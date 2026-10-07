// Màn 1: đối thoại 1:1, tự nhận diện ai đang nói bằng 2 recognizer song song
// (1 theo tiếng đối tác, 1 theo tiếng Việt) trên cùng mic.

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, supported } from './recognizer.js';
import { createArbiter } from './arbiter.js';
import { translate } from './translate.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, pickVoice } from './tts.js';
import { diag } from './diagnostics.js';

const TAIL_MS = 300; // chờ đuôi âm thanh TTS tắt hẳn rồi mới mở lại mic

export function initDialogue() {
  const log = [];
  let running = false;
  let speaking = false;

  const partnerLang = () => $('partnerLang').value;
  const recOpts = (name, lang, side) => ({
    name,
    lang,
    onFinal: (text, conf) => arbiter.push(side, text, conf),
    onInterim: (text) => { if (!speaking) $('dlgOrig').textContent = text; },
    onError: (err) => {
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError($('dlgErr'), 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.');
        setRunning(false);
        recA.stop();
        recB.stop();
      } else {
        diag(`LỖI ${name}: ${err}`); // 1 bên lỗi (vd language-not-supported) thì bên kia vẫn nghe tiếp
      }
    },
    onLog: diag,
  });

  const arbiter = createArbiter({ mode: $('arbiterMode').value }, onDecision);
  const recA = createRecognizer(recOpts('đối-tác', partnerLang(), 'partner'));
  const recB = createRecognizer(recOpts('việt', 'vi-VN', 'me'));

  async function onDecision({ side, text, confidence, candidates }) {
    if (speaking) return;
    const partner = side === 'partner';
    const from = partner ? partnerLang() : 'vi-VN';
    const to = partner ? 'vi-VN' : partnerLang();
    diag(
      `QUYẾT ĐỊNH: ${partner ? 'Đối tác' : 'Tôi'} conf=${confidence.toFixed(2)} từ ` +
      candidates.map((c) => `${c.side}:${c.confidence.toFixed(2)}`).join(' vs ')
    );
    $('dlgOrig').textContent = text;
    try {
      const r = await translate(text, from, to);
      const out = partner ? applyGlossary(text, r.text, parseGlossary($('glossary').value)) : r.text;
      $('dlgTrans').textContent = out;
      setError($('dlgErr'), pickVoice(to) ? '' : `Máy chưa có giọng đọc ${NAMES[to]}. Xem mục Chẩn đoán.`);

      const entry = { time: timeNow(), tag: partner ? 'Đối tác' : 'Tôi', src: text, out, info: `dịch ${r.ms}ms · ${r.engine}` };
      log.push(entry);
      renderLog($('dlgLog'), log);
      $('dlgCopy').disabled = false;

      // Mic phải tắt hẳn khi TTS phát, nếu không sẽ nghe lại chính bản dịch của mình.
      speaking = true;
      recA.pause();
      recB.pause();
      await speak(out, to, {
        onStart: (ms, voice) => {
          entry.info += ` · TTS +${ms}ms${voice ? ' · ' + voice.name : ''}`;
          renderLog($('dlgLog'), log);
        },
      });
      await new Promise((res) => setTimeout(res, TAIL_MS));
      speaking = false;
      if (running) { recA.start(); recB.start(); }
    } catch (_) {
      speaking = false;
      setError($('dlgErr'), 'Dịch không thành công (mạng chậm hoặc dịch vụ bận). Nói lại câu vừa rồi.');
      diag('LỖI dịch: translate_failed');
    }
  }

  function setRunning(on) {
    running = on;
    $('dlgToggle').textContent = on ? 'Dừng nghe' : 'Bắt đầu nghe';
    $('dlgDot').className = 'dot' + (on ? ' live' : '');
    $('dlgStatus').textContent = on ? `Đang nghe cả hai chiều · Việt ↔ ${NAMES[partnerLang()]}` : 'Đang tắt';
  }

  $('partnerLang').onchange = () => {
    recA && recA.setLang(partnerLang());
    if (running) setRunning(true);
  };
  $('arbiterMode').onchange = () => {
    arbiter.setMode($('arbiterMode').value);
    diag('Chế độ phân xử: ' + $('arbiterMode').value);
  };

  $('dlgToggle').onclick = () => {
    if (!supported) return setError($('dlgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
    setError($('dlgErr'), '');
    if (running) {
      recA.stop();
      recB.stop();
      arbiter.reset();
      setRunning(false);
    } else {
      recA.setLang(partnerLang());
      recA.start();
      recB.start();
      setRunning(true);
    }
  };

  $('dlgCopy').onclick = () => copyText(logToText(log), $('dlgCopy'));
}
