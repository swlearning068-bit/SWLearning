/**
 * writing.js — 寫作練習模組（L1 / L2 / L3）
 *
 * 職責：
 * 1. 難度切換（破冰 / 結構 / 專業）
 * 2. L1：情境碎片 → 完整句
 * 3. L2：句型填空 → 文法批改
 * 4. L3：個案紀錄 → 三版本 Tabs 展示
 * 5. Loading 骨架屏與打字機效果
 */

/* ============================================================
   L2 句型資料
   ============================================================ */

/** @type {Array<{id: string, label: string, blanks: number, placeholders: string[]}>} */
let L2_PATTERNS = [
  {
    id: 'feel-because',
    label: 'The client feels ___ because ___.',
    blanks: 2,
    placeholders: ['feeling / emotion', 'reason']
  },
  {
    id: 'need-in-order',
    label: 'The client needs ___ in order to ___.',
    blanks: 2,
    placeholders: ['support / resource', 'goal']
  },
  {
    id: 'during-visit',
    label: 'During the home visit, I noticed that ___.',
    blanks: 1,
    placeholders: ['observation']
  },
  {
    id: 'expressed-concern',
    label: 'The client expressed concern about ___ and requested ___.',
    blanks: 2,
    placeholders: ['concern', 'request']
  },
  {
    id: 'will-follow-up',
    label: 'I will follow up with ___ to ensure ___.',
    blanks: 2,
    placeholders: ['person / agency', 'outcome']
  },
  {
    id: 'although-still',
    label: 'Although the client ___, he/she still ___.',
    blanks: 2,
    placeholders: ['challenge', 'strength / action']
  }
];

/** 目前選中的 L3 結果資料（供 Tab 切換使用） */
let l3ResultData = null;

/** 換一組請求進行中旗標，避免重複點擊 */
let isShufflingL1 = false;
let isShufflingL2 = false;

/* ============================================================
   共用工具
   ============================================================ */

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function writing$(id) {
  return document.getElementById(id);
}

/**
 * @param {HTMLElement|null} el
 */
function writingShow(el) {
  if (el) el.classList.remove('hidden');
}

/**
 * @param {HTMLElement|null} el
 */
function writingHide(el) {
  if (el) el.classList.add('hidden');
}

/**
 * 打字機效果：逐字將文字顯示到目標元素
 *
 * @param {HTMLElement} element
 * @param {string} text
 * @param {number} speedMs
 * @returns {Promise<void>}
 */
function writingTypewriter(element, text, speedMs = 40) {
  return new Promise((resolve) => {
    element.textContent = '';
    element.classList.add('typewriter-cursor');

    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        element.textContent += text[index];
        index++;
      } else {
        clearInterval(timer);
        element.classList.remove('typewriter-cursor');
        resolve();
      }
    }, speedMs);
  });
}

/**
 * 將句型中的 ___ 依序替換成填空內容
 * @param {string} patternLabel
 * @param {string[]} answers
 * @returns {string}
 */
function fillPatternSentence(patternLabel, answers) {
  let i = 0;
  return patternLabel.replace(/___/g, () => {
    const ans = (answers[i] || '').trim() || '___';
    i++;
    return ans;
  });
}

/* ============================================================
   難度切換
   ============================================================ */

/**
 * 切換寫作難度面板
 * @param {'l1'|'l2'|'l3'} level
 */
function switchWritingLevel(level) {
  const panels = document.querySelectorAll('[data-level-panel]');
  panels.forEach((panel) => {
    const isTarget = panel.getAttribute('data-level-panel') === level;
    panel.classList.toggle('hidden', !isTarget);
  });

  const switchEl = writing$('writing-level-switch');
  if (!switchEl) return;

  switchEl.querySelectorAll('.level-btn').forEach((btn) => {
    const isActive = btn.dataset.level === level;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

/**
 * 綁定難度切換按鈕
 */
function initWritingLevelSwitch() {
  const switchEl = writing$('writing-level-switch');
  if (!switchEl) return;

  switchEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.level-btn');
    if (!btn) return;
    const level = btn.dataset.level;
    if (level) switchWritingLevel(level);
  });
}

/* ============================================================
   L1：情境碎片 → 完整句
   ============================================================ */

function initScenarioChips() {
  const chipsContainer = writing$('scenario-chips');
  const textarea = writing$('user-input');
  if (!chipsContainer || !textarea) return;

  chipsContainer.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;

    textarea.value = chip.dataset.fragments || '';

    chipsContainer.querySelectorAll('.chip').forEach((c) => {
      c.classList.remove('active');
    });
    chip.classList.add('active');
  });
}

/**
 * 以新的情境資料重繪 L1 標籤（格式與預設一致：中文標籤 + data-fragments）
 * @param {Array<{label_zh:string,fragments:string}>} scenarios
 */
function renderL1ScenarioChips(scenarios) {
  const chipsContainer = writing$('scenario-chips');
  if (!chipsContainer) return;

  chipsContainer.innerHTML = '';

  scenarios.forEach((item) => {
    const labelZh = String(item?.label_zh || '').trim();
    const fragments = String(item?.fragments || '').trim();
    if (!labelZh || !fragments) return;

    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.dataset.fragments = fragments;
    btn.textContent = labelZh;
    chipsContainer.appendChild(btn);
  });
}

/**
 * 取得目前科目名稱（供動態生成使用）
 * @returns {string}
 */
function getWritingSubjectName() {
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
 * L1「換一組」：呼叫 AI 生成新情境碎片並抽換畫面
 */
async function handleShuffleL1() {
  const shuffleBtn = writing$('btn-shuffle-l1');
  if (isShufflingL1) return;

  if (typeof generateWritingPromptsAPI !== 'function') {
    alert('動態生成功能尚未載入，請重新整理頁面。');
    return;
  }

  isShufflingL1 = true;
  const originalLabel = shuffleBtn ? shuffleBtn.textContent : '🔄 換一組';

  if (shuffleBtn) {
    shuffleBtn.disabled = true;
    shuffleBtn.textContent = '⏳ 生成中...';
  }

  try {
    const prompts = await generateWritingPromptsAPI('l1', getWritingSubjectName());
    renderL1ScenarioChips(prompts);

    // 清空輸入與結果，避免舊情境殘留
    const textarea = writing$('user-input');
    if (textarea) textarea.value = '';
    resetL1ResultArea();

    if (typeof showToast === 'function') {
      showToast('✅ 已換一組新情境！');
    }
  } catch (error) {
    alert(error.message || '換一組失敗，請稍後再試。');
  } finally {
    isShufflingL1 = false;
    if (shuffleBtn) {
      shuffleBtn.disabled = false;
      shuffleBtn.textContent = originalLabel;
    }
  }
}

/**
 * 將 API 回傳的句型資料轉成 L2_PATTERNS 物件（與預設格式一致）
 * @param {{label:string,blanks:number,placeholders:string[]}|string} prompt
 * @param {number} index
 * @returns {{id: string, label: string, blanks: number, placeholders: string[]}}
 */
function buildL2PatternFromLabel(prompt, index) {
  // 新格式：已含 blanks / placeholders
  if (prompt && typeof prompt === 'object' && prompt.label) {
    const label = String(prompt.label).replace(/_{2,}/g, '___');
    const blanks =
      typeof prompt.blanks === 'number' && prompt.blanks > 0
        ? prompt.blanks
        : (label.match(/___/g) || []).length || 1;

    const placeholders = Array.isArray(prompt.placeholders)
      ? prompt.placeholders.slice(0, blanks)
      : [];

    while (placeholders.length < blanks) {
      placeholders.push(`blank ${placeholders.length + 1}`);
    }

    return {
      id: `ai-l2-${Date.now()}-${index}`,
      label,
      blanks,
      placeholders
    };
  }

  // 舊格式相容：純字串
  const label = String(prompt || '').replace(/_{2,}/g, '___');
  const blanks = (label.match(/___/g) || []).length || 1;
  const placeholders = Array.from({ length: blanks }, (_, i) => `blank ${i + 1}`);

  return {
    id: `ai-l2-${Date.now()}-${index}`,
    label,
    blanks,
    placeholders
  };
}

/**
 * 以目前 L2_PATTERNS 重填下拉選單並渲染填空
 */
function refreshL2PatternSelect() {
  const select = writing$('l2-pattern-select');
  if (!select) return;

  select.innerHTML = '';
  L2_PATTERNS.forEach((pattern) => {
    const option = document.createElement('option');
    option.value = pattern.id;
    option.textContent = pattern.label;
    select.appendChild(option);
  });

  renderL2Blanks();
}

/**
 * L2「換一組」：呼叫 AI 生成新句型並抽換下拉選單
 */
async function handleShuffleL2() {
  const shuffleBtn = writing$('btn-shuffle-l2');
  if (isShufflingL2) return;

  if (typeof generateWritingPromptsAPI !== 'function') {
    alert('動態生成功能尚未載入，請重新整理頁面。');
    return;
  }

  isShufflingL2 = true;
  const originalLabel = shuffleBtn ? shuffleBtn.textContent : '🔄 換一組';

  if (shuffleBtn) {
    shuffleBtn.disabled = true;
    shuffleBtn.textContent = '⏳ 生成中...';
  }

  try {
    const prompts = await generateWritingPromptsAPI('l2', getWritingSubjectName());
    L2_PATTERNS = prompts.map((label, index) => buildL2PatternFromLabel(label, index));
    refreshL2PatternSelect();
    resetL2ResultArea();

    if (typeof showToast === 'function') {
      showToast('✅ 已換一組新句型！');
    }
  } catch (error) {
    alert(error.message || '換一組失敗，請稍後再試。');
  } finally {
    isShufflingL2 = false;
    if (shuffleBtn) {
      shuffleBtn.disabled = false;
      shuffleBtn.textContent = originalLabel;
    }
  }
}

function resetL1ResultArea() {
  writingHide(writing$('loading-skeleton'));
  writingHide(writing$('result-card'));
  writingHide(writing$('error-message'));
}

function showL1Error(message) {
  const errorEl = writing$('error-message');
  if (errorEl) {
    errorEl.textContent = `❌ ${message}`;
    writingShow(errorEl);
  }
}

async function displayL1Result(result) {
  const resultCard = writing$('result-card');
  const encouragementEl = writing$('result-encouragement');
  const sentenceEl = writing$('result-sentence-en');
  const translationEl = writing$('result-translation');

  if (encouragementEl) encouragementEl.textContent = result.encouragement_zh;
  writingShow(resultCard);

  if (sentenceEl) await writingTypewriter(sentenceEl, result.completed_sentence_en);
  if (translationEl) await writingTypewriter(translationEl, result.translation_zh, 30);
}

async function handleL1Submit() {
  const textarea = writing$('user-input');
  const submitBtn = writing$('btn-submit');
  const userText = textarea ? textarea.value.trim() : '';

  if (!userText) {
    alert('請先輸入一些英文碎片，或點選一個情境標籤。');
    return;
  }

  resetL1ResultArea();
  writingShow(writing$('loading-skeleton'));

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '思考中...';
  }

  try {
    const result = await callDeepSeekAPI(userText);
    writingHide(writing$('loading-skeleton'));
    await displayL1Result(result);
  } catch (error) {
    writingHide(writing$('loading-skeleton'));
    showL1Error(error.message || '發生未知錯誤，請稍後再試。');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '送出給 AI';
    }
  }
}

/* ============================================================
   L2：句型填空
   ============================================================ */

/**
 * 依目前選中的句型，渲染填空 input
 */
function renderL2Blanks() {
  const select = writing$('l2-pattern-select');
  const blanksEl = writing$('l2-blanks');
  const previewEl = writing$('l2-pattern-preview');
  if (!select || !blanksEl) return;

  const pattern = L2_PATTERNS.find((p) => p.id === select.value) || L2_PATTERNS[0];
  if (previewEl) previewEl.textContent = pattern.label;

  blanksEl.innerHTML = '';

  for (let i = 0; i < pattern.blanks; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'l2-blank-item';

    const label = document.createElement('label');
    label.className = 'label-text';
    label.setAttribute('for', `l2-blank-${i}`);
    label.textContent = `空格 ${i + 1}（${pattern.placeholders[i] || '填空'}）：`;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `l2-blank-${i}`;
    input.className = 'l2-blank-input';
    input.placeholder = pattern.placeholders[i] || '';
    input.autocomplete = 'off';

    wrap.appendChild(label);
    wrap.appendChild(input);
    blanksEl.appendChild(wrap);
  }
}

function initL2PatternSelect() {
  const select = writing$('l2-pattern-select');
  if (!select) return;

  select.innerHTML = '';
  L2_PATTERNS.forEach((pattern) => {
    const option = document.createElement('option');
    option.value = pattern.id;
    option.textContent = pattern.label;
    select.appendChild(option);
  });

  select.addEventListener('change', () => {
    resetL2ResultArea();
    renderL2Blanks();
  });

  renderL2Blanks();
}

function resetL2ResultArea() {
  writingHide(writing$('l2-loading'));
  writingHide(writing$('l2-result-card'));
  writingHide(writing$('l2-error'));
}

function showL2Error(message) {
  const errorEl = writing$('l2-error');
  if (errorEl) {
    errorEl.textContent = `❌ ${message}`;
    writingShow(errorEl);
  }
}

/**
 * 顯示 L2 批改結果
 * @param {{corrected_sentence: string, issues: string[], grammar_tip_zh: string}} result
 */
async function displayL2Result(result) {
  const resultCard = writing$('l2-result-card');
  const correctedEl = writing$('l2-corrected');
  const issuesEl = writing$('l2-issues');
  const tipEl = writing$('l2-grammar-tip');

  if (issuesEl) {
    issuesEl.innerHTML = '';
    if (result.issues.length === 0) {
      const li = document.createElement('li');
      li.textContent = '沒有明顯錯誤，寫得很好！';
      issuesEl.appendChild(li);
    } else {
      result.issues.forEach((issue) => {
        const li = document.createElement('li');
        li.textContent = issue;
        issuesEl.appendChild(li);
      });
    }
  }

  writingShow(resultCard);

  if (correctedEl) await writingTypewriter(correctedEl, result.corrected_sentence);
  if (tipEl) await writingTypewriter(tipEl, result.grammar_tip_zh, 30);
}

async function handleL2Submit() {
  const select = writing$('l2-pattern-select');
  const submitBtn = writing$('btn-l2-submit');
  if (!select) return;

  const pattern = L2_PATTERNS.find((p) => p.id === select.value) || L2_PATTERNS[0];
  const answers = [];

  for (let i = 0; i < pattern.blanks; i++) {
    const input = writing$(`l2-blank-${i}`);
    const value = input ? input.value.trim() : '';
    if (!value) {
      alert(`請填寫空格 ${i + 1}。`);
      if (input) input.focus();
      return;
    }
    answers.push(value);
  }

  const filledSentence = fillPatternSentence(pattern.label, answers);

  resetL2ResultArea();
  writingShow(writing$('l2-loading'));

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '批改中...';
  }

  try {
    const result = await callL2WritingAPI(pattern.label, filledSentence, answers);
    writingHide(writing$('l2-loading'));
    await displayL2Result(result);
  } catch (error) {
    writingHide(writing$('l2-loading'));
    showL2Error(error.message || '發生未知錯誤，請稍後再試。');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '送出給 AI';
    }
  }
}

/* ============================================================
   L3：個案紀錄三版本 Tabs
   ============================================================ */

const L3_TAB_META = {
  grammar: {
    label: '文法正確的日常版',
    key: 'grammar_version'
  },
  professional: {
    label: '專業客觀的社工紀錄版（Case Notes）',
    key: 'professional_version'
  },
  empathy: {
    label: '同理心溝通版（對案主講的話）',
    key: 'empathy_version'
  }
};

function resetL3ResultArea() {
  writingHide(writing$('l3-loading'));
  writingHide(writing$('l3-result-card'));
  writingHide(writing$('l3-error'));
  l3ResultData = null;
}

function showL3Error(message) {
  const errorEl = writing$('l3-error');
  if (errorEl) {
    errorEl.textContent = `❌ ${message}`;
    writingShow(errorEl);
  }
}

/**
 * 切換 L3 結果內部 Tab，並以打字機顯示對應版本
 * @param {'grammar'|'professional'|'empathy'} tabKey
 * @param {boolean} animate
 */
async function switchL3ResultTab(tabKey, animate = true) {
  if (!l3ResultData) return;

  const meta = L3_TAB_META[tabKey];
  if (!meta) return;

  const tabsContainer = document.querySelector('.l3-result-tabs');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.l3-tab-btn').forEach((btn) => {
      const isActive = btn.dataset.l3Tab === tabKey;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
  }

  const labelEl = writing$('l3-version-label');
  const textEl = writing$('l3-version-text');
  const versionText = l3ResultData[meta.key] || '';

  if (labelEl) labelEl.textContent = meta.label;

  if (textEl) {
    if (animate) {
      await writingTypewriter(textEl, versionText, 25);
    } else {
      textEl.textContent = versionText;
    }
  }
}

/**
 * 綁定 L3 結果 Tabs
 */
function initL3ResultTabs() {
  const tabsContainer = document.querySelector('.l3-result-tabs');
  if (!tabsContainer) return;

  tabsContainer.addEventListener('click', (event) => {
    const btn = event.target.closest('.l3-tab-btn');
    if (!btn || !l3ResultData) return;
    const tabKey = btn.dataset.l3Tab;
    if (tabKey) switchL3ResultTab(tabKey, true);
  });
}

/**
 * 顯示 L3 批改結果（預設顯示日常版 Tab）
 * @param {{grammar_version: string, professional_version: string, empathy_version: string, explanation_zh: string}} result
 */
async function displayL3Result(result) {
  l3ResultData = result;

  const resultCard = writing$('l3-result-card');
  const explanationEl = writing$('l3-explanation');

  writingShow(resultCard);

  // 先顯示說明（不需等打字機），再切到日常版並打字
  if (explanationEl) explanationEl.textContent = result.explanation_zh;

  await switchL3ResultTab('grammar', true);
}

async function handleL3Submit() {
  const textarea = writing$('l3-input');
  const submitBtn = writing$('btn-l3-submit');
  const caseNotes = textarea ? textarea.value.trim() : '';

  if (!caseNotes) {
    alert('請先輸入一段個案紀錄再送出。');
    return;
  }

  if (caseNotes.length < 20) {
    alert('內容太短了，請多寫幾句完整的個案紀錄。');
    return;
  }

  resetL3ResultArea();
  writingShow(writing$('l3-loading'));

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '批改中...';
  }

  try {
    const result = await callL3WritingAPI(caseNotes);
    writingHide(writing$('l3-loading'));
    await displayL3Result(result);
  } catch (error) {
    writingHide(writing$('l3-loading'));
    showL3Error(error.message || '發生未知錯誤，請稍後再試。');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '送出給 AI 批改';
    }
  }
}

/* ============================================================
   初始化
   ============================================================ */

/**
 * 初始化寫作模組（由 app.js 在 DOMContentLoaded 時呼叫）
 */
function initWritingModule() {
  initWritingLevelSwitch();
  initScenarioChips();
  initL2PatternSelect();
  initL3ResultTabs();

  writing$('btn-submit')?.addEventListener('click', handleL1Submit);
  writing$('btn-l2-submit')?.addEventListener('click', handleL2Submit);
  writing$('btn-l3-submit')?.addEventListener('click', handleL3Submit);
  writing$('btn-shuffle-l1')?.addEventListener('click', handleShuffleL1);
  writing$('btn-shuffle-l2')?.addEventListener('click', handleShuffleL2);

  // 預設顯示 L1
  switchWritingLevel('l1');
}

window.initWritingModule = initWritingModule;
