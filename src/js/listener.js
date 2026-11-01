// Nghe liên tục bằng bộ nhận diện giọng nói của Chrome (Google). Đây là thứ DUY NHẤT trong app dùng micro — app không gọi
// getUserMedia (bài học 11/2026: mở thêm micro song song thì trên điện thoại bộ nhận diện chỉ nhận im lặng).
// KHÔI PHỤC 02/11/2026 đúng bản 2026-11-01.3 (bản chạy được trên điện thoại Lợi Minh). Bản .4/.5 thử lại sau 0,25s khi lỗi →
// điện thoại báo lỗi micro, không dịch (Chrome Android: bộ nhận diện còn bận = not-allowed, micro chưa nhả = audio-capture).
// KHÔNG đổi file này nếu chưa thử trên điện thoại thật. Không dùng continuous=true (Chrome Android cũ lặp lại chữ đã chốt).
// Mỗi phiên 1 đối tượng SpeechRecognition mới (continuous=false — Android vốn chạy kiểu này); phiên hết thì mở phiên mới ngay.
// Phiên khởi động không xong sau START_TIMEOUT_MS (Android có khi treo) → bỏ, tạo phiên mới.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = Boolean(SR);

const RESTART_MS = 120;
const START_TIMEOUT_MS = 3000;
const BACKOFF_MS = 1500; // lỗi tạm (mạng, micro bận): chờ rồi thử lại
// Phiên treo: đo trên S22 Ultra của Lợi Minh 01/11/2026 (gỡ lỗi USB): mạng 4G mất 1 nhịp (GRPC 14) + chưa có gói tiếng Hàn offline
// → dịch vụ giọng nói Google mở micro cho phiên mới rồi treo, không bắn kết quả / lỗi / kết thúc nào → app "Đang nghe" mà chết hẳn.
// Phiên bình thường (kể cả im lặng) luôn kết thúc trong ~5–8s → STALL_MS không có sự kiện nào = treo → bỏ, tạo phiên mới.
const STALL_MS = 15000;

// on: { interim(text), final(text), speechStart(), speechEnd(), start(), error(code), log(msg) }
export function createListener(on) {
  let rec = null;
  let lang = 'en-US';
  let want = false;
  let timer = null;
  let watchdog = null;
  let stall = null;
  // gọi mỗi khi phiên có động tĩnh: dời hạn "treo"
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => {
      if (!want) return;
      log('phiên nhận diện ' + STALL_MS / 1000 + ' giây không có động tĩnh (treo) → tạo phiên mới');
      on.stall && on.stall();
      begin();
    }, STALL_MS);
  };
  const log = (m) => on.log && on.log(m);

  function discard() {
    if (!rec) return;
    const r = rec;
    rec = null;
    r.onstart = r.onresult = r.onerror = r.onend = r.onspeechstart = r.onspeechend = null;
    try { r.abort(); } catch (_) {}
  }

  function begin() {
    clearTimeout(timer);
    clearTimeout(watchdog);
    clearTimeout(stall);
    discard();
    if (!want) return;
    const r = new SR();
    rec = r;
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    const live = () => r === rec;
    r.onstart = () => {
      if (!live()) return;
      clearTimeout(watchdog);
      alive();
      on.start && on.start();
    };
    r.onspeechstart = () => { if (live()) { alive(); on.speechStart && on.speechStart(); } };
    r.onspeechend = () => { if (live()) { alive(); on.speechEnd && on.speechEnd(); } };
    r.onresult = (e) => {
      if (!live()) return;
      alive();
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) on.final(res[0].transcript.trim());
        else interim += res[0].transcript;
      }
      if (interim.trim()) on.interim(interim.trim());
    };
    r.onerror = (e) => {
      if (!live()) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return; // bình thường: im lặng / tự huỷ
      log('lỗi nhận diện: ' + e.error);
      on.error && on.error(e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
        // không tự thử lại liên tục — app quyết định (trang ẩn thì chờ hiện lại)
        rec = null;
        return;
      }
      rec = null;
      clearTimeout(stall);
      timer = setTimeout(begin, BACKOFF_MS);
    };
    r.onend = () => {
      if (!live()) return;
      rec = null;
      clearTimeout(stall);
      timer = setTimeout(begin, RESTART_MS);
    };
    try {
      r.start();
    } catch (e) {
      log('start lỗi ' + e.name);
    }
    watchdog = setTimeout(() => {
      if (!want || !live()) return;
      log('phiên nhận diện không khởi động sau 3 giây → tạo phiên mới');
      begin();
    }, START_TIMEOUT_MS);
  }

  return {
    start(l) {
      lang = l;
      want = true;
      begin();
    },
    stop() {
      want = false;
      clearTimeout(timer);
      clearTimeout(watchdog);
      clearTimeout(stall);
      discard();
    },
    // bỏ phiên hiện tại, mở phiên mới ngay (đã tự chốt câu bằng chữ tạm, không chờ máy chốt)
    restart() {
      if (want) begin();
    },
    setLang(l) {
      lang = l;
      if (want) begin();
    },
    running: () => want,
  };
}
