import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOnsetDetector } from '../src/js/onset.js';
import { summarize } from '../src/js/meetstats.js';

// dãy khung 20ms: [số khung, rms]
function run(det, parts) {
  let t = 0;
  const out = [];
  for (const [n, rms] of parts) for (let i = 0; i < n; i++) { t += 20; const e = det.push(rms, t); if (e) out.push([e, e === 'start' ? det.lastStart() : det.lastLoud()]); }
  return out;
}

test('nền ồn nhỏ → nói → im: mốc bắt đầu = khung có tiếng đầu tiên, mốc dứt = khung có tiếng cuối', () => {
  const d = createOnsetDetector();
  const ev = run(d, [[50, 0.002], [40, 0.05], [30, 0.002]]);
  assert.deepEqual(ev.map((e) => e[0]), ['start', 'end']);
  assert.equal(ev[0][1], 1000); // khung 51 bắt đầu lúc 1000ms
  assert.equal(ev[1][1], 1800); // khung có tiếng cuối (khung 90) kết thúc lúc 1800ms
});

test('tiếng động ngắn hơn 60ms không tính là bắt đầu nói', () => {
  const d = createOnsetDetector();
  assert.deepEqual(run(d, [[50, 0.002], [2, 0.08], [50, 0.002]]), []);
});

test('ngừng ngắn hơn 300ms giữa 2 từ không tính là dứt lời', () => {
  const d = createOnsetDetector();
  const ev = run(d, [[50, 0.002], [20, 0.05], [10, 0.002], [20, 0.05], [30, 0.002]]);
  assert.deepEqual(ev.map((e) => e[0]), ['start', 'end']);
});

test('nền ồn lớn (nhà xưởng) → ngưỡng tự nâng, tiếng ồn không bị tính là nói', () => {
  const d = createOnsetDetector();
  const ev = run(d, [[200, 0.02], [40, 0.12], [30, 0.02]]);
  assert.deepEqual(ev.map((e) => e[0]), ['start', 'end']);
});

test('summarize: trung vị và mức 90%', () => {
  assert.equal(summarize([]), null);
  assert.deepEqual(summarize([5, 1, 3, 2, 4, 6, 7, 8, 9, 10]), { n: 10, median: 6, p90: 10 });
});
