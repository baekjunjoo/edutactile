/* 가이드 빌드 — 이미지를 base64로 심어 자체완결 HTML 한 장을 만든다 (오프라인 전달·인쇄용) */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'guide-ko.src.html');
const OUT = path.join(__dirname, 'guide-ko.html');
let h = fs.readFileSync(SRC, 'utf8');
h = h.replace(/IMG:([\w.\-]+)/g, function (m, f) {
  const b = fs.readFileSync(path.join(__dirname, 'img', f)).toString('base64');
  return 'data:' + (/\.png$/.test(f) ? 'image/png' : 'image/jpeg') + ';base64,' + b;
});
if (/IMG:/.test(h)) throw new Error('이미지를 못 찾았습니다');
fs.writeFileSync(OUT, h);
console.log('built', path.relative(process.cwd(), OUT), fs.statSync(OUT).size, 'bytes');
