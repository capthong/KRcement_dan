// 배치 규칙(순수 함수): 적층, 벽 스냅, 겹침, 벽까지 거리, 적합성 점검.
// DOM·three.js 와 무관하게 테스트할 수 있도록 분리했다.
import { recommendCableManagement, type CableRec } from '../recommend/cables';
import { checkMonitorsOnDesk } from '../recommend/fit';
import { DESK_THICKNESS, type Item, type Room, dims, fitsUnderDesk, itemLabel, toProduct } from './items';

export interface P2 {
  x: number;
  z: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 물건 로컬(u: 오른쪽, v: 앞) → 방 좌표 */
export function toWorld(it: Pick<Item, 'x' | 'z' | 'rot'>, u: number, v: number): P2 {
  const t = rad(it.rot);
  return { x: it.x + u * Math.cos(t) + v * Math.sin(t), z: it.z - u * Math.sin(t) + v * Math.cos(t) };
}

/** 방 좌표 → 물건 로컬 */
export function toLocal(it: Pick<Item, 'x' | 'z' | 'rot'>, x: number, z: number): { u: number; v: number } {
  const t = rad(it.rot);
  const dx = x - it.x;
  const dz = z - it.z;
  return { u: dx * Math.cos(t) - dz * Math.sin(t), v: dx * Math.sin(t) + dz * Math.cos(t) };
}

export function corners(it: Item): P2[] {
  const { w, d } = dims(it);
  return [
    toWorld(it, -w / 2, -d / 2),
    toWorld(it, w / 2, -d / 2),
    toWorld(it, w / 2, d / 2),
    toWorld(it, -w / 2, d / 2),
  ];
}

export function aabb(it: Item) {
  const c = corners(it);
  return {
    minX: Math.min(...c.map((p) => p.x)),
    maxX: Math.max(...c.map((p) => p.x)),
    minZ: Math.min(...c.map((p) => p.z)),
    maxZ: Math.max(...c.map((p) => p.z)),
  };
}

export function contains(surface: Item, x: number, z: number, margin = 0): boolean {
  const { w, d } = dims(surface);
  const { u, v } = toLocal(surface, x, z);
  return Math.abs(u) <= w / 2 + margin && Math.abs(v) <= d / 2 + margin;
}

/** 2D 회전 사각형 겹침 (분리축 정리). 1mm 이하 접촉은 겹침으로 보지 않는다. */
export function overlaps(a: Item, b: Item): boolean {
  const ca = corners(a);
  const cb = corners(b);
  const axes: P2[] = [];
  for (const c of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const e = { x: c[i + 1].x - c[i].x, z: c[i + 1].z - c[i].z };
      const len = Math.hypot(e.x, e.z) || 1;
      axes.push({ x: -e.z / len, z: e.x / len });
    }
  }
  for (const ax of axes) {
    const pa = ca.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
    if (Math.max(...pa) <= Math.min(...pb) + 1 || Math.max(...pb) <= Math.min(...pa) + 1) return false;
  }
  return true;
}

const SURFACE_RANK: Partial<Record<Item['kind'], number>> = { desk: 0, mat: 1, riser: 2 };
const surfaceTop = (s: Item) => s.y + dims(s).h;

/** 책상 위 물건은 상판(또는 매트·받침대) 높이로 올린다. */
export function restack(items: Item[]): void {
  const surfaces = items.filter((i) => SURFACE_RANK[i.kind] !== undefined).sort((a, b) => SURFACE_RANK[a.kind]! - SURFACE_RANK[b.kind]!);
  const placed: Item[] = [];
  for (const s of surfaces) {
    if (s.kind === 'desk') s.y = 0;
    else s.y = placed.filter((p) => contains(p, s.x, s.z)).reduce((m, p) => Math.max(m, surfaceTop(p)), 0);
    placed.push(s);
  }
  for (const it of items) {
    if (SURFACE_RANK[it.kind] !== undefined) continue;
    if (!onSurfaceKind(it)) {
      it.y = 0;
      continue;
    }
    let pool = placed;
    // 모니터암은 책상 상판에 고정 → 받침대·매트 높이를 무시
    if (it.kind === 'monitor' && it.opt.mount === 'arm') pool = placed.filter((p) => p.kind === 'desk');
    it.y = pool.filter((p) => contains(p, it.x, it.z)).reduce((m, p) => Math.max(m, surfaceTop(p)), 0);
  }
}

function onSurfaceKind(it: Item) {
  if (it.kind === 'pc') return it.opt.size === 'mini';
  if (it.kind === 'plant') return it.opt.size === 'desk';
  return ['monitor', 'keyboard', 'mouse', 'lamp', 'speaker', 'laptop'].includes(it.kind);
}

/** 책상을 옮길 때 같이 움직일 물건 */
export function ridersOf(desk: Item, items: Item[]): Item[] {
  return items.filter((i) => i !== desk && (SURFACE_RANK[i.kind] !== undefined || onSurfaceKind(i)) && i.kind !== 'desk' && contains(desk, i.x, i.z));
}

export interface Gaps {
  left: number;
  right: number;
  back: number;
  front: number;
}

export function wallGaps(it: Item, room: Room): Gaps {
  const b = aabb(it);
  return { left: b.minX + room.w / 2, right: room.w / 2 - b.maxX, back: b.minZ + room.d / 2, front: room.d / 2 - b.maxZ };
}

/** 벽에 가까우면(기본 60mm) 벽에 붙인다 */
export function snapToWalls(it: Item, room: Room, threshold = 60): void {
  const g = wallGaps(it, room);
  if (Math.abs(g.left) < threshold) it.x -= g.left;
  else if (Math.abs(g.right) < threshold) it.x += g.right;
  if (Math.abs(g.back) < threshold) it.z -= g.back;
  else if (Math.abs(g.front) < threshold) it.z += g.front;
}

export type Level = 'ok' | 'warn' | 'bad';
export interface Check {
  level: Level;
  title: string;
  detail: string;
  ids: string[];
}

/** 책상 앞쪽(의자 쪽)으로 벽·다른 가구까지의 거리 */
export function chairClearance(desk: Item, items: Item[], room: Room): number {
  const { w, d } = dims(desk);
  const t = rad(desk.rot);
  const dir = { x: Math.sin(t), z: Math.cos(t) };
  let best = Infinity;
  for (const u of [-w / 4, 0, w / 4]) {
    const o = toWorld(desk, u, d / 2);
    // 벽까지
    const tx = dir.x > 1e-6 ? (room.w / 2 - o.x) / dir.x : dir.x < -1e-6 ? (-room.w / 2 - o.x) / dir.x : Infinity;
    const tz = dir.z > 1e-6 ? (room.d / 2 - o.z) / dir.z : dir.z < -1e-6 ? (-room.d / 2 - o.z) / dir.z : Infinity;
    let dist = Math.min(tx, tz);
    // 바닥 가구까지 (의자·화분 제외 — 의자는 이 공간에 놓이는 것이 정상)
    for (const other of items) {
      if (other === desk || other.kind === 'chair' || onSurfaceKind(other) || other.kind === 'mat' || other.kind === 'riser') continue;
      for (let s = 0; s < dist; s += 20) {
        const p = { x: o.x + dir.x * s, z: o.z + dir.z * s };
        if (contains(other, p.x, p.z)) {
          dist = s;
          break;
        }
      }
    }
    best = Math.min(best, dist);
  }
  return best;
}

/** 의자에 앉은 눈 위치에서 모니터 화면까지 수평 거리 [mm] */
export function eyeToScreen(chair: Item, monitor: Item): number {
  const eye = toWorld(chair, 0, -60); // 의자 중심보다 약간 앞(책상 쪽)
  const screen = toWorld(monitor, 0, screenOffset(monitor));
  return Math.hypot(eye.x - screen.x, eye.z - screen.z);
}

export function nearestChair(desk: Item, items: Item[]): Item | undefined {
  const { d } = dims(desk);
  const front = toWorld(desk, 0, d / 2 + 300);
  return items
    .filter((i) => i.kind === 'chair')
    .map((c) => ({ c, dist: Math.hypot(c.x - front.x, c.z - front.z) }))
    .filter((x) => x.dist < 900)
    .sort((a, b) => a.dist - b.dist)[0]?.c;
}

export function runChecks(room: Room, items: Item[]): Check[] {
  const out: Check[] = [];
  // 방 밖
  for (const it of items) {
    const g = wallGaps(it, room);
    const worst = Math.min(g.left, g.right, g.back, g.front);
    if (worst < -5) out.push({ level: 'bad', title: `${itemLabel(it)} — 방 밖으로 ${Math.round(-worst)}mm 나감`, detail: '방 크기나 위치를 조정하세요.', ids: [it.id] });
    if (dims(it).h > room.h) out.push({ level: 'bad', title: `${itemLabel(it)} — 천장보다 높음`, detail: `높이 ${dims(it).h}mm / 천장 ${room.h}mm`, ids: [it.id] });
  }
  // 겹침
  const floorItems = items.filter((i) => !onSurfaceKind(i) && i.kind !== 'mat' && i.kind !== 'riser');
  for (let i = 0; i < floorItems.length; i++) {
    for (let j = i + 1; j < floorItems.length; j++) {
      const a = floorItems[i];
      const b = floorItems[j];
      if (!overlaps(a, b)) continue;
      if (a.kind === 'desk' && fitsUnderDesk(b, a)) continue;
      if (b.kind === 'desk' && fitsUnderDesk(a, b)) continue;
      out.push({ level: 'bad', title: `${itemLabel(a)} ↔ ${itemLabel(b)} 겹침`, detail: '두 물건이 같은 자리를 차지합니다.', ids: [a.id, b.id] });
    }
  }
  const topItems = items.filter((i) => onSurfaceKind(i) && i.y > 0 && !(i.kind === 'monitor' && i.opt.mount === 'arm'));
  for (let i = 0; i < topItems.length; i++) {
    for (let j = i + 1; j < topItems.length; j++) {
      const a = topItems[i];
      const b = topItems[j];
      if (Math.abs(a.y - b.y) < 5 && overlaps(a, b)) {
        out.push({ level: 'warn', title: `${itemLabel(a)} ↔ ${itemLabel(b)} 겹침`, detail: '책상 위에서 서로 부딪힙니다.', ids: [a.id, b.id] });
      }
    }
  }
  // 책상별 점검
  for (const desk of items.filter((i) => i.kind === 'desk')) {
    const dd = dims(desk);
    const mons = items.filter((i) => i.kind === 'monitor' && contains(desk, i.x, i.z, 40));
    const chair = nearestChair(desk, items);
    if (mons.length) {
      const anyArm = mons.some((m) => m.opt.mount === 'arm');
      const r = checkMonitorsOnDesk(toProduct(desk), mons.map(toProduct), anyArm);
      if (r.totalWidthMm > dd.w) out.push({ level: 'warn', title: `모니터 전체 폭 ${Math.round(r.totalWidthMm)}mm > 책상 ${dd.w}mm`, detail: '모니터가 책상 밖으로 나옵니다.', ids: [desk.id, ...mons.map((m) => m.id)] });
      for (const m of mons) {
        const need = toProduct(m).monitor?.minViewMm ?? 600;
        const dist = chair ? eyeToScreen(chair, m) : r.viewDistanceMm;
        const lvl: Level = dist >= need ? 'ok' : dist >= need - 100 ? 'warn' : 'bad';
        out.push({
          level: lvl,
          title: `${itemLabel(m)} 시청거리 약 ${Math.round(dist / 10)}cm`,
          detail: `권장 ${Math.round(need / 10)}cm 이상${chair ? ' (의자 위치 기준)' : ' (책상 깊이로 추정)'}${lvl === 'ok' ? '' : ' — 모니터암으로 뒤로 밀거나 더 깊은 책상을 고려하세요.'}`,
          ids: [m.id],
        });
        if (m.opt.mount === 'arm' && wallGaps(desk, room).back < 50 && desk.rot % 180 === 0) {
          out.push({ level: 'warn', title: '모니터암 기둥 공간 부족', detail: `책상 뒤와 벽 사이 ${Math.round(wallGaps(desk, room).back)}mm — 클램프·기둥용으로 50mm 이상 띄우세요.`, ids: [desk.id, m.id] });
        }
      }
    }
    const clear = chairClearance(desk, items, room);
    out.push({
      level: clear >= 700 ? 'ok' : clear >= 550 ? 'warn' : 'bad',
      title: `책상 앞 의자 공간 ${Math.round(clear / 10)}cm`,
      detail: clear >= 700 ? '의자를 빼고 앉기에 충분합니다.' : '권장 70cm 이상. 의자를 빼거나 지나다니기 불편합니다.',
      ids: [desk.id],
    });
  }
  return out;
}

export function cableRecs(items: Item[]): CableRec[] {
  const desk = items.find((i) => i.kind === 'desk');
  return recommendCableManagement({
    products: items.map(toProduct),
    desk: desk ? toProduct(desk) : undefined,
    pcOnFloor: items.some((i) => i.kind === 'pc' && i.y === 0),
    monitorsOnArm: items.filter((i) => i.kind === 'monitor' && i.opt.mount === 'arm').length,
  });
}

/** 모니터 앞면(화면)이 모니터 로컬 v 축 어디에 있는지 [mm] */
export function screenOffset(m: Item): number {
  return m.opt.mount === 'arm' ? 10 : dims(m).d / 2 - 60;
}

/**
 * 같은 책상 위 모니터를 가운데 정렬. 2대 이상이면 바깥 모니터를 안쪽으로 돌리고,
 * 안쪽 모서리끼리 맞닿도록 위치를 보정한다.
 */
export function arrangeMonitors(desk: Item, items: Item[]): void {
  const dd = dims(desk);
  const mons = items
    .filter((i) => i.kind === 'monitor' && contains(desk, i.x, i.z, 60))
    .sort((a, b) => toLocal(desk, a.x, a.z).u - toLocal(desk, b.x, b.z).u);
  if (!mons.length) return;
  const gap = 10;
  const base = (m: Item) => (m.opt.mount === 'arm' ? -dd.d / 2 + 150 : -dd.d / 2 + dims(m).d / 2 + 30);
  const place = (m: Item, u: number, v: number, rot: number) => {
    Object.assign(m, toWorld(desk, u, v));
    m.rot = desk.rot + rot;
  };
  if (mons.length === 1) {
    place(mons[0], 0, base(mons[0]), 0);
    return;
  }
  const ang = mons.length === 2 ? 14 : 22;
  const s = Math.sin(rad(ang));
  const c = Math.cos(rad(ang));
  if (mons.length === 2) {
    const [L, R] = mons;
    const wl = dims(L).w;
    const wr = dims(R).w;
    place(L, -(gap / 2 + (wl / 2) * c), base(L) + (wl / 2) * s, ang);
    place(R, gap / 2 + (wr / 2) * c, base(R) + (wr / 2) * s, -ang);
    return;
  }
  // 3대 이상: 가운데는 정면, 나머지는 양옆으로
  const mid = mons[Math.floor(mons.length / 2)];
  const wm = dims(mid).w;
  place(mid, 0, base(mid), 0);
  const left = mons.slice(0, Math.floor(mons.length / 2)).reverse();
  const right = mons.slice(Math.floor(mons.length / 2) + 1);
  let edge = wm / 2 + gap;
  for (const m of left) {
    const w = dims(m).w;
    place(m, -(edge + (w / 2) * c), base(m) + (w / 2) * s, ang);
    edge += w * c + gap;
  }
  edge = wm / 2 + gap;
  for (const m of right) {
    const w = dims(m).w;
    place(m, edge + (w / 2) * c, base(m) + (w / 2) * s, -ang);
    edge += w * c + gap;
  }
}

export function deskSurfaceSpot(desk: Item, u: number, v: number): P2 {
  return toWorld(desk, u, v);
}

export { DESK_THICKNESS };
