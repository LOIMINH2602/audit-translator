// Service worker tối thiểu (để "Thêm vào màn hình chính" như app). Không lưu tạm gì: luôn lấy bản mới từ mạng,
// và xoá bộ nhớ đệm của các bản cũ (bản cũ có lưu tạm → máy có thể chạy lẫn file cũ / mới).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', () => {});
