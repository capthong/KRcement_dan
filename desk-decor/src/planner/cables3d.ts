// 선정리 전/후 3D: 정리 전에는 선이 바닥 멀티탭까지 늘어지고,
// 정리 후에는 상판 아래 와이어 트레이 + 멀티탭 + (모션데스크면) 케이블 체인으로 1가닥만 내려간다.
import * as THREE from 'three';
import { trayLengthFor } from '../recommend/cables';
import { DESK_THICKNESS, type Item, type Room, dims, toProduct } from './items';
import { contains, toWorld } from './layout';
import { materials as M, rbox } from './models';
import { powerStripTexture, rng } from './textures';

const mm = (v: number) => v / 1000;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function tube(points: THREE.Vector3[], r: number, color: string) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(32, points.length * 14), r, 7, false), M.matte(color, 0.55));
  m.castShadow = true;
  return m;
}

function powerStrip(len = 0.3) {
  const g = new THREE.Group();
  g.add(rbox(len, 0.038, 0.058, 0.01, M.plastic('#f4f4f2', 0.45), 0, 0.019, 0));
  const top = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.02, 0.05), new THREE.MeshStandardMaterial({ map: powerStripTexture(), roughness: 0.45 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0385;
  g.add(top);
  g.add(rbox(0.012, 0.006, 0.014, 0.002, M.glow('#ff5a4a', 2), len / 2 - 0.034, 0.041, 0));
  return g;
}

/** 와이어 바스켓 트레이 (길이 방향 x) */
function wireTray(len: number) {
  const g = new THREE.Group();
  const wd = 0.14;
  const hh = 0.09;
  const steel = M.powder('#2a2c30');
  const r = 0.0022;
  const rail = (y: number, z: number) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), steel);
    c.rotation.z = Math.PI / 2;
    c.position.set(0, y, z);
    g.add(c);
  };
  rail(0, -wd / 2);
  rail(0, wd / 2);
  rail(hh, -wd / 2);
  rail(hh * 0.55, wd / 2);
  rail(0, 0);
  const n = Math.max(4, Math.floor(len / 0.04));
  const seg = new THREE.CylinderGeometry(r, r, 1, 6);
  const inst = new THREE.InstancedMesh(seg, steel, n * 3);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    inst.setMatrixAt(i * 3, m4.compose(V(x, hh / 2, -wd / 2), q.identity(), V(1, hh, 1)));
    inst.setMatrixAt(i * 3 + 1, m4.compose(V(x, hh * 0.275, wd / 2), q.identity(), V(1, hh * 0.55, 1)));
    inst.setMatrixAt(i * 3 + 2, m4.compose(V(x, 0, 0), q.setFromAxisAngle(V(1, 0, 0), Math.PI / 2), V(1, wd, 1)));
  }
  inst.castShadow = true;
  g.add(inst);
  return g;
}

/** 수직 케이블 체인: 곡선을 따라 마디를 이어 붙임 */
function spine(curve: THREE.Curve<THREE.Vector3>) {
  const len = curve.getLength();
  const n = Math.max(3, Math.floor(len / 0.032));
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.034, 0.03, 0.044), M.plastic('#26282c', 0.5), n);
  const up = V(0, 1, 0);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const q = new THREE.Quaternion().setFromUnitVectors(up, tan);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(up, i % 2 ? 0.15 : -0.15));
    inst.setMatrixAt(i, m4.compose(p, q, V(1, 1, 1)));
  }
  inst.castShadow = true;
  return inst;
}

/** 선을 내릴 쪽: 바닥 PC 반대편(+1 오른쪽, -1 왼쪽). 3D 에서 본체에 가려지지 않게 한다. */
export function cableSide(items: Item[], desk: Item): 1 | -1 {
  const pc = items.find((i) => i.kind === 'pc' && i.y === 0);
  if (!pc) return 1;
  const t = (desk.rot * Math.PI) / 180;
  const u = (pc.x - desk.x) * Math.cos(t) - (pc.z - desk.z) * Math.sin(t);
  return u > 0 ? -1 : 1;
}

/** 벽 콘센트 위치: 선을 내리는 쪽 뒤 모서리에서 가장 가까운 벽 */
function outletFor(desk: Item, room: Room, side: number) {
  const dd = dims(desk);
  const p = toWorld(desk, side * (dd.w / 2 - 150), -dd.d / 2);
  const W = room.w / 2;
  const D = room.d / 2;
  const cands = [
    { d: p.x + W, pos: { x: -W, z: p.z }, n: V(1, 0, 0) },
    { d: W - p.x, pos: { x: W, z: p.z }, n: V(-1, 0, 0) },
    { d: p.z + D, pos: { x: p.x, z: -D }, n: V(0, 0, 1) },
    { d: D - p.z, pos: { x: p.x, z: D }, n: V(0, 0, -1) },
  ].sort((a, b) => a.d - b.d)[0];
  return { x: mm(cands.pos.x), z: mm(cands.pos.z), n: cands.n };
}

export function buildCables(items: Item[], room: Room, tidy: boolean): THREE.Group {
  const out = new THREE.Group();
  const desk = items.find((i) => i.kind === 'desk');
  if (!desk) return out;
  const dd = dims(desk);
  const H = mm(dd.h);
  const T = mm(DESK_THICKNESS);
  const L = (u: number, v: number, y: number) => {
    const p = toWorld(desk, u, v);
    return V(mm(p.x), y, mm(p.z));
  };
  const side = cableSide(items, desk);
  const outlet = outletFor(desk, room, side);
  const outletPos = V(outlet.x, 0.3, outlet.z).add(outlet.n.clone().multiplyScalar(0.012));
  // 벽 콘센트 판
  const plate = rbox(0.075, 0.12, 0.012, 0.004, M.plastic('#fafaf8', 0.4));
  plate.position.copy(outletPos);
  plate.lookAt(outletPos.clone().add(outlet.n));
  out.add(plate);

  const powered = items.filter((i) => i.kind !== 'desk' && toProduct(i).plugs > 0 && i.y > 0 && contains(desk, i.x, i.z, 40));
  const pcItem = items.find((i) => i.kind === 'pc' && i.y === 0);
  const monitors = items.filter((i) => i.kind === 'monitor' && contains(desk, i.x, i.z, 40));
  const r = rng(7);
  const rearOf = (it: Item) => {
    const d = dims(it);
    const p = toWorld(it, 0, -d.d / 2 + (it.kind === 'monitor' ? d.d * 0.35 : 10));
    return V(mm(p.x), mm(it.y) + 0.03, mm(p.z));
  };
  const deskLocal = (it: Item) => {
    const t = (desk.rot * Math.PI) / 180;
    const dx = it.x - desk.x;
    const dz = it.z - desk.z;
    return dx * Math.cos(t) - dz * Math.sin(t);
  };

  if (!tidy) {
    const strip = powerStrip();
    const sp = L(side * (dd.w / 2 - 250), -dd.d / 2 + 60, 0);
    strip.position.copy(sp);
    strip.rotation.y = (desk.rot * Math.PI) / 180;
    out.add(strip);
    powered.forEach((it, i) => {
      const a = rearOf(it);
      const u = deskLocal(it);
      const j = (r() - 0.5) * 0.12;
      out.add(
        tube(
          [a, L(u, -dd.d / 2 + 5, H + 0.006), L(u + j * 200, -dd.d / 2 - 25, H - 0.12), L(u * 0.9 + j * 400, -dd.d / 2 - 40, H * 0.4), L(u * 0.7 + j * 600, -dd.d / 2 + 20 + r() * 80, 0.012), sp.clone().add(V(-0.12 + i * 0.045, 0.012, 0.04)), sp.clone().add(V(-0.12 + i * 0.045, 0.04, 0.0))],
          0.0032,
          i % 3 === 2 ? '#e8e8e6' : '#151517',
        ),
      );
    });
    if (pcItem) {
      const pcTop = toWorld(pcItem, 0, -dims(pcItem).d / 2 + 30);
      const pcp = V(mm(pcTop.x), mm(dims(pcItem).h) * 0.8, mm(pcTop.z));
      monitors.forEach((m, i) => {
        const a = rearOf(m);
        out.add(tube([a, a.clone().add(V(0, -0.02, -0.06)), L(deskLocal(m) + 60, -dd.d / 2 - 30, H - 0.25), V(pcp.x - 0.05 + i * 0.03, H * 0.3, pcp.z - 0.05), pcp.clone().add(V(i * 0.02, -0.1, -0.02))], 0.004, '#101012'));
      });
      out.add(tube([pcp.clone().add(V(0.03, -0.3, -0.02)), V(pcp.x, 0.05, pcp.z - 0.1), sp.clone().add(V(0.05, 0.02, 0.05)), sp.clone().add(V(0.1, 0.04, 0))], 0.0035, '#151517'));
    }
    out.add(tube([sp.clone().add(V(0.15, 0.02, 0)), sp.clone().add(V(0.3, 0.01, -0.05)), V(outletPos.x, 0.012, outletPos.z).add(outlet.n.clone().multiplyScalar(0.05)), outletPos.clone().add(outlet.n.clone().multiplyScalar(0.02))], 0.0035, '#151517'));
    return out;
  }

  // ── 정리 후 ──
  const trayLen = mm(trayLengthFor(toProduct(desk)));
  const trayY = H - T - 0.1;
  const trayV = -dd.d / 2 + 90;
  const tray = wireTray(trayLen);
  tray.position.copy(L(0, trayV, trayY));
  tray.rotation.y = (desk.rot * Math.PI) / 180;
  out.add(tray);
  // 트레이 고정 브래킷
  for (const s of [-1, 1]) {
    const b = rbox(0.02, 0.1, 0.02, 0.003, M.powder('#2a2c30'));
    b.position.copy(L(s * (trayLen * 500 - 60), trayV - 60, trayY + 0.05));
    out.add(b);
  }
  const stripU = side * (trayLen * 500 - 230);
  const strip = powerStrip(Math.min(0.36, trayLen - 0.1));
  strip.position.copy(L(stripU, trayV, trayY + 0.004));
  strip.rotation.y = (desk.rot * Math.PI) / 180;
  out.add(strip);
  const stripPt = L(stripU, trayV, trayY + 0.03);
  powered.forEach((it, i) => {
    const a = rearOf(it);
    const u = deskLocal(it);
    const entry = L(u, -dd.d / 2 + 4, H + 0.004);
    const drop = L(u, -dd.d / 2 + 20, H - T - 0.03);
    const inTray = L(u * 0.8 + stripU * 0.2, trayV - 20 + i * 8, trayY + 0.02);
    out.add(tube([a, entry, drop, inTray, stripPt.clone().add(V(-0.1 + i * 0.03, 0, 0))], 0.003, '#2a2c30'));
  });
  // 모니터 영상선은 PC 쪽으로 같이 묶어서
  const legU = side * (dd.w / 2 - (desk.opt.type === 'motion' ? 130 : 60));
  const inU = legU - side * 40;
  const downTop = L(inU, -dd.d / 2 + 40, trayY + 0.02);
  const downBot = L(inU, -dd.d / 2 + 40, 0.05);
  const toOutlet = [downBot, L(legU, -dd.d / 2 - 30, 0.012), V(outletPos.x, 0.012, outletPos.z).add(outlet.n.clone().multiplyScalar(0.03)), outletPos.clone().add(outlet.n.clone().multiplyScalar(0.02))];
  const path = new THREE.CatmullRomCurve3([L(stripU + side * 150, trayV, trayY + 0.03), downTop, L(inU, -dd.d / 2 + 40, trayY * 0.5), downBot]);
  if (desk.opt.type === 'motion') out.add(spine(path));
  out.add(tube([...path.points, ...toOutlet.slice(1)], 0.0038, '#2a2c30'));
  if (pcItem) {
    const pcTop = toWorld(pcItem, 0, -dims(pcItem).d / 2 + 30);
    const pcp = V(mm(pcTop.x), mm(dims(pcItem).h) * 0.75, mm(pcTop.z));
    monitors.forEach((m, i) => {
      // 영상선은 트레이를 따라 본체 쪽 끝에서 바로 내려감
      const pcSideU = -side * (trayLen * 500 - 40);
      out.add(tube([rearOf(m), L(deskLocal(m), -dd.d / 2 + 4, H + 0.004), L(deskLocal(m), -dd.d / 2 + 20, H - T - 0.03), L(deskLocal(m) * 0.5 + pcSideU * 0.5, trayV - 30 + i * 10, trayY + 0.03), L(pcSideU, trayV - 20, trayY + 0.03), V(pcp.x, pcp.y + 0.08, pcp.z - 0.04), pcp], 0.0035, '#18191b'));
    });
  }
  // 벨크로 타이
  const tie = new THREE.TorusGeometry(0.009, 0.003, 6, 16);
  for (const t of [0.2, 0.45, 0.7, 0.92]) {
    const p = path.getPointAt(t);
    const m = new THREE.Mesh(tie, M.matte('#4f8a6b', 0.7));
    m.position.copy(p);
    m.rotation.x = Math.PI / 2;
    out.add(m);
  }
  return out;
}
