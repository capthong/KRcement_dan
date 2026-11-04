// 평면 호모그래피: 사진 속 "바닥(또는 책상) 평면"과 실제 mm 좌표 사이의 변환.
// 기준 물체(A4 등)의 네 꼭짓점만 알면, 같은 평면 위의 임의 두 점 사이 실제 거리를 잴 수 있다.
import { type Mat3, mat3Inv, mat3Mul, solveLinear } from './linalg';

export interface Pt {
  x: number;
  y: number;
}

/** Hartley 정규화: 중심을 원점으로, 평균 거리를 √2 로 맞춰 수치 안정성을 높인다. */
function normalizer(pts: Pt[]): Mat3 {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
  const k = d > 0 ? Math.SQRT2 / d : 1;
  return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
}

/**
 * src → dst 로 보내는 호모그래피 H (h22 = 1 로 정규화).
 * 4점이면 정확해(exact), 5점 이상이면 최소제곱해.
 */
export function computeHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== dst.length || src.length < 4) throw new Error('need >= 4 point pairs');
  const Ts = normalizer(src);
  const Td = normalizer(dst);
  const s = src.map((p) => applyHomography(Ts, p));
  const d = dst.map((p) => applyHomography(Td, p));

  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const { x, y } = s[i];
    const { x: u, y: v } = d[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }

  let h: number[];
  if (rows.length === 8) {
    h = solveLinear(rows, rhs);
  } else {
    // 정규방정식 (AᵀA) h = Aᵀb
    const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    const Atb = new Array<number>(8).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let i = 0; i < 8; i++) {
        Atb[i] += rows[r][i] * rhs[r];
        for (let j = 0; j < 8; j++) AtA[i][j] += rows[r][i] * rows[r][j];
      }
    }
    h = solveLinear(AtA, Atb);
  }
  const Hn: Mat3 = [...h, 1];
  const H = mat3Mul(mat3Inv(Td), mat3Mul(Hn, Ts));
  const k = H[8];
  return H.map((v) => v / k);
}

export function applyHomography(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/** 이미지 좌표 두 점 → (평면 위라고 가정할 때) 실제 거리[mm]. Hinv: 이미지→평면 */
export function planeDistanceMm(Hinv: Mat3, a: Pt, b: Pt): number {
  const A = applyHomography(Hinv, a);
  const B = applyHomography(Hinv, b);
  return Math.hypot(A.x - B.x, A.y - B.y);
}

/**
 * 점이 평면의 "지평선" 너머(카메라 뒤쪽으로 투영되는 영역)에 있는지.
 * 지평선 위를 찍으면 호모그래피가 터무니없는 값을 내므로 UI 에서 막는다.
 */
export function isBeyondHorizon(Hinv: Mat3, p: Pt, Href: Mat3): boolean {
  // 평면→이미지 H 의 세 번째 행으로 깊이 부호를 판단: w = h20 X + h21 Y + h22
  const P = applyHomography(Hinv, p);
  const w = Href[6] * P.x + Href[7] * P.y + Href[8];
  return !(w > 0) || !Number.isFinite(P.x) || !Number.isFinite(P.y);
}
