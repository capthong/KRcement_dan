// 꼭짓점 자동 보정(코너 스냅) + 측정 불확실도 추정.
// 시뮬레이션(tests/accuracy.sim.test.ts)에서 탭 오차 σ 4px → 1px 로 줄이면 측정 오차가 약 5배 줄었다.

import { calibrate, type CalibrationInput } from './calibrate';
import { type Pt, planeDistanceMm } from './homography';

export interface GrayPatch {
  data: Float32Array;
  width: number;
  height: number;
  /** 패치 (0,0) 이 원본 이미지에서 어디인지 */
  ox: number;
  oy: number;
}

/** RGBA → 회색조 패치 */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number, ox = 0, oy = 0): GrayPatch {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return { data, width, height, ox, oy };
}

function gradients(p: GrayPatch) {
  const { data, width: w, height: h } = p;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // Sobel
      gx[i] =
        data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
      gy[i] =
        data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
    }
  }
  return { gx, gy };
}

/**
 * (x, y) 근처 반경 r 안에서 가장 강한 코너(Shi-Tomasi)를 찾고,
 * OpenCV cornerSubPix 와 같은 원리(창 안의 그래디언트가 코너를 향하는 직선과 직교)로 서브픽셀 보정.
 * 코너 반응이 약하면 null (사용자 탭을 그대로 쓴다).
 */
export function refineCorner(p: GrayPatch, x: number, y: number, r: number, win = 4): Pt | null {
  const { width: w, height: h } = p;
  const { gx, gy } = gradients(p);
  // 연속 좌표에서 픽셀 i 는 [i, i+1) 를 덮으므로 중심은 i+0.5 → 인덱스 좌표로 변환
  const lx = x - p.ox - 0.5;
  const ly = y - p.oy - 0.5;
  let best = -1;
  let bx = -1;
  let by = -1;
  let maxGrad = 0;
  for (let i = 0; i < gx.length; i++) maxGrad = Math.max(maxGrad, Math.abs(gx[i]) + Math.abs(gy[i]));
  if (maxGrad < 40) return null; // 대비가 거의 없는 영역

  for (let cy = Math.max(win + 1, Math.floor(ly - r)); cy <= Math.min(h - win - 2, Math.ceil(ly + r)); cy++) {
    for (let cx = Math.max(win + 1, Math.floor(lx - r)); cx <= Math.min(w - win - 2, Math.ceil(lx + r)); cx++) {
      if ((cx - lx) ** 2 + (cy - ly) ** 2 > r * r) continue;
      let a = 0;
      let b = 0;
      let c = 0;
      for (let dy = -win; dy <= win; dy++) {
        for (let dx = -win; dx <= win; dx++) {
          const i = (cy + dy) * w + (cx + dx);
          a += gx[i] * gx[i];
          b += gx[i] * gy[i];
          c += gy[i] * gy[i];
        }
      }
      const tr = a + c;
      const minEig = tr / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
      if (minEig > best) {
        best = minEig;
        bx = cx;
        by = cy;
      }
    }
  }
  if (bx < 0) return null;
  // 코너 반응이 너무 약하면(직선 모서리 위·평탄 영역) 신뢰하지 않음
  const norm = best / ((2 * win + 1) ** 2 * maxGrad * maxGrad);
  if (norm < 0.002) return null;

  // 서브픽셀 반복
  let qx = bx;
  let qy = by;
  for (let it = 0; it < 8; it++) {
    let a = 0;
    let b = 0;
    let c = 0;
    let bbx = 0;
    let bby = 0;
    const cx0 = Math.round(qx);
    const cy0 = Math.round(qy);
    if (cx0 - win < 1 || cy0 - win < 1 || cx0 + win >= w - 1 || cy0 + win >= h - 1) break;
    for (let dy = -win; dy <= win; dy++) {
      for (let dx = -win; dx <= win; dx++) {
        const px = cx0 + dx;
        const py = cy0 + dy;
        const i = py * w + px;
        const gxx = gx[i] * gx[i];
        const gxy = gx[i] * gy[i];
        const gyy = gy[i] * gy[i];
        a += gxx;
        b += gxy;
        c += gyy;
        bbx += gxx * px + gxy * py;
        bby += gxy * px + gyy * py;
      }
    }
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-9) break;
    const nx = (c * bbx - b * bby) / det;
    const ny = (a * bby - b * bbx) / det;
    const moved = Math.hypot(nx - qx, ny - qy);
    qx = nx;
    qy = ny;
    if (moved < 0.01) break;
  }
  if (Math.hypot(qx - lx, qy - ly) > r * 1.5) return null;
  return { x: qx + p.ox + 0.5, y: qy + p.oy + 0.5 };
}

/** 결정적 가우시안 난수 (UI 에서 값이 깜빡이지 않도록 시드 고정) */
function gaussian(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
}

export interface TapNoise {
  /** 꼭짓점별 위치 오차 σ [이미지 px] — 자동 보정된 꼭짓점은 서브픽셀(≈0.5px) */
  cornerSigmaPx: number[];
  /** 측정 끝점 탭 오차 σ [이미지 px] */
  endSigmaPx: number;
}

/**
 * 꼭짓점·끝점 위치 오차를 가정했을 때 이 측정값이 얼마나 흔들리는지(90% 구간 상대오차).
 * 사용자에게 "1,200mm ± 3%" 처럼 보여 주고, 너무 크면 다시 찍도록 안내한다.
 */
export function measurementUncertainty(calInput: CalibrationInput, a: Pt, b: Pt, noise: TapNoise, trials = 120): number {
  const n = gaussian(1234);
  const j = (p: Pt, s: number) => ({ x: p.x + n() * s, y: p.y + n() * s });
  const base = planeDistanceMm(calibrate(calInput).Hinv, a, b);
  const errs: number[] = [];
  for (let i = 0; i < trials; i++) {
    try {
      const cal = calibrate({ ...calInput, corners: calInput.corners.map((c, k) => j(c, noise.cornerSigmaPx[k] ?? 2)) });
      const d = planeDistanceMm(cal.Hinv, j(a, noise.endSigmaPx), j(b, noise.endSigmaPx));
      errs.push(Number.isFinite(d) ? Math.abs(d - base) / base : 10);
    } catch {
      errs.push(10);
    }
  }
  errs.sort((x, y) => x - y);
  return errs[Math.floor(0.9 * (errs.length - 1))];
}
