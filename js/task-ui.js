/**
 * task-ui.js — L3 臨床督導實務紀錄表（Observation / Assessment / Intervention）
 *
 * 職責：
 * 1. 管理表格化填寫 UI 與科目專屬 placeholder
 * 2. 注入／顯示 AI 客製化引導（#task-instruction）
 * 3. 「發送給督導 (Submit)」為寫作批改的唯一 API 觸發點
 * 4. 提供文章庫免 AI 再練習用的表單區塊建立器
 */

/* ============================================================
   欄位定義
   ============================================================ */

const CLINICAL_FIELD_IDS = {
  observation: 'clinical-field-observation',
  assessment: 'clinical-field-assessment',
  intervention: 'clinical-field-intervention'
};

const CLINICAL_FIELD_CLASSES = {
  observation: 'clinical-field-observation',
  assessment: 'clinical-field-assessment',
  intervention: 'clinical-field-intervention'
};

const DEFAULT_PLACEHOLDERS = {
  observation: '案主的具體行為、語氣或環境細節為何？',
  assessment: '結合理論（如：三角關係／復元模式），你的專業評估是？',
  intervention: '你打算如何回應？請嘗試撰寫你的介入對話。'
};

/** 督導批改 System Prompt（Submit 唯一 API 路徑） */
const CLINICAL_SUPERVISION_SYSTEM_PROMPT =
  '你是一位社工督導，請針對學生撰寫的實務紀錄給予回饋，重點修正其英文文法與學術用詞，並給出臨床建議。\n\n' +
  '學生以 Observation／Assessment／Intervention 三欄完成臨床實務紀錄表。' +
  '請根據「個案文章（背景 Context）、任務提示、學生三欄英文答案」給予回饋。\n\n' +
  '回饋重點：\n' +
  '1. 對 Observation／Assessment／Intervention 各自評語：肯定可取之處，指出盲點、風險、倫理或理論應用不足。\n' +
  '2. 重點修正英文文法與學術／社工用詞（Vocab Correction）。\n' +
  '3. 給予可操作的臨床建議；Intervention 可附 1 句英文示範對話（若合適）。\n' +
  '4. 語氣像督導面談：直接、具體、親切鼓勵；禁止只說「很好」或複述文章。\n\n' +
  '請以 JSON 回傳：\n' +
  '{\n' +
  '  "feedback_zh": "繁體中文總評（約 80–160 字）",\n' +
  '  "feedback_en": "Optional short English coaching note (2–4 sentences)",\n' +
  '  "field_feedback": {\n' +
  '    "observation": "對 Observation 的繁體中文評語",\n' +
  '    "assessment": "對 Assessment 的繁體中文評語",\n' +
  '    "intervention": "對 Intervention 的繁體中文評語"\n' +
  '  },\n' +
  '  "vocab_corrections": [\n' +
  '    {\n' +
  '      "original": "學生用詞或片語",\n' +
  '      "suggestion": "更合適的學術／社工英文",\n' +
  '      "note": "一句簡短說明（繁中或英皆可）"\n' +
  '    }\n' +
  '  ]\n' +
  '}';

/* ============================================================
   科目知識 → 提示詞
   ============================================================ */

/**
 * 從科目知識庫組出理論提示片段（供 placeholder／fallback 引導）
 * @param {Object|null} knowledge
 * @returns {{theoryHint: string, theoryCore: string, concepts: string[]}}
 */
function extractTheoryHint(knowledge) {
  const concepts = Array.isArray(knowledge?.key_concepts)
    ? knowledge.key_concepts.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  const theoryCore = String(knowledge?.theory_core || '').trim();

  let theoryHint = concepts.slice(0, 2).join('／');
  if (!theoryHint && theoryCore) {
    theoryHint = theoryCore.split(/[、,，]/)[0].trim();
  }
  if (!theoryHint) theoryHint = '相關理論';

  return { theoryHint, theoryCore, concepts };
}

/**
 * 依科目知識庫動態產生三欄 placeholder
 * @param {Object|null} knowledge
 * @returns {{observation: string, assessment: string, intervention: string}}
 */
function buildSubjectFieldPlaceholders(knowledge) {
  const { theoryHint } = extractTheoryHint(knowledge);
  return {
    observation: DEFAULT_PLACEHOLDERS.observation,
    assessment: `結合理論（如：${theoryHint}），你的專業評估是？`,
    intervention: DEFAULT_PLACEHOLDERS.intervention
  };
}

/**
 * 若 AI 未回傳 guidance，依知識庫組一段親切引導
 * @param {Object|null} knowledge
 * @param {string} [subjectName]
 * @returns {string}
 */
function buildFallbackGuidance(knowledge, subjectName) {
  const name = String(subjectName || knowledge?.name || '目前科目').trim();
  const { theoryHint, theoryCore, concepts } = extractTheoryHint(knowledge);
  const focus = concepts[0] || theoryHint;

  if (theoryCore) {
    return `請運用「${focus}」觀點（參考：${theoryCore}），以 Observation → Assessment → Intervention 完成這份實務紀錄。科目：${name}。`;
  }
  return `請以 Observation → Assessment → Intervention 完成這份實務紀錄，並盡量連結「${focus}」。科目：${name}。`;
}

/**
 * 組出收藏用的 task_instruction 字串
 * @param {{
 *   task_instruction?: string,
 *   guidance_zh?: string,
 *   task_zh?: string,
 *   task_en?: string
 * }} data
 * @returns {string}
 */
function buildStoredTaskInstruction(data) {
  return String(
    data?.task_instruction ||
      data?.guidance_zh ||
      data?.task_zh ||
      data?.task_en ||
      ''
  ).trim();
}

/* ============================================================
   DOM 操作
   ============================================================ */

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function clinical$(id) {
  return document.getElementById(id);
}

/**
 * 在 root 內查詢（無 root 則用 document）
 * @param {ParentNode|null|undefined} root
 * @param {string} selector
 * @returns {Element|null}
 */
function clinicalQuery(root, selector) {
  const scope = root && typeof root.querySelector === 'function' ? root : document;
  return scope.querySelector(selector);
}

/**
 * 將 AI／科目引導寫入 #task-instruction（或 scoped .task-instruction）
 * @param {string} text
 * @param {ParentNode|null} [root]
 */
function setTaskInstruction(text, root) {
  const el =
    clinicalQuery(root, '#task-instruction') ||
    clinicalQuery(root, '.task-instruction') ||
    clinical$('task-instruction');
  if (!el) return;
  el.textContent = String(text || '').trim();
}

/**
 * 依科目知識更新三個 textarea 的 placeholder
 * @param {Object|null} knowledge
 * @param {ParentNode|null} [root]
 */
function applySubjectPlaceholders(knowledge, root) {
  const placeholders = buildSubjectFieldPlaceholders(knowledge);
  Object.keys(CLINICAL_FIELD_IDS).forEach((key) => {
    const el =
      clinicalQuery(root, `#${CLINICAL_FIELD_IDS[key]}`) ||
      clinicalQuery(root, `.${CLINICAL_FIELD_CLASSES[key]}`) ||
      clinical$(CLINICAL_FIELD_IDS[key]);
    if (el) el.placeholder = placeholders[key];
  });
}

/**
 * 讀取表格三欄位（trim 後）；可指定 scoped root（文章庫動態表單）
 * @param {ParentNode|null} [root]
 * @returns {{observation: string, assessment: string, intervention: string}}
 */
function getClinicalTaskAnswers(root) {
  const readField = (key) => {
    const el =
      clinicalQuery(root, `#${CLINICAL_FIELD_IDS[key]}`) ||
      clinicalQuery(root, `.${CLINICAL_FIELD_CLASSES[key]}`) ||
      clinical$(CLINICAL_FIELD_IDS[key]);
    return String(el?.value || '').trim();
  };

  return {
    observation: readField('observation'),
    assessment: readField('assessment'),
    intervention: readField('intervention')
  };
}

/**
 * 是否三欄皆為空
 * @param {{observation?: string, assessment?: string, intervention?: string}} answers
 * @returns {boolean}
 */
function isClinicalTaskEmpty(answers) {
  const a = answers || getClinicalTaskAnswers();
  return !a.observation && !a.assessment && !a.intervention;
}

/**
 * 重置表格與回饋區
 * @param {ParentNode|null} [root]
 */
function resetClinicalTaskForm(root) {
  Object.keys(CLINICAL_FIELD_IDS).forEach((key) => {
    const el =
      clinicalQuery(root, `#${CLINICAL_FIELD_IDS[key]}`) ||
      clinicalQuery(root, `.${CLINICAL_FIELD_CLASSES[key]}`) ||
      clinical$(CLINICAL_FIELD_IDS[key]);
    if (el) {
      el.value = '';
      el.disabled = false;
    }
  });

  const submitBtn =
    clinicalQuery(root, '#btn-submit-task') ||
    clinicalQuery(root, '.btn-submit-clinical-task') ||
    clinical$('btn-submit-task') ||
    clinical$('btn-l3-submit-supervisor');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = '發送給督導 (Submit)';
  }

  setTaskInstruction('', root);
  clearClinicalFeedback(root);
}

/**
 * 啟用／停用表格欄位
 * @param {boolean} disabled
 * @param {ParentNode|null} [root]
 */
function setClinicalTaskFormDisabled(disabled, root) {
  Object.keys(CLINICAL_FIELD_IDS).forEach((key) => {
    const el =
      clinicalQuery(root, `#${CLINICAL_FIELD_IDS[key]}`) ||
      clinicalQuery(root, `.${CLINICAL_FIELD_CLASSES[key]}`) ||
      clinical$(CLINICAL_FIELD_IDS[key]);
    if (el) el.disabled = Boolean(disabled);
  });
}

/**
 * 清空督導回饋渲染區
 * @param {ParentNode|null} [root]
 */
function clearClinicalFeedback(root) {
  const box =
    clinicalQuery(root, '.l3-supervision-feedback') ||
    clinical$('l3-supervision-feedback');
  const zh =
    clinicalQuery(root, '.l3-feedback-zh') || clinical$('l3-feedback-zh');
  const en =
    clinicalQuery(root, '.l3-feedback-en') || clinical$('l3-feedback-en');
  const fields =
    clinicalQuery(root, '.l3-field-feedback') || clinical$('l3-field-feedback');
  const vocab =
    clinicalQuery(root, '.l3-vocab-corrections') ||
    clinical$('l3-vocab-corrections');

  if (box) box.classList.add('hidden');
  if (zh) zh.textContent = '';
  if (en) {
    en.textContent = '';
    en.classList.add('hidden');
  }
  if (fields) {
    fields.innerHTML = '';
    fields.classList.add('hidden');
  }
  if (vocab) {
    vocab.innerHTML = '';
    vocab.classList.add('hidden');
  }
}

/**
 * 渲染分欄督導回饋＋詞彙修正
 * @param {{
 *   feedback_zh?: string,
 *   feedback_en?: string,
 *   field_feedback?: {observation?: string, assessment?: string, intervention?: string},
 *   vocab_corrections?: Array<{original?: string, suggestion?: string, note?: string}>
 * }} result
 * @param {ParentNode|null} [root]
 */
function renderStructuredSupervisionFeedback(result, root) {
  const box =
    clinicalQuery(root, '.l3-supervision-feedback') ||
    clinical$('l3-supervision-feedback');
  const zh =
    clinicalQuery(root, '.l3-feedback-zh') || clinical$('l3-feedback-zh');
  const en =
    clinicalQuery(root, '.l3-feedback-en') || clinical$('l3-feedback-en');
  const fieldsEl =
    clinicalQuery(root, '.l3-field-feedback') || clinical$('l3-field-feedback');
  const vocabEl =
    clinicalQuery(root, '.l3-vocab-corrections') ||
    clinical$('l3-vocab-corrections');

  if (zh) zh.textContent = result?.feedback_zh || '';
  if (en) {
    const enText = String(result?.feedback_en || '').trim();
    en.textContent = enText;
    en.classList.toggle('hidden', !enText);
  }

  const fieldLabels = {
    observation: 'Observation 觀察',
    assessment: 'Assessment 評估',
    intervention: 'Intervention 介入'
  };
  const fieldFeedback = result?.field_feedback && typeof result.field_feedback === 'object'
    ? result.field_feedback
    : null;

  if (fieldsEl) {
    fieldsEl.innerHTML = '';
    if (fieldFeedback) {
      const parts = ['observation', 'assessment', 'intervention']
        .map((key) => {
          const text = String(fieldFeedback[key] || '').trim();
          if (!text) return '';
          return (
            `<div class="l3-field-feedback-item">` +
            `<span class="l3-field-feedback-label">${fieldLabels[key]}</span>` +
            `<p class="l3-field-feedback-text">${escapeHtml(text)}</p>` +
            `</div>`
          );
        })
        .filter(Boolean);

      if (parts.length) {
        fieldsEl.innerHTML =
          `<span class="result-label">分欄評語</span>${parts.join('')}`;
        fieldsEl.classList.remove('hidden');
      } else {
        fieldsEl.classList.add('hidden');
      }
    } else {
      fieldsEl.classList.add('hidden');
    }
  }

  const corrections = Array.isArray(result?.vocab_corrections)
    ? result.vocab_corrections
    : [];

  if (vocabEl) {
    vocabEl.innerHTML = '';
    const items = corrections
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const original = String(item.original || '').trim();
        const suggestion = String(item.suggestion || '').trim();
        const note = String(item.note || '').trim();
        if (!original && !suggestion) return '';
        return (
          `<li class="l3-vocab-item">` +
          `<span class="l3-vocab-original">${escapeHtml(original || '—')}</span>` +
          `<span class="l3-vocab-arrow" aria-hidden="true">→</span>` +
          `<span class="l3-vocab-suggestion">${escapeHtml(suggestion || '—')}</span>` +
          (note ? `<span class="l3-vocab-note">${escapeHtml(note)}</span>` : '') +
          `</li>`
        );
      })
      .filter(Boolean);

    if (items.length) {
      vocabEl.innerHTML =
        `<span class="result-label">Vocab Correction 學術詞彙修正</span>` +
        `<ul class="l3-vocab-list">${items.join('')}</ul>`;
      vocabEl.classList.remove('hidden');
    } else {
      vocabEl.classList.add('hidden');
    }
  }

  if (box) box.classList.remove('hidden');
}

/**
 * 簡易 HTML 跳脫（避免 AI 回傳破壞 DOM）
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 依目前科目套用 placeholder，並決定要顯示的引導文字
 * @param {{
 *   guidance_zh?: string,
 *   task_zh?: string,
 *   task_en?: string,
 *   task_instruction?: string,
 *   knowledge?: Object|null,
 *   subjectName?: string,
 *   root?: ParentNode|null
 * }} options
 */
function hydrateClinicalTaskForm(options) {
  const knowledge = options?.knowledge || null;
  const root = options?.root || null;
  applySubjectPlaceholders(knowledge, root);

  const guidance =
    String(options?.task_instruction || '').trim() ||
    String(options?.guidance_zh || '').trim() ||
    String(options?.task_zh || '').trim() ||
    buildFallbackGuidance(knowledge, options?.subjectName);

  setTaskInstruction(guidance, root);
}

/**
 * 解析督導 JSON 回傳
 * @param {string} rawContent
 * @returns {{
 *   feedback_zh: string,
 *   feedback_en: string,
 *   field_feedback: {observation: string, assessment: string, intervention: string},
 *   vocab_corrections: Array<{original: string, suggestion: string, note: string}>
 * }}
 */
function parseSupervisionFeedbackPayload(rawContent) {
  let result;
  try {
    result = JSON.parse(String(rawContent || '').trim());
  } catch (_) {
    throw new Error('AI 回傳的 JSON 格式有誤，請再試一次。');
  }

  const feedback_zh = String(result.feedback_zh || '').trim();
  const feedback_en = String(result.feedback_en || '').trim();

  if (!feedback_zh && !feedback_en) {
    throw new Error('AI 回傳資料不完整，缺少督導回饋。');
  }

  const rawFields =
    result.field_feedback && typeof result.field_feedback === 'object'
      ? result.field_feedback
      : {};

  const field_feedback = {
    observation: String(rawFields.observation || '').trim(),
    assessment: String(rawFields.assessment || '').trim(),
    intervention: String(rawFields.intervention || '').trim()
  };

  const vocab_corrections = Array.isArray(result.vocab_corrections)
    ? result.vocab_corrections
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const original = String(item.original || '').trim();
          const suggestion = String(item.suggestion || '').trim();
          const note = String(item.note || '').trim();
          if (!original && !suggestion) return null;
          return { original, suggestion, note };
        })
        .filter(Boolean)
    : [];

  return {
    feedback_zh: feedback_zh || feedback_en,
    feedback_en,
    field_feedback,
    vocab_corrections
  };
}

/**
 * 寫作批改：Submit 為唯一 API 觸發點
 * 收集文章 Context + O/A/I，呼叫 callDeepSeekChatAPI(..., 'standard', subjectId)
 *
 * @param {{
 *   root?: ParentNode|null,
 *   feedbackRoot?: ParentNode|null,
 *   articleEn: string,
 *   articleZh?: string,
 *   taskInstruction?: string,
 *   taskEn?: string,
 *   taskZh?: string,
 *   guidanceZh?: string,
 *   taskType?: string,
 *   subjectId?: string|null,
 *   answers?: {observation?: string, assessment?: string, intervention?: string}|null,
 *   loadingEl?: HTMLElement|null,
 *   onError?: (message: string) => void
 * }} options
 * @returns {Promise<object|null>}
 */
async function submitClinicalTaskToSupervisor(options) {
  const root = options?.root || null;
  const feedbackRoot = options?.feedbackRoot || root || null;
  const articleEn = String(options?.articleEn || '').trim();
  const articleZh = String(options?.articleZh || '').trim();
  const taskInstruction = String(
    options?.taskInstruction || options?.guidanceZh || ''
  ).trim();
  const taskEn = String(options?.taskEn || '').trim();
  const taskZh = String(options?.taskZh || '').trim();
  const taskType = String(options?.taskType || '').trim();

  const reportError = (message) => {
    if (typeof options?.onError === 'function') {
      options.onError(message);
    } else if (typeof showToast === 'function') {
      showToast(`❌ ${message}`);
    } else {
      alert(message);
    }
  };

  if (!articleEn) {
    reportError('缺少個案文章，無法請督導批改。');
    return null;
  }

  const clinicalAnswers =
    options?.answers || getClinicalTaskAnswers(root);

  if (isClinicalTaskEmpty(clinicalAnswers)) {
    reportError('請至少填寫一個欄位再送出給督導。');
    return null;
  }

  const apiFn =
    typeof callDeepSeekChatAPI === 'function'
      ? callDeepSeekChatAPI
      : typeof window.callDeepSeekChatAPI === 'function'
        ? window.callDeepSeekChatAPI
        : null;

  if (!apiFn) {
    reportError('AI 模組尚未載入，請強制重新整理頁面（Ctrl+F5）後再試。');
    return null;
  }

  let subjectId =
    options?.subjectId != null && String(options.subjectId).trim() !== ''
      ? String(options.subjectId).trim()
      : null;

  if (!subjectId && typeof resolveCurrentSubject === 'function') {
    subjectId = resolveCurrentSubject().id || null;
  }

  const subjectName =
    typeof window.getCurrentSubjectName === 'function'
      ? window.getCurrentSubjectName()
      : (typeof resolveCurrentSubject === 'function'
        ? resolveCurrentSubject().name
        : '社會工作');

  const submitBtn =
    clinicalQuery(root, '#btn-submit-task') ||
    clinicalQuery(root, '.btn-submit-clinical-task') ||
    clinical$('btn-submit-task') ||
    clinical$('btn-l3-submit-supervisor');
  const loadingEl = options?.loadingEl || null;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '督導批改中...';
  }
  setClinicalTaskFormDisabled(true, root);
  clearClinicalFeedback(feedbackRoot);
  if (loadingEl) loadingEl.classList.remove('hidden');

  const answersJson = JSON.stringify(clinicalAnswers, null, 2);
  const userContent =
    `科目：${subjectName || '社會工作'}\n` +
    `任務類型：${taskType || '（未標示）'}\n\n` +
    `【個案文章（背景 Context）】\n${articleEn}` +
    (articleZh ? `\n\n（中文參考）\n${articleZh}` : '') +
    `\n\n【任務提示 task_instruction】\n${taskInstruction || taskZh || taskEn || '（無）'}` +
    (taskEn ? `\n\n【英文任務】\n${taskEn}` : '') +
    (taskZh && taskZh !== taskInstruction ? `\n\n【中文任務】\n${taskZh}` : '') +
    `\n\n【學生實務紀錄表 Observation / Assessment / Intervention（JSON）】\n${answersJson}\n\n` +
    `請重點修正英文文法與學術用詞，並給出臨床建議與分欄評語。`;

  const messages = [
    { role: 'system', content: CLINICAL_SUPERVISION_SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ];

  try {
    // Phase 11.7：Submit 唯一 API；使用 standard 路由（flash）
    const rawContent = await apiFn(messages, 'standard', subjectId, {
      maxTokens: 4096,
      temperature: 0.7,
      jsonObject: true
    });

    const result = parseSupervisionFeedbackPayload(rawContent);
    renderStructuredSupervisionFeedback(result, feedbackRoot);

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '再次請督導批改';
    }
    setClinicalTaskFormDisabled(false, root);
    return result;
  } catch (error) {
    reportError(error?.message || '取得督導回饋失敗，請稍後再試。');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '發送給督導 (Submit)';
    }
    setClinicalTaskFormDisabled(false, root);
    return null;
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

/**
 * 建立文章庫用的「臨床督導實務紀錄表」區塊（空白表單 + 已存 task_instruction）
 * 開啟時不呼叫文章生成 API；僅 Submit 才打督導批改 API。
 *
 * @param {{
 *   articleEn: string,
 *   articleZh?: string,
 *   taskInstruction?: string,
 *   taskEn?: string,
 *   taskZh?: string,
 *   guidanceZh?: string,
 *   taskType?: string,
 *   subjectId?: string|null,
 *   knowledge?: Object|null,
 *   subjectName?: string,
 *   onError?: (message: string) => void
 * }} options
 * @returns {HTMLElement}
 */
function createClinicalTaskPracticeBlock(options) {
  const wrap = document.createElement('div');
  wrap.className = 'l3-challenge-task library-clinical-practice';

  const header = document.createElement('div');
  header.className = 'l3-challenge-header';
  header.innerHTML =
    '<span class="result-label">Clinical Challenge — 再次寫作練習（免 AI 生成文章）</span>';
  wrap.appendChild(header);

  const form = document.createElement('div');
  form.className = 'clinical-task-form card';
  form.innerHTML =
    '<h3 class="clinical-task-title">📝 臨床督導實務紀錄表</h3>' +
    '<p class="task-instruction hint-text"></p>' +
    '<table class="clinical-table">' +
    '<thead><tr><th scope="col">欄位</th><th scope="col">你的專業思考（請輸入英文）</th></tr></thead>' +
    '<tbody>' +
    '<tr><td><strong>Observation</strong></td><td>' +
    '<textarea class="user-textarea clinical-field-textarea clinical-field-observation" rows="3" ' +
    'placeholder="案主的具體行為、語氣或環境細節為何？"></textarea></td></tr>' +
    '<tr><td><strong>Assessment</strong></td><td>' +
    '<textarea class="user-textarea clinical-field-textarea clinical-field-assessment" rows="3" ' +
    'placeholder="結合理論（如：三角關係／復元模式），你的專業評估是？"></textarea></td></tr>' +
    '<tr><td><strong>Intervention</strong></td><td>' +
    '<textarea class="user-textarea clinical-field-textarea clinical-field-intervention" rows="3" ' +
    'placeholder="你打算如何回應？請嘗試撰寫你的介入對話。"></textarea></td></tr>' +
    '</tbody></table>' +
    '<button class="btn btn-primary primary-btn btn-submit-clinical-task" type="button">' +
    '發送給督導 (Submit)</button>';

  wrap.appendChild(form);

  const loadingEl = document.createElement('div');
  loadingEl.className = 'l3-supervision-loading hidden';
  loadingEl.setAttribute('aria-live', 'polite');
  loadingEl.innerHTML = '<p class="loading-text">督導正在閱讀你的實務紀錄…</p>';
  wrap.appendChild(loadingEl);

  const feedback = document.createElement('div');
  feedback.className = 'l3-supervision-feedback hidden';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.innerHTML =
    '<span class="result-label">督導回饋 (Supervision Feedback)</span>' +
    '<p class="l3-feedback-zh"></p>' +
    '<p class="l3-feedback-en hidden"></p>' +
    '<div class="l3-field-feedback hidden"></div>' +
    '<div class="l3-vocab-corrections hidden"></div>';
  wrap.appendChild(feedback);

  const instruction = buildStoredTaskInstruction({
    task_instruction: options?.taskInstruction,
    guidance_zh: options?.guidanceZh,
    task_zh: options?.taskZh,
    task_en: options?.taskEn
  });

  hydrateClinicalTaskForm({
    root: form,
    task_instruction: instruction,
    guidance_zh: options?.guidanceZh,
    task_zh: options?.taskZh,
    task_en: options?.taskEn,
    knowledge: options?.knowledge || null,
    subjectName: options?.subjectName
  });

  // 表格預設空白，供再次練習
  Object.keys(CLINICAL_FIELD_CLASSES).forEach((key) => {
    const el = form.querySelector(`.${CLINICAL_FIELD_CLASSES[key]}`);
    if (el) el.value = '';
  });

  const submitBtn = form.querySelector('.btn-submit-clinical-task');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      submitClinicalTaskToSupervisor({
        root: form,
        feedbackRoot: wrap,
        articleEn: options?.articleEn || '',
        articleZh: options?.articleZh || '',
        taskInstruction: instruction,
        taskEn: options?.taskEn || '',
        taskZh: options?.taskZh || '',
        guidanceZh: options?.guidanceZh || instruction,
        taskType: options?.taskType || '',
        subjectId: options?.subjectId || null,
        loadingEl,
        onError: options?.onError
      });
    });
  }

  return wrap;
}

/* ============================================================
   Phase 11.8：漸進式寫作（L1 填空／L2 造句／L3 表單）
   ============================================================ */

/**
 * 在掛載點渲染 L1/L2/L3 寫作切換區
 * @param {HTMLElement} mountEl
 * @param {Object} article - 互動文章（含 writing_tasks、track、task_instruction）
 */
function renderProgressiveWritingBlock(mountEl, article) {
  if (!mountEl || !article) return;

  mountEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'progressive-writing';
  wrap.innerHTML =
    '<h3 class="progressive-writing-title">✍️ 漸進式寫作練習</h3>' +
    '<div class="level-switch progressive-writing-switch" role="tablist" aria-label="寫作難度">' +
    '<button type="button" class="level-btn active" data-write-level="l1" role="tab" aria-selected="true">🌱 L1 填空</button>' +
    '<button type="button" class="level-btn" data-write-level="l2" role="tab" aria-selected="false">🌿 L2 造句</button>' +
    '<button type="button" class="level-btn" data-write-level="l3" role="tab" aria-selected="false">🌳 L3 專業寫作</button>' +
    '</div>' +
    '<div class="progressive-writing-panels"></div>';

  const panels = wrap.querySelector('.progressive-writing-panels');
  const panelL1 = document.createElement('div');
  panelL1.className = 'progressive-writing-panel';
  panelL1.dataset.writePanel = 'l1';
  panelL1.appendChild(buildL1ClozePanel(article.writing_tasks?.l1_cloze));

  const panelL2 = document.createElement('div');
  panelL2.className = 'progressive-writing-panel hidden';
  panelL2.dataset.writePanel = 'l2';
  panelL2.appendChild(buildL2SentencePanel(article.writing_tasks?.l2_sentence));

  const panelL3 = document.createElement('div');
  panelL3.className = 'progressive-writing-panel hidden';
  panelL3.dataset.writePanel = 'l3';
  panelL3.appendChild(buildL3WritingPanel(article));

  panels.appendChild(panelL1);
  panels.appendChild(panelL2);
  panels.appendChild(panelL3);

  const switchEl = wrap.querySelector('.progressive-writing-switch');
  switchEl?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-write-level]');
    if (!btn) return;
    const level = btn.getAttribute('data-write-level');
    switchEl.querySelectorAll('.level-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    panels.querySelectorAll('.progressive-writing-panel').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.writePanel !== level);
    });
  });

  mountEl.appendChild(wrap);
}

/**
 * @param {Object} cloze
 * @returns {HTMLElement}
 */
function buildL1ClozePanel(cloze) {
  const data = cloze && typeof cloze === 'object' ? cloze : {};
  const box = document.createElement('div');
  box.className = 'writing-l1-cloze card';

  const instruction = document.createElement('p');
  instruction.className = 'hint-text';
  instruction.textContent = data.instruction || '請填入適當的臨床/學術單字：';
  box.appendChild(instruction);

  if (data.sentence_zh) {
    const zh = document.createElement('p');
    zh.className = 'writing-l1-zh';
    zh.textContent = data.sentence_zh;
    box.appendChild(zh);
  }

  const template = document.createElement('p');
  template.className = 'writing-l1-template';
  template.textContent = data.sentence_en_template || '';
  box.appendChild(template);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'user-textarea writing-l1-input';
  input.placeholder = '在此輸入單字…';
  input.autocomplete = 'off';
  box.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = '檢查答案';
  box.appendChild(btn);

  const feedback = document.createElement('p');
  feedback.className = 'writing-check-feedback hidden';
  box.appendChild(feedback);

  btn.addEventListener('click', () => {
    const user = String(input.value || '').trim();
    const answer = String(data.answer || '').trim();
    if (!user) {
      feedback.textContent = '請先填寫答案。';
      feedback.classList.remove('hidden', 'is-correct', 'is-wrong');
      return;
    }
    const ok = user.toLowerCase() === answer.toLowerCase();
    feedback.classList.remove('hidden');
    feedback.classList.toggle('is-correct', ok);
    feedback.classList.toggle('is-wrong', !ok);
    feedback.textContent = ok
      ? '✅ 正確！'
      : `❌ 再想想。參考答案：${answer}`;
  });

  return box;
}

/**
 * @param {Object} sentenceTask
 * @returns {HTMLElement}
 */
function buildL2SentencePanel(sentenceTask) {
  const data = sentenceTask && typeof sentenceTask === 'object' ? sentenceTask : {};
  const box = document.createElement('div');
  box.className = 'writing-l2-sentence card';

  const instruction = document.createElement('p');
  instruction.className = 'hint-text';
  instruction.textContent =
    data.instruction || '請將以下內容翻譯成適當的英文：';
  box.appendChild(instruction);

  const prompt = document.createElement('p');
  prompt.className = 'writing-l2-prompt';
  prompt.textContent = data.prompt_zh || '';
  box.appendChild(prompt);

  const ta = document.createElement('textarea');
  ta.className = 'user-textarea writing-l2-input';
  ta.rows = 3;
  ta.placeholder = '請用英文寫出完整句子…';
  box.appendChild(ta);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = '對答案';
  box.appendChild(btn);

  const suggested = document.createElement('div');
  suggested.className = 'writing-l2-suggested hidden';
  suggested.innerHTML =
    '<span class="result-label">參考答案（自我校對）</span>' +
    `<p class="writing-l2-suggested-text"></p>`;
  box.appendChild(suggested);

  btn.addEventListener('click', () => {
    const textEl = suggested.querySelector('.writing-l2-suggested-text');
    if (textEl) textEl.textContent = data.suggested_answer || '（無參考答案）';
    suggested.classList.remove('hidden');
  });

  return box;
}

/**
 * L3：依 track 顯示 SOAP 或文獻反思表
 * @param {Object} article
 * @returns {HTMLElement}
 */
function buildL3WritingPanel(article) {
  const isLit = article?.track === 'literature';
  const wrap = document.createElement('div');
  wrap.className = 'writing-l3-panel';

  const articleEn =
    typeof buildPracticeArticleContext === 'function'
      ? buildPracticeArticleContext(article)
      : (Array.isArray(article?.content_chunks)
        ? article.content_chunks.map((c) => c.paragraph_en).join('\n\n')
        : '');

  const articleZh = Array.isArray(article?.content_chunks)
    ? article.content_chunks
        .map((c) => String(c.paragraph_zh || '').trim())
        .filter(Boolean)
        .join('\n\n')
    : '';

  let subjectId = article?.subjectId || null;
  let subjectName = article?.subjectName || '';
  if (!subjectId && typeof resolveCurrentSubject === 'function') {
    const s = resolveCurrentSubject();
    subjectId = s?.id || null;
    subjectName = subjectName || s?.name || '';
  }

  const knowledge =
    typeof getSubjectKnowledge === 'function' && subjectId
      ? getSubjectKnowledge(subjectId)
      : null;

  const instruction =
    buildStoredTaskInstruction(article) ||
    buildFallbackGuidance(knowledge, subjectName);

  const title = isLit
    ? '📝 學術文獻反思表'
    : '📝 臨床督導實務紀錄表 (SOAP)';

  const labels = isLit
    ? {
        observation: 'Observation 關鍵觀察',
        assessment: 'Critique 理論批判／評估',
        intervention: 'Application 實務應用'
      }
    : {
        observation: 'Observation',
        assessment: 'Assessment',
        intervention: 'Intervention'
      };

  const form = document.createElement('div');
  form.className = 'clinical-task-form card';
  form.innerHTML =
    `<h3 class="clinical-task-title">${title}</h3>` +
    `<p class="task-instruction hint-text"></p>` +
    '<table class="clinical-table"><thead><tr><th>欄位</th><th>你的專業思考（請輸入英文）</th></tr></thead><tbody>' +
    `<tr><td><strong>${labels.observation}</strong></td><td>` +
    '<textarea class="user-textarea clinical-field-textarea clinical-field-observation" rows="3"></textarea></td></tr>' +
    `<tr><td><strong>${labels.assessment}</strong></td><td>` +
    '<textarea class="user-textarea clinical-field-textarea clinical-field-assessment" rows="3"></textarea></td></tr>' +
    `<tr><td><strong>${labels.intervention}</strong></td><td>` +
    '<textarea class="user-textarea clinical-field-textarea clinical-field-intervention" rows="3"></textarea></td></tr>' +
    '</tbody></table>' +
    '<button class="btn btn-primary btn-submit-clinical-task" type="button">發送給督導 (Submit)</button>';

  wrap.appendChild(form);

  const loadingEl = document.createElement('div');
  loadingEl.className = 'l3-supervision-loading hidden';
  loadingEl.innerHTML = '<p class="loading-text">督導正在閱讀你的實務紀錄…</p>';
  wrap.appendChild(loadingEl);

  const feedback = document.createElement('div');
  feedback.className = 'l3-supervision-feedback hidden';
  feedback.setAttribute('role', 'status');
  feedback.innerHTML =
    '<span class="result-label">督導回饋 (Supervision Feedback)</span>' +
    '<p class="l3-feedback-zh"></p>' +
    '<p class="l3-feedback-en hidden"></p>' +
    '<div class="l3-field-feedback hidden"></div>' +
    '<div class="l3-vocab-corrections hidden"></div>';
  wrap.appendChild(feedback);

  hydrateClinicalTaskForm({
    root: form,
    task_instruction: instruction,
    knowledge,
    subjectName
  });

  form.querySelector('.btn-submit-clinical-task')?.addEventListener('click', () => {
    submitClinicalTaskToSupervisor({
      root: form,
      feedbackRoot: wrap,
      articleEn,
      articleZh,
      taskInstruction: instruction,
      taskType: isLit ? 'literature_reflection' : 'soap',
      subjectId,
      loadingEl,
      onError: (message) => {
        if (typeof showToast === 'function') showToast(`❌ ${message}`);
        else alert(message);
      }
    });
  });

  return wrap;
}

// 對外 API
window.buildSubjectFieldPlaceholders = buildSubjectFieldPlaceholders;
window.renderProgressiveWritingBlock = renderProgressiveWritingBlock;
window.buildFallbackGuidance = buildFallbackGuidance;
window.buildStoredTaskInstruction = buildStoredTaskInstruction;
window.setTaskInstruction = setTaskInstruction;
window.applySubjectPlaceholders = applySubjectPlaceholders;
window.getClinicalTaskAnswers = getClinicalTaskAnswers;
window.isClinicalTaskEmpty = isClinicalTaskEmpty;
window.resetClinicalTaskForm = resetClinicalTaskForm;
window.setClinicalTaskFormDisabled = setClinicalTaskFormDisabled;
window.clearClinicalFeedback = clearClinicalFeedback;
window.renderStructuredSupervisionFeedback = renderStructuredSupervisionFeedback;
window.hydrateClinicalTaskForm = hydrateClinicalTaskForm;
window.submitClinicalTaskToSupervisor = submitClinicalTaskToSupervisor;
window.createClinicalTaskPracticeBlock = createClinicalTaskPracticeBlock;
