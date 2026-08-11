/* UI 정리 검증: 개발자용 패널 숨김 + 문서 변환기 드래그&드롭 */
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DIST = 'file://' + path.resolve(__dirname, '../dist/tactile-material-maker-ko.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(DIST);
  await page.waitForSelector('#gallery .gcat');
  await sleep(500);

  // 1. 보고서·JSON 편집 패널이 화면에서 보이지 않는다 (내부 상태 저장용으로만 존재)
  const hidden = await page.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
    return {
      report: vis('report'), hRep: vis('h-report'), json: vis('json'), apply: vis('applyJson'),
      jsonAlive: !!document.querySelector('#json').value   // 스펙 저장소로는 계속 동작해야 한다
    };
  });
  ok('report / advanced-JSON panel hidden from the page',
    !hidden.report && !hidden.hRep && !hidden.json && !hidden.apply, JSON.stringify(hidden));
  ok('hidden #json still carries the spec (exports/tests unaffected)', hidden.jsonAlive);

  // 2. 문서 변환기: 미리보기에 파일을 드롭하면 변환된다
  await page.click('#gallery .gcat:has-text("Documents")');
  await page.click('#gallery .card:has-text("점자 문서 변환기"), #gallery .card:has-text("Braille Document Converter")');
  await sleep(400);
  const hint = await page.evaluate(() => document.querySelector('#preview').textContent);
  ok('empty state invites drag & drop', /끌어다|Drag/i.test(hint), hint.slice(0, 60));

  const drop = await page.evaluate(async () => {
    const sample = new File([JSON.stringify(window.RB_SAMPLE)], 'drop-test.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(sample);
    const pv = document.querySelector('#preview');
    pv.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const highlighted = pv.classList.contains('dropping');
    pv.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 1500));
    return {
      highlighted,
      cleared: !pv.classList.contains('dropping'),
      converted: !!document.querySelector('#rbFrame'),
      name: (window.__appState && window.__appState().rbName) || null
    };
  });
  ok('dragover highlights the drop zone', drop.highlighted);
  ok('drop converts the file (rulebook renders)', drop.converted && drop.cleared, JSON.stringify(drop));

  // 3. 다른 템플릿에서는 드롭이 아무 것도 하지 않는다 (오조작 방지)
  await page.click('#gallery .gcat:has-text("Mathematics")');
  await page.click('#gallery .card:has-text("수직선"), #gallery .card:has-text("Number Line")');
  await sleep(400);
  const other = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{}'], 'x.json', { type: 'application/json' }));
    const pv = document.querySelector('#preview');
    pv.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { highlighted: pv.classList.contains('dropping'), svg: !!pv.querySelector('svg') };
  });
  ok('drop zone inactive outside the converter', !other.highlighted && other.svg, JSON.stringify(other));

  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
