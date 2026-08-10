/* DotPad 뷰포트 내비게이션 검증: 비율 유지, 확대/축소, 상하좌우 이동, 미리보기 표시, 위치 안내 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.addInitScript(`
    Object.defineProperty(navigator, 'bluetooth', { value: {} });
    window.__mock = (function(){ const module = { exports: {} }; ${mockSrc}; return module.exports; })();
  `);
  await page.goto(DIST);
  await page.waitForSelector('#gallery .gcat');
  await page.evaluate(() => {
    window.__sim = window.__mock.createMockSdk();
    DOTPAD.BLE.loadSDK = () => Promise.resolve(window.__sim.module);
    window.__key = k => window.__sim.fireKey(k, DOTPAD.BLE.devs[0].dev);
    window.__geo = () => {
      const b = document.querySelector('#dpVp').getBoundingClientRect();
      const s = document.querySelector('#preview svg').getBoundingClientRect();
      return { bw: b.width, bh: b.height, bx: b.left - s.left, by: b.top - s.top, sw: s.width, sh: s.height,
               label: document.querySelector('#dpVp').textContent,
               shown: document.querySelector('#dpVp').style.display !== 'none' };
    };
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);
  await sleep(1300);

  // ── 1. 기본 배율 = ×1.5 (실기기에서 가장 안정적으로 읽히는 값) ──
  const def = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  ok('default zoom is ×1.5 on connect', /×1\.5/.test(def.geo.label), def.geo.label);
  ok('viewport frame shown on preview when connected', def.geo.shown && def.geo.bw > 0, JSON.stringify(def.geo));
  ok('default frame is smaller than the page (magnified)', def.geo.bw < def.geo.sw, `${Math.round(def.geo.bw)} vs ${Math.round(def.geo.sw)}`);
  ok('device has content at default zoom', def.state.some(r => r !== '0'.repeat(60)));

  // ── 2. F3로 전체보기(×1): 비율 유지(60:40), 페이지 전체 포함 ──
  await page.evaluate(() => window.__key('KeyFunction3'));
  await sleep(900);
  const fit = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  ok('F3 from default reaches full view (×1)', !/\s×[\d.]+$/.test(fit.geo.label), fit.geo.label);
  ok('frame aspect = 60:40 (no stretching to device grid)', Math.abs(fit.geo.bw / fit.geo.bh - 1.5) < 0.02, (fit.geo.bw / fit.geo.bh).toFixed(3));
  ok('fit view covers the whole page (letterboxed)', fit.geo.bw >= fit.geo.sw - 1 && fit.geo.bh >= fit.geo.sh - 1,
    `frame ${Math.round(fit.geo.bw)}×${Math.round(fit.geo.bh)} vs page ${Math.round(fit.geo.sw)}×${Math.round(fit.geo.sh)}`);

  // ── 3. F4 확대 → 프레임 축소, 기기 내용 변경 ──
  await page.evaluate(() => window.__key('KeyFunction4'));
  await sleep(900);
  const z2 = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  ok('F4 zooms in: frame shrinks', z2.geo.bw < fit.geo.bw * 0.75, `${Math.round(fit.geo.bw)} → ${Math.round(z2.geo.bw)}`);
  ok('F4 zoom label shows magnification', /×1\.5/.test(z2.geo.label), z2.geo.label);
  ok('zoomed frame keeps 60:40 aspect', Math.abs(z2.geo.bw / z2.geo.bh - 1.5) < 0.02, (z2.geo.bw / z2.geo.bh).toFixed(3));
  ok('device content changes on zoom', JSON.stringify(z2.state) !== JSON.stringify(fit.state));
  const inkCount = s => s.join('').split('').filter(c => c !== '0').length;
  ok('zoomed view has more ink (magnified strokes)', inkCount(z2.state) > inkCount(fit.state), inkCount(fit.state) + ' → ' + inkCount(z2.state));

  // ── 4. 이동: 팬 우/좌, F2 아래 / F1 위 ──
  await page.evaluate(() => window.__key('KeyFunction4'));   // ×2
  await sleep(700);
  const base = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  await page.evaluate(() => window.__key('PanningRight'));
  await sleep(900);
  const right = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  // 이 페이지는 뷰포트보다 조금만 넓어 반 화면 이동이 가장자리에서 잘린다 (정상 동작)
  ok('pan ▶ moves frame right (clamped at page edge)',
    right.geo.bx > base.geo.bx + 20 && right.geo.bx + right.geo.bw <= right.geo.sw + 2,
    `${Math.round(base.geo.bx)} → ${Math.round(right.geo.bx)}, right edge ${Math.round(right.geo.bx + right.geo.bw)}/${Math.round(right.geo.sw)}`);
  ok('pan ▶ changes device content', JSON.stringify(right.state) !== JSON.stringify(base.state));
  await page.evaluate(() => window.__key('KeyFunction2'));
  await sleep(900);
  const down = await page.evaluate(() => window.__geo());
  ok('F2 moves frame down', down.by > right.geo.by + right.geo.bh * 0.4, `${Math.round(right.geo.by)} → ${Math.round(down.by)}`);
  await page.evaluate(() => window.__key('KeyFunction1'));
  await sleep(900);
  const up = await page.evaluate(() => window.__geo());
  ok('F1 moves frame back up', Math.abs(up.by - right.geo.by) < 3, `${Math.round(down.by)} → ${Math.round(up.by)}`);
  await page.evaluate(() => window.__key('PanningLeft'));
  await sleep(900);
  const back = await page.evaluate(() => window.__geo());
  ok('pan ◀ moves frame back left', back.bx < right.geo.bx - 20 && back.bx >= -2, `${Math.round(right.geo.bx)} → ${Math.round(back.bx)}`);

  // ── 5. 프레임은 페이지 밖으로 나가지 않는다 (클램프) ──
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__key('PanningRight')); await sleep(120); }
  await sleep(700);
  const edge = await page.evaluate(() => window.__geo());
  ok('frame clamps at page edge', edge.bx + edge.bw <= edge.sw + 2, `right edge ${Math.round(edge.bx + edge.bw)} vs page ${Math.round(edge.sw)}`);

  // ── 6. 확대 중 텍스트 라인 = 현재 위치 안내 ──
  const txt = await page.evaluate(() => DOTPAD.BLE.devs[0].lastText);
  const decode = hex => {   // 텍스트 셀 hex → 점 번호
    const out = [];
    for (let i = 0; i < hex.length; i += 2) {
      const b = parseInt(hex.substr(i, 2), 16), dots = [];
      for (let d = 0; d < 8; d++) if (b & (1 << d)) dots.push(d + 1);
      out.push(dots);
    }
    return out;
  };
  const cells = decode(txt || '').filter(c => c.length);
  ok('text line carries position info while zoomed', cells.length >= 3, JSON.stringify(cells.slice(0, 5)));

  // ── 7. 축소 한계 / 확대 한계 ──
  for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__key('KeyFunction3')); await sleep(120); }
  await sleep(700);
  const zmin = await page.evaluate(() => ({ zoom: window.__geo().label, geo: window.__geo() }));
  ok('F3 zooms back out to full view', !/\s×[\d.]+$/.test(zmin.zoom) && zmin.geo.bw >= zmin.geo.sw - 1, zmin.zoom);
  for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__key('KeyFunction4')); await sleep(90); }
  await sleep(700);
  const zmax = await page.evaluate(() => window.__geo());
  ok('zoom stops at max ×6', /×6/.test(zmax.label), zmax.label);

  // ── 8. 규정집 모드: 키 배치가 항목 이동 (F3/F4 = ±10) ──
  await page.click('#gallery .gcat:has-text("Documents")');
  await page.click('#gallery .card:has-text("Braille Document Converter")');
  await page.click('#form .genBtn');
  await page.waitForSelector('#rbFrame');
  await sleep(900);
  const rbHidden = await page.evaluate(() => document.querySelector('#dpVp').style.display);
  ok('viewport frame hidden in document mode', rbHidden === 'none', rbHidden);
  const rb0 = await page.evaluate(() => window.__sim.deviceState());
  await page.evaluate(() => window.__key('KeyFunction4'));   // +10 items
  await sleep(900);
  const rb10 = await page.evaluate(() => window.__sim.deviceState());
  ok('F4 jumps 10 items ahead in document mode', JSON.stringify(rb10) !== JSON.stringify(rb0));
  await page.evaluate(() => window.__key('KeyFunction2'));   // first item
  await sleep(900);
  const rbFirst = await page.evaluate(() => window.__sim.deviceState());
  ok('F2 returns to first item', JSON.stringify(rbFirst) === JSON.stringify(rb0));

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
