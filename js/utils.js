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

window.speakText = speakText;
window.stopSpeaking = stopSpeaking;
window.createArticleSpeakControls = createArticleSpeakControls;
window.createVocabSpeakButton = createVocabSpeakButton;
