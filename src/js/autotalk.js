// Màn 1:1, chế độ "Tự nhận người nói" (10/10/2026): không còn lượt, không còn nút "Mời … nói". Micro nghe liên tục;
// hết 1 câu (im lặng đủ thời gian chọn ở ô "Thời gian chờ nhận biết hết câu") → Whisper trên máy nhận ra câu đó là
// tiếng Việt (Tôi) hay tiếng đối tác → dịch → đọc ngay. Trong lúc đọc, bỏ âm thanh micro (tránh dịch lại giọng của app).
// Phần nghe ở autolisten.js / autoworker.js.

import { $, setError, timeNow, renderLog } from './ui.js';
import { NAMES } from './config.js';
import { detectTranslate } from './translate.js';
import { isEcho } from './speaker.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, cancel as cancelSpeech } from './tts.js';
import { diag } from './diagnostics.js';
import { createAutoListener } from './autolisten.js';

const WHO = { me: 'Tôi', partner: 'Đối tác' };
const W2L = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };
const ECHO_WINDOW_MS = 3000;
const UNMUTE_AFTER_MS = 250; // dư âm giọng đọc trong tai nghe
// Câu rất ngắn mà Whisper không chắc ngôn ngữ: chỉ hiện chữ, không đọc. Đo 10/10/2026: "Vâng." bị nghe thành "Van"/"晚"/"왠"
// (chắc 78–90%), còn "네" thật của đối tác chắc 83–98% → không phân biệt được bằng ngưỡng; thà không đọc nhầm.
const SHORT_MS = 1000;
const SURE = 0.95;

// ctx: { log, partnerLang(), endSilenceMs(), status(text), model?, device? (để test ép cấu hình) }
export function createAutoTalk(ctx) {
  let L = null;
  let running = false;
  let speaking = false;
  const sayQueue = [];
  let lastSpoken = { text: '', lang: '', endAt: -1e9 };

  // 1 bộ nghe cho cả phiên; đổi tiếng đối tác thì chỉ báo cho worker (không nạp lại mô hình)
  function listener() {
    if (L) return L;
    L = createAutoListener({
      model: ctx.model,
      device: ctx.device,
      // thuật ngữ audit đặt trước câu: Whisper viết "KPI", "ISO 9001" thay vì phiên âm (đo: đúng thêm cả câu ngắn)
      prompt: 'ISO 9001, KPI, FSC, BRC, CAPA, audit.',
      partner: ctx.partnerLang(),
      endSilenceMs: ctx.endSilenceMs(),
      onProgress: (pct) => ctx.status(`Đang tải bộ nhận diện giọng nói (chỉ lần đầu, 40–95 MB): ${pct}%`),
      onStage: (st) => diag(`Tự nhận người nói: nạp xong ${st.name} (${st.ms}ms)`),
      onReady: (i) => {
        diag(`Tự nhận người nói: sẵn sàng (whisper-${i.model}, ${i.device}, nạp ${i.loadMs}ms)`);
        // không có WebGPU: Whisper chạy bằng CPU, chậm hơn ~2 lần (đo trên máy tính) — báo để Lợi Minh biết vì sao chậm
        if (!/webgpu/.test(i.device)) setError($('dlgErr'), 'Máy này chưa bật tăng tốc đồ hoạ (WebGPU) cho Chrome nên nhận diện chậm hơn. Cập nhật Chrome lên bản mới nhất có thể cải thiện.');
      },
      onSentence,
      onSpeaking: (on) => running && !speaking && ctx.status(on ? '🎤 Đang nghe một người nói…' : idleText()),
      onDropped: (r) => diag(`Bỏ câu (${r.why}): "${r.text}"`),
      onError: (m) => diag('LỖI tự nhận người nói: ' + m),
    });
    return L;
  }

  const idleText = () => `Đang nghe cả hai · Việt ↔ ${NAMES[ctx.partnerLang()]} · tự nhận ai đang nói`;

  async function onSentence(r) {
    if (!running) return;
    const lang = W2L[r.lang] || ctx.partnerLang();
    const side = lang === 'vi-VN' ? 'me' : 'partner';
    const to = side === 'me' ? ctx.partnerLang() : 'vi-VN';
    const heardAfter = Math.round(performance.timeOrigin + performance.now() - r.endAt);
    if (lang === lastSpoken.lang && performance.now() - lastSpoken.endAt < ECHO_WINDOW_MS && isEcho(r.text, lastSpoken.text)) {
      return diag(`Bỏ tiếng vọng: "${r.text}"`);
    }
    let t;
    try {
      t = await detectTranslate(r.text, lang, to);
    } catch (e) {
      diag('LỖI dịch: ' + (e.details || e.message));
      return setError($('dlgErr'), 'Dịch không thành công (mạng chậm). Nói lại câu vừa rồi.');
    }
    if (!running) return;
    const out = side === 'partner' ? applyGlossary(r.text, t.text, parseGlossary($('glossary').value)) : t.text;
    const unsure = r.audioMs < SHORT_MS && r.prob < SURE;
    const entry = {
      time: timeNow(), tag: WHO[side] + (unsure ? ' (?)' : ''), src: r.text, out,
      info: `nhận ra ${heardAfter}ms sau khi dứt lời (Whisper ${r.asrMs}ms${r.early ? ', nhận diện sớm' : ''}, chắc ${Math.round(r.prob * 100)}%) · dịch ${t.ms}ms · ${t.engine}`,
    };
    ctx.log.push(entry);
    renderLog($('dlgLog'), ctx.log);
    $('dlgCopy').disabled = false;
    $('dlgOrig').textContent = r.text;
    $('dlgTrans').textContent = out;
    setError($('dlgErr'), '');
    diag(`TỰ NHẬN: ${WHO[side]} [${r.lang} ${Math.round(r.prob * 100)}%] "${r.text}" → "${out}" (Whisper ${r.asrMs}ms = đặc trưng ${r.featMs} + giải mã ${r.genMs}ms/${r.tokens} token, chờ hàng ${r.queuedMs}ms, câu ${r.audioMs}ms)`);
    if (unsure) {
      entry.info += ' · câu ngắn, không chắc ai nói → chỉ hiện chữ, không đọc';
      return renderLog($('dlgLog'), ctx.log);
    }
    sayQueue.push({ out, to, entry });
    sayNext();
  }

  async function sayNext() {
    if (speaking || !sayQueue.length || !running) return;
    speaking = true;
    L.config({ muted: true });
    ctx.status('🔊 Đang đọc bản dịch…');
    const { out, to, entry } = sayQueue.shift();
    try {
      await speak(out, to, {
        rate: Number($('ttsRate').value) || 1,
        onStart: (ms, voice) => { entry.info += ` · đọc +${ms}ms${voice ? ' · ' + voice : ''}`; renderLog($('dlgLog'), ctx.log); },
        onError: (err) => diag(`LỖI TTS ${to}: ${err}`),
      });
    } finally {
      lastSpoken = { text: out, lang: to, endAt: performance.now() };
      await new Promise((r) => setTimeout(r, UNMUTE_AFTER_MS));
      speaking = false;
      if (running) {
        L.config({ muted: false });
        ctx.status(idleText());
        sayNext();
      }
    }
  }

  return {
    async start() {
      running = true;
      ctx.status('Đang chuẩn bị bộ nhận diện giọng nói…');
      try {
        await listener().start();
      } catch (e) {
        running = false;
        const msg = e && e.name === 'NotAllowedError' ? 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.' : 'Không khởi động được chế độ tự nhận người nói: ' + (e && e.message) + '. Chọn "Chrome luân phiên" ở ô Cách nghe.';
        setError($('dlgErr'), msg);
        diag('LỖI khởi động tự nhận người nói: ' + (e && (e.stack || e.message)));
        throw e;
      }
      L.config({ muted: false, partner: ctx.partnerLang(), endSilenceMs: ctx.endSilenceMs() });
      ctx.status(idleText());
    },
    stop() {
      running = false;
      sayQueue.length = 0;
      cancelSpeech();
      speaking = false;
      if (L) L.stop();
    },
    config(c) { if (L) L.config(c); },
    // nạp sẵn mô hình (khi chọn chế độ này) để bấm Bắt đầu là nghe ngay
    preload() { return listener().load().catch((e) => diag('LỖI nạp tự nhận người nói: ' + e.message)); },
    state: () => ({ running, speaking, queued: sayQueue.length }),
  };
}
