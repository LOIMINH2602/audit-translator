import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delta, sentenceCut, dropLastWord, isFragment } from '../src/js/segment.js';

test('delta: lấy phần mới sau phần đã chốt; Google sửa chữ cũ thì bỏ theo số từ', () => {
  assert.equal(delta('a b c d', '', 'en-US'), 'a b c d');
  assert.equal(delta('a b c d', 'a b', 'en-US'), 'c d');
  assert.equal(delta('A x c d', 'a b', 'en-US'), 'c d');
  assert.equal(delta('请让我看一下记录', '请让我', 'zh-CN'), '看一下记录');
});

test('sentenceCut: tiếng Hàn theo đuôi câu, không cắt ở từ cuối đang nghe dở', () => {
  assert.equal(sentenceCut('오늘 회의를 시작합니다 먼저 공장을', 'ko-KR'), '오늘 회의를 시작합니다');
  assert.equal(sentenceCut('오늘 회의를 시작합니다', 'ko-KR'), '');
  assert.equal(sentenceCut('그리고 공장을 보고', 'ko-KR'), '');
});

test('sentenceCut: Trung/Nhật theo dấu câu, Anh theo . ? !', () => {
  assert.equal(sentenceCut('质量手册在哪里？我们在仓库', 'zh-CN'), '质量手册在哪里？');
  assert.equal(sentenceCut('記録を見せてください。倉庫で', 'ja-JP'), '記録を見せてください。');
  assert.equal(sentenceCut('Where is the manual? We found one', 'en-US'), 'Where is the manual?');
  assert.equal(sentenceCut('no end here', 'en-US'), '');
});

test('dropLastWord và isFragment', () => {
  assert.equal(dropLastWord('a b c', 'en-US'), 'a b');
  assert.equal(dropLastWord('abc', 'en-US'), 'abc');
  assert.equal(dropLastWord('请让我看一下', 'zh-CN'), '请让我看一');
  assert.equal(isFragment('세', 'ko-KR'), true);
  assert.equal(isFragment('세계 보건', 'ko-KR'), false);
  assert.equal(isFragment('是的', 'zh-CN'), true);
});
