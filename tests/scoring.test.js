import test from 'node:test';
import assert from 'node:assert/strict';
import { similarity, judge } from '../src/js/scoring.js';
import { syllables, plausible, pickSpeaker, vietnameseRatio } from '../src/js/speaker.js';
import { isInAppBrowser } from '../src/js/env.js';

test('similarity: bỏ qua hoa/thường, dấu câu, khoảng trắng', () => {
  assert.equal(similarity('Xin chào, tôi muốn xem hồ sơ.', 'xin chào tôi muốn xem hồ sơ'), 1);
  assert.equal(similarity('请让我看一下纠正措施记录。', '请让我看一下纠正措施记录'), 1);
  assert.equal(similarity('abc', ''), 0);
  assert.ok(similarity('Phiên dịch', 'Fren') < 0.6);
});

// Chuỗi dưới đây là kết quả đo thật trên Chrome 154 ngày 08/10/2026 (giọng tổng hợp đọc câu mẫu).
test('judge: tiếng Anh — recognizer Việt nghe ra chữ Anh rác, Google dò ra en → loại, chọn đúng đối tác', () => {
  const r = judge('partner', 'Please show me the corrective action records.', [
    { side: 'partner', lang: 'en-US', text: 'please show me the corrective action records', detected: 'en' },
    { side: 'me', lang: 'vi-VN', text: 'Please Show me the cracking back in dragon', detected: 'en' },
  ], 'me');
  assert.equal(r.winner, 'partner');
  assert.equal(r.pickOk, true);
  assert.equal(r.recognizerOk, true);
});

test('judge: tiếng Việt — recognizer Anh trả số/rỗng → chọn đúng Tôi', () => {
  const r = judge('me', 'Xin chào, tôi muốn xem hồ sơ hành động khắc phục.', [
    { side: 'partner', lang: 'en-US', text: '21747', detected: 'en' },
    { side: 'me', lang: 'vi-VN', text: 'Xin chào tôi muốn xem hồ sơ hành động khắc phục', detected: 'vi' },
  ]);
  assert.equal(r.winner, 'me');
  assert.equal(r.recognizerOk, true);
});

test('judge: không bên nào nghe được gì', () => {
  const r = judge('me', 'xin chào', []);
  assert.equal(r.winner, null);
  assert.equal(r.recognizerOk, false);
  assert.equal(r.pickOk, false);
});

test('isInAppBrowser: Zalo và WebView là true, Chrome thật là false', () => {
  const zalo = 'Mozilla/5.0 (Linux; Android 16; SM-S908U1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.36 Mobile Safari/537.36 Zalo android/260901903';
  const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';
  assert.equal(isInAppBrowser(zalo), true);
  assert.equal(isInAppBrowser(chrome), false);
});

test('syllables: Hán/kana/Hangul theo ký tự, Việt theo từ, Anh theo nguyên âm', () => {
  assert.equal(syllables('质量手册在哪里', 'zh-CN'), 7);
  assert.equal(syllables('시정 조치', 'ko-KR'), 4);
  assert.equal(syllables('kho nguyên liệu nằm ở đâu', 'vi-VN'), 6);
  assert.equal(syllables('corrective action', 'en-US'), 5);
  assert.equal(syllables('', 'vi-VN'), 0);
});

test('plausible: rỗng/số/ngôn ngữ dò khác tiếng recognizer → loại; Google lỗi (detected null) → chỉ xét chữ', () => {
  assert.equal(plausible({ lang: 'en-US', text: '9', detected: 'en' }), false);
  assert.equal(plausible({ lang: 'ja-JP', text: '', detected: null }), false);
  assert.equal(plausible({ lang: 'vi-VN', text: 'Where is the world', detected: 'en' }), false);
  assert.equal(plausible({ lang: 'zh-CN', text: '质量手册在哪里', detected: 'zh-CN' }), true);
  assert.equal(plausible({ lang: 'zh-CN', text: '质量手册', detected: 'zh-TW' }), true);
  assert.equal(plausible({ lang: 'vi-VN', text: 'xin chào', detected: null }), true);
});

// Các ca dưới đây lấy từ log chạy thật ở chế độ song song (bản đầu chọn sai, bản này phải chọn đúng).
test('pickSpeaker: tiếng Việt thật thắng chuỗi rác tiếng Hàn/Nhật dài hơn', () => {
  const vi = { side: 'me', lang: 'vi-VN', text: 'vui lòng cho tôi xem sổ tay chất lượng', detected: 'vi' };
  assert.equal(pickSpeaker([vi, { side: 'partner', lang: 'ko-KR', text: '불 나오면 저도 이샘 소따위처럼', detected: 'ko' }], 'me').side, 'me');
  assert.equal(pickSpeaker([vi, { side: 'partner', lang: 'ja-JP', text: 'vlm ちょっと ダイジェストロング', detected: 'ja' }], 'me').side, 'me');
});

test('pickSpeaker: đối tác nói 2 câu liền (lượt đang là Tôi) vẫn nhận ra nhờ âm tiết tiếng Việt không hợp lệ', () => {
  // Giới hạn đã biết: rác toàn âm tiết tiếng Việt hợp lệ ("xin cho ông chủ trì Kỷ Trụ Vương...") vẫn thắng câu Hàn thật.
  const j = pickSpeaker([
    { side: 'partner', lang: 'ja-JP', text: '従業員の教育記録はどこにありますか', detected: 'ja' },
    { side: 'me', lang: 'vi-VN', text: 'Do you know chơi câu chia đôi cửa tôi có nghe đi massage', detected: 'vi' },
  ], 'me');
  assert.equal(j.side, 'partner');
});

test('pickSpeaker: không bên nào hợp lệ → null', () => {
  assert.equal(pickSpeaker([{ side: 'me', lang: 'vi-VN', text: '123', detected: 'vi' }], 'me'), null);
});

test('vietnameseRatio: câu tiếng Việt thật = 1, lẫn từ tiếng Anh thì thấp', () => {
  assert.equal(vietnameseRatio('Công nhân có được đào tạo về an toàn lao động không'), 1);
  assert.equal(vietnameseRatio('Xin chào tôi muốn xem hồ sơ hành động khắc phục'), 1);
  assert.ok(vietnameseRatio('UEFA wanna One thành phố Manila house') < 0.5);
  assert.ok(vietnameseRatio('để phim Samsung j8') <= 0.5);
});
