// Test đầu-cuối màn Nghe hội trường (phụ đề dịch real time, chỉ hiện chữ — 16/10/2026).
//   node tools/e2e/meeting.mjs [ko|en|zh|ja] [N=10]   GAP=1200 (ms ngừng giữa các câu; 250 = nói liền kiểu podcast)
//   ANDROID=0 (mặc định giả lập Chrome Android), BASE_URL=… (test bản đang live), SHOW=1 in từng câu, DIAG=1 nhật ký
//   MOCK_TR=300: dịch giả lập (trả "[vi] <câu>" sau 300ms) — khi Google chặn máy test; chỉ đo được độ trễ + nghe được, không đo nghĩa
// Giọng: ko/en = GIỌNG NGƯỜI THẬT (tools/whisper/real/, cần `node tools/whisper/fetch-real.mjs`); zh/ja = giọng Google đọc
// (chưa có bộ giọng thật) — các câu Hàn thật được Google dịch sang Trung/Nhật rồi đọc.
// Nhận diện Google thật của Chrome, dịch thật. Chấm:
//  - độ trễ APP TỰ ĐO (con số hiện trên màn hình điện thoại) và độ trễ THẬT tính từ mốc âm thanh của từng câu (biết trước):
//    chữ = đầu câu → phụ đề có chữ mới; chốt = cuối câu → bản dịch chốt của câu đó hiện ra (câu sau khi đã ngừng ≥ GAP).
//  - nghe được = khớp chữ (chuỗi đã chốt ghép lại so với chữ gốc); giữ nghĩa = bản dịch của app so với bản Google dịch chữ gốc.
// KHÔNG đo được ở đây: micro thật trong phòng (xa người nói, vọng, ồn), mạng di động, tốc độ điện thoại.

import { readFileSync } from 'node:fs';
import { loadClips, readTool, runInChrome } from './chrome.mjs';
import { similarity } from '../../src/js/scoring.js';

const L = process.argv[2] || 'ko';
const N = Number(process.argv[3] || 10);
const GAP = Number(process.env.GAP || 1200);
const ANDROID = process.env.ANDROID !== '0';
const SR_LANG = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' }[L];
const TL = { ko: 'ko', en: 'en', zh: 'zh-CN', ja: 'ja' }[L];
const MOCK_TR = Number(process.env.MOCK_TR || 0);
const strip = (f) => f.replace(/\.\w+$/, '');

async function gtrans(q, sl, tl) {
  const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(q)}`;
  return (await (await fetch(u)).json())[0].map((s) => s[0]).join('');
}

const dir = new URL('../whisper/real/', import.meta.url);
const real = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
let items, clips;
if (L === 'ko' || L === 'en') {
  items = real.filter((x) => x.lang === L).slice(0, N).map((x) => ({ id: strip(x.file), text: x.text }));
  clips = Object.fromEntries(real.filter((x) => x.lang === L).slice(0, N).map((x) => [strip(x.file), readFileSync(new URL(x.file, dir)).toString('base64')]));
} else {
  try {
  const src = real.filter((x) => x.lang === 'ko').slice(0, N);
  const texts = [];
  for (const x of src) texts.push(await gtrans(x.text, 'ko', TL));
  const S = Object.fromEntries(texts.map((t, i) => [`m${L}-${i}`, [TL, t.slice(0, 190)]]));
  const all = await loadClips(S); // Google TTS, lưu tools/e2e/audio/
  items = Object.keys(S).map((id) => ({ id, text: S[id][1] }));
  clips = Object.fromEntries(items.map((x) => [x.id, all[x.id]]));
  } catch (e) {
    // Google chặn máy test (không dịch / không tạo được giọng mới): dùng 4 câu audit giọng Google có sẵn (tools/e2e/audio), lặp 2 lần
    console.log('  (không tạo được mẫu mới: ' + e.message.slice(0, 60) + ' → dùng 4 câu có sẵn × 2)');
    const FIX = {
      zh: ['请让我看一下纠正措施记录。', '质量手册在哪里？', '我们在仓库发现了一项不符合项。', '请问你们的员工培训记录在哪里？'],
      ja: ['是正措置の記録を見せてください。', '品質マニュアルはどこにありますか。', '倉庫で不適合が一件見つかりました。', '従業員の教育記録はどこにありますか。'],
    }[L];
    const pre = L === 'zh' ? 'zh-CN-' : 'ja-';
    const all = await loadClips({});
    items = [...FIX, ...FIX].map((t, i) => ({ id: pre + ((i % 4) + 1), text: t }));
    clips = Object.fromEntries([1, 2, 3, 4].map((k) => [pre + k, all[pre + k]]));
  }
}
const seq = items.flatMap((x, i) => (i ? [GAP, x.id] : [x.id]));

const page = `window.__CLIPS=${JSON.stringify(clips)};\n` + readTool('fakemic.js') + `
(async () => {
  await window.__ready;
  window.__androidLike = ${ANDROID};
  // micro đo âm lượng (onset.js) nghe cùng nguồn âm thanh với bộ nhận diện
  navigator.mediaDevices.getUserMedia = async () => new MediaStream([window.__fakeTrack.clone()]);
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
  $('tabMeeting').click();
  document.querySelector('#meetingLangChips [data-lang="${SR_LANG}"]').click();
  $('mtgToggle').click();
  await sleep(2500);
  // mốc thật của từng câu (theo giờ trang)
  const ids = ${JSON.stringify(items.map((x) => x.id))};
  const t0 = performance.now() + 100; // __say bắt đầu phát sau 100ms
  const marks = [];
  let t = t0;
  for (let i = 0; i < ids.length; i++) { if (i) t += ${GAP}; const d = __dur(ids[i]); const sp = __span(ids[i]); marks.push({ start: t + sp[0], end: t + sp[1], lead: sp[0], tail: d - sp[1] }); t += d; }
  const ev = []; // thay đổi phụ đề và câu chốt, kèm giờ
  new MutationObserver(() => ev.push({ t: performance.now(), k: 'src', v: $('mtgLiveSrc').textContent })).observe($('mtgLiveSrc'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => ev.push({ t: performance.now(), k: 'log', n: document.querySelectorAll('#mtgLog .entry').length })).observe($('mtgLog'), { childList: true });
  const total = await __say(${JSON.stringify(seq)});
  await sleep(total + 6000);
  const entries = [...document.querySelectorAll('#mtgLog .entry')].reverse().map((e) => ({ src: e.querySelector('.o').textContent, out: e.querySelector('.t').textContent }));
  const lat = [...document.querySelectorAll('#mtgLat .lat-row')].map((r) => r.dataset.k + ': ' + r.querySelector('b').textContent);
  return { version: $('appVersion').textContent, total: Math.round(total), entries, marks, ev, lat, stats: window.__meeting.stats, diag: $('diagLog').textContent };
})()`;

const errors = [];
const r = await runInChrome(page, { errors, timeoutMs: 900000 });
if (!r || !r.entries) { console.log('KẾT QUẢ LẠ:', JSON.stringify(r).slice(0, 1500)); process.exit(1); }
let refVi = null;
if (!MOCK_TR) try { refVi = (await Promise.all(items.map((x) => gtrans(x.text, TL, 'vi')))).join(' '); } catch (_) {}
const pct = (x) => Math.round(x * 100) + '%';
const sec = (ms) => (ms / 1000).toFixed(2) + 's';
const summ = (xs) => {
  if (!xs.length) return 'không có số liệu';
  const a = xs.slice().sort((p, q) => p - q);
  return `trung vị ${sec(a[Math.floor(a.length / 2)])} · chậm nhất 10% ${sec(a[Math.min(a.length - 1, Math.floor(0.9 * a.length))])} (${a.length} lần)`;
};
console.log(`${r.version} · tiếng ${L} (${L === 'ko' || L === 'en' ? 'giọng người thật' : 'giọng Google đọc'}) · ${ANDROID ? 'giả lập Chrome Android' : 'Chrome máy tính'} · ${items.length} câu, ngừng ${GAP}ms, ${(r.total / 1000).toFixed(0)}s`);
console.log(`  số câu chốt: ${r.entries.length} · nghe được (khớp chữ): ${pct(similarity(items.map((x) => x.text).join(' '), r.entries.map((e) => e.src).join(' ')))} · giữ nghĩa: ${refVi ? pct(similarity(refVi, r.entries.map((e) => e.out).join(' '))) : (MOCK_TR ? 'không đo (dịch giả lập ' + MOCK_TR + 'ms)' : 'không đo (Google chặn máy test)')}`);
console.log(`  APP TỰ ĐO (màn hình): ${r.lat.join(' | ')}`);
// độ trễ thật: chữ = đầu câu → lần đầu phụ đề đổi sau đó; chốt = cuối câu → câu chốt đầu tiên xuất hiện sau đó (trước đầu câu kế + 1 GAP)
const textReal = [], finalReal = [];
for (let i = 0; i < r.marks.length; i++) {
  const m = r.marks[i];
  const e = r.ev.find((x) => x.k === 'src' && x.t > m.start && x.v);
  if (e && (!r.marks[i + 1] || e.t < r.marks[i + 1].start)) textReal.push(e.t - m.start);
  // mảnh chốt cuối cùng của câu i: câu chốt cuối xuất hiện sau khi hết câu và trước khi câu kế kịp nói ~0,7s
  const lim = r.marks[i + 1] ? r.marks[i + 1].start + 500 : Infinity;
  const fs = r.ev.filter((x) => x.k === 'log' && x.t > m.end && x.t < lim);
  if (fs.length) finalReal.push(fs.at(-1).t - m.end);
}
const avgLead = Math.round(r.marks.reduce((a, m) => a + m.lead, 0) / r.marks.length);
console.log(`  (lặng đầu file TB ${avgLead}ms, đã trừ khỏi mốc thật)`);
console.log(`  THẬT (theo mốc âm thanh): chữ hiện sau khi bắt đầu nói ${summ(textReal)} · bản dịch chốt sau khi hết câu ${summ(finalReal)}`);
const s = r.stats.lat;
console.log(`  app tự đo chi tiết: chữ ${summ(s.text)} · dịch tạm ${summ(s.draft)} · chốt ${summ(s.final)}`);
console.log(`  cách chốt câu: ${Object.entries(r.stats.lines.reduce((m, x) => ((m[x.why] = (m[x.why] || 0) + 1), m), {})).map(([k, v]) => k + ' ' + v).join(', ')}`);
if (process.env.DIAG) console.log(r.diag.split('\n').filter((l) => /chốt|LỖI|CẢNH BÁO/.test(l)).join('\n'));
if (process.env.SHOW) r.entries.forEach((e, i) => console.log(`  ${i + 1}. ${e.src}\n     → ${e.out}`));
console.log('  lỗi JS:', errors.length ? errors : 'không');
