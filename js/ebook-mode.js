/**
 * ebook-mode.js — Phase 11.9：純淨電子書閱讀器
 *
 * 職責：
 * 1. 從文章庫列表頁進入全螢幕閱讀 overlay
 * 2. 只渲染標題與中英段落（略過單字表、inline_quiz、寫作任務）
 * 3. 上一篇／下一篇與目錄導覽
 *
 * 依賴：reading.js／article-library.js 的 getSavedArticles／loadSavedArticles
 */

/** @type {Array<Object>} 目前閱讀清單 */
let ebookArticles = [];

/** @type {number} 目前閱讀索引 */
let currentEbookIndex = 0;

/** 側邊目錄是否開啟 */
let ebookTocOpen = false;

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
 * 讀取收藏文章
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
 * 電子書標題（完整、不截斷）
 * @param {Object} item
 * @returns {string}
 */
function getEbookTitle(item) {
  if (!item) return '（無標題）';
  if (item.type === 'practice' || (Array.isArray(item.content_chunks) && item.content_chunks.length)) {
    return String(item.title_zh || item.title_en || item.title || '（無標題演練）');
  }
  if (item.type === 'story') {
    if (item.title) return String(item.title);
    const text = String(item.story_en || '').replace(/\s+/g, ' ').trim();
    return text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : '（無標題故事）';
  }
  if (item.type === 'case_note') {
    if (item.title) return String(item.title);
    const text = String(item.article_en || item.case_note_en || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : '（無標題臨床挑戰）';
  }
  return String(item.original_title || item.title || '（無標題）');
}

/**
 * 類型標籤
 * @param {Object} item
 * @returns {string}
 */
function getEbookTypeLabel(item) {
  if (!item) return '';
  if (item.type === 'practice' || (Array.isArray(item.content_chunks) && item.content_chunks.length)) {
    return item.track === 'literature' ? '模擬學術文獻' : '社工小故事';
  }
  if (item.type === 'story') return '社工小故事（舊）';
  if (item.type === 'case_note') return '臨床挑戰（舊）';
  if (item.type === 'literature') return '模擬學術文獻（舊）';
  return '收藏文章';
}

/**
 * 建立一個中英段落區塊（純文字，不含測驗）
 * @param {string} [heading]
 * @param {string} enText
 * @param {string} [zhText]
 * @returns {string}
 */
function buildEbookParagraphHtml(heading, enText, zhText) {
  const en = String(enText || '').trim();
  const zh = String(zhText || '').trim();
  if (!en && !zh) return '';

  let html = '<section class="ebook-section">';
  if (heading) {
    html += `<h3 class="ebook-section-heading">${ebookEscapeHtml(heading)}</h3>`;
  }
  if (en) {
    html += `<p class="ebook-en">${ebookEscapeHtml(en).replace(/\n/g, '<br>')}</p>`;
  }
  if (zh) {
    html += `<p class="ebook-zh">${ebookEscapeHtml(zh).replace(/\n/g, '<br>')}</p>`;
  }
  html += '</section>';
  return html;
}

/**
 * 將文章轉成純淨閱讀 HTML（略過單字、測驗、寫作）
 * @param {Object} item
 * @returns {string}
 */
function buildEbookContentHtml(item) {
  if (!item) {
    return '<p class="ebook-empty">找不到文章內容。</p>';
  }

  const title = getEbookTitle(item);
  const typeLabel = getEbookTypeLabel(item);
  const subject = String(item.subjectName || '').trim();

  let body = '';

  // Phase 11.8 practice：只取 content_chunks 的中英段落
  const chunks = Array.isArray(item.content_chunks) ? item.content_chunks : [];
  if (chunks.length > 0) {
    chunks.forEach((chunk, i) => {
      if (!chunk || typeof chunk !== 'object') return;
      // 刻意略過 inline_quiz、highlight_terms、writing_tasks
      body += buildEbookParagraphHtml(
        chunks.length > 1 ? `第 ${i + 1} 段` : '',
        chunk.paragraph_en,
        chunk.paragraph_zh
      );
    });
  } else if (item.type === 'story') {
    body += buildEbookParagraphHtml('', item.story_en, item.story_zh);
  } else if (item.type === 'case_note') {
    body += buildEbookParagraphHtml(
      '',
      item.article_en || item.case_note_en,
      item.article_zh || item.case_note_zh
    );
  } else {
    // literature／相容舊格式
    body += buildEbookParagraphHtml(
      '學術摘要',
      item.simplified_article || item.simplified_en || item.article_en,
      item.article_zh
    );
    body += buildEbookParagraphHtml(
      '情境案例',
      item.case_scenario_en,
      item.case_scenario_zh
    );
    body += buildEbookParagraphHtml(
      '實踐應用',
      item.practical_application_en,
      item.practical_application_zh
    );
  }

  if (!body) {
    body = '<p class="ebook-empty">此篇文章沒有可閱讀的正文。</p>';
  }

  const metaParts = [typeLabel, subject].filter(Boolean);
  const metaHtml = metaParts.length
    ? `<p class="ebook-meta">${ebookEscapeHtml(metaParts.join(' ｜ '))}</p>`
    : '';

  return (
    `<header class="ebook-article-header">` +
    `<h1 class="ebook-title">${ebookEscapeHtml(title)}</h1>` +
    metaHtml +
    `</header>` +
    `<div class="ebook-body">${body}</div>`
  );
}

/**
 * 更新上一篇／下一篇按鈕狀態與進度
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
 * 渲染目錄清單
 */
function renderEbookToc() {
  const list = document.getElementById('ebook-toc-list');
  if (!list) return;

  list.innerHTML = '';
  ebookArticles.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'ebook-toc-item' + (index === currentEbookIndex ? ' is-active' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ebook-toc-btn';
    btn.dataset.index = String(index);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'ebook-toc-title';
    titleSpan.textContent = getEbookTitle(item);

    const typeSpan = document.createElement('span');
    typeSpan.className = 'ebook-toc-type';
    typeSpan.textContent = getEbookTypeLabel(item);

    btn.appendChild(titleSpan);
    btn.appendChild(typeSpan);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

/**
 * 渲染目前索引的文章
 */
function renderEbookContent() {
  const container = document.getElementById('ebook-text-container');
  if (!container) return;

  const item = ebookArticles[currentEbookIndex];
  container.innerHTML = buildEbookContentHtml(item);
  container.scrollTop = 0;

  updateEbookNavState();
  renderEbookToc();
}

/**
 * 開關目錄側邊欄
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
 * 進入電子書模式
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
    // 若文章庫有選中文章，從該篇開始
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

  overlay.classList.remove('ebook-hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ebook-reader-open');
  setEbookTocOpen(false);
  renderEbookContent();
}

/**
 * 退出電子書模式
 */
function closeEbookReader() {
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
 * 切換至指定索引
 * @param {number} index
 */
function goToEbookIndex(index) {
  if (!ebookArticles.length) return;
  const next = Math.max(0, Math.min(ebookArticles.length - 1, Number(index)));
  if (next === currentEbookIndex && document.getElementById('ebook-text-container')?.innerHTML) {
    setEbookTocOpen(false);
    return;
  }
  currentEbookIndex = next;
  setEbookTocOpen(false);
  renderEbookContent();
}

/**
 * 同步列表頁入口按鈕可用狀態
 */
function syncEbookEntryButton() {
  const btn = document.getElementById('btn-enter-ebook');
  if (!btn) return;
  const articles = getEbookArticles();
  btn.disabled = articles.length === 0;
  btn.title = articles.length === 0 ? '請先收藏至少一篇文章' : '進入純淨電子書閱讀模式';
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

  // 點擊側邊欄外關閉目錄
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
 * 初始化電子書模組
 */
function initEbookModeModule() {
  bindEbookModeEvents();
  syncEbookEntryButton();
}

window.getEbookArticles = getEbookArticles;
window.openEbookReader = openEbookReader;
window.closeEbookReader = closeEbookReader;
window.syncEbookEntryButton = syncEbookEntryButton;
window.initEbookModeModule = initEbookModeModule;
// 相容舊名稱
window.enterEbookMode = openEbookReader;
window.exitEbookMode = closeEbookReader;
