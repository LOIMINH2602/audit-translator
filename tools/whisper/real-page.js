// Chạy trong trang app (tools/whisper/real.mjs): đo Whisper trên GIỌNG NGƯỜI THẬT, ở 2 điều kiện: thu sạch và "qua tai nghe
// Bluetooth" (băng hẹp 8 kHz như micro HFP + nhiễu hồng SNR 15 dB). Mỗi câu dò ngôn ngữ 2 cách: giữa Việt và tiếng thật của câu
// (cách app đang làm) và giữa cả 5 tiếng (Việt/Anh/Hàn/Trung/Nhật — không cần chọn trước tiếng đối tác).
// window.__REAL = { lib, models: [{ id, dtype, device }], files: { name: base64 }, items: [{ file, lang, text }], prompt }
(async () => {
  const B = window.__REAL;
  const T = await import(B.lib);
  const { similarity } = await import(new URL('js/scoring.js', location.href).href);
  T.env.allowLocalModels = false;
  const ctx = new AudioContext({ sampleRate: 16000 });
  const audio = {};
  for (const [k, b64] of Object.entries(B.files)) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    audio[k] = (await ctx.decodeAudioData(bin.buffer)).getChannelData(0).slice();
  }
  // "qua Bluetooth": lọc thông thấp 3,4 kHz (OfflineAudioContext) rồi lấy mẫu 8 kHz → 16 kHz, cộng nhiễu
  async function bt(x) {
    const oc = new OfflineAudioContext(1, Math.ceil(x.length / 2), 8000);
    const b = oc.createBuffer(1, x.length, 16000);
    b.copyToChannel(x, 0);
    const s = oc.createBufferSource(); s.buffer = b;
    const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3400;
    s.connect(f).connect(oc.destination); s.start();
    const nb = (await oc.startRendering()).getChannelData(0);
    const oc2 = new OfflineAudioContext(1, x.length, 16000);
    const b2 = oc2.createBuffer(1, nb.length, 8000); b2.copyToChannel(nb, 0);
    const s2 = oc2.createBufferSource(); s2.buffer = b2; s2.connect(oc2.destination); s2.start();
    const y = (await oc2.startRendering()).getChannelData(0).slice();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    let b0 = 0, b1 = 0, b2n = 0;
    const n = y.map(() => { const w = rnd(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2n = 0.57 * b2n + w * 1.0526913; return b0 + b1 + b2n + w * 0.1848; });
    const p = (a) => a.reduce((s, v) => s + v * v, 0) / a.length;
    const g = Math.sqrt(p(y) / (p(n) * 10 ** (15 / 10)));
    return y.map((v, i) => v + n[i] * g);
  }
  const ALL = ['vi', 'en', 'ko', 'zh', 'ja'];
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
    const rows = [];
    for (const cond of ['sạch', 'bluetooth']) {
      for (const it of B.items) {
        const x = cond === 'sạch' ? audio[it.file] : await bt(audio[it.file]);
        const ta = performance.now();
        const { input_features } = await processor(x);
        const init = [];
        if (B.prompt) init.push(tokId('<|startofprev|>'), ...tokenizer.encode(' ' + B.prompt, { add_special_tokens: false }));
        init.push(tokId('<|startoftranscript|>'));
        let lg = null;
        // 5 tiếng: lấy logits bước đầu của cả 5; nhận diện theo tiếng thắng trong 5 (không chọn tiếng đối tác trước)
        class Pick extends T.LogitsProcessor {
          _call(input_ids, logits) {
            const step = input_ids[0].length - init.length;
            const d = logits[0].data;
            if (step === 0 && m.lang) {
              // mô hình chuyên 1 tiếng (PhoWhisper): ép luôn tiếng đó, không dò
              lg = Object.fromEntries(ALL.map((c) => [c, c === m.lang ? 1 : 0]));
              d.fill(-Infinity);
              d[tokId(`<|${m.lang}|>`)] = 0;
            } else if (step === 0) {
              lg = Object.fromEntries(ALL.map((c) => [c, d[tokId(`<|${c}|>`)]]));
              const keep = ALL.map((c) => [tokId(`<|${c}|>`), d[tokId(`<|${c}|>`)]]);
              d.fill(-Infinity);
              for (const [id, v] of keep) d[id] = v;
            } else if (step === 1 || step === 2) {
              d.fill(-Infinity);
              d[tokId(step === 1 ? '<|transcribe|>' : '<|notimestamps|>')] = 0;
            }
            return logits;
          }
        }
        const lp = new T.LogitsProcessorList(); lp.push(new Pick());
        const seq = await model.generate({ inputs: input_features, decoder_input_ids: init, logits_processor: lp, max_new_tokens: Math.round((15 * x.length) / 16000) + 12, no_repeat_ngram_size: 4 });
        const ids = Array.from(seq.tolist()[0]).slice(init.length);
        const text = tokenizer.decode(ids, { skip_special_tokens: true }).trim();
        const ms = Math.round(performance.now() - ta);
        const top5 = ALL.reduce((a, c) => (lg[c] > lg[a] ? c : a), 'vi');
        // 2 tiếng: Việt với tiếng thật của câu (câu Việt: so với tiếng Hàn — trường hợp của Lợi Minh)
        const pair = it.lang === 'vi' ? ['vi', 'ko'] : ['vi', it.lang];
        const top2 = lg[pair[0]] >= lg[pair[1]] ? pair[0] : pair[1];
        rows.push({ file: it.file, cond, lang: it.lang, top2, top5, ok2: top2 === it.lang, ok5: top5 === it.lang,
          sim: +similarity(it.text, text).toFixed(2), text, dur: +(x.length / 16000).toFixed(1), ms });
      }
    }
    out.push({ model: m, loadMs, rows });
    await model.dispose();
  }
  return out;
})()
