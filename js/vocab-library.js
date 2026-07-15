/**
 * vocab-library.js — 模組 5：社工專業詞彙庫
 *
 * 職責：
 * 1. 以 fetch 讀取 data/sw_terms.json
 * 2. 動態渲染詞彙卡片
 * 3. 即時搜尋過濾（英文單字 / 中文翻譯）
 * 4. 使用 Web Speech API（speechSynthesis）播放美式英語發音
 * 5. 「加入學習」：將單字寫入 localStorage（sw_progress）供間隔複習
 *
 * 注意：需透過本機伺服器開啟頁面（如 Live Server），
 *       直接用 file:// 開啟時 fetch 可能被瀏覽器阻擋。
 */

/* ============================================================
   常數與狀態變數
   ============================================================ */

/** localStorage 鍵名：生字學習進度 */
const STORAGE_KEY_PROGRESS = 'sw_progress';

/** localStorage 鍵名：文獻閱讀等來源的自訂生字（舊鍵，仍合併以相容） */
const STORAGE_KEY_CUSTOM_TERMS = 'sw_custom_terms';

/** localStorage 鍵名：AI 探索／動態擴充的詞彙 */
const STORAGE_KEY_AI_CUSTOM_TERMS = 'custom_sw_terms';

/** @type {Array<Object>} 完整詞彙資料（靜態 JSON + localStorage 動態資料） */
let allTerms = [];

/** AI 探索新詞進行中旗標 */
let isGeneratingVocab = false;

/* ============================================================
   學習進度（localStorage）
   ============================================================ */

/**
 * 讀取 sw_progress 物件；若不存在或損壞則回傳空物件
 * @returns {Object.<string, {status:string, interval:number, nextReview:number, correctStreak:number}>}
 */
function getLearningProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROGRESS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[vocab-library.js] 讀取 sw_progress 失敗：', error);
    return {};
  }
}

/**
 * 將進度物件寫回 localStorage
 * @param {Object} progress
 */
function saveLearningProgress(progress) {
  localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progress));
  if (typeof window.__swNotifyDataChanged === 'function') {
    window.__swNotifyDataChanged(STORAGE_KEY_PROGRESS);
  }
}

/**
 * 判斷某單字是否已加入學習清單
 * @param {string} termId
 * @returns {boolean}
 */
function isTermInLearning(termId) {
  const progress = getLearningProgress();
  return Object.prototype.hasOwnProperty.call(progress, termId);
}

/**
 * 將單字加入學習清單（寫入 sw_progress）
 * @param {string} termId - 詞彙 id（如 sw_001）
 * @returns {boolean} 是否成功新加入（已存在則回傳 false）
 */
function addTermToLearning(termId) {
  const progress = getLearningProgress();

  if (Object.prototype.hasOwnProperty.call(progress, termId)) {
    return false;
  }

  progress[termId] = {
    status: 'new',
    interval: 0,
    nextReview: 0,
    correctStreak: 0
  };

  saveLearningProgress(progress);
  return true;
}

/**
 * 讀取自訂生字陣列（文獻 L2 等來源）
 * @returns {Array<Object>}
 */
function getCustomTerms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_TERMS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * 將自訂生字寫回 localStorage
 * @param {Array<Object>} terms
 */
function saveCustomTerms(terms) {
  localStorage.setItem(STORAGE_KEY_CUSTOM_TERMS, JSON.stringify(terms));
  if (typeof window.__swNotifyDataChanged === 'function') {
    window.__swNotifyDataChanged(STORAGE_KEY_CUSTOM_TERMS);
  }
}

/**
 * 讀取 AI 動態擴充詞彙（custom_sw_terms）
 * @returns {Array<Object>}
 */
function getAiCustomTerms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AI_CUSTOM_TERMS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * 將 AI 動態詞彙寫回 localStorage
 * @param {Array<Object>} terms
 */
function saveAiCustomTerms(terms) {
  localStorage.setItem(STORAGE_KEY_AI_CUSTOM_TERMS, JSON.stringify(terms));
  if (typeof window.__swNotifyDataChanged === 'function') {
    window.__swNotifyDataChanged(STORAGE_KEY_AI_CUSTOM_TERMS);
  }
}

/**
 * 正規化詞彙欄位（相容文獻舊格式 translation / definition）
 * @param {Object} term
 * @returns {Object|null}
 */
function normalizeTermFields(term) {
  if (!term || typeof term !== 'object') return null;

  const normalized = { ...term };

  if (!normalized.translation_zh && normalized.translation) {
    normalized.translation_zh = normalized.translation;
  }
  if (!normalized.definition_en && normalized.definition) {
    normalized.definition_en = normalized.definition;
  }

  if (!normalized.id || !normalized.term) return null;

  // 確保搜尋／卡片所需欄位至少是字串
  normalized.translation_zh = normalized.translation_zh || '';
  normalized.definition_en = normalized.definition_en || '';
  normalized.pos = normalized.pos || '';
  normalized.example_en = normalized.example_en || '';
  normalized.example_zh = normalized.example_zh || '';
  normalized.common_mistake = normalized.common_mistake || '';

  return normalized;
}

/**
 * 把一筆詞彙合併進 allTerms（以 id 或英文單字去重）
 * @param {Object} term
 * @returns {boolean} 是否成功新加入
 */
function mergeTermIntoAll(term) {
  const normalized = normalizeTermFields(term);
  if (!normalized) return false;

  const exists = allTerms.some(
    (t) =>
      t.id === normalized.id ||
      (t.term &&
        normalized.term &&
        t.term.toLowerCase() === normalized.term.toLowerCase())
  );

  if (exists) return false;
  allTerms.push(normalized);
  return true;
}

/**
 * 合併 localStorage 動態詞庫進 allTerms
 * = 靜態 JSON + custom_sw_terms + sw_custom_terms（文獻相容）
 */
function mergeCustomTermsIntoAll() {
  getAiCustomTerms().forEach((term) => mergeTermIntoAll(term));
  getCustomTerms().forEach((term) => mergeTermIntoAll(term));
}

/**
 * 取得目前詞庫所有英文單字（供 AI 避重複）
 * @returns {string[]}
 */
function getExistingTermNames() {
  return allTerms
    .map((t) => (t && t.term ? String(t.term).trim() : ''))
    .filter(Boolean);
}

/**
 * 為 AI 新詞產生唯一 id
 * @param {string} termWord
 * @returns {string}
 */
function buildAiTermId(termWord) {
  const slug = String(termWord || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `ai_${slug || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 取得目前科目名稱
 * @returns {string}
 */
function getVocabSubjectName() {
  if (typeof window.getCurrentSubjectName === 'function') {
    const name = window.getCurrentSubjectName();
    if (name) return String(name);
  }
  if (typeof window.resolveCurrentSubject === 'function') {
    const subject = window.resolveCurrentSubject();
    if (subject && subject.name) return String(subject.name);
  }
  return '通用社工實務';
}

/**
 * 點擊「AI 探索新詞彙」：生成 3 詞 → 寫入 custom_sw_terms → 重渲染
 */
async function handleGenerateNewVocab() {
  const btn = document.getElementById('generate-vocab-btn');
  if (isGeneratingVocab) return;

  if (typeof generateNewVocabAPI !== 'function') {
    alert('動態生成功能尚未載入，請重新整理頁面。');
    return;
  }

  isGeneratingVocab = true;
  const originalLabel = btn ? btn.textContent : '✨ AI 探索新詞彙 (基於目前科目)';

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 探索中...';
  }

  try {
    const existingTerms = getExistingTermNames();
    const newTerms = await generateNewVocabAPI(
      getVocabSubjectName(),
      existingTerms
    );

    const stamped = newTerms.map((item) => ({
      id: buildAiTermId(item.term),
      term: item.term,
      pos: item.pos,
      translation_zh: item.translation_zh,
      definition_en: item.definition_en,
      example_en: item.example_en,
      example_zh: item.example_zh,
      common_mistake: item.common_mistake
    }));

    // 附加到 localStorage custom_sw_terms
    const stored = getAiCustomTerms();
    stamped.forEach((term) => {
      const dup = stored.some(
        (t) =>
          t &&
          t.term &&
          term.term &&
          t.term.toLowerCase() === term.term.toLowerCase()
      );
      if (!dup) stored.push(term);
      mergeTermIntoAll(term);
    });
    saveAiCustomTerms(stored);

    // 重新渲染（保留搜尋關鍵字）
    const searchInput = document.getElementById('vocab-search');
    const query = searchInput ? searchInput.value : '';
    filterVocabCards(query);

    if (typeof refreshLearnSession === 'function') {
      refreshLearnSession();
    }

    if (typeof showToast === 'function') {
      showToast('✅ 已成功加入 3 個新單字！');
    }
  } catch (error) {
    alert(error.message || '探索新詞彙失敗，請稍後再試。');
  } finally {
    isGeneratingVocab = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
}

/**
 * 將自訂生字（例如文獻簡化抽出的字）加入詞彙庫與學習清單
 * 供閱讀 L2「➕ 將生字加入學習」使用；會持久化到 localStorage
 *
 * @param {{word: string, zh: string, pos?: string}} vocabItem
 * @returns {{ok: boolean, already: boolean, termId: string, message: string}}
 */
function addCustomTermToLearning(vocabItem) {
  const word = vocabItem && typeof vocabItem.word === 'string'
    ? vocabItem.word.trim()
    : '';
  const zh = vocabItem && typeof vocabItem.zh === 'string'
    ? vocabItem.zh.trim()
    : '';
  const pos = vocabItem && typeof vocabItem.pos === 'string'
    ? vocabItem.pos.trim()
    : '';

  if (!word || !zh) {
    return { ok: false, already: false, termId: '', message: '生字資料不完整。' };
  }

  // 穩定 id：以小寫單字為準，避免重複加入
  const slug = word.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const termId = `lit_${slug || Date.now()}`;

  // 若已用相同英文單字存在於詞彙庫，優先用既有 id
  const matched = allTerms.find(
    (t) => t.id === termId || (t.term && t.term.toLowerCase() === word.toLowerCase())
  );

  let finalId;
  if (matched) {
    finalId = matched.id;
  } else {
    const newTerm = normalizeTermFields({
      id: termId,
      term: word,
      pos: pos || '',
      translation_zh: zh,
      definition_en: '來自文獻閱讀的生字',
      example_en: '',
      example_zh: '',
      common_mistake: ''
    });

    if (newTerm) {
      allTerms.push(newTerm);

      // 持久化，重新整理後生字複習仍找得到
      const custom = getCustomTerms();
      if (!custom.some((t) => t.id === termId)) {
        custom.push(newTerm);
        saveCustomTerms(custom);
      }
    }
    finalId = termId;
  }

  if (isTermInLearning(finalId)) {
    return {
      ok: false,
      already: true,
      termId: finalId,
      message: '已在學習清單中'
    };
  }

  addTermToLearning(finalId);
  return {
    ok: true,
    already: false,
    termId: finalId,
    message: '已加入學習'
  };
}

window.addCustomTermToLearning = addCustomTermToLearning;
window.addTermToLearning = addTermToLearning;
window.isTermInLearning = isTermInLearning;

/* ============================================================
   發音功能（Web Speech API）
   ============================================================ */

/**
 * 使用瀏覽器原生 speechSynthesis 朗讀英文單字
 * @param {string} text - 要朗讀的英文文字（通常是 term）
 */
function speakTerm(text) {
  if (typeof speakText === 'function') {
    speakText(text, 'en-US');
    return;
  }

  // 後備：utils.js 尚未載入時仍可發音
  if (!window.speechSynthesis) {
    alert('您的瀏覽器不支援語音朗讀功能，請改用 Chrome 或 Edge。');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

/* ============================================================
   卡片渲染
   ============================================================ */

/**
 * 將單筆詞彙資料轉成一張詞彙卡片的 HTML 字串
 * （使用 textContent 安全寫入，避免 XSS；此處資料來自本地 JSON，仍保持良好習慣）
 * @param {Object} term - 詞彙物件
 * @returns {HTMLElement} 組裝好的 article 元素
 */
function createVocabCard(term) {
  const card = document.createElement('article');
  card.className = 'vocab-card';
  // data-term / data-zh 供搜尋過濾使用
  card.dataset.term = (term.term || '').toLowerCase();
  card.dataset.zh = (term.translation_zh || '').toLowerCase();
  card.dataset.id = term.id;

  // --- 標題列：單字 + 詞性 + 發音按鈕 ---
  const header = document.createElement('div');
  header.className = 'vocab-card-header';

  const termEl = document.createElement('span');
  termEl.className = 'vocab-term';
  termEl.textContent = term.term;

  const posEl = document.createElement('span');
  posEl.className = 'vocab-pos';
  posEl.textContent = term.pos;

  const speakBtn = document.createElement('button');
  speakBtn.className = 'btn-speak';
  speakBtn.type = 'button';
  speakBtn.setAttribute('aria-label', `朗讀 ${term.term}`);
  speakBtn.textContent = '🔊 發音';
  // 點擊時朗讀該英文單字
  speakBtn.addEventListener('click', () => speakTerm(term.term));

  header.append(termEl, posEl, speakBtn);

  // --- 中文翻譯 ---
  const translation = document.createElement('p');
  translation.className = 'vocab-translation';
  translation.textContent = term.translation_zh;

  // --- 英文定義 ---
  const definition = document.createElement('p');
  definition.className = 'vocab-definition';
  definition.textContent = term.definition_en;

  // --- 例句區塊 ---
  const example = document.createElement('div');
  example.className = 'vocab-example';

  const exampleEn = document.createElement('p');
  exampleEn.className = 'vocab-example-en';
  exampleEn.textContent = term.example_en;

  const exampleZh = document.createElement('p');
  exampleZh.className = 'vocab-example-zh';
  exampleZh.textContent = term.example_zh;

  example.append(exampleEn, exampleZh);

  // --- 常見錯誤提醒 ---
  const mistake = document.createElement('div');
  mistake.className = 'vocab-mistake';

  const mistakeLabel = document.createElement('span');
  mistakeLabel.className = 'vocab-mistake-label';
  mistakeLabel.textContent = '常見錯誤：';

  const mistakeText = document.createElement('span');
  mistakeText.textContent = term.common_mistake;

  mistake.append(mistakeLabel, mistakeText);

  // --- 加入學習按鈕 ---
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-add-learn';
  addBtn.type = 'button';
  addBtn.dataset.termId = term.id;

  if (isTermInLearning(term.id)) {
    // 已在學習清單：顯示已加入並停用
    addBtn.textContent = '✅ 已加入';
    addBtn.disabled = true;
  } else {
    addBtn.textContent = '➕ 加入學習';
    addBtn.addEventListener('click', () => {
      addTermToLearning(term.id);
      addBtn.textContent = '✅ 已加入';
      addBtn.disabled = true;
    });
  }

  // 組裝整張卡片
  card.append(header, translation, definition, example, mistake, addBtn);
  return card;
}

/**
 * 將詞彙陣列渲染到 #vocab-card-list
 * @param {Array<Object>} terms - 要顯示的詞彙列表
 */
function renderVocabCards(terms) {
  const listEl = document.getElementById('vocab-card-list');
  const emptyEl = document.getElementById('vocab-empty');

  if (!listEl) return;

  // 清空現有內容
  listEl.innerHTML = '';

  if (!terms.length) {
    // 無結果：顯示空狀態提示
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  // 有結果：隱藏空狀態，逐一加入卡片
  if (emptyEl) emptyEl.classList.add('hidden');
  terms.forEach((term) => {
    listEl.appendChild(createVocabCard(term));
  });
}

/* ============================================================
   搜尋過濾
   ============================================================ */

/**
 * 依搜尋關鍵字過濾詞彙（比對英文單字或中文翻譯）
 * @param {string} query - 使用者輸入的搜尋字串
 */
function filterVocabCards(query) {
  const keyword = query.trim().toLowerCase();

  // 空白關鍵字 → 顯示全部
  if (!keyword) {
    renderVocabCards(allTerms);
    return;
  }

  const filtered = allTerms.filter((term) => {
    const en = (term.term || '').toLowerCase();
    const zh = (term.translation_zh || '').toLowerCase();
    return en.includes(keyword) || zh.includes(keyword);
  });

  renderVocabCards(filtered);
}

/**
 * 綁定搜尋框的 input 事件（即時過濾）
 */
function initVocabSearch() {
  const searchInput = document.getElementById('vocab-search');
  if (!searchInput) return;

  searchInput.addEventListener('input', (event) => {
    filterVocabCards(event.target.value);
  });
}

/* ============================================================
   資料載入與初始化
   ============================================================ */

/**
 * 從本地 JSON 載入詞彙資料並渲染
 * @returns {Promise<void>}
 */
async function loadVocabTerms() {
  const listEl = document.getElementById('vocab-card-list');

  try {
    // 讀取靜態詞彙庫（相對路徑，需透過 HTTP 伺服器開啟）
    const response = await fetch('./data/sw_terms.json');

    if (!response.ok) {
      throw new Error(`無法載入詞彙庫（HTTP ${response.status}）`);
    }

    allTerms = await response.json();
    // 合併文獻閱讀等來源的自訂生字（供間隔複習使用）
    mergeCustomTermsIntoAll();
    renderVocabCards(allTerms);

    // 詞彙載入完成後，若生字複習模組已就緒則同步刷新到期佇列
    if (typeof refreshLearnSession === 'function') {
      refreshLearnSession();
    }

  } catch (error) {
    console.error('[vocab-library.js] 載入失敗：', error);
    if (listEl) {
      listEl.innerHTML = '';
      const errMsg = document.createElement('p');
      errMsg.className = 'vocab-empty';
      errMsg.textContent =
        '詞彙庫載入失敗。請確認以本機伺服器開啟頁面（不可直接用 file:// 開啟）。';
      listEl.appendChild(errMsg);
    }
  }
}

/**
 * 初始化詞彙庫模組（由 app.js 在 DOMContentLoaded 時呼叫）
 */
function initVocabLibrary() {
  initVocabSearch();
  loadVocabTerms();

  const generateBtn = document.getElementById('generate-vocab-btn');
  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerateNewVocab);
  }

  const openLearnBtn = document.getElementById('btn-open-learn');
  if (openLearnBtn) {
    openLearnBtn.addEventListener('click', () => {
      if (typeof switchTab === 'function') switchTab('learn');
    });
  }

  const backToVocabBtn = document.getElementById('btn-back-to-vocab');
  if (backToVocabBtn) {
    backToVocabBtn.addEventListener('click', () => {
      if (typeof switchTab === 'function') switchTab('vocab');
    });
  }
}
