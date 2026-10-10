// Tải mẫu GIỌNG NGƯỜI THẬT (không phải giọng máy đọc) để đo Whisper đúng thực tế — 10/10/2026 Lợi Minh báo trên điện thoại
// "dịch loạn, không nhận được ai nói", trong khi đo bằng giọng Google TTS thì 95%. Lưu vào tools/whisper/real/ (không commit:
// dữ liệu của bên thứ ba, chỉ dùng đo nội bộ).
//   node tools/whisper/fetch-real.mjs [số câu mỗi tiếng]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
const N = Number(process.argv[2] || 25);
const out = new URL('real/', import.meta.url);
mkdirSync(out, { recursive: true });
const SETS = [
  { lang: 'vi', ds: 'doof-ferb/vlsp2020_vinai_100h', config: 'default', split: 'train', total: 56000, text: (r) => r.transcription },
  { lang: 'ko', ds: 'Bingsu/zeroth-korean', config: 'default', split: 'test', total: 450, text: (r) => r.text },
  { lang: 'en', ds: 'hf-internal-testing/librispeech_asr_dummy', config: 'clean', split: 'validation', total: 73, text: (r) => r.text.toLowerCase() },
];
const index = [];
// máy chủ dữ liệu hay trả 502 tạm thời: thử lại tối đa 5 lần
async function getJson(url) {
  for (let k = 0; k < 5; k++) {
    const r = await fetch(url);
    const t = await r.text();
    try { return JSON.parse(t); } catch (_) { await new Promise((res) => setTimeout(res, 1500 * (k + 1))); }
  }
  return {};
}
for (const s of SETS) {
  for (let i = 0; i < N; i++) {
    const off = Math.floor((i * s.total) / N); // cách quãng: nhiều người nói khác nhau
    const r = await getJson(`https://datasets-server.huggingface.co/rows?dataset=${s.ds}&config=${s.config}&split=${s.split}&offset=${off}&length=1`);
    if (!r.rows) { console.log('lỗi', s.lang, off, JSON.stringify(r).slice(0, 120)); continue; }
    const row = r.rows[0].row;
    const src = row.audio[0].src;
    const ext = src.includes('.flac') ? 'flac' : 'wav';
    const name = `${s.lang}-${String(i).padStart(2, '0')}.${ext}`;
    if (!existsSync(new URL(name, out))) writeFileSync(new URL(name, out), Buffer.from(await fetch(src).then((x) => x.arrayBuffer())));
    const keys = Object.keys(row).filter((k) => k !== 'audio');
    const text = s.text(row) ?? row[keys.find((k) => typeof row[k] === 'string' && k !== 'file' && k !== 'id')];
    index.push({ file: name, lang: s.lang, text });
  }
  console.log(s.lang, index.filter((x) => x.lang === s.lang).length, 'câu');
}
writeFileSync(new URL('index.json', out), JSON.stringify(index, null, 1));
