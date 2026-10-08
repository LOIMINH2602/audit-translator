// Bọc Web Speech API (webkitSpeechRecognition) thành recognizer nghe liên tục, tự khởi động lại
// khi trình duyệt dừng do im lặng.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const supported = Boolean(SR);

const RESTART_MS = 250;
const RESTART_BACKOFF_MS = 1500; // khi bị ngắt liên tục ngay sau khi bật
const QUICK_END_MS = 800;
const QUICK_END_LIMIT = 3;

// track (tuỳ chọn): MediaStreamTrack micro dùng chung. Chrome chỉ cho 1 phiên nhận diện tự giữ micro
// (phiên mới huỷ phiên cũ — đã đo thật), nhưng phiên nhận audio qua track thì chạy song song được.
// continuous=false: mỗi câu 1 phiên, onend tự mở phiên mới. Đo thật: recognizer sai tiếng ít ra chữ rác hơn
// (thường trả rỗng) và tiếng Trung không gộp nhiều câu thành 1 final muộn. Android vốn chạy kiểu này.
// onNoMatch (tuỳ chọn): phiên đã nghe ra chữ tạm (interim) nhưng kết thúc không có final nào có chữ. Đo thật: đây là
// dấu hiệu rõ nhất của nghe sai tiếng (recognizer Anh/Trung/Nhật/Hàn nghe tiếng Việt thường kết thúc như vậy).
// Tiếng ồn thường không tạo ra chữ tạm nên không kích hoạt.
export function createRecognizer({ name, lang, track = null, continuous = true, onFinal, onInterim, onNoMatch, onError, onLog }) {
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.lang = lang;

  let want = false;
  let startedAt = 0;
  let quickEnds = 0;
  let timer = null;
  let sawText = false; // có chữ tạm chưa được final nào có chữ "tiêu thụ"
  const log = (m) => onLog && onLog(`[${name}] ${m}`);

  let clone = null;
  function safeStart() {
    const c = track ? track.clone() : null;
    try {
      if (c) rec.start(c);
      else rec.start();
      if (clone) clone.stop();
      clone = c;
    } catch (_) {
      // InvalidStateError: đã đang chạy
      if (c) c.stop();
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
        if (alt.transcript.trim()) sawText = false;
        onFinal(alt.transcript.trim(), alt.confidence || 0);
      } else {
        interim += alt.transcript;
      }
    }
    if (interim.trim()) sawText = true;
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
    if (clone) clone.stop();
    clone = null;
    const missed = sawText;
    sawText = false;
    if (!want) return;
    if (missed) {
      log('kết thúc không ra chữ (nghi nghe sai tiếng)');
      if (onNoMatch) onNoMatch();
    }
    // Nếu 2 recognizer giành mic, máy có thể chỉ cho 1 bên sống: bên kia bị ngắt ngay sau khi bật.
    quickEnds = Date.now() - startedAt < QUICK_END_MS ? quickEnds + 1 : 0;
    if (quickEnds === QUICK_END_LIMIT) log('CẢNH BÁO: bị ngắt liên tục ngay sau khi bật (có thể thiết bị không cho 2 recognizer chạy song song)');
    timer = setTimeout(() => want && safeStart(), quickEnds >= QUICK_END_LIMIT ? RESTART_BACKOFF_MS : RESTART_MS);
  };

  return {
    start() {
      want = true;
      clearTimeout(timer);
      const begin = Date.now();
      safeStart();
      // Không có sự kiện start sau 3 giây: recognizer này không khởi động được (thường do bị recognizer khác giành mic).
      setTimeout(() => want && startedAt < begin && log('CẢNH BÁO: không khởi động được sau 3 giây'), 3000);
    },
    // dừng hẳn, vẫn nhận nốt kết quả đang chờ
    stop() {
      want = false;
      sawText = false;
      clearTimeout(timer);
      try { rec.stop(); } catch (_) {}
    },
    // dừng và bỏ kết quả đang chờ (dùng khi TTS đang phát để mic không nghe lại chính nó)
    pause() {
      want = false;
      // phiên bị huỷ giữa câu: onend đến muộn (có khi sau start() kế tiếp) không được tính là "nghe sai tiếng"
      sawText = false;
      clearTimeout(timer);
      try { rec.abort(); } catch (_) {}
    },
    setLang(l) {
      rec.lang = l;
      sawText = false;
      // lang chỉ có hiệu lực ở lần start kế tiếp: nếu đang chạy thì abort để onend tự khởi động lại
      if (want) try { rec.abort(); } catch (_) {}
    },
  };
}

const PROBE_MS = 1500;

// Dò xem máy có chạy được 2 recognizer song song qua track micro không (chạy thật 1,5 giây).
// Trả về { parallel: true, track } hoặc { parallel: false, reason }. Khi false, micro đã được trả lại
// để recognizer 1 phiên tự giữ micro như thường.
export async function probeParallel(langA, langB) {
  if (!SR) return { parallel: false, reason: 'không có SpeechRecognition' };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { parallel: false, reason: 'không có getUserMedia' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    return { parallel: false, reason: 'getUserMedia lỗi ' + e.name, denied: e.name === 'NotAllowedError' };
  }
  const track = stream.getAudioTracks()[0];
  const st = [langA, langB].map((lang) => {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    const s = { r, lang, started: false, died: null, clone: track.clone() };
    r.onstart = () => (s.started = true);
    r.onerror = (e) => (s.died = s.died || 'error ' + e.error);
    r.onend = () => (s.died = s.died || 'end');
    return s;
  });
  try {
    for (const s of st) s.r.start(s.clone);
  } catch (e) {
    st.forEach((s) => s.clone.stop());
    stream.getTracks().forEach((t) => t.stop());
    return { parallel: false, reason: 'start(track) lỗi ' + e.name };
  }
  await new Promise((res) => setTimeout(res, PROBE_MS));
  const ok = st.every((s) => s.started && !s.died);
  const reason = st.map((s) => `${s.lang}: ${s.started ? 'chạy' : 'không chạy'}${s.died ? ', ' + s.died : ''}`).join('; ');
  for (const s of st) {
    s.r.onend = s.r.onerror = null;
    try { s.r.abort(); } catch (_) {}
    s.clone.stop();
  }
  await new Promise((res) => setTimeout(res, 300));
  if (ok) return { parallel: true, track, reason };
  stream.getTracks().forEach((t) => t.stop());
  return { parallel: false, reason };
}
