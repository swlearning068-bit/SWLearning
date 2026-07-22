/**
 * deepseek.js — DeepSeek API 呼叫封裝
 *
 * 職責：
 * 1. 從 localStorage 讀取 API Key
 * 2. 組裝 System Prompt 與使用者訊息（支援動態科目附加提示）
 * 3. 依 taskType 強制路由至 v4-flash / v4-pro（+ thinking）
 *    （勿再用 deepseek-chat / deepseek-reasoner：官方已改為 flash 別名）
 * 4. 發送 fetch 請求並強制回傳 JSON 格式（過濾 <think> 標籤）
 * 5. 解析並回傳結構化結果（寫作 L1/L2/L3 / 閱讀 L1/L2/L3）
 * 6. 從 subjects_knowledge.json 無痕注入科目理論框架至 System Prompt
 */

// localStorage 中用來儲存 API Key 的鍵名（與 app.js 保持一致）
const STORAGE_KEY_API = 'swlearning_deepseek_api_key';

/** localStorage：目前選擇的社工科目 ID */
const STORAGE_KEY_SUBJECT = 'swlearning_current_subject';

// DeepSeek API 端點（OpenAI 相容格式）
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/** 十二大（及延伸）社工領域理論知識庫（subjectId → knowledge） */
let subjectsKnowledge = {};

/**
 * 系統初始化時載入科目理論知識庫
 * @returns {Promise<void>}
 */
async function loadSubjectsKnowledge() {
  try {
    const response = await fetch('data/subjects_knowledge.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    subjectsKnowledge =
      data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error('⚠️ 無法載入科目知識庫:', error);
    subjectsKnowledge = {};
  }
}

/**
 * 依科目 ID 取得理論知識物件
 * @param {string} subjectId
 * @returns {Object|null}
 */
function getSubjectKnowledge(subjectId) {
  const id = normalizeSubjectId(subjectId);
  if (!id || !subjectsKnowledge || typeof subjectsKnowledge !== 'object') {
    return null;
  }
  // family_practice 與 family_social_work 互通
  return (
    subjectsKnowledge[id] ||
    (id === 'family_practice' ? subjectsKnowledge.family_social_work : null) ||
    (id === 'family_social_work' ? subjectsKnowledge.family_practice : null) ||
    null
  );
}

/**
 * 依科目 ID 取得核心理論知識（對外別名）
 * @param {string} subjectId
 * @returns {Object|null}
 */
function getTheoryBySubject(subjectId) {
  return getSubjectKnowledge(subjectId);
}

/**
 * 將知識庫轉為可注入 System Prompt 的文字
 * 支援：theories[] 詳版，或 theory_core / key_concepts / tone 精簡版
 * @param {Object} knowledge
 * @returns {string}
 */
function buildKnowledgeInjectionText(knowledge) {
  if (!knowledge || typeof knowledge !== 'object') return '';

  const theoryCore = String(
    knowledge.theory_core || knowledge.core_philosophy || ''
  ).trim();
  const topConcepts = Array.isArray(knowledge.key_concepts)
    ? knowledge.key_concepts.map((c) => String(c || '').trim()).filter(Boolean)
    : [];
  const tone = String(knowledge.tone || '').trim();
  const philosophy = String(knowledge.core_philosophy || '').trim();
  const theories = Array.isArray(knowledge.theories) ? knowledge.theories : [];

  const theoriesText = theories
    .map((t) => {
      if (!t || typeof t !== 'object') return '';
      const name = String(t.theory_name || '').trim() || '未命名理論';
      const scholar = String(t.scholar || '').trim() || '未知學者';
      const concepts = Array.isArray(t.key_concepts)
        ? t.key_concepts.map((c) => String(c || '').trim()).filter(Boolean).join(', ')
        : '';
      const application = String(t.application || '').trim();
      return (
        `- 【${name}】(${scholar}): 關鍵概念包含 ${concepts || '（未提供）'}。` +
        `實務應用：${application || '（未提供）'}`
      );
    })
    .filter(Boolean)
    .join('\n');

  // 無任何可用理論資訊則不注入
  if (!theoryCore && !theoriesText && topConcepts.length === 0) {
    return '';
  }

  const lines = [
    '',
    '',
    '【📚 專業學理強制注入 (CRITICAL)】：',
    '你是一位香港資深社會工作督導。請運用以下理論架構進行分析：'
  ];

  if (theoryCore) {
    lines.push(`- 核心理論: ${theoryCore}`);
  }
  if (philosophy && philosophy !== theoryCore) {
    lines.push(`- 核心哲學: ${philosophy}`);
  }
  if (topConcepts.length > 0) {
    lines.push(`- 關鍵概念: ${topConcepts.join(', ')}`);
  }
  if (tone) {
    lines.push(`- 寫作／分析語氣: ${tone}`);
  }
  if (theoriesText) {
    lines.push('以下為必須精準運用的詳細理論框架：');
    lines.push(theoriesText);
  }

  lines.push(
    '請確保內容精準對應上述理論框架，並符合香港社會工作脈絡。'
  );
  lines.push(
    '【題目解析強制要求】：若輸出含 explanation／解析／reference_answer，' +
      '必須明確引用本科目至少一個核心理論或關鍵概念來支撐論點' +
      '（例如：「本題涉及家庭系統理論中的三角關係，案主透過拉攏子女來稀釋伴侶間衝突...」），' +
      '禁止只做表面對錯說明而無學理支撐。'
  );

  return lines.join('\n');
}

/**
 * 將理論知識無痕附加至 messages 中的 system 訊息（就地修改副本）
 * @param {Array<{role: string, content: string}>} messages
 * @param {string|null} subjectId
 * @returns {Array<{role: string, content: string}>}
 */
function injectSubjectKnowledgeIntoMessages(messages, subjectId) {
  const list = Array.isArray(messages)
    ? messages.map((msg) => ({
        role: msg.role,
        content: String(msg.content || '')
      }))
    : [];

  if (!subjectId) return list;

  const knowledge = getTheoryBySubject(subjectId);
  const injectionText = buildKnowledgeInjectionText(knowledge);
  if (!injectionText) return list;

  const systemMessageIndex = list.findIndex((msg) => msg.role === 'system');
  if (systemMessageIndex !== -1) {
    list[systemMessageIndex].content += injectionText;
  } else {
    list.unshift({
      role: 'system',
      content: '你是一位香港資深社會工作督導。' + injectionText
    });
  }

  return list;
}

/** DeepSeek V4：日常任務預設（最省 Token） */
const DEEPSEEK_MODEL_FLASH = 'deepseek-v4-flash';

/** DeepSeek V4：高價值旗艦任務（故事／文獻／推理／慶祝信） */
const DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro';

/**
 * 注意（2026-04 官方變更）：
 * deepseek-chat / deepseek-reasoner 已是相容別名，實際都指向 deepseek-v4-flash
 * （chat=非思考、reasoner=思考）。計費後台會一律顯示 flash。
 * 若要真正切到不同模型與計費，必須使用 deepseek-v4-flash / deepseek-v4-pro。
 */

/** 相容舊常數名稱（預設指向 Flash） */
const DEEPSEEK_MODEL = DEEPSEEK_MODEL_FLASH;

/**
 * 依任務類型強制決定模型字串（智慧路由）
 *
 * - standard：deepseek-v4-flash（翻譯／單字等日常任務）
 * - story / literature：deepseek-v4-pro（長篇故事與文獻，高穩定度）
 * - complex_logic / ethics / challenge：deepseek-v4-pro + thinking（倫理兩難、測驗題）
 * - ultimate_celebration / deep_correction：deepseek-v4-pro（滿卡慶祝信、長文深度批改）
 *
 * @param {string} [taskType='standard']
 * @returns {{ modelName: string, extraBody: Object }}
 */
function resolveDeepSeekRouting(taskType = 'standard') {
  // 預設使用最便宜的 flash 模型
  let targetModel = DEEPSEEK_MODEL_FLASH;
  // V4 預設會開 thinking；非推理任務必須明確關閉，否則思考佔滿 max_tokens 會讓 content 變空
  let extraBody = { thinking: { type: 'disabled' } };

  // 根據任務類型強制切換「真正會分開計費」的 V4 模型
  if (taskType === 'story' || taskType === 'literature') {
    // 長篇故事與文獻：旗艦 Pro（勿用 deepseek-chat，那只是 flash 別名）
    targetModel = DEEPSEEK_MODEL_PRO;
  } else if (
    taskType === 'complex_logic' ||
    taskType === 'ethics' ||
    taskType === 'challenge'
  ) {
    // 倫理兩難、測驗題：Pro + 思考模式（勿用 deepseek-reasoner，那只是 flash 思考別名）
    targetModel = DEEPSEEK_MODEL_PRO;
    extraBody = { thinking: { type: 'enabled' } };
  } else if (
    taskType === 'ultimate_celebration' ||
    taskType === 'deep_correction'
  ) {
    // 滿卡慶祝信、長文深度批改
    targetModel = DEEPSEEK_MODEL_PRO;
  }

  return { modelName: targetModel, extraBody };
}

/**
 * 過濾模型思考過程標籤，避免破壞 UI／JSON 解析
 * @param {string} content
 * @returns {string}
 */
function stripThinkTags(content) {
  return String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** 找不到科目時的通用社工場景（防呆） */
const DEFAULT_SUBJECT = {
  id: 'general_practice',
  name: '通用社工實務',
  prompt_context:
    '此情境為香港通用社工實務，請使用 casework, home visit, resource referral, follow-up 等前線社工日常專有名詞。'
};

/** 舊科目 ID → 新科目 ID（避免 localStorage 殘留導致選錯科） */
const SUBJECT_ID_ALIASES = {
  ethics: 'ethics_and_values',
  family_practice: 'family_social_work'
};

/**
 * 將可能的舊科目 ID 正規化為現行 ID
 * @param {string} subjectId
 * @returns {string}
 */
function normalizeSubjectId(subjectId) {
  const id = String(subjectId || '').trim();
  return SUBJECT_ID_ALIASES[id] || id;
}

/**
 * 從 localStorage 讀取當前科目 ID，並對應取得 name / prompt_context
 * 若找不到選擇或資料，則回退為通用社工場景
 *
 * @returns {{id: string, name: string, prompt_context: string}}
 */
function resolveCurrentSubject() {
  const subjectId = normalizeSubjectId(
    localStorage.getItem(STORAGE_KEY_SUBJECT) || ''
  );
  const list = Array.isArray(window.subjectsList) ? window.subjectsList : [];

  if (subjectId && list.length > 0) {
    const found = list.find((s) => s && s.id === subjectId);
    if (found && found.name && found.prompt_context) {
      return {
        id: found.id,
        name: String(found.name),
        prompt_context: String(found.prompt_context)
      };
    }
  }

  // 後備：嘗試用 app.js 暴露的當前科目物件
  if (
    typeof window.getCurrentSubject === 'function'
  ) {
    const current = window.getCurrentSubject();
    if (current && current.name && current.prompt_context) {
      return {
        id: current.id || DEFAULT_SUBJECT.id,
        name: String(current.name),
        prompt_context: String(current.prompt_context)
      };
    }
  }

  return { ...DEFAULT_SUBJECT };
}

/**
 * 在 System Prompt 最前面強制注入當前科目情境前綴
 *
 * @param {string} basePrompt - 基礎 System Prompt
 * @returns {string} 含科目脈絡的完整 Prompt
 */
function withSubjectContext(basePrompt) {
  const subject = resolveCurrentSubject();
  const prefix =
    '【科目鎖定｜最高優先級】我們現在的情境是香港社工課程的【' +
    subject.name +
    '】科目。' +
    subject.prompt_context +
    ' 你生成的所有內容必須嚴格服務於此科目核心主題；若科目要求倫理兩難，內容核心必須呈現衝突與道德抉擇，禁止偏離成其他科目或無關的一般日常敘事。\n\n';

  return prefix + String(basePrompt || '');
}

/**
 * System Prompt：告訴 AI 如何回應初學者的零碎英文輸入
 * 重點：不批評文法、稱讚表達、組合完整句、附中文翻譯、強制 JSON 格式
 */
const SYSTEM_PROMPT = `你的用戶是英文初學者，他們只會輸入零碎的單字或極度破碎的句子來表達社工場景。
請不要批評文法，因為這階段的目標是鼓勵表達。
任務：
1. 稱讚他們成功傳達的核心意思
2. 將碎片組合成一句文法正確、用詞簡單（初中程度）的完整英文句子
3. 加上繁體中文翻譯

請務必以 JSON 格式回傳，格式如下：
{
  "encouragement_zh": "簡短的一句中文稱讚",
  "completed_sentence_en": "組合後的英文完整句",
  "translation_zh": "英文句子的中文翻譯"
}`;

/**
 * L2 結構期 System Prompt：半完成句型填空批改
 */
const L2_WRITING_SYSTEM_PROMPT = `用戶會填寫半完成的英文句型來描述社工個案。
請溫和指出文法或用詞問題，強調句子結構正確性，語氣像鼓勵學生的老師。
回傳 JSON 格式：
{
  "corrected_sentence": "修正後的完整句",
  "issues": ["錯誤點1", "錯誤點2"],
  "grammar_tip_zh": "繁體中文的文法提示與鼓勵"
}`;

/**
 * L3 專業期 System Prompt：個案紀錄三種改寫
 */
const L3_WRITING_SYSTEM_PROMPT = `用戶是準備實習的社工學生，這是他們寫的個案紀錄。
請提供三個版本：1.文法正確的日常版 2.專業客觀的社工紀錄版(Case Notes) 3.同理心溝通版(對案主講的話)。
回傳 JSON 格式：
{
  "grammar_version": "...",
  "professional_version": "...",
  "empathy_version": "...",
  "explanation_zh": "繁體中文解釋這三者在用詞和語氣上的差異"
}`;

/**
 * 從 localStorage 讀取 API Key
 * @returns {string} API Key 字串
 * @throws {Error} 若 localStorage 中沒有 API Key
 */
function getApiKey() {
  const key = localStorage.getItem(STORAGE_KEY_API);
  if (!key || key.trim() === '') {
    throw new Error('尚未設定 API Key，請先到設定頁面輸入。');
  }
  return key.trim();
}

/**
 * L1 閱讀：長文 detailed case vignette System Prompt（300–450 字）
 */
const L1_STORY_LONG_SYSTEM_PROMPT = `你是一位具備高度學術素養的香港資深社會工作督導。請根據指定的主題，生成一篇高度專業、細節豐富的社工個案情境 (Case Vignette / detailed case vignette)。
必須符合香港的社會脈絡與法例，並在文中自然穿插至少 8 到 10 個高級社工學術專有名詞（如 ecological perspective, empowerment, crisis intervention 等）。
⚠️ 最高優先：主題必須嚴格符合開頭的「科目鎖定」要求，不可寫成與該科目無關的一般日常敘事。
若科目為社會工作倫理與價值，核心必須清楚呈現社工倫理兩難與道德抉擇時的專業反思（例如保密 vs 舉報、自決 vs 保護生命）；香港法例、SWRB、華人價值或宗教等僅隨機帶入 1–2 個作為導火線，不要一次塞滿。
【寫作語氣與專業規範】：
1. **臨床與專業 (Clinical & Professional)**：文章應讀起來像是一份**高水準的臨床督導紀錄 (Clinical Supervision Log) 或專業個案匯報 (Case Presentation)**。
2. **拒絕煽情 (No Melodrama)**：絕對禁止使用言情小說式、過度詩意或誇張的情感詞彙（例如嚴禁使用 "my heart clenched", "delicate dance", "raw struggle" 等字眼）。社工的情感反思必須是理性、客觀且受控的。
3. **保持專業界線 (Professional Boundaries)**：在描寫介入過程時，社工的行為必須符合專業規範。避免描寫社工過度表露自我情緒（Over-involvement）而造成案主負擔。
4. **自然融入名詞**：學術名詞必須自然地作為『預估 (Assessment)』與『介入策略 (Intervention)』的專業術語使用，不可為了湊數而生硬堆砌。

你必須嚴格回傳以下 JSON 格式，絕對不允許偏離字數限制：
{
  "story_en": "【必須是 300 到 450 字的英文長文】。請分為3段：1.案主背景與呈現問題。2.詳細的社工心理社會預估與對話細節。3.具體的介入過程與學術理論應用。",
  "story_zh": "高質量的繁體中文意譯，嚴禁生硬直譯與翻譯腔，需符合香港社工中文實務書寫習慣。",
  "vocabulary": [
    {
      "term": "英文專有名詞1",
      "zh": "繁體中文翻譯",
      "part_of_speech": "詞性"
    }
  ]
}
【中文翻譯規範 (CRITICAL)】：
"story_zh" 欄位的翻譯必須徹底擺脫『翻譯腔 (Translationese)』，達到信、達、雅的要求。
1. **意譯優於直譯**：請根據上下文的真實語境進行翻譯。例如 "competing values" 應譯為『互相衝突的價值觀』，而非『相競的價值』。
2. **符合中文語法**：避免使用英文思維的『死物主詞』或『過度冗長的名詞片語』。例如不要寫『評估架構揭示了...』，請改為『社工透過評估架構發現...』。
3. **香港實務口吻**：請使用香港社會工作者撰寫中文個案紀錄時自然、專業且流暢的語氣。文字應具備溫度與臨床嚴謹性。
vocabulary 請提供 5-8 個從文中萃取的進階專有名詞。絕對禁止回傳過短、摘要式或僅數句的內容。`;

/**
 * L1 閱讀：短文社工小故事 System Prompt（約 3–4 句）
 */
const L1_STORY_SHORT_SYSTEM_PROMPT = `你是一位英文老師。請創作一個包含 3 到 4 句英文的社工小故事。
⚠️ 最高優先：故事主題必須嚴格符合開頭的「科目鎖定」要求，不可寫成與該科目無關的一般日常敘事。
若科目為社會工作倫理與價值，故事核心必須清楚呈現社工倫理兩難與道德抉擇時的專業反思（例如保密 vs 舉報、自決 vs 保護生命）；香港法例、SWRB、華人價值或宗教等僅隨機帶入 1–2 個作為導火線，不要一次塞滿。
英文難度必須控制在初中程度，句子結構要簡單，但仍要保留關鍵專業術語。語氣須客觀、專業，避免煽情或言情小說式情感詞彙。

請以 JSON 格式回傳：
{
  "story_en": "英文故事全文（3 到 4 句）",
  "story_zh": "高質量的繁體中文意譯，嚴禁生硬直譯與翻譯腔，需符合香港社工中文實務書寫習慣。",
  "vocabulary": [
    {
      "term": "英文專有名詞1",
      "zh": "繁體中文翻譯",
      "part_of_speech": "詞性"
    }
  ]
}
【中文翻譯規範 (CRITICAL)】：
"story_zh" 欄位的翻譯必須徹底擺脫『翻譯腔 (Translationese)』，達到信、達、雅的要求。
1. **意譯優於直譯**：請根據上下文的真實語境進行翻譯。例如 "competing values" 應譯為『互相衝突的價值觀』，而非『相競的價值』。
2. **符合中文語法**：避免使用英文思維的『死物主詞』或『過度冗長的名詞片語』。例如不要寫『評估架構揭示了...』，請改為『社工透過評估架構發現...』。
3. **香港實務口吻**：請使用香港社會工作者撰寫中文個案紀錄時自然、專業且流暢的語氣。文字應具備溫度與臨床嚴謹性。
vocabulary 請挑選 5 到 8 個對於該科目最重要的單字。`;

/** 相容舊名稱 */
const L1_STORY_SYSTEM_PROMPT = L1_STORY_LONG_SYSTEM_PROMPT;

/**
 * Thinking 模式會把 reasoning 也計入 max_tokens；過低時 content 常為空。
 * 對有開 thinking 的任務抬高下限，避免多次重試才「碰巧」成功。
 */
const THINKING_MAX_TOKENS_FLOOR = 4096;

/**
 * 呼叫 DeepSeek Chat Completions（含智慧模型路由）
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} [taskType='standard'] - 路由任務類型
 * @param {string|null} [subjectId=null] - 科目 ID；有值時注入理論知識庫
 * @param {Object} [options]
 * @param {number} [options.maxTokens=2500]
 * @param {number} [options.temperature=0.7]
 * @param {boolean} [options.jsonObject=true] - 是否強制 JSON Object 回傳
 * @returns {Promise<string>} 已過濾 <think> 標籤的訊息內容
 */
async function callDeepSeekChatAPI(
  messages,
  taskType = 'standard',
  subjectId = null,
  options = {}
) {
  // 相容舊呼叫：第三參數若為物件，視為 options（無 subjectId）
  if (
    subjectId &&
    typeof subjectId === 'object' &&
    !Array.isArray(subjectId)
  ) {
    options = subjectId;
    subjectId = options.subjectId || null;
  }

  // 防呆：漏傳 taskType 會降級為 flash，方便第一時間發現呼叫端問題
  if (!taskType || taskType === 'standard') {
    console.warn(
      '⚠️ [API 警告] 當前 API 呼叫未指定 taskType，已預設降級為 deepseek-v4-flash。若這不是預期行為，請檢查呼叫來源的參數傳遞。'
    );
  }

  const apiKey = getApiKey();
  const temperature =
    typeof options.temperature === 'number' ? options.temperature : 0.7;
  const jsonObject = options.jsonObject !== false;

  const { modelName, extraBody } = resolveDeepSeekRouting(taskType);
  const thinkingEnabled = extraBody?.thinking?.type === 'enabled';

  let maxTokens = Number(options.maxTokens) > 0 ? Number(options.maxTokens) : 2500;
  if (thinkingEnabled && maxTokens < THINKING_MAX_TOKENS_FLOOR) {
    maxTokens = THINKING_MAX_TOKENS_FLOOR;
  }

  // 💎 知識注入：依 subjectId 將理論框架附加至 system prompt
  const resolvedSubjectId =
    subjectId != null && String(subjectId).trim() !== ''
      ? normalizeSubjectId(subjectId)
      : null;
  const finalMessages = injectSubjectKnowledgeIntoMessages(
    messages,
    resolvedSubjectId
  );

  // 發送請求前確認目前使用的模型（除錯用）
  console.log(
    `[API Routing] Current Task: ${taskType}, Model Triggered: ${modelName}` +
      (thinkingEnabled ? ' + thinking' : '') +
      (resolvedSubjectId ? `, Subject: ${resolvedSubjectId}` : '')
  );

  // 右下角輔助提示：顯示當前 Flash / Chat / Reasoner / Pro（不取代各功能自己的 Loading）
  if (typeof showAiIndicator === 'function') {
    showAiIndicator(taskType);
  }

  /**
   * @param {number} tokenBudget
   * @returns {Promise<{rawContent: string, finishReason: string}>}
   */
  async function fetchOnce(tokenBudget) {
    const requestBody = {
      model: modelName,
      messages: finalMessages,
      temperature,
      max_tokens: tokenBudget,
      ...extraBody
    };

    if (jsonObject) {
      requestBody.response_format = { type: 'json_object' };
    }

    let response;
    try {
      response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
    } catch (_) {
      throw new Error('網路連線失敗，請檢查您的網路後再試。');
    }

    if (!response.ok) {
      let errorDetail = `API 回應錯誤（狀態碼 ${response.status}）`;

      try {
        const errorBody = await response.json();
        if (errorBody.error && errorBody.error.message) {
          errorDetail = errorBody.error.message;
        }
      } catch (_) {
        // 若無法解析錯誤 body，使用預設訊息
      }

      if (response.status === 401) {
        throw new Error('API Key 無效或已過期，請重新設定。');
      }

      throw new Error(errorDetail);
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error('API 回傳格式異常，無法解析 JSON。');
    }

    const choice = data?.choices?.[0];
    const rawContent = choice?.message?.content;
    const finishReason = String(choice?.finish_reason || '');
    const hasReasoning = Boolean(
      choice?.message?.reasoning_content &&
        String(choice.message.reasoning_content).trim()
    );

    return {
      rawContent: typeof rawContent === 'string' ? rawContent : '',
      finishReason,
      hasReasoning
    };
  }

  try {
    let result = await fetchOnce(maxTokens);

    // Thinking 佔滿 token 時 content 會是空字串；自動加大配額重試一次
    if (!result.rawContent.trim()) {
      const shouldRetry =
        thinkingEnabled ||
        result.finishReason === 'length' ||
        result.hasReasoning;

      if (shouldRetry) {
        const retryTokens = Math.max(maxTokens * 2, 8192);
        console.warn(
          `[API] content 為空 (finish_reason=${result.finishReason || 'n/a'})，` +
            `以 max_tokens=${retryTokens} 重試一次…`
        );
        result = await fetchOnce(retryTokens);
      }
    }

    if (!result.rawContent.trim()) {
      const truncated = result.finishReason === 'length';
      throw new Error(
        truncated
          ? 'API 回傳內容被截斷（思考過程過長），請再試一次。'
          : 'API 回傳內容為空，請稍後再試。'
      );
    }

    // 思考模式可能夾帶 <think>...</think>，回傳前必須過濾
    return stripThinkTags(result.rawContent);
  } finally {
    if (typeof hideAiIndicator === 'function') {
      hideAiIndicator();
    }
  }
}

/**
 * 組裝 System／User 訊息並呼叫 DeepSeek，強制解析為 JSON
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {number} [maxTokens=300]
 * @param {string} [taskType='standard']
 * @param {Object} [options]
 * @param {boolean} [options.skipSubjectContext=false]
 * @param {string|null} [options.subjectId=null] - 科目 ID；用於理論知識注入
 * @param {number} [options.temperature]
 * @returns {Promise<Object>}
 */
async function requestDeepSeekJSON(
  systemPrompt,
  userContent,
  maxTokens = 300,
  taskType = 'standard',
  options = {}
) {
  const finalSystemPrompt = options.skipSubjectContext
    ? systemPrompt
    : withSubjectContext(systemPrompt);

  // 優先用呼叫端明確傳入的 subjectId；否則在有科目鎖定時用當前科目
  let subjectId =
    options.subjectId != null && String(options.subjectId).trim() !== ''
      ? normalizeSubjectId(options.subjectId)
      : null;
  if (!subjectId && !options.skipSubjectContext) {
    subjectId = resolveCurrentSubject().id || null;
  }

  const rawContent = await callDeepSeekChatAPI(
    [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: userContent }
    ],
    taskType,
    subjectId,
    {
      maxTokens,
      temperature: options.temperature,
      jsonObject: true
    }
  );

  let result;
  try {
    result = JSON.parse(rawContent);
  } catch (_) {
    throw new Error('AI 回傳的 JSON 格式有誤，請再試一次。');
  }

  return result;
}

/**
 * 呼叫 DeepSeek API，將使用者的零碎英文組合成完整句子
 *
 * @param {string} userText - 使用者輸入的零碎英文單字或破碎句子
 * @returns {Promise<{encouragement_zh: string, completed_sentence_en: string, translation_zh: string}>}
 * @throws {Error} API Key 缺失、網路錯誤、或 API 回傳格式異常時拋出
 */
async function callDeepSeekAPI(userText) {
  const result = await requestDeepSeekJSON(SYSTEM_PROMPT, userText, 300);

  const { encouragement_zh, completed_sentence_en, translation_zh } = result;
  if (!encouragement_zh || !completed_sentence_en || !translation_zh) {
    throw new Error('AI 回傳資料不完整，缺少必要欄位。');
  }

  return { encouragement_zh, completed_sentence_en, translation_zh };
}

/**
 * L2 寫作：批改半完成句型填空
 *
 * @param {string} patternLabel - 原始句型（含 ___）
 * @param {string} filledSentence - 使用者填完空格後的完整句
 * @param {string[]} blankAnswers - 各空格填入內容
 * @returns {Promise<{corrected_sentence: string, issues: string[], grammar_tip_zh: string}>}
 */
async function callL2WritingAPI(patternLabel, filledSentence, blankAnswers) {
  const blanksText = blankAnswers
    .map((ans, i) => `Blank ${i + 1}: ${ans}`)
    .join('\n');

  const userContent = `句型：${patternLabel}
使用者填空內容：
${blanksText}
組合成的句子：${filledSentence}

請批改這句話。`;

  const result = await requestDeepSeekJSON(L2_WRITING_SYSTEM_PROMPT, userContent, 500);

  const { corrected_sentence, issues, grammar_tip_zh } = result;

  if (!corrected_sentence || !grammar_tip_zh) {
    throw new Error('AI 回傳資料不完整，缺少必要欄位。');
  }

  // issues 允許為空陣列（表示幾乎沒問題），但必須是陣列
  const issuesList = Array.isArray(issues)
    ? issues.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];

  return {
    corrected_sentence: String(corrected_sentence).trim(),
    issues: issuesList,
    grammar_tip_zh: String(grammar_tip_zh).trim()
  };
}

/**
 * L3 寫作：個案紀錄三種改寫
 *
 * @param {string} caseNotes - 使用者撰寫的個案紀錄全文
 * @returns {Promise<{grammar_version: string, professional_version: string, empathy_version: string, explanation_zh: string}>}
 */
async function callL3WritingAPI(caseNotes) {
  const userContent = `以下是學生撰寫的個案紀錄，請依指示提供三個版本與說明：\n\n${caseNotes}`;

  // 長文深度批改：動用 Pro 旗艦模型
  const result = await requestDeepSeekJSON(
    L3_WRITING_SYSTEM_PROMPT,
    userContent,
    1200,
    'deep_correction'
  );

  const {
    grammar_version,
    professional_version,
    empathy_version,
    explanation_zh
  } = result;

  if (!grammar_version || !professional_version || !empathy_version || !explanation_zh) {
    throw new Error('AI 回傳資料不完整，缺少必要欄位。');
  }

  return {
    grammar_version: String(grammar_version).trim(),
    professional_version: String(professional_version).trim(),
    empathy_version: String(empathy_version).trim(),
    explanation_zh: String(explanation_zh).trim()
  };
}

/**
 * 依當前科目取得 L1 故事主題池（避免通用主題蓋過科目核心）
 * @param {string} subjectId
 * @returns {string[]}
 */
function getL1StoryThemes(subjectId) {
  const id = normalizeSubjectId(subjectId);

  if (id === 'ethics_and_values') {
    return [
      '保密與告知義務之間的倫理兩難',
      '保護生命與案主自決之間的掙扎',
      '案主自決與家人施壓之間的衝突',
      '專業守則與機構要求之間的兩難',
      '強制介入與尊重自主之間的抉擇',
      '個人信念與專業倫理之間的張力',
      '保護弱勢與維持信任關係之間的衝突'
    ];
  }

  return [
    '探訪獨居長者',
    '協助有情緒困擾的青少年',
    '家庭衝突調解',
    '申請津貼與資源轉介',
    '家訪與社區關懷',
    '協助新來港家庭適應生活'
  ];
}

/**
 * 生成 L1 漸進式閱讀的社工小故事／詳細個案情境
 *
 * @param {'long'|'short'} [lengthMode='long'] - 長文（2500 tokens）或短文（600 tokens）
 * @param {string} [taskType] - 呼叫端強制指定的路由；未傳時依科目自動判斷 ethics / story
 * @param {string|null} [subjectId] - 科目 ID；未傳時使用當前科目（供理論知識注入）
 * @returns {Promise<{story_en: string, story_zh: string, theme: string, lengthMode: string, keywords: Array<{word: string, zh: string, pos?: string}>}>}
 * @throws {Error} API Key 缺失、網路錯誤、或回傳格式異常時拋出
 */
async function generateL1Story(lengthMode = 'long', taskType, subjectId = null) {
  const isShort = lengthMode === 'short';
  const subject = subjectId
    ? (() => {
        const id = normalizeSubjectId(subjectId);
        const list = Array.isArray(window.subjectsList) ? window.subjectsList : [];
        const found = list.find((s) => s && s.id === id);
        return found && found.name
          ? {
              id,
              name: String(found.name),
              prompt_context: String(found.prompt_context || '')
            }
          : { ...resolveCurrentSubject(), id };
      })()
    : resolveCurrentSubject();
  // 依科目挑選主題，避免通用日常情境蓋過倫理等專科要求
  const themes = getL1StoryThemes(subject.id);
  const theme = themes[Math.floor(Math.random() * themes.length)];

  const systemPrompt = isShort ? L1_STORY_SHORT_SYSTEM_PROMPT : L1_STORY_LONG_SYSTEM_PROMPT;
  const maxTokens = isShort ? 600 : 2500;
  const userContent = isShort
    ? (
      `請創作一個關於「${theme}」的社工小故事（3 到 4 句英文）。` +
      `故事必須嚴格符合科目「${subject.name}」的核心要求，不可偏離成無關日常敘事。`
    )
    : (
      `請創作一篇關於「${theme}」的 detailed case vignette（詳細個案情境）。` +
      `story_en 必須是 300 到 450 字的英文長文（分為三段），不可壓縮成摘要或數句。` +
      `內容必須嚴格符合科目「${subject.name}」的核心要求，不可偏離成無關日常敘事。`
    );

  // 優先採用呼叫端傳入的 taskType；否則倫理與價值 → Pro+thinking，其他科目 → Pro
  const resolvedTaskType =
    taskType ||
    (normalizeSubjectId(subject.id) === 'ethics_and_values' ? 'ethics' : 'story');

  const result = await requestDeepSeekJSON(
    systemPrompt,
    userContent,
    maxTokens,
    resolvedTaskType,
    { subjectId: subject.id }
  );

  const { story_en, story_zh } = result;
  // 新 schema：vocabulary[{term, zh, part_of_speech}]；舊版相容：keywords[{word, zh}]
  const rawVocab = Array.isArray(result.vocabulary)
    ? result.vocabulary
    : (Array.isArray(result.keywords) ? result.keywords : []);

  if (!story_en || !story_zh || rawVocab.length === 0) {
    throw new Error('AI 回傳資料不完整，缺少個案情境或專有名詞。');
  }

  // 統一映射為 UI 使用的 keywords[{word, zh, pos?}]
  const validKeywords = rawVocab
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const word = String(item.term || item.word || '').trim();
      const zh = String(item.zh || '').trim();
      const pos = String(item.part_of_speech || item.pos || '').trim();
      if (!word || !zh) return null;
      return pos ? { word, zh, pos } : { word, zh };
    })
    .filter(Boolean);

  if (validKeywords.length === 0) {
    throw new Error('AI 回傳的專有名詞格式無效，請再試一次。');
  }

  return {
    story_en: String(story_en).trim(),
    story_zh: String(story_zh).trim(),
    theme: theme,
    lengthMode: isShort ? 'short' : 'long',
    keywords: validKeywords
  };
}

/**
 * L2 閱讀：將真實論文摘要簡化為初中～高中程度短文 + 生字
 */
const SIMPLIFY_ABSTRACT_SYSTEM_PROMPT = `你是一位專門教社工學生的英文教授。我會給你一篇真實的社工學術論文標題與摘要。請幫我：
1. 改寫成約 100-150 字、符合初中至高中程度的英文短文。必須保留核心的社工專業詞彙。
2. 提供整段改寫後短文的繁體中文翻譯。
3. 從中提取 3-5 個對社工學生最重要的專業生字（附中文解釋與詞性）。

請強制以 JSON 格式回傳：
{
  "simplified_en": "約 100-150 字的英文短文",
  "translation_zh": "繁體中文翻譯",
  "vocab": [
    {"word": "生字1", "zh": "中文意思", "pos": "n."},
    {"word": "生字2", "zh": "中文意思", "pos": "v."},
    {"word": "生字3", "zh": "中文意思", "pos": "adj."}
  ]
}
vocab 請提供 3 到 5 個；pos 可用簡短詞性標記（如 n. / v. / adj.）。`;

/**
 * 簡化學術論文摘要（L2 閱讀）
 * 內部透過 DeepSeek JSON API 呼叫（等同強制 JSON 的 callDeepSeek 流程）
 *
 * @param {string} title - 論文標題
 * @param {string} abstract - 論文摘要
 * @returns {Promise<{simplified_en: string, translation_zh: string, vocab: Array<{word: string, zh: string, pos: string}>}>}
 */
async function simplifyAbstractAPI(title, abstract) {
  const safeTitle = String(title || '').trim();
  const safeAbstract = String(abstract || '').trim();

  if (!safeTitle || !safeAbstract) {
    throw new Error('論文標題或摘要為空，無法簡化。');
  }

  const userContent = `論文標題：${safeTitle}\n\n論文摘要：\n${safeAbstract}`;

  const result = await requestDeepSeekJSON(
    SIMPLIFY_ABSTRACT_SYSTEM_PROMPT,
    userContent,
    1000
  );

  const { simplified_en, translation_zh, vocab } = result;

  if (!simplified_en || !translation_zh || !Array.isArray(vocab)) {
    throw new Error('AI 回傳資料不完整，缺少簡化短文或生字。');
  }

  const validVocab = vocab
    .filter(
      (item) =>
        item &&
        typeof item.word === 'string' &&
        typeof item.zh === 'string' &&
        item.word.trim() &&
        item.zh.trim()
    )
    .slice(0, 5)
    .map((item) => ({
      word: item.word.trim(),
      zh: item.zh.trim(),
      pos: typeof item.pos === 'string' && item.pos.trim()
        ? item.pos.trim()
        : ''
    }));

  if (validVocab.length === 0) {
    throw new Error('AI 回傳的生字格式無效，請再試一次。');
  }

  return {
    simplified_en: String(simplified_en).trim(),
    translation_zh: String(translation_zh).trim(),
    vocab: validVocab
  };
}

/**
 * L2 閱讀：依關鍵字與科目，由 AI 模擬生成「理論摘要＋情境案例＋實踐應用」教材
 */
function buildSimulatedLiteratureSystemPrompt(keyword, subjectName) {
  const safeKeyword = String(keyword || '').trim();
  const safeSubject = String(subjectName || '').trim() || '社會工作';

  return `你是一位香港社工系教授。使用者正在學習科目「${safeSubject}」，感興趣的關鍵字為「${safeKeyword}」。
請生成一份結合『學術理論』與『前線實務』的教材。所有英文內容的文法與單字必須控制在初中至高中難度。
⚠️ 絕對不可包含任何真實人物的個人資料，所有案例皆須為虛構。
⚠️ 內容必須嚴格服務於科目「${safeSubject}」；若該科為社會工作倫理與價值，摘要與案例核心必須呈現倫理兩難與道德抉擇的掙扎，並只隨機帶入 1–2 個背景元素（如 SWRB、特定法例、華人價值或宗教信仰），不要一次塞滿所有元素。

請強制以 JSON 格式回傳，格式如下：
{
  "original_title": "模擬的論文標題 (英文)",
  "simplified_article": "簡化後的文獻摘要短文 (英文，約 80 字)",
  "article_zh": "高質量的繁體中文意譯，嚴禁生硬直譯與翻譯腔，需符合香港社工中文實務書寫習慣。",
  "case_scenario_en": "基於該理論的虛構社工情境案例 (英文，約 60 字)",
  "case_scenario_zh": "高質量的繁體中文意譯，嚴禁生硬直譯與翻譯腔，需符合香港社工中文實務書寫習慣。",
  "practical_application_en": "社工在此情境下的具體介入/實踐手法 (英文，約 60 字)",
  "practical_application_zh": "高質量的繁體中文意譯，嚴禁生硬直譯與翻譯腔，需符合香港社工中文實務書寫習慣。",
  "key_vocabulary": [{"term": "...", "pos": "...", "zh": "..."}]
}
【中文翻譯規範 (CRITICAL)】：
article_zh、case_scenario_zh、practical_application_zh 欄位的翻譯必須徹底擺脫『翻譯腔 (Translationese)』，達到信、達、雅的要求。
1. **意譯優於直譯**：請根據上下文的真實語境進行翻譯。例如 "competing values" 應譯為『互相衝突的價值觀』，而非『相競的價值』。
2. **符合中文語法**：避免使用英文思維的『死物主詞』或『過度冗長的名詞片語』。例如不要寫『評估架構揭示了...』，請改為『社工透過評估架構發現...』。
3. **香港實務口吻**：請使用香港社會工作者撰寫中文個案紀錄時自然、專業且流暢的語氣。文字應具備溫度與臨床嚴謹性。
key_vocabulary 請提取 5 個重要專業生字。`;
}

/**
 * 生成 AI 模擬文獻（含摘要、情境案例、實踐應用與生字）
 *
 * @param {string} keyword - 搜尋／主題關鍵字
 * @param {string} [subjectName] - 目前科目名稱；未提供時自動解析
 * @param {string} [taskType='literature'] - 模型路由（預設 Pro）
 * @param {string|null} [subjectId=null] - 科目 ID；供理論知識注入
 * @returns {Promise<{
 *   original_title: string,
 *   simplified_article: string,
 *   article_zh: string,
 *   case_scenario_en: string,
 *   case_scenario_zh: string,
 *   practical_application_en: string,
 *   practical_application_zh: string,
 *   key_vocabulary: Array<{term: string, pos: string, zh: string}>,
 *   simplified_en: string,
 *   translation_zh: string,
 *   vocab: Array<{word: string, zh: string, pos: string}>
 * }>}
 */
async function generateSimulatedLiteratureAPI(
  keyword,
  subjectName,
  taskType = 'literature',
  subjectId = null
) {
  const safeKeyword = String(keyword || '').trim();
  if (!safeKeyword) {
    throw new Error('請先輸入關鍵字，才能生成模擬文獻。');
  }

  const current = resolveCurrentSubject();
  const resolvedSubjectId = subjectId
    ? normalizeSubjectId(subjectId)
    : current.id;
  const subject =
    subjectName && String(subjectName).trim()
      ? { id: resolvedSubjectId, name: String(subjectName).trim() }
      : current;

  const systemPrompt = buildSimulatedLiteratureSystemPrompt(
    safeKeyword,
    subject.name
  );
  const userContent =
    `科目：${subject.name}\n關鍵字：${safeKeyword}\n請依上述格式生成結合學術理論與前線實務的教材。`;

  // 文獻生成：使用 deepseek-v4-pro（可由呼叫端覆寫 taskType）
  const result = await requestDeepSeekJSON(
    systemPrompt,
    userContent,
    1600,
    taskType || 'literature',
    { subjectId: subject.id || resolvedSubjectId }
  );

  const {
    original_title,
    simplified_article,
    article_zh,
    case_scenario_en,
    case_scenario_zh,
    practical_application_en,
    practical_application_zh,
    key_vocabulary,
    // 相容舊欄位（若模型仍回傳）
    chinese_translation
  } = result;

  const articleZh = String(article_zh || chinese_translation || '').trim();

  if (
    !original_title ||
    !simplified_article ||
    !articleZh ||
    !case_scenario_en ||
    !case_scenario_zh ||
    !practical_application_en ||
    !practical_application_zh ||
    !Array.isArray(key_vocabulary)
  ) {
    throw new Error('AI 回傳資料不完整，缺少摘要、情境案例、實踐應用或生字。');
  }

  const validVocab = key_vocabulary
    .filter(
      (item) =>
        item &&
        typeof item.term === 'string' &&
        typeof item.zh === 'string' &&
        item.term.trim() &&
        item.zh.trim()
    )
    .slice(0, 5)
    .map((item) => ({
      term: item.term.trim(),
      word: item.term.trim(),
      zh: item.zh.trim(),
      pos:
        typeof item.pos === 'string' && item.pos.trim()
          ? item.pos.trim()
          : ''
    }));

  if (validVocab.length === 0) {
    throw new Error('AI 回傳的生字格式無效，請再試一次。');
  }

  const simplifiedArticle = String(simplified_article).trim();

  return {
    original_title: String(original_title).trim(),
    simplified_article: simplifiedArticle,
    article_zh: articleZh,
    case_scenario_en: String(case_scenario_en).trim(),
    case_scenario_zh: String(case_scenario_zh).trim(),
    practical_application_en: String(practical_application_en).trim(),
    practical_application_zh: String(practical_application_zh).trim(),
    key_vocabulary: validVocab.map(({ term, pos, zh }) => ({ term, pos, zh })),
    // 與既有 L2 欄位對齊（摘要區）
    simplified_en: simplifiedArticle,
    translation_zh: articleZh,
    vocab: validVocab.map(({ word, pos, zh }) => ({ word, pos, zh }))
  };
}

/**
 * L2 無縫擴寫：以真實摘要為種子，擴寫成約 800 字 IMRaD 模擬文獻
 * （Phase 11.3 中文翻譯規範 + Phase 11.4 混合模式）
 */
function buildExpandLiteratureSystemPrompt(subjectName) {
  const safeSubject = String(subjectName || '').trim() || '社會工作';

  return `你是一位香港社工系教授，同時擅長學術英文寫作教學。使用者正在學習科目「${safeSubject}」。
我會提供一篇「真實學術論文」的標題與摘要。請以其核心概念為種子，擴寫成一份供英文閱讀訓練用的「AI 模擬文獻」。

【擴寫要求】
1. 英文正文約 800 字，嚴格採 IMRaD 結構書寫，並以清楚小標標示：
   - Introduction
   - Methods
   - Results
   - Discussion
2. Methods / Results 可虛構合理的研究設計與數據（樣本數、量表、統計結果等），但語氣須像正式學術論文。
3. 難度控制在高中至大學一年級可讀範圍，保留社工專業詞彙。
4. 內容必須嚴格服務於科目「${safeSubject}」；若該科為社會工作倫理與價值，討論核心須呈現倫理兩難與道德抉擇。
5. ⚠️ 絕對不可包含任何真實人物的個人資料；案例與數據皆須為虛構。
6. 另外撰寫簡短的「情境案例」與「實踐應用」，方便社工學生連結前線實務。

請強制以 JSON 格式回傳：
{
  "original_title": "模擬文獻標題（英文，可微調原標題使其適合作為教材）",
  "simplified_article": "約 800 字的英文 IMRaD 正文（含 Introduction/Methods/Results/Discussion 小標）",
  "article_zh": "高質量的繁體中文意譯，嚴禁生硬直譯與翻譯腔，需符合香港社工中文實務書寫習慣。",
  "case_scenario_en": "基於該研究主題的虛構社工情境案例（英文，約 80–120 字）",
  "case_scenario_zh": "高質量的繁體中文意譯",
  "practical_application_en": "社工在此情境下的具體介入／實踐手法（英文，約 80–120 字）",
  "practical_application_zh": "高質量的繁體中文意譯",
  "key_vocabulary": [{"term": "...", "pos": "...", "zh": "..."}]
}

【中文翻譯規範 (CRITICAL)】：
article_zh、case_scenario_zh、practical_application_zh 欄位的翻譯必須徹底擺脫『翻譯腔 (Translationese)』，達到信、達、雅的要求。
1. **意譯優於直譯**：請根據上下文的真實語境進行翻譯。例如 "competing values" 應譯為『互相衝突的價值觀』，而非『相競的價值』。
2. **符合中文語法**：避免使用英文思維的『死物主詞』或『過度冗長的名詞片語』。例如不要寫『評估架構揭示了...』，請改為『社工透過評估架構發現...』。
3. **香港實務口吻**：請使用香港社會工作者撰寫中文個案紀錄時自然、專業且流暢的語氣。文字應具備溫度與臨床嚴謹性。
key_vocabulary 請提取 5 到 8 個重要專業生字。`;
}

/**
 * 將真實摘要無縫擴寫為 AI 模擬文獻（IMRaD ≈ 800 字）
 *
 * @param {string} title - 真實論文標題
 * @param {string} abstract - 真實論文摘要（僅作 Prompt 種子，不直接顯示）
 * @param {string|null} [subjectId=null] - 科目 ID；供理論知識注入
 * @param {string} [taskType='literature'] - 模型路由（預設 Pro）
 * @returns {Promise<{
 *   original_title: string,
 *   simplified_article: string,
 *   article_zh: string,
 *   case_scenario_en: string,
 *   case_scenario_zh: string,
 *   practical_application_en: string,
 *   practical_application_zh: string,
 *   key_vocabulary: Array<{term: string, pos: string, zh: string}>,
 *   simplified_en: string,
 *   translation_zh: string,
 *   vocab: Array<{word: string, zh: string, pos: string}>
 * }>}
 */
async function expandLiteratureFromAbstractAPI(
  title,
  abstract,
  subjectId = null,
  taskType = 'literature'
) {
  const safeTitle = String(title || '').trim();
  const safeAbstract = String(abstract || '').trim();

  if (!safeTitle || !safeAbstract) {
    throw new Error('論文標題或摘要為空，無法進行擴寫。');
  }

  const current = resolveCurrentSubject();
  const resolvedSubjectId = subjectId
    ? normalizeSubjectId(subjectId)
    : current.id;
  const subjectName = current.name || '社會工作';

  const systemPrompt = buildExpandLiteratureSystemPrompt(subjectName);
  const userContent =
    `科目：${subjectName}\n` +
    `真實論文標題：${safeTitle}\n\n` +
    `真實論文摘要（請以此為種子擴寫，勿原樣照抄）：\n${safeAbstract}\n\n` +
    `請依 IMRaD 結構擴寫成約 800 字的 AI 模擬文獻，並附情境案例、實踐應用與生字。`;

  // 800 字英文 + 中譯 + 情境／實踐：需要較大 token 預算
  const result = await requestDeepSeekJSON(
    systemPrompt,
    userContent,
    4500,
    taskType || 'literature',
    { subjectId: resolvedSubjectId }
  );

  const {
    original_title,
    simplified_article,
    article_zh,
    case_scenario_en,
    case_scenario_zh,
    practical_application_en,
    practical_application_zh,
    key_vocabulary,
    chinese_translation
  } = result;

  const articleZh = String(article_zh || chinese_translation || '').trim();

  if (
    !original_title ||
    !simplified_article ||
    !articleZh ||
    !case_scenario_en ||
    !case_scenario_zh ||
    !practical_application_en ||
    !practical_application_zh ||
    !Array.isArray(key_vocabulary)
  ) {
    throw new Error('AI 回傳資料不完整，缺少擴寫正文、情境案例、實踐應用或生字。');
  }

  const validVocab = key_vocabulary
    .filter(
      (item) =>
        item &&
        typeof item.term === 'string' &&
        typeof item.zh === 'string' &&
        item.term.trim() &&
        item.zh.trim()
    )
    .slice(0, 8)
    .map((item) => ({
      term: item.term.trim(),
      word: item.term.trim(),
      zh: item.zh.trim(),
      pos:
        typeof item.pos === 'string' && item.pos.trim()
          ? item.pos.trim()
          : ''
    }));

  if (validVocab.length === 0) {
    throw new Error('AI 回傳的生字格式無效，請再試一次。');
  }

  const simplifiedArticle = String(simplified_article).trim();

  return {
    original_title: String(original_title).trim(),
    simplified_article: simplifiedArticle,
    article_zh: articleZh,
    case_scenario_en: String(case_scenario_en).trim(),
    case_scenario_zh: String(case_scenario_zh).trim(),
    practical_application_en: String(practical_application_en).trim(),
    practical_application_zh: String(practical_application_zh).trim(),
    key_vocabulary: validVocab.map(({ term, pos, zh }) => ({ term, pos, zh })),
    simplified_en: simplifiedArticle,
    translation_zh: articleZh,
    vocab: validVocab.map(({ word, pos, zh }) => ({ word, pos, zh }))
  };
}

/**
 * L3 閱讀：依當前科目生成個案故事 + 臨床實務挑戰任務（表格化 O/A/I）
 */
const CASE_NOTE_READING_SYSTEM_PROMPT = `你是一位香港資深社會工作督導。請根據當前選擇的社工科目，先生成一篇約 180–220 字的 L3 英文個案故事（Case Note／個案情境），英文難度適合準備實習的社工學生。
內容必須嚴格貼合該科目核心與已注入的理論知識庫；若科目為社會工作倫理與價值，個案必須清楚呈現倫理兩難與道德抉擇的掙扎，並只隨機帶入 1–2 個背景元素，不要一次塞滿。

接著，請為社工學生設計一個『臨床實務挑戰任務 (Clinical Challenge Task)』，讓學生以 Observation／Assessment／Intervention 三欄實務紀錄表作答。
請絕對不要問能在文章中直接找到答案的表面問題（禁止 True/False、細節回憶、選詞填空等閱讀測驗式題目）。
請從以下三種任務焦點中『隨機挑選一種』來出題（作為引導方向，學生仍填寫 O／A／I 三欄）：

1. soap — SOAP 紀錄撰寫：引導學生把焦點放在 Assessment（評估）與 Plan／Intervention（介入計畫）。
2. theory_ethics — 理論與倫理批判：結合該科目的核心理論（如家庭系統、倫理六原則），引導學生檢視決策盲點並提出更好介入。
3. key_dialogue — 關鍵對話回應：擷取文章中案主最抗拒或情緒最高漲的一句話，引導學生撰寫同理與介入對話。

【客製化引導建議 guidance_zh — 必填】
必須根據已注入的科目理論知識庫，寫出一段親切、具體、可操作的繁體中文引導（約 1–3 句），放入 guidance_zh。
引導必須點名該科目至少一個理論／關鍵概念，並告訴學生在填表時該如何運用。
示例（長者服務）：「請運用積極老齡化觀點，分析案主在社會參與上的限制。」
示例（家庭社工）：「請留意三角關係與邊界，評估家庭互動如何維持症狀。」
禁止空泛套話（如「請認真作答」）；禁止與科目無關的理論。

【任務指令語氣】task_en 與 task_zh 為完整可獨立閱讀的任務說明（雙語對照），語氣像嚴格但具啟發性的督導。

請務必以 JSON 格式回傳：
{
  "case_note_en": "約 180–220 字的英文個案故事",
  "case_note_zh": "繁體中文翻譯",
  "task_type": "soap",
  "task_en": "英文任務指令（督導語氣）",
  "task_zh": "繁體中文任務指令（督導語氣）",
  "guidance_zh": "依科目理論客製化的親切引導建議（繁體中文，1–3 句）"
}
task_type 必須是 "soap"、"theory_ethics" 或 "key_dialogue" 其中之一。`;

/** L3 督導回饋 System Prompt（分欄 O/A/I + 詞彙修正；與 task-ui Submit 路徑對齊） */
const L3_SUPERVISION_FEEDBACK_SYSTEM_PROMPT = `你是一位社工督導，請針對學生撰寫的實務紀錄給予回饋，重點修正其英文文法與學術用詞，並給出臨床建議。

學生以 Observation／Assessment／Intervention 三欄完成臨床實務紀錄表。
請根據「個案文章（背景 Context）、任務提示、學生三欄英文答案」給予回饋。

回饋重點：
1. 對 Observation／Assessment／Intervention 各自評語：肯定可取之處，指出盲點、風險、倫理或理論應用不足。
2. Assessment 必須檢查是否連結該科目核心理論／關鍵概念。
3. Intervention 可給 1 句可操作的英文示範對話（若合適）。
4. Vocab Correction：列出 2–5 組可改進的詞彙或片語（口語→學術／更精確的社工英語）；若學生幾乎全中文，請建議對應英文專業用語。
5. 語氣像督導面談：直接、具體、親切鼓勵；禁止只說「很好」或複述文章。
6. 必須結合該科目核心理論／關鍵概念至少一點（寫入 feedback_zh）。

請以 JSON 回傳：
{
  "feedback_zh": "繁體中文總評（約 80–160 字）",
  "feedback_en": "Optional short English coaching note (2–4 sentences)",
  "field_feedback": {
    "observation": "對 Observation 的繁體中文評語",
    "assessment": "對 Assessment 的繁體中文評語",
    "intervention": "對 Intervention 的繁體中文評語"
  },
  "vocab_corrections": [
    {
      "original": "學生用詞或片語",
      "suggestion": "更合適的學術／社工英文",
      "note": "一句簡短說明（繁中或英皆可）"
    }
  ]
}`;

/**
 * 生成 L3 個案故事 + 臨床實務挑戰任務（含科目客製化引導）
 *
 * @returns {Promise<{case_note_en: string, case_note_zh: string, task_type: string, task_en: string, task_zh: string, guidance_zh: string, question_en: string, question_zh: string}>}
 */
async function generateCaseNoteReading() {
  const subject = resolveCurrentSubject();
  const knowledge = getSubjectKnowledge(subject.id);
  const theoryHint = knowledge
    ? [
        knowledge.theory_core,
        Array.isArray(knowledge.key_concepts)
          ? knowledge.key_concepts.slice(0, 3).join('、')
          : ''
      ]
        .filter(Boolean)
        .join('；')
    : '';

  const userContent =
    `請為科目「${subject.name}」生成一篇 L3 英文個案故事，並隨機挑選一種臨床實務挑戰焦點出題。` +
    `\n學生將以 Observation／Assessment／Intervention 三欄實務紀錄表作答。` +
    `\n請務必產出 guidance_zh：一段貼合本科目理論的親切引導建議。` +
    (theoryHint
      ? `\n本科目理論提示（請融入 guidance_zh）：${theoryHint}`
      : '');

  const result = await requestDeepSeekJSON(
    CASE_NOTE_READING_SYSTEM_PROMPT,
    userContent,
    4096,
    'challenge',
    { subjectId: subject.id }
  );

  const case_note_en = result.case_note_en;
  const case_note_zh = result.case_note_zh;
  // 相容舊欄位命名（若模型仍回 question_*）
  const task_en = result.task_en || result.question_en;
  const task_zh = result.task_zh || result.question_zh;
  const rawType = String(result.task_type || '').trim().toLowerCase();
  let guidance_zh = String(result.guidance_zh || '').trim();

  if (!case_note_en || !case_note_zh || !task_en || !task_zh) {
    throw new Error('AI 回傳資料不完整，缺少個案故事或臨床挑戰任務。');
  }

  const allowedTypes = ['soap', 'theory_ethics', 'key_dialogue'];
  const task_type = allowedTypes.includes(rawType) ? rawType : 'soap';

  const taskEn = String(task_en).trim();
  const taskZh = String(task_zh).trim();

  // 若模型漏掉 guidance，由知識庫組 fallback（前端亦會再兜底）
  if (!guidance_zh) {
    if (typeof buildFallbackGuidance === 'function') {
      guidance_zh = buildFallbackGuidance(knowledge, subject.name);
    } else if (theoryHint) {
      guidance_zh = `請運用「${theoryHint}」觀點，以 Observation → Assessment → Intervention 完成這份實務紀錄。`;
    } else {
      guidance_zh = taskZh;
    }
  }

  return {
    case_note_en: String(case_note_en).trim(),
    case_note_zh: String(case_note_zh).trim(),
    task_type,
    task_en: taskEn,
    task_zh: taskZh,
    guidance_zh,
    // 供舊 UI／呼叫端相容
    question_en: taskEn,
    question_zh: taskZh
  };
}

/**
 * L3：送出學生實務紀錄表（O/A/I JSON），取得督導分欄回饋
 *
 * @param {{
 *   caseNoteEn: string,
 *   caseNoteZh?: string,
 *   taskEn?: string,
 *   taskZh?: string,
 *   guidanceZh?: string,
 *   taskType?: string,
 *   studentAnswer?: string,
 *   clinicalAnswers?: {observation?: string, assessment?: string, intervention?: string}
 * }} payload
 * @returns {Promise<{
 *   feedback_zh: string,
 *   feedback_en: string,
 *   field_feedback: {observation: string, assessment: string, intervention: string},
 *   vocab_corrections: Array<{original: string, suggestion: string, note: string}>
 * }>}
 */
async function getL3SupervisionFeedbackAPI(payload) {
  const caseNoteEn = String(payload?.caseNoteEn || '').trim();
  const caseNoteZh = String(payload?.caseNoteZh || '').trim();
  const taskEn = String(payload?.taskEn || '').trim();
  const taskZh = String(payload?.taskZh || '').trim();
  const guidanceZh = String(payload?.guidanceZh || '').trim();
  const taskType = String(payload?.taskType || '').trim();

  const clinical = payload?.clinicalAnswers && typeof payload.clinicalAnswers === 'object'
    ? {
        observation: String(payload.clinicalAnswers.observation || '').trim(),
        assessment: String(payload.clinicalAnswers.assessment || '').trim(),
        intervention: String(payload.clinicalAnswers.intervention || '').trim()
      }
    : null;

  const legacyAnswer = String(payload?.studentAnswer || '').trim();
  const hasClinical =
    clinical &&
    (clinical.observation || clinical.assessment || clinical.intervention);

  if (!caseNoteEn) {
    throw new Error('缺少個案文章，無法請督導批改。');
  }
  if (!taskEn && !taskZh && !guidanceZh) {
    throw new Error('缺少任務題目，無法請督導批改。');
  }
  if (!hasClinical && !legacyAnswer) {
    throw new Error('請先填寫實務紀錄表再送出給督導。');
  }

  const subject = resolveCurrentSubject();
  const answersJson = hasClinical
    ? JSON.stringify(clinical, null, 2)
    : JSON.stringify({ free_response: legacyAnswer }, null, 2);

  const userContent = `科目：${subject.name}
任務類型：${taskType || '（未標示）'}

【個案文章 Case Note】
${caseNoteEn}
${caseNoteZh ? `\n（中文參考）\n${caseNoteZh}` : ''}

【臨床實務挑戰任務】
${taskEn || ''}
${taskZh ? `\n${taskZh}` : ''}
${guidanceZh ? `\n【科目客製引導】\n${guidanceZh}` : ''}

【學生實務紀錄表（JSON）】
${answersJson}

請分別對 Observation／Assessment／Intervention 給予評語，並提供 Vocab Correction。`;

  // Phase 11.7：寫作批改走 standard（與 task-ui Submit 一致）；文章生成才用 challenge
  const result = await requestDeepSeekJSON(
    L3_SUPERVISION_FEEDBACK_SYSTEM_PROMPT,
    userContent,
    4096,
    'standard',
    { subjectId: subject.id }
  );

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
 * 寫作練習：動態生成 L1 情境碎片或 L2 半完成句型
 *
 * @param {'l1'|'l2'} level - 寫作難度
 * @param {string} subjectName - 目前科目名稱
 * @returns {Promise<Array<{label_zh:string,fragments:string}>|Array<{label:string,blanks:number,placeholders:string[]}>>}
 *   L1：[{label_zh, fragments}, ...]；L2：[{label, blanks, placeholders}, ...]
 */
async function generateWritingPromptsAPI(level, subjectName) {
  const safeSubject = String(subjectName || '').trim() || '通用社工實務';
  const safeLevel = String(level || '').toLowerCase();

  if (safeLevel !== 'l1' && safeLevel !== 'l2') {
    throw new Error('不支援的寫作難度，僅接受 l1 或 l2。');
  }

  let systemPrompt;
  let userContent;

  if (safeLevel === 'l1') {
    systemPrompt = `你是社工英文寫作助教。請根據指定科目，生成 3 個全新的社工場景提示，供初學者點選練習。
每個情境必須包含：
1. label_zh：簡短繁體中文標籤（約 4–8 字，如「長者拒絕服藥」「案主情緒崩潰」）
2. fragments：逗號分隔的英文關鍵字碎片（約 3–5 個詞，不要寫完整句子）

主題必須貼近香港社工實務與該科目。

請務必以 JSON 格式回傳：
{
  "prompts": [
    {
      "label_zh": "案主憂鬱自殺風險",
      "fragments": "client, depressed, suicide risk"
    },
    {
      "label_zh": "家庭衝突肢體虐待",
      "fragments": "family, conflict, physical abuse"
    },
    {
      "label_zh": "長者拒絕服藥",
      "fragments": "elderly, refuse medicine, angry"
    }
  ]
}
prompts 必須剛好 3 筆，且彼此情境不重複。`;

    userContent =
      `請為社工科目「${safeSubject}」生成 3 個全新的 L1 情境（含中文標籤與英文碎片）。`;
  } else {
    systemPrompt = `你是社工英文寫作助教。請根據指定科目，生成 3 個全新的半完成英文句型，供學生填空練習。
每個句型必須剛好包含 2 個空白標記 ___（三個底線），不可多也不可少。
並為每個空白提供簡短英文提示 placeholders（與預設句型格式一致）。
句型須貼近香港社工個案紀錄／實務用語，難度適合社工學生。

請務必以 JSON 格式回傳：
{
  "prompts": [
    {
      "label": "The client feels ___ because ___.",
      "placeholders": ["feeling / emotion", "reason"]
    },
    {
      "label": "The client needs ___ in order to ___.",
      "placeholders": ["support / resource", "goal"]
    },
    {
      "label": "I will follow up with ___ to ensure ___.",
      "placeholders": ["person / agency", "outcome"]
    }
  ]
}
prompts 必須剛好 3 筆；每筆 label 必須剛好含 2 個 ___；placeholders 必須剛好 2 個字串。`;

    userContent =
      `請為社工科目「${safeSubject}」生成 3 個全新的 L2 半完成句型（每個剛好 2 個 ___，並附 placeholders）。`;
  }

  const result = await requestDeepSeekJSON(systemPrompt, userContent, 500);
  const rawPrompts = Array.isArray(result.prompts) ? result.prompts : [];

  if (safeLevel === 'l1') {
    const prompts = rawPrompts
      .filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof item.label_zh === 'string' &&
          item.label_zh.trim() &&
          typeof item.fragments === 'string' &&
          item.fragments.trim()
      )
      .map((item) => ({
        label_zh: String(item.label_zh).trim(),
        fragments: String(item.fragments).trim()
      }))
      .slice(0, 3);

    if (prompts.length < 3) {
      throw new Error('AI 回傳的寫作提示不足 3 筆，請再試一次。');
    }

    return prompts;
  }

  // L2：正規化空白標記，並組裝與預設一致的句型物件
  const prompts = rawPrompts
    .map((item) => {
      // 相容舊格式（純字串）與新格式（物件）
      let label = '';
      let placeholders = [];

      if (typeof item === 'string') {
        label = item.trim();
      } else if (item && typeof item === 'object') {
        label = typeof item.label === 'string' ? item.label.trim() : '';
        if (Array.isArray(item.placeholders)) {
          placeholders = item.placeholders
            .filter((p) => typeof p === 'string' && p.trim())
            .map((p) => p.trim());
        }
      }

      if (!label) return null;

      // 將連續 2 個以上底線統一成 ___，避免 AI 用 ____ / __ 導致空白數算錯
      const normalizedLabel = label.replace(/_{2,}/g, '___');
      const blankCount = (normalizedLabel.match(/___/g) || []).length;

      if (blankCount < 1) return null;

      // placeholders 數量對齊空白數；不足則補預設提示
      const finalPlaceholders = [];
      for (let i = 0; i < blankCount; i++) {
        finalPlaceholders.push(placeholders[i] || `blank ${i + 1}`);
      }

      return {
        label: normalizedLabel,
        blanks: blankCount,
        placeholders: finalPlaceholders
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  if (prompts.length < 3) {
    throw new Error('AI 回傳的寫作提示不足 3 筆，請再試一次。');
  }

  // 與預設多數句型一致：每個句型必須剛好 2 個空白
  const invalidBlank = prompts.filter((p) => p.blanks !== 2);
  if (invalidBlank.length > 0) {
    throw new Error('AI 回傳的句型空白數量不正確，請再試一次。');
  }

  return prompts;
}

/**
 * 詞彙庫：依科目生成 3 個不重複的進階專業單字
 *
 * @param {string} subjectName - 目前科目名稱
 * @param {string[]} existingTerms - 既有單字清單（避免重複）
 * @returns {Promise<Array<{term:string,pos:string,translation_zh:string,definition_en:string,example_en:string,example_zh:string,common_mistake:string}>>}
 */
async function generateNewVocabAPI(subjectName, existingTerms) {
  const safeSubject = String(subjectName || '').trim() || '通用社工實務';
  const termList = Array.isArray(existingTerms)
    ? existingTerms
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim())
    : [];

  const existingText = termList.length > 0 ? termList.join(', ') : '(目前清單為空)';

  const systemPrompt = `你是社工專業英文詞彙助教。請根據指定科目，生成 3 個進階的專業英文單字。
這三個單字不能出現在使用者提供的既有清單中。
每個單字必須包含完整欄位，格式須與詞庫 JSON 一致。

請務必以 JSON 格式回傳：
{
  "terms": [
    {
      "term": "英文單字",
      "pos": "n.",
      "translation_zh": "繁體中文翻譯",
      "definition_en": "簡單英文定義",
      "example_en": "社工情境英文例句",
      "example_zh": "例句繁體中文翻譯",
      "common_mistake": "常見錯誤提醒（繁體中文）"
    }
  ]
}
terms 必須剛好 3 筆；pos 可用 n. / v. / adj. / adv. 等簡短標記。`;

  const userContent =
    `請根據社工科目「${safeSubject}」，生成 3 個進階的專業英文單字。` +
    `這三個單字不能包含在以下清單中：[${existingText}]。` +
    `請嚴格按照現有詞庫的 JSON 格式回傳，包含 term, pos, translation_zh, definition_en, example_en, example_zh, common_mistake 欄位。`;

  const result = await requestDeepSeekJSON(systemPrompt, userContent, 1200);
  const rawTerms = Array.isArray(result.terms) ? result.terms : [];

  const existingLower = new Set(termList.map((t) => t.toLowerCase()));

  const validTerms = rawTerms
    .filter(
      (item) =>
        item &&
        typeof item.term === 'string' &&
        item.term.trim() &&
        typeof item.translation_zh === 'string' &&
        item.translation_zh.trim() &&
        typeof item.definition_en === 'string' &&
        item.definition_en.trim()
    )
    .map((item) => ({
      term: String(item.term).trim(),
      pos: typeof item.pos === 'string' && item.pos.trim() ? item.pos.trim() : 'n.',
      translation_zh: String(item.translation_zh).trim(),
      definition_en: String(item.definition_en).trim(),
      example_en:
        typeof item.example_en === 'string' ? item.example_en.trim() : '',
      example_zh:
        typeof item.example_zh === 'string' ? item.example_zh.trim() : '',
      common_mistake:
        typeof item.common_mistake === 'string' ? item.common_mistake.trim() : ''
    }))
    .filter((item) => !existingLower.has(item.term.toLowerCase()))
    .slice(0, 3);

  if (validTerms.length < 3) {
    throw new Error('AI 回傳的新詞彙不足 3 個（或與既有詞重複），請再試一次。');
  }

  return validTerms;
}

/**
 * Phase 13.1：L0 極簡單字／短句測驗（5 題，英選中／中選英）
 *
 * @param {string} subjectName
 * @param {string} [subjectId]
 * @param {string} [wishText]
 * @returns {Promise<Array<{
 *   id: number,
 *   type: 'en_to_zh'|'zh_to_en',
 *   prompt: string,
 *   options: string[],
 *   correctIndex: number,
 *   hint_zh?: string
 * }>>}
 */
async function generateL0VocabQuizAPI(subjectName, subjectId, wishText) {
  const safeSubject = String(subjectName || '').trim() || '通用社工實務';
  const wish = String(wishText || '').trim();

  const systemPrompt = `你是香港社工系的溫柔英文助教，專門為初學者設計「零挫折」單字測驗。
請產出剛好 5 題極簡單字或極短句選擇題，難度必須非常低（日常社工場域常見詞，避免生僻術語）。
題型須混合：英文選中文（en_to_zh）、中文選英文（zh_to_en）。
每題 4 個選項，只有一個正確；干擾項也要合理但明顯不同。

必須回傳純 JSON：
{
  "questions": [
    {
      "type": "en_to_zh",
      "prompt": "題幹（英文單字／短句或中文）",
      "options": ["選項A", "選項B", "選項C", "選項D"],
      "correctIndex": 0,
      "hint_zh": "一句溫柔提示（繁中）"
    }
  ]
}
rules:
- questions 必須剛好 5 題
- type 只能是 en_to_zh 或 zh_to_en（兩者都要出現）
- correctIndex 為 0–3 整數
- options 必須剛好 4 個字串
- 全部文字用語適合香港／台灣繁體中文學習者`;

  const userContent =
    `科目：「${safeSubject}」。` +
    (wish ? `學習者願望／目標：「${wish}」。` : '') +
    `請生成 5 題與該科目相關、極低門檻的單字或極短句測驗（英選中與中選英混合）。`;

  const result = await requestDeepSeekJSON(
    systemPrompt,
    userContent,
    1400,
    'standard',
    { subjectId: subjectId || null, temperature: 0.6 }
  );

  const raw = Array.isArray(result.questions) ? result.questions : [];
  const questions = raw
    .map((q, index) => {
      if (!q || typeof q !== 'object') return null;
      const type =
        q.type === 'zh_to_en' || q.type === 'en_to_zh' ? q.type : null;
      const prompt = String(q.prompt || '').trim();
      const options = Array.isArray(q.options)
        ? q.options.map((o) => String(o || '').trim()).filter(Boolean)
        : [];
      let correctIndex = Number(q.correctIndex);
      if (!type || !prompt || options.length < 4) return null;
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
        correctIndex = 0;
      }
      // 正規化為剛好 4 選項
      const four = options.slice(0, 4);
      while (four.length < 4) four.push(`（選項 ${four.length + 1}）`);
      if (correctIndex >= four.length) correctIndex = 0;

      return {
        id: index + 1,
        type,
        prompt,
        options: four,
        correctIndex,
        hint_zh:
          typeof q.hint_zh === 'string' && q.hint_zh.trim()
            ? q.hint_zh.trim()
            : '再想一想，你可以的！'
      };
    })
    .filter(Boolean)
    .slice(0, 5);

  if (questions.length < 5) {
    throw new Error('AI 回傳的 L0 題目不足 5 題，請再試一次。');
  }

  // 確保兩種題型都有
  const hasEn = questions.some((q) => q.type === 'en_to_zh');
  const hasZh = questions.some((q) => q.type === 'zh_to_en');
  if (!hasEn || !hasZh) {
    // 輕量修正：交替標記（不改答案內容）
    questions.forEach((q, i) => {
      q.type = i % 2 === 0 ? 'en_to_zh' : 'zh_to_en';
    });
  }

  return questions;
}

/**
 * 文章庫 AI 深度挑戰：依文本（文獻或故事）生成 MCQ + 情境反思測驗
 */
const ARTICLE_CHALLENGE_SYSTEM_PROMPT = `你是一位嚴格的香港社會工作系教授。請根據我提供的文本（可能是學術文獻或實務故事），設計一份英文測驗卷。
必須回傳純 JSON 格式：
{
  "mcq": {
    "question": "針對文本核心概念或情境細節的英文選擇題...",
    "options": ["A選項", "B選項", "C選項", "D選項"],
    "correct_index": 0,
    "explanation": "中文解析：必須明確引用本科目一個核心理論／關鍵概念來支撐為何選此答案（例：本題涉及家庭系統理論中的三角關係…）"
  },
  "scenario_reflection": {
    "question": "針對文本中的案例，提出一個進階的實務挑戰問題 (英文)。請結合香港社工實務語境...",
    "reference_answer": "中文參考解答：必須結合本科目核心理論框架給出可操作的督導級分析"
  }
}
規則：
1. mcq.question 與 mcq.options 必須為英文；explanation 必須為繁體中文。
2. options 必須剛好 4 個選項；correct_index 為 0–3 的整數。
3. scenario_reflection.question 必須為英文，並盡量結合香港前線社工實務語境（如家訪、轉介、保密與知情同意等）；reference_answer 必須為繁體中文。
4. 題目必須緊扣所提供文本內容，不可憑空捏造無關理論或情節。
5. 若文本為短篇故事，選擇題應聚焦情境細節與專業判斷；若為學術文獻，可聚焦理論概念與案例應用。
6. 【學理引用強制】explanation 與 reference_answer 必須明確點出至少一個核心理論或關鍵概念名稱，並用一句話說明其如何支撐判斷；禁止只寫「因為文本提到…」而無理論支撐。`;

/**
 * 依文章內容生成 AI 深度挑戰測驗卷
 *
 * @param {string} articleContext - 文獻摘要／情境或故事全文
 * @param {string} [taskType='challenge'] - 模型路由（預設 Pro + thinking）
 * @param {string|null} [subjectId=null] - 科目 ID；供理論知識注入
 * @returns {Promise<{
 *   mcq: {question: string, options: string[], correct_index: number, explanation: string},
 *   scenario_reflection: {question: string, reference_answer: string}
 * }>}
 */
async function generateArticleChallengeAPI(
  articleContext,
  taskType = 'challenge',
  subjectId = null
) {
  const context = String(articleContext || '').trim();
  if (!context) {
    throw new Error('文章內容為空，無法生成深度挑戰。');
  }

  const userContent =
    `請根據以下文本設計測驗卷（文本可能是學術文獻或社工實務故事）：\n\n${context}`;

  const resolvedSubjectId = subjectId
    ? normalizeSubjectId(subjectId)
    : resolveCurrentSubject().id;

  // AI 深度挑戰：Pro + thinking；max_tokens 需預留 reasoning，否則 content 常為空
  const result = await requestDeepSeekJSON(
    ARTICLE_CHALLENGE_SYSTEM_PROMPT,
    userContent,
    4096,
    taskType || 'challenge',
    { subjectId: resolvedSubjectId }
  );

  const mcq = result && result.mcq;
  const reflection = result && result.scenario_reflection;

  if (
    !mcq ||
    typeof mcq.question !== 'string' ||
    !mcq.question.trim() ||
    !Array.isArray(mcq.options) ||
    typeof mcq.explanation !== 'string' ||
    !mcq.explanation.trim() ||
    !reflection ||
    typeof reflection.question !== 'string' ||
    !reflection.question.trim() ||
    typeof reflection.reference_answer !== 'string' ||
    !reflection.reference_answer.trim()
  ) {
    throw new Error('AI 回傳資料不完整，缺少選擇題或反思題欄位。');
  }

  const options = mcq.options
    .filter((opt) => typeof opt === 'string' && opt.trim())
    .map((opt) => opt.trim())
    .slice(0, 4);

  if (options.length !== 4) {
    throw new Error('AI 回傳的選擇題選項數量不正確，請再試一次。');
  }

  let correctIndex = Number(mcq.correct_index);
  if (
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex > 3
  ) {
    throw new Error('AI 回傳的正確答案索引無效，請再試一次。');
  }

  return {
    mcq: {
      question: String(mcq.question).trim(),
      options,
      correct_index: correctIndex,
      explanation: String(mcq.explanation).trim()
    },
    scenario_reflection: {
      question: String(reflection.question).trim(),
      reference_answer: String(reflection.reference_answer).trim()
    }
  };
}

/**
 * L2 文獻搜尋：依科目批次生成推薦中英雙語關鍵字／詞組（供標籤快取池補充）
 *
 * @param {string} subjectName - 目前科目名稱
 * @param {string[]} [excludeTags=[]] - 已出現過的英文關鍵字黑名單（換一組時排除）
 * @returns {Promise<Array<{en: string, zh: string}>>} suggested_tags 陣列（目標 12 筆，至少 4 筆）
 */
async function generateLiteratureTagsAPI(subjectName, excludeTags = []) {
  const safeSubject = String(subjectName || '').trim() || '通用社工實務';
  const excludeList = Array.isArray(excludeTags)
    ? excludeTags.map((t) => String(t || '').trim()).filter(Boolean)
    : [];

  const systemPrompt = `你是一位社工系教授。使用者正在學習科目「${safeSubject}」，準備搜尋相關的學術文獻。
請提供 12 個高度相關且具備學術價值的專業關鍵字/詞組。

⚠️ 【極度重要限制】：
1. 關鍵字必須緊扣「${safeSubject}」的科目核心，不可飄到無關領域。
2. 若科目為社會工作倫理與價值，關鍵字必須圍繞 ethical dilemma、ethical decision-making、autonomy、confidentiality、informed consent、paternalism 等倫理兩難與道德抉擇概念；香港法例、SWRB、宗教、華人價值等僅作可選面向，不要每次都全塞。
3. 可在該科目核心內探索不同面向以保持多樣性，但不可改成其他社工科目主題。
4. 絕對不可使用以下已經出現過的關鍵字：[${excludeList.join(', ')}]。請提供完全不同的新詞彙！

請強制以 JSON 格式回傳，格式如下：
{
  "suggested_tags": [
    {"en": "英文關鍵字", "zh": "繁體中文翻譯"},
    {"en": "英文關鍵字", "zh": "繁體中文翻譯"}
  ]
}`;

  const userContent =
    `請為社工科目「${safeSubject}」提供 12 個適合 OpenAlex／學術資料庫搜尋的專業關鍵字（含英文與繁體中文翻譯）。關鍵字必須緊扣該科目核心，不可離題。` +
    (excludeList.length > 0
      ? `\n請務必避開這些已出現過的關鍵字：${excludeList.join(', ')}。`
      : '');

  const result = await requestDeepSeekJSON(systemPrompt, userContent, 700);
  const rawTags = Array.isArray(result.suggested_tags) ? result.suggested_tags : [];

  const tags = rawTags
    .map((tag) => {
      if (tag && typeof tag === 'object') {
        const en = String(tag.en || '').trim();
        const zh = String(tag.zh || '').trim();
        return en ? { en, zh: zh || en } : null;
      }
      // 相容舊格式：純字串視為英文關鍵字
      if (typeof tag === 'string' && tag.trim()) {
        const en = tag.trim();
        return { en, zh: en };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, 12);

  if (tags.length < 4) {
    throw new Error('AI 回傳的推薦關鍵字不足，請再試一次。');
  }

  return tags;
}

/**
 * 獎勵系統：滿卡後由資深社工督導生成溫暖祝賀信（英文＋中文）
 *
 * @param {number} totalDays - 挑戰天數
 * @param {string} rewardGoal - 使用者自訂獎勵
 * @param {string} [taskType='ultimate_celebration'] - 模型路由（預設 Pro）
 * @returns {Promise<{message_en: string, message_zh: string}>}
 */
async function generateCelebrationLetterAPI(
  totalDays,
  rewardGoal,
  taskType = 'ultimate_celebration'
) {
  const days = Math.max(1, Number(totalDays) || 1);
  const goal = String(rewardGoal || '').trim() || 'a well-deserved reward';

  const systemPrompt = `使用者經過 ${days} 天的努力，完成了社工英文的學習挑戰，他給自己的獎勵是 ${goal}。請扮演一位資深的社工督導，寫一段溫暖、肯定且帶有專業社工價值的英文祝賀信，並附上中文翻譯。字數 100 字以內。

請務必以 JSON 格式回傳：
{
  "message_en": "英文祝賀信（約 100 字以內）",
  "message_zh": "對應的繁體中文翻譯"
}`;

  const userContent =
    `請為完成 ${days} 天社工英文學習挑戰、自訂獎勵為「${goal}」的學生撰寫督導祝賀信。`;

  // 滿卡慶祝：動用 Pro；不注入科目鎖定前綴，避免祝賀信被科目主題綁架
  const result = await requestDeepSeekJSON(
    systemPrompt,
    userContent,
    350,
    taskType,
    { skipSubjectContext: true, temperature: 0.8 }
  );

  const message_en = String(result.message_en || '').trim();
  const message_zh = String(result.message_zh || '').trim();

  if (!message_en || !message_zh) {
    throw new Error('AI 回傳資料不完整，缺少祝賀信內容。');
  }

  return { message_en, message_zh };
}

/* ============================================================
   Phase 11.8：雙軌互動文章（段落穿插測驗 + 漸進寫作題）
   ============================================================ */

/** 共用 JSON 契約說明（嵌入兩軌 system prompt） */
const INTERACTIVE_PRACTICE_JSON_CONTRACT = `
請務必以 JSON 格式回傳（不可省略欄位）：
{
  "title_en": "文章英文標題",
  "title_zh": "文章中文標題",
  "vocabulary": [
    { "term": "英文專有名詞", "zh": "繁體中文", "part_of_speech": "n." }
  ],
  "content_chunks": [
    {
      "paragraph_en": "本段英文（約 60–120 字）",
      "paragraph_zh": "本段繁體中文意譯",
      "inline_quiz": {
        "question": "針對本段的閱讀理解選擇題（英文）",
        "options": ["選項A全文", "選項B全文", "選項C全文", "選項D全文"],
        "correct_answer": "A",
        "explanation": "繁體中文詳解，必須引述該科目理論／關鍵概念"
      }
    }
  ],
  "writing_tasks": {
    "l1_cloze": {
      "instruction": "請填入適當的臨床/學術單字：",
      "sentence_zh": "中文提示句",
      "sentence_en_template": "English sentence with one _______ blank.",
      "answer": "defense"
    },
    "l2_sentence": {
      "instruction": "請將以下臨床情境/學術論述翻譯成適當的英文：",
      "prompt_zh": "中文造句提示",
      "suggested_answer": "Suggested full English sentence."
    }
  },
  "task_instruction": "給 L3 專業寫作表單的繁體中文引導（1–3 句，須點名科目理論）"
}
硬性規則：
1. content_chunks 必須剛好 3 或 4 段；每一段都要有完整 inline_quiz。
2. inline_quiz.options 必須剛好 4 個字串；correct_answer 用 "A"|"B"|"C"|"D"（對應 options 第 1–4 項）。
3. vocabulary 必須提供足夠的進階專有名詞／片語（數量以 user 訊息指定為準；含多詞片語）。
   - 每一個 term 都必須「原樣出現」在至少一段 paragraph_en 中（大小寫可不同）。
   - 密度高時：寧可多列文中實詞／片語，目標是覆蓋段落中絕大多數社工、臨床、學術內容詞（勿只給 5–10 個）。
4. 每一個 content_chunk 另可（高密度時必須）附上 highlight_terms：
   "highlight_terms": [{ "term": "文中原樣英文", "zh": "繁中" }, ...]
   請把該段幾乎所有專業／學術／臨床用詞與片語都列入（功能詞如 the/a/is/to 除外）。
5. writing_tasks.l1_cloze 的 sentence_en_template 必須含 _______；answer 為應填單字（可為片語）。
6. explanation 與 task_instruction 必須結合已注入的科目理論知識庫，禁止空泛套話。
7. 中文須為自然繁體、避免翻譯腔。`;

const INTERACTIVE_STORY_SYSTEM_PROMPT =
  `你是一位香港資深社會工作督導兼英文教師。請依當前科目生成一篇「社工小故事／個案情境」互動閱讀教材。` +
  `\n語氣專業、客觀，符合香港社工實務脈絡；拒絕煽情。` +
  `\n文章切成 3–4 段，每段後附即時閱讀選擇題；並一併產出 L1 填空與 L2 造句寫作題。` +
  INTERACTIVE_PRACTICE_JSON_CONTRACT;

const INTERACTIVE_LITERATURE_SYSTEM_PROMPT =
  `你是一位社工學術寫作教練。請依當前科目生成一篇「模擬學術文獻／理論短文」互動閱讀教材（IMRaD 或理論應用口吻均可）。` +
  `\n這是教學模擬文獻，非真實出版論文；用語須學術、嚴謹。` +
  `\n文章切成 3–4 段，每段後附即時閱讀選擇題；並一併產出 L1 填空與 L2 造句寫作題。` +
  INTERACTIVE_PRACTICE_JSON_CONTRACT;

/**
 * 正規化互動文章 JSON（雙軌共用）
 * @param {Object} result
 * @param {'story'|'literature'} track
 * @returns {Object}
 */
function normalizeInteractivePracticeArticle(result, track) {
  if (!result || typeof result !== 'object') {
    throw new Error('AI 回傳資料格式無效。');
  }

  const title_en = String(result.title_en || '').trim();
  const title_zh = String(result.title_zh || '').trim();
  if (!title_en) {
    throw new Error('AI 回傳資料不完整，缺少文章標題。');
  }

  const rawVocab = Array.isArray(result.vocabulary) ? result.vocabulary : [];
  const vocabulary = rawVocab
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const term = String(item.term || item.word || '').trim();
      const zh = String(item.zh || '').trim();
      const part_of_speech = String(
        item.part_of_speech || item.pos || ''
      ).trim();
      if (!term || !zh) return null;
      return { term, zh, part_of_speech };
    })
    .filter(Boolean);

  const rawChunks = Array.isArray(result.content_chunks)
    ? result.content_chunks
    : [];
  const content_chunks = rawChunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return null;
      const paragraph_en = String(chunk.paragraph_en || '').trim();
      const paragraph_zh = String(chunk.paragraph_zh || '').trim();
      const quiz = chunk.inline_quiz && typeof chunk.inline_quiz === 'object'
        ? chunk.inline_quiz
        : null;
      if (!paragraph_en || !quiz) return null;

      let options = Array.isArray(quiz.options)
        ? quiz.options.map((o) => String(o || '').trim()).filter(Boolean)
        : [];
      if (options.length > 4) options = options.slice(0, 4);
      if (options.length < 4) return null;

      let correct_answer = String(quiz.correct_answer || '').trim();
      const letter = correct_answer.toUpperCase();
      if (/^[A-D]$/.test(letter)) {
        correct_answer = letter;
      } else {
        const idx = options.findIndex(
          (o) => o.toLowerCase() === correct_answer.toLowerCase()
        );
        correct_answer = idx >= 0 ? String.fromCharCode(65 + idx) : 'A';
      }

      const highlight_terms = Array.isArray(chunk.highlight_terms)
        ? chunk.highlight_terms
            .map((t) => {
              if (!t || typeof t !== 'object') return null;
              const term = String(t.term || t.word || '').trim();
              const zh = String(t.zh || '').trim();
              if (!term || !zh) return null;
              return { term, zh, part_of_speech: '' };
            })
            .filter(Boolean)
        : [];

      return {
        paragraph_en,
        paragraph_zh,
        highlight_terms,
        inline_quiz: {
          question: String(quiz.question || '').trim(),
          options,
          correct_answer,
          explanation: String(quiz.explanation || '').trim()
        }
      };
    })
    .filter(Boolean);

  if (content_chunks.length < 3) {
    throw new Error('AI 回傳的段落不足（需要 3–4 段含測驗）。');
  }

  // 合併各段 highlight_terms 進 vocabulary（去重，擴充藍字覆蓋）
  const vocabByKey = new Map();
  vocabulary.forEach((v) => {
    const key = String(v.term || '').toLowerCase();
    if (key) vocabByKey.set(key, v);
  });
  content_chunks.forEach((chunk) => {
    (chunk.highlight_terms || []).forEach((t) => {
      const key = String(t.term || '').toLowerCase();
      if (key && !vocabByKey.has(key)) {
        vocabByKey.set(key, t);
      }
    });
  });
  const mergedVocabulary = Array.from(vocabByKey.values());

  const wt = result.writing_tasks && typeof result.writing_tasks === 'object'
    ? result.writing_tasks
    : {};
  const cloze = wt.l1_cloze && typeof wt.l1_cloze === 'object' ? wt.l1_cloze : {};
  const sentence =
    wt.l2_sentence && typeof wt.l2_sentence === 'object' ? wt.l2_sentence : {};

  const l1_cloze = {
    instruction: String(cloze.instruction || '請填入適當的臨床/學術單字：').trim(),
    sentence_zh: String(cloze.sentence_zh || '').trim(),
    sentence_en_template: String(cloze.sentence_en_template || '').trim(),
    answer: String(cloze.answer || '').trim()
  };
  const l2_sentence = {
    instruction: String(
      sentence.instruction || '請將以下內容翻譯成適當的英文：'
    ).trim(),
    prompt_zh: String(sentence.prompt_zh || '').trim(),
    suggested_answer: String(sentence.suggested_answer || '').trim()
  };

  if (!l1_cloze.sentence_en_template || !l1_cloze.answer) {
    throw new Error('AI 回傳缺少 L1 填空寫作題。');
  }
  if (!l2_sentence.prompt_zh || !l2_sentence.suggested_answer) {
    throw new Error('AI 回傳缺少 L2 造句寫作題。');
  }

  const task_instruction = String(
    result.task_instruction || result.guidance_zh || ''
  ).trim();

  return {
    track: track === 'literature' ? 'literature' : 'story',
    type: 'practice',
    title_en,
    title_zh: title_zh || title_en,
    vocabulary: mergedVocabulary,
    content_chunks: content_chunks.slice(0, 4),
    writing_tasks: { l1_cloze, l2_sentence },
    task_instruction
  };
}

/**
 * 依目前藍色單字密度推算 vocabulary 建議數量
 * 密度＝約略覆蓋全文「內容詞」的比例；100% 時要求高覆蓋（約 40–60 詞）
 * @returns {{min: number, max: number, density: number}}
 */
function resolveVocabCountByDensity() {
  const density =
    typeof getVocabHighlightDensity === 'function'
      ? getVocabHighlightDensity()
      : 70;
  const pct = Math.max(0, Math.min(100, Number(density) || 70));
  // 0%→約 10–14；50%→約 25–32；100%→約 45–60（盡量覆蓋全文專業詞）
  const max = Math.max(12, Math.round(12 + (pct / 100) * 48)); // 12–60
  const min = Math.max(10, Math.round(max * 0.75));
  return { min, max, density: pct };
}

/**
 * 組出密度相關的 vocabulary／highlight 指示句
 * @param {{min: number, max: number, density: number}} opts
 * @returns {string}
 */
function buildVocabDensityInstruction(opts) {
  const { min, max, density } = opts;
  let extra = '';
  if (density >= 90) {
    extra =
      `\n【高密度要求】藍色單字密度 ${density}%：請盡量把各段 paragraph_en 中的社工／臨床／學術內容詞與片語都列入 vocabulary，` +
      `並在每一段 content_chunks 附上豐富的 highlight_terms。` +
      `目標是讀者瀏覽英文時，絕大部分專業用語皆可標藍（排除 the/a/an/is/are/to/of/and 等功能詞）。` +
      `宁可多列，勿只給少數幾個。`;
  } else if (density >= 50) {
    extra =
      `\n【中密度】請讓 vocabulary + 各段 highlight_terms 合計約能覆蓋文中一半以上的專業內容詞。`;
  }
  return (
    `\n目前使用者設定藍色單字密度約 ${density}%（= 約略覆蓋全文內容詞的比例）。` +
    `\nvocabulary 請列出至少 ${min}–${max} 個文中實際出現的專有名詞／片語（含多詞）。` +
    `\n每一段請附 highlight_terms（該段專業詞／片語 + 繁中），密度越高 highlight_terms 越多。` +
    extra
  );
}

/**
 * Phase 11.8：生成互動社工小故事（段落測驗 + 寫作題）
 * @returns {Promise<Object>}
 */
async function generateInteractiveStoryAPI() {
  const subject = resolveCurrentSubject();
  const themes = getL1StoryThemes(subject.id);
  const theme = themes[Math.floor(Math.random() * themes.length)];
  const taskType =
    normalizeSubjectId(subject.id) === 'ethics_and_values' ? 'ethics' : 'story';
  const densityOpts = resolveVocabCountByDensity();

  const userContent =
    `請為科目「${subject.name}」生成一篇互動社工小故事教材。` +
    `\n主題方向：${theme}` +
    `\n必須輸出 3–4 個 content_chunks（每段含 inline_quiz），以及 writing_tasks。` +
    buildVocabDensityInstruction(densityOpts);

  const result = await requestDeepSeekJSON(
    INTERACTIVE_STORY_SYSTEM_PROMPT,
    userContent,
    densityOpts.density >= 80 ? 10000 : 8192,
    taskType,
    { subjectId: subject.id }
  );

  return normalizeInteractivePracticeArticle(result, 'story');
}

/**
 * Phase 11.8：生成互動模擬學術文獻（段落測驗 + 寫作題）
 * @returns {Promise<Object>}
 */
async function generateInteractiveLiteratureAPI() {
  const subject = resolveCurrentSubject();
  const knowledge = getSubjectKnowledge(subject.id);
  const theoryHint = knowledge
    ? [
        knowledge.theory_core,
        Array.isArray(knowledge.key_concepts)
          ? knowledge.key_concepts.slice(0, 3).join('、')
          : ''
      ]
        .filter(Boolean)
        .join('；')
    : '';

  const densityOpts = resolveVocabCountByDensity();

  const userContent =
    `請為科目「${subject.name}」生成一篇互動模擬學術文獻教材。` +
    (theoryHint ? `\n理論焦點：${theoryHint}` : '') +
    `\n必須輸出 3–4 個 content_chunks（每段含 inline_quiz），以及 writing_tasks。` +
    buildVocabDensityInstruction(densityOpts) +
    `\n文體須像教學用模擬論文／理論短文，並在適處加學術免責意識（不必另開欄位）。`;

  const result = await requestDeepSeekJSON(
    INTERACTIVE_LITERATURE_SYSTEM_PROMPT,
    userContent,
    densityOpts.density >= 80 ? 10000 : 8192,
    'literature',
    { subjectId: subject.id }
  );

  return normalizeInteractivePracticeArticle(result, 'literature');
}

// 明確掛到 window，避免快取／作用域問題導致其他模組找不到函式
window.generateL1Story = generateL1Story;
window.generateInteractiveStoryAPI = generateInteractiveStoryAPI;
window.generateInteractiveLiteratureAPI = generateInteractiveLiteratureAPI;
window.normalizeInteractivePracticeArticle = normalizeInteractivePracticeArticle;
window.callDeepSeekAPI = callDeepSeekAPI;
window.callL2WritingAPI = callL2WritingAPI;
window.callL3WritingAPI = callL3WritingAPI;
window.simplifyAbstractAPI = simplifyAbstractAPI;
window.generateSimulatedLiteratureAPI = generateSimulatedLiteratureAPI;
window.expandLiteratureFromAbstractAPI = expandLiteratureFromAbstractAPI;
window.buildExpandLiteratureSystemPrompt = buildExpandLiteratureSystemPrompt;
window.generateCaseNoteReading = generateCaseNoteReading;
window.getL3SupervisionFeedbackAPI = getL3SupervisionFeedbackAPI;
window.generateWritingPromptsAPI = generateWritingPromptsAPI;
window.generateNewVocabAPI = generateNewVocabAPI;
window.generateL0VocabQuizAPI = generateL0VocabQuizAPI;
window.generateLiteratureTagsAPI = generateLiteratureTagsAPI;
window.generateArticleChallengeAPI = generateArticleChallengeAPI;
window.generateCelebrationLetterAPI = generateCelebrationLetterAPI;
window.callDeepSeekChatAPI = callDeepSeekChatAPI;
window.resolveDeepSeekRouting = resolveDeepSeekRouting;
window.stripThinkTags = stripThinkTags;
window.STORAGE_KEY_SUBJECT = STORAGE_KEY_SUBJECT;
window.withSubjectContext = withSubjectContext;
window.SUBJECT_ID_ALIASES = SUBJECT_ID_ALIASES;
window.normalizeSubjectId = normalizeSubjectId;
window.resolveCurrentSubject = resolveCurrentSubject;
window.loadSubjectsKnowledge = loadSubjectsKnowledge;
window.getSubjectKnowledge = getSubjectKnowledge;
window.getTheoryBySubject = getTheoryBySubject;

// 系統初始化：載入科目理論知識庫（供後續無痕注入）
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadSubjectsKnowledge();
    });
  } else {
    loadSubjectsKnowledge();
  }
} else {
  loadSubjectsKnowledge();
}
