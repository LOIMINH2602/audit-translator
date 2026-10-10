// Chạy trong trang app (qua CDP, tools/whisper/bench.mjs). Đo Whisper trên trình duyệt: tự dò ngôn ngữ giữa tiếng Việt và
// tiếng đối tác (bước đoán đầu tiên của decoder, so xác suất token <|vi|> với <|ko|>…), rồi nhận diện câu với ngôn ngữ đó.
// window.__BENCH = { lib, models: [{ id, dtype, device }], clips: { id: base64 mp3 }, items: [{ clip, lang, text }], snrs: [null, 10] }
(async () => {
  const B = window.__BENCH;
  const T = await import(B.lib);
  const { similarity } = await import(new URL('js/scoring.js', location.href).href);
  T.env.allowLocalModels = false;
  const ctx = new AudioContext({ sampleRate: 16000 });
  const audio = {};
  for (const [k, b64] of Object.entries(B.clips)) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    audio[k] = (await ctx.decodeAudioData(bin.buffer)).getChannelData(0).slice();
  }
  // nhiễu hồng ở SNR (dB) cho trước, cố định hạt giống để các mô hình nghe cùng 1 bản
  function noisy(x, snr) {
    if (snr == null) return x;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    const n = new Float32Array(x.length);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n.length; i++) {
      const w = rnd();
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      n[i] = b0 + b1 + b2 + w * 0.1848;
    }
    const p = (a) => a.reduce((s, v) => s + v * v, 0) / a.length;
    const g = Math.sqrt(p(x) / (p(n) * 10 ** (snr / 10)));
    return x.map((v, i) => v + n[i] * g);
  }
  const out = [];
  for (const m of B.models) {
    const t0 = performance.now();
    let processor, tokenizer, model;
    try {
      processor = await T.AutoProcessor.from_pretrained(m.id);
      tokenizer = await T.AutoTokenizer.from_pretrained(m.id);
      model = await T.WhisperForConditionalGeneration.from_pretrained(m.id, { dtype: m.dtype, device: m.device });
    } catch (e) {
      out.push({ model: m, error: 'nạp lỗi: ' + (e && e.message) });
      continue;
    }
    const loadMs = Math.round(performance.now() - t0);
    const tokId = (t) => tokenizer.model.tokens_to_ids.get(t);
    const SOT = tokId('<|startoftranscript|>');
    const rows = [];
    for (const snr of B.snrs) {
      for (const it of B.items) {
        const cands = ['vi', it.partner];
        const x = noisy(audio[it.clip], snr);
        const ta = performance.now();
        const { input_features } = await processor(x);
        // 1 lần chạy: tiền tố [<|startofprev|> thuật ngữ] <|startoftranscript|>; bộ lọc ở bước đầu chỉ cho chọn
        // <|vi|> hoặc tiếng đối tác (ghi lại xác suất = ai đang nói), rồi ép <|transcribe|><|notimestamps|>, sau đó tự do.
        const init = [];
        if (m.prompt) init.push(tokId('<|startofprev|>'), ...tokenizer.encode(' ' + m.prompt, { add_special_tokens: false }));
        init.push(SOT);
        const langIds = cands.map((c) => tokId(`<|${c}|>`));
        const force = [null, tokId('<|transcribe|>'), tokId('<|notimestamps|>')];
        let probs = null;
        class Pick extends T.LogitsProcessor {
          _call(input_ids, logits) {
            for (let i = 0; i < input_ids.length; i++) {
              const step = input_ids[i].length - init.length;
              const d = logits[i].data;
              if (step === 0) {
                const lg = langIds.map((id) => d[id]);
                const mx = Math.max(...lg);
                const ex = lg.map((v) => Math.exp(v - mx));
                const sum = ex[0] + ex[1];
                probs = ex.map((v) => v / sum);
                d.fill(-Infinity);
                langIds.forEach((id, k) => (d[id] = lg[k]));
              } else if (step === 1 || step === 2) {
                d.fill(-Infinity);
                d[force[step]] = 0;
              }
            }
            return logits;
          }
        }
        const lp = new T.LogitsProcessorList();
        lp.push(new Pick());
        const maxTok = Math.round(15 * x.length / 16000) + 12; // chữ Hàn/Trung tốn 2–3 token/âm tiết; chặn lặp vô hạn
        const seq = await model.generate({ inputs: input_features, decoder_input_ids: init, logits_processor: lp, max_new_tokens: maxTok, no_repeat_ngram_size: 4 });
        const outIds = Array.from(seq.tolist()[0]).slice(init.length);
        const pick = cands[probs[0] >= probs[1] ? 0 : 1];
        const text = tokenizer.decode(outIds, { skip_special_tokens: true }).trim();
        const tb = performance.now(), tc = tb;
        rows.push({
          clip: it.clip, snr, want: it.lang, pick, p: +probs[cands.indexOf(it.lang)].toFixed(3),
          langOk: pick === it.lang, sim: +similarity(it.text, text).toFixed(2), text,
          dur: +(x.length / 16000).toFixed(1), detectMs: Math.round(tb - ta), asrMs: Math.round(tc - tb),
        });
      }
    }
    out.push({ model: m, loadMs, rows });
    await model.dispose();
  }
  return out;
})()
