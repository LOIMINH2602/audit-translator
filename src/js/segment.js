// Cắt luồng chữ của bộ nhận diện thành từng câu để dịch (thuần dữ liệu, test bằng node).
// Bộ nhận diện Chrome trả "chữ tạm" lớn dần trong 1 phiên. Người nói không ngừng (thuyết trình, podcast) thì máy không chốt
// câu → app tự chốt phần đã nghe, phiên vẫn chạy; lần sau chỉ lấy phần chữ MỚI (sau phần đã chốt).

// Tiếng không dùng dấu cách giữa các từ
export const spaced = (lang) => !/^(zh|ja)/.test(lang);

// Phần mới của `text` sau phần đã chốt `done`. Google hay sửa vài chữ cũ → không khớp đầu chuỗi thì bỏ theo số từ / ký tự.
export function delta(text, done, lang) {
  text = text.trim();
  if (!done) return text;
  if (text.startsWith(done)) return text.slice(done.length).trim();
  if (spaced(lang)) return text.split(/\s+/).slice(done.split(/\s+/).length).join(' ');
  return text.slice(done.length).trim();
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
