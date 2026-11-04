// 이미지 파일 없이 캔버스로 그리는 텍스처: 나뭇결, 마루, 패브릭, 메쉬, 모니터 화면 등.
// 외부 파일을 받지 않으므로 아티팩트 한 장(HTML)으로 배포할 수 있다.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

export const WOOD_TONES = {
  oak: { base: '#c79c6a', dark: '#9c7244', light: '#ddb987' },
  walnut: { base: '#6a4530', dark: '#45291a', light: '#8a5f42' },
  white: { base: '#eceae6', dark: '#dedbd6', light: '#f6f5f2' },
  black: { base: '#2b2b2d', dark: '#1f1f21', light: '#38383b' },
  ash: { base: '#d8c3a0', dark: '#b89d74', light: '#e8d8bb' },
} as const;
export type WoodTone = keyof typeof WOOD_TONES;

/** 결 방향이 가로(u)인 나뭇결. 화이트·블랙은 무늬가 거의 없는 무광 라미네이트. */
function drawGrain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tone: WoodTone, seed: number) {
  const t = WOOD_TONES[tone];
  const r = rng(seed);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = t.base;
  g.fillRect(x, y, w, h);
  const plain = tone === 'white' || tone === 'black';
  const lines = plain ? 40 : Math.round(h / 3);
  for (let i = 0; i < lines; i++) {
    const yy = y + r() * h;
    g.strokeStyle = r() > 0.5 ? t.dark : t.light;
    g.globalAlpha = plain ? 0.08 : 0.12 + r() * 0.3;
    g.lineWidth = plain ? 1 : 0.6 + r() * 2.4;
    g.beginPath();
    const amp = 2 + r() * 6;
    const freq = 0.002 + r() * 0.006;
    const ph = r() * 10;
    for (let xx = x; xx <= x + w; xx += 8) {
      const yy2 = yy + Math.sin(xx * freq + ph) * amp + Math.sin(xx * freq * 3.1 + ph) * amp * 0.3;
      if (xx === x) g.moveTo(xx, yy2);
      else g.lineTo(xx, yy2);
    }
    g.stroke();
  }
  // 옹이 무늬 (오크·월넛만)
  if (!plain) {
    for (let k = 0; k < 2; k++) {
      const cx = x + r() * w;
      const cy = y + r() * h;
      for (let ring = 0; ring < 7; ring++) {
        g.globalAlpha = 0.1;
        g.strokeStyle = t.dark;
        g.lineWidth = 1.2;
        g.beginPath();
        g.ellipse(cx, cy, 20 + ring * 9, 4 + ring * 2.2, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  g.restore();
  g.globalAlpha = 1;
}

/** 책상 상판용 나뭇결 — 텍스처 한 장이 1.2m × 0.6m */
export function woodTexture(tone: WoodTone) {
  return make(`wood-${tone}`, 1024, 512, (g, w, h) => drawGrain(g, 0, 0, w, h, tone, 11));
}

/** 바닥: 텍스처 한 장 = 2m × 2m. 마루(폭 180mm) 또는 600각 타일 */
export function floorTexture(kind: 'oak' | 'walnut' | 'gray') {
  return make(`floor-${kind}`, 2048, 2048, (g, w, h) => {
    const px = w / 2000; // 1mm 당 px
    const r = rng(7);
    if (kind === 'gray') {
      g.fillStyle = '#b9b8b4';
      g.fillRect(0, 0, w, h);
      const tile = 600 * px;
      for (let ty = 0; ty < h; ty += tile) {
        for (let tx = 0; tx < w; tx += tile) {
          const v = 180 + Math.round(r() * 14);
          g.fillStyle = `rgb(${v},${v - 1},${v - 4})`;
          g.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
          for (let k = 0; k < 400; k++) {
            g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '90,90,90'},0.05)`;
            g.fillRect(tx + r() * tile, ty + r() * tile, 2 + r() * 5, 2 + r() * 5);
          }
        }
      }
      return;
    }
    const plankW = 180 * px;
    for (let x = 0, col = 0; x < w; x += plankW, col++) {
      let y = -r() * 900 * px;
      while (y < h) {
        const len = (700 + r() * 1100) * px;
        // 마루 한 장: 결은 세로 방향 → 회전해서 그림
        g.save();
        g.translate(x, y);
        g.rotate(Math.PI / 2);
        drawGrain(g, 0, -plankW, len, plankW, kind, col * 97 + Math.floor(y));
        g.restore();
        const shade = (r() - 0.5) * 0.14;
        g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
        g.fillRect(x, y, plankW, len);
        g.fillStyle = 'rgba(40,25,15,0.45)';
        g.fillRect(x, y, plankW, 2);
        y += len;
      }
      g.fillStyle = 'rgba(40,25,15,0.5)';
      g.fillRect(x, 0, 2, h);
    }
  });
}

/** 패브릭(의자 좌판, 데스크 매트): 촘촘한 직조 + 잡음 */
export function fabricTexture(color: string, key = color) {
  return make(`fabric-${key}`, 256, 256, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.04})`;
      g.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      g.fillRect(x, 0, 1, h);
    }
    for (let k = 0; k < 2500; k++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
      g.fillRect(r() * w, r() * h, 1, 1);
    }
  });
}

/** 의자 등판 메쉬: 흰색 = 실, 검정 = 구멍 (alphaMap) */
export function meshAlpha() {
  return make(
    'mesh-alpha',
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      const s = 16;
      for (let i = -h; i < w + h; i += s) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + h, h);
        g.stroke();
        g.beginPath();
        g.moveTo(i, h);
        g.lineTo(i + h, 0);
        g.stroke();
      }
    },
    false,
  );
}

/** 모니터 화면 내용 — 배경화면 + 코드 편집기 + 브라우저 창 */
export function screenTexture(variant: number, aspect: number) {
  const W = 1024;
  const H = Math.round(W / aspect);
  return make(`screen-${variant}-${aspect.toFixed(2)}`, W, H, (g, w, h) => {
    const r = rng(variant + 5);
    const pal = [
      ['#0f2a4a', '#1f6f8b', '#99d5c9'],
      ['#2b1d3f', '#a2466b', '#f2a65a'],
      ['#13241b', '#2e6b4f', '#c9e4a4'],
    ][variant % 3];
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, pal[0]);
    bg.addColorStop(0.6, pal[1]);
    bg.addColorStop(1, pal[2]);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 5; k++) {
      g.globalAlpha = 0.18;
      g.fillStyle = pal[2];
      g.beginPath();
      g.ellipse(r() * w, r() * h, 80 + r() * 260, 40 + r() * 120, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // 상단 메뉴바
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, Math.max(10, h * 0.025));
    const win = (x: number, y: number, ww: number, hh: number, dark: boolean) => {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 6, y + 8, ww, hh);
      g.fillStyle = dark ? '#1c1d22' : '#f7f7f8';
      g.fillRect(x, y, ww, hh);
      g.fillStyle = dark ? '#2a2c33' : '#e6e7ea';
      g.fillRect(x, y, ww, hh * 0.07);
      ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
        g.fillStyle = c;
        g.beginPath();
        g.arc(x + 14 + i * 14, y + hh * 0.035, 4, 0, Math.PI * 2);
        g.fill();
      });
      if (dark) {
        const colors = ['#c678dd', '#61afef', '#98c379', '#e5c07b', '#abb2bf', '#56b6c2'];
        let ly = y + hh * 0.12;
        while (ly < y + hh - 8) {
          let lx = x + 14 + (r() > 0.6 ? 20 : 0);
          const n = 1 + Math.floor(r() * 4);
          for (let k = 0; k < n; k++) {
            const len = 20 + r() * 90;
            if (lx + len > x + ww - 10) break;
            g.fillStyle = colors[Math.floor(r() * colors.length)];
            g.fillRect(lx, ly, len, 4);
            lx += len + 8;
          }
          ly += 11;
        }
      } else {
        g.fillStyle = '#d9dbe0';
        g.fillRect(x + ww * 0.08, y + hh * 0.13, ww * 0.84, hh * 0.05);
        g.fillStyle = '#3a6ff0';
        g.fillRect(x + ww * 0.08, y + hh * 0.24, ww * 0.5, hh * 0.04);
        for (let k = 0; k < 3; k++) {
          g.fillStyle = ['#e8ecf6', '#f1e8f6', '#e8f6ee'][k];
          g.fillRect(x + ww * (0.08 + k * 0.29), y + hh * 0.34, ww * 0.26, hh * 0.3);
        }
        for (let k = 0; k < 6; k++) {
          g.fillStyle = '#c9ccd3';
          g.fillRect(x + ww * 0.08, y + hh * (0.7 + k * 0.045), ww * (0.4 + r() * 0.4), 4);
        }
      }
    };
    const wide = aspect > 2;
    win(w * 0.05, h * 0.09, w * (wide ? 0.38 : 0.5), h * 0.62, true);
    win(w * (wide ? 0.47 : 0.4), h * 0.2, w * (wide ? 0.36 : 0.52), h * 0.66, false);
    if (wide) win(w * 0.86, h * 0.12, w * 0.11, h * 0.5, true);
    // 하단 독
    g.fillStyle = 'rgba(255,255,255,0.28)';
    const dw = Math.min(w * 0.4, 420);
    g.fillRect(w / 2 - dw / 2, h * 0.93, dw, h * 0.05);
    for (let k = 0; k < 9; k++) {
      g.fillStyle = `hsl(${k * 40}, 60%, 60%)`;
      g.fillRect(w / 2 - dw / 2 + 10 + k * (dw - 20) / 9, h * 0.94, (dw - 20) / 9 - 6, h * 0.03);
    }
  });
}

/** 모션데스크 컨트롤러 표시창 */
export function displayTexture(text: string) {
  return make(`disp-${text}`, 128, 48, (g, w, h) => {
    g.fillStyle = '#0c0d0f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb547';
    g.font = 'bold 30px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

/** 멀티탭 윗면: 콘센트 6구 + 스위치 */
export function powerStripTexture() {
  return make('strip', 512, 96, (g, w, h) => {
    g.fillStyle = '#f4f4f2';
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) {
      const cx = 46 + k * 70;
      g.fillStyle = '#dcdcd8';
      g.beginPath();
      g.arc(cx, h / 2, 28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a3a3a';
      for (const dx of [-9, 9]) {
        g.beginPath();
        g.arc(cx + dx, h / 2, 4.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = '#e2483d';
    g.fillRect(w - 58, h / 2 - 16, 34, 32);
  });
}

/** 노트북 키보드 면 */
export function laptopDeckTexture() {
  return make('deck', 512, 360, (g, w, h) => {
    g.fillStyle = '#c8cbd0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b2d31';
    const kw = (w - 60) / 14;
    for (let row = 0; row < 6; row++) {
      for (let k = 0; k < 14; k++) g.fillRect(30 + k * kw + 2, 20 + row * 30 + 2, kw - 4, 24);
    }
    g.fillStyle = '#babdc2';
    g.fillRect(w / 2 - 90, 220, 180, 120);
  });
}

/** 산세베리아 잎: 진녹색 가로 무늬 + 노란 테두리 */
export function leafTexture() {
  return make('leaf', 64, 256, (g, w, h) => {
    g.fillStyle = '#2f5a2c';
    g.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let y = 0; y < h; y += 6 + r() * 8) {
      g.fillStyle = `rgba(160,200,140,${0.15 + r() * 0.2})`;
      g.fillRect(0, y, w, 2 + r() * 3);
    }
    g.fillStyle = '#c9b84a';
    g.fillRect(0, 0, 5, h);
    g.fillRect(w - 5, 0, 5, h);
  });
}
