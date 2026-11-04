// 상품 → "약간 입체적인" 파라메트릭 3D 모델.
// 실제 3D 스캔/모델 없이 치수(W×D×H)만으로 박스·원기둥을 조합해 만든다.
// 좌표: mm, Z 위, 그룹 원점 = 바닥 투영 중심, 앞(사용자 쪽) = -Y
import * as THREE from 'three';
import type { Product } from '../catalog/catalog';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string } = {}) {
  const key = `${color}|${opts.rough}|${opts.metal}|${opts.emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.75,
      metalness: opts.metal ?? 0.05,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts.emissive ? 0.35 : undefined,
    });
    matCache.set(key, m);
  }
  return m;
}

function box(w: number, d: number, h: number, color: string, x = 0, y = 0, z = h / 2, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat(color, o));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(r: number, h: number, color: string, x = 0, y = 0, z = h / 2, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat(color, o));
  m.rotation.x = Math.PI / 2; // 원기둥 축을 Z 로
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const FRAME = '#3a3d42';

export interface BuildOptions {
  onArm?: boolean;
}

export function buildProductMesh(p: Product, opts: BuildOptions = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = p.id;
  switch (p.category) {
    case 'desk': {
      const t = p.desk?.topThickness ?? 25;
      g.add(box(p.w, p.d, t, p.color, 0, 0, p.h - t / 2));
      if (p.desk?.motorized) {
        const lx = p.w / 2 - 130;
        for (const sx of [-1, 1]) {
          g.add(box(70, 70, p.h - t, FRAME, sx * lx, 0));
          g.add(box(70, p.d - 80, 30, FRAME, sx * lx, 0, 15));
        }
        g.add(box(p.w - 2 * 130, 50, 40, FRAME, 0, 0, p.h - t - 20));
        g.add(box(110, 45, 18, '#222', p.w / 2 - 260, -p.d / 2 + 30, p.h - t - 9)); // 높이 조절 버튼
      } else {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(box(45, 45, p.h - t, FRAME, sx * (p.w / 2 - 40), sy * (p.d / 2 - 40)));
      }
      break;
    }
    case 'monitor': {
      const pw = p.monitor?.panelW ?? p.w;
      const ph = p.monitor?.panelH ?? p.h - 110;
      const curved = (p.monitor?.aspect[0] ?? 16) / (p.monitor?.aspect[1] ?? 9) > 2;
      const panel = new THREE.Group();
      const body = box(pw, 28, ph, p.color, 0, 0, 0);
      panel.add(body);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(pw - 16, ph - 23),
        mat('#0d1a2b', { rough: 0.25, metal: 0.2, emissive: '#1d3d66' }),
      );
      screen.rotation.x = Math.PI / 2; // 평면 법선 → -Y (사용자 쪽)
      screen.position.set(0, -14.5, 7);
      panel.add(screen);
      if (curved) panel.scale.set(1, 1, 1); // 곡면은 단순화(평면). 보고서 '한계' 참고
      if (opts.onArm) {
        panel.position.set(0, -20, 160 + ph / 2);
        g.add(panel);
        // 책상 뒤쪽 클램프 기둥 + 수평 암
        g.add(box(35, 35, 450, '#8c9096', 0, p.d / 2 + 60, 225, { metal: 0.6, rough: 0.4 }));
        g.add(box(28, p.d / 2 + 70, 22, '#8c9096', 0, (p.d / 2 + 60) / 2, 160 + ph / 2, { metal: 0.6, rough: 0.4 }));
        g.add(box(60, 30, 20, '#8c9096', 0, p.d / 2 + 60, 6));
      } else {
        panel.position.set(0, -25, 110 + ph / 2);
        g.add(panel);
        g.add(box(60, 30, 110 + ph / 2, FRAME, 0, 15));
        g.add(box(250, 190, 12, FRAME, 0, 5));
      }
      break;
    }
    case 'riser': {
      g.add(box(p.w, p.d, 18, p.color, 0, 0, p.h - 9));
      for (const sx of [-1, 1]) g.add(box(25, p.d, p.h - 18, p.color, sx * (p.w / 2 - 12.5), 0));
      break;
    }
    case 'lamp': {
      g.add(cyl(75, 20, p.color));
      g.add(cyl(9, 380, '#bfc3c8', 0, 30, 210, { metal: 0.5, rough: 0.35 }));
      g.add(box(60, 220, 22, p.color, 0, -60, 405));
      break;
    }
    case 'speaker': {
      g.add(box(p.w, p.d, p.h, p.color));
      const w = new THREE.Mesh(new THREE.CylinderGeometry(38, 38, 4, 24), mat('#1a1a1a', { rough: 0.9 }));
      w.position.set(0, -p.d / 2 - 1, p.h * 0.38);
      g.add(w);
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 4, 16), mat('#555', { rough: 0.4 }));
      tw.position.set(0, -p.d / 2 - 1, p.h * 0.78);
      g.add(tw);
      break;
    }
    case 'pc': {
      g.add(box(p.w, p.d, p.h, p.color, 0, 0, p.h / 2, { metal: 0.3, rough: 0.5 }));
      g.add(box(p.w - 30, 3, p.h - 60, '#2c3138', 0, -p.d / 2 - 1, p.h / 2, { rough: 0.3 }));
      g.add(box(6, 4, 6, '#59d3ff', p.w / 2 - 30, -p.d / 2 - 2, p.h - 25, { emissive: '#59d3ff' }));
      break;
    }
    case 'keyboard': {
      const kb = box(p.w, p.d, 22, p.color);
      g.add(kb);
      g.add(box(p.w - 20, p.d - 20, 14, '#4a4f57', 0, 0, 29));
      break;
    }
    case 'deskmat':
      g.add(box(p.w, p.d, p.h, p.color, 0, 0, p.h / 2, { rough: 0.95 }));
      break;
    case 'laptop': {
      // 거치대 + 노트북
      const stand = box(p.w * 0.7, p.d * 0.9, 12, '#c0c4c9', 0, 0, 60, { metal: 0.6, rough: 0.35 });
      stand.rotation.x = -0.18;
      g.add(stand);
      g.add(box(20, 20, 100, '#c0c4c9', 0, p.d * 0.3, 50, { metal: 0.6 }));
      const base = box(p.w, p.d * 0.92, 14, p.color, 0, 0, 82, { metal: 0.5, rough: 0.35 });
      base.rotation.x = -0.18;
      g.add(base);
      const lid = box(p.w, 8, p.d * 0.9, p.color, 0, p.d * 0.46 + 10, 82 + (p.d * 0.9) / 2, { metal: 0.5, rough: 0.35 });
      lid.rotation.x = -0.18;
      g.add(lid);
      break;
    }
  }
  return g;
}

/** 선택 표시용 바닥 사각 테두리 */
export function footprintOutline(w: number, d: number, color = '#ffcc33'): THREE.LineLoop {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-w / 2, -d / 2, 2),
    new THREE.Vector3(w / 2, -d / 2, 2),
    new THREE.Vector3(w / 2, d / 2, 2),
    new THREE.Vector3(-w / 2, d / 2, 2),
  ]);
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
  line.renderOrder = 10;
  return line;
}
