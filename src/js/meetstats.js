// Thống kê độ trễ màn Hội trường (thuần, test bằng node).

// trung vị và mức 90% (chậm nhất 10%) của dãy số ms; rỗng → null
export function summarize(xs) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { n: a.length, median: at(0.5), p90: at(0.9) };
}
