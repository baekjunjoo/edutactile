/* DotPad 뷰포트 내비게이션 검증: 비율 유지, 확대/축소, 상하좌우 이동, 미리보기 표시, 위치 안내 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 전송 큐가 비고 in-flight가 없을 때까지 (한 줄씩 보내므로 프레임 완성까지 기다린다) */
const waitIdle = async p => { await p.waitForFunction(() => window.DOTPAD && DOTPAD.BLE.pendingRows == null && DOTPAD.BLE.pendingText == null && DOTPAD.BLE.inflightTotal() === 0, null, { timeout: 20000 }); await sleep(80); };

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
    DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.LINE_GAP = 5;   // 테스트 가속 (실제 기본값 200ms는 별도 항목에서 검증)
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

  // ── 1. 기본 배율 = 1:1 (점자 도트 1개 = 핀 1개, 판독 가능한 유일한 실척) ──
  const def = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState(), info: window.__dpInfo() }));
  ok('default scale is 1:1 (actual size)', /1:1/.test(def.geo.label) && def.info.scale === 1, def.geo.label);
  ok('1:1 means one pin per braille dot pitch (2.34mm)', Math.abs(def.info.mmPerPin - 2.34) < 0.01, def.info.mmPerPin.toFixed(2) + 'mm/pin');
  ok('viewport frame shown on preview when connected', def.geo.shown && def.geo.bw > 0, JSON.stringify(def.geo));
  ok('default frame is smaller than the page (device is physically smaller)', def.geo.bw < def.geo.sw, `${Math.round(def.geo.bw)} vs ${Math.round(def.geo.sw)}`);
  ok('device has content at default scale', def.state.some(r => r !== '0'.repeat(60)));
  ok('frame aspect = 60:40 (no stretching to device grid)', Math.abs(def.geo.bw / def.geo.bh - 1.5) < 0.02, (def.geo.bw / def.geo.bh).toFixed(3));

  // ── 2. 좌패닝+F1(축소) 두 번 → ½ → 전체보기 ──
  await page.evaluate(() => window.__key('LPF1'));
  await sleep(800);
  const half = await page.evaluate(() => ({ geo: window.__geo(), info: window.__dpInfo() }));
  ok('pan◀+F1 → ½ scale', half.info.scale === 0.5 && /½/.test(half.geo.label), half.geo.label);
  ok('½ is flagged as unreadable for braille', half.info.legible === false, half.info.mmPerPin.toFixed(2) + 'mm/pin');
  await page.evaluate(() => window.__key('LPF1'));
  await sleep(900);
  const fit = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState(), info: window.__dpInfo() }));
  ok('F3 again → full page view', fit.info.scale === 'fit', fit.geo.label);
  ok('fit view covers the whole page (letterboxed)', fit.geo.bw >= fit.geo.sw - 1 && fit.geo.bh >= fit.geo.sh - 1,
    `frame ${Math.round(fit.geo.bw)}×${Math.round(fit.geo.bh)} vs page ${Math.round(fit.geo.sw)}×${Math.round(fit.geo.sh)}`);
  ok('fit keeps 60:40 aspect', Math.abs(fit.geo.bw / fit.geo.bh - 1.5) < 0.02, (fit.geo.bw / fit.geo.bh).toFixed(3));

  // ── 3. 우패닝+F4 확대 → 프레임 축소, 기기 내용 변경 ──
  await page.evaluate(() => window.__key('RPF4'));
  await sleep(900);
  const z2 = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  ok('pan▶+F4 zooms in: frame shrinks', z2.geo.bw < fit.geo.bw * 0.75, `${Math.round(fit.geo.bw)} → ${Math.round(z2.geo.bw)}`);
  ok('device content changes on zoom', JSON.stringify(z2.state) !== JSON.stringify(fit.state));

  // ── 4. 이동: F4 우 · F1 좌 · F3 아래 · F2 위 (1:1에서 — 키 물리 배치와 방향 일치) ──
  await page.evaluate(() => window.__key('RPF4'));   // 1:1
  await sleep(700);
  const base = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  await page.evaluate(() => window.__key('KeyFunction4'));
  await sleep(900);
  const right = await page.evaluate(() => ({ geo: window.__geo(), state: window.__sim.deviceState() }));
  // 이 페이지는 뷰포트보다 조금만 넓어 반 화면 이동이 가장자리에서 잘린다 (정상 동작)
  ok('F4 moves frame right (clamped at page edge)',
    right.geo.bx > base.geo.bx + 20 && right.geo.bx + right.geo.bw <= right.geo.sw + 2,
    `${Math.round(base.geo.bx)} → ${Math.round(right.geo.bx)}, right edge ${Math.round(right.geo.bx + right.geo.bw)}/${Math.round(right.geo.sw)}`);
  ok('F4 changes device content', JSON.stringify(right.state) !== JSON.stringify(base.state));
  await page.evaluate(() => window.__key('KeyFunction3'));
  await sleep(900);
  const down = await page.evaluate(() => window.__geo());
  ok('F3 moves frame down', down.by > right.geo.by + right.geo.bh * 0.4, `${Math.round(right.geo.by)} → ${Math.round(down.by)}`);
  await page.evaluate(() => window.__key('KeyFunction2'));
  await sleep(900);
  const up = await page.evaluate(() => window.__geo());
  ok('F2 moves frame back up', Math.abs(up.by - right.geo.by) < 3, `${Math.round(down.by)} → ${Math.round(up.by)}`);
  await page.evaluate(() => window.__key('KeyFunction1'));
  await sleep(900);
  const back = await page.evaluate(() => window.__geo());
  ok('F1 moves frame back left', back.bx < right.geo.bx - 20 && back.bx >= -2, `${Math.round(right.geo.bx)} → ${Math.round(back.bx)}`);

  // ── 5. 프레임은 페이지 밖으로 나가지 않는다 (클램프) ──
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__key('KeyFunction4')); await sleep(120); }
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
  for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__key('LPF1')); await sleep(120); }
  await sleep(700);
  const zmin = await page.evaluate(() => ({ geo: window.__geo(), info: window.__dpInfo() }));
  ok('zoom-out stops at full page view', zmin.info.scale === 'fit' && zmin.geo.bw >= zmin.geo.sw - 1, zmin.geo.label);
  for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__key('RPF4')); await sleep(90); }
  await sleep(700);
  const zmax = await page.evaluate(() => ({ geo: window.__geo(), info: window.__dpInfo() }));
  ok('zoom stops at max 2×', zmax.info.scale === 2 && /2×/.test(zmax.geo.label), zmax.geo.label);

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

  // ── 9. 패닝 단독 = 이전/다음 페이지, 조합키가 뒤따르면 페이지 이동 취소 ──
  if (!await page.$('#gallery .card:has-text("Tennis")')) await page.click('#gallery .gcat:has-text("Physical")');
  await page.click('#gallery .card:has-text("Tennis")');
  await page.waitForSelector('#preview svg');
  await page.click('#addPage');                       // 페이지 1
  await page.click('#gallery .card:has-text("Basketball")');
  await page.waitForSelector('#preview svg');
  await page.evaluate(() => { document.querySelector('#addPage').click(); });   // 페이지 2
  await sleep(400);
  const seq = await page.evaluate(() => ({ pages: document.querySelectorAll('#seqList .srow').length }));
  ok('sequence has 2 pages for page-key test', seq.pages === 2, seq.pages);

  const pageNav = await page.evaluate(async () => {
    const cur = () => { const a = document.querySelector('#seqList .srow.active'); return a ? [...document.querySelectorAll('#seqList .srow')].indexOf(a) : -1; };
    const before = cur();
    window.__key('PanningLeft');                      // 단독 → 이전 페이지 (350ms 뒤)
    await new Promise(r => setTimeout(r, 700));
    const afterPan = cur();
    window.__key('PanningRight');                     // 조합키의 앞부분처럼 즉시 RPF4가 따라옴
    await new Promise(r => setTimeout(r, 80));
    window.__key('RPF4');
    await new Promise(r => setTimeout(r, 700));
    return { before, afterPan, afterCombo: cur(), scale: DOTPAD.BLE ? window.__dpInfo().scale : null };
  });
  ok('pan ◀ alone moves to the previous page', pageNav.afterPan !== pageNav.before, `${pageNav.before} → ${pageNav.afterPan}`);
  ok('pan ▶ + F4 zooms without flipping the page',
    pageNav.afterCombo === pageNav.afterPan, `페이지 ${pageNav.afterPan} → ${pageNav.afterCombo}`);

  // ── 8. 텍스트 페이지: 본문이 한 쪽(10줄)을 넘으면 기기가 자동으로 새 쪽을 따라간다 ──
  await page.click('#gallery .gcat:has-text("Language Arts")');
  await page.click('#gallery .card:has-text("Braille Text Page")');
  await sleep(300);
  const tpFollow = await page.evaluate(async () => {
    const long = Array.from({ length: 26 }, (_, i) => 'line ' + (i + 1)).join('\n');  // 제목+본문 > 2쪽
    const body = [...document.querySelectorAll('#form textarea, #form input[type=text]')].pop();
    const ta = document.querySelector('#form textarea') || body;
    ta.value = long;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1400));
    const st1 = JSON.stringify(window.__sim.deviceState());
    const pageLabel1 = document.querySelector('#dpVp').textContent;
    // 이어서 더 쓰면 (같은 쪽 안에서라도) 계속 마지막 쪽을 보여준다
    ta.value = long + '\nline 27';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1400));
    const st2 = JSON.stringify(window.__sim.deviceState());
    // 팬 ◀로 앞쪽을 보는 동안에는 입력이 있어도 쪽을 빼앗지 않는다
    window.__key('PanningLeft');
    await new Promise(r => setTimeout(r, 900));
    const back = document.querySelector('#dpVp').textContent;
    ta.value = long + '\nline 27 more';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1400));
    const staying = document.querySelector('#dpVp').textContent;
    // 팬 ▶로 마지막 쪽까지 가면 다시 입력을 따라간다
    window.__key('PanningRight'); window.__key('PanningRight'); window.__key('PanningRight');
    await new Promise(r => setTimeout(r, 900));
    const fwd = document.querySelector('#dpVp').textContent;
    return { pageLabel1, changed: st1 !== st2, back, staying, fwd };
  });
  const pg = s => { const m = String(s).match(/(\d+)\/(\d+)/); return m ? { p: +m[1], n: +m[2] } : null; };
  const a1 = pg(tpFollow.pageLabel1), a2 = pg(tpFollow.staying), a3 = pg(tpFollow.fwd);
  ok('typing past one page auto-advances the device to the newest page',
    a1 && a1.n >= 3 && a1.p === a1.n, tpFollow.pageLabel1);
  ok('continued typing keeps updating the device (screen changes)', tpFollow.changed);
  ok('browsing back with pan ◀ is not yanked forward by typing',
    a2 && a2.p < a2.n, tpFollow.staying);
  ok('pan ▶ to the last page resumes following', a3 && a3.p === a3.n, tpFollow.fwd);

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
