// 플래너 E2E: 방 크기 변경 → 물건 추가·옵션 변경 → 모션데스크 높이 → 선정리 → 저장 복원.
// 사용: npx vite build -c vite.artifact.config.ts && npx vite preview -c vite.artifact.config.ts --port 4174 &
//       node scripts/e2e-planner.mjs [스크린샷 폴더]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
const url = process.env.PLANNER_URL ?? 'http://localhost:4174/planner.html';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(url);
await page.waitForTimeout(2500);
const sub = () => page.locator('#room-sub').textContent();
check('예시 구성 로드', (await sub()).includes('물건 13개'), await sub());

// 방 크기 변경
await page.click('[data-tab="room"]');
await page.fill('#room-w', '2600');
await page.locator('#room-w').dispatchEvent('change');
check('방 가로 변경 반영', (await sub()).includes('2,600 ×'), await sub());

// 모니터 추가 → 2대가 되면 자동 정렬
await page.click('[data-tab="add"]');
await page.click('.card:has-text("모니터 27")');
check('모니터 추가 후 선택 탭', (await page.locator('#tab-body h2').first().textContent()).includes('27'));
await page.click('[data-opt="mount"][data-val="arm"]');
check('모니터암 옵션', (await page.locator('#tab-body h2').first().textContent()).includes('모니터암'));

// 점검 탭에서 책상 선택 → 높이 1100 (서서 쓰기)
await page.click('[data-tab="check"]');
await page.click('.check:has-text("의자 공간") button');
check('점검 항목 → 책상 선택', (await page.locator('#tab-body h2').first().textContent()).includes('모션데스크'));
await page.locator('#desk-h').evaluate((el) => {
  el.value = '1100';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
const dimsTxt = await page.locator('.dims').textContent();
check('모션데스크 높이 1100', dimsTxt.endsWith('×1100'), dimsTxt);
await page.click('[data-view="seated"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/e2e-standing-seated.png` });
await page.click('[data-cables="tidy"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/e2e-standing-tidy.png` });
const recs = await page.locator('.rec b').allTextContents();
check('선정리 추천에 케이블 체인', recs.some((r) => r.includes('케이블 체인')), recs.slice(0, 3).join(' / '));

// 키보드 조작: 선택된 책상을 화살표로 이동
await page.click('[data-tab="sel"]');
const before = await page.locator('.gap b').allTextContents();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const after = await page.locator('.gap b').allTextContents();
check('화살표 키로 5cm 이동', before.join() !== after.join(), `${before.join('/')} → ${after.join('/')}`);

// 저장·복원
await page.waitForTimeout(500);
const count = (await sub()).match(/물건 (\d+)개/)?.[1];
await page.reload();
await page.waitForTimeout(2500);
check('새로고침 후 복원', (await sub()).includes(`물건 ${count}개`) && (await sub()).includes('2,600'), await sub());

const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
check('가로 스크롤 없음', ov <= 0);
check('콘솔 오류 없음', errs.length === 0, errs.join(' | '));
await b.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
