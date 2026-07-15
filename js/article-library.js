/**
 * article-library.js — 模組 8.5：統一文章庫（文獻 + 社工小故事 + 臨床挑戰）
 *
 * 職責：
 * 1. 讀取 localStorage「sw_saved_articles」並依 type 過濾列表
 * 2. 依文章 type 動態渲染右側詳情（文獻含填空挑戰；故事含翻譯與生字）
 * 3. case_note：免 AI 渲染文章＋寫作表單（task_instruction 來自收藏）
 * 4. 保留純前端、零 Token 的翻譯切換與克漏字填空
 *
 * 依賴：reading.js（getSavedArticles／遷移邏輯）、task-ui.js（寫作表單）
 */

/** localStorage 鍵名（與 reading.js 共用） */
const ARTICLE_LIBRARY_STORAGE_KEY = 'sw_saved_articles';

/** @type {'all'|'literature'|'story'|'case_note'|'practice'} 目前過濾類型 */
let articleFilterType = 'all';

/** 目前展開中的文章 id；無則為 null */
let activeArticleId = null;

/** 是否處於填空挑戰模式 */
let clozeModeActive = false;

/* ============================================================
   資料讀取
   ============================================================ */

/**
 * 讀取統一文章庫（優先使用 reading.js 的 getSavedArticles，含舊資料遷移）
 * @returns {Array<Object>}
 */
function loadSavedArticles() {
  if (typeof getSavedArticles === 'function') {
    return getSavedArticles();
  }

  try {
    const raw = localStorage.getItem(ARTICLE_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * 依 id 找出單篇文章
 * @param {number|string} id
 * @returns {Object|null}
 */
function findArticleById(id) {
  const target = String(id);
  return loadSavedArticles().find((item) => String(item.id) === target) || null;
}

/* ============================================================
   HTML 工具
   ============================================================ */

/**
 * 跳脫 HTML 特殊字元
 * @param {string} text
 * @returns {string}
 */
function articleEscapeHtml(text) {
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
function articleEscapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 從 key_vocabulary／keywords 抽出可用單字
 * @param {Array<{term?: string, word?: string}>} vocab
 * @returns {string[]}
 */
function extractArticleVocabTerms(vocab) {
  return (vocab || [])
    .map((v) => String(v.term || v.word || '').trim())
    .filter(Boolean);
}

/**
 * 列表標題
 * @param {Object} item
 * @returns {string}
 */
function getArticleListTitle(item) {
  if (!item) return '（無標題）';
  if (item.type === 'practice') {
    return String(item.title_zh || item.title_en || item.title || '（無標題演練）');
  }
  if (item.type === 'story' || item.type === 'case_note') {
    if (item.title) return String(item.title);
    const text = String(
      item.type === 'case_note'
        ? item.article_en || item.case_note_en || ''
        : item.story_en || ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return item.type === 'case_note' ? '（無標題臨床挑戰）' : '（無標題故事）';
    }
    return text.length > 42 ? `${text.slice(0, 42)}…` : text;
  }
  return item.original_title || '（無標題）';
}

/**
 * 文章庫分類鍵：story | literature | legacy
 * 新雙軌（practice）依 track；其餘舊格式一律 legacy
 * @param {Object} item
 * @returns {'story'|'literature'|'legacy'}
 */
function getArticleLibraryCategory(item) {
  if (!item) return 'legacy';
  if (item.type === 'practice' || isInteractivePracticeArticle(item)) {
    return item.track === 'literature' ? 'literature' : 'story';
  }
  return 'legacy';
}

/**
 * 是否符合目前篩選 chip
 * @param {Object} item
 * @param {string} filterType
 * @returns {boolean}
 */
function articleMatchesLibraryFilter(item, filterType) {
  if (!item) return false;
  if (!filterType || filterType === 'all') return true;
  const category = getArticleLibraryCategory(item);
  // 相容舊 chip
  if (filterType === 'practice') {
    return item.type === 'practice' || isInteractivePracticeArticle(item);
  }
  if (filterType === 'case_note') {
    return item.type === 'case_note';
  }
  return category === filterType;
}

/**
 * 文章類型徽章文案與 CSS modifier
 * @param {Object} item
 * @returns {{label: string, modifier: string}}
 */
function getArticleTypeBadgeMeta(item) {
  if (item?.type === 'practice' || isInteractivePracticeArticle(item)) {
    return item.track === 'literature'
      ? { label: '模擬文獻', modifier: 'article-type-badge--literature' }
      : { label: '小故事', modifier: 'article-type-badge--story' };
  }
  if (item?.type === 'story') {
    return { label: '舊·故事', modifier: 'article-type-badge--story' };
  }
  if (item?.type === 'case_note') {
    return { label: '舊·臨床', modifier: 'article-type-badge--case-note' };
  }
  if (item?.type === 'literature') {
    return { label: '舊·文獻', modifier: 'article-type-badge--literature' };
  }
  return { label: '舊收藏', modifier: 'article-type-badge--case-note' };
}

/**
 * 右側占位提示
 * @returns {string}
 */
function getArticleDetailPlaceholderHtml() {
  return (
    '<div class="article-library-placeholder">' +
    '<p class="article-library-placeholder-title">選擇一篇文章</p>' +
    '<p class="article-library-placeholder-desc">從左側列表點選社工小故事或模擬學術文獻，即可在此閱讀、單字與寫作練習。</p>' +
    '</div>'
  );
}

/**
 * 將英文段落中出現的關鍵單字替換為填空 input
 * @param {string} text
 * @param {string[]} terms
 * @returns {string}
 */
function buildArticleClozeHtml(text, terms) {
  let html = articleEscapeHtml(text || '');
  if (!terms.length) return html;

  const sorted = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );

  const placeholders = [];

  sorted.forEach((term) => {
    const pattern = articleEscapeRegExp(articleEscapeHtml(term));
    const isPhrase = /\s/.test(term);
    const regex = isPhrase
      ? new RegExp(`(${pattern})`, 'gi')
      : new RegExp(`\\b(${pattern})\\b`, 'gi');

    html = html.replace(regex, (match) => {
      const index = placeholders.length;
      const safeAnswer = articleEscapeHtml(match);
      placeholders.push(
        `<span class="cloze-blank">` +
          `<input type="text" class="cloze-input" data-answer="${safeAnswer}" ` +
          `autocomplete="off" spellcheck="false" aria-label="填空：${safeAnswer}">` +
          `</span>`
      );
      return `\uE000${index}\uE001`;
    });
  });

  return html.replace(/\uE000(\d+)\uE001/g, (_, indexStr) => {
    return placeholders[Number(indexStr)] || '';
  });
}

/* ============================================================
   過濾 Chip
   ============================================================ */

/**
 * 同步 filter-chip 的 active 樣式
 * @param {'all'|'literature'|'story'|'case_note'} filterType
 */
function syncArticleFilterChips(filterType) {
  const chips = document.querySelectorAll('#article-library-section .filter-chip');
  chips.forEach((chip) => {
    const isActive = chip.dataset.type === filterType;
    chip.classList.toggle('active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  });
}

/**
 * 處理分類 Chip 點擊
 * @param {MouseEvent} event
 */
function handleArticleFilterClick(event) {
  const chip = event.target.closest('.filter-chip');
  if (!chip || !chip.dataset.type) return;

  const nextType = chip.dataset.type;
  if (nextType === articleFilterType) return;

  articleFilterType = nextType;
  syncArticleFilterChips(articleFilterType);
  renderArticlesList(articleFilterType);
}

/* ============================================================
   列表渲染
   ============================================================ */

/**
 * 渲染左側文章列表
 * @param {'all'|'literature'|'story'|'case_note'} [filterType='all']
 */
function renderArticlesList(filterType = 'all') {
  const listEl = document.getElementById('library-articles-list');
  const emptyEl = document.getElementById('article-library-empty');
  const detailEl = document.getElementById('library-article-detail');
  const layoutEl = document.querySelector('#article-library-section .layout-container');

  if (!listEl) return;

  articleFilterType = filterType || 'all';
  clozeModeActive = false;
  activeArticleId = null;
  exitEbookMode();

  const allArticles = loadSavedArticles();
  const filtered = allArticles.filter((item) =>
    articleMatchesLibraryFilter(item, articleFilterType)
  );

  listEl.innerHTML = '';
  if (detailEl) {
    detailEl.innerHTML = getArticleDetailPlaceholderHtml();
  }

  syncArticleFilterChips(articleFilterType);

  if (allArticles.length === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (layoutEl) layoutEl.classList.add('is-empty');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (layoutEl) layoutEl.classList.remove('is-empty');

  if (filtered.length === 0) {
    const emptyFilter = document.createElement('p');
    emptyFilter.className = 'article-filter-empty text-gray';
    const emptyMsgs = {
      literature: '此分類尚無模擬學術文獻。',
      story: '此分類尚無社工小故事。',
      legacy: '此分類尚無舊版收藏（舊文獻、舊故事、臨床挑戰等）。',
      case_note: '此分類尚無舊版臨床挑戰文章。',
      practice: '此分類尚無閱讀練習文章。'
    };
    emptyFilter.textContent =
      emptyMsgs[articleFilterType] || '此分類尚無文章。';
    listEl.appendChild(emptyFilter);
    return;
  }

  filtered.forEach((item) => {
    // 用 div 而非 button：行動版 Safari/WebKit 對 button 高度計算常讓小標題溢到邊框上
    const row = document.createElement('div');
    row.className = 'library-item article-library-item';
    row.dataset.id = String(item.id);
    row.dataset.type = item.type || '';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const topRow = document.createElement('div');
    topRow.className = 'article-item-top';

    const badgeMeta = getArticleTypeBadgeMeta(item);
    const badge = document.createElement('span');
    badge.className = `article-type-badge ${badgeMeta.modifier}`;
    badge.textContent = badgeMeta.label;
    topRow.appendChild(badge);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'library-item-title';
    titleSpan.textContent = getArticleListTitle(item);
    topRow.appendChild(titleSpan);

    const subjectSpan = document.createElement('div');
    subjectSpan.className = 'library-item-subject';
    const themePart =
      item.type === 'story' && item.theme ? ` · ${item.theme}` : '';
    subjectSpan.textContent = `${item.subjectName || '未指定科目'}${themePart}`;

    row.appendChild(topRow);
    row.appendChild(subjectSpan);

    const activate = () => {
      const id = item.id;
      if (String(activeArticleId) === String(id) && !clozeModeActive) {
        activeArticleId = null;
        exitEbookMode();
        if (detailEl) detailEl.innerHTML = getArticleDetailPlaceholderHtml();
        listEl.querySelectorAll('.library-item.is-active').forEach((el) => {
          el.classList.remove('is-active');
        });
        return;
      }

      activeArticleId = id;
      listEl.querySelectorAll('.library-item').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.id === String(id));
      });
      // 絕對不呼叫文章生成 API；僅從儲存庫渲染
      renderArticleDetail(item);
    };

    row.addEventListener('click', activate);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });

    listEl.appendChild(row);
  });
}

/* ============================================================
   詳情：文獻
   ============================================================ */

/**
 * 在標題區下方掛上 AI 深度挑戰按鈕與容器（文獻／故事共用）
 * @param {HTMLElement} pack
 * @param {Object} item
 * @param {{includeCloze?: boolean}} [opts]
 */
function appendArticleChallengeControls(pack, item, opts = {}) {
  const { includeCloze = false } = opts;

  const actions = document.createElement('div');
  actions.className = 'library-cloze-actions library-challenge-actions';

  if (includeCloze) {
    const clozeBtn = document.createElement('button');
    clozeBtn.type = 'button';
    clozeBtn.className = 'cloze-quiz-btn';
    clozeBtn.textContent = '🕳️ 填空挑戰';
    clozeBtn.addEventListener('click', () => {
      startArticleClozeChallenge(pack, item);
    });
    actions.appendChild(clozeBtn);
  }

  const challengeContainer = document.createElement('div');
  challengeContainer.id = 'challenge-container';
  challengeContainer.className = 'challenge-container hidden';
  challengeContainer.setAttribute('aria-live', 'polite');

  const challengeBtn = document.createElement('button');
  challengeBtn.type = 'button';
  challengeBtn.id = 'btn-generate-challenge';
  challengeBtn.className = 'btn btn-primary challenge-generate-btn';
  challengeBtn.textContent = '🧠 AI 深度挑戰';
  challengeBtn.addEventListener('click', () => {
    handleGenerateArticleChallenge(item, challengeBtn, challengeContainer);
  });
  actions.appendChild(challengeBtn);

  pack.appendChild(actions);
  pack.appendChild(challengeContainer);
}

/**
 * 取得文章庫項目可朗讀的英文全文
 * @param {Object} item
 * @returns {string}
 */
function getLibraryArticleSpeakText(item) {
  if (!item) return '';

  if (
    typeof isInteractivePracticeArticle === 'function' &&
    isInteractivePracticeArticle(item) &&
    typeof buildPracticeArticleContext === 'function'
  ) {
    return buildPracticeArticleContext(item);
  }

  if (item.type === 'story') {
    return String(item.story_en || '').trim();
  }

  if (item.type === 'case_note') {
    return String(item.article_en || item.case_note_en || '').trim();
  }

  // literature 與其他：串接各英文區塊
  return [
    item.simplified_article,
    item.simplified_en,
    item.article_en,
    item.case_scenario_en,
    item.practical_application_en
  ]
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 在標題列掛上朗讀控制（缺字時不掛）
 * @param {HTMLElement} titleRow
 * @param {string|(() => string)} textOrGetter
 */
function appendLibrarySpeakControls(titleRow, textOrGetter) {
  if (!titleRow || typeof createArticleSpeakControls !== 'function') return;
  const probe =
    typeof textOrGetter === 'function' ? textOrGetter() : textOrGetter;
  if (!String(probe || '').trim()) return;
  titleRow.appendChild(createArticleSpeakControls(textOrGetter));
}

/**
 * 建立帶朗讀的區塊標籤列
 * @param {string} labelText
 * @param {string|(() => string)} speakText
 * @returns {HTMLElement}
 */
function createLibrarySpeakLabelRow(labelText, speakText) {
  const row = document.createElement('div');
  row.className = 'tts-label-row';

  const label = document.createElement('span');
  label.className = 'result-label';
  label.textContent = labelText;
  row.appendChild(label);

  appendLibrarySpeakControls(row, speakText);
  return row;
}

/**
 * 建立文獻內容區塊（英文＋可切換中文）
 * @param {{heading: string, enText: string, zhText: string, variant?: string}} opts
 * @returns {HTMLElement}
 */
function createArticleLiteratureSection(opts) {
  const { heading, enText, zhText, variant = '' } = opts;

  const section = document.createElement('section');
  section.className = `sim-lit-section library-detail-section${variant ? ` sim-lit-section--${variant}` : ''}`;
  section.dataset.variant = variant;

  const headingRow = document.createElement('div');
  headingRow.className = 'tts-label-row library-section-heading-row';

  const headingEl = document.createElement('h4');
  headingEl.className = 'sim-lit-section-heading';
  headingEl.textContent = heading;
  headingRow.appendChild(headingEl);

  const enTextStr = String(enText || '').trim();
  if (enTextStr) {
    appendLibrarySpeakControls(headingRow, () => enTextStr);
  }
  section.appendChild(headingRow);

  const enP = document.createElement('p');
  enP.className = 'sim-lit-en library-en-text';
  enP.textContent = enText || '';
  enP.dataset.originalEn = enText || '';
  section.appendChild(enP);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'toggle-translation-btn library-zh-toggle';
  toggleBtn.textContent = '👀 顯示中文翻譯';
  toggleBtn.setAttribute('aria-expanded', 'false');
  section.appendChild(toggleBtn);

  const zhWrap = document.createElement('div');
  zhWrap.className = 'sim-lit-zh-wrap library-zh-wrap';
  zhWrap.setAttribute('aria-hidden', 'true');

  const zhP = document.createElement('p');
  zhP.className = 'sim-lit-zh';
  zhP.textContent = zhText || '';
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
 * 渲染文獻詳情（含填空挑戰）
 * @param {Object} item
 * @param {HTMLElement} detailEl
 */
function renderLiteratureArticleDetail(item, detailEl) {
  clozeModeActive = false;
  detailEl.innerHTML = '';

  const pack = document.createElement('article');
  pack.className = 'library-detail-pack';
  pack.dataset.articleId = String(item.id);
  pack.dataset.articleType = 'literature';

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row';

  const titleEl = document.createElement('h3');
  titleEl.className = 'literature-title';
  titleEl.textContent = item.original_title || '（無標題）';
  titleRow.appendChild(titleEl);

  appendLibrarySpeakControls(titleRow, () => getLibraryArticleSpeakText(item));
  pack.appendChild(titleRow);

  const metaEl = document.createElement('p');
  metaEl.className = 'library-detail-meta';
  metaEl.textContent = `📄 學術文獻｜科目：${item.subjectName || '未指定'}`;
  pack.appendChild(metaEl);

  appendArticleChallengeControls(pack, item, { includeCloze: true });

  pack.appendChild(
    createArticleLiteratureSection({
      heading: '📄 學術摘要 (Theory & Abstract)',
      enText: item.simplified_article,
      zhText: item.article_zh,
      variant: 'theory'
    })
  );

  pack.appendChild(
    createArticleLiteratureSection({
      heading: '👤 情境案例 (Case Scenario)',
      enText: item.case_scenario_en,
      zhText: item.case_scenario_zh,
      variant: 'case'
    })
  );

  pack.appendChild(
    createArticleLiteratureSection({
      heading: '🛠️ 實踐應用 (Practical Application)',
      enText: item.practical_application_en,
      zhText: item.practical_application_zh,
      variant: 'practice'
    })
  );

  const vocab = item.key_vocabulary || item.vocab || [];
  if (vocab.length > 0) {
    const vocabWrap = document.createElement('div');
    vocabWrap.className = 'literature-vocab library-vocab';
    vocabWrap.innerHTML = '<span class="result-label">重要生字</span>';

    const ul = document.createElement('ul');
    ul.className = 'literature-vocab-list';

    vocab.forEach((v) => {
      const word = (v.term || v.word || '').trim();
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
      zhSpan.textContent = v.pos ? `${v.zh}（${v.pos}）` : v.zh || '';
      li.appendChild(zhSpan);

      ul.appendChild(li);
    });

    vocabWrap.appendChild(ul);
    pack.appendChild(vocabWrap);
  }

  detailEl.appendChild(pack);
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ============================================================
   詳情：故事
   ============================================================ */

/**
 * 渲染社工小故事詳情
 * @param {Object} item
 * @param {HTMLElement} detailEl
 */
function renderStoryArticleDetail(item, detailEl) {
  clozeModeActive = false;
  detailEl.innerHTML = '';

  const pack = document.createElement('article');
  pack.className = 'library-detail-pack story-library-detail-pack';
  pack.dataset.articleId = String(item.id);
  pack.dataset.articleType = 'story';

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row';

  const titleEl = document.createElement('h3');
  titleEl.className = 'literature-title';
  titleEl.textContent = getArticleListTitle(item);
  titleRow.appendChild(titleEl);

  appendLibrarySpeakControls(titleRow, () => getLibraryArticleSpeakText(item));
  pack.appendChild(titleRow);

  const metaEl = document.createElement('p');
  metaEl.className = 'library-detail-meta';
  const themeText = item.theme ? `｜情境：${item.theme}` : '';
  metaEl.textContent = `📖 社工故事｜科目：${item.subjectName || '未指定'}${themeText}`;
  pack.appendChild(metaEl);

  appendArticleChallengeControls(pack, item, { includeCloze: false });

  const enBlock = document.createElement('div');
  enBlock.className = 'story-en-block';

  enBlock.appendChild(
    createLibrarySpeakLabelRow('英文故事', () => item.story_en || '')
  );

  const enP = document.createElement('p');
  enP.className = 'story-en';
  enP.textContent = item.story_en || '';
  enBlock.appendChild(enP);
  pack.appendChild(enBlock);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn btn-secondary story-library-zh-toggle';
  toggleBtn.textContent = '👀 顯示完整翻譯';
  toggleBtn.setAttribute('aria-expanded', 'false');
  pack.appendChild(toggleBtn);

  const zhBlock = document.createElement('div');
  zhBlock.className = 'story-zh-block hidden';

  const zhLabel = document.createElement('span');
  zhLabel.className = 'result-label';
  zhLabel.textContent = '中文翻譯';
  zhBlock.appendChild(zhLabel);

  const zhP = document.createElement('p');
  zhP.className = 'story-zh';
  zhP.textContent = item.story_zh || '';
  zhBlock.appendChild(zhP);
  pack.appendChild(zhBlock);

  toggleBtn.addEventListener('click', () => {
    const willShow = zhBlock.classList.contains('hidden');
    zhBlock.classList.toggle('hidden', !willShow);
    toggleBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
    toggleBtn.textContent = willShow ? '🙈 隱藏完整翻譯' : '👀 顯示完整翻譯';
  });

  const keywords = Array.isArray(item.keywords) ? item.keywords : [];
  if (keywords.length > 0) {
    const vocabWrap = document.createElement('div');
    vocabWrap.className = 'literature-vocab story-library-vocab';
    vocabWrap.innerHTML = '<span class="result-label">關鍵生字</span>';

    const ul = document.createElement('ul');
    ul.className = 'literature-vocab-list';

    keywords.forEach((v) => {
      const word = String((v && (v.word || v.term)) || '').trim();
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
      zhSpan.textContent = (v && v.zh) || '';
      li.appendChild(zhSpan);

      ul.appendChild(li);
    });

    vocabWrap.appendChild(ul);
    pack.appendChild(vocabWrap);
  }

  // 簡易反思提問（純前端、零 Token）
  const reflect = document.createElement('div');
  reflect.className = 'story-reflect-box';
  reflect.innerHTML =
    '<span class="result-label">💭 反思提問</span>' +
    '<p class="story-reflect-text">這個故事裡的社工運用了哪些溝通或介入技巧？若換成你，會如何回應案主的需要？</p>';
  pack.appendChild(reflect);

  detailEl.appendChild(pack);
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 渲染臨床挑戰詳情（免 AI 生成文章；底部掛寫作表單供再次練習）
 * @param {Object} item
 * @param {HTMLElement} detailEl
 */
function renderCaseNoteArticleDetail(item, detailEl) {
  clozeModeActive = false;
  detailEl.innerHTML = '';

  const articleEn = String(item.article_en || item.case_note_en || '').trim();
  const articleZh = String(item.article_zh || item.case_note_zh || '').trim();
  const taskInstruction =
    typeof buildStoredTaskInstruction === 'function'
      ? buildStoredTaskInstruction(item)
      : String(
          item.task_instruction ||
            item.guidance_zh ||
            item.task_zh ||
            item.task_en ||
            ''
        ).trim();

  const pack = document.createElement('article');
  pack.className = 'library-detail-pack case-note-library-detail-pack';
  pack.dataset.articleId = String(item.id);
  pack.dataset.articleType = 'case_note';

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row';

  const titleEl = document.createElement('h3');
  titleEl.className = 'literature-title';
  titleEl.textContent = getArticleListTitle(item);
  titleRow.appendChild(titleEl);

  appendLibrarySpeakControls(titleRow, () => articleEn);
  pack.appendChild(titleRow);

  const metaEl = document.createElement('p');
  metaEl.className = 'library-detail-meta';
  metaEl.textContent = `📝 臨床挑戰｜科目：${item.subjectName || '未指定'}｜免 AI 再次練習`;
  pack.appendChild(metaEl);

  // 不掛「AI 深度挑戰」：開啟收藏文章時不得呼叫文章生成 API

  const enBlock = document.createElement('div');
  enBlock.className = 'story-en-block';
  enBlock.appendChild(
    createLibrarySpeakLabelRow('Case Note（英文）', () => articleEn)
  );
  const enP = document.createElement('p');
  enP.className = 'story-en l3-case-en';
  enP.textContent = articleEn;
  enBlock.appendChild(enP);
  pack.appendChild(enBlock);

  if (articleZh) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-secondary story-library-zh-toggle';
    toggleBtn.textContent = '👀 顯示完整翻譯';
    toggleBtn.setAttribute('aria-expanded', 'false');
    pack.appendChild(toggleBtn);

    const zhBlock = document.createElement('div');
    zhBlock.className = 'story-zh-block hidden';
    const zhLabel = document.createElement('span');
    zhLabel.className = 'result-label';
    zhLabel.textContent = '中文翻譯';
    zhBlock.appendChild(zhLabel);
    const zhP = document.createElement('p');
    zhP.className = 'story-zh l3-case-zh';
    zhP.textContent = articleZh;
    zhBlock.appendChild(zhP);
    pack.appendChild(zhBlock);

    toggleBtn.addEventListener('click', () => {
      const willShow = zhBlock.classList.contains('hidden');
      zhBlock.classList.toggle('hidden', !willShow);
      toggleBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
      toggleBtn.textContent = willShow ? '🙈 隱藏完整翻譯' : '👀 顯示完整翻譯';
    });
  }

  const vocabulary = Array.isArray(item.vocabulary)
    ? item.vocabulary
    : Array.isArray(item.keywords)
      ? item.keywords
      : [];

  if (vocabulary.length > 0) {
    const vocabWrap = document.createElement('div');
    vocabWrap.className = 'literature-vocab story-library-vocab';
    vocabWrap.innerHTML = '<span class="result-label">關鍵生字</span>';

    const ul = document.createElement('ul');
    ul.className = 'literature-vocab-list';

    vocabulary.forEach((v) => {
      const word = String((v && (v.word || v.term)) || '').trim();
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
      zhSpan.textContent = (v && v.zh) || '';
      li.appendChild(zhSpan);

      ul.appendChild(li);
    });

    vocabWrap.appendChild(ul);
    pack.appendChild(vocabWrap);
  }

  // 文章底部：Phase 11.6 臨床督導實務紀錄表（空白表單 + 已存 task_instruction）
  if (typeof createClinicalTaskPracticeBlock === 'function') {
    const subjectId =
      (item.subjectId && String(item.subjectId).trim()) ||
      resolveArticleSubjectId(item.subjectName) ||
      null;

    let knowledge = null;
    if (typeof getSubjectKnowledge === 'function' && subjectId) {
      knowledge = getSubjectKnowledge(subjectId);
    }

    const practiceBlock = createClinicalTaskPracticeBlock({
      articleEn,
      articleZh,
      taskInstruction,
      taskEn: item.task_en || '',
      taskZh: item.task_zh || '',
      guidanceZh: item.guidance_zh || taskInstruction,
      taskType: item.task_type || '',
      subjectId,
      knowledge,
      subjectName: item.subjectName || '',
      onError: (message) => {
        if (typeof showToast === 'function') {
          showToast(`❌ ${message}`);
        } else {
          alert(message);
        }
      }
    });
    pack.appendChild(practiceBlock);
  } else {
    const fallback = document.createElement('p');
    fallback.className = 'hint-text';
    fallback.textContent =
      '寫作表單模組尚未載入。請重新整理頁面後再試。任務提示：' +
      (taskInstruction || '（無）');
    pack.appendChild(fallback);
  }

  detailEl.appendChild(pack);
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 渲染 Phase 11.8 情境演練收藏（免 AI；與主畫面同一套 UI）
 * @param {Object} item
 * @param {HTMLElement} detailEl
 */
function renderPracticeArticleDetail(item, detailEl) {
  clozeModeActive = false;
  detailEl.innerHTML = '';

  if (typeof renderPracticeArticle === 'function') {
    const root = document.createElement('div');
    root.className = 'practice-article-root library-practice-root';
    detailEl.appendChild(root);
    renderPracticeArticle(item, root);

    // 若主渲染未掛到朗讀（極端相容），補掛於標題列
    if (
      !root.querySelector('.tts-controls') &&
      typeof createArticleSpeakControls === 'function'
    ) {
      const titleRow =
        root.querySelector('.practice-title-row') ||
        root.querySelector('.tts-title-row');
      if (titleRow) {
        appendLibrarySpeakControls(titleRow, () =>
          getLibraryArticleSpeakText(item)
        );
      }
    }

    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  detailEl.innerHTML =
    '<p class="hint-text">閱讀練習模組尚未載入，請重新整理頁面後再試。</p>';
}

/**
 * 在右側詳情頂部插入「電子書模式」按鈕
 * @param {HTMLElement} detailEl
 */
function prependEbookModeButton(detailEl) {
  if (!detailEl) return;
  if (detailEl.querySelector('.article-library-placeholder')) return;
  if (detailEl.querySelector('#btn-ebook-mode')) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'ebook-mode-toolbar';

  const btn = document.createElement('button');
  btn.id = 'btn-ebook-mode';
  btn.type = 'button';
  btn.className = 'btn btn-secondary secondary-btn ebook-mode-btn';
  btn.textContent = '📖 電子書模式';
  btn.setAttribute('aria-label', '進入電子書閱讀模式');
  toolbar.appendChild(btn);

  detailEl.insertBefore(toolbar, detailEl.firstChild);
}

/**
 * 進入電子書沉浸閱讀模式
 */
function enterEbookMode() {
  const detailEl = document.getElementById('library-article-detail');
  if (!detailEl || detailEl.querySelector('.article-library-placeholder')) return;
  document.body.classList.add('ebook-active');
  detailEl.scrollTop = 0;
}

/**
 * 退出電子書沉浸閱讀模式
 */
function exitEbookMode() {
  document.body.classList.remove('ebook-active');
}

/**
 * 綁定電子書模式進出事件（按鈕、ESC、離開文章庫 Tab）
 */
function bindEbookModeEvents() {
  if (bindEbookModeEvents._bound) return;
  bindEbookModeEvents._bound = true;

  document.addEventListener('click', (event) => {
    if (event.target.closest('#btn-ebook-mode')) {
      enterEbookMode();
      return;
    }
    if (event.target.closest('#btn-exit-ebook')) {
      exitEbookMode();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('ebook-active')) {
      exitEbookMode();
    }
  });

  const tabNav = document.querySelector('.tab-nav');
  if (tabNav) {
    tabNav.addEventListener('click', (event) => {
      const tabBtn = event.target.closest('[data-tab]');
      if (tabBtn && tabBtn.getAttribute('data-tab') !== 'articles') {
        exitEbookMode();
      }
    });
  }
}

/**
 * 依 type 分派詳情渲染（開啟收藏文章時一律離線渲染，不呼叫文章生成 API）
 * @param {Object} item
 */
function renderArticleDetail(item) {
  const detailEl = document.getElementById('library-article-detail');
  if (!detailEl || !item) return;

  // Phase 11.8：有 content_chunks 的 practice／相容舊資料
  if (
    item.type === 'practice' ||
    (typeof isInteractivePracticeArticle === 'function' &&
      isInteractivePracticeArticle(item))
  ) {
    renderPracticeArticleDetail(item, detailEl);
  } else if (item.type === 'story') {
    renderStoryArticleDetail(item, detailEl);
  } else if (item.type === 'case_note') {
    renderCaseNoteArticleDetail(item, detailEl);
  } else {
    renderLiteratureArticleDetail(item, detailEl);
  }

  prependEbookModeButton(detailEl);
}

/* ============================================================
   填空挑戰（文獻專用）
   ============================================================ */

/**
 * 啟動填空挑戰
 * @param {HTMLElement} pack
 * @param {Object} item
 */
function startArticleClozeChallenge(pack, item) {
  if (!pack || !item) return;

  const terms = extractArticleVocabTerms(item.key_vocabulary || item.vocab || []);
  if (terms.length === 0) {
    alert('此文獻沒有生字資料，無法啟動填空挑戰。');
    return;
  }

  clozeModeActive = true;

  pack.querySelectorAll('.library-zh-wrap').forEach((el) => {
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    el.classList.add('cloze-zh-hidden');
  });
  pack.querySelectorAll('.library-zh-toggle').forEach((el) => {
    el.classList.add('hidden');
  });

  const targets = pack.querySelectorAll(
    '.library-detail-section[data-variant="theory"] .library-en-text, ' +
      '.library-detail-section[data-variant="case"] .library-en-text'
  );

  targets.forEach((enP) => {
    const original = enP.dataset.originalEn || enP.textContent || '';
    enP.innerHTML = buildArticleClozeHtml(original, terms);
    enP.classList.add('is-cloze-mode');
  });

  const actions = pack.querySelector('.library-cloze-actions');
  if (!actions) return;

  actions.innerHTML = '';

  const hint = document.createElement('p');
  hint.className = 'cloze-hint';
  hint.textContent = '請依文意填入關鍵單字（不分大小寫），完成後按「送出答案」。';
  actions.appendChild(hint);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn-primary cloze-submit-btn';
  submitBtn.textContent = '送出答案';
  submitBtn.addEventListener('click', () => {
    checkArticleClozeAnswers(pack);
  });
  actions.appendChild(submitBtn);

  const exitBtn = document.createElement('button');
  exitBtn.type = 'button';
  exitBtn.className = 'btn btn-secondary cloze-exit-btn';
  exitBtn.textContent = '結束挑戰並還原';
  exitBtn.addEventListener('click', () => {
    const fresh = findArticleById(item.id);
    if (fresh) renderArticleDetail(fresh);
  });
  actions.appendChild(exitBtn);

  const firstInput = pack.querySelector('.cloze-input');
  if (firstInput) firstInput.focus();
}

/**
 * 驗證填空答案
 * @param {HTMLElement} pack
 */
function checkArticleClozeAnswers(pack) {
  if (!pack) return;

  const inputs = pack.querySelectorAll('.cloze-input');
  let correctCount = 0;
  const total = inputs.length;

  inputs.forEach((input) => {
    const blank = input.closest('.cloze-blank') || input.parentElement;
    const answer = String(input.getAttribute('data-answer') || '').trim();
    const userVal = String(input.value || '').trim();

    if (blank) {
      blank.querySelectorAll('.cloze-correct-answer').forEach((el) => el.remove());
    }
    input.classList.remove('cloze-correct', 'cloze-wrong');

    const isCorrect = userVal.toLowerCase() === answer.toLowerCase();

    if (isCorrect) {
      correctCount += 1;
      input.classList.add('cloze-correct');
    } else {
      input.classList.add('cloze-wrong');
      const tip = document.createElement('span');
      tip.className = 'cloze-correct-answer';
      tip.textContent = ` → ${answer}`;
      if (blank) blank.appendChild(tip);
    }

    input.disabled = true;
  });

  let summary = pack.querySelector('.cloze-score-summary');
  if (!summary) {
    summary = document.createElement('p');
    summary.className = 'cloze-score-summary';
    const actions = pack.querySelector('.library-cloze-actions');
    if (actions) actions.appendChild(summary);
  }

  if (total === 0) {
    summary.textContent = '文中未找到可填空的關鍵單字。';
  } else if (correctCount === total) {
    summary.textContent = `🎉 全對！${correctCount} / ${total}`;
    summary.classList.add('cloze-score-summary--perfect');
  } else {
    summary.textContent = `得分：${correctCount} / ${total}（紅底為錯誤，旁有正確答案）`;
    summary.classList.remove('cloze-score-summary--perfect');
  }

  const submitBtn = pack.querySelector('.cloze-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '已送出';
  }
}

/* ============================================================
   AI 深度挑戰（文獻專用）
   ============================================================ */

/**
 * 依文章類型組裝傳給 LLM 的上下文
 * - literature：英文摘要 + 英文情境
 * - story：故事全文 story_en
 * @param {Object} item
 * @returns {string}
 */
function buildArticleChallengeContext(item) {
  if (!item) return '';

  if (item.type === 'story') {
    const story = String(item.story_en || '').trim();
    if (!story) return '';
    const theme = String(item.theme || '').trim();
    const title = getArticleListTitle(item);
    const parts = [`Type: Social Work Story`];
    if (title) parts.push(`Title: ${title}`);
    if (theme) parts.push(`Theme: ${theme}`);
    parts.push(`Story:\n${story}`);
    return parts.join('\n\n');
  }

  // literature（或未標 type 時視為文獻）
  const parts = ['Type: Academic Literature'];
  const title = String(item.original_title || '').trim();
  const abstract = String(
    item.simplified_article ||
      item.simplified_en ||
      item.article_en ||
      ''
  ).trim();
  const scenario = String(item.case_scenario_en || '').trim();

  if (title) parts.push(`Title: ${title}`);
  if (abstract) parts.push(`Abstract / Theory:\n${abstract}`);
  if (scenario) parts.push(`Case Scenario:\n${scenario}`);

  return parts.length > 1 ? parts.join('\n\n') : '';
}

/**
 * 依文章科目名稱反查 subjectId（舊收藏可能只有 subjectName）
 * @param {string} subjectName
 * @returns {string|null}
 */
function resolveArticleSubjectId(subjectName) {
  const name = String(subjectName || '').trim();
  if (!name) return null;
  const list = Array.isArray(window.subjectsList) ? window.subjectsList : [];
  const found = list.find((s) => s && String(s.name || '').trim() === name);
  return found && found.id ? String(found.id) : null;
}

/**
 * 點擊「AI 深度挑戰」：呼叫 API 並渲染測驗
 * @param {Object} item
 * @param {HTMLButtonElement} btn
 * @param {HTMLElement} container
 */
async function handleGenerateArticleChallenge(item, btn, container) {
  if (!item || !btn || !container) return;

  // 防止連點／重試期間重複送出請求
  if (btn.dataset.generating === '1' || btn.disabled) return;

  if (typeof generateArticleChallengeAPI !== 'function') {
    alert('深度挑戰功能尚未載入，請重新整理頁面後再試。');
    return;
  }

  const articleContext = buildArticleChallengeContext(item);
  if (!articleContext.trim()) {
    const emptyMsg =
      item.type === 'story'
        ? '此故事缺少英文內容，無法生成深度挑戰。'
        : '此文獻缺少英文摘要或情境內容，無法生成深度挑戰。';
    alert(emptyMsg);
    return;
  }

  const originalLabel = btn.textContent;
  btn.dataset.generating = '1';
  btn.disabled = true;
  btn.textContent = '🧠 生成中...';
  container.classList.remove('hidden');
  container.innerHTML =
    '<p class="challenge-loading-text">正在根據文章內容生成專屬測驗，請稍候…</p>';

  try {
    const articleSubjectId =
      (item.subjectId && String(item.subjectId).trim()) ||
      resolveArticleSubjectId(item.subjectName) ||
      (typeof resolveCurrentSubject === 'function'
        ? resolveCurrentSubject().id
        : null);

    const challenge = await generateArticleChallengeAPI(
      articleContext,
      'challenge',
      articleSubjectId
    );
    renderArticleChallenge(container, challenge, item);
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    const message =
      err && err.message
        ? err.message
        : '生成失敗，請稍後再試。';
    container.innerHTML =
      `<p class="challenge-error-text">${articleEscapeHtml(message)}</p>`;
  } finally {
    btn.dataset.generating = '0';
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/**
 * 渲染 AI 深度挑戰測驗卷
 * @param {HTMLElement} container
 * @param {{
 *   mcq: {question: string, options: string[], correct_index: number, explanation: string},
 *   scenario_reflection: {question: string, reference_answer: string}
 * }} challenge
 * @param {Object} [articleItem] - 來源文章（用於 earnGem 防重複 referenceId）
 */
function renderArticleChallenge(container, challenge, articleItem) {
  if (!container || !challenge || !challenge.mcq || !challenge.scenario_reflection) {
    return;
  }

  const { mcq, scenario_reflection: reflection } = challenge;
  const articleId =
    articleItem && articleItem.id != null ? articleItem.id : null;
  container.innerHTML = '';
  container.classList.remove('hidden');

  const title = document.createElement('h4');
  title.className = 'challenge-title';
  title.textContent = '🧠 AI 深度挑戰';
  container.appendChild(title);

  // —— MCQ ——
  const mcqBlock = document.createElement('section');
  mcqBlock.className = 'challenge-mcq-block';

  const mcqLabel = document.createElement('span');
  mcqLabel.className = 'result-label';
  mcqLabel.textContent = '選擇題 (Multiple Choice)';
  mcqBlock.appendChild(mcqLabel);

  const mcqQuestion = document.createElement('p');
  mcqQuestion.className = 'challenge-question';
  mcqQuestion.textContent = mcq.question;
  mcqBlock.appendChild(mcqQuestion);

  const optionsList = document.createElement('div');
  optionsList.className = 'challenge-options';
  optionsList.setAttribute('role', 'radiogroup');
  optionsList.setAttribute('aria-label', '選擇題選項');

  const radioName = `challenge-mcq-${Date.now()}`;

  mcq.options.forEach((opt, index) => {
    const label = document.createElement('label');
    label.className = 'challenge-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.value = String(index);
    radio.className = 'challenge-option-radio';

    const text = document.createElement('span');
    text.className = 'challenge-option-text';
    text.textContent = opt;

    label.appendChild(radio);
    label.appendChild(text);
    optionsList.appendChild(label);
  });

  mcqBlock.appendChild(optionsList);

  const submitMcqBtn = document.createElement('button');
  submitMcqBtn.type = 'button';
  submitMcqBtn.className = 'btn btn-primary challenge-submit-mcq-btn';
  submitMcqBtn.textContent = '✅ 送出答案';
  mcqBlock.appendChild(submitMcqBtn);

  const explanationEl = document.createElement('div');
  explanationEl.className = 'challenge-explanation hidden';
  explanationEl.setAttribute('aria-hidden', 'true');
  mcqBlock.appendChild(explanationEl);

  submitMcqBtn.addEventListener('click', () => {
    const selected = optionsList.querySelector(
      'input[type="radio"]:checked'
    );
    if (!selected) {
      alert('請先選擇一個答案。');
      return;
    }

    const selectedIndex = Number(selected.value);
    const correctIndex = Number(mcq.correct_index);

    optionsList.querySelectorAll('.challenge-option').forEach((optEl, idx) => {
      optEl.classList.remove('is-correct', 'is-wrong', 'is-selected');
      const input = optEl.querySelector('input');
      if (input) input.disabled = true;

      if (idx === correctIndex) {
        optEl.classList.add('is-correct');
      } else if (idx === selectedIndex) {
        optEl.classList.add('is-wrong');
      }
      if (idx === selectedIndex) {
        optEl.classList.add('is-selected');
      }
    });

    const isCorrect = selectedIndex === correctIndex;
    explanationEl.classList.remove('hidden');
    explanationEl.setAttribute('aria-hidden', 'false');
    explanationEl.innerHTML =
      `<p class="challenge-result-label">${
        isCorrect ? '🎉 答對了！' : '❌ 答錯了'
      }</p>` +
      `<p class="challenge-explanation-text">${articleEscapeHtml(
        mcq.explanation
      )}</p>`;

    submitMcqBtn.disabled = true;
    submitMcqBtn.textContent = '已送出';

    // 遊戲化：AI 深度挑戰選擇題答對時獲得寶石（同文章不重複）
    if (isCorrect && typeof earnGem === 'function') {
      earnGem('challenge', articleId);
    }
  });

  container.appendChild(mcqBlock);

  // —— 情境反思 ——
  const reflectBlock = document.createElement('section');
  reflectBlock.className = 'challenge-reflect-block';

  const reflectLabel = document.createElement('span');
  reflectLabel.className = 'result-label';
  reflectLabel.textContent = '情境反思 (Scenario Reflection)';
  reflectBlock.appendChild(reflectLabel);

  const reflectQuestion = document.createElement('p');
  reflectQuestion.className = 'challenge-question';
  reflectQuestion.textContent = reflection.question;
  reflectBlock.appendChild(reflectQuestion);

  const textarea = document.createElement('textarea');
  textarea.className = 'challenge-reflect-textarea';
  textarea.rows = 4;
  textarea.placeholder = '可在此寫下你的想法（選填）…';
  textarea.setAttribute('aria-label', '情境反思作答');
  reflectBlock.appendChild(textarea);

  const revealBtn = document.createElement('button');
  revealBtn.type = 'button';
  revealBtn.className = 'btn btn-secondary challenge-reveal-btn';
  revealBtn.textContent = '💡 查看專家參考方向';
  reflectBlock.appendChild(revealBtn);

  const referenceEl = document.createElement('div');
  referenceEl.className = 'challenge-reference hidden';
  referenceEl.setAttribute('aria-hidden', 'true');
  reflectBlock.appendChild(referenceEl);

  revealBtn.addEventListener('click', () => {
    const willShow = referenceEl.classList.contains('hidden');
    referenceEl.classList.toggle('hidden', !willShow);
    referenceEl.setAttribute('aria-hidden', willShow ? 'false' : 'true');
    if (willShow) {
      referenceEl.innerHTML =
        `<p class="challenge-reference-label">專家參考方向</p>` +
        `<p class="challenge-reference-text">${articleEscapeHtml(
          reflection.reference_answer
        )}</p>`;
      revealBtn.textContent = '🙈 隱藏參考方向';
    } else {
      revealBtn.textContent = '💡 查看專家參考方向';
    }
  });

  container.appendChild(reflectBlock);
}

/* ============================================================
   初始化
   ============================================================ */

/**
 * 重新整理文章庫（切換 Tab 時呼叫）
 */
function refreshArticleLibraryView() {
  activeArticleId = null;
  clozeModeActive = false;
  exitEbookMode();
  renderArticlesList(articleFilterType || 'all');
}

/**
 * 初始化文章庫模組
 */
function initArticleLibraryModule() {
  const filters = document.querySelector('#article-library-section .library-filters');
  if (filters) {
    filters.addEventListener('click', handleArticleFilterClick);
  }

  bindEbookModeEvents();
  renderArticlesList('all');
}

window.loadSavedArticles = loadSavedArticles;
window.renderArticlesList = renderArticlesList;
window.refreshArticleLibraryView = refreshArticleLibraryView;
window.initArticleLibraryModule = initArticleLibraryModule;
window.enterEbookMode = enterEbookMode;
window.exitEbookMode = exitEbookMode;

// 相容舊呼叫名稱（若有殘留引用）
window.refreshLibraryView = refreshArticleLibraryView;
window.initLibraryModule = initArticleLibraryModule;
