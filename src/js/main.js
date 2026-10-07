import { $ } from './ui.js';
import { supported } from './recognizer.js';
import { initDiagnostics } from './diagnostics.js';
import { initDialogue } from './dialogue.js';
import { initMeeting } from './meeting.js';

// Trình duyệt nhúng trong app khác (Zalo, Facebook...) hoặc WebView: thiếu giọng đọc, nhận diện không ổn định, không cài PWA được.
// Chrome thật trên Android không có "Version/x" trong UA; WebView thì có.
const inAppBrowser = /; wv\)|Zalo|FBAN|FBAV|Instagram|Line\//.test(navigator.userAgent) ||
  (/Android/.test(navigator.userAgent) && /Version\/[\d.]+ Chrome/.test(navigator.userAgent));
if (!supported || inAppBrowser) {
  $('browserWarn').textContent = inAppBrowser
    ? 'Bạn đang mở trong trình duyệt của app khác (Zalo, Facebook...). Giọng đọc và nhận diện sẽ không hoạt động đúng. Sao chép link rồi dán vào Google Chrome.'
    : 'Trình duyệt này không hỗ trợ nhận diện giọng nói liên tục. Hãy mở trang bằng Google Chrome.';
  $('browserWarn').hidden = false;
}

function selectTab(which) {
  $('tabDialogue').setAttribute('aria-selected', which === 'dlg');
  $('tabMeeting').setAttribute('aria-selected', which === 'mtg');
  $('screenDialogue').classList.toggle('active', which === 'dlg');
  $('screenMeeting').classList.toggle('active', which === 'mtg');
}
$('tabDialogue').onclick = () => selectTab('dlg');
$('tabMeeting').onclick = () => selectTab('mtg');

initDiagnostics();
initDialogue();
initMeeting();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
