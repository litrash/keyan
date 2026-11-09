/* =========================================================
 * core.js — 工具函数、数据模型、规范化、历史记录
 * 无任何外部依赖，可直接 file:// 打开
 * ======================================================= */
(function () {
  'use strict';

  var LT = (window.LT = window.LT || {});

  /* ---------------- 工具 ---------------- */
  var util = (LT.util = {
    clone: function (o) { return JSON.parse(JSON.stringify(o)); },

    el: function (tag, attrs, kids) {
      var e = document.createElement(tag);
      if (attrs) {
        for (var k in attrs) {
          if (k === 'class') e.className = attrs[k];
          else if (k === 'text') e.textContent = attrs[k];
          else if (k === 'html') e.innerHTML = attrs[k];
          else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
          else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
        }
      }
      if (kids) {
        (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
          if (c === null || c === undefined) return;
          e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      }
      return e;
    },

    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },

    escapeHtml: function (s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    hex2rgb: function (h) {
      h = String(h || '').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      if (isNaN(n)) return { r: 0, g: 0, b: 0 };
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },

    rgb2hex: function (r, g, b) {
      var f = function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return ('0' + v.toString(16)).slice(-2); };
      return '#' + f(r) + f(g) + f(b);
    },

    debounce: function (fn, ms) {
      var t = null;
      return function () {
        var a = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, a); }, ms);
      };
    },

    download: function (name, text, mime) {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    },

    readFile: function (file, mode) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onerror = function () { reject(fr.error); };
        fr.onload = function () { resolve(fr.result); };
        if (mode === 'buffer') fr.readAsArrayBuffer(file);
        else fr.readAsText(file, 'utf-8');
      });
    },

    copy: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return util.copyFallback(text); });
      }
      return Promise.resolve(util.copyFallback(text));
    },

    copyFallback: function (text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    },

    colLetter: function (n) {
      var s = '';
      n = n + 1;
      while (n > 0) {
        var m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    },

    /* 去掉首尾空白但保留内部内容 */
    trim: function (s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  });

  /* ---------------- 数据模型 ---------------- */
  var M = (LT.model = {});

  /* 便捷别名（多处模块使用 M.trim） */
  M.trim = util.trim;

  /* 横线线型定义：id 用于存储，label 用于界面，cmd 用于生成 */
  M.RULE_STYLES = [
    { id: 'hline', label: '\\hline 单线', css: 'hline', full: '\\hline', part: function (a, b) { return '\\cline{' + a + '-' + b + '}'; } },
    { id: 'hline2', label: '\\hline\\hline 双线', css: 'hline2', full: '\\hline\\hline', part: function (a, b) { return '\\cline{' + a + '-' + b + '}\\cline{' + a + '-' + b + '}'; } },
    { id: 'toprule', label: '\\toprule 顶线（booktabs）', css: 'toprule', pkg: 'booktabs', full: '\\toprule', part: function (a, b) { return '\\cmidrule(lr){' + a + '-' + b + '}'; } },
    { id: 'midrule', label: '\\midrule 中线（booktabs）', css: 'midrule', pkg: 'booktabs', full: '\\midrule', part: function (a, b) { return '\\cmidrule(lr){' + a + '-' + b + '}'; } },
    { id: 'bottomrule', label: '\\bottomrule 底线（booktabs）', css: 'bottomrule', pkg: 'booktabs', full: '\\bottomrule', part: function (a, b) { return '\\cmidrule(lr){' + a + '-' + b + '}'; } },
    { id: 'thick', label: '\\specialrule 粗线（booktabs）', css: 'thick', pkg: 'booktabs', full: '\\specialrule{1pt}{0pt}{0pt}', part: function (a, b) { return '\\cmidrule(lr){' + a + '-' + b + '}'; } },
    { id: 'hdashline', label: '\\hdashline 虚线（arydshln）', css: 'hdashline', pkg: 'arydshln', full: '\\hdashline', part: function (a, b) { return '\\cdashline{' + a + '-' + b + '}'; } },
    { id: 'dotted', label: '\\hdashline[1pt/1pt] 点线（arydshln）', css: 'dotted', pkg: 'arydshln', full: '\\hdashline[1pt/1pt]', part: function (a, b) { return '\\cdashline{' + a + '-' + b + '}[1pt/1pt]'; } }
  ];
  M.ruleById = function (id) {
    for (var i = 0; i < M.RULE_STYLES.length; i++) if (M.RULE_STYLES[i].id === id) return M.RULE_STYLES[i];
    return M.RULE_STYLES[0];
  };

  M.newCell = function () {
    return {
      t: '',            // 文本（LaTeX 语法片段）
      rs: 1, cs: 1,     // rowspan / colspan
      cov: false,       // 是否被合并覆盖
      org: null,        // 被覆盖时指向源单元格 {r,c}
      align: '',        // '' | 'l' | 'c' | 'r'
      valign: '',       // '' | 'top' | 'bottom'
      b: false, i: false, u: false, s: false, sup: false, sub: false,
      bg: null, fg: null
    };
  };

  M.defaultOptions = function () {
    return {
      fit: 'none',          // none | scale | tabularx
      fontsize: '',
      centering: true,
      landscape: false,
      float: false,
      longtable: false,
      caption: '',
      label: '',
      escape: true,
      preserveCommands: false,
      compact: false,
      noSpace: false        // 去除空格：输出里不保留空格
    };
  };

  M.create = function (rows, cols) {
    rows = Math.max(1, rows | 0);
    cols = Math.max(1, cols | 0);
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) row.push(M.newCell());
      cells.push(row);
    }
    return {
      v: 1,
      name: 'table',
      cells: cells,
      vlines: new Array(cols + 1).fill(null),   // 每条列边界： null | 'single' | 'double'
      hlines: Array.from({ length: rows + 1 }, function () { return []; }), // 每条行边界： [{s,from,to}]
      colAlign: new Array(cols).fill('c'),
      options: M.defaultOptions()
    };
  };

  M.nRows = function (doc) { return doc.cells.length; };
  M.nCols = function (doc) { return doc.cells.length ? doc.cells[0].length : 0; };

  M.emptyCell = function (c) {
    return !c || (!c.t && !c.bg && !c.fg && !c.b && !c.i && !c.u && !c.s && !c.sup && !c.sub && !c.align && !c.valign);
  };

  /* --------- 规范化：保证网格、跨度、边界数组一致 --------- */
  function canPlace(cells, claimed, r, c, rs, cs, self) {
    for (var dr = 0; dr < rs; dr++) {
      for (var dc = 0; dc < cs; dc++) {
        var y = r + dr, x = c + dc;
        if (!cells[y] || !cells[y][x]) return false;
        if (claimed[y][x]) return false;
        if (dr === 0 && dc === 0) continue;
        if (cells[y][x].rs > 1 || cells[y][x].cs > 1) return false;
      }
    }
    return true;
  }

  M.normalize = function (doc) {
    if (!doc || !Array.isArray(doc.cells) || !doc.cells.length) {
      var fresh = M.create(3, 3);
      for (var k in fresh) doc[k] = fresh[k];
      return doc;
    }
    var cells = doc.cells;
    var nR = cells.length;
    var nC = Math.max(1, cells[0] ? cells[0].length : 1);

    /* 每行等长 */
    for (var r = 0; r < nR; r++) {
      if (!Array.isArray(cells[r])) cells[r] = [];
      for (var c = 0; c < nC; c++) {
        if (!cells[r][c] || typeof cells[r][c] !== 'object') cells[r][c] = M.newCell();
        else {
          var cell = cells[r][c];
          var base = M.newCell();
          for (var f in base) if (cell[f] === undefined) cell[f] = base[f];
        }
      }
      cells[r].length = nC;
    }

    /* 选项与列对齐 */
    if (!doc.options || typeof doc.options !== 'object') doc.options = M.defaultOptions();
    var dopt = M.defaultOptions();
    for (var o in dopt) if (doc.options[o] === undefined) doc.options[o] = dopt[o];

    if (!Array.isArray(doc.colAlign)) doc.colAlign = [];
    for (var i1 = 0; i1 < nC; i1++) if (doc.colAlign[i1] !== 'l' && doc.colAlign[i1] !== 'c' && doc.colAlign[i1] !== 'r') doc.colAlign[i1] = 'c';
    doc.colAlign.length = nC;

    if (!Array.isArray(doc.vlines)) doc.vlines = [];
    for (var i2 = 0; i2 < nC + 1; i2++) {
      var v = doc.vlines[i2];
      doc.vlines[i2] = (v === 'single' || v === 'double' || v === true) ? (v === 'double' ? 'double' : 'single') : null;
    }
    doc.vlines.length = nC + 1;

    if (!Array.isArray(doc.hlines)) doc.hlines = [];
    for (var i3 = 0; i3 < nR + 1; i3++) if (!Array.isArray(doc.hlines[i3])) doc.hlines[i3] = [];
    doc.hlines.length = nR + 1;

    /* 清空覆盖标记 */
    for (var r2 = 0; r2 < nR; r2++) {
      for (var c2 = 0; c2 < nC; c2++) { cells[r2][c2].cov = false; cells[r2][c2].org = null; }
    }

    /* 重新计算跨度覆盖 */
    var claimed = [];
    for (var r3 = 0; r3 < nR; r3++) { claimed.push(new Array(nC).fill(false)); }

    for (var r4 = 0; r4 < nR; r4++) {
      for (var c4 = 0; c4 < nC; c4++) {
        if (claimed[r4][c4]) continue;
        var cl = cells[r4][c4];
        var rs = Math.max(1, Math.min(parseInt(cl.rs, 10) || 1, nR - r4));
        var cs = Math.max(1, Math.min(parseInt(cl.cs, 10) || 1, nC - c4));
        var guard = 0;
        while (guard++ < 200 && (!canPlace(cells, claimed, r4, c4, rs, cs))) {
          if (cs > rs) cs--; else rs--;
          if (rs < 1) rs = 1;
          if (cs < 1) cs = 1;
          if (rs === 1 && cs === 1) break;
        }
        cl.rs = rs; cl.cs = cs;
        for (var dr = 0; dr < rs; dr++) {
          for (var dc = 0; dc < cs; dc++) {
            claimed[r4 + dr][c4 + dc] = true;
            if (dr || dc) {
              var cov = M.newCell();
              cov.cov = true; cov.org = { r: r4, c: c4 };
              cells[r4 + dr][c4 + dc] = cov;
            }
          }
        }
      }
    }

    /* 横线段落合法性 */
    for (var h = 0; h < doc.hlines.length; h++) {
      var segs = doc.hlines[h];
      var out = [];
      for (var s = 0; s < segs.length; s++) {
        var seg = segs[s];
        if (!seg || !seg.s) continue;
        var from = Math.max(0, Math.min(seg.from | 0, nC - 1));
        var to = Math.max(0, Math.min(seg.to === undefined ? nC - 1 : seg.to | 0, nC - 1));
        if (from > to) { var t2 = from; from = to; to = t2; }
        if (!M.ruleById(seg.s)) seg.s = 'hline';
        out.push({ s: seg.s, from: from, to: to });
      }
      doc.hlines[h] = segs.length ? M.mergeSegs(out, nC) : out;
    }

    /* 文本统一为字符串、去控制字符 */
    for (var r5 = 0; r5 < nR; r5++) {
      for (var c5 = 0; c5 < nC; c5++) {
        var cc = cells[r5][c5];
        if (cc.cov) continue;
        if (typeof cc.t !== 'string') cc.t = cc.t == null ? '' : String(cc.t);
        cc.t = cc.t.replace(/\u0000/g, '');
        if (cc.align !== 'l' && cc.align !== 'c' && cc.align !== 'r') cc.align = '';
        if (cc.valign !== 'top' && cc.valign !== 'bottom') cc.valign = '';
      }
    }
    return doc;
  };

  /* 合并横线段：同一行边界上，全宽段覆盖其它段；相邻同型合并 */
  M.mergeSegs = function (segs, nC) {
    if (!segs.length) return [];
    segs.sort(function (a, b) { return a.from - b.from || a.to - b.to; });
    var merged = [];
    for (var i = 0; i < segs.length; i++) merged.push({ s: segs[i].s, from: segs[i].from, to: segs[i].to });

    /* 若存在全宽段，则删除其它段（保留最后一个全宽段） */
    var fullIdx = -1;
    for (var j = 0; j < merged.length; j++) if (merged[j].from === 0 && merged[j].to === nC - 1) fullIdx = j;
    if (fullIdx >= 0) return [{ s: merged[fullIdx].s, from: 0, to: nC - 1 }];

    /* 合并相邻同型 */
    var out = [];
    for (var k = 0; k < merged.length; k++) {
      var cur = merged[k];
      var last = out[out.length - 1];
      if (last && last.s === cur.s && cur.from <= last.to + 1) last.to = Math.max(last.to, cur.to);
      else out.push(cur);
    }
    return out;
  };

  /* 在给定边界上添加横线段，并移除被覆盖的旧段 */
  M.addSeg = function (doc, boundary, styleId, from, to) {
    var nC = M.nCols(doc);
    if (!doc.hlines[boundary]) doc.hlines[boundary] = [];
    var segs = doc.hlines[boundary].filter(function (sg) {
      return sg.to < from || sg.from > to;   /* 移除与新区间重叠的段 */
    });
    segs.push({ s: styleId, from: from, to: to });
    doc.hlines[boundary] = M.mergeSegs(segs, nC);
  };

  /* 从给定边界上移除区间内的横线（保留区间外的部分） */
  M.removeSeg = function (doc, boundary, from, to) {
    var nC = M.nCols(doc);
    if (!doc.hlines[boundary]) return;
    var out = [];
    doc.hlines[boundary].forEach(function (sg) {
      if (sg.to < from || sg.from > to) { out.push({ s: sg.s, from: sg.from, to: sg.to }); return; }
      if (sg.from < from) out.push({ s: sg.s, from: sg.from, to: from - 1 });
      if (sg.to > to) out.push({ s: sg.s, from: to + 1, to: sg.to });
    });
    doc.hlines[boundary] = M.mergeSegs(out, nC);
  };

  /* 边界上某列是否存在规则 */
  M.hasRuleAt = function (doc, boundary, col) {
    var segs = doc.hlines[boundary] || [];
    for (var i = 0; i < segs.length; i++) if (col >= segs[i].from && col <= segs[i].to) return segs[i].s;
    return null;
  };

  /* 求 origin 单元格在给定边界上的规则样式（若整段都被覆盖） */
  M.ruleOver = function (doc, boundary, from, to) {
    var segs = doc.hlines[boundary] || [];
    var best = null;
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].to < from || segs[i].from > to) continue;
      best = segs[i].s;
      if (segs[i].from <= from && segs[i].to >= to) return segs[i].s;
    }
    return best;
  };

  /* ---------------- 历史记录 ---------------- */
  function History(limit) {
    this.limit = limit || 120;
    this.past = [];
    this.future = [];
  }
  History.prototype.push = function (state) {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  };
  History.prototype.undo = function (current) {
    if (!this.past.length) return null;
    var prev = this.past.pop();
    this.future.push(current);
    return prev;
  };
  History.prototype.redo = function (current) {
    if (!this.future.length) return null;
    var next = this.future.pop();
    this.past.push(current);
    return next;
  };
  History.prototype.clear = function () { this.past.length = 0; this.future.length = 0; };
  LT.History = History;

  /* ---------------- 导出命名空间 ---------------- */
  LT.emit = LT.emit || {};
  LT.parse = LT.parse || {};
})();
