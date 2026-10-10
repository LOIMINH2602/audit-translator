// Màn 1:1, cách nghe "Tự nhận người nói" (bản ghép, 10/10/2026): Google ra chữ + Whisper biết ai nói. Không lượt, không nút.
// Vì sao ghép: đo giọng người thật — Google (SpeechRecognition) chép chữ Việt 93% / Hàn 94% / Anh 95%; Whisper trên máy chép
// chữ kém (tiny Việt ~50%) nhưng nhận đúng tiếng/người nói 69–70/70. Điện thoại Lợi Minh qua bài "Thử nghe song song": cho
// app (getUserMedia) và Google cùng thu micro.
//
// Luồng: Google nghe liên tục bằng 1 tiếng (srLang). Song song, micro app → VAD → Whisper dò tiếng của từng câu (autoworker.js
// chế độ 'hybrid'). Mỗi câu:
//   - Whisper cùng tiếng với Google → dùng chữ của Google.
//   - khác tiếng → chữ Google là rác: bỏ; chép lại câu bằng Whisper (tiếng đối tác) / PhoWhisper (tiếng Việt); chuyển Google
//     sang tiếng đó cho câu sau.
//   - Whisper không chắc (< SURE_LID) mà Google dò chữ ra đúng tiếng của nó → tin Google.
// Dịch + đọc ngay từng câu (không chờ lượt). Đọc xong: Google nghe sẵn tiếng của người đoán sẽ nói tiếp (predictNext).
// Google nghe được mà VAD bỏ sót câu → sau ORPHAN_MS vẫn dịch theo Google.

import { $, setError, timeNow, renderLog } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer } from './recognizer.js';
import { detectTranslate } from './translate.js';
import { isEcho, baseLang } from './speaker.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, cancel as cancelSpeech } from './tts.js';
import { diag } from './diagnostics.js';
import { createAutoListener } from './autolisten.js';
import { classifyMicError } from './keepalive.js';

const WHO = { me: 'Tôi', partner: 'Đối tác' };
const W2L = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };
const now = () => performance.timeOrigin + performance.now(); // giờ chung với worker
const FINAL_WAIT_MS = 2500; // Google đang nghe dở (có chữ tạm): chờ final tối đa chừng này (Android trả final muộn 1–2s)
const HEARD_GRACE_MS = 300; // Google chưa có chữ tạm nào cho câu: chờ thêm chút rồi coi như Google không nghe được
const EARLY_MS = 600; // chữ Google thuộc câu nếu đến sau lúc câu bắt đầu trừ khoảng này
const ORPHAN_MS = 2500; // Google ra chữ mà không có câu nào của VAD nhận → vẫn dịch
const SURE_LID = 0.8;
const ECHO_WINDOW_MS = 3000;
const UNMUTE_AFTER_MS = 250;

// ctx: { log, partnerLang(), endSilenceMs(), status(text), model?, device? }
export function createHybridTalk(ctx) {
  let L = null;
  let rec = null;
  let running = false;
  let speaking = false;
  let srLang = 'vi-VN';
  let lastSpoken = { text: '', lang: '', endAt: -1e9 };
  const finals = []; // { text, at, lang, used }
  let interim = { text: '', at: 0, lang: '' };
  let lastUsedFinalAt = 0; // lúc nhận final Google vừa dùng: câu VAD bắt đầu trước lúc này đã nằm trong final đó
  const speakers = []; // ai nói các câu gần đây ('me'|'partner') — để đoán người nói tiếp
  let vadSpeaking = false; // micro app đang nghe thấy có người nói
  let ttsLang = null; // tiếng app đang đọc
  let chain = Promise.resolve(); // xử lý câu theo thứ tự
  let orphans = 0; // số câu liên tiếp chỉ Google nghe được: micro app im lặng = máy không cho nghe song song
  const sayQueue = [];

  const other = (lang) => (lang === 'vi-VN' ? ctx.partnerLang() : 'vi-VN');
  const sideOf = (lang) => (lang === 'vi-VN' ? 'me' : 'partner');
  const idle = () => `Đang nghe cả hai · Việt ↔ ${NAMES[ctx.partnerLang()]} · tự nhận ai nói (Google đang nghe tiếng ${NAMES[srLang]})`;

  function setSr(lang, why) {
    if (lang === srLang) return;
    diag(`Google chuyển sang nghe tiếng ${NAMES[lang]} (${why})`);
    srLang = lang;
    interim = { text: '', at: 0, lang: '' };
    if (rec && !speaking) rec.setLang(lang);
    if (running && !speaking) ctx.status(idle());
  }

  function buildRec() {
    rec = createRecognizer({
      name: 'google',
      lang: srLang,
      continuous: false,
      onFinal: (text) => {
        if (!running || speaking || !text) return;
        const f = { text, at: now(), lang: srLang, used: false };
        finals.push(f);
        if (finals.length > 20) finals.shift();
        // không có câu VAD nào nhận chữ này (VAD bỏ sót câu nói nhỏ) → vẫn dịch theo Google
        setTimeout(() => { if (!f.used && running) { f.used = true; enqueue({ google: f }); } }, ORPHAN_MS);
      },
      onInterim: (text) => { if (running && !speaking) interim = { text: text.trim(), at: now(), lang: srLang }; },
      onError: async (err) => {
        const kind = await classifyMicError(err);
        if (kind === 'denied') setError($('dlgErr'), 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.');
        else diag(`LỖI google: ${err}${kind ? ' (' + kind + ')' : ''}`);
      },
      onLog: diag,
    });
  }

  function listener() {
    if (L) return L;
    L = createAutoListener({
      mode: 'hybrid',
      model: ctx.model,
      device: ctx.device,
      partner: ctx.partnerLang(),
      endSilenceMs: ctx.endSilenceMs(),
      onProgress: (pct) => ctx.status(`Đang tải bộ nhận người nói (chỉ lần đầu): ${pct}%`),
      onStage: (st) => diag(`Tự nhận người nói: nạp xong ${st.name} (${st.ms}ms)`),
      onReady: (i) => diag(`Tự nhận người nói (ghép Google): sẵn sàng (whisper-${i.model}, ${i.device}, nạp ${i.loadMs}ms)`),
      onSegment: (s) => { if (running) enqueue({ seg: { ...s, ttsLang: s.duringTts ? ttsLang || lastSpoken.lang : null } }); },
      onSpeaking: (on) => {
        vadSpeaking = on;
        if (running && !speaking) ctx.status(on ? '🎤 Đang nghe một người nói…' : idle());
      },
      onError: (m) => diag('LỖI tự nhận người nói: ' + m),
    });
    return L;
  }

  let pending = 0; // câu đang chờ / đang xử lý
  function enqueue(job) {
    pending++;
    chain = chain.then(() => handle(job)).catch((e) => diag('LỖI xử lý câu: ' + (e && e.message))).finally(() => pending--);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // chữ Google thuộc câu s: các final đến sau lúc câu bắt đầu. Google đang nghe dở (có chữ tạm trong câu) → chờ final tối đa
  // FINAL_WAIT_MS; Google không nghe thấy gì → trả null ngay (không bắt người nghe chờ vô ích).
  async function googleTextFor(s) {
    const from = s.startAt - EARLY_MS;
    const pick = () => finals.filter((f) => !f.used && f.at >= from);
    const heard = () => pick().length || interim.at >= from;
    const grace = now() + HEARD_GRACE_MS;
    while (!heard() && now() < grace && running) await sleep(50);
    const deadline = now() + FINAL_WAIT_MS;
    while (heard() && !pick().length && now() < deadline && running) await sleep(50);
    const fs = pick();
    if (fs.length) {
      fs.forEach((f) => (f.used = true));
      lastUsedFinalAt = fs[fs.length - 1].at;
      return { text: fs.map((f) => f.text).join(' '), lang: fs[fs.length - 1].lang, how: 'final' };
    }
    if (interim.text && interim.at >= from) {
      const t = interim;
      interim = { text: '', at: 0, lang: '' };
      if (rec) rec.restart(); // bỏ phiên đang giữ chữ tạm này: tránh final của nó bị dịch lần nữa
      return { text: t.text, lang: t.lang, how: 'chữ tạm' };
    }
    return null;
  }

  async function handle(job) {
    if (!running) return;
    let text, lang, src, info;
    const t0 = performance.now();
    if (job.google) {
      if (++orphans >= 3) setError($('dlgErr'), 'Micro của app không nhận được tiếng trong lúc Google nghe (máy không cho nghe song song). Chọn "Chrome luân phiên" ở ô Cách nghe.');
      ({ text, lang } = job.google);
      if (!/\p{L}/u.test(text)) return diag(`Bỏ chữ Google không có câu VAD, chỉ có số: "${text}"`); // số: không biết của ai
      // không có Whisper xác nhận: chỉ dịch nếu chữ Google đúng là tiếng Google đang nghe (Google nghe sai tiếng ra chữ rác)
      let det = null;
      try { det = (await detectTranslate(text, lang, other(lang))).detected; } catch (_) {}
      if (det && baseLang(det) !== baseLang(lang)) return diag(`Bỏ chữ Google không có câu VAD, dò ra ${det}: "${text}"`);
      src = 'Google';
      info = 'Google (VAD bỏ sót câu)';
    } else {
      const s = job.seg;
      orphans = 0;
      const wl = W2L[s.lang] || ctx.partnerLang();
      // câu có lúc trùng giọng đọc của app: cùng tiếng app đang/vừa đọc = tiếng vọng → bỏ; khác tiếng = người nói tiếp → giữ
      // câu nói trùng lúc app đọc bằng cùng tiếng: có thể là tiếng vọng giọng đọc, cũng có thể người kia nói chen → chép ra
      // chữ, giống câu app vừa đọc mới bỏ
      let chen = null;
      if (s.duringTts && wl === s.ttsLang) {
        const r = await L.transcribe(s.id, wl);
        if (!running) return;
        if (!r.text || isEcho(r.text, lastSpoken.text)) return diag(`Bỏ tiếng vọng giọng đọc (${NAMES[wl]}): "${r.text}"`);
        chen = r;
      }
      const g = chen ? null : await googleTextFor(s); // Google tạm dừng lúc app đọc: câu nói chen không có chữ Google
      if (!running) return;
      // câu dài có quãng nghỉ bị VAD cắt làm 2: final Google của phần trước đã gồm phần này → không chép lại (tránh dịch trùng)
      if (!g && s.startAt < lastUsedFinalAt) return diag(`Bỏ đoạn ${s.audioMs}ms: đã nằm trong câu Google vừa dịch`);
      if (g && g.lang === wl) {
        ({ text, lang } = g);
        src = 'Google';
        info = `Google (${g.how}) · Whisper: ${NAMES[wl]} ${Math.round(s.prob * 100)}%`;
      } else if (g && s.prob < SURE_LID) {
        // Whisper không chắc: hỏi Google dò ngôn ngữ của chữ nó nghe được
        let det = null;
        try { det = (await detectTranslate(g.text, g.lang, other(g.lang))).detected; } catch (_) {}
        if (det && baseLang(det) === baseLang(g.lang)) {
          ({ text, lang } = g);
          src = 'Google';
          info = `Google (Whisper không chắc ${Math.round(s.prob * 100)}% ${NAMES[wl]}; chữ dò ra ${det})`;
        }
      }
      if (!text) {
        // Google nghe sai tiếng (hoặc không nghe được): chép lại câu này bằng Whisper/PhoWhisper, chuyển Google sang tiếng đúng
        if (!chen) setSr(wl, `Whisper nghe ra tiếng ${NAMES[wl]} ${Math.round(s.prob * 100)}%`);
        const r = chen || (await L.transcribe(s.id, wl));
        if (!running) return;
        if (!r.text || !/\p{L}/u.test(r.text)) return diag(`Bỏ câu (${r.model} không ra chữ)`);
        text = r.text;
        lang = wl;
        src = r.model;
        info = `${r.model} ${r.ms}ms (Google đang nghe ${g ? NAMES[g.lang] + ': "' + g.text + '"' : 'không ra chữ'}) · Whisper: ${NAMES[wl]} ${Math.round(s.prob * 100)}%`;
      }
    }
    const side = sideOf(lang);
    const to = side === 'me' ? ctx.partnerLang() : 'vi-VN';
    if (lang === lastSpoken.lang && performance.now() - lastSpoken.endAt < ECHO_WINDOW_MS && isEcho(text, lastSpoken.text)) {
      return diag(`Bỏ tiếng vọng: "${text}"`);
    }
    let t;
    try {
      t = await detectTranslate(text, lang, to);
    } catch (e) {
      diag('LỖI dịch: ' + (e.details || e.message));
      return setError($('dlgErr'), 'Dịch không thành công (mạng chậm). Nói lại câu vừa rồi.');
    }
    if (!running) return;
    const out = side === 'partner' ? applyGlossary(text, t.text, parseGlossary($('glossary').value)) : t.text;
    const entry = { time: timeNow(), tag: WHO[side], src: text, out, info: `${info} · xử lý ${Math.round(performance.now() - t0)}ms · dịch ${t.ms}ms · ${t.engine}` };
    ctx.log.push(entry);
    renderLog($('dlgLog'), ctx.log);
    $('dlgCopy').disabled = false;
    $('dlgOrig').textContent = text;
    $('dlgTrans').textContent = out;
    setError($('dlgErr'), '');
    diag(`GHÉP: ${WHO[side]} [${src}] "${text}" → "${out}"`);
    speakers.push(side);
    if (speakers.length > 5) speakers.shift();
    sayQueue.push({ out, to, entry, side });
    sayNext();
  }

  // Đoán ai nói câu tiếp để Google nghe sẵn đúng tiếng (đoán sai thì câu đó phải chép lại bằng Whisper/PhoWhisper — chậm hơn):
  // 2 câu gần nhất cùng 1 người (đang trình bày nhiều câu) → người đó nói tiếp; đang hỏi–đáp xen kẽ → người kia đáp lời.
  function predictNext(side) {
    const n = speakers.length;
    const monologue = n >= 2 && speakers[n - 1] === speakers[n - 2];
    const who = monologue ? side : side === 'me' ? 'partner' : 'me';
    return { lang: who === 'me' ? 'vi-VN' : ctx.partnerLang(), why: monologue ? `${WHO[side]} đang nói nhiều câu liền` : 'đoán người kia đáp lời' };
  }

  async function sayNext() {
    if (speaking || !sayQueue.length || !running) return;
    speaking = true;
    // không đọc chen khi có người đang nói (người nói ngừng giữa câu rồi nói tiếp): chờ im lặng, tối đa 6 giây
    const waitUntil = performance.now() + 6000;
    while (vadSpeaking && running && performance.now() < waitUntil) await sleep(80);
    if (!running) return void (speaking = false);
    // gộp các câu đã dịch xong của cùng 1 người thành 1 lần đọc
    const first = sayQueue.shift();
    while (sayQueue.length && sayQueue[0].side === first.side) {
      const n = sayQueue.shift();
      first.out += ' ' + n.out;
    }
    const { out, to, entry, side } = first;
    ttsLang = to;
    L.config({ tts: true });
    if (rec) rec.pause(); // Google không có khử tiếng vọng: tạm dừng, câu nói chen lúc đọc sẽ được Whisper/PhoWhisper chép
    ctx.status('🔊 Đang đọc bản dịch…');
    try {
      await speak(out, to, {
        rate: Number($('ttsRate').value) || 1,
        onStart: (ms, voice) => { entry.info += ` · đọc +${ms}ms${voice ? ' · ' + voice : ''}`; renderLog($('dlgLog'), ctx.log); },
        onError: (err) => diag(`LỖI TTS ${to}: ${err}`),
      });
    } finally {
      lastSpoken = { text: out, lang: to, endAt: performance.now() };
      await sleep(UNMUTE_AFTER_MS);
      speaking = false;
      if (running) {
        const next = predictNext(side);
        if (next.lang !== srLang) diag(`Google chuyển sang nghe tiếng ${NAMES[next.lang]} (${next.why})`);
        srLang = next.lang;
        interim = { text: '', at: 0, lang: '' };
        finals.forEach((f) => (f.used = true));
        L.config({ tts: false });
        ttsLang = null;
        rec.setLang(srLang);
        rec.start();
        ctx.status(idle());
        sayNext();
      }
    }
  }

  return {
    async start() {
      running = true;
      srLang = 'vi-VN';
      ctx.status('Đang chuẩn bị bộ nhận người nói…');
      try {
        await listener().start();
      } catch (e) {
        running = false;
        const msg = e && e.name === 'NotAllowedError' ? 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.' : 'Không khởi động được tự nhận người nói: ' + (e && e.message) + '. Chọn "Chrome luân phiên" ở ô Cách nghe.';
        setError($('dlgErr'), msg);
        diag('LỖI khởi động ghép: ' + (e && (e.stack || e.message)));
        throw e;
      }
      L.config({ tts: false, partner: ctx.partnerLang(), endSilenceMs: ctx.endSilenceMs() });
      if (!rec) buildRec();
      rec.setLang(srLang);
      rec.start();
      ctx.status(idle());
    },
    stop() {
      running = false;
      sayQueue.length = 0;
      cancelSpeech();
      speaking = false;
      if (rec) rec.stop();
      if (L) L.stop();
    },
    config(c) {
      if (L) L.config(c);
      if (c.partner && srLang !== 'vi-VN') setSr(c.partner, 'đổi tiếng đối tác');
    },
    state: () => ({ running, speaking, srLang, queued: sayQueue.length, pending, vadSpeaking }),
  };
}
