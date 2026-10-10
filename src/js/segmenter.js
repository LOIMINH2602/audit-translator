// Cắt câu từ luồng micro cho chế độ "Tự nhận người nói" (Whisper chạy trên máy). Thuần dữ liệu → test bằng node.
// Mỗi khung 512 mẫu (32ms ở 16 kHz) kèm xác suất có tiếng nói (Silero VAD). Câu bắt đầu khi xác suất vượt
// startProb; kết thúc khi im lặng (xác suất dưới endProb) liên tục endSilenceMs — đúng ý Lợi Minh 10/10/2026:
// "dịch realtime khi nhận diện hết 1 câu, quy định thời gian chờ để nhận biết kết thúc câu". Câu quá dài thì cắt ở
// maxMs để không phải chờ người nói hết cả đoạn dài mới dịch.

export const SR = 16000;
export const FRAME = 512;
const FRAME_MS = (FRAME / SR) * 1000;

export function createSegmenter({
  startProb = 0.5,
  endProb = 0.35,
  endSilenceMs = 600,
  minSpeechMs = 250, // ngắn hơn: tiếng động (ho, gõ bàn), bỏ
  preRollMs = 300, // giữ đoạn trước lúc bắt đầu nói: tránh mất phụ âm đầu
  maxMs = 12000,
} = {}) {
  const pre = Math.ceil(preRollMs / FRAME_MS);
  let ring = []; // khung gần nhất khi chưa nói
  let cur = null; // { id, frames, speech, silence, version }
  let silenceMs = endSilenceMs;
  let nextId = 1;

  // audio từ đầu câu tới khung keep (bỏ phần im lặng cuối, chừa 2 khung)
  function audioOf(c) {
    const keep = c.frames.length - Math.max(0, c.silence - 2);
    const out = new Float32Array(keep * FRAME);
    for (let i = 0; i < keep; i++) out.set(c.frames[i], i * FRAME);
    return { out, keep };
  }

  function finish() {
    const c = cur;
    cur = null;
    const voiced = c.speech * FRAME_MS;
    if (voiced < minSpeechMs) return null;
    const { out, keep } = audioOf(c);
    return { id: c.id, version: c.version, audio: out, ms: Math.round(keep * FRAME_MS), voicedMs: Math.round(voiced) };
  }

  return {
    // frame: Float32Array(FRAME); prob: 0..1. Trả về câu vừa xong ({ audio, ms, voicedMs }) hoặc null.
    push(frame, prob) {
      if (!cur) {
        ring.push(frame);
        if (ring.length > pre + 1) ring.shift();
        if (prob < startProb) return null;
        cur = { id: nextId++, frames: ring, speech: 1, silence: 0, version: 1 };
        ring = [];
        return null;
      }
      cur.frames.push(frame);
      if (prob >= endProb) {
        cur.speech++;
        if (cur.silence) cur.version++; // nói tiếp sau quãng ngừng: bản nhận diện sớm (peek) không còn đúng
        cur.silence = 0;
      } else cur.silence++;
      if (cur.silence * FRAME_MS >= silenceMs || cur.frames.length * FRAME_MS >= maxMs) return finish();
      return null;
    },
    // đang có người nói (để hiện trạng thái / hoãn đọc bản dịch)
    speaking: () => Boolean(cur && cur.silence * FRAME_MS < 200),
    setEndSilence(ms) { silenceMs = ms; },
    // Nhận diện sớm: người nói đã ngừng >= ms nhưng chưa đủ thời gian chờ hết câu → trả câu tới lúc này để nhận diện
    // trước; khi câu kết thúc với cùng { id, version } (không nói thêm) thì dùng luôn kết quả đó.
    peek(ms) {
      if (!cur || cur.silence * FRAME_MS < ms || cur.speech * FRAME_MS < minSpeechMs) return null;
      return { id: cur.id, version: cur.version, audio: audioOf(cur).out };
    },
    // dừng giữa chừng (tắt nghe): trả nốt câu đang dở nếu đủ dài
    flush() { return cur ? finish() : null; },
    reset() { ring = []; cur = null; },
  };
}
