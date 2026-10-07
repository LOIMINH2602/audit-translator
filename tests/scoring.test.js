import test from 'node:test';
import assert from 'node:assert/strict';
import { similarity, judge } from '../src/js/scoring.js';
import { isInAppBrowser } from '../src/js/env.js';

test('similarity: bỏ qua hoa/thường, dấu câu, khoảng trắng', () => {
  assert.equal(similarity('Xin chào, tôi muốn xem hồ sơ.', 'xin chào tôi muốn xem hồ sơ'), 1);
  assert.equal(similarity('请让我看一下纠正措施记录。', '请让我看一下纠正措施记录'), 1);
  assert.equal(similarity('abc', ''), 0);
  assert.ok(similarity('Phiên dịch', 'Fren') < 0.6);
});

test('judge: recognizer sai ngôn ngữ về trước thì chế độ nhanh chọn sai, độ tin cậy chọn đúng', () => {
  const r = judge('vi', 'Phiên dịch này dùng cho buổi đánh giá', {
    partner: [{ t: 100, text: 'Fren dich', conf: 0.3 }],
    vi: [{ t: 400, text: 'Phiên dịch này dùng cho buổi đánh giá', conf: 0.9 }],
  });
  assert.equal(r.fastWinner, 'partner');
  assert.equal(r.fastOk, false);
  assert.equal(r.confWinner, 'vi');
  assert.equal(r.confOk, true);
  assert.equal(r.recognizerOk, true);
});

test('judge: confidence đều bằng 0 thì độ tin cậy rơi về bên đến trước', () => {
  const r = judge('partner', 'hello world', {
    vi: [{ t: 50, text: 'he lô', conf: 0 }],
    partner: [{ t: 80, text: 'hello world', conf: 0 }],
  });
  assert.equal(r.confWinner, 'vi');
  assert.equal(r.recognizerOk, true);
});

test('judge: không bên nào nghe được gì', () => {
  const r = judge('vi', 'xin chào', { vi: [], partner: [] });
  assert.equal(r.fastWinner, null);
  assert.equal(r.recognizerOk, false);
});

test('isInAppBrowser: Zalo và WebView là true, Chrome thật là false', () => {
  const zalo = 'Mozilla/5.0 (Linux; Android 16; SM-S908U1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/153.0.8010.36 Mobile Safari/537.36 Zalo android/260901903';
  const chrome = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';
  assert.equal(isInAppBrowser(zalo), true);
  assert.equal(isInAppBrowser(chrome), false);
});
