// 플래너 앱: 상태 · 패널 · 끌어서 배치 · 저장.
import { DEFAULT_OPTS, type Item, KEYBOARDS, KIND_INFO, type Kind, MATS, MONITORS, MOTION_MAX, MOTION_MIN, type Room, dims, itemLabel } from './items';
import { arrangeMonitors, cableRecs, contains, restack, ridersOf, runChecks, snapToWalls, toLocal, toWorld, wallGaps } from './layout';
import { PlannerScene, type View } from './scene';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');

type Tab = 'room' | 'add' | 'sel' | 'check';
type CableMode = 'off' | 'messy' | 'tidy';

const STORE = 'desk-planner-v1';
let seq = 0;
const uid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

const WALLS = [
  { c: '#efede9', n: '화이트' },
  { c: '#dcd6cd', n: '웜그레이' },
  { c: '#cdd6c8', n: '세이지' },
  { c: '#c9d2db', n: '블루그레이' },
  { c: '#e6d8c5', n: '베이지' },
];

function exampleState(): { room: Room; items: Item[] } {
  const room: Room = { w: 3200, d: 2800, h: 2400, floor: 'oak', wall: '#efede9', window: 'left' };
  const desk: Item = { id: uid(), kind: 'desk', opt: { ...DEFAULT_OPTS.desk, w: 1400, d: 700 }, x: 200, z: -room.d / 2 + 350 + 60, rot: 0, y: 0 };
  const mk = (kind: Kind, u: number, v: number, opt: Item['opt'] = {}, rot = 0): Item => ({
    id: uid(),
    kind,
    opt: { ...DEFAULT_OPTS[kind], ...opt },
    ...toWorld(desk, u, v),
    rot: desk.rot + rot,
    y: 0,
  });
  const items: Item[] = [
    desk,
    mk('mat', 0, 80),
    mk('monitor', 0, -200, { size: '34uw', mount: 'arm', lightbar: true }),
    mk('keyboard', -40, 140, { layout: 'tkl', color: 'white' }),
    mk('mouse', 250, 150),
    mk('speaker', -520, -230, {}, 10),
    mk('speaker', 520, -230, {}, -10),
    mk('laptop', -560, 90, {}, 15),
    mk('plant', 600, 120, { size: 'desk' }),
    mk('pc', 480, -60),
    mk('chair', 0, 620, {}, 180),
    { id: uid(), kind: 'shelf', opt: { ...DEFAULT_OPTS.shelf }, x: -room.w / 2 + 150, z: -200, rot: 90, y: 0 },
    { id: uid(), kind: 'plant', opt: { size: 'floor' }, x: room.w / 2 - 260, z: -room.d / 2 + 260, rot: 0, y: 0 },
  ];
  arrangeMonitors(desk, items);
  restack(items);
  return { room, items };
}

function load(): { room: Room; items: Item[]; example: boolean } {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s?.room && Array.isArray(s.items)) return { ...s, example: false };
    }
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return { ...exampleState(), example: true };
}

const initial = load();
const state = {
  room: initial.room,
  items: initial.items,
  example: initial.example,
  selected: null as string | null,
  tab: 'add' as Tab,
  view: 'orbit' as View,
  cables: 'off' as CableMode,
  gaps: true,
};

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ room: state.room, items: state.items }));
    } catch {
      /* 무시 */
    }
  }, 300);
}

const scene = new PlannerScene($('viewport'));
const sel = () => state.items.find((i) => i.id === state.selected) ?? null;
const mainDesk = () => state.items.find((i) => i.kind === 'desk');

// ───────────── 동기화 ─────────────
function sync(opts: { cables?: boolean; panel?: boolean } = {}) {
  restack(state.items);
  scene.setItems(state.items);
  const checks = runChecks(state.room, state.items);
  const s = sel();
  const bad = !!s && checks.some((c) => c.level !== 'ok' && c.ids.includes(s.id) && (c.title.includes('겹침') || c.title.includes('방 밖')));
  scene.setSelection(s, bad, state.gaps);
  if (opts.cables !== false) scene.setCables(state.items, state.cables === 'tidy', state.cables !== 'off');
  const issues = checks.filter((c) => c.level !== 'ok');
  const cnt = $('issue-count');
  cnt.hidden = issues.length === 0;
  cnt.textContent = String(issues.length);
  cnt.className = `count${issues.some((c) => c.level === 'bad') ? '' : ' warn'}`;
  $('room-sub').textContent = `방 ${fmt(state.room.w)} × ${fmt(state.room.d)} × ${fmt(state.room.h)} mm · 물건 ${state.items.length}개${state.example ? ' · 예시 구성' : ''}`;
  if (opts.panel !== false) renderPanel();
  save();
}

// ───────────── 추가 ─────────────
function addItem(kind: Kind, opt: Item['opt'] = {}) {
  const o = { ...DEFAULT_OPTS[kind], ...opt };
  const R = state.room;
  const desk = mainDesk();
  const it: Item = { id: uid(), kind, opt: o, x: 0, z: 0, rot: 0, y: 0 };
  const dd = desk ? dims(desk) : null;
  const onDesk = (u: number, v: number, rot = 0) => {
    Object.assign(it, toWorld(desk!, u, v));
    it.rot = desk!.rot + rot;
  };
  if (kind === 'desk') {
    const d = dims(it);
    if (!desk) Object.assign(it, { x: 0, z: -R.d / 2 + d.d / 2 + 60 });
    else Object.assign(it, { x: 0, z: 0 });
  } else if (desk && dd && (KIND_INFO[kind].onSurface || (kind === 'pc' && o.size === 'mini') || (kind === 'plant' && o.size === 'desk'))) {
    const n = state.items.filter((i) => i.kind === kind).length;
    switch (kind) {
      case 'monitor':
        onDesk(0, -dd.d / 2 + 150);
        break;
      case 'keyboard':
        onDesk(-40, dd.d / 2 - 170);
        break;
      case 'mouse':
        onDesk(250, dd.d / 2 - 160);
        break;
      case 'mat':
        onDesk(0, dd.d / 2 - 230);
        break;
      case 'riser':
        onDesk(0, -dd.d / 2 + 140);
        break;
      case 'lamp':
        onDesk(dd.w / 2 - 130, -dd.d / 2 + 140, -20);
        break;
      case 'speaker': {
        const monW = state.items.filter((i) => i.kind === 'monitor' && contains(desk, i.x, i.z, 40)).reduce((s, m) => s + dims(m).w + 10, 0);
        const side = n % 2 ? 1 : -1;
        onDesk(side * Math.min(dd.w / 2 - 80, Math.max(260, monW / 2 + 90)), -dd.d / 2 + 120, side * -10);
        break;
      }
      case 'laptop':
        onDesk(-dd.w / 2 + 200, 40, 15);
        break;
      case 'plant':
        onDesk(dd.w / 2 - 110, -dd.d / 2 + 100);
        break;
      case 'pc':
        onDesk(dd.w / 2 - 160, -dd.d / 2 + 220);
        break;
    }
  } else if (kind === 'chair' && desk && dd) {
    onDesk(0, dd.d / 2 + 260, 180);
  } else if (kind === 'pc' && desk && dd) {
    onDesk(dd.w / 2 - 170, -dd.d / 2 + 280);
  } else if (kind === 'shelf') {
    Object.assign(it, { x: -R.w / 2 + 150, z: 0, rot: 90 });
  } else if (kind === 'plant') {
    Object.assign(it, { x: R.w / 2 - 260, z: -R.d / 2 + 260 });
  }
  state.items.push(it);
  if (kind === 'monitor' && desk) arrangeMonitors(desk, state.items);
  state.selected = it.id;
  state.example = false;
  if (kind === 'speaker' && state.items.filter((i) => i.kind === 'speaker').length % 2 === 1 && opt.pair !== false) {
    addItem('speaker', { ...opt, pair: false });
    return;
  }
  delete it.opt.pair;
  state.tab = 'sel';
  sync();
}

// ───────────── 선택한 물건 변경 ─────────────
function setOpt(it: Item, key: string, value: string | number | boolean) {
  const before = it.kind === 'desk' ? ridersOf(it, state.items).map((r) => ({ r, l: toLocal(it, r.x, r.z) })) : [];
  it.opt = { ...it.opt, [key]: value };
  if (it.kind === 'desk') {
    // 책상 크기가 바뀌면 위 물건이 상판 안에 머물도록 비율로 이동
    const d = dims(it);
    for (const { r, l } of before) Object.assign(r, toWorld(it, Math.max(-d.w / 2 + 60, Math.min(d.w / 2 - 60, l.u)), Math.max(-d.d / 2 + 50, Math.min(d.d / 2 - 50, l.v))));
    if (key === 'type' && value === 'fixed') it.opt.height = 720;
    if (key !== 'height') arrangeMonitors(it, state.items);
  }
  if (it.kind === 'monitor' && (key === 'size' || key === 'mount')) {
    const desk = state.items.find((d) => d.kind === 'desk' && contains(d, it.x, it.z, 60));
    if (desk) arrangeMonitors(desk, state.items);
  }
  state.example = false;
  sync();
}

function rotate(it: Item, delta: number) {
  if (it.kind === 'desk') {
    for (const r of ridersOf(it, state.items)) {
      const l = toLocal(it, r.x, r.z);
      const rr = { ...it, rot: it.rot + delta };
      Object.assign(r, toWorld(rr, l.u, l.v));
      r.rot += delta;
    }
  }
  it.rot = (((it.rot + delta) % 360) + 360) % 360;
  sync();
}

function move(it: Item, dx: number, dz: number) {
  const riders = it.kind === 'desk' ? ridersOf(it, state.items) : [];
  it.x += dx;
  it.z += dz;
  for (const r of riders) {
    r.x += dx;
    r.z += dz;
  }
  sync();
}

function remove(it: Item) {
  state.items = state.items.filter((i) => i !== it);
  state.selected = null;
  sync();
}

function duplicate(it: Item) {
  const copy: Item = { ...it, id: uid(), opt: { ...it.opt }, x: it.x + 150, z: it.z + 150 };
  state.items.push(copy);
  state.selected = copy.id;
  sync();
}

// ───────────── 패널 ─────────────
const chips = (key: string, cur: unknown, options: [string | number, string][], mono = false) =>
  `<div class="row">${options
    .map(([v, l]) => `<button type="button" class="chip${mono ? ' mono' : ''}" data-opt="${key}" data-val="${v}" aria-pressed="${String(cur) === String(v)}">${esc(l)}</button>`)
    .join('')}</div>`;

const TONES: [string, string][] = [
  ['oak', '오크'],
  ['walnut', '월넛'],
  ['white', '화이트'],
  ['black', '블랙'],
];

function roomTab() {
  const R = state.room;
  return `
  <div class="group"><h2>방 크기</h2>
    <div class="fields">
      <label class="field">가로 (mm)<input id="room-w" type="number" min="1500" max="9000" step="50" value="${R.w}" inputmode="numeric"></label>
      <label class="field">세로 (mm)<input id="room-d" type="number" min="1500" max="9000" step="50" value="${R.d}" inputmode="numeric"></label>
      <label class="field">천장 (mm)<input id="room-h" type="number" min="2100" max="3600" step="50" value="${R.h}" inputmode="numeric"></label>
    </div>
    <p class="lead">줄자로 잰 벽 안쪽 치수를 넣으세요. 가로 = 창 쪽에서 봤을 때 좌우 폭.</p>
  </div>
  <div class="group"><h3>바닥</h3>${chips('room-floor', R.floor, [['oak', '오크 마루'], ['walnut', '월넛 마루'], ['gray', '그레이 타일']])}</div>
  <div class="group"><h3>벽 색</h3><div class="row">${WALLS.map((w) => `<button type="button" class="swatch" style="background:${w.c}" data-opt="room-wall" data-val="${w.c}" aria-pressed="${R.wall === w.c}" aria-label="${w.n}" title="${w.n}"></button>`).join('')}</div></div>
  <div class="group"><h3>창문</h3>${chips('room-window', R.window, [['left', '왼쪽 벽'], ['back', '뒤쪽 벽'], ['right', '오른쪽 벽'], ['none', '없음']])}</div>
  <div class="row"><button type="button" class="btn" data-act="example">예시 구성 불러오기</button><button type="button" class="btn danger" data-act="clear">모두 지우기</button></div>`;
}

const CATALOG: { kind: Kind; opt?: Item['opt']; name: string; sub: string }[] = [
  { kind: 'desk', opt: { type: 'motion', w: 1400, d: 700 }, name: '모션데스크', sub: '1400×700 · 650~1250' },
  { kind: 'desk', opt: { type: 'fixed', w: 1200, d: 600 }, name: '일반 책상', sub: '1200×600 · H720' },
  { kind: 'monitor', opt: { size: '27' }, name: '모니터 27"', sub: '16:9 평면' },
  { kind: 'monitor', opt: { size: '34uw', mount: 'arm' }, name: '모니터 34" 곡면', sub: '3440×1440 · 1800R' },
  { kind: 'chair', name: '메쉬 의자', sub: '660×660 · H1180' },
  { kind: 'keyboard', name: '키보드', sub: '텐키리스 360×135' },
  { kind: 'mouse', name: '마우스', sub: '64×120' },
  { kind: 'mat', name: '데스크 매트', sub: '900×400' },
  { kind: 'riser', name: '모니터 받침대', sub: '600×240×110' },
  { kind: 'lamp', name: '스탠드 조명', sub: '관절형 · 조명 포함' },
  { kind: 'speaker', name: '스피커 (2개)', sub: '125×170×210' },
  { kind: 'pc', name: 'PC 본체', sub: '미들타워 230×460×480' },
  { kind: 'laptop', name: '노트북 + 거치대', sub: '14인치' },
  { kind: 'plant', opt: { size: 'desk' }, name: '탁상 화분', sub: '다육이 Ø130' },
  { kind: 'plant', opt: { size: 'floor' }, name: '대형 화분', sub: '산세베리아 H950' },
  { kind: 'shelf', name: '책장', sub: '800×300×1800' },
];

function addTab() {
  const hasDesk = !!mainDesk();
  return `
  <p class="lead">${hasDesk ? '책상 위 물건은 책상에 맞춰 자동으로 놓입니다. 추가한 뒤 ‘선택’ 탭에서 크기·색을 바꾸세요.' : '책상부터 추가하면 나머지 물건이 책상에 맞춰 놓입니다.'}</p>
  <div class="catalog">${CATALOG.map((c, i) => `<button type="button" class="card" data-add="${i}"><b>${esc(c.name)}</b><span>${esc(c.sub)}</span></button>`).join('')}</div>`;
}

function selTab() {
  const it = sel();
  if (!it) return '<p class="empty-sel">3D 화면에서 물건을 누르면 크기·색·위치를 바꿀 수 있습니다.</p>';
  const d = dims(it);
  const g = wallGaps(it, state.room);
  const o = it.opt;
  const parts: string[] = [
    `<div class="selected-head"><h2>${esc(itemLabel(it))}</h2><span class="dims">${d.w}×${d.d}×${d.h}</span></div>`,
  ];
  switch (it.kind) {
    case 'desk':
      parts.push(`<div class="group"><h3>종류</h3>${chips('type', o.type, [['motion', '모션데스크'], ['fixed', '일반 책상']])}</div>`);
      parts.push(`<div class="group"><h3>가로</h3>${chips('w', o.w, [1000, 1200, 1400, 1600, 1800].map((v) => [v, String(v)]), true)}</div>`);
      parts.push(`<div class="group"><h3>깊이</h3>${chips('d', o.d, [600, 700, 800].map((v) => [v, String(v)]), true)}</div>`);
      if (o.type === 'motion') {
        parts.push(`<div class="group"><h3>높이 (앉기 ~720 · 서기 ~1050)</h3><div class="range"><input id="desk-h" type="range" min="${MOTION_MIN}" max="${MOTION_MAX}" step="10" value="${o.height}"><output>${o.height} mm</output></div></div>`);
      }
      parts.push(`<div class="group"><h3>상판</h3>${chips('top', o.top, TONES)}</div>`);
      parts.push(`<div class="group"><h3>프레임</h3>${chips('frame', o.frame, [['black', '블랙'], ['white', '화이트'], ['gray', '그레이']])}</div>`);
      break;
    case 'monitor':
      parts.push(`<div class="group"><h3>크기</h3>${chips('size', o.size, Object.entries(MONITORS).map(([k, v]) => [k, v.label]))}</div>`);
      parts.push(`<div class="group"><h3>거치</h3>${chips('mount', o.mount, [['stand', '기본 스탠드'], ['arm', '모니터암']])}</div>`);
      parts.push(`<div class="group"><h3>모니터 라이트바</h3>${chips('lightbar', o.lightbar, [[true as unknown as string, '장착'], [false as unknown as string, '없음']])}</div>`);
      parts.push(`<div class="group"><h3>색</h3>${chips('color', o.color, [['black', '블랙'], ['white', '화이트']])}</div>`);
      break;
    case 'keyboard':
      parts.push(`<div class="group"><h3>배열</h3>${chips('layout', o.layout, Object.entries(KEYBOARDS).map(([k, v]) => [k, v.label]))}</div>`);
      parts.push(`<div class="group"><h3>색</h3>${chips('color', o.color, [['white', '화이트'], ['gray', '그레이·오렌지'], ['black', '블랙']])}</div>`);
      break;
    case 'mat':
      parts.push(`<div class="group"><h3>크기</h3>${chips('size', o.size, Object.keys(MATS).map((k) => [k, k]), true)}</div>`);
      parts.push(`<div class="group"><h3>색</h3>${chips('color', o.color, [['charcoal', '차콜'], ['gray', '그레이'], ['beige', '베이지'], ['navy', '네이비']])}</div>`);
      break;
    case 'riser':
      parts.push(`<div class="group"><h3>폭</h3>${chips('w', o.w, [[600, '600'], [900, '900']], true)}</div>`);
      parts.push(`<div class="group"><h3>상판</h3>${chips('top', o.top, TONES)}</div>`);
      break;
    case 'speaker':
      parts.push(`<div class="group"><h3>색</h3>${chips('color', o.color, [['black', '블랙'], ['white', '화이트'], ['wood', '우드']])}</div>`);
      break;
    case 'pc':
      parts.push(`<div class="group"><h3>크기</h3>${chips('size', o.size, [['mid', '미들타워'], ['mini', '미니(책상 위)']])}</div>`);
      parts.push(`<div class="group"><h3>색</h3>${chips('color', o.color, [['black', '블랙'], ['white', '화이트']])}</div>`);
      break;
    case 'plant':
      parts.push(`<div class="group"><h3>크기</h3>${chips('size', o.size, [['floor', '대형(바닥)'], ['desk', '탁상']])}</div>`);
      break;
    case 'shelf':
      parts.push(`<div class="group"><h3>폭</h3>${chips('w', o.w, [[600, '600'], [800, '800'], [1200, '1200']], true)}</div>`);
      parts.push(`<div class="group"><h3>높이</h3>${chips('h', o.h, [[1200, '1200'], [1800, '1800']], true)}</div>`);
      parts.push(`<div class="group"><h3>색</h3>${chips('top', o.top, TONES)}</div>`);
      break;
    case 'chair':
    case 'mouse':
    case 'lamp':
      parts.push(`<div class="group"><h3>색</h3>${chips('color', o.color, it.kind === 'chair' ? [['black', '블랙'], ['gray', '그레이'], ['white', '화이트']] : [['white', '화이트'], ['black', '블랙']])}</div>`);
      break;
  }
  parts.push(`<div class="group"><h3>벽까지 거리 (mm)</h3><div class="gaps">${(
    [
      ['왼쪽', g.left],
      ['오른쪽', g.right],
      ['뒤', g.back],
      ['앞', g.front],
    ] as [string, number][]
  )
    .map(([n, v]) => `<div class="gap"><small>${n}</small><b>${fmt(v)}</b></div>`)
    .join('')}</div></div>`);
  parts.push(`<div class="group"><h3>회전 · 이동</h3><div class="row">
      <button type="button" class="btn" data-act="rot" data-val="-15" aria-label="왼쪽으로 15도">⟲ 15°</button>
      <button type="button" class="btn" data-act="rot" data-val="15" aria-label="오른쪽으로 15도">⟳ 15°</button>
      <button type="button" class="btn" data-act="rot" data-val="90">90°</button>
      <button type="button" class="btn" data-act="nudge" data-val="-50,0" aria-label="왼쪽으로 5cm">←</button>
      <button type="button" class="btn" data-act="nudge" data-val="0,-50" aria-label="뒤로 5cm">↑</button>
      <button type="button" class="btn" data-act="nudge" data-val="0,50" aria-label="앞으로 5cm">↓</button>
      <button type="button" class="btn" data-act="nudge" data-val="50,0" aria-label="오른쪽으로 5cm">→</button>
    </div><p class="lead">화살표 버튼·키는 5cm(Shift 1cm)씩, R 키는 15° 회전.</p></div>`);
  parts.push(`<div class="row"><button type="button" class="btn" data-act="dup">복제</button><button type="button" class="btn danger" data-act="del">삭제</button></div>`);
  return parts.join('');
}

function checkTab() {
  const checks = runChecks(state.room, state.items);
  const n = (l: string) => checks.filter((c) => c.level === l).length;
  const order = { bad: 0, warn: 1, ok: 2 } as const;
  const recs = cableRecs(state.items);
  return `
  <div class="summary"><div class="bad"><b>${n('bad')}</b><small>문제</small></div><div class="warn"><b>${n('warn')}</b><small>주의</small></div><div class="ok"><b>${n('ok')}</b><small>통과</small></div></div>
  <div class="checks">${
    checks.length
      ? [...checks]
          .sort((a, b) => order[a.level] - order[b.level])
          .map((c) => `<div class="check ${c.level}"><button type="button" data-pick="${c.ids[0]}"><span class="dot"></span><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></button></div>`)
          .join('')
      : '<p class="empty-sel">책상을 놓으면 시청거리·의자 공간 등을 점검합니다.</p>'
  }</div>
  <div class="group"><h2>선정리 추천</h2><p class="lead">상단의 ‘정리 전 / 정리 후’로 3D 에서 비교해 보세요.</p>
  ${recs.map((r) => `<div class="rec ${r.priority}"><b>${esc(r.title)}</b><span class="spec">${esc(r.spec)}</span><span>${esc(r.reason)}</span></div>`).join('') || '<p class="empty-sel">전원이 필요한 물건을 놓으면 추천이 나타납니다.</p>'}
  </div>
  <p class="note">점검 기준(시청거리, 의자 공간 70cm 등)은 일반적인 권장값을 단순화한 참고용입니다.</p>`;
}

function renderPanel() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  const body = $('tab-body');
  const top = body.scrollTop;
  body.innerHTML = { room: roomTab, add: addTab, sel: selTab, check: checkTab }[state.tab]();
  body.scrollTop = top;
}

$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab as Tab;
  $('tab-body').scrollTop = 0;
  renderPanel();
});

$('tab-body').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>('[data-add]');
  if (add) {
    const c = CATALOG[Number(add.dataset.add)];
    addItem(c.kind, c.opt);
    return;
  }
  const pick = t.closest<HTMLElement>('[data-pick]');
  if (pick) {
    state.selected = pick.dataset.pick ?? null;
    state.tab = 'sel';
    sync({ cables: false });
    return;
  }
  const opt = t.closest<HTMLElement>('[data-opt]');
  if (opt) {
    const key = opt.dataset.opt!;
    const raw = opt.dataset.val!;
    const val: string | number | boolean = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
    if (key.startsWith('room-')) {
      const k = key.slice(5) as 'floor' | 'wall' | 'window';
      state.room = { ...state.room, [k]: val };
      scene.setRoom(state.room);
      sync();
      return;
    }
    const it = sel();
    if (it) setOpt(it, key, val);
    return;
  }
  const act = t.closest<HTMLElement>('[data-act]');
  if (!act) return;
  const it = sel();
  switch (act.dataset.act) {
    case 'rot':
      if (it) rotate(it, Number(act.dataset.val));
      break;
    case 'nudge':
      if (it) {
        const [dx, dz] = act.dataset.val!.split(',').map(Number);
        move(it, dx, dz);
      }
      break;
    case 'dup':
      if (it) duplicate(it);
      break;
    case 'del':
      if (it) remove(it);
      break;
    case 'example': {
      const ex = exampleState();
      Object.assign(state, { room: ex.room, items: ex.items, selected: null, example: true });
      scene.setRoom(state.room);
      sync();
      scene.setView(state.view, state.items);
      break;
    }
    case 'clear':
      state.items = [];
      state.selected = null;
      state.example = false;
      sync();
      break;
  }
});

$('tab-body').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'desk-h') {
    const it = sel();
    if (!it) return;
    it.opt = { ...it.opt, height: Number(el.value) };
    (el.nextElementSibling as HTMLOutputElement).textContent = `${el.value} mm`;
    const d = dims(it);
    const head = document.querySelector('#tab-body .dims');
    if (head) head.textContent = `${d.w}×${d.d}×${d.h}`;
    sync({ panel: false });
  }
});

$('tab-body').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const map: Record<string, 'w' | 'd' | 'h'> = { 'room-w': 'w', 'room-d': 'd', 'room-h': 'h' };
  const k = map[el.id];
  if (!k) return;
  const lim = k === 'h' ? [2100, 3600] : [1500, 9000];
  const v = Math.max(lim[0], Math.min(lim[1], Number(el.value) || state.room[k]));
  state.room = { ...state.room, [k]: v };
  scene.setRoom(state.room);
  sync();
});

// ───────────── 상단 도구 ─────────────
function pressed(group: string, attr: string, value: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`#${group} button`)) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}
$('views').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view as View;
  pressed('views', 'view', state.view);
  scene.setView(state.view, state.items);
});
$('cables').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cables]');
  if (!b) return;
  state.cables = b.dataset.cables as CableMode;
  pressed('cables', 'cables', state.cables);
  if (state.cables !== 'off') {
    state.tab = 'check';
    // 선은 책상 뒤·아래에 있으므로 보이는 시점으로 자동 전환
    if (state.view !== 'under' && mainDesk()) {
      state.view = 'under';
      pressed('views', 'view', 'under');
      scene.setView('under', state.items);
    }
  }
  sync();
});
$('toggle-gaps').addEventListener('click', () => {
  state.gaps = !state.gaps;
  $('toggle-gaps').setAttribute('aria-pressed', String(state.gaps));
  sync({ cables: false, panel: false });
});

// ───────────── 끌어서 이동 ─────────────
const vp = $('viewport');
let drag: { id: string; offX: number; offZ: number; y: number; riders: { it: Item; dx: number; dz: number }[]; moved: boolean } | null = null;
let down: { x: number; y: number } | null = null;

vp.addEventListener(
  'pointerdown',
  (e) => {
    down = { x: e.clientX, y: e.clientY };
    const id = scene.pickItem(e.clientX, e.clientY);
    if (!id) return;
    const it = state.items.find((i) => i.id === id)!;
    const hit = scene.pickPlane(e.clientX, e.clientY, it.y);
    if (!hit) return;
    scene.controls.enabled = false;
    state.selected = id;
    drag = {
      id,
      offX: it.x - hit.x,
      offZ: it.z - hit.z,
      y: it.y,
      riders: it.kind === 'desk' ? ridersOf(it, state.items).map((r) => ({ it: r, dx: r.x - it.x, dz: r.z - it.z })) : [],
      moved: false,
    };
    vp.setPointerCapture(e.pointerId);
    if (state.tab !== 'check') state.tab = 'sel';
    sync({ cables: false });
  },
  { capture: true },
);

vp.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const it = state.items.find((i) => i.id === drag!.id);
  const hit = scene.pickPlane(e.clientX, e.clientY, drag.y);
  if (!it || !hit) return;
  const nx = hit.x + drag.offX;
  const nz = hit.z + drag.offZ;
  if (Math.hypot(nx - it.x, nz - it.z) < 0.5) return;
  drag.moved = true;
  it.x = Math.max(-state.room.w / 2 - 500, Math.min(state.room.w / 2 + 500, nx));
  it.z = Math.max(-state.room.d / 2 - 500, Math.min(state.room.d / 2 + 500, nz));
  if (!KIND_INFO[it.kind].onSurface) snapToWalls(it, state.room);
  for (const r of drag.riders) {
    r.it.x = it.x + r.dx;
    r.it.z = it.z + r.dz;
  }
  state.example = false;
  sync({ cables: false, panel: false });
});

function endDrag(e: PointerEvent) {
  const wasDrag = drag;
  drag = null;
  scene.controls.enabled = true;
  const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
  if (!wasDrag && click) {
    state.selected = null;
    sync({ cables: false });
  } else if (wasDrag) {
    sync();
  }
  down = null;
}
vp.addEventListener('pointerup', endDrag);
vp.addEventListener('pointercancel', endDrag);

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const it = sel();
  if (!it) return;
  const step = e.shiftKey ? 10 : 50;
  const keys: Record<string, () => void> = {
    r: () => rotate(it, e.shiftKey ? -15 : 15),
    R: () => rotate(it, -15),
    Delete: () => remove(it),
    Backspace: () => remove(it),
    Escape: () => {
      state.selected = null;
      sync({ cables: false });
    },
    ArrowLeft: () => move(it, -step, 0),
    ArrowRight: () => move(it, step, 0),
    ArrowUp: () => move(it, 0, -step),
    ArrowDown: () => move(it, 0, step),
  };
  const f = keys[e.key];
  if (f) {
    e.preventDefault();
    f();
  }
});

// ───────────── 시작 ─────────────
scene.setRoom(state.room);
sync();
scene.setView('orbit', state.items);
renderPanel();
