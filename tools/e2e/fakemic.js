// Micro giả: 1 AudioContext → MediaStreamDestination. __say(['en-9', 1500, 'vi-7']) phát lần lượt (số = ms lặng).
// Mọi SpeechRecognition.start() đều nhận track này. __androidLike=true giả lập Android: phiên mới huỷ phiên đang chạy.
(() => {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const track = dest.stream.getAudioTracks()[0];
  window.__fakeTrack = track; // chế độ Tự nhận người nói lấy micro qua getUserMedia (tools/e2e/auto.mjs)
  // micro thật luôn có dữ liệu: phát im lặng liên tục (nhiễu rất nhỏ) để track không bao giờ 'đứng'
  const hiss = ctx.createConstantSource(); hiss.offset.value = 0.0001; hiss.connect(dest); hiss.start();
  // __noise > 0: tiếng ồn nền liên tục (nhà xưởng, quạt, người xung quanh) trộn vào micro — micro giả im tuyệt đối thì
  // máy luôn báo "hết tiếng nói" kịp thời, ngoài đời thì không (09/10/2026: Lợi Minh báo app không tự đọc bản dịch).
  if (window.__noise > 0) {
    const len = ctx.sampleRate * 4;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { // nhiễu hồng (gần tiếng ồn môi trường hơn nhiễu trắng)
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
    const g = ctx.createGain(); g.gain.value = window.__noise;
    src.connect(g).connect(dest); src.start();
  }
  const bufs = {};
  window.__ready = Promise.all(Object.entries(window.__CLIPS).map(async ([k, b64]) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    bufs[k] = await ctx.decodeAudioData(bin.buffer);
  }));
  window.__say = async (seq) => {
    await ctx.resume();
    let t = ctx.currentTime + 0.1;
    for (const x of seq) {
      if (typeof x === 'number') { t += x / 1000; continue; }
      const s = ctx.createBufferSource(); s.buffer = bufs[x]; s.connect(dest); s.start(t); t += bufs[x].duration;
    }
    return (t - ctx.currentTime) * 1000;
  };
  // __androidLike=true giả lập Chrome Android:
  //  1. chỉ 1 phiên giữ micro: phiên mới huỷ phiên đang chạy (đã đo thật trên Chrome);
  //  2. khởi động phiên mất ~600ms (gắn dịch vụ nhận diện, tiếng bíp); bị abort/stop trong lúc đó thì phiên TREO:
  //     không bao giờ bắn sự kiện nào, start() lại trên đối tượng đó ném InvalidStateError (giả thuyết, chưa đo trên máy);
  //  3. speechSynthesis không bắn onend (hiện tượng hay gặp trên Chrome Android).
  const SR = window.webkitSpeechRecognition;
  const orig = { start: SR.prototype.start, abort: SR.prototype.abort, stop: SR.prototype.stop };
  let active = null;
  window.__androidLike = false;
  const STARTUP_MS = 600;
  SR.prototype.start = function () {
    if (!window.__androidLike) return orig.start.call(this, track.clone());
    if (this.__stuck || this.__pending) throw new DOMException('recognition has already started', 'InvalidStateError');
    if (active && active !== this) { const a = active; try { a.abort(); } catch (_) {} }
    active = this;
    // 4. Android chốt câu chậm: final (và onend sau nó) đến muộn __finalDelay ms sau khi người nói dừng;
    //    speechend vẫn đến đúng lúc. App phải tự chốt bằng speechend + chữ tạm thì mới nhanh.
    const delay = window.__finalDelay ?? 1500;
    const onres = this.onresult, onend = this.onend;
    let late = false;
    if (onres) this.onresult = (e) => {
      const fin = [...e.results].slice(e.resultIndex).some((r) => r.isFinal);
      if (fin) { late = true; setTimeout(() => onres.call(this, e), delay); } else onres.call(this, e);
    };
    if (onend) this.onend = (e) => (late ? setTimeout(() => onend.call(this, e), delay + 50) : onend.call(this, e));
    this.__pending = true;
    this.__t = setTimeout(() => {
      this.__pending = false;
      orig.start.call(this, track.clone());
    }, STARTUP_MS);
  };
  for (const m of ['abort', 'stop']) {
    SR.prototype[m] = function () {
      if (window.__androidLike && this.__pending) {
        clearTimeout(this.__t);
        this.__pending = false;
        this.__stuck = true;
        window.__stuckCount = (window.__stuckCount || 0) + 1;
        return;
      }
      return orig[m].call(this);
    };
  }
  // 6. trang bị ẩn (tắt màn hình / chuyển app): Chrome Android cắt phiên nhận diện đang chạy và từ chối start()
  //    bằng lỗi 'not-allowed' (mã nguồn Chromium: speech_recognition_dispatcher_host.cc, StartRequestOnUI —
  //    "On Android, background speech recognition is not permitted"). __setHidden(true/false) giả lập việc đó.
  let hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const deny = (r) => setTimeout(() => { r.onerror && r.onerror({ error: 'not-allowed' }); r.onend && r.onend(); }, 50);
  window.__setHidden = (h) => {
    hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
    if (h && window.__androidLike && active) {
      const a = active;
      active = null;
      clearTimeout(a.__t);
      a.__pending = false;
      try { orig.abort.call(a); } catch (_) {}
      deny(a);
    }
  };
  const startAndroid = SR.prototype.start;
  SR.prototype.start = function () {
    if (window.__androidLike && hidden) return deny(this);
    return startAndroid.call(this);
  };
  // 5. giọng máy tiếng nước ngoài chậm: Lợi Minh báo chiều Việt → nước ngoài rất chậm (giọng chưa tải về máy,
  //    Chrome Android setLanguage mỗi lần đổi tiếng). Giả lập: chỉ giọng không phải tiếng Việt chờ __slowTts ms.
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => {
    if (!window.__androidLike) return speak(u);
    u.onend = null;
    const slow = window.__slowTts ?? 2500;
    if (slow && !/^vi/i.test(u.lang)) setTimeout(() => speak(u), slow);
    else speak(u);
  };
})();
