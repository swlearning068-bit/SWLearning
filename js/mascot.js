/**
 * Phase 13.3+：Lottie 動態學習小夥伴
 * 狀態：idle / thinking / success / error
 * 對外 API：setState / triggerSuccess / triggerHint / triggerError / triggerThinking / say
 */
(function () {
  'use strict';

  const IDLE_MESSAGES = [
    '準備好開始今天的挑戰了嗎？',
    '慢慢來，我會陪著你～',
    '記得先看清楚題目再作答喔！',
    '累了就休息一下，再繼續加油！'
  ];

  const SUCCESS_MESSAGES = [
    '太棒了！完全正確！',
    '漂亮！就是這樣！',
    '答對了，繼續保持！',
    '優秀！你越來越上手了！'
  ];

  const ERROR_MESSAGES = [
    '沒關係，再試一次！',
    '差一點～仔細看看提示吧！',
    '別灰心，錯誤是學習的一部分！'
  ];

  const LOTTIE_VER = '3';
  const ANIMATIONS = {
    idle: `assets/lottie/mascot-idle.json?v=${LOTTIE_VER}`,
    success: `assets/lottie/mascot-success.json?v=${LOTTIE_VER}`,
    thinking: `assets/lottie/mascot-thinking.json?v=${LOTTIE_VER}`,
    error: `assets/lottie/mascot-error.json?v=${LOTTIE_VER}`
  };

  let idleTimer = null;
  let messageIndex = 0;
  let currentState = '';

  /**
   * @returns {boolean}
   */
  function ready() {
    return Boolean(MascotApp.container && MascotApp.bubble);
  }

  /**
   * @returns {boolean}
   */
  function hasLottie() {
    return typeof window.lottie !== 'undefined' && typeof window.lottie.loadAnimation === 'function';
  }

  /**
   * @param {number} [ms]
   */
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

  /**
   * @param {string[]} list
   * @returns {string}
   */
  function pickMessage(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const msg = list[messageIndex % list.length];
    messageIndex += 1;
    return msg;
  }

  /**
   * @param {HTMLElement} el
   * @param {string|null|undefined} message
   */
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

  const MascotApp = {
    container: null,
    bubble: null,
    currentAnimation: null,
    animations: ANIMATIONS,

    init() {
      this.container = document.getElementById('mascot-lottie-avatar');
      this.bubble = document.getElementById('mascot-speech-bubble');
      if (!ready()) return;

      if (!hasLottie()) {
        console.warn('[mascot.js] lottie-web 尚未載入，改用靜態後備顯示');
        this.container.innerHTML =
          '<span class="mascot-fallback" aria-hidden="true">🐶</span>';
      }

      const onTap = () => {
        this.setState('idle', pickMessage(IDLE_MESSAGES));
        scheduleIdle(4000);
      };
      this.container.addEventListener('click', onTap);
      this.container.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTap();
        }
      });

      this.setState('idle', IDLE_MESSAGES[0]);
      scheduleIdle(5000);
    },

    /**
     * @param {'idle'|'thinking'|'success'|'error'} state
     */
    loadAnimation(state) {
      if (!ready()) return;

      const next = ANIMATIONS[state] ? state : 'idle';
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
        currentState = next;
        return;
      }

      // 同一狀態且動畫仍在：不必重載（避免點擊閒聊時閃爍）
      if (next === currentState && this.currentAnimation) {
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

      this.container.innerHTML = '';
      this.currentAnimation = window.lottie.loadAnimation({
        container: this.container,
        renderer: 'svg',
        loop: next === 'idle' || next === 'thinking',
        autoplay: true,
        path: ANIMATIONS[next] || ANIMATIONS.idle
      });

      this.currentAnimation.addEventListener('data_failed', () => {
        console.warn('[mascot.js] 動畫載入失敗：', ANIMATIONS[next]);
        this.container.innerHTML =
          '<span class="mascot-fallback" aria-hidden="true">🐶</span>';
      });

      currentState = next;
    },

    /**
     * @param {'idle'|'thinking'|'success'|'error'} state
     * @param {string|null} [message]
     */
    setState(state, message) {
      if (!ready()) return;

      const next = ANIMATIONS[state] ? state : 'idle';
      if (idleTimer && next !== 'idle') {
        clearTimeout(idleTimer);
        idleTimer = null;
      }

      this.loadAnimation(next);
      updateBubble(this.bubble, message);
    },

    /**
     * @param {string} [message]
     */
    triggerSuccess(message) {
      this.setState('success', message || pickMessage(SUCCESS_MESSAGES));
      scheduleIdle(3000);
    },

    /**
     * @param {string} hintText
     */
    triggerHint(hintText) {
      this.setState('thinking', hintText || '讓我想想……');
    },

    /**
     * @param {string} [message]
     */
    triggerError(message) {
      this.setState('error', message || pickMessage(ERROR_MESSAGES));
      scheduleIdle(3500);
    },

    /**
     * @param {string} [message]
     */
    triggerThinking(message) {
      this.triggerHint(message || '正在努力想……請稍候！');
    },

    /**
     * @param {string} [message]
     */
    say(message) {
      this.setState('idle', message || pickMessage(IDLE_MESSAGES));
      scheduleIdle(4500);
    }
  };

  window.MascotApp = MascotApp;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MascotApp.init());
  } else {
    MascotApp.init();
  }
})();
