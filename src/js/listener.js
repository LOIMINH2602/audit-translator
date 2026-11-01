// Nghe liên tục bằng bộ nhận diện giọng nói của Chrome (Google). Đây là thứ DUY NHẤT trong app dùng micro — app không gọi
// getUserMedia (bài học 11/2026: mở thêm micro song song thì trên điện thoại bộ nhận diện chỉ nhận im lặng).
// continuous=true (01/11/2026): Chrome Android mới (mã nguồn 12/10/2026) giữ 1 phiên tới 5 phút, cắt câu bên trong — ít mở/huỷ
// phiên. Chrome cũ thì phiên vẫn hết sau mỗi câu như trước → mở phiên mới ngay. Mỗi phiên 1 đối tượng SpeechRecognition mới.
// Lỗi "network": Chrome Android gộp ERROR_NETWORK / NETWORK_TIMEOUT / SERVER của dịch vụ Google vào 1 mã (SpeechRecognitionImpl.java)
// — thường là lỗi tạm của máy chủ, không phải mất mạng → thử lại ngay (0,25s), lỗi liên tiếp mới chờ lâu dần.
// Phiên khởi động không xong sau START_TIMEOUT_MS, hoặc chạy mà STALL_MS không có sự kiện nào (Chrome bỏ qua một số lỗi của
// dịch vụ, vd. "quá nhiều yêu cầu" → phiên chết im lặng) → bỏ, tạo phiên mới.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = Boolean(SR);

const RESTART_MS = 120;
const START_TIMEOUT_MS = 3000;
const RETRY_MS = [250, 500, 1000, 2000]; // lỗi tạm liên tiếp lần 1, 2, 3, 4+
const STALL_MS = 30000;

// on: { interim(text), final(text), speechStart(), speechEnd(), start(), error(code), log(msg) }
export function createListener(on) {
  let rec = null;
  let lang = 'en-US';
  let want = false;
  let timer = null;
  let watchdog = null;
  let stall = null;
  let fails = 0; // lỗi tạm liên tiếp (reset khi có chữ)
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => {
      if (!want) return;
      log('phiên nhận diện ' + STALL_MS / 1000 + ' giây không có sự kiện nào → tạo phiên mới');
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
    r.continuous = true;
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
      fails = 0;
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
      timer = setTimeout(begin, RETRY_MS[Math.min(fails++, RETRY_MS.length - 1)]);
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
