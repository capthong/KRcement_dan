// 샘플 카탈로그. 실제 판매 상품이 아니라 "시중에 흔한 규격"을 일반화한 예시다.
// 실서비스에서는 이 자리에 제휴 API + 직접 정리한 치수 DB 가 들어간다 (보고서 4장 참고).

export type Category =
  | 'desk'
  | 'monitor'
  | 'riser'
  | 'lamp'
  | 'speaker'
  | 'pc'
  | 'keyboard'
  | 'deskmat'
  | 'laptop'
  | 'mouse'
  | 'chair'
  | 'plant'
  | 'shelf';

export interface Product {
  id: string;
  name: string;
  category: Category;
  /** 바닥 투영 가로(x) · 깊이(y) · 높이(z) [mm] */
  w: number;
  d: number;
  h: number;
  color: string;
  /** 전원 플러그 개수 (선정리 추천용) */
  plugs: number;
  /** 책상 위로 올라오는 케이블 수 (영상·USB 등, 전원 제외) */
  dataCables: number;
  desk?: { motorized: boolean; minH: number; maxH: number; topThickness: number };
  monitor?: { diagonalInch: number; aspect: [number, number]; panelW: number; panelH: number; minViewMm: number };
  /** 쇼핑 검색어 (가격/재고는 앱에 저장하지 않고 외부 검색으로 연결) */
  query: string;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  desk: '책상',
  monitor: '모니터',
  riser: '모니터 받침대',
  lamp: '조명',
  speaker: '스피커',
  pc: 'PC 본체',
  keyboard: '키보드',
  deskmat: '데스크 매트',
  laptop: '노트북',
  mouse: '마우스',
  chair: '의자',
  plant: '화분',
  shelf: '책장',
};

/** 대각선(인치)·화면비 → 패널 크기[mm]. 베젤은 좌우 8mm, 하단 15mm 정도로 가정. */
export function monitorPanelMm(diagonalInch: number, aw: number, ah: number) {
  const diagMm = diagonalInch * 25.4;
  const k = diagMm / Math.hypot(aw, ah);
  return { activeW: aw * k, activeH: ah * k, panelW: aw * k + 16, panelH: ah * k + 23 };
}

function desk(
  id: string,
  name: string,
  w: number,
  d: number,
  opts: { motorized?: boolean; color?: string } = {},
): Product {
  const motorized = !!opts.motorized;
  return {
    id,
    name,
    category: 'desk',
    w,
    d,
    h: 720,
    color: opts.color ?? (motorized ? '#d9d4cc' : '#b98d5f'),
    plugs: motorized ? 1 : 0,
    dataCables: 0,
    desk: { motorized, minH: motorized ? 650 : 720, maxH: motorized ? 1250 : 720, topThickness: 25 },
    query: `${motorized ? '모션데스크' : '컴퓨터 책상'} ${w}x${d}`,
  };
}

/** 권장 최소 시청거리 [mm] — 일반적인 가이드를 단순화한 참고값 (보고서 8장 검증 항목) */
function minViewMm(diag: number, aw: number, ah: number): number {
  const ultrawide = aw / ah > 2;
  if (ultrawide) return diag >= 40 ? 900 : 750;
  if (diag <= 24) return 550;
  if (diag <= 27) return 650;
  return 750;
}

function monitor(diag: number, aw: number, ah: number, label: string): Product {
  const p = monitorPanelMm(diag, aw, ah);
  const standH = 110; // 책상 ~ 패널 하단
  return {
    id: `mon-${diag}-${aw}x${ah}`,
    name: `${diag}인치 ${label}`,
    category: 'monitor',
    w: Math.round(p.panelW),
    d: 210,
    h: Math.round(p.panelH + standH),
    color: '#26282c',
    plugs: 1,
    dataCables: 1,
    monitor: {
      diagonalInch: diag,
      aspect: [aw, ah],
      panelW: Math.round(p.panelW),
      panelH: Math.round(p.panelH),
      minViewMm: minViewMm(diag, aw, ah),
    },
    query: `${diag}인치 모니터 ${label.split(' (')[0]}`,
  };
}

export const CATALOG: Product[] = [
  desk('desk-1000x600', '일반 책상 1000×600', 1000, 600),
  desk('desk-1200x600', '일반 책상 1200×600', 1200, 600),
  desk('desk-1200x700', '일반 책상 1200×700', 1200, 700),
  desk('desk-1400x700', '일반 책상 1400×700', 1400, 700),
  desk('desk-1600x800', '일반 책상 1600×800', 1600, 800),
  desk('desk-1800x800', '일반 책상 1800×800', 1800, 800),
  desk('mdesk-1200x700', '모션데스크 1200×700', 1200, 700, { motorized: true }),
  desk('mdesk-1400x700', '모션데스크 1400×700', 1400, 700, { motorized: true }),
  desk('mdesk-1600x800', '모션데스크 1600×800', 1600, 800, { motorized: true }),

  monitor(24, 16, 9, '16:9'),
  monitor(27, 16, 9, '16:9'),
  monitor(32, 16, 9, '16:9'),
  monitor(34, 43, 18, '울트라와이드 21:9 (3440×1440)'),
  monitor(49, 32, 9, '슈퍼울트라와이드 32:9 (5120×1440)'),

  { id: 'riser-550', name: '모니터 받침대 550mm', category: 'riser', w: 550, d: 220, h: 100, color: '#8a6a4a', plugs: 0, dataCables: 0, query: '모니터 받침대 550' },
  { id: 'riser-900', name: '듀얼 모니터 받침대 900mm', category: 'riser', w: 900, d: 240, h: 100, color: '#8a6a4a', plugs: 0, dataCables: 0, query: '듀얼 모니터 받침대' },
  { id: 'lamp-desk', name: '스탠드 조명', category: 'lamp', w: 160, d: 160, h: 420, color: '#f0f0f0', plugs: 1, dataCables: 0, query: '책상 스탠드 조명' },
  { id: 'spk-1', name: '북셸프 스피커 (1개)', category: 'speaker', w: 110, d: 150, h: 180, color: '#3b3b3b', plugs: 1, dataCables: 1, query: '북셸프 PC 스피커' },
  { id: 'pc-mid', name: 'PC 본체 (미들타워)', category: 'pc', w: 220, d: 450, h: 470, color: '#1f2226', plugs: 1, dataCables: 0, query: '미들타워 케이스' },
  { id: 'kb-full', name: '키보드 (풀배열)', category: 'keyboard', w: 440, d: 140, h: 35, color: '#2f3237', plugs: 0, dataCables: 1, query: '기계식 키보드 풀배열' },
  { id: 'kb-tkl', name: '키보드 (텐키리스)', category: 'keyboard', w: 360, d: 140, h: 35, color: '#2f3237', plugs: 0, dataCables: 1, query: '텐키리스 키보드' },
  { id: 'mat-900', name: '데스크 매트 900×400', category: 'deskmat', w: 900, d: 400, h: 3, color: '#45505c', plugs: 0, dataCables: 0, query: '데스크 매트 900x400' },
  { id: 'laptop-14', name: '노트북 14인치 (거치대 포함)', category: 'laptop', w: 320, d: 240, h: 170, color: '#9aa0a6', plugs: 1, dataCables: 1, query: '노트북 거치대' },
];

export function productById(id: string): Product | undefined {
  return CATALOG.find((p) => p.id === id);
}

/** 외부 쇼핑 검색 링크 — 가격·재고를 앱이 보관하지 않아 서버가 필요 없다. */
export function shoppingSearchUrl(p: Product): string {
  return `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(p.query)}`;
}
