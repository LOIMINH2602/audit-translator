// Mục "Chẩn đoán": nhật ký sự kiện nhận diện/dịch/TTS, danh sách giọng đọc có trên máy,
// nút đọc thử từng tiếng. Phục vụ test thật trên Chrome Android — bấm "Sao chép nhật ký" rồi gửi lại.

import { $, copyText, timeNow } from './ui.js';
import { NAMES, SAMPLES } from './config.js';
import { pickVoice, voices, onVoicesChanged, speak, supported as ttsSupported } from './tts.js';

const lines = [];
const MAX_LINES = 300;

export function diag(msg) {
  lines.push(`${timeNow()} ${msg}`);
  if (lines.length > MAX_LINES) lines.shift();
  const box = $('diagLog');
  if (box) {
    box.textContent = lines.slice(-60).join('\n');
    box.scrollTop = box.scrollHeight;
  }
}

function renderVoices() {
  const box = $('diagVoices');
  box.textContent = '';
  if (!ttsSupported) {
    box.textContent = 'Trình duyệt không có speechSynthesis.';
    return;
  }
  for (const lang of Object.keys(NAMES)) {
    const v = pickVoice(lang);
    const row = document.createElement('div');
    row.className = 'voice-row';
    const label = document.createElement('span');
    label.textContent = `${NAMES[lang]} (${lang}): ` + (v ? `${v.name} [${v.lang}]${v.localService ? ' · offline' : ''}` : 'THIẾU GIỌNG');
    if (!v) label.className = 'missing';
    const btn = document.createElement('button');
    btn.className = 'ghost small';
    btn.textContent = 'Đọc thử';
    btn.onclick = () => {
      diag(`TTS thử ${lang} voice=${v ? v.name : 'mặc định'}`);
      speak(SAMPLES[lang], lang, { onStart: (ms) => diag(`TTS ${lang} bắt đầu sau ${ms}ms`) });
    };
    row.append(label, btn);
    box.appendChild(row);
  }
  diag(`Số giọng đọc có trên máy: ${voices().length}`);
}

export function initDiagnostics() {
  renderVoices();
  onVoicesChanged(renderVoices);
  diag('UA: ' + navigator.userAgent);
  $('diagCopy').onclick = () => copyText(lines.join('\n'), $('diagCopy'));
}
