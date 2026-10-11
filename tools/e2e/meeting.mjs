// Test đầu-cuối màn Nghe hội trường với "podcast" GIỌNG NGƯỜI THẬT nói liền (11/10/2026: Lợi Minh test podcast Hàn,
// app đứng im). Ghép N câu tiếng Hàn thật (tools/whisper/real/, cần `node tools/whisper/fetch-real.mjs` trước), cách nhau
// GAP ms, phát vào micro giả; nhận diện là Google thật của Chrome, dịch thật, đọc thật. ANDROID=1 (mặc định) giả lập Chrome
// Android (1 phiên giữ micro, khởi động phiên ~0,6s, final đến muộn 1,5s).
//   node tools/e2e/meeting.mjs [N=12]   GAP=250 DURING=listen|pause BASE_URL=… (test bản đang live)
// Chấm: nghe được = khớp chữ (chuỗi nhận diện ghép lại so với chữ gốc); giữ nghĩa = bản dịch của app so với bản Google
// dịch chữ gốc (cùng máy dịch → chỉ đo phần mất do nghe/cắt câu); độ trễ chốt câu, dịch, đọc.
// KHÔNG đo được ở đây: tiếng loa/tai nghe lọt lại vào micro (micro giả không nghe tiếng app đọc), Bluetooth, máy thật.

import { readFileSync } from 'node:fs';
import { readTool, runInChrome } from './chrome.mjs';
import { similarity } from '../../src/js/scoring.js';

const N = Number(process.argv[2] || 12);
const GAP = Number(process.env.GAP || 250);
const DURING = process.env.DURING || 'listen';
const ANDROID = process.env.ANDROID !== '0';
const dir = new URL('../whisper/real/', import.meta.url);
const items = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).filter((x) => x.lang === 'ko').slice(0, N);
const clips = Object.fromEntries(items.map((x) => [x.file.replace(/\.\w+$/, ''), readFileSync(new URL(x.file, dir)).toString('base64')]));
const seq = items.flatMap((x, i) => (i ? [GAP, x.file.replace(/\.\w+$/, '')] : [x.file.replace(/\.\w+$/, '')]));

const page = `window.__CLIPS=${JSON.stringify(clips)};\n` + readTool('fakemic.js') + `
(async () => {
  await window.__ready;
  window.__androidLike = ${ANDROID};
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('tabMeeting').click();
  document.querySelector('#meetingLangChips [data-lang="ko-KR"]').click();
  if ($('mtgDuring')) { $('mtgDuring').value = ${JSON.stringify(DURING)}; $('mtgDuring').onchange(); }
  $('mtgSpeak').checked = true;
  $('mtgToggle').click();
  await sleep(2500);
  const t0 = performance.now();
  const total = await __say(${JSON.stringify(seq)});
  // cập nhật trạng thái mỗi 500ms: có đứng im không
  const timeline = [];
  const iv = setInterval(() => timeline.push({ t: Math.round(performance.now() - t0), n: document.querySelectorAll('#mtgLog .entry').length,
    live: $('mtgLive') ? !$('mtgLive').hidden : null, out: $('mtgLiveOut') ? $('mtgLiveOut').textContent : '' }), 500);
  await sleep(total + 9000);
  clearInterval(iv);
  const entries = [...document.querySelectorAll('#mtgLog .entry')].reverse().map((e) => ({ src: e.querySelector('.o').textContent, out: e.querySelector('.t').textContent }));
  return { version: $('appVersion').textContent, total: Math.round(total), entries, timeline,
    stats: window.__meeting ? window.__meeting.stats : null, stuck: window.__stuckCount || 0 };
})()`;

const ref = items.map((x) => x.text).join(' ');
async function gtrans(q) {
  const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=vi&dt=t&q=${encodeURIComponent(q)}`;
  return (await (await fetch(u)).json())[0].map((s) => s[0]).join('');
}
const refVi = (await Promise.all(items.map((x) => gtrans(x.text)))).join(' ');
const errors = [];
const r = await runInChrome(page, { errors, timeoutMs: 600000 });
const heard = r.entries.map((e) => e.src).join(' ');
const outVi = r.entries.map((e) => e.out).join(' ');
const pct = (x) => Math.round(x * 100) + '%';
console.log(`${r.version} · ${ANDROID ? 'giả lập Android' : 'Chrome máy tính'} · khi đọc: ${DURING} · podcast ${items.length} câu, ${(r.total / 1000).toFixed(1)}s, ngừng ${GAP}ms`);
console.log(`  số câu app dịch: ${r.entries.length} · nghe được (khớp chữ): ${pct(similarity(ref, heard))} · giữ nghĩa (so bản dịch chuẩn): ${pct(similarity(refVi, outVi))}`);
// đứng im: khoảng dài nhất trong lúc đang phát podcast mà không có câu dịch mới
let last = 0, maxGap = 0, prevN = 0;
for (const p of r.timeline) { if (p.t > r.total + 3000) break; if (p.n > prevN) { maxGap = Math.max(maxGap, p.t - last); last = p.t; prevN = p.n; } }
maxGap = Math.max(maxGap, Math.min(r.total + 3000, r.timeline.at(-1)?.t || 0) - last);
console.log(`  lâu nhất không có câu dịch mới trong lúc podcast chạy: ${(maxGap / 1000).toFixed(1)}s · phiên nhận diện treo: ${r.stuck}`);
if (r.stats) {
  const s = r.stats;
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const during = s.reads.filter((x) => x.startAt < r.total + 2500).length;
  console.log(`  dịch xong sau khi chốt câu TB ${avg(s.lines.map((x) => x.shownAt - x.heardAt))}ms · lượt đọc: ${s.reads.length}, bỏ đọc ${s.skipped || 0} câu cũ (${during} lượt đọc trong lúc podcast còn chạy) · bắt đầu đọc sau khi chốt câu TB ${avg(s.reads.map((x) => x.lagMs))}ms, lâu nhất ${Math.max(0, ...s.reads.map((x) => x.lagMs))}ms`);
  console.log(`  cách chốt câu: ${Object.entries(s.lines.reduce((m, x) => ((m[x.why] = (m[x.why] || 0) + 1), m), {})).map(([k, v]) => k + ' ' + v).join(', ')}`);
}
if (process.env.SHOW) r.entries.forEach((e, i) => console.log(`  ${i + 1}. ${e.src}\n     → ${e.out}`));
const lv = r.timeline.filter((p) => p.t < r.total);
console.log(`  phụ đề chạy: hiện ${pct(lv.filter((p) => p.live).length / (lv.length || 1))} thời gian podcast · có bản dịch tạm ${pct(lv.filter((p) => p.live && p.out).length / (lv.length || 1))}`);
console.log('  lỗi JS:', errors.length ? errors : 'không');
