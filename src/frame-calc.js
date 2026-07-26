// 스크롤 길이(vh)와 프레임 밀도로부터 필요한 프레임 수와 예상 용량을 계산하는 순수 모듈

/** 계산 기준 뷰포트 높이. 기기마다 결과가 달라지지 않도록 고정한다. */
export const BASE_VIEWPORT = 1080;

/**
 * WebP 품질 75 기준 픽셀당 대략적인 바이트 수.
 * 실측 두 건 사이의 중간값이다. 프랙탈처럼 화면 전체가 고밀도인 최악의 소스가
 * 0.054, 하늘과 단색 면이 있는 일반 영상이 0.033이었다. 내용에 따라 편차가
 * 크므로 정확한 값이 아니라 눈대중용 지표로 쓴다.
 */
const BYTES_PER_PIXEL = 0.04;

/** 프레임 밀도 허용 범위(px당 1장). 이 밖으로 나가면 용량이 낭비되거나 끊김이 보인다. */
export const PX_PER_FRAME_MIN = 20;
export const PX_PER_FRAME_MAX = 40;

/**
 * 스크롤 컨테이너 높이(vh)에서 실제 스크롤 이동 거리를 구한다.
 * sticky로 고정된 canvas는 컨테이너 높이에서 화면 한 장을 뺀 만큼만 움직인다.
 */
export function scrollDistance(vh, viewportH = BASE_VIEWPORT) {
  return Math.max(0, (vh / 100) * viewportH - viewportH);
}

/** 스크롤 거리를 프레임 밀도로 나눠 필요한 장수를 구한다. */
export function calcFrameCount(vh, pxPerFrame, viewportH = BASE_VIEWPORT) {
  if (pxPerFrame <= 0) throw new RangeError('pxPerFrame은 0보다 커야 합니다');
  return Math.max(1, Math.round(scrollDistance(vh, viewportH) / pxPerFrame));
}

/** 장수를 먼저 정했을 때 필요한 vh를 역산한다. 사용자가 프레임 수를 직접 입력할 때 쓴다. */
export function calcVh(frameCount, pxPerFrame, viewportH = BASE_VIEWPORT) {
  if (frameCount < 1) throw new RangeError('frameCount는 1 이상이어야 합니다');
  return Math.round(((frameCount * pxPerFrame + viewportH) / viewportH) * 100);
}

/** 프레임 세트 하나의 예상 용량을 바이트로 반환한다. */
export function estimateBytes(frameCount, width, aspectRatio) {
  if (aspectRatio <= 0) throw new RangeError('aspectRatio는 0보다 커야 합니다');
  const height = width / aspectRatio;
  return Math.round(frameCount * width * height * BYTES_PER_PIXEL);
}

/** 용량을 사람이 읽는 문자열로 바꾼다. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}
