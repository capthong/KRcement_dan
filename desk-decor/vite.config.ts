import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// base './' → GitHub Pages / Cloudflare Pages 어느 하위 경로에 올려도 동작하도록 상대경로로 빌드
export default defineConfig({
  base: './',
  // three.js 가 대부분(약 160KB gzip). 프로토타입에서는 분할하지 않는다.
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), planner: resolve(__dirname, 'planner.html') },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
