// dist-artifact/planner.html + JS + CSS → 외부 파일 없는 HTML 조각 한 장 (Claude 아티팩트 게시용)
// 사용: npx vite build -c vite.artifact.config.ts && node scripts/build-artifact.mjs <출력파일>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve('dist-artifact');
const out = process.argv[2] ?? join(dist, 'desk-planner.html');
let html = readFileSync(join(dist, 'planner.html'), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)];
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)];
if (js.length !== 1) throw new Error(`JS 청크가 1개여야 합니다: ${js.length}`);

for (const m of css) html = html.replace(m[0], `<style>\n${readFileSync(join(dist, m[1]), 'utf8')}\n</style>`);
html = html.replace(js[0][0], '');
const code = readFileSync(join(dist, js[0][1]), 'utf8').replace(/<\/script/gi, '<\\/script');

// 아티팩트는 doctype/html/head/body 를 게시 시점에 감싸므로 내용만 남긴다
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
const headKeep = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n')
  .trim();
const fragment = `${headKeep}\n${body.trim()}\n<script type="module">\n${code}\n</script>\n`;
writeFileSync(out, fragment);
console.log(`${out}  ${(fragment.length / 1024).toFixed(0)} KB`);
