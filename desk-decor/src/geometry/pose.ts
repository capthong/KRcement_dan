// 호모그래피 + 카메라 내부 파라미터(초점거리) → 카메라 자세(R, t).
// 자세를 알면 평면 위에 높이가 있는 3D 박스(책상·모니터)를 사진과 같은 원근으로 그릴 수 있다.
import {
  type Mat3,
  type Vec3,
  add,
  col,
  cross,
  dot,
  mat3Inv,
  mat3MulVec,
  norm,
  normalize,
  scale,
  sub,
} from './linalg';

export interface Intrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export type FocalSource = 'exif' | 'estimated' | 'default';

/** 35mm 환산 초점거리 → 픽셀 초점거리 (긴 변 = 36mm 기준). 스마트폰 기본 카메라는 보통 24~28mm. */
export function focalPxFrom35mm(f35: number, width: number, height: number): number {
  return (Math.max(width, height) * f35) / 36;
}

export const DEFAULT_FOCAL_35MM = 26;

export function makeIntrinsics(width: number, height: number, focalPx: number): Intrinsics {
  return { fx: focalPx, fy: focalPx, cx: width / 2, cy: height / 2, width, height };
}

export function kMatrix(K: Intrinsics): Mat3 {
  return [K.fx, 0, K.cx, 0, K.fy, K.cy, 0, 0, 1];
}

/**
 * 직사각형 기준물체의 호모그래피(평면 mm → 이미지 px)에서 초점거리를 추정한다.
 * r1 ⟂ r2 조건만 사용하므로 기준물체의 가로/세로 배정과 무관하다.
 * 기준물체가 정면(평행)으로 찍히면 해가 불안정 → null.
 */
export function estimateFocalPx(H: Mat3, cx: number, cy: number): number | null {
  const a1 = H[0] - cx * H[6];
  const b1 = H[3] - cy * H[6];
  const c1 = H[6];
  const a2 = H[1] - cx * H[7];
  const b2 = H[4] - cy * H[7];
  const c2 = H[7];
  const denom = c1 * c2;
  if (Math.abs(denom) < 1e-14) return null;
  const f2 = -(a1 * a2 + b1 * b2) / denom;
  if (!(f2 > 0) || !Number.isFinite(f2)) return null;
  return Math.sqrt(f2);
}

export interface Pose {
  /** world→camera 회전 (OpenCV 규약: x 오른쪽, y 아래, z 앞) */
  R: Mat3;
  t: Vec3;
  /** 평면에서 카메라까지 높이[mm] (양수여야 정상) */
  cameraHeightMm: number;
  /** 평면 좌표계에서의 카메라 위치[mm] */
  cameraPos: Vec3;
  /** |‖r1‖-‖r2‖| / 평균 — 0 에 가까울수록 초점거리·가로세로 배정이 일관됨 */
  normMismatch: number;
}

/** H: 평면(mm, z=0) → 이미지(px). 평면 좌표계는 X 오른쪽, Y 안쪽(카메라에서 멀어지는 방향), Z 위. */
export function poseFromHomography(H: Mat3, K: Intrinsics): Pose {
  const Kinv = mat3Inv(kMatrix(K));
  let m1 = mat3MulVec(Kinv, col(H, 0));
  let m2 = mat3MulVec(Kinv, col(H, 1));
  let m3 = mat3MulVec(Kinv, col(H, 2));
  const n1 = norm(m1);
  const n2 = norm(m2);
  let lambda = 2 / (n1 + n2);
  if (m3[2] * lambda < 0) lambda = -lambda; // 평면이 카메라 앞(z>0)에 오도록
  m1 = scale(m1, lambda);
  m2 = scale(m2, lambda);
  m3 = scale(m3, lambda);

  // 두 벡터 대칭 직교화 → 가장 가까운 직교 기저
  const a = normalize(m1);
  const b = normalize(m2);
  const c = normalize(add(a, b));
  const d = normalize(sub(a, b));
  const r1 = scale(add(c, d), Math.SQRT1_2);
  const r2 = scale(sub(c, d), Math.SQRT1_2);
  const r3 = cross(r1, r2);
  const R: Mat3 = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]];
  const t = m3;
  // 카메라 위치 C = -Rᵀ t
  const cameraPos: Vec3 = [-dot(r1, t), -dot(r2, t), -dot(r3, t)];
  return {
    R,
    t,
    cameraHeightMm: cameraPos[2],
    cameraPos,
    normMismatch: Math.abs(n1 - n2) / ((n1 + n2) / 2),
  };
}

/** 평면 좌표(mm, z 포함) → 이미지 px. 테스트·샘플 생성용. */
export function projectPoint(K: Intrinsics, R: Mat3, t: Vec3, Pw: Vec3): { x: number; y: number; z: number } {
  const Pc = add(mat3MulVec(R, Pw), t);
  return { x: (K.fx * Pc[0]) / Pc[2] + K.cx, y: (K.fy * Pc[1]) / Pc[2] + K.cy, z: Pc[2] };
}

/** look-at 으로 world→camera 회전 생성 (OpenCV 규약). world 는 Z-up. */
export function lookAtPose(eye: Vec3, target: Vec3): { R: Mat3; t: Vec3 } {
  const zc = normalize(sub(target, eye)); // 카메라 앞
  const up: Vec3 = [0, 0, 1];
  const xc = normalize(cross(zc, up)); // 카메라 오른쪽
  const yc = cross(zc, xc); // 카메라 아래
  const R: Mat3 = [...xc, ...yc, ...zc];
  const t = scale(mat3MulVec(R, eye), -1);
  return { R, t };
}
