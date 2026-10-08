// window.__CFG = { partner: 'en-US', android: false, script: [['me', 'vi-7'], ['partner', ['en-1', 1200, 'en-2']], ...] }
// Mỗi lượt: 1 mẫu giọng, hoặc nhiều đoạn xen khoảng ngừng (ms) — người trình bày ngắt quãng.
// Người nghe chỉ bắt đầu lượt sau khi nghe xong bản dịch (theo tiếng đọc thật, không chờ app), cách REPLY_MS.
// Chấm 1 lượt: ĐÚNG (mọi đoạn dịch ra đều đúng người, đọc bản dịch 1 lần, chuyển lượt), SAI, MỜI NÓI LẠI → nói lại.
// hear = từ lúc dứt đoạn cuối tới lúc bắt đầu nghe bản dịch.
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
  for (let i = 0; i < 60 && !__dialogue.state().running; i++) await sleep(100);
  const out = { mode: __dialogue.state().mode, steps: [], hiddenMs: 0 };
  // trang bị ẩn (cửa sổ bị thu nhỏ/che): Chrome không tải <audio>, làm chậm bộ đếm giờ → số đo không đại diện điện thoại
  let hiddenAt = document.visibilityState === 'hidden' ? performance.now() : null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = performance.now();
    else if (hiddenAt !== null) { out.hiddenMs += performance.now() - hiddenAt; hiddenAt = null; }
  });
  await sleep(1500);

  async function once(side, clips) {
    const seq = Array.isArray(clips) ? clips : [clips];
    const parts = seq.filter((x) => typeof x === 'string').length;
    const n0 = __dialogue.state().log.length;
    const turnBefore = __dialogue.state().turn;
    const sw0 = __dialogue.state().switches;
    const ms = await __say(seq);
    const tEnd = Date.now() + ms;
    // chờ: app bắt đầu đọc bản dịch, hoặc tự chuyển lượt (mời nói lại) sau khi người nói đã dứt
    let tHear = null;
    let spokeEarly = false; // app đọc bản dịch khi người nói chưa nói hết (cắt lượt giữa chừng)
    while (Date.now() < tEnd + 12000) {
      if (speaking() && (__dialogue.state().busy || Date.now() >= tEnd - 300)) {
        // app đọc bản dịch (busy) trước khi người nói dứt = cắt lượt; câu đọc thử không tiếng thì không tính
        if (Date.now() < tEnd - 300) { if (__dialogue.state().busy) spokeEarly = true; }
        else { tHear = Date.now(); break; }
      }
      if (__dialogue.state().switches > sw0 && Date.now() > tEnd) break;
      await sleep(30);
    }
    await sleep(500);
    while (speaking()) await sleep(50);
    const s = __dialogue.state();
    const es = s.log.slice(n0);
    const tag = side === 'me' ? 'Tôi' : 'Đối tác';
    let res;
    if (es.some((e) => e.tag !== tag)) res = 'SAI';
    else if (es.length && tHear && !spokeEarly) res = 'ĐÚNG';
    else if (es.length && spokeEarly) res = 'CẮT LƯỢT';
    else if (s.switches > sw0) res = s.turn === side ? 'MỜI NÓI LẠI' : 'SAI-LƯỢT';
    else res = 'BỎ SÓT';
    return {
      said: side + ':' + seq.filter((x) => typeof x === 'string').join('+'),
      turnBefore, res, parts, segs: es.length, hear: tHear ? tHear - tEnd : null,
      got: es.length ? es.map((e) => `${e.tag}: "${e.src}" → "${e.out}"`).join(' | ') + ` (${es[es.length - 1].info})` : 'KHÔNG DỊCH · ' + $('dlgErr').textContent,
      turnAfter: s.turn,
    };
  }

  for (const [side, clips] of cfg.script) {
    let r = await once(side, clips);
    if (r.res === 'MỜI NÓI LẠI') {
      await sleep(cfg.replyMs ?? 300);
      const r2 = await once(side, clips); // người nói lặp lại
      r = { ...r2, said: r.said, turnBefore: r.turnBefore, res: 'NÓI LẠI→' + r2.res };
    }
    r.ok = r.res === 'ĐÚNG' || r.res === 'NÓI LẠI→ĐÚNG';
    out.steps.push(r);
    await sleep(cfg.replyMs ?? 300);
  }
  $('dlgToggle').click();
  if (hiddenAt !== null) out.hiddenMs += performance.now() - hiddenAt;
  out.hiddenMs = Math.round(out.hiddenMs);
  out.score = out.steps.filter((x) => x.ok).length + '/' + out.steps.length;
  out.stuck = window.__stuckCount || 0;
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const ok = out.steps.filter((x) => x.ok && x.hear != null);
  out.hearViToX = avg(ok.filter((x) => x.said.startsWith('me:')).map((x) => x.hear));
  out.hearXToVi = avg(ok.filter((x) => x.said.startsWith('partner:')).map((x) => x.hear));
  out.diag = $('diagLog').textContent.split('\n').filter((l) => window.__FULLDIAG || /QUYẾT|Dò song|CẢNH BÁO|LỖI|không ra chữ|Giọng đọc|Trang đang ẩn|Kết thúc lượt|Bỏ qua/.test(l));
  return out;
})()
