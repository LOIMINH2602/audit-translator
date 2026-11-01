// 1 = giống hệt, 0 = khác hoàn toàn (bỏ qua hoa/thường, dấu câu, khoảng trắng). Dùng để chấm bài test.
const norm = (s) => (s || '').normalize('NFC').toLowerCase().replace(/[\s.,!?;:'"“”‘’。、！？，：；·\-–—()（）]/g, '');
function dist(a, b) {
  const p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let d = p[0];
    p[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = p[j];
      p[j] = Math.min(p[j] + 1, p[j - 1] + 1, d + (a[i - 1] === b[j - 1] ? 0 : 1));
      d = t;
    }
  }
  return p[b.length];
}
export function similarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  return 1 - dist(x, y) / Math.max(x.length, y.length);
}
