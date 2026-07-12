/**
 * sync.js — 雲端儲存庫
 *
 * 流程：
 * 1. 首次登入且雲端空白 → 確認後以上傳建立雲端真相
 * 2. 之後裝置登入且雲端已有資料 → 二選一（上傳覆蓋／沿用雲端）
 * 3. 本機標記已對齊後 → 學習資料變更防抖自動上傳
 * 4. 監聽雲端變更 → 其他裝置更新時自動下載並重新載入
 */

import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  onSnapshot,
  isFirebaseReady,
  getFirebaseAuth,
  getFirebaseDb,
  STORAGE_KEY_FIREBASE
} from './firebase-init.js?v=11';

/** 本機對齊標記（不同步上雲） */
const STORAGE_KEY_CLOUD_BOUND = 'swlearning_cloud_bound';
/** 本機裝置識別（用來略過自己上傳觸發的雲端監聽） */
const STORAGE_KEY_DEVICE_ID = 'swlearning_device_id';

/** 不同步敏感／裝置設定鍵 */
const EXCLUDE_KEYS = new Set([
  'swlearning_deepseek_api_key',
  STORAGE_KEY_FIREBASE,
  STORAGE_KEY_CLOUD_BOUND,
  STORAGE_KEY_DEVICE_ID
]);

const AUTO_PUSH_DEBOUNCE_MS = 2500;

/** @type {{ local: object, cloud: object } | null} */
let lastCompareResult = null;

/** @type {string | null | undefined} */
let previousAuthUid = undefined;

/** @type {'first-seed' | 'choose' | 'manual' | null} */
let syncModalMode = null;

let suppressAutoPush = false;
let autoPushTimer = null;
let autoPushInFlight = false;
let autoPushInstalled = false;
/** @type {typeof localStorage.setItem | null} */
let originalSetItem = null;

/** @type {(() => void) | null} */
let cloudPullUnsubscribe = null;
/** @type {string | null} */
let cloudPullUid = null;
let remoteApplyInFlight = false;
let visibilityPullBound = false;

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
  let ready = false;
  try {
    ready = typeof isFirebaseReady === 'function' ? isFirebaseReady() : false;
  } catch (_) {
    ready = false;
  }

  let auth =
    (typeof getFirebaseAuth === 'function' ? getFirebaseAuth() : null) ||
    window.firebaseAuth ||
    null;
  let db =
    (typeof getFirebaseDb === 'function' ? getFirebaseDb() : null) ||
    window.firebaseDb ||
    null;

  if ((!auth || !db) && typeof window.isFirebaseReady === 'function') {
    ready = window.isFirebaseReady() || ready;
    auth =
      auth ||
      (window.getFirebaseAuth && window.getFirebaseAuth()) ||
      window.firebaseAuth;
    db =
      db ||
      (window.getFirebaseDb && window.getFirebaseDb()) ||
      window.firebaseDb;
  }

  if (!ready && !(auth && db)) {
    syncToast('請先到「設定」連上 Firebase');
    return null;
  }
  if (!auth || !db) {
    syncToast('Firebase 尚未就緒，請到設定重新連線');
    return null;
  }
  return { auth, db };
}

/**
 * @param {unknown} error
 */
function describeFirestoreError(error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(/** @type {{ code: string }} */ (error).code)
      : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(/** @type {{ message: string }} */ (error).message)
      : String(error || '');

  if (code === 'permission-denied' || /permission/i.test(message)) {
    return {
      code,
      toast: '⚠️ Firestore 權限不足，請設定安全規則',
      detail: [
        '雲端讀取被拒絕（permission-denied）。',
        '',
        '請到 Firebase Console → Firestore Database → Rules，允許登入者讀寫 users/{userId}。'
      ].join('\n')
    };
  }

  if (
    code === 'not-found' ||
    code === 'failed-precondition' ||
    /cloud firestore .+ has not been (used|created)|does not exist/i.test(
      message
    )
  ) {
    return {
      code,
      toast: '⚠️ 請先在 Firebase 建立 Firestore 資料庫',
      detail:
        '請到 Firebase Console → Build → Firestore Database → 建立資料庫。'
    };
  }

  return {
    code,
    toast: `❌ 讀取雲端失敗${code ? `（${code}）` : ''}`,
    detail: message || '未知錯誤。請打開瀏覽器 Console 查看詳細訊息。'
  };
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
 * @returns {string}
 */
function getDeviceId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY_DEVICE_ID);
    if (id && id.length > 8) return id;
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const prev = suppressAutoPush;
    suppressAutoPush = true;
    try {
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, id);
    } finally {
      suppressAutoPush = prev;
    }
    return id;
  } catch (_) {
    return `dev_fallback_${Date.now()}`;
  }
}

/**
 * @param {string} uid
 */
function readCloudBound() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CLOUD_BOUND);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} uid
 */
function isCloudBound(uid) {
  const bound = readCloudBound();
  return Boolean(bound && bound.uid === uid);
}

/**
 * @param {string} uid
 * @param {Date | string | null} [syncedAt]
 */
function markCloudBound(uid, syncedAt = null) {
  const prevSuppress = suppressAutoPush;
  suppressAutoPush = true;
  const when =
    syncedAt instanceof Date
      ? syncedAt.toISOString()
      : typeof syncedAt === 'string' && syncedAt
        ? syncedAt
        : new Date().toISOString();
  try {
    localStorage.setItem(
      STORAGE_KEY_CLOUD_BOUND,
      JSON.stringify({
        uid,
        lastSyncedAt: when
      })
    );
  } finally {
    suppressAutoPush = prevSuppress;
  }
  installAutoPush();
  startCloudPullListener(uid);
}

function clearCloudBound() {
  const prevSuppress = suppressAutoPush;
  suppressAutoPush = true;
  try {
    localStorage.removeItem(STORAGE_KEY_CLOUD_BOUND);
  } finally {
    suppressAutoPush = prevSuppress;
  }
  stopCloudPullListener();
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
      missing: true,
      error: 'Firebase 尚未就緒'
    };
  }

  try {
    const snap = await getDoc(doc(services.db, 'users', uid));
    if (!snap.exists()) {
      return {
        hasData: false,
        keyCount: 0,
        lastUpdated: null,
        missing: false,
        error: null
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
      missing: false,
      error: null
    };
  } catch (error) {
    console.error('[sync] 讀取雲端狀態失敗：', error);
    const tip = describeFirestoreError(error);
    return {
      hasData: false,
      keyCount: 0,
      lastUpdated: null,
      missing: false,
      error: tip.toast,
      errorDetail: tip.detail,
      errorCode: tip.code
    };
  }
}

/**
 * @param {string} uid
 */
async function compareLocalAndCloud(uid) {
  const local = getLocalSyncSummary();
  const cloud = await getCloudSyncSummary(uid);
  const bothHaveData = local.hasData && cloud.hasData && !cloud.error;
  const result = { local, cloud, bothHaveData };
  lastCompareResult = result;
  return result;
}

/**
 * @param {'first-seed' | 'choose' | 'manual'} mode
 * @param {{ local: object, cloud: object, bothHaveData: boolean } | null} result
 * @param {string} [errorMessage]
 */
function renderSyncComparison(mode, result, errorMessage) {
  syncModalMode = mode;

  const titleEl = document.getElementById('sync-modal-title');
  const descEl = document.getElementById('sync-modal-desc');
  const localEl = document.getElementById('sync-local-meta');
  const cloudEl = document.getElementById('sync-cloud-meta');
  const bannerEl = document.getElementById('sync-conflict-banner');
  const hintEl = document.getElementById('sync-hint');
  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');
  const clearBtn = document.getElementById('btn-sync-clear-cloud');
  const closeBtn = document.getElementById('btn-close-sync-modal');

  const localFallback =
    result && result.local ? result.local : getLocalSyncSummary();

  if (titleEl) {
    if (mode === 'first-seed') titleEl.textContent = '☁️ 建立雲端儲存庫';
    else if (mode === 'choose') titleEl.textContent = '☁️ 雲端已有資料';
    else titleEl.textContent = '☁️ 雲端儲存庫';
  }

  if (descEl) {
    if (mode === 'first-seed') {
      descEl.textContent =
        '雲端尚無學習資料。確定要以「此裝置」的本機資料建立雲端庫嗎？建立後，雲端將成為此帳號的資料基準。';
    } else if (mode === 'choose') {
      descEl.textContent =
        '此帳號的雲端已有資料。請選擇要以本機覆蓋雲端，或沿用雲端資料覆蓋本機。';
    } else {
      descEl.textContent =
        '此裝置已對齊雲端儲存庫。本機學習資料變更會自動上傳；也可手動重新載入或推送。';
    }
  }

  if (closeBtn) {
    closeBtn.textContent = mode === 'manual' ? '關閉' : '稍後再說';
  }

  const showClear =
    mode === 'manual' &&
    result &&
    result.cloud &&
    result.cloud.hasData &&
    !result.cloud.error;

  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !showClear);
    clearBtn.disabled = !showClear;
  }

  if (errorMessage) {
    if (localEl) {
      localEl.textContent = localFallback.hasData
        ? `${localFallback.keyCount} 筆學習資料`
        : '尚無學習資料';
    }
    if (cloudEl) cloudEl.textContent = errorMessage;
    if (bannerEl) bannerEl.classList.add('hidden');
    if (clearBtn) {
      clearBtn.classList.add('hidden');
      clearBtn.disabled = true;
    }
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.classList.remove('hidden');
      uploadBtn.textContent =
        mode === 'first-seed' ? '確定建立（上傳本機）' : '⬆️ 上傳覆蓋雲端';
    }
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.classList.toggle('hidden', mode === 'first-seed');
      downloadBtn.textContent = '⬇️ 沿用雲端資料';
    }
    if (hintEl) {
      hintEl.textContent =
        '雲端狀態讀取失敗。請確認已建立 Firestore 並設定規則後再試。';
    }
    return;
  }

  if (!result) {
    if (localEl) localEl.textContent = '檢查中…';
    if (cloudEl) cloudEl.textContent = '檢查中…';
    if (bannerEl) bannerEl.classList.add('hidden');
    if (uploadBtn) uploadBtn.disabled = true;
    if (downloadBtn) downloadBtn.disabled = true;
    if (clearBtn) {
      clearBtn.classList.add('hidden');
      clearBtn.disabled = true;
    }
    return;
  }

  const { local, cloud } = result;

  if (localEl) {
    localEl.textContent = local.hasData
      ? `${local.keyCount} 筆學習資料`
      : '尚無學習資料';
  }

  if (cloudEl) {
    if (cloud.error) cloudEl.textContent = cloud.error;
    else if (cloud.hasData) {
      cloudEl.textContent = `${cloud.keyCount} 筆（更新於 ${formatDateTime(
        cloud.lastUpdated
      )}）`;
    } else cloudEl.textContent = '尚無資料';
  }

  if (bannerEl) {
    if (mode === 'first-seed') {
      bannerEl.classList.remove('hidden');
      bannerEl.textContent =
        '首次建立後，其他裝置登入時會詢問要以哪一邊為準。';
    } else if (mode === 'choose') {
      bannerEl.classList.remove('hidden');
      bannerEl.textContent =
        '⚠️ 上傳會改寫雲端真相；沿用雲端會覆蓋此裝置本機學習資料。';
    } else {
      bannerEl.classList.add('hidden');
    }
  }

  if (hintEl) {
    if (cloud.error) {
      hintEl.textContent =
        '雲端讀取失敗：請確認 Firestore 已建立，且允許登入者讀寫 users/{uid}。';
    } else if (mode === 'first-seed') {
      hintEl.textContent = local.hasData
        ? '將上傳本機學習資料（不含 API Key／Firebase 設定）。'
        : '本機目前幾乎沒有學習資料，仍可建立空白雲端庫。';
    } else if (mode === 'choose') {
      hintEl.textContent =
        '選「沿用雲端」後會重新載入頁面；選「上傳覆蓋」會以本機改寫雲端。';
    } else {
      hintEl.textContent =
        '已對齊後：本機變更會自動上傳；其他裝置更新雲端時會自動同步並重新載入。也可手動推送／重新載入／清除雲端。';
    }
  }

  if (uploadBtn) {
    uploadBtn.classList.remove('hidden');
    uploadBtn.disabled = false;
    if (mode === 'first-seed') uploadBtn.textContent = '確定建立（上傳本機）';
    else if (mode === 'choose') uploadBtn.textContent = '⬆️ 上傳覆蓋雲端';
    else uploadBtn.textContent = '⬆️ 將本機推上雲端';
  }

  if (downloadBtn) {
    if (mode === 'first-seed') {
      downloadBtn.classList.add('hidden');
      downloadBtn.disabled = true;
    } else {
      downloadBtn.classList.remove('hidden');
      downloadBtn.disabled = !cloud.hasData || Boolean(cloud.error);
      downloadBtn.textContent =
        mode === 'choose' ? '⬇️ 沿用雲端資料' : '⬇️ 從雲端重新載入';
    }
  }
}

/**
 * @param {string} uid
 * @param {{ silent?: boolean }} [options]
 */
async function uploadToCloud(uid, options = {}) {
  if (!uid) throw new Error('缺少使用者 uid');
  const services = requireFirebaseServices();
  if (!services) throw new Error('Firebase 未連線');

  const payload = collectLocalStoragePayload();
  const keyCount = Object.keys(payload).length;
  const now = new Date();
  const deviceId = getDeviceId();

  await setDoc(
    doc(services.db, 'users', uid),
    {
      data: payload,
      lastUpdated: now,
      keyCount,
      updatedBy: deviceId
    },
    { merge: true }
  );

  markCloudBound(uid, now);
  if (!options.silent) {
    syncToast(`✅ 已上傳 ${keyCount} 筆資料至雲端`);
  }
}

/**
 * 將雲端 payload 寫入本機（不 reload）
 * @param {string} uid
 * @param {Record<string, unknown>} remote
 * @returns {number} 寫入鍵數量
 */
function applyRemotePayloadToLocal(uid, remote) {
  const data = remote.data;
  if (!data || typeof data !== 'object') {
    throw new Error('雲端資料格式異常');
  }

  const keys = Object.keys(data);
  suppressAutoPush = true;
  try {
    keys.forEach((key) => {
      if (!shouldSyncKey(key)) return;
      const value = data[key];
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, String(value));
    });
    const remoteUpdated = toDateOrNull(remote.lastUpdated) || new Date();
    markCloudBound(uid, remoteUpdated);
  } finally {
    suppressAutoPush = false;
  }
  return keys.length;
}

/**
 * @param {string} uid
 * @param {{ reload?: boolean, toast?: boolean }} [options]
 */
async function downloadFromCloud(uid, options = {}) {
  if (!uid) throw new Error('缺少使用者 uid');
  const services = requireFirebaseServices();
  if (!services) throw new Error('Firebase 未連線');

  const snap = await getDoc(doc(services.db, 'users', uid));
  if (!snap.exists()) {
    syncToast('☁️ 雲端尚無資料，請先從此裝置上傳');
    return;
  }

  const remote = snap.data() || {};
  const keyCount = applyRemotePayloadToLocal(uid, remote);

  if (keyCount === 0) {
    syncToast('☁️ 雲端資料為空');
    return;
  }

  if (options.toast !== false) {
    syncToast(
      options.reload === false
        ? `✅ 已從雲端同步 ${keyCount} 筆資料`
        : `✅ 已從雲端下載 ${keyCount} 筆資料，即將重新載入…`
    );
  }

  if (options.reload !== false) {
    setTimeout(() => {
      location.reload();
    }, 600);
  }
}

/**
 * 其他裝置更新雲端後，套用並重整
 * @param {string} uid
 * @param {Record<string, unknown>} remote
 */
function applyRemoteFromOtherDevice(uid, remote) {
  if (remoteApplyInFlight) return;
  remoteApplyInFlight = true;
  try {
    const keyCount = applyRemotePayloadToLocal(uid, remote);
    syncToast(`☁️ 偵測到其他裝置更新，已同步 ${keyCount} 筆，即將重新載入…`);
    setTimeout(() => {
      location.reload();
    }, 700);
  } catch (error) {
    remoteApplyInFlight = false;
    console.error('[sync] 套用遠端更新失敗：', error);
    syncToast('❌ 同步其他裝置資料失敗');
  }
}

function stopCloudPullListener() {
  if (cloudPullUnsubscribe) {
    try {
      cloudPullUnsubscribe();
    } catch (_) {
      // ignore
    }
  }
  cloudPullUnsubscribe = null;
  cloudPullUid = null;
}

/**
 * 監聽雲端文件；其他裝置寫入時自動拉取
 * @param {string} uid
 */
function startCloudPullListener(uid) {
  if (!uid) return;
  if (cloudPullUid === uid && cloudPullUnsubscribe) return;

  const services = requireFirebaseServices();
  if (!services) return;

  stopCloudPullListener();
  cloudPullUid = uid;
  let isFirstEvent = true;
  const deviceId = getDeviceId();

  cloudPullUnsubscribe = onSnapshot(
    doc(services.db, 'users', uid),
    (snap) => {
      if (!isCloudBound(uid)) return;
      if (!snap.exists()) return;

      const remote = snap.data() || {};
      const remoteUpdated = toDateOrNull(remote.lastUpdated);
      const updatedBy = remote.updatedBy ? String(remote.updatedBy) : '';

      // 自己上傳的變更：只更新對齊時間，不重整
      if (updatedBy && updatedBy === deviceId) {
        if (remoteUpdated) markCloudBound(uid, remoteUpdated);
        isFirstEvent = false;
        return;
      }

      const bound = readCloudBound();
      const localSynced = bound && bound.lastSyncedAt
        ? new Date(bound.lastSyncedAt)
        : null;

      const cloudIsNewer =
        remoteUpdated &&
        (!localSynced ||
          remoteUpdated.getTime() > localSynced.getTime() + 800);

      if (isFirstEvent) {
        isFirstEvent = false;
        // 訂閱當下若雲端明顯較新（例如他機先改完），立刻同步
        if (cloudIsNewer) {
          applyRemoteFromOtherDevice(uid, remote);
        }
        return;
      }

      if (cloudIsNewer) {
        applyRemoteFromOtherDevice(uid, remote);
      }
    },
    (error) => {
      console.error('[sync] 雲端監聽失敗：', error);
    }
  );
}

/**
 * 分頁重新顯示時檢查雲端是否有較新資料
 */
async function pullIfCloudNewerOnFocus() {
  const uid = requireUidQuiet();
  if (!uid || !isCloudBound(uid) || remoteApplyInFlight) return;

  try {
    const services = requireFirebaseServices();
    if (!services) return;
    const snap = await getDoc(doc(services.db, 'users', uid));
    if (!snap.exists()) return;
    const remote = snap.data() || {};
    const updatedBy = remote.updatedBy ? String(remote.updatedBy) : '';
    if (updatedBy && updatedBy === getDeviceId()) return;

    const remoteUpdated = toDateOrNull(remote.lastUpdated);
    const bound = readCloudBound();
    const localSynced = bound && bound.lastSyncedAt
      ? new Date(bound.lastSyncedAt)
      : null;
    if (
      remoteUpdated &&
      (!localSynced || remoteUpdated.getTime() > localSynced.getTime() + 800)
    ) {
      applyRemoteFromOtherDevice(uid, remote);
    }
  } catch (error) {
    console.error('[sync] 前景檢查雲端失敗：', error);
  }
}

function bindVisibilityPull() {
  if (visibilityPullBound) return;
  visibilityPullBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pullIfCloudNewerOnFocus();
    }
  });
  window.addEventListener('focus', () => {
    pullIfCloudNewerOnFocus();
  });
}

/**
 * 清除 Firestore 上此帳號的學習資料（不動本機）
 * @param {string} uid
 */
async function clearCloudData(uid) {
  if (!uid) throw new Error('缺少使用者 uid');
  const services = requireFirebaseServices();
  if (!services) throw new Error('Firebase 未連線');

  await deleteDoc(doc(services.db, 'users', uid));
  clearCloudBound();
  uninstallAutoPush();
  syncToast('✅ 已清除雲端學習資料（本機資料未更動）');
}

/**
 * 雙重防呆後清除雲端
 */
async function runClearCloudWithGuards() {
  const uid = requireUid();
  if (!uid) return;

  const compare = await compareLocalAndCloud(uid);
  if (compare.cloud.error) {
    syncToast(compare.cloud.error);
    return;
  }
  if (!compare.cloud.hasData) {
    syncToast('☁️ 雲端目前沒有可清除的資料');
    return;
  }

  const firstOk = window.confirm(
    [
      '即將永久刪除此帳號在 Firestore 的學習資料。',
      '',
      `雲端目前約 ${compare.cloud.keyCount} 筆（更新於 ${formatDateTime(
        compare.cloud.lastUpdated
      )}）`,
      '',
      '注意：',
      '· 只清除雲端，不會刪除本機資料',
      '· 清除後其他裝置無法再下載這份雲端庫',
      '· 此裝置會解除「已對齊」狀態，需重新建立雲端庫',
      '',
      '確定要繼續嗎？'
    ].join('\n')
  );
  if (!firstOk) {
    syncToast('已取消清除');
    return;
  }

  const CONFIRM_TEXT = '清除雲端';
  const typed = window.prompt(
    `防呆確認：請輸入「${CONFIRM_TEXT}」四個字（必須完全相同）才會執行清除。`,
    ''
  );
  if (typed === null) {
    syncToast('已取消清除');
    return;
  }
  if (String(typed).trim() !== CONFIRM_TEXT) {
    syncToast('輸入不符，未清除雲端資料');
    return;
  }

  const clearBtn = document.getElementById('btn-sync-clear-cloud');
  if (clearBtn) clearBtn.disabled = true;

  try {
    await clearCloudData(uid);
    const refreshed = await compareLocalAndCloud(uid);
    renderSyncComparison('manual', refreshed);
  } catch (error) {
    console.error('[sync] 清除雲端失敗：', error);
    const tip = describeFirestoreError(error);
    syncToast(tip.toast || '❌ 清除雲端失敗');
    window.alert(['清除雲端失敗', '', tip.detail || String(error)].join('\n'));
  } finally {
    if (clearBtn) clearBtn.disabled = false;
  }
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

function closeSyncModal() {
  const modal = document.getElementById('sync-modal');
  if (modal) modal.classList.add('hidden');
  syncModalMode = null;
}

/**
 * @param {'first-seed' | 'choose' | 'manual'} mode
 */
async function openSyncModal(mode = 'manual') {
  const modal = document.getElementById('sync-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  renderSyncComparison(mode, null);

  const uid = requireUid();
  if (!uid) {
    closeSyncModal();
    return;
  }

  try {
    const result = await compareLocalAndCloud(uid);
    renderSyncComparison(mode, result);

    if (result.cloud && result.cloud.errorDetail) {
      syncToast(result.cloud.error || '讀取雲端狀態失敗');
      window.alert(
        [
          '無法讀取雲端狀態',
          '',
          result.cloud.errorDetail,
          result.cloud.errorCode ? `\n錯誤代碼：${result.cloud.errorCode}` : ''
        ].join('\n')
      );
    }
  } catch (error) {
    console.error('[sync] 比對失敗：', error);
    const tip = describeFirestoreError(error);
    const local = getLocalSyncSummary();
    renderSyncComparison(
      mode,
      {
        local,
        cloud: {
          hasData: false,
          keyCount: 0,
          lastUpdated: null,
          error: tip.toast
        },
        bothHaveData: false
      },
      tip.toast
    );
    syncToast(tip.toast);
    window.alert(['無法讀取雲端狀態', '', tip.detail].join('\n'));
  }
}

/**
 * @param {'upload' | 'download'} action
 */
async function runSyncAction(action) {
  const uid = requireUid();
  if (!uid) return;

  const mode = syncModalMode || 'manual';
  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');
  const buttons = [uploadBtn, downloadBtn].filter(Boolean);

  buttons.forEach((btn) => {
    btn.disabled = true;
  });

  try {
    const compare = await compareLocalAndCloud(uid);
    renderSyncComparison(mode, compare);

    if (action === 'upload') {
      if (mode === 'choose' || mode === 'manual') {
        if (compare.cloud.hasData) {
          const ok = window.confirm(
            [
              '即將以「本機資料」覆蓋「雲端資料」。',
              '',
              `本機：${compare.local.keyCount} 筆`,
              `雲端：${compare.cloud.keyCount} 筆（更新於 ${formatDateTime(
                compare.cloud.lastUpdated
              )}）`,
              '',
              '確定上傳嗎？'
            ].join('\n')
          );
          if (!ok) {
            syncToast('已取消');
            return;
          }
        } else if (!compare.local.hasData && mode === 'manual') {
          const ok = window.confirm(
            '本機幾乎沒有學習資料，仍要推上雲端嗎？'
          );
          if (!ok) {
            syncToast('已取消');
            return;
          }
        }
      }

      await uploadToCloud(uid);
      closeSyncModal();
      if (mode === 'first-seed') {
        syncToast('✅ 已建立雲端儲存庫，之後本機變更會自動上傳');
      }
      return;
    }

    // download
    if (!compare.cloud.hasData) {
      syncToast('☁️ 雲端尚無資料可下載');
      return;
    }

    if (compare.local.hasData) {
      const ok = window.confirm(
        [
          '即將以「雲端資料」覆蓋「本機資料」，並重新載入頁面。',
          '',
          `本機：${compare.local.keyCount} 筆`,
          `雲端：${compare.cloud.keyCount} 筆（更新於 ${formatDateTime(
            compare.cloud.lastUpdated
          )}）`,
          '',
          '確定沿用雲端嗎？'
        ].join('\n')
      );
      if (!ok) {
        syncToast('已取消');
        return;
      }
    }

    await downloadFromCloud(uid);
  } catch (error) {
    console.error('[sync] 同步失敗：', error);
    const tip = describeFirestoreError(error);
    syncToast(tip.toast || '❌ 同步失敗，請稍後再試');
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function scheduleAutoPush() {
  if (suppressAutoPush || autoPushInFlight) return;
  const uid = requireUidQuiet();
  if (!uid || !isCloudBound(uid)) return;

  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    autoPushTimer = null;
    const currentUid = requireUidQuiet();
    if (!currentUid || !isCloudBound(currentUid) || suppressAutoPush) return;

    autoPushInFlight = true;
    try {
      await uploadToCloud(currentUid, { silent: true });
      console.log('[sync] 已自動上傳至雲端');
    } catch (error) {
      console.error('[sync] 自動上傳失敗：', error);
    } finally {
      autoPushInFlight = false;
    }
  }, AUTO_PUSH_DEBOUNCE_MS);
}

/**
 * @returns {string | null}
 */
function requireUidQuiet() {
  try {
    if (!isFirebaseReady() && !(window.firebaseAuth && window.firebaseDb)) {
      return null;
    }
  } catch (_) {
    return null;
  }
  const auth =
    (typeof getFirebaseAuth === 'function' && getFirebaseAuth()) ||
    window.firebaseAuth;
  const user = (auth && auth.currentUser) || window.firebaseCurrentUser;
  return user && user.uid ? user.uid : null;
}

function installAutoPush() {
  if (!autoPushInstalled) {
    originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function patchedSetItem(key, value) {
      originalSetItem(key, value);
      if (!suppressAutoPush && shouldSyncKey(String(key))) {
        scheduleAutoPush();
      }
    };
    autoPushInstalled = true;
  }
  const uid = requireUidQuiet();
  if (uid && isCloudBound(uid)) {
    startCloudPullListener(uid);
  }
}

function uninstallAutoPush() {
  if (autoPushInstalled && originalSetItem) {
    localStorage.setItem = originalSetItem;
    originalSetItem = null;
    autoPushInstalled = false;
  }
  if (autoPushTimer) {
    clearTimeout(autoPushTimer);
    autoPushTimer = null;
  }
  stopCloudPullListener();
}

/**
 * 登入後決策：首次建庫／換裝置二選一／已對齊則啟用自動上傳
 * @param {{ uid?: string } | null} user
 * @param {{ forceDecision?: boolean }} [options]
 */
async function handleAuthCloudDecision(user, options = {}) {
  const uid = user && user.uid ? user.uid : null;
  const forceDecision = Boolean(options.forceDecision);

  if (!uid) {
    previousAuthUid = null;
    uninstallAutoPush();
    stopCloudPullListener();
    return;
  }

  const firstAuthEvent = previousAuthUid === undefined;
  const justLoggedIn = !firstAuthEvent && previousAuthUid !== uid;
  previousAuthUid = uid;

  const bound = readCloudBound();
  if (bound && bound.uid && bound.uid !== uid) {
    clearCloudBound();
  }

  if (isCloudBound(uid) && !forceDecision) {
    installAutoPush();
    return;
  }

  const shouldDecide =
    forceDecision || justLoggedIn || (firstAuthEvent && !isCloudBound(uid));
  if (!shouldDecide) return;

  try {
    const result = await compareLocalAndCloud(uid);
    if (result.cloud && result.cloud.error) {
      syncToast(result.cloud.error);
      if (result.cloud.errorDetail) {
        window.alert(
          ['無法讀取雲端狀態', '', result.cloud.errorDetail].join('\n')
        );
      }
      return;
    }

    if (!result.cloud.hasData) {
      syncToast('雲端尚無資料，請確認是否以此裝置建立雲端庫');
      await openSyncModal('first-seed');
      return;
    }

    syncToast('雲端已有資料，請選擇上傳覆蓋或沿用雲端');
    await openSyncModal('choose');
  } catch (error) {
    console.error('[sync] 登入後雲端決策失敗：', error);
  }
}

function bindSyncUI() {
  const syncBtn = document.getElementById('btn-sync');
  const closeBtn = document.getElementById('btn-close-sync-modal');
  const uploadBtn = document.getElementById('btn-sync-upload');
  const downloadBtn = document.getElementById('btn-sync-download');
  const clearBtn = document.getElementById('btn-sync-clear-cloud');
  const modal = document.getElementById('sync-modal');

  bindVisibilityPull();

  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      const uid = requireUid();
      if (!uid) return;
      if (isCloudBound(uid)) {
        openSyncModal('manual');
      } else {
        // 尚未對齊：重新走決策
        handleAuthCloudDecision(
          { uid },
          { forceDecision: true }
        );
      }
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
      runSyncAction('upload');
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      runSyncAction('download');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      runClearCloudWithGuards();
    });
  }

  window.addEventListener('sw-firebase-auth', (event) => {
    const detail = /** @type {CustomEvent} */ (event).detail || {};
    handleAuthCloudDecision(detail.user || null);
  });

  // 若 auth 事件早於 listener，補跑一次目前登入狀態
  const auth =
    (typeof getFirebaseAuth === 'function' && getFirebaseAuth()) ||
    window.firebaseAuth;
  const currentUser =
    (auth && auth.currentUser) || window.firebaseCurrentUser || null;
  if (currentUser) {
    handleAuthCloudDecision(currentUser);
  } else {
    const existingUid = requireUidQuiet();
    if (existingUid && isCloudBound(existingUid)) {
      installAutoPush();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSyncUI);
} else {
  bindSyncUI();
}

window.uploadToCloud = uploadToCloud;
window.downloadFromCloud = downloadFromCloud;
window.clearCloudData = clearCloudData;
window.openSyncModal = openSyncModal;
window.STORAGE_KEY_CLOUD_BOUND = STORAGE_KEY_CLOUD_BOUND;

export {
  uploadToCloud,
  downloadFromCloud,
  clearCloudData,
  collectLocalStoragePayload,
  compareLocalAndCloud,
  openSyncModal,
  STORAGE_KEY_CLOUD_BOUND
};
