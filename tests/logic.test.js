import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGlossary, applyGlossary } from '../src/js/glossary.js';
import { createArbiter } from '../src/js/arbiter.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('glossary: bỏ dòng sai cú pháp, cụm dài xếp trước cụm ngắn', () => {
  const p = parseGlossary('corrective action=khắc phục\nbad line\ncorrective action and preventive action=CAPA\n=x');
  assert.deepEqual(p.map((x) => x[0]), ['corrective action and preventive action', 'corrective action']);
});

test('glossary: chèn chú giải khi bản dịch thiếu thuật ngữ, không chèn khi đã có', () => {
  const p = parseGlossary('root cause=nguyên nhân gốc');
  assert.equal(applyGlossary('Find the root cause', 'Tìm gốc rễ', p), 'Tìm gốc rễ  [root cause = nguyên nhân gốc]');
  assert.equal(applyGlossary('Find the root cause', 'Tìm nguyên nhân gốc', p), 'Tìm nguyên nhân gốc');
  assert.equal(applyGlossary('nothing here', 'không có', p), 'không có');
});

test('arbiter: đủ 2 bên thì đóng cửa sổ ngay, final rỗng bị bỏ', () => {
  const got = [];
  const a = createArbiter({ windowMs: 1000 }, (c) => got.push(c));
  a.push('partner', '');
  assert.equal(got.length, 0);
  a.push('partner', 'please show me');
  a.push('me', 'Please Show me the cracking');
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].map((c) => c.side), ['partner', 'me']);
});

test('arbiter: chỉ 1 bên có kết quả thì đóng sau windowMs', async () => {
  const got = [];
  const a = createArbiter({ windowMs: 40 }, (c) => got.push(c));
  a.push('me', 'xin chào');
  await wait(20);
  assert.equal(got.length, 0);
  await wait(60);
  assert.deepEqual(got, [[{ side: 'me', text: 'xin chào' }]]);
});

test('arbiter: bên kia đang nghe dở (interim) thì chờ final của nó, tối đa maxMs', async () => {
  const got = [];
  const a = createArbiter({ windowMs: 30, maxMs: 300 }, (c) => got.push(c));
  a.interim('me');
  a.push('partner', 'volume'); // bên sai tiếng trả rác trước
  await wait(100);
  assert.equal(got.length, 0); // quá windowMs nhưng bên Việt còn đang nghe
  a.push('me', 'vui lòng cho tôi xem sổ tay chất lượng');
  assert.equal(got.length, 1);
  assert.equal(got[0].length, 2);
  // interim treo (bị abort, không có final) → vẫn đóng ở maxMs
  a.interim('partner');
  a.push('me', 'a');
  await wait(400);
  assert.equal(got.length, 2);
});

test('arbiter: cùng 1 bên nhiều final trong cửa sổ thì nối lại', async () => {
  const got = [];
  const a = createArbiter({ windowMs: 30 }, (c) => got.push(c));
  a.push('me', 'xin chào');
  a.push('me', 'tôi muốn xem');
  await wait(60);
  assert.deepEqual(got, [[{ side: 'me', text: 'xin chào tôi muốn xem' }]]);
});
