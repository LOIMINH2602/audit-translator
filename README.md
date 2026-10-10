# Phiên Dịch Audit

App web cá nhân cho Lợi Minh: nghe liên tục và dịch khi audit nhà máy với đối tác nước ngoài, phát bản dịch ra tai nghe Bluetooth. Chạy trên Chrome Android, cài như app qua "Thêm vào màn hình chính" (PWA). Không bán, không phân phối.

## Hai chế độ

| Màn | Dùng khi | Cách hoạt động |
|---|---|---|
| Đối thoại 1:1 | Hai người dùng chung 1 tai nghe | Tự nhận ai đang nói, dịch sang tiếng còn lại, đọc to bản dịch. Bấm Bắt đầu thì app dò 1,5 giây xem máy chạy được chế độ nào (xem dưới). |
| Nghe hội trường | Nhiều người nói Anh/Trung/Nhật/Hàn xen nhau | 1 recognizer, người dùng chạm chọn tiếng đang nghe. Chỉ dịch sang tiếng Việt, đọc to nếu bật. |

Ngôn ngữ đối tác: Anh, Trung (giản thể), Nhật, Hàn.

### Màn 1:1 nhận người nói thế nào

Chrome chỉ cho **1 phiên nhận diện tự giữ micro**: bật phiên thứ 2 thì phiên đầu bị huỷ (`aborted`). Đã đo thật 08/10/2026; đây là lý do bản 07/10 (2 recognizer song song trên mic) không dịch được câu nào. App giờ có 2 chế độ, tự chọn:

| Chế độ | Khi nào | Cách nhận người nói |
|---|---|---|
| Song song | Máy cho 2 recognizer nhận chung 1 track micro (`start(track)`, Chrome desktop 154 chạy được) | Cả 2 cùng nghe. Mỗi câu chọn bên đúng bằng `pickSpeaker`: Google dò ngôn ngữ phải khớp, bên "nói được lâu hơn" (âm tiết ÷ tốc độ nói) thắng, tiếng Việt phải là âm tiết Việt hợp lệ, ưu tiên nhẹ bên đến lượt. |
| Luân phiên | Máy chỉ cho 1 recognizer (dự kiến Chrome Android) | Nghe tiếng của bên đến lượt, dịch xong tự chuyển bên. Câu không khớp tiếng (rỗng, số, Google dò ra tiếng khác, có chữ tạm nhưng không thành câu) → tự chuyển bên và mời nói lại. Ô "Đang nghe: …" chạm để đổi bên nếu app đoán sai. |

Kết quả test đầu-cuối 08/10/2026 (giọng Google TTS, 8 lượt mỗi tiếng, có câu ngắn và 2 lần 1 người nói 2 câu liền):

| | Anh | Trung | Nhật | Hàn |
|---|---|---|---|---|
| Song song | 8/8 | 6/8 | 8/8 | 8/8 |
| Luân phiên (giả lập Android) | 8/8 | 7/8 | 7/8 | 6/8 |

Chế độ luân phiên trên Chrome Android cần thêm (bản 2026-10-08.2, sau test thật): Android không báo TTS đọc xong nên app dò `speechSynthesis.speaking`; mic mở lại ngay khi đọc xong và lọc tiếng vọng bằng `isEcho`; mỗi phiên nhận diện là đối tượng mới, có watchdog thay phiên treo. Giả lập Android (`run.mjs <tiếng> android`, người kia trả lời 0,3s sau khi nghe xong): Anh 8/8, Trung/Nhật/Hàn 7/8; bản trước chỉ 3/8.

Giọng đọc (bản 2026-10-08.4): chiều Việt → tiếng nước ngoài chậm trên Android vì Chrome nạp lại giọng mỗi lần đổi tiếng và giọng nước ngoài thường chưa tải về máy. Chế độ Tự động đọc thử không tiếng khi bấm Bắt đầu; giọng máy chậm (> 0,9s) thì dùng file đọc của Google Dịch (`translate_tts`, cần `<meta name="referrer" content="no-referrer">`). Giả lập: Việt→ngoại 3,3s → ~0,5–0,7s.

Giữ lượt (bản 2026-10-08.5): người đang nói có thể ngắt quãng nhiều lần — mỗi đoạn được dịch và hiện ngay, im lặng hẳn 2 giây (chỉnh được) app mới đọc bản dịch cả lượt và chuyển lượt; chạm ô lượt để đọc ngay.

Mọi lượt nói luân phiên bình thường đều đúng. Sai chỉ rơi vào: 1 người nói 2 câu liền bằng tiếng Trung/Nhật/Hàn (recognizer sai tiếng ra chuỗi rác trông hợp lệ), và câu rất ngắn "Đúng rồi" khi đối tác là tiếng Trung ở chế độ song song.

## Cấu trúc

```
src/                  site tĩnh, đây là thứ được deploy
  index.html
  css/app.css
  js/
    main.js           khởi tạo, chuyển tab, đăng ký service worker
    dialogue.js       màn 1:1
    meeting.js        màn hội trường
    recognizer.js     bọc Web Speech API, tự restart, nhận track micro, báo "nghe ra chữ tạm nhưng không thành câu",
                      probeParallel() dò máy có chạy 2 recognizer song song không
    arbiter.js        gom kết quả 2 recognizer của cùng 1 câu (chế độ song song)
    speaker.js        chọn người nói / kiểm tra câu có khớp tiếng không (logic thuần, có test)
    translate.js      Google, dự phòng MyMemory; detectTranslate() dò ngôn ngữ + dịch trong 1 lần gọi
    tts.js            speechSynthesis, chọn giọng theo ngôn ngữ
    glossary.js       bảng thuật ngữ ngành
    diagnostics.js    nhật ký + danh sách giọng + đọc thử
    ui.js, config.js
  sw.js               service worker (network-first)
  manifest.webmanifest, icon-*.png
tests/                test logic (glossary, arbiter, speaker, scoring) bằng node:test
tools/serve.mjs       server tĩnh để chạy thử ở máy tính
tools/e2e/            test đầu-cuối trên Chrome thật với micro giả + dữ liệu đo dùng chỉnh pickSpeaker
prototype/            bản nháp gốc từ Cowork, giữ làm tham chiếu, không sửa
BAN-GIAO-AI.md        bàn giao kỹ thuật và các quyết định đã chốt
.github/workflows/    tự deploy `src/` lên GitHub Pages khi push vào main
```

Không có bước build. Mã nguồn chạy thẳng trên trình duyệt dưới dạng ES module.

## Chạy thử ở máy tính

```
npm start        # http://localhost:8080
npm test         # test logic
node tools/e2e/run.mjs ja-JP            # test đầu-cuối chế độ song song (Chrome desktop)
node tools/e2e/run.mjs ja-JP android    # giả lập máy chỉ cho 1 recognizer → chế độ luân phiên
node tools/e2e/tune.mjs [grid]          # chấm pickSpeaker trên 122 ca nhận diện đo thật
node tools/whisper/fetch-real.mjs             # tải giọng người thật (Việt/Hàn/Anh) để đo — không commit
MODE=hybrid DLG=1 REAL=1 ANDROID=1 node tools/e2e/auto.mjs ko-KR tiny webgpu  # bản ghép Google + Whisper (mặc định); MODE=chrome để so
node tools/e2e/auto.mjs ko-KR tiny webgpu   # Tự nhận người nói (Whisper trên máy): bộ nghe; DLG=1 = cả màn 1:1; NOISE=0.05
node tools/whisper/bench.mjs tiny,base webgpu  # đo Whisper: nhận đúng người nói, khớp chữ, tốc độ (DEC=fp16|q4, PROMPT=1)
node tools/e2e/field.mjs [android]      # test bài "Đo tai nghe & độ trễ" với người dùng giả (4 kịch bản tai nghe)
```

`run.mjs` mở Chrome riêng (profile tạm), tải mẫu giọng Google TTS về `tools/e2e/audio/` (không commit), phát qua micro giả và in từng lượt: ĐÚNG / SAI / NÓI LẠI→ĐÚNG. Mất khoảng 2 phút mỗi lần. Micro giả là AudioContext đưa vào `start(track)`; chế độ `android` giả lập việc phiên nhận diện mới huỷ phiên cũ.

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
2. Dò máy chạy chế độ song song hay luân phiên (chính hàm app dùng), thử nhận diện từng tiếng, phân loại lỗi (audio-capture, network, language-not-supported).
3. Dịch 8 chiều Anh/Trung/Nhật/Hàn ⇄ Việt.
4. Đọc thử giọng 5 tiếng, người dùng bấm "nghe rõ / sai / không nghe".
5. Đọc to câu mẫu theo đúng chế độ máy dùng: app biết câu đúng nên tự chấm nghe đúng không, nhận đúng người nói không. Ở chế độ luân phiên có thêm 2 câu "nói nhầm lượt" để đo app có tự phát hiện không.

Kết quả là báo cáo tiếng Việt có mục "Vấn đề phát hiện" kèm cách xử lý, nút **Gửi báo cáo** (chia sẻ qua Zalo/Messenger) và **Sao chép**. Logic chấm điểm nằm ở `src/js/scoring.js`, có test trong `tests/scoring.test.js`.

### Đo tai nghe & độ trễ (cùng tab, nút thứ 2)

Đo những gì máy tính không giả lập được: Bluetooth thật. Khoảng 5 phút, người dùng chạm nút khi nghe tiếng bíp và trả lời nghe ở tai nào. Báo cáo cho biết:

- Tai trái/phải có tách được không: lúc micro tắt, lúc nhận diện giọng nói đang bật, lúc app giữ micro điện thoại (getUserMedia + `start(track)`).
- Mỗi lần micro tắt, tai nghe chậm thêm bao lâu mới phát được tiếng, có mất tiếng đầu không (so phản xạ với lúc micro chưa bật).
- Chuỗi thật: dứt lời → chốt câu → dịch → máy bắt đầu đọc → nghe thấy, tách ra từng bước, chỉ ra bước chậm nhất.

Đo 1 lần với tai nghe, 1 lần với loa điện thoại (tắt Bluetooth) thì báo cáo có dòng So sánh. Kết luận tính ở `src/js/fieldcheck.js` (test: `tests/fieldcheck.test.js`), giao diện ở `src/js/fieldtest.js`, test tự động `tools/e2e/field.mjs`.

Mục **Chẩn đoán & cài đặt thử nghiệm** cuối trang vẫn còn cho việc soi chi tiết: nhật ký từng sự kiện (có dòng `QUYẾT ĐỊNH` cho mỗi câu: bên nào thắng, mỗi recognizer nghe ra gì, Google dò ra tiếng gì), đọc thử từng giọng, nút Thử dịch.

Khi đang nghe, app giữ màn hình sáng. Android ngừng micro khi trang bị ẩn (tắt màn hình, chuyển app); app tự nghe lại khi trang hiện lại (`src/js/keepalive.js`).

Màn Hội trường: khi bật "Đọc to", mic tạm ngừng trong lúc đọc để không nghe lại bản dịch rồi dịch tiếp thành vòng lặp; câu nói chen vào lúc đó có thể bị hụt.
