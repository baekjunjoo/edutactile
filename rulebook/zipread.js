/* zipread.js — 최소 ZIP 리더 (.docx 해제용). DEFLATE는 pako.inflateRaw 사용. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ZIPREAD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /* bytes(Uint8Array) → { 'word/document.xml': Uint8Array, ... } */
  function readZip(bytes, inflateRaw) {
    // EOCD 탐색 (뒤에서부터)
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP EOCD not found');
    var count = u16(bytes, eocd + 10), cdOff = u32(bytes, eocd + 16);
    var files = {}, p = cdOff;
    for (var e = 0; e < count; e++) {
      if (u32(bytes, p) !== 0x02014b50) break;
      var method = u16(bytes, p + 10);
      var csize = u32(bytes, p + 20), usize = u32(bytes, p + 24);
      var nlen = u16(bytes, p + 28), elen = u16(bytes, p + 30), clen = u16(bytes, p + 32);
      var lho = u32(bytes, p + 42);
      var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
      // 로컬 헤더에서 데이터 위치
      var lnlen = u16(bytes, lho + 26), lelen = u16(bytes, lho + 28);
      var dstart = lho + 30 + lnlen + lelen;
      var raw = bytes.subarray(dstart, dstart + csize);
      files[name] = method === 0 ? raw : inflateRaw(raw);
      p += 46 + nlen + elen + clen;
    }
    return files;
  }

  /* document.xml → 문단 텍스트 배열 */
  function docxParagraphs(xmlBytes) {
    var xml = new TextDecoder().decode(xmlBytes);
    var paras = [];
    var pRe = /<w:p[ >][\s\S]*?<\/w:p>/g, tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, m, t;
    while ((m = pRe.exec(xml))) {
      var text = '';
      tRe.lastIndex = 0;
      while ((t = tRe.exec(m[0]))) text += t[1];
      text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      paras.push(text);
    }
    return paras;
  }

  return { readZip: readZip, docxParagraphs: docxParagraphs };
});
