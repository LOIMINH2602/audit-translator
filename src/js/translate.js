// Dịch miễn phí sang tiếng Việt: Google (endpoint không chính thức) trước; lỗi / bị chặn thì MyMemory.

const GOOGLE = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const code = (lang) => (lang === 'zh-CN' ? 'zh-CN' : lang.split('-')[0]);

async function getJson(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('http_' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function viaGoogle(text, from, timeoutMs) {
  const d = await getJson(`${GOOGLE}?client=gtx&sl=${code(from)}&tl=vi&dt=t&q=${encodeURIComponent(text)}`, timeoutMs);
  return d[0].map((x) => x[0]).join('');
}

async function viaMyMemory(text, from, timeoutMs) {
  const d = await getJson(`${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${code(from)}|vi`, timeoutMs);
  const out = d && d.responseData && d.responseData.translatedText;
  // hết hạn mức: MyMemory vẫn trả 200 nhưng nhét cảnh báo vào chữ dịch
  if (Number(d.responseStatus) !== 200 || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) throw new Error('mymemory_rejected');
  return out;
}

// googleOnly: bản dịch tạm (gọi dày) — không dùng hạn mức của MyMemory.
export async function toVietnamese(text, from, { timeoutMs = 3500, googleOnly = false } = {}) {
  const errors = [];
  for (const [name, run] of googleOnly ? [['google', viaGoogle]] : [['google', viaGoogle], ['mymemory', viaMyMemory]]) {
    try {
      return await run(text, from, timeoutMs);
    } catch (e) {
      errors.push(`${name}: ${e.name === 'AbortError' ? 'quá giờ' : e.message}`);
    }
  }
  const err = new Error('Không dịch được (' + errors.join('; ') + ')');
  err.details = errors.join('; ');
  throw err;
}
