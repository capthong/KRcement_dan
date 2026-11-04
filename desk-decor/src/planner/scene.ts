// three.js 장면: 방(벽·창·바닥·조명), 물건, 선택·치수 표시, 선정리, 카메라 시점.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildCables, cableSide } from './cables3d';
import { type Item, type Room, dims } from './items';
import { type Gaps, aabb, corners, wallGaps } from './layout';
import { buildItem, materials as M, rbox } from './models';
import { floorTexture } from './textures';

const mm = (v: number) => v / 1000;
export type View = 'orbit' | 'seated' | 'top' | 'under';

export class PlannerScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
  readonly controls: OrbitControls;
  private roomGroup = new THREE.Group();
  private itemsGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private cableGroup = new THREE.Group();
  private walls: { mesh: THREE.Object3D[]; normal: THREE.Vector3; point: THREE.Vector3; mat: THREE.Material[] }[] = [];
  private sun = new THREE.DirectionalLight('#fff1dc', 3.8);
  private nodes = new Map<string, { group: THREE.Group; key: string }>();
  private room!: Room;
  private needsRender = true;
  private cutAll = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    host.appendChild(this.labels.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    this.scene.background = new THREE.Color('#d9dde2');

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#a8927a', 0.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const ceiling = new THREE.PointLight('#fff6ea', 6, 0, 2);
    ceiling.name = 'ceiling';
    this.scene.add(ceiling);

    this.scene.add(this.roomGroup, this.itemsGroup, this.overlay, this.cableGroup);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 14;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      const moved = this.controls.update();
      if (moved || this.needsRender) {
        this.updateCutaway();
        this.renderer.render(this.scene, this.camera);
        this.labels.render(this.scene, this.camera);
        this.needsRender = false;
      }
    };
    loop();
  }

  invalidate() {
    this.needsRender = true;
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  // ───────────── 방 ─────────────
  setRoom(room: Room) {
    this.room = room;
    this.roomGroup.clear();
    this.walls = [];
    const W = mm(room.w);
    const D = mm(room.d);
    const H = mm(room.h);
    const T = 0.12;

    const fmap = floorTexture(room.floor).clone();
    fmap.needsUpdate = true;
    fmap.repeat.set(W / 2, D / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: fmap, roughness: room.floor === 'gray' ? 0.5 : 0.42, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.roomGroup.add(floor);

    const win = { w: 1.3, h: 1.35, sill: 0.85 };
    const defs = [
      { id: 'back', len: W, pos: new THREE.Vector3(0, 0, -D / 2), rotY: 0, normal: new THREE.Vector3(0, 0, 1) },
      { id: 'front', len: W, pos: new THREE.Vector3(0, 0, D / 2), rotY: Math.PI, normal: new THREE.Vector3(0, 0, -1) },
      { id: 'left', len: D, pos: new THREE.Vector3(-W / 2, 0, 0), rotY: Math.PI / 2, normal: new THREE.Vector3(1, 0, 0) },
      { id: 'right', len: D, pos: new THREE.Vector3(W / 2, 0, 0), rotY: -Math.PI / 2, normal: new THREE.Vector3(-1, 0, 0) },
    ];
    for (const d of defs) {
      const hasWin = room.window === d.id && d.len > win.w + 0.4;
      const s = new THREE.Shape();
      s.moveTo(-d.len / 2 - T, 0);
      s.lineTo(d.len / 2 + T, 0);
      s.lineTo(d.len / 2 + T, H);
      s.lineTo(-d.len / 2 - T, H);
      s.lineTo(-d.len / 2 - T, 0);
      if (hasWin) {
        const hole = new THREE.Path();
        hole.moveTo(-win.w / 2, win.sill);
        hole.lineTo(-win.w / 2, win.sill + win.h);
        hole.lineTo(win.w / 2, win.sill + win.h);
        hole.lineTo(win.w / 2, win.sill);
        hole.lineTo(-win.w / 2, win.sill);
        s.holes.push(hole);
      }
      const geo = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false });
      geo.translate(0, 0, -T); // 안쪽 면이 z=0
      const mat = new THREE.MeshStandardMaterial({ color: room.wall, roughness: 0.92 });
      const wall = new THREE.Mesh(geo, mat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      const g = new THREE.Group();
      g.add(wall);
      const base = rbox(d.len, 0.07, 0.012, 0.002, M.matte('#f3f1ed', 0.6), 0, 0.035, 0.006);
      g.add(base);
      const parts: THREE.Object3D[] = [base];
      const partMats: THREE.Material[] = [mat];
      if (hasWin) {
        const frameM = M.plastic('#fafaf8', 0.4);
        const fw = 0.05;
        const fr = [
          rbox(win.w + fw * 2, fw, 0.07, 0.006, frameM, 0, win.sill - fw / 2, -0.03),
          rbox(win.w + fw * 2, fw, 0.07, 0.006, frameM, 0, win.sill + win.h + fw / 2, -0.03),
          rbox(fw, win.h, 0.07, 0.006, frameM, -win.w / 2 - fw / 2, win.sill + win.h / 2, -0.03),
          rbox(fw, win.h, 0.07, 0.006, frameM, win.w / 2 + fw / 2, win.sill + win.h / 2, -0.03),
          rbox(0.04, win.h, 0.05, 0.004, frameM, 0, win.sill + win.h / 2, -0.05),
          rbox(win.w + 0.12, 0.025, 0.16, 0.006, frameM, 0, win.sill - 0.0125, 0.02),
        ];
        fr.forEach((f) => g.add(f));
        const sky = new THREE.Mesh(
          new THREE.PlaneGeometry(win.w + 0.4, win.h + 0.4),
          new THREE.MeshBasicMaterial({ color: '#cfe4f5', toneMapped: false }),
        );
        sky.position.set(0, win.sill + win.h / 2, -T - 0.6);
        g.add(sky);
        parts.push(...fr, sky);
      }
      g.position.copy(d.pos);
      g.rotation.y = d.rotY;
      this.roomGroup.add(g);
      this.walls.push({ mesh: parts, normal: d.normal, point: d.pos.clone(), mat: partMats });
      if (hasWin) {
        // 창밖에서 들어오는 햇빛: 창 반대쪽 아래로 비스듬히
        const out = d.normal.clone().multiplyScalar(-1);
        this.sun.position.copy(d.pos).add(out.multiplyScalar(3.2)).add(new THREE.Vector3(0, win.sill + win.h + 2.0, 0));
        this.sun.target.position.copy(d.pos).add(d.normal.clone().multiplyScalar(1.6));
      }
    }
    // 천장: 보이지는 않지만 그림자를 만들어 햇빛이 창으로만 들어오게 함
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.1, D + 0.4), new THREE.MeshStandardMaterial({ colorWrite: false, depthWrite: false }));
    ceil.position.y = H + 0.05;
    ceil.castShadow = true;
    this.roomGroup.add(ceil);
    this.sun.visible = room.window !== 'none';
    const sc = this.sun.shadow.camera;
    const ext = Math.max(W, D) * 0.9 + 1;
    Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 14 });
    sc.updateProjectionMatrix();
    const ceiling = this.scene.getObjectByName('ceiling') as THREE.PointLight;
    ceiling.position.set(0, H - 0.15, 0);
    ceiling.intensity = room.window === 'none' ? 8 : 4;
    this.needsRender = true;
  }

  /** 카메라가 벽 바깥에 있으면 그 벽을 투명 처리(그림자는 유지) */
  private updateCutaway() {
    const cam = this.camera.position;
    for (const w of this.walls) {
      const outside = this.cutAll || cam.clone().sub(w.point).dot(w.normal) < 0.02;
      for (const m of w.mat) (m as THREE.MeshStandardMaterial).colorWrite = !outside;
      for (const m of w.mat) (m as THREE.MeshStandardMaterial).depthWrite = !outside;
      for (const p of w.mesh) p.visible = !outside;
    }
  }

  // ───────────── 물건 ─────────────
  setItems(items: Item[]) {
    const alive = new Set(items.map((i) => i.id));
    for (const [id, n] of this.nodes) {
      if (!alive.has(id)) {
        this.itemsGroup.remove(n.group);
        this.nodes.delete(id);
      }
    }
    let monitorIdx = 0;
    for (const it of items) {
      const variant = it.kind === 'monitor' ? monitorIdx++ : 0;
      const key = JSON.stringify([it.opt, variant]);
      let n = this.nodes.get(it.id);
      if (!n || n.key !== key) {
        if (n) this.itemsGroup.remove(n.group);
        const group = new THREE.Group();
        group.add(buildItem(it, variant));
        group.userData.itemId = it.id;
        n = { group, key };
        this.nodes.set(it.id, n);
        this.itemsGroup.add(group);
      }
      n.group.position.set(mm(it.x), mm(it.y), mm(it.z));
      n.group.rotation.y = THREE.MathUtils.degToRad(it.rot);
    }
    this.needsRender = true;
  }

  setCables(items: Item[], tidy: boolean, show: boolean) {
    this.cableGroup.clear();
    if (show && this.room) this.cableGroup.add(buildCables(items, this.room, tidy));
    this.needsRender = true;
  }

  /** 선택 표시: 바닥 사각형 + 크기 + 벽까지 거리 */
  setSelection(it: Item | null, bad: boolean, showGaps: boolean) {
    this.overlay.clear();
    if (!it) {
      this.needsRender = true;
      return;
    }
    const color = bad ? '#e5484d' : '#2f6fed';
    const y = mm(it.y) + 0.004;
    const c = corners(it).map((p) => new THREE.Vector3(mm(p.x), y, mm(p.z)));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    line.renderOrder = 10;
    this.overlay.add(line);
    const d = dims(it);
    const label = this.label(`${d.w} × ${d.d} × ${d.h}`, 'size');
    label.position.set(mm(it.x), mm(it.y + d.h) + 0.06, mm(it.z));
    this.overlay.add(label);
    if (showGaps && this.room) this.drawGaps(it, wallGaps(it, this.room));
    this.needsRender = true;
  }

  private drawGaps(it: Item, g: Gaps) {
    const b = aabb(it);
    const W = this.room.w / 2;
    const D = this.room.d / 2;
    const y = Math.max(0.01, mm(it.y) + 0.01);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const segs: [number, number, number, number, number][] = [
      [b.minX, cz, -W, cz, g.left],
      [b.maxX, cz, W, cz, g.right],
      [cx, b.minZ, cx, -D, g.back],
      [cx, b.maxZ, cx, D, g.front],
    ];
    for (const [x1, z1, x2, z2, v] of segs) {
      if (v < 15 || v > 2500) continue;
      const pts = [new THREE.Vector3(mm(x1), y, mm(z1)), new THREE.Vector3(mm(x2), y, mm(z2))];
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#2f6fed', dashSize: 0.03, gapSize: 0.02, depthTest: false }));
      l.computeLineDistances();
      l.renderOrder = 10;
      this.overlay.add(l);
      const lab = this.label(`${Math.round(v)}`, 'gap');
      lab.position.copy(pts[0]).lerp(pts[1], 0.5);
      this.overlay.add(lab);
    }
  }

  private label(text: string, cls: string) {
    const el = document.createElement('div');
    el.className = `dim ${cls}`;
    el.textContent = text;
    return new CSS2DObject(el);
  }

  // ───────────── 카메라 ─────────────
  setView(view: View, items: Item[]) {
    const W = mm(this.room.w);
    const D = mm(this.room.d);
    const H = mm(this.room.h);
    const desk = items.find((i) => i.kind === 'desk');
    const focus = desk ? new THREE.Vector3(mm(desk.x), mm(dims(desk).h) * 0.8, mm(desk.z)) : new THREE.Vector3(0, 0.7, 0);
    this.cutAll = view === 'top';
    if (view === 'orbit') {
      const r = Math.max(W, D) * 1.2 + 1.5;
      this.camera.fov = 42;
      this.camera.position.set(focus.x + r * 0.45, Math.max(H * 1.05, 2.3), focus.z + r * 0.9);
      this.controls.target.copy(focus);
    } else if (view === 'top') {
      this.camera.fov = 45;
      this.camera.position.set(0.001, Math.max(W, D) * 1.45 + 1.2, 0.35);
      this.controls.target.set(0, 0, 0);
    } else if (view === 'under' && desk) {
      // 선을 내리는 쪽(바닥 본체 반대편) 앞에서 낮게 상판 아래·뒤쪽을 봄
      const dd = dims(desk);
      const t = THREE.MathUtils.degToRad(desk.rot);
      const fwd = new THREE.Vector3(Math.sin(t), 0, Math.cos(t));
      const right = new THREE.Vector3(Math.cos(t), 0, -Math.sin(t));
      const side = cableSide(items, desk);
      const c = new THREE.Vector3(mm(desk.x), 0, mm(desk.z));
      this.camera.fov = 52;
      this.camera.position
        .copy(c)
        .add(right.clone().multiplyScalar(side * (mm(dd.w) / 2 + 0.45)))
        .add(fwd.clone().multiplyScalar(mm(dd.d) / 2 + 1.15));
      this.camera.position.y = 0.72;
      this.controls.target
        .copy(c)
        .add(right.clone().multiplyScalar(side * (mm(dd.w) / 2 - 0.45)))
        .add(fwd.clone().multiplyScalar(-mm(dd.d) / 2 + 0.15));
      this.controls.target.y = 0.33;
    } else if (desk) {
      const chair = items.find((i) => i.kind === 'chair');
      const dd = dims(desk);
      const t = THREE.MathUtils.degToRad(desk.rot);
      const fwd = new THREE.Vector3(Math.sin(t), 0, Math.cos(t));
      const standing = dd.h > 950;
      const eyeH = standing ? 1.58 : 1.18;
      const base = chair && !standing ? new THREE.Vector3(mm(chair.x), 0, mm(chair.z)) : new THREE.Vector3(mm(desk.x), 0, mm(desk.z)).add(fwd.clone().multiplyScalar(mm(dd.d) / 2 + 0.45));
      this.camera.fov = 62;
      this.camera.position.set(base.x, eyeH, base.z).add(fwd.clone().multiplyScalar(0.05));
      const mon = items.find((i) => i.kind === 'monitor');
      const look = mon ? new THREE.Vector3(mm(desk.x), mm(mon.y) + mm(dims(mon).h) * 0.6, mm(desk.z)) : new THREE.Vector3(mm(desk.x), mm(dd.h) + 0.2, mm(desk.z));
      this.controls.target.copy(look);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsRender = true;
  }

  // ───────────── 포인터 ─────────────
  private ray = new THREE.Raycaster();
  private ndc(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }
  pickItem(cx: number, cy: number): string | null {
    this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
    const hits = this.ray.intersectObjects(this.itemsGroup.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.itemId) o = o.parent;
      if (o) return o.userData.itemId as string;
    }
    return null;
  }
  /** 화면 좌표 → 높이 yMm 인 수평면 위 점 [mm] */
  pickPlane(cx: number, cy: number, yMm: number): { x: number; z: number } | null {
    this.ray.setFromCamera(this.ndc(cx, cy), this.camera);
    const p = new THREE.Vector3();
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -mm(yMm)), p);
    return hit ? { x: p.x * 1000, z: p.z * 1000 } : null;
  }
}
