// Đo Whisper chạy trên trình duyệt (transformers.js) cho bài toán "tự nhận ai đang nói": dò ngôn ngữ giữa tiếng Việt
// và tiếng đối tác cho từng câu, rồi nhận diện câu đó. Chạy trên Chrome máy tính: độ chính xác giống trên điện thoại,
// tốc độ thì KHÔNG (điện thoại chậm hơn nhiều lần — phải đo trên máy thật).
//   node tools/whisper/bench.mjs [tiny,base,small] [wasm|webgpu]
// Mẫu giọng: Google TTS (sạch) + bản trộn nhiễu hồng SNR 10 dB. Tải mô hình từ huggingface.co lần đầu (cache theo profile tạm).

import { loadClips, runInChrome } from '../e2e/chrome.mjs';
import { readFileSync } from 'node:fs';

const sizes = (process.argv[2] || 'tiny,base').split(',');
const device = process.argv[3] || 'wasm';
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const S = {
  'vi-7': ['vi', 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.'],
  'vi-23': ['vi', 'Anh cho tôi xem biên bản kiểm tra đầu vào tháng trước.'],
  'vi-24': ['vi', 'Đúng rồi.'],
  'vi-25': ['vi', 'Công nhân có được đào tạo về an toàn lao động không?'],
  'vi-p2': ['vi', 'Phiên dịch này dùng cho buổi đánh giá nhà máy.'],
  'vi-s1': ['vi', 'Vâng.'],
  'vi-s2': ['vi', 'Không có.'],
  'vi-s3': ['vi', 'Được, cảm ơn anh.'],
  'vi-t1': ['vi', 'Check lại KPI của line 3 giúp tôi.'],
  'vi-t2': ['vi', 'Chứng chỉ ISO 9001 còn hiệu lực đến năm nào?'],
  'en-1': ['en', 'Please show me the corrective action records.'],
  'en-2': ['en', 'Where is the quality manual?'],
  'en-s1': ['en', 'Yes.'],
  'en-s2': ['en', 'No problem.'],
  'ko-1': ['ko', '시정 조치 기록을 보여 주세요.'],
  'ko-2': ['ko', '품질 매뉴얼은 어디에 있습니까?'],
  'ko-3': ['ko', '창고에서 부적합 사항이 하나 발견되었습니다.'],
  'ko-4': ['ko', '직원 교육 기록은 어디에 있습니까?'],
  'ko-s1': ['ko', '네.'],
  'ko-s2': ['ko', '아니요.'],
  'ko-s3': ['ko', '감사합니다.'],
  'ko-s4': ['ko', '네, 맞습니다.'],
  'zh-CN-1': ['zh-CN', '请让我看一下纠正措施记录。'],
  'zh-CN-2': ['zh-CN', '质量手册在哪里？'],
  'zh-s1': ['zh-CN', '是的。'],
  'ja-1': ['ja', '是正措置の記録を見せてください。'],
  'ja-2': ['ja', '品質マニュアルはどこにありますか。'],
  'ja-s1': ['ja', 'はい。'],
};
const all = await loadClips(S);
const clips = Object.fromEntries(Object.keys(S).map((k) => [k, all[k]]));
const W = (tl) => (tl === 'zh-CN' ? 'zh' : tl);
const vi = Object.keys(S).filter((k) => k.startsWith('vi-'));
const items = [];
for (const p of ['ko', 'en', 'zh', 'ja']) {
  for (const k of Object.keys(S).filter((k) => W(S[k][0]) === p)) items.push({ clip: k, lang: p, partner: p, text: S[k][1] });
  // tiếng Việt: dò với từng tiếng đối tác (tiếng Hàn đủ bộ, các tiếng khác 4 câu)
  for (const k of p === 'ko' ? vi : vi.slice(0, 4)) items.push({ clip: k, lang: 'vi', partner: p, text: S[k][1] });
}
// DEC=fp16|q4|fp32: kiểu số của decoder khi chạy WebGPU; SNRS=clean: chỉ đo bản sạch (nhanh)
const dtype = device === 'webgpu' ? { encoder_model: process.env.ENC || 'fp32', decoder_model_merged: process.env.DEC || 'q4' } : 'q8';
// PROMPT=1: tiền tố thuật ngữ audit (giúp Whisper viết đúng ISO/KPI/FSC… thay vì phiên âm)
const prompt = process.env.PROMPT ? 'ISO 9001, KPI, FSC, BRC, CAPA, line, check, audit.' : null;
const models = sizes.map((s) => ({ id: `onnx-community/whisper-${s}`, dtype, device, prompt }));
const page = `window.__BENCH=${JSON.stringify({ lib: LIB, models, clips, items, snrs: process.env.SNRS === 'clean' ? [null] : [null, 10] })};\n` + readFileSync(new URL('bench-page.js', import.meta.url), 'utf8');

const errors = [];
const res = await runInChrome(page, { errors, timeoutMs: 3600000 });
if (!res) process.exit(2);
for (const r of res) {
  if (r.error) { console.log(`${r.model.id}: ${r.error}`); continue; }
  console.log(`\n== ${r.model.id} (${device}, ${JSON.stringify(r.model.dtype)}) nạp ${r.loadMs}ms`);
  for (const snr of [null, 10]) {
    const rows = r.rows.filter((x) => x.snr === snr);
    const ok = rows.filter((x) => x.langOk).length;
    const viRows = rows.filter((x) => x.want === 'vi'), fRows = rows.filter((x) => x.want !== 'vi');
    const short = rows.filter((x) => /-s\d|vi-24/.test(x.clip));
    const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / (a.length || 1));
    console.log(`  ${snr == null ? 'sạch' : 'ồn SNR ' + snr + 'dB'}: dò đúng người nói ${ok}/${rows.length} (Việt ${viRows.filter((x) => x.langOk).length}/${viRows.length}, đối tác ${fRows.filter((x) => x.langOk).length}/${fRows.length}, câu ngắn ${short.filter((x) => x.langOk).length}/${short.length})` +
      ` · khớp chữ TB ${avg(rows.map((x) => x.sim * 100))}% · xử lý ${avg(rows.map((x) => x.detectMs))}ms cho câu TB ${(rows.reduce((s, x) => s + x.dur, 0) / rows.length).toFixed(1)}s`);
    for (const x of rows.filter((x) => !x.langOk || x.sim < 0.6)) console.log(`    ${x.langOk ? 'chữ sai' : 'NHẦM NGƯỜI'} ${x.clip}→${x.pick} (p đúng ${x.p}) khớp ${x.sim}: "${x.text}"`);
  }
}
if (errors.length) console.log('LỖI JS:', errors.slice(0, 3));
