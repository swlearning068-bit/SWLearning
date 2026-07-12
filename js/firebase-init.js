/**
 * firebase-init.js — Firebase v10 動態連線與 Google 登入
 *
 * 職責：
 * 1. 使用者在設定頁貼上 firebaseConfig，存入 localStorage
 * 2. 依設定動態 initializeApp / Auth / Firestore（無硬編碼專案）
 * 3. 綁定導覽列登入／登出，並暴露 getter 供 sync.js 使用
 */

import {
  initializeApp,
  getApps,
  deleteApp
} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';

const STORAGE_KEY_FIREBASE = 'swlearning_firebase_config';

/** @type {import('https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js').FirebaseApp | null} */
let app = null;
/** @type {import('https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js').Auth | null} */
let auth = null;
/** @type {import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js').Firestore | null} */
let db = null;
/** @type {(() => void) | null} */
let unsubscribeAuth = null;
/** @type {GoogleAuthProvider | null} */
let googleProvider = null;

function authToast(message) {
  if (typeof window.showToast === 'function') {
    window.showToast(message);
  } else {
    console.log('[auth]', message);
  }
}

/**
 * @param {unknown} config
 * @returns {config is Record<string, string>}
 */
function isValidFirebaseConfig(config) {
  if (!config || typeof config !== 'object') return false;
  const c = /** @type {Record<string, unknown>} */ (config);
  return Boolean(
    typeof c.apiKey === 'string' &&
      c.apiKey.trim() &&
      typeof c.authDomain === 'string' &&
      c.authDomain.trim() &&
      typeof c.projectId === 'string' &&
      c.projectId.trim() &&
      typeof c.appId === 'string' &&
      c.appId.trim()
  );
}

/**
 * 解析使用者貼上的 Firebase 設定（支援 JSON 或 Console 複製的 JS 物件）
 * @param {string} raw
 * @returns {Record<string, string> | null}
 */
function parseFirebaseConfigInput(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;

  const assignMatch = text.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (assignMatch) text = assignMatch[1].trim();

  try {
    const parsed = JSON.parse(text);
    return isValidFirebaseConfig(parsed) ? parsed : null;
  } catch (_) {
    // continue
  }

  try {
    const normalized = text
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(normalized);
    return isValidFirebaseConfig(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function loadSavedFirebaseConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FIREBASE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidFirebaseConfig(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveFirebaseConfig(config) {
  localStorage.setItem(STORAGE_KEY_FIREBASE, JSON.stringify(config));
}

function clearSavedFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEY_FIREBASE);
}

function isFirebaseReady() {
  return Boolean(app && auth && db);
}

function getFirebaseAuth() {
  return auth;
}

function getFirebaseDb() {
  return db;
}

/**
 * @param {import('https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js').User | null} [user]
 */
function updateAuthUI(user) {
  const loginBtn = document.getElementById('btn-login');
  const profile = document.getElementById('user-profile');
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');

  if (!loginBtn || !profile) return;

  const ready = isFirebaseReady();
  const currentUser =
    user !== undefined ? user : (auth && auth.currentUser) || null;

  if (!ready) {
    loginBtn.classList.remove('hidden');
    loginBtn.textContent = '設定雲端同步';
    profile.classList.add('hidden');
    return;
  }

  if (currentUser) {
    loginBtn.classList.add('hidden');
    profile.classList.remove('hidden');

    if (emailEl) {
      emailEl.textContent =
        currentUser.displayName || currentUser.email || '已登入';
      emailEl.title = currentUser.email || '';
    }

    if (avatarEl) {
      if (currentUser.photoURL) {
        avatarEl.src = currentUser.photoURL;
        avatarEl.alt =
          currentUser.displayName || currentUser.email || '使用者頭像';
        avatarEl.classList.remove('hidden');
      } else {
        avatarEl.removeAttribute('src');
        avatarEl.classList.add('hidden');
      }
    }
  } else {
    loginBtn.classList.remove('hidden');
    loginBtn.textContent = '登入以同步';
    profile.classList.add('hidden');
    if (emailEl) {
      emailEl.textContent = '';
      emailEl.title = '';
    }
    if (avatarEl) {
      avatarEl.removeAttribute('src');
      avatarEl.classList.add('hidden');
    }
  }
}

function updateFirebaseStatusUI() {
  const statusEl = document.getElementById('firebase-status');
  const connectBtn = document.getElementById('btn-firebase-connect');
  const disconnectBtn = document.getElementById('btn-firebase-disconnect');
  const config = loadSavedFirebaseConfig();

  if (statusEl) {
    if (isFirebaseReady() && config) {
      statusEl.textContent = `已連線：${config.projectId}`;
      statusEl.classList.remove('firebase-status--off');
      statusEl.classList.add('firebase-status--on');
    } else if (config) {
      statusEl.textContent = `已儲存設定（尚未連線）：${config.projectId}`;
      statusEl.classList.add('firebase-status--off');
      statusEl.classList.remove('firebase-status--on');
    } else {
      statusEl.textContent = '尚未連線 Firebase';
      statusEl.classList.add('firebase-status--off');
      statusEl.classList.remove('firebase-status--on');
    }
  }

  if (connectBtn) {
    connectBtn.textContent = isFirebaseReady() ? '重新連線' : '儲存並連線';
  }
  if (disconnectBtn) {
    disconnectBtn.disabled = !isFirebaseReady() && !config;
  }
}

function refreshFirebaseSettingsUI() {
  const textarea = document.getElementById('firebase-config-input');
  const config = loadSavedFirebaseConfig();
  if (textarea) {
    textarea.value = config ? JSON.stringify(config, null, 2) : '';
  }
  updateFirebaseStatusUI();
  updateAuthUI();
}

function exposeFirebaseGlobals() {
  window.firebaseApp = app;
  window.firebaseAuth = auth;
  window.firebaseDb = db;
  window.firebaseDoc = doc;
  window.firebaseSetDoc = setDoc;
  window.firebaseGetDoc = getDoc;
  window.firebaseCurrentUser = (auth && auth.currentUser) || null;
  window.isFirebaseReady = isFirebaseReady;
  window.getFirebaseAuth = getFirebaseAuth;
  window.getFirebaseDb = getFirebaseDb;
}

/**
 * @param {{ clearConfig?: boolean }} [options]
 */
async function disconnectFirebase(options = {}) {
  const clearConfig = Boolean(options.clearConfig);

  try {
    if (unsubscribeAuth) {
      unsubscribeAuth();
      unsubscribeAuth = null;
    }

    if (auth && auth.currentUser) {
      await signOut(auth);
    }

    if (app) {
      await deleteApp(app);
    }
  } catch (error) {
    console.error('[firebase-init] 中斷連線失敗：', error);
  }

  app = null;
  auth = null;
  db = null;
  googleProvider = null;
  window.firebaseCurrentUser = null;
  exposeFirebaseGlobals();

  window.dispatchEvent(
    new CustomEvent('sw-firebase-auth', { detail: { user: null } })
  );

  if (clearConfig) {
    clearSavedFirebaseConfig();
    const textarea = document.getElementById('firebase-config-input');
    if (textarea) textarea.value = '';
  }

  updateAuthUI(null);
  updateFirebaseStatusUI();
}

/**
 * @param {Record<string, string>} config
 */
async function connectFirebase(config) {
  if (!isValidFirebaseConfig(config)) {
    throw new Error(
      'Firebase 設定不完整，請確認 apiKey、authDomain、projectId、appId'
    );
  }

  const current = loadSavedFirebaseConfig();
  if (
    isFirebaseReady() &&
    current &&
    current.apiKey === config.apiKey &&
    current.projectId === config.projectId &&
    current.appId === config.appId
  ) {
    saveFirebaseConfig(config);
    updateFirebaseStatusUI();
    updateAuthUI();
    return;
  }

  if (unsubscribeAuth) {
    unsubscribeAuth();
    unsubscribeAuth = null;
  }

  const existingApps = getApps();
  for (const existing of existingApps) {
    try {
      await deleteApp(existing);
    } catch (error) {
      console.warn('[firebase-init] 刪除舊 App 失敗：', error);
    }
  }

  app = null;
  auth = null;
  db = null;

  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  saveFirebaseConfig(config);
  exposeFirebaseGlobals();

  unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    window.firebaseCurrentUser = user || null;
    updateAuthUI(user);
    window.dispatchEvent(
      new CustomEvent('sw-firebase-auth', { detail: { user: user || null } })
    );
  });

  updateFirebaseStatusUI();
  updateAuthUI();
}

async function handleConnectFromSettings() {
  const textarea = document.getElementById('firebase-config-input');
  const raw = textarea ? textarea.value : '';
  const config = parseFirebaseConfigInput(raw);

  if (!config) {
    authToast('⚠️ 無法解析 Firebase 設定，請貼上完整的 firebaseConfig 物件');
    return;
  }

  const connectBtn = document.getElementById('btn-firebase-connect');
  if (connectBtn) connectBtn.disabled = true;

  try {
    await connectFirebase(config);
    authToast(`✅ 已連線 Firebase（${config.projectId}）`);
  } catch (error) {
    console.error('[firebase-init] 連線失敗：', error);
    authToast('❌ Firebase 連線失敗，請檢查設定內容');
  } finally {
    if (connectBtn) connectBtn.disabled = false;
    updateFirebaseStatusUI();
  }
}

async function handleDisconnectFromSettings() {
  const hasConfig = Boolean(loadSavedFirebaseConfig());
  if (!isFirebaseReady() && !hasConfig) {
    authToast('目前沒有 Firebase 連線');
    return;
  }

  const confirmed = window.confirm(
    '確定要中斷 Firebase 連線，並清除本機儲存的 Firebase 設定嗎？'
  );
  if (!confirmed) return;

  await disconnectFirebase({ clearConfig: true });
  authToast('已中斷 Firebase 連線');
}

async function handleLogin() {
  if (!isFirebaseReady() || !auth || !googleProvider) {
    authToast('請先到「設定」連上你的 Firebase 專案');
    if (typeof window.openSettingsModal === 'function') {
      window.openSettingsModal();
    } else {
      document.getElementById('btn-open-settings')?.click();
    }
    setTimeout(() => {
      document.getElementById('firebase-config-input')?.focus();
    }, 100);
    return;
  }

  try {
    await signInWithPopup(auth, googleProvider);
    authToast('✅ 已登入，可進行雲端同步');
  } catch (error) {
    console.error('[firebase-init] 登入失敗：', error);
    const code = error && error.code ? String(error.code) : '';
    if (code === 'auth/popup-closed-by-user') {
      authToast('已取消登入');
      return;
    }
    if (code === 'auth/unauthorized-domain') {
      authToast('⚠️ 此網域未在 Firebase 授權，請到 Console 加入網域');
      return;
    }
    authToast('❌ 登入失敗，請確認已啟用 Google 登入');
  }
}

async function handleLogout() {
  if (!auth) {
    authToast('尚未連線 Firebase');
    return;
  }
  try {
    await signOut(auth);
    authToast('已登出');
  } catch (error) {
    console.error('[firebase-init] 登出失敗：', error);
    authToast('❌ 登出失敗，請稍後再試');
  }
}

function bindAuthAndSettingsUI() {
  const loginBtn = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');
  const connectBtn = document.getElementById('btn-firebase-connect');
  const disconnectBtn = document.getElementById('btn-firebase-disconnect');

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      handleLogin();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      handleLogout();
    });
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      handleConnectFromSettings();
    });
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      handleDisconnectFromSettings();
    });
  }
}

async function bootstrapFirebase() {
  exposeFirebaseGlobals();
  bindAuthAndSettingsUI();
  refreshFirebaseSettingsUI();

  const saved = loadSavedFirebaseConfig();
  if (!saved) {
    updateAuthUI(null);
    return;
  }

  try {
    await connectFirebase(saved);
  } catch (error) {
    console.error('[firebase-init] 自動連線失敗：', error);
    authToast('⚠️ 已儲存的 Firebase 設定無法連線，請到設定檢查');
    updateAuthUI(null);
    updateFirebaseStatusUI();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bootstrapFirebase();
  });
} else {
  bootstrapFirebase();
}

window.refreshFirebaseSettingsUI = refreshFirebaseSettingsUI;
window.connectFirebaseFromSettings = handleConnectFromSettings;
window.STORAGE_KEY_FIREBASE = STORAGE_KEY_FIREBASE;

export {
  doc,
  setDoc,
  getDoc,
  isFirebaseReady,
  getFirebaseAuth,
  getFirebaseDb,
  connectFirebase,
  disconnectFirebase,
  loadSavedFirebaseConfig,
  parseFirebaseConfigInput,
  STORAGE_KEY_FIREBASE
};
