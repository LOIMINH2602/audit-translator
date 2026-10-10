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

## Cập nhật 08/10/2026 tối — "tốc độ dịch rất chậm" (bản 2026-10-08.3)
- Chưa có nhật ký thật từ điện thoại; sửa các điểm chậm đã biết của Chrome Android, đo bằng giả lập (final đến muộn 1,5 giây như Android):
  - **Chốt câu theo `speechend`**: máy báo hết tiếng nói mà 350ms chưa có final thì dùng chữ tạm. Từ dứt lời tới bản dịch hiện ra: 1,68s → 0,34s (tiếng Anh). Không chốt giữa câu như cách "chữ đứng yên" đã bỏ.
  - Nhớ kết quả dò song song (localStorage `audit.parallel.v1`): Android không còn mất ~2 giây dò mỗi lần bấm Bắt đầu.
  - Tốc độ đọc bản dịch chọn được (Bình thường / Nhanh 1,2× mặc định / Rất nhanh), nhớ theo máy.
  - Preconnect tới Google/MyMemory; Google quá 3,5s thì chuyển thẳng MyMemory (trước: dự phòng thử lại Google lần 2).
- Giả lập Android sau sửa: Anh 8/8, Nhật 8/8, Trung 7/8, Hàn 7/8. Song song không đổi.
- Muốn đổi máy về dò lại song song: xoá dữ liệu trang (hoặc localStorage `audit.parallel.v1`).

## Cập nhật 08/10/2026 tối — "chiều Việt → tiếng nước ngoài rất chậm" (bản 2026-10-08.4)
- **Loại trừ bằng số đo:** dịch Google 2 chiều như nhau (~105–115ms trung vị, 10 lần mỗi chiều × 4 tiếng). Nhận diện: đã xác nhận trong mã nguồn Chromium (SpeechRecognitionImpl.java + Blink) Android có bắn `speechend` khi continuous=false → bản chốt câu theo speechend có tác dụng trên điện thoại.
- **Nguyên nhân (mã nguồn Chromium TtsPlatformImpl.java):** Chrome Android gọi `TextToSpeech.setLanguage()` mỗi khi câu đọc đổi tiếng so với câu trước — hội thoại 1:1 đổi tiếng ở mọi câu; giọng nước ngoài chưa tải về máy thì Google TTS tổng hợp qua mạng → chậm. Giọng Việt có sẵn trên máy tiếng Việt → chiều ngược lại nhanh. Khớp đúng triệu chứng. (Giả thuyết "chọn nhầm giọng mạng" đã kiểm và bác: Chrome Android chỉ liệt kê 1 giọng/locale.)
- **Sửa — giọng đọc tự chọn (tts.js):** chế độ Tự động: bấm Bắt đầu thì đọc thử không tiếng (volume 0) giọng máy tiếng đối tác, chưa bắt đầu sau 0,9s → dùng **file đọc của Google Dịch** (translate_tts qua `<audio>`, bắt đầu sau ~0,2–0,5s); mỗi câu thật cũng đo lại. Google lỗi → giọng máy, 5 phút không thử lại Google (tránh lặp chịu cả 2 lần chờ). Trang ẩn (tắt màn hình) → giọng máy luôn (Chrome không tải `<audio>` khi trang ẩn). Câu > 180 ký tự cắt đoạn, tải trước đoạn sau. Chọn tay được: Tự động / Giọng máy / Giọng Google.
- **Bắt buộc:** `<meta name="referrer" content="no-referrer">` ở index.html — Google trả 404 cho translate_tts nếu có Referer (đã đo).
- Chế độ song song: bên sai tiếng nghe dở rồi kết thúc không ra chữ thì báo arbiter ngay (trước: chờ tới maxMs 3s → chiều Việt chậm 2,6s; nay ~0,6–1,1s).
- Tab Tự kiểm tra đọc thử không tiếng trước rồi mới đo → báo đúng giọng sẽ dùng; giọng bắt đầu > 1,5s thì nêu thành vấn đề kèm cách xử lý.
- **Giả lập Android (giọng máy nước ngoài chậm 2,5s):** bản .3 Việt→ngoại 3,3s / ngoại→Việt 0,5s; bản .4: Anh 0,45s, Trung 0,62s, Nhật 0,66s, Hàn 0,61s (cả 2 chiều cân bằng), đúng 6–8/8 (sai còn lại = 1 người nói 2 câu liền). Đã test: giọng máy nhanh (giữ giọng máy), Google bị chặn (về giọng máy, không lặp), trang ẩn, câu dài 386 ký tự (3 đoạn), tốc độ đọc 1,4× có hiệu lực, Tự kiểm tra, Hội trường.
- e2e: harness phải chạy Chrome với `--disable-features=CalculateNativeWinOcclusion` (cửa sổ bị che → trang hidden → `<audio>` không tải). `SLOW_TTS`, `BLOCK_GTTS` để test các nhánh.
- Chưa kiểm chứng trên điện thoại thật: độ trễ thật của giọng máy nước ngoài trên máy Lợi Minh (biên bản ghi `TTS +…ms · <giọng>`).

## Cập nhật 08/10/2026 tối — "để người đối diện trình bày hết, ngắt quãng 3–4 lần" (bản 2026-10-08.5)
- **Vấn đề:** chế độ luân phiên cắt lượt sau mỗi lần người nói ngừng (~1s): dịch, đọc, chuyển sang người kia → phần nói tiếp bị nghe bằng sai tiếng, mất.
- **Sửa — giữ lượt (phiên dịch nối tiếp), cả 2 chế độ:** mỗi đoạn nói xong được dịch và hiện chữ ngay nhưng CHƯA đọc; mic vẫn nghe tiếp người đó. Im lặng hẳn `holdMs` (ô "Kết thúc lượt nói khi im lặng", mặc định 2 giây; 1 / 1,5 / 2 / 3 / 4) mới đọc bản dịch cả lượt rồi chuyển lượt. Có tiếng nói (`speechstart`) hoặc chữ tạm mới → hoãn kết thúc lượt. Chạm ô lượt khi đang giữ lượt = đọc bản dịch ngay. Chế độ song song: người kia bắt đầu nói → đọc ngay bản dịch lượt trước.
- Chốt 1 đoạn bằng speechend thì mở phiên nhận diện mới ngay (`recognizer.restart()`), không chờ final của Android → người nói tiếp ngay ít bị mất đầu câu.
- Đánh đổi: sau đoạn cuối, người nghe chờ thêm `holdMs` mới nghe bản dịch (đo: ~2,2–3,3s với mặc định 2s). Muốn nhanh: chọn 1–1,5s hoặc chạm ô lượt.
- Google Dịch (giọng đọc) lỗi 1 lần chỉ đọc câu đó bằng giọng máy; lỗi 2 lần liên tiếp mới chuyển hẳn sang giọng máy 5 phút (trước: 1 lần đã chuyển 5 phút).
- Test e2e kịch bản mới (đối tác 3 đoạn ngừng 1,2s; tôi 2 đoạn; câu ngắn; nói tiếp sau khi nghe bản dịch), giả lập Android: Anh/Nhật/Hàn 7/7 hoặc 6/7, Trung 6/7 — mọi lượt nhiều đoạn đều giữ trọn (3/3, 2/2 đoạn); sai còn lại: đối tác tiếng Trung/Nhật nói tiếp SAU khi đã nghe bản dịch (giới hạn cũ). Song song: Anh 7/7, Nhật 7/7.
- e2e: kịch bản nhiều đoạn (`SCRIPT`, `GAP`), `FULLDIAG`; tự báo "KHÔNG HỢP LỆ" nếu trang test bị ẩn trong lúc chạy.

## Cập nhật 09/10/2026 — "tai nghe không phân biệt tai khách / tai tôi", "qua tai nghe rất chậm", lấy Timekettle làm chuẩn (bản 2026-10-09.1)
- **Đã kiểm, không làm được bằng phần mềm:** FreeArc là Bluetooth thường (SBC/AAC, không LE Audio) → điện thoại nhận 1 luồng micro chung, không biết tiếng từ tai nào; khi micro Bluetooth bật, tai nghe ở chế độ cuộc gọi (HFP) → âm thanh mono. Timekettle tách được vì mỗi tai là 1 micro/kênh riêng do phần cứng + app của hãng. Tách trái/phải bằng Web Audio không áp được cho giọng đọc: file Google Dịch không có CORS (MediaElementSource ra im lặng), speechSynthesis không đi qua Web Audio.
- **Thừa nhận:** mọi số đo trước 09/10 làm trên máy tính, micro giả, KHÔNG có Bluetooth. Nghi chậm do đổi chế độ Bluetooth (cuộc gọi ↔ nghe nhạc) mỗi lượt + 2s chờ im lặng của bản `.5` — chưa đo.
- **Lợi Minh chọn hướng C — đo thực địa trước:** tab Tự kiểm tra → nút **Đo tai nghe & độ trễ** (`fieldtest.js` giao diện, `fieldcheck.js` kết luận thuần). Đo: tai trái/phải (micro tắt / nhận diện bật / app giữ micro điện thoại + `start(track)`), phản xạ trước và ngay sau khi micro tắt (chênh = trễ chuyển chế độ, đếm tiếng bíp = mất tiếng đầu), chuỗi dịch thật tách từng bước. Đo tai nghe + loa → dòng So sánh. Dữ liệu thô ghi vào nhật ký dòng `FIELD dữ liệu {...}`.
- **Kiểm chứng:** 8 unit test mới (26/26 đạt). `tools/e2e/field.mjs` — người dùng giả trả lời như tai nghe định sẵn (A: mono khi micro bật + trễ 900ms + mất 1 bíp + chạm sớm 1 lần; B: loa; D: bấm Dừng giữa chừng; C: tai nghe tốt): đạt hết ở desktop và giả lập Android, chạy lặp nhiều lần; đo lại đúng trễ giả lập (895–921ms / 900ms). Màn 1:1 không đổi: `run.mjs en-US android` 7/7.
- **Việc tiếp theo:** đọc báo cáo đo thật của Lợi Minh → nếu "giữ micro điện thoại" vẫn tách tai + nhận diện qua track chạy được → làm hướng B (tai nghe không phải đổi chế độ mỗi lượt). Nếu không → khuyến nghị thiết bị chuyên dụng cho 1:1, app giữ cho hội trường. Chưa sửa gì ở màn 1:1 trong bản này.
- e2e: phần khởi động Chrome tách ra `tools/e2e/chrome.mjs` (dùng chung run.mjs / field.mjs); có BASE_URL thì không bật server cục bộ.

## Cập nhật 09/10/2026 chiều — ảnh màn 1:1 tắt hẳn với "Chưa cấp quyền micro" (bản 2026-10-09.2)
- **Nguyên nhân (mã nguồn Chromium, `speech_recognition_dispatcher_host.cc` StartRequestOnUI + `speech_recognition_manager_impl.cc` OnVisibilityChanged):** trên Android, trang bị ẩn (tắt màn hình, chuyển app) thì phiên nhận diện bị cắt và mọi `start()` bị từ chối bằng `not-allowed` — cùng mã lỗi với bị chặn quyền. App cũ coi đó là chặn quyền → `stop()`. Giọng đọc cũng không phát khi trang ẩn ("đọc 0.0s (lỗi)" trong ảnh).
- **Sửa (`src/js/keepalive.js`, dùng ở màn 1:1, hội trường, bài đo):** giữ màn hình sáng (Screen Wake Lock) trong lúc nghe, tự xin lại khi trang hiện lại; `classifyMicError`: `not-allowed` chỉ là chặn quyền khi trang đang hiện VÀ `permissions.query` = `denied`; trang ẩn → tạm dừng, hiện lại → tự nghe tiếp (giữ lượt và các đoạn chưa đọc); lỗi tạm → nghe lại, quá 3 lần / 15 giây mới dừng với thông báo micro bị app khác dùng.
- **Phát hiện thêm từ cùng file mã nguồn:** Chrome Android từ chối MỌI `start(MediaStreamTrack)` bằng `not-allowed` → không thể ép nhận diện qua micro điện thoại do app giữ. Hướng B ở dạng "giữ micro điện thoại" là KHÔNG làm được trên Android; bài đo bỏ bước đó trên Android và ghi lý do vào báo cáo.
- **Kiểm chứng:** fakemic giả lập trang ẩn đúng như Chromium (`__setHidden`), kịch bản run.mjs thêm bước `['hide', 3000]`. Bản cũ: tái hiện đúng lỗi (4/8, "Chưa cấp quyền micro", app tắt). Bản sửa: en-US Android 8/8, ko-KR Android 8/8, ja-JP song song 8/8. Bài đo: field.mjs đạt hết cả user-agent Android (`ua` trong chrome.mjs) lẫn desktop. Unit test 27/27.
- Còn thấy: 1 lần/3 lượt "đối tác nói tiếp sau khi nghe bản dịch" bị micro Việt nghe thành chuỗi nửa Việt nửa Anh và nhận nhầm là Tôi (giới hạn cũ của pickSpeaker, chưa chỉnh). "chờ câu" ~5s thỉnh thoảng xuất hiện (1 lần trong ~6 lần chạy), ảnh của Lợi Minh cũng có 6,5s — chưa rõ nguyên nhân, cần nhật ký thật.

## Cập nhật 09/10/2026 tối — "nói tiếng Việt xong phải chạm chuyển lượt mới dịch", "chờ quá lâu, không tự nhận ai đang nói" (bản 2026-10-09.3)
- **Tái hiện:** thêm tiếng ồn nền vào micro giả (`NOISE=0.03–0.1`, nhiễu hồng). Bản cũ: Chrome báo hết tiếng nói trễ 3,9–8,4 giây hoặc không báo → "chờ câu" 4–8s, nghe bản dịch sau 6–10s (ảnh của Lợi Minh: chờ câu 6,5s). Micro giả im tuyệt đối nên các test trước không thấy. Ngoài ra speechstart bắn vì tiếng ồn mà không có speechend → cờ `talking` kẹt → lượt không bao giờ kết thúc cho tới khi chạm ô lượt.
- **Sửa kết thúc lượt (`dialogue.js`):** bỏ cờ `talking`. Mốc im lặng `lastHeardAt` = lần cuối có chữ mới (chữ tạm đổi / final), hoặc máy báo speechstart (dời mốc 1 lần), hoặc speechend (yên tĩnh: mốc chính xác lúc người nói dừng). Hết `holdMs` không có gì mới → kết thúc lượt; chữ tạm đứng yên mà máy chưa chốt câu → tự chốt chữ đó (`endIfQuiet`, nhật ký "Chữ tạm đứng yên … → tự chốt").
- **Tự chuyển lượt:** đang giữ lượt mà nghe ra câu sai tiếng (≥ 2 âm tiết) → đọc bản dịch ngay, chuyển sang người kia (trước: bỏ đoạn đó, giữ lượt).
- **Nhận người nói (`speaker.js`):** Google dò ra "vi" thì ngưỡng tỷ lệ âm tiết Việt hạ 0,5 → 0,3; số không tính vào tỷ lệ. Lý do: câu thật "check lại KPI của line 3" (0,4) bị loại → app tưởng người kia nói. tune.mjs giữ 114/122.
- **Kết quả (giả lập Android, tắt màn hình 3s giữa chừng):** Anh yên tĩnh 8/8, ồn 0,03 8/8, ồn 0,1 7/8; Nhật ồn 8/8; Trung ồn 7/8; Hàn ồn 7/8; Nhật song song 8/8. Dứt lời → nghe bản dịch ~1,8–2,9s cả khi ồn (trước: 2,3s yên tĩnh, 6–10s khi ồn). Lượt sai còn lại đều là "đối tác nói tiếp sau khi đã nghe bản dịch" (micro Việt nghe tiếng nước ngoài thành câu Việt hợp lệ — vd. tiếng Hàn → "khách sạn"; giới hạn của 1 phiên nhận diện trên Android).

## Cập nhật 10/10/2026 — Lợi Minh chọn giữ miễn phí, yêu cầu "tốt hơn Timekettle" (bản 2026-10-10.1)
- **Dịch cả lượt:** lượt nhiều đoạn được dịch sẵn thành 1 khối ở nền mỗi khi có đoạn mới (`prepareWhole`); lúc kết thúc lượt, đã xong (chờ tối đa 300ms) thì đọc bản cả lượt, chưa xong thì đọc bản ghép từng đoạn như cũ. Lý do: đối tác Hàn chê bản dịch; từng đoạn dịch rời mất ngữ cảnh. Không thêm độ trễ.
- Đã thử và BỎ: tính im lặng từ lúc mic nghe lại (onstart) — không cứu được tiếng Trung khi ồn (máy không trả chữ nào cho đoạn 2–3 trong > 2 giây) mà làm mọi lượt chậm thêm ~0,6s.
- **Đánh giá thật (e2e giả lập Android, nhiều lần chạy):** Anh 7–8/8, Hàn 4–8/8, Nhật 7/8, Trung 4–7/8 khi ồn. Kết quả dao động theo dịch vụ nhận diện; lỗi lớn nhất là dây chuyền: 1 câu ngắn bị nhỡ (nói lúc mic đang mở lại ~0,6s) → app ở sai lượt → câu của người kia bị micro sai tiếng nghe thành rác "hợp lệ". Đây là trần của kiến trúc 1 phiên nhận diện/1 tiếng của Chrome Android. Phát hiện thêm: Google dịch đại từ xưng hô sai ("Anh cho tôi xem…" → "He showed me…").
- **Hướng miễn phí duy nhất còn lại để tự nhận người nói:** nhận diện trên máy bằng Whisper (WebGPU/WASM, transformers.js) với micro app tự thu (getUserMedia) — Whisper tự dò ngôn ngữ mỗi câu. Đổi lại: tải mô hình 40–250 MB 1 lần, tốn pin/nóng máy, chậm hơn trên điện thoại tầm trung, tiếng Việt/Hàn của mô hình nhỏ kém hơn Google. Chưa làm — chờ Lợi Minh đồng ý thử.

## Cập nhật 10/10/2026 chiều — chế độ "Tự nhận người nói" (Whisper chạy trên điện thoại, miễn phí) (bản 2026-10-10.2)
- **Yêu cầu Lợi Minh:** bỏ "Mời … nói"; cả 2 tai nghe cùng nghe; hết 1 câu là dịch ngay; tự quy định thời gian chờ nhận biết hết câu; giữ miễn phí; tốt hơn Timekettle (chỉ cần 4 tiếng).
- **Kiến trúc mới (mặc định, ô "Cách nghe"):** micro getUserMedia (Android cho phép, không bị giới hạn 1 phiên SpeechRecognition) → AudioWorklet khung 512 mẫu 16 kHz → Web Worker `autoworker.js`: Silero VAD (`onnx-community/silero-vad`) + `segmenter.js` cắt câu theo "Thời gian chờ nhận biết hết câu" (0,5–2,5s, mặc định 0,8s) → Whisper (`onnx-community/whisper-tiny`, transformers.js 3.8.1 từ jsdelivr). Dò ngôn ngữ trong cùng 1 lần chạy: bộ lọc logits ở bước đầu decoder chỉ cho chọn `<|vi|>` hoặc tiếng đối tác (thư viện chưa có dò ngôn ngữ — mặc định tiếng Anh). Tiền tố thuật ngữ `ISO 9001, KPI, FSC, BRC, CAPA, audit.` qua `<|startofprev|>`. → `autotalk.js`: dịch Google (dự phòng MyMemory), đọc ngay từng câu; lúc đọc bỏ âm thanh micro (không dịch lại giọng app).
- **Nhận diện sớm:** người nói ngừng 250ms là chạy Whisper luôn; câu kết thúc không nói thêm (cùng id+version) thì dùng kết quả đó → chữ có 0–0,3s sau khi VAD báo hết câu (trước 1,2–2,4s).
- **Cấu hình chọn theo đo:** WebGPU: encoder fp32 + decoder fp16 nếu GPU có `shader-f16` (nhanh hơn q4 35–45%), không thì q4; encoder fp16 làm whisper-base hỏng (khớp chữ 1%) — cấm. Không có WebGPU: CPU q8 + báo cho người dùng. tiny mặc định (đúng người nói như base, chữ 86% vs 85%, tải 93 MB vs 187 MB với WebGPU; 41 MB với CPU).
- **Đo (Chrome máy tính; điện thoại sẽ chậm hơn — chưa đo):** bench 66 câu (`tools/whisper/bench.mjs`): nhận đúng người nói 95% (sạch và ồn 10 dB), sai chỉ ở câu Việt cực ngắn. Màn 1:1 đầy đủ (`DLG=1 node tools/e2e/auto.mjs ko-KR tiny webgpu`): 10/11 câu đúng người nói; dứt lời → nghe bản dịch ~2,5s (gồm 0,8s chờ hết câu và ~1s dịch chậm do Google hạn chế máy test). Có ồn (auto.mjs NOISE=0.05): Anh 10/11, Trung 10/11, Nhật 11/11; CPU (không WebGPU) Hàn 9/11, chậm ~3,9s.
- **Câu ngắn không chắc:** câu < 1s mà độ chắc ngôn ngữ < 95% → chỉ hiện chữ (nhãn "(?)"), không đọc. Lý do: "Vâng." bị nghe thành "Van"/"晚"/"왠" (78–93%) còn "네" thật 80–98% → không tách được bằng ngưỡng.
- **Lưu ý test:** chạy e2e nhiều làm Google chặn IP máy test ("automated queries") → dịch rơi về MyMemory, chậm 1–2s. Không phải lỗi app. e2e cũ (`run.mjs`) đặt `listenMode=chrome`. `E2E_PORT` để chạy 2 bài test song song.
- **Chưa biết (cần đo trên điện thoại Lợi Minh):** điện thoại có WebGPU không, Whisper mất bao lâu mỗi câu, Bluetooth HFP ảnh hưởng VAD thế nào. Nhật ký mỗi câu ghi "Whisper Xms = đặc trưng + giải mã/token", dòng "sẵn sàng (whisper-tiny, webgpu fp16 …)".

## Cập nhật 10/10/2026 tối — "dịch loạn, không nhận được ai nói" trên điện thoại (bản 2026-10-10.3)
- **Nguyên nhân (đo trên GIỌNG NGƯỜI THẬT, `tools/whisper/fetch-real.mjs` + `real.mjs`: 25 câu Việt VLSP2020, 21 câu Hàn Zeroth, 24 câu Anh LibriSpeech; thu sạch và giả lập micro Bluetooth 8 kHz + ồn 15 dB):** Whisper tiny chỉ khớp ~50% chữ tiếng Việt (base 61–72%); Google (Chrome SpeechRecognition, `chrome-sr.mjs`) khớp Việt 93%, Hàn 94%, Anh 95%. Còn nhận đúng tiếng/người nói của Whisper rất tốt: 69–70/70 (2 tiếng), base 69/70 kể cả chọn trong 5 tiếng. Bài đo trước dùng giọng Google TTS (quá sạch) nên báo 95%/86% chữ — sai lệch so với thực tế. Bài học: luôn đo trên giọng người thật.
- **Đã làm:** cách nghe mặc định quay về "Chrome luân phiên" (khoá lưu `audit.listenMode.v2` để ai đã lưu 'auto' cũng quay về); "Tự nhận người nói" ghi là thử nghiệm. Thêm tab Tự kiểm tra → **Thử nghe song song** (`concurrent.js`): bật getUserMedia và SpeechRecognition cùng lúc (2 thứ tự), đọc 1 câu; kết luận máy có cho 2 bên cùng thu micro không.
- **Hướng kế tiếp (chờ kết quả Thử nghe song song trên điện thoại):** nếu được → chế độ ghép: Google ra chữ (chính xác) + Whisper tiny chỉ dò ai nói (encoder + 1 bước, nhanh) trên luồng getUserMedia; sai tiếng thì chuyển Google sang tiếng đúng ngay. Nếu không → phương án toàn Whisper với PhoWhisper (VinAI, chuyên tiếng Việt, có bản ONNX `onnx-community/PhoWhisper-base-ONNX`) cho câu tiếng Việt — đang đo.
- **PhoWhisper (đo xong 10/10 tối, 25 câu Việt thật VLSP2020, WebGPU máy tính):** base khớp chữ 92% (sạch) / 89% (giả lập Bluetooth), 5,3 s/câu 6,9 s; tiny 91% / 85%, 2,8–3,0 s/câu. CẢNH BÁO: VLSP2020 nằm trong dữ liệu huấn luyện của PhoWhisper → số này có thể cao hơn thực tế; cần đo lại trên bộ không trùng (FLEURS vi dev, 215 MB) trước khi dùng. PhoWhisper chỉ dùng cho câu tiếng Việt (ép <|vi|>); dò ai nói vẫn bằng Whisper đa ngữ.
