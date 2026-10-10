// Tự kiểm tra → "Thử nghe song song": Android có cho app thu micro (getUserMedia) TRONG LÚC bộ nhận diện giọng nói của
// Google (SpeechRecognition) đang nghe không?
// Vì sao (10/10/2026): đo trên giọng người thật — Google chuyển giọng thành chữ tốt hơn hẳn Whisper chạy trên máy (Việt 93% so
// với 50–72%), còn Whisper nhận đúng ai đang nói 69–70/70. Ghép 2 cái (Google ra chữ, Whisper biết ai nói) chỉ làm được nếu
// Android cho 2 bên cùng thu micro. Máy tính không trả lời được câu này — phải đo trên điện thoại.
// 2 lần thử: micro app mở trước rồi mới bật Google; và ngược lại (trên Android, bên mở sau có thể giành micro).

import { $ } from './ui.js';
import { similarity } from './scoring.js';
import { diag } from './diagnostics.js';
import { add, issue, ask, showStatus, finish, resetReport } from './selftest.js';
import { holdScreen } from './keepalive.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SENTENCE = 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mở micro app, đo mức âm (RMS) liên tục. Trả về { stop(), levels: [{ t, rms }] }.
async function openMeter() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(an);
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  const buf = new Float32Array(an.fftSize);
  const levels = [];
  const t0 = performance.now();
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    levels.push({ t: performance.now() - t0, rms: Math.sqrt(s / buf.length) });
  }, 50);
  return {
    levels,
    ended: () => stream.getAudioTracks().some((t) => t.readyState === 'ended' || t.muted),
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

function openSR(lang) {
  const r = new SR();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = false;
  const st = { started: false, err: null, text: '' };
  r.onstart = () => (st.started = true);
  r.onerror = (e) => (st.err = st.err || e.error);
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) st.text += ' ' + e.results[i][0].transcript;
  };
  try { r.start(); } catch (e) { st.err = 'start ' + e.name; }
  st.stop = () => { try { r.stop(); } catch (_) {} };
  return st;
}

// Một lần thử. order 'app-first' | 'google-first'. Trả về { srOk, sim, text, srErr, appOk, quiet, loud, ended }.
async function trial(order, i) {
  await ask(`Lần ${i}/2: bấm "Bắt đầu", chờ 1 giây rồi đọc to:\n\n"${SENTENCE}"`, ['Bắt đầu'], `conc-ready-${i}`);
  let meter = null;
  let sr = null;
  try {
    if (order === 'app-first') {
      meter = await openMeter();
      await sleep(400);
      sr = openSR('vi-VN');
    } else {
      sr = openSR('vi-VN');
      await sleep(1200);
      meter = await openMeter();
    }
    const tStart = meter.levels.length;
    showStatus(`ĐANG NGHE (lần ${i}) — đọc to:\n\n"${SENTENCE}"`, `conc-listen-${i}`);
    await sleep(7000);
    sr.stop();
    await sleep(1500);
    const lv = meter.levels.slice(tStart).map((x) => x.rms).sort((a, b) => a - b);
    // micro app thật sự có tiếng: mức to (phân vị 95) gấp nhiều lần mức nền (phân vị 20) và không phải toàn số 0
    const quiet = lv[Math.floor(lv.length * 0.2)] || 0;
    const loud = lv[Math.floor(lv.length * 0.95)] || 0;
    const appOk = loud > 0.003 && loud > quiet * 4;
    const sim = similarity(SENTENCE, sr.text);
    const r = { order, srOk: sim > 0.5, sim: +sim.toFixed(2), text: sr.text.trim(), srErr: sr.err, srStarted: sr.started, appOk, quiet: +quiet.toFixed(4), loud: +loud.toFixed(4), ended: meter.ended() };
    diag('SONG SONG ' + JSON.stringify(r));
    return r;
  } finally {
    if (sr) sr.stop();
    if (meter) meter.stop();
  }
}

async function run() {
  if (!SR) return;
  resetReport();
  $('stConc').disabled = true;
  holdScreen('conc', true);
  const res = [];
  try {
    add('info', 'Thử: app thu micro trong lúc Google đang nghe giọng nói (2 lần, đảo thứ tự bật).');
    for (const [i, order] of [[1, 'app-first'], [2, 'google-first']]) {
      const r = await trial(order, i);
      res.push(r);
      const name = order === 'app-first' ? 'micro app bật trước' : 'Google bật trước';
      add(r.srOk && r.appOk ? 'ok' : 'bad',
        `Lần ${i} (${name}): Google ${r.srOk ? `nghe được ("${r.text}", khớp ${Math.round(r.sim * 100)}%)` : `KHÔNG nghe được${r.srErr ? ' (' + r.srErr + ')' : ''}`} · micro app ${r.appOk ? 'có tiếng' : 'KHÔNG có tiếng'} (nền ${r.quiet}, to ${r.loud})`);
    }
    const both = res.some((r) => r.srOk && r.appOk);
    if (both) add('ok', 'KẾT LUẬN: máy này cho nghe song song → làm được chế độ "Google ra chữ + Whisper nhận ai nói".');
    else {
      add('bad', 'KẾT LUẬN: máy này KHÔNG cho nghe song song.');
      issue('Android không cho app và Google cùng thu micro: chế độ ghép "Google ra chữ + Whisper nhận ai nói" không làm được trên máy này.');
    }
  } catch (e) {
    add('bad', 'Lỗi khi thử: ' + (e && e.message));
    issue('Bài thử nghe song song bị lỗi: ' + (e && e.message));
  } finally {
    holdScreen('conc', false);
    $('stConc').disabled = false;
    $('stAsk').textContent = '';
    window.__conc = res; // test tự động đọc
    finish('BÁO CÁO THỬ NGHE SONG SONG');
  }
}

export function initConcurrentTest() {
  $('stConc').onclick = run;
}
