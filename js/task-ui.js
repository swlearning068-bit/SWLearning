/**
 * task-ui.js — L3 臨床督導實務紀錄表（Observation / Assessment / Intervention）
 *
 * 職責：
 * 1. 管理表格化填寫 UI 與科目專屬 placeholder
 * 2. 注入／顯示 AI 客製化引導（#task-instruction）
 * 3. 打包三欄位為 JSON，並渲染督導分欄回饋＋詞彙修正
 */

/* ============================================================
   欄位定義
   ============================================================ */

const CLINICAL_FIELD_IDS = {
  observation: 'clinical-field-observation',
  assessment: 'clinical-field-assessment',
  intervention: 'clinical-field-intervention'
};

const DEFAULT_PLACEHOLDERS = {
  observation: '案主的具體行為、語氣或環境細節為何？',
  assessment: '結合理論（如：三角關係／復元模式），你的專業評估是？',
  intervention: '你打算如何回應？請嘗試撰寫你的介入對話。'
};

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
 * 將 AI／科目引導寫入 #task-instruction
 * @param {string} text
 */
function setTaskInstruction(text) {
  const el = clinical$('task-instruction');
  if (!el) return;
  el.textContent = String(text || '').trim();
}

/**
 * 依科目知識更新三個 textarea 的 placeholder
 * @param {Object|null} knowledge
 */
function applySubjectPlaceholders(knowledge) {
  const placeholders = buildSubjectFieldPlaceholders(knowledge);
  Object.keys(CLINICAL_FIELD_IDS).forEach((key) => {
    const el = clinical$(CLINICAL_FIELD_IDS[key]);
    if (el) el.placeholder = placeholders[key];
  });
}

/**
 * 讀取表格三欄位（trim 後）
 * @returns {{observation: string, assessment: string, intervention: string}}
 */
function getClinicalTaskAnswers() {
  return {
    observation: String(clinical$(CLINICAL_FIELD_IDS.observation)?.value || '').trim(),
    assessment: String(clinical$(CLINICAL_FIELD_IDS.assessment)?.value || '').trim(),
    intervention: String(clinical$(CLINICAL_FIELD_IDS.intervention)?.value || '').trim()
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
 */
function resetClinicalTaskForm() {
  Object.values(CLINICAL_FIELD_IDS).forEach((id) => {
    const el = clinical$(id);
    if (el) {
      el.value = '';
      el.disabled = false;
    }
  });

  const submitBtn = clinical$('btn-submit-task') || clinical$('btn-l3-submit-supervisor');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = '發送給督導 (Submit)';
  }

  setTaskInstruction('');
  clearClinicalFeedback();
}

/**
 * 啟用／停用表格欄位
 * @param {boolean} disabled
 */
function setClinicalTaskFormDisabled(disabled) {
  Object.values(CLINICAL_FIELD_IDS).forEach((id) => {
    const el = clinical$(id);
    if (el) el.disabled = Boolean(disabled);
  });
}

/**
 * 清空督導回饋渲染區
 */
function clearClinicalFeedback() {
  const box = clinical$('l3-supervision-feedback');
  const zh = clinical$('l3-feedback-zh');
  const en = clinical$('l3-feedback-en');
  const fields = clinical$('l3-field-feedback');
  const vocab = clinical$('l3-vocab-corrections');

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
 */
function renderStructuredSupervisionFeedback(result) {
  const box = clinical$('l3-supervision-feedback');
  const zh = clinical$('l3-feedback-zh');
  const en = clinical$('l3-feedback-en');
  const fieldsEl = clinical$('l3-field-feedback');
  const vocabEl = clinical$('l3-vocab-corrections');

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
 *   knowledge?: Object|null,
 *   subjectName?: string
 * }} options
 */
function hydrateClinicalTaskForm(options) {
  const knowledge = options?.knowledge || null;
  applySubjectPlaceholders(knowledge);

  const guidance =
    String(options?.guidance_zh || '').trim() ||
    String(options?.task_zh || '').trim() ||
    buildFallbackGuidance(knowledge, options?.subjectName);

  setTaskInstruction(guidance);
}

// 對外 API
window.buildSubjectFieldPlaceholders = buildSubjectFieldPlaceholders;
window.buildFallbackGuidance = buildFallbackGuidance;
window.setTaskInstruction = setTaskInstruction;
window.applySubjectPlaceholders = applySubjectPlaceholders;
window.getClinicalTaskAnswers = getClinicalTaskAnswers;
window.isClinicalTaskEmpty = isClinicalTaskEmpty;
window.resetClinicalTaskForm = resetClinicalTaskForm;
window.setClinicalTaskFormDisabled = setClinicalTaskFormDisabled;
window.clearClinicalFeedback = clearClinicalFeedback;
window.renderStructuredSupervisionFeedback = renderStructuredSupervisionFeedback;
window.hydrateClinicalTaskForm = hydrateClinicalTaskForm;
