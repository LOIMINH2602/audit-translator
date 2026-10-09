// Tab "Tự kiểm tra" → "Đo tai nghe & độ trễ": đo trên điện thoại + tai nghe thật những gì máy tính không giả lập
// được (Bluetooth). Kết luận tính ở fieldcheck.js. Các bước:
//   1. Tai trái/phải khi micro tắt (tiếng bíp chỉ phát 1 bên, người dùng trả lời nghe ở đâu).
//   2. Phản xạ: chạm khi nghe tiếng bíp — lúc micro chưa bật, và ngay sau khi nhận diện giọng nói vừa tắt.
//      Chênh lệch = thời gian tai nghe chuyển từ chế độ cuộc gọi sang phát. Đếm số tiếng bíp nghe được = mất tiếng đầu.
//   3. Tai trái/phải trong lúc nhận diện giọng nói đang bật (đúng cách app nghe).
//   4. App giữ micro điện thoại (getUserMedia) và nhận diện qua track đó: tai nghe có giữ được chế độ phát không.
//   5. Chuỗi thật: đọc 1 câu tiếng Việt → chốt câu → dịch → đọc bản dịch; chạm khi nghe thấy.
// Mọi bước đều có giới hạn thời gian; bấm "Dừng bài đo" là dừng ngay và vẫn lập báo cáo phần đã đo.

import { $ } from './ui.js';
import { NAMES, TEST_PROMPTS, APP_VERSION } from './config.js';
import { supported as srSupported } from './recognizer.js';
import { detectTranslate } from './translate.js';
import { speak, warmUp, cancel as ttsCancel, engineFor } from './tts.js';
import { diag } from './diagnostics.js';
import { analyze, compare, BEEPS } from './fieldcheck.js';
import { add, issue, ask, showStatus, finish, resetReport } from './selftest.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const STORE = 'audit.field.v1'; // { bt: summary, speaker: summary } — để so 2 lần đo
const REACTION_TRIALS = 3;
const CHAIN_SENTENCES = 2;
const TAP_WAIT_MS = 6000;
const EARLY_MS = 100; // chạm sớm hơn mức này sau tiếng bíp là đoán trước, không phải nghe thấy

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = Symbol('stop');
let stopped = false;
let wakeStop = () => {};
let stopSignal = null;
const cleanups = new Set(); // micro / phiên nhận diện đang mở: dọn khi kết thúc hoặc bị dừng

class Stopped extends Error {}
function check() {
  if (stopped) throw new Stopped();
}
async function sleepC(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    check();
    await sleep(Math.min(50, end - performance.now()));
  }
  check();
}
async function untilC(cond, ms) {
  const end = performance.now() + ms;
  while (!cond() && performance.now() < end) {
    check();
    await sleep(30);
  }
  check();
  return cond();
}
async function askC(question, options, step) {
  const a = await Promise.race([ask(question, options, step), stopSignal]);
  if (a === STOP) throw new Stopped();
  return a;
}

// ---------- âm thanh: tiếng bíp phát trái / phải / giữa ----------
let ctx = null;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}
async function resumeAudio() {
  const c = audioCtx();
  if (c.state !== 'running') await Promise.race([c.resume().catch(() => {}), sleep(1500)]);
  return c;
}
// Cho luồng âm thanh nghỉ như lúc app im lặng (không giữ tai nghe ở chế độ phát) trước mỗi lần đo phản xạ.
async function suspendAudio() {
  if (ctx && ctx.state === 'running') await Promise.race([ctx.suspend().catch(() => {}), sleep(500)]);
}
// n tiếng bíp cách nhau gapMs; pan -1 = chỉ tai trái, 1 = chỉ tai phải. Trả về { at: performance.now() lúc tiếng
// đầu vào bộ phát, state }.
const LEAD_S = 0.06;
async function beep(pan = 0, n = 1, gapMs = 300) {
  const c = await resumeAudio();
  const t0 = c.currentTime + LEAD_S;
  const at = performance.now() + LEAD_S * 1000;
  let out = c.destination;
  if (pan) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(c.destination);
    out = p;
  }
  for (let i = 0; i < n; i++) {
    const t = t0 + (i * gapMs) / 1000;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.setValueAtTime(0.5, t + 0.14);
    g.gain.linearRampToValueAtTime(0, t + 0.16);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.17);
  }
  const info = { pan, n, at, state: c.state };
  if (window.__onBeep) window.__onBeep(info); // test tự động (tools/e2e/field.mjs)
  return info;
}

// ---------- nhận diện giọng nói thô (không tự khởi động lại), đo thời điểm từng sự kiện ----------
function openSR({ lang = 'vi-VN', continuous = true, track = null } = {}) {
  const r = new SR();
  r.lang = lang;
  r.continuous = continuous;
  r.interimResults = true;
  const st = { started: false, ended: false, err: null, text: '', interim: '', speechEndAt: null, closed: false };
  r.onstart = () => (st.started = true);
  r.onspeechend = () => { if (st.speechEndAt === null) st.speechEndAt = performance.now(); };
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) st.text = (st.text + ' ' + t).trim();
      else interim += t;
    }
    st.interim = interim.trim();
  };
  r.onerror = (e) => (st.err = st.err || e.error);
  r.onend = () => (st.ended = true);
  const clone = track ? track.clone() : null;
  st.close = () => {
    if (st.closed) return;
    st.closed = true;
    st.ended = true;
    r.onstart = r.onresult = r.onerror = r.onend = r.onspeechend = null;
    try { r.abort(); } catch (_) {}
    if (clone) clone.stop();
    cleanups.delete(st.close);
  };
  cleanups.add(st.close);
  try {
    if (clone) r.start(clone);
    else r.start();
  } catch (e) {
    st.err = 'start ' + e.name;
    st.close();
  }
  return st;
}

// Giữ 1 phiên nhận diện đang chạy (Android tự tắt phiên khi im lặng lâu): ensure() mở lại nếu đã tắt.
function keepSR(opts) {
  let cur = null;
  return {
    async ensure() {
      if (cur && cur.started && !cur.ended) return true;
      if (cur) cur.close();
      cur = openSR(opts);
      await untilC(() => cur.started || cur.ended, 3000);
      if (!cur.started) return false;
      await sleepC(700); // chờ máy chuyển xong chế độ micro rồi mới phát tiếng
      return !cur.ended;
    },
    active: () => Boolean(cur && cur.started && !cur.ended),
    get cur() { return cur; },
    close() { if (cur) cur.close(); },
  };
}

// ---------- màn chạm ----------
function tapScreen(text, step, onTap, label = 'NGHE THẤY') {
  const box = $('stAsk');
  box.textContent = '';
  box.dataset.step = step;
  const q = document.createElement('div');
  q.className = 'st-q';
  q.textContent = text;
  const b = document.createElement('button');
  b.className = 'primary tap';
  b.textContent = label;
  b.onclick = onTap;
  box.append(q, b);
  box.scrollIntoView({ block: 'nearest' });
  return q;
}

const EAR_ANS = ['left', 'right', 'both', 'phone', 'none'];
async function askEar(step, replay) {
  for (let k = 0; k < 3; k++) {
    const a = await askC('Tiếng bíp vừa rồi nghe ở đâu?', ['Tai trái', 'Tai phải', 'Cả hai tai như nhau', 'Phát ra điện thoại', 'Không nghe thấy', 'Phát lại'], step);
    if (a < EAR_ANS.length) return EAR_ANS[a];
    await replay();
  }
  return null;
}

// Tai trái/phải: phát bíp từng bên (thứ tự ngẫu nhiên). before(): chuẩn bị trước mỗi tiếng bíp, trả false = điều kiện
// đo không đạt (vd. nhận diện không chạy) → bên đó ghi null.
async function earsTest(kind, before = async () => true) {
  const res = { left: null, right: null };
  const sides = Math.random() < 0.5 ? ['left', 'right'] : ['right', 'left'];
  for (const side of sides) {
    showStatus(`Đo tai trái/phải (${kind === 'idle' ? 'micro tắt' : kind === 'mic' ? 'micro đang bật' : 'app giữ micro điện thoại'})...`, `ear-${kind}-wait`);
    const ok = await before();
    const play = () => beep(side === 'left' ? -1 : 1, 2, 250);
    await play();
    const ans = await askEar(`ear-${kind}-${side}`, async () => { await before(); await play(); });
    res[side] = ok ? ans : null;
    diag(`FIELD tai ${kind} bíp ${side} → ${ans}${ok ? '' : ' (bỏ: điều kiện đo không đạt)'}`);
  }
  return res;
}

// 1 lần đo phản xạ. kind 'base': micro chưa bật; 'mic': bật nhận diện 1,2–2,2 giây rồi tắt, phát bíp ngay.
async function reactionTrial(kind, i) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let tapAt = null;
    const q = tapScreen(
      `Đo phản xạ ${i}/${REACTION_TRIALS} — ${kind === 'base' ? 'micro tắt' : 'micro bật rồi tắt'}.\nGiữ yên lặng. Chạm nút ngay khi nghe tiếng bíp đầu tiên.`,
      `tap-${kind}-${i}`,
      () => { if (tapAt === null) tapAt = performance.now(); }
    );
    await suspendAudio();
    let mic = null;
    if (kind === 'base') {
      await sleepC(1500 + Math.random() * 2000);
    } else {
      const sr = openSR({ continuous: true });
      await untilC(() => sr.started || sr.ended, 3000);
      mic = { started: sr.started, err: sr.err };
      await sleepC(1200 + Math.random() * 1000);
      sr.close();
    }
    if (tapAt !== null) {
      q.textContent = 'Chạm sớm quá (chưa có tiếng bíp) — đo lại lần này.';
      await sleepC(1500);
      continue;
    }
    const b = await beep(0, BEEPS);
    await untilC(() => tapAt !== null, TAP_WAIT_MS);
    if (tapAt !== null && tapAt - b.at < EARLY_MS) {
      q.textContent = 'Chạm sớm quá — đo lại lần này.';
      await sleepC(1500);
      continue;
    }
    const rt = tapAt === null ? null : Math.round(tapAt - b.at);
    const c = await askC(`Anh nghe được mấy tiếng bíp?`, ['3 tiếng', '2 tiếng', '1 tiếng', 'Không nghe thấy'], `count-${kind}-${i}`);
    const heard = BEEPS - c;
    diag(`FIELD phản xạ ${kind} ${i}: ${rt ?? 'không chạm'}ms, nghe ${heard}/${BEEPS}, âm thanh ${b.state}${mic ? `, mic ${mic.started ? 'đã bật' : 'KHÔNG bật'}${mic.err ? ' ' + mic.err : ''}` : ''}`);
    return { rt, heard, early: false, state: b.state, mic };
  }
  diag(`FIELD phản xạ ${kind} ${i}: chạm sớm 3 lần, bỏ`);
  return { rt: null, heard: null, early: true };
}

// Liệt kê micro/loa máy thấy (cần quyền micro để có tên).
async function listDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    add('bad', 'Không mở được micro: ' + e.name);
    if (e.name === 'NotAllowedError') issue('Chưa cho phép micro cho trang này. Chrome → biểu tượng ổ khóa cạnh địa chỉ → Quyền → Micro → Cho phép.');
    return [];
  }
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const ins = devs.filter((d) => d.kind === 'audioinput');
  const outs = devs.filter((d) => d.kind === 'audiooutput');
  add('info', 'Micro máy thấy: ' + (ins.map((d) => d.label || '(không tên)').join(' | ') || 'không có'));
  if (outs.length) add('info', 'Đầu ra máy thấy: ' + outs.map((d) => d.label || '(không tên)').join(' | '));
  return ins;
}

// Micro của điện thoại (không phải tai nghe) trong danh sách thiết bị. Chrome Android đặt tên "Speakerphone",
// "Headset earpiece" (micro máy ở chế độ nghe gần), "Bluetooth headset", "Wired headset", "USB audio".
function phoneMicOf(ins) {
  const real = ins.filter((d) => d.deviceId && !['default', 'communications'].includes(d.deviceId));
  return (
    real.find((d) => /speakerphone|earpiece|built-?in|internal|bottom|điện thoại/i.test(d.label)) ||
    real.find((d) => d.label && !/bluetooth|headset|usb|freearc|huawei|buds/i.test(d.label)) ||
    null
  );
}

// Bước 4: app giữ micro điện thoại, nhận diện qua track đó.
async function phoneMicTest(ins, bt) {
  const out = { ears: null, track: { tried: false } };
  const dev = phoneMicOf(ins);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: dev ? { deviceId: { exact: dev.deviceId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true },
    });
  } catch (e) {
    add('warn', 'Không mở được micro điện thoại riêng: ' + e.name);
    out.track = { tried: true, ok: false, err: 'getUserMedia ' + e.name };
    return out;
  }
  const stopStream = () => stream.getTracks().forEach((t) => t.stop());
  cleanups.add(stopStream);
  const track = stream.getAudioTracks()[0];
  add('info', `App giữ micro: ${track.label || '(không tên)'}${dev ? '' : ' (không tìm thấy micro điện thoại riêng, dùng micro mặc định)'}`);
  const k = keepSR({ continuous: true, track });
  try {
    if (bt) out.ears = await earsTest('phone', () => k.ensure());
    const go = await askC('Thử nhận diện qua micro điện thoại: bấm Bắt đầu rồi đọc to:\n\n"một hai ba bốn năm"', ['Bắt đầu', 'Bỏ qua'], 'track-ready');
    if (go === 0) {
      const running = await k.ensure();
      showStatus('ĐANG NGHE — đọc to:\n\n"một hai ba bốn năm"', 'track-listen');
      await untilC(() => (k.cur && (k.cur.text || k.cur.ended)), 8000);
      const st = k.cur || {};
      const text = st.text || st.interim || '';
      out.track = { tried: true, ok: Boolean(text), text, err: text ? null : st.err || (running ? 'không nghe ra chữ' : 'nhận diện không khởi động') };
      diag(`FIELD nhận diện qua micro điện thoại: ${JSON.stringify(out.track)}`);
    }
  } finally {
    k.close();
    stopStream();
    cleanups.delete(stopStream);
  }
  return out;
}

// Bước 5: chuỗi dịch thật, giống màn 1:1 (nhận diện 1 câu, chốt khi máy báo hết tiếng nói + 350ms, dịch, đọc).
const SPEECHEND_GRACE_MS = 350;
async function chainTest(partner, i, text) {
  await askC(`Câu ${i}/${CHAIN_SENTENCES}: bấm Bắt đầu, đọc to câu dưới rồi im lặng.\nKhi nghe giọng đọc bản dịch (tiếng ${NAMES[partner]}), chạm nút NGHE THẤY ngay.\n\n"${text}"`, ['Bắt đầu'], `chain-ready-${i}`);
  let tapAt = null;
  const q = tapScreen(`ĐANG NGHE — đọc to:\n\n"${text}"`, `chain-tap-${i}`, () => { if (tapAt === null) tapAt = performance.now(); }, 'NGHE THẤY BẢN DỊCH');
  const sr = openSR({ continuous: false });
  try {
    await untilC(
      () => sr.text || (sr.speechEndAt !== null && sr.interim && performance.now() - sr.speechEndAt >= SPEECHEND_GRACE_MS) || sr.ended,
      15000
    );
  } finally {
    sr.close();
  }
  const tText = performance.now();
  const said = sr.text || sr.interim;
  if (!said) return { err: `không nghe ra câu nói${sr.err ? ' (' + sr.err + ')' : ''}` };
  const tEnd = sr.speechEndAt ?? tText;
  q.textContent = `Đang dịch: "${said}"\nChạm NGHE THẤY BẢN DỊCH khi nghe giọng đọc.`;
  let tr;
  try {
    tr = await detectTranslate(said, 'vi-VN', partner);
  } catch (e) {
    return { said, err: 'dịch lỗi ' + (e.details || e.message) };
  }
  check();
  const tTr = performance.now();
  let startAt = null;
  let voice = null;
  const rate = Number(($('ttsRate') || {}).value) || 1.2;
  await Promise.race([
    speak(tr.text, partner, { rate, onStart: (ms, v) => { if (startAt === null) { startAt = performance.now(); voice = v; } } }),
    sleep(20000),
  ]);
  check();
  await untilC(() => tapAt !== null, 2500);
  const r = {
    said,
    out: tr.text,
    textMs: Math.round(tText - tEnd),
    translateMs: Math.round(tTr - tText),
    ttsStartMs: startAt === null ? null : Math.round(startAt - tTr),
    appMs: startAt === null ? null : Math.round(startAt - tEnd),
    tapMs: tapAt === null ? null : Math.round(tapAt - tEnd),
    early: tapAt !== null && (startAt === null || tapAt < startAt),
    engine: voice || engineFor(partner),
    noSpeechEnd: sr.speechEndAt === null,
  };
  if (startAt === null) r.err = 'giọng đọc không phát được';
  diag('FIELD chuỗi ' + JSON.stringify(r));
  return r;
}

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; }
}
function saveStore(x) {
  try { localStorage.setItem(STORE, JSON.stringify(x)); } catch (_) {}
}

async function run() {
  const btn = $('stField');
  if (btn.dataset.running) {
    stopped = true;
    wakeStop();
    return;
  }
  stopped = false;
  stopSignal = new Promise((res) => (wakeStop = () => res(STOP)));
  btn.dataset.running = '1';
  btn.textContent = 'Dừng bài đo';
  $('stStart').disabled = true;
  $('stPartner').disabled = true;
  resetReport();
  audioCtx(); // tạo trong lúc người dùng vừa chạm (Chrome chỉ cho phát âm thanh sau thao tác chạm)
  const partner = $('stPartner').value;
  const r = { output: null, ears: { idle: null, mic: null, phone: null }, base: [], afterMic: [], track: { tried: false }, chain: [] };
  let done = false;
  try {
    add('info', `Bản ${APP_VERSION} · ${navigator.userAgent}`);
    if (!srSupported) {
      add('bad', 'Trình duyệt không hỗ trợ nhận diện giọng nói — mở bằng Google Chrome.');
      issue('Trình duyệt không hỗ trợ nhận diện giọng nói: phải dùng Google Chrome.');
      return;
    }
    const o = await askC('Anh đang nghe bằng gì?', ['Tai nghe Bluetooth (đeo cả 2 tai)', 'Loa điện thoại (đã tắt Bluetooth)'], 'output');
    r.output = o === 0 ? 'bt' : 'speaker';
    add('info', 'Đo với: ' + (r.output === 'bt' ? 'tai nghe Bluetooth' : 'loa điện thoại'));
    await resumeAudio();
    const ins = await listDevices();
    const bt = r.output === 'bt';

    if (bt) r.ears.idle = await earsTest('idle', async () => { await suspendAudio(); return true; });
    await askC(`Đo phản xạ: ${REACTION_TRIALS * 2} lần, mỗi lần chờ tiếng bíp rồi chạm nút thật nhanh. Giữ yên lặng trong lúc đo.`, ['Bắt đầu'], 'reaction-intro');
    for (let i = 1; i <= REACTION_TRIALS; i++) r.base.push(await reactionTrial('base', i));
    for (let i = 1; i <= REACTION_TRIALS; i++) r.afterMic.push(await reactionTrial('mic', i));

    if (bt) {
      const k = keepSR({ continuous: true });
      try {
        r.ears.mic = await earsTest('mic', () => k.ensure());
      } finally {
        k.close();
      }
      const p = await phoneMicTest(ins, bt);
      r.ears.phone = p.ears;
      r.track = p.track;
    }

    await warmUp(partner); // như màn 1:1: chọn giọng đọc trước khi đọc thật
    const prompts = TEST_PROMPTS['vi-VN'];
    for (let i = 1; i <= CHAIN_SENTENCES; i++) r.chain.push(await chainTest(partner, i, prompts[(i - 1) % prompts.length]));
    done = true;
  } catch (e) {
    if (e instanceof Stopped) add('warn', 'Đã dừng bài đo giữa chừng — kết quả dưới đây chỉ gồm phần đã đo.');
    else {
      add('bad', 'Bài đo bị lỗi chương trình: ' + (e && e.message));
      issue('Bài đo bị lỗi chương trình: ' + (e && e.message));
    }
  } finally {
    for (const c of [...cleanups]) c();
    ttsCancel();
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
    if (r.output) {
      const a = analyze(r);
      a.lines.forEach((l) => add(l.level, l.text));
      a.issues.forEach(issue);
      if (done) {
        const store = loadStore();
        store[r.output] = { ...a.summary, at: new Date().toISOString() };
        saveStore(store);
        const cmp = compare(store.bt, store.speaker);
        if (cmp.length) cmp.forEach((t) => add('info', 'So sánh: ' + t));
        else add('info', r.output === 'bt' ? 'Để so sánh: tắt Bluetooth rồi bấm "Đo tai nghe & độ trễ" lần nữa, chọn "Loa điện thoại".' : 'Để so sánh: bật tai nghe Bluetooth rồi đo lại, chọn "Tai nghe Bluetooth".');
      }
      diag('FIELD dữ liệu ' + JSON.stringify(r));
      window.__field = { r, summary: a.summary }; // test tự động đọc
    }
    delete btn.dataset.running;
    btn.textContent = 'Đo tai nghe & độ trễ';
    $('stStart').disabled = false;
    $('stPartner').disabled = false;
    $('stAsk').textContent = '';
    finish('BÁO CÁO ĐO TAI NGHE');
  }
}

export function initFieldTest() {
  $('stField').onclick = run;
}
