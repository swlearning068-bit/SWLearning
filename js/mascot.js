/**
 * Phase 13.3–13.5：Lottie 多形態學習小夥伴
 * 形態：baby → rookie → pro → master
 * 狀態：idle / thinking / success / error
 */
(function () {
  'use strict';

  const LOTTIE_VER = '6';
  const STORAGE_KEY_STAGE = 'sw_mascot_stage';
  const STORAGE_KEY_POS = 'sw_mascot_pos';
  const DRAG_THRESHOLD_PX = 6;

  /** @type {Array<{id: string, name: string, title: string, min: number, blurb: string}>} */
  const EVOLUTION_STAGES = [
    {
      id: 'baby',
      name: '實習生',
      title: '奶瓶狗 BB',
      min: 1,
      blurb: '剛踏進社工路的小小夥伴'
    },
    {
      id: 'rookie',
      name: '前線社工',
      title: '熱血實習犬',
      min: 21,
      blurb: '掛上工作證，準備衝第一線！'
    },
    {
      id: 'pro',
      name: '單位主管',
      title: '專業筆記犬',
      min: 51,
      blurb: '眼鏡一戴，筆記本在手，專業登場'
    },
    {
      id: 'master',
      name: '資深督導',
      title: '披風督導犬',
      min: 81,
      blurb: '披上督導披風，陪你走到最終關'
    }
  ];

  /**
   * 形態資源映射表（Phase 13.5）
   * @type {Record<string, Record<'idle'|'success'|'thinking'|'error', string>>}
   */
  const mascotAssets = {
    baby: {
      idle: `assets/lottie/mascot-baby-idle.json?v=${LOTTIE_VER}`,
      success: `assets/lottie/mascot-baby-success.json?v=${LOTTIE_VER}`,
      thinking: `assets/lottie/mascot-baby-thinking.json?v=${LOTTIE_VER}`,
      error: `assets/lottie/mascot-baby-error.json?v=${LOTTIE_VER}`
    },
    rookie: {
      idle: `assets/lottie/mascot-rookie-idle.json?v=${LOTTIE_VER}`,
      success: `assets/lottie/mascot-rookie-success.json?v=${LOTTIE_VER}`,
      thinking: `assets/lottie/mascot-rookie-thinking.json?v=${LOTTIE_VER}`,
      error: `assets/lottie/mascot-rookie-error.json?v=${LOTTIE_VER}`
    },
    pro: {
      idle: `assets/lottie/mascot-pro-idle.json?v=${LOTTIE_VER}`,
      success: `assets/lottie/mascot-pro-success.json?v=${LOTTIE_VER}`,
      thinking: `assets/lottie/mascot-pro-thinking.json?v=${LOTTIE_VER}`,
      error: `assets/lottie/mascot-pro-error.json?v=${LOTTIE_VER}`
    },
    master: {
      idle: `assets/lottie/mascot-master-idle.json?v=${LOTTIE_VER}`,
      success: `assets/lottie/mascot-master-success.json?v=${LOTTIE_VER}`,
      thinking: `assets/lottie/mascot-master-thinking.json?v=${LOTTIE_VER}`,
      error: `assets/lottie/mascot-master-error.json?v=${LOTTIE_VER}`
    }
  };

  const MESSAGES_BY_STAGE = {
    baby: {
      idle: [
        '準備好開始今天的挑戰了嗎？',
        '慢慢來，我會陪著你～',
        '記得先看清楚題目再作答喔！',
        '累了就休息一下，再繼續加油！'
      ],
      success: ['太棒了！完全正確！', '答對了，繼續保持！', '哇！你超強的！'],
      error: ['沒關係，再試一次！', '差一點～仔細看看提示吧！', '別灰心，我們一起加油！']
    },
    rookie: {
      idle: [
        '工作證已佩戴，衝第一線！',
        '這關很實務，專心應戰吧。',
        '把專業詞彙記起來喔。',
        '休息夠了就繼續衝關！'
      ],
      success: [
        '漂亮！前線社工就是這樣！',
        '判斷正確，繼續保持節奏。',
        '好身手，下一題也沒問題！'
      ],
      error: [
        '實務上也常遇到這種題，再練！',
        '對照提示調整一下思路。',
        '沒過關沒關係，重點是學會。'
      ]
    },
    pro: {
      idle: [
        '筆記本打開，先釐清問題。',
        '這關可以當督導前的暖身。',
        '注意用詞精準度，會更專業。',
        '穩定輸出，比一次衝刺更重要。'
      ],
      success: [
        '決策正確，很有主管風範。',
        '漂亮！重點都抓到了。',
        '這種穩定度，團隊會很安心。'
      ],
      error: [
        '先停一下，回顧關鍵概念再試。',
        '錯也是資訊，調整策略即可。',
        '督導思維：找出卡關點再前進。'
      ]
    },
    master: {
      idle: [
        '披風督導模式啟動，穩健推進。',
        '把經驗轉成判斷力，就是專業。',
        '這關可以當教學案例來拆解。',
        '保持節奏，我陪你走到第 100 關。'
      ],
      success: [
        '典範級表現，督導會給按讚。',
        '精準又沉著，太出色了。',
        '這就是資深社工的手感！'
      ],
      error: [
        '即使資深也會再確認細節，再來。',
        '把這題變成你的教學筆記。',
        '深度複盤後，下一題會更穩。'
      ]
    }
  };

  let idleTimer = null;
  let messageIndex = 0;
  let currentState = '';
  let previewAnimation = null;
  /** @type {{stage: string, stageName: string, title: string, blurb: string}|null} */
  let pendingEvolution = null;

  function ready() {
    return Boolean(MascotApp.container && MascotApp.bubble);
  }

  function hasLottie() {
    return (
      typeof window.lottie !== 'undefined' &&
      typeof window.lottie.loadAnimation === 'function'
    );
  }

  function scheduleIdle(ms) {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (ms == null || ms <= 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      MascotApp.setState('idle');
    }, ms);
  }

  function pickMessage(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const msg = list[messageIndex % list.length];
    messageIndex += 1;
    return msg;
  }

  function stageMessages(kind) {
    const pack =
      MESSAGES_BY_STAGE[MascotApp.currentStage] || MESSAGES_BY_STAGE.baby;
    return pack[kind] || MESSAGES_BY_STAGE.baby[kind];
  }

  function updateBubble(el, message) {
    if (message) {
      el.textContent = message;
      el.classList.remove('hidden');
      el.classList.remove('speech-bubble--pop');
      void el.offsetWidth;
      el.classList.add('speech-bubble--pop');
    } else {
      el.classList.add('hidden');
    }
  }

  function resolveStage(level) {
    const n = Math.max(1, Number(level) || 1);
    let found = EVOLUTION_STAGES[0];
    for (let i = 0; i < EVOLUTION_STAGES.length; i += 1) {
      if (n >= EVOLUTION_STAGES[i].min) found = EVOLUTION_STAGES[i];
    }
    return found;
  }

  function normalizeStageId(raw) {
    if (!raw) return '';
    // 舊版命名相容
    if (raw === 'teen') return 'rookie';
    if (raw === 'adult') return 'pro';
    if (mascotAssets[raw]) return raw;
    return '';
  }

  function persistStage(stage) {
    try {
      localStorage.setItem(STORAGE_KEY_STAGE, stage);
    } catch (_) {
      // ignore
    }
  }

  function loadPersistedStage() {
    try {
      return normalizeStageId(localStorage.getItem(STORAGE_KEY_STAGE) || '');
    } catch (_) {
      return '';
    }
  }

  /**
   * @returns {{left: number, top: number}|null}
   */
  function loadPersistedPosition() {
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
  function persistPosition(pos) {
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
   * @param {HTMLElement} root
   * @param {number} left
   * @param {number} top
   * @returns {{left: number, top: number}}
   */
  function clampPosition(root, left, top) {
    const margin = 4;
    const w = root.offsetWidth || 140;
    const h = root.offsetHeight || 180;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(margin, window.innerHeight - h - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop)
    };
  }

  /**
   * @param {HTMLElement} root
   * @param {{left: number, top: number}} pos
   */
  function applyPosition(root, pos) {
    const clamped = clampPosition(root, pos.left, pos.top);
    root.style.left = `${clamped.left}px`;
    root.style.top = `${clamped.top}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.classList.add('mascot-positioned');
    return clamped;
  }

  /**
   * 綁定自由拖拉（拖曳超過閾值才算移動，避免誤觸台詞）
   * @param {HTMLElement} root
   * @param {HTMLElement} handle
   * @param {() => void} onTap
   */
  function bindMascotDrag(root, handle, onTap) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let pointerId = null;

    const onPointerDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      dragging = true;
      moved = false;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      root.classList.add('mascot-dragging');
      try {
        handle.setPointerCapture(event.pointerId);
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
      applyPosition(root, {
        left: originLeft + dx,
        top: originTop + dy
      });
    };

    const endDrag = (event) => {
      if (!dragging) return;
      if (pointerId != null && event.pointerId !== pointerId) return;
      dragging = false;
      root.classList.remove('mascot-dragging');
      try {
        if (pointerId != null) handle.releasePointerCapture(pointerId);
      } catch (_) {
        // ignore
      }
      pointerId = null;

      if (moved) {
        const rect = root.getBoundingClientRect();
        const saved = applyPosition(root, { left: rect.left, top: rect.top });
        persistPosition(saved);
        return;
      }
      onTap();
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', () => {
      if (!root.classList.contains('mascot-positioned')) return;
      const left = parseFloat(root.style.left);
      const top = parseFloat(root.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      const saved = applyPosition(root, { left, top });
      persistPosition(saved);
    });
  }

  /**
   * @param {string} stage
   * @returns {Record<'idle'|'success'|'thinking'|'error', string>}
   */
  function assetsFor(stage) {
    return mascotAssets[stage] || mascotAssets.baby;
  }

  /**
   * @param {HTMLElement} container
   * @param {string} path
   * @param {{loop?: boolean}} [opts]
   * @returns {object|null}
   */
  function playLottie(container, path, opts) {
    if (!container || !hasLottie()) return null;
    container.innerHTML = '';
    const anim = window.lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: Boolean(opts && opts.loop),
      autoplay: true,
      path
    });
    anim.addEventListener('data_failed', () => {
      console.warn('[mascot.js] 動畫載入失敗：', path);
      container.innerHTML =
        '<span class="mascot-fallback" aria-hidden="true">🐶</span>';
    });
    return anim;
  }

  function destroyPreview() {
    if (previewAnimation) {
      try {
        previewAnimation.destroy();
      } catch (_) {
        // ignore
      }
      previewAnimation = null;
    }
    const preview = document.getElementById('mascot-evolution-preview');
    if (preview) preview.innerHTML = '';
  }

  /**
   * 套用形態到右下角常駐小夥伴
   * @param {string} stageId
   * @param {string} [message]
   */
  function applyStageVisual(stageId, message) {
    const meta = EVOLUTION_STAGES.find((s) => s.id === stageId) || EVOLUTION_STAGES[0];
    MascotApp.currentStage = meta.id;
    MascotApp.stageName = meta.name;
    MascotApp.stageTitle = meta.title;
    MascotApp.animations = assetsFor(meta.id);
    persistStage(meta.id);
    currentState = '';

    if (MascotApp.container) {
      MascotApp.container.dataset.stage = meta.id;
      MascotApp.container.setAttribute(
        'aria-label',
        `學習小夥伴（${meta.title} · ${meta.name}），可拖拉移動；點擊可聽鼓勵`
      );
    }

    if (message) {
      MascotApp.setState('idle', message);
      scheduleIdle(4500);
    } else {
      MascotApp.setState('idle');
    }
  }

  const MascotApp = {
    root: null,
    container: null,
    bubble: null,
    currentAnimation: null,
    currentStage: 'baby',
    stageName: '實習生',
    stageTitle: '奶瓶狗 BB',
    animations: assetsFor('baby'),
    assets: mascotAssets,

    init() {
      this.container = document.getElementById('mascot-lottie-avatar');
      this.bubble = document.getElementById('mascot-speech-bubble');
      this.root = document.getElementById('mascot-container');
      if (!ready()) return;

      if (!hasLottie()) {
        console.warn('[mascot.js] lottie-web 尚未載入，改用靜態後備顯示');
        this.container.innerHTML =
          '<span class="mascot-fallback" aria-hidden="true">🐶</span>';
      }

      const persisted = loadPersistedStage();
      if (persisted) {
        const meta = EVOLUTION_STAGES.find((s) => s.id === persisted);
        this.currentStage = persisted;
        this.stageName = meta ? meta.name : '實習生';
        this.stageTitle = meta ? meta.title : '奶瓶狗 BB';
        this.animations = assetsFor(persisted);
      }

      const onTap = () => {
        this.setState('idle', pickMessage(stageMessages('idle')));
        scheduleIdle(4000);
      };

      // 拖拉整個容器；輕點頭像才說話（避免與 drag 衝突）
      if (this.root) {
        const savedPos = loadPersistedPosition();
        if (savedPos) {
          requestAnimationFrame(() => {
            const clamped = applyPosition(this.root, savedPos);
            persistPosition(clamped);
          });
        }
        bindMascotDrag(this.root, this.container, onTap);
      }

      this.container.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTap();
        }
      });

      document
        .getElementById('btn-close-mascot-evolution')
        ?.addEventListener('click', () => this.closeEvolutionModal());

      document
        .getElementById('mascot-evolution-modal')
        ?.addEventListener('click', (event) => {
          if (event.target && event.target.id === 'mascot-evolution-modal') {
            this.closeEvolutionModal();
          }
        });

      this.container.dataset.stage = this.currentStage;
      this.container.setAttribute(
        'aria-label',
        '學習小夥伴，可拖拉移動；點擊可聽鼓勵'
      );
      this.setState('idle', pickMessage(stageMessages('idle')));
      scheduleIdle(5000);

      setTimeout(() => {
        this.syncFromQuestProgress({ announce: false });
      }, 0);
    },

    /**
     * 依形態＋情緒狀態更新視覺
     * @param {'idle'|'success'|'thinking'|'error'} state
     */
    updateMascotVisual(state) {
      this.loadAnimation(state);
    },

    /**
     * @param {number} currentLevel
     * @param {{announce?: boolean}} [options]
     * @returns {{stage: string, stageName: string, evolved: boolean}}
     */
    checkEvolution(currentLevel, options) {
      const announce = Boolean(options && options.announce);
      const next = resolveStage(currentLevel);
      const prevStage = this.currentStage;
      const evolved = Boolean(prevStage && prevStage !== next.id);

      if (!evolved) {
        // 同階段：校正路徑／舊版 teen→rookie、adult→pro
        this.currentStage = next.id;
        this.stageName = next.name;
        this.stageTitle = next.title;
        this.animations = assetsFor(next.id);
        persistStage(next.id);
        if (this.container) this.container.dataset.stage = next.id;
        return {
          stage: next.id,
          stageName: next.name,
          evolved: false
        };
      }

      if (announce) {
        // 先不立刻換右下角，開慶祝 Modal；關閉後再套用
        pendingEvolution = {
          stage: next.id,
          stageName: next.name,
          title: next.title,
          blurb: next.blurb
        };
        this.openEvolutionModal(pendingEvolution);
      } else {
        applyStageVisual(next.id, null);
        updateBubble(this.bubble, null);
      }

      return {
        stage: next.id,
        stageName: next.name,
        evolved: true
      };
    },

    /**
     * @param {{announce?: boolean}} [options]
     */
    syncFromQuestProgress(options) {
      let level = 1;
      if (typeof window.getHighestUnlockedLevel === 'function') {
        try {
          level = Number(window.getHighestUnlockedLevel()) || 1;
        } catch (_) {
          level = 1;
        }
      }
      return this.checkEvolution(level, options);
    },

    /**
     * @param {{stage: string, stageName: string, title: string, blurb: string}} info
     */
    openEvolutionModal(info) {
      const modal = document.getElementById('mascot-evolution-modal');
      const titleEl = document.getElementById('mascot-evolution-title');
      const nameEl = document.getElementById('mascot-evolution-name');
      const descEl = document.getElementById('mascot-evolution-desc');
      const preview = document.getElementById('mascot-evolution-preview');
      if (!modal || !preview) {
        // 無 Modal 時直接套用
        applyStageVisual(info.stage, `✨ 我進化成「${info.title}」了！`);
        pendingEvolution = null;
        return;
      }

      if (titleEl) titleEl.textContent = '✨ 恭喜！你的小夥伴進化了！✨';
      if (nameEl) nameEl.textContent = `${info.title}（${info.stageName}）`;
      if (descEl) {
        descEl.textContent =
          info.blurb ||
          `太棒了！跟著你一起學習，我也進化成「${info.stageName}」了！`;
      }

      destroyPreview();
      const path = assetsFor(info.stage).success;
      previewAnimation = playLottie(preview, path, { loop: true });

      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');

      if (typeof confetti === 'function') {
        try {
          confetti({
            particleCount: 140,
            spread: 80,
            origin: { y: 0.55 },
            colors: ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa']
          });
        } catch (_) {
          // ignore
        }
      }
    },

    closeEvolutionModal() {
      const modal = document.getElementById('mascot-evolution-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
      }
      destroyPreview();

      if (pendingEvolution) {
        const info = pendingEvolution;
        pendingEvolution = null;
        applyStageVisual(
          info.stage,
          `✨ 太棒了！跟著你一起學習，我也進化成「${info.title}」了！`
        );
      }
    },

    /**
     * 相容舊 API：直接播進化慶祝
     * @param {string} [stageName]
     */
    triggerEvolution(stageName) {
      const meta =
        EVOLUTION_STAGES.find((s) => s.name === stageName || s.id === stageName) ||
        EVOLUTION_STAGES.find((s) => s.id === this.currentStage) ||
        resolveStage(
          typeof window.getHighestUnlockedLevel === 'function'
            ? window.getHighestUnlockedLevel()
            : 1
        );

      pendingEvolution = {
        stage: meta.id,
        stageName: meta.name,
        title: meta.title,
        blurb: meta.blurb
      };
      this.openEvolutionModal(pendingEvolution);
    },

    /**
     * @param {'idle'|'thinking'|'success'|'error'} state
     */
    loadAnimation(state) {
      if (!ready()) return;

      const paths = this.animations || assetsFor(this.currentStage);
      const next = paths[state] ? state : 'idle';
      this.container.dataset.state = next;

      if (!hasLottie()) {
        const faces = {
          idle: '🐶',
          thinking: '🤔',
          success: '🎉',
          error: '🥺'
        };
        this.container.innerHTML =
          `<span class="mascot-fallback" aria-hidden="true">${faces[next] || faces.idle}</span>`;
        currentState = `${this.currentStage}:${next}`;
        return;
      }

      const stateKey = `${this.currentStage}:${next}`;
      if (stateKey === currentState && this.currentAnimation) {
        try {
          this.currentAnimation.goToAndPlay(0, true);
        } catch (_) {
          // ignore
        }
        return;
      }

      if (this.currentAnimation) {
        try {
          this.currentAnimation.destroy();
        } catch (_) {
          // ignore
        }
        this.currentAnimation = null;
      }

      this.currentAnimation = playLottie(this.container, paths[next] || paths.idle, {
        loop: next === 'idle' || next === 'thinking'
      });
      currentState = stateKey;
    },

    /**
     * @param {'idle'|'thinking'|'success'|'error'} state
     * @param {string|null} [message]
     */
    setState(state, message) {
      if (!ready()) return;
      const next = this.animations[state] ? state : 'idle';
      if (idleTimer && next !== 'idle') {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      this.updateMascotVisual(next);
      updateBubble(this.bubble, message);
    },

    triggerSuccess(message) {
      this.setState('success', message || pickMessage(stageMessages('success')));
      scheduleIdle(3000);
    },

    triggerHint(hintText) {
      this.setState('thinking', hintText || '讓我想想……');
    },

    triggerError(message) {
      this.setState('error', message || pickMessage(stageMessages('error')));
      scheduleIdle(3500);
    },

    triggerThinking(message) {
      this.triggerHint(message || '正在努力想……請稍候！');
    },

    say(message) {
      this.setState('idle', message || pickMessage(stageMessages('idle')));
      scheduleIdle(4500);
    }
  };

  window.MascotApp = MascotApp;
  window.MASCOT_ASSETS = mascotAssets;
  window.MASCOT_EVOLUTION_STAGES = EVOLUTION_STAGES;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MascotApp.init());
  } else {
    MascotApp.init();
  }
})();
