import test from 'node:test';
import assert from 'node:assert/strict';
import { createSegmenter, FRAME } from '../src/js/segmenter.js';

const F = 32; // ms mỗi khung
// chạy chuỗi [xác suất, số khung] qua bộ cắt; mỗi khung mang số thứ tự để kiểm tra đúng đoạn được giữ
function run(seg, pattern) {
  const out = [];
  let n = 0;
  for (const [p, count] of pattern) {
    for (let i = 0; i < count; i++) {
      const fr = new Float32Array(FRAME).fill(++n);
      const r = seg.push(fr, p);
      if (r) out.push({ ...r, first: r.audio[0], last: r.audio[r.audio.length - 1], at: n });
    }
  }
  return out;
}

test('1 câu: bắt đầu khi có tiếng, kết thúc sau đúng thời gian im lặng đã chọn, giữ đoạn trước lúc nói', () => {
  const seg = createSegmenter({ endSilenceMs: 640, preRollMs: 96 });
  const out = run(seg, [[0, 20], [0.9, 50], [0.1, 40]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].at, 20 + 50 + 20); // 640ms = 20 khung im lặng
  assert.equal(out[0].first, 18); // 3 khung trước (96ms: 18–20) rồi khung bắt đầu 21
  assert.ok(Math.abs(out[0].voicedMs - 50 * F) <= F);
});

test('ngừng ngắn hơn thời gian chờ thì vẫn là 1 câu; ngừng đủ lâu thì tách 2 câu', () => {
  const seg = createSegmenter({ endSilenceMs: 640 });
  assert.equal(run(seg, [[0.9, 30], [0.1, 15], [0.9, 30], [0.1, 25]]).length, 1);
  const seg2 = createSegmenter({ endSilenceMs: 320 });
  assert.equal(run(seg2, [[0.9, 30], [0.1, 15], [0.9, 30], [0.1, 25]]).length, 2);
});

test('tiếng động ngắn (dưới minSpeechMs) bị bỏ', () => {
  const seg = createSegmenter({ endSilenceMs: 320, minSpeechMs: 250 });
  assert.equal(run(seg, [[0.9, 4], [0.1, 20]]).length, 0);
});

test('câu quá dài bị cắt ở maxMs, phần sau thành câu mới', () => {
  const seg = createSegmenter({ endSilenceMs: 640, maxMs: 3200 });
  const out = run(seg, [[0.9, 150], [0.1, 30]]);
  assert.equal(out.length, 2);
  assert.ok(out[0].ms <= 3200 + F);
});

test('đổi thời gian chờ khi đang chạy; flush trả câu đang dở', () => {
  const seg = createSegmenter({ endSilenceMs: 2000 });
  seg.setEndSilence(320);
  assert.equal(run(seg, [[0.9, 20], [0.1, 12]]).length, 1);
  run(seg, [[0.9, 20]]);
  assert.ok(seg.flush());
  assert.equal(seg.flush(), null);
});

test('peek: nhận diện sớm khi đã ngừng; nói tiếp thì version đổi, câu cuối cùng khớp id+version thì dùng được', () => {
  const seg = createSegmenter({ endSilenceMs: 800 });
  run(seg, [[0.9, 20], [0.1, 9]]);
  const p1 = seg.peek(250);
  assert.ok(p1 && p1.audio.length > 0);
  run(seg, [[0.9, 10], [0.1, 9]]); // nói tiếp
  const p2 = seg.peek(250);
  assert.equal(p2.id, p1.id);
  assert.notEqual(p2.version, p1.version);
  const out = run(seg, [[0.1, 20]]);
  assert.equal(out.length, 1);
  assert.equal(seg.peek(250), null);
});
