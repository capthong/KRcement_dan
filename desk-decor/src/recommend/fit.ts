// 측정한 공간에 맞는 책상, 책상에 맞는 모니터를 고르는 규칙 기반 추천.
// 머신러닝 없이도 "왜 이걸 추천했는지"를 설명할 수 있게 근거 문장을 같이 돌려준다.
import { CATALOG, type Product } from '../catalog/catalog';

export interface Space {
  /** 책상을 놓을 수 있는 가로 폭 [mm] (벽~가구 사이 등) */
  widthMm: number;
  /** 벽에서부터 쓸 수 있는 깊이 [mm] (의자 공간 포함). 모르면 undefined */
  depthMm?: number;
}

export const SIDE_CLEARANCE_MM = 20; // 책상 양옆 최소 여유
export const CHAIR_ZONE_MM = 700; // 책상 앞 의자·통로 권장 깊이

/** 패널이 책상 뒤 모서리에서 얼마나 앞에 오는지 [mm] */
const PANEL_OFFSET_STAND = 120;
const PANEL_OFFSET_ARM = 30;
/** 눈이 책상 앞 모서리보다 뒤에 있는 거리 [mm] */
const EYE_BEHIND_EDGE = 100;
const MONITOR_GAP_MM = 10;

export interface MonitorCheck {
  ok: boolean;
  totalWidthMm: number;
  viewDistanceMm: number;
  requiredViewMm: number;
  issues: string[];
}

export function checkMonitorsOnDesk(desk: Product, monitors: Product[], onArm: boolean): MonitorCheck {
  const issues: string[] = [];
  const totalWidthMm =
    monitors.reduce((s, m) => s + (m.monitor?.panelW ?? m.w), 0) + Math.max(0, monitors.length - 1) * MONITOR_GAP_MM;
  const viewDistanceMm = desk.d - (onArm ? PANEL_OFFSET_ARM : PANEL_OFFSET_STAND) + EYE_BEHIND_EDGE;
  const requiredViewMm = Math.max(0, ...monitors.map((m) => m.monitor?.minViewMm ?? 0));
  if (totalWidthMm > desk.w) {
    issues.push(`모니터 전체 폭 ${Math.round(totalWidthMm)}mm 가 책상 폭 ${desk.w}mm 보다 넓습니다.`);
  }
  if (monitors.length && viewDistanceMm < requiredViewMm) {
    issues.push(
      `예상 시청거리 약 ${Math.round(viewDistanceMm / 10)}cm 로 권장 ${Math.round(requiredViewMm / 10)}cm 보다 가깝습니다.`,
    );
  }
  return { ok: issues.length === 0, totalWidthMm, viewDistanceMm, requiredViewMm, issues };
}

export interface DeskRec {
  product: Product;
  fits: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
  needsArm: boolean;
}

export function recommendDesks(space: Space, plannedMonitors: Product[] = [], wantMotorized?: boolean): DeskRec[] {
  const desks = CATALOG.filter((p) => p.category === 'desk');
  const recs = desks.map((desk): DeskRec => {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const freeW = space.widthMm - desk.w - 2 * SIDE_CLEARANCE_MM;
    let fits = freeW >= 0;
    if (fits) reasons.push(`폭 여유 ${Math.round(freeW + 2 * SIDE_CLEARANCE_MM)}mm`);
    else reasons.push(`폭이 ${Math.round(-freeW)}mm 부족`);

    if (space.depthMm !== undefined) {
      if (desk.d > space.depthMm) {
        fits = false;
        reasons.push(`깊이가 ${Math.round(desk.d - space.depthMm)}mm 부족`);
      } else if (space.depthMm - desk.d < CHAIR_ZONE_MM) {
        warnings.push(`책상 앞 의자 공간이 ${Math.round((space.depthMm - desk.d) / 10)}cm 로 권장 70cm 보다 좁습니다.`);
      }
    }

    let needsArm = false;
    let monitorScore = 0;
    if (plannedMonitors.length) {
      const stand = checkMonitorsOnDesk(desk, plannedMonitors, false);
      const arm = checkMonitorsOnDesk(desk, plannedMonitors, true);
      if (stand.ok) {
        monitorScore = 30;
        reasons.push('계획한 모니터를 기본 스탠드로 올려도 충분');
      } else if (arm.ok) {
        monitorScore = 15;
        needsArm = true;
        reasons.push('모니터암을 쓰면 시청거리 확보 가능');
      } else {
        warnings.push(...arm.issues);
      }
    }

    const motorized = !!desk.desk?.motorized;
    const prefScore = wantMotorized === undefined ? 0 : motorized === wantMotorized ? 25 : -25;
    // 공간을 꽉 채우는 것보다 양옆 100~300mm 남기는 것을 선호
    const utilization = fits ? 20 - Math.abs(freeW - 200) / 50 : 0;
    const score = (fits ? 100 : 0) + monitorScore + prefScore + utilization - warnings.length * 5;
    return { product: desk, fits, score, reasons, warnings, needsArm };
  });
  return recs.sort((a, b) => b.score - a.score);
}

export interface MonitorRec {
  product: Product;
  count: number;
  ok: boolean;
  needsArm: boolean;
  check: MonitorCheck;
}

export function recommendMonitors(desk: Product, count: number): MonitorRec[] {
  return CATALOG.filter((p) => p.category === 'monitor')
    .map((m) => {
      const list = Array.from({ length: count }, () => m);
      const stand = checkMonitorsOnDesk(desk, list, false);
      const arm = checkMonitorsOnDesk(desk, list, true);
      const ok = stand.ok || arm.ok;
      return { product: m, count, ok, needsArm: !stand.ok && arm.ok, check: stand.ok ? stand : arm };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || Number(a.needsArm) - Number(b.needsArm) || b.product.w - a.product.w);
}
