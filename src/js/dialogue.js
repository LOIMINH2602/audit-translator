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
import { pickSpeaker, syllables, isEcho } from './speaker.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, pickVoice, cancel as cancelSpeech } from './tts.js';
import { diag } from './diagnostics.js';

// Mở lại mic ngay khi đọc xong (không chờ dư âm): đuôi bản dịch lọt vào mic thì isEcho lọc trong ECHO_WINDOW_MS.
const ECHO_WINDOW_MS = 3000;
// Chế độ luân phiên: Android chốt câu (final) muộn 1–2 giây sau khi người nói dừng. Khi máy báo hết tiếng nói
// (speechend) mà chừng này chưa có final thì dùng luôn chữ tạm. Khác cách "chữ đứng yên" đã bỏ: speechend chỉ
// đến khi người nói thật sự dừng, nên không chốt giữa câu.
const SPEECHEND_GRACE_MS = 350;
const PROBE_KEY = 'audit.parallel.v1';
const RATE_KEY = 'audit.ttsRate';
const WHO = { me: 'Tôi', partner: 'Đối tác' };
// localStorage có thể bị chặn (chế độ ẩn danh...): lỗi thì coi như không có
const readPref = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
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
  // đo thời gian từng bước của 1 câu (hiện trong biên bản + nhật ký) để biết chậm ở đâu
  let lastInterimAt = 0; // lần cuối chữ tạm thay đổi
  let listenAt = 0; // lúc yêu cầu mở lại mic
  let lastEntry = null;
  let interimText = '';
  let speechEndTimer = null;
  let lastSpoken = { text: '', lang: '', endAt: -1e9 }; // bản dịch vừa đọc, để lọc tiếng vọng
  const echoOf = (text, lang) =>
    lang === lastSpoken.lang && performance.now() - lastSpoken.endAt < ECHO_WINDOW_MS && isEcho(text, lastSpoken.text);

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
          onStart: onListening,
          onInterim: (text) => {
            if (busy) return;
            lastInterimAt = performance.now();
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
          onFinal: (text) => {
            clearTimeout(speechEndTimer);
            if (!busy && text) handle([{ side: turn, text }], 'final');
          },
          onSpeechEnd: () => {
            if (busy) return;
            clearTimeout(speechEndTimer);
            speechEndTimer = setTimeout(() => {
              if (!busy && running && interimText) handle([{ side: turn, text: interimText }], 'hết tiếng nói');
            }, SPEECHEND_GRACE_MS);
          },
          onInterim: (text) => {
            if (busy) return;
            $('dlgOrig').textContent = text;
            if (text.trim() === interimText) return;
            clearTimeout(speechEndTimer); // còn chữ mới: người nói chưa dứt
            interimText = text.trim();
            lastInterimAt = performance.now();
          },
          onStart: onListening,
          onNoMatch: () => {
            if (busy || !running) return;
            if (echoOf(interimText, langOf(turn))) return diag(`Bỏ tiếng vọng (chữ tạm): "${interimText}"`);
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

  // mic thực sự nghe lại sau khi đọc xong bản dịch: ghi độ trễ mở lại vào câu vừa dịch
  function onListening() {
    showStatus();
    if (!listenAt) return;
    const ms = Math.round(performance.now() - listenAt);
    listenAt = 0;
    diag(`Mic nghe lại sau ${ms}ms`);
    if (lastEntry && lastEntry.waitMic) {
      lastEntry.waitMic = false;
      lastEntry.info += ` · mic +${ms}ms`;
      renderLog($('dlgLog'), log);
    }
  }

  function listen() {
    if (!running) return;
    interims.partner = interims.me = '';
    interimText = '';
    clearTimeout(speechEndTimer);
    arbiter.reset();
    listenAt = performance.now();
    if (mode === 'turn') recs.one.setLang(langOf(turn));
    all().forEach((r) => r.start());
    showStatus('Đang mở mic…'); // "Mời … nói" chỉ hiện khi mic thật sự nghe (onListening)
  }

  function pauseAll() {
    all().forEach((r) => r.pause());
  }

  async function handle(cands, how = 'final') {
    busy = true;
    clearTimeout(speechEndTimer);
    const tStart = performance.now();
    const waitMs = lastInterimAt ? Math.round(tStart - lastInterimAt) : 0; // từ lúc dứt lời tới lúc có câu
    // Tắt mic ngay: không để recognizer tự mở phiên mới trong lúc dịch rồi bị huỷ giữa chừng (Android dễ treo).
    pauseAll();
    let relisten = true;
    try {
      const all0 = cands.map((c) => ({ ...c, lang: langOf(c.side) }));
      const cs = all0.filter((c) => !echoOf(c.text, c.lang));
      if (!cs.length) {
        diag('Bỏ tiếng vọng: ' + all0.map((c) => `"${c.text}"`).join(' vs '));
        return;
      }
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
        `QUYẾT ĐỊNH (${mode}, lượt ${WHO[turn]}, ${how}, chờ câu ${waitMs}ms): ${win ? WHO[win.side] : 'không bên nào'} từ ` +
        cs.map((c) => `${c.side}[${c.lang}→dò ${c.detected || '?'}]:"${c.text}"${c.err ? ' LỖI ' + c.err : ''}`).join(' vs ')
      );

      if (!win) {
        if (!usable.length && cs.some((c) => c.err)) {
          setError($('dlgErr'), 'Dịch không thành công (mạng chậm hoặc dịch vụ bận). Nói lại câu vừa rồi.');
        } else if (mode === 'turn') {
          busy = false;
          relisten = false;
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

      const entry = { time: timeNow(), tag: WHO[win.side], src: win.text, out, info: `chờ câu ${waitMs}ms${how === 'final' ? '' : ' (' + how + ')'} · dịch ${win.r.ms}ms · ${win.r.engine}` };
      log.push(entry);
      lastEntry = entry;
      renderLog($('dlgLog'), log);
      $('dlgCopy').disabled = false;

      turn = other(win.side);
      // Mic đã tắt từ đầu hàm nên TTS phát không bị mic nghe lại.
      showStatus('Đang đọc bản dịch…');
      await speak(out, to, {
        rate: Number($('ttsRate').value) || 1,
        onError: (err) => diag(`LỖI TTS ${to}: ${err}`),
        onStart: (ms, voice) => {
          entry.info += ` · TTS +${ms}ms${voice ? ' · ' + voice.name : ''}`;
          renderLog($('dlgLog'), log);
        },
        onEnd: (ms, end) => {
          entry.info += ` · đọc ${(ms / 1000).toFixed(1)}s (${end})`;
          renderLog($('dlgLog'), log);
        },
      });
      lastSpoken = { text: out, lang: to, endAt: performance.now() };
      entry.waitMic = true;
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
      if (mode === 'turn') {
        turnBtn.textContent = text === 'Đang mở mic…' ? `Đang mở mic cho ${WHO[turn]}… — chạm để đổi` : `🔊 ${text}`;
        turnBtn.className = 'turn wait';
      }
      return;
    }
    if (mode === 'parallel') {
      $('dlgStatus').textContent = `Đang nghe cả hai chiều · Việt ↔ ${NAMES[partnerLang()]} · tự nhận người nói`;
    } else {
      $('dlgStatus').textContent = 'Nghe luân phiên · dịch xong tự chuyển lượt';
      turnBtn.textContent = `🎤 Mời ${WHO[turn]} nói (tiếng ${NAMES[langOf(turn)]}) — chạm để đổi`;
      turnBtn.className = 'turn ' + turn;
    }
  }

  async function start() {
    setError($('dlgErr'), '');
    $('dlgToggle').disabled = true;
    $('dlgStatus').textContent = 'Đang kiểm tra micro…';
    try {
      if (!probe) {
        // Máy đã dò ra "không song song" thì nhớ luôn (localStorage), không mất ~2 giây dò lại mỗi lần bấm Bắt đầu.
        if (readPref(PROBE_KEY) === 'no') {
          probe = { parallel: false, reason: 'đã dò trước đây' };
        } else {
          probe = await probeParallel(partnerLang(), 'vi-VN');
          if (!probe.denied) writePref(PROBE_KEY, probe.parallel ? 'yes' : 'no');
        }
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

  if (readPref(RATE_KEY)) $('ttsRate').value = readPref(RATE_KEY);
  $('ttsRate').onchange = () => writePref(RATE_KEY, $('ttsRate').value);

  // cho bảng Tự kiểm tra / test tự động đọc trạng thái
  return { state: () => ({ running, mode, turn, busy, log, switches }) };
}
