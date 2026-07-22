/**
 * quest-mode.js — Phase 13：任務模式（之字形棋盤關卡）
 *
 * 職責：
 * 1. 依目前科目自動分配 5–10 個跨科目關卡
 * 2. 渲染 S 型關卡地圖（active / completed / locked）
 * 3. 開啟專屬挑戰視圖：段落閱讀 → 即時測驗 → L1/L2/L3 漸進寫作
 * 4. 通關後解鎖下一關並寫入 localStorage（可隨 Firebase 同步）
 */

/* ============================================================
   常數
   ============================================================ */

/** localStorage：關卡進度 */
const STORAGE_KEY_QUEST = 'sw_quest_levels';

/** 關卡數量範圍 */
const QUEST_LEVEL_MIN = 5;
const QUEST_LEVEL_MAX = 10;

/**
 * 各科目關卡標題素材（跨科混搭用）
 * @type {Record<string, string[]>}
 */
const QUEST_TITLE_BANK = {
  family_social_work: ['家庭結構基礎', '三角關係辨識', '親子動力觀察', '家訪危機應對'],
  mental_health: ['精神健康初探', '復元語言練習', '危機介入詞彙', '去污名化表達'],
  casework: ['個案接案用語', '評估報告骨架', '介入計畫草稿', '結案紀錄精煉'],
  elderly: ['長者照顧情境', '認知障礙溝通', '照顧者支持語言', '社區安老倡議'],
  children_youth: ['兒保通報情境', '青少年風險辨識', '學校社工對話', '發展需求評估'],
  group_work: ['小組動力觀察', '帶領技巧用語', '凝聚力促進', '過程紀錄寫作'],
  community_work: ['社區賦權基礎', '資源連結用語', '倡議行動語言', '社區評估短文'],
  social_policy: ['福利政策詞彙', '經濟審查情境', '房屋政策討論', '扶貧論述練習'],
  disability: ['無障礙倡議', '權利本位語言', '融合實務對話', '賦權評估寫作'],
  intro_psych: ['防衛機制辨識', '創傷知情用語', 'CBT 概念應用', '情緒調節描述'],
  ethics_and_values: ['倫理兩難思辨', '保密界限權衡', '自主與保護', '專業反思書寫'],
  sw_admin: ['督導對話用語', '服務規劃語言', '資源配置說明', '機構管理短評'],
  sw_research: ['實證實務導讀', '質性訪談用語', '評估指標描述', '研究摘要改寫'],
  general_practice: ['家訪日常用語', '資源轉介表達', '跟進紀錄練習', '前線溝通情境']
};

/* ============================================================
   狀態
   ============================================================ */

/** @type {Array<Object>} */
let questLevels = [];

/** @type {Object|null} */
let activeQuestLevel = null;

/** @type {Object|null} */
let questChallengeArticle = null;

/** 開啟挑戰前暫存的科目 ID（關閉時還原） */
let questSubjectBackupId = '';

/** @type {{ reading: boolean, quiz: boolean, writing: boolean }} */
let questProgress = { reading: false, quiz: false, writing: false };

/* ============================================================
   DOM / 工具
   ============================================================ */

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function quest$(id) {
  return document.getElementById(id);
}

/**
 * @param {string} message
 */
function questToast(message) {
  if (typeof window.showToast === 'function') {
    window.showToast(message);
  }
}

/**
 * @returns {Array<{id: string, name: string}>}
 */
function getQuestSubjectsList() {
  if (Array.isArray(window.subjectsList) && window.subjectsList.length) {
    return window.subjectsList;
  }
  return [
    { id: 'general_practice', name: '通用社工實務' },
    { id: 'family_social_work', name: '家庭社工實務' },
    { id: 'mental_health', name: '精神健康' }
  ];
}

/**
 * @returns {{id: string, name: string}|null}
 */
function getQuestCurrentSubject() {
  if (window.currentSubject && window.currentSubject.id) {
    return window.currentSubject;
  }
  if (typeof window.getCurrentSubject === 'function') {
    return window.getCurrentSubject();
  }
  const list = getQuestSubjectsList();
  return list[0] || null;
}

/**
 * @param {string} subjectId
 * @returns {string}
 */
function getSubjectDisplayName(subjectId) {
  const found = getQuestSubjectsList().find((s) => s.id === subjectId);
  return found?.name || subjectId || '社工實務';
}

/**
 * 暫時切換科目（供關卡生成 API 使用）
 * @param {string} subjectId
 */
function applyQuestSubject(subjectId) {
  const list = getQuestSubjectsList();
  const found = list.find((s) => s.id === subjectId) || list[0];
  if (!found) return;

  const key =
    typeof STORAGE_KEY_SUBJECT !== 'undefined'
      ? STORAGE_KEY_SUBJECT
      : 'swlearning_current_subject';

  localStorage.setItem(key, found.id);
  window.currentSubject = found;

  const selector = quest$('subject-selector');
  if (selector) selector.value = found.id;
}

/**
 * 還原開啟挑戰前的科目
 */
function restoreQuestSubjectBackup() {
  if (!questSubjectBackupId) return;
  applyQuestSubject(questSubjectBackupId);
  questSubjectBackupId = '';
}

/* ============================================================
   關卡資料：讀寫 / 生成
   ============================================================ */

/**
 * @returns {Array<Object>}
 */
function loadQuestLevels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUEST);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => normalizeQuestLevel(item, index));
  } catch (_) {
    return [];
  }
}

/**
 * @param {Object} item
 * @param {number} index
 * @returns {Object}
 */
function normalizeQuestLevel(item, index) {
  const status = ['active', 'locked', 'completed'].includes(item.status)
    ? item.status
    : index === 0
      ? 'active'
      : 'locked';
  const level = String(item.level || 'L1').toUpperCase();
  const track =
    item.track === 'literature' || level === 'L3' ? 'literature' : 'story';

  return {
    id: Number(item.id) || index + 1,
    level: level === 'L2' || level === 'L3' ? level : 'L1',
    subject: String(item.subject || 'general_practice'),
    title: String(item.title || `關卡 ${index + 1}`),
    track,
    status
  };
}

/**
 * 寫入 localStorage（觸發雲端同步 hook）
 */
function saveQuestLevels() {
  try {
    localStorage.setItem(STORAGE_KEY_QUEST, JSON.stringify(questLevels));
    if (typeof window.__swNotifyDataChanged === 'function') {
      window.__swNotifyDataChanged(STORAGE_KEY_QUEST);
    }
  } catch (err) {
    console.warn('[quest-mode] 無法寫入關卡進度', err);
  }
}

/**
 * 確保狀態鏈正確：第一個未完成 = active，其後 locked，已完成保持 completed
 */
function reconcileQuestStatuses() {
  let unlockedNext = true;
  questLevels = questLevels.map((level) => {
    if (level.status === 'completed') {
      return level;
    }
    if (unlockedNext) {
      unlockedNext = false;
      return { ...level, status: 'active' };
    }
    return { ...level, status: 'locked' };
  });
}

/**
 * 依種子打亂陣列（穩定、可重現）
 * @template T
 * @param {T[]} list
 * @param {number} seed
 * @returns {T[]}
 */
function seededShuffle(list, seed) {
  const arr = list.slice();
  let s = seed || 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 為指定「錨點科目」產生 5–10 個跨科目關卡
 * @param {string} [anchorSubjectId]
 * @param {{force?: boolean}} [options]
 * @returns {Array<Object>}
 */
function generateQuestLevels(anchorSubjectId, options) {
  const subjects = getQuestSubjectsList();
  const anchor =
    subjects.find((s) => s.id === anchorSubjectId)?.id ||
    getQuestCurrentSubject()?.id ||
    subjects[0]?.id ||
    'general_practice';

  const count =
    QUEST_LEVEL_MIN +
    Math.floor(Math.random() * (QUEST_LEVEL_MAX - QUEST_LEVEL_MIN + 1));

  // 錨點科目優先排前段，其餘科目交錯
  const others = subjects.filter((s) => s.id !== anchor);
  const shuffledOthers = seededShuffle(
    others,
    Date.now() % 100000 + count * 17
  );

  const subjectSequence = [];
  subjectSequence.push(anchor);
  for (let i = 0; i < count - 1; i += 1) {
    if (i % 2 === 0 && shuffledOthers.length) {
      subjectSequence.push(shuffledOthers[i % shuffledOthers.length].id);
    } else {
      subjectSequence.push(
        i % 3 === 0
          ? anchor
          : shuffledOthers[(i + 1) % Math.max(shuffledOthers.length, 1)]?.id ||
            anchor
      );
    }
  }

  const titleCursor = {};
  const levels = subjectSequence.slice(0, count).map((subjectId, index) => {
    const bank = QUEST_TITLE_BANK[subjectId] || QUEST_TITLE_BANK.general_practice;
    const cursor = titleCursor[subjectId] || 0;
    titleCursor[subjectId] = cursor + 1;
    const title = bank[cursor % bank.length];

    let tier = 'L1';
    let track = 'story';
    if (index >= Math.floor(count * 0.7)) {
      tier = 'L3';
      track = 'literature';
    } else if (index >= Math.floor(count * 0.35)) {
      tier = 'L2';
      track = index % 2 === 0 ? 'story' : 'literature';
    }

    return {
      id: index + 1,
      level: tier,
      subject: subjectId,
      title,
      track,
      status: index === 0 ? 'active' : 'locked'
    };
  });

  questLevels = levels;
  saveQuestLevels();

  if (!options?.silent) {
    questToast(`🗺️ 已分配 ${levels.length} 個任務關卡，出發吧！`);
  }

  return levels;
}

/**
 * 若尚無關卡則生成；學習目標啟動時可 force 重建
 * @param {{force?: boolean, silent?: boolean}} [options]
 */
function ensureQuestLevels(options) {
  const force = Boolean(options?.force);
  if (!force) {
    const existing = loadQuestLevels();
    if (existing.length >= QUEST_LEVEL_MIN) {
      questLevels = existing;
      reconcileQuestStatuses();
      saveQuestLevels();
      return questLevels;
    }
  }

  const currentId = getQuestCurrentSubject()?.id;
  return generateQuestLevels(currentId, { silent: options?.silent });
}

/**
 * 學習目標啟動時呼叫：依目前科目重新分配關卡
 */
function onLearningGoalStarted() {
  generateQuestLevels(getQuestCurrentSubject()?.id, { silent: false });
  if (typeof refreshQuestView === 'function') {
    refreshQuestView();
  }
}

/* ============================================================
   地圖渲染
   ============================================================ */

/**
 * 奇數靠左、偶數靠右（1-based），中段可置中形成 S 型
 * @param {number} index0
 * @returns {'left'|'center'|'right'}
 */
function getSnakeAlignment(index0) {
  const n = index0 + 1;
  if (n % 3 === 2) return 'center';
  return n % 2 === 1 ? 'left' : 'right';
}

/**
 * @param {Object} level
 * @returns {string}
 */
function getNodeIcon(level) {
  if (level.status === 'completed') return '✓';
  if (level.status === 'locked') return '🔒';
  if (level.level === 'L3') return '🌳';
  if (level.level === 'L2') return '🌿';
  return '🌱';
}

/**
 * 渲染 #quest-map-container
 */
function renderQuestMap() {
  const container = quest$('quest-map-container');
  const hint = quest$('quest-status-hint');
  if (!container) return;

  ensureQuestLevels({ silent: true });
  container.innerHTML = '';

  if (!questLevels.length) {
    container.innerHTML =
      '<p class="quest-status-hint">尚無關卡。請先到「學習目標」開始挑戰，或點上方重新分配。</p>';
    if (hint) {
      hint.textContent = '尚未建立任務地圖。';
    }
    return;
  }

  const completed = questLevels.filter((l) => l.status === 'completed').length;
  const active = questLevels.find((l) => l.status === 'active');
  if (hint) {
    hint.textContent = active
      ? `進度 ${completed}/${questLevels.length}｜目前關卡：${active.title}`
      : `🎉 全部通關！共完成 ${completed} 關`;
  }

  questLevels.forEach((level, index) => {
    const row = document.createElement('div');
    const align = getSnakeAlignment(index);
    row.className = `quest-map-row quest-map-row--${align}`;

    const node = document.createElement('button');
    node.type = 'button';
    node.className = `quest-node node-${level.status}`;
    node.dataset.questId = String(level.id);
    node.setAttribute(
      'aria-label',
      `${level.title}，${level.level}，${level.status}`
    );
    if (level.status === 'locked') {
      node.disabled = true;
    }

    node.innerHTML =
      `<span class="quest-node-btn" aria-hidden="true">${getNodeIcon(level)}</span>` +
      `<span class="quest-node-label">${escapeQuestHtml(level.title)}</span>` +
      `<span class="quest-node-sub">${escapeQuestHtml(level.level)} · ${escapeQuestHtml(
        getSubjectDisplayName(level.subject)
      )}</span>`;

    node.addEventListener('click', () => {
      if (level.status === 'locked') {
        questToast('🔒 請先完成前一關卡');
        return;
      }
      openQuestChallenge(level);
    });

    row.appendChild(node);
    container.appendChild(row);
  });
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeQuestHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 刷新任務模式畫面
 */
function refreshQuestView() {
  renderQuestMap();
}

/* ============================================================
   挑戰視圖
   ============================================================ */

/**
 * 更新頂部步驟指示
 */
function syncQuestStepIndicators() {
  const steps = document.querySelectorAll('.quest-step[data-quest-step]');
  steps.forEach((el) => {
    const key = el.getAttribute('data-quest-step');
    el.classList.toggle('is-done', Boolean(questProgress[key]));
    el.classList.remove('is-current');
  });

  let current = 'reading';
  if (questProgress.reading && !questProgress.quiz) current = 'quiz';
  else if (questProgress.quiz && !questProgress.writing) current = 'writing';
  else if (questProgress.writing) current = 'writing';

  const currentEl = document.querySelector(
    `.quest-step[data-quest-step="${current}"]`
  );
  if (currentEl && !questProgress.writing) {
    currentEl.classList.add('is-current');
  }

  const completeBtn = quest$('btn-quest-complete');
  if (completeBtn) {
    const ready =
      questProgress.reading &&
      questProgress.quiz &&
      questProgress.writing;
    completeBtn.classList.toggle('hidden', !questProgress.reading);
    completeBtn.disabled = !ready;
    completeBtn.textContent = ready
      ? '🏅 完成本關卡'
      : '🏅 完成閱讀／測驗／寫作後可通關';
  }
}

/**
 * @param {'reading'|'quiz'|'writing'} key
 */
function markQuestProgress(key) {
  if (!questProgress[key]) {
    questProgress[key] = true;
    syncQuestStepIndicators();
  }
}

/**
 * 綁定挑戰區內測驗與寫作完成偵測
 * @param {HTMLElement} root
 */
function bindQuestChallengeProgress(root) {
  if (!root) return;

  root.addEventListener('click', (event) => {
    // 即時測驗：點選選項或按「檢查」
    const quizHit = event.target.closest(
      '.practice-quiz-option, .practice-quiz-check, .practice-quiz-radio, .inline-quiz-option'
    );
    if (quizHit && root.contains(quizHit)) {
      markQuestProgress('quiz');
    }

    // L1 檢查答案正確
    const checkBtn = event.target.closest('.writing-l1-cloze .btn');
    if (checkBtn && root.contains(checkBtn)) {
      setTimeout(() => {
        const feedback = root.querySelector('.writing-check-feedback.is-correct');
        if (feedback) markQuestProgress('writing');
      }, 0);
    }

    // L2 對答案
    const l2Btn = event.target.closest('.writing-l2-sentence .btn');
    if (l2Btn && root.contains(l2Btn)) {
      markQuestProgress('writing');
    }

    // L3 送出督導
    const l3Btn = event.target.closest('.btn-submit-clinical-task');
    if (l3Btn && root.contains(l3Btn)) {
      markQuestProgress('writing');
    }
  });

  // 無段落測驗時，自動視為 quiz 步驟完成
  const hasQuiz = Boolean(root.querySelector('.practice-inline-quiz'));
  if (!hasQuiz) {
    markQuestProgress('quiz');
  }
}

/**
 * 開啟任務挑戰視圖
 * @param {Object} level
 */
function openQuestChallenge(level) {
  const overlay = quest$('quest-challenge-overlay');
  if (!overlay || !level) return;

  activeQuestLevel = level;
  questChallengeArticle = null;
  questProgress = { reading: false, quiz: false, writing: false };

  const current = getQuestCurrentSubject();
  questSubjectBackupId = current?.id || '';
  applyQuestSubject(level.subject);

  const meta = quest$('quest-challenge-meta');
  const title = quest$('quest-challenge-title');
  if (meta) {
    meta.textContent = `${level.level} · ${getSubjectDisplayName(level.subject)} · ${
      level.track === 'literature' ? '模擬學術文獻' : '社工小故事'
    }`;
  }
  if (title) title.textContent = level.title;

  const root = quest$('quest-challenge-root');
  if (root) root.innerHTML = '';
  hideQuestEl(quest$('quest-challenge-error'));
  hideQuestEl(quest$('quest-challenge-loading'));

  const genBtn = quest$('btn-quest-generate');
  if (genBtn) {
    genBtn.disabled = false;
    genBtn.classList.remove('hidden');
    genBtn.textContent = '🚀 開始本關挑戰（生成文章）';
  }

  syncQuestStepIndicators();

  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

/**
 * 關閉挑戰視圖並還原科目
 */
function closeQuestChallenge() {
  const overlay = quest$('quest-challenge-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
  activeQuestLevel = null;
  questChallengeArticle = null;
  restoreQuestSubjectBackup();

  const root = quest$('quest-challenge-root');
  if (root) root.innerHTML = '';
}

/**
 * @param {HTMLElement|null} el
 */
function hideQuestEl(el) {
  if (el) el.classList.add('hidden');
}

/**
 * @param {HTMLElement|null} el
 */
function showQuestEl(el) {
  if (el) el.classList.remove('hidden');
}

/**
 * 為本關生成互動文章並渲染
 */
async function handleQuestGenerateArticle() {
  const level = activeQuestLevel;
  if (!level) return;

  const apiFn =
    level.track === 'literature'
      ? window.generateInteractiveLiteratureAPI
      : window.generateInteractiveStoryAPI;

  if (typeof apiFn !== 'function') {
    showQuestError('AI 模組尚未載入，請強制重新整理頁面後再試。');
    return;
  }

  const hasKey = !!localStorage.getItem(
    typeof STORAGE_KEY_API !== 'undefined'
      ? STORAGE_KEY_API
      : 'swlearning_deepseek_api_key'
  );
  if (!hasKey) {
    showQuestError('請先在設定中輸入 DeepSeek API Key。');
    return;
  }

  applyQuestSubject(level.subject);

  const loading = quest$('quest-challenge-loading');
  const genBtn = quest$('btn-quest-generate');
  const root = quest$('quest-challenge-root');

  hideQuestEl(quest$('quest-challenge-error'));
  showQuestEl(loading);
  if (genBtn) genBtn.disabled = true;
  if (root) root.innerHTML = '';

  try {
    const data = await apiFn();
    const article = {
      ...data,
      id: `quest-${level.id}-${Date.now()}`,
      track: level.track === 'literature' ? 'literature' : 'story',
      type: 'quest',
      subjectId: level.subject,
      subjectName: getSubjectDisplayName(level.subject),
      questLevelId: level.id
    };

    questChallengeArticle = article;
    hideQuestEl(loading);

    if (typeof renderPracticeArticle === 'function' && root) {
      renderPracticeArticle(article, root, { skipScroll: true });
      markQuestProgress('reading');
      bindQuestChallengeProgress(root);
      if (genBtn) {
        genBtn.textContent = '🔄 重新生成文章';
        genBtn.disabled = false;
      }
      questToast('📖 文章已就緒，請完成段落測驗與寫作練習');
    } else {
      showQuestError('無法渲染挑戰文章，請重新整理後再試。');
      if (genBtn) genBtn.disabled = false;
    }
  } catch (error) {
    hideQuestEl(loading);
    showQuestError(error?.message || '生成失敗，請稍後再試。');
    if (genBtn) genBtn.disabled = false;
  }
}

/**
 * @param {string} message
 */
function showQuestError(message) {
  const el = quest$('quest-challenge-error');
  if (!el) {
    questToast(`❌ ${message}`);
    return;
  }
  el.textContent = message;
  showQuestEl(el);
}

/**
 * 通關：標記 completed、解鎖下一關、慶祝
 */
function completeActiveQuestLevel() {
  if (!activeQuestLevel) return;

  if (!(questProgress.reading && questProgress.quiz && questProgress.writing)) {
    questToast('請先完成閱讀、測驗與寫作練習');
    return;
  }

  const id = activeQuestLevel.id;
  const idx = questLevels.findIndex((l) => l.id === id);
  if (idx < 0) return;

  const wasAlreadyDone = questLevels[idx].status === 'completed';
  questLevels[idx] = { ...questLevels[idx], status: 'completed' };

  if (idx + 1 < questLevels.length && questLevels[idx + 1].status !== 'completed') {
    questLevels[idx + 1] = { ...questLevels[idx + 1], status: 'active' };
  }

  reconcileQuestStatuses();
  saveQuestLevels();

  const clearedTitle = activeQuestLevel.title;
  const next = questLevels.find((l) => l.status === 'active');

  closeQuestChallenge();
  renderQuestMap();
  showQuestClearModal(clearedTitle, next);

  if (!wasAlreadyDone && typeof window.earnGem === 'function') {
    try {
      window.earnGem('quest_clear');
    } catch (_) {
      // ignore
    }
  }

  if (typeof confetti === 'function') {
    confetti({
      particleCount: 90,
      spread: 68,
      origin: { y: 0.65 },
      colors: ['#22c55e', '#3b82f6', '#fbbf24']
    });
  }
}

/**
 * @param {string} title
 * @param {Object|null|undefined} nextLevel
 */
function showQuestClearModal(title, nextLevel) {
  const modal = quest$('quest-clear-modal');
  const text = quest$('quest-clear-text');
  if (text) {
    text.textContent = nextLevel
      ? `「${title}」已通關！下一關「${nextLevel.title}」已解鎖。`
      : `「${title}」已通關！你完成了整條社工英文歷險地圖！`;
  }
  if (modal) modal.classList.remove('hidden');
}

function closeQuestClearModal() {
  const modal = quest$('quest-clear-modal');
  if (modal) modal.classList.add('hidden');
}

/* ============================================================
   初始化
   ============================================================ */

/**
 * 綁定事件（只執行一次）
 */
function bindQuestEvents() {
  quest$('btn-quest-regen')?.addEventListener('click', () => {
    const ok = window.confirm(
      '重新分配會重置關卡進度，確定要以目前科目重新產生地圖嗎？'
    );
    if (!ok) return;
    generateQuestLevels(getQuestCurrentSubject()?.id);
    renderQuestMap();
  });

  quest$('btn-quest-challenge-close')?.addEventListener('click', closeQuestChallenge);
  quest$('btn-quest-generate')?.addEventListener('click', handleQuestGenerateArticle);
  quest$('btn-quest-complete')?.addEventListener('click', completeActiveQuestLevel);

  quest$('btn-close-quest-clear')?.addEventListener('click', closeQuestClearModal);
  quest$('quest-clear-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeQuestClearModal();
  });

  // Escape 關閉挑戰
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const overlay = quest$('quest-challenge-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      closeQuestChallenge();
    }
  });
}

/**
 * 由 app.js 在 DOMContentLoaded 呼叫
 */
function initQuestModeModule() {
  questLevels = loadQuestLevels();
  if (questLevels.length) {
    reconcileQuestStatuses();
    saveQuestLevels();
  }
  bindQuestEvents();
}

window.initQuestModeModule = initQuestModeModule;
window.refreshQuestView = refreshQuestView;
window.renderQuestMap = renderQuestMap;
window.generateQuestLevels = generateQuestLevels;
window.ensureQuestLevels = ensureQuestLevels;
window.onLearningGoalStarted = onLearningGoalStarted;
window.getQuestLevels = () => questLevels.slice();
