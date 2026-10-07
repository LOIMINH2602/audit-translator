---
name: ban-giao-ai
description: Bàn giao từ Cowork sang Claude Code (Antigravity) để build/deploy app Phiên Dịch Audit. Đọc trước khi code.
---

# Bàn giao: App Phiên Dịch Audit

## Mục tiêu
App web cá nhân (Lợi Minh dùng, không bán) chạy trên điện thoại Android (Chrome/Google Play có sẵn),
nghe liên tục và dịch audit nhà máy với đối tác nước ngoài, phát ra tai nghe Bluetooth (Huawei FreeArc).

## 2 use case bắt buộc
1. **Đối thoại 1:1, chia sẻ tai nghe** — Lợi Minh và đối tác đeo chung 1 tai nghe. App phải **tự nhận diện
   ai đang nói** (không có nút bấm chuyển chiều — đã bỏ theo yêu cầu khách), dịch 2 chiều Việt ⇄ ngoại ngữ,
   đọc to bản dịch ra tai nghe.
2. **Nghe hội trường/họp nhiều người** — nhiều đối tác nói các tiếng khác nhau (Anh/Trung/Nhật/Hàn xen nhau).
   Mục đích chỉ để **nghe hiểu**, không cần dịch ngược lại. Người dùng chạm chọn ngôn ngữ hiện tại đang nghe
   (vì Web Speech API không tự nhận diện được giữa nhiều ngoại ngữ cùng lúc — chỉ auto giữa Việt/1 ngoại ngữ
   khả thi, xem phần kỹ thuật dưới).

Ngôn ngữ đối tác cần hỗ trợ: **Anh, Trung, Nhật, Hàn**.

## Đã quyết (không hỏi lại trừ khi có lý do kỹ thuật mới)
- Nền tảng: web app thuần (HTML/CSS/JS), không build step, để dễ deploy tĩnh.
- Nhận diện giọng nói: Web Speech API (`webkitSpeechRecognition`), continuous + interim, tự restart khi
  trình duyệt dừng do im lặng. **Không** dùng artifact Claude (sandbox chặn micro hoàn toàn — đã xác nhận).
- Dịch: dùng dịch vụ **miễn phí** (MyMemory API, dự phòng Google Translate endpoint không chính thức) —
  khách đã từ chối trả phí Claude API. **Giới hạn đã biết:** không ép được thuật ngữ ngành chính xác như
  gọi LLM có prompt glossary; đã có bảng thuật ngữ ngành chèn chú giải kiểu "[en = vi]" khi phát hiện từ gốc,
  đây là giải pháp tạm, không phải dịch đúng nghĩa.
- Nhận diện ai đang nói (case 1): chạy **2 recognizer song song** (1 lang=tiếng đối tác, 1 lang=vi-VN) trên
  cùng mic. Bên nào có kết quả final trước thì xử lý, bên kia bị khoá 1.5s để không xử lý trùng câu vừa nói
  (coi là "vọng"). Khi app đang đọc TTS, tạm dừng cả 2 recognizer để tránh mic tự nghe lại chính nó.
  **Đây là giải pháp chưa kiểm chứng thực tế** — Lợi Minh sẽ test và báo lại độ chính xác nhận diện.
  Nếu tệ, hướng thay thế: so sánh `confidence` của cả 2 bên trước khi quyết định, hoặc thêm độ trễ ngắn
  (~300-500ms) để chờ cả 2 bên trả kết quả rồi chọn bên tốt hơn.
- Cài đặt trên điện thoại: **không đóng gói APK** — WebView (nền của APK) không hỗ trợ Web Speech API,
  sẽ làm chết tính năng lõi. Dùng PWA "Thêm vào màn hình chính" từ Chrome thay thế (đã có `manifest.webmanifest`
  + icon trong `prototype/`).
- Deploy: cần hosting HTTPS thật (artifact/localhost không đủ cho Web Speech API liên tục trên điện thoại
  qua link chia sẻ). Phiên Cowork trước đã đề xuất Netlify Drop (không cần tài khoản), nhưng giờ việc deploy
  thuộc về Claude Code + Antigravity — có thể làm sạch hơn: GitHub Pages hoặc Vercel/Netlify qua CLI, dùng tài
  khoản GitHub thật của Lợi Minh (đã xác nhận có tài khoản GitHub kết nối: `LOIMINH260285`).

## Đã có sẵn (file khởi điểm, KHÔNG phải bản hoàn chỉnh)
`prototype/index.html` — bản nháp đầy đủ 2 màn hình (tab Đối thoại 1:1 / Nghe hội trường), đã implement:
- Dual-recognizer auto-detect cho case 1 (chưa test thật)
- Single-recognizer + chip chọn ngôn ngữ cho case 2
- Dịch MyMemory + fallback Google, TTS qua `speechSynthesis`
- Bảng thuật ngữ ngành (textarea sửa được), biên bản song ngữ có giờ + copy
- Theme sáng/tối theo `prefers-color-scheme`
`prototype/manifest.webmanifest` + `prototype/icon-192.png` + `prototype/icon-512.png` — cho PWA install.

**Chưa test được gì** từ môi trường Cowork (mạng ra ngoài bị chặn, không gọi được MyMemory/Google để kiểm
tra response thật). Claude Code cần tự verify toàn bộ luồng dịch + nhận diện giọng nói trên máy thật.

## Việc cần làm
1. `git init`, dọn `prototype/` thành cấu trúc project thật (tách CSS/JS nếu cần, thêm `README.md`).
2. Test thật trên Chrome Android: độ chính xác dual-recognizer case 1, độ trễ, chất lượng giọng TTS
   cho vi/en/zh/ja/ko (nhiều máy Android thiếu giọng tiếng Việt/Trung/Nhật tốt — kiểm tra và báo nếu
   cần fallback).
3. Deploy lên hosting HTTPS thật (gợi ý GitHub Pages dùng tài khoản `LOIMINH260285`, hoặc Vercel/Netlify
   qua CLI nếu Lợi Minh đăng nhập). Trả về 1 link cố định.
4. Hướng dẫn Lợi Minh "Thêm vào màn hình chính" trên Chrome.
5. Sau khi có phản hồi thật từ Lợi Minh (độ chính xác nhận diện người nói, lỗi dịch, giọng đọc) → sửa lặp.
6. Cân nhắc sau (không làm ngay trừ khi được yêu cầu): nếu Lợi Minh sau này đồng ý trả phí, thay dịch miễn
   phí bằng Claude API để ép đúng thuật ngữ ngành ISO/FSC/BRC — khi đó cần thêm 1 backend nhỏ (serverless)
   giữ API key phía server, không để lộ key trong code client.

## Không được làm
- Không đóng gói APK/WebView (lý do: mất Web Speech API).
- Không đưa code vào `PROJECTS/audit-translator/` — chỉ `PROJECT.md` trỏ tới đây (`CODE/audit-translator/`).
- Không ghi đè `prototype/` — giữ lại làm tham chiếu, code thật để ở thư mục gốc project này (ví dụ `src/`).
