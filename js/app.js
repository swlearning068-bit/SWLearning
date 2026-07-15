/**
 * app.js — 社工英文學習助手 主程式
 *
 * 職責：
 * 1. 管理設定 Modal 與 API Key
 * 2. Tab 切換（寫作 / 閱讀 / 詞彙庫 / 生字複習 / 測驗 / 文章庫 / 學習目標）
 * 3. 載入 14 個社工科目並支援動態切換（localStorage）
 * 4. 初始化各功能模組
 * 5. 動態確保 flashcard.css 已載入
 *
 * 寫作練習（L1/L2/L3）邏輯已獨立至 writing.js
 */

// localStorage 鍵名已在 deepseek.js 宣告為 STORAGE_KEY_API / STORAGE_KEY_SUBJECT
// （否則瀏覽器會拋 SyntaxError，導致整支 app.js 無法執行、畫面空白）

/* ============================================================
   科目狀態
   ============================================================ */

/** @type {Array<{id: string, name: string, prompt_context: string}>} */
let subjectsList = [];

/** 目前選中的科目物件 */
let currentSubject = null;

/**
 * 取得當前科目的 prompt_context（供 deepseek.js 動態附加）
 * @returns {string}
 */
function getSubjectPromptAddition() {
  return currentSubject && currentSubject.prompt_context
    ? currentSubject.prompt_context
    : '';
}

/**
 * 取得當前科目顯示名稱
 * @returns {string}
 */
function getCurrentSubjectName() {
  return currentSubject && currentSubject.name
    ? currentSubject.name
    : '通用社工實務';
}

/* ============================================================
   Toast 浮動提示（可重複使用）
   ============================================================ */

/** @type {ReturnType<typeof setTimeout>|null} */
let toastHideTimer = null;

/**
 * 顯示短暫浮動提示，約 2.5 秒後自動隱藏
 * @param {string} message
 */
function showToast(message) {
  const toast = $('toast-notification');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove('toast-hidden');
  toast.classList.add('toast-show');

  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hidden');
    toastHideTimer = null;
  }, 2500);
}

/**
 * 取得當前科目完整物件（供 deepseek.js 讀取 name / prompt_context）
 * @returns {{id: string, name: string, prompt_context: string}|null}
 */
function getCurrentSubject() {
  return currentSubject;
}

window.getSubjectPromptAddition = getSubjectPromptAddition;
window.getCurrentSubjectName = getCurrentSubjectName;
window.getCurrentSubject = getCurrentSubject;
window.showToast = showToast;
window.subjectsList = subjectsList;

/* ============================================================
   工具函式
   ============================================================ */

/**
 * 依 ID 取得 DOM 元素，若找不到則在 console 警告
 * @param {string} id - 元素的 id 屬性值
 * @returns {HTMLElement|null}
 */
function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[app.js] 找不到元素：#${id}`);
  return el;
}

/**
 * 顯示指定元素（移除 hidden 類別）
 * @param {HTMLElement} el
 */
function show(el) {
  if (el) el.classList.remove('hidden');
}

/**
 * 隱藏指定元素（加上 hidden 類別）
 * @param {HTMLElement} el
 */
function hide(el) {
  if (el) el.classList.add('hidden');
}

/* ============================================================
   科目選擇器
   ============================================================ */

/**
 * 從 localStorage 讀取已儲存的科目 ID
 * @returns {string}
 */
function getSavedSubjectId() {
  const key = typeof STORAGE_KEY_SUBJECT !== 'undefined'
    ? STORAGE_KEY_SUBJECT
    : 'swlearning_current_subject';
  return localStorage.getItem(key) || '';
}

/**
 * 將科目 ID 寫入 localStorage
 * @param {string} subjectId
 */
function saveSubjectId(subjectId) {
  const key = typeof STORAGE_KEY_SUBJECT !== 'undefined'
    ? STORAGE_KEY_SUBJECT
    : 'swlearning_current_subject';
  localStorage.setItem(key, subjectId);
}

/**
 * 依 ID 設定 currentSubject，同步下拉選單，並立即寫入 localStorage
 * @param {string} subjectId
 */
function setCurrentSubject(subjectId) {
  const aliases =
    typeof SUBJECT_ID_ALIASES !== 'undefined' && SUBJECT_ID_ALIASES
      ? SUBJECT_ID_ALIASES
      : { ethics: 'ethics_and_values' };
  const normalizedId = aliases[subjectId] || subjectId;
  const found = subjectsList.find((s) => s.id === normalizedId);
  currentSubject = found || subjectsList[0] || null;

  const selector = $('subject-selector');
  if (selector && currentSubject) {
    selector.value = currentSubject.id;
  }

  // 切換科目時立即持久化，確保下次 API 呼叫能讀到最新科目
  if (currentSubject) {
    saveSubjectId(currentSubject.id);
  }

  // 同步 window 參考，供 deepseek.js 直接讀取
  window.subjectsList = subjectsList;
  window.currentSubject = currentSubject;
}

/**
 * 將 subjects 陣列渲染到 #subject-selector
 * @param {Array<{id: string, name: string}>} subjects
 */
function renderSubjectSelector(subjects) {
  const selector = $('subject-selector');
  if (!selector) return;

  selector.innerHTML = '';

  subjects.forEach((subject) => {
    const option = document.createElement('option');
    option.value = subject.id;
    option.textContent = subject.name;
    selector.appendChild(option);
  });
}

/**
 * 載入 data/subjects.json 並初始化科目選擇器
 */
async function initSubjectSelector() {
  const selector = $('subject-selector');

  try {
    const response = await fetch('data/subjects.json');
    if (!response.ok) {
      throw new Error(`無法載入科目資料（狀態碼 ${response.status}）`);
    }

    const data = await response.json();
    subjectsList = Array.isArray(data.subjects) ? data.subjects : [];

    if (subjectsList.length === 0) {
      throw new Error('科目資料為空');
    }

    renderSubjectSelector(subjectsList);
    window.subjectsList = subjectsList;

    // 優先還原上次選擇；否則用第一個科目（相容舊 ethics ID）
    const savedId = getSavedSubjectId();
    const aliases =
      typeof SUBJECT_ID_ALIASES !== 'undefined' && SUBJECT_ID_ALIASES
        ? SUBJECT_ID_ALIASES
        : { ethics: 'ethics_and_values' };
    const normalizedSavedId = aliases[savedId] || savedId;
    const initialId = subjectsList.some((s) => s.id === normalizedSavedId)
      ? normalizedSavedId
      : subjectsList[0].id;

    setCurrentSubject(initialId);

    // 切換科目時立即寫入 localStorage（經 setCurrentSubject），並顯示 Toast 確認
    if (selector) {
      selector.addEventListener('change', () => {
        setCurrentSubject(selector.value);
        const subjectName = getCurrentSubjectName();
        showToast('✅ 已切換學習科目至：' + subjectName);

        if (typeof invalidateSuggestedTags === 'function') {
          invalidateSuggestedTags();
        }
      });
    }

  } catch (error) {
    console.error('[app.js] 載入科目失敗：', error);
    if (selector) {
      selector.innerHTML = '<option value="">科目載入失敗</option>';
      selector.disabled = true;
    }
    // 後備：仍提供最小可用科目，避免 AI Prompt 完全沒有脈絡
    subjectsList = [{
      id: 'general_practice',
      name: '通用社工實務',
      prompt_context: '此情境為香港通用社工實務，請使用 casework, home visit, resource referral, follow-up 等前線社工日常專有名詞。'
    }];
    currentSubject = subjectsList[0];
    window.subjectsList = subjectsList;
    window.currentSubject = currentSubject;
    saveSubjectId(currentSubject.id);
  }
}

/* ============================================================
   API Key 管理
   ============================================================ */

/**
 * 檢查 localStorage 是否有 API Key，並切換情境演練區顯示狀態
 * - 有 Key：顯示情境演練主體，隱藏警告
 * - 無 Key：顯示警告，隱藏情境演練主體
 */
function refreshApiKeyState() {
  const hasKey = !!localStorage.getItem(STORAGE_KEY_API);

  const warning = $('api-key-warning');
  const practice = $('case-practice') || $('writing-practice');

  if (hasKey) {
    hide(warning);
    show(practice);
  } else {
    show(warning);
    hide(practice);
  }
}

/**
 * 開啟設定 Modal，並將已儲存的 API Key／Firebase 設定填入表單
 */
function openSettingsModal() {
  const modal     = $('settings-modal');
  const keyInput  = $('api-key-input');
  const savedKey  = localStorage.getItem(STORAGE_KEY_API) || '';

  if (keyInput) keyInput.value = savedKey;

  if (typeof window.refreshFirebaseSettingsUI === 'function') {
    window.refreshFirebaseSettingsUI();
  }

  show(modal);
  if (keyInput) keyInput.focus();
}

window.openSettingsModal = openSettingsModal;

/**
 * 關閉設定 Modal
 */
function closeSettingsModal() {
  hide($('settings-modal'));
}

/**
 * 保存 API Key 至 localStorage，並更新主畫面狀態
 */
function saveApiKey() {
  const keyInput = $('api-key-input');
  const key = keyInput ? keyInput.value.trim() : '';

  if (!key) {
    alert('請輸入 DeepSeek API Key 後再保存。');
    return;
  }

  localStorage.setItem(STORAGE_KEY_API, key);
  closeSettingsModal();
  refreshApiKeyState();
}

/* ============================================================
   Tab 切換（寫作 ↔ 閱讀 ↔ 詞彙庫 ↔ 生字複習 ↔ 測驗 ↔ 文獻庫）
   ============================================================ */

/**
 * 確保 flashcard.css 已掛載（若 HTML 未引入則動態補上）
 */
function ensureFlashcardStyles() {
  const href = 'css/flashcard.css';
  const existing = document.querySelector(`link[href="${href}"], link[href*="flashcard.css"]`);
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/**
 * 切換到指定 Tab，顯示對應 section、隱藏其餘
 * 生字複習（learn）掛在專業詞彙庫底下，進入時高亮「專業詞彙庫」Tab
 * @param {'practice'|'vocab'|'learn'|'quiz'|'articles'|'reward'} tabName
 */
function switchTab(tabName) {
  // 相容舊呼叫
  if (tabName === 'writing' || tabName === 'reading') {
    tabName = 'practice';
  }

  const sections = {
    practice: $('practice-section'),
    writing:  $('writing-section'),
    reading:  $('reading-section'),
    vocab:    $('vocab-section'),
    learn:    $('learn-section'),
    quiz:     $('quiz-section'),
    articles: $('article-library-section'),
    reward:   $('reward-section')
  };

  const tabs = {
    practice: $('tab-practice'),
    vocab:    $('tab-vocab'),
    quiz:     $('tab-quiz'),
    articles: $('nav-article-library'),
    reward:   $('nav-reward')
  };

  Object.keys(sections).forEach((name) => {
    const section = sections[name];
    if (!section) return;
    // 舊 writing／reading 區塊永久隱藏
    if (name === 'writing' || name === 'reading') {
      hide(section);
      return;
    }
    if (name === tabName) {
      show(section);
    } else {
      hide(section);
    }
  });

  // 生字複習屬於詞彙庫子功能，導覽列維持「專業詞彙庫」為作用中
  const activeTabName = tabName === 'learn' ? 'vocab' : tabName;

  Object.keys(tabs).forEach((name) => {
    const tab = tabs[name];
    if (!tab) return;
    const isActive = name === activeTabName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  if (tabName === 'learn' && typeof refreshLearnSession === 'function') {
    refreshLearnSession();
  }

  if (tabName === 'articles' && typeof refreshArticleLibraryView === 'function') {
    refreshArticleLibraryView();
  }

  if (tabName === 'reward' && typeof refreshRewardView === 'function') {
    refreshRewardView();
  }
}

/**
 * 綁定 Tab 按鈕的點擊事件
 */
function initTabs() {
  const tabNav = document.querySelector('.tab-nav');
  if (!tabNav) return;

  tabNav.addEventListener('click', (event) => {
    const btn = event.target.closest('.tab-btn');
    if (!btn) return;

    const tabName = btn.dataset.tab;
    if (tabName) switchTab(tabName);
  });
}

/* ============================================================
   初始化：頁面載入完成後執行
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {

  // 0. 確保單字卡樣式已載入
  ensureFlashcardStyles();

  // 1. 載入 14 個社工科目並渲染選擇器
  await initSubjectSelector();

  // 2. 根據 API Key 狀態切換寫作區顯示
  refreshApiKeyState();

  // 3. 綁定設定 Modal 相關按鈕
  $('btn-open-settings')?.addEventListener('click', openSettingsModal);
  $('btn-close-modal')?.addEventListener('click', closeSettingsModal);
  $('btn-save-key')?.addEventListener('click', saveApiKey);

  // 點擊 Modal 背景（遮罩層）也可關閉
  $('settings-modal')?.addEventListener('click', (event) => {
    if (event.target === $('settings-modal')) {
      closeSettingsModal();
    }
  });

  // 4. 初始化 Tab 切換（預設情境演練）
  initTabs();
  switchTab('practice');

  // 5. 初始化情境演練（Phase 11.8，定義於 story.js）
  if (typeof initCasePracticeModule === 'function') {
    initCasePracticeModule();
  }

  // 6. 初始化詞彙庫模組（定義於 vocab-library.js）
  if (typeof initVocabLibrary === 'function') {
    initVocabLibrary();
  }

  // 7. 舊閱讀模組：僅保留文章庫收藏工具；主 UI 已由情境演練接管
  if (typeof initReadingModule === 'function') {
    // 可選：若仍有殘留綁定需求則呼叫；閱讀區 DOM 已清空
    try {
      initReadingModule();
    } catch (_) {
      // ignore：舊面板 ID 可能已移除
    }
  }

  // 8. 初始化生字複習模組（定義於 vocab-learn.js）
  if (typeof initVocabLearn === 'function') {
    initVocabLearn();
  }

  // 9. 初始化測驗模組（定義於 quiz.js）
  if (typeof initQuizModule === 'function') {
    initQuizModule();
  }

  // 10. 初始化統一文章庫模組（定義於 article-library.js）
  if (typeof initArticleLibraryModule === 'function') {
    initArticleLibraryModule();
  }

  // 10.5 Phase 11.9：純淨電子書閱讀器
  if (typeof initEbookModeModule === 'function') {
    initEbookModeModule();
  }

  // 11. 初始化遊戲化獎勵／印花模組（定義於 reward.js）
  if (typeof initRewardModule === 'function') {
    initRewardModule();
  }

});
