// Màn 2: nghe hội trường. 1 recognizer, người dùng chạm chọn tiếng đang nghe, chỉ dịch sang tiếng Việt.
// Real time + song song (11/10/2026, Lợi Minh test podcast Hàn): vừa nghe vừa đọc bản dịch — micro KHÔNG tạm ngừng khi đọc
// (mặc định; đeo tai nghe). Chữ đang nghe và bản dịch tạm hiện ngay như phụ đề. Câu được chốt theo chữ, không mở phiên
// nhận diện mới (mở phiên mới trên Android mất ~0,6s tiếng nói).

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, supported } from './recognizer.js';
import { translate } from './translate.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { speak, cancel } from './tts.js';
import { diag } from './diagnostics.js';
import { holdScreen, classifyMicError } from './keepalive.js';
import { createAutoListener, pickDevice } from './autolisten.js';
import { openPhoneMic } from './phonemic.js';

// nhớ theo máy: có đọc bản dịch không, khi đọc có nghe tiếp không, tiếng đang nghe
const SPEAK_KEY = 'audit.mtgSpeak.v1';
const DURING_KEY = 'audit.mtgDuring.v1';
const LANG_KEY = 'audit.mtgLang.v1';
const ENGINE_KEY = 'audit.mtgEngine.v1';
const MIC_KEY = 'audit.mtgMic.v1';
const MODEL_KEY = 'audit.mtgModel.v1';
const ENGLISH_G = /\b(the|we|will|and|then|of|is|are|with|this|that|our|you|first|finally)\b/gi;
const readPref = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

// Chốt 1 câu khi chữ mới đứng yên STABLE_MS (người nói ngừng), hoặc đã nói liền MAX_MS chưa chốt (podcast, thuyết trình:
// máy không chốt câu khi người nói không ngừng).
const STABLE_MS = 1000;
const MAX_MS = 6000;
const HARD_MAX_MS = 9000;
const SPEECHEND_GRACE_MS = 350; // như màn 1:1: speechend xong 350ms không có chữ mới thì coi là dứt câu
const CARRY_MS = 10000; // > HARD_MAX_MS: câu sau dài vẫn kịp ghép
const PREVIEW_MS = 900; // bản dịch tạm của chữ đang nghe: tối đa 1 lần / PREVIEW_MS
const MAX_LAG_MS = 8000; // giọng đọc tụt quá mức này sau người nói thì bỏ đọc câu cũ
const spaced = (lang) => !/^(zh|ja)/.test(lang);

export function initMeeting() {
  const log = [];
  let running = false;
  let currentLang = NAMES[readPref(LANG_KEY)] ? readPref(LANG_KEY) : 'en-US';
  if (readPref(SPEAK_KEY)) $('mtgSpeak').checked = readPref(SPEAK_KEY) === '1';
  if (readPref(DURING_KEY)) $('mtgDuring').value = readPref(DURING_KEY);
  $('mtgSpeak').onchange = () => writePref(SPEAK_KEY, $('mtgSpeak').checked ? '1' : '0');
  $('mtgDuring').onchange = () => writePref(DURING_KEY, $('mtgDuring').value);
  const pauseWhileSpeaking = () => $('mtgDuring').value === 'pause';
  for (const [id, key] of [['mtgEngine', ENGINE_KEY], ['mtgModel', MODEL_KEY]]) {
    if (readPref(key)) $(id).value = readPref(key);
    $(id).onchange = () => { writePref(key, $(id).value); if (running) $('mtgToggle').click(); };
  }
  $('mtgMic').onchange = () => { writePref(MIC_KEY, $('mtgMic').value); if (running) $('mtgToggle').click(); };
  const useMic = () => $('mtgEngine').value === 'mic';

  // Chữ của phiên nhận diện hiện tại đã chốt (committed) → chữ tạm sau đó chỉ lấy phần mới (delta).
  let committed = '';
  let interim = ''; // phần chữ mới chưa chốt
  let rawInterim = ''; // nguyên chữ tạm của phiên
  let interimAt = 0; // lần cuối phần mới đổi
  let firstAt = 0; // lúc phần mới bắt đầu
  const resetInterim = () => { interim = ''; rawInterim = ''; interimAt = 0; firstAt = 0; showLive('', ''); };

  // bỏ phần đã chốt khỏi chữ của phiên. Google hay sửa vài chữ cũ → không khớp đầu chuỗi thì bỏ theo số từ / số ký tự.
  function delta(text) {
    if (!committed) return text;
    if (text.startsWith(committed)) return text.slice(committed.length).trim();
    if (spaced(currentLang)) return text.split(/\s+/).slice(committed.split(/\s+/).length).join(' ');
    return text.slice(committed.length).trim();
  }

  let speechEndTimer = null;
  const rec = createRecognizer({
    name: 'hội-trường',
    lang: currentLang,
    continuous: false,
    onStart: () => { committed = ''; },
    onFinal: (text) => {
      const d = delta(text);
      committed = '';
      resetInterim();
      if (d) commit(d, 'final');
    },
    // Android chốt câu muộn (~1,5s) rồi mới mở phiên mới (~0,6s) → ~2s không nghe giữa 2 câu, podcast mất đầu câu sau
    // (test 11/10: chỉ nghe được 67%). Máy báo hết tiếng nói thì chốt chữ tạm luôn và mở phiên mới ngay.
    onSpeechEnd: () => {
      clearTimeout(speechEndTimer);
      speechEndTimer = setTimeout(() => {
        if (!running || !interim || (speaking && pauseWhileSpeaking())) return;
        const t = interim;
        committed = '';
        interim = '';
        rawInterim = '';
        showLive('', '');
        rec.restart();
        commit(t, 'hết tiếng nói');
      }, SPEECHEND_GRACE_MS);
    },
    onInterim: (text) => {
      clearTimeout(speechEndTimer); // còn chữ mới: người nói chưa dứt
      if (!running || (speaking && pauseWhileSpeaking())) return;
      const t = text.trim();
      const d = delta(t);
      rawInterim = t;
      if (!d || d === interim) return;
      const now = Date.now();
      if (!firstAt) firstAt = now;
      interim = d;
      interimAt = now;
      showLive(d, null);
      preview();
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
      if (kind === 'transient') setTimeout(() => running && !(speaking && pauseWhileSpeaking()) && rec.start(), 800);
    },
    onLog: diag,
  });

  // Android ngừng micro khi trang ẩn (keepalive.js): hiện lại thì nghe tiếp
  document.addEventListener('visibilitychange', () => {
    if (!running || useMic() || document.visibilityState !== 'visible' || (speaking && pauseWhileSpeaking())) return;
    diag('Trang hiện lại → nghe lại (hội trường)');
    setError($('mtgErr'), 'App vừa bị ẩn (tắt màn hình hoặc chuyển app) nên Android ngừng micro. Đã nghe lại.');
    rec.start();
  });

  // ---- phụ đề: chữ đang nghe + bản dịch tạm ----
  function showLive(src, out) {
    const box = $('mtgLive');
    if (!src) { box.hidden = true; return; }
    box.hidden = false;
    $('mtgLiveSrc').textContent = src.length > 160 ? '…' + src.slice(-160) : src;
    if (out !== null) $('mtgLiveOut').textContent = out;
  }
  let previewBusy = false;
  let previewAt = 0;
  async function preview() {
    if (previewBusy || Date.now() - previewAt < PREVIEW_MS) return;
    previewBusy = true;
    previewAt = Date.now();
    const src = interim;
    try {
      const r = await translate(src, currentLang, 'vi-VN', { timeoutMs: 3000 });
      if (interim && interim.startsWith(src.slice(0, 8))) showLive(interim, r.text);
    } catch (_) {} finally {
      previewBusy = false;
    }
    if (interim && interim !== src) setTimeout(preview, 0);
  }

  setInterval(() => {
    if (!running || !interim || (speaking && pauseWhileSpeaking())) return;
    const now = Date.now();
    if (now - interimAt >= STABLE_MS) return take(interim, 'ngừng nói');
    if (now - firstAt < MAX_MS) return;
    // nói liền: cắt ở đuôi câu gần nhất (tiếng Hàn …다/…요/…까), phần sau giữ lại nghe tiếp; không có đuôi câu thì chờ
    // tới HARD_MAX_MS mới cắt cứng (cắt giữa câu → bản dịch mất nghĩa, test 11/10: "라는 입장입니다" → "Đây là vị trí")
    const cut = sentenceCut(interim);
    if (cut) return take(cut, 'hết câu (nói liền)');
    // cắt cứng: chừa lại từ cuối (đang nghe dở, Google còn sửa — test 11/10: "없" + "는")
    if (now - firstAt >= HARD_MAX_MS) take(dropLastWord(interim), 'nói liền ' + HARD_MAX_MS / 1000 + 's');
  }, 200);

  // chốt `text` (phần đầu của interim); phiên vẫn chạy tiếp: lần sau chỉ lấy phần mới
  function take(text, why) {
    const rest = interim.slice(text.length).trim();
    committed = rest ? rawInterim.slice(0, rawInterim.length - rest.length).trim() : rawInterim;
    interim = rest;
    interimAt = rest ? Date.now() : 0;
    firstAt = rest ? Date.now() : 0;
    showLive(rest, '');
    commit(text, why);
  }

  const dropLastWord = (s) => (spaced(currentLang) && /\s/.test(s) ? s.replace(/\s+\S+$/, '') : s);

  // phần đầu của s tới đuôi câu cuối cùng (chỉ tiếng Hàn: đuôi câu rõ, có dấu cách); không có → ''
  function sentenceCut(s) {
    if (!/^ko/.test(currentLang)) return '';
    const words = s.split(/\s+/);
    for (let i = words.length - 2; i >= 1; i--) {
      if (/(다|요|죠|까)[.?!]?$/.test(words[i])) return words.slice(0, i + 1).join(' ');
    }
    return '';
  }

  // ---- dịch: chạy ngay từng câu, hiện theo đúng thứ tự ----
  let shown = Promise.resolve();
  const heardAt = (t) => `${((t - startedAt) / 1000).toFixed(1)}s`;
  let startedAt = 0;
  // mảnh quá ngắn (1 từ, vd. "세" bị cắt khỏi "계보건기구…" khi mở phiên mới) dịch rời thì vô nghĩa → giữ lại, ghép vào câu sau;
  // CARRY_MS không có câu sau thì dịch luôn
  let carry = '';
  let carryTimer = null;
  function commit(text, why) {
    if (carry) {
      text = carry + (spaced(currentLang) ? ' ' : '') + text;
      carry = '';
      clearTimeout(carryTimer);
    }
    const short = spaced(currentLang) ? !/\s/.test(text.trim()) : text.trim().length < 3;
    if (short && why !== 'mảnh ngắn') {
      carry = text;
      carryTimer = setTimeout(() => { if (carry) { const t = carry; carry = ''; commit(t, 'mảnh ngắn'); } }, CARRY_MS);
      return;
    }
    const at = Date.now();
    diag(`Hội trường chốt câu (${why}) ${heardAt(at)}: "${text}"`);
    const job = translateOne(text);
    shown = shown.then(async () => {
      const r = await job;
      if (!r || !running) return;
      log.push({ time: timeNow(), tag: NAMES[currentLang], src: text, out: r.out, info: `dịch ${r.ms}ms · ${r.engine}` });
      renderLog($('mtgLog'), log);
      $('mtgCopy').disabled = false;
      stats.lines.push({ src: text, out: r.out, why, heardAt: at - startedAt, shownAt: Date.now() - startedAt });
      if ($('mtgSpeak').checked) say(r.out, at);
    });
  }

  async function translateOne(text) {
    try {
      const r = await translate(text, currentLang, 'vi-VN');
      // đoạn dài không dấu câu: Google đôi khi trả nửa sau bằng tiếng Anh (đo 11/10, lúc Google chậm) → dịch lại phần đó
      if ((r.text.match(ENGLISH_G) || []).length >= 3) {
        try {
          r.text = (await translate(r.text, 'en-US', 'vi-VN')).text;
          diag('Hội trường: bản dịch lẫn tiếng Anh → dịch lại');
        } catch (_) {}
      }
      return { out: applyGlossary(text, r.text, parseGlossary($('glossary').value)), ms: r.ms, engine: r.engine };
    } catch (e) {
      setError($('mtgErr'), 'Dịch không thành công, bỏ qua câu này.');
      diag('LỖI dịch (hội trường): ' + (e.details || e.message));
      return null;
    }
  }

  // ---- đọc: hàng đợi; tụt lại sau người nói thì gộp các câu đang chờ, đọc nhanh hơn ----
  let speaking = false;
  const sayQueue = [];
  function say(text, heard) {
    sayQueue.push({ text, heard });
    if (!speaking) readNext();
  }
  async function readNext() {
    if (!running || !sayQueue.length) return;
    let items = sayQueue.splice(0);
    // giữ real time: tụt quá MAX_LAG_MS sau người nói thì chỉ đọc câu mới nhất (câu bỏ qua vẫn có chữ trên màn hình).
    // Test 11/10: bản dịch tiếng Việt dài hơn câu Hàn, đọc tụt tới 12s.
    if (items.length > 1 && Date.now() - items[0].heard > MAX_LAG_MS) {
      diag(`Hội trường đọc tụt ${Date.now() - items[0].heard}ms → bỏ đọc ${items.length - 1} câu cũ (vẫn có chữ)`);
      stats.skipped += items.length - 1;
      items = items.slice(-1);
    }
    const text = items.map((x) => x.text).join(' ');
    // bản dịch tiếng Việt thường dài hơn câu gốc → đọc nhanh hơn người nói; tụt lại (nhiều câu chờ) thì nhanh hơn nữa
    const rate = items.length > 1 ? 1.5 : 1.25;
    speaking = true;
    const pause = pauseWhileSpeaking();
    if (pause) {
      // dùng loa ngoài: tạm ngừng nghe để micro không nghe lại giọng đọc; chữ đang nghe dở được chốt trước
      if (useMic()) L && L.config({ muted: true });
      else {
        if (interim) { const t = interim; committed = rawInterim; interim = ''; commit(t, 'trước khi đọc'); }
        rec.pause();
        resetInterim();
      }
    }
    const t0 = Date.now();
    stats.reads.push({ n: items.length, startAt: t0 - startedAt, lagMs: t0 - items[0].heard, rate });
    diag(`Hội trường đọc ${items.length} câu (x${rate}, trễ ${t0 - items[0].heard}ms sau khi chốt câu)`);
    try {
      await speak(text, 'vi-VN', { rate, onError: (err) => diag('LỖI TTS vi-VN: ' + err) });
    } finally {
      speaking = false;
    }
    if (pause && running) {
      await new Promise((res) => setTimeout(res, 300));
      if (useMic()) L && L.config({ muted: false });
      else rec.start();
    }
    readNext();
  }

  // cho test tự động (tools/e2e/meeting.mjs) đọc
  const stats = { lines: [], reads: [], skipped: 0, asr: [] };
  window.__meeting = { stats, state: () => ({ running, speaking, queued: sayQueue.length, interim }) };

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
      committed = '';
      resetInterim();
      if (L) L.config({ partner: currentLang });
      if (!useMic()) rec && rec.setLang(currentLang);
      if (running) setRunning(true);
    };
  });

  // ---- cách nghe "Micro liên tục": micro điện thoại mở 1 lần suốt buổi (tai nghe giữ chế độ nghe nhạc), Whisper chạy
  // trên máy nhận diện (đo 11/10, 21 câu Hàn giọng thật: base khớp chữ 88% thu sạch / 75% qua micro Bluetooth; tiny 81% / 64%)
  let L = null;
  let Lmodel = '';
  let micInfo = null;
  let hw = null; // { device, f16 } — chọn bộ nhận diện theo máy
  function listener(model) {
    if (L && Lmodel === model) return L;
    Lmodel = model;
    L = createAutoListener({
      mode: 'full',
      model,
      device: hw.device,
      partner: currentLang,
      endSilenceMs: 450, // nói liền (podcast) cũng có quãng ngừng ngắn giữa các câu
      agc: true,
      getStream: async () => {
        micInfo = await openPhoneMic(readPref(MIC_KEY) || '');
        fillMics(micInfo);
        diag(`Hội trường micro: "${micInfo.label}" (${micInfo.auto ? 'tự chọn micro điện thoại' : 'chọn tay'}, tắt xử lý âm thanh → tai nghe giữ chế độ nghe nhạc)`);
        return micInfo.stream;
      },
      onProgress: (pct) => { $('mtgStatus').textContent = `Đang tải bộ nhận diện (chỉ lần đầu, nên dùng Wi-Fi): ${pct}%`; },
      onStage: (st) => diag(`Hội trường nạp xong ${st.name} (${st.ms}ms)`),
      onReady: (i) => diag(`Hội trường Whisper sẵn sàng (whisper-${i.model}, ${i.device}, nạp ${i.loadMs}ms)`),
      onSpeaking: (on) => {
        if (!running) return;
        $('mtgStatus').textContent = on ? `🎤 Đang nghe ${NAMES[currentLang]}…` : `Đang nghe · ${NAMES[currentLang]} · micro: ${micInfo ? micInfo.label : ''}`;
      },
      onSentence: (r) => {
        if (!running) return;
        const rt = r.audioMs ? (r.asrMs / r.audioMs).toFixed(2) : '?';
        stats.asr.push({ audioMs: r.audioMs, asrMs: r.asrMs });
        checkSpeed(r);
        diag(`Whisper ${r.lang} ${Math.round(r.prob * 100)}%${r.redo ? ' (chép lại theo tiếng đối tác)' : ''} · câu ${r.audioMs}ms · xử lý ${r.asrMs}ms (x${rt}${r.early ? ', sớm' : ''}): "${r.text}"`);
        if (r.lang === 'vi') return diag('Hội trường bỏ câu tiếng Việt (giọng đọc của app lọt vào micro, hoặc có người nói tiếng Việt)');
        commit(r.text, 'Whisper');
      },
      onDropped: (r) => diag(`Whisper bỏ: ${r.why} "${r.text || ''}"`),
      onError: (m) => diag('LỖI Whisper (hội trường): ' + m),
    });
    return L;
  }

  // máy xử lý chậm hơn tốc độ nói → bản dịch tụt dần: báo cho người dùng cách xử lý
  const speed = [];
  function checkSpeed(r) {
    if (!r.audioMs) return;
    speed.push(r.asrMs / r.audioMs);
    if (speed.length > 4) speed.shift();
    const avg = speed.reduce((a, b) => a + b, 0) / speed.length;
    if (speed.length >= 3 && avg > 1) {
      const tip = Lmodel === 'base' ? 'Chọn "Bộ nhận diện: Nhanh" để theo kịp.' : 'Máy này quá chậm cho nhận diện trên máy; tắt bớt app khác, cắm sạc.';
      setError($('mtgErr'), `Máy xử lý chậm hơn tốc độ nói (x${avg.toFixed(1)}) — bản dịch sẽ tụt dần. ${tip}`);
    }
  }

  function fillMics(info) {
    const sel = $('mtgMic');
    const cur = readPref(MIC_KEY) || '';
    sel.textContent = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Tự chọn micro điện thoại (khuyên dùng)' + (info.auto ? ` — đang dùng: ${info.label}` : '');
    sel.appendChild(auto);
    for (const d of info.devices) {
      if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || d.deviceId.slice(0, 8);
      sel.appendChild(o);
    }
    sel.value = cur;
  }

  async function startMic() {
    $('mtgToggle').disabled = true;
    $('mtgStatus').textContent = 'Đang chuẩn bị bộ nhận diện…';
    try {
      // Tự chọn theo máy: có WebGPU → base (chính xác); chỉ có CPU → tiny (đo 11/10 trên CPU máy tính: base xử lý 0,4–1,3 lần
      // thời lượng câu — điện thoại chậm hơn nhiều lần → không theo kịp người nói; tiny ~0,5 lần)
      if (!hw) {
        const forced = readPref('audit.mtgDevice.v1'); // 'wasm': ép chạy CPU (test / chẩn đoán)
        hw = forced ? { device: forced, f16: false } : await pickDevice();
        diag(`Hội trường: máy ${hw.device === 'webgpu' ? 'CÓ WebGPU (xử lý bằng card đồ hoạ)' : 'KHÔNG có WebGPU (xử lý bằng CPU, chậm hơn)'}`);
      }
      const pick = $('mtgModel').value;
      const model = pick === 'auto' ? (hw.device === 'webgpu' ? 'base' : 'tiny') : pick;
      const l = listener(model);
      await l.start(); // tạo worker (lần đầu) rồi mới gửi cấu hình — gửi trước thì bị mất
      l.config({ partner: currentLang, muted: false, keepPartner: true, early: hw.device === 'webgpu' });
      speed.length = 0;
      setRunning(true);
      $('mtgStatus').textContent = `Đang nghe · ${NAMES[currentLang]} · micro: ${micInfo ? micInfo.label : ''}`;
    } catch (e) {
      diag('LỖI khởi động micro liên tục: ' + (e && (e.stack || e.message)));
      setError($('mtgErr'), e && e.name === 'NotAllowedError' ? 'Chưa cấp quyền micro.' : 'Không mở được micro liên tục: ' + (e && e.message) + '. Thử chọn micro khác hoặc cách nghe "Chrome".');
      try { L && L.stop(); } catch (_) {}
    } finally {
      $('mtgToggle').disabled = false;
    }
  }

  $('mtgToggle').onclick = () => {
    if (!useMic() && !supported) return setError($('mtgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
    setError($('mtgErr'), '');
    committed = '';
    carry = '';
    clearTimeout(carryTimer);
    clearTimeout(speechEndTimer);
    resetInterim();
    if (running) {
      rec.stop();
      if (L) L.stop();
      sayQueue.length = 0;
      cancel();
      setRunning(false);
    } else {
      startedAt = Date.now();
      if (useMic()) return startMic();
      rec.setLang(currentLang);
      rec.start();
      setRunning(true);
    }
  };

  $('mtgCopy').onclick = () => copyText(logToText(log), $('mtgCopy'));
}
