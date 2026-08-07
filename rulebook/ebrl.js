/* ebrl.js — eBraille(.ebrl) 생성 (ebraille-format 스킬 검증 구조의 브라우저 변형)
 * 차이: 본문을 텍스트 점역이 아니라 "이미 점자인 유니코드 셀"로 직접 주입
 *       (규정집의 점형은 원문 자체가 점자 데이터이므로).
 * 유효성 규칙 준수: mimetype 첫 항목 STORED, container.xml, package.opf 필수 메타,
 * nav rel=publication, 본문 U+2800, ZIP 전체 STORED.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EBRL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CRC_T = (function () {
    var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function strBytes(s) { return new TextEncoder().encode(s); }
  function zipStore(files) {   // 전부 STORED (스킬 규칙 6)
    function u16(n) { return [n & 255, (n >> 8) & 255]; }
    function u32(n) { n >>>= 0; return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; }
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = strBytes(f.name), data = f.bytes, crc = crc32(data), len = data.length;
      var lh = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(len), u32(len), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, data);
      var ch = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(len), u32(len), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(ch), name);
      offset += lh.length + name.length + len;
    });
    var csize = 0; central.forEach(function (p) { csize += p.length; });
    var eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(offset), u16(0)));
    var all = parts.concat(central); all.push(eocd);
    var total = 0; all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* blocks: [{h: 점자헤딩}, {p: 점자문단}] — 전부 유니코드 점자여야 함 */
  function buildFromBraille(blocks, opts) {
    opts = opts || {};
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    var iso = d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + 'T' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()) + 'Z';
    var date = d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
    var lang = opts.lang || 'ar-Brai', sys = opts.sys || 'Arabic Braille';
    var titleTxt = opts.title || 'braille document';
    var titleBr = opts.titleBraille || '⠃⠗⠇';
    var uid = 'urn:uuid:' + ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(16) + '-' + Math.random().toString(16).slice(2)));
    var body = blocks.map(function (b) {
      if (b.h != null) return '    <h1>' + xmlEsc(b.h) + '</h1>';
      return '    <p>' + xmlEsc(b.p) + '</p>';
    }).join('\n');
    var pkg = '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid" xml:lang="' + lang + '">\n' +
      '  <metadata>\n    <dc:title>' + xmlEsc(titleTxt) + '</dc:title>\n    <dc:creator>Tactile Material Maker</dc:creator>\n    <dc:format>eBraille 1.0</dc:format>\n    <dc:identifier id="uid">' + uid + '</dc:identifier>\n    <dc:language>' + lang + '</dc:language>\n    <dc:date>' + date + '</dc:date>\n' +
      '    <meta property="dcterms:dateCopyrighted">' + d.getFullYear() + '</meta>\n    <meta property="dcterms:modified">' + iso + '</meta>\n    <meta property="a11y:brailleCellType">6</meta>\n    <meta property="a11y:brailleSystem">' + xmlEsc(sys) + '</meta>\n    <meta property="a11y:completeTranscription">true</meta>\n    <meta property="a11y:producer">Tactile Material Maker</meta>\n    <meta property="a11y:tactileGraphics">none</meta>\n  </metadata>\n' +
      '  <manifest>\n    <item id="nav" href="index.html" media-type="application/xhtml+xml" properties="nav"/>\n    <item id="t01" href="transcript.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n  <spine>\n    <itemref idref="t01"/>\n  </spine>\n</package>\n';
    var nav = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' + lang + '" lang="' + lang + '">\n<head><meta charset="utf-8"/><title>' + xmlEsc(titleTxt) + '</title>\n<link rel="publication" href="package.opf" type="application/oebps-package+xml"/></head>\n<body>\n<nav epub:type="toc" role="doc-toc" aria-label="Table of Contents">\n<h2>' + xmlEsc(titleBr) + '</h2>\n<ol><li><a href="transcript.xhtml">' + xmlEsc(titleBr) + '</a></li></ol>\n</nav>\n</body></html>\n';
    var docx = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + lang + '" lang="' + lang + '">\n<head><meta charset="utf-8"/><title>' + xmlEsc(titleTxt) + '</title></head>\n<body>\n    <h1>' + xmlEsc(titleBr) + '</h1>\n' + body + '\n</body></html>\n';
    var container = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n   <rootfiles>\n      <rootfile full-path="package.opf" media-type="application/oebps-package+xml"/>\n   </rootfiles>\n</container>\n';
    return zipStore([
      { name: 'mimetype', bytes: strBytes('application/epub+zip') },   // 첫 항목·STORED (규칙 1)
      { name: 'META-INF/container.xml', bytes: strBytes(container) },
      { name: 'package.opf', bytes: strBytes(pkg) },
      { name: 'index.html', bytes: strBytes(nav) },
      { name: 'transcript.xhtml', bytes: strBytes(docx) }
    ]);
  }

  return { buildFromBraille: buildFromBraille, zipStore: zipStore };
});
