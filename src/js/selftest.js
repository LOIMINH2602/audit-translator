// Tab "Tự kiểm tra": chạy toàn bộ phép thử trên máy người dùng, tự chấm đúng/sai, xuất báo cáo tiếng Việt
// để gửi lại. Người dùng không cần tự đánh giá hay mô tả lỗi.
//   Phần 1 (tự động): môi trường, 2 recognizer chạy song song, dịch 8 chiều, giọng đọc 5 tiếng.
//   Phần 2 (đọc to): 6 câu mẫu; app biết câu đúng nên tự chấm bên nào nghe đúng, chế độ phân xử nào chọn đúng.

import { $, copyText } from './ui.js';
import { NAMES, SAMPLES, TEST_PROMPTS, APP_VERSION } from './config.js';
import { createRecognizer, supported as srSupported } from './recognizer.js';
import { translate } from './translate.js';
import { pickVoice, voices, speak, supported as ttsSupported } from './tts.js';
import { judge, similarity } from './scoring.js';
import { isInAppBrowser } from './env.js';
import { diag, recentLog } from './diagnostics.js';

const ICON = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANGS = ['vi-VN', 'en-US', 'zh-CN', 'ja-JP', 'ko-KR'];

let lines = []; // { level, text } — nguyên liệu của báo cáo
let issues = []; // kết luận bằng lời thường, hiện đầu báo cáo

function add(level, text) {
  lines.push({ level, text });
  const div = document.createElement('div');
  div.className = 'st-line ' + level;
  div.textContent = `${ICON[level]} ${text}`;
  $('stList').appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
}

function issue(text) {
  issues.push(text);
}

// Hỏi người dùng 1 câu có nút trả lời; trả về chỉ số nút đã bấm.
function ask(question, options) {
  return new Promise((resolve) => {
    const box = $('stAsk');
    box.textContent = '';
    const q = document.createElement('div');
    q.className = 'st-q';
    q.textContent = question;
    const row = document.createElement('div');
    row.className = 'row';
    options.forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (i === 0) b.className = 'primary';
      b.onclick = () => {
        box.textContent = '';
        resolve(i);
      };
      row.appendChild(b);
    });
    box.append(q, row);
    box.scrollIntoView({ block: 'nearest' });
  });
}

function showStatus(text) {
  const box = $('stAsk');
  box.textContent = '';
  const q = document.createElement('div');
  q.className = 'st-q';
  q.textContent = text;
  box.appendChild(q);
}

// ---------- Phần 1: tự động ----------

function checkEnvironment() {
  const ua = navigator.userAgent;
  add('info', 'Thiết bị: ' + ua);
  if (isInAppBrowser(ua)) {
    add('bad', 'Đang mở trong trình duyệt của app khác (Zalo/Facebook/WebView), không phải Chrome.');
    issue('Bạn đang mở trong trình duyệt của app khác. Hãy sao chép link, dán vào Google Chrome rồi làm lại bài kiểm tra này.');
  } else {
    add('ok', 'Đang mở trong trình duyệt thật.');
  }
  add(srSupported ? 'ok' : 'bad', srSupported ? 'Trình duyệt hỗ trợ nhận diện giọng nói.' : 'Trình duyệt KHÔNG hỗ trợ nhận diện giọng nói.');
  if (!srSupported) issue('Trình duyệt không hỗ trợ nhận diện giọng nói: phải dùng Google Chrome.');
  add(ttsSupported ? 'ok' : 'bad', ttsSupported ? 'Trình duyệt hỗ trợ đọc to (TTS).' : 'Trình duyệt KHÔNG hỗ trợ đọc to.');
  add(window.isSecureContext ? 'ok' : 'bad', window.isSecureContext ? 'Trang chạy qua HTTPS.' : 'Trang không chạy qua HTTPS, micro sẽ bị chặn.');
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  add('info', standalone ? 'Đang chạy như app cài trên màn hình chính.' : 'Đang chạy trong tab trình duyệt (chưa cài vào màn hình chính).');
}

async function checkMicPermission() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    add(p.state === 'denied' ? 'bad' : 'info', 'Quyền micro: ' + p.state);
    if (p.state === 'denied') issue('Micro đang bị chặn. Chrome → biểu tượng ổ khóa cạnh địa chỉ → Quyền → Micro → Cho phép.');
  } catch (_) {
    add('info', 'Không đọc được trạng thái quyền micro.');
  }
}

// 2 recognizer start cùng lúc trên cùng mic, xem cả hai có sống không.
// Trả về true nếu recognizer không dùng được (micro/mạng hỏng) — khi đó bỏ qua bài đọc câu mẫu.
async function checkDualRecognizers(partnerLang) {
  if (!srSupported) return true;
  showStatus('Đang thử mở 2 recognizer cùng lúc (4 giây)...');
  const ev = { vi: [], partner: [] };
  const mk = (side, lang) =>
    createRecognizer({
      name: side,
      lang,
      onFinal: () => {},
      onError: (e) => ev[side].push('error ' + e),
      onLog: (m) => ev[side].push(m),
    });
  const a = mk('partner', partnerLang);
  const b = mk('vi', 'vi-VN');
  a.start();
  b.start();
  await sleep(4000);
  a.stop();
  b.stop();
  await sleep(400);

  const started = (s) => ev[s].some((m) => / start /.test(m));
  const ends = (s) => ev[s].filter((m) => / end$/.test(m)).length;
  const denied = [...ev.vi, ...ev.partner].some((m) => /not-allowed|service-not-allowed/.test(m));
  const sv = started('vi');
  const sp = started('partner');
  const all = [...ev.vi, ...ev.partner].join(' ');
  if (denied) {
    add('bad', 'Micro bị từ chối khi thử nhận diện.');
    issue('Chưa cho phép micro cho trang này.');
  } else if (/audio-capture/.test(all)) {
    add('bad', 'Chrome không lấy được tiếng từ micro (lỗi audio-capture).');
    issue('Chrome không lấy được tiếng từ micro. Kiểm tra: micro đang bị app khác chiếm (cuộc gọi, ghi âm, Zalo/Messenger đang mở micro), hoặc tai nghe Bluetooth đang ở chế độ chỉ phát nhạc không có micro. Thử rút/ngắt tai nghe và dùng micro máy.');
  } else if (/error network/.test(all)) {
    add('bad', 'Không kết nối được dịch vụ nhận diện giọng nói của Google (lỗi network).');
    issue('Điện thoại không kết nối được dịch vụ nhận diện giọng nói của Google. Kiểm tra mạng Wi-Fi/4G.');
  } else if (/language-not-supported/.test(all)) {
    add('bad', 'Máy chưa hỗ trợ nhận diện một trong các ngôn ngữ (lỗi language-not-supported).');
    issue(`Máy chưa hỗ trợ nhận diện tiếng Việt hoặc tiếng ${NAMES[partnerLang]}. Cài đặt → Ứng dụng → Google → Giọng nói / Nhận diện giọng nói → Ngôn ngữ → tải thêm.`);
  } else if (sv && sp && ends('vi') < 3 && ends('partner') < 3) {
    add('ok', `Cả 2 recognizer (Việt + ${NAMES[partnerLang]}) cùng khởi động và chạy ổn định.`);
  } else if (sv && sp) {
    add('warn', `Cả 2 recognizer khởi động nhưng bị ngắt liên tục (Việt ${ends('vi')} lần, ${NAMES[partnerLang]} ${ends('partner')} lần trong 4 giây).`);
    issue('Hai recognizer giành mic và ngắt nhau liên tục: tự nhận diện người nói sẽ không ổn định.');
  } else {
    add('bad', `Chỉ ${sv ? 'recognizer Việt' : sp ? 'recognizer ' + NAMES[partnerLang] : 'không recognizer nào'} khởi động được (Việt: ${sv ? 'có' : 'KHÔNG'}, ${NAMES[partnerLang]}: ${sp ? 'có' : 'KHÔNG'}).`);
    issue('Máy chỉ cho 1 recognizer chạy tại một thời điểm: cách tự nhận diện người nói bằng 2 recognizer không dùng được. Cần chuyển sang 1 recognizer + nút chọn chiều nói.');
  }
  diag('SELFTEST dual: ' + JSON.stringify(ev));
  return denied || /audio-capture|error network|language-not-supported/.test(all);
}

async function checkTranslation() {
  showStatus('Đang thử dịch 8 chiều...');
  const pairs = LANGS.filter((l) => l !== 'vi-VN').flatMap((l) => [[l, 'vi-VN'], ['vi-VN', l]]);
  const results = await Promise.all(
    pairs.map(async ([from, to]) => {
      const src = SAMPLES[from];
      try {
        const r = await translate(src, from, to);
        const same = similarity(src, r.text) > 0.9;
        return { from, to, ok: !same && Boolean(r.text), r };
      } catch (e) {
        return { from, to, ok: false, err: e.details || e.message };
      }
    })
  );
  const bad = [];
  for (const x of results) {
    const label = `${NAMES[x.from]}→${NAMES[x.to]}`;
    if (x.ok) add('ok', `Dịch ${label}: ${x.r.ms}ms (${x.r.engine}) "${x.r.text}"`);
    else {
      add('bad', `Dịch ${label} lỗi: ${x.err || 'kết quả trống hoặc giống hệt câu gốc'}`);
      bad.push(label);
    }
  }
  const slow = results.filter((x) => x.ok && x.r.ms > 3000).length;
  if (bad.length) issue('Dịch lỗi ở chiều: ' + bad.join(', ') + '. Kiểm tra kết nối mạng của điện thoại.');
  if (slow) issue(`${slow} chiều dịch chậm hơn 3 giây.`);
}

async function checkTts() {
  if (!ttsSupported) return;
  add('info', `Số giọng đọc máy liệt kê: ${voices().length}`);
  const missing = [];
  for (const lang of LANGS) {
    const voice = pickVoice(lang);
    showStatus(`Đang đọc thử tiếng ${NAMES[lang]}... Hãy nghe qua tai nghe/loa.`);
    let startedMs = null;
    let error = null;
    await Promise.race([
      speak(SAMPLES[lang], lang, { onStart: (ms) => (startedMs = ms), onError: (e) => (error = e) }),
      sleep(9000),
    ]);
    const where = `giọng: ${voice ? voice.name : 'không có trong danh sách'}`;
    if (error || startedMs === null) {
      add('bad', `Đọc tiếng ${NAMES[lang]}: không phát được (${error || 'không bắt đầu'}); ${where}`);
      missing.push(NAMES[lang]);
      continue;
    }
    const a = await ask(`Bạn có nghe rõ giọng đọc tiếng ${NAMES[lang]} không?`, ['Nghe rõ', 'Nghe nhưng sai/khó hiểu', 'Không nghe gì']);
    if (a === 0) add('ok', `Đọc tiếng ${NAMES[lang]}: nghe rõ, trễ ${startedMs}ms; ${where}`);
    else {
      add(a === 1 ? 'warn' : 'bad', `Đọc tiếng ${NAMES[lang]}: ${a === 1 ? 'sai/khó hiểu' : 'không nghe thấy'}; ${where}`);
      missing.push(NAMES[lang]);
    }
  }
  if (missing.length) {
    issue(
      'Giọng đọc chưa dùng được cho: ' + missing.join(', ') +
      '. Cài đặt → Quản lý chung → Ngôn ngữ → Chuyển văn bản thành giọng nói → chọn "Dịch vụ giọng nói của Google" → bánh răng → Cài đặt dữ liệu giọng nói → tải các tiếng còn thiếu.'
    );
  }
}

// ---------- Phần 2: đọc to câu mẫu ----------

async function checkSpeaking(partnerLang) {
  if (!srSupported) return;
  const go = await ask('Phần cuối: đọc to 6 câu mẫu (mất khoảng 2 phút). Hãy ở nơi yên tĩnh, đọc bình thường như khi audit.', ['Bắt đầu đọc', 'Bỏ qua phần này']);
  if (go === 1) {
    add('info', 'Bỏ qua bài đọc câu mẫu.');
    return;
  }

  let cur = null; // phiên thu hiện tại
  const mk = (side, lang) =>
    createRecognizer({
      name: side,
      lang,
      onFinal: (text, conf) => cur && text && cur[side].push({ t: performance.now() - cur.t0, text, conf }),
      onError: () => {},
      onLog: diag,
    });
  const recP = mk('partner', partnerLang);
  const recV = mk('vi', 'vi-VN');

  const vi = TEST_PROMPTS['vi-VN'];
  const pa = TEST_PROMPTS[partnerLang];
  const order = [];
  for (let i = 0; i < 3; i++) order.push(['vi', vi[i]], ['partner', pa[i]]);

  const results = [];
  for (let i = 0; i < order.length; i++) {
    const [side, text] = order[i];
    const langName = side === 'vi' ? 'Việt' : NAMES[partnerLang];
    const r = await ask(`Câu ${i + 1}/6 — đọc to bằng tiếng ${langName}:\n\n"${text}"`, ['Tôi sẵn sàng, bắt đầu nghe', 'Dừng bài đọc']);
    if (r === 1) break;
    cur = { t0: performance.now(), vi: [], partner: [] };
    recP.start();
    recV.start();
    for (let s = 7; s > 0; s--) {
      showStatus(`ĐANG NGHE (${s}s) — đọc to bằng tiếng ${langName}:\n\n"${text}"`);
      await sleep(1000);
    }
    recP.stop();
    recV.stop();
    showStatus('Đang xử lý...');
    await sleep(1200); // chờ final cuối cùng sau khi stop
    const j = judge(side, text, cur);
    cur = null;
    results.push({ text, ...j });
    diag('SELFTEST speak ' + JSON.stringify({ side, text, heard: j.heard, conf: j.conf }));
  }

  if (!results.length) return;
  reportSpeaking(results, partnerLang);
}

function pct(x) {
  return Math.round(x * 100) + '%';
}

function reportSpeaking(results, partnerLang) {
  const pn = NAMES[partnerLang];
  results.forEach((r, i) => {
    const who = r.expectedSide === 'vi' ? 'Việt' : pn;
    const level = r.recognizerOk && r.fastOk && r.confOk ? 'ok' : r.recognizerOk ? 'warn' : 'bad';
    add(
      level,
      `Câu ${i + 1} (${who}) "${r.text}" → bên Việt nghe: "${r.heard.vi || '(không có)'}" (${pct(r.sim.vi)}); bên ${pn} nghe: "${r.heard.partner || '(không có)'}" (${pct(r.sim.partner)}); chế độ Nhanh: ${r.fastOk ? 'ĐÚNG' : 'SAI'}; chế độ Tin cậy: ${r.confOk ? 'ĐÚNG' : 'SAI'}; confidence Việt ${r.conf.vi.toFixed(2)} / ${pn} ${r.conf.partner.toFixed(2)}`
    );
  });
  const n = results.length;
  const heardOk = results.filter((r) => r.recognizerOk).length;
  const fast = results.filter((r) => r.fastOk).length;
  const conf = results.filter((r) => r.confOk).length;
  const noConf = results.every((r) => r.conf.vi === 0 && r.conf.partner === 0);
  add('info', `Tổng kết đọc câu mẫu: nhận diện đúng ngôn ngữ ${heardOk}/${n}; chế độ Nhanh chọn đúng người nói ${fast}/${n}; chế độ Tin cậy chọn đúng ${conf}/${n}${noConf ? ' (máy không trả confidence, chế độ Tin cậy chỉ là đoán theo thứ tự)' : ''}`);
  if (heardOk < n) issue(`Nhận diện giọng nói chỉ đúng ${heardOk}/${n} câu. Kiểm tra micro, môi trường ồn, hoặc gói ngôn ngữ nhận diện của Google chưa cài.`);
  const best = Math.max(fast, conf);
  if (best < n) issue(`Tự nhận diện ai đang nói chỉ đúng ${best}/${n} câu ở chế độ tốt nhất: chưa đủ tin cậy, cần đổi cách (xem đề xuất của Claude Code sau khi nhận báo cáo).`);
}

// ---------- Báo cáo ----------

function buildReport() {
  const head = [`BÁO CÁO TỰ KIỂM TRA — Phiên Dịch Audit — bản ${APP_VERSION} — ${new Date().toLocaleString('vi-VN')}`, ''];
  const sum = issues.length
    ? ['VẤN ĐỀ PHÁT HIỆN:', ...issues.map((t, i) => `${i + 1}. ${t}`)]
    : ['Không phát hiện vấn đề nào.'];
  const body = lines.map((l) => `${ICON[l.level]} ${l.text}`);
  return [...head, ...sum, '', 'CHI TIẾT:', ...body, '', 'NHẬT KÝ (cuối):', recentLog(60)].join('\n');
}

function finish() {
  const panel = $('stReportPanel');
  panel.hidden = false;
  const sum = $('stSummary');
  sum.textContent = '';
  const h = document.createElement('div');
  h.className = issues.length ? 'err' : 'note ok-note';
  h.textContent = issues.length ? 'Phát hiện ' + issues.length + ' vấn đề:' : 'Không phát hiện vấn đề nào.';
  sum.appendChild(h);
  if (issues.length) {
    const ol = document.createElement('ol');
    ol.className = 'st-issues';
    issues.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ol.appendChild(li);
    });
    sum.appendChild(ol);
  }
  const text = buildReport();
  $('stReport').textContent = text;
  $('stCopy').onclick = () => copyText(text, $('stCopy'));
  $('stShare').hidden = !navigator.share;
  $('stShare').onclick = () => navigator.share({ title: 'Báo cáo tự kiểm tra Phiên Dịch Audit', text }).catch(() => {});
  panel.scrollIntoView({ block: 'start' });
}

async function run() {
  lines = [];
  issues = [];
  $('stList').textContent = '';
  $('stReportPanel').hidden = true;
  $('stStart').disabled = true;
  $('stPartner').disabled = true;
  const partner = $('stPartner').value;
  try {
    checkEnvironment();
    await checkMicPermission();
    const blocked = await checkDualRecognizers(partner);
    await checkTranslation();
    await checkTts();
    if (blocked) add('info', 'Bỏ qua bài đọc câu mẫu vì nhận diện giọng nói chưa chạy được (xem vấn đề ở trên).');
    else await checkSpeaking(partner);
  } catch (e) {
    add('bad', 'Bài kiểm tra bị dừng giữa chừng do lỗi: ' + (e && e.message));
    issue('Bài kiểm tra bị lỗi chương trình: ' + (e && e.message));
  } finally {
    $('stAsk').textContent = '';
    $('stStart').disabled = false;
    $('stStart').textContent = 'Làm lại bài kiểm tra';
    $('stPartner').disabled = false;
    finish();
  }
}

export function initSelfTest() {
  $('stStart').onclick = run;
}

