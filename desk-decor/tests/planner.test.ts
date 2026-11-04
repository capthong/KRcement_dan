import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, type Item, type Kind, type Room, dims, monitorGeom } from '../src/planner/items';
import {
  arrangeMonitors,
  chairClearance,
  contains,
  overlaps,
  restack,
  ridersOf,
  runChecks,
  snapToWalls,
  toLocal,
  toWorld,
  wallGaps,
} from '../src/planner/layout';

let n = 0;
const mk = (kind: Kind, x: number, z: number, opt: Record<string, string | number | boolean> = {}, rot = 0): Item => ({
  id: `t${++n}`,
  kind,
  opt: { ...DEFAULT_OPTS[kind], ...opt },
  x,
  z,
  rot,
  y: 0,
});
const room: Room = { w: 3000, d: 2600, h: 2400, floor: 'oak', wall: '#eee', window: 'left' };

describe('좌표 변환', () => {
  it('toWorld/toLocal 왕복', () => {
    const it = mk('desk', 300, -200, {}, 37);
    const p = toWorld(it, 120, -45);
    const l = toLocal(it, p.x, p.z);
    expect(l.u).toBeCloseTo(120, 6);
    expect(l.v).toBeCloseTo(-45, 6);
  });
  it('회전 0 이면 앞면(+v)이 +z', () => {
    const it = mk('desk', 0, 0);
    expect(toWorld(it, 0, 100).z).toBeCloseTo(100);
  });
});

describe('적층·이동', () => {
  it('책상 위 모니터·키보드는 상판 높이, 매트 위 키보드는 +3mm', () => {
    const desk = mk('desk', 0, -950, { height: 740 });
    const mat = mk('mat', 0, -800);
    const kb = mk('keyboard', 0, -800);
    const mon = mk('monitor', 0, -1150);
    const pc = mk('pc', 500, -950);
    const items = [kb, mon, mat, desk, pc];
    restack(items);
    expect(mat.y).toBe(740);
    expect(kb.y).toBe(743);
    expect(mon.y).toBe(740);
    expect(pc.y).toBe(0); // 미들타워는 책상 밑 바닥
  });
  it('책상을 옮기면 위 물건이 따라온다', () => {
    const desk = mk('desk', 0, 0);
    const mon = mk('monitor', 100, -200);
    const chair = mk('chair', 0, 700);
    expect(ridersOf(desk, [desk, mon, chair])).toEqual([mon]);
  });
  it('벽 스냅', () => {
    const desk = mk('desk', 0, -room.d / 2 + 350 + 40); // 뒤 벽에서 40mm
    snapToWalls(desk, room);
    expect(wallGaps(desk, room).back).toBeCloseTo(0, 6);
  });
});

describe('겹침', () => {
  it('회전한 사각형도 정확히 판정', () => {
    const a = mk('shelf', 0, 0, { w: 800 });
    const b = mk('shelf', 700, 0, { w: 800 });
    expect(overlaps(a, b)).toBe(true);
    b.x = 801;
    expect(overlaps(a, b)).toBe(false);
    b.rot = 45;
    b.x = 600;
    expect(overlaps(a, b)).toBe(true);
  });
  it('의자·미들타워는 책상 밑에 들어가도 겹침 경고 없음, 책장은 경고', () => {
    const desk = mk('desk', 0, -950);
    const chair = mk('chair', 0, -700);
    const pc = mk('pc', 450, -1000);
    const shelf = mk('shelf', -800, -1000);
    const items = [desk, chair, pc, shelf];
    restack(items);
    const titles = runChecks(room, items).filter((c) => c.title.includes('겹침')).map((c) => c.ids.sort().join());
    expect(titles).toContain([desk.id, shelf.id].sort().join());
    expect(titles.some((t) => t.includes(chair.id))).toBe(false);
    expect(titles.some((t) => t.includes(pc.id))).toBe(false);
  });
});

describe('모니터 배치', () => {
  it('2대는 안쪽 모서리가 맞닿게 안쪽으로 돌린다', () => {
    const desk = mk('desk', 0, -950, { w: 1600, d: 800 });
    const a = mk('monitor', -100, -1200);
    const b = mk('monitor', 100, -1200);
    arrangeMonitors(desk, [desk, a, b]);
    expect(a.rot).toBeGreaterThan(0);
    expect(b.rot).toBeLessThan(0);
    const w = dims(a).w;
    const innerA = toWorld(a, w / 2, 0);
    const innerB = toWorld(b, -w / 2, 0);
    expect(Math.hypot(innerA.x - innerB.x, innerA.z - innerB.z)).toBeCloseTo(10, 3);
    expect(contains(desk, a.x, a.z)).toBe(true);
  });
  it('곡면 49" 는 깊이(새그)가 크다', () => {
    expect(monitorGeom('49suw').sag).toBeGreaterThan(90);
    expect(monitorGeom('27').sag).toBe(0);
  });
});

describe('점검', () => {
  it('책상 앞 공간이 좁으면 bad', () => {
    const desk = mk('desk', 0, -room.d / 2 + 350, { d: 700 });
    expect(chairClearance(desk, [desk], room)).toBeCloseTo(room.d - 700, 0);
    const shelf = mk('shelf', 0, -room.d / 2 + 700 + 400 + 150);
    const c = chairClearance(desk, [desk, shelf], room);
    expect(c).toBeLessThanOrEqual(400);
    const checks = runChecks(room, [desk, shelf]);
    expect(checks.find((x) => x.title.startsWith('책상 앞'))?.level).toBe('bad');
  });
  it('방 밖으로 나가면 bad', () => {
    const shelf = mk('shelf', room.w / 2, 0);
    expect(runChecks(room, [shelf]).some((c) => c.level === 'bad' && c.title.includes('방 밖'))).toBe(true);
  });
  it('모니터암 + 벽에 붙은 책상 → 기둥 공간 경고', () => {
    const desk = mk('desk', 0, -room.d / 2 + 350);
    const mon = mk('monitor', 0, -room.d / 2 + 150, { mount: 'arm' });
    const items = [desk, mon];
    restack(items);
    expect(runChecks(room, items).some((c) => c.title.includes('기둥'))).toBe(true);
  });
});
