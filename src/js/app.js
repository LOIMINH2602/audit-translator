// Phiên Dịch Audit — nghe người nói tiếng Hàn / Nhật / Trung / Anh, hiện bản dịch tiếng Việt trên màn hình (chỉ chữ).
// Làm lại từ đầu 01/11/2026 theo yêu cầu duy nhất của Lợi Minh: dịch 1 chiều để hiểu người khác đang nói gì.
// Luồng: bộ nhận diện Chrome (listener.js) → chữ tạm hiện ngay + bản dịch tạm → tự chốt câu (segment.js) → bản dịch chốt.
// Phiên bản: đổi bằng `npm run bump` (đổi cả ?v= ở index.html và các import để máy không nạp lẫn file cũ / mới).

import { createListener, supported } from './listener.js?v=2026-11-02.4';
import { toVietnamese } from './translate.js?v=2026-11-02.4';
import { delta, sentenceCut, dropLastWord, isFragment, spaced } from './segment.js?v=2026-11-02.4';

export const VERSION = '2026-11-02.4';

const LANGS = { 'ko-KR': 'Hàn', 'ja-JP': 'Nhật', 'zh-CN': 'Trung', 'en-US': 'Anh' };
const LANG_KEY = 'dich.lang';
const STABLE_MS = 700; // chữ đứng yên chừng này = người nói ngừng → chốt câu
const SPEECHEND_MS = 350; // máy báo hết tiếng nói + chừng này không có chữ mới → chốt câu
const CUT_MS = 6000; // nói liền: từ 6 giây tìm chỗ hết câu để chốt
const HARD_MS = 9000; // nói liền 9 giây không thấy chỗ hết câu → cắt
const FRAGMENT_WAIT_MS = 1500; // mảnh 1 từ chờ ghép vào câu sau. Đo trên S22 (podcast Hàn thật 01/11): chờ 8s làm "그때부터", "공항에서" trễ 8,8s
const DRAFT_EVERY_MS = 500; // bản dịch tạm tối đa 2 lần/giây (gọi Google dày quá thì bị chặn)
const DRAFT_PAUSE_MS = 5000; // bản dịch tạm lỗi → nghỉ, để dành cho bản dịch chốt
const SILENT_WARN_MS = 6000; // đang nghe mà chừng này không ra chữ → tự chẩn đoán trên màn hình

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

// ---------- nhật ký (mục Chẩn đoán) ----------
const logLines = [];
function log(m) {
  const t = new Date().toLocaleTimeString('vi-VN');
  logLines.push(`${t} ${m}`);
  if (logLines.length > 400) logLines.shift();
  $('log').textContent = logLines.slice(-80).join('\n');
}

// ---------- trạng thái ----------
let lang = LANGS[read(LANG_KEY)] ? read(LANG_KEY) : 'ko-KR';
let running = false;
let done = ''; // phần chữ của phiên hiện tại đã chốt
let raw = ''; // nguyên chữ tạm của phiên
let interim = ''; // phần chữ mới chưa chốt
let interimAt = 0;
let firstAt = 0;
let onsetAt = 0;
let speechEndAt = 0;
let speechEndTimer = null;
let lastHealthMsg = ''; // lời báo tự chẩn đoán đang hiện
const resetInterim = () => { raw = ''; interim = ''; interimAt = 0; firstAt = 0; };
const health = { startedAt: 0, sessions: 0, speech: 0, text: 0, lastTextAt: 0, lastError: '', errorAt: 0 };
// Mở phiên nghe mới ngay sau mỗi câu chốt (mặc định). Android trả final muộn rồi mới mở phiên mới (~0,6s) → không mở ngay thì mất
// đầu câu sau (e2e 01/11, tiếng Hàn: có 88/73/89% — không 77/68/65%). Tắt để thử: localStorage 'dich.restart'='0'.
const restartAfterCommit = () => (read('dich.restart') ?? '1') === '1';
const NET_WARN_COUNT = 4; // lỗi network: chỉ báo khi ≥ chừng này lần trong NET_WARN_WINDOW_MS (mất mạng thật: thử lại 0,25–2s, hỏng liên tục)
const NET_WARN_WINDOW_MS = 10000; // lỗi lẻ tẻ (~8s/lần, test 01/11) không bao giờ chạm ngưỡng
const netErrors = []; // giờ các lần lỗi network gần đây
const ERROR_FRESH_MS = 15000; // lỗi mạng/micro chỉ được nêu nếu xảy ra trong chừng này (test thật 01/11: 1 lần mạng chập chờn,
// chữ vẫn ra bình thường, nhưng lúc người nói ngừng 6 giây app lại báo "không kết nối được" theo lỗi cũ)
function gotText() {
  health.text++;
  health.lastTextAt = now();
  health.lastError = '';
  if (lastHealthMsg && $('warn').textContent === lastHealthMsg) setWarn(''); // đã ra chữ lại: gỡ lời báo ngay
  lastHealthMsg = '';
}
const lat = { text: [], draft: [], final: [] };
const history = [];
window.__app = { lat, history, health, version: VERSION }; // cho bài test tự động đọc

function record(k, ms) {
  lat[k].push(Math.round(ms));
  if (lat[k].length > 40) lat[k].shift();
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const f = (ms) => (ms === null ? '–' : (ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + 's');
  // chỉ ghi nhật ký: mốc 'bắt đầu nói' của điện thoại có lúc đến SAU khi đã ra chữ → số ước tính có thể sai (test 01/11: 0,0s, thật 0,6s)
  if (k === 'final' && lat.final.length % 5 === 0) log(`độ trễ ước tính (trung vị): chữ ${f(med(lat.text))} · dịch tạm ${f(med(lat.draft))} · dịch chốt ${f(med(lat.final))}`);
}

function setStatus(text) { $('status').textContent = text; }
function setWarn(text) {
  $('warn').textContent = text || '';
  $('warn').hidden = !text;
}
function showLive(src, vi) {
  if (src !== null) $('liveSrc').textContent = src.length > 220 ? '…' + src.slice(-220) : src;
  if (vi !== null) $('liveVi').textContent = vi;
}

// ---------- nghe ----------
const listener = supported && createListener({
  start() {
    done = '';
    health.sessions++;
  },
  speechStart() {
    health.speech++;
    if (!onsetAt) onsetAt = now();
  },
  interim(t) {
    if (!running) return;
    clearTimeout(speechEndTimer); // còn chữ mới: người nói chưa dứt
    raw = t;
    const d = delta(t, done);
    if (!d || d === interim) return;
    const at = now();
    gotText();
    if (onsetAt) { record('text', at - onsetAt); onsetAt = 0; }
    speechEndAt = 0;
    if (!firstAt) firstAt = at;
    interim = d;
    interimAt = at;
    showLive(d, null);
    draft();
  },
  final(t) {
    if (!running) return;
    const d = delta(t, done);
    const end = speechEndAt || interimAt || now();
    done = t; // giữ cả câu final: máy có lặp lại nó ở kết quả sau thì delta bỏ đi
    resetInterim();
    if (d) {
      gotText();
      commit(d, end);
    }
  },
  // máy báo hết tiếng nói: chốt chữ tạm luôn, mở phiên mới ngay (Android chốt câu và đóng phiên muộn ~1,5s)
  speechEnd() {
    speechEndAt = now();
    if (interim && interim !== lastDraft.src) draft(true); // dứt lời: dịch câu này ngay, câu chốt sẽ dùng lại kết quả
    clearTimeout(speechEndTimer);
    speechEndTimer = setTimeout(() => {
      if (!running || !interim) return;
      const t = interim;
      const end = speechEndAt;
      if (restartAfterCommit()) {
        done = '';
        resetInterim();
        listener.restart();
      } else take(t);
      if (restartAfterCommit()) commit(t, end);
    }, SPEECHEND_MS);
  },
  error(code) {
    health.lastError = code;
    health.errorAt = now();
    if (!running) return;
    // phiên chết giữa câu: giữ phần đã nghe được, vẫn dịch (không để mất)
    if (interim) {
      const t = interim;
      const end = interimAt;
      done = '';
      resetInterim();
      commit(t, end);
    }
    if (code === 'network') {
      netErrors.push(now());
      while (netErrors.length && now() - netErrors[0] > NET_WARN_WINDOW_MS) netErrors.shift();
    }
    if (code === 'not-allowed') {
      if (document.hidden) return; // Android chặn nghe khi trang ẩn — hiện lại thì nghe tiếp (onVisible)
      micDenied().then((denied) => {
        if (denied) {
          stop();
          setWarn('Micro đang bị chặn cho trang này. Bấm biểu tượng ổ khoá cạnh địa chỉ → Quyền → Micro → Cho phép, rồi bấm Bắt đầu nghe.');
        } else {
          setTimeout(() => running && !document.hidden && listener.restart(), 800);
        }
      });
    } else if (code === 'service-not-allowed') {
      stop();
      setWarn('Trình duyệt này chặn nhận diện giọng nói. Mở link bằng Google Chrome (không mở trong Zalo / Facebook).');
    } else if (code === 'language-not-supported') {
      stop();
      setWarn(`Máy chưa hỗ trợ nhận diện tiếng ${LANGS[lang]}. Vào ứng dụng Google → Cài đặt → Giọng nói → Ngôn ngữ, thêm tiếng ${LANGS[lang]}.`);
    }
  },
  log,
});

async function micDenied() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state === 'denied'; } catch (_) { return false; }
}

// tự chốt câu khi người nói không ngừng / máy không chốt
setInterval(() => {
  if (!running || !interim) return;
  const t = now();
  if (t - interimAt >= STABLE_MS) {
    if (!restartAfterCommit()) return take(interim);
    const whole = interim;
    // chốt trọn phần đang nghe: mở phiên mới luôn (Android đóng phiên muộn → mất đầu câu sau)
    done = '';
    const end = interimAt;
    resetInterim();
    listener.restart();
    return commit(whole, end);
  }
  if (t - firstAt < CUT_MS) return;
  const cut = sentenceCut(interim, lang);
  if (cut) return take(cut);
  if (t - firstAt >= HARD_MS) take(dropLastWord(interim, lang));
}, 100);

// chốt phần đầu `text` của chữ đang nghe; phiên vẫn chạy, lần sau chỉ lấy phần mới
function take(text) {
  const end = interimAt;
  const rest = interim.slice(text.length).trim();
  done = rest ? raw.slice(0, raw.length - rest.length).trim() : raw;
  interim = rest;
  interimAt = firstAt = rest ? now() : 0;
  commit(text, end);
}

// ---------- dịch ----------
let fragment = '';
let fragmentTimer = null;
let shown = Promise.resolve(); // bản dịch chốt hiện đúng thứ tự câu
// bản dịch tạm gần nhất (kể cả đang dịch dở): câu chốt trùng chữ thì dùng luôn, không gọi dịch lại từ đầu
// (đo 01/11: Google dịch mất 0,4–1,8s mỗi lần — gọi lại làm bản dịch chốt chậm thêm chừng đó)
let lastDraft = { src: '', p: null };

function commit(text, endAt, force = false) {
  if (fragment) {
    text = fragment + (spaced(lang) ? ' ' : '') + text;
    fragment = '';
    clearTimeout(fragmentTimer);
  }
  if (isFragment(text, lang) && !force) {
    fragment = text;
    fragmentTimer = setTimeout(() => { if (fragment) { const f = fragment; fragment = ''; commit(f, endAt, true); } }, FRAGMENT_WAIT_MS);
    return;
  }
  const from = lang;
  const fresh = () => toVietnamese(text, from);
  const job = (text === lastDraft.src ? lastDraft.p.catch(fresh) : fresh()).catch((e) => {
    log('LỖI dịch: ' + (e.details || e.message));
    setWarn('Không dịch được câu vừa rồi (mạng chậm hoặc dịch vụ dịch bận). App vẫn đang nghe.');
    return null;
  });
  shown = shown.then(async () => {
    const vi = await job;
    if (vi === null || !running) return;
    const ms = now() - endAt;
    record('final', ms);
    history.push({ time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), lang: LANGS[from], src: text, vi, ms: Math.round(ms) });
    renderHistory();
    if (!interim) showLive(text, vi); // đang im lặng: khung trên giữ câu vừa dịch
    if ($('warn').textContent.startsWith('Không dịch được')) setWarn('');
  });
}

let draftBusy = false;
let draftAt = 0;
let draftPauseUntil = 0;
async function draft(now_ = false) {
  const t = now();
  if (!interim || t < draftPauseUntil) return;
  if (!now_ && (draftBusy || t - draftAt < DRAFT_EVERY_MS)) return;
  const src = interim;
  const srcAt = interimAt;
  draftBusy = true;
  draftAt = t;
  try {
    const p = toVietnamese(src, lang, { timeoutMs: 2500, googleOnly: true });
    lastDraft = { src, p };
    const vi = await p;
    if (interim && interim.startsWith(src.slice(0, Math.min(6, src.length)))) {
      showLive(null, vi);
      record('draft', now() - srcAt);
    }
  } catch (e) {
    draftPauseUntil = now() + DRAFT_PAUSE_MS;
    log('bản dịch tạm lỗi → nghỉ 5 giây: ' + (e.details || e.message));
  } finally {
    draftBusy = false;
  }
  if (interim && interim !== src) setTimeout(draft, Math.max(0, DRAFT_EVERY_MS - (now() - draftAt)));
}

function renderHistory() {
  const box = $('history');
  box.textContent = '';
  for (const x of history.slice().reverse()) {
    const div = document.createElement('div');
    div.className = 'entry';
    const vi = document.createElement('div');
    vi.className = 'vi';
    vi.textContent = x.vi;
    const src = document.createElement('div');
    src.className = 'src';
    src.textContent = x.src;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${x.time} · ${x.lang}`;
    div.append(vi, src, meta);
    box.appendChild(div);
  }
  $('copy').disabled = !history.length;
}

// ---------- tự chẩn đoán: đang nghe mà không ra chữ thì nói rõ kẹt ở đâu ----------
setInterval(() => {
  if (!running) return;
  const quiet = now() - (health.lastTextAt || health.startedAt);
  let msg = '';
  let err = now() - health.errorAt < ERROR_FRESH_MS ? health.lastError : '';
  if (err === 'network' && netErrors.filter((t) => now() - t < NET_WARN_WINDOW_MS).length < NET_WARN_COUNT) err = ''; // lỗi lẻ tẻ: đã tự nghe lại
  if (quiet >= SILENT_WARN_MS) {
    if (err === 'audio-capture') msg = 'Không lấy được tiếng từ micro: app khác đang dùng micro (gọi điện, ghi âm, Zalo). Tắt app đó rồi bấm Dừng → Bắt đầu nghe.';
    else if (err === 'network') msg = 'Không kết nối được dịch vụ nhận diện giọng nói của Google. Kiểm tra Wi-Fi / 4G.';
    else if (!health.sessions) msg = 'Bộ nhận diện giọng nói chưa khởi động được. Bấm Dừng → Bắt đầu nghe; vẫn lỗi thì đóng hẳn app và mở lại.';
    else if (!health.speech) msg = 'Micro chưa nghe thấy tiếng nói nào. Đặt điện thoại gần người nói hoặc gần loa hơn.';
    else if (!health.text) msg = `Micro có nghe thấy tiếng nhưng không ra chữ. Kiểm tra đã chọn đúng tiếng người đang nói (đang chọn: ${LANGS[lang]}).`;
  }
  if (msg === lastHealthMsg) return;
  if (msg) {
    log(`tự chẩn đoán: ${msg} (phiên ${health.sessions}, có tiếng ${health.speech}, ra chữ ${health.text}, lỗi cuối "${health.lastError}")`);
    setWarn(msg);
  } else if ($('warn').textContent === lastHealthMsg) setWarn(''); // đã ra chữ lại: gỡ lời báo của chính phần này
  lastHealthMsg = msg;
}, 1000);

// ---------- giữ màn hình sáng (màn hình tắt = Android ngừng nghe) ----------
let wake = null;
async function holdScreen(on) {
  try {
    if (on && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => (wake = null));
    } else if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (!running) return;
  if (document.hidden) {
    listener.stop();
    log('trang bị ẩn → tạm ngừng nghe');
  } else {
    log('trang hiện lại → nghe tiếp');
    holdScreen(true);
    listener.start(lang);
  }
});

// ---------- điều khiển ----------
function start() {
  if (!listener) return setWarn('Trình duyệt này không có nhận diện giọng nói. Mở link bằng Google Chrome.');
  setWarn('');
  lastHealthMsg = '';
  done = '';
  resetInterim();
  onsetAt = speechEndAt = 0;
  Object.assign(health, { startedAt: now(), sessions: 0, speech: 0, text: 0, lastTextAt: 0, lastError: '', errorAt: 0 });
  running = true;
  listener.start(lang);
  holdScreen(true);
  $('toggle').textContent = 'Dừng nghe';
  $('toggle').classList.add('on');
  setStatus(`Đang nghe tiếng ${LANGS[lang]}…`);
  showLive('', 'Đang nghe — bản dịch tiếng Việt sẽ hiện ở đây.');
  log(`bắt đầu nghe ${lang}`);
}

function stop() {
  running = false;
  if (listener) listener.stop();
  clearTimeout(speechEndTimer);
  holdScreen(false);
  $('toggle').textContent = 'Bắt đầu nghe';
  $('toggle').classList.remove('on');
  setStatus('Đã dừng');
  log('dừng nghe');
}

const chips = document.querySelectorAll('#langs button');
function paintChips() { chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.lang === lang))); }
chips.forEach((c) => {
  c.onclick = () => {
    lang = c.dataset.lang;
    write(LANG_KEY, lang);
    paintChips();
    done = '';
    resetInterim();
    if (running) {
      listener.setLang(lang);
      setStatus(`Đang nghe tiếng ${LANGS[lang]}…`);
    }
  };
});
paintChips();

$('toggle').onclick = () => (running ? stop() : start());
$('copy').onclick = () => copy(history.map((x) => `[${x.time} · ${x.lang}] ${x.src}\n→ ${x.vi}`).join('\n\n'), $('copy'));
$('copyLog').onclick = () => copy(`Phiên Dịch Audit ${VERSION}\n${navigator.userAgent}\n` + logLines.join('\n'), $('copyLog'));
$('clear').onclick = () => { history.length = 0; renderHistory(); };

function copy(text, btn) {
  const label = btn.textContent;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => (btn.textContent = 'Đã chép'))
    .catch(() => (btn.textContent = 'Không chép được'))
    .finally(() => setTimeout(() => (btn.textContent = label), 1500));
}

// mở trong Zalo / Facebook / WebView: không có nhận diện giọng nói đầy đủ
const ua = navigator.userAgent;
if (/; wv\)|\bZalo\b|FBAN|FBAV|Instagram|\bLine\//.test(ua) || (/Android/.test(ua) && /Version\/[\d.]+ Chrome/.test(ua))) {
  setWarn('Bạn đang mở trong trình duyệt của app khác (Zalo, Facebook…). Sao chép link rồi mở bằng Google Chrome.');
} else if (!supported) {
  setWarn('Trình duyệt này không có nhận diện giọng nói. Mở link bằng Google Chrome.');
}

$('version').textContent = 'Bản ' + VERSION;
$('toggle').disabled = false;
$('toggle').textContent = 'Bắt đầu nghe';
log('app sẵn sàng · ' + ua);
window.__appReady = VERSION;

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
