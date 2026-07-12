/**
 * utils.js — 共用工具（Web Speech TTS 等）
 *
 * 提供全域 speakText / stopSpeaking，供閱讀練習、文章庫、詞彙卡呼叫。
 */

/**
 * 朗讀英文文字（瀏覽器原生 speechSynthesis）
 * @param {string} text - 要朗讀的文字
 * @param {string} [lang='en-US'] - 語音語言
 * @param {(() => void)|null} [onEnd=null] - 朗讀結束或失敗時的回呼
 */
function speakText(text, lang = 'en-US', onEnd = null) {
  if (!('speechSynthesis' in window)) {
    alert('您的瀏覽器不支援語音合成功能');
    return;
  }

  const content = String(text || '').trim();
  if (!content) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = lang || 'en-US';
  utterance.rate = 0.9;

  const finish = () => {
    try {
      window.dispatchEvent(new CustomEvent('sw-tts-end'));
    } catch (_) {
      /* ignore */
    }
    if (typeof onEnd === 'function') onEnd();
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  window.speechSynthesis.speak(utterance);
}

/**
 * 停止目前正在播放的語音
 */
function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * 建立「朗讀／停止」按鈕組
 * @param {string|(() => string)} textOrGetter - 英文全文，或回傳全文的函式
 * @returns {HTMLElement}
 */
function createArticleSpeakControls(textOrGetter) {
  const wrap = document.createElement('div');
  wrap.className = 'tts-controls';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'icon-btn play-article-btn';
  playBtn.title = '朗讀文章';
  playBtn.textContent = '🔊 朗讀';

  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'icon-btn stop-article-btn hidden';
  stopBtn.title = '停止朗讀';
  stopBtn.textContent = '⏹️ 停止';

  const showPlay = () => {
    playBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  };

  const showStop = () => {
    playBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
  };

  playBtn.addEventListener('click', () => {
    const text =
      typeof textOrGetter === 'function' ? textOrGetter() : textOrGetter;
    const content = String(text || '').trim();
    if (!content) return;
    showStop();
    speakText(content, 'en-US', showPlay);
  });

  stopBtn.addEventListener('click', () => {
    stopSpeaking();
    showPlay();
  });

  wrap.append(playBtn, stopBtn);
  return wrap;
}

/**
 * 建立生字旁的發音按鈕
 * @param {string} term - 英文單字
 * @returns {HTMLButtonElement}
 */
function createVocabSpeakButton(term) {
  const word = String(term || '').trim();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vocab-speak-btn icon-btn';
  btn.title = word ? `發音：${word}` : '發音';
  btn.setAttribute('aria-label', word ? `朗讀 ${word}` : '朗讀生字');
  btn.dataset.term = word;
  btn.textContent = '🔊';

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const t = btn.dataset.term || word;
    if (t) speakText(t, 'en-US');
  });

  return btn;
}

/** 巢狀 API 計數：避免並行請求時過早隱藏標籤 */
let aiIndicatorDepth = 0;

/** hide 動畫延遲計時器 */
let hideAiIndicatorTimer = null;

/**
 * 顯示右下角 AI 模式懸浮標籤
 * @param {string} [mode='standard'] - taskType：standard / story / literature / ethics / challenge / complex_logic / ultimate_celebration / deep_correction
 */
function showAiIndicator(mode) {
  const indicator = document.getElementById('ai-mode-indicator');
  const icon = document.getElementById('ai-mode-icon');
  const text = document.getElementById('ai-mode-text');
  if (!indicator || !icon || !text) return;

  if (hideAiIndicatorTimer) {
    clearTimeout(hideAiIndicatorTimer);
    hideAiIndicatorTimer = null;
  }

  aiIndicatorDepth += 1;

  indicator.classList.remove('mode-flash', 'mode-thinking', 'mode-pro', 'mode-chat');

  switch (mode) {
    case 'ethics':
    case 'challenge':
    case 'complex_logic':
      icon.textContent = '🧠';
      text.textContent = '推理模式 (Reasoner)...';
      indicator.classList.add('mode-thinking');
      break;
    case 'story':
    case 'literature':
      icon.textContent = '✍️';
      text.textContent = '穩定寫作 (Chat)...';
      indicator.classList.add('mode-chat');
      break;
    case 'ultimate_celebration':
    case 'deep_correction':
      icon.textContent = '💎';
      text.textContent = '專業模式 (Pro)...';
      indicator.classList.add('mode-pro');
      break;
    default:
      icon.textContent = '⚡';
      text.textContent = '閃電模式 (Flash)...';
      indicator.classList.add('mode-flash');
  }

  indicator.setAttribute('aria-hidden', 'false');
  indicator.classList.remove('hidden');
  // 下一幀再加 show，讓 opacity / transform 過渡生效
  requestAnimationFrame(() => {
    indicator.classList.add('show');
  });
}

/**
 * 隱藏 AI 模式懸浮標籤（等淡出動畫結束後再加 hidden）
 */
function hideAiIndicator() {
  const indicator = document.getElementById('ai-mode-indicator');
  if (!indicator) return;

  aiIndicatorDepth = Math.max(0, aiIndicatorDepth - 1);
  if (aiIndicatorDepth > 0) return;

  indicator.classList.remove('show');
  indicator.setAttribute('aria-hidden', 'true');

  if (hideAiIndicatorTimer) {
    clearTimeout(hideAiIndicatorTimer);
  }
  hideAiIndicatorTimer = setTimeout(() => {
    indicator.classList.add('hidden');
    hideAiIndicatorTimer = null;
  }, 300);
}

window.speakText = speakText;
window.stopSpeaking = stopSpeaking;
window.createArticleSpeakControls = createArticleSpeakControls;
window.createVocabSpeakButton = createVocabSpeakButton;
window.showAiIndicator = showAiIndicator;
window.hideAiIndicator = hideAiIndicator;
