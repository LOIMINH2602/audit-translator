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
// Mỗi phiên dùng 1 đối tượng SpeechRecognition MỚI, sự kiện của đối tượng cũ bị bỏ qua. Lý do: trên Android, phiên bị
// abort lúc đang khởi động có thể treo (không bao giờ bắn onend) → start() sau đó ném InvalidStateError mãi, mic chết.
// Thêm watchdog: gọi start mà START_TIMEOUT_MS không có onstart thì bỏ đối tượng đó, tạo cái mới, thử lại.
const START_TIMEOUT_MS = 2500;

// onSpeechEnd (tuỳ chọn): máy báo người nói đã dừng (VAD), thường sớm hơn final nhiều trên Android.
// onSpeechStart (tuỳ chọn): máy báo vừa có tiếng nói — sớm hơn chữ tạm vài trăm ms.
export function createRecognizer({ name, lang, track = null, continuous = true, onFinal, onInterim, onNoMatch, onStart, onSpeechStart, onSpeechEnd, onError, onLog }) {
  if (!SR) return null;
  let rec = null; // đối tượng của phiên hiện tại
  let curLang = lang;
  let want = false;
  let startedAt = 0;
  let quickEnds = 0;
  let timer = null;
  let watchdog = null;
  let sawText = false; // có chữ tạm chưa được final nào có chữ "tiêu thụ"
  let clone = null;
  const log = (m) => onLog && onLog(`[${name}] ${m}`);

  function discard() {
    if (!rec) return;
    const r = rec;
    rec = null;
    r.onstart = r.onresult = r.onerror = r.onend = r.onspeechend = r.onspeechstart = null;
    try { r.abort(); } catch (_) {}
    if (clone) clone.stop();
    clone = null;
  }

  function make() {
    const r = new SR();
    r.continuous = continuous;
    r.interimResults = true;
    r.lang = curLang;
    const live = () => r === rec;

    r.onstart = () => {
      if (!live()) return;
      clearTimeout(watchdog);
      startedAt = Date.now();
      log('start ' + r.lang);
      if (onStart) onStart();
    };

    r.onspeechend = () => {
      if (live() && onSpeechEnd) onSpeechEnd();
    };
    r.onspeechstart = () => {
      if (live() && onSpeechStart) onSpeechStart();
    };

    r.onresult = (e) => {
      if (!live()) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (res.isFinal) {
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

    r.onerror = (e) => {
      if (!live()) return;
      log('error ' + e.error);
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') want = false;
      onError(e.error);
    };

    r.onend = () => {
      if (!live()) return;
      log('end');
      clearTimeout(watchdog);
      rec = null;
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
      timer = setTimeout(() => want && begin(), quickEnds >= QUICK_END_LIMIT ? RESTART_BACKOFF_MS : RESTART_MS);
    };
    return r;
  }

  function begin() {
    discard();
    rec = make();
    const c = track ? track.clone() : null;
    try {
      if (c) rec.start(c);
      else rec.start();
      clone = c;
    } catch (e) {
      if (c) c.stop();
      log('start lỗi ' + e.name);
    }
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (!want) return;
      log('CẢNH BÁO: không khởi động được sau ' + START_TIMEOUT_MS / 1000 + ' giây → tạo phiên mới');
      begin();
    }, START_TIMEOUT_MS);
  }

  function halt(graceful) {
    want = false;
    sawText = false;
    clearTimeout(timer);
    clearTimeout(watchdog);
    if (!rec) return;
    if (graceful) {
      // stop(): vẫn nhận nốt final đang chờ; onend sẽ dọn
      try { rec.stop(); } catch (_) { discard(); }
    } else {
      discard();
    }
  }

  return {
    start() {
      want = true;
      clearTimeout(timer);
      begin();
    },
    // dừng hẳn, vẫn nhận nốt kết quả đang chờ
    stop() {
      halt(true);
    },
    // dừng ngay và bỏ kết quả đang chờ (TTS sắp phát / đổi lượt); sự kiện muộn của phiên cũ bị bỏ qua
    pause() {
      halt(false);
    },
    // bỏ phiên hiện tại (kể cả final đang chờ) và mở phiên mới ngay: dùng khi đã chốt câu bằng chữ tạm, để
    // không phải chờ Android trả final rồi mới nghe tiếp (người nói có thể nói tiếp ngay đoạn sau)
    restart() {
      if (!want) return;
      sawText = false;
      clearTimeout(timer);
      begin();
    },
    setLang(l) {
      curLang = l;
      sawText = false;
      // lang chỉ có hiệu lực ở phiên mới: nếu đang nghe thì mở phiên mới ngay
      if (want) begin();
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
