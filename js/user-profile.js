/**
 * user-profile.js — Phase 13.2：每日連勝與導覽列狀態
 *
 * 職責：
 * 1. localStorage `userStats`：streakDays／lastPlayDate
 * 2. 通關時 updateStreak()，並更新頂部 🔥 計數器
 * 3. 連勝增加時觸發火焰脈衝動畫
 */

/* ============================================================
   常數
   ============================================================ */

/** localStorage：使用者遊戲化統計 */
const STORAGE_KEY_USER_STATS = 'userStats';

/* ============================================================
   日期工具
   ============================================================ */

/**
 * @param {Date} [date]
 * @returns {string} YYYY-MM-DD（本地時區）
 */
function toLocalDateString(date) {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @returns {string} 昨天 YYYY-MM-DD
 */
function getYesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalDateString(d);
}

/* ============================================================
   localStorage 讀寫
   ============================================================ */

/**
 * @returns {{streakDays: number, lastPlayDate: string}}
 */
function defaultUserStats() {
  return { streakDays: 0, lastPlayDate: '' };
}

/**
 * @returns {{streakDays: number, lastPlayDate: string}}
 */
function loadUserStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USER_STATS);
    if (!raw) return defaultUserStats();
    const parsed = JSON.parse(raw);
    const streakDays = Math.max(0, Number(parsed?.streakDays) || 0);
    const lastPlayDate =
      typeof parsed?.lastPlayDate === 'string' ? parsed.lastPlayDate : '';
    return { streakDays, lastPlayDate };
  } catch (_) {
    return defaultUserStats();
  }
}

/**
 * @param {{streakDays: number, lastPlayDate: string}} stats
 */
function saveUserStats(stats) {
  try {
    localStorage.setItem(
      STORAGE_KEY_USER_STATS,
      JSON.stringify({
        streakDays: Math.max(0, Number(stats.streakDays) || 0),
        lastPlayDate: String(stats.lastPlayDate || '')
      })
    );
  } catch (_) {
    // ignore quota / private mode
  }
}

/* ============================================================
   連勝邏輯與 UI
   ============================================================ */

/**
 * 更新導覽列連勝計數；可選觸發脈衝
 * @param {number} streakDays
 * @param {boolean} [pulse=false]
 */
function renderNavStreak(streakDays, pulse) {
  const el = document.getElementById('nav-streak-counter');
  if (!el) return;

  const days = Math.max(0, Number(streakDays) || 0);
  el.textContent = `🔥 ${days}`;
  el.setAttribute('aria-label', `每日連勝 ${days} 天`);

  if (!pulse) return;

  el.classList.remove('streak-fire--pulse');
  // 強制重播動畫
  void el.offsetWidth;
  el.classList.add('streak-fire--pulse');
  const onEnd = () => {
    el.classList.remove('streak-fire--pulse');
    el.removeEventListener('animationend', onEnd);
  };
  el.addEventListener('animationend', onEnd);
}

/**
 * 每次成功通關時呼叫：依 lastPlayDate 更新連續天數
 * @returns {{streakDays: number, lastPlayDate: string, increased: boolean}}
 */
function updateStreak() {
  const stats = loadUserStats();
  const today = toLocalDateString();
  const yesterday = getYesterdayDateString();
  const prevDays = stats.streakDays;

  if (stats.lastPlayDate === today) {
    renderNavStreak(stats.streakDays, false);
    return { ...stats, increased: false };
  }

  if (stats.lastPlayDate === yesterday) {
    stats.streakDays = prevDays + 1;
  } else {
    // 首次遊玩，或中斷一天以上 → 歸零後從 1 開始
    stats.streakDays = 1;
  }

  stats.lastPlayDate = today;
  saveUserStats(stats);

  const increased = stats.streakDays > prevDays;
  renderNavStreak(stats.streakDays, increased);
  return { ...stats, increased };
}

/**
 * 初始化：從 storage 還原連勝顯示
 */
function initUserProfileModule() {
  const stats = loadUserStats();
  renderNavStreak(stats.streakDays, false);
}

window.STORAGE_KEY_USER_STATS = STORAGE_KEY_USER_STATS;
window.loadUserStats = loadUserStats;
window.saveUserStats = saveUserStats;
window.updateStreak = updateStreak;
window.renderNavStreak = renderNavStreak;
window.initUserProfileModule = initUserProfileModule;
