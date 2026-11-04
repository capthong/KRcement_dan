import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// 플래너만 단일 JS 청크로 빌드 → scripts/build-artifact.mjs 가 HTML 한 장으로 인라인
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
    modulePreload: false,
    rollupOptions: { input: resolve(__dirname, 'planner.html') },
  },
});
