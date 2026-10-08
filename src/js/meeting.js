// Màn 2: nghe hội trường. 1 recognizer, người dùng chạm chọn tiếng đang nghe, chỉ dịch sang tiếng Việt.

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, supported } from './recognizer.js';
import { translate } from './translate.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, cancel } from './tts.js';
import { diag } from './diagnostics.js';

export function initMeeting() {
  const log = [];
  let running = false;
  let currentLang = 'en-US';

  const rec = createRecognizer({
    name: 'hội-trường',
    lang: currentLang,
    onFinal: (text) => text && handle(text),
    onError: (err) => {
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError($('mtgErr'), 'Chưa cấp quyền micro.');
        rec.stop();
        setRunning(false);
      } else {
        // lỗi tạm (network, audio-capture...): recognizer tự khởi động lại, chỉ ghi nhật ký
        diag('LỖI hội-trường: ' + err);
      }
    },
    onLog: diag,
  });

  async function handle(text) {
    try {
      const r = await translate(text, currentLang, 'vi-VN');
      const out = applyGlossary(text, r.text, parseGlossary($('glossary').value));
      log.push({ time: timeNow(), tag: NAMES[currentLang], src: text, out, info: `dịch ${r.ms}ms · ${r.engine}` });
      renderLog($('mtgLog'), log);
      $('mtgCopy').disabled = false;
      if ($('mtgSpeak').checked) {
        // tắt mic khi đọc, nếu không mic nghe lại bản dịch tiếng Việt rồi dịch tiếp thành vòng lặp
        rec.pause();
        await speak(out, 'vi-VN', { onError: (err) => diag('LỖI TTS vi-VN: ' + err) });
        await new Promise((res) => setTimeout(res, 300));
        if (running) rec.start();
      }
    } catch (e) {
      setError($('mtgErr'), 'Dịch không thành công, bỏ qua câu này.');
      diag('LỖI dịch (hội trường): ' + (e.details || e.message));
    }
  }

  function setRunning(on) {
    running = on;
    $('mtgToggle').textContent = on ? 'Dừng nghe' : 'Bắt đầu nghe';
    $('mtgDot').className = 'dot' + (on ? ' live' : '');
    $('mtgStatus').textContent = on ? 'Đang nghe · ' + NAMES[currentLang] : 'Đang tắt';
  }

  document.querySelectorAll('#meetingLangChips .chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('#meetingLangChips .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      currentLang = chip.dataset.lang;
      rec && rec.setLang(currentLang);
      if (running) setRunning(true);
    };
  });

  $('mtgToggle').onclick = () => {
    if (!supported) return setError($('mtgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
    setError($('mtgErr'), '');
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
