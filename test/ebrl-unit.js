/* .ebrl 단위 검증: EXPORT.ebrl 로직 재현 → ebraille-format 스킬 유효성 규칙 검사 */
const fs = require('fs');
const RULEBOOK = require('../rulebook/rulebook.js');
const EBRL = require('../rulebook/ebrl.js');
const E = require('/root/.claude/skills/ebraille-format/lib/ebraille.js');

const data = JSON.parse(fs.readFileSync(__dirname + '/../rulebook/arabic-709.json', 'utf8'));
const d = RULEBOOK.normalize(data, {});

// ── app.js와 동일한 전사 로직 ──
function rbCharMap(doc) {
  const map = {};
  doc.chapters.forEach(ch => ch.sections.forEach(s => s.items.forEach(it => {
    if (!it.print || !it.dots || !it.dots.length) return;
    const p = String(it.print).trim();
    if (Array.from(p).length === 1 && !map[p]) map[p] = it.dots;
  })));
  return map;
}
function rbTranscribe(text, map) {
  if (!text) return null;
  const cells = []; let known = 0, unknown = 0;
  Array.from(String(text)).forEach(ch => {
    if (/\s/.test(ch)) { cells.push([]); return; }
    const dots = map[ch];
    if (dots) { known++; dots.forEach(ds => cells.push(RULEBOOK.parseDots(ds))); }
    else unknown++;
  });
  if (!known || known < unknown) return null;
  while (cells.length && !cells[0].length) cells.shift();
  while (cells.length && !cells[cells.length - 1].length) cells.pop();
  return cells.length ? cells : null;
}
const rbBrailleStr = c => c ? c.map(x => x.length ? RULEBOOK.cellChar(x) : '⠀').join('') : null;
const DIG = ['⠚','⠁','⠃','⠉','⠙','⠑','⠋','⠛','⠓','⠊'];
const rbNumBraille = n => '⠼' + String(n).split('').map(c => DIG[+c] || '⠀').join('');

const map = rbCharMap(d);
console.log('charMap size:', Object.keys(map).length);

const blocks = [];
let namedItems = 0, totalItems = 0, sectionsWithTitle = 0;
d.chapters.forEach((ch, ci) => {
  const hb = rbBrailleStr(rbTranscribe(ch.title, map));
  blocks.push({ h: hb || rbNumBraille(ci + 1) });
  ch.sections.forEach(sec => {
    const sb = rbBrailleStr(rbTranscribe(sec.title, map));
    if (sb) { blocks.push({ p: sb }); sectionsWithTitle++; }
    sec.items.forEach(it => {
      if (!it.dots || !it.dots.length) return;
      totalItems++;
      const nb = rbBrailleStr(rbTranscribe(it.name || it.print || '', map));
      if (nb) namedItems++;
      blocks.push({ p: (nb ? nb + '⠀' : '') + RULEBOOK.brailleText(it.dots) });
    });
  });
});
console.log('blocks:', blocks.length, '| items:', totalItems, '| with braille name:', namedItems,
  '(' + Math.round(namedItems / totalItems * 100) + '%) | sections titled:', sectionsWithTitle);

const zip = EBRL.buildFromBraille(blocks, { title: d.title || 'braille document', titleBraille: rbBrailleStr(rbTranscribe(d.title, map)) || undefined });
fs.writeFileSync(__dirname + '/braille-document.ebrl', zip);

// ── 유효성 검사 ──
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log(' ✔', n); } else { fail++; console.log(' ✘', n, x || ''); } };

// 규칙 1: mimetype 첫 항목·STORED
ok('mimetype first entry', zip[0] === 0x50 && new TextDecoder().decode(zip.slice(30, 38)) === 'mimetype');
ok('mimetype STORED (method=0)', zip[8] === 0 && zip[9] === 0);
const files = E.zipReadStored(zip);
ok('zipReadStored reads all 5', Object.keys(files).length === 5, Object.keys(files));
ok('mimetype content', new TextDecoder().decode(files['mimetype']) === 'application/epub+zip');
const opf = new TextDecoder().decode(files['package.opf']);
['dc:title','dc:creator','dc:identifier','dc:language','dc:date','eBraille 1.0','dcterms:dateCopyrighted','dcterms:modified','a11y:brailleCellType','a11y:brailleSystem','a11y:completeTranscription','a11y:producer','a11y:tactileGraphics']
  .forEach(k => ok('opf has ' + k, opf.includes(k)));
ok('language has Brai subtag', /<dc:language>[^<]*-Brai/.test(opf), opf.match(/<dc:language>[^<]*</));
const nav = new TextDecoder().decode(files['index.html']);
ok('nav rel=publication', nav.includes('rel="publication"') && nav.includes('package.opf'));
ok('nav epub:type=toc', nav.includes('epub:type="toc"'));
const body = new TextDecoder().decode(files['transcript.xhtml']);
const inner = [...body.matchAll(/<(p|h1)>([^<]*)<\/\1>/g)].map(m => m[2]).join('');
const nonBraille = [...inner].filter(c => !(c.charCodeAt(0) >= 0x2800 && c.charCodeAt(0) <= 0x28FF));
ok('body all U+2800 braille', nonBraille.length === 0, 'non-braille: ' + JSON.stringify(nonBraille.slice(0, 10)));
ok('container.xml rootfile', new TextDecoder().decode(files['META-INF/container.xml']).includes('application/oebps-package+xml'));
console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
