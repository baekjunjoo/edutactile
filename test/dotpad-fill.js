/* 기기 출력 충실도 — 빗금(텍스처) = 채워진 면인가
 * 실기기 피드백: 빗금 영역은 핀이 꽉 차야 하고, 채운 면 안의 칸 구분선은
 * 홈(핀 내려감)이어야 손으로 칸을 셀 수 있다. (솟은 면 위의 솟은 선은 못 느낀다) */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const mockSrc = fs.readFileSync(path.join(__dirname, 'lib/dotpad-mock.js'), 'utf8');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rowsToGrid(rows) {
  const g = Array.from({ length: 40 }, () => new Array(60).fill(0));
  rows.forEach((hex, cy) => {
    for (let cx = 0; cx < 30; cx++) {
      const b = parseInt(hex.substr(cx * 2, 2), 16);
      for (let r = 0; r < 4; r++) {
        if (b & (1 << r)) g[cy * 4 + r][cx * 2] = 1;
        if (b & (1 << (r + 4))) g[cy * 4 + r][cx * 2 + 1] = 1;
      }
    }
  });
  return g;
}
/* 잉크가 있는 세로 범위의 한가운데 행 (테두리 행이 아니라 내부를 본다) */
const midRow = g => {
  const idx = g.map((r, i) => r.some(Boolean) ? i : -1).filter(i => i >= 0);
  return g[idx[Math.floor(idx.length / 2)]] || g[0];
};
/* 한 행의 연속 솟음 구간들 (길이 2 이상만 = 면, 1은 선) */
const runs = row => {
  const out = []; let n = 0;
  row.forEach(v => { if (v) n++; else { if (n) out.push(n); n = 0; } });
  if (n) out.push(n);
  return out;
};

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
    DOTPAD.BLE.MIN_INTERVAL = 5; DOTPAD.BLE.HEAVY_GAP = 20;
  });
  await page.click('#dpBtn');
  await page.waitForFunction(() => DOTPAD.BLE.readyCount() === 1);

  async function deviceGrid(cardText, category) {
    if (!await page.$(`#gallery .card:has-text("${cardText}")`)) await page.click(`#gallery .gcat:has-text("${category}")`);
    await page.click(`#gallery .card:has-text("${cardText}")`);
    await page.waitForSelector('#preview svg');
    await page.evaluate(() => window.__setView('fit', null, null));
    await sleep(1500);
    return rowsToGrid(await page.evaluate(() => window.__sim.deviceState()));
  }

  // ── 1. 분수 막대 3/4: 채운 칸은 꽉 찬 면, 칸 사이는 홈 ──
  const strip = await deviceGrid('Fraction Strip', 'Mathematics');
  const stripRow = midRow(strip);
  const areas = runs(stripRow).filter(n => n >= 4);        // 면(4핀 이상)만
  ok('shaded parts come through as solid filled areas', areas.length === 3, `면 ${areas.length}개 (폭 ${runs(stripRow).join(',')})`);
  ok('filled areas are genuinely solid (not sparse hatch lines)',
    areas.every(n => n >= 6), `가장 좁은 면 ${Math.min.apply(null, areas)}핀`);
  ok('dividers between filled parts stay down (countable by touch)',
    runs(stripRow).length >= 4, `구간 ${runs(stripRow).length}개`);
  const stripInk = strip.flat().filter(Boolean).length;
  ok('unshaded part left empty', stripInk > 200 && stripInk < 900, `${stripInk}핀`);

  // ── 2. 분수 원(부채꼴)도 면으로 채워진다 ──
  const pie = await deviceGrid('Fraction Circle', 'Mathematics');
  const pieRow = midRow(pie);
  ok('pie sector filled solid', runs(pieRow).some(n => n >= 8), `최대 구간 ${Math.max.apply(null, runs(pieRow))}핀`);

  // ── 3. 막대그래프: 막대마다 솟은 면, 서로 분리 ──
  const bar = await deviceGrid('Bar Chart', 'Mathematics');
  const barRow = bar[bar.length - 8];                       // 아래쪽 = 모든 막대가 존재하는 높이
  const bars = runs(barRow).filter(n => n >= 3);
  ok('bars render as separated solid blocks', bars.length >= 3, `막대 ${bars.length}개 (구간 ${runs(barRow).join(',')})`);

  // ── 4. 텍스처가 없는 도면은 예전 그대로 (선만, 통짜로 차지 않는다) ──
  const court = await deviceGrid('Tennis', 'Physical');
  const courtInk = court.flat().filter(Boolean).length;
  ok('texture-free diagram stays line art (not flooded)', courtInk < 600, `${courtInk}핀 / 2400`);

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
