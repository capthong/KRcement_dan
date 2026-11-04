// 브라우저 E2E 스모크 테스트: 샘플 사진(정답을 아는 가상 방)으로 전체 흐름을 돌리고 스크린샷을 남긴다.
// 사용: npm run build && npx vite preview --port 4173 &  →  node scripts/e2e-smoke.mjs [출력폴더]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const out = process.argv[2] ?? '.';
const base = process.env.BASE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function run(viewport, tag) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: tag === 'desktop' ? 1 : 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + '?debug=1');
  await page.click('[data-action="sample"]');
  await page.waitForFunction(() => window.__truth);
  const truth = await page.evaluate(() => window.__truth);
  const W = 1600, H = 1200;
  let box = await page.locator('#overlay').boundingBox();
  const toScreen = (p) => ({ x: box.x + (p.x / W) * box.width, y: box.y + (p.y / H) * box.height });

  // 2단계: A4 꼭짓점을 일부러 약간(화면 2~3px) 빗나가게 탭 → 자동 보정 확인
  // 휴대폰은 A4 가 화면에서 20px 남짓이므로 첫 점을 찍은 뒤 ×3 확대해서 나머지를 찍는다
  const off = [[3, -2], [-2, 3], [2, 2], [-3, -2]];
  for (const [i, c] of truth.a4Corners.entries()) {
    const s = toScreen(c);
    await page.mouse.click(s.x + off[i][0], s.y + off[i][1]);
    if (i === 0 && tag === 'mobile') {
      await page.click('#zoom');
      await page.waitForTimeout(300); // transition
      box = await page.locator('#overlay').boundingBox();
      await page.screenshot({ path: `${out}/${tag}-0-zoomed.png` });
    }
  }
  await page.waitForSelector('.badge.ok');
  const snapped = await page.locator('dl.kv dd').nth(3).textContent();
  check(`[${tag}] 보정 완료 + 꼭짓점 자동 보정`, true, `보정된 꼭짓점 ${snapped}`);
  await page.screenshot({ path: `${out}/${tag}-1-calibrated.png` });

  // 3단계: 옷장~책장 사이 1600mm 측정 (확대 해제)
  if (tag === 'mobile') {
    await page.click('#zoom');
    await page.waitForTimeout(300);
    box = await page.locator('#overlay').boundingBox();
  }
  await page.click('[data-goto="3"]');
  // 버튼을 누르느라 페이지가 스크롤됐을 수 있으므로 사진 위치를 다시 잰다
  await page.locator('#stage').scrollIntoViewIfNeeded();
  box = await page.locator('#overlay').boundingBox();
  const hintBefore = await page.locator('#hint').boundingBox();
  for (const p of [truth.gapA, truth.gapB]) {
    const before = await page.locator('#overlay').boundingBox();
    if (Math.abs(before.y - box.y) > 0.5) check(`[${tag}] 탭 사이 화면 밀림 없음`, false, `${(before.y - box.y).toFixed(1)}px 이동`);
    const s = toScreen(p);
    await page.mouse.click(s.x, s.y);
  }
  const hintAfter = await page.locator('#hint').boundingBox();
  check(`[${tag}] 안내문 변경 시 레이아웃 고정`, Math.abs(hintBefore.height - hintAfter.height) < 0.5);
  const txt = await page.locator('.meas b').first().textContent();
  const mm = Number(txt.replace(/[^0-9]/g, ''));
  const err = Math.abs(mm - truth.gapMm) / truth.gapMm;
  check(`[${tag}] 측정 정확도 (정답 ${truth.gapMm}mm)`, err < 0.03, `측정 ${mm}mm, 오차 ${(err * 100).toFixed(2)}%`);
  const band = await page.locator('.meas .badge').first().textContent();
  const bandPct = Number(band.replace(/[^0-9]/g, '')) / 100;
  check(`[${tag}] 표시 오차범위가 실제 오차를 포함하고 과장되지 않음`, /±\d+%/.test(band) && err <= bandPct && bandPct <= 0.15, `표시 ${band}, 실제 ${(err * 100).toFixed(2)}%`);
  await page.click('[data-action="use-w"]');
  await page.fill('[data-action="space-d"]', '1500');
  await page.locator('[data-action="space-d"]').dispatchEvent('change');
  await page.screenshot({ path: `${out}/${tag}-2-measured.png` });

  // 4단계: 모션데스크 선호 → 첫 추천 배치 → 모니터 2대 → 소품
  await page.click('[data-goto="4"]');
  await page.selectOption('[data-action="motorized"]', '1');
  await page.locator('[data-action="place-desk"]:not([disabled])').first().click();
  await page.selectOption('[data-action="moncount"]', '2');
  await page.locator('[data-action="place-mon"]:not([disabled])').first().click();
  for (const id of ['kb-tkl', 'lamp-desk', 'spk-1', 'spk-1', 'pc-mid']) await page.click(`[data-action="add"][data-id="${id}"]`);
  const placed = await page.locator('.placed').count();
  check(`[${tag}] 책상·모니터·소품 배치`, placed === 8, `${placed}개 배치`);

  // 3D 가 실제로 그려졌는지: WebGL 캔버스에서 투명하지 않은 픽셀 비율
  const coverage = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const t = document.createElement('canvas');
    t.width = c.width; t.height = c.height;
    const g = t.getContext('2d');
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / (d.length / 4);
  });
  check(`[${tag}] 3D 렌더링`, coverage > 0.03, `캔버스 ${(coverage * 100).toFixed(1)}% 에 3D 물체`);

  await page.screenshot({ path: `${out}/${tag}-3-placed.png` });

  // 5단계: 선정리 전/후
  await page.click('[data-goto="5"]');
  const recs = await page.locator('.step-body .card .card-title').allTextContents();
  check(`[${tag}] 선정리 추천`, recs.some((r) => r.includes('케이블 체인')) && recs.some((r) => r.includes('멀티탭')), recs.slice(0, 4).join(' / '));
  await page.screenshot({ path: `${out}/${tag}-4-cables-before.png` });
  await page.click('[data-action="tidy"][data-v="1"]');
  await page.screenshot({ path: `${out}/${tag}-5-cables-after.png` });

  // 가로 스크롤 없음 확인
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`[${tag}] 가로 스크롤 없음`, overflow <= 0, `overflow ${overflow}px`);
  check(`[${tag}] 콘솔 오류 없음`, errors.length === 0, errors.join(' | '));
  await page.close();
}

await run({ width: 1440, height: 900 }, 'desktop');
await run({ width: 390, height: 844 }, 'mobile');
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
