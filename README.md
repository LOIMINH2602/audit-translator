# Phiên Dịch Audit

App web cá nhân cho Lợi Minh: nghe liên tục và dịch khi audit nhà máy với đối tác nước ngoài, phát bản dịch ra tai nghe Bluetooth. Chạy trên Chrome Android, cài như app qua "Thêm vào màn hình chính" (PWA). Không bán, không phân phối.

## Hai chế độ

| Màn | Dùng khi | Cách hoạt động |
|---|---|---|
| Đối thoại 1:1 | Hai người dùng chung 1 tai nghe | 2 recognizer chạy song song trên cùng mic (tiếng đối tác + tiếng Việt). Tự nhận ai đang nói, dịch sang tiếng còn lại, đọc to bản dịch. |
| Nghe hội trường | Nhiều người nói Anh/Trung/Nhật/Hàn xen nhau | 1 recognizer, người dùng chạm chọn tiếng đang nghe. Chỉ dịch sang tiếng Việt, đọc to nếu bật. |

Ngôn ngữ đối tác: Anh, Trung (giản thể), Nhật, Hàn.

## Cấu trúc

```
src/                  site tĩnh, đây là thứ được deploy
  index.html
  css/app.css
  js/
    main.js           khởi tạo, chuyển tab, đăng ký service worker
    dialogue.js       màn 1:1
    meeting.js        màn hội trường
    recognizer.js     bọc Web Speech API, tự restart, báo khi bị ngắt liên tục
    arbiter.js        phân xử kết quả của 2 recognizer (nhanh / so confidence)
    translate.js      Google, dự phòng MyMemory
    tts.js            speechSynthesis, chọn giọng theo ngôn ngữ
    glossary.js       bảng thuật ngữ ngành
    diagnostics.js    nhật ký + danh sách giọng + đọc thử
    ui.js, config.js
  sw.js               service worker (network-first)
  manifest.webmanifest, icon-*.png
tests/                test logic (glossary, arbiter) bằng node:test
tools/serve.mjs       server tĩnh để chạy thử ở máy tính
prototype/            bản nháp gốc từ Cowork, giữ làm tham chiếu, không sửa
BAN-GIAO-AI.md        bàn giao kỹ thuật và các quyết định đã chốt
.github/workflows/    tự deploy `src/` lên GitHub Pages khi push vào main
```

Không có bước build. Mã nguồn chạy thẳng trên trình duyệt dưới dạng ES module.

## Chạy thử ở máy tính

```
npm start        # http://localhost:8080
npm test         # test logic
```

`localhost` được coi là secure context nên micro dùng được. Mở bằng `file://` sẽ không chạy vì ES module.

## Deploy

Push vào nhánh `main`, workflow `pages.yml` tự đăng `src/` lên GitHub Pages (HTTPS). Cần bật Pages với nguồn "GitHub Actions" ở Settings → Pages của repo.

## Ràng buộc đã chốt

- Không đóng gói APK/WebView: WebView không có Web Speech API.
- Dịch miễn phí: Google endpoint không chính thức trước, MyMemory dự phòng (đổi thứ tự 07/10/2026 vì MyMemory chèn chữ thừa ở chiều Việt→Nhật/Trung). Chưa dùng Claude API trả phí.
- Chỉ Chrome Android/desktop. Safari/Firefox không hỗ trợ nhận diện giọng nói liên tục.

## Cài lên điện thoại

1. Mở link deploy bằng **Chrome** trên Android (không dùng trình duyệt trong app khác).
2. Menu ⋮ → **Thêm vào màn hình chính** (hoặc **Cài đặt ứng dụng**) → Cài đặt.
3. Mở app từ icon vừa tạo. Lần đầu bấm "Bắt đầu nghe" và chọn **Cho phép** micro.
4. Ghép tai nghe Bluetooth trước khi mở app để âm thanh ra đúng thiết bị.

## Test thật trên điện thoại

Dùng tab **Tự kiểm tra** (tab thứ 3). Bấm 1 nút, app tự chạy và tự chấm:

1. Môi trường: có đang ở Chrome thật không (loại trừ Zalo/Facebook/WebView), quyền micro, HTTPS.
2. Mở 2 recognizer cùng lúc 4 giây, kiểm tra cả hai có sống không, phân loại lỗi (audio-capture, network, language-not-supported).
3. Dịch 8 chiều Anh/Trung/Nhật/Hàn ⇄ Việt.
4. Đọc thử giọng 5 tiếng, người dùng bấm "nghe rõ / sai / không nghe".
5. Đọc to 6 câu mẫu: app biết câu đúng nên tự tính bên nào nghe đúng và chế độ phân xử "Nhanh" / "Tin cậy" chọn đúng bao nhiêu câu.

Kết quả là báo cáo tiếng Việt có mục "Vấn đề phát hiện" kèm cách xử lý, nút **Gửi báo cáo** (chia sẻ qua Zalo/Messenger) và **Sao chép**. Logic chấm điểm nằm ở `src/js/scoring.js`, có test trong `tests/scoring.test.js`.

Mục **Chẩn đoán & cài đặt thử nghiệm** cuối trang vẫn còn cho việc soi chi tiết: nhật ký từng sự kiện, đọc thử từng giọng, nút Thử dịch, đổi chế độ phân xử.

Rủi ro đã biết: Chrome Android có thể không cho 2 recognizer chạy cùng lúc. Nếu một bên bị ngắt liên tục, báo cáo sẽ nêu rõ.
