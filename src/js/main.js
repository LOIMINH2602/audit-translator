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
// Mỗi màn khởi động riêng: 1 màn lỗi không làm hỏng màn khác. Lỗi thường gặp: vừa cập nhật bản mới, máy chủ GitHub còn lưu tạm
// file cũ (tối đa 10 phút) → giao diện mới + mã cũ không khớp (test 16/10: màn Hội trường ra 0 câu ngay sau khi cập nhật).
const STALE = 'App vừa được cập nhật, máy đang nhận lẫn bản cũ và bản mới. Đóng hẳn app, chờ khoảng 10 phút rồi mở lại.';
function safe(name, fn) {
  try {
    return fn();
  } catch (e) {
    console.error(name, e);
    $('browserWarn').textContent = STALE + ' (lỗi ở ' + name + ': ' + (e && e.message) + ')';
    $('browserWarn').hidden = false;
  }
}
safe('Chẩn đoán', initDiagnostics);
// trạng thái màn 1:1 cho test tự động (tools/e2e) đọc
window.__dialogue = safe('Đối thoại 1:1', initDialogue);
safe('Hội trường', initMeeting);
safe('Tự kiểm tra', initSelfTest);
safe('Đo tai nghe', initFieldTest);
safe('Thử nghe song song', initConcurrentTest);
window.__appReady = APP_VERSION;
// 11/10: Lợi Minh dừng phát triển 1:1, chỉ dùng Nghe hội trường → mở app vào thẳng màn này
selectTab('mtg');

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
