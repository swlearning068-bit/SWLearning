/**
 * reward.js — 模組 9：遊戲化獎勵與每日印花系統
 *
 * 職責：
 * 1. 管理自訂獎勵、目標天數、印花與當日寶石進度（localStorage）
 * 2. earnGem：綁定實質學習行為，每日滿 3 寶石換 1 印花（防刷）
 * 3. 渲染「學習目標」設定表單與印花卡網格
 * 4. 滿卡時呼叫 AI 生成督導祝賀信（低 Token：僅此時才打 API）
 *
 * 依賴：app.js（showToast、$）、deepseek.js（generateCelebrationLetterAPI）
 */

/* ============================================================
   常數
   ============================================================ */

/** localStorage 鍵名：獎勵總狀態 */
const STORAGE_KEY_REWARD = 'sw_reward_state';

/** localStorage 鍵名：已領過寶石的文章挑戰 ID */
const STORAGE_KEY_COMPLETED_CHALLENGES = 'sw_completed_challenges';

/** 每日達成印花所需寶石數 */
const GEMS_PER_STAMP = 3;

/** 可選目標天數 */
const REWARD_DAY_OPTIONS = [7, 14, 21];

/** 本地社工鼓勵語錄（日常不耗 Token） */
const encouragements = [
  '社工魂燃燒！繼續保持！',
  '案主會因為你的努力而受益！',
  '今天的進步是明天的專業底氣！',
  '一步一腳印，專業就在累積中！',
  '你願意學習，就是對服務對象最好的承諾！',
  '堅持複習，英文會變成你的實務工具！',
  '小進步也值得慶祝，加油！',
  '專業社工，從每天的一點努力開始！',
  '你的付出，正在變成更好的陪伴能力！',
  '學習路上不孤單，督導為你按讚！'
];

/* ============================================================
   狀態
   ============================================================ */

/**
 * @typedef {{ date: string, gems: number, stampEarned: boolean }} DailyProgress
 * @typedef {{
 *   rewardGoal: string,
 *   totalDays: number,
 *   currentStamps: number,
 *   dailyProgress: DailyProgress
 * }} RewardState
 */

/** @type {RewardState} */
let rewardState = createDefaultRewardState();

/**
 * 下次渲染印花卡時，要套用蓋章動畫的格子索引（0-based）；無則為 null
 * @type {number|null}
 */
let pendingStampAnimateIndex = null;

/**
 * 已給過寶石的文章挑戰 ID 列表（防重複刷同一篇文章）
 * @type {string[]}
 */
let completedChallenges = (function loadCompletedChallenges() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY_COMPLETED_CHALLENGES)
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id)).filter(Boolean);
  } catch (_) {
    return [];
  }
})();

/**
 * 將已完成挑戰列表寫回 localStorage
 */
function saveCompletedChallenges() {
  try {
    localStorage.setItem(
      STORAGE_KEY_COMPLETED_CHALLENGES,
      JSON.stringify(completedChallenges)
    );
  } catch (err) {
    console.warn('[reward.js] 無法寫入挑戰快取', err);
  }
}

/* ============================================================
   音效與煙火 Helper
   ============================================================ */

/**
 * 中等規模慶祝煙火（獲得今日印花）
 */
function playConfetti() {
  if (typeof confetti !== 'function') return;
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#FCD34D', '#10B981', '#3B82F6']
  });
}

/**
 * 輕量「叮」聲（Web Audio API，無需外部音檔）
 */
function playDingSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);

    // 音效結束後關閉 context，避免累積
    osc.onended = () => {
      try {
        ctx.close();
      } catch (_) {
        /* ignore */
      }
    };
  } catch (e) {
    console.log('音效播放失敗', e);
  }
}

/**
 * 滿卡終極煙火：左右兩側持續約 3 秒
 */
function playUltimateConfetti() {
  if (typeof confetti !== 'function') return;

  const duration = 3000;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#FCD34D']
    });
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#FCD34D']
    });
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
}

/**
 * 為「今日寶石進度」加上短暫彈跳回饋
 */
function bounceTodayGems() {
  const el = document.querySelector('.reward-today-gems');
  if (!el) return;
  el.classList.remove('gem-bounce');
  // 強制重播 animation
  void el.offsetWidth;
  el.classList.add('gem-bounce');
}

window.playConfetti = playConfetti;
window.playDingSound = playDingSound;
window.playUltimateConfetti = playUltimateConfetti;

/* ============================================================
   日期與預設狀態
   ============================================================ */

/**
 * 取得本地今日日期字串 YYYY-MM-DD
 * @returns {string}
 */
function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 建立預設獎勵狀態
 * @returns {RewardState}
 */
function createDefaultRewardState() {
  return {
    rewardGoal: '',
    totalDays: 0,
    currentStamps: 0,
    dailyProgress: {
      date: getTodayDateString(),
      gems: 0,
      stampEarned: false
    }
  };
}

/**
 * 若 dailyProgress.date 不是今天，重置當日寶石與印花標記
 * @param {RewardState} state
 * @returns {RewardState}
 */
function ensureDailyProgressFresh(state) {
  const today = getTodayDateString();
  if (!state.dailyProgress || state.dailyProgress.date !== today) {
    state.dailyProgress = {
      date: today,
      gems: 0,
      stampEarned: false
    };
  }
  return state;
}

/* ============================================================
   localStorage 讀寫
   ============================================================ */

/**
 * 從 localStorage 載入獎勵狀態；損壞或缺漏時回傳預設
 * @returns {RewardState}
 */
function loadRewardState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REWARD);
    if (!raw) return createDefaultRewardState();

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultRewardState();
    }

    const state = {
      rewardGoal:
        typeof parsed.rewardGoal === 'string' ? parsed.rewardGoal.trim() : '',
      totalDays: Number(parsed.totalDays) || 0,
      currentStamps: Math.max(0, Number(parsed.currentStamps) || 0),
      dailyProgress: {
        date:
          parsed.dailyProgress && typeof parsed.dailyProgress.date === 'string'
            ? parsed.dailyProgress.date
            : getTodayDateString(),
        gems: Math.max(0, Number(parsed.dailyProgress?.gems) || 0),
        stampEarned: Boolean(parsed.dailyProgress?.stampEarned)
      }
    };

    return ensureDailyProgressFresh(state);
  } catch (_) {
    return createDefaultRewardState();
  }
}

/**
 * 將目前獎勵狀態寫入 localStorage
 */
function saveRewardState() {
  try {
    localStorage.setItem(STORAGE_KEY_REWARD, JSON.stringify(rewardState));
  } catch (err) {
    console.warn('[reward.js] 無法寫入獎勵狀態', err);
  }
}

/**
 * 是否已設定學習目標
 * @returns {boolean}
 */
function hasRewardGoal() {
  return Boolean(
    rewardState.rewardGoal &&
      rewardState.totalDays > 0 &&
      REWARD_DAY_OPTIONS.includes(rewardState.totalDays)
  );
}

/* ============================================================
   鼓勵語與寶石顯示
   ============================================================ */

/**
 * 隨機抽取一句本地鼓勵語
 * @returns {string}
 */
function pickEncouragement() {
  const i = Math.floor(Math.random() * encouragements.length);
  return encouragements[i] || encouragements[0];
}

/**
 * 以 💎 字元視覺化今日寶石進度（最多 3）
 * @param {number} gems
 * @returns {string}
 */
function formatGemIcons(gems) {
  const filled = Math.min(GEMS_PER_STAMP, Math.max(0, gems));
  const empty = GEMS_PER_STAMP - filled;
  return '💎'.repeat(filled) + '⚪'.repeat(empty);
}

/**
 * 安全顯示 Toast（優先用 app.js 的 showToast）
 * @param {string} message
 */
function rewardToast(message) {
  if (typeof showToast === 'function') {
    showToast(message);
    return;
  }
  if (typeof window.showToast === 'function') {
    window.showToast(message);
    return;
  }
  console.log('[reward]', message);
}

/* ============================================================
   獲得寶石（全域觸發）
   ============================================================ */

/**
 * 學習行為觸發：獲得 1 顆寶石（每日限換 1 印花）
 * @param {string} [source='unknown'] - 來源標記（quiz / challenge 等）
 * @param {string|number|null} [referenceId=null] - 挑戰文章 ID（防重複）
 * @returns {boolean} 是否成功增加寶石
 */
function earnGem(source, referenceId = null) {
  const src = String(source || 'unknown');
  const refId =
    referenceId != null && String(referenceId).trim() !== ''
      ? String(referenceId)
      : null;

  // 文章挑戰：同一篇文章不可重複領寶石
  if (src === 'challenge' && refId) {
    if (completedChallenges.includes(refId)) {
      rewardToast(
        '✅ 複習得很棒！但此文章的寶石已領取過，去挑戰新文章吧！'
      );
      return false;
    }
  }

  // 尚未設定目標：不給寶石，避免空轉刷分
  if (!hasRewardGoal()) {
    console.debug('[reward.js] 尚未設定目標，略過 earnGem：', src);
    return false;
  }

  rewardState = ensureDailyProgressFresh(rewardState);

  // 今日印花已達成 → 防刷
  if (rewardState.dailyProgress.stampEarned) {
    rewardToast('今日印花已達成！明日再來挑戰吧💪');
    return false;
  }

  // 確認將發放寶石後，才記錄此文章已領過（避免印花已滿卻鎖死文章）
  if (src === 'challenge' && refId) {
    completedChallenges.push(refId);
    saveCompletedChallenges();
  }

  rewardState.dailyProgress.gems += 1;
  saveRewardState();

  const gems = rewardState.dailyProgress.gems;

  // 視覺／聽覺回饋：叮聲 + 寶石進度彈跳
  playDingSound();

  if (gems < GEMS_PER_STAMP) {
    const quote = pickEncouragement();
    rewardToast(
      `💎 獲得 1 顆寶石！(目前 ${gems}/${GEMS_PER_STAMP}) - ${quote}`
    );
    refreshRewardView();
    bounceTodayGems();
    return true;
  }

  // 剛好滿 3 顆 → 蓋印
  if (gems === GEMS_PER_STAMP) {
    rewardState.dailyProgress.stampEarned = true;
    rewardState.currentStamps = Math.min(
      rewardState.totalDays,
      rewardState.currentStamps + 1
    );
    saveRewardState();

    const stamps = rewardState.currentStamps;
    const total = rewardState.totalDays;

    // 蓋章打擊感：僅為剛獲得的那一格播放動畫
    pendingStampAnimateIndex = stamps - 1;

    playConfetti();
    showStampEarnedModal(stamps, total);
    refreshRewardView();
    bounceTodayGems();

    if (stamps >= total && total > 0) {
      // 稍後觸發終極慶祝，讓印花 Modal 先出現
      setTimeout(() => {
        triggerUltimateCelebration();
      }, 600);
    }

    return true;
  }

  // gems > 3 理論上不該發生（stampEarned 會擋）；保險重置顯示
  refreshRewardView();
  return false;
}

window.earnGem = earnGem;

/* ============================================================
   Modal：今日印花 / 終極慶祝
   ============================================================ */

/**
 * 顯示「恭喜獲得今日印花」Modal
 * @param {number} stamps
 * @param {number} total
 */
function showStampEarnedModal(stamps, total) {
  const modal = document.getElementById('stamp-earned-modal');
  const textEl = document.getElementById('stamp-earned-text');
  if (textEl) {
    textEl.textContent = `🎉 恭喜獲得今日印花！目前進度 (${stamps}/${total})`;
  }
  if (modal) modal.classList.remove('hidden');
}

/**
 * 關閉今日印花 Modal
 */
function closeStampEarnedModal() {
  const modal = document.getElementById('stamp-earned-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * 顯示終極慶祝 Modal（含載入狀態）
 */
function openCelebrationModal() {
  const modal = document.getElementById('celebration-modal');
  const body = document.getElementById('celebration-letter-body');
  const loading = document.getElementById('celebration-loading');
  const claimBtn = document.getElementById('btn-claim-reward');

  if (loading) loading.classList.remove('hidden');
  if (body) {
    body.classList.add('hidden');
    body.innerHTML = '';
  }
  if (claimBtn) claimBtn.disabled = true;
  if (modal) modal.classList.remove('hidden');
}

/**
 * 關閉終極慶祝 Modal
 */
function closeCelebrationModal() {
  const modal = document.getElementById('celebration-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * 滿卡後：呼叫 AI 生成督導祝賀信並華麗展示
 */
async function triggerUltimateCelebration() {
  closeStampEarnedModal();
  openCelebrationModal();

  // 持續煙火 + 印花卡外框呼吸發光
  playUltimateConfetti();
  playDingSound();
  const stampGrid = document.getElementById('stamp-grid');
  if (stampGrid) {
    stampGrid.classList.add('is-complete', 'pulse-glow');
  }

  const body = document.getElementById('celebration-letter-body');
  const loading = document.getElementById('celebration-loading');
  const claimBtn = document.getElementById('btn-claim-reward');
  const goalEl = document.getElementById('celebration-goal-label');

  if (goalEl) {
    goalEl.textContent = `獎勵：${rewardState.rewardGoal}`;
  }

  try {
    if (typeof generateCelebrationLetterAPI !== 'function') {
      throw new Error('找不到慶祝信 API，請重新整理頁面。');
    }

    const letter = await generateCelebrationLetterAPI(
      rewardState.totalDays,
      rewardState.rewardGoal
    );

    if (loading) loading.classList.add('hidden');
    if (body) {
      body.classList.remove('hidden');
      body.innerHTML =
        `<p class="celebration-letter-en">${escapeRewardHtml(letter.message_en)}</p>` +
        `<p class="celebration-letter-zh">${escapeRewardHtml(letter.message_zh)}</p>`;
    }
    if (claimBtn) claimBtn.disabled = false;
  } catch (err) {
    console.error('[reward.js] 終極慶祝失敗：', err);
    if (loading) loading.classList.add('hidden');
    if (body) {
      body.classList.remove('hidden');
      const fallbackEn =
        'Congratulations on completing your learning challenge! Your dedication reflects the heart of social work — growth in service of others.';
      const fallbackZh =
        `恭喜你完成 ${rewardState.totalDays} 天的學習挑戰！你的堅持體現了社工精神——為了更好地服務他人而不斷成長。` +
        (err && err.message
          ? `\n（AI 祝賀信暫時無法生成：${err.message}）`
          : '');
      body.innerHTML =
        `<p class="celebration-letter-en">${escapeRewardHtml(fallbackEn)}</p>` +
        `<p class="celebration-letter-zh">${escapeRewardHtml(fallbackZh)}</p>`;
    }
    if (claimBtn) claimBtn.disabled = false;
  }
}

window.triggerUltimateCelebration = triggerUltimateCelebration;

/**
 * HTML 跳脫
 * @param {string} text
 * @returns {string}
 */
function escapeRewardHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 領取獎勵並重置，開啟下一輪目標
 */
function claimRewardAndReset() {
  rewardState = createDefaultRewardState();
  saveRewardState();
  closeCelebrationModal();
  refreshRewardView();
  rewardToast('已領取獎勵！請設定下一輪學習目標 🏆');
}

/* ============================================================
   UI 渲染
   ============================================================ */

/**
 * 刷新 #reward-section 畫面（設定表單 or 印花卡）
 */
function refreshRewardView() {
  rewardState = ensureDailyProgressFresh(rewardState);
  saveRewardState();

  const setupEl = document.getElementById('reward-setup');
  const boardEl = document.getElementById('reward-board');
  if (!setupEl || !boardEl) return;

  if (!hasRewardGoal()) {
    setupEl.classList.remove('hidden');
    boardEl.classList.add('hidden');
    return;
  }

  setupEl.classList.add('hidden');
  boardEl.classList.remove('hidden');

  const goalText = document.getElementById('reward-goal-display');
  if (goalText) {
    const gems = rewardState.dailyProgress.gems;
    const gemIcons = formatGemIcons(
      rewardState.dailyProgress.stampEarned ? GEMS_PER_STAMP : gems
    );
    goalText.innerHTML =
      `為了獲得 <strong class="reward-goal-name">【${escapeRewardHtml(
        rewardState.rewardGoal
      )}】</strong>，請每天集滿 ${GEMS_PER_STAMP} 顆寶石！` +
      `<span class="reward-today-gems">（今日進度：${gemIcons}）</span>`;
  }

  const progressMeta = document.getElementById('reward-progress-meta');
  if (progressMeta) {
    progressMeta.textContent = `印花進度：${rewardState.currentStamps} / ${rewardState.totalDays}`;
  }

  renderStampGrid();
}

/**
 * 以 CSS Grid 渲染印花卡方格
 */
function renderStampGrid() {
  const grid = document.getElementById('stamp-grid');
  if (!grid) return;

  const total = rewardState.totalDays;
  const earned = rewardState.currentStamps;

  // 若獎勵分頁未顯示，保留 pending 索引，切換 Tab 時再播蓋章動畫
  const rewardSection = document.getElementById('reward-section');
  const boardVisible =
    rewardSection && !rewardSection.classList.contains('hidden');
  const animateIndex = boardVisible ? pendingStampAnimateIndex : null;
  if (boardVisible) {
    pendingStampAnimateIndex = null;
  }

  const isComplete = earned >= total && total > 0;
  grid.classList.toggle('is-complete', isComplete);
  grid.classList.toggle('pulse-glow', isComplete);

  grid.style.setProperty('--stamp-cols', String(Math.min(7, total)));
  grid.innerHTML = '';

  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    const isEarned = i < earned;
    const isFreshStamp = isEarned && animateIndex === i;

    cell.className =
      'stamp-cell' +
      (isEarned ? ' is-earned' : ' is-locked') +
      (isFreshStamp ? ' stamp-animate' : '');

    cell.setAttribute('role', 'img');
    cell.setAttribute(
      'aria-label',
      isEarned ? `第 ${i + 1} 天：已獲得印花` : `第 ${i + 1} 天：尚未獲得`
    );

    const dayLabel = document.createElement('span');
    dayLabel.className = 'stamp-day-label';
    dayLabel.textContent = `D${i + 1}`;

    const icon = document.createElement('span');
    icon.className = 'stamp-icon' + (isFreshStamp ? ' stamp-animate' : '');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isEarned ? '🌸' : '🔒';

    cell.append(dayLabel, icon);
    grid.appendChild(cell);
  }
}

/**
 * 處理目標設定表單送出
 * @param {Event} event
 */
function handleRewardSetupSubmit(event) {
  event.preventDefault();

  const goalInput = document.getElementById('reward-goal-input');
  const daysSelect = document.getElementById('reward-days-select');

  const goal = goalInput ? goalInput.value.trim() : '';
  const days = daysSelect ? Number(daysSelect.value) : 0;

  if (!goal) {
    alert('請輸入你想要的獎勵（例如：吃一頓大餐）。');
    goalInput?.focus();
    return;
  }

  if (!REWARD_DAY_OPTIONS.includes(days)) {
    alert('請選擇目標天數：7、14 或 21 天。');
    return;
  }

  rewardState = {
    rewardGoal: goal,
    totalDays: days,
    currentStamps: 0,
    dailyProgress: {
      date: getTodayDateString(),
      gems: 0,
      stampEarned: false
    }
  };
  saveRewardState();
  refreshRewardView();
  rewardToast(`目標已設定！為了「${goal}」，開始收集寶石吧 💎`);
}

/**
 * 綁定獎勵區事件（只執行一次）
 */
function bindRewardEvents() {
  const form = document.getElementById('reward-setup-form');
  form?.addEventListener('submit', handleRewardSetupSubmit);

  document
    .getElementById('btn-close-stamp-modal')
    ?.addEventListener('click', closeStampEarnedModal);
  document
    .getElementById('stamp-earned-modal')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeStampEarnedModal();
    });

  document
    .getElementById('btn-close-celebration')
    ?.addEventListener('click', closeCelebrationModal);
  document
    .getElementById('celebration-modal')
    ?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeCelebrationModal();
    });

  document
    .getElementById('btn-claim-reward')
    ?.addEventListener('click', claimRewardAndReset);

  document
    .getElementById('btn-debug-reset-reward')
    ?.addEventListener('click', debugResetRewardProgress);
}

/**
 * 開發者調試：清空所有獎勵、印花與挑戰紀錄後重新載入
 */
function debugResetRewardProgress() {
  const ok = window.confirm(
    '確定要清空所有獎勵、印花與挑戰紀錄嗎？此操作無法復原。'
  );
  if (!ok) return;

  // 現行合併狀態鍵
  localStorage.removeItem(STORAGE_KEY_REWARD);
  localStorage.removeItem(STORAGE_KEY_COMPLETED_CHALLENGES);

  // 相容任務規格中的舊／拆分鍵名
  localStorage.removeItem('sw_reward_goal');
  localStorage.removeItem('sw_reward_total_days');
  localStorage.removeItem('sw_reward_current_stamps');
  localStorage.removeItem('sw_reward_daily_progress');
  localStorage.removeItem('sw_completed_challenges');

  location.reload();
}

/**
 * 初始化獎勵模組（由 app.js 在 DOMContentLoaded 呼叫）
 */
function initRewardModule() {
  rewardState = loadRewardState();
  saveRewardState();
  bindRewardEvents();
  refreshRewardView();
}

window.initRewardModule = initRewardModule;
window.refreshRewardView = refreshRewardView;
window.hasRewardGoal = hasRewardGoal;
