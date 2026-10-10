// Chạy trong trang app (tools/e2e/auto.mjs): micro giả (fakemic.js) đưa vào getUserMedia → autolisten.js (VAD + Whisper
// trong worker). Phát kịch bản hội thoại, ghi lại câu app nhận ra: ai nói (theo ngôn ngữ dò được), chữ, độ trễ.
// window.__AUTO = { partner, model, device, endSilenceMs, script: [[side, clip, gapAfterMs], ...], truth: { clip: text } }
(async () => {
  const A = window.__AUTO;
  await window.__ready;
  const track = window.__fakeTrack;
  navigator.mediaDevices.getUserMedia = async () => new MediaStream([track.clone()]);
  const { createAutoListener } = await import(new URL('js/autolisten.js', location.href).href);
  const { similarity } = await import(new URL('js/scoring.js', location.href).href);
  const got = [];
  const dropped = [];
  const errors = [];
  let pct = 0;
  const stages = [];
  const L = createAutoListener({
    model: A.model, device: A.device, partner: A.partner, endSilenceMs: A.endSilenceMs, prompt: A.prompt,
    onProgress: (p) => (pct = p),
    onStage: (st) => stages.push(`${st.name} ${st.ms}ms`),
    onSentence: (r) => got.push({ ...r, at: performance.timeOrigin + performance.now() }),
    onDropped: (r) => dropped.push(r),
    onError: (m) => errors.push(m),
  });
  const t0 = performance.now();
  let info;
  try {
    info = await L.load();
  } catch (e) {
    return { error: 'nạp lỗi: ' + e.message + ' · ' + stages.join(', '), errors };
  }
  const loadMs = Math.round(performance.now() - t0);
  await L.start();
  await __say([500]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const turns = [];
  for (const [side, clip, gap] of A.script) {
    const ms = await __say([clip]);
    const end = performance.timeOrigin + performance.now() + ms;
    turns.push({ side, clip, end });
    await sleep(ms + (gap ?? 1500));
  }
  await sleep(8000); // chờ câu cuối xử lý xong
  L.stop();
  // ghép câu với lượt nói theo lúc máy nhận ra hết câu (endAt). Mẫu giọng Google có tới ~0,8s im lặng ở cuối file nên VAD
  // có thể báo hết câu TRƯỚC lúc file kết thúc: cho phép sớm tối đa 1,5s.
  const owner = (g) => turns.reduce((k, t, i) => (t.end - 1500 <= g.endAt ? i : k), -1);
  const res = turns.map((t, i) => {
    const mine = got.filter((g) => owner(g) === i);
    const g = mine[0];
    const wantLang = t.side === 'me' ? 'vi' : A.partnerW;
    return {
      clip: t.clip, side: t.side, n: mine.length,
      ok: Boolean(g) && mine.every((x) => x.lang === wantLang),
      lang: g ? mine.map((x) => x.lang).join('+') : '-', prob: g ? g.prob : null,
      text: mine.map((x) => x.text).join(' | '), sim: g ? +similarity(A.truth[t.clip], mine.map((x) => x.text).join(' ')).toFixed(2) : 0,
      latency: g ? Math.round(mine[mine.length - 1].at - t.end) : null, asrMs: g ? g.asrMs : null,
    };
  });
  return { info, loadMs, stages, turnEnds: turns.map((t) => Math.round(t.end - turns[0].end)), got: got.map((g) => ({ endRel: Math.round(g.endAt - turns[0].end), text: g.text.slice(0, 20), lang: g.lang, asrMs: g.asrMs, featMs: g.featMs, genMs: g.genMs, tokens: g.tokens, queuedMs: g.queuedMs, audioMs: g.audioMs })), res, dropped, errors, extra: got.filter((g) => owner(g) < 0).length };
})()
