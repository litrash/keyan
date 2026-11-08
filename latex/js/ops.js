/* =========================================================
 * ops.js — 表格操作：行列增删、合并拆分、边框、转置、查找替换
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var M = LT.model;

  var ops = (LT.ops = {});

  function fix(doc) { M.normalize(doc); return doc; }

  /* 每个操作返回 { changed:bool, log:string[] } */
  function res(changed, log) { return { changed: !!changed, log: log || [] }; }

  /* ---------------- 行列 ---------------- */
  ops.insertRow = function (doc, sel, where) {
    var b = sel.bbox();
    var R = where === 'above' ? b.r1 : b.r2 + 1;
    var nC = M.nCols(doc);
    /* 被插入位置跨越的纵向合并需要扩展 */
    for (var r = 0; r < M.nRows(doc); r++) {
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        if (cell.rs > 1 && r < R && r + cell.rs > R) cell.rs += 1;
      }
    }
    var row = [];
    for (var i = 0; i < nC; i++) row.push(M.newCell());
    doc.cells.splice(R, 0, row);
    doc.hlines.splice(R, 0, []);
    fix(doc);
    sel.reset(R, b.c1);
    return res(true);
  };

  ops.insertCol = function (doc, sel, where) {
    var b = sel.bbox();
    var nR = M.nRows(doc);
    var C = where === 'before' ? b.c1 : b.c2 + 1;
    for (var r = 0; r < nR; r++) {
      for (var c = 0; c < M.nCols(doc); c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        if (cell.cs > 1 && c < C && c + cell.cs > C) cell.cs += 1;
      }
    }
    for (var r2 = 0; r2 < nR; r2++) doc.cells[r2].splice(C, 0, M.newCell());
    doc.vlines.splice(C, 0, null);
    doc.colAlign.splice(C, 0, 'c');
    /* 列边界上的横线段：新列也继承（避免出现断口），保持简单：不动 */
    fix(doc);
    sel.reset(b.r1, C);
    return res(true);
  };

  ops.deleteRow = function (doc, sel) {
    var b = sel.bbox();
    var nC = M.nCols(doc);
    if (M.nRows(doc) - (b.r2 - b.r1 + 1) < 1) return res(false, ['至少要保留一行']);
    var log = [];
    for (var r = b.r2; r >= b.r1; r--) {
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        if (cell.rs > 1) {
          if (cell.rs - 1 >= 1) {
            var next = doc.cells[r + 1] && doc.cells[r + 1][c];
            if (cell.rs > 1 && next) {
              /* 内容下沉到下一行，跨度减一 */
              var moved = M.newCell();
              for (var f in cell) if (f !== 'cov' && f !== 'org') moved[f] = cell[f];
              moved.rs = cell.rs - 1;
              doc.cells[r + 1][c] = moved;
            }
          }
        }
      }
      doc.cells.splice(r, 1);
      doc.hlines.splice(r, 1);
    }
    if (!doc.cells.length) doc.cells.push([M.newCell()]);
    fix(doc);
    var nr = Math.max(0, Math.min(b.r1, M.nRows(doc) - 1));
    sel.reset(nr, Math.min(b.c1, M.nCols(doc) - 1));
    return res(true, log);
  };

  ops.deleteCol = function (doc, sel) {
    var b = sel.bbox();
    var nR = M.nRows(doc);
    if (M.nCols(doc) - (b.c2 - b.c1 + 1) < 1) return res(false, ['至少要保留一列']);
    for (var c = b.c2; c >= b.c1; c--) {
      for (var r = 0; r < nR; r++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        if (cell.cs > 1) {
          var next = doc.cells[r][c + 1];
          if (next) {
            var moved = M.newCell();
            for (var f in cell) if (f !== 'cov' && f !== 'org') moved[f] = cell[f];
            moved.cs = cell.cs - 1;
            doc.cells[r][c + 1] = moved;
          }
        }
      }
      for (var r2 = 0; r2 < doc.cells.length; r2++) doc.cells[r2].splice(c, 1);
      doc.vlines.splice(c, 1);
      doc.colAlign.splice(c, 1);
    }
    if (!doc.cells[0].length) { for (var r3 = 0; r3 < doc.cells.length; r3++) doc.cells[r3].push(M.newCell()); }
    fix(doc);
    var nc = Math.max(0, Math.min(b.c1, M.nCols(doc) - 1));
    sel.reset(Math.min(b.r1, M.nRows(doc) - 1), nc);
    return res(true);
  };

  /* ---------------- 合并 / 拆分 ---------------- */
  function expandBBox(doc, b) {
    /* 把与 bbox 相交的既有合并单元格完整纳入 */
    for (var pass = 0; pass < 4; pass++) {
      var changed = false;
      for (var r = b.r1; r <= b.r2; r++) {
        for (var c = b.c1; c <= b.c2; c++) {
          var cell = doc.cells[r] && doc.cells[r][c];
          if (!cell) continue;
          var or = cell.cov ? cell.org : cell;
          if (!or) continue;
          var r0 = or.r !== undefined ? or.r : r;
          var c0 = or.c !== undefined ? or.c : c;
          if (cell.cov && cell.org) { r0 = cell.org.r; c0 = cell.org.c; }
          var src = doc.cells[r0][c0];
          var rEnd = r0 + src.rs - 1, cEnd = c0 + src.cs - 1;
          if (r0 < b.r1) { b.r1 = r0; changed = true; }
          if (c0 < b.c1) { b.c1 = c0; changed = true; }
          if (rEnd > b.r2) { b.r2 = rEnd; changed = true; }
          if (cEnd > b.c2) { b.c2 = cEnd; changed = true; }
        }
      }
      if (!changed) break;
    }
    return b;
  }

  function firstText(doc, b) {
    var texts = [];
    for (var r = b.r1; r <= b.r2; r++) {
      for (var c = b.c1; c <= b.c2; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        if (M.trim(cell.t)) texts.push(cell.t);
      }
    }
    return { keep: texts.length ? texts[0] : '', dropped: Math.max(0, texts.length - 1) };
  }

  ops.merge = function (doc, sel, mode) {
    var log = [];
    var b = expandBBox(doc, sel.bbox());
    var txt = firstText(doc, b);
    if (txt.dropped) log.push('合并时保留了第一个单元格的内容，丢弃了 ' + txt.dropped + ' 个单元格的文本（可撤销）');

    if (mode === 'h') {
      /* 按行合并 */
      for (var r = b.r1; r <= b.r2; r++) {
        var origin = doc.cells[r][b.c1];
        if (origin.cov && origin.org) origin = doc.cells[origin.org.r][origin.org.c];
        var t = M.trim(origin.t) ? origin.t : txt.keep;
        var base = M.newCell();
        for (var f in origin) if (f !== 'cov' && f !== 'org') base[f] = origin[f];
        base.t = t;
        base.cs = b.c2 - b.c1 + 1;
        base.rs = origin.rs || 1;
        doc.cells[r][b.c1] = base;
        for (var c = b.c1 + 1; c <= b.c2; c++) {
          var cov = M.newCell(); cov.cov = true; cov.org = { r: r, c: b.c1 };
          doc.cells[r][c] = cov;
        }
      }
    } else if (mode === 'v') {
      for (var c2 = b.c1; c2 <= b.c2; c2++) {
        var o2 = doc.cells[b.r1][c2];
        if (o2.cov && o2.org) o2 = doc.cells[o2.org.r][o2.org.c];
        var t2 = M.trim(o2.t) ? o2.t : txt.keep;
        var base2 = M.newCell();
        for (var f2 in o2) if (f2 !== 'cov' && f2 !== 'org') base2[f2] = o2[f2];
        base2.t = t2;
        base2.rs = b.r2 - b.r1 + 1;
        base2.cs = o2.cs || 1;
        doc.cells[b.r1][c2] = base2;
        for (var r2 = b.r1 + 1; r2 <= b.r2; r2++) {
          var cov2 = M.newCell(); cov2.cov = true; cov2.org = { r: b.r1, c: c2 };
          doc.cells[r2][c2] = cov2;
        }
      }
    } else {
      var o3 = doc.cells[b.r1][b.c1];
      if (o3.cov && o3.org) o3 = doc.cells[o3.org.r][o3.org.c];
      var base3 = M.newCell();
      for (var f3 in o3) if (f3 !== 'cov' && f3 !== 'org') base3[f3] = o3[f3];
      base3.t = M.trim(o3.t) ? o3.t : txt.keep;
      base3.rs = b.r2 - b.r1 + 1;
      base3.cs = b.c2 - b.c1 + 1;
      doc.cells[b.r1][b.c1] = base3;
      for (var rr = b.r1; rr <= b.r2; rr++) {
        for (var cc = b.c1; cc <= b.c2; cc++) {
          if (rr === b.r1 && cc === b.c1) continue;
          var cv = M.newCell(); cv.cov = true; cv.org = { r: b.r1, c: b.c1 };
          doc.cells[rr][cc] = cv;
        }
      }
    }
    fix(doc);
    sel.ranges = [{ r1: b.r1, c1: b.c1, r2: b.r2, c2: b.c2 }];
    sel.anchor = { r: b.r1, c: b.c1 };
    sel.head = { r: b.r2, c: b.c2 };
    return res(true, log);
  };

  ops.split = function (doc, sel) {
    var list = sel.origins(doc);
    var n = 0;
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      if (cell.rs > 1 || cell.cs > 1) { cell.rs = 1; cell.cs = 1; n++; }
    });
    fix(doc);
    return res(n > 0, n ? [] : ['选区内没有合并单元格']);
  };

  /* ---------------- 内容 ---------------- */
  ops.clearContent = function (doc, sel) {
    var log = [];
    var list = sel.origins(doc);
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      cell.t = '';
      cell.b = cell.i = cell.u = cell.s = cell.sup = cell.sub = false;
      cell.bg = null; cell.fg = null;
    });
    if (!list.length) log.push('没有选中任何单元格');
    return res(list.length > 0, log);
  };

  ops.clearAll = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    doc.cells = [];
    for (var r = 0; r < nR; r++) {
      var row = [];
      for (var c = 0; c < nC; c++) row.push(M.newCell());
      doc.cells.push(row);
    }
    doc.hlines = Array.from({ length: nR + 1 }, function () { return []; });
    doc.vlines = new Array(nC + 1).fill(null);
    fix(doc);
    return res(true);
  };

  /* ---------------- 格式 ---------------- */
  ops.setProp = function (doc, sel, key, value) {
    var list = sel.origins(doc);
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      cell[key] = typeof value === 'function' ? value(cell[key]) : value;
    });
    return res(list.length > 0);
  };

  ops.toggleFmt = function (doc, sel, key) {
    var list = sel.origins(doc);
    var all = list.length > 0;
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      if (!cell[key]) all = false;
    });
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      cell[key] = !all;
      if (key === 'sup' && !all) cell.sub = false;
      if (key === 'sub' && !all) cell.sup = false;
    });
    return res(list.length > 0);
  };

  ops.setColAlign = function (doc, sel, v) {
    var b = sel.bbox();
    for (var c = b.c1; c <= b.c2; c++) doc.colAlign[c] = v;
    return res(true);
  };

  ops.clearFmt = function (doc, sel) {
    var list = sel.origins(doc);
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      cell.b = cell.i = cell.u = cell.s = cell.sup = cell.sub = false;
      cell.align = ''; cell.valign = '';
      cell.bg = null; cell.fg = null;
    });
    return res(list.length > 0);
  };

  /* ---------------- 边框 ---------------- */
  ops.setBorder = function (doc, sel, side, styleId) {
    var list = sel.origins(doc);
    if (!list.length) return res(false, ['没有选中单元格']);
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      var boundary = side === 'top' ? p.r : p.r + cell.rs;
      M.addSeg(doc, boundary, styleId, p.c, p.c + cell.cs - 1);
    });
    fix(doc);
    return res(true);
  };

  ops.clearBorder = function (doc, sel, side) {
    var list = sel.origins(doc);
    if (!list.length) return res(false, ['没有选中单元格']);
    list.forEach(function (p) {
      var cell = doc.cells[p.r][p.c];
      var boundary = side === 'top' ? p.r : p.r + cell.rs;
      M.removeSeg(doc, boundary, p.c, p.c + cell.cs - 1);
    });
    return res(true);
  };

  ops.setBoundary = function (doc, boundary, styleId, from, to) {
    var nC = M.nCols(doc);
    from = from === undefined ? 0 : from;
    to = to === undefined ? nC - 1 : to;
    if (!styleId) M.removeSeg(doc, boundary, from, to);
    else M.addSeg(doc, boundary, styleId, from, to);
    fix(doc);
    return res(true);
  };

  ops.allBorders = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    for (var i = 0; i <= nR; i++) doc.hlines[i] = [{ s: 'hline', from: 0, to: nC - 1 }];
    for (var j = 0; j <= nC; j++) doc.vlines[j] = 'single';
    return res(true);
  };

  ops.noBorders = function (doc) {
    for (var i = 0; i < doc.hlines.length; i++) doc.hlines[i] = [];
    for (var j = 0; j < doc.vlines.length; j++) doc.vlines[j] = null;
    return res(true);
  };

  /* 三线表：顶线 / 首行下中线 / 底线 */
  ops.booktabs = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    for (var i = 0; i < doc.hlines.length; i++) doc.hlines[i] = [];
    doc.hlines[0] = [{ s: 'toprule', from: 0, to: nC - 1 }];
    if (nR > 1) doc.hlines[1] = [{ s: 'midrule', from: 0, to: nC - 1 }];
    doc.hlines[nR] = [{ s: 'bottomrule', from: 0, to: nC - 1 }];
    return res(true, ['已应用三线表（booktabs）：\\toprule / \\midrule / \\bottomrule']);
  };

  ops.toggleVlines = function (doc, sel) {
    var b = sel.bbox();
    var L = b.c1, R = b.c2 + 1;
    var on = !!(doc.vlines[L] || doc.vlines[R]);
    doc.vlines[L] = on ? null : 'single';
    doc.vlines[R] = on ? null : 'single';
    return res(true);
  };

  ops.setVline = function (doc, j, kind) {
    doc.vlines[j] = kind || null;
    return res(true);
  };

  /* ---------------- 转置 ---------------- */
  ops.transpose = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var out = [];
    for (var c = 0; c < nC; c++) {
      var row = [];
      for (var r = 0; r < nR; r++) row.push(M.newCell());
      out.push(row);
    }
    for (var r2 = 0; r2 < nR; r2++) {
      for (var c2 = 0; c2 < nC; c2++) {
        var cell = doc.cells[r2][c2];
        if (!cell || cell.cov) continue;
        var nc = M.newCell();
        for (var f in cell) if (f !== 'cov' && f !== 'org') nc[f] = cell[f];
        nc.rs = cell.cs; nc.cs = cell.rs;
        out[c2][r2] = nc;
      }
    }
    doc.cells = out;
    /* 边界互换（部分线段退化为整段） */
    var oldH = doc.hlines, oldV = doc.vlines;
    var newH = [], newV = [];
    for (var i = 0; i <= nC; i++) newH.push(oldV[i] ? [{ s: 'hline', from: 0, to: nR - 1 }] : []);
    for (var j = 0; j <= nR; j++) newV.push((oldH[j] && oldH[j].length) ? 'single' : null);
    doc.hlines = newH;
    doc.vlines = newV;
    var oldAlign = doc.colAlign, newAlign = [];
    for (var k = 0; k < nR; k++) newAlign.push('c');
    doc.colAlign = newAlign;
    fix(doc);
    return res(true, ['已转置；竖线/横线的局部区间无法完全保留，已按整段转换']);
  };

  /* ---------------- 查找替换 ---------------- */
  ops.findReplace = function (doc, sel, find, replace, scope, useRegex) {
    if (!find) return res(false, ['请输入要查找的内容']);
    var count = 0;
    var re = null;
    if (useRegex) { try { re = new RegExp(find, 'g'); } catch (e) { return res(false, ['正则表达式无效：' + e.message]); } }
    var selected = {};
    if (scope !== 'all') {
      sel.origins(doc).forEach(function (p) { selected[p.r + ':' + p.c] = 1; });
    }
    var nR = M.nRows(doc), nC = M.nCols(doc);
    for (var r = 0; r < nR; r++) {
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        var isSel = !!selected[r + ':' + c];
        if (scope === 'sel' && !isSel) continue;
        if (scope === 'unsel' && isSel) continue;
        var before = cell.t;
        if (re) cell.t = cell.t.replace(re, replace);
        else {
          var parts = cell.t.split(find);
          if (parts.length > 1) cell.t = parts.join(replace);
        }
        if (cell.t !== before) count++;
      }
    }
    fix(doc);
    return res(count > 0, [count ? '替换了 ' + count + ' 个单元格' : '未找到匹配内容']);
  };

  /* ---------------- 数据导入辅助 ---------------- */
  ops.fromMatrix = function (matrix, opts) {
    var rows = matrix.length || 1;
    var cols = 0;
    matrix.forEach(function (r) { cols = Math.max(cols, r.length); });
    cols = cols || 1;
    var doc = M.create(rows, cols);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = matrix[r][c];
        doc.cells[r][c].t = v == null ? '' : String(v);
      }
    }
    if (opts && opts.header && rows > 1) {
      for (var c2 = 0; c2 < cols; c2++) doc.cells[0][c2].b = true;
      doc.hlines[1] = [{ s: 'hline', from: 0, to: cols - 1 }];
    }
    fix(doc);
    return doc;
  };

  LT.fixDoc = fix;
})();
