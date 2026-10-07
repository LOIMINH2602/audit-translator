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

test('arbiter fast: bên đến trước thắng, bên kia bị khoá', () => {
  const got = [];
  const a = createArbiter({ mode: 'fast', lockMs: 100 }, (d) => got.push(d.side));
  a.push('partner', 'hello', 0.9);
  a.push('me', 'rác', 0.5);
  assert.deepEqual(got, ['partner']);
});

test('arbiter confidence: chọn bên có confidence cao hơn dù đến sau', async () => {
  const got = [];
  const a = createArbiter({ mode: 'confidence', windowMs: 30, lockMs: 100 }, (d) => got.push(d));
  a.push('me', 'rác', 0.4);
  a.push('partner', 'hello', 0.92);
  await wait(60);
  assert.equal(got.length, 1);
  assert.equal(got[0].side, 'partner');
  assert.equal(got[0].candidates.length, 2);
});

test('arbiter confidence: hòa thì giữ bên đến trước; sau khoá thì nhận câu mới', async () => {
  const got = [];
  const a = createArbiter({ mode: 'confidence', windowMs: 20, lockMs: 50 }, (d) => got.push(d.side));
  a.push('me', 'a', 0);
  a.push('partner', 'b', 0);
  await wait(40);
  assert.deepEqual(got, ['me']);
  a.push('partner', 'c', 0.8); // còn trong thời gian khoá
  await wait(40);
  assert.equal(got.length, 1);
  await wait(60);
  a.push('partner', 'd', 0.8);
  await wait(40);
  assert.deepEqual(got, ['me', 'partner']);
});
