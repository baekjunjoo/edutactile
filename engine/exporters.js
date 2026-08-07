/* exporters.js — DotPad .dtms / BRF 내보내기
 * .dtms: 용지 전체를 도트 그리드(피치 2.4mm)로 래스터라이즈 → 60×40 뷰포트 페이지로 분할
 *        (Monarch/DotPad는 버튼 패닝으로 아래 내용 탐색 — baekjun 결정사항)
 * BRF:   키 페이지(제목·치수 목록)를 North American ASCII braille로
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EXPORTERS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRID_COLS = 120, VIEW_W = 60, VIEW_H = 40;
  var LEFT_BITS = [0, 1, 2, 6], RIGHT_BITS = [3, 4, 5, 7]; // 검증된 dtms 비트 배열

  /* 60×40 그리드(0/1 2차원) → 300바이트 hex */
  function encodePage(grid) {
    var b = new Uint8Array(300);
    for (var y = 0; y < VIEW_H; y++) for (var x = 0; x < VIEW_W; x++) {
      if (!grid[y] || !grid[y][x]) continue;
      var cc = x >> 1, side = x & 1, cr = y >> 2, r = y & 3;
      b[cr * 30 + cc] |= (1 << (side ? RIGHT_BITS[r] : LEFT_BITS[r]));
    }
    return Array.from(b, function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  /* 잉크 bbox로 크롭 (여백 페이지 제거·페이지 수 최소화) */
  function cropGrid(big, pad) {
    pad = pad == null ? 1 : pad;
    var H = big.length, W = big[0].length;
    var x0 = W, x1 = -1, y0 = H, y1 = -1, x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (big[y][x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    var out = [];
    for (y = y0; y <= y1; y++) out.push(big[y].slice(x0, x1 + 1));
    return out;
  }

  /* 크롭 후: 한 화면(60×40)에 들어가면 중앙 배치 단일 페이지, 아니면 뷰포트 분할 */
  function fitOrSlice(big) {
    var c = cropGrid(big, 1);
    if (!c) return [];
    var H = c.length, W = c[0].length;
    if (W <= VIEW_W && H <= VIEW_H) {
      var ox = Math.floor((VIEW_W - W) / 2), oy = Math.floor((VIEW_H - H) / 2);
      var g = [], ink = 0, x, y;
      for (y = 0; y < VIEW_H; y++) { g.push([]); for (x = 0; x < VIEW_W; x++) g[y].push(0); }
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (c[y][x]) { g[oy + y][ox + x] = 1; ink++; }
      return [{ grid: g, ink: ink, row: 1, col: 1 }];
    }
    return sliceViewports(c);
  }

  /* 큰 그리드 → 60×40 뷰포트 페이지들 (좌→우, 위→아래) */
  function sliceViewports(big) {
    var H = big.length, W = big[0].length, pages = [];
    var nx = Math.ceil(W / VIEW_W), ny = Math.ceil(H / VIEW_H);
    for (var py = 0; py < ny; py++) for (var px = 0; px < nx; px++) {
      var g = [], ink = 0;
      for (var y = 0; y < VIEW_H; y++) {
        var row = [];
        for (var x = 0; x < VIEW_W; x++) {
          var v = (big[py * VIEW_H + y] || [])[px * VIEW_W + x] || 0;
          row.push(v); ink += v;
        }
        g.push(row);
      }
      pages.push({ grid: g, ink: ink, row: py + 1, col: px + 1 });
    }
    return pages.filter(function (p) { return p.ink > 0; }); // 빈 페이지 제거
  }

  /* 페이지들 → .dtms JSON 문자열 */
  function makeDtms(title, pages, lang) {
    return JSON.stringify({
      title: title, lang: lang === 'ko' ? 'korean' : 'english', lang_option: '2',
      device: 'dotpad320', audioPath: '',
      items: pages.map(function (p, i) {
        return {
          page: i + 1, title: title + ' (' + p.row + ',' + p.col + ')',
          graphic: { name: (i + 1) + '.dtm', data: encodePage(p.grid) },
          text: { name: (i + 1) + '.txt', data: '', plain: title + ' — section row ' + p.row + ', col ' + p.col },
          audio: { fileName: '' }
        };
      })
    }, null, 1);
  }

  /* 캔버스 ImageData → 그리드 (셀 커버리지 임계값) */
  function gridFromImageData(data, w, h, cols, rows, threshold) {
    threshold = threshold || 0.12;
    var cw = w / cols, ch = h / rows, grid = [];
    for (var gy = 0; gy < rows; gy++) {
      var row = [];
      for (var gx = 0; gx < cols; gx++) {
        var ink = 0, tot = 0;
        for (var y = Math.floor(gy * ch); y < Math.min(h, (gy + 1) * ch); y++)
          for (var x = Math.floor(gx * cw); x < Math.min(w, (gx + 1) * cw); x++) {
            var idx = (y * w + x) * 4;
            var lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            var alpha = data[idx + 3] / 255;
            if (alpha > 0.5 && lum < 128) ink++;
            tot++;
          }
        row.push(ink / tot >= threshold ? 1 : 0);
      }
      grid.push(row);
    }
    return grid;
  }

  /* ── BRF: 점번호 셀 배열 → North American ASCII braille ── */
  var BRF_TABLE = ' A1B\'K2L@CIF/MSP"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=';
  function cellsToBrf(cells) {
    var out = '';
    for (var i = 0; i < cells.length; i++) {
      var v = 0;
      for (var d = 0; d < cells[i].length; d++) v |= 1 << (cells[i][d] - 1);
      out += BRF_TABLE[v & 63];
    }
    return out;
  }
  /* 텍스트 배열(각각 translate 완료된 cells) → BRF 문서 (40셀/행, 25행/페이지) */
  function makeBrf(cellLines) {
    var lines = [];
    cellLines.forEach(function (cells) {
      var s = cellsToBrf(cells);
      while (s.length > 40) {
        var cut = s.lastIndexOf(' ', 40); if (cut < 1) cut = 40;
        lines.push(s.slice(0, cut)); s = s.slice(cut).replace(/^ /, '');
      }
      lines.push(s);
    });
    return lines.join('\r\n') + '\r\n';
  }

  return {
    GRID_COLS: GRID_COLS, encodePage: encodePage, sliceViewports: sliceViewports,
    cropGrid: cropGrid, fitOrSlice: fitOrSlice,
    makeDtms: makeDtms, gridFromImageData: gridFromImageData,
    cellsToBrf: cellsToBrf, makeBrf: makeBrf
  };
});
