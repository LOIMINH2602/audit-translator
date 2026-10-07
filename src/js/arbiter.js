// Phân xử kết quả của 2 recognizer chạy song song (case đối thoại 1:1).
// Cả hai cùng nghe 1 câu nói; recognizer sai ngôn ngữ vẫn có thể trả về chuỗi rác.
//
// mode 'fast'       : bên nào có final trước thì thắng, bên kia bị khoá lockMs (hành vi của bản nháp).
// mode 'confidence' : chờ windowMs thu kết quả của cả 2 bên rồi chọn bên có confidence cao hơn.
//
// onDecision({ side, text, confidence, candidates }) được gọi đúng 1 lần cho mỗi câu.

export function createArbiter({ mode = 'fast', windowMs = 600, lockMs = 1500 } = {}, onDecision) {
  let lockedUntil = 0;
  let pending = null;

  function flush() {
    const cands = pending.cands;
    pending = null;
    // Hòa confidence (kể cả cùng bằng 0) thì giữ bên đến trước.
    const best = cands.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    lockedUntil = Date.now() + lockMs;
    onDecision({ ...best, candidates: cands });
  }

  return {
    setMode(m) {
      mode = m;
    },
    push(side, text, confidence = 0) {
      if (!text || Date.now() < lockedUntil) return;
      if (mode === 'fast') {
        lockedUntil = Date.now() + lockMs;
        onDecision({ side, text, confidence, candidates: [{ side, text, confidence }] });
        return;
      }
      if (!pending) pending = { cands: [], timer: setTimeout(flush, windowMs) };
      const same = pending.cands.find((c) => c.side === side);
      if (same) {
        // cùng 1 bên trả nhiều final liên tiếp trong cửa sổ: nối lại thành 1 câu
        same.text += ' ' + text;
        same.confidence = (same.confidence + confidence) / 2;
      } else {
        pending.cands.push({ side, text, confidence });
      }
    },
    reset() {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      lockedUntil = 0;
    },
  };
}
