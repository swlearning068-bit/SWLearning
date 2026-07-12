/**
 * deepseek.js — DeepSeek API 呼叫封裝
 *
 * 職責：
 * 1. 從 localStorage 讀取 API Key
 * 2. 組裝 System Prompt 與使用者訊息（支援動態科目附加提示）
 * 3. 發送 fetch 請求並強制回傳 JSON 格式
 * 4. 解析並回傳結構化結果（寫作 L1/L2/L3 / 閱讀 L1/L2/L3）
 */

// localStorage 中用來儲存 API Key 的鍵名（與 app.js 保持一致）
const STORAGE_KEY_API = 'swlearning_deepseek_api_key';

/** localStorage：目前選擇的社工科目 ID */
const STORAGE_KEY_SUBJECT = 'swlearning_current_subject';

// DeepSeek API 端點（OpenAI 相容格式）
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// 使用的模型名稱
const DEEPSEEK_MODEL = 'deepseek-chat';

/** 找不到科目時的通用社工場景（防呆） */
const DEFAULT_SUBJECT = {
  id: 'general_practice',
  name: '通用社工實務',
  prompt_context:
    '此情境為香港通用社工實務，請使用 casework, home visit, resource referral, follow-up 等前線社工日常專有名詞。'
};

/** 舊科目 ID → 新科目 ID（避免 localStorage 殘留導致選錯科） */
const SUBJECT_ID_ALIASES = {
  ethics: 'ethics_and_values'
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
 * L1 閱讀故事的 System Prompt
 * 要求：高度專業 Case Vignette、300–450 字、學術術語、香港脈絡、強制 JSON（含關鍵字與例句）
 */
const L1_STORY_SYSTEM_PROMPT = `你是一位具備高度學術素養的香港資深社會工作督導。請根據所選的科目與情境，生成一篇**高度專業、細節豐富的社工個案情境故事 (Case Vignette)**。

⚠️ 最高優先：故事主題必須嚴格符合開頭的「科目鎖定」要求，不可寫成與該科目無關的一般日常敘事。
若科目為社會工作倫理與價值，故事核心必須清楚呈現社工倫理兩難與道德抉擇的掙扎（例如保密 vs 舉報、自決 vs 保護生命）；香港法例、SWRB、華人價值或宗教等僅隨機帶入 1–2 個作為導火線，不要一次塞滿。

【格式與內容要求】：
1. **長度與結構**：英文原文必須在 300 到 450 字之間。請分為 3-4 個段落（例如：案主背景與呈現問題、社工的心理社會預估 (Psychosocial Assessment)、具體的介入過程與理論應用、後續結果或倫理反思）。段落之間請以空行分隔。
2. **學術深度**：必須在文章中自然地穿插**至少 8 到 10 個高級社工學術專有名詞**（例如：ecological perspective, cognitive restructuring, strengths-based approach, self-determination, transference, rapport building, empowerment, crisis intervention 等）。
3. **具體細節**：請勿使用空泛的描述。請具體寫出案主的情緒反應、社工使用的微視技巧（Micro-skills，如 active listening, reframing）或是實際的會談對話片段。
4. **在地化**：情境必須符合香港的社會脈絡、法例或福利制度運作。

請以 JSON 格式回傳：
{
  "story_en": "英文故事全文（300-450 字，3-4 段）",
  "story_zh": "高品質的繁體中文翻譯（對應全文）",
  "keywords": [
    {"word": "單字1", "zh": "中文意思", "example": "含該單字的英文例句"},
    {"word": "單字2", "zh": "中文意思", "example": "含該單字的英文例句"}
  ]
}
keywords 請從文中萃取出 5 到 8 個最核心的專業生字，並為每個生字提供一句取材自故事脈絡的英文例句。`;

/**
 * 底層：發送 DeepSeek Chat Completions 請求並解析 JSON 物件
 *
 * @param {string} systemPrompt - System Prompt
 * @param {string} userContent - 使用者訊息
 * @param {number} maxTokens - 最大 token 數
 * @returns {Promise<Object>} 解析後的 JSON 物件
 * @throws {Error} API Key 缺失、網路錯誤、或回傳格式異常時拋出
 */
async function requestDeepSeekJSON(systemPrompt, userContent, maxTokens = 300) {
  const apiKey = getApiKey();

  // 動態附加當前科目的角色設定
  const finalSystemPrompt = withSubjectContext(systemPrompt);

  const requestBody = {
    model: DEEPSEEK_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user',   content: userContent }
    ],
    temperature: 0.7,
    max_tokens: maxTokens
  };

  let response;

  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
  } catch (networkError) {
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

  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('API 回傳內容為空，請稍後再試。');
  }

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

  const result = await requestDeepSeekJSON(L3_WRITING_SYSTEM_PROMPT, userContent, 1200);

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
 * 生成 L1 漸進式閱讀的社工小故事
 *
 * @returns {Promise<{story_en: string, story_zh: string, theme: string, keywords: Array<{word: string, zh: string, example?: string}>}>}
 * @throws {Error} API Key 缺失、網路錯誤、或回傳格式異常時拋出
 */
async function generateL1Story() {
  const subject = resolveCurrentSubject();
  // 依科目挑選主題，避免通用日常情境蓋過倫理等專科要求
  const themes = getL1StoryThemes(subject.id);
  const theme = themes[Math.floor(Math.random() * themes.length)];
  const userContent =
    `請根據情境「${theme}」，生成一篇 300 到 450 字、細節豐富的社工個案情境故事 (Case Vignette)。` +
    `故事必須嚴格符合科目「${subject.name}」的核心要求，不可偏離成無關日常敘事。` +
    `請自然融入至少 8 到 10 個高級社工學術專有名詞，並具體描寫微視技巧與會談細節。`;

  // 長文英文＋繁中翻譯＋關鍵字例句，需較高 token 上限
  const result = await requestDeepSeekJSON(L1_STORY_SYSTEM_PROMPT, userContent, 2800);

  const { story_en, story_zh, keywords } = result;

  if (!story_en || !story_zh || !Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('AI 回傳資料不完整，缺少故事或關鍵字。');
  }

  // 過濾無效關鍵字項目，確保 word / zh 皆為字串；例句為可選強化欄位
  const validKeywords = keywords.filter(
    (item) => item && typeof item.word === 'string' && typeof item.zh === 'string'
      && item.word.trim() && item.zh.trim()
  );

  if (validKeywords.length === 0) {
    throw new Error('AI 回傳的關鍵字格式無效，請再試一次。');
  }

  return {
    story_en: String(story_en).trim(),
    story_zh: String(story_zh).trim(),
    theme: theme,
    keywords: validKeywords.map((item) => {
      const mapped = {
        word: item.word.trim(),
        zh: item.zh.trim()
      };
      if (typeof item.example === 'string' && item.example.trim()) {
        mapped.example = item.example.trim();
      }
      return mapped;
    })
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
  "article_zh": "摘要繁體中文翻譯",
  "case_scenario_en": "基於該理論的虛構社工情境案例 (英文，約 60 字)",
  "case_scenario_zh": "案例繁體中文翻譯",
  "practical_application_en": "社工在此情境下的具體介入/實踐手法 (英文，約 60 字)",
  "practical_application_zh": "實踐手法繁體中文翻譯",
  "key_vocabulary": [{"term": "...", "pos": "...", "zh": "..."}]
}
key_vocabulary 請提取 5 個重要專業生字。`;
}

/**
 * 生成 AI 模擬文獻（含摘要、情境案例、實踐應用與生字）
 *
 * @param {string} keyword - 搜尋／主題關鍵字
 * @param {string} [subjectName] - 目前科目名稱；未提供時自動解析
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
async function generateSimulatedLiteratureAPI(keyword, subjectName) {
  const safeKeyword = String(keyword || '').trim();
  if (!safeKeyword) {
    throw new Error('請先輸入關鍵字，才能生成模擬文獻。');
  }

  const subject =
    subjectName && String(subjectName).trim()
      ? { name: String(subjectName).trim() }
      : resolveCurrentSubject();

  const systemPrompt = buildSimulatedLiteratureSystemPrompt(
    safeKeyword,
    subject.name
  );
  const userContent =
    `科目：${subject.name}\n關鍵字：${safeKeyword}\n請依上述格式生成結合學術理論與前線實務的教材。`;

  const result = await requestDeepSeekJSON(systemPrompt, userContent, 1600);

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
 * L3 閱讀：依當前科目生成個案紀錄 + 是非題
 */
const CASE_NOTE_READING_SYSTEM_PROMPT = `請根據當前選擇的社工科目，生成一篇約 150 字的專業個案紀錄 (Case Note)，英文難度適合社工學生。
內容必須嚴格貼合該科目核心；若科目為社會工作倫理與價值，個案紀錄必須清楚呈現倫理兩難與道德抉擇的掙扎，並只隨機帶入 1–2 個背景元素，不要一次塞滿。
並提供一題是非題 (True/False) 來測試閱讀理解。

請務必以 JSON 格式回傳：
{
  "case_note_en": "約 150 字的英文個案紀錄",
  "case_note_zh": "繁體中文翻譯",
  "question_en": "是非題題幹（英文）",
  "question_zh": "是非題題幹（繁體中文）",
  "answer": true
}
answer 必須是布林值 true 或 false，表示正確答案。`;

/**
 * 生成 L3 個案紀錄閱讀任務
 *
 * @returns {Promise<{case_note_en: string, case_note_zh: string, question_en: string, question_zh: string, answer: boolean}>}
 */
async function generateCaseNoteReading() {
  const subject = resolveCurrentSubject();
  const userContent =
    `請為科目「${subject.name}」生成一篇專業個案紀錄與一題是非題。`;

  const result = await requestDeepSeekJSON(
    CASE_NOTE_READING_SYSTEM_PROMPT,
    userContent,
    900
  );

  const {
    case_note_en,
    case_note_zh,
    question_en,
    question_zh,
    answer
  } = result;

  if (!case_note_en || !case_note_zh || !question_en || !question_zh) {
    throw new Error('AI 回傳資料不完整，缺少個案紀錄或是非題。');
  }

  // 正規化 answer：允許布林或字串 "true"/"false"
  let answerBool;
  if (typeof answer === 'boolean') {
    answerBool = answer;
  } else if (typeof answer === 'string') {
    const lower = answer.trim().toLowerCase();
    if (lower === 'true') answerBool = true;
    else if (lower === 'false') answerBool = false;
    else throw new Error('AI 回傳的是非題答案格式無效。');
  } else {
    throw new Error('AI 回傳的是非題答案格式無效。');
  }

  return {
    case_note_en: String(case_note_en).trim(),
    case_note_zh: String(case_note_zh).trim(),
    question_en: String(question_en).trim(),
    question_zh: String(question_zh).trim(),
    answer: answerBool
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
 * 文章庫 AI 深度挑戰：依文本（文獻或故事）生成 MCQ + 情境反思測驗
 */
const ARTICLE_CHALLENGE_SYSTEM_PROMPT = `你是一位嚴格的香港社會工作系教授。請根據我提供的文本（可能是學術文獻或實務故事），設計一份英文測驗卷。
必須回傳純 JSON 格式：
{
  "mcq": {
    "question": "針對文本核心概念或情境細節的英文選擇題...",
    "options": ["A選項", "B選項", "C選項", "D選項"],
    "correct_index": 0,
    "explanation": "中文解析說明為什麼選這個答案"
  },
  "scenario_reflection": {
    "question": "針對文本中的案例，提出一個進階的實務挑戰問題 (英文)。請結合香港社工實務語境...",
    "reference_answer": "中文參考解答方向與社工倫理思考指引"
  }
}
規則：
1. mcq.question 與 mcq.options 必須為英文；explanation 必須為繁體中文。
2. options 必須剛好 4 個選項；correct_index 為 0–3 的整數。
3. scenario_reflection.question 必須為英文，並盡量結合香港前線社工實務語境（如家訪、轉介、SWRB、保密與知情同意等）；reference_answer 必須為繁體中文。
4. 題目必須緊扣所提供文本內容，不可憑空捏造無關理論或情節。
5. 若文本為短篇故事，選擇題應聚焦情境細節與專業判斷；若為學術文獻，可聚焦理論概念與案例應用。`;

/**
 * 依文章內容生成 AI 深度挑戰測驗卷
 *
 * @param {string} articleContext - 文獻摘要／情境或故事全文
 * @returns {Promise<{
 *   mcq: {question: string, options: string[], correct_index: number, explanation: string},
 *   scenario_reflection: {question: string, reference_answer: string}
 * }>}
 */
async function generateArticleChallengeAPI(articleContext) {
  const context = String(articleContext || '').trim();
  if (!context) {
    throw new Error('文章內容為空，無法生成深度挑戰。');
  }

  const userContent =
    `請根據以下文本設計測驗卷（文本可能是學術文獻或社工實務故事）：\n\n${context}`;

  const result = await requestDeepSeekJSON(
    ARTICLE_CHALLENGE_SYSTEM_PROMPT,
    userContent,
    1200
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
 * @returns {Promise<{message_en: string, message_zh: string}>}
 */
async function generateCelebrationLetterAPI(totalDays, rewardGoal) {
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

  // 不注入科目鎖定前綴，避免祝賀信被科目主題綁架
  const apiKey = getApiKey();
  const requestBody = {
    model: DEEPSEEK_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.8,
    max_tokens: 350
  };

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
    if (response.status === 401) {
      throw new Error('API Key 無效或已過期，請重新設定。');
    }
    throw new Error(`API 回應錯誤（狀態碼 ${response.status}）`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('API 回傳內容為空，請稍後再試。');
  }

  let result;
  try {
    result = JSON.parse(rawContent);
  } catch (_) {
    throw new Error('AI 回傳的 JSON 格式有誤，請再試一次。');
  }

  const message_en = String(result.message_en || '').trim();
  const message_zh = String(result.message_zh || '').trim();

  if (!message_en || !message_zh) {
    throw new Error('AI 回傳資料不完整，缺少祝賀信內容。');
  }

  return { message_en, message_zh };
}

// 明確掛到 window，避免快取／作用域問題導致其他模組找不到函式
window.generateL1Story = generateL1Story;
window.callDeepSeekAPI = callDeepSeekAPI;
window.callL2WritingAPI = callL2WritingAPI;
window.callL3WritingAPI = callL3WritingAPI;
window.simplifyAbstractAPI = simplifyAbstractAPI;
window.generateSimulatedLiteratureAPI = generateSimulatedLiteratureAPI;
window.generateCaseNoteReading = generateCaseNoteReading;
window.generateWritingPromptsAPI = generateWritingPromptsAPI;
window.generateNewVocabAPI = generateNewVocabAPI;
window.generateLiteratureTagsAPI = generateLiteratureTagsAPI;
window.generateArticleChallengeAPI = generateArticleChallengeAPI;
window.generateCelebrationLetterAPI = generateCelebrationLetterAPI;
window.STORAGE_KEY_SUBJECT = STORAGE_KEY_SUBJECT;
window.withSubjectContext = withSubjectContext;
window.SUBJECT_ID_ALIASES = SUBJECT_ID_ALIASES;
window.normalizeSubjectId = normalizeSubjectId;
window.resolveCurrentSubject = resolveCurrentSubject;
window.resolveCurrentSubject = resolveCurrentSubject;
