/* docx.js — 브라우저용 최소 .docx 생성기 (외부 의존성 없음)
 * 설계 문서의 python-docx 패턴을 OOXML로 직접 구현:
 *  - w:bidi RTL 문단, 점자 run(Apple Braille Pinpoint), RLM 경계 run(아랍어 폰트)
 *  - 점 번호: 아랍어 라벨(النقاط:) RTL 앵커 + LRO…PDF로 내부 순서 고정
 * ZIP은 STORE(무압축) + CRC32 — 어떤 Word/LibreOffice에서도 열림.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.DOCX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── CRC32 ── */
  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  /* ── ZIP (STORE) ── */
  function zipStore(files) {   // files: [{name, data(Uint8Array|string)}]
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var name = utf8(f.name);
      var crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += local.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) {
      var hdr = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(c.offset));
      chunks.push(new Uint8Array(hdr), c.name);
      cdSize += hdr.length + c.name.length;
    });
    chunks.push(new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
      u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))));
    var total = chunks.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  /* ── OOXML 헬퍼 ── */
  function xesc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  var LRO = '‭', PDF_ = '‬', RLM = '‏';

  function run(text, opts) {   // opts: {font, sz(pt), bold, color, cs}
    opts = opts || {};
    var pr = '';
    if (opts.font) pr += '<w:rFonts w:ascii="' + opts.font + '" w:hAnsi="' + opts.font + '" w:cs="' + (opts.csFont || opts.font) + '"/>';
    if (opts.bold) pr += '<w:b/><w:bCs/>';
    if (opts.sz) pr += '<w:sz w:val="' + Math.round(opts.sz * 2) + '"/><w:szCs w:val="' + Math.round(opts.sz * 2) + '"/>';
    if (opts.color) pr += '<w:color w:val="' + opts.color + '"/>';
    if (opts.cs) pr += '<w:rtl/>';
    return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') +
      '<w:t xml:space="preserve">' + xesc(text) + '</w:t></w:r>';
  }
  function para(runs, opts) {  // opts: {rtl, heading(1|2|3), spacingAfter(pt)}
    opts = opts || {};
    var pr = '';
    if (opts.heading) pr += '<w:pStyle w:val="Heading' + opts.heading + '"/>';
    if (opts.rtl) pr += '<w:bidi/><w:jc w:val="right"/>';
    if (opts.spacingAfter != null) pr += '<w:spacing w:after="' + Math.round(opts.spacingAfter * 20) + '"/>';
    return '<w:p>' + (pr ? '<w:pPr>' + pr + '</w:pPr>' : '') + runs.join('') + '</w:p>';
  }

  var BRAILLE_FONT = 'Apple Braille Pinpoint 6 Dot';
  var AR_FONT = 'Noto Naskh Arabic';

  /* 점자 run + RLM 경계 (설계 문서 add_braille_run 패턴) */
  function brailleRuns(brText, pt, rtl) {
    var rs = [];
    if (rtl) rs.push(run(RLM, { font: AR_FONT, sz: pt * 0.4 }));
    rs.push(run(brText, { font: BRAILLE_FONT, sz: pt }));
    if (rtl) rs.push(run(RLM, { font: AR_FONT, sz: pt * 0.4 }));
    return rs;
  }
  /* 점 번호 라벨 (설계 문서 add_dots_label 패턴) */
  function dotsRuns(labelText, groupsText, rtl, sz) {
    var rs = [];
    if (rtl && labelText) rs.push(run(labelText + ' ', { sz: sz, color: '777777', cs: true, font: AR_FONT }));
    rs.push(run(LRO + groupsText + PDF_, { font: 'Noto Serif', sz: sz, color: '666666' }));
    return rs;
  }

  /* ── 문서 조립: RULEBOOK.normalize() 결과 → docx 바이트 ── */
  function buildDocx(doc, RB) {
    var rtl = doc.rtl, body = [];
    body.push(para([run(doc.title, { sz: 24, bold: true, cs: rtl, font: AR_FONT })], { rtl: rtl, heading: 1 }));
    body.push(para([run(doc.itemCount + ' رمزًا', { sz: 11, color: '555555', cs: rtl, font: AR_FONT })], { rtl: rtl, spacingAfter: 14 }));
    doc.front.forEach(function (b) {
      if (b.kind === 'heading') body.push(para([run(b.text, { sz: 14, bold: true, cs: rtl, font: AR_FONT })], { rtl: rtl, heading: 3 }));
      else body.push(para([run(b.text, { sz: 11.5, cs: rtl, font: AR_FONT })], { rtl: rtl, spacingAfter: 4 }));
    });
    doc.chapters.forEach(function (ch, ci) {
      body.push(para([run((ci + 1) + ' — ' + ch.title, { sz: 17, bold: true, cs: rtl, font: AR_FONT })], { rtl: rtl, heading: 2 }));
      ch.rules.forEach(function (rb) {
        if (rb.heading) body.push(para([run(rb.heading, { sz: 13, bold: true, cs: rtl, font: AR_FONT })], { rtl: rtl, heading: 3 }));
        rb.lines.forEach(function (l) {
          body.push(para([run(l, { sz: 11.5, cs: rtl, font: AR_FONT })], { rtl: rtl, spacingAfter: 3 }));
        });
      });
      ch.sections.forEach(function (s, si) {
        if (s.title) body.push(para([run((ci + 1) + '-' + (si + 1) + ' ' + s.title, { sz: 13, bold: true, cs: rtl, font: AR_FONT })], { rtl: rtl, heading: 3 }));
        s.items.forEach(function (it, ii) {
          var id = (ci + 1) + '-' + (si + 1) + '-' + (ii + 1);
          var rs = [run(LRO + id + PDF_ + '  ', { sz: 8.5, color: '888888', font: 'Noto Serif' })];
          if (it.name) rs.push(run(it.name + '  ', { sz: 11.5, bold: true, cs: rtl, font: AR_FONT }));
          if (it.print != null && it.print !== '') rs.push(run(it.print + '  ', { sz: 11.5, cs: rtl, font: AR_FONT }));
          if (it.dots && it.dots.length) rs = rs.concat(brailleRuns(RB.brailleText(it.dots, rtl), 20, rtl));
          body.push(para(rs, { rtl: rtl, spacingAfter: 1 }));
          if (it.dots && it.dots.length)
            body.push(para(dotsRuns(rtl ? 'النقاط:' : 'dots:', RB.dotsLabel(it.dots, rtl), rtl, 8), { rtl: rtl, spacingAfter: 3 }));
          (it.notes || []).forEach(function (n) {
            body.push(para([run((rtl ? 'ملاحظة: ' : 'note: ') + n, { sz: 10, color: '444444', cs: rtl, font: AR_FONT })], { rtl: rtl, spacingAfter: 2 }));
          });
          (it.examples || []).forEach(function (ex) {
            var er = [];
            if (ex.print != null) er.push(run(ex.print + '  ', { sz: 10.5, cs: rtl, font: AR_FONT }));
            er = er.concat(brailleRuns(RB.brailleText(ex.dots, rtl), 15, rtl));
            er.push(run('  ', { sz: 8 }));
            er = er.concat(dotsRuns('', RB.dotsLabel(ex.dots, rtl), rtl, 7.5));
            body.push(para(er, { rtl: rtl, spacingAfter: 2 }));
          });
        });
      });
    });

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + body.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>' +
      (rtl ? '<w:bidi/>' : '') + '</w:sectPr></w:body></w:document>';

    // 문서 언어 태그 (스크린리더가 올바른 음성 엔진 선택 — 페르소나 피드백)
    var langDefaults = '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:lang w:val="en-US"' + (rtl ? ' w:bidi="ar-SA"' : '') + '/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>';
    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      langDefaults +
      [1, 2, 3].map(function (n) {
        return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/>' +
          '<w:pPr><w:keepNext/><w:spacing w:before="' + (300 - n * 60) + '" w:after="120"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr>' +
          '<w:rPr><w:b/><w:bCs/></w:rPr></w:style>';
      }).join('') + '</w:styles>';

    return zipStore([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/document.xml', data: documentXml }
    ]);
  }

  return { buildDocx: buildDocx, zipStore: zipStore, crc32: crc32 };
});
