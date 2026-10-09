// Test tự động bài "Đo tai nghe & độ trễ" trên Chrome thật: người dùng giả (field-e2e.js) trả lời như 1 tai nghe có
// hành vi định sẵn, rồi kiểm báo cáo có đo ra đúng hành vi đó không. Không thay được đo trên điện thoại thật — chỉ
// chứng minh bài đo chạy hết các bước, không treo, và tính đúng.
//   node tools/e2e/field.mjs [android]
// 3 lần đo nối tiếp trong cùng trang:
//   A. tai nghe "xấu": micro bật → mono, chậm thêm 900ms, mất 1 tiếng bíp; giữ micro điện thoại → vẫn stereo; chạm sớm 1 lần.
//   B. loa điện thoại, không trễ → báo cáo phải có dòng "So sánh" với lần A.
//   D. bấm "Dừng bài đo" lúc đang giữ micro điện thoại → dừng gọn, có báo cáo phần đã đo.
//   C. tai nghe "tốt": micro bật vẫn stereo, không trễ (chạy sau D: chứng minh dừng xong đo lại được).

import { loadClips, readTool, runInChrome } from './chrome.mjs';

const android = process.argv[2] === 'android';
const clips = await loadClips({
  'vi-7': ['vi', 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.'],
  'vi-p2': ['vi', 'Phiên dịch này dùng cho buổi đánh giá nhà máy.'],
  'vi-num': ['vi', 'một hai ba bốn năm'],
});
const runs = [
  { name: 'A tai nghe xấu', output: 'bt', micEars: 'mono', phoneEars: 'stereo', switchMs: 900, clipMic: 1, earlyOnce: true },
  { name: 'B loa', output: 'speaker', switchMs: 0, clipMic: 0 },
  { name: 'D dừng giữa chừng', output: 'bt', micEars: 'stereo', phoneEars: 'stereo', switchMs: 0, clipMic: 0, stopAt: 'ear-phone-left' },
  { name: 'C tai nghe tốt', output: 'bt', micEars: 'stereo', phoneEars: 'stereo', switchMs: 0, clipMic: 0 },
];
const page =
  `window.__CLIPS=${JSON.stringify(clips)};\n` + readTool('fakemic.js') +
  `\nwindow.__slowTts=${Number(process.env.SLOW_TTS ?? 2500)};` +
  `\nwindow.__FCFG=${JSON.stringify({ partner: process.env.PARTNER || 'en-US', android, runs })};\n` + readTool('field-e2e.js');

const errors = [];
const res = await runInChrome(page, { errors });
if (!res) process.exit(2);

let fail = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ĐẠT ' : 'LỖI '} ${msg}`);
  if (!cond) fail++;
};
const near = (x, want, tol) => Number.isFinite(x) && Math.abs(x - want) <= tol;

for (const r of res) {
  const { sim, summary: s, data: d, report } = r;
  console.log(`\n== ${sim.name} (${android ? 'giả lập Android' : 'Chrome desktop'}) — các bước: ${r.steps.join(' ')}`);
  if (sim.stopAt) {
    ok(!r.running && /Đã dừng bài đo giữa chừng/.test(report) && /^BÁO CÁO ĐO TAI NGHE/.test(report), 'bấm Dừng: dừng ngay, vẫn có báo cáo phần đã đo');
    ok(s && s.ears.idle === 'stereo' && Number.isFinite(s.switchMs), 'báo cáo giữ kết quả các bước đã đo xong');
    ok(!/lỗi chương trình/.test(report), 'không lỗi chương trình khi dừng');
    continue;
  }
  ok(!r.running && s, 'bài đo chạy hết, có kết quả');
  if (!s) continue;
  ok(/^BÁO CÁO ĐO TAI NGHE/.test(report) && !/NaN|undefined|null ms|\?ms/.test(report.split('NHẬT KÝ')[0]), 'báo cáo không có số trống/NaN');
  ok(!/lỗi chương trình|Đã dừng/.test(report), 'không lỗi chương trình, không bị dừng');
  ok(d.base.length === 3 && d.afterMic.length === 3 && d.base.concat(d.afterMic).every((t) => !t.early && Number.isFinite(t.rt)), '6 lần đo phản xạ đều hợp lệ' + (sim.earlyOnce ? ' (sau khi đo lại lần chạm sớm)' : ''));
  if (sim.earlyOnce) ok(r.steps.filter((x) => x === 'tap-base-1').length === 2, 'chạm sớm → app đo lại đúng lần đó');
  ok(near(s.switchMs, sim.switchMs, 250), `trễ sau khi micro tắt đo được ${s.switchMs}ms (giả lập ${sim.switchMs}ms ±250)`);
  ok((s.clipped ?? 0) === sim.clipMic, `mất tiếng bíp đầu: đo ${s.clipped ?? 0}, giả lập ${sim.clipMic}`);
  if (sim.output === 'bt') {
    ok(s.ears.idle === 'stereo', `tai lúc micro tắt: ${s.ears.idle}`);
    ok(s.ears.mic === sim.micEars, `tai lúc micro bật: ${s.ears.mic} (giả lập ${sim.micEars})`);
    ok(s.ears.phone === sim.phoneEars, `tai lúc giữ micro điện thoại: ${s.ears.phone} (giả lập ${sim.phoneEars})`);
    ok(d.track.tried && d.track.ok, `nhận diện qua micro điện thoại: "${d.track.text || d.track.err}"`);
  } else {
    ok(d.ears.idle === null && !d.track.tried, 'loa: bỏ phần tai trái/phải');
  }
  ok(d.chain.length === 2 && d.chain.every((c) => !c.err && !c.early && Number.isFinite(c.tapMs)), 'chuỗi dịch thật: 2/2 câu đo được — ' + d.chain.map((c) => c.err || `"${c.said}"→"${c.out}" chốt ${c.textMs} dịch ${c.translateMs} đọc ${c.ttsStartMs} (${c.engine}) chạm ${c.tapMs}`).join(' | '));
  ok(s.parts && near(s.parts.tail, sim.switchMs, 400), `phần "phát ra tai nghe" trong chuỗi: ${s.parts && s.parts.tail}ms (giả lập ${sim.switchMs}ms ±400)`);
  if (sim.name.startsWith('B')) ok(/So sánh: Trễ sau khi micro tắt: tai nghe \d+ms · loa \d+ms/.test(report), 'có dòng So sánh tai nghe / loa');
  const issues = report.split('CHI TIẾT:')[0];
  console.log(issues.split('\n').slice(2).map((l) => '     ' + l).join('\n'));
}
ok(errors.length === 0, `không có lỗi JS trong trang (${errors.length})`);
console.log(fail ? `\nKẾT QUẢ: ${fail} mục LỖI` : '\nKẾT QUẢ: tất cả ĐẠT');
process.exit(fail ? 1 : 0);
