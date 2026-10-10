// Đo Whisper trên giọng người thật (tools/whisper/real/, tải bằng fetch-real.mjs): nhận đúng tiếng (2 cách) và khớp chữ,
// ở điều kiện thu sạch và giả lập micro tai nghe Bluetooth.   node tools/whisper/real.mjs tiny,base [webgpu|wasm]
import { readFileSync } from 'node:fs';
import { runInChrome } from '../e2e/chrome.mjs';
const sizes = (process.argv[2] || 'tiny,base').split(',');
const device = process.argv[3] || 'webgpu';
const dir = new URL('real/', import.meta.url);
let items = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const files = Object.fromEntries(items.map((x) => [x.file, readFileSync(new URL(x.file, dir)).toString('base64')]));
const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: process.env.DEC || 'fp16' } : 'q8';
// MODEL_DTYPE='{"encoder_model":"fp32","decoder_model_merged":"fp32"}' ép kiểu số; LANG=vi ép tiếng (mô hình chuyên 1 tiếng);
// ONLY=vi chỉ đo câu tiếng Việt
const md = process.env.MODEL_DTYPE ? JSON.parse(process.env.MODEL_DTYPE) : dtype;
const models = sizes.map((s) => ({ id: s.includes('/') ? s : `onnx-community/whisper-${s}`, dtype: md, device, lang: process.env.LANG_FORCE || null }));
if (process.env.ONLY) items.splice(0, items.length, ...items.filter((x) => x.lang === process.env.ONLY));
const page = `window.__REAL=${JSON.stringify({ lib: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1', models, files, items, prompt: process.env.PROMPT ? 'ISO 9001, KPI, FSC, BRC, CAPA, audit.' : null })};\n` + readFileSync(new URL('real-page.js', import.meta.url), 'utf8');
const res = await runInChrome(page, { timeoutMs: 3600000 });
if (!res) process.exit(2);
const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / (a.length || 1));
for (const r of res) {
  if (r.error) { console.log(r.model.id, r.error); continue; }
  console.log(`\n== ${r.model.id} (${device} ${JSON.stringify(r.model.dtype)}) nạp ${r.loadMs}ms`);
  for (const cond of ['sạch', 'bluetooth']) {
    for (const l of ['vi', 'ko', 'en'].filter((l) => r.rows.some((x) => x.lang === l))) {
      const xs = r.rows.filter((x) => x.cond === cond && x.lang === l);
      console.log(`  ${cond.padEnd(9)} ${l}: đúng tiếng (Việt/đối tác) ${xs.filter((x) => x.ok2).length}/${xs.length} · (trong 5 tiếng) ${xs.filter((x) => x.ok5).length}/${xs.length} · khớp chữ TB ${avg(xs.map((x) => x.sim * 100))}% · ${avg(xs.map((x) => x.ms))}ms/câu ${(xs.reduce((s, x) => s + x.dur, 0) / xs.length).toFixed(1)}s`);
    }
  }
  if (process.env.SHOW) for (const x of r.rows.filter((x) => x.cond === 'bluetooth').slice(0, 30)) console.log(`    ${x.file} ${x.top5} ${x.sim} "${x.text.slice(0, 80)}"`);
}
