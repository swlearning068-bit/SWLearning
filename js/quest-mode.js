/**
 * quest-mode.js — Phase 13.1：100 關任務地圖與願望迴圈
 *
 * 職責：
 * 1. 動態產生 100 關之字形地圖，視覺區隔為 10 章（每章 10 關）
 * 2. 難度：1–20 L0 單字／21–50 L1／51–80 L2／81–100 L3
 * 3. 每章起點設定「願望目標」，第 10 關寶箱顯示願望 tooltip
 * 4. 開啟挑戰：L0 純測驗；L1+ 段落閱讀 → 測驗 → 對應寫作
 */

/* ============================================================
   常數
   ============================================================ */

/** localStorage：關卡進度 */
const STORAGE_KEY_QUEST = 'sw_quest_levels';

/** localStorage：各章願望 */
const STORAGE_KEY_QUEST_WISHES = 'sw_quest_wishes';

/** 固定 100 關 */
const QUEST_LEVEL_COUNT = 100;

/** 每章關卡數 */
const QUEST_CHAPTER_SIZE = 10;

/** 章節總數 */
const QUEST_CHAPTER_COUNT = QUEST_LEVEL_COUNT / QUEST_CHAPTER_SIZE;

/**
 * 章節顯示名稱（依難度帶）
 * @type {Array<{id: number, name: string, band: string}>}
 */
const QUEST_CHAPTER_META = [
  { id: 1, name: '單字萌芽', band: 'L0 極簡' },
  { id: 2, name: '詞彙暖身', band: 'L0 極簡' },
  { id: 3, name: '短句起步', band: 'L1 基礎' },
  { id: 4, name: '段落初探', band: 'L1 基礎' },
  { id: 5, name: '克漏字練功', band: 'L1 基礎' },
  { id: 6, name: '長文導讀', band: 'L2 中階' },
  { id: 7, name: '造句實作', band: 'L2 中階' },
  { id: 8, name: '情境書寫', band: 'L2 中階' },
  { id: 9, name: '臨床紀錄', band: 'L3 進階' },
  { id: 10, name: '督導挑戰', band: 'L3 進階' }
];

/**
 * 各科目關卡標題素材
 * @type {Record<string, string[]>}
 */
const QUEST_TITLE_BANK = {
  family_social_work: [
    '家庭結構基礎',
    '三角關係辨識',
    '親子動力觀察',
    '家訪危機應對',
    '婚姻衝突調解',
    '照顧者負荷',
    '家庭資源盤點',
    '系統觀點應用',
    '家暴風險警訊',
    '復原力語言'
  ],
  mental_health: [
    '精神健康初探',
    '復元語言練習',
    '危機介入詞彙',
    '去污名化表達',
    '情緒調節用語',
    '自殺風險評估',
    '藥物依從溝通',
    '朋輩支持語言',
    '創傷知情基礎',
    '復元目標設定'
  ],
  casework: [
    '個案接案用語',
    '評估報告骨架',
    '介入計畫草稿',
    '結案紀錄精煉',
    '目標協商對話',
    '轉介書寫練習',
    '家訪紀錄要點',
    '危機備忘錄',
    '優勢視角筆記',
    '跟進電話用語'
  ],
  elderly: [
    '長者照顧情境',
    '認知障礙溝通',
    '照顧者支持語言',
    '社區安老倡議',
    '跌倒風險提醒',
    '長期照顧評估',
    '安寧溝通基礎',
    '孤獨感介入',
    '跨代連結用語',
    '日間中心紀錄'
  ],
  children_youth: [
    '兒保通報情境',
    '青少年風險辨識',
    '學校社工對話',
    '發展需求評估',
    '遊戲治療用語',
    '家長會談技巧',
    '網絡成癮溝通',
    '朋輩欺凌介入',
    '生涯探索語言',
    '保護令說明'
  ],
  group_work: [
    '小組動力觀察',
    '帶領技巧用語',
    '凝聚力促進',
    '過程紀錄寫作',
    '破冰活動說明',
    '衝突處理語言',
    '結束儀式設計',
    '成員回饋整理',
    '規範共識建立',
    '角色扮演引導'
  ],
  community_work: [
    '社區賦權基礎',
    '資源連結用語',
    '倡議行動語言',
    '社區評估短文',
    '居民會議主持',
    '資產地圖說明',
    '參與階梯概念',
    '行動計畫草稿',
    '政策倡議口號',
    '夥伴協作用語'
  ],
  social_policy: [
    '福利政策詞彙',
    '經濟審查情境',
    '房屋政策討論',
    '扶貧論述練習',
    '綜援申請說明',
    '權利本位語言',
    '預算影響分析',
    '服務缺口描述',
    '政策倡議短評',
    '數據解讀練習'
  ],
  disability: [
    '無障礙倡議',
    '權利本位語言',
    '融合實務對話',
    '賦權評估寫作',
    '合理調整說明',
    '自立生活用語',
    '家庭支持計劃',
    '就業配對語言',
    '污名回應練習',
    '服務轉介紀錄'
  ],
  intro_psych: [
    '防衛機制辨識',
    '創傷知情用語',
    'CBT 概念應用',
    '情緒調節描述',
    '依附風格觀察',
    '動機晤談基礎',
    '壓力因應語言',
    '自我效能寫作',
    '認知扭曲改寫',
    '行為活化說明'
  ],
  ethics_and_values: [
    '倫理兩難思辨',
    '保密界限權衡',
    '自主與保護',
    '專業反思書寫',
    '雙重關係警訊',
    '知情同意說明',
    '文化敏感表達',
    '權力不對等覺察',
    '舉報義務情境',
    '價值澄清練習'
  ],
  sw_admin: [
    '督導對話用語',
    '服務規劃語言',
    '資源配置說明',
    '機構管理短評',
    '質素保證紀錄',
    '團隊會議紀要',
    '風險管理說明',
    '人手編制討論',
    '服務協議草稿',
    '績效指標描述'
  ],
  sw_research: [
    '實證實務導讀',
    '質性訪談用語',
    '評估指標描述',
    '研究摘要改寫',
    '抽樣方法說明',
    '倫理審查重點',
    '數據詮釋練習',
    '文獻回顧短句',
    '介入成效描述',
    '限制與建議'
  ],
  general_practice: [
    '家訪日常用語',
    '資源轉介表達',
    '跟進紀錄練習',
    '前線溝通情境',
    '接案寒暄用語',
    '情緒支持短句',
    '目標設定對話',
    '安全計劃說明',
    '跨專業協作',
    '結案祝福用語'
  ]
};

/* ============================================================
   狀態
   ============================================================ */

/** @type {Array<Object>} */
let questLevels = [];

/** @type {Record<string, Object>} */
let questWishes = {};

/** @type {Object|null} */
let activeQuestLevel = null;

/** @type {Object|null} */
let questChallengeArticle = null;

/** 開啟挑戰前暫存的科目 ID（關閉時還原） */
let questSubjectBackupId = '';

/** @type {{ reading: boolean, quiz: boolean, writing: boolean }} */
let questProgress = { reading: false, quiz: false, writing: false };

/** 願望 Modal 對應的章節／關卡 */
let pendingWishContext = null;

/* ============================================================
   DOM / 工具
   ============================================================ */

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function quest$(id) {
  return document.getElementById(id);
}

/**
 * @param {string} message
 */
function questToast(message) {
  if (typeof window.showToast === 'function') {
    window.showToast(message);
  }
}

/**
 * @returns {Array<{id: string, name: string}>}
 */
function getQuestSubjectsList() {
  if (Array.isArray(window.subjectsList) && window.subjectsList.length) {
    return window.subjectsList;
  }
  return [
    { id: 'general_practice', name: '通用社工實務' },
    { id: 'family_social_work', name: '家庭社工實務' },
    { id: 'mental_health', name: '精神健康' },
    { id: 'elderly', name: '長者' },
    { id: 'children_youth', name: '兒童及青少年' },
    { id: 'casework', name: '個案工作' }
  ];
}

/**
 * @returns {{id: string, name: string}|null}
 */
function getQuestCurrentSubject() {
  if (window.currentSubject && window.currentSubject.id) {
    return window.currentSubject;
  }
  if (typeof window.getCurrentSubject === 'function') {
    return window.getCurrentSubject();
  }
  const list = getQuestSubjectsList();
  return list[0] || null;
}

/**
 * @param {string} subjectId
 * @returns {string}
 */
function getSubjectDisplayName(subjectId) {
  const found = getQuestSubjectsList().find((s) => s.id === subjectId);
  return found?.name || subjectId || '社工實務';
}

/**
 * @param {string} subjectId
 */
function applyQuestSubject(subjectId) {
  const list = getQuestSubjectsList();
  const found = list.find((s) => s.id === subjectId) || list[0];
  if (!found) return;

  const key =
    typeof STORAGE_KEY_SUBJECT !== 'undefined'
      ? STORAGE_KEY_SUBJECT
      : 'swlearning_current_subject';

  localStorage.setItem(key, found.id);
  window.currentSubject = found;

  const selector = quest$('subject-selector');
  if (selector) selector.value = found.id;
}

function restoreQuestSubjectBackup() {
  if (!questSubjectBackupId) return;
  applyQuestSubject(questSubjectBackupId);
  questSubjectBackupId = '';
}

/**
 * @param {number} levelId 1-based
 * @returns {number} chapter 1-10
 */
function getChapterIdForLevel(levelId) {
  return Math.floor((Number(levelId) - 1) / QUEST_CHAPTER_SIZE) + 1;
}

/**
 * @param {number} chapterId
 * @returns {boolean}
 */
function isChapterStartLevel(levelId) {
  return (Number(levelId) - 1) % QUEST_CHAPTER_SIZE === 0;
}

/**
 * @param {number} levelId
 * @returns {boolean}
 */
function isChapterChestLevel(levelId) {
  return Number(levelId) % QUEST_CHAPTER_SIZE === 0;
}

/**
 * 依關卡 ID 決定難度模式
 * @param {number} levelId
 * @returns {{tier: string, mode: string, track: string}}
 */
function getQuestDifficultyForLevel(levelId) {
  const id = Number(levelId) || 1;
  if (id <= 20) {
    return { tier: 'L0', mode: 'L0_vocab', track: 'story' };
  }
  if (id <= 50) {
    return { tier: 'L1', mode: 'L1_basic', track: 'story' };
  }
  if (id <= 80) {
    return {
      tier: 'L2',
      mode: 'L2_intermediate',
      track: id % 2 === 0 ? 'literature' : 'story'
    };
  }
  return { tier: 'L3', mode: 'L3_advanced', track: 'literature' };
}

/**
 * @param {number} chapterId
 * @returns {{id: number, name: string, band: string}}
 */
function getChapterMeta(chapterId) {
  return (
    QUEST_CHAPTER_META.find((c) => c.id === chapterId) || {
      id: chapterId,
      name: `第 ${chapterId} 章`,
      band: ''
    }
  );
}

/* ============================================================
   願望資料
   ============================================================ */

/**
 * @returns {Record<string, Object>}
 */
function loadQuestWishes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUEST_WISHES);
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out = {};
    Object.keys(parsed).forEach((key) => {
      const item = parsed[key];
      if (!item || typeof item !== 'object') return;
      out[String(key)] = {
        chapter: Number(item.chapter) || Number(key),
        subjectId: String(item.subjectId || 'general_practice'),
        wishText: String(item.wishText || '').trim(),
        setAt: String(item.setAt || '')
      };
    });
    return out;
  } catch (_) {
    return {};
  }
}

function saveQuestWishes() {
  try {
    localStorage.setItem(STORAGE_KEY_QUEST_WISHES, JSON.stringify(questWishes));
    if (typeof window.__swNotifyDataChanged === 'function') {
      window.__swNotifyDataChanged(STORAGE_KEY_QUEST_WISHES);
    }
  } catch (err) {
    console.warn('[quest-mode] 無法寫入願望資料', err);
  }
}

/**
 * @param {number} chapterId
 * @returns {Object|null}
 */
function getWishForChapter(chapterId) {
  const wish = questWishes[String(chapterId)];
  if (!wish || !wish.wishText) return null;
  return wish;
}

/**
 * @param {number} chapterId
 * @param {string} subjectId
 * @param {string} wishText
 */
function setWishForChapter(chapterId, subjectId, wishText) {
  questWishes[String(chapterId)] = {
    chapter: chapterId,
    subjectId: subjectId || 'general_practice',
    wishText: String(wishText || '').trim(),
    setAt: new Date().toISOString()
  };
  saveQuestWishes();

  // 將該章 10 關的科目同步為願望科目
  const start = (chapterId - 1) * QUEST_CHAPTER_SIZE + 1;
  const end = chapterId * QUEST_CHAPTER_SIZE;
  questLevels = questLevels.map((level) => {
    if (level.id >= start && level.id <= end) {
      const bank =
        QUEST_TITLE_BANK[subjectId] || QUEST_TITLE_BANK.general_practice;
      const titleIndex = (level.id - start) % bank.length;
      return {
        ...level,
        subject: subjectId,
        title: bank[titleIndex]
      };
    }
    return level;
  });
  saveQuestLevels();
}

/* ============================================================
   關卡資料：讀寫 / 生成
   ============================================================ */

/**
 * @returns {Array<Object>}
 */
function loadQuestLevels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUEST);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => normalizeQuestLevel(item, index));
  } catch (_) {
    return [];
  }
}

/**
 * @param {Object} item
 * @param {number} index
 * @returns {Object}
 */
function normalizeQuestLevel(item, index) {
  const status = ['active', 'locked', 'completed'].includes(item.status)
    ? item.status
    : index === 0
      ? 'active'
      : 'locked';

  const id = Number(item.id) || index + 1;
  const diff = getQuestDifficultyForLevel(id);
  const rawLevel = String(item.level || item.mode || diff.tier).toUpperCase();

  let tier = diff.tier;
  let mode = diff.mode;
  if (rawLevel === 'L0' || rawLevel.includes('L0')) {
    tier = 'L0';
    mode = 'L0_vocab';
  } else if (rawLevel === 'L1' || rawLevel.includes('L1')) {
    tier = id <= 20 ? 'L0' : 'L1';
    mode = id <= 20 ? 'L0_vocab' : 'L1_basic';
  } else if (rawLevel === 'L2' || rawLevel.includes('L2')) {
    tier = 'L2';
    mode = 'L2_intermediate';
  } else if (rawLevel === 'L3' || rawLevel.includes('L3')) {
    tier = 'L3';
    mode = 'L3_advanced';
  }

  // 強制依關卡區間覆寫（保證 100 關難度曲線）
  tier = diff.tier;
  mode = diff.mode;

  const track =
    item.track === 'literature' || tier === 'L3'
      ? 'literature'
      : diff.track;

  const chapter = Number(item.chapter) || getChapterIdForLevel(id);

  return {
    id,
    level: tier,
    mode,
    subject: String(item.subject || 'general_practice'),
    title: String(item.title || `關卡 ${id}`),
    track: tier === 'L0' ? 'story' : track,
    status,
    chapter,
    isChapterStart: isChapterStartLevel(id),
    isChest: isChapterChestLevel(id)
  };
}

function saveQuestLevels() {
  try {
    localStorage.setItem(STORAGE_KEY_QUEST, JSON.stringify(questLevels));
    if (typeof window.__swNotifyDataChanged === 'function') {
      window.__swNotifyDataChanged(STORAGE_KEY_QUEST);
    }
  } catch (err) {
    console.warn('[quest-mode] 無法寫入關卡進度', err);
  }
}

function reconcileQuestStatuses() {
  let unlockedNext = true;
  questLevels = questLevels.map((level) => {
    if (level.status === 'completed') {
      return level;
    }
    if (unlockedNext) {
      unlockedNext = false;
      return { ...level, status: 'active' };
    }
    return { ...level, status: 'locked' };
  });
}

/**
 * @template T
 * @param {T[]} list
 * @param {number} seed
 * @returns {T[]}
 */
function seededShuffle(list, seed) {
  const arr = list.slice();
  let s = seed || 1;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 產生完整 100 關地圖
 * @param {string} [anchorSubjectId]
 * @param {{silent?: boolean, preserveProgress?: Array<Object>}} [options]
 * @returns {Array<Object>}
 */
function generateQuestLevels(anchorSubjectId, options) {
  const subjects = getQuestSubjectsList();
  const anchor =
    subjects.find((s) => s.id === anchorSubjectId)?.id ||
    getQuestCurrentSubject()?.id ||
    subjects[0]?.id ||
    'general_practice';

  const others = subjects.filter((s) => s.id !== anchor);
  const shuffledOthers = seededShuffle(others, 42 + subjects.length * 7);

  const prevById = new Map();
  (options?.preserveProgress || []).forEach((lv) => {
    if (lv && lv.id) prevById.set(Number(lv.id), lv);
  });

  const titleCursor = {};
  const levels = [];

  for (let i = 0; i < QUEST_LEVEL_COUNT; i += 1) {
    const id = i + 1;
    const chapter = getChapterIdForLevel(id);
    const wish = getWishForChapter(chapter);

    let subjectId = wish?.subjectId || anchor;
    if (!wish) {
      // 無願望時：錨點科目與其他科目交錯，每章略作變化
      if (i % 3 === 0) {
        subjectId = anchor;
      } else if (shuffledOthers.length) {
        subjectId =
          shuffledOthers[(chapter + i) % shuffledOthers.length].id || anchor;
      }
    }

    const bank =
      QUEST_TITLE_BANK[subjectId] || QUEST_TITLE_BANK.general_practice;
    const cursor = titleCursor[subjectId] || 0;
    titleCursor[subjectId] = cursor + 1;
    const title = bank[cursor % bank.length];

    const diff = getQuestDifficultyForLevel(id);
    const prev = prevById.get(id);

    levels.push({
      id,
      level: diff.tier,
      mode: diff.mode,
      subject: subjectId,
      title: prev?.title && prev.subject === subjectId ? prev.title : title,
      track: diff.track,
      status: prev?.status === 'completed' ? 'completed' : 'locked',
      chapter,
      isChapterStart: isChapterStartLevel(id),
      isChest: isChapterChestLevel(id)
    });
  }

  // 第一個未完成者為 active
  const firstOpen = levels.find((l) => l.status !== 'completed');
  if (firstOpen) {
    firstOpen.status = 'active';
  }

  questLevels = levels;
  reconcileQuestStatuses();
  saveQuestLevels();

  if (!options?.silent) {
    questToast(`🗺️ 已展開 ${QUEST_LEVEL_COUNT} 關歷險地圖（10 章願望迴圈）！`);
  }

  return levels;
}

/**
 * @param {{force?: boolean, silent?: boolean}} [options]
 */
function ensureQuestLevels(options) {
  const force = Boolean(options?.force);
  questWishes = loadQuestWishes();

  if (!force) {
    const existing = loadQuestLevels();
    if (existing.length === QUEST_LEVEL_COUNT) {
      questLevels = existing.map((item, index) =>
        normalizeQuestLevel(item, index)
      );
      reconcileQuestStatuses();
      saveQuestLevels();
      return questLevels;
    }
    if (existing.length > 0 && existing.length < QUEST_LEVEL_COUNT) {
      // 舊版 5–10 關：保留通關進度，擴充至 100
      return generateQuestLevels(getQuestCurrentSubject()?.id, {
        silent: options?.silent,
        preserveProgress: existing
      });
    }
  }

  return generateQuestLevels(getQuestCurrentSubject()?.id, {
    silent: options?.silent
  });
}

/**
 * 學習目標啟動時：重建 100 關（保留願望）
 */
function onLearningGoalStarted() {
  generateQuestLevels(getQuestCurrentSubject()?.id, { silent: false });
  if (typeof refreshQuestView === 'function') {
    refreshQuestView();
  }
}

/* ============================================================
   地圖渲染
   ============================================================ */

/**
 * 之字形：奇數靠左、偶數靠右，每 5 關置中一次
 * @param {number} index0
 * @returns {'left'|'center'|'right'}
 */
function getSnakeAlignment(index0) {
  const n = index0 + 1;
  if (n % 5 === 3) return 'center';
  return n % 2 === 1 ? 'left' : 'right';
}

/**
 * @param {Object} level
 * @returns {string}
 */
function getNodeIcon(level) {
  if (level.status === 'completed') return '✓';
  if (level.status === 'locked') return '🔒';
  if (level.isChest) return '🎁';
  if (level.level === 'L0') return '🔤';
  if (level.level === 'L3') return '🌳';
  if (level.level === 'L2') return '🌿';
  return '🌱';
}

/**
 * @param {HTMLElement} container
 * @param {number} chapterId
 */
function appendChapterDivider(container, chapterId) {
  const meta = getChapterMeta(chapterId);
  const wish = getWishForChapter(chapterId);
  const divider = document.createElement('div');
  divider.className = 'quest-chapter-divider';
  divider.setAttribute('role', 'separator');
  divider.innerHTML =
    `<div class="quest-chapter-badge">第 ${chapterId} 章</div>` +
    `<div class="quest-chapter-info">` +
    `<strong class="quest-chapter-name">${escapeQuestHtml(meta.name)}</strong>` +
    `<span class="quest-chapter-band">${escapeQuestHtml(meta.band)}</span>` +
    (wish
      ? `<span class="quest-chapter-wish">✨ ${escapeQuestHtml(wish.wishText)}</span>`
      : `<span class="quest-chapter-wish quest-chapter-wish--empty">尚未設定願望</span>`) +
    `</div>`;
  container.appendChild(divider);
}

/**
 * 渲染 #quest-map-container
 */
function renderQuestMap() {
  const container = quest$('quest-map-container');
  const hint = quest$('quest-status-hint');
  if (!container) return;

  ensureQuestLevels({ silent: true });
  container.innerHTML = '';

  if (!questLevels.length) {
    container.innerHTML =
      '<p class="quest-status-hint">尚無關卡。請先到「學習目標」開始挑戰，或點上方重新分配。</p>';
    if (hint) hint.textContent = '尚未建立任務地圖。';
    return;
  }

  const completed = questLevels.filter((l) => l.status === 'completed').length;
  const active = questLevels.find((l) => l.status === 'active');
  if (hint) {
    const chapter = active ? getChapterIdForLevel(active.id) : null;
    const wish = chapter ? getWishForChapter(chapter) : null;
    hint.textContent = active
      ? `進度 ${completed}/${questLevels.length}｜第 ${chapter} 章 · Lv ${active.id}「${active.title}」` +
        (wish ? `｜願望：${wish.wishText}` : '｜請先設定本章願望')
      : `🎉 全部通關！共完成 ${completed} 關`;
  }

  let lastChapter = 0;
  questLevels.forEach((level, index) => {
    if (level.chapter !== lastChapter) {
      lastChapter = level.chapter;
      appendChapterDivider(container, level.chapter);
    }

    const row = document.createElement('div');
    const align = getSnakeAlignment(index);
    row.className = `quest-map-row quest-map-row--${align}`;

    const node = document.createElement('button');
    node.type = 'button';
    node.className = `quest-node node-${level.status}`;
    if (level.isChest) node.classList.add('quest-node--chest');
    if (level.isChapterStart) node.classList.add('quest-node--chapter-start');
    node.dataset.questId = String(level.id);

    const wish = getWishForChapter(level.chapter);
    const wishTip =
      level.isChest && wish
        ? `願望寶箱：${wish.wishText}`
        : level.isChapterStart && !wish && level.status === 'active'
          ? '點此設定本章學習願望'
          : '';

    node.setAttribute(
      'aria-label',
      `Lv ${level.id} ${level.title}，${level.level}，${level.status}` +
        (wishTip ? `，${wishTip}` : '')
    );
    if (wishTip) node.title = wishTip;
    if (level.status === 'locked') node.disabled = true;

    let subText = `${level.level} · ${getSubjectDisplayName(level.subject)}`;
    if (level.isChest) {
      subText = wish
        ? `🎁 願望寶箱 · ${wish.wishText}`
        : '🎁 章節願望寶箱';
    }

    node.innerHTML =
      `<span class="quest-node-btn" aria-hidden="true">${getNodeIcon(level)}</span>` +
      `<span class="quest-node-label">Lv ${level.id} · ${escapeQuestHtml(
        level.title
      )}</span>` +
      `<span class="quest-node-sub">${escapeQuestHtml(subText)}</span>`;

    if (level.isChest && wish) {
      const tip = document.createElement('span');
      tip.className = 'quest-chest-tooltip';
      tip.textContent = `✨ ${wish.wishText}`;
      node.appendChild(tip);
    }

    node.addEventListener('click', () => {
      handleQuestNodeClick(level);
    });

    row.appendChild(node);
    container.appendChild(row);
  });
}

/**
 * 節點點擊：章節起點且未設願望 → Wish Modal；否則進挑戰
 * @param {Object} level
 */
function handleQuestNodeClick(level) {
  if (!level || level.status === 'locked') {
    questToast('🔒 請先完成前一關卡');
    return;
  }

  const needWish =
    level.isChapterStart &&
    level.status === 'active' &&
    !getWishForChapter(level.chapter);

  if (needWish) {
    openWishSettingModal(level);
    return;
  }

  openQuestChallenge(level);
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeQuestHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function refreshQuestView() {
  renderQuestMap();
}

/* ============================================================
   願望設定 Modal
   ============================================================ */

/**
 * @param {Object} level
 */
function openWishSettingModal(level) {
  const modal = quest$('wish-setting-modal');
  if (!modal || !level) return;

  pendingWishContext = { level, chapterId: level.chapter };

  const meta = getChapterMeta(level.chapter);
  const heading = quest$('wish-setting-heading');
  if (heading) {
    heading.textContent = `第 ${level.chapter} 章「${meta.name}」· 請為接下來的 10 關設定你的學習目標與願望！`;
  }

  const select = quest$('wish-subject-select');
  if (select) {
    const subjects = getQuestSubjectsList();
    const existing = getWishForChapter(level.chapter);
    const preferred =
      existing?.subjectId ||
      getQuestCurrentSubject()?.id ||
      subjects[0]?.id ||
      '';
    select.innerHTML = subjects
      .map(
        (s) =>
          `<option value="${escapeQuestHtml(s.id)}"${
            s.id === preferred ? ' selected' : ''
          }>${escapeQuestHtml(s.name)}</option>`
      )
      .join('');
  }

  const input = quest$('wish-text-input');
  if (input) {
    const existing = getWishForChapter(level.chapter);
    input.value = existing?.wishText || '';
    setTimeout(() => input.focus(), 50);
  }

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeWishSettingModal() {
  const modal = quest$('wish-setting-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  pendingWishContext = null;
}

function handleWishSettingSubmit() {
  if (!pendingWishContext) return;

  const select = quest$('wish-subject-select');
  const input = quest$('wish-text-input');
  const subjectId = select?.value || 'general_practice';
  const wishText = String(input?.value || '').trim();

  if (!wishText) {
    questToast('請寫下你的過關願望（例如：希望實習順利）');
    input?.focus();
    return;
  }

  const { level, chapterId } = pendingWishContext;
  setWishForChapter(chapterId, subjectId, wishText);
  closeWishSettingModal();
  renderQuestMap();
  questToast(`✨ 願望已設定：${wishText}`);

  // 設定後直接進入該關挑戰
  const refreshed = questLevels.find((l) => l.id === level.id) || level;
  openQuestChallenge({ ...refreshed, subject: subjectId });
}

/* ============================================================
   挑戰視圖
   ============================================================ */

function syncQuestStepIndicators() {
  const steps = document.querySelectorAll('.quest-step[data-quest-step]');
  const isL0 = activeQuestLevel?.level === 'L0';

  steps.forEach((el) => {
    const key = el.getAttribute('data-quest-step');
    el.classList.toggle('is-done', Boolean(questProgress[key]));
    el.classList.remove('is-current');
    if (isL0) {
      el.classList.toggle('hidden', key !== 'quiz');
    } else {
      el.classList.remove('hidden');
    }
  });

  const arrows = document.querySelectorAll('.quest-step-arrow');
  arrows.forEach((el) => {
    el.classList.toggle('hidden', Boolean(isL0));
  });

  let current = 'reading';
  if (isL0) {
    current = 'quiz';
  } else if (questProgress.reading && !questProgress.quiz) {
    current = 'quiz';
  } else if (questProgress.quiz && !questProgress.writing) {
    current = 'writing';
  } else if (questProgress.writing) {
    current = 'writing';
  }

  const currentEl = document.querySelector(
    `.quest-step[data-quest-step="${current}"]`
  );
  if (currentEl && !(isL0 ? questProgress.quiz : questProgress.writing)) {
    currentEl.classList.add('is-current');
  }

  const completeBtn = quest$('btn-quest-complete');
  if (completeBtn) {
    // L0：通關鈕改放在題目最下方，頂部隱藏
    if (isL0) {
      completeBtn.classList.add('hidden');
      completeBtn.disabled = true;
    } else {
      const ready =
        questProgress.reading &&
        questProgress.quiz &&
        questProgress.writing;
      completeBtn.classList.toggle('hidden', !questProgress.reading);
      completeBtn.disabled = !ready;
      completeBtn.textContent = ready
        ? '🏅 完成本關卡'
        : '🏅 完成閱讀／測驗／寫作後可通關';
    }
  }
}

/**
 * @param {'reading'|'quiz'|'writing'} key
 */
function markQuestProgress(key) {
  if (!questProgress[key]) {
    questProgress[key] = true;
    syncQuestStepIndicators();
  }
}

/**
 * @param {HTMLElement} root
 */
function bindQuestChallengeProgress(root) {
  if (!root) return;

  root.addEventListener('click', (event) => {
    const quizHit = event.target.closest(
      '.practice-quiz-option, .practice-quiz-check, .practice-quiz-radio, .inline-quiz-option'
    );
    if (quizHit && root.contains(quizHit)) {
      markQuestProgress('quiz');
    }

    const checkBtn = event.target.closest('.writing-l1-cloze .btn');
    if (checkBtn && root.contains(checkBtn)) {
      setTimeout(() => {
        const feedback = root.querySelector('.writing-check-feedback.is-correct');
        if (feedback) markQuestProgress('writing');
      }, 0);
    }

    const l2Btn = event.target.closest('.writing-l2-sentence .btn');
    if (l2Btn && root.contains(l2Btn)) {
      markQuestProgress('writing');
    }

    const l3Btn = event.target.closest('.btn-submit-clinical-task');
    if (l3Btn && root.contains(l3Btn)) {
      markQuestProgress('writing');
    }
  });

  const hasQuiz = Boolean(root.querySelector('.practice-inline-quiz'));
  if (!hasQuiz) {
    markQuestProgress('quiz');
  }
}

/**
 * 依關卡難度鎖定寫作面板
 * @param {HTMLElement} root
 * @param {string} tier L1|L2|L3
 */
function focusQuestWritingLevel(root, tier) {
  const map = { L1: 'l1', L2: 'l2', L3: 'l3' };
  const level = map[tier] || 'l1';
  const switchEl = root.querySelector('.progressive-writing-switch');
  if (!switchEl) return;

  const btn = switchEl.querySelector(`[data-write-level="${level}"]`);
  if (btn) btn.click();

  switchEl.querySelectorAll('.level-btn').forEach((b) => {
    const match = b.getAttribute('data-write-level') === level;
    b.disabled = !match;
    b.classList.toggle('is-quest-locked', !match);
    b.setAttribute('aria-hidden', String(!match));
  });
}

/**
 * @param {Object} level
 */
function openQuestChallenge(level) {
  const overlay = quest$('quest-challenge-overlay');
  if (!overlay || !level) return;

  activeQuestLevel = level;
  questChallengeArticle = null;
  questProgress = { reading: false, quiz: false, writing: false };

  const current = getQuestCurrentSubject();
  questSubjectBackupId = current?.id || '';
  applyQuestSubject(level.subject);

  const meta = quest$('quest-challenge-meta');
  const title = quest$('quest-challenge-title');
  const wish = getWishForChapter(level.chapter);
  const modeLabel =
    level.mode === 'L0_vocab'
      ? '單字配對訓練'
      : level.track === 'literature'
        ? '模擬學術文獻'
        : '社工小故事';

  if (meta) {
    meta.textContent =
      `Lv ${level.id} · ${level.level} · ${getSubjectDisplayName(level.subject)} · ${modeLabel}` +
      (wish ? ` · 願望：${wish.wishText}` : '');
  }
  if (title) {
    title.textContent = level.isChest
      ? `🎁 ${level.title}`
      : level.title;
  }

  const root = quest$('quest-challenge-root');
  if (root) root.innerHTML = '';
  hideQuestEl(quest$('quest-challenge-error'));
  hideQuestEl(quest$('quest-challenge-loading'));

  const genBtn = quest$('btn-quest-generate');
  if (genBtn) {
    genBtn.disabled = false;
    genBtn.classList.remove('hidden');
    genBtn.textContent =
      level.level === 'L0'
        ? '🔤 開始單字訓練'
        : '🚀 開始本關挑戰（生成文章）';
  }

  // 更新步驟標籤文案（L0）
  const quizStep = document.querySelector('.quest-step[data-quest-step="quiz"]');
  if (quizStep) {
    quizStep.textContent =
      level.level === 'L0' ? '① 單字／短句測驗' : '② 即時測驗';
  }
  const readingStep = document.querySelector(
    '.quest-step[data-quest-step="reading"]'
  );
  if (readingStep) readingStep.textContent = '① 段落閱讀';
  const writingStep = document.querySelector(
    '.quest-step[data-quest-step="writing"]'
  );
  if (writingStep) {
    const labels = {
      L1: '③ L1 克漏字',
      L2: '③ L2 造句',
      L3: '③ L3 臨床表單'
    };
    writingStep.textContent = labels[level.level] || '③ 漸進寫作';
  }

  syncQuestStepIndicators();

  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeQuestChallenge() {
  const overlay = quest$('quest-challenge-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
  activeQuestLevel = null;
  questChallengeArticle = null;
  restoreQuestSubjectBackup();

  const root = quest$('quest-challenge-root');
  if (root) root.innerHTML = '';
}

/**
 * @param {HTMLElement|null} el
 */
function hideQuestEl(el) {
  if (el) el.classList.add('hidden');
}

/**
 * @param {HTMLElement|null} el
 */
function showQuestEl(el) {
  if (el) el.classList.remove('hidden');
}

/**
 * 開始本關：L0 → 單字測驗；其餘 → 生成文章
 */
async function handleQuestGenerateArticle() {
  const level = activeQuestLevel;
  if (!level) return;

  if (level.level === 'L0') {
    await handleQuestL0Start();
    return;
  }

  const apiFn =
    level.track === 'literature'
      ? window.generateInteractiveLiteratureAPI
      : window.generateInteractiveStoryAPI;

  if (typeof apiFn !== 'function') {
    showQuestError('AI 模組尚未載入，請強制重新整理頁面後再試。');
    return;
  }

  const hasKey = !!localStorage.getItem(
    typeof STORAGE_KEY_API !== 'undefined'
      ? STORAGE_KEY_API
      : 'swlearning_deepseek_api_key'
  );
  if (!hasKey) {
    showQuestError('請先在設定中輸入 DeepSeek API Key。');
    return;
  }

  applyQuestSubject(level.subject);

  const loading = quest$('quest-challenge-loading');
  const genBtn = quest$('btn-quest-generate');
  const root = quest$('quest-challenge-root');
  const loadingText = loading?.querySelector('.loading-text');

  hideQuestEl(quest$('quest-challenge-error'));
  showQuestEl(loading);
  if (loadingText) {
    loadingText.textContent = '正在為本關生成任務文章與測驗…';
  }
  if (genBtn) genBtn.disabled = true;
  if (root) root.innerHTML = '';

  try {
    const data = await apiFn({
      levelId: level.id,
      levelTitle: level.title,
      chapterId: level.chapter,
      theme: level.title
    });
    const article = {
      ...data,
      id: `quest-${level.id}-${Date.now()}`,
      track: level.track === 'literature' ? 'literature' : 'story',
      type: 'quest',
      subjectId: level.subject,
      subjectName: getSubjectDisplayName(level.subject),
      questLevelId: level.id,
      questLevelTitle: level.title
    };

    questChallengeArticle = article;
    hideQuestEl(loading);

    if (typeof renderPracticeArticle === 'function' && root) {
      renderPracticeArticle(article, root, { skipScroll: true, showSave: true });
      markQuestProgress('reading');
      bindQuestChallengeProgress(root);
      focusQuestWritingLevel(root, level.level);
      if (genBtn) {
        genBtn.textContent = '🔄 重新生成文章';
        genBtn.disabled = false;
      }
      questToast('📖 文章已就緒，請完成段落測驗與寫作練習');
      syncQuestStepIndicators();
    } else {
      showQuestError('無法渲染挑戰文章，請重新整理後再試。');
      if (genBtn) genBtn.disabled = false;
    }
  } catch (error) {
    hideQuestEl(loading);
    showQuestError(error?.message || '生成失敗，請稍後再試。');
    if (genBtn) genBtn.disabled = false;
  }
}

/**
 * L0：呼叫 renderL0VocabTask
 */
async function handleQuestL0Start() {
  const level = activeQuestLevel;
  if (!level) return;

  const hasKey = !!localStorage.getItem(
    typeof STORAGE_KEY_API !== 'undefined'
      ? STORAGE_KEY_API
      : 'swlearning_deepseek_api_key'
  );
  if (!hasKey) {
    showQuestError('請先在設定中輸入 DeepSeek API Key。');
    return;
  }

  if (typeof window.renderL0VocabTask !== 'function') {
    showQuestError('L0 單字模組尚未載入，請強制重新整理後再試。');
    return;
  }

  applyQuestSubject(level.subject);

  const loading = quest$('quest-challenge-loading');
  const genBtn = quest$('btn-quest-generate');
  const root = quest$('quest-challenge-root');
  const loadingText = loading?.querySelector('.loading-text');

  hideQuestEl(quest$('quest-challenge-error'));
  showQuestEl(loading);
  if (loadingText) {
    loadingText.textContent = '正在產生單字配對題目…';
  }
  if (genBtn) genBtn.disabled = true;
  if (root) root.innerHTML = '';

  try {
    const wish = getWishForChapter(level.chapter);
    await window.renderL0VocabTask(root, {
      subjectId: level.subject,
      subjectName: getSubjectDisplayName(level.subject),
      wishText: wish?.wishText || '',
      levelId: level.id,
      levelTitle: level.title,
      chapterId: level.chapter,
      onAllCorrect: () => {
        markQuestProgress('reading');
        markQuestProgress('quiz');
        markQuestProgress('writing');
        syncQuestStepIndicators();
        questToast('🎉 全對！可收藏生字後通關');
      },
      onComplete: () => {
        completeActiveQuestLevel();
      },
      onError: (message) => {
        showQuestError(message);
      }
    });

    hideQuestEl(loading);
    questChallengeArticle = { type: 'l0', id: `l0-${level.id}` };
    if (genBtn) {
      genBtn.textContent = '🔄 重新產生題目';
      genBtn.disabled = false;
    }
    syncQuestStepIndicators();
  } catch (error) {
    hideQuestEl(loading);
    showQuestError(error?.message || '單字題目生成失敗，請稍後再試。');
    if (genBtn) genBtn.disabled = false;
  }
}

/**
 * @param {string} message
 */
function showQuestError(message) {
  const el = quest$('quest-challenge-error');
  if (!el) {
    questToast(`❌ ${message}`);
    return;
  }
  el.textContent = message;
  showQuestEl(el);
}

/**
 * 通關
 */
function completeActiveQuestLevel() {
  if (!activeQuestLevel) return;

  const isL0 = activeQuestLevel.level === 'L0';
  const ready = isL0
    ? questProgress.quiz
    : questProgress.reading &&
      questProgress.quiz &&
      questProgress.writing;

  if (!ready) {
    questToast(
      isL0 ? '請先答對全部單字題目' : '請先完成閱讀、測驗與寫作練習'
    );
    return;
  }

  const id = activeQuestLevel.id;
  const idx = questLevels.findIndex((l) => l.id === id);
  if (idx < 0) return;

  const wasAlreadyDone = questLevels[idx].status === 'completed';
  const clearedLevel = { ...questLevels[idx] };
  questLevels[idx] = { ...questLevels[idx], status: 'completed' };

  if (idx + 1 < questLevels.length && questLevels[idx + 1].status !== 'completed') {
    questLevels[idx + 1] = { ...questLevels[idx + 1], status: 'active' };
  }

  reconcileQuestStatuses();
  saveQuestLevels();

  const clearedTitle = activeQuestLevel.title;
  const next = questLevels.find((l) => l.status === 'active');
  const wish = getWishForChapter(clearedLevel.chapter);
  const isChapterClear = clearedLevel.isChest;

  closeQuestChallenge();
  renderQuestMap();
  showQuestClearModal(clearedTitle, next, {
    wishText: wish?.wishText || '',
    isChapterClear,
    chapterId: clearedLevel.chapter
  });

  if (!wasAlreadyDone && typeof window.earnGem === 'function') {
    try {
      window.earnGem('quest_clear');
    } catch (_) {
      // ignore
    }
  }

  if (typeof confetti === 'function') {
    confetti({
      particleCount: isChapterClear ? 140 : 90,
      spread: isChapterClear ? 80 : 68,
      origin: { y: 0.65 },
      colors: ['#22c55e', '#3b82f6', '#fbbf24', '#f472b6']
    });
  }
}

/**
 * @param {string} title
 * @param {Object|null|undefined} nextLevel
 * @param {{wishText?: string, isChapterClear?: boolean, chapterId?: number}} [extra]
 */
function showQuestClearModal(title, nextLevel, extra) {
  const modal = quest$('quest-clear-modal');
  const text = quest$('quest-clear-text');
  const modalTitle = quest$('quest-clear-title');

  if (modalTitle) {
    modalTitle.textContent = extra?.isChapterClear
      ? '🎁 章節願望達成！'
      : '🎉 恭喜通關！';
  }

  if (text) {
    if (extra?.isChapterClear && extra.wishText) {
      text.textContent = nextLevel
        ? `「${title}」通關！願望「${extra.wishText}」已點亮。下一章從 Lv ${nextLevel.id} 開始，記得再設新願望哦！`
        : `「${title}」通關！願望「${extra.wishText}」已點亮。你完成了整條社工英文歷險地圖！`;
    } else {
      text.textContent = nextLevel
        ? `「${title}」已通關！下一關「Lv ${nextLevel.id} · ${nextLevel.title}」已解鎖。`
        : `「${title}」已通關！你完成了整條社工英文歷險地圖！`;
    }
  }
  if (modal) modal.classList.remove('hidden');
}

function closeQuestClearModal() {
  const modal = quest$('quest-clear-modal');
  if (modal) modal.classList.add('hidden');
}

/* ============================================================
   初始化
   ============================================================ */

function bindQuestEvents() {
  quest$('btn-quest-regen')?.addEventListener('click', () => {
    const ok = window.confirm(
      '重新分配會重置 100 關進度（願望會保留），確定要以目前科目重新產生地圖嗎？'
    );
    if (!ok) return;
    try {
      localStorage.removeItem('sw_quest_l0_recent_terms');
    } catch (_) {
      // ignore
    }
    generateQuestLevels(getQuestCurrentSubject()?.id);
    renderQuestMap();
  });

  quest$('btn-quest-challenge-close')?.addEventListener('click', closeQuestChallenge);
  quest$('btn-quest-generate')?.addEventListener('click', handleQuestGenerateArticle);
  quest$('btn-quest-complete')?.addEventListener('click', completeActiveQuestLevel);

  quest$('btn-close-quest-clear')?.addEventListener('click', closeQuestClearModal);
  quest$('quest-clear-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeQuestClearModal();
  });

  quest$('btn-wish-save')?.addEventListener('click', handleWishSettingSubmit);
  quest$('btn-wish-cancel')?.addEventListener('click', closeWishSettingModal);
  quest$('wish-setting-modal')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeWishSettingModal();
  });
  quest$('wish-text-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleWishSettingSubmit();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const wishModal = quest$('wish-setting-modal');
    if (wishModal && !wishModal.classList.contains('hidden')) {
      closeWishSettingModal();
      return;
    }
    const overlay = quest$('quest-challenge-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      closeQuestChallenge();
    }
  });
}

function initQuestModeModule() {
  questWishes = loadQuestWishes();
  questLevels = loadQuestLevels();
  if (questLevels.length) {
    if (questLevels.length !== QUEST_LEVEL_COUNT) {
      ensureQuestLevels({ silent: true });
    } else {
      questLevels = questLevels.map((item, index) =>
        normalizeQuestLevel(item, index)
      );
      reconcileQuestStatuses();
      saveQuestLevels();
    }
  }
  bindQuestEvents();
}

window.initQuestModeModule = initQuestModeModule;
window.refreshQuestView = refreshQuestView;
window.renderQuestMap = renderQuestMap;
window.generateQuestLevels = generateQuestLevels;
window.ensureQuestLevels = ensureQuestLevels;
window.onLearningGoalStarted = onLearningGoalStarted;
window.getQuestLevels = () => questLevels.slice();
window.getQuestWishes = () => ({ ...questWishes });
window.STORAGE_KEY_QUEST = STORAGE_KEY_QUEST;
window.STORAGE_KEY_QUEST_WISHES = STORAGE_KEY_QUEST_WISHES;
