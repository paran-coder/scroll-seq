// 웹빌더에 붙여넣을 스크롤 시퀀스 코드를 문자열로 만드는 순수 모듈

/**
 * @param {object} spec
 * @param {string} spec.uid 페이지 내 충돌을 막는 고유 id
 * @param {number} spec.frames 실제로 뽑힌 프레임 장수
 * @param {{desktop:{w:number,h:number}, mobile:{w:number,h:number}}} spec.dims
 * @param {string} spec.base 프레임을 올린 상위 주소
 * @param {number} spec.vh 스크롤 구간 높이
 */
export function buildSnippet({ uid, frames, dims, base, vh }) {
  const head = Math.min(20, frames);

  return `<!-- 스크롤 시퀀스 · 프레임 ${frames}장 -->
<div id="${uid}">
  <div class="stick"><canvas></canvas></div>
</div>

<style>
#${uid} { position: relative; height: ${vh}vh; }
#${uid} .stick {
  position: sticky; top: 0; height: 100vh;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
#${uid} canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>

<script>
(function () {
  var root = document.getElementById('${uid}');
  var canvas = root.querySelector('canvas');
  var ctx = canvas.getContext('2d');

  var BASE = '${base}';
  var COUNT = ${frames};
  var HEAD = ${head};

  var small = window.matchMedia('(max-width: 768px)').matches;
  var dir = small ? 'mobile' : 'desktop';
  canvas.width = small ? ${dims.mobile.w} : ${dims.desktop.w};
  canvas.height = small ? ${dims.mobile.h} : ${dims.desktop.h};

  var shots = new Array(COUNT);
  var current = -1;

  function load(i, done) {
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () { shots[i] = img; if (done) done(); };
    img.src = BASE + '/' + dir + '/' + String(i + 1).padStart(4, '0') + '.webp';
  }

  function draw(i) {
    if (i === current || !shots[i]) return;
    current = i;
    ctx.drawImage(shots[i], 0, 0, canvas.width, canvas.height);
  }

  // 첫 화면에 필요한 앞부분을 먼저 받고 나머지는 뒤이어 채운다.
  var got = 0;
  for (var i = 0; i < HEAD; i++) {
    load(i, function () {
      if (++got === HEAD) {
        draw(0);
        for (var j = HEAD; j < COUNT; j++) load(j);
      }
    });
  }

  var waiting = false;
  function onScroll() {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(function () {
      waiting = false;
      var span = root.offsetHeight - window.innerHeight;
      if (span <= 0) return;
      var p = Math.min(1, Math.max(0, -root.getBoundingClientRect().top / span));
      draw(Math.round(p * (COUNT - 1)));
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
})();
<\/script>`;
}
