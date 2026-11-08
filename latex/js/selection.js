/* =========================================================
 * selection.js — 选区模型（矩形选区集合）
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var U = LT.util;

  function Selection() {
    this.ranges = [{ r1: 0, c1: 0, r2: 0, c2: 0 }];
    this.anchor = { r: 0, c: 0 };
    this.head = { r: 0, c: 0 };
  }

  Selection.prototype.reset = function (r, c) {
    this.ranges = [{ r1: r, c1: c, r2: r, c2: c }];
    this.anchor = { r: r, c: c };
    this.head = { r: r, c: c };
  };

  Selection.prototype.primary = function () { return this.ranges[0]; };

  Selection.prototype.isEmpty = function () {
    return !this.ranges.length;
  };

  /* 单选 / 追加 / 连续 */
  Selection.prototype.select = function (r, c, mode) {
    if (mode === 'add') {
      var found = -1;
      for (var i = 0; i < this.ranges.length; i++) {
        var g = this.ranges[i];
        if (g.r1 === r && g.c1 === c && g.r2 === r && g.c2 === c) found = i;
      }
      if (found >= 0) this.ranges.splice(found, 1);
      else this.ranges.push({ r1: r, c1: c, r2: r, c2: c });
      this.anchor = { r: r, c: c };
      this.head = { r: r, c: c };
      if (!this.ranges.length) this.ranges = [{ r1: r, c1: c, r2: r, c2: c }];
      return;
    }
    if (mode === 'range') {
      var last = this.ranges[this.ranges.length - 1];
      var a = this.anchor || { r: last ? last.r1 : r, c: last ? last.c1 : c };
      this.ranges[this.ranges.length - 1] = {
        r1: Math.min(a.r, r), c1: Math.min(a.c, c),
        r2: Math.max(a.r, r), c2: Math.max(a.c, c)
      };
      this.head = { r: r, c: c };
      return;
    }
    this.reset(r, c);
  };

  /* 拖动选区：从当前锚点扩展到 (r,c) */
  Selection.prototype.dragTo = function (r, c) {
    var a = this.anchor;
    this.ranges = [{ r1: Math.min(a.r, r), c1: Math.min(a.c, c), r2: Math.max(a.r, r), c2: Math.max(a.c, c) }];
    this.head = { r: r, c: c };
  };

  Selection.prototype.contains = function (r, c) {
    for (var i = 0; i < this.ranges.length; i++) {
      var g = this.ranges[i];
      if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) return true;
    }
    return false;
  };

  Selection.prototype.isAnchor = function (r, c) {
    if (!this.anchor) return false;
    return this.anchor.r === r && this.anchor.c === c;
  };

  /* 选区包围盒 */
  Selection.prototype.bbox = function () {
    var b = { r1: Infinity, c1: Infinity, r2: -Infinity, c2: -Infinity };
    this.ranges.forEach(function (g) {
      b.r1 = Math.min(b.r1, g.r1); b.c1 = Math.min(b.c1, g.c1);
      b.r2 = Math.max(b.r2, g.r2); b.c2 = Math.max(b.c2, g.c2);
    });
    if (!this.ranges.length) return { r1: 0, c1: 0, r2: 0, c2: 0 };
    return b;
  };

  /* 选区内 origin 单元格坐标列表（去重、忽略被覆盖单元格） */
  Selection.prototype.origins = function (doc) {
    var out = [], seen = {};
    var nR = LT.model.nRows(doc), nC = LT.model.nCols(doc);
    for (var i = 0; i < this.ranges.length; i++) {
      var g = this.ranges[i];
      for (var r = Math.max(0, g.r1); r <= Math.min(nR - 1, g.r2); r++) {
        for (var c = Math.max(0, g.c1); c <= Math.min(nC - 1, g.c2); c++) {
          var cell = doc.cells[r] && doc.cells[r][c];
          if (!cell) continue;
          if (cell.cov && cell.org) {
            var key0 = cell.org.r + ':' + cell.org.c;
            if (!seen[key0]) { seen[key0] = 1; out.push({ r: cell.org.r, c: cell.org.c }); }
            continue;
          }
          var key = r + ':' + c;
          if (!seen[key]) { seen[key] = 1; out.push({ r: r, c: c }); }
        }
      }
    }
    return out;
  };

  /* 选区覆盖的单元格数量（含被覆盖的物理位置） */
  Selection.prototype.count = function () {
    var n = 0;
    for (var i = 0; i < this.ranges.length; i++) {
      var g = this.ranges[i];
      n += (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
    }
    return n;
  };

  Selection.prototype.snapshot = function () {
    return { ranges: U.clone(this.ranges), anchor: U.clone(this.anchor), head: U.clone(this.head) };
  };

  Selection.prototype.restore = function (snap) {
    if (!snap) return;
    this.ranges = U.clone(snap.ranges);
    this.anchor = U.clone(snap.anchor);
    this.head = U.clone(snap.head);
  };

  LT.Selection = Selection;
})();
