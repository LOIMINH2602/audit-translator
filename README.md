# Phiên Dịch Audit

App web cá nhân cho Lợi Minh: nghe người nói tiếng **Hàn, Nhật, Trung hoặc Anh** và hiện bản dịch **tiếng Việt** trên màn hình điện thoại. Chỉ dịch 1 chiều, chỉ hiện chữ (không đọc to). Chạy trên Chrome Android, cài như app qua "Thêm vào màn hình chính".

Link: https://loiminh2602.github.io/audit-translator/

Làm lại từ đầu ngày 01/11/2026. App cũ (đối thoại 1:1, đọc vào tai nghe, Whisper, đo tai nghe) ở thẻ Git `legacy-2026-11-01` và `Claude_Workspace/ARCHIVE/_backup-2026-11-01/audit-translator-app-cu/`.

## Cách hoạt động

1. Bộ nhận diện giọng nói của Chrome (Google) nghe tiếng đã chọn, ra chữ ngay khi người ta đang nói.
2. Chữ đang nghe được dịch tạm (tối đa 2 lần/giây) và hiện ở khung lớn.
3. Người nói ngừng (hoặc nói liền quá 6–9 giây) thì app chốt câu, dịch chốt, đưa vào danh sách "Đã dịch".
4. Nghe 6 giây mà không ra chữ: app tự báo trên màn hình đang kẹt ở đâu (micro bị chặn, app khác giữ micro, mất mạng, không nghe thấy tiếng, sai tiếng).

**Quy tắc quan trọng:** app không được mở thêm micro (`getUserMedia`). Bộ nhận diện của Chrome phải là thứ duy nhất dùng micro. Trên điện thoại, mở thêm micro song song làm bộ nhận diện chỉ nhận im lặng (lỗi thật 01/11/2026).

## Cấu trúc

```
src/
  index.html, css/app.css, manifest.webmanifest, icon-*.png
  sw.js              service worker tối thiểu (không lưu tạm; xoá bộ nhớ đệm của bản cũ)
  js/app.js          giao diện, luồng chốt câu, dịch, tự chẩn đoán
  js/listener.js     bọc SpeechRecognition: tự mở phiên mới, chống phiên treo
  js/segment.js      cắt chữ thành câu (thuần, có test)
  js/translate.js    Google dịch, dự phòng MyMemory
tests/segment.test.js
tools/
  serve.mjs          server tĩnh chạy thử ở máy tính
  bump.mjs           đổi số phiên bản (cả ?v= trong index.html và import)
  e2e/live.mjs       test đầu-cuối: giọng thật → nhận diện Google thật → app
  e2e/chrome.mjs, fakemic.js, similarity.mjs
  whisper/fetch-real.mjs   tải bộ giọng người thật dùng cho test (tên thư mục giữ từ bản cũ)
```

## Lệnh

```
npm start                          # http://localhost:8080
npm test                           # test logic cắt câu
npm run bump 2026-11-02.1          # đổi phiên bản trước khi deploy
node tools/e2e/live.mjs ko 10      # test đầu-cuối (ko|en|zh|ja); xem đầu file để biết biến môi trường
```

Deploy: push vào `main` → GitHub Pages tự đăng `src/`. Máy chủ lưu tạm 10 phút: test link thật sau khi deploy ≥ 10 phút.

## Ràng buộc đã chốt

- Web app, không đóng gói APK (WebView không có nhận diện giọng nói).
- Dịch miễn phí (Google không chính thức, dự phòng MyMemory). Gọi Google quá dày thì bị chặn tạm thời.
- Chỉ Google Chrome. Mở trong Zalo/Facebook thì app báo và không chạy đúng.
