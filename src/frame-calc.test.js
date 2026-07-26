// frame-calc 모듈의 계산 결과가 계획서 수치와 일치하는지 검증하는 테스트

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollDistance,
  calcFrameCount,
  calcVh,
  estimateBytes,
  formatBytes,
} from './frame-calc.js';

test('500vh의 스크롤 이동 거리는 4320px이다', () => {
  assert.equal(scrollDistance(500), 4320);
});

test('100vh 이하는 스크롤 거리가 0이다', () => {
  assert.equal(scrollDistance(100), 0);
  assert.equal(scrollDistance(50), 0);
});

test('500vh / 30px는 144장이다', () => {
  assert.equal(calcFrameCount(500, 30), 144);
});

test('350vh / 30px는 90장이다', () => {
  assert.equal(calcFrameCount(350, 30), 90);
});

test('500vh / 20px는 216장이다', () => {
  assert.equal(calcFrameCount(500, 20), 216);
});

test('밀도를 높이면 장수가 늘어난다', () => {
  assert.ok(calcFrameCount(500, 20) > calcFrameCount(500, 40));
});

test('스크롤 거리가 0이어도 최소 1장은 나온다', () => {
  assert.equal(calcFrameCount(100, 30), 1);
});

test('pxPerFrame이 0 이하면 예외를 던진다', () => {
  assert.throws(() => calcFrameCount(500, 0), RangeError);
});

test('calcVh는 calcFrameCount의 역방향이다', () => {
  const vh = calcVh(144, 30);
  assert.equal(vh, 500);
  assert.equal(calcFrameCount(vh, 30), 144);
});

test('1920px 144장의 예상 용량은 10~13MB 범위다', () => {
  const bytes = estimateBytes(144, 1920, 16 / 9);
  const mb = bytes / 1024 ** 2;
  assert.ok(mb > 10 && mb < 13, `실제 ${mb.toFixed(1)}MB`);
});

test('720px 세트는 1920px 세트보다 확연히 작다', () => {
  const desktop = estimateBytes(144, 1920, 16 / 9);
  const mobile = estimateBytes(144, 720, 16 / 9);
  assert.ok(mobile < desktop / 5);
});

test('formatBytes는 단위를 구분해 표기한다', () => {
  assert.equal(formatBytes(512), '512B');
  assert.equal(formatBytes(2048), '2KB');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0MB');
});
