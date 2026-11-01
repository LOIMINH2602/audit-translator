// Cắt luồng chữ của bộ nhận diện thành từng câu để dịch (thuần dữ liệu, test bằng node).
// Bộ nhận diện Chrome trả "chữ tạm" lớn dần trong 1 phiên. Người nói không ngừng (thuyết trình, podcast) thì máy không chốt
// câu → app tự chốt phần đã nghe, phiên vẫn chạy; lần sau chỉ lấy phần chữ MỚI (sau phần đã chốt).

// Tiếng không dùng dấu cách giữa các từ
export const spaced = (lang) => !/^(zh|ja)/.test(lang);

// Phần mới của `text` sau phần đã chốt `done` (cùng 1 phiên nghe).
// Chỉ cắt khi đầu `text` THẬT SỰ là `done` (khớp nguyên văn, hoặc khớp ≥ 70% sau khi bỏ dấu cách/dấu câu — Google hay sửa vài chữ
// cũ). Không khớp → `text` là câu mới, giữ nguyên. Bản cũ cắt theo số từ bất kể nội dung; khi Chrome Android lặp lại chữ cũ (chế độ
// continuous lỗi trước 12/10/2026) thì câu đầu dính vào mọi bản dịch (test thật 01/11).
const bare = (s) => s.toLowerCase().replace(/[\s.,!?;:。？！、，]/g, '');
function editRatio(a, b) {
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
  return 1 - p[b.length] / Math.max(a.length, b.length, 1);
}
// vị trí trong s ngay sau n ký tự "thật" (không tính dấu cách/dấu câu)
function afterBare(s, n) {
  let k = 0;
  let i = 0;
  while (i < s.length && k < n) if (bare(s[i++])) k++;
  return i;
}
export function delta(text, done) {
  text = text.trim();
  if (!done) return text;
  if (text.startsWith(done)) return text.slice(done.length).trim();
  const T = bare(text);
  const D = bare(done);
  if (!D) return text;
  if (T.length >= D.length * 0.7 && editRatio(T.slice(0, D.length), D) >= 0.7) {
    return text.slice(afterBare(text, Math.min(D.length, T.length))).trim();
  }
  return text;
}

// Phần đầu của s tới hết câu cuối cùng; không thấy chỗ hết câu → ''.
// Tiếng Hàn: đuôi câu …다/…요/…죠/…까. Trung/Nhật: dấu câu 。？！ (Google có khi chèn). Anh: . ? !
export function sentenceCut(s, lang) {
  if (/^ko/.test(lang)) {
    const w = s.split(/\s+/);
    for (let i = w.length - 2; i >= 1; i--) if (/(다|요|죠|까)[.?!]?$/.test(w[i])) return w.slice(0, i + 1).join(' ');
    return '';
  }
  const re = /^(zh|ja)/.test(lang) ? /[。？！?!]/g : /[.?!](?=\s)/g;
  let last = -1;
  for (const m of s.matchAll(re)) if (m.index < s.length - 1) last = m.index;
  return last > 0 ? s.slice(0, last + 1).trim() : '';
}

// Cắt cứng giữa câu: chừa lại từ cuối (đang nghe dở, Google còn sửa).
export function dropLastWord(s, lang) {
  if (spaced(lang)) return /\s/.test(s) ? s.replace(/\s+\S+$/, '') : s;
  return s.length > 4 ? s.slice(0, -1) : s;
}

// Mảnh quá ngắn (1 từ / < 3 ký tự Hán-kana) dịch rời thì vô nghĩa → ghép vào câu sau.
export const isFragment = (s, lang) => (spaced(lang) ? !/\s/.test(s.trim()) : s.trim().length < 3);
