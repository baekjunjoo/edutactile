/* DOT Convert — 단일 HTML 빌드 (edutactile 엔진·pdf.js·pako 인라인, 오프라인 동작) */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const ET = path.join(ROOT, '..');                          // 재사용: edutactile 엔진들
const read = p => fs.readFileSync(p, 'utf8');

const brailleWrapped =
  'window.KB=(function(){var module={exports:{}};\n' +
  read(path.join(ET, 'engine/braille.js')) +
  '\nreturn module.exports;})();';

let html = read(path.join(ROOT, 'src/index.html'))
  .replace('/*__BRAILLE__*/', () => brailleWrapped)
  .replace('/*__PAKO__*/', () => read(path.join(ET, 'node_modules/pako/dist/pako_inflate.min.js')))
  .replace('/*__PDFJS__*/', () => read(path.join(ET, 'node_modules/pdfjs-dist/legacy/build/pdf.min.js')))
  .replace('/*__PDFWORKER__*/', () => read(path.join(ET, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js')))
  .replace('/*__ZIPREAD__*/', () => read(path.join(ET, 'rulebook/zipread.js')))
  .replace('/*__TGIL__*/', () => read(path.join(ET, 'engine/tgil.js')))
  .replace('/*__EXPORTERS__*/', () => read(path.join(ET, 'engine/exporters.js')))
  .replace('/*__APP__*/', () => read(path.join(ROOT, 'src/app.js')));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist/dot-convert.html');
fs.writeFileSync(out, html);
console.log('built', out, fs.statSync(out).size, 'bytes');
