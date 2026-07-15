/**
 * story.js — Phase 11.8 一站式情境演練
 *
 * 職責：
 * 1. 雙軌生成（社工小故事／模擬學術文獻）
 * 2. 渲染 content_chunks（一段英 → 可折疊中 → inline_quiz）
 * 3. 掛載漸進式寫作區塊（task-ui）
 * 4. 整包收藏至文章庫
 */

/** @type {Object|null} 目前畫面上的互動文章 */
let currentPracticeArticle = null;

/** localStorage：藍色單字密度（0–100） */
const STORAGE_KEY_VOCAB_DENSITY = 'sw_vocab_highlight_density';

/** 預設密度 */
const DEFAULT_VOCAB_DENSITY = 70;

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function practice$(id) {
  return document.getElementById(id);
}

/**
 * 讀取藍色單字密度（0–100）
 * @returns {number}
 */
function getVocabHighlightDensity() {
  const raw = Number(localStorage.getItem(STORAGE_KEY_VOCAB_DENSITY));
  if (!Number.isFinite(raw)) return DEFAULT_VOCAB_DENSITY;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * 寫入藍色單字密度
 * @param {number} pct
 * @returns {number}
 */
function setVocabHighlightDensity(pct) {
  const next = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  localStorage.setItem(STORAGE_KEY_VOCAB_DENSITY, String(next));
  if (typeof window.__swNotifyDataChanged === 'function') {
    window.__swNotifyDataChanged(STORAGE_KEY_VOCAB_DENSITY);
  }
  return next;
}

/** 不列入「內容詞覆蓋率」計算的功能詞 */
const VOCAB_DENSITY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'at', 'by',
  'for', 'from', 'in', 'into', 'of', 'on', 'to', 'with', 'without', 'via',
  'is', 'are', 'was', 'were', 'be', 'been', 'been', 'am', 'do', 'does', 'did',
  'has', 'have', 'had', 'not', 'no', 'nor', 'this', 'that', 'these', 'those',
  'it', 'its', 'he', 'she', 'they', 'them', 'his', 'her', 'their', 'we', 'our',
  'you', 'your', 'i', 'my', 'me', 'who', 'whom', 'which', 'what', 'when',
  'where', 'why', 'how', 'can', 'could', 'may', 'might', 'must', 'shall',
  'should', 'will', 'would', 'also', 'than', 'too', 'very', 'just', 'only',
  'about', 'over', 'under', 'after', 'before', 'between', 'during', 'while',
  'such', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'any',
  'all', 'own', 'same', 'than', 'too', 'up', 'out', 'off', 'again', 'further',
  'once', 'here', 'there', 'mr', 'mrs', 'ms', 'dr'
]);

/**
 * 抽出英文內容詞（排除功能詞與過短詞）
 * @param {string} text
 * @returns {string[]}
 */
function extractContentTokens(text) {
  const raw = String(text || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  return raw.filter(
    (w) => w.length >= 3 && !VOCAB_DENSITY_STOPWORDS.has(w)
  );
}

/**
 * 依「全文內容詞覆蓋率」挑選要標藍的關鍵字
 * 100% = 標出詞表中所有能匹配到文中的詞／片語（不再只取詞表的一部分）
 * @param {Array<{word: string, zh: string}>} keywords
 * @param {number} [densityPct]
 * @param {string} [articleText]
 * @returns {Array<{word: string, zh: string}>}
 */
function selectKeywordsByDensity(keywords, densityPct, articleText) {
  const list = Array.isArray(keywords) ? keywords : [];
  const pct = Math.max(
    0,
    Math.min(100, Number(densityPct ?? getVocabHighlightDensity()) || 0)
  );
  if (pct <= 0 || list.length === 0) return [];

  const text = String(articleText || '');
  const textLower = text.toLowerCase();

  // 只保留實際出現在文中的詞
  const matched = list.filter((item) => {
    const w = String(item.word || '').trim();
    if (!w) return false;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isPhrase = /\s/.test(w);
    const pattern = isPhrase
      ? escaped.replace(/\s+/g, '\\s+')
      : `\\b${escaped}\\b`;
    try {
      return new RegExp(pattern, 'i').test(text);
    } catch (_) {
      return textLower.includes(w.toLowerCase());
    }
  });

  if (matched.length === 0) return [];
  if (pct >= 100) {
    // 100%：詞表能對上全文的全部標出（長詞優先避免短詞搶標）
    return [...matched].sort((a, b) => b.word.length - a.word.length);
  }

  const contentTokens = extractContentTokens(text);
  const targetCover = Math.max(
    1,
    Math.ceil((contentTokens.length * pct) / 100)
  );

  const sorted = [...matched].sort((a, b) => b.word.length - a.word.length);
  const selected = [];
  const covered = new Set();

  for (const item of sorted) {
    selected.push(item);
    extractContentTokens(item.word).forEach((tok) => covered.add(tok));
    if (covered.size >= targetCover) break;
  }

  return selected;
}

/**
 * 同步密度滑桿 UI 文案
 * @param {number} [pct]
 */
function syncVocabDensityUi(pct) {
  const value = pct != null ? pct : getVocabHighlightDensity();
  const range = practice$('vocab-density-range');
  const label = practice$('vocab-density-value');
  if (range && String(range.value) !== String(value)) {
    range.value = String(value);
  }
  if (label) label.textContent = `${value}%`;
}

/**
 * 密度變更：即時重渲目前文章（不重打生成 API）
 * @param {number} pct
 */
function applyVocabDensityAndRerender(pct) {
  const next = setVocabHighlightDensity(pct);
  syncVocabDensityUi(next);
  if (currentPracticeArticle && isInteractivePracticeArticle(currentPracticeArticle)) {
    renderPracticeArticle(currentPracticeArticle, null, { skipScroll: true });
  }
}

/**
 * 串接所有段落英文（供 L3 督導 Context）
 * @param {Object} article
 * @returns {string}
 */
function buildPracticeArticleContext(article) {
  if (!article) return '';
  const chunks = Array.isArray(article.content_chunks)
    ? article.content_chunks
    : [];
  const body = chunks
    .map((c) => String(c.paragraph_en || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const title = String(article.title_en || '').trim();
  return title ? `${title}\n\n${body}` : body;
}

/**
 * 判斷是否為 Phase 11.8 互動文章
 * @param {Object} item
 * @returns {boolean}
 */
function isInteractivePracticeArticle(item) {
  return (
    item &&
    Array.isArray(item.content_chunks) &&
    item.content_chunks.length > 0 &&
    item.writing_tasks &&
    typeof item.writing_tasks === 'object'
  );
}

/**
 * 顯示／清除錯誤
 * @param {string} [message]
 */
function showPracticeError(message) {
  const el = practice$('practice-error');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = `❌ ${message}`;
  el.classList.remove('hidden');
}

/**
 * 重置結果區（生成前）
 */
function resetPracticeDisplay() {
  currentPracticeArticle = null;
  const root = practice$('practice-article-root');
  const loading = practice$('practice-loading');
  const placeholder = practice$('practice-placeholder');
  if (root) {
    root.innerHTML = '';
    root.classList.add('hidden');
  }
  if (loading) loading.classList.add('hidden');
  if (placeholder) placeholder.classList.remove('hidden');
  showPracticeError('');
  syncPracticeSaveButton();
}

/**
 * 同步收藏按鈕
 */
function syncPracticeSaveButton() {
  const btn = practice$('btn-save-practice-article');
  if (!btn) return;

  if (!currentPracticeArticle || !isInteractivePracticeArticle(currentPracticeArticle)) {
    btn.disabled = true;
    btn.textContent = '⭐ 收藏文章';
    btn.classList.remove('is-saved');
    return;
  }

  const subjectName =
    typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : '社會工作';
  const title = String(currentPracticeArticle.title_en || '');
  const track = currentPracticeArticle.track || 'story';

  const already =
    typeof getSavedArticles === 'function'
      ? getSavedArticles().some(
          (item) =>
            item &&
            item.type === 'practice' &&
            item.title_en === title &&
            item.track === track &&
            item.subjectName === subjectName
        )
      : false;

  if (already) {
    btn.textContent = '✅ 已收藏至文章庫';
    btn.disabled = true;
    btn.classList.add('is-saved');
  } else {
    btn.textContent = '⭐ 收藏文章';
    btn.disabled = false;
    btn.classList.remove('is-saved');
  }
}

/**
 * 收藏目前互動文章（整包 JSON）
 */
function handleSavePracticeArticle() {
  if (!currentPracticeArticle || !isInteractivePracticeArticle(currentPracticeArticle)) {
    alert('目前沒有可收藏的文章，請先生成一篇。');
    return;
  }

  if (typeof saveArticleToLibrary !== 'function') {
    alert('文章庫模組尚未載入，請重新整理頁面。');
    return;
  }

  const subjectName =
    typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : '社會工作';
  const subjectId =
    typeof resolveCurrentSubject === 'function'
      ? resolveCurrentSubject().id
      : '';

  const payload = {
    ...currentPracticeArticle,
    id: currentPracticeArticle.id || Date.now(),
    type: 'practice',
    track: currentPracticeArticle.track || 'story',
    subjectId: subjectId || currentPracticeArticle.subjectId || '',
    subjectName: subjectName || '社會工作',
    timestamp: Date.now(),
    savedAt: new Date().toISOString()
  };

  const result = saveArticleToLibrary(payload);
  if (!result.ok) {
    alert(result.message || '收藏失敗，請稍後再試。');
    return;
  }

  currentPracticeArticle = payload;
  syncPracticeSaveButton();
  if (typeof showToast === 'function') {
    showToast(result.already ? '✅ 此文章已在文章庫中' : '✅ 已收藏至文章庫');
  }
}

/**
 * 比對 inline quiz 答案
 * @param {string} userLetter - A|B|C|D
 * @param {{correct_answer: string, options: string[]}} quiz
 * @returns {boolean}
 */
function isInlineQuizCorrect(userLetter, quiz) {
  const letter = String(userLetter || '').toUpperCase();
  const correct = String(quiz?.correct_answer || '').toUpperCase();
  if (/^[A-D]$/.test(correct)) return letter === correct;
  const options = Array.isArray(quiz?.options) ? quiz.options : [];
  const idx = letter.charCodeAt(0) - 65;
  if (idx < 0 || idx >= options.length) return false;
  return String(options[idx]).trim().toLowerCase() === correct.toLowerCase();
}

/**
 * 將 vocabulary 正規化為 wrapKeywordsWithHover 可用格式
 * @param {Array} vocabulary
 * @returns {Array<{word: string, zh: string}>}
 */
function normalizePracticeKeywords(vocabulary) {
  return (Array.isArray(vocabulary) ? vocabulary : [])
    .map((v) => {
      const word = String((v && (v.term || v.word)) || '').trim();
      const zh = String((v && v.zh) || '').trim();
      if (!word || !zh) return null;
      return { word, zh };
    })
    .filter(Boolean);
}

/**
 * 渲染單一段落 + 穿插選擇題
 * @param {Object} chunk
 * @param {number} index
 * @param {Array<{word: string, zh: string}>} [keywords]
 * @returns {HTMLElement}
 */
function renderPracticeChunk(chunk, index, keywords) {
  const section = document.createElement('section');
  section.className = 'practice-chunk';
  section.dataset.chunkIndex = String(index);

  const en = document.createElement('p');
  en.className = 'practice-chunk-en';
  const paragraphEn = String(chunk.paragraph_en || '');
  const kw = Array.isArray(keywords) ? keywords : [];
  if (kw.length > 0 && typeof wrapKeywordsWithHover === 'function') {
    en.innerHTML = wrapKeywordsWithHover(paragraphEn, kw);
  } else {
    en.textContent = paragraphEn;
  }
  section.appendChild(en);

  const zhToggle = document.createElement('button');
  zhToggle.type = 'button';
  zhToggle.className = 'btn btn-secondary practice-zh-toggle';
  zhToggle.textContent = '👀 顯示中文翻譯';
  zhToggle.setAttribute('aria-expanded', 'false');
  section.appendChild(zhToggle);

  const zhBlock = document.createElement('div');
  zhBlock.className = 'practice-chunk-zh hidden';
  const zhP = document.createElement('p');
  zhP.textContent = chunk.paragraph_zh || '';
  zhBlock.appendChild(zhP);
  section.appendChild(zhBlock);

  zhToggle.addEventListener('click', () => {
    const show = zhBlock.classList.contains('hidden');
    zhBlock.classList.toggle('hidden', !show);
    zhToggle.setAttribute('aria-expanded', show ? 'true' : 'false');
    zhToggle.textContent = show ? '🙈 隱藏中文翻譯' : '👀 顯示中文翻譯';
  });

  const quiz = chunk.inline_quiz || {};
  const quizBox = document.createElement('div');
  quizBox.className = 'practice-inline-quiz';

  const qLabel = document.createElement('span');
  qLabel.className = 'result-label';
  qLabel.textContent = `段落測驗 ${index + 1}`;
  quizBox.appendChild(qLabel);

  const qText = document.createElement('p');
  qText.className = 'practice-quiz-question';
  qText.textContent = quiz.question || '';
  quizBox.appendChild(qText);

  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'practice-quiz-options';
  optionsWrap.setAttribute('role', 'radiogroup');

  const radioName = `practice-quiz-${index}-${Date.now()}`;
  const options = Array.isArray(quiz.options) ? quiz.options : [];

  options.forEach((opt, optIdx) => {
    const letter = String.fromCharCode(65 + optIdx);
    const label = document.createElement('label');
    label.className = 'practice-quiz-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.value = letter;
    radio.className = 'practice-quiz-radio';

    const text = document.createElement('span');
    text.textContent = `${letter}. ${opt}`;

    label.appendChild(radio);
    label.appendChild(text);
    optionsWrap.appendChild(label);
  });

  quizBox.appendChild(optionsWrap);

  const checkBtn = document.createElement('button');
  checkBtn.type = 'button';
  checkBtn.className = 'btn btn-primary practice-quiz-check';
  checkBtn.textContent = '送出答案';
  quizBox.appendChild(checkBtn);

  const feedback = document.createElement('div');
  feedback.className = 'practice-quiz-feedback hidden';
  quizBox.appendChild(feedback);

  checkBtn.addEventListener('click', () => {
    const selected = optionsWrap.querySelector('input[type="radio"]:checked');
    if (!selected) {
      feedback.textContent = '請先選擇一個答案。';
      feedback.classList.remove('hidden', 'is-correct', 'is-wrong');
      return;
    }

    const ok = isInlineQuizCorrect(selected.value, quiz);
    feedback.classList.remove('hidden');
    feedback.classList.toggle('is-correct', ok);
    feedback.classList.toggle('is-wrong', !ok);
    feedback.innerHTML =
      (ok ? '✅ 正確！' : `❌ 不正確。正確答案是 ${quiz.correct_answer}。`) +
      (quiz.explanation
        ? `<p class="practice-quiz-explanation">${escapePracticeHtml(quiz.explanation)}</p>`
        : '');

    optionsWrap.querySelectorAll('input').forEach((input) => {
      input.disabled = true;
    });
    checkBtn.disabled = true;
    checkBtn.textContent = '已作答';
  });

  section.appendChild(quizBox);
  return section;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapePracticeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 渲染單字表（含發音與「加入學習」）
 * @param {Array} vocabulary
 * @returns {HTMLElement|null}
 */
function renderPracticeVocabulary(vocabulary) {
  const list = Array.isArray(vocabulary) ? vocabulary : [];
  if (list.length === 0) return null;

  const normalized = list.map((v) => ({
    word: String((v && (v.term || v.word)) || '').trim(),
    zh: String((v && v.zh) || '').trim(),
    pos: String((v && (v.part_of_speech || v.pos)) || '').trim()
  }));

  // 複用閱讀模組生字區塊（發音 + 加入學習）
  if (typeof createLiteratureVocabSection === 'function') {
    const section = createLiteratureVocabSection(normalized);
    const label = section.querySelector('.result-label');
    if (label) label.textContent = '重點單字表';
    section.classList.add('practice-vocab');
    return section;
  }

  // 後備：vocab-library 尚未就緒時仍提供加入學習
  const wrap = document.createElement('div');
  wrap.className = 'literature-vocab practice-vocab';
  wrap.innerHTML = '<span class="result-label">重點單字表</span>';

  const ul = document.createElement('ul');
  ul.className = 'literature-vocab-list';

  normalized.forEach((v) => {
    if (!v.word || !v.zh) return;

    const li = document.createElement('li');
    li.className = 'literature-vocab-item';

    const wordRow = document.createElement('div');
    wordRow.className = 'literature-vocab-word-row';

    const word = document.createElement('span');
    word.className = 'literature-vocab-word';
    word.textContent = v.word;
    wordRow.appendChild(word);

    if (typeof createVocabSpeakButton === 'function') {
      wordRow.appendChild(createVocabSpeakButton(v.word));
    }
    li.appendChild(wordRow);

    const zh = document.createElement('span');
    zh.className = 'literature-vocab-zh';
    zh.textContent = v.pos ? `${v.zh}（${v.pos}）` : v.zh;
    li.appendChild(zh);

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
        word: v.word,
        zh: v.zh,
        pos: v.pos
      });
      if (result.already) {
        addBtn.textContent = '✓ 已在學習清單';
        addBtn.disabled = true;
        addBtn.classList.add('is-added');
      } else if (result.ok) {
        addBtn.textContent = '✓ 已加入學習';
        addBtn.disabled = true;
        addBtn.classList.add('is-added');
        if (typeof showToast === 'function') {
          showToast('✅ 已加入學習清單');
        }
      } else {
        alert(result.message || '加入失敗，請稍後再試。');
      }
    });

    li.appendChild(addBtn);
    ul.appendChild(li);
  });

  wrap.appendChild(ul);
  return wrap;
}

/**
 * 渲染完整互動文章（主畫面或文章庫共用）
 * @param {Object} article
 * @param {HTMLElement} [targetRoot]
 * @param {{skipScroll?: boolean}} [options]
 */
function renderPracticeArticle(article, targetRoot, options) {
  const root = targetRoot || practice$('practice-article-root');
  const placeholder = practice$('practice-placeholder');
  if (!root || !article || !isInteractivePracticeArticle(article)) return;

  if (!targetRoot) {
    currentPracticeArticle = article;
  }

  root.innerHTML = '';
  root.classList.remove('hidden');
  if (placeholder && !targetRoot) placeholder.classList.add('hidden');

  const pack = document.createElement('article');
  pack.className = 'practice-article-pack';
  pack.dataset.track = article.track || 'story';

  const trackBadge = document.createElement('span');
  trackBadge.className =
    'practice-track-badge' +
    (article.track === 'literature'
      ? ' practice-track-badge--literature'
      : ' practice-track-badge--story');
  trackBadge.textContent =
    article.track === 'literature' ? '模擬學術文獻' : '社工小故事';
  pack.appendChild(trackBadge);

  // 模擬學術文獻：強制顯示學術免責（與舊閱讀模組同一份文案）
  if (article.track === 'literature') {
    const disclaimerWrap = document.createElement('div');
    disclaimerWrap.className = 'practice-academic-disclaimer-wrap';
    disclaimerWrap.innerHTML =
      typeof getAcademicDisclaimerHTML === 'function'
        ? getAcademicDisclaimerHTML()
        : '<div class="academic-disclaimer" style="background-color: #FDF2F8; color: #BE185D; padding: 12px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 20px; border-left: 4px solid #BE185D;">' +
          '<strong>⚠️ AI 模擬文獻聲明：</strong><br>' +
          '本文獻係以真實學術摘要為基礎，由 AI 擴寫而成之模擬教材（包含虛構之研究數據）。僅供英文閱讀訓練使用，請勿引用於真實學術研究。' +
          '</div>';
    pack.appendChild(disclaimerWrap);
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'tts-title-row practice-title-row';

  const titleEn = document.createElement('h3');
  titleEn.className = 'practice-title-en literature-title';
  titleEn.textContent = article.title_en || article.title || '';
  titleRow.appendChild(titleEn);

  if (typeof createArticleSpeakControls === 'function') {
    titleRow.appendChild(
      createArticleSpeakControls(() => buildPracticeArticleContext(article))
    );
  }
  pack.appendChild(titleRow);

  const titleZhText = String(article.title_zh || '').trim();
  if (titleZhText && titleZhText !== String(article.title_en || '').trim()) {
    const titleZh = document.createElement('p');
    titleZh.className = 'practice-title-zh';
    titleZh.textContent = titleZhText;
    pack.appendChild(titleZh);
  }

  // 主畫面：收藏按鈕放在標題下方（小尺寸）
  if (!targetRoot) {
    const saveWrap = document.createElement('div');
    saveWrap.className = 'save-story-wrap practice-save-wrap';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.id = 'btn-save-practice-article';
    saveBtn.className = 'save-story-btn btn btn-primary practice-save-btn';
    saveBtn.textContent = '⭐ 收藏文章';
    saveBtn.addEventListener('click', handleSavePracticeArticle);
    saveWrap.appendChild(saveBtn);
    pack.appendChild(saveWrap);
  }

  // 合併全域 vocabulary + 各段 highlight_terms
  const chunkTerms = [];
  (article.content_chunks || []).forEach((chunk) => {
    if (Array.isArray(chunk.highlight_terms)) {
      chunkTerms.push(...chunk.highlight_terms);
    }
  });
  const allKeywords = normalizePracticeKeywords([
    ...(article.vocabulary || []),
    ...chunkTerms
  ]);
  const articleText = buildPracticeArticleContext(article);
  const keywords = selectKeywordsByDensity(
    allKeywords,
    getVocabHighlightDensity(),
    articleText
  );
  const chunksWrap = document.createElement('div');
  chunksWrap.className = 'practice-chunks';
  article.content_chunks.forEach((chunk, i) => {
    chunksWrap.appendChild(renderPracticeChunk(chunk, i, keywords));
  });
  // 觸控裝置：點擊藍色關鍵字顯示中文
  chunksWrap.addEventListener(
    'click',
    typeof handleHoverWordTap === 'function'
      ? handleHoverWordTap
      : (event) => {
          const wordEl = event.target.closest('.hover-word');
          if (!wordEl || !chunksWrap.contains(wordEl)) return;
          const wasActive = wordEl.classList.contains('is-active');
          chunksWrap.querySelectorAll('.hover-word.is-active').forEach((el) => {
            el.classList.remove('is-active');
          });
          if (!wasActive) wordEl.classList.add('is-active');
        }
  );
  pack.appendChild(chunksWrap);

  const writingMount = document.createElement('div');
  writingMount.className = 'progressive-writing-mount';
  pack.appendChild(writingMount);

  // 重點單字表置於最下方（寫作區之後；顯示完整合併詞表）
  const vocabEl = renderPracticeVocabulary(allKeywords.map((k) => ({
    term: k.word,
    zh: k.zh
  })));
  if (vocabEl) {
    vocabEl.classList.add('practice-vocab--bottom');
    pack.appendChild(vocabEl);
  }

  root.appendChild(pack);

  if (typeof renderProgressiveWritingBlock === 'function') {
    renderProgressiveWritingBlock(writingMount, article);
  }

  if (!targetRoot) {
    syncPracticeSaveButton();
    if (!options?.skipScroll) {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

/**
 * 雙軌生成
 * @param {'story'|'literature'} track
 */
async function handleGeneratePracticeTrack(track) {
  const storyBtn = practice$('btn-generate-story-track');
  const litBtn = practice$('btn-generate-literature-track');
  const loading = practice$('practice-loading');
  const loadingText = loading?.querySelector('.loading-text');

  const apiFn =
    track === 'literature'
      ? window.generateInteractiveLiteratureAPI
      : window.generateInteractiveStoryAPI;

  if (typeof apiFn !== 'function') {
    showPracticeError('AI 模組尚未載入，請強制重新整理頁面（Ctrl+F5）後再試。');
    return;
  }

  resetPracticeDisplay();
  if (loading) loading.classList.remove('hidden');
  if (loadingText) {
    loadingText.textContent =
      track === 'literature'
        ? '正在生成模擬學術文獻與段落測驗…'
        : '正在生成社工小故事與段落測驗…';
  }

  if (storyBtn) storyBtn.disabled = true;
  if (litBtn) litBtn.disabled = true;

  try {
    const data = await apiFn();
    const article = {
      ...data,
      id: Date.now(),
      track: track === 'literature' ? 'literature' : 'story',
      type: 'practice'
    };
    if (loading) loading.classList.add('hidden');
    renderPracticeArticle(article);
  } catch (error) {
    if (loading) loading.classList.add('hidden');
    showPracticeError(error?.message || '生成失敗，請稍後再試。');
  } finally {
    if (storyBtn) storyBtn.disabled = false;
    if (litBtn) litBtn.disabled = false;
  }
}

/**
 * 初始化情境演練模組
 */
function initCasePracticeModule() {
  practice$('btn-generate-story-track')?.addEventListener('click', () => {
    handleGeneratePracticeTrack('story');
  });
  practice$('btn-generate-literature-track')?.addEventListener('click', () => {
    handleGeneratePracticeTrack('literature');
  });

  const densityRange = practice$('vocab-density-range');
  if (densityRange) {
    const initial = getVocabHighlightDensity();
    densityRange.value = String(initial);
    syncVocabDensityUi(initial);
    densityRange.addEventListener('input', () => {
      applyVocabDensityAndRerender(Number(densityRange.value));
    });
  }

  resetPracticeDisplay();
}

window.isInteractivePracticeArticle = isInteractivePracticeArticle;
window.buildPracticeArticleContext = buildPracticeArticleContext;
window.renderPracticeArticle = renderPracticeArticle;
window.initCasePracticeModule = initCasePracticeModule;
window.getCurrentPracticeArticle = () => currentPracticeArticle;
window.getVocabHighlightDensity = getVocabHighlightDensity;
window.selectKeywordsByDensity = selectKeywordsByDensity;
