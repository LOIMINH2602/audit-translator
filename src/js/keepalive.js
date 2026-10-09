// Giữ app nghe được khi audit thật trên Chrome Android.
// 09/10/2026: Lợi Minh gửi ảnh màn 1:1 tắt hẳn với "Chưa cấp quyền micro" giữa buổi, dù micro đã dùng được.
// Mã nguồn Chromium (content/browser/speech/speech_recognition_dispatcher_host.cc, StartRequestOnUI; và
// speech_recognition_manager_impl.cc, OnVisibilityChanged): trên Android, trang bị ẩn (tắt màn hình, chuyển app)
// thì phiên nhận diện bị cắt và mọi start() bị từ chối bằng lỗi 'not-allowed' — cùng mã lỗi với "bị chặn quyền".
// Vì vậy:
//   1. holdScreen(): giữ màn hình sáng trong lúc nghe (Screen Wake Lock), tự xin lại khi trang hiện lại.
//   2. classifyMicError(): 'not-allowed' chỉ là "chặn quyền" khi trang đang hiện VÀ quyền micro thật sự 'denied';
//      trang ẩn → 'hidden' (chờ hiện lại rồi nghe tiếp); còn lại → 'transient' (thử nghe lại).

let lock = null;
const wants = new Set(); // màn nào đang cần giữ màn hình sáng ('dlg', 'mtg', 'field')

async function acquire() {
  if (!wants.size || lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (_) {
    lock = null; // máy tiết kiệm pin / trình duyệt không cho: vẫn chạy, chỉ là màn hình có thể tự tắt
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire(); // khoá màn hình tự nhả khi trang ẩn
});

export function holdScreen(who, on) {
  if (on) wants.add(who);
  else wants.delete(who);
  if (wants.size) acquire();
  else if (lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}

export const screenHeld = () => Boolean(lock);

// Trả về 'denied' | 'hidden' | 'transient' | null (không phải lỗi micro).
export async function classifyMicError(err) {
  if (err !== 'not-allowed' && err !== 'service-not-allowed') return null;
  if (document.visibilityState !== 'visible') return 'hidden';
  if (err === 'service-not-allowed') return 'denied'; // dịch vụ nhận diện của máy bị tắt/không cho dùng
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    if (p.state === 'denied') return 'denied';
  } catch (_) {}
  // trang có thể vừa ẩn rồi hiện lại trước khi lỗi tới nơi
  return 'transient';
}
