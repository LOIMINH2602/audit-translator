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

// Trả về Promise resolve khi đọc xong (hoặc lỗi / quá thời gian dự phòng).
// onStart(msTừLúcGọi, voice) được gọi khi âm thanh thực sự bắt đầu — dùng đo độ trễ TTS.
export function speak(text, lang, { onStart } = {}) {
  return new Promise((resolve) => {
    if (!synth || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;

    const t0 = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    };
    // Chrome Android đôi khi không bắn onend: dự phòng theo độ dài câu.
    const guard = setTimeout(finish, Math.max(5000, text.length * 150));
    u.onstart = () => onStart && onStart(Math.round(performance.now() - t0), voice);
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

export function cancel() {
  if (synth) synth.cancel();
}
