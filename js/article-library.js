/**
 * article-library.js — 模組 8.5：統一文章庫（文獻 + 社工小故事）
 *
 * 職責：
 * 1. 讀取 localStorage「sw_saved_articles」並依 type 過濾列表
 * 2. 依文章 type 動態渲染右側詳情（文獻含填空挑戰；故事含翻譯與生字）
 * 3. 保留純前端、零 Token 的翻譯切換與克漏字填空
 *
 * 依賴：reading.js（getSavedArticles／遷移邏輯）
 */

/** localStorage 鍵名（與 reading.js 共用） */
const ARTICLE_LIBRARY_STORAGE_KEY = 'sw_saved_articles';

/** @type {'all'|'literature'|'story'} 目前過濾類型 */
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
  if (item.type === 'story') {
    if (item.title) return String(item.title);
    const text = String(item.story_en || '').replace(/\s+/g, ' ').trim();
    if (!text) return '（無標題故事）';
    return text.length > 42 ? `${text.slice(0, 42)}…` : text;
  }
  return item.original_title || '（無標題）';
}

/**
 * 右側占位提示
 * @returns {string}
 */
function getArticleDetailPlaceholderHtml() {
  return (
    '<div class="article-library-placeholder">' +
    '<p class="article-library-placeholder-title">選擇一篇文章</p>' +
    '<p class="article-library-placeholder-desc">從左側列表點選文獻或故事，即可在此閱讀、翻譯與進行填空挑戰。</p>' +
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
 * @param {'all'|'literature'|'story'} filterType
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
 * @param {'all'|'literature'|'story'} [filterType='all']
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

  const allArticles = loadSavedArticles();
  const filtered =
    articleFilterType === 'all'
      ? allArticles
      : allArticles.filter((item) => item && item.type === articleFilterType);

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
    emptyFilter.textContent =
      articleFilterType === 'literature'
        ? '此分類尚無學術文獻。'
        : '此分類尚無社工故事。';
    listEl.appendChild(emptyFilter);
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'library-item article-library-item';
    row.dataset.id = String(item.id);
    row.dataset.type = item.type || '';

    // 內層包一層：避免 <button> 當 flex 容器時高度算錯，小標題溢到卡片邊框上
    const body = document.createElement('span');
    body.className = 'library-item-body';

    const topRow = document.createElement('span');
    topRow.className = 'article-item-top';

    const badge = document.createElement('span');
    badge.className =
      'article-type-badge' +
      (item.type === 'story' ? ' article-type-badge--story' : ' article-type-badge--literature');
    badge.textContent = item.type === 'story' ? '故事' : '文獻';
    topRow.appendChild(badge);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'library-item-title';
    titleSpan.textContent = getArticleListTitle(item);
    topRow.appendChild(titleSpan);

    const subjectSpan = document.createElement('span');
    subjectSpan.className = 'library-item-subject';
    const themePart =
      item.type === 'story' && item.theme ? ` · ${item.theme}` : '';
    subjectSpan.textContent = `${item.subjectName || '未指定科目'}${themePart}`;

    body.appendChild(topRow);
    body.appendChild(subjectSpan);
    row.appendChild(body);

    row.addEventListener('click', () => {
      const id = item.id;
      if (String(activeArticleId) === String(id) && !clozeModeActive) {
        activeArticleId = null;
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
      renderArticleDetail(item);
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
 * 建立文獻內容區塊（英文＋可切換中文）
 * @param {{heading: string, enText: string, zhText: string, variant?: string}} opts
 * @returns {HTMLElement}
 */
function createArticleLiteratureSection(opts) {
  const { heading, enText, zhText, variant = '' } = opts;

  const section = document.createElement('section');
  section.className = `sim-lit-section library-detail-section${variant ? ` sim-lit-section--${variant}` : ''}`;
  section.dataset.variant = variant;

  const headingEl = document.createElement('h4');
  headingEl.className = 'sim-lit-section-heading';
  headingEl.textContent = heading;
  section.appendChild(headingEl);

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

  if (typeof createArticleSpeakControls === 'function') {
    titleRow.appendChild(
      createArticleSpeakControls(() =>
        [
          item.simplified_article,
          item.case_scenario_en,
          item.practical_application_en
        ]
          .map((t) => String(t || '').trim())
          .filter(Boolean)
          .join('\n\n')
      )
    );
  }
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

  if (typeof createArticleSpeakControls === 'function') {
    titleRow.appendChild(
      createArticleSpeakControls(() => item.story_en || '')
    );
  }
  pack.appendChild(titleRow);

  const metaEl = document.createElement('p');
  metaEl.className = 'library-detail-meta';
  const themeText = item.theme ? `｜情境：${item.theme}` : '';
  metaEl.textContent = `📖 社工故事｜科目：${item.subjectName || '未指定'}${themeText}`;
  pack.appendChild(metaEl);

  appendArticleChallengeControls(pack, item, { includeCloze: false });

  const enBlock = document.createElement('div');
  enBlock.className = 'story-en-block';

  const enLabel = document.createElement('span');
  enLabel.className = 'result-label';
  enLabel.textContent = '英文故事';
  enBlock.appendChild(enLabel);

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
 * 依 type 分派詳情渲染
 * @param {Object} item
 */
function renderArticleDetail(item) {
  const detailEl = document.getElementById('library-article-detail');
  if (!detailEl || !item) return;

  if (item.type === 'story') {
    renderStoryArticleDetail(item, detailEl);
    return;
  }

  renderLiteratureArticleDetail(item, detailEl);
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
    const challenge = await generateArticleChallengeAPI(
      articleContext,
      'challenge'
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

  renderArticlesList('all');
}

window.loadSavedArticles = loadSavedArticles;
window.renderArticlesList = renderArticlesList;
window.refreshArticleLibraryView = refreshArticleLibraryView;
window.initArticleLibraryModule = initArticleLibraryModule;

// 相容舊呼叫名稱（若有殘留引用）
window.refreshLibraryView = refreshArticleLibraryView;
window.initLibraryModule = initArticleLibraryModule;
