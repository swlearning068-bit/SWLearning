/**
 * reading.js — 模組 4：漸進式閱讀理解（L1 / L2 / L3）
 *
 * 職責：
 * 1. L1：社工小故事 + 懸停關鍵字翻譯
 * 2. L2：OpenAlex 真實文獻搜尋／AI 模擬文獻 → DeepSeek 簡化 → 生字加入學習
 * 3. L3：依科目生成個案紀錄 + 是非題即時核對
 * 4. 管理難度切換、Loading 與錯誤提示
 */

/* ============================================================
   狀態
   ============================================================ */

/** 目前閱讀難度：'l1' | 'l2' | 'l3' */
let currentReadingLevel = 'l1';

/** L3 是非題正確答案（布林）；尚未生成時為 null */
let l3CorrectAnswer = null;

/** L3 是否已作答 */
let l3Answered = false;

/** L2 推薦標籤是否正在載入（避免重複請求） */
let suggestedTagsLoading = false;

/** 是否已為目前科目載入過推薦標籤 */
let suggestedTagsLoaded = false;

/** localStorage 鍵名：標籤快取池／黑名單／所屬科目（跨 Session 永久化） */
const STORAGE_KEY_TAGS_POOL = 'sw_tags_pool';
const STORAGE_KEY_TAGS_HISTORY = 'sw_tags_history';
const STORAGE_KEY_CURRENT_TAGS_SUBJECT = 'sw_current_tags_subject';

/**
 * 從 localStorage 安全讀取 JSON 陣列；損壞或缺漏時回傳空陣列
 * @param {string} key
 * @returns {Array}
 */
function loadJsonArrayFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/** 已生成過的英文關鍵字黑名單（換一組時排除，避免重複）；持久化於 localStorage */
let generatedTagsHistory = loadJsonArrayFromStorage(STORAGE_KEY_TAGS_HISTORY);

/**
 * 標籤快取池（Tag Pool）：
 * API 一次批次取回多個關鍵字存入此陣列；點擊「換一組」時優先從池中隨機抽出 4 個秒速切換，
 * 僅在池內不足 4 個時才再次呼叫 API 補充，以減少等待與 Token 消耗。
 * 持久化於 localStorage，重整頁面後仍可沿用，節省 API Token。
 */
let tagsPool = loadJsonArrayFromStorage(STORAGE_KEY_TAGS_POOL);

/** 目前快取池所屬的科目 ID（切換科目時必須清空池，避免跨科混用）；持久化於 localStorage */
let currentTagsSubject = localStorage.getItem(STORAGE_KEY_CURRENT_TAGS_SUBJECT) || '';

/**
 * 永久快取寫入 Helper：將標籤池狀態同步到 localStorage
 *
 * 運作機制：
 * - tagsPool / generatedTagsHistory 以 JSON.stringify 序列化後寫入，重整頁面仍可還原，避免重複消耗 API Token。
 * - currentTagsSubject 一併保存，確保下次開啟時能辨識快取屬於哪個科目，避免跨科混用。
 * - 凡是「清空／補充／抽出」等會改變池內容的操作，都必須立刻呼叫本函式。
 */
function saveTagsStateToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_TAGS_POOL, JSON.stringify(tagsPool));
    localStorage.setItem(STORAGE_KEY_TAGS_HISTORY, JSON.stringify(generatedTagsHistory));
    localStorage.setItem(STORAGE_KEY_CURRENT_TAGS_SUBJECT, currentTagsSubject || '');
  } catch (_) {
    // QuotaExceeded 等寫入失敗時略過，不中斷閱讀流程
  }
}

/* ============================================================
   工具函式
   ============================================================ */

/**
 * 跳脫 HTML 特殊字元，避免 XSS 與版面破壞
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 跳脫正則特殊字元
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 將故事中的關鍵字包成可懸停翻譯的 span
 *
 * @param {string} storyEn - 英文故事全文
 * @param {Array<{word: string, zh: string}>} keywords - 關鍵字陣列
 * @returns {string} 含 .hover-word 的 HTML 字串
 */
function wrapKeywordsWithHover(storyEn, keywords) {
  const sorted = [...keywords].sort((a, b) => b.word.length - a.word.length);

  let html = escapeHtml(storyEn);
  const placeholders = [];

  for (const { word, zh } of sorted) {
    const pattern = escapeRegExp(escapeHtml(word));
    const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');

    html = html.replace(regex, (match) => {
      const index = placeholders.length;
      const safeZh = escapeHtml(zh);
      placeholders.push(
        `<span class="hover-word" data-zh="${safeZh}" tabindex="0" role="button" aria-label="${match}：${safeZh}">${match}</span>`
      );
      return `\uE000${index}\uE001`;
    });
  }

  return html.replace(/\uE000(\d+)\uE001/g, (_, indexStr) => {
    return placeholders[Number(indexStr)] || '';
  });
}

/* ============================================================
   難度切換
   ============================================================ */

/**
 * 切換閱讀難度面板（L1 / L2 / L3）
 * @param {'l1'|'l2'|'l3'} level
 */
function switchReadingLevel(level) {
  if (!['l1', 'l2', 'l3'].includes(level)) return;
  currentReadingLevel = level;

  document.querySelectorAll('[data-reading-panel]').forEach((panel) => {
    const isTarget = panel.getAttribute('data-reading-panel') === level;
    panel.classList.toggle('hidden', !isTarget);
  });

  document.querySelectorAll('#reading-level-switch .level-btn').forEach((btn) => {
    const isActive = btn.dataset.level === level;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // 進入 L2 且尚未載入過標籤時，自動生成推薦關鍵字
  if (level === 'l2' && !suggestedTagsLoaded && !suggestedTagsLoading) {
    loadSuggestedTags();
  }
}

/* ============================================================
   L1：UI 狀態與渲染
   ============================================================ */

/** localStorage 鍵名：統一文章庫（文獻 + 小故事；與 article-library.js 共用） */
const STORAGE_KEY_SAVED_ARTICLES = 'sw_saved_articles';

/** 舊版鍵名（首次讀取時遷移後清除） */
const LEGACY_KEY_SAVED_LITERATURES = 'saved_literatures';
const LEGACY_KEY_SAVED_STORIES = 'sw_saved_stories';

/** @type {Object|null} 目前畫面上的 L1 故事（供收藏按鈕使用） */
let currentL1Story = null;

/** @type {'long'|'short'} L1 長文／短文模式（預設長文） */
let currentL1LengthMode = 'long';

const L1_LENGTH_UI = {
  long: {
    desc: '隨機生成香港社工 detailed case vignette（約 300–450 字）。滑鼠懸停（或點擊）藍色關鍵字可看中文意思。',
    generateLabel: '🎲 隨機生成詳細個案情境',
    loadingLabel: '正在創作詳細個案情境...',
    resultLabel: '英文個案情境',
    saveLabel: '💾 收藏此個案情境'
  },
  short: {
    desc: '隨機生成香港社工小故事（約 3–4 句）。滑鼠懸停（或點擊）藍色關鍵字可看中文意思。',
    generateLabel: '🎲 隨機生成社工小故事',
    loadingLabel: '正在創作社工小故事...',
    resultLabel: '英文故事',
    saveLabel: '💾 收藏此故事'
  }
};

/**
 * 取得目前 L1 長度模式
 * @returns {'long'|'short'}
 */
function getL1LengthMode() {
  return currentL1LengthMode === 'short' ? 'short' : 'long';
}

/**
 * 切換 L1 長文／短文，並同步按鈕與說明文案
 * @param {'long'|'short'} mode
 */
function setL1LengthMode(mode) {
  currentL1LengthMode = mode === 'short' ? 'short' : 'long';
  const ui = L1_LENGTH_UI[currentL1LengthMode];

  document.querySelectorAll('#l1-length-switch .l1-length-btn').forEach((btn) => {
    const isActive = btn.getAttribute('data-story-length') === currentL1LengthMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const descEl = document.getElementById('l1-story-desc');
  if (descEl) descEl.textContent = ui.desc;

  const generateBtn = document.getElementById('btn-generate-story');
  if (generateBtn && !generateBtn.disabled) {
    generateBtn.textContent = ui.generateLabel;
  }

  const loadingText = document.querySelector('#reading-loading .loading-text');
  if (loadingText) loadingText.textContent = ui.loadingLabel;

  const resultLabel = document.querySelector('#story-display .story-en-block .result-label');
  if (resultLabel) resultLabel.textContent = ui.resultLabel;

  const saveBtn = document.getElementById('btn-save-story');
  if (saveBtn && !saveBtn.classList.contains('is-saved')) {
    saveBtn.textContent = ui.saveLabel;
  }
}

/**
 * 從 localStorage 安全讀取 JSON 陣列
 * @param {string} key
 * @returns {Array}
 */
function loadArticlesJsonArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * 將舊版文獻庫／小故事庫一次性遷移至 sw_saved_articles
 * @returns {Array<Object>}
 */
function migrateLegacyArticlesIfNeeded() {
  let articles = loadArticlesJsonArray(STORAGE_KEY_SAVED_ARTICLES);
  const legacyLit = loadArticlesJsonArray(LEGACY_KEY_SAVED_LITERATURES);
  const legacyStories = loadArticlesJsonArray(LEGACY_KEY_SAVED_STORIES);

  if (legacyLit.length === 0 && legacyStories.length === 0) {
    return articles;
  }

  const byId = new Map();

  articles.forEach((item) => {
    if (item && item.id != null) byId.set(String(item.id), item);
  });

  legacyLit.forEach((item) => {
    if (!item || item.id == null) return;
    byId.set(String(item.id), { ...item, type: item.type || 'literature' });
  });

  legacyStories.forEach((item) => {
    if (!item || item.id == null) return;
    byId.set(String(item.id), { ...item, type: item.type || 'story' });
  });

  articles = Array.from(byId.values()).sort((a, b) => Number(b.id) - Number(a.id));
  localStorage.setItem(STORAGE_KEY_SAVED_ARTICLES, JSON.stringify(articles));
  localStorage.removeItem(LEGACY_KEY_SAVED_LITERATURES);
  localStorage.removeItem(LEGACY_KEY_SAVED_STORIES);
  return articles;
}

/**
 * 讀取統一文章庫
 * @returns {Array<Object>}
 */
function getSavedArticles() {
  return migrateLegacyArticlesIfNeeded();
}

/**
 * 將文章寫入統一文章庫
 * @param {Object} article - 必須含 type: 'literature' | 'story'
 * @returns {{ok: boolean, already?: boolean, message?: string}}
 */
function saveArticleToLibrary(article) {
  if (!article || !article.type) {
    return { ok: false, message: '文章資料不完整，無法收藏。' };
  }

  if (article.type === 'literature' && !article.original_title) {
    return { ok: false, message: '文獻資料不完整，無法收藏。' };
  }
  if (article.type === 'story' && !article.story_en) {
    return { ok: false, message: '故事資料不完整，無法收藏。' };
  }

  const list = getSavedArticles();

  let already = false;
  if (article.type === 'literature') {
    already = list.some(
      (item) =>
        item.type === 'literature' &&
        item.original_title === article.original_title &&
        item.subjectName === article.subjectName
    );
  } else if (article.type === 'story') {
    already = list.some(
      (item) =>
        item.type === 'story' &&
        item.story_en === article.story_en &&
        item.subjectName === article.subjectName
    );
  }

  if (already) {
    return { ok: true, already: true };
  }

  list.unshift(article);
  localStorage.setItem(STORAGE_KEY_SAVED_ARTICLES, JSON.stringify(list));
  return { ok: true, already: false };
}

/**
 * 由英文故事產生列表用標題（取前幾個字）
 * @param {string} storyEn
 * @returns {string}
 */
function buildStoryTitle(storyEn) {
  const text = String(storyEn || '').replace(/\s+/g, ' ').trim();
  if (!text) return '（無標題故事）';
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

/**
 * 同步「收藏此個案情境」按鈕狀態（已收藏則 disable）
 */
function syncSaveStoryButtonState() {
  const btn = document.getElementById('btn-save-story');
  if (!btn) return;
  const saveLabel = L1_LENGTH_UI[getL1LengthMode()].saveLabel;

  if (!currentL1Story || !currentL1Story.story_en) {
    btn.disabled = true;
    btn.textContent = saveLabel;
    btn.classList.remove('is-saved');
    return;
  }

  const subjectName =
    typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : '社會工作';

  const already = getSavedArticles().some(
    (item) =>
      item.type === 'story' &&
      item.story_en === currentL1Story.story_en &&
      item.subjectName === subjectName
  );

  if (already) {
    btn.textContent = '✅ 已收藏至文章庫';
    btn.disabled = true;
    btn.classList.add('is-saved');
  } else {
    btn.textContent = saveLabel;
    btn.disabled = false;
    btn.classList.remove('is-saved');
  }
}

/**
 * 處理「收藏此個案情境」按鈕
 */
function handleSaveStory() {
  if (!currentL1Story || !currentL1Story.story_en) {
    alert('目前沒有可收藏的個案情境，請先生成一篇。');
    return;
  }

  const subjectName =
    typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : '社會工作';

  const payload = {
    id: Date.now(),
    type: 'story',
    subjectName: subjectName || '社會工作',
    theme: currentL1Story.theme || '',
    title: buildStoryTitle(currentL1Story.story_en),
    story_en: currentL1Story.story_en,
    story_zh: currentL1Story.story_zh,
    keywords: Array.isArray(currentL1Story.keywords) ? currentL1Story.keywords : [],
    savedAt: new Date().toISOString()
  };

  const result = saveArticleToLibrary(payload);
  if (!result.ok) {
    alert(result.message || '收藏失敗，請稍後再試。');
    return;
  }

  const btn = document.getElementById('btn-save-story');
  if (btn) {
    btn.textContent = '✅ 已收藏至文章庫';
    btn.disabled = true;
    btn.classList.add('is-saved');
  }

  if (typeof showToast === 'function') {
    showToast(result.already ? '✅ 此個案情境已在文章庫中' : '✅ 已收藏至文章庫');
  }
}

/**
 * 重置 L1 閱讀區結果相關區塊
 */
function resetReadingArea() {
  const loading = document.getElementById('reading-loading');
  const display = document.getElementById('story-display');
  const errorEl = document.getElementById('reading-error');
  const zhBlock = document.getElementById('story-zh-block');
  const showBtn = document.getElementById('btn-show-translation');

  currentL1Story = null;

  if (loading) loading.classList.add('hidden');
  if (display) display.classList.add('hidden');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
  if (zhBlock) zhBlock.classList.add('hidden');
  if (showBtn) {
    showBtn.textContent = '👀 顯示完整翻譯';
    showBtn.setAttribute('aria-expanded', 'false');
  }

  syncSaveStoryButtonState();
}

/**
 * 顯示 L1 閱讀錯誤訊息
 * @param {string} message
 */
function showReadingError(message) {
  const errorEl = document.getElementById('reading-error');
  if (!errorEl) return;
  errorEl.textContent = `❌ ${message}`;
  errorEl.classList.remove('hidden');
}

/**
 * 將 L1 故事 JSON 渲染到展示區
 * @param {{story_en: string, story_zh: string, theme?: string, keywords: Array<{word: string, zh: string}>}} story
 */
function renderStory(story) {
  const display = document.getElementById('story-display');
  const enEl = document.getElementById('story-en');
  const zhEl = document.getElementById('story-zh');
  const zhBlock = document.getElementById('story-zh-block');

  if (!display || !enEl || !zhEl) return;

  currentL1Story = story;
  enEl.innerHTML = wrapKeywordsWithHover(story.story_en, story.keywords);
  zhEl.textContent = story.story_zh;
  if (zhBlock) zhBlock.classList.add('hidden');

  // 在英文故事標籤旁掛上朗讀控制（只建立一次）
  const enBlock = enEl.closest('.story-en-block');
  if (enBlock && typeof createArticleSpeakControls === 'function') {
    let labelRow = enBlock.querySelector('.tts-label-row');
    if (!labelRow) {
      const label = enBlock.querySelector('.result-label');
      labelRow = document.createElement('div');
      labelRow.className = 'tts-label-row';
      if (label) {
        labelRow.appendChild(label);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'result-label';
        fallback.textContent = L1_LENGTH_UI[getL1LengthMode()].resultLabel;
        labelRow.appendChild(fallback);
      }
      labelRow.appendChild(
        createArticleSpeakControls(() =>
          currentL1Story && currentL1Story.story_en
            ? currentL1Story.story_en
            : ''
        )
      );
      enBlock.insertBefore(labelRow, enEl);
    }
  }

  display.classList.remove('hidden');
  syncSaveStoryButtonState();
}

/**
 * 處理「隨機生成社工小故事／詳細個案情境」按鈕
 */
async function handleGenerateStory() {
  const generateBtn = document.getElementById('btn-generate-story');
  const loading = document.getElementById('reading-loading');
  const lengthMode = getL1LengthMode();
  const ui = L1_LENGTH_UI[lengthMode];

  resetReadingArea();

  if (loading) loading.classList.remove('hidden');

  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = '生成中...';
  }

  try {
    if (typeof generateL1Story !== 'function') {
      throw new Error('閱讀模組尚未載入完成，請強制重新整理頁面（Ctrl+F5）後再試。');
    }

    const story = await generateL1Story(lengthMode);

    if (loading) loading.classList.add('hidden');
    renderStory(story);

  } catch (error) {
    if (loading) loading.classList.add('hidden');
    showReadingError(error.message || '生成故事失敗，請稍後再試。');

  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = ui.generateLabel;
    }
  }
}

/**
 * 切換完整中文翻譯的顯示／隱藏
 */
function handleToggleTranslation() {
  const zhBlock = document.getElementById('story-zh-block');
  const showBtn = document.getElementById('btn-show-translation');
  if (!zhBlock || !showBtn) return;

  const willShow = zhBlock.classList.contains('hidden');

  if (willShow) {
    zhBlock.classList.remove('hidden');
    showBtn.textContent = '🙈 隱藏完整翻譯';
    showBtn.setAttribute('aria-expanded', 'true');
  } else {
    zhBlock.classList.add('hidden');
    showBtn.textContent = '👀 顯示完整翻譯';
    showBtn.setAttribute('aria-expanded', 'false');
  }
}

/**
 * 手機點擊關鍵字時切換 Tooltip
 * @param {MouseEvent|TouchEvent} event
 */
function handleHoverWordTap(event) {
  const wordEl = event.target.closest('.hover-word');
  const storyEn = document.getElementById('story-en');
  if (!storyEn) return;

  if (!wordEl) {
    storyEn.querySelectorAll('.hover-word.is-active').forEach((el) => {
      el.classList.remove('is-active');
    });
    return;
  }

  event.preventDefault();

  const wasActive = wordEl.classList.contains('is-active');

  storyEn.querySelectorAll('.hover-word.is-active').forEach((el) => {
    el.classList.remove('is-active');
  });

  if (!wasActive) {
    wordEl.classList.add('is-active');
  }
}

/* ============================================================
   L2：文獻搜尋與簡化
   ============================================================ */

/**
 * 從統一文章庫讀取已收藏文獻（相容舊呼叫）
 * @returns {Array<Object>}
 */
function getSavedLiteratures() {
  return getSavedArticles().filter((item) => item && item.type === 'literature');
}

/**
 * 將文獻寫入統一文章庫（強制 type: literature）
 * @param {Object} literature
 * @returns {{ok: boolean, already?: boolean, message?: string}}
 */
function saveLiteratureToLibrary(literature) {
  return saveArticleToLibrary({
    ...literature,
    type: 'literature'
  });
}

/**
 * 建立「收藏此文獻」按鈕，點擊後寫入統一文章庫
 * @param {Object} literatureData - 完整文獻 JSON（尚未含 id）
 * @param {string} subjectName - 所屬科目名稱
 * @returns {HTMLElement}
 */
function createSaveLiteratureButton(literatureData, subjectName) {
  const wrap = document.createElement('div');
  wrap.className = 'save-literature-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'save-literature-btn';
  btn.textContent = '💾 收藏至文章庫';

  const existing = getSavedArticles().some(
    (item) =>
      item.type === 'literature' &&
      item.original_title === literatureData.original_title &&
      item.subjectName === subjectName
  );
  if (existing) {
    btn.textContent = '✅ 已收藏至文章庫';
    btn.disabled = true;
    btn.classList.add('is-saved');
  }

  btn.addEventListener('click', () => {
    const payload = {
      id: Date.now(),
      type: 'literature',
      subjectName: subjectName || '社會工作',
      original_title: literatureData.original_title,
      simplified_article: literatureData.simplified_article,
      article_zh: literatureData.article_zh,
      case_scenario_en: literatureData.case_scenario_en,
      case_scenario_zh: literatureData.case_scenario_zh,
      practical_application_en: literatureData.practical_application_en,
      practical_application_zh: literatureData.practical_application_zh,
      key_vocabulary: literatureData.key_vocabulary || literatureData.vocab || [],
      notice: literatureData.notice || '',
      savedAt: new Date().toISOString()
    };

    const result = saveLiteratureToLibrary(payload);
    if (!result.ok) {
      alert(result.message || '收藏失敗，請稍後再試。');
      return;
    }

    btn.textContent = '✅ 已收藏至文章庫';
    btn.disabled = true;
    btn.classList.add('is-saved');

    if (typeof showToast === 'function') {
      showToast(result.already ? '✅ 此文獻已在文章庫中' : '✅ 已收藏至文章庫');
    }
  });

  wrap.appendChild(btn);
  return wrap;
}

/**
 * 重置 L2 結果區
 */
function resetL2ReadingArea() {
  const loading = document.getElementById('l2-reading-loading');
  const results = document.getElementById('l2-reading-results');
  const errorEl = document.getElementById('l2-reading-error');

  if (loading) loading.classList.add('hidden');
  if (results) {
    results.classList.add('hidden');
    results.innerHTML = '';
  }
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
}

/**
 * 顯示 L2 錯誤
 * @param {string} message
 */
function showL2ReadingError(message) {
  const errorEl = document.getElementById('l2-reading-error');
  if (!errorEl) return;
  errorEl.textContent = `❌ ${message}`;
  errorEl.classList.remove('hidden');
}

/**
 * 渲染單篇簡化後的文獻卡片（OpenAlex 真實文獻用）
 * @param {{title: string, simplified_en: string, translation_zh: string, vocab: Array<{word: string, zh: string, pos: string}>, source?: string, notice?: string}} item
 * @returns {HTMLElement}
 */
function createLiteratureCard(item) {
  const card = document.createElement('article');
  card.className = 'literature-card';

  if (item.notice) {
    const noticeEl = document.createElement('p');
    noticeEl.className = 'literature-notice';
    noticeEl.textContent = item.notice;
    card.appendChild(noticeEl);
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row';

  const titleEl = document.createElement('h3');
  titleEl.className = 'literature-title';
  titleEl.textContent = item.title;
  titleRow.appendChild(titleEl);

  if (typeof createArticleSpeakControls === 'function') {
    titleRow.appendChild(
      createArticleSpeakControls(() => item.simplified_en || '')
    );
  }
  card.appendChild(titleRow);

  const enBlock = document.createElement('div');
  enBlock.className = 'literature-block';
  enBlock.innerHTML = `<span class="result-label">簡化英文</span>`;
  const enP = document.createElement('p');
  enP.className = 'literature-en';
  enP.textContent = item.simplified_en;
  enBlock.appendChild(enP);
  card.appendChild(enBlock);

  const zhBlock = document.createElement('div');
  zhBlock.className = 'literature-block';
  zhBlock.innerHTML = `<span class="result-label">中文翻譯</span>`;
  const zhP = document.createElement('p');
  zhP.className = 'literature-zh';
  zhP.textContent = item.translation_zh;
  zhBlock.appendChild(zhP);
  card.appendChild(zhBlock);

  card.appendChild(createLiteratureVocabSection(item.vocab || []));

  return card;
}

/**
 * 建立生字清單區塊（含發音與「加入學習」按鈕）
 * @param {Array<{word?: string, term?: string, zh: string, pos?: string}>} vocab
 * @returns {HTMLElement}
 */
function createLiteratureVocabSection(vocab) {
  const vocabWrap = document.createElement('div');
  vocabWrap.className = 'literature-vocab';
  vocabWrap.innerHTML = `<span class="result-label">重要生字</span>`;

  const vocabList = document.createElement('ul');
  vocabList.className = 'literature-vocab-list';

  (vocab || []).forEach((v) => {
    const word = (v.word || v.term || '').trim();
    if (!word) return;

    const li = document.createElement('li');
    li.className = 'literature-vocab-item';

    const wordRow = document.createElement('div');
    wordRow.className = 'literature-vocab-word-row';

    const wordSpan = document.createElement('span');
    wordSpan.className = 'literature-vocab-word';
    wordSpan.textContent = word;
    wordRow.appendChild(wordSpan);

    if (typeof createVocabSpeakButton === 'function') {
      wordRow.appendChild(createVocabSpeakButton(word));
    }
    li.appendChild(wordRow);

    const zhSpan = document.createElement('span');
    zhSpan.className = 'literature-vocab-zh';
    zhSpan.textContent = v.pos ? `${v.zh}（${v.pos}）` : v.zh;
    li.appendChild(zhSpan);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-secondary btn-add-vocab';
    addBtn.textContent = '➕ 將生字加入學習';

    addBtn.addEventListener('click', () => {
      if (typeof addCustomTermToLearning !== 'function') {
        alert('生字學習模組尚未載入，請重新整理頁面。');
        return;
      }
      const result = addCustomTermToLearning({
        word,
        zh: v.zh,
        pos: v.pos || ''
      });
      if (result.already) {
        addBtn.textContent = '✓ 已在學習清單';
        addBtn.disabled = true;
        addBtn.classList.add('is-added');
      } else if (result.ok) {
        addBtn.textContent = '✓ 已加入學習';
        addBtn.disabled = true;
        addBtn.classList.add('is-added');
      } else {
        alert(result.message || '加入失敗，請稍後再試。');
      }
    });

    li.appendChild(addBtn);
    vocabList.appendChild(li);
  });

  vocabWrap.appendChild(vocabList);
  return vocabWrap;
}

/**
 * 建立可切換中文翻譯的內容區塊（預設只顯示英文）
 * @param {{heading: string, enText: string, zhText: string, variant?: string}} opts
 * @returns {HTMLElement}
 */
function createToggleableSection(opts) {
  const { heading, enText, zhText, variant = '' } = opts;

  const section = document.createElement('section');
  section.className = `sim-lit-section${variant ? ` sim-lit-section--${variant}` : ''}`;

  const headingEl = document.createElement('h4');
  headingEl.className = 'sim-lit-section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

  const enP = document.createElement('p');
  enP.className = 'sim-lit-en';
  enP.textContent = enText;
  section.appendChild(enP);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'toggle-translation-btn';
  toggleBtn.textContent = '👀 顯示中文翻譯';
  toggleBtn.setAttribute('aria-expanded', 'false');
  section.appendChild(toggleBtn);

  const zhWrap = document.createElement('div');
  zhWrap.className = 'sim-lit-zh-wrap';
  zhWrap.setAttribute('aria-hidden', 'true');

  const zhP = document.createElement('p');
  zhP.className = 'sim-lit-zh';
  zhP.textContent = zhText;
  zhWrap.appendChild(zhP);
  section.appendChild(zhWrap);

  toggleBtn.addEventListener('click', () => {
    const willShow = !zhWrap.classList.contains('is-open');
    zhWrap.classList.toggle('is-open', willShow);
    zhWrap.setAttribute('aria-hidden', willShow ? 'false' : 'true');
    toggleBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
    toggleBtn.textContent = willShow ? '🙈 隱藏中文翻譯' : '👀 顯示中文翻譯';
  });

  return section;
}

/**
 * 渲染 AI 模擬文獻：學術摘要／情境案例／實踐應用三區塊 + 生字 + 收藏按鈕
 * @param {{
 *   original_title: string,
 *   simplified_article: string,
 *   article_zh: string,
 *   case_scenario_en: string,
 *   case_scenario_zh: string,
 *   practical_application_en: string,
 *   practical_application_zh: string,
 *   vocab?: Array<{word: string, zh: string, pos: string}>,
 *   key_vocabulary?: Array<{term: string, zh: string, pos: string}>,
 *   notice?: string,
 *   subjectName?: string
 * }} data
 * @returns {HTMLElement}
 */
function createSimulatedLiteratureCard(data) {
  const pack = document.createElement('article');
  pack.className = 'sim-lit-pack';

  if (data.notice) {
    const noticeEl = document.createElement('p');
    noticeEl.className = 'literature-notice';
    noticeEl.textContent = data.notice;
    pack.appendChild(noticeEl);
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row';

  const titleEl = document.createElement('h3');
  titleEl.className = 'literature-title';
  titleEl.textContent = data.original_title;
  titleRow.appendChild(titleEl);

  if (typeof createArticleSpeakControls === 'function') {
    titleRow.appendChild(
      createArticleSpeakControls(() =>
        [
          data.simplified_article,
          data.case_scenario_en,
          data.practical_application_en
        ]
          .map((t) => String(t || '').trim())
          .filter(Boolean)
          .join('\n\n')
      )
    );
  }
  pack.appendChild(titleRow);

  // 標題下方：收藏至文章庫（零 API 重複學習用）
  const subjectName =
    data.subjectName ||
    (typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : '社會工作');

  // 統一生字格式：支援 vocab（word）與 key_vocabulary（term）兩種欄位
  const vocab =
    data.vocab ||
    (data.key_vocabulary || []).map((v) => ({
      word: v.term || v.word,
      zh: v.zh,
      pos: v.pos || ''
    }));

  const keyVocabulary =
    data.key_vocabulary ||
    vocab.map((v) => ({
      term: v.word || v.term,
      zh: v.zh,
      pos: v.pos || ''
    }));

  pack.appendChild(
    createSaveLiteratureButton(
      {
        original_title: data.original_title,
        simplified_article: data.simplified_article,
        article_zh: data.article_zh,
        case_scenario_en: data.case_scenario_en,
        case_scenario_zh: data.case_scenario_zh,
        practical_application_en: data.practical_application_en,
        practical_application_zh: data.practical_application_zh,
        key_vocabulary: keyVocabulary,
        vocab,
        notice: data.notice || ''
      },
      subjectName
    )
  );

  pack.appendChild(
    createToggleableSection({
      heading: '📄 學術摘要 (Theory & Abstract)',
      enText: data.simplified_article,
      zhText: data.article_zh,
      variant: 'theory'
    })
  );

  pack.appendChild(
    createToggleableSection({
      heading: '👤 情境案例 (Case Scenario)',
      enText: data.case_scenario_en,
      zhText: data.case_scenario_zh,
      variant: 'case'
    })
  );

  pack.appendChild(
    createToggleableSection({
      heading: '🛠️ 實踐應用 (Practical Application)',
      enText: data.practical_application_en,
      zhText: data.practical_application_zh,
      variant: 'practice'
    })
  );

  pack.appendChild(createLiteratureVocabSection(vocab));

  return pack;
}

/**
 * 渲染 OpenAlex 搜尋結果列表，供使用者選擇要簡化的論文
 * @param {Array<{id: string, title: string, abstract: string, year: number|null}>} papers
 */
function renderOpenAlexPaperList(papers) {
  const results = document.getElementById('l2-reading-results');
  if (!results) return;

  results.innerHTML = '';

  const heading = document.createElement('p');
  heading.className = 'literature-list-heading';
  heading.textContent = `找到 ${papers.length} 篇含摘要的論文，請選擇一篇進行簡化：`;
  results.appendChild(heading);

  papers.forEach((paper, index) => {
    const card = document.createElement('article');
    card.className = 'literature-pick-card';

    const titleEl = document.createElement('h3');
    titleEl.className = 'literature-title';
    titleEl.textContent = paper.year
      ? `${paper.title}（${paper.year}）`
      : paper.title;
    card.appendChild(titleEl);

    const preview = document.createElement('p');
    preview.className = 'literature-abstract-preview';
    const abs = paper.abstract || '';
    preview.textContent = abs.length > 220 ? `${abs.slice(0, 220)}…` : abs;
    card.appendChild(preview);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = '✨ 簡化此篇文獻';
    btn.addEventListener('click', () => {
      handleSimplifySelectedPaper(paper);
    });
    card.appendChild(btn);

    // 第一篇標示建議
    if (index === 0) {
      const tip = document.createElement('p');
      tip.className = 'literature-pick-tip';
      tip.textContent = '來源：OpenAlex 真實文獻';
      card.insertBefore(tip, titleEl);
    }

    results.appendChild(card);
  });

  results.classList.remove('hidden');
}

/**
 * 將選中的真實論文交給 DeepSeek 簡化並渲染結果卡
 * @param {{title: string, abstract: string}} paper
 */
async function handleSimplifySelectedPaper(paper) {
  const searchBtn = document.getElementById('btn-l2-search');
  const simulateBtn = document.getElementById('btn-generate-simulated');
  const loading = document.getElementById('l2-reading-loading');
  const results = document.getElementById('l2-reading-results');
  const loadingText = loading ? loading.querySelector('.loading-text') : null;
  const errorEl = document.getElementById('l2-reading-error');

  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }

  if (results) results.classList.add('hidden');
  if (loading) loading.classList.remove('hidden');
  if (loadingText) loadingText.textContent = '正在以 AI 簡化文獻摘要...';

  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.textContent = '簡化中...';
  }
  if (simulateBtn) simulateBtn.disabled = true;

  // 簡化過程中暫時鎖住結果區按鈕（已隱藏）
  try {
    if (typeof simplifyAbstractAPI !== 'function') {
      throw new Error('AI 模組尚未載入，請強制重新整理頁面（Ctrl+F5）後再試。');
    }

    const simplified = await simplifyAbstractAPI(paper.title, paper.abstract);

    if (loading) loading.classList.add('hidden');

    if (results) {
      results.innerHTML = '';
      results.appendChild(
        createLiteratureCard({
          title: paper.title,
          simplified_en: simplified.simplified_en,
          translation_zh: simplified.translation_zh,
          vocab: simplified.vocab,
          source: 'openalex',
          notice: '📚 來源：OpenAlex 真實學術文獻（經 AI 改寫為學習用短文）'
        })
      );
      results.classList.remove('hidden');
    }
  } catch (error) {
    if (loading) loading.classList.add('hidden');
    showL2ReadingError(error.message || '文獻簡化失敗，請稍後再試。');
  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = '🔍 搜尋真實文獻';
    }
    if (simulateBtn) simulateBtn.disabled = false;
  }
}

/**
 * L2：以 OpenAlex 搜尋真實文獻，再交由使用者選擇並簡化
 */
async function handleL2SearchLiterature() {
  const input = document.getElementById('l2-keyword-input');
  const searchBtn = document.getElementById('btn-l2-search');
  const simulateBtn = document.getElementById('btn-generate-simulated');
  const loading = document.getElementById('l2-reading-loading');
  const results = document.getElementById('l2-reading-results');
  const loadingText = loading ? loading.querySelector('.loading-text') : null;

  const keyword = input ? input.value.trim() : '';
  if (!keyword) {
    showL2ReadingError('請先輸入關鍵字（建議英文，例如 attachment theory）。');
    return;
  }

  resetL2ReadingArea();

  if (loading) loading.classList.remove('hidden');
  if (loadingText) loadingText.textContent = '正在從 OpenAlex 搜尋真實文獻...';

  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.textContent = '搜尋中...';
  }
  if (simulateBtn) simulateBtn.disabled = true;

  try {
    if (typeof searchOpenAlex !== 'function') {
      throw new Error('文獻模組尚未載入，請強制重新整理頁面（Ctrl+F5）後再試。');
    }

    const papers = await searchOpenAlex(keyword, 5);

    if (loading) loading.classList.add('hidden');
    renderOpenAlexPaperList(papers);

  } catch (error) {
    if (loading) loading.classList.add('hidden');
    showL2ReadingError(error.message || '文獻搜尋失敗，請稍後再試。');

  } finally {
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = '🔍 搜尋真實文獻';
    }
    if (simulateBtn) simulateBtn.disabled = false;
  }
}

/**
 * L2：由 AI 依關鍵字與目前科目生成模擬文獻，並直接渲染簡化結果
 */
async function handleGenerateSimulatedLiterature() {
  const input = document.getElementById('l2-keyword-input');
  const searchBtn = document.getElementById('btn-l2-search');
  const simulateBtn = document.getElementById('btn-generate-simulated');
  const loading = document.getElementById('l2-reading-loading');
  const results = document.getElementById('l2-reading-results');
  const loadingText = loading ? loading.querySelector('.loading-text') : null;

  const keyword = input ? input.value.trim() : '';
  if (!keyword) {
    showL2ReadingError('請先輸入關鍵字（例如 attachment theory 或 依附理論）。');
    return;
  }

  const subjectName =
    typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : (typeof resolveCurrentSubject === 'function'
          ? resolveCurrentSubject().name
          : '社會工作');

  resetL2ReadingArea();

  if (loading) loading.classList.remove('hidden');
  if (loadingText) loadingText.textContent = '正在生成理論摘要、情境案例與實踐應用...';

  if (simulateBtn) {
    simulateBtn.disabled = true;
    simulateBtn.textContent = '生成中...';
  }
  if (searchBtn) searchBtn.disabled = true;

  try {
    if (typeof generateSimulatedLiteratureAPI !== 'function') {
      throw new Error('AI 模組尚未載入，請強制重新整理頁面（Ctrl+F5）後再試。');
    }

    const data = await generateSimulatedLiteratureAPI(keyword, subjectName);

    if (loading) loading.classList.add('hidden');

    if (results) {
      results.innerHTML = '';
      results.appendChild(
        createSimulatedLiteratureCard({
          original_title: data.original_title,
          simplified_article: data.simplified_article || data.simplified_en,
          article_zh: data.article_zh || data.translation_zh || data.chinese_translation,
          case_scenario_en: data.case_scenario_en,
          case_scenario_zh: data.case_scenario_zh,
          practical_application_en: data.practical_application_en,
          practical_application_zh: data.practical_application_zh,
          vocab: data.vocab,
          key_vocabulary: data.key_vocabulary,
          subjectName,
          notice: '✨ 來源：AI 模擬教材（理論＋虛構情境＋實踐手法，非真實論文）'
        })
      );
      results.classList.remove('hidden');
    }
  } catch (error) {
    if (loading) loading.classList.add('hidden');
    showL2ReadingError(error.message || '模擬文獻生成失敗，請稍後再試。');
  } finally {
    if (simulateBtn) {
      simulateBtn.disabled = false;
      simulateBtn.textContent = '✨ AI 生成模擬文獻';
    }
    if (searchBtn) searchBtn.disabled = false;
  }
}

/* ============================================================
   L3：個案紀錄與是非題
   ============================================================ */

/**
 * 重置 L3 結果區
 */
function resetL3ReadingArea() {
  const loading = document.getElementById('l3-reading-loading');
  const display = document.getElementById('l3-reading-display');
  const errorEl = document.getElementById('l3-reading-error');
  const feedback = document.getElementById('l3-tf-feedback');
  const trueBtn = document.getElementById('btn-l3-true');
  const falseBtn = document.getElementById('btn-l3-false');

  l3CorrectAnswer = null;
  l3Answered = false;

  if (loading) loading.classList.add('hidden');
  if (display) display.classList.add('hidden');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
  if (feedback) {
    feedback.className = 'l3-tf-feedback hidden';
    feedback.textContent = '';
  }
  if (trueBtn) {
    trueBtn.disabled = false;
    trueBtn.classList.remove('is-correct', 'is-wrong');
  }
  if (falseBtn) {
    falseBtn.disabled = false;
    falseBtn.classList.remove('is-correct', 'is-wrong');
  }
}

/**
 * 顯示 L3 錯誤
 * @param {string} message
 */
function showL3ReadingError(message) {
  const errorEl = document.getElementById('l3-reading-error');
  if (!errorEl) return;
  errorEl.textContent = `❌ ${message}`;
  errorEl.classList.remove('hidden');
}

/**
 * 渲染 L3 個案紀錄與是非題
 * @param {{case_note_en: string, case_note_zh: string, question_en: string, question_zh: string, answer: boolean}} data
 */
function renderL3CaseNote(data) {
  const display = document.getElementById('l3-reading-display');
  const enEl = document.getElementById('l3-case-en');
  const zhEl = document.getElementById('l3-case-zh');
  const qEn = document.getElementById('l3-question-en');
  const qZh = document.getElementById('l3-question-zh');

  if (!display) return;

  if (enEl) enEl.textContent = data.case_note_en;
  if (zhEl) zhEl.textContent = data.case_note_zh;
  if (qEn) qEn.textContent = data.question_en;
  if (qZh) qZh.textContent = data.question_zh;

  l3CorrectAnswer = data.answer;
  l3Answered = false;

  display.classList.remove('hidden');
}

/**
 * 生成 L3 個案紀錄
 */
async function handleGenerateCaseNote() {
  const genBtn = document.getElementById('btn-l3-generate');
  const loading = document.getElementById('l3-reading-loading');

  resetL3ReadingArea();

  if (loading) loading.classList.remove('hidden');

  if (genBtn) {
    genBtn.disabled = true;
    genBtn.textContent = '生成中...';
  }

  try {
    if (typeof generateCaseNoteReading !== 'function') {
      throw new Error('AI 模組尚未載入，請強制重新整理頁面（Ctrl+F5）後再試。');
    }

    const data = await generateCaseNoteReading();

    if (loading) loading.classList.add('hidden');
    renderL3CaseNote(data);

  } catch (error) {
    if (loading) loading.classList.add('hidden');
    showL3ReadingError(error.message || '生成個案紀錄失敗，請稍後再試。');

  } finally {
    if (genBtn) {
      genBtn.disabled = false;
      genBtn.textContent = '📝 生成個案紀錄任務';
    }
  }
}

/**
 * 處理 L3 是非題作答
 * @param {boolean} userAnswer
 */
function handleL3TrueFalse(userAnswer) {
  if (l3Answered || l3CorrectAnswer === null) return;

  l3Answered = true;
  const isCorrect = userAnswer === l3CorrectAnswer;

  const trueBtn = document.getElementById('btn-l3-true');
  const falseBtn = document.getElementById('btn-l3-false');
  const feedback = document.getElementById('l3-tf-feedback');

  if (trueBtn) trueBtn.disabled = true;
  if (falseBtn) falseBtn.disabled = true;

  const chosenBtn = userAnswer ? trueBtn : falseBtn;
  const correctBtn = l3CorrectAnswer ? trueBtn : falseBtn;

  if (correctBtn) correctBtn.classList.add('is-correct');
  if (!isCorrect && chosenBtn) chosenBtn.classList.add('is-wrong');

  if (feedback) {
    feedback.classList.remove('hidden');
    if (isCorrect) {
      feedback.className = 'l3-tf-feedback l3-tf-feedback--correct';
      feedback.textContent = '✅ 正確！你理解了這段個案紀錄。';
    } else {
      feedback.className = 'l3-tf-feedback l3-tf-feedback--wrong';
      feedback.textContent = `❌ 不正確。正確答案是 ${l3CorrectAnswer ? 'True' : 'False'}。`;
    }
  }
}

/* ============================================================
   L2：推薦搜尋標籤（Search Chips）
   ============================================================ */

/**
 * 標記推薦標籤需重新生成（例如科目已切換但尚未進入閱讀模組）
 */
function invalidateSuggestedTags() {
  suggestedTagsLoaded = false;
  generatedTagsHistory = [];
  tagsPool = [];
  currentTagsSubject = '';
  // 科目切換／失效時一併清空永久快取，避免舊科目標籤殘留
  saveTagsStateToStorage();
}

/**
 * 取得目前科目 ID（供標籤快取池綁定科目用）
 * @returns {string}
 */
function getSuggestedTagsSubjectId() {
  if (typeof getCurrentSubject === 'function') {
    const subject = getCurrentSubject();
    if (subject && subject.id) return String(subject.id);
  }
  if (window.currentSubject && window.currentSubject.id) {
    return String(window.currentSubject.id);
  }
  return '';
}

/**
 * Fisher-Yates 洗牌：原地打亂陣列順序
 * @param {Array} arr
 * @returns {Array} 同一個陣列參考（已洗牌）
 */
function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 從標籤快取池隨機抽出 count 個標籤，並自池中移除（抽出即消費）
 * @param {number} count
 * @returns {Array<{en: string, zh: string}>}
 */
function drawTagsFromPool(count) {
  const n = Math.min(Math.max(0, count), tagsPool.length);
  if (n === 0) return [];
  // 先對整個池做 Fisher-Yates 洗牌，再取出前 n 個，確保每次「換一組」順序都隨機
  shuffleArrayInPlace(tagsPool);
  const drawn = tagsPool.splice(0, n);
  // 抽出即消費：立刻寫入 localStorage，避免重整後已用過的標籤又出現
  saveTagsStateToStorage();
  return drawn;
}

/**
 * 將標籤陣列渲染為搜尋 chip
 * @param {HTMLElement} container
 * @param {Array<{en: string, zh: string}|string>} tags
 */
function renderSuggestedTagChips(container, tags) {
  container.innerHTML = '';

  tags.forEach((tag) => {
    const en = typeof tag === 'object' ? String(tag.en || '').trim() : String(tag || '').trim();
    const zh = typeof tag === 'object' ? String(tag.zh || '').trim() : '';
    if (!en) return;

    const chip = document.createElement('span');
    chip.className = 'search-chip';
    chip.dataset.keyword = en;
    chip.innerHTML =
      escapeHtml(en) +
      (zh ? ' <small class="search-chip-zh">(' + escapeHtml(zh) + ')</small>' : '');
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute(
      'aria-label',
      '填入搜尋關鍵字：' + en + (zh ? '（' + zh + '）' : '')
    );
    container.appendChild(chip);
  });
}

/**
 * 將新標籤寫入黑名單（保留中英雙語），並以 FIFO 限制長度
 * @param {Array<{en: string, zh: string}|string>} tags
 */
function appendTagsToHistory(tags) {
  tags.forEach((tag) => {
    if (typeof tag === 'object' && tag !== null) {
      const en = String(tag.en || '').trim();
      const zh = String(tag.zh || '').trim();
      if (en) generatedTagsHistory.push({ en, zh });
      return;
    }
    const en = String(tag || '').trim();
    if (en) generatedTagsHistory.push({ en, zh: '' });
  });

  // FIFO 保護：黑名單最多保留最近 30 個關鍵字，避免無限增長導致 AI 可用詞彙枯竭、產生幻覺
  if (generatedTagsHistory.length > 30) {
    generatedTagsHistory = generatedTagsHistory.slice(-30);
  }
}

/**
 * 從黑名單取出英文關鍵字陣列（供 API 排除用；相容舊版純字串格式）
 * @returns {string[]}
 */
function getHistoryEnglishList() {
  return generatedTagsHistory
    .map((tag) =>
      typeof tag === 'object' && tag !== null
        ? String(tag.en || '').trim()
        : String(tag || '').trim()
    )
    .filter(Boolean);
}

/**
 * 將標籤歷史黑名單渲染進 #history-tags-list
 */
function renderTagHistoryList() {
  const listEl = document.getElementById('history-tags-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (!generatedTagsHistory.length) {
    listEl.innerHTML = '<span class="text-small text-gray">尚無歷史紀錄</span>';
    return;
  }

  generatedTagsHistory.forEach((tag) => {
    const en =
      typeof tag === 'object' && tag !== null
        ? String(tag.en || '').trim()
        : String(tag || '').trim();
    const zh =
      typeof tag === 'object' && tag !== null ? String(tag.zh || '').trim() : '';
    if (!en) return;

    const chip = document.createElement('span');
    chip.className = 'history-chip';
    chip.innerHTML =
      escapeHtml(en) +
      (zh ? ' <small class="search-chip-zh">(' + escapeHtml(zh) + ')</small>' : '');
    listEl.appendChild(chip);
  });
}

/**
 * 開啟標籤探索歷史 Modal
 */
function openTagHistoryModal() {
  const modal = document.getElementById('tag-history-modal');
  if (!modal) return;
  renderTagHistoryList();
  modal.classList.remove('hidden');
}

/**
 * 關閉標籤探索歷史 Modal
 */
function closeTagHistoryModal() {
  const modal = document.getElementById('tag-history-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

/**
 * 清空標籤歷史黑名單，寫回 localStorage，並更新 Modal 顯示
 */
function clearTagHistory() {
  generatedTagsHistory = [];
  saveTagsStateToStorage();
  renderTagHistoryList();
  if (typeof showToast === 'function') {
    showToast('✅ 歷史標籤已清空');
  }
}

/**
 * 綁定標籤歷史 Modal 的開關與清空事件
 */
function bindTagHistoryModalEvents() {
  const viewBtn = document.getElementById('btn-view-tag-history');
  const closeBtn = document.getElementById('btn-close-history');
  const clearBtn = document.getElementById('btn-clear-tag-history');
  const modal = document.getElementById('tag-history-modal');

  if (viewBtn) {
    viewBtn.addEventListener('click', openTagHistoryModal);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeTagHistoryModal);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearTagHistory);
  }

  // 點擊半透明背景（overlay 本身）時關閉
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeTagHistoryModal();
      }
    });
  }
}

/**
 * 依目前科目載入／切換推薦搜尋關鍵字標籤
 *
 * 永久快取池運作機制：
 * 1. 啟動時從 localStorage 還原 tagsPool／黑名單／科目綁定（跨 Session 不丟）。
 * 2. 同一科目下，API 一次補充約 12 個標籤進 tagsPool，並寫入黑名單。
 * 3. 「換一組」優先從池中隨機抽出 4 個立刻顯示（零 API 延遲），抽出後立刻 saveTagsStateToStorage。
 * 4. 池內不足 4 個時才再次呼叫 API 補充。
 * 5. 切換科目時清空池與黑名單，更新 currentTagsSubject，並立刻寫入 localStorage，避免跨科混用。
 */
async function loadSuggestedTags() {
  const container = document.getElementById('suggested-tags-container');
  const shuffleBtn = document.getElementById('btn-shuffle-tags');
  if (!container) return;

  if (suggestedTagsLoading) return;
  suggestedTagsLoading = true;

  const subjectName =
    typeof getCurrentSubjectName === 'function'
      ? getCurrentSubjectName()
      : '通用社工實務';
  const subjectId = getSuggestedTagsSubjectId() || subjectName;

  try {
    // 步驟 A：科目檢查——與 currentTagsSubject 不同時，清空池與黑名單並永久化
    if (subjectId !== currentTagsSubject) {
      tagsPool = [];
      generatedTagsHistory = [];
      currentTagsSubject = subjectId;
      saveTagsStateToStorage();
    }

    // 步驟 B：池內足夠（>= 4）→ 直接隨機抽出，零延遲切換
    if (tagsPool.length >= 4) {
      const drawn = drawTagsFromPool(4);
      renderSuggestedTagChips(container, drawn);
      suggestedTagsLoaded = true;
      return;
    }

    // 步驟 B：池底不足 → 顯示 Loading，呼叫 API 批次補充後再抽出
    container.innerHTML = '<span class="tags-loading">靈感生成中...</span>';
    if (shuffleBtn) shuffleBtn.disabled = true;

    if (typeof generateLiteratureTagsAPI !== 'function') {
      throw new Error('標籤生成功能尚未就緒，請重新整理頁面。');
    }

    const newTags = await generateLiteratureTagsAPI(subjectName, getHistoryEnglishList());

    // API 回傳後：推入快取池與黑名單，套用 FIFO（最多 30），立刻永久化
    tagsPool.push(...newTags);
    appendTagsToHistory(newTags);
    saveTagsStateToStorage();

    const drawn = drawTagsFromPool(4);
    if (drawn.length < 4) {
      throw new Error('標籤快取池不足，請再試一次。');
    }

    renderSuggestedTagChips(container, drawn);
    suggestedTagsLoaded = true;
  } catch (error) {
    suggestedTagsLoaded = false;
    container.innerHTML =
      '<span class="tags-error">' +
      escapeHtml(error.message || '標籤生成失敗，請稍後再試。') +
      '</span>';
  } finally {
    suggestedTagsLoading = false;
    if (shuffleBtn) shuffleBtn.disabled = false;
  }
}

/**
 * 點擊推薦標籤：將文字填入 L2 搜尋框
 * @param {string} tagText
 */
function fillL2KeywordFromChip(tagText) {
  const input = document.getElementById('l2-keyword-input');
  if (!input) return;
  input.value = String(tagText || '').trim();
  input.focus();
}

/**
 * 處理標籤容器的點擊／鍵盤事件（事件委派）
 * @param {Event} event
 */
function handleSuggestedTagsInteraction(event) {
  const chip = event.target.closest('.search-chip');
  if (!chip || !chip.closest('#suggested-tags-container')) return;

  if (event.type === 'keydown') {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
  }

  fillL2KeywordFromChip(chip.dataset.keyword || '');
}

/**
 * 綁定閱讀模組的所有事件（由 app.js 在 DOMContentLoaded 時呼叫）
 */
function initReadingModule() {
  // --- 難度切換 ---
  const levelSwitch = document.getElementById('reading-level-switch');
  if (levelSwitch) {
    levelSwitch.addEventListener('click', (event) => {
      const btn = event.target.closest('.level-btn');
      if (!btn || !btn.dataset.level) return;
      switchReadingLevel(btn.dataset.level);
    });
  }

  // --- L1 ---
  const generateBtn = document.getElementById('btn-generate-story');
  const showBtn = document.getElementById('btn-show-translation');
  const saveStoryBtn = document.getElementById('btn-save-story');
  const storyEn = document.getElementById('story-en');
  const lengthSwitch = document.getElementById('l1-length-switch');

  if (lengthSwitch) {
    lengthSwitch.addEventListener('click', (event) => {
      const btn = event.target.closest('.l1-length-btn');
      if (!btn) return;
      const mode = btn.getAttribute('data-story-length');
      if (mode !== 'long' && mode !== 'short') return;
      setL1LengthMode(mode);
    });
    setL1LengthMode(currentL1LengthMode);
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerateStory);
  }

  if (showBtn) {
    showBtn.addEventListener('click', handleToggleTranslation);
    showBtn.setAttribute('aria-expanded', 'false');
  }

  if (saveStoryBtn) {
    saveStoryBtn.addEventListener('click', handleSaveStory);
    syncSaveStoryButtonState();
  }

  if (storyEn) {
    storyEn.addEventListener('click', handleHoverWordTap);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('#story-en')) return;
    const activeWords = document.querySelectorAll('#story-en .hover-word.is-active');
    activeWords.forEach((el) => el.classList.remove('is-active'));
  });

  // --- L2 ---
  const l2SearchBtn = document.getElementById('btn-l2-search');
  const l2SimulateBtn = document.getElementById('btn-generate-simulated');
  const l2Input = document.getElementById('l2-keyword-input');
  const tagsContainer = document.getElementById('suggested-tags-container');
  const shuffleTagsBtn = document.getElementById('btn-shuffle-tags');

  if (l2SearchBtn) {
    l2SearchBtn.addEventListener('click', handleL2SearchLiterature);
  }

  if (l2SimulateBtn) {
    l2SimulateBtn.addEventListener('click', handleGenerateSimulatedLiterature);
  }

  if (l2Input) {
    l2Input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleL2SearchLiterature();
      }
    });
  }

  if (tagsContainer) {
    tagsContainer.addEventListener('click', handleSuggestedTagsInteraction);
    tagsContainer.addEventListener('keydown', handleSuggestedTagsInteraction);
  }

  if (shuffleTagsBtn) {
    shuffleTagsBtn.addEventListener('click', () => {
      loadSuggestedTags();
    });
  }

  // --- 標籤探索歷史 Modal ---
  bindTagHistoryModalEvents();

  // --- L3 ---
  const l3GenBtn = document.getElementById('btn-l3-generate');
  const l3TrueBtn = document.getElementById('btn-l3-true');
  const l3FalseBtn = document.getElementById('btn-l3-false');

  if (l3GenBtn) {
    l3GenBtn.addEventListener('click', handleGenerateCaseNote);
  }
  if (l3TrueBtn) {
    l3TrueBtn.addEventListener('click', () => handleL3TrueFalse(true));
  }
  if (l3FalseBtn) {
    l3FalseBtn.addEventListener('click', () => handleL3TrueFalse(false));
  }

  // 預設顯示 L1
  switchReadingLevel('l1');
}

window.initReadingModule = initReadingModule;
window.switchReadingLevel = switchReadingLevel;
window.loadSuggestedTags = loadSuggestedTags;
window.invalidateSuggestedTags = invalidateSuggestedTags;
window.getSavedArticles = getSavedArticles;
window.saveArticleToLibrary = saveArticleToLibrary;
