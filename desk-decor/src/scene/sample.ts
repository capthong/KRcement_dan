// 체험용 "샘플 사진": 실제 방 사진 대신, 치수를 정확히 아는 가상의 방을 렌더링한다.
// 정답(ground truth)을 알기 때문에 측정 정확도를 브라우저 E2E 테스트로 검증할 수 있다.
import * as THREE from 'three';
import type { Vec3 } from '../geometry/linalg';
import { focalPxFrom35mm, lookAtPose, makeIntrinsics, projectPoint, type Pose } from '../geometry/pose';
import { applyCvCamera } from './render';

export const SAMPLE = {
  width: 1600,
  height: 1200,
  focal35: 26,
  eye: [120, -1250, 1350] as Vec3,
  target: [0, 1150, 250] as Vec3,
  /** 바닥 위 A4 (가까운 왼쪽 꼭짓점 기준) */
  a4: { x0: -130, y0: 820, w: 210, h: 297 },
  wallY: 2000,
  wardrobeRightX: -800,
  shelfLeftX: 800,
};

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b9926a';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 8; i++) {
    const shade = 180 + ((i * 37) % 30) - 15;
    g.fillStyle = `rgb(${shade}, ${shade * 0.79}, ${shade * 0.57})`;
    g.fillRect(i * 128 + 2, 0, 124, 1024);
    g.fillStyle = 'rgba(80,50,25,0.35)';
    g.fillRect(i * 128, 0, 2, 1024);
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = 'rgba(120,80,45,0.18)';
      g.beginPath();
      const x = i * 128 + 10 + ((k * 53) % 110);
      g.moveTo(x, 0);
      g.bezierCurveTo(x + 8, 300, x - 8, 700, x + 4, 1024);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function samplePose(): { K: ReturnType<typeof makeIntrinsics>; R: number[]; t: Vec3 } {
  const K = makeIntrinsics(SAMPLE.width, SAMPLE.height, focalPxFrom35mm(SAMPLE.focal35, SAMPLE.width, SAMPLE.height));
  const { R, t } = lookAtPose(SAMPLE.eye, SAMPLE.target);
  return { K, R, t };
}

/** 정답 픽셀 좌표 (E2E 테스트·디버그용) */
export function sampleGroundTruth() {
  const { K, R, t } = samplePose();
  const P = (x: number, y: number, z = 0) => {
    const p = projectPoint(K, R, t, [x, y, z]);
    return { x: p.x, y: p.y };
  };
  const { x0, y0, w, h } = SAMPLE.a4;
  return {
    a4Corners: [P(x0, y0 + h), P(x0 + w, y0 + h), P(x0 + w, y0), P(x0, y0)],
    gapA: P(SAMPLE.wardrobeRightX, SAMPLE.wallY - 40),
    gapB: P(SAMPLE.shelfLeftX, SAMPLE.wallY - 40),
    gapMm: SAMPLE.shelfLeftX - SAMPLE.wardrobeRightX,
  };
}

export function renderSamplePhoto(): string {
  const { K, R, t } = samplePose();
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE.width;
  canvas.height = SAMPLE.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SAMPLE.width, SAMPLE.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ddd8cf');
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x7a6a58, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.4);
  sun.position.set(-1500, -800, 3200);
  sun.target.position.set(0, 1200, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3000, right: 3000, top: 3000, bottom: -3000, near: 100, far: 9000 });
  scene.add(sun, sun.target);

  const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // 바닥 · 벽 · 걸레받이
  add(new THREE.PlaneGeometry(8000, 8000), std('#ffffff', { map: plankTexture() }), 0, 1000, 0, false);
  const wall = add(new THREE.PlaneGeometry(8000, 2600), std('#efebe4'), 0, SAMPLE.wallY, 1300, false);
  wall.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(8000, 14, 80), std('#f7f5f2'), 0, SAMPLE.wallY - 7, 40);
  // 창문
  const win = add(new THREE.PlaneGeometry(1000, 1100), std('#cfe3f1', { emissive: '#bcd6ea', emissiveIntensity: 0.5 }), 150, SAMPLE.wallY - 2, 1700, false);
  win.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(1060, 40, 60), std('#ffffff'), 150, SAMPLE.wallY - 20, 1120);
  // 콘센트
  add(new THREE.BoxGeometry(80, 12, 120), std('#fafafa'), 640, SAMPLE.wallY - 6, 300);
  // 왼쪽 옷장 (오른쪽 면이 x=-800)
  add(new THREE.BoxGeometry(1100, 600, 1950), std('#f4f1ec'), -1350, SAMPLE.wallY - 300, 975);
  add(new THREE.BoxGeometry(6, 4, 1900), std('#c9c3b8'), -1350, SAMPLE.wallY - 602, 975);
  // 오른쪽 책장 (왼쪽 면이 x=800)
  add(new THREE.BoxGeometry(800, 320, 1200), std('#9c7650'), 1200, SAMPLE.wallY - 160, 600);
  for (const z of [300, 600, 900]) add(new THREE.BoxGeometry(760, 300, 18), std('#8a6643'), 1200, SAMPLE.wallY - 170, z);
  // 화분
  add(new THREE.CylinderGeometry(110, 90, 260, 24).rotateX(Math.PI / 2), std('#e4dfd6'), 1300, 900, 130);
  add(new THREE.SphereGeometry(220, 20, 16), std('#5f8a5a'), 1300, 900, 420);
  // A4 용지 (기준물체) — 조명 영향 없이 선명한 흰색
  const { x0, y0, w, h } = SAMPLE.a4;
  add(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#ffffff' }), x0 + w / 2, y0 + h / 2, 0.6, false);

  const cam = new THREE.PerspectiveCamera();
  const pose: Pose = {
    R,
    t,
    cameraHeightMm: SAMPLE.eye[2],
    cameraPos: SAMPLE.eye,
    normMismatch: 0,
  };
  applyCvCamera(cam, K, pose);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/jpeg', 0.92);
  renderer.dispose();
  return url;
}
