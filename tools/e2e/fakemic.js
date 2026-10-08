// Micro giả: 1 AudioContext → MediaStreamDestination. __say(['en-9', 1500, 'vi-7']) phát lần lượt (số = ms lặng).
// Mọi SpeechRecognition.start() đều nhận track này. __androidLike=true giả lập Android: phiên mới huỷ phiên đang chạy.
(() => {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const track = dest.stream.getAudioTracks()[0];
  // micro thật luôn có dữ liệu: phát im lặng liên tục (nhiễu rất nhỏ) để track không bao giờ 'đứng'
  const hiss = ctx.createConstantSource(); hiss.offset.value = 0.0001; hiss.connect(dest); hiss.start();
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
