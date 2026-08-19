/* DOT Convert E2E: 업로드(PDF·DOCX) → 분석 수치 → 견적 계산(단가 검증) → 변환 → 점자·BRF */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const DIST = 'file://' + path.resolve(__dirname, 'dist/dot-convert.html');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✔', n); } else { fail++; console.log('  ✘', n, x !== undefined ? '→ ' + x : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 테스트용 PDF는 edutactile 내보내기 산출물이 없으니 즉석 제작 (pdfkit 없이 최소 PDF)
  // → 간단히: 브라우저에서 jsPDF 불가. 대신 실제 견본: tgil-studio의 PDF 테스트 자산? 없음.
  // 최소 유효 PDF를 손으로 구성 (2페이지, 텍스트 스트림 포함)
  const mkPdf = () => {
    const pageTxt = n => `BT /F1 12 Tf 50 700 Td (DOT Convert demo page ${n} with plenty of sample words so the analyzer counts enough text per page to call this a text based document not a scan) Tj ET`;
    const objs = [];
    const add = s => objs.push(s);
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
    add(`<< /Length ${pageTxt(1).length} >>\nstream\n${pageTxt(1)}\nendstream`);
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>');
    add(`<< /Length ${pageTxt(2).length} >>\nstream\n${pageTxt(2)}\nendstream`);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let out = '%PDF-1.4\n', offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offs.forEach(o => { out += String(o).padStart(10, '0') + ' 00000 n \n'; });
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  };
  const pdfPath = path.join(__dirname, 'sample.pdf');
  fs.writeFileSync(pdfPath, mkPdf());

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(DIST);
  await sleep(400);

  ok('engines loaded (pdfjs · pako · TGIL · EXPORTERS)', await page.evaluate(() =>
    !!(window.pako && (window.pdfjsLib || window['pdfjs-dist/build/pdf']) && window.TGIL && window.EXPORTERS && window.ZIPREAD)));

  // ── 1. PDF 업로드 → 분석 ──
  await page.setInputFiles('#fileInp', pdfPath);
  await page.waitForFunction(() => document.querySelector('#stPages').textContent !== '…', null, { timeout: 15000 });
  const an = await page.evaluate(() => ({
    pages: document.querySelector('#stPages').textContent,
    words: +document.querySelector('#stWords').textContent.replace(/,/g, ''),
    kind: document.querySelector('#stKind').textContent
  }));
  ok('PDF analyzed: 2 pages, text-based', an.pages === '2' && an.kind === '텍스트 기반' && an.words > 10, JSON.stringify(an));

  // ── 2. 견적: 2페이지 × $0.6 = $1.2 = 12크레딧 (객체 0 → 옵션 자동 무시) ──
  const q = await page.evaluate(() => ({
    cred: document.querySelector('#tCred').textContent,
    usd: document.querySelector('#tUsd').textContent,
    btn: document.querySelector('#goBtn').textContent
  }));
  ok('quote: 2p × $0.6 → 12 credits', q.cred === '12' && /\$1\.2/.test(q.usd), JSON.stringify(q));

  // 프리미엄 수량은 객체 수(0)를 넘지 못한다
  await page.click('#pPlus');
  const pc = await page.evaluate(() => document.querySelector('#pCnt').textContent);
  ok('premium count capped at detected objects (0)', pc === '0', pc);

  // ── 3. 변환 → 점자 미리보기 + 잔액 차감 ──
  await page.click('#goBtn');
  await page.waitForFunction(() => document.querySelector('#result').style.display === 'grid', null, { timeout: 15000 });
  const res = await page.evaluate(() => ({
    bal: document.querySelector('#creditBal').textContent,
    brl: document.querySelector('#prevBrl').textContent, brlFull: document.querySelector('#prevBrl').textContent,
    code: document.querySelector('#brlCode').textContent,
    doc: document.querySelector('#prevDoc').textContent
  }));
  ok('credits deducted (5,000 − 12 = 4,988)', res.bal === '4,988', res.bal);
  ok('braille preview is real unicode braille (UEB for English text)',
    /[⠁-⣿]/.test(res.brl) && /UEB/.test(res.code), res.brl.slice(0, 20));
  ok('accessible doc preview shows content', /DOT Convert demo page/.test(res.doc));

  // ── 4. BRF 다운로드 산출물 검증 ──
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlBrf')]);
  const brfPath = path.join(__dirname, 'out.brf');
  await dl.saveAs(brfPath);
  const brf = fs.readFileSync(brfPath, 'latin1');
  ok('BRF: ASCII braille lines ≤40 cells', brf.length > 20 && brf.split('\r\n').every(l => l.length <= 40), brf.slice(0, 40));

  // ── 5. DOCX 업로드 (한국어) → 한국 점자 경로 ──
  //     zipread가 읽는 구조 그대로: word/document.xml (raw deflate 없이 stored는 지원? readZip은 inflateRaw 필요)
  //     → 실제 docx는 deflate — pako.deflateRaw로 만들 수 있지만 노드 zlib.deflateRawSync 사용
  const zlib = require('zlib');
  const docXml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
    '<w:p><w:r><w:t>수학 삼각형 학습지</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>세 변의 길이를 비교해 봅시다</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const mkDocx = () => {
    const name = 'word/document.xml';
    const data = Buffer.from(docXml, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32 ? zlib.crc32(data) : require('zlib').crc32(data);
    const nameB = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    const local = Buffer.concat([lh, nameB, comp]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(0, 42);
    const central = Buffer.concat([ch, nameB]);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
    return Buffer.concat([local, central, end]);
  };
  const docxPath = path.join(__dirname, 'sample.docx');
  fs.writeFileSync(docxPath, mkDocx());
  await page.setInputFiles('#fileInp', docxPath);
  await page.waitForFunction(() => document.querySelector('#stKind').textContent !== '…', null, { timeout: 8000 });
  await page.click('#goBtn');
  await page.waitForFunction(() => document.querySelector('#result').style.display === 'grid', null, { timeout: 15000 });
  const ko = await page.evaluate(() => ({
    code: document.querySelector('#brlCode').textContent,
    brl: document.querySelector('#prevBrl').textContent
  }));
  ok('DOCX with Korean text → 한국 점자 경로', /한국/.test(ko.code) && /[⠁-⣿]/.test(ko.brl), JSON.stringify(ko).slice(0, 60));

  await page.screenshot({ path: path.join(__dirname, 'shot-result.png'), fullPage: false });
  await browser.close();
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
