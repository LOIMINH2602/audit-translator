// Màn 1: đối thoại 1:1, tự nhận ai đang nói, dịch sang tiếng còn lại, đọc to.
//
// Chrome chỉ cho 1 phiên nhận diện tự giữ micro: bật phiên thứ 2 thì phiên đầu bị huỷ ("aborted") —
// đã đo thật 08/10/2026, đây là lý do bản 07/10 (2 recognizer song song) không dịch được câu nào.
// Nên khi bấm Bắt đầu, app dò 1,5 giây (probeParallel) rồi chọn:
//   'parallel': máy cho 2 recognizer nhận chung 1 track micro → cả 2 cùng nghe, mỗi câu chọn bên đúng
//               bằng pickSpeaker (ngôn ngữ Google dò khớp + dài hơn).
//   'turn'    : máy chỉ cho 1 recognizer (Chrome Android) → nghe luân phiên kiểu phiên dịch nối tiếp: người đến lượt
//               được GIỮ LƯỢT qua các quãng ngừng — mỗi đoạn nói xong được dịch và hiện ngay, chưa đọc; im lặng
//               hẳn holdMs (mặc định 2s, chỉnh được) mới đọc bản dịch của cả lượt rồi chuyển sang bên kia.
//               (08/10/2026: Lợi Minh báo đối tác trình bày ngắt quãng 3–4 lần mà app cắt lượt sau mỗi lần ngừng.)
//               Đoạn đầu tiên không khớp tiếng (rỗng, số, Google dò ra tiếng khác) → tự chuyển bên, mời nói lại.
//               Chạm ô lượt: đang giữ lượt thì đọc bản dịch ngay; chưa ai nói thì đổi bên.

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, probeParallel, supported } from './recognizer.js';
import { createArbiter } from './arbiter.js';
import { detectTranslate } from './translate.js';
import { pickSpeaker, syllables, isEcho } from './speaker.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, canSpeak, warmUp, getMode, setMode, resetAuto, cancel as cancelSpeech } from './tts.js';
import { diag } from './diagnostics.js';

// Mở lại mic ngay khi đọc xong (không chờ dư âm): đuôi bản dịch lọt vào mic thì isEcho lọc trong ECHO_WINDOW_MS.
const ECHO_WINDOW_MS = 3000;
// Chế độ luân phiên: Android chốt câu (final) muộn 1–2 giây sau khi người nói dừng. Khi máy báo hết tiếng nói
// (speechend) mà chừng này chưa có final thì dùng luôn chữ tạm. Khác cách "chữ đứng yên" đã bỏ: speechend chỉ
// đến khi người nói thật sự dừng, nên không chốt giữa câu.
const SPEECHEND_GRACE_MS = 350;
const HOLD_KEY = 'audit.holdMs';
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
  // chế độ luân phiên: các đoạn của lượt đang nói (đã dịch, chưa đọc)
  let floor = [];
  let floorSide = 'me'; // ai đang giữ lượt
  let inflight = 0; // số đoạn đang dịch
  let holdTimer = null;
  let talking = false; // máy báo đang có tiếng nói (speechstart chưa có speechend)
  const holdMs = () => Number($('holdMs').value) || 2000;
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
          // bên này nghe dở rồi kết thúc không ra chữ (thường là sai tiếng): báo ngay để arbiter khỏi chờ tới maxMs
          onNoMatch: () => {
            if (busy) return;
            arbiter.push(side, '');
            armHold();
          },
          onStart: onListening,
          onSpeechStart: () => { if (!busy) clearTimeout(holdTimer); }, // có người đang nói: chưa kết thúc lượt
          onInterim: (text) => {
            if (busy) return;
            clearTimeout(holdTimer);
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
            if (!busy && text) takeSegment(text, 'final');
          },
          onSpeechStart: () => {
            if (busy) return;
            talking = true;
            clearTimeout(holdTimer); // người đang giữ lượt nói tiếp: chưa kết thúc lượt
          },
          onSpeechEnd: () => {
            talking = false;
            if (busy) return;
            if (!interimText) armHold(); // tiếng động ngắn không ra chữ: hẹn lại kết thúc lượt
            clearTimeout(speechEndTimer);
            speechEndTimer = setTimeout(() => {
              if (busy || !running || !interimText) return;
              const t = interimText;
              recs.one.restart(); // mở phiên mới ngay: người nói có thể nói tiếp đoạn sau
              takeSegment(t, 'hết tiếng nói');
            }, SPEECHEND_GRACE_MS);
          },
          onInterim: (text) => {
            if (busy) return;
            $('dlgOrig').textContent = [...floor.map((e) => e.src), text].join(' ');
            if (text.trim() === interimText) return;
            clearTimeout(speechEndTimer); // còn chữ mới: người nói chưa dứt
            clearTimeout(holdTimer); // đang nói tiếp: chưa kết thúc lượt
            interimText = text.trim();
            lastInterimAt = performance.now();
          },
          onStart: onListening,
          onNoMatch: () => {
            if (busy || !running) return;
            if (echoOf(interimText, langOf(turn))) return diag(`Bỏ tiếng vọng (chữ tạm): "${interimText}"`);
            if (floor.length || inflight) {
              diag(`Bỏ qua chữ tạm không thành câu (đang giữ lượt ${WHO[turn]}): "${interimText}"`);
              interimText = '';
              return armHold();
            }
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
    talking = false;
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

  // Chế độ song song: 1 câu (đã gom 2 bên) → chọn người nói → dịch, cho vào lượt đang giữ (chưa đọc).
  // Người kia bắt đầu nói (bên thắng khác bên đang giữ lượt) → đọc ngay bản dịch lượt trước rồi mới nhận câu mới.
  async function handle(cands, how = 'final') {
    clearTimeout(holdTimer);
    const waitMs = lastInterimAt ? Math.round(performance.now() - lastInterimAt) : 0; // từ lúc dứt lời tới lúc có câu
    const all0 = cands.map((c) => ({ ...c, lang: langOf(c.side) }));
    const cs = all0.filter((c) => !echoOf(c.text, c.lang));
    if (!cs.length) {
      diag('Bỏ tiếng vọng: ' + all0.map((c) => `"${c.text}"`).join(' vs '));
      return armHold();
    }
    inflight++;
    await Promise.all(
      cs.map((c) =>
        detectTranslate(c.text, c.lang, langOf(other(c.side)))
          .then((r) => { c.r = r; c.detected = r.detected; })
          .catch((e) => { c.err = e.details || e.message; })
      )
    );
    inflight--;
    if (!running || busy) return;
    const usable = cs.filter((c) => c.r);
    const expected = floor.length ? floorSide : turn;
    const win = pickSpeaker(usable, expected);
    diag(
      `QUYẾT ĐỊNH (${mode}, lượt ${WHO[expected]}, ${how}, chờ câu ${waitMs}ms): ${win ? WHO[win.side] : 'không bên nào'} từ ` +
      cs.map((c) => `${c.side}[${c.lang}→dò ${c.detected || '?'}]:"${c.text}"${c.err ? ' LỖI ' + c.err : ''}`).join(' vs ')
    );
    if (!win) {
      if (!usable.length && cs.some((c) => c.err)) setError($('dlgErr'), 'Dịch không thành công (mạng chậm hoặc dịch vụ bận). Nói lại câu vừa rồi.');
      else if (!floor.length) setError($('dlgErr'), 'Chưa nghe rõ, mời nói lại.');
      return armHold();
    }
    if (floor.length && floorSide !== win.side) {
      await release('người kia nói'); // đọc bản dịch lượt trước; câu mới của người kia giữ lại
      if (!running) return;
    }
    addToFloor(win.side, win.text, win.r, waitMs, how);
  }

  // Thêm 1 đoạn đã dịch vào lượt đang giữ: hiện chữ ngay, chưa đọc; hẹn kết thúc lượt.
  function addToFloor(side, text, r, waitMs, how) {
    const to = langOf(other(side));
    const out = side === 'partner' ? applyGlossary(text, r.text, parseGlossary($('glossary').value)) : r.text;
    const entry = { time: timeNow(), tag: WHO[side], src: text, out, info: `chờ câu ${waitMs}ms${how === 'final' ? '' : ' (' + how + ')'} · dịch ${r.ms}ms · ${r.engine}` };
    log.push(entry);
    floor.push(entry);
    floorSide = side;
    lastEntry = entry;
    renderLog($('dlgLog'), log);
    $('dlgCopy').disabled = false;
    $('dlgOrig').textContent = floor.map((e) => e.src).join(' ');
    $('dlgTrans').textContent = floor.map((e) => e.out).join(' ');
    setError($('dlgErr'), canSpeak(to) ? '' : `Không thấy giọng đọc ${NAMES[to]} trong máy (vẫn thử đọc). Chọn "Giọng Google" ở ô Giọng đọc.`);
    armHold();
  }

  // ---------- chế độ luân phiên: giữ lượt ----------
  // 1 đoạn nói xong: dịch ngay, hiện chữ, chưa đọc; mic vẫn nghe tiếp người đang nói.
  async function takeSegment(text, how) {
    interimText = '';
    talking = false;
    const side = turn;
    const lang = langOf(side);
    const to = langOf(other(side));
    if (echoOf(text, lang)) return diag(`Bỏ tiếng vọng: "${text}"`);
    const waitMs = lastInterimAt ? Math.round(performance.now() - lastInterimAt) : 0;
    clearTimeout(holdTimer);
    inflight++;
    let r = null;
    try {
      r = await detectTranslate(text, lang, to);
    } catch (e) {
      diag('LỖI dịch: ' + (e.details || e.message));
    }
    inflight--;
    if (!running || busy || side !== turn) return; // lượt đã kết thúc/đổi trong lúc dịch
    if (!r) {
      setError($('dlgErr'), 'Dịch không thành công (mạng chậm hoặc dịch vụ bận). Nói lại đoạn vừa rồi.');
      return armHold();
    }
    const ok = pickSpeaker([{ side, lang, text, detected: r.detected }], side);
    diag(`QUYẾT ĐỊNH (turn, lượt ${WHO[side]}, ${how}, chờ câu ${waitMs}ms, đoạn ${floor.length + 1}): ${ok ? 'nhận' : 'loại'} [${lang}→dò ${r.detected || '?'}] "${text}"`);
    if (!ok) {
      if (!floor.length && !inflight) return switchTurn(); // chưa ai nói gì mà nghe sai tiếng: bên kia đang nói
      return armHold(); // đang giữ lượt: bỏ đoạn rác, giữ lượt
    }
    addToFloor(side, text, r, waitMs, how);
  }

  // Hẹn kết thúc lượt sau holdMs im lặng (không hẹn nếu người nói đang nói dở 1 đoạn).
  function armHold() {
    clearTimeout(holdTimer);
    if (!running || busy || !floor.length || interimText || talking) return;
    showStatus();
    holdTimer = setTimeout(() => release('im lặng'), holdMs());
  }

  // Kết thúc lượt: đọc bản dịch cả lượt rồi chuyển sang bên kia.
  async function release(how) {
    clearTimeout(holdTimer);
    if (busy || !floor.length) return;
    if (inflight) {
      holdTimer = setTimeout(() => release(how), 150); // còn đoạn đang dịch: chờ cho đủ
      return;
    }
    busy = true;
    pauseAll();
    const side = floorSide;
    const to = langOf(other(side));
    const segs = floor;
    floor = [];
    const out = segs.map((e) => e.out).join(' ');
    const last = segs[segs.length - 1];
    if (segs.length > 1) last.info += ` · cả lượt ${segs.length} đoạn`;
    diag(`Kết thúc lượt ${WHO[side]} (${how}, ${segs.length} đoạn) → đọc bản dịch`);
    turn = other(side);
    showStatus('Đang đọc bản dịch…');
    try {
      await speak(out, to, {
        rate: Number($('ttsRate').value) || 1,
        onError: (err) => diag(`LỖI TTS ${to}: ${err}`),
        onStart: (ms, voice) => {
          last.info += ` · TTS +${ms}ms${voice ? ' · ' + voice : ''}`;
          renderLog($('dlgLog'), log);
        },
        onEnd: (ms, end) => {
          last.info += ` · đọc ${(ms / 1000).toFixed(1)}s (${end})`;
          renderLog($('dlgLog'), log);
        },
      });
      lastSpoken = { text: out, lang: to, endAt: performance.now() };
      last.waitMic = true;
    } catch (e) {
      diag('LỖI đọc bản dịch: ' + (e && e.message));
    } finally {
      busy = false;
      if (running) {
        pauseAll();
        listen();
      }
    }
  }

  // Chế độ luân phiên: câu không khớp tiếng đang nghe → nhiều khả năng bên kia đang nói → chuyển bên, mời nói lại.
  function switchTurn() {
    clearTimeout(holdTimer);
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
      $('dlgStatus').textContent = floor.length
        ? `${WHO[floorSide]} đang nói (${floor.length} đoạn) · im lặng ${(holdMs() / 1000).toLocaleString('vi-VN')} giây thì đọc bản dịch`
        : `Đang nghe cả hai chiều · Việt ↔ ${NAMES[partnerLang()]} · tự nhận người nói`;
    } else {
      turnBtn.className = 'turn ' + turn;
      if (floor.length) {
        $('dlgStatus').textContent = `Đang nghe tiếp · im lặng ${(holdMs() / 1000).toLocaleString('vi-VN')} giây thì đọc bản dịch`;
        turnBtn.textContent = `🎤 ${WHO[turn]} đang nói (${floor.length} đoạn) — chạm để đọc bản dịch ngay`;
      } else {
        $('dlgStatus').textContent = 'Nghe luân phiên · nói hết ý rồi dừng, app đọc bản dịch và chuyển lượt';
        turnBtn.textContent = `🎤 Mời ${WHO[turn]} nói (tiếng ${NAMES[langOf(turn)]}) — chạm để đổi`;
      }
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
      // Đọc thử không tiếng giọng tiếng đối tác (lần đầu): giọng máy chậm thì tự dùng giọng Google Dịch.
      // Tối đa ~0,9 giây. Tiếng Việt không đọc thử: đo luôn ở câu thật đầu tiên.
      $('dlgStatus').textContent = 'Đang chuẩn bị giọng đọc…';
      await warmUp(partnerLang());
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
    clearTimeout(holdTimer);
    floor = [];
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
    if (!running) warmUp(partnerLang());
    if (mode === 'parallel') recs.partner.setLang(partnerLang());
    else if (mode === 'turn' && running && !busy) {
      pauseAll();
      listen();
    }
    if (running) showStatus();
  };

  $('dlgTurn').onclick = () => {
    if (!running || mode !== 'turn' || busy) return;
    if (floor.length || inflight) return release('chạm'); // đang giữ lượt: đọc bản dịch ngay
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

  $('ttsEngine').value = getMode();
  $('ttsEngine').onchange = () => {
    const m = $('ttsEngine').value;
    if (m === 'auto') resetAuto(); // chọn lại Tự động = đo lại từ đầu
    setMode(m);
    diag('Giọng đọc: ' + m);
  };
  if (readPref(HOLD_KEY)) $('holdMs').value = readPref(HOLD_KEY);
  $('holdMs').onchange = () => writePref(HOLD_KEY, $('holdMs').value);
  if (readPref(RATE_KEY)) $('ttsRate').value = readPref(RATE_KEY);
  $('ttsRate').onchange = () => writePref(RATE_KEY, $('ttsRate').value);

  // cho bảng Tự kiểm tra / test tự động đọc trạng thái
  return { state: () => ({ running, mode, turn, busy, log, switches, floor: floor.length }) };
}
