// Chấm điểm bài test nhận diện người nói: app biết câu mẫu đúng nên tự tính bên nào nghe đúng
// và chế độ phân xử nào (nhanh / độ tin cậy) sẽ chọn đúng bên.

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

// finals: { vi: [{ t, text, conf }], partner: [...] } — các final không rỗng của từng recognizer.
export function judge(expectedSide, expectedText, finals) {
  const sides = ['vi', 'partner'];
  const heard = {};
  const sim = {};
  const first = {};
  const conf = {};
  for (const s of sides) {
    const list = (finals[s] || []).filter((f) => f.text);
    heard[s] = list.map((f) => f.text).join(' ');
    sim[s] = similarity(expectedText, heard[s]);
    first[s] = list.length ? Math.min(...list.map((f) => f.t)) : Infinity;
    conf[s] = list.length ? Math.max(...list.map((f) => f.conf)) : 0;
  }
  const heardAny = sides.filter((s) => heard[s]);
  // Chế độ "nhanh": bên có final đầu tiên thắng.
  const fastWinner = heardAny.length ? heardAny.reduce((a, b) => (first[b] < first[a] ? b : a)) : null;
  // Chế độ "độ tin cậy": bên có confidence cao hơn thắng, hòa thì bên đến trước.
  const confWinner = heardAny.length
    ? heardAny.reduce((a, b) => (conf[b] > conf[a] || (conf[b] === conf[a] && first[b] < first[a]) ? b : a))
    : null;
  return {
    expectedSide,
    heard,
    sim,
    conf,
    fastWinner,
    confWinner,
    recognizerOk: sim[expectedSide] >= PASS_SIMILARITY,
    fastOk: fastWinner === expectedSide,
    confOk: confWinner === expectedSide,
  };
}
