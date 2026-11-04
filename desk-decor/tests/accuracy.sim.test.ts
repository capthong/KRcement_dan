// 몬테카를로 정확도 시뮬레이션: "사진 1장 + 기준물체" 방식의 측정 오차가 얼마나 되는가?
// 결과 표는 보고서 5장(구현 제한)에 그대로 인용한다.  실행: npx vitest run tests/accuracy.sim.test.ts
import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/geometry/calibrate';
import { planeDistanceMm } from '../src/geometry/homography';
import type { Vec3 } from '../src/geometry/linalg';
import { lookAtPose, makeIntrinsics, projectPoint } from '../src/geometry/pose';

function rng(seed: number) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const u = Math.max(uni(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uni());
  };
}

interface Scenario {
  name: string;
  eye: Vec3;
  target: Vec3;
  ref: { w: number; h: number; x0: number; y0: number };
  seg: [Vec3, Vec3];
  sigmaPx: number;
}

const W = 4032;
const H = 3024;
const K = makeIntrinsics(W, H, (W * 26) / 36);

function run(s: Scenario, trials = 2000) {
  const { R, t } = lookAtPose(s.eye, s.target);
  const proj = (p: Vec3) => {
    const q = projectPoint(K, R, t, p);
    return { x: q.x, y: q.y };
  };
  const n = rng(42);
  const jitter = (p: { x: number; y: number }) => ({ x: p.x + n() * s.sigmaPx, y: p.y + n() * s.sigmaPx });
  const { w, h, x0, y0 } = s.ref;
  const corners: Vec3[] = [
    [x0, y0 + h, 0],
    [x0 + w, y0 + h, 0],
    [x0 + w, y0, 0],
    [x0, y0, 0],
  ];
  const truth = Math.hypot(s.seg[0][0] - s.seg[1][0], s.seg[0][1] - s.seg[1][1]);
  const errs: number[] = [];
  let failures = 0;
  for (let i = 0; i < trials; i++) {
    try {
      const cal = calibrate({
        corners: corners.map((c) => jitter(proj(c))),
        ref: { w: Math.min(w, h), h: Math.max(w, h) },
        image: { width: W, height: H },
      });
      const d = planeDistanceMm(cal.Hinv, jitter(proj(s.seg[0])), jitter(proj(s.seg[1])));
      errs.push(Math.abs(d - truth) / truth);
    } catch {
      failures++;
    }
  }
  errs.sort((a, b) => a - b);
  const pct = (q: number) => (errs.length ? errs[Math.floor(q * (errs.length - 1))] * 100 : NaN);
  // 기준물체가 사진에서 차지하는 크기(짧은 쪽 픽셀) — 정확도를 가르는 핵심 변수
  const px = corners.map(proj);
  const refPx = Math.min(
    Math.hypot(px[0].x - px[1].x, px[0].y - px[1].y),
    Math.hypot(px[1].x - px[2].x, px[1].y - px[2].y),
  );
  return { median: pct(0.5), p90: pct(0.9), failures, refPx };
}

const floorEye: Vec3 = [0, -1200, 1300];
const floorTarget: Vec3 = [0, 1000, 0];
// 기준물체를 카메라 가까이(측정 대상과 멀리) 둔 경우 vs 측정 대상 바로 옆에 둔 경우
const a4Near = { w: 210, h: 297, x0: -105, y0: 300 };
const a4AtWall = { w: 210, h: 297, x0: -105, y0: 1450 };
const a3AtWall = { w: 297, h: 420, x0: -148, y0: 1350 };
const cardAtWall = { w: 53.98, h: 85.6, x0: -27, y0: 1650 };
const wallGap: [Vec3, Vec3] = [
  [-800, 1800, 0],
  [800, 1800, 0],
];

const deskEye: Vec3 = [0, -650, 500]; // 책상 상판 기준, 앉은 눈높이 정도
const deskTarget: Vec3 = [0, 400, 0];
const a4Desk = { w: 210, h: 297, x0: -105, y0: 50 };
const deskWidth: [Vec3, Vec3] = [
  [-600, 550, 0],
  [600, 550, 0],
];

const floor = (name: string, ref: Scenario['ref'], sigmaPx: number): Scenario => ({
  name,
  eye: floorEye,
  target: floorTarget,
  ref,
  seg: wallGap,
  sigmaPx,
});

const scenarios: Scenario[] = [
  floor('바닥 · A4를 카메라 앞(측정 대상과 1.5m 떨어짐) · 자동 꼭짓점 검출 가정 σ=1px', a4Near, 1),
  floor('바닥 · A4를 카메라 앞 · 신중한 탭 σ=4px', a4Near, 4),
  floor('바닥 · A4를 카메라 앞 · 대충 탭 σ=12px', a4Near, 12),
  floor('바닥 · A4를 측정 대상 바로 옆 · 자동 검출 σ=1px', a4AtWall, 1),
  floor('바닥 · A4를 측정 대상 바로 옆 · 신중한 탭 σ=4px', a4AtWall, 4),
  floor('바닥 · A4를 측정 대상 바로 옆 · 대충 탭 σ=12px', a4AtWall, 12),
  floor('바닥 · A3(=A4 2장)를 측정 대상 옆 · 신중한 탭 σ=4px', a3AtWall, 4),
  floor('바닥 · 신용카드를 측정 대상 옆 · 신중한 탭 σ=4px', cardAtWall, 4),
  { name: '책상 위 · A4 · 상판 폭 1.2m · 신중한 탭 σ=4px', eye: deskEye, target: deskTarget, ref: a4Desk, seg: deskWidth, sigmaPx: 4 },
  { name: '책상 위 · A4 · 상판 폭 1.2m · 대충 탭 σ=12px', eye: deskEye, target: deskTarget, ref: a4Desk, seg: deskWidth, sigmaPx: 12 },
];

describe('정확도 시뮬레이션 (4032×3024, 26mm 환산)', () => {
  const rows = scenarios.map((s) => ({ s, r: run(s) }));
  // 인덱스: 0~2 바닥·A4 앞, 3~5 바닥·A4 벽 옆, 6 A3 벽 옆, 7 카드, 8~9 책상 위

  it('결과 표 출력', () => {
    console.log('\n| 시나리오 | 기준물체 크기(px) | 중앙값 오차 | 90% 오차 | 앱이 거부한 비율 |');
    console.log('|---|---:|---:|---:|---:|');
    for (const { s, r } of rows) {
      const f = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—');
      console.log(`| ${s.name} | ${Math.round(r.refPx)} | ${f(r.median)} | ${f(r.p90)} | ${((r.failures / 2000) * 100).toFixed(0)}% |`);
    }
  });

  it('기준물체가 사진에서 클수록(가까이서 찍을수록) 정확하다: 책상 위 A4 σ=4px 중앙값 < 3%', () => {
    expect(rows[8].r.refPx).toBeGreaterThan(rows[1].r.refPx);
    expect(rows[8].r.median).toBeLessThan(3);
    expect(rows[8].r.median).toBeLessThan(rows[1].r.median);
  });

  it('같은 위치라면 큰 기준물체(A3)가 A4 보다 정확하다', () => {
    expect(rows[6].r.median).toBeLessThan(rows[4].r.median);
  });

  it('너무 작게 찍힌 기준물체(멀리 있는 신용카드)는 앱이 거부한다', () => {
    expect(rows[7].r.failures).toBeGreaterThan(0);
  });

  it('탭 정밀도가 오차를 좌우한다 (σ 1px < 4px < 12px)', () => {
    expect(rows[3].r.median).toBeLessThan(rows[4].r.median);
    expect(rows[4].r.median).toBeLessThan(rows[5].r.median);
  });

  it('평면 밖의 점은 측정하면 안 된다 (높이 300mm 점의 오차)', () => {
    const { R, t } = lookAtPose(floorEye, floorTarget);
    const proj = (p: Vec3) => {
      const q = projectPoint(K, R, t, p);
      return { x: q.x, y: q.y };
    };
    const c: Vec3[] = [
      [-105, 597, 0],
      [105, 597, 0],
      [105, 300, 0],
      [-105, 300, 0],
    ];
    const cal = calibrate({ corners: c.map(proj), ref: { w: 210, h: 297 }, image: { width: W, height: H } });
    // 바닥에서 300mm 높이(예: 서랍장 윗면)의 두 점 사이 실제 1600mm
    const d = planeDistanceMm(cal.Hinv, proj([-800, 1800, 300]), proj([800, 1800, 300]));
    const err = Math.abs(d - 1600) / 1600;
    console.log(`평면 밖(높이 300mm) 1.6m 측정 결과: ${Math.round(d)}mm (오차 ${(err * 100).toFixed(0)}%)`);
    expect(err).toBeGreaterThan(0.1);
  });
});
