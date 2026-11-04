// 치수 → 디테일 있는 3D 모델 (절차적 모델링).
// 단순 박스 대신 실제 제품의 구조(텔레스코픽 기둥, 베젤·곡면 패널, 키캡, 5발 의자 다리, 메쉬 등판 등)를 재현한다.
// 단위: m. 원점 = 바닥 투영 중심의 바닥면, 앞면 = +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DESK_THICKNESS, type Item, KEYBOARDS, MATS, dims, monitorGeom } from './items';
import {
  type WoodTone,
  displayTexture,
  fabricTexture,
  laptopDeckTexture,
  leafTexture,
  meshAlpha,
  rng,
  screenTexture,
  woodTexture,
} from './textures';

const mm = (v: number) => v / 1000;

// ───────────── 재질 ─────────────
const mats = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, f: () => T): T {
  let m = mats.get(key);
  if (!m) {
    m = f();
    mats.set(key, m);
  }
  return m as T;
}
export const M = {
  powder: (c: string) => cached(`powder${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.4 })),
  alu: () => cached('alu', () => new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3, metalness: 0.9 })),
  darkAlu: () => cached('dalu', () => new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 0.35, metalness: 0.85 })),
  chrome: () => cached('chrome', () => new THREE.MeshStandardMaterial({ color: '#e9eaec', roughness: 0.1, metalness: 1 })),
  plastic: (c: string, rough = 0.45) =>
    cached(`pl${c}${rough}`, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5 })),
  matte: (c: string, rough = 0.85) => cached(`mt${c}${rough}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: rough })),
  rubber: () => cached('rubber', () => new THREE.MeshStandardMaterial({ color: '#1b1b1c', roughness: 0.95 })),
  wood: (tone: WoodTone, rx = 1, ry = 1) =>
    cached(`wood${tone}${rx.toFixed(2)}${ry.toFixed(2)}`, () => {
      const map = woodTexture(tone).clone();
      map.needsUpdate = true;
      map.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map, roughness: tone === 'white' || tone === 'black' ? 0.5 : 0.62, metalness: 0 });
    }),
  fabric: (c: string, rx = 1, ry = 1) =>
    cached(`fab${c}${rx}${ry}`, () => {
      const map = fabricTexture(c).clone();
      map.needsUpdate = true;
      map.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
    }),
  mesh: (c: string) =>
    cached(`mesh${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, alphaMap: meshRepeat(), alphaTest: 0.45, side: THREE.DoubleSide })),
  glow: (c: string, k = 2) => cached(`glow${c}${k}`, () => new THREE.MeshStandardMaterial({ color: '#000', emissive: c, emissiveIntensity: k })),
  glass: () =>
    cached('glass', () => new THREE.MeshPhysicalMaterial({ color: '#202630', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.6 })),
  screen: (variant: number, aspect: number, flip = false) =>
    cached(`scr${variant}${aspect.toFixed(2)}${flip}`, () => {
      let tex = screenTexture(variant, aspect);
      if (flip) {
        tex = tex.clone();
        tex.needsUpdate = true;
        tex.repeat.x = -1;
        tex.offset.x = 1;
      }
      return new THREE.MeshStandardMaterial({ color: '#050608', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.95, roughness: 0.16, metalness: 0 });
    }),
};
function meshRepeat() {
  const t = meshAlpha().clone();
  t.needsUpdate = true;
  t.repeat.set(9, 9);
  return t;
}

// ───────────── 기본 도형 ─────────────
const geoCache = new Map<string, THREE.BufferGeometry>();
function rgeo(w: number, h: number, d: number, r: number, seg = 3) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${rr.toFixed(4)}|${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, seg, Math.max(rr, 1e-4));
    geoCache.set(key, g);
  }
  return g;
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}
/** 둥근 모서리 박스. (x, y, z) 는 박스 중심 */
function rbox(w: number, h: number, d: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  return mesh(rgeo(w, h, d, r), m, x, y, z);
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 24) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
}
/** 두 점을 잇는 막대(원통) */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const len = a.distanceTo(b);
  const o = mesh(new THREE.CylinderGeometry(r, r, len, 16), m);
  o.position.copy(a).lerp(b, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return o;
}
/** 평면 둥근 사각형을 두께만큼 세운 판 (매트·모니터 받침 등) */
function slab(w: number, d: number, t: number, r: number, m: THREE.Material, bevel = 0) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: t - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  // ExtrudeGeometry 의 UV 는 도형 좌표(m) 그대로 → 텍스처 반복이 실제 크기를 따름
  return mesh(g, m);
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const FRAME_COLOR: Record<string, string> = { black: '#1f2124', white: '#e8e8e6', gray: '#8d9096' };

// ───────────── 책상 ─────────────
function desk(it: Item, g: THREE.Group) {
  const o = it.opt;
  const W = mm(Number(o.w));
  const D = mm(Number(o.d));
  const H = mm(dims(it).h);
  const T = mm(DESK_THICKNESS);
  const tone = (o.top as WoodTone) ?? 'oak';
  const frame = M.powder(FRAME_COLOR[String(o.frame)] ?? FRAME_COLOR.black);
  g.add(rbox(W, T, D, 0.004, M.wood(tone, W / 1.2, D / 0.6), 0, H - T / 2, 0));
  if (o.type === 'motion') {
    const lx = W / 2 - 0.13;
    const frameBottom = H - T - 0.03;
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      g.add(rbox(0.075, 0.032, D - 0.05, 0.014, frame, x, 0.016, 0));
      for (const sz of [-1, 1]) g.add(cyl(0.012, 0.014, 0.008, M.rubber(), x, 0.004, sz * (D / 2 - 0.06)));
      // 3단 텔레스코픽 기둥: 높이를 올리면 가운데 단이 길어진다
      const b = 0.4;
      const t = 0.24;
      g.add(rbox(0.088, b, 0.066, 0.006, frame, x, 0.032 + b / 2, 0));
      const midBot = 0.032 + b - 0.05;
      const midTop = Math.max(midBot + 0.08, frameBottom - t + 0.05);
      g.add(rbox(0.079, midTop - midBot, 0.058, 0.005, frame, x, (midBot + midTop) / 2, 0));
      g.add(rbox(0.07, t, 0.05, 0.005, frame, x, frameBottom - t / 2, 0));
      // 상판 지지대 + 모터 커버
      g.add(rbox(0.06, 0.03, D - 0.12, 0.005, frame, x, H - T - 0.015, 0));
      g.add(rbox(0.1, 0.045, 0.08, 0.008, frame, x, frameBottom - 0.02, 0));
    }
    g.add(rbox(W - 0.26, 0.04, 0.05, 0.005, frame, 0, H - T - 0.022, 0));
    // 컨트롤러 + 높이 표시
    const cx = W / 2 - 0.3;
    const cz = D / 2 - 0.035;
    g.add(rbox(0.13, 0.024, 0.055, 0.009, M.plastic('#202124', 0.4), cx, H - T - 0.012, cz));
    const disp = new THREE.Mesh(
      new THREE.PlaneGeometry(0.036, 0.0135),
      new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: displayTexture((Number(o.height) / 10).toFixed(1)), emissiveIntensity: 1.3 }),
    );
    disp.position.set(cx - 0.03, H - T - 0.012, cz + 0.0281);
    g.add(disp);
    for (const k of [0, 1]) g.add(cyl(0.006, 0.006, 0.004, M.plastic('#3a3b3e'), cx + 0.02 + k * 0.025, H - T - 0.012, cz + 0.028, 16).rotateX(Math.PI / 2));
  } else {
    const legH = H - T;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        g.add(rbox(0.05, legH, 0.05, 0.006, frame, sx * (W / 2 - 0.06), legH / 2, sz * (D / 2 - 0.06)));
        g.add(cyl(0.016, 0.016, 0.008, M.rubber(), sx * (W / 2 - 0.06), 0.004, sz * (D / 2 - 0.06)));
      }
      g.add(rbox(0.04, 0.035, D - 0.12, 0.004, frame, sx * (W / 2 - 0.06), H - T - 0.0175, 0));
    }
    g.add(rbox(W - 0.12, 0.035, 0.03, 0.004, frame, 0, H - T - 0.0175, -(D / 2 - 0.06)));
    g.add(rbox(W - 0.12, 0.03, 0.03, 0.004, frame, 0, 0.12, -(D / 2 - 0.06)));
  }
}

// ───────────── 모니터 ─────────────
function curvedShell(R: number, t: number, phi: number, height: number, m: THREE.Material) {
  const s = new THREE.Shape();
  const a0 = Math.PI / 2 + phi / 2;
  const a1 = Math.PI / 2 - phi / 2;
  s.absarc(0, -R, R + t, a0, a1, true);
  s.absarc(0, -R, R, a1, a0, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 72 });
  g.rotateX(-Math.PI / 2);
  return mesh(g, m);
}

function monitor(it: Item, g: THREE.Group, variant: number) {
  const o = it.opt;
  const geo = monitorGeom(String(o.size));
  const Pw = mm(geo.panelW);
  const Ph = mm(geo.panelH);
  const aw = mm(geo.activeW);
  const ah = mm(geo.activeH);
  const d = mm(dims(it).d);
  const arm = o.mount === 'arm';
  const bodyC = o.color === 'white' ? '#e9e9ea' : '#1b1c1f';
  const body = M.plastic(bodyC, 0.5);
  const bottom = arm ? 0.16 : 0.115;
  const cy = bottom + Ph / 2;
  const zp = arm ? 0.01 : d / 2 - 0.06; // 화면 앞면 위치
  const R = mm(geo.spec.curve);
  const panel = new THREE.Group();
  if (R > 0) {
    const shell = curvedShell(R, 0.012, Pw / R, Ph, body);
    shell.position.set(0, bottom, zp);
    panel.add(shell);
    const scr = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.0006, R - 0.0006, ah, 96, 1, true, Math.PI - aw / R / 2, aw / R),
      M.screen(variant, aw / ah, true),
    );
    (scr.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
    scr.position.set(0, cy + 0.0035, zp + R);
    panel.add(scr);
    panel.add(rbox(Pw * 0.38, Ph * 0.55, 0.05, 0.015, body, 0, cy - Ph * 0.06, zp - 0.012 - 0.022));
  } else {
    panel.add(rbox(Pw, Ph, 0.012, 0.004, body, 0, cy, zp - 0.006));
    panel.add(rbox(Pw * 0.64, Ph * 0.62, 0.034, 0.014, body, 0, cy - Ph * 0.07, zp - 0.012 - 0.016));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(aw, ah), M.screen(variant, aw / ah));
    scr.position.set(0, cy + 0.0035, zp + 0.0004);
    panel.add(scr);
  }
  // 하단 로고 점
  panel.add(mesh(new THREE.CircleGeometry(0.0025, 12), M.glow('#ffffff', 0.4), 0, bottom + 0.007, zp + (R > 0 ? 0.0001 : 0.0005)));
  g.add(panel);

  const backZ = zp - 0.012 - (R > 0 ? 0.045 : 0.035);
  if (arm) {
    // 클램프 + 기둥 + 2관절 가스 스프링 암
    const poleZ = -0.15;
    const top = cy + 0.02;
    g.add(rbox(0.07, 0.012, 0.1, 0.004, M.darkAlu(), 0, 0.006, poleZ));
    g.add(rbox(0.07, 0.012, 0.1, 0.004, M.darkAlu(), 0, -mm(DESK_THICKNESS) - 0.006, poleZ));
    g.add(rbox(0.07, mm(DESK_THICKNESS) + 0.024, 0.014, 0.004, M.darkAlu(), 0, -mm(DESK_THICKNESS) / 2, poleZ - 0.05));
    g.add(cyl(0.019, 0.019, top + 0.03, M.alu(), 0, (top + 0.03) / 2, poleZ));
    g.add(cyl(0.021, 0.021, 0.012, M.darkAlu(), 0, top + 0.036, poleZ));
    const a = V(0, top - 0.02, poleZ);
    const elbow = V(0.15, top - 0.02, (poleZ + backZ) / 2 - 0.02);
    const vesa = V(0, cy, backZ - 0.03);
    g.add(rod(a, elbow, 0.014, M.darkAlu()));
    g.add(rod(elbow, vesa, 0.013, M.darkAlu()));
    for (const p of [a, elbow]) g.add(cyl(0.02, 0.02, 0.05, M.darkAlu(), p.x, p.y, p.z));
    g.add(rbox(0.11, 0.11, 0.012, 0.004, M.darkAlu(), 0, cy, backZ - 0.006));
  } else {
    // 받침대: 기울어진 목 + 납작한 베이스
    const neckH = cy - 0.01;
    const neck = rbox(0.065, neckH, 0.03, 0.01, body, 0, neckH / 2 + 0.008, backZ - 0.015);
    neck.rotation.x = -0.1;
    g.add(neck);
    const bw = Math.min(0.32, Math.max(0.24, Pw * 0.36));
    const base = slab(bw, 0.19, 0.012, 0.035, body, 0.003);
    base.position.set(0, 0, backZ - 0.02 + (zp - backZ) * 0.15);
    g.add(base);
  }
  if (o.lightbar) {
    const len = Math.min(0.5, Pw * 0.75);
    const topY = bottom + Ph;
    const bar = cyl(0.012, 0.012, len, M.darkAlu(), 0, topY + 0.016, zp + 0.012);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    const strip = rbox(len - 0.02, 0.003, 0.008, 0.001, M.glow('#fff2dc', 3), 0, topY + 0.004, zp + 0.016);
    g.add(strip);
    g.add(rbox(0.045, 0.05, 0.02, 0.006, M.darkAlu(), 0, topY - 0.01, zp - 0.04));
    const spot = new THREE.SpotLight('#fff1d6', 2.2, 1.6, 0.85, 0.7, 1.5);
    spot.position.set(0, topY + 0.01, zp + 0.02);
    spot.target.position.set(0, 0, zp + 0.35);
    g.add(spot, spot.target);
  }
}

// ───────────── 키보드 ─────────────
type Row = number[];
const TKL: Row[] = [
  [1, -1, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.25, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, -0.25, 1, 1, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, -0.25, 1, 1, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75, -1.25, 1],
  [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25, -0.25, 1, 1, 1],
];
const NUMPAD: Row[] = [[], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1]];
const K75: Row[] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25, 1],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75, 1, 1],
  [1.25, 1.25, 1.25, 6.25, 1, 1, 1, -0.0, 1, 1, 1],
];
const KB_COLORS: Record<string, { case: string; alpha: string; mod: string; accent: string; metal: boolean }> = {
  white: { case: '#efefed', alpha: '#f6f6f3', mod: '#c9cdd2', accent: '#7fc8b1', metal: false },
  gray: { case: '#5b5f66', alpha: '#d9d3c7', mod: '#7d8189', accent: '#e07a3f', metal: true },
  black: { case: '#1e1f22', alpha: '#2b2d31', mod: '#3a3d42', accent: '#3a3d42', metal: false },
};

function keyboard(it: Item, g: THREE.Group) {
  const layout = String(it.opt.layout);
  const kb = KEYBOARDS[layout] ?? KEYBOARDS.tkl;
  const W = mm(kb.w);
  const D = mm(kb.d);
  const col = KB_COLORS[String(it.opt.color)] ?? KB_COLORS.white;
  const caseMat = col.metal ? new THREE.MeshStandardMaterial({ color: col.case, metalness: 0.75, roughness: 0.35 }) : M.plastic(col.case, 0.5);
  const tilt = new THREE.Group();
  tilt.rotation.x = 0.045;
  tilt.position.y = 0.006;
  tilt.add(rbox(W, 0.022, D, 0.006, caseMat, 0, 0.011, 0));
  const rows = layout === '75' ? K75 : TKL;
  const u = 0.01905;
  const keys: { x: number; z: number; w: number; mod: boolean; accent: boolean }[] = [];
  const place = (rs: Row[], x0: number) => {
    rs.forEach((row, ri) => {
      let x = x0;
      const z = (ri === 0 ? 0 : ri + (layout === '75' ? 0 : 0.25)) * u;
      row.forEach((w, ki) => {
        if (w < 0) {
          x += -w * u;
          return;
        }
        keys.push({ x: x + (w * u) / 2, z, w, mod: w > 1.01 || ri === 0 || (layout !== '75' && x > 15 * u), accent: ri === 0 && ki === 0 });
        x += w * u;
      });
    });
  };
  place(rows, 0);
  if (layout === 'full') place(NUMPAD, 18.5 * u);
  const maxX = Math.max(...keys.map((k) => k.x + (k.w * u) / 2));
  const maxZ = Math.max(...keys.map((k) => k.z)) + u;
  const cap = rgeo(u * 0.92, 0.0095, u * 0.9, 0.0022, 2);
  const inst = new THREE.InstancedMesh(cap, M.plastic('#ffffff', 0.55), keys.length);
  const m4 = new THREE.Matrix4();
  const c = new THREE.Color();
  keys.forEach((k, i) => {
    const sx = (k.w * u - u * 0.08) / (u * 0.92);
    m4.compose(V(k.x - maxX / 2, 0.026, k.z - maxZ / 2 + u / 2), new THREE.Quaternion(), V(sx, 1, 1));
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, c.set(k.accent ? col.accent : k.mod ? col.mod : col.alpha));
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  tilt.add(inst);
  g.add(tilt);
}

// ───────────── 작은 소품 ─────────────
function mouse(it: Item, g: THREE.Group) {
  const c = it.opt.color === 'black' ? '#202124' : '#f2f2f0';
  const body = mesh(new THREE.SphereGeometry(1, 40, 24), M.plastic(c, 0.35));
  body.scale.set(0.031, 0.02, 0.06);
  body.position.y = 0.016;
  g.add(body);
  const wheel = cyl(0.0048, 0.0048, 0.006, M.rubber(), 0, 0.035, 0.024);
  wheel.rotation.z = Math.PI / 2;
  g.add(wheel);
}

const MAT_COLORS: Record<string, string> = { charcoal: '#36393e', gray: '#8a8e93', beige: '#cbbd9f', navy: '#27324a' };
function deskMat(it: Item, g: THREE.Group) {
  const s = MATS[String(it.opt.size)] ?? MATS['900x400'];
  g.add(slab(mm(s.w), mm(s.d), 0.003, 0.02, M.fabric(MAT_COLORS[String(it.opt.color)] ?? MAT_COLORS.charcoal, 6, 6)));
}

function riser(it: Item, g: THREE.Group) {
  const W = mm(Number(it.opt.w));
  const tone = (it.opt.top as WoodTone) ?? 'walnut';
  g.add(rbox(W, 0.018, 0.24, 0.004, M.wood(tone, W / 1.2, 0.4), 0, 0.101, 0));
  for (const sx of [-1, 1]) {
    g.add(rbox(0.018, 0.092, 0.2, 0.004, M.powder('#1f2124'), sx * (W / 2 - 0.05), 0.046, 0));
  }
}

function lamp(it: Item, g: THREE.Group) {
  const c = it.opt.color === 'black' ? '#1f2124' : '#eeeeec';
  const body = M.plastic(c, 0.4);
  g.add(cyl(0.075, 0.08, 0.022, body, 0, 0.011, -0.03, 36));
  const a = V(0, 0.03, -0.03);
  const elbow = V(0, 0.33, -0.1);
  const head = V(0, 0.42, 0.08);
  g.add(rod(a, elbow, 0.008, M.darkAlu()));
  g.add(rod(elbow, head, 0.007, M.darkAlu()));
  for (const p of [a, elbow]) {
    const j = cyl(0.013, 0.013, 0.028, body, p.x, p.y, p.z);
    j.rotation.z = Math.PI / 2;
    g.add(j);
  }
  const shadeProfile = [V(0.012, 0.02, 0), V(0.03, 0.012, 0), V(0.062, -0.03, 0), V(0.064, -0.036, 0)].map((p) => new THREE.Vector2(p.x, p.y));
  const shade = mesh(new THREE.LatheGeometry(shadeProfile, 40), body);
  (shade.material as THREE.Material).side = THREE.DoubleSide;
  shade.position.copy(head);
  shade.rotation.x = 0.35;
  g.add(shade);
  const bulb = mesh(new THREE.CircleGeometry(0.05, 32), M.glow('#fff4e0', 4));
  bulb.rotation.x = Math.PI / 2 + 0.35;
  bulb.position.copy(head).add(V(0, -0.028, 0.012));
  g.add(bulb);
  const spot = new THREE.SpotLight('#ffedd1', 3, 1.8, 0.9, 0.6, 1.5);
  spot.position.copy(head).add(V(0, -0.03, 0.01));
  spot.target.position.set(0, -0.2, 0.3);
  g.add(spot, spot.target);
}

function speaker(it: Item, g: THREE.Group) {
  const W = 0.125;
  const H = 0.21;
  const D = 0.17;
  const wood = it.opt.color === 'wood';
  const bodyMat = wood ? M.wood('walnut', 0.3, 0.4) : it.opt.color === 'white' ? M.plastic('#efefed', 0.5) : M.matte('#26272a', 0.6);
  g.add(rbox(W, H, D, 0.008, bodyMat, 0, H / 2, 0));
  g.add(rbox(W - 0.012, H - 0.012, 0.006, 0.006, M.matte('#1c1c1e', 0.7), 0, H / 2, D / 2 - 0.0015));
  const cone = [
    [0.0, -0.012],
    [0.012, -0.011],
    [0.038, -0.002],
    [0.041, 0.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const woofer = mesh(new THREE.LatheGeometry(cone, 40), M.matte('#2f3135', 0.5));
  woofer.rotation.x = -Math.PI / 2;
  woofer.position.set(0, H * 0.36, D / 2 + 0.002);
  g.add(woofer);
  const sur = mesh(new THREE.TorusGeometry(0.041, 0.0035, 10, 40), M.rubber(), 0, H * 0.36, D / 2 + 0.002);
  g.add(sur);
  const cap = mesh(new THREE.SphereGeometry(0.012, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.matte('#3c3e43', 0.4));
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, H * 0.36, D / 2 - 0.006);
  g.add(cap);
  const tw = mesh(new THREE.SphereGeometry(0.011, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.alu());
  tw.rotation.x = Math.PI / 2;
  tw.position.set(0, H * 0.78, D / 2 + 0.001);
  g.add(tw);
  g.add(mesh(new THREE.TorusGeometry(0.017, 0.003, 8, 32), M.darkAlu(), 0, H * 0.78, D / 2 + 0.001));
}

function pc(it: Item, g: THREE.Group) {
  const d = dims(it);
  const W = mm(d.w);
  const H = mm(d.h);
  const D = mm(d.d);
  const white = it.opt.color === 'white';
  const shell = new THREE.MeshStandardMaterial({ color: white ? '#ececea' : '#18191b', roughness: 0.45, metalness: 0.55 });
  const lift = 0.02;
  // 다리
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.012, 0.014, lift, M.rubber(), sx * (W / 2 - 0.03), lift / 2, sz * (D / 2 - 0.05)));
  // 오른쪽 철판·윗면·아랫면·앞면 (왼쪽은 강화유리)
  const y0 = lift;
  g.add(rbox(0.006, H, D, 0.003, shell, W / 2 - 0.003, y0 + H / 2, 0));
  g.add(rbox(W, 0.006, D, 0.003, shell, 0, y0 + H - 0.003, 0));
  g.add(rbox(W, 0.006, D, 0.003, shell, 0, y0 + 0.003, 0));
  g.add(rbox(0.006, H, D, 0.003, M.matte('#111', 0.8), -W / 2 + 0.03, y0 + H / 2, 0)); // 메인보드 판 뒤 가림
  g.add(rbox(W, H, 0.012, 0.004, M.matte(white ? '#d8d8d6' : '#0f1012', 0.9), 0, y0 + H / 2, D / 2 - 0.006));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.01, H - 0.01), M.glass());
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(-W / 2, y0 + H / 2, 0);
  g.add(glass);
  // 내부: 메인보드, 그래픽카드, CPU 쿨러, 램, 팬
  const inner = new THREE.Group();
  inner.add(rbox(0.004, H * 0.62, D * 0.6, 0.002, M.matte('#1d2a24', 0.7), W / 2 - 0.012, y0 + H * 0.62, -D * 0.06));
  inner.add(rbox(W * 0.55, 0.045, D * 0.62, 0.006, M.matte('#202226', 0.4), W / 2 - 0.012 - W * 0.275, y0 + H * 0.38, 0.0));
  for (const z of [-0.1, 0.0, 0.1]) {
    inner.add(mesh(new THREE.TorusGeometry(0.035, 0.004, 8, 30), M.glow('#7c5cff', 1.6), -0.002, y0 + H * 0.38 - 0.024, z * (D / 0.46)).rotateX(Math.PI / 2));
  }
  inner.add(rbox(0.06, 0.12, 0.08, 0.01, M.alu(), W / 2 - 0.055, y0 + H * 0.68, -D * 0.12));
  inner.add(mesh(new THREE.TorusGeometry(0.045, 0.005, 8, 32), M.glow('#3ad1ff', 1.8), W / 2 - 0.086, y0 + H * 0.68, -D * 0.12).rotateY(Math.PI / 2));
  for (const k of [0, 1]) inner.add(rbox(0.035, 0.008, 0.012, 0.002, M.glow('#ff5ccd', 1.5), W / 2 - 0.035, y0 + H * 0.68 + 0.08, -D * 0.12 + 0.06 + k * 0.02));
  g.add(inner);
  for (const k of [0, 1, 2]) {
    const ring = mesh(new THREE.TorusGeometry(0.052, 0.005, 10, 40), M.glow(['#3ad1ff', '#7c5cff', '#ff5ccd'][k], 2.2), 0, y0 + H * (0.22 + k * 0.28), D / 2 - 0.02);
    g.add(ring);
  }
  g.add(mesh(new THREE.TorusGeometry(0.006, 0.0012, 6, 20), M.glow('#ffffff', 2), W * 0.25, y0 + H + 0.0005, D / 2 - 0.04).rotateX(Math.PI / 2));
}

function laptop(_it: Item, g: THREE.Group) {
  const tilt = 0.22;
  const stand = new THREE.Group();
  stand.add(rbox(0.24, 0.006, 0.2, 0.003, M.alu(), 0, 0, 0));
  stand.rotation.x = tilt;
  stand.position.set(0, 0.075, -0.01);
  g.add(stand);
  g.add(rbox(0.2, 0.006, 0.06, 0.003, M.alu(), 0, 0.003, 0.07));
  g.add(rod(V(0, 0.006, 0.06), V(0, 0.095, -0.08), 0.007, M.alu()));
  const lap = new THREE.Group();
  lap.add(rbox(0.31, 0.014, 0.215, 0.005, M.alu(), 0, 0.007, 0));
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.2), new THREE.MeshStandardMaterial({ map: laptopDeckTexture(), roughness: 0.5, metalness: 0.3 }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.0142;
  lap.add(deck);
  const lid = new THREE.Group();
  lid.add(rbox(0.31, 0.205, 0.006, 0.005, M.alu(), 0, 0.1025, 0));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.18), M.screen(2, 0.29 / 0.18));
  scr.position.set(0, 0.105, 0.0032);
  lid.add(scr);
  lid.position.set(0, 0.014, -0.105);
  lid.rotation.x = -1.83 + Math.PI / 2;
  lap.add(lid);
  lap.rotation.x = tilt;
  lap.position.set(0, 0.082, -0.01);
  g.add(lap);
}

function plant(it: Item, g: THREE.Group) {
  const r = rng(it.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0));
  const small = it.opt.size === 'desk';
  const k = small ? 0.38 : 1;
  const pot = [
    [0.0, 0],
    [0.11 * k, 0],
    [0.125 * k, 0.02 * k],
    [0.15 * k, 0.3 * k],
    [0.16 * k, 0.31 * k],
    [0.155 * k, 0.32 * k],
    [0.14 * k, 0.315 * k],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(mesh(new THREE.LatheGeometry(pot, 40), M.matte(small ? '#c9c2b6' : '#e7e2da', 0.9)));
  g.add(mesh(new THREE.CircleGeometry(0.14 * k, 32), M.matte('#3b2a1e', 1), 0, 0.3 * k, 0).rotateX(-Math.PI / 2));
  if (small) {
    // 다육이 로제트
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4;
      const ring = 0.012 + (i / 16) * 0.04;
      const leaf = mesh(new THREE.SphereGeometry(1, 16, 10), M.matte(i % 3 ? '#8fae8b' : '#a9c4a0', 0.7));
      leaf.scale.set(0.012, 0.03 - i * 0.0008, 0.02);
      leaf.position.set(Math.cos(a) * ring, 0.125 + (16 - i) * 0.0015, Math.sin(a) * ring);
      leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      g.add(leaf);
    }
    return;
  }
  // 산세베리아: 칼 모양 잎
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.55, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const h = 0.45 + r() * 0.35;
    const w = 0.045 + r() * 0.03;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.quadraticCurveTo(-w * 0.62, h * 0.5, 0, h);
    s.quadraticCurveTo(w * 0.62, h * 0.5, w / 2, 0);
    s.lineTo(-w / 2, 0);
    const geo = new THREE.ShapeGeometry(s, 12);
    // UV 를 잎 길이에 맞춤
    const uv = geo.attributes.uv;
    const pos = geo.attributes.position;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, (pos.getX(j) + w / 2) / w, pos.getY(j) / h);
    const leaf = mesh(geo, leafMat);
    const a = r() * Math.PI * 2;
    const rr = r() * 0.08;
    leaf.position.set(Math.cos(a) * rr, 0.29, Math.sin(a) * rr);
    leaf.rotation.set(Math.sin(a) * (0.08 + r() * 0.18), r() * Math.PI, -Math.cos(a) * (0.08 + r() * 0.18), 'YXZ');
    g.add(leaf);
  }
}

function shelf(it: Item, g: THREE.Group) {
  const W = mm(Number(it.opt.w));
  const H = mm(Number(it.opt.h));
  const D = 0.3;
  const t = 0.018;
  const wood = M.wood((it.opt.top as WoodTone) ?? 'oak', 0.4, 1.5);
  const woodH = M.wood((it.opt.top as WoodTone) ?? 'oak', W / 1.2, 0.5);
  for (const sx of [-1, 1]) g.add(rbox(t, H, D, 0.002, wood, sx * (W / 2 - t / 2), H / 2, 0));
  g.add(rbox(W - 2 * t, 0.006, 0.006, 0.001, wood, 0, H / 2, -D / 2 + 0.003));
  g.add(mesh(new THREE.PlaneGeometry(W - 2 * t, H), M.matte('#d9d4cb', 0.9), 0, H / 2, -D / 2 + 0.004));
  const levels = Math.max(3, Math.round(H / 0.36));
  const r = rng(it.id.length * 31 + W * 1000);
  const books = ['#3b4a6b', '#8c3b2f', '#c9a14a', '#2f5d50', '#d8d2c4', '#5a3e60', '#1f2a36', '#b5653a', '#7d8b6a'];
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  const bookList: { m: THREE.Matrix4; c: string }[] = [];
  for (let i = 0; i <= levels; i++) {
    const y = t / 2 + (i * (H - t)) / levels;
    g.add(rbox(W - 2 * t, t, D - 0.01, 0.002, woodH, 0, y, 0.005));
    if (i === levels) break;
    // 책
    const clearH = (H - t) / levels - t - 0.02;
    let x = -W / 2 + t + 0.01 + r() * 0.05;
    const end = W / 2 - t - 0.02 - (r() > 0.5 ? 0.18 : 0.02);
    while (x < end) {
      const bt = 0.016 + r() * 0.025;
      const bh = Math.min(clearH, 0.17 + r() * 0.1);
      const bd = 0.16 + r() * 0.06;
      if (x + bt > end) break;
      const m4 = new THREE.Matrix4().compose(V(x + bt / 2, y + t / 2 + bh / 2, -D / 2 + 0.02 + bd / 2), new THREE.Quaternion(), V(bt, bh, bd));
      bookList.push({ m: m4, c: books[Math.floor(r() * books.length)] });
      x += bt + 0.0015;
      if (r() > 0.93) x += 0.06;
    }
    if (r() > 0.4) {
      const vase = cyl(0.035, 0.03, 0.12, M.matte(['#e6e1d8', '#4f6b5c', '#c87f5a'][i % 3], 0.6), W / 2 - t - 0.1, y + t / 2 + 0.06, 0);
      g.add(vase);
    }
  }
  const inst = new THREE.InstancedMesh(bookGeo, M.matte('#ffffff', 0.75), bookList.length);
  const c = new THREE.Color();
  bookList.forEach((b, i) => {
    inst.setMatrixAt(i, b.m);
    inst.setColorAt(i, c.set(b.c));
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  g.add(inst);
}

// ───────────── 의자 ─────────────
function chair(it: Item, g: THREE.Group) {
  const col = String(it.opt.color);
  const frameC = col === 'white' ? '#e6e6e4' : col === 'gray' ? '#6b6f75' : '#1d1e21';
  const meshC = col === 'white' ? '#cfd2d6' : col === 'gray' ? '#7f848b' : '#26282c';
  const frame = M.plastic(frameC, 0.45);
  // 5발 베이스 + 바퀴
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5 + Math.PI / 2;
    const arm = rbox(0.3, 0.032, 0.048, 0.012, M.darkAlu());
    arm.position.set(Math.cos(a) * 0.16, 0.095, -Math.sin(a) * 0.16);
    arm.rotation.y = a;
    arm.rotation.z = 0.08;
    g.add(arm);
    const cx = Math.cos(a) * 0.3;
    const cz = -Math.sin(a) * 0.3;
    g.add(rbox(0.028, 0.04, 0.03, 0.006, M.matte('#202124', 0.5), cx, 0.065, cz));
    for (const s of [-1, 1]) {
      const wheel = cyl(0.026, 0.026, 0.012, M.plastic('#2a2b2e', 0.4), cx + Math.cos(a + Math.PI / 2) * 0.012 * s, 0.026, cz - Math.sin(a + Math.PI / 2) * 0.012 * s, 20);
      wheel.rotation.set(0, a, Math.PI / 2, 'YXZ');
      g.add(wheel);
    }
  }
  g.add(cyl(0.045, 0.05, 0.05, M.darkAlu(), 0, 0.1, 0));
  g.add(cyl(0.026, 0.026, 0.24, M.matte('#202124', 0.5), 0, 0.24, 0));
  g.add(cyl(0.015, 0.015, 0.08, M.chrome(), 0, 0.39, 0));
  g.add(rbox(0.24, 0.05, 0.26, 0.01, frame, 0, 0.43, -0.01));
  // 좌판
  g.add(rbox(0.5, 0.075, 0.49, 0.034, M.fabric(meshC, 4, 4), 0, 0.49, 0.0));
  g.add(rbox(0.48, 0.02, 0.47, 0.008, frame, 0, 0.452, 0.0));
  // 등판: 곡면 메쉬 + 테두리 프레임 (뒤로 약간 젖힘)
  const back = new THREE.Group();
  const R = 0.55;
  const span = 0.86;
  const bh = 0.52;
  const panel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bh, 32, 1, true, Math.PI - span / 2, span), M.mesh(meshC));
  panel.position.set(0, bh / 2, R);
  back.add(panel);
  const pts: THREE.Vector3[] = [];
  const arcPt = (t: number, y: number, rr = R) => V(Math.sin(Math.PI - t) * rr, y, R + Math.cos(Math.PI - t) * rr);
  for (let i = 0; i <= 12; i++) pts.push(arcPt(-span / 2 + (span * i) / 12, bh));
  pts.push(arcPt(span / 2, bh * 0.5));
  for (let i = 12; i >= 0; i--) pts.push(arcPt(-span / 2 + (span * i) / 12, 0));
  pts.push(arcPt(-span / 2, bh * 0.5));
  back.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 120, 0.012, 8, true), frame));
  const lumbar = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.012, R - 0.012, 0.07, 24, 1, true, Math.PI - span * 0.35, span * 0.7), M.fabric('#3a3d42'));
  (lumbar.material as THREE.Material).side = THREE.DoubleSide;
  lumbar.position.set(0, 0.16, R);
  back.add(lumbar);
  // 헤드레스트
  const head = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.11, 24, 1, true, Math.PI - 0.27, 0.54), M.fabric(meshC, 2, 1));
  (head.material as THREE.Material).side = THREE.DoubleSide;
  head.position.set(0, bh + 0.11, R);
  back.add(head);
  back.add(rbox(0.04, 0.09, 0.015, 0.006, frame, 0, bh + 0.03, -0.006));
  back.position.set(0, 0.56, -0.255);
  back.rotation.x = -0.14;
  g.add(back);
  // 등판 지지대
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([V(s * 0.18, 0.45, -0.18), V(s * 0.21, 0.5, -0.27), V(s * 0.2, 0.6, -0.28)]);
    g.add(mesh(new THREE.TubeGeometry(curve, 16, 0.016, 8, false), frame));
    // 팔걸이
    g.add(rbox(0.032, 0.2, 0.05, 0.01, frame, s * 0.27, 0.56, -0.03));
    g.add(rbox(0.026, 0.03, 0.05, 0.008, frame, s * 0.23, 0.46, -0.03));
    g.add(rbox(0.075, 0.026, 0.25, 0.012, M.matte('#1c1c1e', 0.7), s * 0.27, 0.67, 0.0));
  }
}

// ───────────── 진입점 ─────────────
export function buildItem(it: Item, variant = 0): THREE.Group {
  const g = new THREE.Group();
  switch (it.kind) {
    case 'desk':
      desk(it, g);
      break;
    case 'monitor':
      monitor(it, g, variant);
      break;
    case 'keyboard':
      keyboard(it, g);
      break;
    case 'mouse':
      mouse(it, g);
      break;
    case 'mat':
      deskMat(it, g);
      break;
    case 'riser':
      riser(it, g);
      break;
    case 'lamp':
      lamp(it, g);
      break;
    case 'speaker':
      speaker(it, g);
      break;
    case 'pc':
      pc(it, g);
      break;
    case 'laptop':
      laptop(it, g);
      break;
    case 'plant':
      plant(it, g);
      break;
    case 'shelf':
      shelf(it, g);
      break;
    case 'chair':
      chair(it, g);
      break;
  }
  return g;
}

export { M as materials, rbox, cyl, rod, slab, mesh, V };
