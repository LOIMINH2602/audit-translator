// Test đầu-cuối app (làm lại 01/11/2026): phát giọng nói vào micro giả → bộ nhận diện Google thật của Chrome → app dịch.
//   node tools/e2e/live.mjs [ko|en|zh|ja] [N=10]
//   GAP=1200 ms ngừng giữa các câu (250 = nói liền kiểu podcast) · ANDROID=0 tắt giả lập Chrome Android
//   STEAL=0 tắt giả lập "trang mở thêm micro thì bộ nhận diện chỉ nhận im lặng" (lỗi thật trên điện thoại 01/11 — mặc định bật)
//   NETERR=1 giả 1 lỗi mạng của bộ nhận diện ngay sau khi bắt đầu (ảnh thật 01/11: dòng đỏ "không kết nối" hiện mãi dù chữ vẫn ra)
//   MOCK_TR=300 dịch giả lập (khi Google chặn máy test) · BASE_URL=… test link thật · SHOW=1 in từng câu · CHIP=ja-JP chọn sai tiếng
// Giọng: ko/en = người thật (tools/whisper/real/, tải bằng `node tools/whisper/fetch-real.mjs`); zh/ja = giọng Google đọc.
// Chấm: số câu dịch, nghe được (khớp chữ), độ trễ THẬT theo mốc âm thanh (chữ = đầu câu → có chữ; chốt = cuối câu → bản dịch
// chốt), số lần app mở thêm micro (phải = 0), lời báo trên màn hình, lỗi JS.
import { readFileSync } from 'node:fs';
import { loadClips, readTool, runInChrome } from './chrome.mjs';
import { similarity } from './similarity.mjs';

const L = process.argv[2] || 'ko';
const N = Number(process.argv[3] || 10);
const GAP = Number(process.env.GAP || 1200);
const ANDROID = process.env.ANDROID !== '0';
const STEAL = process.env.STEAL !== '0';
const MOCK_TR = Number(process.env.MOCK_TR || 0);
const SR_LANG = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' }[L];
const strip = (f) => f.replace(/\.\w+$/, '');

let items;
let clips;
if (L === 'ko' || L === 'en') {
  const dir = new URL('../whisper/real/', import.meta.url);
  const real = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).filter((x) => x.lang === L).slice(0, N);
  items = real.map((x) => ({ id: strip(x.file), text: x.text }));
  clips = Object.fromEntries(real.map((x) => [strip(x.file), readFileSync(new URL(x.file, dir)).toString('base64')]));
} else {
  const FIX = {
    zh: ['请让我看一下纠正措施记录。', '质量手册在哪里？', '我们在仓库发现了一项不符合项。', '请问你们的员工培训记录在哪里？'],
    ja: ['是正措置の記録を見せてください。', '品質マニュアルはどこにありますか。', '倉庫で不適合が一件見つかりました。', '従業員の教育記録はどこにありますか。'],
  }[L];
  const pre = L === 'zh' ? 'zh-CN-' : 'ja-';
  const S = Object.fromEntries(FIX.map((t, i) => [pre + (i + 1), [L === 'zh' ? 'zh-CN' : 'ja', t]]));
  const all = await loadClips(S);
  items = Array.from({ length: Math.max(4, N) }, (_, i) => ({ id: pre + ((i % 4) + 1), text: FIX[i % 4] }));
  clips = Object.fromEntries(Object.keys(S).map((k) => [k, all[k]]));
}
const seq = items.flatMap((x, i) => (i ? [GAP, x.id] : [x.id]));

const page = `window.__CLIPS=${JSON.stringify(clips)};\n` + readTool('fakemic.js') + `
(async () => {
  await window.__ready;
  window.__androidLike = ${ANDROID};
  window.__steal = ${STEAL};
  window.__gumCalls = 0;
  navigator.mediaDevices.getUserMedia = async () => { window.__gumCalls++; window.__micTaken = true; return new MediaStream([window.__fakeTrack.clone()]); };
  if (${MOCK_TR}) {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const url = String(u);
      if (!/translate.googleapis|mymemory/.test(url)) return real(u, o);
      const q = new URL(url).searchParams.get('q');
      await new Promise((r) => setTimeout(r, ${MOCK_TR}));
      return new Response(JSON.stringify([[['[vi] ' + q]]]), { headers: { 'content-type': 'application/json' } });
    };
  }
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !window.__appReady; i++) await sleep(100);
  if (!window.__appReady) return { error: 'app không nạp xong sau 20 giây' };
  document.querySelector('#langs [data-lang="${process.env.CHIP || SR_LANG}"]').click();
  const SRP = window.webkitSpeechRecognition.prototype;
  const st = SRP.start;
  SRP.start = function (...a) { window.__lastSR = this; return st.apply(this, a); };
  $('toggle').click();
  await sleep(2500);
  if (${Boolean(process.env.NETERR)} && window.__lastSR && window.__lastSR.onerror) window.__lastSR.onerror({ error: 'network' });
  const ids = ${JSON.stringify(items.map((x) => x.id))};
  const marks = [];
  let t = performance.now() + 100; // __say phát sau 100ms
  for (let i = 0; i < ids.length; i++) { if (i) t += ${GAP}; const d = __dur(ids[i]); const sp = __span(ids[i]); marks.push({ start: t + sp[0], end: t + sp[1] }); t += d; }
  const ev = [];
  new MutationObserver(() => ev.push({ t: performance.now(), k: 'src' })).observe($('liveSrc'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => ev.push({ t: performance.now(), k: 'log' })).observe($('history'), { childList: true });
  const warns = [];
  new MutationObserver(() => { const w = $('warn').hidden ? '' : $('warn').textContent; if (w && warns.at(-1) !== w) warns.push(w); })
    .observe($('warn'), { attributes: true, childList: true, characterData: true, subtree: true });
  const total = await __say(${JSON.stringify(seq)});
  await sleep(total + 6000);
  return { version: $('version').textContent, total: Math.round(total), history: window.__app.history, marks, ev, gum: window.__gumCalls, warns,
    warn: $('warn').hidden ? '' : $('warn').textContent, log: $('log').textContent };
})()`;

const errors = [];
const r = await runInChrome(page, { errors, timeoutMs: 900000 });
if (!r || r.error) {
  console.log('KẾT QUẢ LẠ:', JSON.stringify(r));
  process.exit(1);
}
const pct = (x) => Math.round(x * 100) + '%';
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
const sec = (ms) => (ms === null ? '–' : (ms / 1000).toFixed(2) + 's');
const textLat = [];
const finalLat = [];
r.marks.forEach((m, i) => {
  const next = r.marks[i + 1];
  const s = r.ev.find((x) => x.k === 'src' && x.t > m.start - 100 && (!next || x.t < next.start));
  if (s) textLat.push(s.t - m.start);
  const fs = r.ev.filter((x) => x.k === 'log' && x.t > m.end && x.t < (next ? next.start + 500 : Infinity));
  if (fs.length) finalLat.push(fs.at(-1).t - m.end);
});
const heard = r.history.map((x) => x.src).join(' ');
console.log(`${r.version} · tiếng ${L} · ${ANDROID ? 'giả lập Android' : 'Chrome máy tính'}${STEAL ? ' + giả lập micro bị chiếm' : ''} · ${items.length} câu, ngừng ${GAP}ms, ${Math.round(r.total / 1000)}s${MOCK_TR ? ' · dịch giả lập ' + MOCK_TR + 'ms' : ''}`);
console.log(`  câu đã dịch: ${r.history.length} · nghe được (khớp chữ): ${pct(similarity(items.map((x) => x.text).join(' '), heard))}`);
console.log(`  THẬT: chữ hiện sau khi bắt đầu nói ${sec(q(textLat, 0.5))} (chậm nhất 10% ${sec(q(textLat, 0.9))}) · dịch chốt sau khi hết câu ${sec(q(finalLat, 0.5))} (chậm nhất 10% ${sec(q(finalLat, 0.9))})`);
console.log(`  lời báo trên màn hình: ${r.warn || '(không có)'}`);
console.log(`  dòng đỏ đã hiện trong buổi: ${r.warns.length ? r.warns.map((w) => '"' + w.slice(0, 60) + '"').join(', ') : '(không lần nào)'}`);
console.log(`  app mở thêm micro: ${r.gum} lần · lỗi JS: ${errors.length ? errors.join(' | ') : 'không'}`);
if (process.env.SHOW) r.history.forEach((x, i) => console.log(`  ${i + 1}. ${x.src}\n     → ${x.vi}`));
if (!r.history.length || process.env.LOG) console.log('NHẬT KÝ:\n' + r.log);
