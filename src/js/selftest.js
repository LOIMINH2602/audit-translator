// Tab "Tự kiểm tra": chạy toàn bộ phép thử trên máy người dùng, tự chấm đúng/sai, xuất báo cáo tiếng Việt
// để gửi lại. Người dùng không cần tự đánh giá hay mô tả lỗi.
//   Phần 1 (tự động): môi trường, dò nghe song song/luân phiên, dịch 8 chiều, giọng đọc 5 tiếng.
//   Phần 2 (đọc to): câu mẫu; app biết câu đúng nên tự chấm nghe đúng không, nhận đúng người nói không.

import { $, copyText } from './ui.js';
import { NAMES, SAMPLES, TEST_PROMPTS, APP_VERSION } from './config.js';
import { createRecognizer, probeParallel, supported as srSupported } from './recognizer.js';
import { translate, detectTranslate } from './translate.js';
import { pickVoice, voices, speak, warmUp, supported as ttsSupported } from './tts.js';
import { judge, similarity } from './scoring.js';
import { isInAppBrowser } from './env.js';
import { diag, recentLog } from './diagnostics.js';

const ICON = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANGS = ['vi-VN', 'en-US', 'zh-CN', 'ja-JP', 'ko-KR'];

let lines = []; // { level, text } — nguyên liệu của báo cáo
let issues = []; // kết luận bằng lời thường, hiện đầu báo cáo

export function add(level, text) {
  lines.push({ level, text });
  const div = document.createElement('div');
  div.className = 'st-line ' + level;
  div.textContent = `${ICON[level]} ${text}`;
  $('stList').appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
}

export function issue(text) {
  issues.push(text);
}

// Hỏi người dùng 1 câu có nút trả lời; trả về chỉ số nút đã bấm. step: mã bước (data-step) cho test tự động.
export function ask(question, options, step = '') {
  return new Promise((resolve) => {
    const box = $('stAsk');
    box.textContent = '';
    box.dataset.step = step;
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

export function showStatus(text, step = '') {
  const box = $('stAsk');
  box.textContent = '';
  box.dataset.step = step;
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

// Dò máy có cho 2 recognizer song song không (chính hàm app dùng khi bấm Bắt đầu), rồi thử 1 recognizer
// mỗi tiếng 3 giây để phân loại lỗi micro/mạng/gói ngôn ngữ.
// Trả về { blocked, probe }: blocked = nhận diện không dùng được → bỏ qua bài đọc câu mẫu.
async function checkRecognition(partnerLang) {
  if (!srSupported) return { blocked: true, probe: null };
  showStatus('Đang dò khả năng nghe song song (2 giây)...');
  const probe = await probeParallel(partnerLang, 'vi-VN');
  diag(`SELFTEST dò song song: ${probe.parallel} (${probe.reason})`);
  if (probe.denied) {
    add('bad', 'Micro bị từ chối.');
    issue('Chưa cho phép micro cho trang này. Chrome → biểu tượng ổ khóa cạnh địa chỉ → Quyền → Micro → Cho phép.');
    return { blocked: true, probe };
  }
  if (probe.parallel) add('ok', `Máy cho 2 recognizer nghe song song (Việt + ${NAMES[partnerLang]}): màn 1:1 dùng chế độ tự nhận người nói song song.`);
  else add('info', `Máy chỉ cho 1 recognizer mỗi lúc (${probe.reason}): màn 1:1 dùng chế độ nghe luân phiên.`);

  const errs = [];
  for (const lang of ['vi-VN', partnerLang]) {
    showStatus(`Đang thử nhận diện tiếng ${NAMES[lang]} (3 giây)...`);
    const ev = [];
    const r = createRecognizer({ name: 'thử-' + lang, lang, onFinal: () => {}, onError: (e) => ev.push('error ' + e), onLog: (m) => ev.push(m) });
    r.start();
    await sleep(3000);
    r.stop();
    await sleep(400);
    const started = ev.some((m) => / start /.test(m));
    const bad = ev.filter((m) => /^error /.test(m));
    add(started ? 'ok' : 'bad', `Nhận diện tiếng ${NAMES[lang]}: ${started ? 'khởi động được' : 'KHÔNG khởi động được'}${bad.length ? ' (' + bad.join(', ') + ')' : ''}`);
    errs.push(...ev);
  }
  const all = errs.join(' ');
  let blocked = false;
  if (/not-allowed|service-not-allowed/.test(all)) {
    issue('Chưa cho phép micro cho trang này.');
    blocked = true;
  } else if (/audio-capture/.test(all)) {
    issue('Chrome không lấy được tiếng từ micro. Kiểm tra: micro đang bị app khác chiếm (cuộc gọi, ghi âm, Zalo/Messenger đang mở micro), hoặc tai nghe Bluetooth đang ở chế độ chỉ phát nhạc không có micro. Thử ngắt tai nghe và dùng micro máy.');
    blocked = true;
  } else if (/error network/.test(all)) {
    issue('Điện thoại không kết nối được dịch vụ nhận diện giọng nói của Google. Kiểm tra mạng Wi-Fi/4G.');
    blocked = true;
  } else if (/language-not-supported/.test(all)) {
    issue(`Máy chưa hỗ trợ nhận diện tiếng Việt hoặc tiếng ${NAMES[partnerLang]}. Cài đặt → Ứng dụng → Google → Giọng nói → Ngôn ngữ → tải thêm.`);
    blocked = true;
  }
  return { blocked, probe };
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
  const slow = [];
  for (const lang of LANGS) {
    const voice = pickVoice(lang);
    showStatus(`Đang đọc thử tiếng ${NAMES[lang]}... Hãy nghe qua tai nghe/loa.`);
    await warmUp(lang); // như màn 1:1: chọn giọng (máy / Google Dịch) trước khi đọc thật, để đo đúng giọng sẽ dùng
    let startedMs = null;
    let usedVoice = null;
    let error = null;
    await Promise.race([
      speak(SAMPLES[lang], lang, { onStart: (ms, v) => { startedMs = ms; usedVoice = v; }, onError: (e) => (error = e) }),
      sleep(9000),
    ]);
    const where = `đọc bằng: ${usedVoice || (voice ? voice.name : 'không rõ')}`;
    if (startedMs !== null && startedMs > 1500) {
      slow.push(`${NAMES[lang]} ${(startedMs / 1000).toFixed(1)}s`);
    }
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
  if (slow.length) issue('Giọng đọc bắt đầu chậm (trên 1,5 giây): ' + slow.join(', ') + '. Ở màn 1:1 chọn "Giọng Google Dịch" ở ô Giọng đọc, hoặc tải giọng đọc ngoại tuyến cho tiếng đó trong Cài đặt → Chuyển văn bản thành giọng nói.');
  if (missing.length) {
    issue(
      'Giọng đọc chưa dùng được cho: ' + missing.join(', ') +
      '. Cài đặt → Quản lý chung → Ngôn ngữ → Chuyển văn bản thành giọng nói → chọn "Dịch vụ giọng nói của Google" → bánh răng → Cài đặt dữ liệu giọng nói → tải các tiếng còn thiếu.'
    );
  }
}

// ---------- Phần 2: đọc to câu mẫu ----------
// Chạy đúng chế độ màn 1:1 sẽ dùng. Song song: cả 2 recognizer nghe, chấm pickSpeaker có chọn đúng bên.
// Luân phiên: recognizer nghe tiếng của bên đến lượt; thêm 2 câu "nói nhầm lượt" để đo app có phát hiện
// được và tự chuyển bên không (câu không khớp phải bị loại).

async function checkSpeaking(partnerLang, probe) {
  if (!srSupported) return;
  const parallel = Boolean(probe && probe.parallel);
  const vi = TEST_PROMPTS['vi-VN'];
  const pa = TEST_PROMPTS[partnerLang];
  const order = []; // [bên nói, câu, bên app đang nghe]
  for (let i = 0; i < 3; i++) order.push(['me', vi[i], 'me'], ['partner', pa[i], 'partner']);
  if (!parallel) order.push(['me', vi[0], 'partner'], ['partner', pa[1], 'me']);

  const go = await ask(`Phần cuối: đọc to ${order.length} câu mẫu (khoảng 2 phút). Hãy ở nơi yên tĩnh, đọc bình thường như khi audit.`, ['Bắt đầu đọc', 'Bỏ qua phần này']);
  if (go === 1) {
    add('info', 'Bỏ qua bài đọc câu mẫu.');
    return;
  }
  const langOf = (side) => (side === 'me' ? 'vi-VN' : partnerLang);
  let cur = null;
  const recs = {};
  for (const side of ['me', 'partner']) {
    recs[side] = createRecognizer({
      name: 'đọc-' + side,
      lang: langOf(side),
      track: parallel ? probe.track : null,
      continuous: false,
      onFinal: (text) => { if (cur && text) cur[side] = (cur[side] ? cur[side] + ' ' : '') + text; },
      onError: () => {},
      onLog: diag,
    });
  }

  const results = [];
  for (let i = 0; i < order.length; i++) {
    const [side, text, listen] = order[i];
    const langName = NAMES[langOf(side)];
    const r = await ask(`Câu ${i + 1}/${order.length} — đọc to bằng tiếng ${langName}:\n\n"${text}"`, ['Tôi sẵn sàng, bắt đầu nghe', 'Dừng bài đọc']);
    if (r === 1) break;
    cur = { me: '', partner: '' };
    const active = parallel ? ['me', 'partner'] : [listen];
    active.forEach((s) => recs[s].start());
    for (let t = 7; t > 0; t--) {
      showStatus(`ĐANG NGHE (${t}s) — đọc to bằng tiếng ${langName}:\n\n"${text}"`);
      await sleep(1000);
    }
    active.forEach((s) => recs[s].stop());
    showStatus('Đang xử lý...');
    await sleep(1200); // chờ final cuối cùng sau khi stop
    const heard = cur;
    cur = null;
    const cands = await Promise.all(
      active.filter((s) => heard[s]).map(async (s) => {
        const c = { side: s, lang: langOf(s), text: heard[s], detected: null };
        try {
          c.detected = (await detectTranslate(c.text, c.lang, langOf(s === 'me' ? 'partner' : 'me'))).detected;
        } catch (_) {}
        return c;
      })
    );
    const j = judge(side, text, cands, listen);
    results.push({ text, listen, mismatch: listen !== side, cands, ...j });
    diag('SELFTEST đọc ' + JSON.stringify({ side, listen, text, cands }));
  }
  if (results.length) reportSpeaking(results, partnerLang, parallel);
}

function pct(x) {
  return Math.round(x * 100) + '%';
}

function reportSpeaking(results, partnerLang, parallel) {
  const pn = NAMES[partnerLang];
  const sideName = (s) => (s === 'me' ? 'Việt' : pn);
  const heardStr = (r) => r.cands.map((c) => `bên ${sideName(c.side)} nghe "${c.text}" (dò: ${c.detected || '?'})`).join('; ') || 'không nghe được gì';
  results.forEach((r, i) => {
    const who = sideName(r.expectedSide);
    if (r.mismatch) {
      const caught = r.winner === null;
      add(caught ? 'ok' : 'warn', `Câu ${i + 1} (${who}, app đang nghe nhầm tiếng ${sideName(r.listen)}) → ${heardStr(r)} → ${caught ? 'app phát hiện nhầm lượt, tự chuyển bên' : 'app KHÔNG phát hiện, sẽ dịch sai câu này'}`);
      return;
    }
    const level = r.recognizerOk && r.pickOk ? 'ok' : r.recognizerOk ? 'warn' : 'bad';
    add(level, `Câu ${i + 1} (${who}) "${r.text}" → ${heardStr(r)}; khớp ${pct(r.expectedSide === 'me' ? r.sim.vi : r.sim.partner)}; app ${r.pickOk ? 'chọn ĐÚNG người nói' : r.winner ? 'chọn SAI người nói' : 'loại bỏ câu này'}`);
  });
  const normal = results.filter((r) => !r.mismatch);
  const mism = results.filter((r) => r.mismatch);
  const heardOk = normal.filter((r) => r.recognizerOk).length;
  const pickOk = normal.filter((r) => r.pickOk).length;
  const caught = mism.filter((r) => r.winner === null).length;
  add('info', `Tổng kết (${parallel ? 'song song' : 'luân phiên'}): nghe đúng câu ${heardOk}/${normal.length}; nhận đúng người nói ${pickOk}/${normal.length}` + (mism.length ? `; phát hiện nói nhầm lượt ${caught}/${mism.length}` : ''));
  if (heardOk < normal.length) issue(`Nhận diện giọng nói chỉ đúng ${heardOk}/${normal.length} câu. Kiểm tra micro, môi trường ồn, hoặc gói ngôn ngữ nhận diện của Google chưa cài.`);
  if (pickOk < normal.length) issue(`App nhận đúng người nói ${pickOk}/${normal.length} câu: gửi báo cáo này để Claude Code chỉnh ngưỡng.`);
  if (mism.length && caught < mism.length) issue(`Khi người nói nhầm lượt, app chỉ phát hiện ${caught}/${mism.length} lần. Lúc audit, nếu thấy ô "Đang nghe" sai người thì chạm vào ô đó để đổi.`);
}

// ---------- Báo cáo ----------

function buildReport(title) {
  const head = [`${title} — Phiên Dịch Audit — bản ${APP_VERSION} — ${new Date().toLocaleString('vi-VN')}`, ''];
  const sum = issues.length
    ? ['VẤN ĐỀ PHÁT HIỆN:', ...issues.map((t, i) => `${i + 1}. ${t}`)]
    : ['Không phát hiện vấn đề nào.'];
  const body = lines.map((l) => `${ICON[l.level]} ${l.text}`);
  return [...head, ...sum, '', 'CHI TIẾT:', ...body, '', 'NHẬT KÝ (cuối):', recentLog(60)].join('\n');
}

export function finish(title = 'BÁO CÁO TỰ KIỂM TRA') {
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
  const text = buildReport(title);
  $('stReport').textContent = text;
  $('stCopy').onclick = () => copyText(text, $('stCopy'));
  $('stShare').hidden = !navigator.share;
  $('stShare').onclick = () => navigator.share({ title: title + ' — Phiên Dịch Audit', text }).catch(() => {});
  panel.scrollIntoView({ block: 'start' });
}

// Xoá báo cáo cũ trước 1 bài kiểm tra/bài đo mới.
export function resetReport() {
  lines = [];
  issues = [];
  $('stList').textContent = '';
  $('stReportPanel').hidden = true;
}

async function run() {
  resetReport();
  $('stStart').disabled = true;
  $('stField').disabled = true;
  $('stPartner').disabled = true;
  const partner = $('stPartner').value;
  let probe = null;
  try {
    checkEnvironment();
    await checkMicPermission();
    const rec = await checkRecognition(partner);
    probe = rec.probe;
    const blocked = rec.blocked;
    await checkTranslation();
    await checkTts();
    if (blocked) add('info', 'Bỏ qua bài đọc câu mẫu vì nhận diện giọng nói chưa chạy được (xem vấn đề ở trên).');
    else await checkSpeaking(partner, probe);
  } catch (e) {
    add('bad', 'Bài kiểm tra bị dừng giữa chừng do lỗi: ' + (e && e.message));
    issue('Bài kiểm tra bị lỗi chương trình: ' + (e && e.message));
  } finally {
    if (probe && probe.track) probe.track.stop();
    $('stAsk').textContent = '';
    $('stStart').disabled = false;
    $('stStart').textContent = 'Làm lại bài kiểm tra';
    $('stPartner').disabled = false;
    $('stField').disabled = false;
    finish();
  }
}

export function initSelfTest() {
  $('stStart').onclick = run;
}

