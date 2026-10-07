// Bọc Web Speech API (webkitSpeechRecognition) thành recognizer nghe liên tục, tự khởi động lại
// khi trình duyệt dừng do im lặng.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supported = Boolean(SR);

const RESTART_MS = 250;
const RESTART_BACKOFF_MS = 1500; // khi bị ngắt liên tục ngay sau khi bật
const QUICK_END_MS = 800;
const QUICK_END_LIMIT = 3;

export function createRecognizer({ name, lang, onFinal, onInterim, onError, onLog }) {
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = lang;

  let want = false;
  let startedAt = 0;
  let quickEnds = 0;
  let timer = null;
  const log = (m) => onLog && onLog(`[${name}] ${m}`);

  function safeStart() {
    try {
      rec.start();
    } catch (_) {
      // InvalidStateError: đã đang chạy
    }
  }

  rec.onstart = () => {
    startedAt = Date.now();
    log('start ' + rec.lang);
  };

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const alt = r[0];
      if (r.isFinal) {
        log(`final "${alt.transcript.trim()}" conf=${(alt.confidence || 0).toFixed(2)}`);
        onFinal(alt.transcript.trim(), alt.confidence || 0);
      } else {
        interim += alt.transcript;
      }
    }
    if (interim && onInterim) onInterim(interim);
  };

  rec.onerror = (e) => {
    log('error ' + e.error);
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') want = false;
    onError(e.error);
  };

  rec.onend = () => {
    log('end');
    if (!want) return;
    // Nếu 2 recognizer giành mic, máy có thể chỉ cho 1 bên sống: bên kia bị ngắt ngay sau khi bật.
    quickEnds = Date.now() - startedAt < QUICK_END_MS ? quickEnds + 1 : 0;
    if (quickEnds === QUICK_END_LIMIT) log('CẢNH BÁO: bị ngắt liên tục ngay sau khi bật (có thể thiết bị không cho 2 recognizer chạy song song)');
    timer = setTimeout(() => want && safeStart(), quickEnds >= QUICK_END_LIMIT ? RESTART_BACKOFF_MS : RESTART_MS);
  };

  return {
    start() {
      want = true;
      clearTimeout(timer);
      safeStart();
    },
    // dừng hẳn, vẫn nhận nốt kết quả đang chờ
    stop() {
      want = false;
      clearTimeout(timer);
      try { rec.stop(); } catch (_) {}
    },
    // dừng và bỏ kết quả đang chờ (dùng khi TTS đang phát để mic không nghe lại chính nó)
    pause() {
      want = false;
      clearTimeout(timer);
      try { rec.abort(); } catch (_) {}
    },
    setLang(l) {
      rec.lang = l;
      // lang chỉ có hiệu lực ở lần start kế tiếp: nếu đang chạy thì abort để onend tự khởi động lại
      if (want) try { rec.abort(); } catch (_) {}
    },
  };
}
