// node tools/whisper/chrome-sr.mjs — khớp chữ của nhận diện Chrome (Google) trên giọng người thật (tools/whisper/real/)
import { readFileSync } from 'node:fs';
import { readTool, runInChrome } from '../e2e/chrome.mjs';
const dir = new URL('real/', import.meta.url);
const items = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).filter((x, i) => !process.env.ONLY || x.lang === process.env.ONLY);
const clips = Object.fromEntries(items.map((x) => [x.file.replace(/\.\w+$/, ''), readFileSync(new URL(x.file, dir)).toString('base64')]));
const page = `window.__CLIPS=${JSON.stringify(clips)};\n` + readTool('fakemic.js') + `\nwindow.__SR=${JSON.stringify({ items })};\n` + readFileSync(new URL('chrome-sr-page.js', import.meta.url), 'utf8');
const rows = await runInChrome(page, { timeoutMs: 3600000 });
const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / (a.length || 1));
for (const l of ['vi', 'ko', 'en']) { const xs = rows.filter((x) => x.lang === l); if (xs.length) console.log(`Chrome/Google ${l}: khớp chữ TB ${avg(xs.map((x) => x.sim * 100))}% (${xs.length} câu)`); }
if (process.env.SHOW) for (const x of rows) console.log(`  ${x.file} ${x.sim} "${x.text.slice(0, 80)}"`);
