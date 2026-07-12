/**
 * vocab-learn.js — 模組 6：生字學習（間隔複習系統）
 *
 * 職責：
 * 1. 從 localStorage（sw_progress）篩選今日到期單字
 * 2. 驅動 3D 翻轉單字卡 UI
 * 3. 依自我評估更新間隔、連對次數與下次複習時間
 *
 * 依賴：vocab-library.js（allTerms、getLearningProgress、saveLearningProgress、speakTerm）
 */

/* ============================================================
   常數
   ============================================================ */

/** 一天的毫秒數 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 連對次數 → 間隔天數
 * 新字／重置：1 天；連對 1 次：3 天；連對 2 次：7 天；連對 3 次：14 天
 */
const STREAK_INTERVAL_DAYS = {
  0: 1,
  1: 3,
  2: 7,
  3: 14
};

/* ============================================================
   狀態
   ============================================================ */

/** @type {Array<Object>} 目前待複習的詞彙陣列（含完整 term 資料） */
let dueCards = [];

/** 目前顯示的卡片在 dueCards 中的索引 */
let currentCardIndex = 0;

/** 翻牌動畫進行中時為 true，防止連點導致內容搶先更新 */
let isAnimating = false;

/**
 * 與 flashcard.css 中 .flashcard-inner 的 transition（0.55s）對齊，
 * 再加 50ms 緩衝，避免動畫未結束就換下一題內容
 */
const FLIP_TRANSITION_MS = 600;

/* ============================================================
   間隔複習核心
   ============================================================ */

/**
 * 依連對次數取得間隔天數
 * @param {number} streak - correctStreak（0～3+）
 * @returns {number} 天數
 */
function getIntervalDays(streak) {
  if (streak <= 0) return STREAK_INTERVAL_DAYS[0];
  if (streak >= 3) return STREAK_INTERVAL_DAYS[3];
  return STREAK_INTERVAL_DAYS[streak];
}

/**
 * 讀取 sw_progress，篩選 nextReview ≤ 現在時間的單字，組成待複習陣列
 * @returns {Array<Object>} 到期詞彙物件陣列（來自 allTerms）
 */
function loadDueCards() {
  const progress = getLearningProgress();
  const now = Date.now();
  const due = [];

  Object.keys(progress).forEach((termId) => {
    const entry = progress[termId];
    if (!entry) return;

    // nextReview 為 0 或已到期 → 需要複習
    const nextReview = typeof entry.nextReview === 'number' ? entry.nextReview : 0;
    if (nextReview > now) return;

    // 從詞彙庫找完整資料（allTerms 由 vocab-library.js 維護）
    const term = (typeof allTerms !== 'undefined' ? allTerms : []).find(
      (t) => t.id === termId
    );
    if (term) {
      due.push(term);
    }
  });

  return due;
}

/**
 * 套用自我評估結果，更新該單字進度並存回 localStorage
 *
 * @param {string} termId - 單字 id
 * @param {'again'|'hard'|'easy'} rating - 評估結果
 *   - again：不認識 → interval=1、streak=0
 *   - hard / easy：有點熟／完全掌握 → streak+1，依倍率延長間隔
 */
function applyRating(termId, rating) {
  const progress = getLearningProgress();
  const entry = progress[termId];
  if (!entry) return;

  if (rating === 'again') {
    // 🔴 不認識：重置連對，間隔改為 1 天
    entry.correctStreak = 0;
    entry.interval = 1;
    entry.status = 'learning';
  } else {
    // 🟡 有點熟 / 🟢 完全掌握：連對 +1
    entry.correctStreak = (entry.correctStreak || 0) + 1;
    entry.interval = getIntervalDays(entry.correctStreak);

    if (entry.correctStreak >= 3) {
      entry.status = 'mastered';
    } else {
      entry.status = 'learning';
    }
  }

  // 下次複習時間 = 現在 + interval 天
  entry.nextReview = Date.now() + entry.interval * DAY_MS;
  progress[termId] = entry;
  saveLearningProgress(progress);
}

/* ============================================================
   UI 輔助
   ============================================================ */

/**
 * 顯示／隱藏學習區各狀態區塊
 * @param {'card'|'done'|'empty'} mode
 */
function setLearnViewMode(mode) {
  const cardArea = document.getElementById('flashcard-area');
  const doneEl = document.getElementById('learn-done');
  const emptyEl = document.getElementById('learn-empty');
  const progressText = document.getElementById('learn-progress-text');

  const showEl = (el, visible) => {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  };

  showEl(cardArea, mode === 'card');
  showEl(doneEl, mode === 'done');
  showEl(emptyEl, mode === 'empty');

  if (progressText) {
    if (mode === 'card' && dueCards.length > 0) {
      const remaining = dueCards.length - currentCardIndex;
      progressText.textContent = `今日待複習：還剩 ${remaining} 張`;
      progressText.classList.remove('hidden');
    } else {
      progressText.textContent = '';
      progressText.classList.add('hidden');
    }
  }
}

/**
 * 顯示／隱藏評估按鈕（翻面後才出現）
 * @param {boolean} visible
 */
function setRateButtonsVisible(visible) {
  const rateGroup = document.getElementById('fc-rate-btns');
  if (!rateGroup) return;
  rateGroup.classList.toggle('hidden', !visible);
}

/**
 * 啟用／停用評估按鈕（動畫期間防連點）
 * @param {boolean} disabled
 */
function setRateButtonsDisabled(disabled) {
  const rateGroup = document.getElementById('fc-rate-btns');
  if (!rateGroup) return;
  rateGroup.querySelectorAll('[data-rating]').forEach((btn) => {
    btn.disabled = disabled;
  });
}

/**
 * 將單字卡翻回正面（移除 is-flipped）
 */
function resetFlashcardFlip() {
  const flashcard = document.getElementById('flashcard');
  if (flashcard) flashcard.classList.remove('is-flipped');
  setRateButtonsVisible(false);
}

/**
 * 翻轉單字卡（切換 is-flipped），並同步評估按鈕顯示
 */
function flipFlashcard() {
  const flashcard = document.getElementById('flashcard');
  if (!flashcard) return;
  flashcard.classList.toggle('is-flipped');
  setRateButtonsVisible(flashcard.classList.contains('is-flipped'));
}

/**
 * 將目前卡片資料填入 DOM
 * @param {Object} term - 詞彙物件
 */
function renderFlashcard(term) {
  resetFlashcardFlip();

  const termEl = document.getElementById('fc-term');
  const translationEl = document.getElementById('fc-translation');
  const posEl = document.getElementById('fc-pos');
  const exampleEnEl = document.getElementById('fc-example-en');
  const exampleZhEl = document.getElementById('fc-example-zh');

  if (termEl) termEl.textContent = term.term || '';
  if (translationEl) translationEl.textContent = term.translation_zh || '';
  if (posEl) posEl.textContent = term.pos || '';
  if (exampleEnEl) exampleEnEl.textContent = term.example_en || '';
  if (exampleZhEl) exampleZhEl.textContent = term.example_zh || '';
}

/**
 * 顯示目前索引的卡片；若已全部複習完則顯示完成狀態
 */
function showCurrentCard() {
  if (currentCardIndex >= dueCards.length) {
    setLearnViewMode('done');
    return;
  }

  setLearnViewMode('card');
  renderFlashcard(dueCards[currentCardIndex]);
}

/**
 * 重新載入到期卡片並更新畫面
 * （切換到生字複習 Tab、或詞彙庫資料就緒時呼叫）
 */
function refreshLearnSession() {
  const progress = getLearningProgress();
  const progressKeys = Object.keys(progress);

  // 尚未加入任何生字
  if (progressKeys.length === 0) {
    dueCards = [];
    currentCardIndex = 0;
    setLearnViewMode('empty');
    return;
  }

  // 詞彙庫尚未載入完成時，暫不顯示（避免空卡）
  if (typeof allTerms === 'undefined' || !allTerms.length) {
    return;
  }

  dueCards = loadDueCards();
  currentCardIndex = 0;

  if (dueCards.length === 0) {
    setLearnViewMode('done');
  } else {
    showCurrentCard();
  }
}

/* ============================================================
   事件處理
   ============================================================ */

/**
 * 處理自我評估按鈕點擊
 * @param {'again'|'hard'|'easy'} rating
 */
function handleRating(rating) {
  if (isAnimating) return;

  const term = dueCards[currentCardIndex];
  if (!term) return;

  isAnimating = true;
  setRateButtonsDisabled(true);

  applyRating(term.id, rating);

  // 第一階段：立刻翻回正面，讓 CSS 動畫開始播放
  resetFlashcardFlip();

  // 第二階段：等翻轉動畫結束後，再換下一題內容，避免背面短暫洩露答案
  setTimeout(() => {
    currentCardIndex += 1;
    showCurrentCard();
    setRateButtonsDisabled(false);
    isAnimating = false;
  }, FLIP_TRANSITION_MS);
}

/**
 * 綁定單字卡相關按鈕事件（只執行一次）
 */
function bindFlashcardEvents() {
  const flipBtn = document.getElementById('btn-fc-flip');
  const speakBtn = document.getElementById('btn-fc-speak');
  const flashcard = document.getElementById('flashcard');

  flipBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    flipFlashcard();
  });

  speakBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    const term = dueCards[currentCardIndex];
    if (term && typeof speakTerm === 'function') {
      speakTerm(term.term);
    }
  });

  // 點擊卡片正面空白處也可翻面（背面有評估按鈕，不綁整卡點擊）
  flashcard?.addEventListener('click', (event) => {
    // 僅在未翻轉、且點擊目標不是按鈕時翻面
    if (flashcard.classList.contains('is-flipped')) return;
    if (event.target.closest('button')) return;
    flipFlashcard();
  });

  // 三個評估按鈕（卡片下方）
  const rateGroup = document.getElementById('fc-rate-btns');
  rateGroup?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-rating]');
    if (!btn) return;
    const rating = btn.dataset.rating;
    if (rating === 'again' || rating === 'hard' || rating === 'easy') {
      handleRating(rating);
    }
  });
}

/* ============================================================
   初始化
   ============================================================ */

/**
 * 初始化生字複習模組（由 app.js 在 DOMContentLoaded 時呼叫）
 */
function initVocabLearn() {
  bindFlashcardEvents();
  // 若詞彙庫已載入，立即整理一次；否則等切換 Tab 時再 refresh
  if (typeof allTerms !== 'undefined' && allTerms.length) {
    refreshLearnSession();
  }
}
