/**
 * Phase 13.7：Web-Pet 學習小夥伴控制器
 * - web-pet 取代 Lottie 成為主視覺（常駐顯示）
 * - 可自由拖放，並記住位置
 * - 閒置時全螢幕漫遊；操作時停在原地（不強制回角落）
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

  const STORAGE_KEY_POS = 'sw_webpet_pos';
  const DRAG_THRESHOLD_PX = 6;

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

  function scrollOffset() {
    return {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0
    };
  }

  /**
   * @returns {{left: number, top: number}|null}
   */
  function loadSavedPos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_POS);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const left = Number(parsed?.left);
      const top = Number(parsed?.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      return { left, top };
    } catch (_) {
      return null;
    }
  }

  /**
   * @param {{left: number, top: number}} pos
   */
  function savePos(pos) {
    try {
      localStorage.setItem(
        STORAGE_KEY_POS,
        JSON.stringify({
          left: Math.round(pos.left),
          top: Math.round(pos.top)
        })
      );
    } catch (_) {
      // ignore
    }
  }

  /**
   * @param {HTMLElement} el
   * @param {number} left
   * @param {number} top
   * @returns {{left: number, top: number}}
   */
  function clampPos(el, left, top) {
    const margin = 4;
    const w = el.offsetWidth || 100;
    const h = el.offsetHeight || 100;
    const scroll = scrollOffset();
    const maxLeft = Math.max(
      margin,
      scroll.x + window.innerWidth - w - margin
    );
    const maxTop = Math.max(
      margin,
      scroll.y + window.innerHeight - h - margin
    );
    return {
      left: Math.min(Math.max(scroll.x + margin, left), maxLeft),
      top: Math.min(Math.max(scroll.y + margin, top), maxTop)
    };
  }

  /**
   * @param {HTMLElement} el
   * @param {number} left
   * @param {number} top
   * @returns {{left: number, top: number}}
   */
  function applyPos(el, left, top) {
    const clamped = clampPos(el, left, top);
    el.style.left = `${clamped.left}px`;
    el.style.top = `${clamped.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    return clamped;
  }

  function restoreSavedPos() {
    const el = queryPetEl();
    if (!el) return false;
    const saved = loadSavedPos();
    if (!saved) return false;
    applyPos(el, saved.left, saved.top);
    return true;
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

  /**
   * 停用 web-pet 內建 jQuery 拖曳／點擊，改由我們的 pointer 拖曳接管
   * @param {HTMLElement} el
   */
  function disableNativePetDrag(el) {
    withJQuery(($) => {
      const $root = $(el);
      const $pet = $root.find('div.pet');
      $pet.off('mousedown click');
      $root.off('mousedown');
    });
  }

  /**
   * 自由拖放（滑鼠／觸控）+ 輕點說話
   * @param {HTMLElement} el
   */
  function bindPetDragOnce(el) {
    if (!el || el.dataset.swDragBound === '1') return;
    el.dataset.swDragBound = '1';
    el.classList.add('web-pet-draggable');

    disableNativePetDrag(el);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    /** @type {number|null} */
    let pointerId = null;

    const isInteractiveTarget = (target) => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          '.pet-operate, .pet-menu, .pet-message, input, button, textarea, a'
        )
      );
    };

    const onPointerDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;

      PetController.idleTime = 0;
      if (PetController.isRoaming) {
        PetController.stopRoaming({ dock: false });
      } else {
        callPetMethod('stopMove');
      }

      const rect = el.getBoundingClientRect();
      const scroll = scrollOffset();
      dragging = true;
      moved = false;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left + scroll.x;
      originTop = rect.top + scroll.y;
      el.classList.add('web-pet-dragging');
      document.body.classList.add('web-pet-dragging-active');

      try {
        el.setPointerCapture(event.pointerId);
      } catch (_) {
        // ignore
      }
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      if (pointerId != null && event.pointerId !== pointerId) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      applyPos(el, originLeft + dx, originTop + dy);
    };

    const endDrag = (event) => {
      if (!dragging) return;
      if (pointerId != null && event.pointerId !== pointerId) return;

      dragging = false;
      el.classList.remove('web-pet-dragging');
      document.body.classList.remove('web-pet-dragging-active');

      try {
        if (pointerId != null) el.releasePointerCapture(pointerId);
      } catch (_) {
        // ignore
      }
      pointerId = null;

      if (moved) {
        const rect = el.getBoundingClientRect();
        const scroll = scrollOffset();
        const saved = applyPos(el, rect.left + scroll.x, rect.top + scroll.y);
        savePos(saved);
        PetController.userParked = true;
        return;
      }

      // 輕點：鼓勵台詞
      const app = window.MascotApp;
      if (app && typeof app.say === 'function') {
        app.say();
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    // 避免觸控捲動搶手勢
    el.addEventListener(
      'touchmove',
      (event) => {
        if (dragging) event.preventDefault();
      },
      { passive: false }
    );

    window.addEventListener('resize', () => {
      const saved = loadSavedPos();
      if (!saved) return;
      applyPos(el, saved.left, saved.top);
    });
  }

  function setupPetInteractions() {
    const el = queryPetEl();
    if (!el) return;
    bindPetDragOnce(el);
    if (!restoreSavedPos()) {
      // 無記憶位置時維持 web-pet 預設右下角
    }
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
    /** 使用者是否曾手動放置 */
    userParked: false,
    _creating: false,
    _mounted: false,

    init() {
      document.body.classList.add('web-pet-companion');
      this.userParked = Boolean(loadSavedPos());

      const onUserActivity = (event) => {
        // 拖曳進行中略過，避免干擾
        if (document.body.classList.contains('web-pet-dragging-active')) {
          return;
        }
        this.idleTime = 0;
        if (isEbookMode()) return;

        // 點在寵物上：只停止漫遊，絕不強制回角落
        const onPet =
          event &&
          event.target &&
          typeof event.target.closest === 'function' &&
          event.target.closest('div.web-pet');

        if (this.isRoaming) {
          this.stopRoaming({ dock: false });
          if (onPet) return;
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
            '[pet-controller] web-pet 可拖放就緒（閒置',
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

      if (document.body.classList.contains('web-pet-dragging-active')) {
        return;
      }

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
          setupPetInteractions();
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

      const status = pet.$status;
      if (status === 'hide') {
        callPetMethod('show');
      }

      this.isActive = true;
      document.body.classList.add('web-pet-companion');
      setupPetInteractions();
      restoreSavedPos();
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
      document.body.classList.remove('web-pet-dragging-active');

      if (destroy) {
        callPetMethod('hide', true);
        removePetDom();
        this.petInstance = null;
        this._mounted = false;
        this._creating = false;
        return;
      }

      if (!callPetMethod('hide', true)) {
        const node = queryPetEl();
        if (node) node.style.display = 'none';
      }
      document.querySelectorAll('.pet-paw-warp').forEach((node) => node.remove());
    },

    startRoaming() {
      if (isEbookMode() || !this.isActive) return;
      if (document.body.classList.contains('web-pet-dragging-active')) return;
      this.isRoaming = true;
      document.body.classList.add('web-pet-roaming');
      callPetMethod('randomMove');
      stopRoamLoop();
      roamTimer = setInterval(() => {
        if (!this.isRoaming || isEbookMode()) return;
        if (document.body.classList.contains('web-pet-dragging-active')) return;
        callPetMethod('randomMove');
      }, 14000);
    },

    /**
     * @param {{dock?: boolean}} [opts]
     */
    stopRoaming(opts) {
      // 預設不停靠角落，保留使用者／漫遊當下位置
      const dock = Boolean(opts && opts.dock);
      this.isRoaming = false;
      stopRoamLoop();
      document.body.classList.remove('web-pet-roaming');
      callPetMethod('stopMove');
      document.querySelectorAll('.pet-paw-warp').forEach((node) => node.remove());

      if (dock && this.isActive && !isEbookMode()) {
        const saved = loadSavedPos();
        const el = queryPetEl();
        if (el && saved) {
          applyPos(el, saved.left, saved.top);
        } else if (el) {
          restoreSavedPos();
        }
      } else {
        // 漫遊中途停下：把目前座標存起來，方便下次還原
        const el = queryPetEl();
        if (el) {
          const rect = el.getBoundingClientRect();
          const scroll = scrollOffset();
          const saved = applyPos(el, rect.left + scroll.x, rect.top + scroll.y);
          savePos(saved);
        }
      }
    },

    /**
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
     * @param {number} [holdMs=6000]
     * @returns {Promise<void>}
     */
    async forceAppear(holdMs) {
      if (isEbookMode()) return;
      const ms = holdMs == null ? 6000 : Number(holdMs);
      this.idleTime = 0;
      await this.showPet();
      // 提示時停止漫遊，留在使用者放置的位置
      this.stopRoaming({ dock: false });
      this.setMood('thinking');
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
