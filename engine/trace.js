/* trace.js — 트랙 B: 이미지 → 촉각 윤곽선 자동 추출
 * 파이프라인: 그레이스케일 → Otsu 임계값 → 마칭 스퀘어 윤곽 추출
 *            → Douglas-Peucker 단순화 → (선택) Chaikin 스무딩 → 크기순 선 계층 부여
 * dotpad-tactile-convert의 "feel over fidelity" 원칙: 작은 조각 제거, 1-외곽선 + 내부 디테일.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TRACE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Otsu 임계값 (0..255 그레이 히스토그램) */
  function otsu(gray) {
    var hist = new Array(256).fill(0), i;
    for (i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, bestT = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; bestT = i; }
    }
    return bestT;
  }

  /* RGBA ImageData → 이진 마스크 (1 = 잉크). invert 옵션 */
  function toMask(data, w, h, threshold, invert) {
    var gray = new Uint8Array(w * h), i;
    for (i = 0; i < w * h; i++) {
      var a = data[i * 4 + 3] / 255;
      var lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      gray[i] = Math.round(lum * a + 255 * (1 - a)); // 투명 = 흰 배경
    }
    var t = (threshold == null || threshold < 0) ? otsu(gray) : threshold;
    var mask = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) mask[i] = (invert ? gray[i] > t : gray[i] <= t) ? 1 : 0;
    return { mask: mask, threshold: t };
  }

  /* 마칭 스퀘어: 이진 마스크 → 닫힌 윤곽 폴리곤들 (외곽선·구멍 모두) */
  function marchingSquares(mask, w, h) {
    function at(x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mask[y * w + x]; }
    // 셀 (x,y): 코너 = at(x,y), at(x+1,y), at(x+1,y+1), at(x,y+1)
    // 세그먼트는 셀 변의 중점을 잇는다. 방문한 (셀,변) 에지 기록으로 루프 추적.
    var segs = {}; // key: cx,cy → 세그먼트 목록
    var EDGE_PT = {
      t: function (x, y) { return [x + 0.5, y]; },
      r: function (x, y) { return [x + 1, y + 0.5]; },
      b: function (x, y) { return [x + 0.5, y + 1]; },
      l: function (x, y) { return [x, y + 0.5]; }
    };
    // case(4비트: tl=8, tr=4, br=2, bl=1) → [진입변→탈출변]. 잉크가 진행 방향 오른쪽(cross<0)에 오도록 유도.
    var CASES = {
      1: [['b', 'l']], 2: [['r', 'b']], 3: [['r', 'l']], 4: [['t', 'r']],
      5: [['t', 'r'], ['b', 'l']], 6: [['t', 'b']], 7: [['t', 'l']],
      8: [['l', 't']], 9: [['b', 't']], 10: [['l', 't'], ['r', 'b']],
      11: [['r', 't']], 12: [['l', 'r']], 13: [['b', 'r']], 14: [['l', 'b']]
    };
    var SADDLE_INK = { 5: [['t', 'l'], ['b', 'r']], 10: [['r', 't'], ['l', 'b']] };
    var x, y;
    for (y = -1; y <= h; y++) for (x = -1; x <= w; x++) {
      var c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      if (c === 0 || c === 15) continue;
      var list = CASES[c];
      if (SADDLE_INK[c]) { // 안장점: 이웃 평균으로 중심 추정해 연결 방향 해소
        var cen = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4;
        if (cen >= 0.5) list = SADDLE_INK[c];
      }
      segs[x + ',' + y] = list.map(function (s) { return { from: s[0], to: s[1], used: false }; });
    }
    // 루프 추적
    var NEXT = { t: [0, -1, 'b'], r: [1, 0, 'l'], b: [0, 1, 't'], l: [-1, 0, 'r'] };
    var contours = [];
    Object.keys(segs).forEach(function (key) {
      segs[key].forEach(function (seed) {
        if (seed.used) return;
        var cxy = key.split(',').map(Number), cx = cxy[0], cy = cxy[1];
        var seg = seed, pts = [];
        while (seg && !seg.used) {
          seg.used = true;
          pts.push(EDGE_PT[seg.to](cx, cy));
          var mv = NEXT[seg.to];
          cx += mv[0]; cy += mv[1];
          var enter = mv[2], cell = segs[cx + ',' + cy];
          seg = null;
          if (cell) for (var i = 0; i < cell.length; i++)
            if (!cell[i].used && cell[i].from === enter) { seg = cell[i]; break; }
        }
        if (pts.length > 3) contours.push(pts);
      });
    });
    return contours;
  }

  /* Douglas-Peucker 단순화 */
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    function dp(arr, i0, i1, keep) {
      var maxD = 0, idx = -1;
      var ax = arr[i0][0], ay = arr[i0][1], bx = arr[i1][0], by = arr[i1][1];
      var dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      for (var i = i0 + 1; i < i1; i++) {
        var d = Math.abs((arr[i][0] - ax) * dy - (arr[i][1] - ay) * dx) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps) { dp(arr, i0, idx, keep); keep[idx] = true; dp(arr, idx, i1, keep); }
    }
    var keep = {}; keep[0] = true; keep[pts.length - 1] = true;
    dp(pts, 0, pts.length - 1, keep);
    return pts.filter(function (_, i) { return keep[i]; });
  }

  /* Chaikin 스무딩 1회 (유기적 곡선 느낌) */
  function chaikin(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    return out;
  }

  function polyArea(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s / 2);
  }

  /* 메인: ImageData → 스펙 요소 배열 + 리포트 */
  function traceToElements(data, w, h, opts) {
    opts = opts || {};
    var mk = toMask(data, w, h, opts.threshold, opts.invert);
    var contours = marchingSquares(mk.mask, w, h);
    var report = ['임계값 ' + mk.threshold + ' (Otsu 자동)'];
    // px → 단순화 epsilon: 도면 폭 대비 (기본 0.6%)
    var eps = (opts.simplify == null ? 0.006 : opts.simplify) * Math.max(w, h);
    var minArea = (opts.minArea == null ? 0.0004 : opts.minArea) * w * h;
    var polys = contours
      .map(function (c) { return { pts: simplify(c, eps), area: polyArea(c) }; })
      .filter(function (c) { return c.area >= minArea && c.pts.length >= 3; })
      .sort(function (a, b) { return b.area - a.area; });
    var dropped = contours.length - polys.length;
    if (dropped > 0) report.push('촉각으로 구분 불가능한 작은 조각 ' + dropped + '개를 제거했어요.');
    var els = polys.map(function (c, i) {
      var pts = opts.smooth ? chaikin(c.pts) : c.pts;
      // y-up 변환 (이미지 y-down → world y-up)
      var wpts = pts.map(function (p) { return [p[0], h - p[1]]; });
      return {
        type: 'polyline', points: wpts, closed: true,
        style: i === 0 ? 'outline' : (c.area > polys[0].area * 0.05 ? 'major' : 'minor')
      };
    });
    if (els.length) report.push('윤곽 ' + els.length + '개: 가장 큰 것 = 외곽선(굵게), 나머지는 크기순 major/minor.');
    return { elements: els, report: report, threshold: mk.threshold };
  }

  return { traceToElements: traceToElements, otsu: otsu, toMask: toMask, marchingSquares: marchingSquares, simplify: simplify };
});
