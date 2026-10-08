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
  const SR = window.webkitSpeechRecognition;
  const orig = SR.prototype.start;
  let active = null;
  window.__androidLike = false;
  SR.prototype.start = function () {
    if (window.__androidLike) {
      if (active && active !== this) { const a = active; try { a.abort(); } catch (_) {} }
      active = this;
    }
    return orig.call(this, track.clone());
  };
})();
