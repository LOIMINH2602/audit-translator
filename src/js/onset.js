// Mốc âm thanh thật để đo độ trễ (16/10/2026): lúc người nói bắt đầu / dứt lời, đo bằng mức âm lượng micro.
// Vì sao: tín hiệu "bắt đầu nói" của bộ nhận diện đến muộn hơn lúc mở miệng thật (test: app báo 0,5s, thật 1,26s) → con số
// trên màn hình sẽ đẹp hơn thực tế. Micro mở song song với nhận diện của Chrome (điện thoại Lợi Minh qua bài "Thử nghe song
// song" 11/10), tắt hết xử lý âm thanh (không đổi chế độ âm thanh của máy — xem phonemic.js).
// Thuần phần quyết định (createOnsetDetector) tách khỏi phần mở micro → test bằng node.

// Mỗi khung (~20ms) một mức năng lượng (RMS). Nền ồn = mức thấp chậm thích nghi; có tiếng = vượt nền × RATIO và trên MIN_RMS
// liên tục ≥ ON_MS; dứt = dưới ngưỡng liên tục ≥ OFF_MS (mốc dứt = khung có tiếng cuối cùng).
export function createOnsetDetector({ ratio = 3, minRms = 0.004, onMs = 60, offMs = 300 } = {}) {
  let floor = 0;
  let calib = [];
  let loud = false;
  let runOn = 0, runOff = 0, firstOn = 0, lastLoud = 0;
  const events = [];
  return {
    // rms ≥ 0, t = thời điểm khung (ms). Trả về 'start' | 'end' | null.
    push(rms, t, frameMs = 20) {
      // 0,3 giây đầu: lấy mức ồn nền (phòng ồn ngay từ đầu — nhà xưởng — không bị tính là đang nói)
      if (calib) {
        calib.push(rms);
        if (calib.length * frameMs < 300) return null;
        floor = calib.reduce((a, b) => a + b, 0) / calib.length;
        calib = null;
        return null;
      }
      const thr = Math.max(minRms, floor * ratio);
      const hot = rms > thr;
      // nền: giảm nhanh khi yên hơn, tăng chậm (~4s) khi ồn kéo dài — tiếng nói ngắn không kéo nền lên đáng kể
      if (rms < floor) floor = floor * 0.9 + rms * 0.1;
      else floor += (rms - floor) * (hot ? 0.002 : 0.02);
      if (hot) {
        lastLoud = t;
        runOff = 0;
        if (!runOn) firstOn = t - frameMs;
        runOn += frameMs;
        if (!loud && runOn >= onMs) { loud = true; events.push({ k: 'start', t: firstOn }); return 'start'; }
      } else {
        runOn = 0;
        runOff += frameMs;
        if (loud && runOff >= offMs) { loud = false; events.push({ k: 'end', t: lastLoud }); return 'end'; }
      }
      return null;
    },
    speaking: () => loud,
    lastStart: () => { for (let i = events.length - 1; i >= 0; i--) if (events[i].k === 'start') return events[i].t; return 0; },
    lastLoud: () => lastLoud,
    events,
  };
}

// Mở micro và chạy bộ dò. onEvent('start'|'end', t). Trả về { stop } hoặc ném lỗi (không có quyền / máy không cho mở song song).
export async function startOnsetMeter(onEvent) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const det = createOnsetDetector();
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    const ev = det.push(Math.sqrt(s / buf.length), performance.now());
    if (ev) onEvent(ev, ev === 'start' ? det.lastStart() : det.lastLoud());
  }, 20);
  if (ctx.state !== 'running') await ctx.resume();
  return {
    det,
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
