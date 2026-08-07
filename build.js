/* build.js — 단일 파일 dist/tactile-material-maker*.html 생성 */
const fs = require('fs');
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');

let html = read('app/shell.html');

// braille.js: 최상단 `var window=...`가 브라우저 전역을 건드리지 않게 클로저로 감싼다
const brailleWrapped =
  'window.KB=(function(){var module={exports:{}};\n' +
  read('engine/braille.js') +
  '\nreturn module.exports;})();';

html = html
  .replace('/*__BRAILLE__*/', () => brailleWrapped)
  .replace('/*__TGIL__*/', () => read('engine/tgil.js'))
  .replace('/*__TEMPLATES__*/', () => read('engine/templates.js'))
  .replace('/*__EXPORTERS__*/', () => read('engine/exporters.js'))
  .replace('/*__TRACE__*/', () => read('engine/trace.js'))
  .replace('/*__RULEBOOK__*/', () => read('rulebook/rulebook.js'))
  .replace('/*__DOCX__*/', () => read('rulebook/docx.js'))
  .replace('/*__EBRL__*/', () => read('rulebook/ebrl.js'))
  .replace('/*__DOTPADSDK__*/', () => {
    // 공식 DotPadSDK 내장 (Dot Inc. 자사 SDK) — 있으면 base64로 심어 파일 선택 없이 즉시 연결
    const p = __dirname + '/app/DotPadSDK-3.0.0.js';
    if (!fs.existsSync(p)) { console.warn('⚠ DotPadSDK not found — connect will ask for the file'); return ''; }
    return 'window.DOTPAD_SDK_SRC=' + JSON.stringify(fs.readFileSync(p).toString('base64')) + ';';
  })
  .replace('/*__DOTPAD__*/', () => read('app/dotpad.js'))
  .replace('/*__PARSER__*/', () => read('rulebook/parser.js'))
  .replace('/*__ZIPREAD__*/', () => read('rulebook/zipread.js'))
  .replace('/*__PAKO__*/', () => read('node_modules/pako/dist/pako_inflate.min.js'))
  .replace('/*__PDFJS__*/', () => read('node_modules/pdfjs-dist/legacy/build/pdf.min.js'))
  .replace('/*__PDFWORKER__*/', () => read('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js'))
  .replace('/*__RBDATA__*/', () => {
    // 점자 폰트: .ttf가 있으면 사용, 없으면 .ttf.b64(텍스트 저장용), 둘 다 없으면 폰트 없이 빌드
    const ttf = __dirname + '/rulebook/AppleBraillePinpoint.ttf';
    let fontB64 = '';
    if (fs.existsSync(ttf)) fontB64 = fs.readFileSync(ttf).toString('base64');
    else if (fs.existsSync(ttf + '.b64')) fontB64 = fs.readFileSync(ttf + '.b64', 'utf8').replace(/\s+/g, '');
    else console.warn('⚠ braille font not found — building without embedded font (see README)');
    // 내장 샘플(아랍어 709): 없으면 샘플 버튼이 자동으로 숨는다
    let sample = null;
    if (fs.existsSync(__dirname + '/rulebook/arabic-709.json')) sample = JSON.parse(read('rulebook/arabic-709.json'));
    else console.warn('⚠ built-in sample not found — sample button will be hidden');
    return 'window.RB_FONT=' + JSON.stringify(fontB64) + ';\n' +
      'window.RB_SAMPLE=' + JSON.stringify(sample) + ';';
  })
  .replace('/*__APP__*/', () => read('app/app.js'));

fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/tactile-material-maker.html', html);
console.log('built dist/tactile-material-maker.html', html.length, 'bytes');

// 한글 기본 버전: UI·점자 기본값 = 한국어
const ko = html
  .replace('<html lang="en">', '<html lang="ko">')
  .replace('<script>window.KB', '<script>window.TGIL_DEFAULT_LANG="ko";window.KB');
fs.writeFileSync(__dirname + '/dist/tactile-material-maker-ko.html', ko);
console.log('built dist/tactile-material-maker-ko.html', ko.length, 'bytes');
