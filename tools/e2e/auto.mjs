// Test đầu-cuối chế độ "Tự nhận người nói" (Whisper + VAD chạy trên máy) với micro giả, không cần điện thoại.
//   node tools/e2e/auto.mjs [ko-KR|en-US|zh-CN|ja-JP] [tiny|base] [wasm|webgpu]   NOISE=0.05 ENDSIL=600
//   DLG=1: chạy cả màn 1:1 (dịch, đọc, bỏ âm thanh micro lúc đọc) thay vì chỉ bộ nghe; MODE=hybrid|auto (cách nghe);
//   ANDROID=1 giả lập Chrome Android; REAL=1 dùng giọng người thật
// Kịch bản hội thoại xen kẽ, có câu trả lời rất ngắn ("Vâng", "네") và người nói nói 2 câu liền.
// Độ chính xác giống trên điện thoại; tốc độ thì không (máy tính nhanh hơn) — tốc độ thật đo trên máy bằng tab Tự kiểm tra.

import { loadClips, readTool, runInChrome } from './chrome.mjs';

const partner = process.argv[2] || 'ko-KR';
const model = process.argv[3] || 'base';
const device = process.argv[4] || 'wasm';
const p = partner === 'en-US' ? 'en' : partner === 'zh-CN' ? 'zh-CN' : partner.slice(0, 2);
const pw = partner === 'zh-CN' ? 'zh' : p;
const S = {
  'vi-7': ['vi', 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.'],
  'vi-23': ['vi', 'Anh cho tôi xem biên bản kiểm tra đầu vào tháng trước.'],
  'vi-24': ['vi', 'Đúng rồi.'],
  'vi-25': ['vi', 'Công nhân có được đào tạo về an toàn lao động không?'],
  'vi-s1': ['vi', 'Vâng.'],
  'vi-t2': ['vi', 'Chứng chỉ ISO 9001 còn hiệu lực đến năm nào?'],
  'en-1': ['en', 'Please show me the corrective action records.'], 'en-2': ['en', 'Where is the quality manual?'],
  'en-3': ['en', 'We found one non conformity in the warehouse.'], 'en-4': ['en', 'Where are your employee training records?'],
  'en-s1': ['en', 'Yes.'],
  'ko-1': ['ko', '시정 조치 기록을 보여 주세요.'], 'ko-2': ['ko', '품질 매뉴얼은 어디에 있습니까?'],
  'ko-3': ['ko', '창고에서 부적합 사항이 하나 발견되었습니다.'], 'ko-4': ['ko', '직원 교육 기록은 어디에 있습니까?'],
  'ko-s1': ['ko', '네.'],
  'zh-CN-1': ['zh-CN', '请让我看一下纠正措施记录。'], 'zh-CN-2': ['zh-CN', '质量手册在哪里？'],
  'zh-CN-3': ['zh-CN', '我们在仓库发现了一项不符合项。'], 'zh-CN-4': ['zh-CN', '请问你们的员工培训记录在哪里？'],
  'zh-s1': ['zh-CN', '是的。'],
  'ja-1': ['ja', '是正措置の記録を見せてください。'], 'ja-2': ['ja', '品質マニュアルはどこにありますか。'],
  'ja-3': ['ja', '倉庫で不適合が一件見つかりました。'], 'ja-4': ['ja', '従業員の教育記録はどこにありますか。'],
  'ja-s1': ['ja', 'はい。'],
};
let clips = await loadClips(S);
const ps = (k) => (p === 'zh-CN' ? `zh-${k}` : `${p}-${k}`);
const pc = (n) => `${p}-${n}`;
// [ai nói, mẫu, ngừng sau đó ms]
let script = [
  ['me', 'vi-7', 1500], ['partner', pc(1), 1500], ['me', 'vi-s1', 1500], ['partner', pc(2), 900], ['partner', pc(3), 1500],
  ['me', 'vi-25', 1500], ['partner', ps('s1'), 1500], ['me', 'vi-t2', 1500], ['partner', pc(4), 1500], ['me', 'vi-24', 1500], ['me', 'vi-23', 1500],
];
let truth = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v[1]]));
// REAL=1: giọng NGƯỜI THẬT (tools/whisper/real/, tải bằng tools/whisper/fetch-real.mjs) cho câu dài; câu ngắn vẫn là mẫu Google
if (process.env.REAL) {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../whisper/real/', import.meta.url);
  const idx = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  const pl = p === 'zh-CN' ? 'zh' : p;
  const vi = idx.filter((x) => x.lang === 'vi');
  const pr = idx.filter((x) => x.lang === pl);
  if (!pr.length) throw new Error('không có giọng thật tiếng ' + pl + ' trong tools/whisper/real');
  for (const x of [...vi.slice(0, 6), ...pr.slice(0, 6)]) {
    const k = 'real-' + x.file.replace(/\.\w+$/, '');
    clips[k] = readFileSync(new URL(x.file, dir)).toString('base64');
    truth[k] = x.text;
  }
  const V = (i) => 'real-' + vi[i].file.replace(/\.\w+$/, '');
  const P = (i) => 'real-' + pr[i].file.replace(/\.\w+$/, '');
  script.splice(0, script.length,
    ['me', V(0)], ['partner', P(0)], ['me', V(1)], ['me', V(2)], ['partner', P(1)], ['partner', P(2)],
    ['me', 'vi-24'], ['partner', P(3)], ['partner', ps('s1')], ['me', V(3)], ['me', V(4)], ['partner', P(4)]);
}
const cfg = { partner, partnerW: pw, model, device, listenMode: process.env.MODE || 'auto', android: Boolean(process.env.ANDROID), endSilenceMs: Number(process.env.ENDSIL || 600), script, truth, prompt: process.env.PROMPT ? 'ISO 9001, KPI, FSC, BRC, CAPA.' : null };
const page = `window.__CLIPS=${JSON.stringify(clips)};\nwindow.__noise=${Number(process.env.NOISE || 0)};\n` + readTool('fakemic.js') +
  `\nwindow.__AUTO=${JSON.stringify(cfg)};\n` + readTool('auto-page.js');
const errors = [];
// DLG=1: chạy màn 1:1 thật (dịch + đọc + bỏ âm thanh micro khi đang đọc), chấm theo biên bản của app
if (process.env.DLG) {
  const pg = page.replace(readTool('auto-page.js'), readTool('auto-dlg-page.js'));
  const d = await runInChrome(pg, { errors, timeoutMs: 1800000 });
  if (!d) process.exit(2);
  if (d.error) { console.log('LỖI:', d.error); process.exit(2); }
  const ok = d.steps.filter((x) => x.ok).length;
  const hs = d.steps.filter((x) => x.hear != null).map((x) => x.hear);
  const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / (a.length || 1));
  console.log(`${partner} · màn 1:1 cách nghe ${cfg.listenMode} (whisper-${model}) · nạp ${d.loadMs}ms · đúng ${ok}/${d.steps.length} · dứt lời → nghe bản dịch TB ${avg(hs)}ms (max ${Math.max(...hs)}) · khớp chữ TB ${avg(d.steps.map((x) => x.sim * 100))}% · câu thừa ${d.extra}`);
  const all = d.steps.flatMap((x) => x.srcs);
  console.log(`  nguồn chữ: Google ${all.filter((x) => x === 'Google').length} · PhoWhisper ${all.filter((x) => x === 'PhoWhisper').length} · Whisper ${all.filter((x) => x === 'Whisper').length}`);
  for (const x of d.steps) console.log(`  ${x.ok ? 'ĐÚNG' : 'SAI '} ${x.side.padEnd(7)} ${x.clip.padEnd(10)} nghe ${x.hear}ms · khớp ${x.sim} · ${x.got.slice(0, 230)}`);
  for (const l of d.diag) if (process.env.FULLDIAG ? true : /Bỏ|LỖI|chuyển/.test(l)) console.log('    ' + l.slice(9, 220));
  if (errors.length) console.log('  LỖI JS:', errors.slice(0, 3));
  process.exit(ok === d.steps.length && !d.extra && !errors.length ? 0 : 1);
}
const r = await runInChrome(page, { errors, timeoutMs: 1800000 });
if (!r) process.exit(2);
if (r.error) { console.log(r.error, r.errors); process.exit(2); }
const ok = r.res.filter((x) => x.ok).length;
const lat = r.res.filter((x) => x.latency != null).map((x) => x.latency);
const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / (a.length || 1));
console.log(`${partner} · whisper-${model} ${r.info.device} · nạp ${r.loadMs}ms · đúng người nói ${ok}/${r.res.length} · dứt lời → có chữ TB ${avg(lat)}ms (max ${Math.max(...lat)}) · Whisper TB ${avg(r.res.filter((x) => x.asrMs).map((x) => x.asrMs))}ms · khớp chữ TB ${avg(r.res.map((x) => x.sim * 100))}%`);
console.log('  nạp: ' + r.stages.join(', '));
if (process.env.TIMES) { console.log('  dứt lời các lượt (ms):', r.turnEnds.join(' ')); console.log('  hết câu theo VAD (ms):', r.got.map((g) => `${g.endRel} ${g.lang} "${g.text}"`).join(' | ')); }
console.log('  Whisper từng câu (câu ms → đặc trưng + giải mã/token, chờ hàng): ' + r.got.map((g) => `${g.audioMs}→${g.featMs}+${g.genMs}/${g.tokens}t q${g.queuedMs}`).join(' · '));
for (const x of r.res) console.log(`  ${x.ok ? 'ĐÚNG' : 'SAI '} ${x.side.padEnd(7)} ${x.clip.padEnd(8)} → ${x.lang} p=${x.prob} · ${x.latency}ms · khớp ${x.sim} · ${x.n} câu: "${x.text.slice(0, 120)}"`);
if (r.dropped.length) console.log('  bỏ:', r.dropped.map((d) => `${d.why}: "${d.text}"`).join(' | '));
if (r.extra) console.log('  câu thừa:', r.extra);
if (r.errors.length || errors.length) console.log('  LỖI:', [...r.errors, ...errors].slice(0, 5));
process.exit(ok === r.res.length ? 0 : 1);
