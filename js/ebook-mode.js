/**
 * ebook-mode.js — Phase 11.9：全功能電子書閱讀器
 *
 * 職責：
 * 1. 全螢幕純淨閱讀（略過單字表、測驗、寫作）
 * 2. 行內藍字生字高亮（vocabulary）＋懸浮中文 tooltip
 * 3. 整段中文翻譯預設收合（details）
 * 4. TTS 朗讀、字級 A-/A+、淺色／護眼／深色主題
 * 5. 上一篇／下一篇與目錄導覽
 */

/** @type {Array<Object>} */
let ebookArticles = [];

/** @type {number} */
let currentEbookIndex = 0;

/** 側邊目錄是否開啟 */
let ebookTocOpen = false;

/** 是否正在朗讀 */
let ebookIsSpeaking = false;

/** 主題循環 */
const EBOOK_THEMES = ['theme-sepia', 'theme-light', 'theme-dark'];

/** localStorage 鍵 */
const EBOOK_FONT_KEY = 'sw_ebook_font_size';
const EBOOK_THEME_KEY = 'sw_ebook_theme';

const EBOOK_FONT_MIN = 1.0;
const EBOOK_FONT_MAX = 1.8;
const EBOOK_FONT_STEP = 0.1;
const EBOOK_FONT_DEFAULT = 1.2;

/**
 * @param {string} text
 * @returns {string}
 */
function ebookEscapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @returns {Array<Object>}
 */
function getEbookArticles() {
  if (typeof loadSavedArticles === 'function') {
    return loadSavedArticles();
  }
  if (typeof getSavedArticles === 'function') {
    return getSavedArticles();
  }
  try {
    const raw = localStorage.getItem('sw_saved_articles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * 電子書主標題（英文優先）
 * @param {Object} item
 * @returns {string}
 */
function getEbookTitleEn(item) {
  if (!item) return '(Untitled)';
  if (
    item.type === 'practice' ||
    (Array.isArray(item.content_chunks) && item.content_chunks.length)
  ) {
    return String(item.title_en || item.title || item.title_zh || '(Untitled)');
  }
  if (item.type === 'story') {
    if (item.title) return String(item.title);
    const text = String(item.story_en || '').replace(/\s+/g, ' ').trim();
    return text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : '(Untitled story)';
  }
  if (item.type === 'case_note') {
    if (item.title) return String(item.title);
    const text = String(item.article_en || item.case_note_en || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text
      ? text.length > 80
        ? `${text.slice(0, 80)}…`
        : text
      : '(Untitled case note)';
  }
  return String(item.original_title || item.title || item.title_en || '(Untitled)');
}

/**
 * 電子書副標題（中文）
 * @param {Object} item
 * @returns {string}
 */
function getEbookTitleZh(item) {
  if (!item) return '';
  const zh = String(item.title_zh || '').trim();
  if (!zh) return '';
  const en = getEbookTitleEn(item);
  if (zh === en) return '';
  return zh;
}

/**
 * 目錄／相容用標題（英文主標）
 * @param {Object} item
 * @returns {string}
 */
function getEbookTitle(item) {
  return getEbookTitleEn(item);
}

/**
 * @param {Object} item
 * @returns {string}
 */
function getEbookTypeLabel(item) {
  if (!item) return '';
  if (
    item.type === 'practice' ||
    (Array.isArray(item.content_chunks) && item.content_chunks.length)
  ) {
    return item.track === 'literature' ? '模擬學術文獻' : '社工小故事';
  }
  if (item.type === 'story') return '社工小故事（舊）';
  if (item.type === 'case_note') return '臨床挑戰（舊）';
  if (item.type === 'literature') return '模擬學術文獻（舊）';
  return '收藏文章';
}

/**
 * 彙整文章可用生字（相容 vocabulary／keywords／key_vocabulary／highlight_terms）
 * @param {Object} item
 * @returns {Array<{term: string, zh: string}>}
 */
function getEbookVocabularyList(item) {
  const map = new Map();

  const addList = (list) => {
    (Array.isArray(list) ? list : []).forEach((v) => {
      if (!v || typeof v !== 'object') return;
      const term = String(v.term || v.word || '').trim();
      const zh = String(v.zh || '').trim();
      if (!term || !zh) return;
      const key = term.toLowerCase();
      if (!map.has(key)) map.set(key, { term, zh });
    });
  };

  if (!item) return [];
  addList(item.vocabulary);
  addList(item.keywords);
  addList(item.key_vocabulary);
  addList(item.vocab);
  (Array.isArray(item.content_chunks) ? item.content_chunks : []).forEach((chunk) => {
    addList(chunk && chunk.highlight_terms);
  });

  return Array.from(map.values());
}

/**
 * 將英文段落中的重點單字替換為藍字高亮標籤（含 data-translation）
 * @param {string} text
 * @param {Array<{term?: string, word?: string, zh?: string}>} vocabList
 * @returns {string} 已跳脫並含高亮 span 的 HTML
 */
function highlightVocabularyInText(text, vocabList) {
  const raw = String(text || '');
  if (!raw) return '';

  const cleaned = (Array.isArray(vocabList) ? vocabList : [])
    .map((item) => {
      const term = String(item?.term || item?.word || '').trim();
      const zh = String(item?.zh || '').trim();
      if (!term || !zh) return null;
      return { term, zh };
    })
    .filter(Boolean);

  if (cleaned.length === 0) {
    return ebookEscapeHtml(raw);
  }

  // 長詞優先，避免短詞先吃掉片語
  const sortedVocab = [...cleaned].sort((a, b) => b.term.length - a.term.length);

  let html = ebookEscapeHtml(raw);
  const placeholders = [];

  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  sortedVocab.forEach((vocab) => {
    const escapedTerm = escapeRegExp(ebookEscapeHtml(vocab.term));
    const isPhrase = /\s/.test(vocab.term);
    const pattern = isPhrase
      ? escapedTerm.replace(/\\\s+/g, '\\s+').replace(/\s+/g, '\\s+')
      : escapedTerm;
    const termRegex = isPhrase
      ? new RegExp(`(${pattern})`, 'gi')
      : new RegExp(`\\b(${pattern})\\b`, 'gi');

    html = html.replace(termRegex, (match) => {
      if (match.includes('\uE000')) return match;
      const index = placeholders.length;
      const safeZh = ebookEscapeHtml(vocab.zh);
      placeholders.push(
        `<span class="vocab-highlight" data-translation="${safeZh}" tabindex="0" role="term" aria-label="${ebookEscapeHtml(match)}：${safeZh}">${match}</span>`
      );
      return `\uE000${index}\uE001`;
    });
  });

  return html.replace(/\uE000(\d+)\uE001/g, (_, indexStr) => {
    return placeholders[Number(indexStr)] || '';
  });
}

/**
 * 建立中英段落（英文含行內藍字高亮；整段中文預設收合）
 * @param {string} [heading]
 * @param {string} enText
 * @param {string} [zhText]
 * @param {Array<{term: string, zh: string}>} [vocabList]
 * @returns {string}
 */
function buildEbookParagraphHtml(heading, enText, zhText, vocabList) {
  const en = String(enText || '').trim();
  const zh = String(zhText || '').trim();
  if (!en && !zh) return '';

  let html = '<section class="ebook-section"><div class="ebook-paragraph">';
  if (heading) {
    html += `<h3 class="ebook-section-heading">${ebookEscapeHtml(heading)}</h3>`;
  }
  if (en) {
    const highlightedEnText = highlightVocabularyInText(en, vocabList);
    html += `<p class="ebook-en-text">${highlightedEnText.replace(/\n/g, '<br>')}</p>`;
  }
  if (zh) {
    html +=
      `<details class="ebook-translation-toggle">` +
      `<summary>👁️ 展開中文翻譯</summary>` +
      `<div class="ebook-translation-content">${ebookEscapeHtml(zh).replace(/\n/g, '<br>')}</div>` +
      `</details>`;
  }
  html += '</div></section>';
  return html;
}

/**
 * @param {Object} item
 * @returns {string}
 */
function buildEbookContentHtml(item) {
  if (!item) {
    return '<p class="ebook-empty">找不到文章內容。</p>';
  }

  const title = getEbookTitleEn(item);
  const titleZh = getEbookTitleZh(item);
  const typeLabel = getEbookTypeLabel(item);
  const subject = String(item.subjectName || '').trim();
  const vocabList = getEbookVocabularyList(item);

  let body = '';
  const chunks = Array.isArray(item.content_chunks) ? item.content_chunks : [];

  if (chunks.length > 0) {
    chunks.forEach((chunk, i) => {
      if (!chunk || typeof chunk !== 'object') return;
      // 刻意略過 inline_quiz、writing_tasks；生字僅用於行內高亮
      body += buildEbookParagraphHtml(
        chunks.length > 1 ? `第 ${i + 1} 段` : '',
        chunk.paragraph_en,
        chunk.paragraph_zh,
        vocabList
      );
    });
  } else if (item.type === 'story') {
    body += buildEbookParagraphHtml('', item.story_en, item.story_zh, vocabList);
  } else if (item.type === 'case_note') {
    body += buildEbookParagraphHtml(
      '',
      item.article_en || item.case_note_en,
      item.article_zh || item.case_note_zh,
      vocabList
    );
  } else {
    body += buildEbookParagraphHtml(
      '學術摘要',
      item.simplified_article || item.simplified_en || item.article_en,
      item.article_zh,
      vocabList
    );
    body += buildEbookParagraphHtml(
      '情境案例',
      item.case_scenario_en,
      item.case_scenario_zh,
      vocabList
    );
    body += buildEbookParagraphHtml(
      '實踐應用',
      item.practical_application_en,
      item.practical_application_zh,
      vocabList
    );
  }

  if (!body) {
    body = '<p class="ebook-empty">此篇文章沒有可閱讀的正文。</p>';
  }

  const metaParts = [typeLabel, subject].filter(Boolean);
  const metaHtml = metaParts.length
    ? `<p class="ebook-meta">${ebookEscapeHtml(metaParts.join(' ｜ '))}</p>`
    : '';

  const titleZhHtml = titleZh
    ? `<p class="ebook-title-zh">${ebookEscapeHtml(titleZh)}</p>`
    : '';

  return (
    `<header class="ebook-article-header">` +
    `<h1 class="ebook-title">${ebookEscapeHtml(title)}</h1>` +
    titleZhHtml +
    metaHtml +
    `</header>` +
    `<div class="ebook-body">${body}</div>`
  );
}

/**
 * 綁定翻譯 details 的 summary 文案切換
 * @param {HTMLElement} container
 */
function bindEbookTranslationToggles(container) {
  if (!container) return;
  container.querySelectorAll('.ebook-translation-toggle').forEach((details) => {
    const summary = details.querySelector('summary');
    if (!summary) return;
    details.addEventListener('toggle', () => {
      summary.textContent = details.open ? '🙈 隱藏中文翻譯' : '👁️ 展開中文翻譯';
    });
  });
}

/**
 * 讀取字級
 * @returns {number}
 */
function getEbookFontSize() {
  const raw = Number(localStorage.getItem(EBOOK_FONT_KEY));
  if (!Number.isFinite(raw)) return EBOOK_FONT_DEFAULT;
  return Math.max(EBOOK_FONT_MIN, Math.min(EBOOK_FONT_MAX, raw));
}

/**
 * 套用字級到容器
 * @param {number} [size]
 */
function applyEbookFontSize(size) {
  const container = document.getElementById('ebook-text-container');
  if (!container) return;
  const next = Math.round((Number(size) || EBOOK_FONT_DEFAULT) * 10) / 10;
  const clamped = Math.max(EBOOK_FONT_MIN, Math.min(EBOOK_FONT_MAX, next));
  container.style.setProperty('--ebook-font-size', `${clamped}rem`);
  localStorage.setItem(EBOOK_FONT_KEY, String(clamped));
}

/**
 * @param {number} delta
 */
function changeEbookFontSize(delta) {
  applyEbookFontSize(getEbookFontSize() + delta);
}

/**
 * @returns {string}
 */
function getEbookTheme() {
  const saved = String(localStorage.getItem(EBOOK_THEME_KEY) || '');
  return EBOOK_THEMES.includes(saved) ? saved : 'theme-sepia';
}

/**
 * @param {string} theme
 */
function applyEbookTheme(theme) {
  const overlay = document.getElementById('ebook-reader-overlay');
  if (!overlay) return;
  const next = EBOOK_THEMES.includes(theme) ? theme : 'theme-sepia';
  EBOOK_THEMES.forEach((t) => overlay.classList.remove(t));
  overlay.classList.add(next);
  localStorage.setItem(EBOOK_THEME_KEY, next);
}

/**
 * 循環切換主題
 */
function cycleEbookTheme() {
  const current = getEbookTheme();
  const idx = EBOOK_THEMES.indexOf(current);
  const next = EBOOK_THEMES[(idx + 1) % EBOOK_THEMES.length];
  applyEbookTheme(next);
}

/**
 * 更新朗讀按鈕文案
 */
function updateEbookReadButton() {
  const btn = document.getElementById('btn-ebook-read');
  if (!btn) return;
  if (ebookIsSpeaking) {
    btn.textContent = '⏹️ 停止';
    btn.setAttribute('aria-label', '停止朗讀');
  } else {
    btn.textContent = '🔊 朗讀';
    btn.setAttribute('aria-label', '朗讀英文');
  }
}

/**
 * 停止朗讀
 */
function stopEbookSpeech() {
  if (typeof stopSpeaking === 'function') {
    stopSpeaking();
  } else if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  ebookIsSpeaking = false;
  updateEbookReadButton();
}

/**
 * 提取目前頁面英文並朗讀／停止
 */
function toggleEbookSpeech() {
  if (ebookIsSpeaking) {
    stopEbookSpeech();
    return;
  }

  const container = document.getElementById('ebook-text-container');
  if (!container) return;

  const parts = Array.from(container.querySelectorAll('.ebook-en-text'))
    .map((el) => String(el.textContent || '').trim())
    .filter(Boolean);
  const text = parts.join('\n\n');
  if (!text) {
    alert('此篇沒有可朗讀的英文內容。');
    return;
  }

  ebookIsSpeaking = true;
  updateEbookReadButton();

  const onEnd = () => {
    ebookIsSpeaking = false;
    updateEbookReadButton();
  };

  if (typeof speakText === 'function') {
    speakText(text, 'en-US', onEnd);
    return;
  }

  if (!window.speechSynthesis) {
    ebookIsSpeaking = false;
    updateEbookReadButton();
    alert('您的瀏覽器不支援語音合成功能');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

/**
 * 更新翻頁與進度
 */
function updateEbookNavState() {
  const prevBtn = document.getElementById('btn-ebook-prev');
  const nextBtn = document.getElementById('btn-ebook-next');
  const progress = document.getElementById('ebook-progress');
  const total = ebookArticles.length;

  if (prevBtn) prevBtn.disabled = currentEbookIndex <= 0 || total === 0;
  if (nextBtn) nextBtn.disabled = currentEbookIndex >= total - 1 || total === 0;
  if (progress) {
    progress.textContent = total > 0 ? `${currentEbookIndex + 1} / ${total}` : '';
  }
}

/**
 * 渲染目錄
 */
function renderEbookToc() {
  const list = document.getElementById('ebook-toc-list');
  if (!list) return;

  list.innerHTML = '';
  ebookArticles.forEach((item, index) => {
    const li = document.createElement('li');
    li.className =
      'ebook-toc-item' + (index === currentEbookIndex ? ' is-active' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ebook-toc-btn';
    btn.dataset.index = String(index);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'ebook-toc-title';
    titleSpan.textContent = getEbookTitleEn(item);

    const titleZh = getEbookTitleZh(item);
    if (titleZh) {
      const zhSpan = document.createElement('span');
      zhSpan.className = 'ebook-toc-title-zh';
      zhSpan.textContent = titleZh;
      btn.appendChild(titleSpan);
      btn.appendChild(zhSpan);
    } else {
      btn.appendChild(titleSpan);
    }

    const typeSpan = document.createElement('span');
    typeSpan.className = 'ebook-toc-type';
    typeSpan.textContent = getEbookTypeLabel(item);

    btn.appendChild(typeSpan);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

/**
 * 渲染目前文章
 */
function renderEbookContent() {
  const container = document.getElementById('ebook-text-container');
  if (!container) return;

  stopEbookSpeech();

  const item = ebookArticles[currentEbookIndex];
  container.innerHTML = buildEbookContentHtml(item);
  container.scrollTop = 0;
  bindEbookTranslationToggles(container);

  updateEbookNavState();
  renderEbookToc();
}

/**
 * @param {boolean} [force]
 */
function setEbookTocOpen(force) {
  const sidebar = document.getElementById('ebook-sidebar');
  const tocBtn = document.getElementById('btn-ebook-toc');
  if (!sidebar) return;

  ebookTocOpen = typeof force === 'boolean' ? force : !ebookTocOpen;
  sidebar.classList.toggle('ebook-sidebar-hidden', !ebookTocOpen);
  sidebar.setAttribute('aria-hidden', ebookTocOpen ? 'false' : 'true');
  if (tocBtn) tocBtn.setAttribute('aria-expanded', ebookTocOpen ? 'true' : 'false');
}

/**
 * @param {number} [startIndex]
 */
function openEbookReader(startIndex) {
  ebookArticles = getEbookArticles();
  if (ebookArticles.length === 0) {
    alert('尚無收藏文章，請先到「閱讀練習」產生並收藏文章。');
    syncEbookEntryButton();
    return;
  }

  let index = Number(startIndex);
  if (!Number.isFinite(index) || index < 0) {
    const activeRow = document.querySelector(
      '#library-articles-list .library-item.is-active'
    );
    const activeId = activeRow ? String(activeRow.dataset.id || '') : '';
    if (activeId) {
      const found = ebookArticles.findIndex((a) => String(a.id) === activeId);
      index = found >= 0 ? found : 0;
    } else {
      index = 0;
    }
  }
  currentEbookIndex = Math.min(index, ebookArticles.length - 1);

  const overlay = document.getElementById('ebook-reader-overlay');
  if (!overlay) return;

  applyEbookTheme(getEbookTheme());
  applyEbookFontSize(getEbookFontSize());

  overlay.classList.remove('ebook-hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ebook-reader-open');
  setEbookTocOpen(false);
  renderEbookContent();
}

/**
 * 退出電子書
 */
function closeEbookReader() {
  stopEbookSpeech();
  const overlay = document.getElementById('ebook-reader-overlay');
  if (overlay) {
    overlay.classList.add('ebook-hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('ebook-reader-open');
  setEbookTocOpen(false);
  ebookArticles = [];
  currentEbookIndex = 0;
}

/**
 * @param {number} index
 */
function goToEbookIndex(index) {
  if (!ebookArticles.length) return;
  const next = Math.max(0, Math.min(ebookArticles.length - 1, Number(index)));
  if (
    next === currentEbookIndex &&
    document.getElementById('ebook-text-container')?.innerHTML
  ) {
    setEbookTocOpen(false);
    return;
  }
  currentEbookIndex = next;
  setEbookTocOpen(false);
  renderEbookContent();
}

/**
 * 同步入口按鈕
 */
function syncEbookEntryButton() {
  const btn = document.getElementById('btn-enter-ebook');
  if (!btn) return;
  const articles = getEbookArticles();
  btn.disabled = articles.length === 0;
  btn.title =
    articles.length === 0 ? '請先收藏至少一篇文章' : '進入純淨電子書閱讀模式';
}

/**
 * 綁定事件
 */
function bindEbookModeEvents() {
  if (bindEbookModeEvents._bound) return;
  bindEbookModeEvents._bound = true;

  const enterBtn = document.getElementById('btn-enter-ebook');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => openEbookReader());
  }

  const exitBtn = document.getElementById('btn-ebook-exit');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => closeEbookReader());
  }

  const tocBtn = document.getElementById('btn-ebook-toc');
  if (tocBtn) {
    tocBtn.addEventListener('click', () => setEbookTocOpen());
  }

  const readBtn = document.getElementById('btn-ebook-read');
  if (readBtn) {
    readBtn.addEventListener('click', () => toggleEbookSpeech());
  }

  const fontMinus = document.getElementById('btn-ebook-font-minus');
  if (fontMinus) {
    fontMinus.addEventListener('click', () => changeEbookFontSize(-EBOOK_FONT_STEP));
  }

  const fontPlus = document.getElementById('btn-ebook-font-plus');
  if (fontPlus) {
    fontPlus.addEventListener('click', () => changeEbookFontSize(EBOOK_FONT_STEP));
  }

  const themeBtn = document.getElementById('btn-ebook-theme');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => cycleEbookTheme());
  }

  const prevBtn = document.getElementById('btn-ebook-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => goToEbookIndex(currentEbookIndex - 1));
  }

  const nextBtn = document.getElementById('btn-ebook-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => goToEbookIndex(currentEbookIndex + 1));
  }

  const tocList = document.getElementById('ebook-toc-list');
  if (tocList) {
    tocList.addEventListener('click', (event) => {
      const btn = event.target.closest('.ebook-toc-btn');
      if (!btn) return;
      goToEbookIndex(Number(btn.dataset.index));
    });
  }

  const overlay = document.getElementById('ebook-reader-overlay');
  if (overlay) {
    overlay.addEventListener('click', (event) => {
      if (!ebookTocOpen) return;
      const sidebar = document.getElementById('ebook-sidebar');
      const toc = document.getElementById('btn-ebook-toc');
      if (
        sidebar &&
        !sidebar.contains(event.target) &&
        toc &&
        !toc.contains(event.target)
      ) {
        setEbookTocOpen(false);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    const overlayEl = document.getElementById('ebook-reader-overlay');
    if (!overlayEl || overlayEl.classList.contains('ebook-hidden')) return;

    if (event.key === 'Escape') {
      if (ebookTocOpen) {
        setEbookTocOpen(false);
      } else {
        closeEbookReader();
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToEbookIndex(currentEbookIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToEbookIndex(currentEbookIndex + 1);
    }
  });
}

/**
 * 初始化
 */
function initEbookModeModule() {
  bindEbookModeEvents();
  applyEbookTheme(getEbookTheme());
  applyEbookFontSize(getEbookFontSize());
  syncEbookEntryButton();
}

window.getEbookArticles = getEbookArticles;
window.openEbookReader = openEbookReader;
window.closeEbookReader = closeEbookReader;
window.syncEbookEntryButton = syncEbookEntryButton;
window.initEbookModeModule = initEbookModeModule;
window.enterEbookMode = openEbookReader;
window.exitEbookMode = closeEbookReader;
