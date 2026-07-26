/**
 * Phase 13.3：學習小夥伴（Mascot）
 * 狀態：idle / thinking / success / error
 * 供 quest-mode.js、task-ui.js、quiz.js 等透過 window.MascotApp 呼叫
 */
(function () {
  'use strict';

  const FACES = {
    idle: '🐶',
    thinking: '🤔',
    success: '🎉',
    error: '🥺'
  };

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

  let idleTimer = null;
  let messageIndex = 0;

  /**
   * @returns {boolean}
   */
  function ready() {
    return Boolean(MascotApp.avatar && MascotApp.bubble && MascotApp.icon);
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

  const MascotApp = {
    avatar: null,
    bubble: null,
    icon: null,

    /**
     * 綁定 DOM（腳本在 body 尾端時可直接呼叫）
     */
    init() {
      this.avatar = document.getElementById('mascot-avatar');
      this.bubble = document.getElementById('mascot-speech-bubble');
      this.icon = document.querySelector('#mascot-avatar .mascot-icon');

      if (!ready()) return;

      const onTap = () => {
        this.setState('idle', pickMessage(IDLE_MESSAGES));
        scheduleIdle(4000);
      };
      this.avatar.addEventListener('click', onTap);
      this.avatar.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTap();
        }
      });

      // 歡迎詞
      this.setState('idle', IDLE_MESSAGES[0]);
      scheduleIdle(5000);
    },

    /**
     * @param {'idle'|'thinking'|'success'|'error'} state
     * @param {string|null} [message]
     */
    setState(state, message) {
      if (!ready()) return;

      const next = FACES[state] ? state : 'idle';
      if (idleTimer && next !== 'idle') {
        clearTimeout(idleTimer);
        idleTimer = null;
      }

      this.avatar.className = `mascot-avatar state-${next}`;
      this.icon.textContent = FACES[next] || FACES.idle;

      if (message) {
        this.bubble.textContent = message;
        this.bubble.classList.remove('hidden');
        this.bubble.classList.remove('speech-bubble--pop');
        void this.bubble.offsetWidth;
        this.bubble.classList.add('speech-bubble--pop');
      } else {
        this.bubble.classList.add('hidden');
      }
    },

    /**
     * 答對／通關鼓勵
     * @param {string} [message]
     */
    triggerSuccess(message) {
      this.setState('success', message || pickMessage(SUCCESS_MESSAGES));
      scheduleIdle(3000);
    },

    /**
     * 思考中／提示
     * @param {string} hintText
     */
    triggerHint(hintText) {
      this.setState(
        'thinking',
        hintText || '讓我想想……'
      );
    },

    /**
     * 答錯溫和回饋
     * @param {string} [message]
     */
    triggerError(message) {
      this.setState('error', message || pickMessage(ERROR_MESSAGES));
      scheduleIdle(3500);
    },

    /**
     * 載入／生成中
     * @param {string} [message]
     */
    triggerThinking(message) {
      this.triggerHint(message || '正在努力想……請稍候！');
    },

    /**
     * 歡迎／待機台詞
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
