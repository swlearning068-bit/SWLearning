/**
 * quiz.js — 模組 7：測驗模式
 *
 * 職責：
 * 1. 從詞彙庫（allTerms / sw_terms.json）自動產生英翻中、中翻英選擇題
 * 2. 驅動測驗 UI（作答、計分、下一題、結算）
 * 3. 答錯時連動間隔複習：將該單字 interval 重置為 1 天
 * 4. 題目冷卻期：以 localStorage 排除最近測驗過的單字，避免連續抽到重複題
 *
 * 依賴：vocab-library.js（allTerms、getLearningProgress、saveLearningProgress）
 */

/* ============================================================
   常數
   ============================================================ */

/** 每次測驗題數 */
const QUIZ_QUESTION_COUNT = 10;

/** 每題選項數（含正確答案） */
const QUIZ_OPTION_COUNT = 4;

/** 一天的毫秒數（與 vocab-learn.js 一致；此處獨立定義避免依賴順序） */
const QUIZ_DAY_MS = 24 * 60 * 60 * 1000;

/** localStorage 鍵名：最近測驗過的單字 term（冷卻期黑名單） */
const STORAGE_KEY_QUIZ_HISTORY = 'sw_quiz_history';

/** 冷卻期歷史上限（固定上限；實際上限會再依詞庫大小 70% 取較小值） */
const QUIZ_HISTORY_HARD_CAP = 50;

/** 候選池不足時，釋放後仍保留的最近紀錄筆數 */
const QUIZ_HISTORY_RELEASE_KEEP = 5;

/* ============================================================
   狀態
   ============================================================ */

/** @type {Array<Object>} 本次測驗題庫 */
let quizQuestions = [];

/** 目前題目索引（0-based） */
let quizIndex = 0;

/** 目前得分 */
let quizScore = 0;

/** 本輪是否已作答（防止重複點選） */
let quizAnswered = false;

/** 本輪答錯題數（結算鼓勵語用） */
let quizWrongCount = 0;

/**
 * 最近測驗過的單字英文 term（冷卻期黑名單）
 * 從 localStorage 還原；損壞或缺漏時回傳空陣列
 * @type {string[]}
 */
let recentQuizHistory = (function loadQuizHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUIZ_HISTORY);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
})();

/* ============================================================
   工具函式
   ============================================================ */

/**
 * 陣列洗牌（Fisher–Yates），回傳新陣列，不修改原陣列
 * @param {Array} arr
 * @returns {Array}
 */
function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * 從陣列中隨機抽取最多 n 個不重複元素
 * @param {Array} arr
 * @param {number} n
 * @returns {Array}
 */
function pickRandom(arr, n) {
  return shuffleArray(arr).slice(0, Math.min(n, arr.length));
}

/**
 * 取得可用詞彙列表（優先使用 vocab-library 已載入的 allTerms）
 * @returns {Array<Object>}
 */
function getQuizTerms() {
  if (typeof allTerms !== 'undefined' && Array.isArray(allTerms) && allTerms.length > 0) {
    return allTerms;
  }
  return [];
}

/**
 * 將冷卻期歷史寫回 localStorage
 */
function saveQuizHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_QUIZ_HISTORY, JSON.stringify(recentQuizHistory));
  } catch (err) {
    console.warn('[quiz.js] 無法寫入測驗冷卻期紀錄', err);
  }
}

/**
 * 依詞庫大小計算冷卻期上限（FIFO 長度限制）
 * @param {number} poolSize
 * @returns {number}
 */
function getQuizHistoryMax(poolSize) {
  const byRatio = Math.floor(poolSize * 0.7);
  return Math.max(0, Math.min(QUIZ_HISTORY_HARD_CAP, byRatio));
}

/**
 * 將本次抽出的 term 推入冷卻期，並依上限裁切後持久化
 * @param {string[]} terms
 * @param {number} poolSize
 */
function appendQuizHistory(terms, poolSize) {
  const fresh = (terms || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (fresh.length === 0) return;

  recentQuizHistory = recentQuizHistory.concat(fresh);

  const maxHistory = getQuizHistoryMax(poolSize);
  if (maxHistory > 0 && recentQuizHistory.length > maxHistory) {
    recentQuizHistory = recentQuizHistory.slice(-maxHistory);
  } else if (maxHistory === 0) {
    recentQuizHistory = [];
  }

  saveQuizHistory();
}

/* ============================================================
   出題邏輯
   ============================================================ */

/**
 * 為單一詞彙建立一題選擇題
 *
 * @param {Object} term - 正確答案對應的詞彙物件
 * @param {Array<Object>} pool - 完整詞彙池（用來抽錯誤選項）
 * @param {'en_to_zh'|'zh_to_en'} type - 題型
 * @returns {Object|null} 題目物件；資料不足時回傳 null
 */
function buildQuestion(term, pool, type) {
  // 其他單字作為干擾項來源
  const others = pool.filter((t) => t.id !== term.id);
  if (others.length === 0) return null;

  const distractorCount = Math.min(QUIZ_OPTION_COUNT - 1, others.length);
  const distractors = pickRandom(others, distractorCount);

  let prompt;
  let correctAnswer;
  let wrongAnswers;
  let typeLabel;

  if (type === 'en_to_zh') {
    // 題型 1：英翻中 — 題目為英文，答案為中文
    prompt = term.term;
    correctAnswer = term.translation_zh;
    wrongAnswers = distractors.map((t) => t.translation_zh);
    typeLabel = '英翻中';
  } else {
    // 題型 2：中翻英 — 題目為中文，答案為英文
    prompt = term.translation_zh;
    correctAnswer = term.term;
    wrongAnswers = distractors.map((t) => t.term);
    typeLabel = '中翻英';
  }

  // 組合選項並洗牌
  const options = shuffleArray([correctAnswer, ...wrongAnswers]);
  const correctIndex = options.indexOf(correctAnswer);

  return {
    termId: term.id,
    type,
    typeLabel,
    prompt,
    options,
    correctIndex
  };
}

/**
 * 讀取詞彙資料，隨機產生混合題型的題庫陣列（預設 10 題）
 * 出題前會排除 recentQuizHistory 中的單字；候選不足時釋放最早冷卻紀錄。
 *
 * @param {number} [count=QUIZ_QUESTION_COUNT]
 * @returns {Array<Object>} 題目陣列；詞彙不足時可能少於 count
 */
function generateQuestions(count = QUIZ_QUESTION_COUNT) {
  const pool = getQuizTerms();

  // 至少需要 2 個單字才能組成選擇題（1 正確 + 1 干擾）
  if (pool.length < 2) {
    console.warn('[quiz.js] 詞彙不足，無法出題（至少需要 2 筆）');
    return [];
  }

  const historySet = new Set(recentQuizHistory);
  let candidatePool = pool.filter((t) => t && t.term && !historySet.has(t.term));

  // 防呆：過濾後不足本次題數 → 釋放最早紀錄，避免抽不到題或無限迴圈
  if (candidatePool.length < count) {
    recentQuizHistory = recentQuizHistory.slice(-QUIZ_HISTORY_RELEASE_KEEP);
    saveQuizHistory();

    const releasedSet = new Set(recentQuizHistory);
    candidatePool = pool.filter((t) => t && t.term && !releasedSet.has(t.term));

    // 詞庫本身偏小：仍不足則改用完整詞庫，確保一定能出題
    if (candidatePool.length < count) {
      candidatePool = pool.slice();
      recentQuizHistory = [];
      saveQuizHistory();
    }
  }

  // 本輪不重複抽題；干擾項仍從完整 pool 產生
  const selectedTerms = pickRandom(candidatePool, Math.min(count, candidatePool.length));
  const questions = [];
  const types = ['en_to_zh', 'zh_to_en'];

  for (let i = 0; i < selectedTerms.length; i++) {
    const term = selectedTerms[i];
    const type = types[Math.floor(Math.random() * types.length)];
    const q = buildQuestion(term, pool, type);
    if (q) questions.push(q);
  }

  // 成功出題後寫入冷卻期（FIFO 上限）
  if (questions.length > 0) {
    appendQuizHistory(
      selectedTerms.map((t) => t.term),
      pool.length
    );
  }

  return questions;
}

/* ============================================================
   錯題連動複習系統
   ============================================================ */

/**
 * 答錯時：將該單字的 interval 強制重置為 1 天，
 * 並把 nextReview 設為「明天」，確保會出現在明日單字卡任務中。
 * 若尚未加入學習清單，則一併寫入。
 *
 * @param {string} termId - 詞彙 id（如 sw_001）
 */
function resetWrongTermToReview(termId) {
  if (!termId) return;
  if (typeof getLearningProgress !== 'function' || typeof saveLearningProgress !== 'function') {
    console.warn('[quiz.js] 找不到進度讀寫函式，無法連動複習系統');
    return;
  }

  const progress = getLearningProgress();
  const existing = progress[termId];

  progress[termId] = {
    status: 'learning',
    interval: 1,                                    // 強制重置為 1 天
    nextReview: Date.now() + QUIZ_DAY_MS,           // 明天到期
    correctStreak: 0                                // 連對歸零
  };

  // 若原本已有資料，保留其他可能欄位（目前結構僅此四項）
  if (existing && typeof existing === 'object') {
    progress[termId] = {
      ...existing,
      status: 'learning',
      interval: 1,
      nextReview: Date.now() + QUIZ_DAY_MS,
      correctStreak: 0
    };
  }

  saveLearningProgress(progress);
}

/* ============================================================
   UI：畫面切換與渲染
   ============================================================ */

/**
 * 切換測驗區三種畫面：start / play / result
 * @param {'start'|'play'|'result'} mode
 */
function setQuizViewMode(mode) {
  const startEl = document.getElementById('quiz-start');
  const playEl = document.getElementById('quiz-play');
  const resultEl = document.getElementById('quiz-result');

  const toggle = (el, visible) => {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  };

  toggle(startEl, mode === 'start');
  toggle(playEl, mode === 'play');
  toggle(resultEl, mode === 'result');
}

/**
 * 更新頂部狀態列（題號、分數）
 */
function updateQuizStatusBar() {
  const progressEl = document.getElementById('quiz-progress');
  const scoreEl = document.getElementById('quiz-score');
  const total = quizQuestions.length;

  if (progressEl) {
    progressEl.textContent = `${quizIndex + 1} / ${total}`;
  }
  if (scoreEl) {
    scoreEl.textContent = `分數：${quizScore}`;
  }
}

/**
 * 渲染目前題目到畫面
 */
function renderCurrentQuestion() {
  const q = quizQuestions[quizIndex];
  if (!q) return;

  quizAnswered = false;
  updateQuizStatusBar();

  const typeLabelEl = document.getElementById('quiz-type-label');
  const questionEl = document.getElementById('quiz-question');
  const optionsEl = document.getElementById('quiz-options');
  const nextBtn = document.getElementById('btn-quiz-next');

  if (typeLabelEl) typeLabelEl.textContent = q.typeLabel;
  if (questionEl) questionEl.textContent = q.prompt;

  // 隱藏「下一題」，等作答後再顯示
  if (nextBtn) {
    nextBtn.classList.add('hidden');
    // 最後一題改顯示「看結果」
    nextBtn.textContent = quizIndex >= quizQuestions.length - 1 ? '看結果 →' : '下一題 →';
  }

  if (!optionsEl) return;

  // 解除鎖定樣式
  optionsEl.classList.remove('is-locked');

  const buttons = optionsEl.querySelectorAll('.quiz-option-btn');
  buttons.forEach((btn, i) => {
    const text = q.options[i];
    if (text == null) {
      // 詞彙不足時可能少於 4 個選項：隱藏多餘按鈕
      btn.classList.add('hidden');
      btn.textContent = '';
      btn.disabled = true;
      return;
    }

    btn.classList.remove('hidden', 'is-correct', 'is-wrong');
    btn.textContent = text;
    btn.disabled = false;
    btn.dataset.index = String(i);
  });
}

/**
 * 顯示結算畫面（總分 + 鼓勵語）
 * 分數達 80% 以上時觸發獎勵系統寶石（earnGem）
 */
function showQuizResult() {
  setQuizViewMode('result');

  const total = quizQuestions.length;
  const scoreEl = document.getElementById('quiz-result-score');
  const messageEl = document.getElementById('quiz-result-message');

  if (scoreEl) {
    scoreEl.textContent = `${quizScore} / ${total}`;
  }

  if (messageEl) {
    let message;
    if (quizScore >= 8) {
      message = '太棒了！專業度提升 🌟';
    } else if (quizScore < 5) {
      message = '再接再厲，錯題已加入複習清單 💪';
    } else {
      message = '不錯喔！繼續練習，錯題會出現在明天的複習任務中。';
    }

    // 若本輪沒有錯題且分數中等，微調文案
    if (quizWrongCount === 0 && quizScore >= 5 && quizScore < 8) {
      message = '全部答對！繼續保持這個節奏 👏';
    }

    messageEl.textContent = message;
  }

  // 遊戲化：測驗結束且分數 > 80% 時獲得寶石
  if (total > 0 && quizScore / total > 0.8 && typeof earnGem === 'function') {
    earnGem('quiz');
  }
}

/* ============================================================
   互動：作答與流程控制
   ============================================================ */

/**
 * 處理選項點擊
 * @param {number} selectedIndex - 被點選的選項索引
 */
function handleOptionSelect(selectedIndex) {
  if (quizAnswered) return;

  const q = quizQuestions[quizIndex];
  if (!q) return;

  quizAnswered = true;

  const optionsEl = document.getElementById('quiz-options');
  const buttons = optionsEl
    ? optionsEl.querySelectorAll('.quiz-option-btn')
    : [];

  // 鎖定所有選項
  if (optionsEl) optionsEl.classList.add('is-locked');
  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  const isCorrect = selectedIndex === q.correctIndex;

  if (isCorrect) {
    // 答對：該選項變綠，分數 +1
    quizScore += 1;
    const selectedBtn = buttons[selectedIndex];
    if (selectedBtn) selectedBtn.classList.add('is-correct');
  } else {
    // 答錯：選項變紅，正確答案標綠；連動複習系統
    quizWrongCount += 1;
    const selectedBtn = buttons[selectedIndex];
    const correctBtn = buttons[q.correctIndex];
    if (selectedBtn) selectedBtn.classList.add('is-wrong');
    if (correctBtn) correctBtn.classList.add('is-correct');
    resetWrongTermToReview(q.termId);
  }

  updateQuizStatusBar();

  // 顯示「下一題」／「看結果」
  const nextBtn = document.getElementById('btn-quiz-next');
  if (nextBtn) nextBtn.classList.remove('hidden');
}

/**
 * 進入下一題，或結束測驗進入結算
 */
function goToNextQuestion() {
  if (!quizAnswered) return;

  quizIndex += 1;

  if (quizIndex >= quizQuestions.length) {
    showQuizResult();
    return;
  }

  renderCurrentQuestion();
}

/**
 * 開始一輪新測驗
 */
function startQuiz() {
  const pool = getQuizTerms();

  if (pool.length < 2) {
    alert('詞彙資料尚未載入或數量不足，請稍候再試，或先到「專業詞彙庫」確認資料。');
    return;
  }

  quizQuestions = generateQuestions(QUIZ_QUESTION_COUNT);

  if (quizQuestions.length === 0) {
    alert('無法產生題目，請確認詞彙庫資料是否正常。');
    return;
  }

  quizIndex = 0;
  quizScore = 0;
  quizWrongCount = 0;
  quizAnswered = false;

  setQuizViewMode('play');
  renderCurrentQuestion();
}

/**
 * 重置回開始畫面（再測一次前也可直接 startQuiz）
 */
function resetQuizToStart() {
  quizQuestions = [];
  quizIndex = 0;
  quizScore = 0;
  quizWrongCount = 0;
  quizAnswered = false;
  setQuizViewMode('start');
}

/* ============================================================
   事件綁定與初始化
   ============================================================ */

/**
 * 綁定測驗相關按鈕事件（只執行一次）
 */
function bindQuizEvents() {
  const startBtn = document.getElementById('btn-quiz-start');
  const nextBtn = document.getElementById('btn-quiz-next');
  const retryBtn = document.getElementById('btn-quiz-retry');
  const optionsEl = document.getElementById('quiz-options');

  startBtn?.addEventListener('click', startQuiz);
  nextBtn?.addEventListener('click', goToNextQuestion);
  retryBtn?.addEventListener('click', startQuiz);

  // 選項：事件委派，方便手機觸控
  optionsEl?.addEventListener('click', (event) => {
    const btn = event.target.closest('.quiz-option-btn');
    if (!btn || btn.disabled || btn.classList.contains('hidden')) return;

    const index = Number(btn.dataset.index);
    if (Number.isNaN(index)) return;
    handleOptionSelect(index);
  });
}

/**
 * 初始化測驗模組（由 app.js 在 DOMContentLoaded 時呼叫）
 */
function initQuizModule() {
  bindQuizEvents();
  setQuizViewMode('start');
}
