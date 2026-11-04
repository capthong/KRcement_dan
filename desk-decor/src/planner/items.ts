// 플래너에서 놓을 수 있는 물건의 종류·옵션·치수. 모든 치수는 mm.
// 3D 모델은 이 치수로 매번 새로 만들기 때문에(절차적 모델링) 크기를 바꿔도 비율이 깨지지 않는다.
import { type Category, type Product, monitorPanelMm, productById } from '../catalog/catalog';

export type Kind =
  | 'desk'
  | 'monitor'
  | 'chair'
  | 'keyboard'
  | 'mouse'
  | 'mat'
  | 'riser'
  | 'lamp'
  | 'speaker'
  | 'pc'
  | 'laptop'
  | 'plant'
  | 'shelf';

export type Opts = Record<string, string | number | boolean>;

export interface Item {
  id: string;
  kind: Kind;
  opt: Opts;
  /** 방 중심 기준 위치 [mm]. x 오른쪽, z 앞(방 안쪽에서 바라보는 사람 쪽) */
  x: number;
  z: number;
  /** Y축 회전 [도]. 0 이면 물건의 앞면이 +z(앞)를 향함 */
  rot: number;
  /** 바닥에서 물건 밑면까지 높이 [mm] — 책상 위에 올리면 상판 높이 (자동 계산) */
  y: number;
}

export interface Room {
  w: number;
  d: number;
  h: number;
  floor: 'oak' | 'walnut' | 'gray';
  wall: string;
  window: 'left' | 'back' | 'right' | 'none';
}

export const DESK_THICKNESS = 25;
export const MOTION_MIN = 650;
export const MOTION_MAX = 1250;

export interface MonitorSpec {
  label: string;
  inch: number;
  aspect: [number, number];
  /** 곡률 반경 [mm] (0 = 평면) */
  curve: number;
  productId: string;
}

export const MONITORS: Record<string, MonitorSpec> = {
  '24': { label: '24" 평면', inch: 24, aspect: [16, 9], curve: 0, productId: 'mon-24-16x9' },
  '27': { label: '27" 평면', inch: 27, aspect: [16, 9], curve: 0, productId: 'mon-27-16x9' },
  '32': { label: '32" 평면', inch: 32, aspect: [16, 9], curve: 0, productId: 'mon-32-16x9' },
  '34uw': { label: '34" 울트라와이드 곡면', inch: 34, aspect: [43, 18], curve: 1800, productId: 'mon-34-43x18' },
  '49suw': { label: '49" 슈퍼울트라와이드 곡면', inch: 49, aspect: [32, 9], curve: 1800, productId: 'mon-49-32x9' },
};

export function monitorGeom(size: string) {
  const s = MONITORS[size] ?? MONITORS['27'];
  const p = monitorPanelMm(s.inch, s.aspect[0], s.aspect[1]);
  const sag = s.curve ? s.curve - Math.sqrt(s.curve ** 2 - (p.panelW / 2) ** 2) : 0;
  return { ...p, spec: s, sag };
}

export const KEYBOARDS: Record<string, { label: string; w: number; d: number }> = {
  full: { label: '풀배열', w: 440, d: 135 },
  tkl: { label: '텐키리스', w: 360, d: 135 },
  '75': { label: '75%', w: 320, d: 128 },
};

export const MATS: Record<string, { w: number; d: number }> = {
  '800x300': { w: 800, d: 300 },
  '900x400': { w: 900, d: 400 },
  '1200x600': { w: 1200, d: 600 },
};

export interface KindInfo {
  label: string;
  /** 책상·받침대 위에 올라가는 물건인가 */
  onSurface: boolean;
  /** 전원 플러그 수, 책상 위로 올라오는 데이터 케이블 수 (선정리 추천용) */
  plugs: number;
  dataCables: number;
}

export const KIND_INFO: Record<Kind, KindInfo> = {
  desk: { label: '책상', onSurface: false, plugs: 0, dataCables: 0 },
  monitor: { label: '모니터', onSurface: true, plugs: 1, dataCables: 1 },
  chair: { label: '의자', onSurface: false, plugs: 0, dataCables: 0 },
  keyboard: { label: '키보드', onSurface: true, plugs: 0, dataCables: 1 },
  mouse: { label: '마우스', onSurface: true, plugs: 0, dataCables: 1 },
  mat: { label: '데스크 매트', onSurface: true, plugs: 0, dataCables: 0 },
  riser: { label: '모니터 받침대', onSurface: true, plugs: 0, dataCables: 0 },
  lamp: { label: '스탠드 조명', onSurface: true, plugs: 1, dataCables: 0 },
  speaker: { label: '스피커', onSurface: true, plugs: 1, dataCables: 1 },
  pc: { label: 'PC 본체', onSurface: false, plugs: 1, dataCables: 0 },
  laptop: { label: '노트북 + 거치대', onSurface: true, plugs: 1, dataCables: 1 },
  plant: { label: '화분', onSurface: false, plugs: 0, dataCables: 0 },
  shelf: { label: '책장', onSurface: false, plugs: 0, dataCables: 0 },
};

/** 기본 옵션 (새로 추가할 때) */
export const DEFAULT_OPTS: Record<Kind, Opts> = {
  desk: { type: 'motion', w: 1400, d: 700, top: 'oak', frame: 'black', height: 720 },
  monitor: { size: '27', mount: 'stand', lightbar: false, color: 'black' },
  chair: { color: 'black' },
  keyboard: { layout: 'tkl', color: 'white' },
  mouse: { color: 'white' },
  mat: { size: '900x400', color: 'charcoal' },
  riser: { w: 600, top: 'walnut' },
  lamp: { color: 'white' },
  speaker: { color: 'black' },
  pc: { size: 'mid', color: 'black' },
  laptop: {},
  plant: { size: 'floor' },
  shelf: { w: 800, h: 1800, top: 'oak' },
};

export interface Dims {
  w: number;
  d: number;
  h: number;
}

export function dims(it: Pick<Item, 'kind' | 'opt'>): Dims {
  const o = it.opt;
  switch (it.kind) {
    case 'desk':
      return { w: Number(o.w), d: Number(o.d), h: o.type === 'motion' ? Number(o.height) : 720 };
    case 'monitor': {
      const g = monitorGeom(String(o.size));
      const arm = o.mount === 'arm';
      return { w: Math.round(g.panelW), d: arm ? 80 : Math.round(Math.max(220, g.sag + 140)), h: Math.round(g.panelH + (arm ? 170 : 115)) };
    }
    case 'chair':
      return { w: 660, d: 660, h: 1180 };
    case 'keyboard': {
      const k = KEYBOARDS[String(o.layout)] ?? KEYBOARDS.tkl;
      return { w: k.w, d: k.d, h: 35 };
    }
    case 'mouse':
      return { w: 64, d: 120, h: 40 };
    case 'mat': {
      const m = MATS[String(o.size)] ?? MATS['900x400'];
      return { w: m.w, d: m.d, h: 3 };
    }
    case 'riser':
      return { w: Number(o.w), d: 240, h: 110 };
    case 'lamp':
      return { w: 170, d: 260, h: 460 };
    case 'speaker':
      return { w: 125, d: 170, h: 210 };
    case 'pc':
      return o.size === 'mini' ? { w: 200, d: 380, h: 380 } : { w: 230, d: 460, h: 480 };
    case 'laptop':
      return { w: 320, d: 260, h: 250 };
    case 'plant':
      return o.size === 'desk' ? { w: 130, d: 130, h: 230 } : { w: 340, d: 340, h: 950 };
    case 'shelf':
      return { w: Number(o.w), d: 300, h: Number(o.h) };
  }
}

/** 의자·PC·화분처럼 책상 밑으로 들어갈 수 있는 높이인가 */
export function fitsUnderDesk(it: Item, desk: Item): boolean {
  const deskUnder = dims(desk).h - DESK_THICKNESS - 40;
  if (it.kind === 'chair') return true; // 의자는 책상 밑으로 밀어 넣는 것이 정상
  return dims(it).h <= deskUnder;
}

export function itemLabel(it: Item): string {
  const o = it.opt;
  switch (it.kind) {
    case 'desk':
      return `${o.type === 'motion' ? '모션데스크' : '일반 책상'} ${o.w}×${o.d}`;
    case 'monitor':
      return `${MONITORS[String(o.size)]?.label ?? '모니터'}${o.mount === 'arm' ? ' · 모니터암' : ''}`;
    case 'keyboard':
      return `키보드 ${KEYBOARDS[String(o.layout)]?.label ?? ''}`;
    case 'mat':
      return `데스크 매트 ${o.size}`;
    case 'riser':
      return `모니터 받침대 ${o.w}`;
    case 'pc':
      return o.size === 'mini' ? 'PC 본체 (미니)' : 'PC 본체 (미들타워)';
    case 'plant':
      return o.size === 'desk' ? '탁상 화분' : '대형 화분';
    case 'shelf':
      return `책장 ${o.w}×${o.h}`;
    default:
      return KIND_INFO[it.kind].label;
  }
}

const CATEGORY_OF: Record<Kind, Category> = {
  desk: 'desk',
  monitor: 'monitor',
  chair: 'chair',
  keyboard: 'keyboard',
  mouse: 'mouse',
  mat: 'deskmat',
  riser: 'riser',
  lamp: 'lamp',
  speaker: 'speaker',
  pc: 'pc',
  laptop: 'laptop',
  plant: 'plant',
  shelf: 'shelf',
};

/** 기존 추천 규칙(recommend/*.ts)에 넘기기 위한 Product 변환 */
export function toProduct(it: Item): Product {
  const d = dims(it);
  const info = KIND_INFO[it.kind];
  const base: Product = {
    id: it.id,
    name: itemLabel(it),
    category: CATEGORY_OF[it.kind],
    w: d.w,
    d: d.d,
    h: d.h,
    color: '#000',
    plugs: info.plugs,
    // 모니터 라이트바는 USB 전원 → 데이터 케이블 1가닥 추가
    dataCables: info.dataCables + (it.kind === 'monitor' && it.opt.lightbar ? 1 : 0),
    query: itemLabel(it),
  };
  if (it.kind === 'desk') {
    const motion = it.opt.type === 'motion';
    base.plugs = motion ? 1 : 0;
    base.desk = { motorized: motion, minH: motion ? MOTION_MIN : 720, maxH: motion ? MOTION_MAX : 720, topThickness: DESK_THICKNESS };
  }
  if (it.kind === 'monitor') {
    const ref = productById(MONITORS[String(it.opt.size)]?.productId ?? '');
    if (ref?.monitor) base.monitor = ref.monitor;
  }
  return base;
}
