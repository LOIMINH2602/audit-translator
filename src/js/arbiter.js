// Gom kết quả của 2 recognizer chạy song song cho cùng 1 câu nói (chế độ song song).
// Đo thật trên Chrome: 2 bên trả final lệch nhau tới ~1,3 giây, bên sai tiếng có khi không trả gì, có khi
// trả rác muộn hơn. Nên: có final đầu tiên thì mở cửa sổ; đóng khi đủ cả 2 bên, hoặc hết windowMs mà bên
// kia không còn đang nghe dở (interim); muộn nhất là maxMs.
//
// onWindow(cands) gọi 1 lần cho mỗi câu, cands = [{ side, text }] (mỗi bên tối đa 1, các final đã nối lại).

export function createArbiter({ windowMs = 1200, maxMs = 3000 } = {}, onWindow) {
  let pending = null; // { cands: Map(side → text), t0, timer }
  const hearing = { partner: false, me: false };

  function close() {
    clearTimeout(pending.timer);
    const cands = [...pending.cands].map(([side, text]) => ({ side, text }));
    pending = null;
    onWindow(cands);
  }

  function tick() {
    if (!pending) return;
    clearTimeout(pending.timer);
    const age = Date.now() - pending.t0;
    const other = pending.cands.has('partner') ? 'me' : 'partner';
    if (pending.cands.size === 2 || age >= maxMs || (age >= windowMs && !hearing[other])) return close();
    pending.timer = setTimeout(tick, hearing[other] ? Math.min(200, maxMs - age) : windowMs - age);
  }

  return {
    push(side, text) {
      text = (text || '').trim();
      hearing[side] = false;
      if (text) {
        if (!pending) pending = { cands: new Map(), t0: Date.now(), timer: null };
        const prev = pending.cands.get(side);
        pending.cands.set(side, prev ? prev + ' ' + text : text);
      }
      tick();
    },
    // recognizer có interim = đang nghe dở 1 câu
    interim(side) {
      hearing[side] = true;
    },
    reset() {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      hearing.partner = hearing.me = false;
    },
  };
}
