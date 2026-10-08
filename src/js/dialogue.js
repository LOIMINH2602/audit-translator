// Màn 1: đối thoại 1:1, tự nhận ai đang nói, dịch sang tiếng còn lại, đọc to.
//
// Chrome chỉ cho 1 phiên nhận diện tự giữ micro: bật phiên thứ 2 thì phiên đầu bị huỷ ("aborted") —
// đã đo thật 08/10/2026, đây là lý do bản 07/10 (2 recognizer song song) không dịch được câu nào.
// Nên khi bấm Bắt đầu, app dò 1,5 giây (probeParallel) rồi chọn:
//   'parallel': máy cho 2 recognizer nhận chung 1 track micro → cả 2 cùng nghe, mỗi câu chọn bên đúng
//               bằng pickSpeaker (ngôn ngữ Google dò khớp + dài hơn).
//   'turn'    : máy chỉ cho 1 recognizer → nghe luân phiên: nghe tiếng của bên đến lượt, dịch xong tự chuyển
//               sang bên kia. Câu không khớp tiếng (rỗng, số, Google dò ra tiếng khác) → tự chuyển bên, mời nói lại.
//               Chạm vào ô "Đang nghe" để đổi bên nếu app đoán sai lượt.

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, probeParallel, supported } from './recognizer.js';
import { createArbiter } from './arbiter.js';
import { detectTranslate } from './translate.js';
import { pickSpeaker, syllables } from './speaker.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, pickVoice, cancel as cancelSpeech } from './tts.js';
import { diag } from './diagnostics.js';

const TAIL_MS = 300; // chờ đuôi âm thanh TTS tắt hẳn rồi mới mở lại mic
const WHO = { me: 'Tôi', partner: 'Đối tác' };
const other = (side) => (side === 'partner' ? 'me' : 'partner');

export function initDialogue() {
  const log = [];
  let running = false;
  let busy = false; // đang dịch/đọc 1 câu: bỏ qua mọi kết quả nhận diện
  let mode = null; // 'parallel' | 'turn'
  let probe = null;
  let turn = 'me'; // bên đến lượt nói
  let switches = 0; // số lần tự chuyển lượt (chế độ luân phiên)
  let recs = {}; // parallel: { partner, me }; turn: { one }
  const interims = { partner: '', me: '' };

  const partnerLang = () => $('partnerLang').value;
  const langOf = (side) => (side === 'partner' ? partnerLang() : 'vi-VN');

  const arbiter = createArbiter({}, (cands) => handle(cands));

  function onError(name) {
    return (err) => {
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError($('dlgErr'), 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.');
        stop();
      } else {
        diag(`LỖI ${name}: ${err}`);
      }
    };
  }

  function buildRecognizers() {
    if (mode === 'parallel') {
      const mk = (side) =>
        createRecognizer({
          name: side === 'partner' ? 'đối-tác' : 'việt',
          lang: langOf(side),
          track: probe.track,
          continuous: false,
          onFinal: (text) => { if (!busy) arbiter.push(side, text); },
          onInterim: (text) => {
            if (busy) return;
            arbiter.interim(side);
            interims[side] = text;
            // hiện chuỗi dài hơn trong 2 bên (bên sai tiếng thường ngắn/rỗng)
            const a = interims.partner, b = interims.me;
            $('dlgOrig').textContent = syllables(a, langOf('partner')) >= syllables(b, 'vi-VN') ? a : b;
          },
          onError: onError(side),
          onLog: diag,
        });
      recs = { partner: mk('partner'), me: mk('me') };
    } else {
      recs = {
        one: createRecognizer({
          name: 'luân-phiên',
          lang: langOf(turn),
          continuous: false,
          onFinal: (text) => { if (!busy && text) handle([{ side: turn, text }]); },
          onInterim: (text) => { if (!busy) $('dlgOrig').textContent = text; },
          onNoMatch: () => {
            if (busy || !running) return;
            diag(`QUYẾT ĐỊNH (turn, lượt ${WHO[turn]}): nghe ra chữ tạm nhưng không có câu → nghi bên kia đang nói`);
            switchTurn();
          },
          onError: onError('luân-phiên'),
          onLog: diag,
        }),
      };
    }
  }

  const all = () => Object.values(recs);

  function listen() {
    if (!running) return;
    interims.partner = interims.me = '';
    arbiter.reset();
    if (mode === 'turn') recs.one.setLang(langOf(turn));
    all().forEach((r) => r.start());
    showStatus();
  }

  function pauseAll() {
    all().forEach((r) => r.pause());
  }

  async function handle(cands) {
    busy = true;
    let relisten = false;
    try {
      const cs = cands.map((c) => ({ ...c, lang: langOf(c.side) }));
      await Promise.all(
        cs.map((c) =>
          detectTranslate(c.text, c.lang, langOf(other(c.side)))
            .then((r) => { c.r = r; c.detected = r.detected; })
            .catch((e) => { c.err = e.details || e.message; })
        )
      );
      const usable = cs.filter((c) => c.r);
      const win = pickSpeaker(usable, turn);
      diag(
        `QUYẾT ĐỊNH (${mode}, lượt ${WHO[turn]}): ${win ? WHO[win.side] : 'không bên nào'} từ ` +
        cs.map((c) => `${c.side}[${c.lang}→dò ${c.detected || '?'}]:"${c.text}"${c.err ? ' LỖI ' + c.err : ''}`).join(' vs ')
      );

      if (!win) {
        if (!usable.length && cs.some((c) => c.err)) {
          setError($('dlgErr'), 'Dịch không thành công (mạng chậm hoặc dịch vụ bận). Nói lại câu vừa rồi.');
        } else if (mode === 'turn') {
          busy = false;
          switchTurn();
        } else {
          setError($('dlgErr'), 'Chưa nghe rõ, mời nói lại.');
        }
        return;
      }

      const partner = win.side === 'partner';
      const to = langOf(other(win.side));
      const out = partner ? applyGlossary(win.text, win.r.text, parseGlossary($('glossary').value)) : win.r.text;
      $('dlgOrig').textContent = win.text;
      $('dlgTrans').textContent = out;
      setError($('dlgErr'), pickVoice(to) ? '' : `Không thấy giọng đọc ${NAMES[to]} trong danh sách (vẫn thử đọc). Xem mục Chẩn đoán.`);

      const entry = { time: timeNow(), tag: WHO[win.side], src: win.text, out, info: `dịch ${win.r.ms}ms · ${win.r.engine}` };
      log.push(entry);
      renderLog($('dlgLog'), log);
      $('dlgCopy').disabled = false;

      turn = other(win.side);
      relisten = true;
      // Mic phải tắt hẳn khi TTS phát, nếu không sẽ nghe lại chính bản dịch.
      pauseAll();
      showStatus('Đang đọc bản dịch…');
      await speak(out, to, {
        onError: (err) => diag(`LỖI TTS ${to}: ${err}`),
        onStart: (ms, voice) => {
          entry.info += ` · TTS +${ms}ms${voice ? ' · ' + voice.name : ''}`;
          renderLog($('dlgLog'), log);
        },
      });
      await new Promise((res) => setTimeout(res, TAIL_MS));
    } catch (e) {
      diag('LỖI xử lý câu: ' + (e && e.message));
    } finally {
      busy = false;
      if (relisten && running) {
        pauseAll();
        listen();
      }
    }
  }

  // Chế độ luân phiên: câu không khớp tiếng đang nghe → nhiều khả năng bên kia đang nói → chuyển bên, mời nói lại.
  function switchTurn() {
    switches++;
    turn = other(turn);
    setError($('dlgErr'), `Chưa nghe rõ. Đã chuyển sang nghe ${WHO[turn]} (tiếng ${NAMES[langOf(turn)]}) — mời nói lại.`);
    pauseAll();
    listen();
  }

  function showStatus(text) {
    $('dlgDot').className = 'dot' + (running ? ' live' : '');
    const turnBtn = $('dlgTurn');
    turnBtn.hidden = !(running && mode === 'turn');
    if (!running) {
      $('dlgStatus').textContent = 'Đang tắt';
      return;
    }
    if (text) {
      $('dlgStatus').textContent = text;
      return;
    }
    if (mode === 'parallel') {
      $('dlgStatus').textContent = `Đang nghe cả hai chiều · Việt ↔ ${NAMES[partnerLang()]} · tự nhận người nói`;
    } else {
      $('dlgStatus').textContent = 'Nghe luân phiên · dịch xong tự chuyển lượt';
      turnBtn.textContent = `Đang nghe: ${WHO[turn]} (tiếng ${NAMES[langOf(turn)]}) — chạm để đổi`;
      turnBtn.className = 'turn ' + turn;
    }
  }

  async function start() {
    setError($('dlgErr'), '');
    $('dlgToggle').disabled = true;
    $('dlgStatus').textContent = 'Đang kiểm tra micro…';
    try {
      if (!probe) {
        probe = await probeParallel(partnerLang(), 'vi-VN');
        diag(`Dò song song: ${probe.parallel ? 'ĐƯỢC' : 'KHÔNG'} (${probe.reason})`);
        if (probe.denied) {
          probe = null;
          setError($('dlgErr'), 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.');
          return;
        }
        mode = probe.parallel ? 'parallel' : 'turn';
        buildRecognizers();
      }
      running = true;
      turn = 'me';
      $('dlgToggle').textContent = 'Dừng nghe';
      listen();
    } finally {
      $('dlgToggle').disabled = false;
      if (!running) showStatus();
    }
  }

  function stop() {
    running = false;
    all().forEach((r) => r.stop());
    arbiter.reset();
    cancelSpeech();
    // trả micro (không để chấm báo micro sáng mãi); lần Bắt đầu sau dò lại và tạo recognizer mới
    if (probe && probe.track) probe.track.stop();
    probe = null;
    $('dlgToggle').textContent = 'Bắt đầu nghe';
    showStatus();
  }

  $('partnerLang').onchange = () => {
    if (mode === 'parallel') recs.partner.setLang(partnerLang());
    else if (mode === 'turn' && running && !busy) {
      pauseAll();
      listen();
    }
    if (running) showStatus();
  };

  $('dlgTurn').onclick = () => {
    if (!running || mode !== 'turn' || busy) return;
    turn = other(turn);
    diag('Đổi lượt bằng tay → ' + WHO[turn]);
    setError($('dlgErr'), '');
    pauseAll();
    listen();
  };

  $('dlgToggle').onclick = () => {
    if (!supported) return setError($('dlgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
    if (running) stop();
    else start();
  };

  $('dlgCopy').onclick = () => copyText(logToText(log), $('dlgCopy'));

  // cho bảng Tự kiểm tra / test tự động đọc trạng thái
  return { state: () => ({ running, mode, turn, busy, log, switches }) };
}
