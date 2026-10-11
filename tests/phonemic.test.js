import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMic } from '../src/js/phonemic.js';

const dev = (deviceId, label, kind = 'audioinput') => ({ deviceId, label, kind });

test('Chrome Android có tai nghe Bluetooth: chọn micro điện thoại (earpiece), không chọn Bluetooth/mặc định', () => {
  const list = [dev('default', 'Default'), dev('b', 'Bluetooth headset'), dev('s', 'Speakerphone'), dev('e', 'Headset earpiece'), dev('o', 'x', 'audiooutput')];
  assert.equal(chooseMic(list), 'e');
});

test('không có earpiece: chọn speakerphone', () => {
  assert.equal(chooseMic([dev('b', 'Bluetooth headset'), dev('s', 'Speakerphone')]), 's');
});

test('chỉ có Bluetooth hoặc chưa có quyền (tên rỗng): trả rỗng → dùng micro mặc định', () => {
  assert.equal(chooseMic([dev('default', 'Default'), dev('b', 'Bluetooth headset')]), '');
  assert.equal(chooseMic([dev('a', ''), dev('b', '')]), '');
});

test('tên khác (máy tính): micro tích hợp', () => {
  assert.equal(chooseMic([dev('default', 'Default'), dev('u', 'USB audio'), dev('i', 'Microphone Array (Realtek)')]), 'i');
});
