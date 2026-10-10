import { $ } from './ui.js';
import { supported } from './recognizer.js';
import { initDiagnostics } from './diagnostics.js';
import { initDialogue } from './dialogue.js';
import { initMeeting } from './meeting.js';
import { initSelfTest } from './selftest.js';
import { initFieldTest } from './fieldtest.js';
import { initConcurrentTest } from './concurrent.js';
import { isInAppBrowser } from './env.js';
import { APP_VERSION } from './config.js';

const inAppBrowser = isInAppBrowser();
if (!supported || inAppBrowser) {
  $('browserWarn').textContent = inAppBrowser
    ? 'Bạn đang mở trong trình duyệt của app khác (Zalo, Facebook...). Giọng đọc và nhận diện sẽ không hoạt động đúng. Sao chép link rồi dán vào Google Chrome.'
    : 'Trình duyệt này không hỗ trợ nhận diện giọng nói liên tục. Hãy mở trang bằng Google Chrome.';
  $('browserWarn').hidden = false;
}

const TABS = { dlg: ['tabDialogue', 'screenDialogue'], mtg: ['tabMeeting', 'screenMeeting'], test: ['tabTest', 'screenTest'] };
function selectTab(which) {
  for (const [key, [tab, screen]] of Object.entries(TABS)) {
    $(tab).setAttribute('aria-selected', key === which);
    $(screen).classList.toggle('active', key === which);
  }
}
$('tabDialogue').onclick = () => selectTab('dlg');
$('tabMeeting').onclick = () => selectTab('mtg');
$('tabTest').onclick = () => selectTab('test');

$('appVersion').textContent = 'Bản ' + APP_VERSION;
initDiagnostics();
// trạng thái màn 1:1 cho test tự động (tools/e2e) đọc
window.__dialogue = initDialogue();
initMeeting();
initSelfTest();
initFieldTest();
initConcurrentTest();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
