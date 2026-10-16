// Màn 2: nghe hội trường — phụ đề dịch real time sang tiếng Việt, CHỈ HIỆN CHỮ (16/10/2026, Lợi Minh chốt: không cần nghe qua
// tai nghe; Anh/Trung/Nhật/Hàn → Việt; mục tiêu độ trễ: chữ ≤ 0,5s, bản dịch tạm ≤ 1s, bản dịch chốt ≤ 1,5s sau khi hết câu).
// Nhận diện của Chrome (Google) vì ra chữ ngay khi người nói đang nói (Whisper chỉ ra chữ sau khi hết câu → không đạt 0,5s).
// Trước đây cách này hỏng vì tai nghe Bluetooth bị chuyển chế độ mỗi lần mở micro; không đọc vào tai nghe thì không còn lỗi đó.
// App tự đo 3 độ trễ trên máy và hiện trên màn hình. Mốc: mức âm lượng micro thật (onset.js — lúc mở miệng / dứt lời); máy không
// cho mở micro song song thì dùng tín hiệu của bộ nhận diện (đến muộn hơn → số đo đẹp hơn thực tế, ghi "ước tính").

import { $, setError, timeNow, copyText, renderLog, logToText } from './ui.js';
import { NAMES } from './config.js';
import { createRecognizer, supported } from './recognizer.js';
import { translate } from './translate.js';
import { parseGlossary, applyGlossary } from './glossary.js';
import { diag } from './diagnostics.js';
import { holdScreen, classifyMicError } from './keepalive.js';
import { summarize } from './meetstats.js';
import { startOnsetMeter } from './onset.js';

const LANG_KEY = 'audit.mtgLang.v1';
const ENGLISH_G = /\b(the|we|will|and|then|of|is|are|with|this|that|our|you|first|finally)\b/gi;
const readPref = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

// Chốt câu: máy báo hết tiếng nói (+ SPEECHEND_GRACE_MS không có chữ mới); hoặc chữ đứng yên STABLE_MS; hoặc nói liền ≥ MAX_MS
// thì cắt ở đuôi câu (tiếng Hàn), ≥ HARD_MAX_MS cắt cứng. Cắt giữa phiên chỉ lấy phần chữ mới, không mở phiên mới (mở phiên mới
// trên Android mất ~0,6s tiếng nói). Đo 11/10 (podcast Hàn giọng thật, giả lập Android): nghe được 79–87%.
const STABLE_MS = 700;
const MAX_MS = 6000;
const HARD_MAX_MS = 9000;
const SPEECHEND_GRACE_MS = 350;
const CARRY_MS = 10000; // mảnh 1 từ chờ ghép vào câu sau
// Bản dịch tạm: dịch khi có từ mới, 1 yêu cầu cùng lúc, cách nhau ≥ PREVIEW_MS (tối đa 2 lần/giây: gọi Google quá dày thì
// Google chặn mạng "automated queries" — đã xảy ra với máy test 16/10). Chỉ dùng Google; lỗi thì nghỉ PREVIEW_BACKOFF_MS để
// dành cho bản dịch chốt (bản chốt vẫn có MyMemory dự phòng).
const PREVIEW_MS = 500;
const PREVIEW_BACKOFF_MS = 5000;
export const TARGET = { text: 500, draft: 1000, final: 1500 };
const ENGLISH_MIX = (out, lang) => lang !== 'en-US' && (out.match(ENGLISH_G) || []).length >= 3;
const spaced = (lang) => !/^(zh|ja)/.test(lang);
const now = () => performance.now();


export function initMeeting() {
  const log = [];
  let running = false;
  let currentLang = NAMES[readPref(LANG_KEY)] ? readPref(LANG_KEY) : 'en-US';

  // ---- đo độ trễ ----
  const lat = { text: [], draft: [], final: [] };
  const stats = { lines: [], lat };
  window.__meeting = { stats, state: () => ({ running, interim }) }; // cho test tự động (tools/e2e/meeting.mjs)
  function record(k, ms) {
    lat[k].push(Math.round(ms));
    if (lat[k].length > 200) lat[k].shift();
    renderLat();
  }
  const sec = (ms) => (ms / 1000).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 's';
  function renderLat() {
    for (const row of document.querySelectorAll('#mtgLat .lat-row')) {
      const k = row.dataset.k;
      const s = summarize(lat[k].slice(-30));
      row.querySelector('b').textContent = s ? `${sec(s.median)} · ${sec(s.p90)}` : '–';
      row.className = 'lat-row' + (s ? (s.median <= TARGET[k] ? ' ok' : ' bad') : '');
    }
  }

  // ---- nhận diện ----
  let committed = ''; // chữ của phiên hiện tại đã chốt → chữ tạm sau đó chỉ lấy phần mới
  let interim = ''; // phần chữ mới chưa chốt
  let rawInterim = '';
  let interimAt = 0; // lần cuối phần mới đổi (≈ lúc nghe ra từ mới nhất)
  let firstAt = 0; // lúc phần mới bắt đầu
  let onsetAt = 0; // bắt đầu có tiếng nói, chưa có chữ
  let meter = null; // bộ đo âm lượng micro (null = máy không cho mở song song → dùng tín hiệu của bộ nhận diện)
  let voiceEndAt = 0; // lúc dứt lời gần nhất (âm lượng)
  // mốc hết câu cho độ trễ chốt: dứt lời thật (âm lượng) nếu có và không muộn hơn lúc chốt, không thì mốc của bộ nhận diện
  const endMark = (fallback) => (meter && voiceEndAt && voiceEndAt <= now() && voiceEndAt > fallback - 3000 ? Math.min(voiceEndAt, fallback) : fallback);
  let speechEndAt = 0;
  const resetInterim = () => { interim = ''; rawInterim = ''; interimAt = 0; firstAt = 0; };

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
    onSpeechStart: () => { if (!meter && !onsetAt) onsetAt = now(); },
    onFinal: (text) => {
      const d = delta(text);
      const end = speechEndAt || interimAt || now();
      committed = '';
      resetInterim();
      if (d) commit(d, 'final', endMark(end));
    },
    // Android chốt câu muộn (~1,5s) rồi mới mở phiên mới: máy báo hết tiếng nói thì chốt chữ tạm luôn, mở phiên mới ngay
    onSpeechEnd: () => {
      speechEndAt = now();
      clearTimeout(speechEndTimer);
      speechEndTimer = setTimeout(() => {
        if (!running || !interim) return;
        const t = interim;
        const end = speechEndAt;
        committed = '';
        resetInterim();
        rec.restart();
        commit(t, 'hết tiếng nói', endMark(end));
      }, SPEECHEND_GRACE_MS);
    },
    onInterim: (text) => {
      clearTimeout(speechEndTimer); // còn chữ mới: người nói chưa dứt
      if (!running) return;
      const t = text.trim();
      const d = delta(t);
      rawInterim = t;
      if (!d || d === interim) return;
      const at = now();
      if (onsetAt) { record('text', at - onsetAt); onsetAt = 0; }
      speechEndAt = 0;
      if (!firstAt) firstAt = at;
      interim = d;
      interimAt = at;
      showLive(d, null);
      preview();
    },
    onError: async (err) => {
      const kind = await classifyMicError(err);
      if (!kind) return diag('LỖI hội-trường: ' + err); // lỗi tạm: recognizer tự khởi động lại
      if (!running) return;
      if (kind === 'denied') {
        setError($('mtgErr'), 'Chưa cấp quyền micro.');
        rec.stop();
        return setRunning(false);
      }
      diag(`Micro bị ngắt (hội-trường: ${err}) — ${kind === 'hidden' ? 'trang đang ẩn, chờ hiện lại' : 'thử nghe lại'}`);
      if (kind === 'transient') setTimeout(() => running && rec.start(), 800);
    },
    onLog: diag,
  });

  // Android ngừng micro khi trang ẩn (keepalive.js): hiện lại thì nghe tiếp
  document.addEventListener('visibilitychange', () => {
    if (!running || document.visibilityState !== 'visible') return;
    diag('Trang hiện lại → nghe lại (hội trường)');
    setError($('mtgErr'), 'App vừa bị ẩn (tắt màn hình hoặc chuyển app) nên Android ngừng micro. Đã nghe lại.');
    rec.start();
  });

  // ---- phụ đề: chữ đang nghe + bản dịch tạm ----
  function showLive(src, out) {
    $('mtgLiveSrc').textContent = src.length > 200 ? '…' + src.slice(-200) : src;
    if (out !== null) $('mtgLiveOut').textContent = out;
  }
  let lastPreview = { src: '', out: '' }; // câu chốt trùng chữ bản dịch tạm vừa xong → dùng luôn, không chờ dịch lại
  let previewBusy = false;
  let previewAt = 0;
  let previewPauseUntil = 0;
  async function preview() {
    if (previewBusy || now() - previewAt < PREVIEW_MS || now() < previewPauseUntil) return;
    const src = interim;
    const srcAt = interimAt;
    if (!src) return;
    previewBusy = true;
    previewAt = now();
    try {
      const r = await translate(src, currentLang, 'vi-VN', { timeoutMs: 2500, only: 'google' });
      lastPreview = { src, out: r.text };
      // vẫn là câu đang nghe (chưa chốt sang câu khác) thì hiện
      if (interim && interim.startsWith(src.slice(0, Math.min(8, src.length)))) {
        showLive(interim, r.text);
        record('draft', now() - srcAt);
      }
    } catch (e) {
      previewPauseUntil = now() + PREVIEW_BACKOFF_MS;
      diag('Hội trường: bản dịch tạm lỗi (' + (e.details || e.message) + ') → nghỉ 5 giây');
    } finally {
      previewBusy = false;
    }
    if (interim && interim !== src) setTimeout(preview, Math.max(0, PREVIEW_MS - (now() - previewAt)));
  }

  setInterval(() => {
    if (!running || !interim) return;
    const t = now();
    if (t - interimAt >= STABLE_MS) return take(interim, 'ngừng nói');
    if (t - firstAt < MAX_MS) return;
    const cut = sentenceCut(interim);
    if (cut) return take(cut, 'hết câu (nói liền)');
    if (t - firstAt >= HARD_MAX_MS) take(dropLastWord(interim), 'nói liền ' + HARD_MAX_MS / 1000 + 's');
  }, 100);

  // chốt `text` (phần đầu của interim); phiên vẫn chạy tiếp: lần sau chỉ lấy phần mới
  function take(text, why) {
    const end = interimAt;
    const rest = interim.slice(text.length).trim();
    if (!rest && why === 'ngừng nói') {
      // người nói đã ngừng, chốt trọn câu: mở phiên mới ngay (đang im lặng nên không mất chữ), không chờ Android tự đóng phiên
      // (~1,5s) rồi mở lại (~0,6s) — test 16/10 giả lập Android: câu ngắn tiếng Trung/Nhật sau đó bị mất đầu (Trung 50%,
      // chữ tiếng Nhật hiện sau 2,4s; Chrome máy tính 93% / 0,9s)
      committed = '';
      resetInterim();
      rec.restart();
      return commit(text, why, endMark(end));
    }
    committed = rest ? rawInterim.slice(0, rawInterim.length - rest.length).trim() : rawInterim;
    interim = rest;
    interimAt = rest ? now() : 0;
    firstAt = rest ? now() : 0;
    commit(text, why, endMark(end));
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

  // ---- dịch chốt: chạy ngay từng câu (song song với việc nghe tiếp), hiện đúng thứ tự ----
  let shown = Promise.resolve();
  let carry = '';
  let carryTimer = null;
  let carryEnd = 0;
  function commit(text, why, endAt) {
    if (carry) {
      text = carry + (spaced(currentLang) ? ' ' : '') + text;
      carry = '';
      clearTimeout(carryTimer);
    }
    // mảnh 1 từ dịch rời thì vô nghĩa → ghép vào câu sau
    const short = spaced(currentLang) ? !/\s/.test(text.trim()) : text.trim().length < 3;
    if (short && why !== 'mảnh ngắn') {
      carry = text;
      carryEnd = endAt;
      carryTimer = setTimeout(() => { if (carry) { const t = carry; carry = ''; commit(t, 'mảnh ngắn', carryEnd); } }, CARRY_MS);
      return;
    }
    diag(`Hội trường chốt câu (${why}): "${text}"`);
    const lang = currentLang;
    const job = text === lastPreview.src && !ENGLISH_MIX(lastPreview.out, lang)
      ? Promise.resolve({ out: applyGlossary(text, lastPreview.out, parseGlossary($('glossary').value)), reused: true })
      : translateOne(text, lang);
    shown = shown.then(async () => {
      const r = await job;
      if (!r || !running) return;
      const ms = now() - endAt;
      record('final', ms);
      log.push({ time: timeNow(), tag: NAMES[lang], src: text, out: r.out, info: `chốt sau ${sec(ms)} · ${why}${r.reused ? ' · dùng bản dịch tạm' : ''}` });
      renderLog($('mtgLog'), log);
      $('mtgCopy').disabled = false;
      stats.lines.push({ src: text, out: r.out, why, finalMs: Math.round(ms) });
      if (!interim) showLive(text, r.out); // đang im lặng: phụ đề giữ câu vừa chốt
    });
  }

  async function translateOne(text, lang) {
    try {
      const r = await translate(text, lang, 'vi-VN');
      // đoạn dài không dấu câu: Google đôi khi trả nửa sau bằng tiếng Anh (đo 11/10) → dịch lại phần đó
      if (ENGLISH_MIX(r.text, lang)) {
        try {
          r.text = (await translate(r.text, 'en-US', 'vi-VN')).text;
          diag('Hội trường: bản dịch lẫn tiếng Anh → dịch lại');
        } catch (_) {}
      }
      return { out: applyGlossary(text, r.text, parseGlossary($('glossary').value)) };
    } catch (e) {
      setError($('mtgErr'), 'Dịch không thành công, bỏ qua câu này.');
      diag('LỖI dịch (hội trường): ' + (e.details || e.message));
      return null;
    }
  }

  function setRunning(on) {
    running = on;
    holdScreen('mtg', on); // màn hình tắt = Android ngừng micro
    $('mtgToggle').textContent = on ? 'Dừng nghe' : 'Bắt đầu nghe';
    $('mtgDot').className = 'dot' + (on ? ' live' : '');
    $('mtgStatus').textContent = on ? 'Đang nghe · ' + NAMES[currentLang] : 'Đang tắt';
  }

  function resetAll() {
    committed = '';
    carry = '';
    onsetAt = 0;
    speechEndAt = 0;
    clearTimeout(carryTimer);
    clearTimeout(speechEndTimer);
    resetInterim();
  }

  const chips = document.querySelectorAll('#meetingLangChips .chip');
  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.lang === currentLang)));
  chips.forEach((chip) => {
    chip.onclick = () => {
      chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      currentLang = chip.dataset.lang;
      writePref(LANG_KEY, currentLang);
      resetAll();
      rec && rec.setLang(currentLang);
      if (running) setRunning(true);
    };
  });

  $('mtgToggle').onclick = () => {
    if (!supported) return setError($('mtgErr'), 'Trình duyệt không hỗ trợ nhận diện giọng nói. Dùng Google Chrome.');
    setError($('mtgErr'), '');
    resetAll();
    if (running) {
      rec.stop();
      if (meter) meter.stop();
      meter = null;
      setRunning(false);
    } else {
      for (const k of Object.keys(lat)) lat[k].length = 0;
      renderLat();
      rec.setLang(currentLang);
      rec.start();
      setRunning(true);
      startMeter();
    }
  };

  async function startMeter() {
    try {
      meter = await startOnsetMeter((ev, t) => {
        if (ev === 'start') { if (!interim || now() - interimAt > 400) onsetAt = t; }
        else voiceEndAt = t;
      });
      diag('Hội trường: đo độ trễ theo âm lượng micro thật');
      $('mtgLatNote').textContent = 'Đo theo âm thanh thật từ micro.';
    } catch (e) {
      meter = null;
      diag('Hội trường: không mở được micro song song để đo (' + (e && e.name) + ') → dùng tín hiệu của bộ nhận diện');
      $('mtgLatNote').textContent = 'Ước tính (máy không cho mở micro song song): độ trễ thật có thể cao hơn ~0,3–0,8 giây.';
    }
  }

  $('mtgCopy').onclick = () => copyText(logToText(log), $('mtgCopy'));
}
