import test from 'node:test';
import assert from 'node:assert/strict';
import { median, stereoVerdict, reactionStats, analyze, compare } from '../src/js/fieldcheck.js';

const trials = (rts, heard = 3) => rts.map((rt) => ({ rt, heard, early: false }));

test('median: bỏ giá trị không phải số, số chẵn lấy trung bình', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([400, 300]), 350);
  assert.equal(median([null, undefined]), null);
});

test('stereoVerdict: đủ các trường hợp', () => {
  assert.equal(stereoVerdict({ left: 'left', right: 'right' }), 'stereo');
  assert.equal(stereoVerdict({ left: 'right', right: 'left' }), 'swapped');
  assert.equal(stereoVerdict({ left: 'both', right: 'both' }), 'mono');
  assert.equal(stereoVerdict({ left: 'phone', right: 'phone' }), 'phone');
  assert.equal(stereoVerdict({ left: 'none', right: 'none' }), 'silent');
  assert.equal(stereoVerdict({ left: 'left', right: 'none' }), 'partial');
  assert.equal(stereoVerdict({ left: 'both', right: 'right' }), 'mixed');
  assert.equal(stereoVerdict({ left: 'left', right: null }), 'unknown');
  assert.equal(stereoVerdict(null), 'unknown');
});

test('reactionStats: bỏ lần chạm sớm, đếm lần không chạm', () => {
  const s = reactionStats([{ rt: 300, heard: 3 }, { rt: null, heard: 0 }, { rt: 50, heard: 3, early: true }, { rt: 500, heard: 2 }]);
  assert.deepEqual(s, { n: 4, valid: 2, rt: 400, missed: 1, heard: 2 });
});

test('analyze: tai nghe mono khi micro bật + chuyển chế độ chậm + mất tiếng đầu', () => {
  const a = analyze({
    output: 'bt',
    ears: { idle: { left: 'left', right: 'right' }, mic: { left: 'both', right: 'both' }, phone: { left: 'both', right: 'both' } },
    base: trials([320, 300, 340]),
    afterMic: trials([1500, 1400, 1450], 2),
    track: { tried: true, ok: true, text: 'một hai ba bốn năm' },
    chain: [
      { said: 'a', out: 'b', textMs: 400, translateMs: 150, ttsStartMs: 300, appMs: 850, tapMs: 3200, engine: 'Google Dịch (mạng)' },
      { said: 'a', out: 'b', textMs: 500, translateMs: 120, ttsStartMs: 280, appMs: 900, tapMs: 3000, engine: 'Google Dịch (mạng)' },
    ],
  });
  const s = a.summary;
  assert.equal(s.ears.idle, 'stereo');
  assert.equal(s.ears.mic, 'mono');
  assert.equal(s.switchMs, 1450 - 320);
  assert.equal(s.clipped, 1);
  assert.equal(s.optionB, false); // micro điện thoại vẫn làm tai nghe mono
  assert.equal(s.hearMs, 2780); // median(3200,3000) − phản xạ 320
  assert.equal(s.parts.tail, 2780 - 875);
  const all = a.issues.join('\n');
  assert.match(all, /âm thanh đổi chế độ \(2 tai nghe như nhau\)/);
  assert.match(all, /mất thêm ~1,1 giây/);
  assert.match(all, /phần đầu âm thanh bị mất/);
  assert.match(all, /chậm nhất là bước: Bluetooth phát ra tai nghe/);
});

test('analyze: mọi thứ tốt → không có vấn đề, hướng B làm được', () => {
  const a = analyze({
    output: 'bt',
    ears: { idle: { left: 'left', right: 'right' }, mic: { left: 'left', right: 'right' }, phone: { left: 'left', right: 'right' } },
    base: trials([300, 310, 290]),
    afterMic: trials([350, 330, 340]),
    track: { tried: true, ok: true, text: 'một hai ba' },
    chain: [{ said: 'a', out: 'b', textMs: 300, translateMs: 100, ttsStartMs: 200, appMs: 600, tapMs: 1200, engine: 'x' }],
  });
  assert.deepEqual(a.issues, []);
  assert.equal(a.summary.optionB, true);
  assert.equal(a.summary.switchMs, 40);
  assert.ok(a.lines.every((l) => l.level !== 'bad'), JSON.stringify(a.lines));
});

test('analyze: thiếu dữ liệu (dừng giữa chừng) không ném lỗi, không bịa số', () => {
  const a = analyze({ output: 'bt', ears: { idle: { left: 'left', right: 'right' }, mic: null, phone: null }, base: trials([300]), afterMic: [], track: { tried: false }, chain: [] });
  assert.equal(a.summary.switchMs, null);
  assert.equal(a.summary.hearMs, null);
  assert.ok(a.lines.some((l) => /Không đủ lần đo phản xạ/.test(l.text)));
  assert.ok(!a.lines.some((l) => /NaN|undefined/.test(l.text)), JSON.stringify(a.lines));
});

test('analyze: loa điện thoại bỏ phần tai; câu lỗi / chạm sớm không tính vào trung bình', () => {
  const a = analyze({
    output: 'speaker',
    ears: { idle: null, mic: null, phone: null },
    base: trials([300, 300, 300]),
    afterMic: trials([320, 300, 310]),
    track: { tried: false },
    chain: [
      { err: 'không nghe ra câu nói' },
      { said: 'a', out: 'b', textMs: 300, translateMs: 100, ttsStartMs: 200, appMs: 600, tapMs: 200, early: true, engine: 'x' },
      { said: 'a', out: 'b', textMs: 300, translateMs: 100, ttsStartMs: 200, appMs: 600, tapMs: 1000, engine: 'x' },
    ],
  });
  assert.ok(a.lines.some((l) => /bỏ qua phần tai/.test(l.text)));
  assert.equal(a.summary.hearMs, 700);
  assert.ok(!a.lines.some((l) => /NaN|undefined/.test(l.text)), JSON.stringify(a.lines));
});

test('compare: chỉ so khi có đủ 2 lần đo', () => {
  assert.deepEqual(compare(null, { switchMs: 1 }), []);
  const c = compare({ switchMs: 1200, hearMs: 3000 }, { switchMs: 50, hearMs: null });
  assert.match(c[0], /tai nghe chậm hơn 1150ms/);
  assert.match(c[1], /loa chưa đo được$/);
});
