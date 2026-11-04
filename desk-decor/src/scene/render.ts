// three.js 오버레이: 사진과 같은 원근(카메라 자세·초점거리)으로 3D 상품을 그린다.
import * as THREE from 'three';
import type { Product } from '../catalog/catalog';
import type { Intrinsics, Pose } from '../geometry/pose';
import { buildCables, type CableDevice, type DeskPlacement } from './cablesMesh';
import { buildProductMesh, footprintOutline } from './models';

export interface PlacedItem {
  uid: string;
  product: Product;
  x: number;
  y: number;
  /** 바닥(또는 기준면)에서의 높이 — 책상 위에 올리면 상판 높이 */
  z: number;
  rotDeg: number;
  onArm?: boolean;
}

/** OpenCV 규약 카메라(R,t,K) → three.js 카메라 행렬/투영 행렬 */
export function applyCvCamera(cam: THREE.Camera, K: Intrinsics, pose: Pose, near = 10, far = 60000) {
  const R = pose.R;
  const C = pose.cameraPos;
  // 카메라의 world 축: x = R 1행, y(위) = -R 2행, z(뒤) = -R 3행
  const m = new THREE.Matrix4().set(
    R[0], -R[3], -R[6], C[0],
    R[1], -R[4], -R[7], C[1],
    R[2], -R[5], -R[8], C[2],
    0, 0, 0, 1,
  );
  cam.matrixAutoUpdate = false;
  cam.matrix.copy(m);
  cam.matrixWorld.copy(m);
  cam.matrixWorldInverse.copy(m).invert();
  const { fx, fy, cx, cy, width: W, height: H } = K;
  cam.projectionMatrix.set(
    (2 * fx) / W, 0, 1 - (2 * cx) / W, 0,
    0, (2 * fy) / H, (2 * cy) / H - 1, 0,
    0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
    0, 0, -1, 0,
  );
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  private itemsRoot = new THREE.Group();
  private extrasRoot = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private meshes = new Map<string, THREE.Group>();
  private calibrated = false;
  private K: Intrinsics | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -3000;
    sc.right = 3000;
    sc.top = 3000;
    sc.bottom = -3000;
    sc.near = 100;
    sc.far = 12000;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    // 그림자만 받는 투명 바닥 → 사진 위에 접지 그림자가 생겨 "놓여 있는" 느낌
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.ShadowMaterial({ opacity: 0.3 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.itemsRoot, this.extrasRoot);
  }

  setCalibration(K: Intrinsics | null, pose: Pose | null) {
    this.calibrated = !!(K && pose);
    this.K = K;
    if (K && pose) {
      applyCvCamera(this.camera, K, pose);
      // 조명: 카메라 뒤쪽 위에서 비춰 물체 뒤로 그림자가 지게
      const [cx, cy] = pose.cameraPos;
      this.sun.position.set(cx * 0.4 - 800, cy * 0.4 - 600, 4500);
      this.sun.target.position.set(0, 800, 0);
      this.sun.target.updateMatrixWorld();
    }
  }

  resize(displayW: number, displayH: number) {
    this.renderer.setSize(displayW, displayH, false);
    const c = this.renderer.domElement;
    c.style.width = `${displayW}px`;
    c.style.height = `${displayH}px`;
  }

  setItems(items: PlacedItem[], selectedUid: string | null) {
    const alive = new Set(items.map((i) => i.uid));
    for (const [uid, g] of this.meshes) {
      if (!alive.has(uid)) {
        this.itemsRoot.remove(g);
        this.meshes.delete(uid);
      }
    }
    for (const it of items) {
      const key = `${it.product.id}|${it.onArm ? 1 : 0}`;
      let g = this.meshes.get(it.uid);
      if (!g || g.userData.key !== key) {
        if (g) this.itemsRoot.remove(g);
        g = new THREE.Group();
        g.add(buildProductMesh(it.product, { onArm: it.onArm }));
        g.userData = { key, uid: it.uid };
        this.meshes.set(it.uid, g);
        this.itemsRoot.add(g);
      }
      g.position.set(it.x, it.y, it.z);
      g.rotation.z = THREE.MathUtils.degToRad(it.rotDeg);
      const old = g.getObjectByName('__sel');
      if (old) g.remove(old);
      if (it.uid === selectedUid) {
        const o = footprintOutline(it.product.w + 30, it.product.d + 30);
        o.name = '__sel';
        o.position.z = 1;
        g.add(o);
      }
    }
  }

  setCables(desk: DeskPlacement | null, devices: CableDevice[], tidy: boolean, trayLenMm: number) {
    this.extrasRoot.clear();
    if (desk) this.extrasRoot.add(buildCables(desk, devices, tidy, trayLenMm));
  }

  render() {
    if (!this.calibrated) {
      this.renderer.clear();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** 화면 좌표 → 기준 평면(z=planeZ) 위 world 좌표 */
  pickPlane(clientX: number, clientY: number, planeZ = 0): THREE.Vector3 | null {
    if (!this.calibrated) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ), hit) ? hit : null;
  }

  pickItem(clientX: number, clientY: number): string | null {
    if (!this.calibrated) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hits = ray.intersectObjects(this.itemsRoot.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.uid) o = o.parent;
      if (o) return o.userData.uid as string;
    }
    return null;
  }

  /** 이미지 중앙 시선이 평면과 만나는 점 (새 물건을 놓을 기본 위치) */
  viewCenterOnPlane(): THREE.Vector3 | null {
    if (!this.calibrated || !this.K) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, -0.2), this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit) ? hit : null;
  }

  /** 사진 + 3D 를 합성한 PNG */
  async snapshot(photo: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
    const maxSide = 2048;
    const s = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.round(w * s);
    const ch = Math.round(h * s);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(photo, 0, 0, cw, ch);
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(cw, ch, false);
    this.render();
    ctx.drawImage(this.renderer.domElement, 0, 0, cw, ch);
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.render();
    return new Promise((res) => canvas.toBlob(res, 'image/png'));
  }
}
