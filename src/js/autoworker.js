// Luồng nền (Web Worker) của chế độ "Tự nhận người nói": Silero VAD cắt câu + Whisper dò ngôn ngữ và nhận diện.
// Vì sao (10/10/2026): Chrome Android chỉ nghe 1 tiếng mỗi lúc → app phải đoán lượt, Lợi Minh phải bấm "Mời … nói".
// Whisper chạy trên máy nghe mọi câu và tự biết câu đó là tiếng Việt hay tiếng đối tác. Đo trên 66 câu mẫu (Google TTS,
// sạch + ồn 10 dB): nhận đúng người nói 38/40 ở cả 2 mức, sai chỉ ở câu Việt rất ngắn ("Vâng.", "Không có.").
// Dò ngôn ngữ trong cùng 1 lần chạy với nhận diện: bộ lọc ở bước đầu của decoder chỉ cho chọn <|vi|> hoặc tiếng đối
// tác (transformers.js 3.8.1 chưa có dò ngôn ngữ cho Whisper — mặc định tiếng Anh).
//
// Chế độ 'hybrid' (10/10/2026, sau khi đo giọng người thật: Whisper chép chữ tiếng Việt kém — tiny ~50% — còn Google 93%;
// điện thoại Lợi Minh cho app và Google cùng thu micro): worker CHỈ dò ngôn ngữ mỗi câu (encoder + 1 bước decoder, nhanh)
// và gửi 'segment'; chữ lấy từ Google. Câu Google nghe sai tiếng thì trang xin 'transcribe' → chép bằng Whisper (tiếng đối
// tác) hoặc PhoWhisper-tiny (tiếng Việt, VinAI).
//
// Nhận: { type: 'load', model, device, f16, partner, endSilenceMs, prompt, mode?: 'full'|'hybrid' }, { type: 'frame', data },
//       { type: 'config', partner?, endSilenceMs?, muted?, tts? }, { type: 'flush' }, { type: 'transcribe', id, lang } (hybrid)
// Gửi:  { type: 'progress', file, loaded, total }, { type: 'stage', name, ms } (từng bước nạp), { type: 'ready', device, model, loadMs }, { type: 'speaking', on },
//       { type: 'sentence', lang, prob, text, audioMs, asrMs, queuedMs, endAt }, { type: 'dropped', why, text }, { type: 'error', message }
//       hybrid: { type: 'segment', id, lang, prob, audioMs, startAt, endAt, lidMs, duringTts }, { type: 'fallback', id, lang, text, ms, model }

import { createSegmenter, FRAME, SR } from './segmenter.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const W = { 'vi-VN': 'vi', 'en-US': 'en', 'zh-CN': 'zh', 'ja-JP': 'ja', 'ko-KR': 'ko' };
// Whisper hay "bịa" các câu này khi nghe tiếng ồn/im lặng (học từ phụ đề video)
const HALLU = /subscribe|đăng ký kênh|theo dõi kênh|cảm ơn các bạn đã (xem|theo dõi)|thank(s| you) for watching|시청해 ?주셔서|구독|ご視聴|ありがとうございました。?$|谢谢观看|字幕/i;

let T, processor, tokenizer, model, vad, vadState, srTensor;
let partner = 'ko';
let prompt = null;
let muted = false;
let seg = createSegmenter();
let lastSpeaking = false;
let frames = []; // khung chờ VAD
let vadBusy = false;
let mode = 'full';
// hybrid: app đang đọc bản dịch. Không tắt nghe (người nói có thể nói tiếp trong lúc app đọc) — chỉ đánh dấu câu nào có lúc
// trùng giọng đọc; trang bỏ câu đó nếu Whisper nghe ra đúng tiếng app đang đọc (tiếng vọng), giữ nếu là tiếng khác.
let tts = false;
let segTts = false;
let pho = null; // { processor, tokenizer, model } PhoWhisper-tiny, nạp nền sau khi sẵn sàng (chỉ hybrid)
const kept = new Map(); // id câu → audio (hybrid: giữ vài câu gần nhất để chép lại khi Google nghe sai tiếng)

const post = (m) => self.postMessage(m);

async function load({ model: size = 'base', device = 'wasm', f16 = false, partner: p, endSilenceMs, prompt: pr, mode: md = 'full' }) {
  const t0 = performance.now();
  mode = md;
  T = await import(LIB);
  T.env.allowLocalModels = false;
  partner = W[p] || p;
  prompt = pr || null;
  if (endSilenceMs) seg.setEndSilence(endSilenceMs);
  const progress_callback = (x) => x.status === 'progress' && post({ type: 'progress', file: x.file, loaded: x.loaded, total: x.total });
  let tStage = performance.now();
  const stage = (name) => {
    post({ type: 'stage', name, ms: Math.round(performance.now() - tStage) });
    tStage = performance.now();
  };
  stage('thư viện');
  vad = await T.AutoModel.from_pretrained('onnx-community/silero-vad', { config: { model_type: 'custom' }, dtype: 'fp32', progress_callback });
  vadState = new T.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  srTensor = new T.Tensor('int64', [BigInt(SR)], []);
  stage('VAD');
  const id = `onnx-community/whisper-${size}`;
  processor = await T.AutoProcessor.from_pretrained(id, { progress_callback });
  tokenizer = await T.AutoTokenizer.from_pretrained(id, { progress_callback });
  // encoder fp32 (fp16 làm hỏng base); decoder fp16 nếu GPU hỗ trợ (nhanh hơn q4 35–45%)
  const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: f16 ? 'fp16' : 'q4' } : 'q8';
  model = await T.WhisperForConditionalGeneration.from_pretrained(id, { dtype, device, progress_callback });
  stage(`Whisper ${size} (${device})`);
  // chạy thử 1 lần cho nóng máy (biên dịch shader WebGPU / khởi tạo wasm): câu thật đầu tiên không bị chậm
  if (mode === 'hybrid') await lid(new Float32Array(SR));
  else await transcribe(new Float32Array(SR));
  stage('chạy thử');
  post({ type: 'ready', device: device + (device === 'webgpu' ? (f16 ? ' fp16' : ' q4') : ''), model: size, mode, loadMs: Math.round(performance.now() - t0) });
  if (mode === 'hybrid') loadPho(progress_callback, device); // nền: chỉ cần khi Google nghe sai tiếng ở 1 câu tiếng Việt
}

// PhoWhisper-tiny (VinAI, chuyên tiếng Việt), bản nén q8 chạy CPU, ~41 MB. Đo giọng Việt thật: khớp chữ 85–91% (có thể cao
// hơn thực tế vì bộ đo VLSP2020 nằm trong dữ liệu huấn luyện của nó) — so với Whisper tiny đa ngữ ~50%.
// Có WebGPU: bản fp32 (~150 MB) chạy GPU — đo máy tính 2,8–3,0 s/câu 7 s so với CPU q8 3,5–5,6 s.
async function loadPho(progress_callback, device) {
  try {
    const id = 'huuquyet/PhoWhisper-tiny';
    const gpu = device === 'webgpu';
    const [p, t, m] = await Promise.all([
      T.AutoProcessor.from_pretrained(id, { progress_callback }),
      T.AutoTokenizer.from_pretrained(id, { progress_callback }),
      T.WhisperForConditionalGeneration.from_pretrained(id, gpu
        ? { dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' }, device: 'webgpu', progress_callback }
        : { dtype: 'q8', device: 'wasm', progress_callback }),
    ]);
    pho = { processor: p, tokenizer: t, model: m };
    post({ type: 'stage', name: 'PhoWhisper (dự phòng tiếng Việt)', ms: 0 });
  } catch (e) {
    post({ type: 'error', message: 'nạp PhoWhisper lỗi: ' + (e && e.message) });
  }
}

// Dò ngôn ngữ: Việt hay tiếng đối tác (encoder + 1 bước decoder từ <|startoftranscript|>).
async function lid(audio) {
  const { input_features } = await processor(audio);
  const dec = new T.Tensor('int64', BigInt64Array.from([BigInt(tokId('<|startoftranscript|>'))]), [1, 1]);
  const o = await model({ input_features, decoder_input_ids: dec });
  const V = o.logits.dims.at(-1);
  const last = o.logits.data.slice(o.logits.data.length - V);
  const cands = ['vi', partner];
  const lg = cands.map((c) => last[tokId(`<|${c}|>`)]);
  const mx = Math.max(...lg);
  const ex = lg.map((v) => Math.exp(v - mx));
  const k = ex[0] >= ex[1] ? 0 : 1;
  return { lang: cands[k], prob: ex[k] / (ex[0] + ex[1]) };
}

// Chép 1 câu với ngôn ngữ đã biết (dự phòng khi Google nghe sai tiếng).
async function transcribeAs(audio, lang) {
  const use = lang === 'vi' && pho ? pho : { processor, tokenizer, model };
  const tid = (t) => use.tokenizer.model.tokens_to_ids.get(t);
  const { input_features } = await use.processor(audio);
  const init = [tid('<|startoftranscript|>'), tid(`<|${lang}|>`), tid('<|transcribe|>'), tid('<|notimestamps|>')];
  const maxTok = Math.round((15 * audio.length) / SR) + 12;
  const seq = await use.model.generate({ inputs: input_features, decoder_input_ids: init, max_new_tokens: maxTok, no_repeat_ngram_size: 4 });
  const ids = Array.from(seq.tolist()[0]).slice(init.length);
  return { text: use.tokenizer.decode(ids, { skip_special_tokens: true }).trim(), model: use === pho ? 'PhoWhisper' : 'Whisper' };
}

const tokId = (t) => tokenizer.model.tokens_to_ids.get(t);

async function transcribe(audio) {
  const t0 = performance.now();
  const { input_features } = await processor(audio);
  const tFeat = performance.now();
  const init = [];
  if (prompt) init.push(tokId('<|startofprev|>'), ...tokenizer.encode(' ' + prompt, { add_special_tokens: false }));
  init.push(tokId('<|startoftranscript|>'));
  const cands = ['vi', partner];
  const langIds = cands.map((c) => tokId(`<|${c}|>`));
  const force = [null, tokId('<|transcribe|>'), tokId('<|notimestamps|>')];
  let probs = [1, 0];
  class Pick extends T.LogitsProcessor {
    _call(input_ids, logits) {
      for (let i = 0; i < input_ids.length; i++) {
        const step = input_ids[i].length - init.length;
        const d = logits[i].data;
        if (step === 0) {
          const lg = langIds.map((id) => d[id]);
          const mx = Math.max(...lg);
          const ex = lg.map((v) => Math.exp(v - mx));
          probs = ex.map((v) => v / (ex[0] + ex[1]));
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
  const maxTok = Math.round((15 * audio.length) / SR) + 12; // chặn lặp vô hạn
  const seq = await model.generate({ inputs: input_features, decoder_input_ids: init, logits_processor: lp, max_new_tokens: maxTok, no_repeat_ngram_size: 4 });
  const ids = Array.from(seq.tolist()[0]).slice(init.length);
  const k = probs[0] >= probs[1] ? 0 : 1;
  const featMs = Math.round(tFeat - t0);
  return { lang: cands[k], prob: probs[k], text: tokenizer.decode(ids, { skip_special_tokens: true }).trim(), featMs, genMs: Math.round(performance.now() - tFeat), tokens: ids.length };
}

// Whisper chạy lần lượt từng việc (1 mô hình, không chạy chồng)
let gpu = Promise.resolve();
function runWhisper(audio) {
  const p = gpu.then(() => transcribe(audio));
  gpu = p.catch(() => {});
  return p;
}

// Nhận diện sớm: người nói ngừng SPEC_MS thì nhận diện luôn phần đã nói, không chờ hết thời gian "hết câu". Câu kết thúc
// mà không nói thêm (cùng id + version) thì dùng kết quả đó → bản dịch đến sớm hơn ~(thời gian chờ − SPEC_MS).
const SPEC_MS = 250;
let spec = null; // { id, version, p }

function deliver(r, s, t0) {
  const audioMs = Math.round((s.audio.length / SR) * 1000);
  const asrMs = Math.round(performance.now() - t0);
  const words = r.text.split(/\s+/).filter(Boolean);
  if (!r.text || !/\p{L}/u.test(r.text)) post({ type: 'dropped', why: 'không ra chữ', text: r.text });
  else if (HALLU.test(r.text)) post({ type: 'dropped', why: 'câu Whisper hay bịa khi ồn', text: r.text });
  else if (words.length > 6 && new Set(words).size / words.length < 0.35) post({ type: 'dropped', why: 'lặp chữ', text: r.text });
  // endAt: lúc máy nhận ra hết câu, theo giờ chung (performance.timeOrigin + now) để trang đối chiếu với giờ của nó
  else post({ type: 'sentence', ...r, prob: +r.prob.toFixed(3), audioMs, asrMs, queuedMs: 0, early: Boolean(s.early), endAt: performance.timeOrigin + s.at });
}

async function finishSentence(done) {
  const s = { audio: done.audio, at: performance.now() };
  if (mode === 'hybrid') return finishSegment(done, s);
  try {
    if (spec && spec.id === done.id && spec.version === done.version) {
      const sp = spec;
      spec = null;
      s.early = true;
      deliver(await sp.p, s, sp.t0);
      return;
    }
    spec = null;
    const t0 = performance.now();
    deliver(await runWhisper(done.audio), s, t0);
  } catch (e) {
    post({ type: 'error', message: 'Whisper lỗi: ' + (e && e.message) });
  }
}

// hybrid: hết câu → dò ngôn ngữ (dùng kết quả dò sớm nếu khớp) → gửi 'segment'; giữ audio để chép lại nếu cần
async function finishSegment(done, s) {
  kept.set(done.id, done.audio);
  if (kept.size > 8) kept.delete(kept.keys().next().value);
  const audioMs = Math.round((done.audio.length / SR) * 1000);
  try {
    let r, t0;
    if (spec && spec.id === done.id && spec.version === done.version) {
      r = await spec.p;
      t0 = spec.t0;
    } else {
      t0 = performance.now();
      r = await runJob(() => lid(done.audio));
    }
    spec = null;
    const endAt = performance.timeOrigin + s.at;
    post({ type: 'segment', id: done.id, lang: r.lang, prob: +r.prob.toFixed(3), audioMs, startAt: endAt - audioMs - seg.endSilence(), endAt, lidMs: Math.round(performance.now() - t0), duringTts: Boolean(done.duringTts) });
  } catch (e) {
    post({ type: 'error', message: 'dò ngôn ngữ lỗi: ' + (e && e.message) });
  }
}

function runJob(fn) {
  const p = gpu.then(fn);
  gpu = p.catch(() => {});
  return p;
}

async function runVad() {
  if (vadBusy) return;
  vadBusy = true;
  while (frames.length) {
    const fr = frames.shift();
    let prob = 0;
    try {
      const { output, stateN } = await vad({ input: new T.Tensor('float32', fr, [1, FRAME]), sr: srTensor, state: vadState });
      vadState = stateN;
      prob = output.data[0];
    } catch (e) {
      post({ type: 'error', message: 'VAD lỗi: ' + (e && e.message) });
    }
    if (muted) continue; // đang đọc bản dịch: không nghe (tránh dịch lại tiếng của chính app)
    const wasActive = seg.active();
    const done = seg.push(fr, prob);
    if (!wasActive && seg.active()) segTts = tts; // câu mới bắt đầu
    if (tts && seg.active()) segTts = true; // chỉ câu thật sự nói trong lúc app đọc
    const sp = seg.speaking();
    if (sp !== lastSpeaking) post({ type: 'speaking', on: (lastSpeaking = sp) });
    if (done) {
      done.duringTts = segTts;
      segTts = false;
      finishSentence(done);
    }
    else {
      const pk = seg.peek(SPEC_MS);
      if (pk && !(spec && spec.id === pk.id && spec.version === pk.version)) {
        spec = { id: pk.id, version: pk.version, t0: performance.now() };
        spec.p = mode === 'hybrid' ? runJob(() => lid(pk.audio)) : runWhisper(pk.audio);
        spec.p.catch(() => {});
      }
    }
  }
  vadBusy = false;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') await load(m);
    else if (m.type === 'frame') {
      if (!vad) return;
      frames.push(m.data);
      runVad();
    } else if (m.type === 'config') {
      if (m.partner) partner = W[m.partner] || m.partner;
      if (m.endSilenceMs) seg.setEndSilence(m.endSilenceMs);
      if (m.tts !== undefined) tts = m.tts;
      if (m.muted !== undefined) {
        muted = m.muted;
        if (muted) {
          seg.reset();
          if (lastSpeaking) post({ type: 'speaking', on: (lastSpeaking = false) });
        }
      }
    } else if (m.type === 'transcribe') {
      const audio = kept.get(m.id);
      if (!audio) return post({ type: 'fallback', id: m.id, lang: m.lang, text: '', ms: 0, model: 'mất audio' });
      const t0 = performance.now();
      const lang = W[m.lang] || m.lang;
      const r = await runJob(() => transcribeAs(audio, lang));
      post({ type: 'fallback', id: m.id, lang, text: r.text, model: r.model, ms: Math.round(performance.now() - t0) });
    } else if (m.type === 'flush') {
      const done = seg.flush();
      if (done) finishSentence(done);
    }
  } catch (err) {
    post({ type: 'error', message: (err && err.message) || String(err) });
  }
};
