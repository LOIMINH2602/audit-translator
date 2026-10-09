// Chọn ai đang nói từ các chuỗi nhận diện. Đo thật trên Chrome (08/10/2026):
// - recognizer đúng tiếng trả nguyên câu; recognizer sai tiếng trả chuỗi rác ngắn, rỗng, số ("21747"),
//   hoặc chữ của tiếng khác ("Please Show me the cracking back" khi tiếng Việt nghe tiếng Anh).
// - confidence của Chrome ~0,95 cả khi sai → không dùng được để phân biệt.
// Nên dùng: (1) ngôn ngữ Google dò được phải khớp tiếng của recognizer, (2) bên nói được lâu hơn (âm tiết ÷ tốc độ
// nói của tiếng đó) thắng, (3) ưu tiên bên đến lượt. Hệ số chỉnh trên 122 ca đo thật 08/10/2026: đúng 114/122 (luân phiên 59/61, 1 người nói 2 câu liền 55/61).

export const baseLang = (l) => (l || '').toLowerCase().split('-')[0];

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;

function enSyllables(w) {
  const n = (w.match(/[aeiouy]+/g) || []).length;
  return Math.max(1, /[^aeiouy]e$/.test(w) && n > 1 ? n - 1 : n); // bỏ "e" câm cuối từ (active, case)
}

// Ước lượng số âm tiết: chữ Hán/kana/Hangul mỗi ký tự 1; tiếng Việt mỗi từ 1; tiếng Anh theo cụm nguyên âm.
export function syllables(text, lang) {
  const s = text || '';
  const cjk = (s.match(CJK) || []).length;
  const words = s.replace(CJK, ' ').match(/\p{L}+/gu) || [];
  const en = baseLang(lang) === 'en';
  return cjk + words.reduce((n, w) => n + (en ? enSyllables(w.toLowerCase()) : 1), 0);
}

const MIN_VI_RATIO = 0.5; // câu thật có chèn ISO/FSC/BRC vẫn ~0,75
// Google đã dò ra tiếng Việt: chỉ loại khi gần như toàn từ ngoại. 09/10/2026: câu thật kiểu "check lại KPI của line 3"
// (0,4) bị loại → app tưởng người kia nói. Câu nghe nhầm tiếng nước ngoài mà Google dò ra "vi" thường lại toàn âm
// tiết Việt ("siêu nhân ngôi sao…" = 1,0) nên ngưỡng này không giúp lọc chúng.
const MIN_VI_RATIO_DETECTED = 0.3;

// cand: { side, lang, text, detected?: 'en' | 'zh-CN' | null }
export function plausible(cand) {
  if (!/\p{L}/u.test(cand.text || '')) return false; // rỗng, chỉ có số/dấu câu
  if (cand.detected && baseLang(cand.detected) !== baseLang(cand.lang)) return false;
  // tiếng Việt mà quá nửa là từ không phải âm tiết Việt ("UEFA wanna One thành phố Manila house") → nghe nhầm tiếng
  const min = cand.detected && baseLang(cand.detected) === 'vi' ? MIN_VI_RATIO_DETECTED : MIN_VI_RATIO;
  if (baseLang(cand.lang) === 'vi' && vietnameseRatio(cand.text) < min) return false;
  return true;
}

// Âm tiết tiếng Việt hợp lệ: [phụ âm đầu] + nguyên âm (1–3) + [âm cuối c/ch/m/n/ng/nh/p/t]. Recognizer tiếng Việt
// nghe tiếng nước ngoài hay chèn từ tiếng Anh ("Samsung", "massage", "SEA Games") → tỷ lệ âm tiết hợp lệ thấp.
const VI_VOWEL = 'aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵ';
const VI_SYLLABLE = new RegExp(`^(ngh|ng|nh|ch|gh|gi|kh|ph|qu|th|tr|[bcdđghklmnpqrstvx])?[${VI_VOWEL}]{1,3}(ng|nh|ch|[cmnpt])?$`);

export function vietnameseRatio(text) {
  // số ("9001", "3") không thuộc tiếng nào: không tính
  const words = ((text || '').toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !/^\p{N}+$/u.test(w));
  if (!words.length) return 0;
  return words.filter((w) => VI_SYLLABLE.test(w)).length / words.length;
}

// Tốc độ nói trung bình (âm tiết/giây; tiếng Nhật tính theo ký tự). Đổi số âm tiết ra "số giây nói được"
// để so 2 tiếng khác nhau cho công bằng: bên đúng tiếng phủ kín thời gian nói, bên sai chỉ ra vài âm rời rạc.
export const RATE = { vi: 5, en: 4.5, zh: 4.5, ja: 7, ko: 6.5 };
// Recognizer Trung/Nhật/Hàn nghe sai tiếng hay chèn chữ Latin ("I phone六", "bean Bon 김찬우"): với các tiếng này
// chỉ tính ký tự CJK (câu thật có "ISO 9001" chỉ mất vài âm tiết, không bị loại).
const CJK_LANGS = ['zh', 'ja', 'ko'];
export const TUNE = { expectedBonus: 1.2 };

export function score(c, expectedSide) {
  const base = baseLang(c.lang);
  const syl = CJK_LANGS.includes(base) ? ((c.text || '').match(CJK) || []).length : syllables(c.text, c.lang);
  let s = syl / (RATE[base] || 5);
  if (base === 'vi') s *= vietnameseRatio(c.text) ** 2;
  return c.side === expectedSide ? s * TUNE.expectedBonus : s;
}

// Trả về ứng viên thắng hoặc null nếu không bên nào hợp lệ. expectedSide: bên đến lượt (luân phiên), được ưu tiên.
export function pickSpeaker(cands, expectedSide) {
  let best = null;
  let bestScore = 0;
  for (const c of cands) {
    if (!plausible(c)) continue;
    const sc = score(c, expectedSide);
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }
  return best;
}

// Mic nghe lại đuôi bản dịch app vừa đọc (tiếng vọng): bỏ câu mà phần lớn từ nằm trong câu vừa đọc.
// Nhờ lọc này mic được mở lại ngay khi đọc xong, không phải chờ thêm, nên không mất đầu câu trả lời.
const ECHO_OVERLAP = 0.7;

function tokens(text) {
  const s = (text || '').toLowerCase().normalize('NFC');
  return [...(s.match(CJK) || []), ...(s.replace(CJK, ' ').match(/[\p{L}\p{N}]+/gu) || [])];
}

export function isEcho(heard, spoken) {
  const h = tokens(heard);
  if (!h.length || !spoken) return false;
  const bag = new Set(tokens(spoken));
  return h.filter((t) => bag.has(t)).length / h.length >= ECHO_OVERLAP;
}
