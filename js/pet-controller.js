/**
 * Phase 13.7：Web-Pet 閒置桌寵控制器
 * - 閒置達門檻後召喚 web-pet 全螢幕漫遊
 * - 使用者恢復操作或進入電子書模式時隱藏／銷毀
 * - 提供座標給 MascotApp speech-bubble 跟隨定位
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

  /** @type {number|null} */
  let tickTimer = null;
  /** @type {number|null} */
  let followRaf = null;
  /** @type {number|null} */
  let forceHideTimer = null;

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
    if (typeof window.WebPet === 'function') return window.WebPet;
    if (typeof window.default === 'function') return window.default;
    return null;
  }

  function queryPetEl() {
    return document.querySelector('div.web-pet');
  }

  function clearForceHideTimer() {
    if (forceHideTimer) {
      clearTimeout(forceHideTimer);
      forceHideTimer = null;
    }
  }

  function stopFollowLoop() {
    if (followRaf != null) {
      cancelAnimationFrame(followRaf);
      followRaf = null;
    }
  }

  /**
   * 將 mascot 容器（氣泡）對齊到 web-pet 正上方
   */
  function positionBubbleAbovePet() {
    const pet = queryPetEl();
    const root = window.MascotApp && window.MascotApp.root;
    const bubble = window.MascotApp && window.MascotApp.bubble;
    if (!pet || !root || !bubble) return false;

    const rect = pet.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;

    root.classList.add('mascot-positioned', 'mascot-follow-pet');
    document.body.classList.add('web-pet-roaming');

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

  function restoreMascotDock() {
    stopFollowLoop();
    const root = window.MascotApp && window.MascotApp.root;
    document.body.classList.remove('web-pet-roaming');
    if (!root) return;
    root.classList.remove('mascot-follow-pet');
    // 還原使用者拖拉位置；若無則回到預設右下角
    try {
      const raw = localStorage.getItem('sw_mascot_pos');
      if (raw) {
        const parsed = JSON.parse(raw);
        const left = Number(parsed?.left);
        const top = Number(parsed?.top);
        if (Number.isFinite(left) && Number.isFinite(top)) {
          root.classList.add('mascot-positioned');
          root.style.left = `${Math.round(left)}px`;
          root.style.top = `${Math.round(top)}px`;
          root.style.right = 'auto';
          root.style.bottom = 'auto';
          return;
        }
      }
    } catch (_) {
      // ignore
    }
    root.classList.remove('mascot-positioned');
    root.style.left = '';
    root.style.top = '';
    root.style.right = '';
    root.style.bottom = '';
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
      pet[name](arg);
      return true;
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

  const PetController = {
    idleTime: 0,
    idleThreshold: 30,
    /** @type {object|null} */
    petInstance: null,
    isActive: false,
    /** 強制顯示期間不因使用者操作立刻隱藏 */
    forceHold: false,
    _creating: false,
    _mounted: false,

    init() {
      const resetTimer = () => {
        // 強制陪伴期間略過重置，避免氣泡一出就立刻收回
        if (this.forceHold) return;
        this.idleTime = 0;
        if (this.isActive && !isEbookMode()) {
          this.hidePet();
        }
      };

      IDLE_EVENTS.forEach((type) => {
        document.addEventListener(type, resetTimer, { passive: true });
      });
      window.addEventListener('load', resetTimer);

      // 觀察電子書 class 變化
      const observer = new MutationObserver(() => {
        if (isEbookMode()) this.hidePet({ destroy: true });
      });
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['class']
        });
      }

      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => this.checkIdleStatus(), 1000);

      // 預先建立實例（隱藏），減少首次閒置延遲
      this.ensurePet();
    },

    checkIdleStatus() {
      if (isEbookMode()) {
        if (this.isActive || this.petInstance) {
          this.hidePet({ destroy: true });
        }
        this.idleTime = 0;
        return;
      }

      this.idleTime += 1;

      if (this.idleTime >= this.idleThreshold && !this.isActive) {
        this.showPet();
      } else if (this.idleTime < this.idleThreshold && this.isActive && !this.forceHold) {
        this.hidePet();
      }
    },

    /**
     * 確保 WebPet 實例存在（預設隱藏）
     * @returns {Promise<object|null>}
     */
    ensurePet() {
      if (this.petInstance && this._mounted) {
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

      this._creating = true;

      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this._creating = false;
          this._mounted = true;
          resolve(this.petInstance);
        };

        try {
          this.petInstance = new Ctor({
            name: '學習小夥伴',
            footPrint: true,
            isShow: false,
            firstPosition: 'rightLower',
            operate: {},
            action: {
              firstGreet: false,
              randomMove: true,
              randomSay: false,
              interval: {
                randomMove: 12000,
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
              report: { url: '', headers: { type: 'application/x-www-form-urlencoded' } }
            },
            on: {
              created() {},
              mounted: finish
            }
          });
        } catch (err) {
          console.warn('[pet-controller] 建立 WebPet 失敗', err);
          this._creating = false;
          this.petInstance = null;
          resolve(null);
          return;
        }

        // jQuery 若已存在，mounted 同步觸發；否則等 CDN 載入
        setTimeout(() => {
          if (!settled && queryPetEl()) finish();
        }, 2500);
      });
    },

    /**
     * 顯示並開始漫遊
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

      // hide(true) 後需 show()；若尚未隱藏則直接顯示 DOM
      if (!callPetMethod('show')) {
        if (el) el.style.display = 'block';
      }

      this.isActive = true;
      document.body.classList.add('web-pet-roaming');
      positionBubbleAbovePet();
      startFollowLoop();
    },

    /**
     * 隱藏桌寵；電子書模式可銷毀 DOM
     * @param {{destroy?: boolean}} [opts]
     */
    hidePet(opts) {
      const destroy = Boolean(opts && opts.destroy);
      clearForceHideTimer();
      this.forceHold = false;
      this.isActive = false;
      stopFollowLoop();
      restoreMascotDock();

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
      document.querySelectorAll('.pet-paw-warp').forEach((el) => el.remove());
    },

    /**
     * 強制召喚（學習提示）：重置 idle、顯示寵物，短暫忽略使用者操作隱藏
     * @param {number} [holdMs=6000]
     * @returns {Promise<void>}
     */
    async forceAppear(holdMs) {
      if (isEbookMode()) return;
      const ms = holdMs == null ? 6000 : Number(holdMs);
      this.idleTime = this.idleThreshold;
      this.forceHold = true;
      clearForceHideTimer();
      await this.showPet();
      forceHideTimer = setTimeout(() => {
        forceHideTimer = null;
        this.forceHold = false;
        this.idleTime = 0;
        this.hidePet();
      }, Math.max(1000, ms));
    },

    /** @returns {DOMRect|null} */
    getPetRect() {
      const el = queryPetEl();
      return el ? el.getBoundingClientRect() : null;
    },

    /** @returns {HTMLElement|null} */
    getPetElement() {
      return queryPetEl();
    },

    /** 供 MascotApp 在對話時對齊氣泡 */
    syncBubbleToPet() {
      if (!this.isActive) return false;
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
