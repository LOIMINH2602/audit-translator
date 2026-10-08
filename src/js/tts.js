// Đọc to bản dịch bằng speechSynthesis của trình duyệt.

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;

export const supported = Boolean(synth);

export function voices() {
  return synth ? synth.getVoices() : [];
}

export function pickVoice(lang) {
  const base = lang.split('-')[0];
  const all = voices();
  return (
    all.find((v) => v.lang && v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase()) ||
    all.find((v) => v.lang && v.lang.toLowerCase().startsWith(base)) ||
    null
  );
}

// Giọng có thể nạp trễ: gọi cb mỗi khi danh sách giọng thay đổi.
export function onVoicesChanged(cb) {
  if (synth) synth.addEventListener('voiceschanged', cb);
}

const POLL_MS = 100;
const NO_START_MS = 4000; // không phát được (thiếu giọng, lỗi mạng TTS): đừng giữ mic tắt lâu

// Thời lượng đọc tối đa ước theo độ dài câu: Hán/kana/Hangul ~0,3 giây/ký tự, chữ Latin ~0,09 giây/ký tự.
export function maxSpeakMs(text) {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  return 2500 + cjk * 300 + (text.length - cjk) * 90;
}

// Trả về Promise resolve khi đọc xong (hoặc lỗi / quá thời gian dự phòng).
// onStart(msTừLúcGọi, voice) được gọi khi âm thanh thực sự bắt đầu — dùng đo độ trễ TTS.
// Chrome Android hay không bắn onend → trước đây mic tắt thêm vài giây sau khi đọc xong, câu trả lời của
// người kia bị mất. Nay theo dõi speechSynthesis.speaking: đã nói rồi mà hết nói là xong (trễ tối đa ~100ms).
export function speak(text, lang, { onStart, onError, onEnd } = {}) {
  return new Promise((resolve) => {
    if (!synth || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;

    const t0 = performance.now();
    let done = false;
    let started = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(guard);
      if (onEnd) onEnd(Math.round(performance.now() - t0), how);
      resolve();
    };
    const markStart = () => {
      if (started) return;
      started = true;
      if (onStart) onStart(Math.round(performance.now() - t0), voice);
    };
    const guard = setTimeout(() => finish('hết giờ'), maxSpeakMs(text));
    const poll = setInterval(() => {
      const ms = performance.now() - t0;
      if (synth.speaking && !synth.pending) {
        if (!started && ms > 300) markStart(); // Android có khi không bắn onstart
      } else if (started && !synth.speaking) {
        finish('dò');
      } else if (!started && ms > NO_START_MS) {
        finish('không phát');
      }
    }, POLL_MS);
    u.onstart = markStart;
    u.onend = () => finish('onend');
    u.onerror = (e) => {
      onError && onError(e.error || 'unknown');
      finish('lỗi');
    };
    if (synth.speaking || synth.pending) synth.cancel(); // câu cũ kẹt trong hàng đợi (Android) làm câu mới không phát
    synth.speak(u);
  });
}

export function cancel() {
  if (synth) synth.cancel();
}
