/**
 * sync.js — 雲端同步引擎（含本機／雲端衝突分辨）
 *
 * 職責：
 * 1. 打包本機 localStorage 學習資料上傳至 Firestore
 * 2. 從雲端下載並覆蓋本機 localStorage
 * 3. 同步前比對兩邊資料，兩邊皆有時強制確認，避免誤覆蓋
 * 4. 登入後若偵測衝突，主動開啟同步視窗
 */

import {
  doc,
  setDoc,
  getDoc,
  isFirebaseReady,
  getFirebaseAuth,
  getFirebaseDb,
  STORAGE_KEY_FIREBASE
} from './firebase-init.js';

/** 不同步敏感／裝置設定鍵 */
const EXCLUDE_KEYS = new Set([
  'swlearning_deepseek_api_key',
  STORAGE_KEY_FIREBASE
]);

/** @type {{ local: object, cloud: object } | null} */
let lastCompareResult = null;

/** 用來判斷「剛登入」而非頁面重整帶入既有 session */
let previousAuthUid = undefined;

/**
 * @param {string} key
 * @returns {boolean}
 */
function shouldSyncKey(key) {
  if (!key || EXCLUDE_KEYS.has(key)) return false;
  return (
    key.startsWith('sw_') ||
    key.startsWith('swlearning_') ||
    key.startsWith('custom_sw_')
  );
}

/**
 * @returns {Record<string, string>}
 */
function collectLocalStoragePayload() {
  const data = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!shouldSyncKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) {
      data[key] = value;
    }
  }
  return data;
}

/**
 * @param {string} message
 */
function syncToast(message) {
  if (typeof window.showToast === 'function') {
    window.showToast(message);
  } else {
    console.log('[sync]', message);
  }
}

function requireFirebaseServices() {
  if (!isFirebaseReady()) {
    syncToast('請先到「設定」連上 Firebase');
    return null;
  }
  const auth = getFirebaseAuth();
  const db = getFirebaseDb();
  if (!auth || !db) {
    syncToast('Firebase 尚未就緒，請重新連線');
    return null;
  }
  return { auth, db };
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function toDateOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch (_) {
      return null;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    const seconds = Number(/** @type {{ seconds: number }} */ (value).seconds);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000);
  }
  return null;
}

/**
 * @param {Date | null} date
 * @returns {string}
 */
function formatDateTime(date) {
  if (!date) return '未知時間';
  try {
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_) {
    return date.toISOString();
  }
}

function getLocalSyncSummary() {
  const data = collectLocalStoragePayload();
  const keys = Object.keys(data);
  return {
    hasData: keys.length > 0,
    keyCount: keys.length,
    keys
  };
}

/**
 * @param {string} uid
 */
async function getCloudSyncSummary(uid) {
  const services = requireFirebaseServices();
  if (!services) {
    return {
      hasData: false,
      keyCount: 0,
      lastUpdated: null,
      missing: true
    };
  }

  const snap = await getDoc(doc(services.db, 'users', uid));
  if (!snap.exists()) {
    return {
      hasData: false,
      keyCount: 0,
      lastUpdated: null,
      missing: false
    };
  }

  const remote = snap.data() || {};
  const data =
    remote.data && typeof remote.data === 'object' ? remote.data : {};
  const keys = Object.keys(data).filter(shouldSyncKey);
  const lastUpdated = toDateOrNull(remote.lastUpdated);

  return {
    hasData: keys.length > 0,
    keyCount: keys.length,
    lastUpdated,
    missing: false
  };
}

/**
 * 比對本機與雲端，供 UI 與覆蓋前確認使用
 * @param {string} uid
 */
async function compareLocalAndCloud(uid) {
  const local = getLocalSyncSummary();
  const cloud = await getCloudSyncSummary(uid);
  const bothHaveData = local.hasData && cloud.hasData;
  const result = { local, cloud, bothHaveData };
  lastCompareResult = result;
  return result;
}

/**
 * 把比對結果寫進同步 Modal
 * @param {{ local: object, cloud: object, bothHaveData: boolean } | null} result
 * @param {string} [errorMessage]
 */
function renderSyncComparison(result, errorMessage) {
  const localEl = document.getElementById('sync-local-meta');
  const cloudEl = document.getElementById('sync-cloud-meta');
  const conflictEl = document.getElementById('sync-conflict-banner');
  const hintEl = document.getElementById('sync-hint');
  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');

  if (errorMessage) {
    if (localEl) localEl.textContent = '無法取得';
    if (cloudEl) cloudEl.textContent = errorMessage;
    if (conflictEl) conflictEl.classList.add('hidden');
    return;
  }

  if (!result) {
    if (localEl) localEl.textContent = '檢查中…';
    if (cloudEl) cloudEl.textContent = '檢查中…';
    if (conflictEl) conflictEl.classList.add('hidden');
    return;
  }

  const { local, cloud, bothHaveData } = result;

  if (localEl) {
    localEl.textContent = local.hasData
      ? `${local.keyCount} 筆學習資料`
      : '尚無學習資料';
  }

  if (cloudEl) {
    if (cloud.hasData) {
      cloudEl.textContent = `${cloud.keyCount} 筆（更新於 ${formatDateTime(
        cloud.lastUpdated
      )}）`;
    } else {
      cloudEl.textContent = '尚無資料';
    }
  }

  if (conflictEl) {
    conflictEl.classList.toggle('hidden', !bothHaveData);
  }

  if (hintEl) {
    if (bothHaveData) {
      hintEl.textContent =
        '兩邊都有資料：請明確選擇「以本機為準上傳」或「以雲端為準下載」。連線本身不會自動覆蓋任一方。';
    } else if (local.hasData && !cloud.hasData) {
      hintEl.textContent =
        '建議：先上傳本機資料到雲端，其他裝置再下載。';
    } else if (!local.hasData && cloud.hasData) {
      hintEl.textContent =
        '建議：下載雲端資料到此裝置。';
    } else {
      hintEl.textContent = '兩邊都還沒有可同步資料。';
    }
  }

  if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.textContent = cloud.hasData
      ? '⬆️ 以本機覆蓋雲端'
      : '⬆️ 上傳到雲端';
  }
  if (downloadBtn) {
    downloadBtn.disabled = !cloud.hasData;
    downloadBtn.textContent = local.hasData
      ? '⬇️ 以雲端覆蓋本機'
      : '⬇️ 下載到本機';
  }
}

/**
 * @param {string} uid
 */
async function uploadToCloud(uid) {
  if (!uid) throw new Error('缺少使用者 uid');
  const services = requireFirebaseServices();
  if (!services) throw new Error('Firebase 未連線');

  const { db } = services;
  const payload = collectLocalStoragePayload();
  const keyCount = Object.keys(payload).length;

  await setDoc(
    doc(db, 'users', uid),
    {
      data: payload,
      lastUpdated: new Date(),
      keyCount
    },
    { merge: true }
  );

  syncToast(`✅ 已上傳 ${keyCount} 筆資料至雲端`);
}

/**
 * @param {string} uid
 */
async function downloadFromCloud(uid) {
  if (!uid) throw new Error('缺少使用者 uid');
  const services = requireFirebaseServices();
  if (!services) throw new Error('Firebase 未連線');

  const { db } = services;
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    syncToast('☁️ 雲端尚無資料，請先從此裝置上傳');
    return;
  }

  const remote = snap.data() || {};
  const data = remote.data;

  if (!data || typeof data !== 'object') {
    syncToast('☁️ 雲端資料格式異常');
    return;
  }

  const keys = Object.keys(data);
  if (keys.length === 0) {
    syncToast('☁️ 雲端資料為空');
    return;
  }

  keys.forEach((key) => {
    if (!shouldSyncKey(key)) return;
    const value = data[key];
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, String(value));
  });

  syncToast(`✅ 已從雲端下載 ${keys.length} 筆資料，即將重新載入…`);
  setTimeout(() => {
    location.reload();
  }, 600);
}

/**
 * @returns {string | null}
 */
function requireUid() {
  const services = requireFirebaseServices();
  if (!services) return null;

  const user = services.auth.currentUser || window.firebaseCurrentUser;
  if (!user || !user.uid) {
    syncToast('請先登入再進行雲端同步');
    return null;
  }
  return user.uid;
}

/**
 * 覆蓋前二次確認（兩邊都有資料時必問）
 * @param {'upload' | 'download'} mode
 * @param {{ local: object, cloud: object, bothHaveData: boolean }} compare
 * @returns {boolean}
 */
function confirmDestructiveSync(mode, compare) {
  const { local, cloud, bothHaveData } = compare;

  if (mode === 'upload') {
    if (!local.hasData) {
      const okEmpty = window.confirm(
        '本機目前沒有可同步的學習資料。\n若繼續上傳，可能用空資料覆蓋雲端。確定嗎？'
      );
      return okEmpty;
    }
    if (cloud.hasData || bothHaveData) {
      return window.confirm(
        [
          '即將以「本機資料」覆蓋「雲端資料」。',
          '',
          `本機：${local.keyCount} 筆`,
          `雲端：${cloud.keyCount} 筆（更新於 ${formatDateTime(
            cloud.lastUpdated
          )}）`,
          '',
          '雲端現有內容會被取代，且無法自動復原。確定上傳嗎？'
        ].join('\n')
      );
    }
    return true;
  }

  // download
  if (!cloud.hasData) {
    syncToast('☁️ 雲端尚無資料可下載');
    return false;
  }
  if (local.hasData || bothHaveData) {
    return window.confirm(
      [
        '即將以「雲端資料」覆蓋「本機資料」。',
        '',
        `本機：${local.keyCount} 筆`,
        `雲端：${cloud.keyCount} 筆（更新於 ${formatDateTime(
          cloud.lastUpdated
        )}）`,
        '',
        '本機現有學習內容會被取代，並重新載入頁面。確定下載嗎？'
      ].join('\n')
    );
  }
  return true;
}

async function openSyncModal() {
  const modal = document.getElementById('sync-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  renderSyncComparison(null);

  const uid = requireUid();
  if (!uid) {
    closeSyncModal();
    return;
  }

  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');
  if (uploadBtn) uploadBtn.disabled = true;
  if (downloadBtn) downloadBtn.disabled = true;

  try {
    const result = await compareLocalAndCloud(uid);
    renderSyncComparison(result);
  } catch (error) {
    console.error('[sync] 比對失敗：', error);
    renderSyncComparison(null, '讀取雲端狀態失敗');
    if (uploadBtn) uploadBtn.disabled = false;
    if (downloadBtn) downloadBtn.disabled = false;
  }
}

function closeSyncModal() {
  const modal = document.getElementById('sync-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * @param {'upload' | 'download'} mode
 */
async function runSync(mode) {
  const uid = requireUid();
  if (!uid) return;

  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');
  const buttons = [uploadBtn, downloadBtn].filter(Boolean);

  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  try {
    const compare = await compareLocalAndCloud(uid);
    renderSyncComparison(compare);

    if (!confirmDestructiveSync(mode, compare)) {
      syncToast('已取消同步');
      return;
    }

    if (mode === 'upload') {
      await uploadToCloud(uid);
      const refreshed = await compareLocalAndCloud(uid);
      renderSyncComparison(refreshed);
      closeSyncModal();
    } else {
      await downloadFromCloud(uid);
    }
  } catch (error) {
    console.error('[sync] 同步失敗：', error);
    syncToast('❌ 同步失敗，請檢查網路或 Firebase 權限後再試');
    closeSyncModal();
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

/**
 * 登入後若兩邊都有資料，主動開啟分辨視窗（僅剛登入時）
 * @param {import('https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js').User | null} user
 */
async function handleAuthChangeForConflict(user) {
  const uid = user && user.uid ? user.uid : null;

  // 第一次收到 auth 狀態：只建立基準，避免重整頁面就彈窗
  if (previousAuthUid === undefined) {
    previousAuthUid = uid;
    return;
  }

  const justLoggedIn = Boolean(uid && previousAuthUid !== uid);
  previousAuthUid = uid;

  if (!justLoggedIn || !uid) return;

  try {
    const result = await compareLocalAndCloud(uid);
    if (!result.bothHaveData) return;

    syncToast('⚠️ 本機與雲端都有資料，請選擇要以哪一邊為準');
    await openSyncModal();
  } catch (error) {
    console.error('[sync] 登入後衝突檢查失敗：', error);
  }
}

function bindSyncUI() {
  const syncBtn = document.getElementById('btn-sync');
  const closeBtn = document.getElementById('btn-close-sync-modal');
  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');
  const modal = document.getElementById('sync-modal');

  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      if (!requireUid()) return;
      openSyncModal();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSyncModal);
  }

  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeSyncModal();
    });
  }

  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      runSync('upload');
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      runSync('download');
    });
  }

  window.addEventListener('sw-firebase-auth', (event) => {
    const detail = /** @type {CustomEvent} */ (event).detail || {};
    handleAuthChangeForConflict(detail.user || null);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSyncUI);
} else {
  bindSyncUI();
}

window.uploadToCloud = uploadToCloud;
window.downloadFromCloud = downloadFromCloud;
window.openSyncModal = openSyncModal;

export {
  uploadToCloud,
  downloadFromCloud,
  collectLocalStoragePayload,
  compareLocalAndCloud,
  openSyncModal
};
