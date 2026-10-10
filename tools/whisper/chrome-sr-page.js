// Mốc so sánh: nhận diện giọng nói của Chrome (Google) nghe cùng các câu giọng người thật, đúng tiếng của câu.
(async () => {
  const R = window.__SR;
  await window.__ready;
  const { similarity } = await import(new URL('js/scoring.js', location.href).href);
  const SR = window.webkitSpeechRecognition;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const L = { vi: 'vi-VN', ko: 'ko-KR', en: 'en-US' };
  const rows = [];
  for (const it of R.items) {
    const rec = new SR();
    rec.lang = L[it.lang]; rec.continuous = true; rec.interimResults = false;
    let text = '';
    rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += ' ' + e.results[i][0].transcript; };
    const started = new Promise((r) => (rec.onstart = r));
    rec.start();
    await Promise.race([started, sleep(3000)]);
    await sleep(300);
    const ms = await __say([it.file.replace(/\.\w+$/, '')]);
    await sleep(ms + 2500);
    rec.stop();
    await sleep(1200);
    rows.push({ file: it.file, lang: it.lang, sim: +similarity(it.text, text).toFixed(2), text: text.trim() });
  }
  return rows;
})()
