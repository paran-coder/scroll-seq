// 영상 입력, 스크롤 설정 계산, 변환 엔진 로딩을 묶는 메인 로직

import { inject } from '@vercel/analytics';
import {
  calcFrameCount,
  scrollDistance,
  estimateBytes,
  formatBytes,
} from './frame-calc.js';
import { buildSnippet } from './snippet.js';
import { zipSync } from './vendor/fflate.js';

// Initialize Vercel Web Analytics
inject();

/** ffmpeg 클래스와 워커는 저장소에 포함한다. 워커는 같은 출처에서만 생성할 수 있다. */
const FF_LOCAL = './vendor/ffmpeg/index.js';

/** 코어는 32MB라 저장소에 넣지 않고 CDN에서 받는다. 모듈 워커에서 부르므로 ESM 빌드여야 한다. */
const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';

const $ = (id) => document.getElementById(id);

const el = {
  drop: $('drop'),
  file: $('file'),
  loaded: $('loaded'),
  preview: $('preview'),
  reset: $('reset'),
  vh: $('vh'),
  density: $('density'),
  densityOut: $('density-out'),
  ruler: $('ruler'),
  rulerDist: $('ruler-dist'),
  warn: $('warn'),
  engine: $('engine'),
  engineMsg: $('engine-msg'),
  stepConfig: $('step-config'),
  stepConvert: $('step-convert'),
  go: $('go'),
  progress: $('progress'),
  barFill: $('bar-fill'),
  progressMsg: $('progress-msg'),
  result: $('result'),
  download: $('download'),
  stepPreview: $('step-preview'),
  stepEmbed: $('step-embed'),
  scrubCanvas: $('scrub-canvas'),
  scrub: $('scrub'),
  scrubMsg: $('scrub-msg'),
  cdn: $('cdn'),
  snippet: $('snippet'),
  copy: $('copy'),
};

/** 뽑아낼 해상도 세트. 데스크톱과 모바일을 같은 필터로 돌려 장수를 맞춘다. */
const SETS = [
  { key: 'desktop', width: 1920 },
  { key: 'mobile', width: 720 },
];

/** 현재 불러온 영상 정보. 영상이 없으면 null이다. */
let source = null;

/** ffmpeg 인스턴스. 로딩은 영상이 들어온 뒤 한 번만 시작한다. */
let ffmpeg = null;
let enginePromise = null;

// ── 영상 입력 ────────────────────────────────────

el.drop.addEventListener('click', () => el.file.click());
el.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    el.file.click();
  }
});

['dragenter', 'dragover'].forEach((type) =>
  el.drop.addEventListener(type, (e) => {
    e.preventDefault();
    el.drop.classList.add('over');
  }),
);

['dragleave', 'drop'].forEach((type) =>
  el.drop.addEventListener(type, (e) => {
    e.preventDefault();
    el.drop.classList.remove('over');
  }),
);

el.drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) acceptFile(file);
});

el.file.addEventListener('change', () => {
  const file = el.file.files?.[0];
  if (file) acceptFile(file);
});

el.reset.addEventListener('click', clearFile);

function acceptFile(file) {
  if (!file.type.startsWith('video/')) {
    showWarn('영상 파일만 넣을 수 있습니다. MP4, MOV, WEBM을 지원합니다.');
    return;
  }

  clearFile();
  const url = URL.createObjectURL(file);
  el.preview.src = url;

  el.preview.addEventListener(
    'loadedmetadata',
    () => {
      source = {
        file,
        url,
        duration: el.preview.duration,
        width: el.preview.videoWidth,
        height: el.preview.videoHeight,
        aspect: el.preview.videoWidth / el.preview.videoHeight,
      };
      renderMeta();
      unlockSteps();
      recalc();
      loadEngine();
    },
    { once: true },
  );
}

function clearFile() {
  if (source) URL.revokeObjectURL(source.url);
  source = null;
  el.preview.removeAttribute('src');
  el.loaded.hidden = true;
  el.drop.hidden = false;
  el.stepConfig.classList.add('locked');
  el.stepConvert.classList.add('locked');
  el.warn.hidden = true;
  el.file.value = '';
}

function renderMeta() {
  $('m-name').textContent = source.file.name;
  $('m-dur').textContent = `${source.duration.toFixed(2)}초`;
  $('m-res').textContent = `${source.width} × ${source.height}`;
  $('m-ratio').textContent = ratioLabel(source.aspect);
  $('m-size').textContent = formatBytes(source.file.size);
  el.drop.hidden = true;
  el.loaded.hidden = false;
}

function ratioLabel(aspect) {
  const known = [
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [4 / 3, '4:3'],
    [1, '1:1'],
    [21 / 9, '21:9'],
  ];
  const hit = known.find(([value]) => Math.abs(value - aspect) < 0.02);
  return hit ? hit[1] : aspect.toFixed(2);
}

function unlockSteps() {
  el.stepConfig.classList.remove('locked');
  el.stepConvert.classList.remove('locked');
}

// ── 설정 계산 ────────────────────────────────────

el.vh.addEventListener('input', recalc);
el.density.addEventListener('input', recalc);

function recalc() {
  const vh = Number(el.vh.value) || 0;
  const density = Number(el.density.value);
  el.densityOut.textContent = `${density}px`;

  const distance = scrollDistance(vh);
  const frames = calcFrameCount(vh, density);

  el.rulerDist.textContent = `${distance.toLocaleString()}px · ${frames}장`;
  $('r-frames').textContent = frames;

  if (source) {
    const desktop = estimateBytes(frames, 1920, source.aspect);
    const mobile = estimateBytes(frames, 720, source.aspect);
    $('r-desktop').innerHTML = `${formatBytes(desktop)} <small>추정</small>`;
    $('r-mobile').innerHTML = `${formatBytes(mobile)} <small>추정</small>`;
    checkWarnings(frames, desktop + mobile);
  }

  drawRuler(frames);
}

function checkWarnings(frames, totalBytes) {
  const totalMb = totalBytes / 1024 ** 2;
  const requestedFps = frames / source.duration;

  if (requestedFps > 60) {
    showWarn(
      `${source.duration.toFixed(1)}초 영상에서 ${frames}장을 뽑으면 초당 ${Math.round(requestedFps)}장이 됩니다. ` +
        '원본에 없는 프레임은 앞 프레임이 복제되니 스크롤 구간을 줄이거나 밀도를 낮추세요.',
    );
    return;
  }

  if (totalMb > 40) {
    showWarn(
      `두 세트를 합치면 약 ${totalMb.toFixed(0)}MB입니다. 방문자 첫 로딩이 길어집니다. ` +
        '스크롤 구간을 짧게 잡거나 밀도를 40px 쪽으로 옮겨보세요.',
    );
    return;
  }

  el.warn.hidden = true;
}

function showWarn(message) {
  el.warn.textContent = message;
  el.warn.hidden = false;
}

// ── 시그니처: 프레임 눈금자 ─────────────────────────

function drawRuler(frames) {
  const canvas = el.ruler;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const pad = 24;
  const span = width - pad * 2;
  const baseY = height - 34;

  ctx.clearRect(0, 0, width, height);

  // 스크롤 축
  ctx.strokeStyle = '#2f353f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, baseY);
  ctx.lineTo(width - pad, baseY);
  ctx.stroke();

  // 프레임 한 장당 눈금 하나. 촘촘해질수록 띠처럼 뭉쳐 보인다.
  const step = frames > 1 ? span / (frames - 1) : 0;
  ctx.lineWidth = frames > 160 ? 1 : 2;

  for (let i = 0; i < frames; i++) {
    const x = pad + step * i;
    const major = i % 10 === 0;
    ctx.strokeStyle = major ? '#f2cb05' : 'rgba(242, 203, 5, 0.32)';
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - (major ? 46 : 24));
    ctx.stroke();
  }

  // 양 끝 프레임 번호
  ctx.fillStyle = '#858d9b';
  ctx.font = "500 20px 'IBM Plex Mono', monospace";
  ctx.textBaseline = 'top';
  ctx.fillText('0001', pad, baseY + 12);
  const last = String(frames).padStart(4, '0');
  ctx.textAlign = 'right';
  ctx.fillText(last, width - pad, baseY + 12);
  ctx.textAlign = 'left';
}

// ── 변환 엔진 ────────────────────────────────────

/** 워커를 거쳐 온 거부 값은 Error가 아닐 수 있다. 무엇이 오든 읽히는 문자열로 바꾼다. */
function describeError(error) {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.name) return error.name;
  try {
    return JSON.stringify(error);
  } catch {
    return '원인을 알 수 없습니다. 콘솔을 확인해주세요.';
  }
}

function setEngine(state, message) {
  el.engine.className = `engine ${state}`;
  el.engineMsg.textContent = message;
}

/**
 * 원격 파일을 받아 blob URL로 바꾼다.
 * 브라우저는 다른 도메인의 스크립트로 Worker를 만들지 못한다. 일단 내려받아
 * 같은 출처의 blob으로 만들어야 ffmpeg의 작업 스레드가 뜬다.
 */
async function toBlobURL(url, type, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} 응답 ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let shown = -1;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    const pct = total ? Math.round((received / total) * 100) : -1;
    if (pct !== shown) {
      shown = pct;
      setEngine('busy', `${label} 내려받는 중 ${pct < 0 ? '' : `${pct}%`}`);
    }
  }

  return URL.createObjectURL(new Blob(chunks, { type }));
}

async function loadEngine() {
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    setEngine('busy', '변환 엔진을 준비하는 중입니다. 처음 한 번만 걸립니다.');

    const { FFmpeg } = await import(FF_LOCAL);

    const coreURL = await toBlobURL(
      `${CORE_BASE}/ffmpeg-core.js`,
      'text/javascript',
      '코어',
    );
    const wasmURL = await toBlobURL(
      `${CORE_BASE}/ffmpeg-core.wasm`,
      'application/wasm',
      '엔진 본체 (32MB)',
    );

    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => console.debug('[ffmpeg]', message));

    await ffmpeg.load({ coreURL, wasmURL });

    setEngine('ready', '변환 엔진 준비 완료.');
    el.go.disabled = false;
    return ffmpeg;
  })();

  try {
    return await enginePromise;
  } catch (error) {
    console.error(error);
    enginePromise = null;
    setEngine('failed', `변환 엔진을 불러오지 못했습니다. ${describeError(error)}`);
    throw error;
  }
}

// ── 프레임 추출 ──────────────────────────────────

/** 마지막 변환 결과. ZIP blob과 실제로 나온 장수를 들고 있다. */
let output = null;

el.go.addEventListener('click', () => {
  convert().catch((error) => {
    console.error(error);
    setProgress(0, `변환에 실패했습니다. ${describeError(error)}`);
    el.go.disabled = false;
  });
});

el.download.addEventListener('click', () => {
  if (!output) return;
  const url = URL.createObjectURL(output.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `frames-${output.frames}.zip`;
  a.click();
  URL.revokeObjectURL(url);
});

function setProgress(ratio, message) {
  el.progress.hidden = false;
  el.barFill.style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  el.progressMsg.textContent = message;
}

async function convert() {
  const startedAt = performance.now();
  el.go.disabled = true;
  el.result.hidden = true;
  output = null;

  const ff = await loadEngine();
  const requested = calcFrameCount(Number(el.vh.value), Number(el.density.value));
  const fps = requested / source.duration;
  const inputName = `input${extensionOf(source.file.name)}`;

  setProgress(0, '영상을 엔진에 올리는 중입니다.');
  await ff.writeFile(inputName, new Uint8Array(await source.file.arrayBuffer()));

  const bundle = {};
  const dims = {};
  releasePreview();
  let produced = 0;

  for (const [index, set] of SETS.entries()) {
    setProgress(index / SETS.length, `${set.width}px 세트를 뽑는 중입니다.`);

    await ff.exec([
      '-i', inputName,
      '-vf', `fps=${fps.toFixed(6)},scale=${set.width}:-2:flags=lanczos`,
      '-c:v', 'libwebp',
      '-quality', '75',
      '-preset', 'picture',
      '-an',
      `${set.key}_%04d.webp`,
    ]);

    const names = (await ff.listDir('/'))
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(`${set.key}_`) && name.endsWith('.webp'))
      .sort();

    if (names.length === 0) {
      throw new Error(`${set.width}px 세트에서 프레임이 하나도 나오지 않았습니다.`);
    }

    for (const name of names) {
      const data = await ff.readFile(name);
      bundle[`${set.key}/${name.slice(set.key.length + 1)}`] = data;
      if (set.key === 'desktop') {
        previewURLs.push(URL.createObjectURL(new Blob([data], { type: 'image/webp' })));
      }
      await ff.deleteFile(name);
    }

    // 실제로 나온 크기를 프레임에서 직접 읽는다. scale 필터의 반올림을 추측하지 않기 위해서다.
    const first = bundle[`${set.key}/${names[0].slice(set.key.length + 1)}`];
    const bitmap = await createImageBitmap(new Blob([first], { type: 'image/webp' }));
    dims[set.key] = { w: bitmap.width, h: bitmap.height };
    bitmap.close();

    produced = names.length;
  }

  await ff.deleteFile(inputName);

  setProgress(0.95, '압축하는 중입니다.');
  const blob = new Blob([zipSync(bundle, { level: 0 })], { type: 'application/zip' });

  output = {
    blob,
    frames: produced,
    dims,
    uid: `seq${Date.now().toString(36)}`,
  };

  setProgress(1, '완료했습니다.');
  showResult(produced, requested, blob.size, (performance.now() - startedAt) / 1000);
  setupPreview();
  el.stepPreview.classList.remove('locked');
  el.stepEmbed.classList.remove('locked');
  renderSnippet();
  el.go.disabled = false;
}

function showResult(produced, requested, size, seconds) {
  $('o-frames').textContent = produced;
  $('o-size').textContent = formatBytes(size);
  $('o-time').innerHTML = `${seconds.toFixed(1)}<small>초</small>`;

  const notes = [];
  if (produced !== requested) {
    notes.push(
      `요청한 ${requested}장 대신 ${produced}장이 나왔습니다. 영상 길이와 프레임 간격이 딱 나눠떨어지지 않아 생기는 차이이며, 이후 코드는 ${produced}장 기준으로 만들어집니다.`,
    );
  }
  notes.push('압축을 풀면 desktop과 mobile 폴더가 나옵니다. 두 폴더를 통째로 CDN에 올리세요.');
  $('o-note').textContent = notes.join(' ');

  el.result.hidden = false;
}

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot > -1 ? filename.slice(dot).toLowerCase() : '.mp4';
}

// ── 미리보기 스크러버 ────────────────────────────

/** 데스크톱 프레임의 blob URL 목록. 재변환 때마다 해제한다. */
let previewURLs = [];

const scrubImage = new Image();

function releasePreview() {
  previewURLs.forEach(URL.revokeObjectURL);
  previewURLs = [];
}

function setupPreview() {
  const { w, h } = output.dims.desktop;
  el.scrubCanvas.width = w;
  el.scrubCanvas.height = h;
  el.scrub.max = previewURLs.length - 1;
  el.scrub.value = 0;
  showFrame(0);
}

function showFrame(index) {
  if (!previewURLs[index]) return;
  scrubImage.src = previewURLs[index];
  el.scrubMsg.textContent = `${index + 1} / ${previewURLs.length}`;
}

scrubImage.addEventListener('load', () => {
  const ctx = el.scrubCanvas.getContext('2d');
  ctx.drawImage(scrubImage, 0, 0, el.scrubCanvas.width, el.scrubCanvas.height);
});

el.scrub.addEventListener('input', () => showFrame(Number(el.scrub.value)));

// ── 삽입 코드 생성 ───────────────────────────────

el.cdn.addEventListener('input', renderSnippet);
el.vh.addEventListener('input', renderSnippet);

el.copy.addEventListener('click', async () => {
  if (!el.snippet.value) return;
  try {
    await navigator.clipboard.writeText(el.snippet.value);
    el.copy.textContent = '복사했습니다';
  } catch {
    el.snippet.select();
    el.copy.textContent = '직접 복사해주세요';
  }
  setTimeout(() => (el.copy.textContent = '코드 복사'), 2000);
});

function renderSnippet() {
  if (!output) return;
  el.snippet.value = buildSnippet({
    uid: output.uid,
    frames: output.frames,
    dims: output.dims,
    base: el.cdn.value.trim().replace(/\/+$/, '') || 'https://주소를-입력하세요',
    vh: Number(el.vh.value),
  });
}

recalc();
