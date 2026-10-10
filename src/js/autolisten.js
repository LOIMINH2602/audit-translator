// Phía giao diện của chế độ "Tự nhận người nói": mở micro (getUserMedia — Android cho phép, không bị giới hạn 1 phiên
// nhận diện như SpeechRecognition), chia âm thanh 16 kHz thành khung 512 mẫu, gửi sang autoworker.js (VAD + Whisper).
// Tự chọn WebGPU nếu máy có (nhanh hơn nhiều), không có thì chạy CPU (wasm).

const WORKLET = `
class Frames extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === 512) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(512); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('frames', Frames);`;

const LOAD_TIMEOUT_MS = 4 * 60 * 1000; // gồm tải 40–80 MB lần đầu qua mạng di động

// Trả về { device: 'webgpu'|'wasm', f16 }. f16: card đồ hoạ tính được số 16-bit → decoder fp16 (đo 10/10/2026: nhanh hơn q4
// 35–45% và đúng chữ hơn). Encoder luôn fp32: encoder fp16 làm whisper-base hỏng hẳn (khớp chữ 1%).
export async function pickDevice() {
  try {
    const a = navigator.gpu && (await navigator.gpu.requestAdapter());
    if (a) return { device: 'webgpu', f16: a.features.has('shader-f16') };
  } catch (_) {}
  return { device: 'wasm', f16: false };
}

// opts: { model?: 'tiny'|'base' (mặc định theo máy), device?, partner, endSilenceMs, prompt, onProgress(pct, file), onReady(info),
//         onStage({ name, ms }), onSentence(r), onSpeaking(on), onDropped(r), onError(msg) }
export function createAutoListener(opts) {
  let worker = null;
  let ctx = null;
  let stream = null;
  let node = null;
  let ready = null;
  const files = {};

  function onMsg(e) {
    const m = e.data;
    if (m.type === 'progress') {
      files[m.file] = [m.loaded, m.total];
      const all = Object.values(files);
      const pct = Math.round((100 * all.reduce((s, f) => s + f[0], 0)) / Math.max(1, all.reduce((s, f) => s + f[1], 0)));
      opts.onProgress && opts.onProgress(pct, m.file);
    } else if (m.type === 'stage') opts.onStage && opts.onStage(m);
    else if (m.type === 'sentence') opts.onSentence(m);
    else if (m.type === 'speaking') opts.onSpeaking && opts.onSpeaking(m.on);
    else if (m.type === 'dropped') opts.onDropped && opts.onDropped(m);
    else if (m.type === 'error') opts.onError && opts.onError(m.message);
  }

  // Nạp mô hình (lần đầu tải ~40–80 MB, sau đó trình duyệt giữ trong bộ nhớ đệm).
  function load() {
    if (ready) return ready;
    ready = (async () => {
      const hw = opts.device ? { device: opts.device, f16: opts.device === 'webgpu' } : await pickDevice();
      const device = hw.device;
      worker = new Worker(new URL('./autoworker.js', import.meta.url), { type: 'module' });
      worker.onerror = (e) => opts.onError && opts.onError('worker: ' + (e.message || 'lỗi'));
      return new Promise((resolve, reject) => {
        // máy yếu / mạng chập chờn có thể kẹt ở bước nạp: báo lỗi thay vì treo im lặng
        let last = 'bắt đầu';
        const guard = setTimeout(() => {
          worker.terminate();
          reject(new Error(`nạp quá ${LOAD_TIMEOUT_MS / 60000} phút (xong tới bước: ${last})`));
        }, LOAD_TIMEOUT_MS);
        worker.onmessage = (e) => {
          if (e.data.type === 'stage') last = e.data.name;
          if (e.data.type === 'ready') {
            clearTimeout(guard);
            worker.onmessage = onMsg;
            opts.onReady && opts.onReady(e.data);
            resolve(e.data);
          } else if (e.data.type === 'error') {
            clearTimeout(guard);
            reject(new Error(e.data.message));
          }
          else onMsg(e);
        };
        // Đo 10/10/2026: màn 1:1 đầy đủ tiếng Hàn — tiny và base nhận người nói như nhau, khớp chữ 86% so với 85%; tiny
        // nhanh hơn và tải nhẹ bằng nửa (WebGPU: 93 MB so với 187 MB; CPU: 41 MB so với 77 MB) → mặc định tiny.
        const model = opts.model || 'tiny';
        worker.postMessage({ type: 'load', model, device, f16: hw.f16, partner: opts.partner, endSilenceMs: opts.endSilenceMs, prompt: opts.prompt });
      });
    })();
    ready.catch(() => (ready = null));
    return ready;
  }

  async function start() {
    await load();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    node = new AudioWorkletNode(ctx, 'frames');
    node.port.onmessage = (e) => worker.postMessage({ type: 'frame', data: e.data }, [e.data.buffer]);
    ctx.createMediaStreamSource(stream).connect(node);
    if (ctx.state !== 'running') await ctx.resume();
  }

  function stop() {
    if (worker) worker.postMessage({ type: 'flush' });
    if (node) node.port.onmessage = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    stream = ctx = node = null;
  }

  return {
    load,
    start,
    stop,
    // muted: đang đọc bản dịch — bỏ âm thanh micro để không dịch lại tiếng của chính app
    config(c) { if (worker) worker.postMessage({ type: 'config', ...c }); },
    running: () => Boolean(stream),
  };
}
