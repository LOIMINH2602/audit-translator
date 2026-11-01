import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delta, sentenceCut, dropLastWord, isFragment } from '../src/js/segment.js';

test('delta: lấy phần mới sau phần đã chốt; Google sửa vài chữ cũ vẫn nhận ra', () => {
  assert.equal(delta('a b c d', ''), 'a b c d');
  assert.equal(delta('a b c d', 'a b'), 'c d');
  assert.equal(delta('지난해 3월 김 전 장관의 동료인 교수가 작업에 들어갔다', '지난해 3월 김 전 장관의 동료인'), '교수가 작업에 들어갔다');
  assert.equal(delta('지난해 3월 김 전 장관에 동료인 교수가', '지난해 3월 김 전 장관의 동료인'), '교수가'); // Google sửa 1 chữ cũ
  assert.equal(delta('请让我看一下记录', '请让我'), '看一下记录');
});

test('delta: câu mới không bắt đầu bằng phần đã chốt → giữ nguyên, không cắt bừa', () => {
  assert.equal(delta('세계보건기구의 노화 프로그램', '지난해 3월 김 전 장관의 동료인'), '세계보건기구의 노화 프로그램');
});

test('delta: Chrome Android lặp lại câu đã chốt ở đầu kết quả mới (lỗi trước 12/10/2026) → chỉ lấy phần mới', () => {
  const first = '지난해 3월 김 전 장관의 동료인 장동연 홍익대 교수가 민간자문단장으로 위촉되면서 본격적인 공모와 개발 작업에 들어갔다';
  assert.equal(delta(first + ' 세계보건기구의 노화', first), '세계보건기구의 노화');
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
