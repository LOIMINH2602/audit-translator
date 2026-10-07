// Dịch miễn phí: Google (endpoint không chính thức) trước vì sạch hơn; lỗi/bị chặn thì rơi về MyMemory.
// MyMemory chiều Việt→Nhật/Trung từng chèn chữ thừa nên chỉ dùng làm dự phòng.

const MYMEMORY = 'https://api.mymemory.translated.net/get';
const GOOGLE = 'https://translate.googleapis.com/translate_a/single';

function code(lang) {
  return lang === 'zh-CN' ? 'zh-CN' : lang.split('-')[0];
}

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

async function viaMyMemory(text, from, to, timeoutMs) {
  const url = `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${code(from)}|${code(to)}`;
  const d = await getJson(url, timeoutMs);
  const out = d && d.responseData && d.responseData.translatedText;
  // Hết hạn mức: MyMemory vẫn trả 200 nhưng nhét cảnh báo vào translatedText.
  if (Number(d.responseStatus) !== 200 || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) {
    throw new Error('mymemory_rejected');
  }
  return out;
}

async function viaGoogle(text, from, to, timeoutMs) {
  const url = `${GOOGLE}?client=gtx&sl=${code(from)}&tl=${code(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const d = await getJson(url, timeoutMs);
  return d[0].map((x) => x[0]).join('');
}

// Trả về { text, engine, ms } để UI hiển thị độ trễ dịch.
export async function translate(text, from, to, { timeoutMs = 6000 } = {}) {
  const engines = [['google', viaGoogle], ['mymemory', viaMyMemory]];
  const t0 = performance.now();
  const errors = [];
  for (const [engine, run] of engines) {
    try {
      const out = await run(text, from, to, timeoutMs);
      return { text: out, engine, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      errors.push(`${engine}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    }
  }
  const err = new Error('translate_failed');
  err.details = errors.join(' | '); // để UI ghi vào nhật ký chẩn đoán
  throw err;
}
