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

## Trạng thái cập nhật 07/10/2026 (Claude Code)
- Đã làm: `git init`, dựng `src/` (module hoá), README, test logic (`npm test`), mục "Chẩn đoán" trong app, push repo, bật GitHub Pages.
- **Link cố định:** https://loiminh2602.github.io/audit-translator/ (repo `LOIMINH2602/audit-translator`, public; push vào `main` là tự deploy).
- **Đổi so với bàn giao gốc:** thứ tự dịch là Google trước, MyMemory dự phòng (Lợi Minh chốt 07/10 vì MyMemory chèn chữ thừa chiều Việt→Nhật/Trung). Tài khoản GitHub thực dùng là `LOIMINH2602` (bàn giao ghi `LOIMINH260285`).
- **Chưa làm được:** test thật trên Chrome Android (nhận diện người nói, độ trễ TTS, chất lượng giọng) — cần Lợi Minh test bằng mục Chẩn đoán rồi gửi nhật ký.
- Rủi ro cần xem khi test: Chrome Android có thể không cho 2 recognizer chạy song song (nhật ký sẽ có `CẢNH BÁO: bị ngắt liên tục`). Mic có thể nghe lại TTS ở màn Hội trường vì không tạm dừng recognizer khi đọc (FreeArc là tai nghe hở).

## Trạng thái cập nhật 08/10/2026 (Claude Code) — sửa lỗi "không dịch qua lại được"
- **Nguyên nhân gốc (đã đo trên Chrome thật):** Chrome chỉ cho 1 phiên nhận diện tự giữ micro; bật recognizer thứ 2 thì recognizer đầu bị huỷ (`aborted`). App cũ bỏ qua lỗi `aborted` và tự khởi động lại nên 2 recognizer huỷ nhau liên tục, không bên nào nghe trọn 1 câu → màn 1:1 không dịch được. Giả định "2 recognizer song song trên cùng mic" trong bàn giao gốc là sai.
- Cũng đã đo: confidence của Chrome ~0,95 cả khi nhận diện sai tiếng → chế độ "So độ tin cậy" cũ vô dụng, đã bỏ.
- **Sửa:** bấm Bắt đầu thì app dò 1,5 giây (`probeParallel`). Máy cho 2 recognizer nhận chung 1 track micro (`start(track)`) → chế độ song song; không cho → chế độ luân phiên (nghe bên đến lượt, tự chuyển bên, tự phát hiện nói nhầm lượt, chạm ô "Đang nghe" để đổi). Chi tiết + bảng kết quả test: README mục "Màn 1:1 nhận người nói thế nào".
- **Đổi so với quyết định cũ "không có nút chuyển chiều":** ở chế độ luân phiên có ô "Đang nghe: … — chạm để đổi". Không phải nút chọn chiều cho mỗi câu (app vẫn tự chuyển), chỉ để sửa khi app đoán sai lượt — nếu thiếu, 1 lần đoán sai sẽ làm lệch mọi câu sau. Cần Lợi Minh xác nhận giữ.
- Màn Hội trường: tạm dừng mic khi đọc bản dịch (trước đây không dừng → mic nghe lại bản dịch tiếng Việt rồi dịch tiếp). Lỗi tạm (network…) không còn làm UI báo "Đang tắt" trong khi recognizer vẫn chạy.
- Đã test đầu-cuối trên Chrome desktop 154 bằng micro giả (`tools/e2e/run.mjs`), cả chế độ song song và giả lập Android, 4 tiếng. Tab Tự kiểm tra và màn Hội trường cũng đã chạy thử trọn vẹn.
- **Chưa kiểm chứng được:** Chrome Android thật có hỗ trợ `start(track)` không (nếu có → điện thoại chạy chế độ song song, tốt hơn); độ chính xác với giọng người thật (test dùng giọng Google TTS); chất lượng giọng đọc trên điện thoại. Tab Tự kiểm tra trên điện thoại sẽ báo máy chạy chế độ nào và tỷ lệ đúng.
- Giới hạn đã biết: 1 người nói 2 câu liền bằng tiếng Trung/Nhật/Hàn có thể bị dịch nhầm bên (rác của recognizer sai tiếng trông hợp lệ); chế độ luân phiên mất câu nói nhầm lượt (app mời nói lại).

## Trạng thái cập nhật 08/10/2026 chiều — phản hồi test thật trên điện thoại (bản 2026-10-08.2)
- **Lợi Minh báo:** điện thoại chạy chế độ luân phiên (Android không cho song song), dịch chậm, app không tự chuyển lượt.
- **Tái hiện được bằng giả lập Android mới trong `tools/e2e/fakemic.js`** (TTS không bắn `onend`, phiên nhận diện khởi động ~600ms và treo nếu bị huỷ lúc đang khởi động, người kia trả lời ngay khi nghe xong bản dịch): bản 2026-10-08.1 chỉ đúng 3/8 câu tiếng Anh.
- **Nguyên nhân chính:** Chrome Android không báo TTS đọc xong → app giữ mic tắt tới hết thời gian dự phòng (≥5 giây) → câu trả lời của người kia rơi vào lúc mic tắt, mất trắng → app vẫn đứng ở lượt cũ, câu sau bị nghe bằng sai tiếng ("không tự chuyển lượt").
- **Sửa:** dò `speechSynthesis.speaking` để biết đọc xong trong ~100ms; mở mic ngay, đuôi bản dịch lọt vào mic được lọc bằng `isEcho`; tắt mic ngay khi bắt đầu xử lý câu; mỗi phiên nhận diện dùng đối tượng mới + watchdog 2,5 giây (phiên treo tự thay); ô lượt chỉ hiện "🎤 Mời … nói" khi mic đã thật sự nghe.
- Kết quả giả lập Android sau sửa: Anh 8/8, Trung 7/8, Nhật 7/8, Hàn 7/8 (sai còn lại đều là 1 người nói 2 câu liền). Song song không đổi.
- Biên bản mỗi câu ghi thời gian từng bước: `chờ câu` (dứt lời → có câu), `dịch`, `TTS +` (độ trễ bắt đầu đọc), `đọc Xs (onend|dò|hết giờ)`, `mic +` (đọc xong → mic nghe lại). Nút **Gửi nhật ký** ở màn 1:1 gửi nhật ký qua Zalo.
- Đã thử và bỏ: "chốt câu sớm" khi chữ tạm đứng yên 0,9s — làm app chốt giữa câu với chuỗi rác của recognizer sai tiếng, phá phát hiện nhầm lượt.
- Chưa kiểm chứng trên máy thật: giả thuyết phiên treo, thời gian khởi động phiên thật của Android (xem `mic +` trong biên bản).
