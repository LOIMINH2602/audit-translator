// Đọc to bản dịch. 2 cách:
//   'system': speechSynthesis của trình duyệt (giọng cài trong máy).
//   'google': file âm thanh của Google Dịch (translate_tts) phát bằng <audio>.
// Lý do có 'google' (08/10/2026): Lợi Minh báo chiều Việt → tiếng nước ngoài rất chậm. Mã nguồn Chrome Android
// (TtsPlatformImpl.java) gọi TextToSpeech.setLanguage() mỗi khi câu đọc đổi tiếng so với câu trước — hội thoại 1:1
// đổi tiếng ở mọi câu, và giọng nước ngoài chưa tải về máy thì Google TTS phải tổng hợp qua mạng. Đo từ trang live:
// file Google Dịch bắt đầu phát sau ~0,2–0,45 giây (cần trang không gửi Referer — có <meta name="referrer"> ở index.html,
// gửi Referer thì Google trả 404).
// Chế độ 'auto' (mặc định): đo độ trễ giọng máy cho từng tiếng (đọc thử không tiếng khi bấm Bắt đầu, và mỗi câu);
// chậm hơn SLOW_MS hoặc không phát được → tiếng đó chuyển sang 'google' và nhớ lại; Google lỗi → quay về giọng máy.

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;

export const supported = Boolean(synth) || typeof Audio !== 'undefined';

const MODE_KEY = 'audit.ttsEngine'; // 'auto' | 'system' | 'google'
const AUTO_KEY = 'audit.ttsAuto.v1'; // { 'en-US': 'google', 'vi-VN': 'system', ... } kết quả đo của chế độ auto
const SLOW_MS = 900;
const POLL_MS = 100;
const NO_START_MS = 4000; // giọng máy không phát được: đừng giữ mic tắt lâu
const GOOGLE_START_MS = 2500; // file Google chưa phát được sau chừng này → coi như lỗi, dùng giọng máy
const GOOGLE_CHUNK = 180; // translate_tts nhận tối đa ~200 ký tự mỗi lần

const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

let mode = read(MODE_KEY) || 'auto';
let auto = {};
try { auto = JSON.parse(read(AUTO_KEY) || '{}') || {}; } catch (_) { auto = {}; }
let log = () => {};
let current = null; // <audio> đang phát (để cancel)
// Google Dịch vừa lỗi (mất mạng / bị chặn): GOOGLE_COOLDOWN_MS không chuyển tiếng nào sang Google nữa, tránh lặp
// "Google lỗi → giọng máy chậm → lại Google" mà câu nào cũng chịu cả 2 lần chờ.
const GOOGLE_COOLDOWN_MS = 5 * 60 * 1000;
let googleFailedAt = -Infinity;
const googleCooling = () => performance.now() - googleFailedAt < GOOGLE_COOLDOWN_MS;

export function setTtsLog(fn) { log = fn; }
export function getMode() { return mode; }
export function setMode(m) {
  mode = m;
  write(MODE_KEY, m);
}
export function resetAuto() {
  auto = {};
  write(AUTO_KEY, '{}');
}

// Cách đọc sẽ dùng cho 1 tiếng.
export function engineFor(lang) {
  if (!synth) return 'google';
  if (mode === 'system' || mode === 'google') return mode;
  return auto[lang] || 'system';
}

function remember(lang, engine, why) {
  if (auto[lang] === engine) return;
  if (engine === 'google' && googleCooling()) return; // Google vừa lỗi: giữ giọng máy dù chậm
  auto[lang] = engine;
  write(AUTO_KEY, JSON.stringify(auto));
  log(`Giọng đọc ${lang} → ${engine === 'google' ? 'Google Dịch (mạng)' : 'giọng máy'}: ${why}`);
}

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

// Có cách đọc được tiếng này không (giọng máy có giọng, hoặc dùng Google).
export function canSpeak(lang) {
  return engineFor(lang) === 'google' || Boolean(pickVoice(lang));
}

// Giọng có thể nạp trễ: gọi cb mỗi khi danh sách giọng thay đổi.
export function onVoicesChanged(cb) {
  if (synth) synth.addEventListener('voiceschanged', cb);
}

// Thời lượng đọc tối đa ước theo độ dài câu: Hán/kana/Hangul ~0,3 giây/ký tự, chữ Latin ~0,09 giây/ký tự.
export function maxSpeakMs(text) {
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  return 2500 + cjk * 300 + (text.length - cjk) * 90;
}

// ---------- giọng máy ----------
// Chrome Android hay không bắn onend → theo dõi speechSynthesis.speaking: đã nói rồi mà hết nói là xong.
// Trả về { startMs (đo bằng onstart thật, null nếu không có), played, how }.
function speakSystem(text, lang, { rate = 1, volume = 1, onStart, onRealStart } = {}) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    u.volume = volume;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;

    const t0 = performance.now();
    let done = false;
    let startMs = null; // từ sự kiện onstart thật — dùng để đo
    let started = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(guard);
      resolve({ startMs, played: started, how });
    };
    const markStart = (real) => {
      if (real && startMs === null) {
        startMs = Math.round(performance.now() - t0);
        if (onRealStart) onRealStart(startMs);
      }
      if (started) return;
      started = true;
      if (onStart) onStart(Math.round(performance.now() - t0), voice ? voice.name : 'giọng máy');
    };
    const guard = setTimeout(() => finish('hết giờ'), maxSpeakMs(text) / Math.min(rate, 1));
    const poll = setInterval(() => {
      const ms = performance.now() - t0;
      if (synth.speaking && !synth.pending) {
        if (!started && ms > 300) markStart(false); // Android có khi không bắn onstart
      } else if (started && !synth.speaking) {
        finish('dò');
      } else if (!started && ms > NO_START_MS) {
        finish('không phát');
      }
    }, POLL_MS);
    u.onstart = () => markStart(true);
    u.onend = () => finish('onend');
    u.onerror = (e) => {
      if (volume > 0) log(`LỖI giọng máy ${lang}: ${e.error || 'unknown'}`); // câu đọc thử bị câu thật cắt: bình thường
      finish('lỗi');
    };
    if (synth.speaking || synth.pending) synth.cancel(); // câu cũ kẹt trong hàng đợi (Android) làm câu mới không phát
    synth.speak(u);
  });
}

// ---------- Google Dịch ----------
function chunks(text) {
  const out = [];
  let rest = text.trim();
  while (rest.length > GOOGLE_CHUNK) {
    const head = rest.slice(0, GOOGLE_CHUNK);
    // cắt ở dấu câu hoặc khoảng trắng gần cuối nhất
    const m = Math.max(...['。', '！', '？', '. ', '! ', '? ', '，', ', ', '、', ' '].map((p) => head.lastIndexOf(p)));
    const cut = m > GOOGLE_CHUNK / 3 ? m + 1 : GOOGLE_CHUNK;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const gUrl = (q, lang) =>
  `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang === 'zh-CN' ? 'zh-CN' : lang.split('-')[0]}&q=${encodeURIComponent(q)}`;

// Trả về { startMs (null nếu không phát được), how }.
function speakGoogle(text, lang, { rate = 1, onStart } = {}) {
  return new Promise((resolve) => {
    const parts = chunks(text);
    const t0 = performance.now();
    let startMs = null;
    let done = false;
    let i = 0;
    let next = null;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearTimeout(startGuard);
      clearTimeout(guard);
      if (current) current.pause();
      current = null;
      resolve({ startMs, how });
    };
    const load = (k) => {
      const a = new Audio();
      a.preload = 'auto';
      a.defaultPlaybackRate = rate; // Chrome đặt lại playbackRate về default mỗi lần nạp file
      a.src = gUrl(parts[k], lang);
      return a;
    };
    const playPart = (a) => {
      current = a;
      a.playbackRate = rate;
      a.onplaying = () => {
        a.playbackRate = rate;
        if (startMs === null) {
          startMs = Math.round(performance.now() - t0);
          clearTimeout(startGuard);
          if (onStart) onStart(startMs, 'Google Dịch (mạng)');
        }
        if (i + 1 < parts.length && !next) next = load(i + 1); // tải trước đoạn sau
      };
      a.onended = () => {
        i++;
        if (i >= parts.length) return finish('hết file');
        const n = next || load(i);
        next = null;
        playPart(n);
      };
      a.onerror = () => {
        log(`LỖI Google Dịch đọc ${lang}: mã ${a.error ? a.error.code : '?'}`);
        finish(startMs === null ? 'lỗi' : 'lỗi giữa chừng');
      };
      a.play().catch((e) => {
        log(`LỖI Google Dịch play ${lang}: ${e.name}`);
        finish('lỗi');
      });
    };
    const startGuard = setTimeout(() => startMs === null && finish('không phát'), GOOGLE_START_MS);
    const guard = setTimeout(() => finish('hết giờ'), maxSpeakMs(text) / Math.min(rate, 1) + GOOGLE_START_MS);
    playPart(load(0));
  });
}

// ---------- chung ----------
// Trả về Promise resolve khi đọc xong (hoặc lỗi / quá thời gian dự phòng).
// onStart(msTừLúcGọi, tênGiọng) khi âm thanh thực sự bắt đầu; onEnd(msTừLúcGọi, cách kết thúc).
export async function speak(text, lang, { rate = 1, onStart, onError, onEnd } = {}) {
  if (!text) return;
  const t0 = performance.now();
  const end = (how) => onEnd && onEnd(Math.round(performance.now() - t0), how);
  let engine = engineFor(lang);
  // Trang bị ẩn (tắt màn hình, chuyển app): Chrome không tải <audio> → dùng giọng máy luôn, không chờ hết giờ.
  if (engine === 'google' && synth && document.visibilityState === 'hidden') {
    engine = 'system';
    log(`Trang đang ẩn → đọc ${lang} bằng giọng máy`);
  }

  if (engine === 'google') {
    const r = await speakGoogle(text, lang, { rate, onStart });
    if (r.startMs !== null) return end(r.how);
    if (onError) onError('google ' + r.how);
    googleFailedAt = performance.now();
    if (!synth) return end(r.how);
    if (mode === 'auto') remember(lang, 'system', 'Google Dịch không phát được');
    engine = 'system'; // đọc lại câu này bằng giọng máy
  }

  const r = await speakSystem(text, lang, { rate, onStart });
  if (mode === 'auto' && document.visibilityState !== 'hidden') {
    if (!r.played) {
      if (onError) onError('giọng máy ' + r.how);
      if (googleCooling()) return end(r.how);
      remember(lang, 'google', `giọng máy không phát (${r.how})`);
      const g = await speakGoogle(text, lang, { rate, onStart }); // đọc lại câu này bằng Google
      if (g.startMs === null) googleFailedAt = performance.now();
      return end(g.how);
    }
    if (r.startMs !== null && r.startMs > SLOW_MS) remember(lang, 'google', `giọng máy bắt đầu sau ${r.startMs}ms`);
  }
  end(r.how);
}

// Đọc thử không tiếng để đo độ trễ giọng máy của 1 tiếng (chế độ auto, chưa đo lần nào) và nạp sẵn giọng.
const WARM_TEXT = { 'vi-VN': 'xin chào', 'en-US': 'hello', 'zh-CN': '你好', 'ja-JP': 'こんにちは', 'ko-KR': '안녕하세요' };
// Kết luận ngay khi giọng máy bắt đầu phát (onstart), chậm nhất ở mốc SLOW_MS (chưa phát = chậm), nên bấm Bắt đầu
// chỉ chờ thêm tối đa ~0,9 giây. Câu đọc thử không tiếng (volume 0) được đọc nốt ở nền, không ảnh hưởng gì.
export async function warmUp(lang) {
  if (mode !== 'auto' || auto[lang] || !synth) return;
  const r = await new Promise((res) => {
    const timer = setTimeout(() => res({ slow: true }), SLOW_MS);
    speakSystem(WARM_TEXT[lang] || 'hello', lang, {
      volume: 0,
      onRealStart: (ms) => { clearTimeout(timer); res({ ms }); },
    }).then((x) => { clearTimeout(timer); res(x.played ? { ms: x.startMs, how: x.how } : { fail: x.how }); });
  });
  if (r.slow) {
    synth.cancel(); // câu đọc thử chưa phát: huỷ để không chen vào câu thật
    remember(lang, 'google', `đọc thử chưa bắt đầu sau ${SLOW_MS}ms`);
  } else if (r.fail) {
    remember(lang, 'google', `đọc thử không phát (${r.fail})`);
  } else {
    // r.ms null: đọc xong trước SLOW_MS mà máy không báo onstart → vẫn là nhanh
    remember(lang, 'system', `đọc thử bắt đầu sau ${r.ms == null ? '<' + SLOW_MS : r.ms}ms`);
  }
}

export function cancel() {
  if (synth) synth.cancel();
  if (current) current.pause();
  current = null;
}

export function isSpeaking() {
  return Boolean((synth && synth.speaking) || (current && !current.paused));
}
