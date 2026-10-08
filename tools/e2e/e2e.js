// window.__CFG = { partner: 'en-US', android: false, script: [['partner','en-9'], ['me','vi-7'], ...] }
(async () => {
  const cfg = window.__CFG;
  await window.__ready;
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
    while (Date.now() - t0 < ms + 9000) {
      const s = __dialogue.state();
      if (s.log.length > n0 || s.switches > sw0) break;
      await sleep(100);
    }
    await sleep(300);
    while (__dialogue.state().busy) await sleep(100);
    const s = __dialogue.state();
    const e = s.log.length > n0 ? s.log[s.log.length - 1] : null;
    const tag = side === 'me' ? 'Tôi' : 'Đối tác';
    const res = e ? (e.tag === tag ? 'ĐÚNG' : 'SAI') : s.switches > sw0 ? (s.turn === side ? 'MỜI NÓI LẠI' : 'SAI-LƯỢT') : 'BỎ SÓT';
    return { said: side + ':' + clip, turnBefore, res, got: e ? `${e.tag}: "${e.src}" → "${e.out}" (${e.info})` : 'KHÔNG DỊCH · ' + $('dlgErr').textContent, turnAfter: s.turn };
  }
  for (const [side, clip] of cfg.script) {
    let r = await once(side, clip);
    if (r.res === 'MỜI NÓI LẠI') {
      await sleep(1200);
      const r2 = await once(side, clip); // người nói lặp lại câu
      r = { ...r2, said: r.said, turnBefore: r.turnBefore, res: 'NÓI LẠI→' + r2.res };
    }
    r.ok = r.res === 'ĐÚNG' || r.res === 'NÓI LẠI→ĐÚNG';
    out.steps.push(r);
    await sleep(1200);
  }
  $('dlgToggle').click();
  out.score = out.steps.filter((x) => x.ok).length + '/' + out.steps.length;
  out.diag = $('diagLog').textContent.split('\n').filter((l) => window.__FULLDIAG || /QUYẾT|Dò song|CẢNH BÁO|LỖI|không ra chữ/.test(l));
  return out;
})()
