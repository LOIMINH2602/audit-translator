// Bảng thuật ngữ dạng "english=tiếng việt", mỗi dòng 1 cặp.
// Dịch miễn phí không ép được thuật ngữ, nên khi nguồn tiếng Anh chứa thuật ngữ mà bản dịch
// chưa có cụm tiếng Việt mong muốn thì chèn chú giải "[en = vi]" vào cuối.

export function parseGlossary(text) {
  const pairs = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const en = line.slice(0, i).trim();
    const vi = line.slice(i + 1).trim();
    if (en && vi) pairs.push([en, vi]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

export function applyGlossary(sourceText, viText, pairs) {
  let out = viText;
  for (const [en, vi] of pairs) {
    const re = new RegExp('\\b' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(sourceText) && !out.toLowerCase().includes(vi.toLowerCase())) {
      out += `  [${en} = ${vi}]`;
    }
  }
  return out;
}
