// window.__CFG = { partner: 'en-US', android: false, script: [['partner','en-9'], ['me','vi-7'], ...] }
// Người nói tiếp theo bắt đầu ngay REPLY_MS sau khi app đọc xong bản dịch (như ngoài đời: nghe xong là trả lời).
// lat = từ lúc dứt lời tới lúc bản dịch hiện ra.
(async () => {
  const cfg = window.__CFG;
  await window.__ready;
  const tts = await import(new URL('js/tts.js', location.href).href); // cùng module app đang dùng
  const speaking = () => (tts.isSpeaking ? tts.isSpeaking() : speechSynthesis.speaking); // bản cũ chưa có isSpeaking
  await __say([200]); // kích hoạt AudioContext của micro giả
  window.__androidLike = cfg.android;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  $('partnerLang').value = cfg.partner; $('partnerLang').onchange();
  $('dlgToggle').click();
  for (let i = 0; i < 40 && !__dialogue.state().running; i++) await sleep(100);
  const st = __dialogue.state();
  const out = { mode: st.mode, steps: [] };
  await sleep(1500);
  async function once(side, clip) {
    const n0 = __dialogue.state().log.length;
    const turnBefore = __dialogue.state().turn;
    const sw0 = __dialogue.state().switches;
    const ms = await __say([clip]);
    const t0 = Date.now();
    let tHit = null;
    while (Date.now() - t0 < ms + 9000) {
      const s = __dialogue.state();
      if (s.log.length > n0 || s.switches > sw0) { tHit = Date.now(); break; }
      await sleep(50);
    }
    // lúc người nghe bắt đầu nghe thấy bản dịch
    let tHear = null;
    if (tHit && __dialogue.state().log.length > n0) {
      while (Date.now() - tHit < 8000) {
        if (speaking()) { tHear = Date.now(); break; }
        await sleep(30);
      }
    }
    // người nghe chờ tới khi tiếng đọc bản dịch thật sự tắt (không chờ app), rồi mới tới lượt nói tiếp
    await sleep(500);
    while (speaking()) await sleep(50);
    const s = __dialogue.state();
    const e = s.log.length > n0 ? s.log[s.log.length - 1] : null;
    const tag = side === 'me' ? 'Tôi' : 'Đối tác';
    const res = e ? (e.tag === tag ? 'ĐÚNG' : 'SAI') : s.switches > sw0 ? (s.turn === side ? 'MỜI NÓI LẠI' : 'SAI-LƯỢT') : 'BỎ SÓT';
    const lat = tHit ? tHit - (t0 + ms) : null;
    const hear = tHear ? tHear - (t0 + ms) : null;
    return { said: side + ':' + clip, turnBefore, res, lat, hear, got: e ? `${e.tag}: "${e.src}" → "${e.out}" (${e.info})` : 'KHÔNG DỊCH · ' + $('dlgErr').textContent, turnAfter: s.turn };
  }
  for (const [side, clip] of cfg.script) {
    let r = await once(side, clip);
    if (r.res === 'MỜI NÓI LẠI') {
      await sleep(cfg.replyMs ?? 300);
      const r2 = await once(side, clip); // người nói lặp lại câu
      r = { ...r2, said: r.said, turnBefore: r.turnBefore, res: 'NÓI LẠI→' + r2.res };
    }
    r.ok = r.res === 'ĐÚNG' || r.res === 'NÓI LẠI→ĐÚNG';
    out.steps.push(r);
    await sleep(cfg.replyMs ?? 300);
  }
  $('dlgToggle').click();
  out.score = out.steps.filter((x) => x.ok).length + '/' + out.steps.length;
  const lats = out.steps.map((x) => x.lat).filter((x) => x != null);
  out.avgLat = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  out.stuck = window.__stuckCount || 0;
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const ok = out.steps.filter((x) => x.ok && x.hear != null);
  out.hearViToX = avg(ok.filter((x) => x.said.startsWith('me:')).map((x) => x.hear));
  out.hearXToVi = avg(ok.filter((x) => x.said.startsWith('partner:')).map((x) => x.hear));
  out.diag = $('diagLog').textContent.split('\n').filter((l) => window.__FULLDIAG || /QUYẾT|Dò song|CẢNH BÁO|LỖI|không ra chữ|Giọng đọc/.test(l));
  return out;
})()
