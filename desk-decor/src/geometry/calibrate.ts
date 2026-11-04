// 사용자가 찍은 기준물체 네 꼭짓점 → 호모그래피 + 카메라 자세.
import { type Pt, computeHomography } from './homography';
import { type Mat3, mat3Inv } from './linalg';
import {
  DEFAULT_FOCAL_35MM,
  type FocalSource,
  type Intrinsics,
  type Pose,
  estimateFocalPx,
  focalPxFrom35mm,
  makeIntrinsics,
  poseFromHomography,
} from './pose';

export interface RefObject {
  id: string;
  label: string;
  /** 짧은 변 / 긴 변 [mm] */
  w: number;
  h: number;
}

export const REF_OBJECTS: RefObject[] = [
  { id: 'a4', label: 'A4 용지 (210×297mm)', w: 210, h: 297 },
  { id: 'card', label: '신용카드 (54×85.6mm)', w: 53.98, h: 85.6 },
  { id: 'a3', label: 'A3 용지 (297×420mm)', w: 297, h: 420 },
];

export interface CalibrationInput {
  /** 클릭 순서: 먼 왼쪽 → 먼 오른쪽 → 가까운 오른쪽 → 가까운 왼쪽 (반대 방향으로 찍어도 자동 보정) */
  corners: Pt[];
  ref: { w: number; h: number };
  image: { width: number; height: number };
  /** EXIF 35mm 환산 초점거리 (있으면 가장 신뢰) */
  focal35?: number;
  /** 가로/세로 배정을 강제로 뒤집기 (자동 판정이 틀렸을 때 UI 에서 토글) */
  forceSwap?: boolean;
}

export interface Calibration {
  /** 평면(mm) → 이미지(px) */
  H: Mat3;
  /** 이미지(px) → 평면(mm) */
  Hinv: Mat3;
  K: Intrinsics;
  focalSource: FocalSource;
  pose: Pose;
  swapped: boolean;
  orderReversed: boolean;
  /** 자동 판정 신뢰도 참고값 (0 에 가까울수록 좋음) */
  normMismatch: number;
  warnings: string[];
}

function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function isConvex(p: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = p[(i + 2) % p.length];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z !== 0) {
      if (sign === 0) sign = Math.sign(z);
      else if (Math.sign(z) !== sign) return false;
    }
  }
  return true;
}

export function calibrate(input: CalibrationInput): Calibration {
  const { corners, ref, image } = input;
  if (corners.length !== 4) throw new Error('기준물체 꼭짓점 4개가 필요합니다.');
  if (!isConvex(corners)) throw new Error('네 점이 볼록한 사각형이 아닙니다. 꼭짓점을 둘레 순서대로 찍어 주세요.');
  const longSide = Math.max(image.width, image.height);
  const areaFrac = Math.abs(polygonArea(corners)) / (image.width * image.height);
  if (areaFrac < 0.0005) throw new Error('기준물체가 너무 작게 찍혔습니다. 더 가까이에서 찍어 주세요.');

  const warnings: string[] = [];
  if (areaFrac < 0.004) warnings.push('기준물체가 사진에서 작습니다(화면의 0.4% 미만). 측정 오차가 커질 수 있습니다.');

  const orders: { pts: Pt[]; reversed: boolean }[] = [
    { pts: corners, reversed: false },
    { pts: [corners[0], corners[3], corners[2], corners[1]], reversed: true },
  ];
  const swaps = input.forceSwap === undefined ? [false, true] : [input.forceSwap];

  type Cand = { H: Mat3; K: Intrinsics; focalSource: FocalSource; pose: Pose; swapped: boolean; reversed: boolean };
  const cands: Cand[] = [];
  for (const o of orders) {
    for (const swapped of swaps) {
      const W = swapped ? ref.h : ref.w;
      const L = swapped ? ref.w : ref.h;
      // 클릭 순서: [먼왼, 먼오, 가까운오, 가까운왼] ↔ 평면 [(0,L), (W,L), (W,0), (0,0)]
      const plane: Pt[] = [
        { x: 0, y: L },
        { x: W, y: L },
        { x: W, y: 0 },
        { x: 0, y: 0 },
      ];
      const H = computeHomography(plane, o.pts);

      let focalPx: number;
      let focalSource: FocalSource;
      if (input.focal35 && input.focal35 > 5 && input.focal35 < 300) {
        focalPx = focalPxFrom35mm(input.focal35, image.width, image.height);
        focalSource = 'exif';
      } else {
        const est = estimateFocalPx(H, image.width / 2, image.height / 2);
        if (est !== null && est > 0.45 * longSide && est < 1.6 * longSide) {
          focalPx = est;
          focalSource = 'estimated';
        } else {
          focalPx = focalPxFrom35mm(DEFAULT_FOCAL_35MM, image.width, image.height);
          focalSource = 'default';
        }
      }
      const K = makeIntrinsics(image.width, image.height, focalPx);
      const pose = poseFromHomography(H, K);
      cands.push({ H, K, focalSource, pose, swapped, reversed: o.reversed });
    }
  }

  // 1) 카메라가 평면 "위"에 있어야 함(클릭 방향 판정) 2) 가로/세로 배정은 normMismatch 최소
  const valid = cands.filter((c) => c.pose.cameraHeightMm > 0);
  const pool = valid.length ? valid : cands;
  pool.sort((a, b) => a.pose.normMismatch - b.pose.normMismatch);
  const best = pool[0];

  if (best.focalSource === 'default') {
    warnings.push('초점거리를 알 수 없어 일반 스마트폰 값(26mm 환산)으로 가정했습니다. 바닥 위 길이 측정에는 영향이 없고, 3D 높이 표현만 약간 어긋날 수 있습니다.');
  }
  if (best.pose.normMismatch > 0.15) {
    warnings.push('기준물체 꼭짓점 위치가 서로 잘 맞지 않습니다. 꼭짓점을 확대해서 다시 찍으면 정확도가 올라갑니다.');
  }

  return {
    H: best.H,
    Hinv: mat3Inv(best.H),
    K: best.K,
    focalSource: best.focalSource,
    pose: best.pose,
    swapped: best.swapped,
    orderReversed: best.reversed,
    normMismatch: best.pose.normMismatch,
    warnings,
  };
}
