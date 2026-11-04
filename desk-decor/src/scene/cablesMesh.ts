// 선정리 전/후 시각화: 책상 위 기기의 전원선을 "그냥 늘어뜨린 상태"와
// "트레이+멀티탭+(모션데스크면)케이블 체인"으로 정리한 상태로 그려 비교한다.
import * as THREE from 'three';
import type { Product } from '../catalog/catalog';

export interface CableDevice {
  product: Product;
  /** world 좌표 [mm] */
  x: number;
  y: number;
  z: number;
}

export interface DeskPlacement {
  product: Product;
  x: number;
  y: number;
  rotDeg: number;
}

const tubeMat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });

function tube(points: THREE.Vector3[], color: string, r = 3.5) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, points.length * 12), r, 6, false), tubeMat(color));
  m.castShadow = true;
  return m;
}

function pseudoRandom(i: number) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

export function buildCables(desk: DeskPlacement, devices: CableDevice[], tidy: boolean, trayLenMm: number): THREE.Group {
  const g = new THREE.Group();
  const p = desk.product;
  const top = p.h;
  const t = p.desk?.topThickness ?? 25;
  const motorized = !!p.desk?.motorized;
  const th = THREE.MathUtils.degToRad(desk.rotDeg);
  const cos = Math.cos(-th);
  const sin = Math.sin(-th);
  const toLocal = (X: number, Y: number) => {
    const dx = X - desk.x;
    const dy = Y - desk.y;
    return { u: dx * cos - dy * sin, v: dx * sin + dy * cos };
  };
  const V = (u: number, v: number, z: number) => new THREE.Vector3(u, v, z);
  const rear = p.d / 2;
  const legU = p.w / 2 - (motorized ? 130 : 40);
  const floorTap = V(p.w / 2 - 180, rear + 90, 20);

  if (!tidy) {
    // 정리 전: 바닥 멀티탭 + 늘어진 선들
    g.add(boxMesh(300, 55, 40, '#f2f2f2', floorTap.x, floorTap.y, 20));
    devices.forEach((d, i) => {
      const { u, v } = toLocal(d.x, d.y);
      const startZ = d.z + 15;
      const j = pseudoRandom(i) * 120;
      const pts = [
        V(u, v + d.product.d / 2 - 5, startZ),
        V(u + j * 0.2, rear - 5, top + 8),
        V(u + j * 0.4, rear + 40, top - 80),
        V(u + j, rear + 70, top * 0.45),
        V(u * 0.6 + j, rear + 60 + j * 0.5, 14),
        V(floorTap.x - 120 + i * 25, floorTap.y - 10, 14),
        V(floorTap.x - 100 + i * 25, floorTap.y, 25),
      ];
      g.add(tube(pts, '#151515'));
    });
  } else {
    // 정리 후: 상판 아래 트레이 + 멀티탭, 바닥으로는 전원선 1가닥
    const trayZ = top - t - 75;
    const trayV = rear - 110;
    const tray = new THREE.Group();
    tray.add(boxMesh(trayLenMm, 140, 4, '#2b2e33', 0, 0, 0));
    tray.add(boxMesh(trayLenMm, 4, 70, '#2b2e33', 0, 70, 35));
    tray.add(boxMesh(trayLenMm, 4, 40, '#2b2e33', 0, -70, 20));
    tray.position.set(0, trayV, trayZ);
    g.add(tray);
    const tapU = trayLenMm / 2 - 190;
    g.add(boxMesh(300, 55, 40, '#f2f2f2', tapU, trayV, trayZ + 22));
    devices.forEach((d, i) => {
      const { u, v } = toLocal(d.x, d.y);
      const pts = [
        V(u, v + d.product.d / 2 - 5, d.z + 15),
        V(u, rear - 8, top + 6),
        V(u, rear - 25, top - t - 25),
        V(u * 0.6 + tapU * 0.4, trayV + 30, trayZ + 18),
        V(tapU - 140 + i * 18, trayV, trayZ + 22),
      ];
      g.add(tube(pts, '#3d4148', 3));
    });
    // 멀티탭 → 다리/체인 → 바닥 → 벽 콘센트 방향
    const down = [
      V(tapU + 150, trayV, trayZ + 22),
      V(legU, rear - 40, trayZ + 10),
      V(legU, rear - 40, trayZ * 0.5),
      V(legU, rear - 40, 40),
      V(legU + 60, rear + 80, 14),
      V(p.w / 2 + 40, rear + 110, 14),
    ];
    g.add(tube(down, '#3d4148', 4));
    if (motorized) {
      const links = Math.floor(trayZ / 45);
      for (let k = 0; k < links; k++) {
        const link = boxMesh(38, 46, 36, '#5b6068', legU, rear - 40, 20 + k * 45);
        link.rotation.z = k % 2 ? 0.08 : -0.08;
        g.add(link);
      }
    }
  }
  g.position.set(desk.x, desk.y, 0);
  g.rotation.z = th;
  return g;
}

function boxMesh(w: number, d: number, h: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
