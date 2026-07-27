/**
 * Phase 13.7：Web-Pet 學習小夥伴控制器
 * - web-pet 取代 Lottie 成為主視覺（常駐顯示）
 * - 閒置時全螢幕漫遊；操作時停靠右下角
 * - 電子書模式銷毀／隱藏
 * - 氣泡與提示由 MascotApp 驅動，座標跟隨 web-pet
 */
(function () {
  'use strict';

  const IDLE_EVENTS = [
    'mousemove',
    'mousedown',
    'keydown',
    'keypress',
    'scroll',
    'touchstart',
    'wheel',
    'pointerdown'
  ];

  const SPRITE = {
    default: 'assets/web-pet/default.png',
    hover: 'assets/web-pet/move.png',
    move: 'assets/web-pet/default.png'
  };

  const MOOD_STATUS = {
    idle: 'default',
    thinking: 'hover',
    success: 'default',
    error: 'hover'
  };

  /** @type {number|null} */
  let tickTimer = null;
  /** @type {number|null} */
  let followRaf = null;
  /** @type {number|null} */
  let roamTimer = null;

  function isEbookMode() {
    const body = document.body;
    if (!body) return false;
    if (
      body.classList.contains('ebook-active') ||
      body.classList.contains('ebook-reader-open')
    ) {
      return true;
    }
    const overlay = document.getElementById('ebook-reader-overlay');
    return Boolean(overlay && !overlay.classList.contains('ebook-hidden'));
  }

  function getWebPetCtor() {
    return typeof window.WebPet === 'function' ? window.WebPet : null;
  }

  function getIsolatedJQuery() {
    const jq = window.SW_JQUERY || window.jQuery;
    return jq && jq.fn ? jq : null;
  }

  /**
   * @template T
   * @param {(jq: *) => T} fn
   * @returns {T|null}
   */
  function withJQuery(fn) {
    const jq = getIsolatedJQuery();
    if (!jq) {
      console.warn('[pet-controller] 找不到 SW_JQUERY，無法操作 web-pet');
      return null;
    }
    const previousDollar = window.$;
    const previousJQuery = window.jQuery;
    window.$ = jq;
    window.jQuery = jq;
    try {
      return fn(jq);
    } finally {
      window.$ = previousDollar;
      window.jQuery = previousJQuery;
    }
  }

  function queryPetEl() {
    return document.querySelector('div.web-pet');
  }

  function stopFollowLoop() {
    if (followRaf != null) {
      cancelAnimationFrame(followRaf);
      followRaf = null;
    }
  }

  function stopRoamLoop() {
    if (roamTimer) {
      clearInterval(roamTimer);
      roamTimer = null;
    }
  }

  function positionBubbleAbovePet() {
    const pet = queryPetEl();
    const root = window.MascotApp && window.MascotApp.root;
    const bubble = window.MascotApp && window.MascotApp.bubble;
    if (!pet || !root || !bubble) return false;

    const rect = pet.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;

    root.classList.add('mascot-positioned', 'mascot-follow-pet');

    const rootW = root.offsetWidth || 160;
    const gap = 8;
    const left = rect.left + rect.width / 2 - rootW / 2;
    const top = rect.top - (bubble.offsetHeight || 56) - gap;

    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(Math.max(4, top))}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    return true;
  }

  function startFollowLoop() {
    stopFollowLoop();
    const tick = () => {
      if (!PetController.isActive) {
        followRaf = null;
        return;
      }
      positionBubbleAbovePet();
      followRaf = requestAnimationFrame(tick);
    };
    followRaf = requestAnimationFrame(tick);
  }

  function callPetMethod(name, arg) {
    const pet = PetController.petInstance;
    if (!pet || typeof pet[name] !== 'function') return false;
    try {
      const result = withJQuery(() => {
        pet[name](arg);
        return true;
      });
      return Boolean(result);
    } catch (_) {
      return false;
    }
  }

  function removePetDom() {
    document.querySelectorAll('div.web-pet, .pet-paw-warp').forEach((el) => {
      try {
        el.remove();
      } catch (_) {
        // ignore
      }
    });
  }

  function dockToCorner() {
    const el = queryPetEl();
    if (!el) return;
    callPetMethod('stopMove');
    const w = document.documentElement.clientWidth || window.innerWidth || 0;
    const h = document.documentElement.clientHeight || window.innerHeight || 0;
    el.style.left = `${Math.max(0, w - 150)}px`;
    el.style.top = `${Math.max(0, h - 150)}px`;
  }

  function bindPetClickOnce() {
    const el = queryPetEl();
    if (!el || el.dataset.swTipBound === '1') return;
    el.dataset.swTipBound = '1';
    el.addEventListener('click', () => {
      const app = window.MascotApp;
      if (!app || typeof app.say !== 'function') return;
      // 略過剛拖曳後的誤觸：web-pet 內部已處理；這裡給鼓勵台詞
      app.say();
    });
  }

  const PetController = {
    idleTime: 0,
    idleThreshold: 20,
    /** @type {object|null} */
    petInstance: null,
    /** 寵物是否在畫面上（電子書除外應為 true） */
    isActive: false,
    /** 是否處於閒置漫遊 */
    isRoaming: false,
    _creating: false,
    _mounted: false,

    init() {
      document.body.classList.add('web-pet-companion');

      const onUserActivity = () => {
        this.idleTime = 0;
        if (isEbookMode()) return;
        if (this.isRoaming) {
          this.stopRoaming({ dock: true });
        }
      };

      IDLE_EVENTS.forEach((type) => {
        document.addEventListener(type, onUserActivity, { passive: true });
      });

      const observer = new MutationObserver(() => {
        if (isEbookMode()) {
          this.hidePet({ destroy: true });
        } else if (!this.isActive) {
          this.showPet();
        }
      });
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['class']
        });
      }

      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => this.checkIdleStatus(), 1000);

      setTimeout(() => {
        this.showPet().then(() => {
          console.info(
            '[pet-controller] web-pet 常駐就緒（閒置',
            this.idleThreshold,
            '秒後漫遊）'
          );
        });
      }, 0);
    },

    checkIdleStatus() {
      if (isEbookMode()) {
        if (this.isActive || this.petInstance) {
          this.hidePet({ destroy: true });
        }
        this.idleTime = 0;
        this.isRoaming = false;
        return;
      }

      // 非電子書時確保常駐顯示
      if (!this.isActive) {
        this.showPet();
      }

      this.idleTime += 1;

      if (this.idleTime >= this.idleThreshold && !this.isRoaming) {
        this.startRoaming();
      }
    },

    /**
     * @returns {Promise<object|null>}
     */
    ensurePet() {
      if (this.petInstance && this._mounted && queryPetEl()) {
        return Promise.resolve(this.petInstance);
      }
      if (this._creating) {
        return new Promise((resolve) => {
          const wait = () => {
            if (this._mounted || !this._creating) {
              resolve(this.petInstance);
              return;
            }
            setTimeout(wait, 50);
          };
          wait();
        });
      }

      const Ctor = getWebPetCtor();
      if (!Ctor) {
        console.warn('[pet-controller] WebPet 尚未載入');
        return Promise.resolve(null);
      }
      if (!getIsolatedJQuery()) {
        console.warn('[pet-controller] SW_JQUERY 未就緒，略過 web-pet');
        return Promise.resolve(null);
      }

      this._creating = true;

      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this._creating = false;
          this._mounted = true;
          bindPetClickOnce();
          resolve(this.petInstance);
        };

        try {
          withJQuery(() => {
            this.petInstance = new Ctor({
              name: '學習小夥伴',
              footPrint: true,
              isShow: true,
              firstPosition: 'rightLower',
              operate: {},
              action: {
                firstGreet: false,
                // 漫遊改由 PetController 控制，避免與操作互斥衝突
                randomMove: false,
                randomSay: false,
                interval: {
                  randomMove: 14000,
                  randomSay: 60000
                }
              },
              statusImg: {
                default: SPRITE.default,
                hover: SPRITE.hover,
                move: SPRITE.move
              },
              server: {
                answer: { url: '' },
                learn: { url: '' },
                report: {
                  url: '',
                  headers: { type: 'application/x-www-form-urlencoded' }
                }
              },
              on: {
                created() {},
                mounted: finish
              }
            });
          });
        } catch (err) {
          console.warn('[pet-controller] 建立 WebPet 失敗', err);
          this._creating = false;
          this.petInstance = null;
          resolve(null);
          return;
        }

        if (!settled && queryPetEl()) {
          finish();
        } else if (!settled) {
          setTimeout(() => {
            if (!settled) {
              this._creating = false;
              if (queryPetEl()) finish();
              else {
                this.petInstance = null;
                resolve(null);
              }
            }
          }, 800);
        }
      });
    },

    /**
     * 常駐顯示（電子書除外）
     * @returns {Promise<void>}
     */
    async showPet() {
      if (isEbookMode()) {
        this.hidePet({ destroy: true });
        return;
      }

      const pet = await this.ensurePet();
      if (!pet) return;

      const el = queryPetEl();
      if (el) {
        el.style.display = '';
        el.style.visibility = 'visible';
      }

      // 若先前 hide 過，呼叫 show；否則確保可見
      const status = pet.$status;
      if (status === 'hide') {
        callPetMethod('show');
      }

      this.isActive = true;
      document.body.classList.add('web-pet-companion');
      bindPetClickOnce();
      positionBubbleAbovePet();
      startFollowLoop();
    },

    /**
     * @param {{destroy?: boolean}} [opts]
     */
    hidePet(opts) {
      const destroy = Boolean(opts && opts.destroy);
      this.stopRoaming({ dock: false });
      this.isActive = false;
      stopFollowLoop();

      if (destroy) {
        callPetMethod('hide', true);
        removePetDom();
        this.petInstance = null;
        this._mounted = false;
        this._creating = false;
        return;
      }

      if (!callPetMethod('hide', true)) {
        const el = queryPetEl();
        if (el) el.style.display = 'none';
      }
      document.querySelectorAll('.pet-paw-warp').forEach((node) => node.remove());
    },

    startRoaming() {
      if (isEbookMode() || !this.isActive) return;
      this.isRoaming = true;
      document.body.classList.add('web-pet-roaming');
      callPetMethod('randomMove');
      stopRoamLoop();
      roamTimer = setInterval(() => {
        if (!this.isRoaming || isEbookMode()) return;
        callPetMethod('randomMove');
      }, 14000);
    },

    /**
     * @param {{dock?: boolean}} [opts]
     */
    stopRoaming(opts) {
      const dock = !opts || opts.dock !== false;
      this.isRoaming = false;
      stopRoamLoop();
      document.body.classList.remove('web-pet-roaming');
      callPetMethod('stopMove');
      document.querySelectorAll('.pet-paw-warp').forEach((node) => node.remove());
      if (dock && this.isActive && !isEbookMode()) {
        dockToCorner();
      }
    },

    /**
     * 對應舊 Mascot 情緒狀態 → web-pet 精靈圖
     * @param {'idle'|'thinking'|'success'|'error'|string} state
     */
    setMood(state) {
      const status = MOOD_STATUS[state] || 'default';
      if (!this.isActive) {
        this.showPet().then(() => callPetMethod('changeStatus', status));
        return;
      }
      callPetMethod('changeStatus', status);
    },

    /**
     * 學習提示：確保寵物可見並短暫保持（不因操作立刻停靠）
     * @param {number} [holdMs=6000]
     * @returns {Promise<void>}
     */
    async forceAppear(holdMs) {
      if (isEbookMode()) return;
      const ms = holdMs == null ? 6000 : Number(holdMs);
      this.idleTime = 0;
      await this.showPet();
      // 提示期間停靠，方便閱讀氣泡
      this.stopRoaming({ dock: true });
      this.setMood('thinking');
      // holdMs 僅用於外部 Promise 時序；常駐模式不再自動隱藏
      await new Promise((r) => setTimeout(r, Math.min(300, Math.max(0, ms))));
    },

    getPetRect() {
      const el = queryPetEl();
      return el ? el.getBoundingClientRect() : null;
    },

    getPetElement() {
      return queryPetEl();
    },

    syncBubbleToPet() {
      if (!this.isActive && !isEbookMode()) {
        // 氣泡出現時順便確保寵物在場
        this.showPet();
      }
      if (!queryPetEl()) return false;
      const ok = positionBubbleAbovePet();
      if (ok) startFollowLoop();
      return ok;
    }
  };

  window.PetController = PetController;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PetController.init());
  } else {
    PetController.init();
  }
})();
