// Đổi số phiên bản: node tools/bump.mjs 2026-11-02.1 — thay mọi "?v=<cũ>" và VERSION trong src/ để máy không nạp lẫn file cũ/mới.
import { readFileSync, writeFileSync } from 'node:fs';
const next = process.argv[2];
if (!/^\d{4}-\d\d-\d\d\.\d+$/.test(next || '')) throw new Error('cần số phiên bản dạng YYYY-MM-DD.N');
const app = readFileSync('src/js/app.js', 'utf8');
const cur = app.match(/export const VERSION = '([^']+)'/)[1];
for (const f of ['src/index.html', 'src/js/app.js']) {
  writeFileSync(f, readFileSync(f, 'utf8').split(cur).join(next));
}
console.log(cur, '→', next);
