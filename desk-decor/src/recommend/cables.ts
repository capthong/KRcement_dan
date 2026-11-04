// 배치한 물건 목록 → 선정리(wire management) 용품 추천.
// 각 추천에 "근거(reason)"를 붙여 사용자가 왜 필요한지 납득할 수 있게 한다.
import type { Product } from '../catalog/catalog';

export type Priority = 'must' | 'recommended' | 'optional';

export interface CableRec {
  id: string;
  title: string;
  spec: string;
  reason: string;
  priority: Priority;
  query: string;
}

export interface CableInput {
  products: Product[];
  /** 메인 책상 (없으면 책상 하부 관련 추천 생략) */
  desk?: Product;
  pcOnFloor: boolean;
  monitorsOnArm: number;
}

const STD_TRAY_MM = [400, 600, 800, 1000, 1200];
const STD_CABLE_M = [1, 1.5, 1.8, 2, 3, 5];
const STD_OUTLETS = [3, 4, 5, 6, 8];

const roundUp = (x: number, std: number[]) => std.find((s) => s >= x) ?? std[std.length - 1];

/** 책상 폭에서 다리·프레임 간섭(300mm)을 뺀 범위 안의 최대 표준 트레이 길이 */
export function trayLengthFor(desk: Product): number {
  const usable = desk.w - 300;
  return [...STD_TRAY_MM].reverse().find((s) => s <= usable) ?? STD_TRAY_MM[0];
}

export function recommendCableManagement(input: CableInput): CableRec[] {
  const { products, desk, pcOnFloor, monitorsOnArm } = input;
  const recs: CableRec[] = [];
  const nonDesk = products.filter((p) => p.category !== 'desk');
  const plugs = products.reduce((s, p) => s + p.plugs, 0);
  const dataCables = nonDesk.reduce((s, p) => s + p.dataCables, 0);
  const monitors = products.filter((p) => p.category === 'monitor');
  const hasLaptop = products.some((p) => p.category === 'laptop');
  const motorized = !!desk?.desk?.motorized;

  if (plugs > 0) {
    const outlets = roundUp(plugs + 2, STD_OUTLETS);
    recs.push({
      id: 'power-strip',
      title: `개별 스위치 멀티탭 ${outlets}구`,
      spec: `전원 플러그 ${plugs}개 + 여유 2구`,
      reason: '플러그 수보다 2구 이상 넉넉해야 충전기 추가 시 문어발 연결을 막을 수 있습니다. 합산 소비전력이 멀티탭 정격(보통 16A) 이내인지 확인하세요.',
      priority: 'must',
      query: `개별스위치 멀티탭 ${outlets}구 16A`,
    });
  }

  if (desk) {
    const trayLen = trayLengthFor(desk);
    recs.push({
      id: 'cable-tray',
      title: `책상 하부 케이블 트레이 ${trayLen}mm`,
      spec: `책상 폭 ${desk.w}mm − 다리 간섭 300mm 이내 최대 규격`,
      reason: '멀티탭과 남는 케이블을 책상 상판 아래에 올려 두면 바닥에 닿는 선이 1~2가닥으로 줄어듭니다.',
      priority: plugs >= 3 ? 'must' : 'recommended',
      query: `책상 케이블 트레이 ${trayLen}`,
    });
  }

  if (motorized && desk?.desk) {
    const travel = desk.desk.maxH - desk.desk.minH;
    recs.push({
      id: 'cable-spine',
      title: '수직 케이블 체인(스파인)',
      spec: `길이 ${Math.ceil(desk.desk.maxH / 100) / 10}m 이상`,
      reason: `모션데스크는 높이가 ${travel}mm 변합니다. 바닥으로 내려가는 선을 체인으로 묶어야 상승 시 당겨지거나 끼지 않습니다.`,
      priority: 'must',
      query: '모션데스크 케이블 체인 스파인',
    });
    recs.push({
      id: 'slack-rule',
      title: '케이블 여유 길이 규칙',
      spec: `책상→바닥 구간 모든 선은 최소 ${Math.round((travel + 200) / 10)}cm 여유`,
      reason: '멀티탭은 트레이에 고정해 책상과 같이 움직이게 하고, 바닥으로는 전원선 1가닥만 내려보내는 구성이 가장 안전합니다.',
      priority: 'must',
      query: '',
    });
  }

  if (pcOnFloor && monitors.length) {
    const deskTop = motorized && desk?.desk ? desk.desk.maxH : (desk?.h ?? 720);
    const needM = (deskTop + 400 + 300 + 200) / 1000; // 높이 + 수평 이동 + 모니터까지 + 여유
    const len = roundUp(needM, STD_CABLE_M);
    recs.push({
      id: 'video-cable',
      title: `모니터 케이블 ${len}m`,
      spec: `필요 경로 약 ${needM.toFixed(1)}m (책상 높이 ${deskTop}mm 기준)`,
      reason: '바닥의 본체에서 책상 위 모니터까지는 생각보다 깁니다. 짧으면 팽팽하게 당겨져 정리가 무너집니다.',
      priority: 'recommended',
      query: `DP 케이블 ${len}m`,
    });
    recs.push({
      id: 'pc-mount',
      title: '책상 하부 PC 거치대(언더데스크 마운트)',
      spec: `본체 폭 220mm 내외 지원 제품`,
      reason: '본체를 바닥에서 띄우면 청소가 쉽고, 본체-책상 사이 케이블이 짧아집니다.' + (motorized ? ' 모션데스크라면 본체가 책상과 같이 움직여 영상 케이블 여유가 거의 필요 없어집니다.' : ''),
      priority: 'optional',
      query: '책상 하부 PC 거치대',
    });
  }

  if (monitors.length >= 2 || (monitors.length >= 1 && hasLaptop)) {
    recs.push({
      id: 'dock',
      title: hasLaptop ? 'USB-C 도킹스테이션 (또는 USB-C 입력 모니터)' : '모니터 전원·영상선 묶음 정리',
      spec: hasLaptop ? '노트북 1가닥 연결로 충전+화면+주변기기' : `모니터 ${monitors.length}대 × (전원+영상)`,
      reason: hasLaptop
        ? '노트북에 꽂는 선을 1가닥으로 줄이는 것이 책상 위 선정리 효과가 가장 큽니다.'
        : '모니터마다 2가닥씩 나오므로 모니터 뒤에서 한 번 묶어 트레이로 내리면 깔끔합니다.',
      priority: 'recommended',
      query: hasLaptop ? 'USB-C 도킹스테이션 듀얼모니터' : '케이블 정리 슬리브',
    });
  }

  if (monitorsOnArm > 0) {
    recs.push({
      id: 'arm-channel',
      title: '모니터암 내장 케이블 가이드 활용',
      spec: `상판 두께 ${desk?.desk?.topThickness ?? 25}mm — 클램프 지원 범위 확인`,
      reason: '암 내부 홈으로 선을 넣으면 모니터 뒤 늘어지는 선이 사라집니다. 클램프 두께 범위와 책상 뒤 벽과의 거리를 같이 확인하세요.',
      priority: 'recommended',
      query: '모니터암 케이블 정리',
    });
  }

  const totalCables = plugs + dataCables;
  if (totalCables > 0) {
    recs.push({
      id: 'velcro',
      title: `벨크로 케이블 타이 ${totalCables > 10 ? '20' : '10'}개입`,
      spec: `케이블 약 ${totalCables}가닥 기준`,
      reason: '플라스틱 케이블 타이와 달리 다시 풀 수 있어 장비를 바꿀 때 편합니다.',
      priority: 'recommended',
      query: '벨크로 케이블 타이',
    });
  }

  if (dataCables >= 2) {
    recs.push({
      id: 'desk-clip',
      title: `책상 모서리 케이블 클립 ${dataCables}구 이상`,
      spec: `책상 위로 올라오는 선 ${dataCables}가닥`,
      reason: '키보드·스피커·충전 케이블 끝이 책상 뒤로 떨어지지 않게 잡아 줍니다.',
      priority: 'optional',
      query: '책상 케이블 클립 마그네틱',
    });
  }

  const order: Record<Priority, number> = { must: 0, recommended: 1, optional: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}
