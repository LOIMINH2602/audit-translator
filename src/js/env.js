// Trình duyệt nhúng trong app khác (Zalo, Facebook...) hoặc WebView: thiếu giọng đọc, nhận diện không ổn định,
// không cài PWA được. Chrome thật trên Android không có "Version/x" trong UA; WebView thì có.
export function isInAppBrowser(ua = navigator.userAgent) {
  return /; wv\)|Zalo|FBAN|FBAV|Instagram|Line\//.test(ua) || (/Android/.test(ua) && /Version\/[\d.]+ Chrome/.test(ua));
}
