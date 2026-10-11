// Màn 2: nghe hội trường. 1 recognizer, người dùng chạm chọn tiếng đang nghe, chỉ dịch sang tiếng Việt.

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, supported } from './recognizer.js';
import { translate } from './translate.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, cancel } from './tts.js';
import { diag } from './diagnostics.js';
import { holdScreen, classifyMicError } from './keepalive.js';

// nhớ theo máy: có đọc bản dịch không (mặc định có — 11/10 Lợi Minh test thấy ô tắt nên chỉ hiện chữ) và tiếng đang nghe
const SPEAK_KEY = 'audit.mtgSpeak.v1';
const LANG_KEY = 'audit.mtgLang.v1';
const ENGLISH_G = /\b(the|we|will|and|then|of|is|are|with|this|that|our|you|first|finally)\b/gi;
const readPref = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export function initMeeting() {
  const log = [];
  let running = false;
  let currentLang = NAMES[readPref(LANG_KEY)] ? readPref(LANG_KEY) : 'en-US';
  if (readPref(SPEAK_KEY)) $('mtgSpeak').checked = readPref(SPEAK_KEY) === '1';
  $('mtgSpeak').onchange = () => writePref(SPEAK_KEY, $('mtgSpeak').checked ? '1' : '0');

  // Nói liền mạch (podcast, thuyết trình): máy không chốt câu khi người nói không ngừng → app đứng im (11/10 Lợi Minh test
  // podcast Hàn). Nên: mỗi câu 1 phiên (continuous=false, như màn 1:1 trên Android), hiện chữ tạm ngay, và tự chốt chữ tạm
  // khi đứng yên STABLE_MS hoặc đã nghe MAX_MS mà chưa chốt; mở phiên mới nghe tiếp (final muộn của phiên cũ bị bỏ, không trùng).
  const STABLE_MS = 1200;
  const MAX_MS = 7000;
  let interim = '';
  let interimAt = 0; // lần cuối chữ tạm đổi
  let firstAt = 0; // lúc bắt đầu có chữ tạm của đoạn hiện tại
  const resetInterim = () => { interim = ''; interimAt = 0; firstAt = 0; };

  const rec = createRecognizer({
    name: 'hội-trường',
    lang: currentLang,
    continuous: false,
    onFinal: (text) => {
      resetInterim();
      if (text) enqueue(text);
    },
    onInterim: (text) => {
      if (!running || speaking) return;
      const t = text.trim();
      if (!t || t === interim) return;
      const now = Date.now();
      if (!firstAt) firstAt = now;
      interim = t;
      interimAt = now;
      $('mtgStatus').textContent = `Đang nghe ${NAMES[currentLang]}: …${t.slice(-80)}`;
    },
    onError: async (err) => {
      const kind = await classifyMicError(err);
      // lỗi tạm (network, audio-capture...): recognizer tự khởi động lại, chỉ ghi nhật ký
      if (!kind) return diag('LỖI hội-trường: ' + err);
      if (!running) return;
      if (kind === 'denied') {
        setError($('mtgErr'), 'Chưa cấp quyền micro.');
        rec.stop();
        return setRunning(false);
      }
      // trang ẩn: chờ hiện lại (visibilitychange); lỗi tạm: nghe lại
      diag(`Micro bị ngắt (hội-trường: ${err}) — ${kind === 'hidden' ? 'trang đang ẩn, chờ hiện lại' : 'thử nghe lại'}`);
      if (kind === 'transient') setTimeout(() => running && !speaking && rec.start(), 800);
    },
    onLog: diag,
  });

  let speaking = false;
  // Android ngừng micro khi trang ẩn (keepalive.js): hiện lại thì nghe tiếp
  document.addEventListener('visibilitychange', () => {
    if (!running || document.visibilityState !== 'visible' || speaking) return;
    diag('Trang hiện lại → nghe lại (hội trường)');
    setError($('mtgErr'), 'App vừa bị ẩn (tắt màn hình hoặc chuyển app) nên Android ngừng micro. Đã nghe lại.');
    rec.start();
  });

  setInterval(() => {
    if (!running || speaking || !interim) return;
    const now = Date.now();
    const why = now - interimAt >= STABLE_MS ? 'chữ tạm đứng yên' : now - firstAt >= MAX_MS ? 'nói liền quá ' + MAX_MS / 1000 + 's' : '';
    if (!why) return;
    const text = interim;
    resetInterim();
    diag(`Hội trường tự chốt (${why}): "${text}"`);
    rec.restart();
    enqueue(text);
  }, 250);

  // dịch + đọc lần lượt từng câu (không chồng tiếng, không bật mic 2 lần)
  let chain = Promise.resolve();
  function enqueue(text) {
    chain = chain.then(() => handle(text));
  }

  async function handle(text) {
    if (!running) return;
    try {
      const r = await translate(text, currentLang, 'vi-VN');
      // đoạn dài không dấu câu: Google đôi khi trả nửa sau bằng tiếng Anh (đo 11/10, lúc Google chậm) → dịch lại phần đó
      if ((r.text.match(ENGLISH_G) || []).length >= 3) {
        try {
          r.text = (await translate(r.text, 'en-US', 'vi-VN')).text;
          diag('Hội trường: bản dịch lẫn tiếng Anh → dịch lại');
        } catch (_) {}
      }
      const out = applyGlossary(text, r.text, parseGlossary($('glossary').value));
      log.push({ time: timeNow(), tag: NAMES[currentLang], src: text, out, info: `dịch ${r.ms}ms · ${r.engine}` });
      renderLog($('mtgLog'), log);
      $('mtgCopy').disabled = false;
      if ($('mtgSpeak').checked) {
        // tắt mic khi đọc, nếu không mic nghe lại bản dịch tiếng Việt rồi dịch tiếp thành vòng lặp
        // chữ đã nghe dở trong lúc dịch: giữ lại, dịch sau (pause bỏ phiên hiện tại)
        if (interim) {
          diag(`Hội trường giữ đoạn đang nghe dở trước khi đọc: "${interim}"`);
          enqueue(interim);
        }
        rec.pause();
        resetInterim();
        speaking = true;
        $('mtgStatus').textContent = 'Đang đọc bản dịch…';
        try {
          await speak(out, 'vi-VN', { onError: (err) => diag('LỖI TTS vi-VN: ' + err) });
          await new Promise((res) => setTimeout(res, 300));
        } finally {
          speaking = false;
        }
        if (running) {
          rec.start();
          setRunning(true);
        }
      }
    } catch (e) {
      setError($('mtgErr'), 'Dịch không thành công, bỏ qua câu này.');
      diag('LỖI dịch (hội trường): ' + (e.details || e.message));
    }
  }

  function setRunning(on) {
    running = on;
    holdScreen('mtg', on); // màn hình tắt = Android ngừng micro
    $('mtgToggle').textContent = on ? 'Dừng nghe' : 'Bắt đầu nghe';
    $('mtgDot').className = 'dot' + (on ? ' live' : '');
    $('mtgStatus').textContent = on ? 'Đang nghe · ' + NAMES[currentLang] : 'Đang tắt';
  }

  const chips = document.querySelectorAll('#meetingLangChips .chip');
  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.lang === currentLang)));
  chips.forEach((chip) => {
    chip.onclick = () => {
      chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      currentLang = chip.dataset.lang;
      writePref(LANG_KEY, currentLang);
      rec && rec.setLang(currentLang);
      if (running) setRunning(true);
    };
  });

  $('mtgToggle').onclick = () => {
    if (!supported) return setError($('mtgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
    setError($('mtgErr'), '');
    resetInterim();
    if (running) {
      rec.stop();
      cancel();
      setRunning(false);
    } else {
      rec.setLang(currentLang);
      rec.start();
      setRunning(true);
    }
  };

  $('mtgCopy').onclick = () => copyText(logToText(log), $('mtgCopy'));
}
