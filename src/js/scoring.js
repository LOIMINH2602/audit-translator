// Chấm điểm bài test nhận diện người nói: app biết câu mẫu đúng nên tự tính recognizer có nghe đúng không
// và app có chọn đúng người nói không.

import { pickSpeaker } from './speaker.js';

export const PASS_SIMILARITY = 0.6;

export function normalize(s) {
  return (s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s.,!?;:'"“”‘’。、！？，：；·\-–—()（）]/g, '');
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// 1 = giống hệt, 0 = khác hoàn toàn (bỏ qua hoa/thường, dấu câu, khoảng trắng).
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

// cands: [{ side, lang, text, detected }] — kết quả nhận diện (đã dò ngôn ngữ) của 1 câu mẫu, mỗi bên tối đa 1.
// Chấm: recognizer của bên đúng có nghe đúng câu không, và pickSpeaker có chọn đúng bên không.
export function judge(expectedSide, expectedText, cands, expectedTurn = expectedSide) {
  const heard = { vi: '', partner: '' };
  const sim = { vi: 0, partner: 0 };
  for (const c of cands) {
    const k = c.side === 'me' ? 'vi' : 'partner';
    heard[k] = c.text || '';
    sim[k] = similarity(expectedText, heard[k]);
  }
  const win = pickSpeaker(cands, expectedTurn);
  const key = expectedSide === 'me' ? 'vi' : 'partner';
  return {
    expectedSide,
    heard,
    sim,
    winner: win ? win.side : null,
    recognizerOk: sim[key] >= PASS_SIMILARITY,
    pickOk: Boolean(win) && win.side === expectedSide,
  };
}
