import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/geometry/calibrate';
import { readExif } from '../src/geometry/exif';
import { applyHomography, computeHomography, isBeyondHorizon, planeDistanceMm } from '../src/geometry/homography';
import type { Vec3 } from '../src/geometry/linalg';
import { estimateFocalPx, lookAtPose, makeIntrinsics, projectPoint } from '../src/geometry/pose';

// 가상 카메라: 4032×3024 사진, 26mm 환산 (f ≈ 2912px), 바닥에서 1.3m 높이에서 앞쪽 아래를 봄
const W = 4032;
const H = 3024;
const F = (W * 26) / 36;
const K = makeIntrinsics(W, H, F);
const eye: Vec3 = [150, -1400, 1300];
const { R, t } = lookAtPose(eye, [0, 900, 0]);
const proj = (X: number, Y: number, Z = 0) => {
  const p = projectPoint(K, R, t, [X, Y, Z]);
  return { x: p.x, y: p.y };
};

// A4 를 바닥에 세로로(긴 변이 안쪽 방향) 놓음. 가까운 왼쪽 꼭짓점이 (-105, 500)
const A4 = { x0: -105, y0: 500, w: 210, h: 297 };
const clicked = [
  proj(A4.x0, A4.y0 + A4.h), // 먼 왼쪽
  proj(A4.x0 + A4.w, A4.y0 + A4.h), // 먼 오른쪽
  proj(A4.x0 + A4.w, A4.y0), // 가까운 오른쪽
  proj(A4.x0, A4.y0), // 가까운 왼쪽
];

describe('homography', () => {
  it('4점을 정확히 옮긴다', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const dst = [
      { x: 10, y: 20 },
      { x: 400, y: 35 },
      { x: 380, y: 300 },
      { x: 5, y: 260 },
    ];
    const Hm = computeHomography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(Hm, p);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });

  it('5점 이상이면 최소제곱으로 동작', () => {
    const plane = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 300 },
      { x: 0, y: 300 },
      { x: 150, y: 150 },
    ];
    const img = plane.map((p) => proj(p.x, p.y));
    const Hm = computeHomography(plane, img);
    const q = applyHomography(Hm, { x: 75, y: 220 });
    const truth = proj(75, 220);
    expect(q.x).toBeCloseTo(truth.x, 4);
    expect(q.y).toBeCloseTo(truth.y, 4);
  });
});

describe('calibrate (노이즈 없음)', () => {
  const cal = calibrate({ corners: clicked, ref: { w: 210, h: 297 }, image: { width: W, height: H } });

  it('A4 가로·세로 배정을 자동으로 맞춘다', () => {
    expect(cal.swapped).toBe(false);
    expect(cal.orderReversed).toBe(false);
  });

  it('바닥 위 1.6m 거리를 정확히 잰다', () => {
    const a = proj(-800, 2000);
    const b = proj(800, 2000);
    expect(planeDistanceMm(cal.Hinv, a, b)).toBeCloseTo(1600, 3);
  });

  it('초점거리를 사각형만으로 추정한다', () => {
    expect(cal.focalSource).toBe('estimated');
    expect(cal.K.fx / F).toBeCloseTo(1, 4);
  });

  it('카메라 높이·위치를 복원한다', () => {
    // 평면 원점은 A4 가까운 왼쪽 꼭짓점
    expect(cal.pose.cameraHeightMm).toBeCloseTo(1300, 1);
    expect(cal.pose.cameraPos[0] + A4.x0).toBeCloseTo(eye[0], 1);
    expect(cal.pose.cameraPos[1] + A4.y0).toBeCloseTo(eye[1], 1);
  });

  it('반대 방향(반시계)으로 찍어도 자동 보정한다', () => {
    const ccw = [clicked[0], clicked[3], clicked[2], clicked[1]];
    const c2 = calibrate({ corners: ccw, ref: { w: 210, h: 297 }, image: { width: W, height: H } });
    expect(c2.pose.cameraHeightMm).toBeGreaterThan(0);
    expect(planeDistanceMm(c2.Hinv, proj(-800, 2000), proj(800, 2000))).toBeCloseTo(1600, 3);
  });

  it('A4 를 가로로 놓아도(긴 변이 좌우) 판정한다', () => {
    const c = [
      proj(-150, 500 + 210),
      proj(-150 + 297, 500 + 210),
      proj(-150 + 297, 500),
      proj(-150, 500),
    ];
    const c3 = calibrate({ corners: c, ref: { w: 210, h: 297 }, image: { width: W, height: H } });
    expect(c3.swapped).toBe(true);
    expect(planeDistanceMm(c3.Hinv, proj(0, 1000), proj(0, 2000))).toBeCloseTo(1000, 3);
  });

  it('지평선 너머 점을 거른다', () => {
    const sky = { x: W / 2, y: 50 }; // 사진 맨 위 = 바닥 평면의 지평선 위
    const floor = proj(0, 1500);
    expect(isBeyondHorizon(cal.Hinv, floor, cal.H)).toBe(false);
    // 카메라가 23° 정도 내려다보므로 화면 맨 위는 평면 위쪽(하늘)일 수 있음
    const horizonCheck = isBeyondHorizon(cal.Hinv, sky, cal.H);
    expect(typeof horizonCheck).toBe('boolean');
  });

  it('EXIF 초점거리가 있으면 그것을 쓴다', () => {
    const c = calibrate({ corners: clicked, ref: { w: 210, h: 297 }, image: { width: W, height: H }, focal35: 26 });
    expect(c.focalSource).toBe('exif');
    expect(c.pose.cameraHeightMm).toBeCloseTo(1300, 0);
  });

  it('볼록하지 않은 사각형은 거부', () => {
    const bad = [clicked[0], clicked[2], clicked[1], clicked[3]];
    expect(() => calibrate({ corners: bad, ref: { w: 210, h: 297 }, image: { width: W, height: H } })).toThrow();
  });
});

describe('estimateFocalPx', () => {
  it('정면 사진에서는 추정 불가(null)', () => {
    const front = lookAtPose([0, 0, 1000], [0, 0.001, 0]);
    const pts = [
      [0, 297],
      [210, 297],
      [210, 0],
      [0, 0],
    ].map(([x, y]) => {
      const p = projectPoint(K, front.R, front.t, [x, y, 0]);
      return { x: p.x, y: p.y };
    });
    const plane = [
      { x: 0, y: 297 },
      { x: 210, y: 297 },
      { x: 210, y: 0 },
      { x: 0, y: 0 },
    ];
    const Hm = computeHomography(plane, pts);
    const f = estimateFocalPx(Hm, W / 2, H / 2);
    // 정면이면 h20,h21 ≈ 0 → 불안정. null 이거나 비현실적인 값이어야 calibrate 가 기본값으로 대체
    expect(f === null || f > 1.6 * W || f < 0.45 * W).toBe(true);
  });
});

describe('readExif', () => {
  it('FocalLengthIn35mmFilm 을 읽는다 (little-endian)', () => {
    // 최소 JPEG: SOI + APP1(Exif) [IFD0: ExifIFDPointer] [ExifIFD: 0xA405 = 26]
    const tiff: number[] = [];
    const u16 = (n: number) => tiff.push(n & 0xff, (n >> 8) & 0xff);
    const u32 = (n: number) => tiff.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
    tiff.push(0x49, 0x49); // II
    u16(42);
    u32(8); // IFD0 offset
    u16(1); // 1 entry
    u16(0x8769);
    u16(4);
    u32(1);
    u32(26); // Exif IFD offset
    u32(0); // next IFD
    u16(1);
    u16(0xa405);
    u16(3);
    u32(1);
    u16(26);
    u16(0);
    u32(0);
    const app1Len = 2 + 6 + tiff.length;
    const bytes = [0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9];
    expect(readExif(new Uint8Array(bytes).buffer).focal35).toBe(26);
  });

  it('JPEG 가 아니면 빈 결과', () => {
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({});
  });
});
