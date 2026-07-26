// 생성된 삽입 코드가 문법적으로 유효하고 치환이 빠짐없이 되었는지 검증하는 테스트

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnippet } from './snippet.js';

const spec = {
  uid: 'seqtest',
  frames: 143,
  dims: { desktop: { w: 1920, h: 1080 }, mobile: { w: 720, h: 404 } },
  base: 'https://example.pages.dev/product',
  vh: 500,
};

const code = buildSnippet(spec);

/** 생성 코드에서 script 블록 안의 자바스크립트만 꺼낸다. */
function scriptBody(html) {
  const open = html.indexOf('<script>') + '<script>'.length;
  const close = html.indexOf('</script>');
  return html.slice(open, close);
}

test('치환되지 않은 자리가 남아있지 않다', () => {
  assert.ok(!code.includes('${'), '템플릿 자리가 그대로 남았습니다');
  assert.ok(!code.includes('undefined'), 'undefined가 섞여 있습니다');
});

test('script 블록의 자바스크립트가 문법적으로 유효하다', () => {
  assert.doesNotThrow(() => new Function(scriptBody(code)));
});

test('script 종료 태그가 정상으로 출력된다', () => {
  assert.ok(code.includes('</script>'));
  assert.ok(!code.includes('<\\/script>'));
});

test('실제 프레임 수와 치수가 반영된다', () => {
  assert.match(code, /var COUNT = 143;/);
  assert.match(code, /small \? 720 : 1920/);
  assert.match(code, /small \? 404 : 1080/);
});

test('스크롤 구간 높이가 반영된다', () => {
  assert.match(code, /height: 500vh;/);
});

test('고유 id가 컨테이너와 스타일 양쪽에 쓰인다', () => {
  assert.match(code, /<div id="seqtest">/);
  assert.match(code, /#seqtest \{ position: relative/);
  assert.match(code, /getElementById\('seqtest'\)/);
});

test('선행 로딩 장수는 전체 장수를 넘지 않는다', () => {
  const short = buildSnippet({ ...spec, frames: 8 });
  assert.match(short, /var HEAD = 8;/);
});

test('주소 끝에 슬래시가 중복되지 않는다', () => {
  assert.ok(!code.includes('product//'));
  assert.match(code, /BASE \+ '\/' \+ dir \+ '\/'/);
});
