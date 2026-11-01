// Nghe liên tục bằng bộ nhận diện giọng nói của Chrome (Google). Đây là thứ DUY NHẤT trong app dùng micro — app không gọi
// getUserMedia (bài học 11/2026: mở thêm micro song song thì trên điện thoại bộ nhận diện chỉ nhận im lặng).
// Mỗi phiên 1 đối tượng SpeechRecognition mới (continuous=false — Android vốn chạy kiểu này); phiên hết thì mở phiên mới ngay.
// Phiên khởi động không xong sau START_TIMEOUT_MS (Android có khi treo) → bỏ, tạo phiên mới.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = Boolean(SR);

const RESTART_MS = 120;
const START_TIMEOUT_MS = 3000;
const BACKOFF_MS = 1500; // lỗi tạm (mạng, micro bận): chờ rồi thử lại

// on: { interim(text), final(text), speechStart(), speechEnd(), start(), error(code), log(msg) }
export function createListener(on) {
  let rec = null;
  let lang = 'en-US';
  let want = false;
  let timer = null;
  let watchdog = null;
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
      on.start && on.start();
    };
    r.onspeechstart = () => live() && on.speechStart && on.speechStart();
    r.onspeechend = () => live() && on.speechEnd && on.speechEnd();
    r.onresult = (e) => {
      if (!live()) return;
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
      timer = setTimeout(begin, BACKOFF_MS);
    };
    r.onend = () => {
      if (!live()) return;
      rec = null;
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
