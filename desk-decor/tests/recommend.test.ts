import { describe, expect, it } from 'vitest';
import { CATALOG, monitorPanelMm, productById } from '../src/catalog/catalog';
import { recommendCableManagement } from '../src/recommend/cables';
import { checkMonitorsOnDesk, recommendDesks, recommendMonitors } from '../src/recommend/fit';

const get = (id: string) => {
  const p = productById(id);
  if (!p) throw new Error(id);
  return p;
};

describe('monitorPanelMm', () => {
  it('27인치 16:9 화면 가로는 약 598mm', () => {
    expect(monitorPanelMm(27, 16, 9).activeW).toBeCloseTo(597.7, 0);
  });
  it('34인치 3440×1440(통칭 21:9) 화면 가로는 약 797mm', () => {
    expect(monitorPanelMm(34, 43, 18).activeW).toBeCloseTo(796.6, 0);
  });
});

describe('recommendDesks', () => {
  it('폭 1450mm 공간에는 1400 이하 책상만 들어간다', () => {
    const recs = recommendDesks({ widthMm: 1450 });
    const fitting = recs.filter((r) => r.fits).map((r) => r.product.w);
    expect(Math.max(...fitting)).toBe(1400);
    expect(recs[0].fits).toBe(true);
  });

  it('깊이가 부족하면 fits=false', () => {
    const recs = recommendDesks({ widthMm: 2000, depthMm: 650 });
    expect(recs.find((r) => r.product.id === 'desk-1600x800')?.fits).toBe(false);
    expect(recs.find((r) => r.product.id === 'desk-1200x600')?.fits).toBe(true);
  });

  it('의자 공간이 좁으면 경고', () => {
    const r = recommendDesks({ widthMm: 2000, depthMm: 1100 }).find((x) => x.product.id === 'desk-1200x600');
    expect(r?.warnings.join(' ')).toContain('의자');
  });

  it('모션데스크 선호를 반영', () => {
    const recs = recommendDesks({ widthMm: 1700 }, [], true);
    expect(recs[0].product.desk?.motorized).toBe(true);
  });
});

describe('checkMonitorsOnDesk', () => {
  it('600 깊이 책상 + 27인치 = 스탠드로는 가깝고 암이면 OK', () => {
    const desk = get('desk-1200x600');
    const m = get('mon-27-16x9');
    expect(checkMonitorsOnDesk(desk, [m], false).ok).toBe(false);
    expect(checkMonitorsOnDesk(desk, [m], true).ok).toBe(true);
  });

  it('1000 폭 책상에 27인치 2대는 폭 초과', () => {
    const r = checkMonitorsOnDesk(get('desk-1000x600'), [get('mon-27-16x9'), get('mon-27-16x9')], true);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('폭');
  });

  it('recommendMonitors: 가능한 것이 먼저 온다', () => {
    const recs = recommendMonitors(get('desk-1400x700'), 2);
    expect(recs[0].ok).toBe(true);
    expect(recs[recs.length - 1].ok).toBe(false);
  });
});

describe('recommendCableManagement', () => {
  it('모션데스크 + 바닥 본체 → 케이블 체인과 긴 영상 케이블 필수', () => {
    const desk = get('mdesk-1400x700');
    const products = [desk, get('mon-27-16x9'), get('mon-27-16x9'), get('pc-mid'), get('lamp-desk')];
    const recs = recommendCableManagement({ products, desk, pcOnFloor: true, monitorsOnArm: 0 });
    const ids = recs.map((r) => r.id);
    expect(ids).toContain('cable-spine');
    expect(ids).toContain('power-strip');
    const video = recs.find((r) => r.id === 'video-cable');
    expect(video?.title).toContain('3m'); // 1250 + 900 = 2.15m → 3m
    expect(recs[0].priority).toBe('must');
    // 플러그: 데스크1 + 모니터2 + PC1 + 조명1 = 5 → +2 = 7 → 8구
    expect(recs.find((r) => r.id === 'power-strip')?.title).toContain('8구');
  });

  it('고정 책상 1200 → 트레이 800mm', () => {
    const desk = get('desk-1200x600');
    const recs = recommendCableManagement({ products: [desk, get('mon-24-16x9')], desk, pcOnFloor: false, monitorsOnArm: 0 });
    expect(recs.find((r) => r.id === 'cable-tray')?.title).toContain('800mm');
    expect(recs.find((r) => r.id === 'cable-spine')).toBeUndefined();
  });

  it('노트북 + 모니터 → 도킹스테이션 추천', () => {
    const recs = recommendCableManagement({
      products: [get('laptop-14'), get('mon-27-16x9')],
      pcOnFloor: false,
      monitorsOnArm: 1,
    });
    expect(recs.find((r) => r.id === 'dock')?.title).toContain('도킹');
    expect(recs.find((r) => r.id === 'arm-channel')).toBeDefined();
  });

  it('카탈로그 모든 상품의 치수가 양수', () => {
    for (const p of CATALOG) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.d).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });
});
