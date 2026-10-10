// Chạy trong trang app (tools/e2e/auto.mjs, chế độ "dlg"): dùng màn 1:1 thật ở cách nghe "Tự nhận người nói".
// Mỗi lượt: phát mẫu giọng qua micro giả; chờ app đọc xong bản dịch (người thật cũng chờ nghe) rồi người sau mới nói.
// Ghi: biên bản app (ai nói, chữ, bản dịch), lúc bắt đầu nghe bản dịch, câu thừa (vd. app dịch lại giọng đọc của chính nó).
(async () => {
  const A = window.__AUTO;
  await window.__ready;
  const track = window.__fakeTrack;
  navigator.mediaDevices.getUserMedia = async () => new MediaStream([track.clone()]);
  const tts = await import(new URL('js/tts.js', location.href).href);
  const { similarity } = await import(new URL('js/scoring.js', location.href).href);
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await __say([200]);
  if (A.model) window.__autoModel = A.model;
  if (A.device) window.__autoDevice = A.device;
  $('listenMode').value = 'auto'; $('listenMode').onchange();
  $('endSilMs').value = String(A.endSilenceMs); $('endSilMs').onchange();
  $('partnerLang').value = A.partner; $('partnerLang').onchange();
  const t0 = performance.now();
  $('dlgToggle').click();
  while (!__dialogue.state().running && performance.now() - t0 < 600000) {
    if ($('dlgErr').textContent && !$('dlgErr').hidden) return { error: $('dlgErr').textContent };
    await sleep(200);
  }
  const loadMs = Math.round(performance.now() - t0);
  await sleep(800);
  const steps = [];
  for (const [side, clip] of A.script) {
    const n0 = __dialogue.state().log.length;
    const ms = await __say([clip]);
    const end = performance.now() + ms;
    let hear = null;
    while (performance.now() < end + 15000) {
      if (performance.now() > end && tts.isSpeaking()) { hear = performance.now(); break; }
      await sleep(25);
    }
    while (tts.isSpeaking()) await sleep(50);
    await sleep(400); // người kia nghe xong rồi mới nói
    const es = __dialogue.state().log.slice(n0);
    const tag = side === 'me' ? 'Tôi' : 'Đối tác';
    steps.push({
      clip, side, n: es.length, ok: es.length >= 1 && es.every((e) => e.tag === tag), unsure: es.some((e) => / \(\?\)$/.test(e.tag)),
      hear: hear ? Math.round(hear - end) : null,
      sim: es.length ? +similarity(A.truth[clip], es.map((e) => e.src).join(' ')).toFixed(2) : 0,
      got: es.map((e) => `${e.tag}: "${e.src}" → "${e.out}" (${e.info})`).join(' | '),
    });
  }
  await sleep(3000);
  const extra = __dialogue.state().log.length - steps.reduce((s, x) => s + x.n, 0);
  $('dlgToggle').click();
  const diag = $('diagLog').textContent.split('\n').filter((l) => /TỰ NHẬN|Bỏ câu|Bỏ tiếng vọng|LỖI|sẵn sàng/.test(l));
  return { loadMs, steps, extra, diag };
})()
