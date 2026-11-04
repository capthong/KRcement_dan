// 앱 진입점: 상태 · 단계별 패널 · 사진 위 포인터 조작을 묶는다.
import { CATALOG, type Product, productById, shoppingSearchUrl } from './catalog/catalog';
import { REF_OBJECTS, calibrate, type Calibration, type CalibrationInput } from './geometry/calibrate';
import { measurementUncertainty, refineCorner, toGray } from './geometry/corner';
import { readExif } from './geometry/exif';
import { type Pt, applyHomography, isBeyondHorizon, planeDistanceMm } from './geometry/homography';
import { recommendCableManagement, trayLengthFor } from './recommend/cables';
import { checkMonitorsOnDesk, recommendDesks, recommendMonitors } from './recommend/fit';
import { type PlacedItem, SceneView } from './scene/render';
import { SAMPLE, renderSamplePhoto, sampleGroundTruth } from './scene/sample';

type Step = 1 | 2 | 3 | 4 | 5;
interface Measurement {
  id: string;
  a: Pt;
  b: Pt;
  mm: number;
  unc: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const photo = $<HTMLImageElement>('photo');
const glCanvas = $<HTMLCanvasElement>('gl');
const overlay = document.getElementById('overlay') as unknown as SVGSVGElement;
const loupe = $<HTMLCanvasElement>('loupe');
const zoomer = $('zoomer');
const zoomBtn = $<HTMLButtonElement>('zoom');
const hint = $('hint');
const stepsNav = $('steps');
const body = $('step-body');
const fileInput = $<HTMLInputElement>('file');
const scene = new SceneView(glCanvas);

const state = {
  step: 1 as Step,
  hasImage: false,
  W: 0,
  H: 0,
  focal35: undefined as number | undefined,
  isSample: false,
  refId: 'a4',
  corners: [] as Pt[],
  snapped: [] as boolean[],
  /** 꼭짓점을 찍던 순간의 탭 오차 σ [이미지 px] (확대 상태에 따라 다름) */
  cornerSigma: [] as number[],
  autoSnap: true,
  forceSwap: undefined as boolean | undefined,
  cal: null as Calibration | null,
  calError: '',
  measurements: [] as Measurement[],
  pendingA: null as Pt | null,
  space: { widthMm: undefined as number | undefined, depthMm: undefined as number | undefined },
  surface: 'floor' as 'floor' | 'desk',
  items: [] as PlacedItem[],
  selected: null as string | null,
  monitorCount: 1,
  wantMotorized: undefined as boolean | undefined,
  tidy: false,
  displayW: 0,
  displayH: 0,
  /** 사진 확대 배율(2·3단계에서만). 휴대폰에서는 A4 가 화면에 20px 남짓이라 확대 없이 꼭짓점을 찍기 어렵다. */
  zoom: 1,
  focus: null as Pt | null,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtMm = (mm: number) => `${Math.round(mm).toLocaleString('ko-KR')}mm`;
let uidSeq = 0;
const uid = () => `i${++uidSeq}`;
const isCoarse = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
/** 화면 1px 당 이미지 px (확대 중이면 그만큼 작아짐) */
const scale = () => (state.displayW ? state.W / state.displayW / state.zoom : 1);

// ───────────────────────────── 사진 불러오기 ─────────────────────────────

async function loadPhoto(src: string, focal35: number | undefined, isSample: boolean) {
  await new Promise<void>((res, rej) => {
    photo.onload = () => res();
    photo.onerror = () => rej(new Error('사진을 열 수 없습니다.'));
    photo.src = src;
  });
  Object.assign(state, {
    hasImage: true,
    W: photo.naturalWidth,
    H: photo.naturalHeight,
    focal35,
    isSample,
    corners: [],
    snapped: [],
    cornerSigma: [],
    cal: null,
    calError: '',
    measurements: [],
    pendingA: null,
    items: [],
    selected: null,
    forceSwap: undefined,
    step: 2,
    zoom: 1,
    focus: null,
  });
  photo.hidden = false;
  $('empty').hidden = true;
  stage.classList.add('sized');
  layoutStage();
  renderAll();
}

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  let focal35: number | undefined;
  try {
    focal35 = readExif(await f.slice(0, 256 * 1024).arrayBuffer()).focal35;
  } catch {
    focal35 = undefined;
  }
  const url = URL.createObjectURL(f);
  try {
    await loadPhoto(url, focal35, false);
  } catch (e) {
    setHint((e as Error).message);
  }
  fileInput.value = '';
});

// ───────────────────────────── 레이아웃 ─────────────────────────────

function layoutStage() {
  if (!state.hasImage) return;
  const col = stage.parentElement!;
  const maxW = col.clientWidth;
  const maxH = Math.max(260, window.innerHeight * (window.innerWidth <= 920 ? 0.62 : 0.8));
  const k = Math.min(maxW / state.W, maxH / state.H);
  state.displayW = Math.round(state.W * k);
  state.displayH = Math.round(state.H * k);
  stage.style.width = `${state.displayW}px`;
  stage.style.height = `${state.displayH}px`;
  photo.style.width = `${state.displayW}px`;
  photo.style.height = `${state.displayH}px`;
  overlay.setAttribute('width', String(state.displayW));
  overlay.setAttribute('height', String(state.displayH));
  overlay.setAttribute('viewBox', `0 0 ${state.W} ${state.H}`);
  scene.resize(state.displayW, state.displayH);
  scene.render();
}
new ResizeObserver(() => {
  layoutStage();
  applyZoom();
  renderOverlay();
}).observe(stage.parentElement!);

function applyZoom() {
  const allowed = state.hasImage && (state.step === 2 || state.step === 3);
  if (!allowed) state.zoom = 1;
  zoomBtn.hidden = !allowed;
  zoomBtn.textContent = state.zoom > 1 ? '전체 보기' : '🔍 확대';
  if (state.zoom === 1 || !state.focus) {
    zoomer.style.transform = '';
    return;
  }
  const z = state.zoom;
  const fx = (state.focus.x / state.W) * state.displayW;
  const fy = (state.focus.y / state.H) * state.displayH;
  // 초점이 가운데 오도록 이동하되 사진 밖이 보이지 않게 제한
  const tx = Math.min(0, Math.max(state.displayW * (1 - z), state.displayW / 2 - fx * z));
  const ty = Math.min(0, Math.max(state.displayH * (1 - z), state.displayH / 2 - fy * z));
  zoomer.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
}

zoomBtn.addEventListener('click', () => {
  if (state.zoom > 1) state.zoom = 1;
  else {
    state.zoom = 3;
    const cs = state.corners;
    state.focus =
      state.focus ??
      (cs.length ? { x: cs.reduce((s, p) => s + p.x, 0) / cs.length, y: cs.reduce((s, p) => s + p.y, 0) / cs.length } : { x: state.W / 2, y: state.H / 2 });
  }
  applyZoom();
  renderOverlay();
});

// ───────────────────────────── 보정(캘리브레이션) ─────────────────────────────

function calInput(): CalibrationInput {
  const ref = REF_OBJECTS.find((r) => r.id === state.refId)!;
  return {
    corners: state.corners,
    ref: { w: ref.w, h: ref.h },
    image: { width: state.W, height: state.H },
    focal35: state.focal35,
    forceSwap: state.forceSwap,
  };
}

function recalibrate() {
  state.cal = null;
  state.calError = '';
  if (state.corners.length === 4) {
    try {
      state.cal = calibrate(calInput());
    } catch (e) {
      state.calError = (e as Error).message;
    }
  }
  // 보정이 바뀌면 측정값도 다시 계산
  state.measurements = state.cal
    ? state.measurements.map((m) => ({ ...m, mm: planeDistanceMm(state.cal!.Hinv, m.a, m.b), unc: uncertaintyOf(m.a, m.b) }))
    : [];
  scene.setCalibration(state.cal?.K ?? null, state.cal?.pose ?? null);
}

/** 현재 확대 상태에서 손가락/마우스 탭 오차 σ [이미지 px] */
function tapSigmaPx() {
  return Math.max(0.5, (isCoarse() ? 3 : 1.5) * scale());
}
const SNAPPED_SIGMA_PX = 0.5;

function uncertaintyOf(a: Pt, b: Pt) {
  try {
    const cornerSigmaPx = state.corners.map((_, k) => (state.snapped[k] ? SNAPPED_SIGMA_PX : (state.cornerSigma[k] ?? tapSigmaPx())));
    return measurementUncertainty(calInput(), a, b, { cornerSigmaPx, endSigmaPx: tapSigmaPx() });
  } catch {
    return 1;
  }
}

/** 90% 오차 표시: 30% 를 넘으면 숫자 대신 "오차 큼" */
const uncLabel = (u: number) => (u > 0.3 ? '오차 큼' : `±${Math.max(1, Math.round(u * 100))}%`);

/** 탭 위치 근처의 실제 꼭짓점으로 스냅 (사진에서 작은 패치만 읽어 메모리 절약) */
function snapCorner(p: Pt): { p: Pt; snapped: boolean } {
  if (!state.autoSnap) return { p, snapped: false };
  const r = Math.max(6, 14 * scale());
  const half = Math.ceil(r + 10);
  const sx = Math.max(0, Math.floor(p.x - half));
  const sy = Math.max(0, Math.floor(p.y - half));
  const sw = Math.min(state.W - sx, 2 * half);
  const sh = Math.min(state.H - sy, 2 * half);
  if (sw < 16 || sh < 16) return { p, snapped: false };
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { p, snapped: false };
  ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, sw, sh);
  const img = ctx.getImageData(0, 0, sw, sh);
  const q = refineCorner(toGray(img.data, sw, sh, sx, sy), p.x, p.y, r);
  return q ? { p: q, snapped: true } : { p, snapped: false };
}

// ───────────────────────────── 배치(스택·자동 위치) ─────────────────────────────

function rotLocal(dx: number, dy: number, deg: number) {
  const t = (-deg * Math.PI) / 180;
  return { u: dx * Math.cos(t) - dy * Math.sin(t), v: dx * Math.sin(t) + dy * Math.cos(t) };
}
function toWorld(base: PlacedItem, u: number, v: number) {
  const t = (base.rotDeg * Math.PI) / 180;
  return { x: base.x + u * Math.cos(t) - v * Math.sin(t), y: base.y + u * Math.sin(t) + v * Math.cos(t) };
}
function contains(s: PlacedItem, x: number, y: number) {
  const { u, v } = rotLocal(x - s.x, y - s.y, s.rotDeg);
  return Math.abs(u) <= s.product.w / 2 && Math.abs(v) <= s.product.d / 2;
}

/** 책상 위에 놓인 물건은 상판 높이로, 받침대 위 모니터는 받침대 높이로 올린다. */
function restack() {
  const desks = state.items.filter((i) => i.product.category === 'desk');
  const risers = state.items.filter((i) => i.product.category === 'riser');
  for (const d of desks) d.z = 0;
  const topAt = (x: number, y: number, pool: PlacedItem[]) =>
    pool.filter((s) => contains(s, x, y)).reduce((m, s) => Math.max(m, s.z + s.product.h), 0);
  for (const r of risers) r.z = topAt(r.x, r.y, desks);
  for (const it of state.items) {
    const c = it.product.category;
    if (c === 'desk' || c === 'riser') continue;
    if (c === 'pc') {
      it.z = 0; // 본체는 바닥(책상 하부)에 둔다고 가정
      continue;
    }
    it.z = topAt(it.x, it.y, [...desks, ...risers]);
  }
}

const mainDesk = () => state.items.find((i) => i.product.category === 'desk');

function itemsOnDesk(desk: PlacedItem) {
  return state.items.filter((i) => i !== desk && i.product.category !== 'desk' && contains(desk, i.x, i.y));
}

function defaultSpot(): { x: number; y: number } {
  const c = scene.viewCenterOnPlane();
  if (c && Math.hypot(c.x, c.y) < 8000) return { x: c.x, y: c.y };
  return { x: 105, y: 900 };
}

function layoutMonitors(desk: PlacedItem) {
  const mons = state.items.filter((i) => i.product.category === 'monitor' && contains(desk, i.x, i.y));
  const widths = mons.map((m) => m.product.monitor?.panelW ?? m.product.w);
  const total = widths.reduce((s, w) => s + w, 0) + Math.max(0, mons.length - 1) * 10;
  let u = -total / 2;
  mons.forEach((m, k) => {
    const cu = u + widths[k] / 2;
    u += widths[k] + 10;
    const v = desk.product.d / 2 - (m.onArm ? 70 : 135);
    Object.assign(m, toWorld(desk, cu, v), { rotDeg: desk.rotDeg });
  });
}

function addProduct(p: Product, opts: { onArm?: boolean } = {}) {
  const desk = mainDesk();
  const it: PlacedItem = { uid: uid(), product: p, x: 0, y: 0, z: 0, rotDeg: desk?.rotDeg ?? 0, onArm: opts.onArm };
  if (p.category === 'desk' || !desk || state.surface === 'desk') {
    Object.assign(it, defaultSpot());
    if (p.category === 'desk' && desk) Object.assign(it, { x: desk.x, y: desk.y, rotDeg: desk.rotDeg });
  } else {
    const { w, d } = desk.product;
    const monW = state.items
      .filter((i) => i.product.category === 'monitor')
      .reduce((s, m) => s + (m.product.monitor?.panelW ?? 0) + 10, 0);
    const n = state.items.filter((i) => i.product.category === p.category).length;
    const local: Record<string, [number, number]> = {
      monitor: [0, d / 2 - 135],
      riser: [0, d / 2 - 140],
      keyboard: [-60, -d / 2 + 150],
      deskmat: [0, -d / 2 + 230],
      lamp: [w / 2 - 120, d / 2 - 110],
      speaker: [(n % 2 ? 1 : -1) * Math.min(w / 2 - 70, monW / 2 + 80), d / 2 - 120],
      laptop: [-w / 2 + 210, -20],
      pc: [w / 2 - 170, -30],
    };
    const [u, v] = local[p.category] ?? [0, 0];
    Object.assign(it, toWorld(desk, u, v));
  }
  state.items.push(it);
  if (p.category === 'monitor' && desk) layoutMonitors(desk);
  state.selected = it.uid;
  restack();
}

function replaceDesk(p: Product) {
  const desk = mainDesk();
  if (!desk) return addProduct(p);
  const riders = itemsOnDesk(desk).map((i) => ({ i, l: rotLocal(i.x - desk.x, i.y - desk.y, desk.rotDeg) }));
  desk.product = p;
  // 새 책상 안으로 들어오도록 위 물건 위치를 비율로 맞춤
  for (const { i, l } of riders) {
    Object.assign(i, toWorld(desk, Math.max(-p.w / 2 + 60, Math.min(p.w / 2 - 60, l.u)), Math.max(-p.d / 2 + 40, Math.min(p.d / 2 - 40, l.v))));
  }
  layoutMonitors(desk);
  state.selected = desk.uid;
  restack();
}

function setMonitors(p: Product, count: number, onArm: boolean) {
  state.items = state.items.filter((i) => i.product.category !== 'monitor');
  for (let k = 0; k < count; k++) addProduct(p, { onArm });
}

function rotateItem(it: PlacedItem, delta: number) {
  if (it.product.category === 'desk') {
    for (const r of itemsOnDesk(it)) {
      const l = rotLocal(r.x - it.x, r.y - it.y, it.rotDeg);
      it.rotDeg += delta;
      Object.assign(r, toWorld(it, l.u, l.v));
      it.rotDeg -= delta;
      r.rotDeg += delta;
    }
  }
  it.rotDeg = (it.rotDeg + delta + 360) % 360;
  restack();
}

// ───────────────────────────── 3D 동기화 ─────────────────────────────

function syncScene() {
  scene.setItems(state.items, state.step >= 4 ? state.selected : null);
  const desk = mainDesk();
  if (desk && state.step === 5 && state.surface === 'floor') {
    const devices = state.items
      .filter((i) => i.product.plugs > 0 && i.product.category !== 'desk' && i.z > 0)
      .map((i) => ({ product: i.product, x: i.x, y: i.y, z: i.z }));
    scene.setCables({ product: desk.product, x: desk.x, y: desk.y, rotDeg: desk.rotDeg }, devices, state.tidy, trayLengthFor(desk.product));
  } else {
    scene.setCables(null, [], false, 0);
  }
  scene.render();
}

// ───────────────────────────── SVG 오버레이 ─────────────────────────────

function renderOverlay() {
  if (!state.hasImage) {
    overlay.innerHTML = '';
    return;
  }
  const s = scale();
  const parts: string[] = [];
  const showRef = state.step === 2 || (state.step === 3 && !state.cal);
  // 보정 확인용 바닥 격자(250mm 간격)
  if (state.cal && state.step === 2) {
    const H = state.cal.H;
    const lines: string[] = [];
    const seg = (a: Pt, b: Pt) => {
      let d = '';
      let pen = false;
      for (let k = 0; k <= 40; k++) {
        const P = { x: a.x + ((b.x - a.x) * k) / 40, y: a.y + ((b.y - a.y) * k) / 40 };
        const w = H[6] * P.x + H[7] * P.y + H[8];
        const q = applyHomography(H, P);
        const inView = w > 0 && q.x > -state.W && q.x < 2 * state.W && q.y > -state.H && q.y < 2 * state.H;
        if (inView) {
          d += `${pen ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
          pen = true;
        } else pen = false;
      }
      if (d) lines.push(`<path d="${d}"/>`);
    };
    for (let x = -1500; x <= 1750; x += 250) seg({ x, y: -750 }, { x, y: 3000 });
    for (let y = -750; y <= 3000; y += 250) seg({ x: -1500, y }, { x: 1750, y });
    parts.push(`<g fill="none" stroke="#5cc8ff" stroke-opacity=".55" stroke-width="1" vector-effect="non-scaling-stroke">${lines.join('')}</g>`);
  }
  if (showRef && state.corners.length) {
    const pts = state.corners.map((p) => `${p.x},${p.y}`).join(' ');
    parts.push(
      `<polygon points="${pts}" fill="#ffcc33" fill-opacity=".18" stroke="#ffcc33" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
    );
    state.corners.forEach((p, i) => {
      parts.push(
        `<circle cx="${p.x}" cy="${p.y}" r="${9 * s}" fill="none" stroke="${state.snapped[i] ? '#3ddc84' : '#ffcc33'}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` +
          `<circle cx="${p.x}" cy="${p.y}" r="${1.6 * s}" fill="#fff"/>` +
          `<text x="${p.x + 12 * s}" y="${p.y - 10 * s}" font-size="${13 * s}" fill="#fff" stroke="#000" stroke-width="${3 * s}" paint-order="stroke" font-weight="700">${i + 1}</text>`,
      );
    });
  }
  if (state.step === 3) {
    for (const m of state.measurements) {
      const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
      const label = `${fmtMm(m.mm)} ${uncLabel(m.unc)}`;
      const color = m.unc > 0.05 ? '#ffb347' : '#3ddc84';
      parts.push(
        `<line x1="${m.a.x}" y1="${m.a.y}" x2="${m.b.x}" y2="${m.b.y}" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/>` +
          [m.a, m.b].map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${7 * s}" fill="${color}" stroke="#000" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('') +
          `<text x="${mid.x}" y="${mid.y - 10 * s}" text-anchor="middle" font-size="${14 * s}" font-weight="700" fill="#fff" stroke="#000" stroke-width="${4 * s}" paint-order="stroke">${label}</text>`,
      );
    }
    if (state.pendingA) {
      parts.push(`<circle cx="${state.pendingA.x}" cy="${state.pendingA.y}" r="${7 * s}" fill="#5cc8ff" stroke="#000" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`);
    }
  }
  overlay.innerHTML = parts.join('');
}

// ───────────────────────────── 포인터 조작 ─────────────────────────────

type Drag =
  | { kind: 'corner'; index: number }
  | { kind: 'meas'; id: string; end: 'a' | 'b' }
  | { kind: 'item'; uid: string; offX: number; offY: number; riders: { it: PlacedItem; dx: number; dy: number }[] };
let drag: Drag | null = null;
let downAt: { x: number; y: number; t: number } | null = null;

function toImage(e: PointerEvent): Pt {
  const r = overlay.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * state.W, y: ((e.clientY - r.top) / r.height) * state.H };
}

function nearest(p: Pt, pts: Pt[], maxDisplayPx: number) {
  const lim = maxDisplayPx * scale();
  let best = -1;
  let bd = Infinity;
  pts.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd && d <= lim) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function showLoupe(p: Pt, clientX: number) {
  const ctx = loupe.getContext('2d');
  if (!ctx) return;
  loupe.hidden = false;
  const r = stage.getBoundingClientRect();
  loupe.classList.toggle('right', clientX - r.left < 190);
  const zoom = 3;
  const src = (150 / zoom) * scale();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 150, 150);
  ctx.drawImage(photo, p.x - src / 2, p.y - src / 2, src, src, 0, 0, 150, 150);
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(75, 60);
  ctx.lineTo(75, 90);
  ctx.moveTo(60, 75);
  ctx.lineTo(90, 75);
  ctx.stroke();
}

overlay.addEventListener('pointerdown', (e) => {
  if (!state.hasImage) return;
  const p = toImage(e);
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (state.zoom === 1) state.focus = p;
  if (state.step === 2) {
    // 점이 4개 미만이면 기존 점 "바로 위"를 누른 경우만 끌기 → 작은 기준물체에서도 새 점이 찍힘
    const i = nearest(p, state.corners, state.corners.length < 4 ? 7 : 22);
    if (i >= 0) drag = { kind: 'corner', index: i };
    else if (state.corners.length < 4) {
      state.corners.push(p);
      state.snapped.push(false);
      state.cornerSigma.push(tapSigmaPx());
      drag = { kind: 'corner', index: state.corners.length - 1 };
    }
    if (drag) showLoupe(p, e.clientX);
  } else if (state.step === 3 && state.cal) {
    for (const m of state.measurements) {
      const i = nearest(p, [m.a, m.b], 20);
      if (i >= 0) {
        drag = { kind: 'meas', id: m.id, end: i === 0 ? 'a' : 'b' };
        showLoupe(p, e.clientX);
        break;
      }
    }
    if (!drag) showLoupe(p, e.clientX);
  } else if (state.step >= 4 && state.cal) {
    const id = scene.pickItem(e.clientX, e.clientY);
    state.selected = id;
    if (id) {
      const it = state.items.find((i) => i.uid === id)!;
      const hit = scene.pickPlane(e.clientX, e.clientY);
      const riders = it.product.category === 'desk' ? itemsOnDesk(it).map((r) => ({ it: r, dx: r.x - it.x, dy: r.y - it.y })) : [];
      drag = { kind: 'item', uid: id, offX: hit ? it.x - hit.x : 0, offY: hit ? it.y - hit.y : 0, riders };
    }
    syncScene();
    renderPanel();
  }
  overlay.setPointerCapture(e.pointerId);
  renderOverlay();
});

overlay.addEventListener('pointermove', (e) => {
  if (!state.hasImage) return;
  const p = toImage(e);
  if (!drag) {
    if (state.step === 3 && e.buttons) showLoupe(p, e.clientX);
    return;
  }
  if (drag.kind === 'corner') {
    state.corners[drag.index] = p;
    state.snapped[drag.index] = false;
    state.cornerSigma[drag.index] = tapSigmaPx();
    showLoupe(p, e.clientX);
    renderOverlay();
  } else if (drag.kind === 'meas') {
    const d = drag;
    const m = state.measurements.find((x) => x.id === d.id);
    if (m) m[d.end] = p;
    showLoupe(p, e.clientX);
    if (m && state.cal) m.mm = planeDistanceMm(state.cal.Hinv, m.a, m.b);
    renderOverlay();
  } else if (drag.kind === 'item') {
    const it = state.items.find((i) => i.uid === (drag as { uid: string }).uid);
    const hit = scene.pickPlane(e.clientX, e.clientY);
    if (it && hit && Math.hypot(hit.x, hit.y) < 15000) {
      it.x = hit.x + drag.offX;
      it.y = hit.y + drag.offY;
      for (const r of drag.riders) {
        r.it.x = it.x + r.dx;
        r.it.y = it.y + r.dy;
      }
      restack();
      syncScene();
    }
  }
});

function endPointer(e: PointerEvent) {
  loupe.hidden = true;
  const p = state.hasImage ? toImage(e) : null;
  const wasTap = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8;
  if (drag?.kind === 'corner') {
    const r = snapCorner(state.corners[drag.index]);
    state.corners[drag.index] = r.p;
    state.snapped[drag.index] = r.snapped;
    recalibrate();
    renderPanel();
  } else if (drag?.kind === 'meas') {
    const m = state.measurements.find((x) => x.id === (drag as { id: string }).id);
    if (m) m.unc = uncertaintyOf(m.a, m.b);
    renderPanel();
  } else if (drag?.kind === 'item') {
    renderPanel();
  } else if (state.step === 3 && state.cal && p && wasTap) {
    if (isBeyondHorizon(state.cal.Hinv, p, state.cal.H)) {
      setHint('그 지점은 기준면(바닥/책상) 위가 아닙니다. 기준면 위의 점만 잴 수 있어요.');
    } else if (!state.pendingA) {
      state.pendingA = p;
      setHint('두 번째 점을 탭하세요.');
    } else {
      const a = state.pendingA;
      state.pendingA = null;
      const m: Measurement = { id: uid(), a, b: p, mm: planeDistanceMm(state.cal.Hinv, a, p), unc: uncertaintyOf(a, p) };
      state.measurements.push(m);
      renderPanel();
    }
  }
  drag = null;
  downAt = null;
  renderOverlay();
  updateHint();
}
overlay.addEventListener('pointerup', endPointer);
overlay.addEventListener('pointercancel', () => {
  drag = null;
  loupe.hidden = true;
});

window.addEventListener('keydown', (e) => {
  if (state.step < 4 || !state.selected) return;
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const it = state.items.find((i) => i.uid === state.selected);
  if (!it) return;
  if (e.key === 'r' || e.key === 'R') rotateItem(it, e.shiftKey ? -15 : 15);
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    state.items = state.items.filter((i) => i !== it);
    state.selected = null;
  } else return;
  e.preventDefault();
  syncScene();
  renderPanel();
});

// ───────────────────────────── 패널 ─────────────────────────────

const STEP_LABEL: Record<Step, string> = { 1: '사진', 2: '기준', 3: '측정', 4: '배치', 5: '선정리' };

function stepEnabled(s: Step) {
  if (s === 1) return true;
  if (s === 2) return state.hasImage;
  return !!state.cal;
}
function stepDone(s: Step) {
  return (s === 1 && state.hasImage) || (s === 2 && !!state.cal) || (s === 3 && !!state.space.widthMm) || (s === 4 && state.items.length > 0);
}

function renderSteps() {
  stepsNav.innerHTML = ([1, 2, 3, 4, 5] as Step[])
    .map(
      (s) =>
        `<button type="button" data-step="${s}" ${state.step === s ? 'aria-current="step"' : ''} class="${stepDone(s) ? 'done' : ''}" ${stepEnabled(s) ? '' : 'disabled'}><span class="n">${stepDone(s) && state.step !== s ? '✓' : s}</span>${STEP_LABEL[s]}</button>`,
    )
    .join('');
}

function setHint(t: string) {
  hint.textContent = t;
}
function updateHint() {
  const n = state.corners.length;
  const msg: Record<Step, string> = {
    1: '사진을 고르면 시작합니다.',
    2:
      n < 4
        ? `A4 꼭짓점을 먼 왼쪽부터 시계 방향으로 탭 (${n}/4). 작게 보이면 🔍 확대, 점은 끌어서 이동.`
        : state.cal
          ? '파란 격자가 바닥(책상) 줄눈과 나란하면 보정이 잘 된 것입니다.'
          : state.calError,
    3: state.pendingA ? '두 번째 점을 탭하세요.' : '기준면 위의 두 점을 차례로 탭해 길이를 잽니다. 끝점은 끌어서 조정할 수 있어요.',
    4: '물건을 끌어 옮기고, 목록에서 회전·삭제하세요. (선택 후 R 키: 15° 회전)',
    5: '선정리 전/후를 바꿔 보며 필요한 용품을 확인하세요.',
  };
  setHint(msg[state.step]);
}

function plannedMonitors(): Product[] {
  return state.items.filter((i) => i.product.category === 'monitor').map((i) => i.product);
}

/** 기준면이 책상 상판일 때, 측정한 상판 크기를 가상의 책상으로 취급 */
function virtualDesk(): Product | undefined {
  if (state.surface !== 'desk' || !state.space.widthMm) return undefined;
  return {
    id: 'virtual-desk',
    name: `내 책상 (${Math.round(state.space.widthMm)}×${Math.round(state.space.depthMm ?? 600)})`,
    category: 'desk',
    w: state.space.widthMm,
    d: state.space.depthMm ?? 600,
    h: 720,
    color: '#000',
    plugs: 0,
    dataCables: 0,
    desk: { motorized: !!state.wantMotorized, minH: 720, maxH: state.wantMotorized ? 1250 : 720, topThickness: 25 },
    query: '',
  };
}

function step1() {
  return `
    <h2>1. 사진 고르기</h2>
    <p class="lead">책상을 놓을 자리(바닥) 또는 지금 쓰는 책상 위를 찍어 주세요. <b>A4 용지</b>를 같은 면에 놓고 찍으면 길이를 잴 수 있습니다.</p>
    <div class="row">
      <button class="btn primary" data-action="pick">사진 선택 / 촬영</button>
      <button class="btn" data-action="sample">샘플 사진으로 체험</button>
    </div>
    <div class="note">
      <b>잘 찍는 법</b>
      <ul>
        <li>A4 용지가 <b>화면에서 크게</b> 보이도록 (손바닥만 하게 보이면 좋음)</li>
        <li>너무 비스듬하지 않게 — 위에서 30~60° 내려다보는 각도</li>
        <li>재고 싶은 곳이 A4 와 <b>같은 면(바닥 또는 상판)</b>에 있어야 함</li>
      </ul>
    </div>`;
}

function step2() {
  const c = state.cal;
  const fsrc = { exif: '사진 EXIF', estimated: '기준물체로 추정', default: '기본값(26mm)' } as const;
  return `
    <h2>2. 기준물체 지정</h2>
    <label class="field">기준물체
      <select data-action="ref">${REF_OBJECTS.map((r) => `<option value="${r.id}" ${r.id === state.refId ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
    </label>
    <label class="field">기준물체가 놓인 면
      <select data-action="surface">
        <option value="floor" ${state.surface === 'floor' ? 'selected' : ''}>바닥 — 책상 놓을 자리를 잴 때</option>
        <option value="desk" ${state.surface === 'desk' ? 'selected' : ''}>책상 상판 — 지금 책상 위를 꾸밀 때</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" data-action="snap" ${state.autoSnap ? 'checked' : ''}/> 꼭짓점 자동 보정 (초록 원 = 보정됨)</label>
    <div class="row">
      <button class="btn small" data-action="reset-corners" ${state.corners.length ? '' : 'disabled'}>점 다시 찍기</button>
      ${c ? `<button class="btn small" data-action="swap">가로·세로 바꾸기</button>` : ''}
    </div>
    ${state.calError ? `<div class="note bad">${esc(state.calError)}</div>` : ''}
    ${
      c
        ? `<dl class="kv">
            <dt>상태</dt><dd><span class="badge ok">보정 완료</span></dd>
            <dt>카메라 높이</dt><dd>${(c.pose.cameraHeightMm / 10).toFixed(0)}cm (기준면에서)</dd>
            <dt>초점거리</dt><dd>${fsrc[c.focalSource]} · ${Math.round((c.K.fx * 36) / Math.max(state.W, state.H))}mm 환산</dd>
            <dt>꼭짓점 보정</dt><dd>${state.snapped.filter(Boolean).length}/4</dd>
          </dl>
          ${c.warnings.map((w) => `<div class="note warn">${esc(w)}</div>`).join('')}
          <div class="footer-actions"><span></span><button class="btn primary" data-goto="3">다음: 길이 재기</button></div>`
        : ''
    }`;
}

function step3() {
  const ms = state.measurements;
  return `
    <h2>3. 길이 재기</h2>
    <p class="lead">${state.surface === 'floor' ? '책상을 놓을 수 있는 <b>가로 폭</b>(벽~가구 사이)과 벽에서부터의 <b>깊이</b>를 재 보세요.' : '책상 상판의 <b>가로</b>와 <b>깊이</b>를 재 보세요.'} 측정값 옆 ±%는 탭 위치 오차를 반영한 90% 범위입니다.</p>
    <div class="list">
      ${
        ms.length
          ? ms
              .map(
                (m, i) => `<div class="card"><div class="meas"><span class="mono">#${i + 1} <b>${fmtMm(m.mm)}</b> <span class="badge ${m.unc > 0.05 ? 'warn' : 'ok'}">${uncLabel(m.unc)}</span></span>
                <span class="row"><button class="btn small" data-action="use-w" data-id="${m.id}">폭으로</button><button class="btn small" data-action="use-d" data-id="${m.id}">깊이로</button><button class="btn small ghost" data-action="del-m" data-id="${m.id}" aria-label="삭제">✕</button></span></div>
                ${m.unc > 0.05 ? '<span class="lead">오차가 큽니다. A4 를 더 크게 찍거나 꼭짓점을 확대해 다시 찍어 보세요.</span>' : ''}</div>`,
              )
              .join('')
          : '<div class="note">아직 측정값이 없습니다. 사진 위 두 점을 탭하세요.</div>'
      }
    </div>
    <div class="grid2">
      <label class="field">${state.surface === 'floor' ? '공간 가로 폭' : '상판 가로'} (mm)<input type="number" inputmode="numeric" min="300" step="10" data-action="space-w" value="${state.space.widthMm ? Math.round(state.space.widthMm) : ''}" placeholder="예: 1500"/></label>
      <label class="field">${state.surface === 'floor' ? '벽에서 깊이' : '상판 깊이'} (mm)<input type="number" inputmode="numeric" min="300" step="10" data-action="space-d" value="${state.space.depthMm ? Math.round(state.space.depthMm) : ''}" placeholder="선택"/></label>
    </div>
    <div class="note">줄자로 잰 값이 있으면 직접 입력해도 됩니다. 사진 측정은 <b>±몇 %</b> 오차가 있습니다.</div>
    <div class="footer-actions"><button class="btn" data-goto="2">이전</button><button class="btn primary" data-goto="4" ${state.space.widthMm ? '' : 'disabled'}>다음: 추천·배치</button></div>`;
}

function deskCard(r: ReturnType<typeof recommendDesks>[number], current?: Product) {
  const p = r.product;
  const isCurrent = current?.id === p.id;
  return `<div class="card ${r.fits ? '' : 'dim'}">
    <div class="card-head"><span class="card-title">${esc(p.name)}</span>
      ${r.fits ? (r.needsArm ? '<span class="badge warn">모니터암 권장</span>' : '<span class="badge ok">들어감</span>') : '<span class="badge bad">안 들어감</span>'}</div>
    <ul>${[...r.reasons, ...r.warnings].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="row"><button class="btn small ${isCurrent ? '' : 'primary'}" data-action="place-desk" data-id="${p.id}" ${r.fits && !isCurrent ? '' : 'disabled'}>${isCurrent ? '배치됨' : current ? '이 책상으로 교체' : '배치'}</button>
    <a class="shop" href="${shoppingSearchUrl(p)}" target="_blank" rel="noopener">비슷한 상품 검색 ↗</a></div></div>`;
}

function step4() {
  const desk = mainDesk();
  const vdesk = virtualDesk();
  const deskP = desk?.product ?? vdesk;
  const parts: string[] = ['<h2>4. 추천 · 배치</h2>'];
  if (state.surface === 'floor') {
    const recs = recommendDesks(
      { widthMm: state.space.widthMm ?? 0, depthMm: state.space.depthMm },
      plannedMonitors(),
      state.wantMotorized,
    );
    parts.push(`<h3>책상 — 공간 폭 ${fmtMm(state.space.widthMm ?? 0)}${state.space.depthMm ? ` · 깊이 ${fmtMm(state.space.depthMm)}` : ''}</h3>
      <label class="field">책상 종류
        <select data-action="motorized"><option value="" ${state.wantMotorized === undefined ? 'selected' : ''}>상관없음</option><option value="1" ${state.wantMotorized === true ? 'selected' : ''}>모션데스크(높이조절) 선호</option><option value="0" ${state.wantMotorized === false ? 'selected' : ''}>일반 책상 선호</option></select>
      </label>
      <div class="list">${recs.slice(0, 4).map((r) => deskCard(r, desk?.product)).join('')}</div>`);
  }
  if (deskP) {
    const mrecs = recommendMonitors(deskP, state.monitorCount);
    const curMon = plannedMonitors();
    const check = curMon.length ? checkMonitorsOnDesk(deskP, curMon, state.items.some((i) => i.onArm)) : null;
    parts.push(`<h3>모니터 — ${esc(deskP.name)} 기준</h3>
      <div class="row"><label class="field" style="flex:1">대수<select data-action="moncount"><option value="1" ${state.monitorCount === 1 ? 'selected' : ''}>1대</option><option value="2" ${state.monitorCount === 2 ? 'selected' : ''}>2대</option></select></label></div>
      ${check && !check.ok ? `<div class="note warn">${check.issues.map(esc).join('<br/>')}</div>` : ''}
      <div class="list">${mrecs
        .slice(0, 5)
        .map(
          (r) => `<div class="card ${r.ok ? '' : 'dim'}"><div class="card-head"><span class="card-title">${esc(r.product.name)} ×${r.count}</span>
          ${r.ok ? (r.needsArm ? '<span class="badge warn">모니터암 필요</span>' : '<span class="badge ok">적합</span>') : '<span class="badge bad">부적합</span>'}</div>
          <ul><li>전체 폭 ${fmtMm(r.check.totalWidthMm)} / 책상 ${fmtMm(deskP.w)}</li><li>예상 시청거리 ${Math.round(r.check.viewDistanceMm / 10)}cm (권장 ${Math.round(r.check.requiredViewMm / 10)}cm 이상)</li>${r.check.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <div class="row"><button class="btn small" data-action="place-mon" data-id="${r.product.id}" data-arm="${r.needsArm ? 1 : 0}" ${r.ok && (desk || state.surface === 'desk') ? '' : 'disabled'}>배치</button><a class="shop" href="${shoppingSearchUrl(r.product)}" target="_blank" rel="noopener">비슷한 상품 검색 ↗</a></div></div>`,
        )
        .join('')}</div>`);
  } else if (state.surface === 'floor') {
    parts.push('<div class="note">책상을 먼저 배치하면 그 책상에 맞는 모니터를 추천합니다.</div>');
  }
  const acc = CATALOG.filter((p) => !['desk', 'monitor'].includes(p.category));
  parts.push(`<h3>소품</h3><div class="row">${acc
    .map((p) => `<button class="btn small" data-action="add" data-id="${p.id}" ${desk || state.surface === 'desk' || p.category === 'pc' ? '' : 'disabled'}>+ ${esc(p.name)}</button>`)
    .join('')}</div>`);
  if (state.items.length) {
    parts.push(`<h3>배치한 물건 (${state.items.length})</h3><div class="list">${state.items
      .map(
        (i) => `<div class="placed ${i.uid === state.selected ? 'sel' : ''}"><span class="name" data-action="select" data-id="${i.uid}">${esc(i.product.name)}${i.onArm ? ' · 암' : ''}</span>
        ${i.product.category === 'monitor' ? `<button class="btn small" data-action="arm" data-id="${i.uid}">${i.onArm ? '스탠드로' : '암으로'}</button>` : ''}
        <button class="btn small" data-action="rot" data-id="${i.uid}" aria-label="15도 회전">⟳</button>
        <button class="btn small ghost" data-action="del" data-id="${i.uid}" aria-label="삭제">✕</button></div>`,
      )
      .join('')}</div>`);
  }
  parts.push(`<div class="footer-actions"><button class="btn" data-goto="3">이전</button><button class="btn primary" data-goto="5" ${state.items.length ? '' : 'disabled'}>다음: 선정리</button></div>`);
  return parts.join('');
}

function step5() {
  const desk = mainDesk();
  const deskP = desk?.product ?? virtualDesk();
  const recs = recommendCableManagement({
    products: [...(deskP && !desk ? [deskP] : []), ...state.items.map((i) => i.product)],
    desk: deskP,
    pcOnFloor: state.items.some((i) => i.product.category === 'pc' && i.z === 0),
    monitorsOnArm: state.items.filter((i) => i.onArm).length,
  });
  const label = { must: ['bad', '필수'], recommended: ['info', '권장'], optional: ['warn', '선택'] } as const;
  return `
    <h2>5. 선정리 추천</h2>
    ${desk && state.surface === 'floor' ? `<div class="row"><button class="btn ${state.tidy ? '' : 'primary'}" data-action="tidy" data-v="0">정리 전</button><button class="btn ${state.tidy ? 'primary' : ''}" data-action="tidy" data-v="1">정리 후</button></div>` : '<div class="note">기준면이 책상 상판이면 3D 케이블 표시는 생략하고 목록만 보여 줍니다.</div>'}
    <div class="list">${
      recs.length
        ? recs
            .map(
              (r) => `<div class="card prio-${r.priority}"><div class="card-head"><span class="card-title">${esc(r.title)}</span><span class="badge ${label[r.priority][0]}">${label[r.priority][1]}</span></div>
              <span class="mono" style="font-size:13px">${esc(r.spec)}</span><span class="lead">${esc(r.reason)}</span>
              ${r.query ? `<a class="shop" href="https://search.shopping.naver.com/search/all?query=${encodeURIComponent(r.query)}" target="_blank" rel="noopener">검색 ↗</a>` : ''}</div>`,
            )
            .join('')
        : '<div class="note">전원이 필요한 물건을 배치하면 추천이 나타납니다.</div>'
    }</div>
    <div class="row"><button class="btn" data-action="png">이미지 저장 (PNG)</button><button class="btn" data-action="json">구성 내보내기 (JSON)</button></div>
    <div class="note">이 화면의 추천은 규칙 기반 예시입니다. 실제 구매 전 제품 상세 치수·정격을 꼭 확인하세요.</div>
    <div class="footer-actions"><button class="btn" data-goto="4">이전</button><button class="btn ghost" data-action="restart">처음부터</button></div>`;
}

function renderPanel() {
  renderSteps();
  body.innerHTML = [step1, step2, step3, step4, step5][state.step - 1]();
  stage.dataset.mode = !state.hasImage ? 'none' : state.step === 2 ? 'corners' : state.step === 3 ? 'measure' : 'place';
  updateHint();
}

function renderAll() {
  applyZoom();
  renderPanel();
  renderOverlay();
  syncScene();
}

function goto(s: Step) {
  if (!stepEnabled(s)) return;
  state.step = s;
  state.pendingA = null;
  renderAll();
}

stepsNav.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-step]') as HTMLButtonElement | null;
  if (b) goto(Number(b.dataset.step) as Step);
});

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

body.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest('[data-action], [data-goto]') as HTMLElement | null;
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (el.dataset.goto) return goto(Number(el.dataset.goto) as Step);
  const id = el.dataset.id ?? '';
  const item = state.items.find((i) => i.uid === id);
  switch (el.dataset.action) {
    case 'pick':
      fileInput.click();
      return;
    case 'sample':
      await loadPhoto(renderSamplePhoto(), SAMPLE.focal35, true);
      if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __truth: sampleGroundTruth(), __state: state });
      return;
    case 'reset-corners':
      state.corners = [];
      state.snapped = [];
      state.cornerSigma = [];
      state.forceSwap = undefined;
      recalibrate();
      break;
    case 'swap':
      state.forceSwap = !state.cal?.swapped;
      recalibrate();
      break;
    case 'use-w':
    case 'use-d': {
      const m = state.measurements.find((x) => x.id === id);
      if (m) state.space[el.dataset.action === 'use-w' ? 'widthMm' : 'depthMm'] = m.mm;
      break;
    }
    case 'del-m':
      state.measurements = state.measurements.filter((m) => m.id !== id);
      break;
    case 'place-desk': {
      const p = productById(id);
      if (p) mainDesk() ? replaceDesk(p) : addProduct(p);
      break;
    }
    case 'place-mon': {
      const p = productById(id);
      if (p) setMonitors(p, state.monitorCount, el.dataset.arm === '1');
      break;
    }
    case 'add': {
      const p = productById(id);
      if (p) addProduct(p);
      break;
    }
    case 'select':
      state.selected = id;
      break;
    case 'rot':
      if (item) rotateItem(item, 15);
      break;
    case 'arm':
      if (item) {
        item.onArm = !item.onArm;
        const desk = mainDesk();
        if (desk) layoutMonitors(desk);
      }
      break;
    case 'del':
      state.items = state.items.filter((i) => i.uid !== id);
      if (state.selected === id) state.selected = null;
      restack();
      break;
    case 'tidy':
      state.tidy = el.dataset.v === '1';
      break;
    case 'png': {
      const blob = await scene.snapshot(photo, state.W, state.H);
      if (blob) download(blob, 'desk-setup.png');
      return;
    }
    case 'json': {
      const data = {
        version: 1,
        space: state.space,
        surface: state.surface,
        items: state.items.map((i) => ({ product: i.product.id, x: Math.round(i.x), y: Math.round(i.y), rotDeg: i.rotDeg, onArm: !!i.onArm })),
      };
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'desk-setup.json');
      return;
    }
    case 'restart':
      location.reload();
      return;
    default:
      return;
  }
  renderAll();
});

body.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  switch (el.dataset.action) {
    case 'ref':
      state.refId = el.value;
      state.forceSwap = undefined;
      recalibrate();
      break;
    case 'surface':
      state.surface = el.value as 'floor' | 'desk';
      state.items = [];
      state.selected = null;
      break;
    case 'snap':
      state.autoSnap = (el as HTMLInputElement).checked;
      return;
    case 'space-w':
    case 'space-d': {
      const v = Number(el.value);
      state.space[el.dataset.action === 'space-w' ? 'widthMm' : 'depthMm'] = v > 0 ? v : undefined;
      break;
    }
    case 'motorized':
      state.wantMotorized = el.value === '' ? undefined : el.value === '1';
      break;
    case 'moncount':
      state.monitorCount = Number(el.value);
      break;
    default:
      return;
  }
  renderAll();
});

renderAll();
