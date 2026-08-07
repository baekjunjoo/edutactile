/* parser.js — PDF/Word → 점자 규정집 구조 파서
 * PDF: pdf.js 텍스트 아이템의 (x,y) 좌표 사용 — RTL에서 x 내림차순 = 판독 순서.
 *      점 번호 그룹도 x 내림차순으로 모으면 논리 순서가 바로 나온다 (역순 휴리스틱 불필요).
 * Word: 문단 텍스트 기반 (좌표 없음) — 설계 문서의 정규식 + 인접 역순 휴리스틱.
 * 출력: { generic:true, title, sections:[{title, items:[{num,name,print,dots,notes,examples}]}], front:[...] }
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RBPARSER = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  var HEADER_HINT = /النقاط|بريل|برايل|الرمز|العلامة|بالخط/;
  var SECTION_HINT = /جدول|رموز|علامات|الحروف|الأشكال|الأرقام|طريقة|ضوابط/;

  function norm(s) { return String(s).normalize('NFKC'); }

  /* ── PDF 페이지 텍스트 아이템 → 행 클러스터 ── */
  function clusterRows(items, tol) {
    tol = tol || 6;
    var rows = [];
    items.forEach(function (it) {
      if (!it.s.trim()) return;
      var row = rows.find(function (r) { return Math.abs(r.y - it.y) <= tol; });
      if (!row) { row = { y: it.y, cells: [] }; rows.push(row); }
      row.cells.push(it);
    });
    rows.forEach(function (r) {
      r.cells.sort(function (a, b) { return b.x - a.x; });   // x 내림차순 = RTL 판독 순서
      // 글리프 단위 PDF에서 단어 간격 복원: x 간격이 크면 공백 표시
      for (var i = 1; i < r.cells.length; i++) {
        var prev = r.cells[i - 1], cur = r.cells[i];
        var gap = prev.x - (cur.x + (cur.w || 0));
        cur._sp = gap > 2.5;
      }
    });
    rows.sort(function (a, b) { return b.y - a.y; });                                   // 위 → 아래
    return rows;
  }

  /* 행 → 구조 분해: 괄호쌍(x 구간)으로 점 그룹 추출, 나머지에서 번호/이름/활자 */
  function parseRow(row) {
    var cells = row.cells;
    var groups = [], cur = null, rest = [];
    cells.forEach(function (c) {
      var s = c.s.trim();
      if (s === ')') { cur = { digits: [], rx: c.x }; return; }   // RTL: ')'가 그룹의 오른쪽 끝
      if (s === '(') { if (cur) { cur.lx = c.x; if (cur.digits.length) groups.push(cur); cur = null; } return; }
      if (cur) {
        var m = s.match(/[1-6]/g);
        if (m) m.forEach(function (d) { cur.digits.push(d); });
        return;
      }
      rest.push(c);
    });
    if (cur && cur.digits.length) groups.push(cur);
    /* 그룹 순서 주의: RTL PDF에서 점 번호 열의 시각적 그룹 순서는 저자 입력 방식에 따라
     * 정순/역순이 섞인다 (아랍어 규정집 실측: 2장 역순, 3장 정순 — 간격으로 구별 불가).
     * 여기서는 x내림차순 그대로 두고, 문서 전체 단일 항목을 앵커로 섹션별 자기 보정한다. */
    // 괄호 없는 인라인 "(1، 2)" 형태 (한 아이템에 통째로 들어온 경우)
    if (!groups.length) {
      var joined = cells.map(function (c) { return c.s; }).join(' ');
      var mm = joined.match(/\(([0-9،,\-\s،]+)\)/g);
      if (mm) mm.forEach(function (g) {
        var ds = (g.match(/[1-6]/g) || []);
        if (ds.length) groups.push({ digits: ds });
      });
    }
    var serial = null, name = [], print = [];
    // 열 분리: 큰 x-간격(>12)으로 클러스터를 나눠 첫 클러스터(최우측)=이름, 나머지=활자/구성
    var clusters = [], prev = null;
    rest.forEach(function (c, idx) {
      var s = norm(c.s.trim());
      if (idx === 0 && /^\d{1,3}$/.test(s)) { serial = s; return; }
      var gap = prev ? (prev.x - (c.x + (c.w || 0))) : 0;
      if (!clusters.length || gap > 12) clusters.push([]);
      clusters[clusters.length - 1].push(c);
      prev = c;
    });
    clusters.forEach(function (cl, ci) {
      cl.forEach(function (c) {
        var s = norm(c.s.trim());
        if (!s) return;
        if (ci === 0 && AR.test(s)) name.push((c._sp ? ' ' : '') + s);
        else print.push((c._sp ? ' ' : '') + s);
      });
    });
    return {
      serial: serial,
      name: name.join('').replace(/\s+/g, ' ').trim(),
      print: print.join(' ').trim() || null,
      dots: groups.map(function (g) { return g.digits.join('-'); }).filter(Boolean),
      textOnly: !groups.length && !serial,
      rawText: cells.map(function (c) { return (c._sp ? ' ' : '') + norm(c.s); }).join('').trim()
    };
  }

  /* ── PDF 전체 → 문서 구조 ── */
  function parsePdfPages(pages) {   // pages: [{items:[{s,x,y}]}]
    var doc = { generic: true, title: '', sections: [], front: [] };
    var curSection = null, lastItem = null, pendingTitle = null;
    var report = { pages: pages.length, itemRows: 0, textRows: 0, skipped: 0 };

    pages.forEach(function (pg, pi) {
      var rows = clusterRows(pg.items);
      // 목차 페이지 통째로 제외
      var pageText = rows.map(function (r) { return r.cells.map(function (c) { return norm(c.s); }).join(''); }).join(' ');
      if (/محتويات/.test(pageText)) { report.skipped += rows.length; return; }
      rows.forEach(function (row) {
        var r = parseRow(row);
        if (!r.rawText) return;
        if (/^\d{1,3}$/.test(r.rawText)) { report.skipped++; return; }        // 페이지 번호
        if (/جدول/.test(r.rawText)) { pendingTitle = 'AWAIT'; report.skipped++; return; }  // "جدول رقم (N)" → 다음 행이 절 제목
        if (r.textOnly && pendingTitle === 'AWAIT' && r.rawText.length < 80) { pendingTitle = r.rawText; return; }
        // 절 제목 후보: 서수(أولاً 등)·챕터(الفصل)·짧은 콜론 종결 헤딩
        if (r.textOnly && r.rawText.length < 70 &&
            /^(أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|الفصل)|[:：]\s*$/.test(r.rawText)) {
          pendingTitle = r.rawText.replace(/[:：]\s*$/, ''); return;
        }
        if (r.textOnly && HEADER_HINT.test(r.rawText) && r.rawText.length < 60 && !r.dots.length) {
          report.skipped++; return;   // 표 머리행
        }
        if (pendingTitle && pendingTitle !== 'AWAIT') {
          curSection = { title: pendingTitle, items: [] };
          doc.sections.push(curSection); pendingTitle = null;
        }
        if (r.serial && r.dots.length) {                                       // 항목 행
          if (!curSection) { curSection = { title: '', items: [] }; doc.sections.push(curSection); }
          lastItem = { num: r.serial, name: r.name, print: r.print, dots: r.dots, notes: [], examples: [] };
          curSection.items.push(lastItem); report.itemRows++;
        } else if (r.dots.length && lastItem) {                                // 번호 없는 점 그룹 = 예시
          lastItem.examples.push({ print: r.name || r.print, dots: r.dots });
        } else if (r.textOnly) {
          report.textRows++;
          if (pi < 7 && !doc.sections.length) doc.front.push({ kind: 'para', text: r.rawText });
          else if (lastItem && r.rawText.length > 3) lastItem.notes.push(r.rawText);
        }
      });
    });
    doc.sections = doc.sections.filter(function (s) { return s.items.length; });

    /* ── 그룹 순서 자기 보정 (정답 데이터로 검증된 규칙) ──
     * 축약어류 항목은 "단어 첫 글자 셀 + 수식 셀" 구조이고, 논리 순서에서
     * 첫 글자 셀이 마지막에 오는 경우는 없다 (아랍어 규정집 185/185 확인).
     * → 문서 자체의 자모 표(이름이 1글자인 항목)에서 첫 글자 점형을 얻고,
     *   그것이 마지막 그룹이면 해당 항목의 그룹 순서를 뒤집는다. */
    var letterDots = {};
    doc.sections.forEach(function (s) {
      s.items.forEach(function (it) {
        if (it.dots.length === 1 && it.name && it.name.trim().length === 1)
          letterDots[it.name.trim()] = it.dots[0];
      });
    });
    report.flippedItems = 0;
    doc.sections.forEach(function (s) {
      s.items.forEach(function (it) {
        if (it.dots.length < 2 || !it.name) return;
        var L = letterDots[it.name.trim()[0]];
        if (!L) return;
        if (it.dots[it.dots.length - 1] === L && it.dots[0] !== L) {
          it.dots.reverse(); report.flippedItems++;
          (it.examples || []).forEach(function (e) { if (e.dots.length > 1) e.dots.reverse(); });
        }
      });
    });

    report.items = doc.sections.reduce(function (a, s) { return a + s.items.length; }, 0);
    report.sections = doc.sections.length;
    doc._report = report;
    return doc;
  }

  /* ── Word(.docx) → 문단 텍스트 → 구조 (좌표 없음: 설계 문서 휴리스틱) ── */
  function parseDocxParagraphs(paras, isRtl) {
    var DOT_GROUP = /\(([0-9][0-9،,\-\s،]*)\)/g;
    var doc = { generic: true, title: '', sections: [], front: [] };
    var curSection = null, lastItem = null;
    paras.forEach(function (p) {
      var text = norm(p).trim();
      if (!text) return;
      var groups = [], m;
      DOT_GROUP.lastIndex = 0;
      while ((m = DOT_GROUP.exec(text))) {
        var ds = m[1].match(/[1-6]/g);
        if (ds) groups.push(ds.join('-'));
      }
      if (groups.length && isRtl && /\)\s*\(/.test(text.replace(/[0-9،،,\-\s]+/g, ''))) groups.reverse(); // 인접 그룹 역순
      var serial = text.match(/^(\d{1,3})[.)\s]/);
      var namePart = text.replace(DOT_GROUP, '').replace(/^(\d{1,3})[.)\s]+/, '').trim();
      if (groups.length) {
        if (!curSection) { curSection = { title: '', items: [] }; doc.sections.push(curSection); }
        lastItem = { num: serial ? serial[1] : String(curSection.items.length + 1), name: namePart, print: null, dots: groups, notes: [], examples: [] };
        curSection.items.push(lastItem);
      } else if (SECTION_HINT.test(text) && text.length < 70) {
        curSection = { title: text, items: [] }; doc.sections.push(curSection); lastItem = null;
      } else if (lastItem) lastItem.notes.push(text);
      else doc.front.push({ kind: 'para', text: text });
    });
    doc.sections = doc.sections.filter(function (s) { return s.items.length; });
    return doc;
  }

  return { clusterRows: clusterRows, parseRow: parseRow, parsePdfPages: parsePdfPages, parseDocxParagraphs: parseDocxParagraphs };
});
