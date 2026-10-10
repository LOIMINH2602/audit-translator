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
import { detectTranslate, translate } from './translate.js';
import { pickSpeaker, syllables, isEcho } from './speaker.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, canSpeak, warmUp, getMode, setMode, resetAuto, cancel as cancelSpeech } from './tts.js';
import { diag } from './diagnostics.js';
import { holdScreen, classifyMicError } from './keepalive.js';
import { createAutoTalk } from './autotalk.js';

// Mở lại mic ngay khi đọc xong (không chờ dư âm): đuôi bản dịch lọt vào mic thì isEcho lọc trong ECHO_WINDOW_MS.
const ECHO_WINDOW_MS = 3000;
// Chế độ luân phiên: Android chốt câu (final) muộn 1–2 giây sau khi người nói dừng. Khi máy báo hết tiếng nói
// (speechend) mà chừng này chưa có final thì dùng luôn chữ tạm. Khác cách "chữ đứng yên" đã bỏ: speechend chỉ
// đến khi người nói thật sự dừng, nên không chốt giữa câu.
const SPEECHEND_GRACE_MS = 350;
const HOLD_KEY = 'audit.holdMs';
const PROBE_KEY = 'audit.parallel.v1';
const RATE_KEY = 'audit.ttsRate';
// 'chrome' (luân phiên, mặc định) | 'auto' (Tự nhận người nói, Whisper trên máy — thử nghiệm: đo giọng người thật 10/10/2026,
// Whisper tiny chỉ khớp ~50% chữ tiếng Việt so với Google 93% → bản dịch loạn). Khoá v2: ai đã lưu 'auto' từ bản .2 quay về mặc định.
const LISTEN_KEY = 'audit.listenMode.v2';
const ENDSIL_KEY = 'audit.endSilMs';
const WHO = { me: 'Tôi', partner: 'Đối tác' };
// localStorage có thể bị chặn (chế độ ẩn danh...): lỗi thì coi như không có
const readPref = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const other = (side) => (side === 'partner' ? 'me' : 'partner');

export function initDialogue() {
  const log = [];
  let usingAuto = false; // đang chạy chế độ Tự nhận người nói
  const auto = createAutoTalk({
    log,
    partnerLang: () => $('partnerLang').value,
    endSilenceMs: () => Number($('endSilMs').value) || 800,
    status: (t) => { $('dlgStatus').textContent = t; },
    // test tự động ép mô hình/cách chạy (đọc lúc bấm Bắt đầu); người dùng: tự chọn theo máy
    get model() { return window.__autoModel; },
    get device() { return window.__autoDevice; },
  });
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
  // Mốc tính im lặng: lần cuối nghe ra chữ mới (chữ tạm đổi / final) hoặc máy báo bắt đầu có tiếng nói. Không dùng
  // cờ "đang nói" (speechstart → speechend):
  // 09/10/2026 Lợi Minh báo nói tiếng Việt xong app không tự đọc bản dịch, phải chạm ô lượt; e2e có tiếng ồn nền
  // (NOISE=0.03–0.1) tái hiện: Chrome báo hết tiếng nói trễ 4–8 giây hoặc không báo, speechstart bắn vì tiếng ồn.
  let lastHeardAt = 0;
  const holdMs = () => Number($('holdMs').value) || 2000;
  let lastSpoken = { text: '', lang: '', endAt: -1e9 }; // bản dịch vừa đọc, để lọc tiếng vọng
  const echoOf = (text, lang) =>
    lang === lastSpoken.lang && performance.now() - lastSpoken.endAt < ECHO_WINDOW_MS && isEcho(text, lastSpoken.text);

  const partnerLang = () => $('partnerLang').value;
  const langOf = (side) => (side === 'partner' ? partnerLang() : 'vi-VN');

  const arbiter = createArbiter({}, (cands) => handle(cands));

  // 'not-allowed' trên Android thường KHÔNG phải bị chặn quyền mà là trang bị ẩn (xem keepalive.js): chỉ dừng hẳn
  // khi quyền micro thật sự bị chặn; trang ẩn thì chờ hiện lại; còn lại thử nghe lại (tối đa 3 lần / 15 giây).
  let micRetries = [];
  let resumeTimer = null;
  function onError(name) {
    return async (err) => {
      const kind = await classifyMicError(err);
      if (!kind) return diag(`LỖI ${name}: ${err}`);
      if (!running) return;
      if (kind === 'denied') {
        setError($('dlgErr'), 'Chưa cấp quyền micro. Vào cài đặt trình duyệt để cho phép.');
        return stop();
      }
      diag(`Micro bị ngắt (${name}: ${err}) — ${kind === 'hidden' ? 'trang đang ẩn, chờ hiện lại' : 'thử nghe lại'}`);
      if (kind === 'hidden') return; // visibilitychange mở lại mic
      const now = performance.now();
      micRetries = micRetries.filter((t) => now - t < 15000).concat(now);
      if (micRetries.length > 3) {
        setError($('dlgErr'), 'Micro bị ngắt liên tục: có thể app khác đang dùng micro (cuộc gọi, ghi âm, Zalo). Đóng app đó rồi bấm Bắt đầu nghe.');
        return stop();
      }
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (running && !busy && document.visibilityState === 'visible') {
          pauseAll();
          listen();
        }
      }, 800);
    };
  }

  // Trang ẩn (tắt màn hình, chuyển app): Android ngừng micro → tạm dừng. Hiện lại → nghe tiếp, giữ nguyên lượt và
  // các đoạn đã dịch chưa đọc.
  document.addEventListener('visibilitychange', () => {
    if (!running || usingAuto) return; // Tự nhận người nói: micro getUserMedia không bị Chrome cắt như nhận diện
    if (document.visibilityState !== 'visible') {
      clearTimeout(holdTimer);
      clearTimeout(speechEndTimer);
      clearTimeout(resumeTimer);
      if (!busy) pauseAll();
      diag('Trang bị ẩn (tắt màn hình / chuyển app) → Android ngừng micro');
      return;
    }
    diag('Trang hiện lại → nghe lại');
    setError($('dlgErr'), 'App vừa bị ẩn (tắt màn hình hoặc chuyển app) nên Android ngừng micro. Đã nghe lại — khi audit, để app mở trên màn hình.');
    if (busy) return; // đang đọc bản dịch: đọc xong tự nghe lại
    pauseAll();
    listen();
    armHold();
  });

  function buildRecognizers() {
    if (mode === 'parallel') {
      const mk = (side) =>
        createRecognizer({
          name: side === 'partner' ? 'đối-tác' : 'việt',
          lang: langOf(side),
          track: probe.track,
          continuous: false,
          onFinal: (text) => {
            if (busy) return;
            if (text) lastHeardAt = performance.now();
            arbiter.push(side, text);
          },
          // bên này nghe dở rồi kết thúc không ra chữ (thường là sai tiếng): báo ngay để arbiter khỏi chờ tới maxMs
          onNoMatch: () => {
            if (busy) return;
            arbiter.push(side, '');
            armHold();
          },
          onStart: onListening,
          onSpeechStart: () => {
            if (busy) return;
            lastHeardAt = performance.now(); // dời mốc kết thúc lượt 1 lần (xem chế độ luân phiên)
            armHold();
          },
          onInterim: (text) => {
            if (busy) return;
            lastInterimAt = lastHeardAt = performance.now();
            armHold(); // có chữ mới: dời mốc kết thúc lượt
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
            if (busy || !text) return;
            lastHeardAt = performance.now();
            takeSegment(text, 'final');
          },
          // máy báo bắt đầu có tiếng nói (sớm hơn chữ tạm 0,5–1 giây): dời mốc kết thúc lượt 1 lần — người đang giữ
          // lượt vừa nói tiếp sau quãng ngừng. Chỉ là 1 mốc, không phải cờ "đang nói": ồn thì máy bắn speechstart mà
          // không bao giờ bắn speechend, cờ sẽ kẹt và lượt không bao giờ kết thúc (lỗi trước 09/10/2026).
          onSpeechStart: () => {
            if (busy) return;
            lastHeardAt = performance.now();
            armHold();
          },
          // máy báo hết tiếng nói (yên tĩnh thì đến kịp lúc): chốt đoạn sớm, không chờ final của Android. Im lặng
          // tính từ đây — chữ tạm cuối cùng đến sớm hơn lúc người nói thật sự dừng vài trăm ms, tính từ đó thì quãng
          // ngừng 1,2 giây giữa 2 đoạn đã bị coi là hết lượt. Ồn mà máy không báo: vẫn còn mốc chữ tạm cuối cùng.
          onSpeechEnd: () => {
            if (busy) return;
            lastHeardAt = performance.now();
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
            interimText = text.trim();
            lastInterimAt = lastHeardAt = performance.now();
            armHold(); // dời mốc kết thúc lượt; chữ đứng yên đủ holdMs thì chốt luôn (endIfQuiet)
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
    if (floor.length > 1) prepareWhole(side, to);
    setError($('dlgErr'), canSpeak(to) ? '' : `Không thấy giọng đọc ${NAMES[to]} trong máy (vẫn thử đọc). Chọn "Giọng Google" ở ô Giọng đọc.`);
    armHold();
  }

  // Dịch sẵn cả lượt (nhiều đoạn) thành 1 khối ở nền mỗi khi có đoạn mới: từng đoạn dịch riêng rồi ghép thì câu rời
  // rạc, mất ngữ cảnh (10/10/2026: đối tác Hàn chê bản dịch). Lúc đọc chỉ dùng nếu đã xong, không bắt người nghe chờ.
  let whole = null; // { src, p: Promise<{ text, ms }|null>, r }
  function joinSrc(segs, from) {
    return segs.map((e) => e.src.trim().replace(/[.!?。！？]+$/, '')).join(from === 'vi-VN' || from === 'en-US' ? '. ' : '。');
  }
  function prepareWhole(side, to) {
    const from = langOf(side);
    const src = joinSrc(floor, from);
    const job = { src, r: null };
    job.p = translate(src, from, to, { timeoutMs: 3000, only: 'google' })
      .then((r) => (job.r = r))
      .catch(() => null);
    whole = job;
  }

  // ---------- chế độ luân phiên: giữ lượt ----------
  // 1 đoạn nói xong: dịch ngay, hiện chữ, chưa đọc; mic vẫn nghe tiếp người đang nói.
  async function takeSegment(text, how) {
    interimText = '';
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
      // Đang giữ lượt mà nghe ra cả câu sai tiếng (≥ 2 từ): người kia đã bắt đầu nói → đọc ngay bản dịch lượt này
      // rồi nghe người kia (09/10/2026: "không tự nhận diện được ai đang nói"). 1 từ rời thường là tiếng động: bỏ qua.
      if (syllables(text, lang) >= 2 && floor.length) {
        diag(`Nghe ra câu sai tiếng khi ${WHO[side]} đang giữ lượt → nghi ${WHO[other(side)]} đang nói, đọc bản dịch ngay`);
        return release('người kia nói');
      }
      return armHold(); // đang giữ lượt: bỏ đoạn rác, giữ lượt
    }
    addToFloor(side, text, r, waitMs, how);
  }

  // Kết thúc lượt khi KHÔNG CÓ CHỮ MỚI trong holdMs, tính từ lastHeardAt (xem khai báo). Có lượt đang giữ (floor) hoặc
  // đang có chữ tạm chưa thành câu thì hẹn; gọi lại mỗi khi có chữ mới để dời mốc.
  function armHold() {
    clearTimeout(holdTimer);
    if (!running || busy) return;
    if (!floor.length && !(mode === 'turn' && interimText)) return;
    showStatus();
    holdTimer = setTimeout(endIfQuiet, Math.max(50, lastHeardAt + holdMs() - performance.now()));
  }

  async function endIfQuiet() {
    if (!running || busy) return;
    if (performance.now() - lastHeardAt < holdMs() - 50) return armHold(); // vừa có chữ mới
    if (mode === 'turn' && interimText) {
      // chữ tạm đứng yên đủ holdMs mà máy chưa báo hết tiếng nói / chưa có final (thường do ồn): chốt luôn
      const t = interimText;
      clearTimeout(speechEndTimer);
      diag(`Chữ tạm đứng yên ${holdMs()}ms, máy chưa chốt câu → tự chốt: "${t}"`);
      recs.one.restart();
      await takeSegment(t, 'chữ đứng yên');
      if (!running || busy) return;
    }
    release('im lặng');
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
    let out = segs.map((e) => e.out).join(' ');
    const last = segs[segs.length - 1];
    if (segs.length > 1) {
      last.info += ` · cả lượt ${segs.length} đoạn`;
      const job = whole;
      const src = joinSrc(segs, langOf(side));
      if (job && job.src === src) {
        if (!job.r) await Promise.race([job.p, new Promise((res) => setTimeout(res, 300))]); // gần xong thì chờ chút
        if (job.r) {
          out = side === 'partner' ? applyGlossary(src, job.r.text, parseGlossary($('glossary').value)) : job.r.text;
          last.info += ' · đọc bản dịch cả lượt';
          $('dlgTrans').textContent = out;
          diag(`Đọc bản dịch cả lượt: "${src}" → "${out}"`);
        } else diag('Bản dịch cả lượt chưa xong → đọc bản ghép từng đoạn');
      }
      if (!running) return void (busy = false);
    }
    whole = null;
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
    if (usingAuto) {
      turnBtn.hidden = true; // không còn lượt
      if (text) $('dlgStatus').textContent = text;
      return;
    }
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
      if ($('listenMode').value === 'auto') {
        await warmUp(partnerLang());
        try {
          await auto.start();
        } catch (_) {
          return; // autotalk đã báo lỗi
        }
        usingAuto = true;
        running = true;
        holdScreen('dlg', true);
        $('dlgToggle').textContent = 'Dừng nghe';
        showStatus();
        return;
      }
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
      micRetries = [];
      holdScreen('dlg', true); // màn hình tắt = Android ngừng micro
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
    holdScreen('dlg', false);
    if (usingAuto) {
      usingAuto = false;
      auto.stop();
      $('dlgToggle').textContent = 'Bắt đầu nghe';
      return showStatus();
    }
    clearTimeout(holdTimer);
    clearTimeout(resumeTimer);
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
    if (usingAuto) return auto.config({ partner: partnerLang() });
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
    if (!supported && $('listenMode').value !== 'auto') return setError($('dlgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
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
  // Cách nghe: Tự nhận người nói (mặc định) hoặc Chrome luân phiên; mỗi cách có ô thời gian chờ riêng
  const showListenMode = () => {
    const a = $('listenMode').value === 'auto';
    $('endSilBox').hidden = !a;
    $('holdBox').hidden = a;
  };
  if (readPref(LISTEN_KEY)) $('listenMode').value = readPref(LISTEN_KEY);
  showListenMode();
  $('listenMode').onchange = () => {
    writePref(LISTEN_KEY, $('listenMode').value);
    showListenMode();
    if (running) stop(); // đổi cách nghe: bấm Bắt đầu lại
  };
  if (readPref(ENDSIL_KEY)) $('endSilMs').value = readPref(ENDSIL_KEY);
  $('endSilMs').onchange = () => {
    writePref(ENDSIL_KEY, $('endSilMs').value);
    auto.config({ endSilenceMs: Number($('endSilMs').value) });
  };
  if (readPref(HOLD_KEY)) $('holdMs').value = readPref(HOLD_KEY);
  $('holdMs').onchange = () => writePref(HOLD_KEY, $('holdMs').value);
  if (readPref(RATE_KEY)) $('ttsRate').value = readPref(RATE_KEY);
  $('ttsRate').onchange = () => writePref(RATE_KEY, $('ttsRate').value);

  // cho bảng Tự kiểm tra / test tự động đọc trạng thái
  return { state: () => ({ running, mode: usingAuto ? 'auto' : mode, turn, busy, log, switches, floor: floor.length, auto: auto.state() }) };
}
