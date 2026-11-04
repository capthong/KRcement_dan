import { describe, expect, it } from 'vitest';
import { measurementUncertainty, refineCorner, type GrayPatch } from '../src/geometry/corner';

/** 회색 바닥 위 흰 사각형(원근 왜곡된 사변형)을 4x4 슈퍼샘플링으로 렌더 */
function renderQuad(w: number, h: number, quad: { x: number; y: number }[], noise = 0): GrayPatch {
  const inside = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  };
  const data = new Float32Array(w * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) s += inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) ? 1 : 0;
      data[y * w + x] = 90 + (s / 16) * 150 + noise * rnd();
    }
  }
  return { data, width: w, height: h, ox: 0, oy: 0 };
}

// 시계 방향(화면 좌표, y 아래) 사변형
const quad = [
  { x: 20.3, y: 18.7 },
  { x: 95.6, y: 22.1 },
  { x: 102.2, y: 80.4 },
  { x: 14.8, y: 76.9 },
];

describe('refineCorner', () => {
  const img = renderQuad(120, 100, quad);

  it('4px 빗나간 탭을 실제 꼭짓점 0.5px 이내로 보정', () => {
    for (const c of quad) {
      const r = refineCorner(img, c.x + 3, c.y - 2.5, 8);
      expect(r).not.toBeNull();
      expect(Math.hypot(r!.x - c.x, r!.y - c.y)).toBeLessThan(0.5);
    }
  });

  it('노이즈가 있어도 1px 이내', () => {
    const noisy = renderQuad(120, 100, quad, 12);
    const c = quad[1];
    const r = refineCorner(noisy, c.x - 3, c.y + 3, 8);
    expect(r).not.toBeNull();
    expect(Math.hypot(r!.x - c.x, r!.y - c.y)).toBeLessThan(1);
  });

  it('평탄한 영역에서는 null (탭 위치 유지)', () => {
    const flat: GrayPatch = { data: new Float32Array(60 * 60).fill(120), width: 60, height: 60, ox: 0, oy: 0 };
    expect(refineCorner(flat, 30, 30, 8)).toBeNull();
  });

  it('직선 모서리 가운데(코너 아님)에서는 엉뚱한 곳으로 튀지 않는다', () => {
    const mid = { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 };
    const r = refineCorner(img, mid.x, mid.y, 6);
    if (r) expect(Math.hypot(r.x - mid.x, r.y - mid.y)).toBeLessThan(9);
  });
});

describe('measurementUncertainty', () => {
  const corners = [
    { x: 1700, y: 1500 },
    { x: 2300, y: 1500 },
    { x: 2450, y: 2100 },
    { x: 1550, y: 2100 },
  ];
  const input = { corners, ref: { w: 210, h: 297 }, image: { width: 4032, height: 3024 } };

  it('탭 오차가 클수록 불확실도가 커진다', () => {
    const a = { x: 1000, y: 1300 };
    const b = { x: 3000, y: 1300 };
    const u2 = measurementUncertainty(input, a, b, { cornerSigmaPx: [2, 2, 2, 2], endSigmaPx: 2 });
    const u10 = measurementUncertainty(input, a, b, { cornerSigmaPx: [10, 10, 10, 10], endSigmaPx: 10 });
    expect(u2).toBeGreaterThan(0);
    expect(u10).toBeGreaterThan(u2);
  });

  it('꼭짓점이 자동 보정(서브픽셀)되면 불확실도가 크게 줄어든다', () => {
    const a = { x: 1000, y: 1300 };
    const b = { x: 3000, y: 1300 };
    const manual = measurementUncertainty(input, a, b, { cornerSigmaPx: [8, 8, 8, 8], endSigmaPx: 4 });
    const snapped = measurementUncertainty(input, a, b, { cornerSigmaPx: [0.5, 0.5, 0.5, 0.5], endSigmaPx: 4 });
    expect(snapped).toBeLessThan(manual / 2);
  });
});
