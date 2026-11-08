/* =========================================================
 * emit-latex.js — LaTeX 代码生成（tabular / tabularx / longtable
 *                 / tabularray / MWE）
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var M = LT.model;

  var ALIGN_OK = { l: 1, c: 1, r: 1 };

  /* ---------------- 包管理 ---------------- */
  var PKG_ORDER = ['xcolor', 'colortbl', 'array', 'tabularx', 'longtable', 'booktabs', 'multirow',
    'arydshln', 'ulem', 'graphicx', 'pdflscape', 'adjustbox', 'tabularray', 'diagbox', 'makecell', 'hhline'];

  function Pkgs() { this.map = {}; }
  Pkgs.prototype.add = function (name, opt) {
    if (!this.map[name]) this.map[name] = opt || null;
    else if (opt && !this.map[name]) this.map[name] = opt;
  };
  Pkgs.prototype.list = function () {
    var self = this;
    return Object.keys(this.map).sort(function (a, b) {
      var ia = PKG_ORDER.indexOf(a), ib = PKG_ORDER.indexOf(b);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      return ia - ib || (a < b ? -1 : 1);
    }).map(function (k) { return { name: k, opt: self.map[k] }; });
  };

  /* ---------------- 文本转义 ---------------- */
  /* ± 是 Unicode 符号，pdfLaTeX 无法直接排版，需转成 \pm。
     \pm 只能在数学模式使用，因此：
       - 数学模式内（$…$ / \(…\)）直接写 \pm
         后面紧跟字母时必须写成 \pm{}，否则会与后续字母连成别的命令
         （例如 \pmb 是真实存在的粗体命令）
       - 正文里用 \ensuremath{\pm}，花括号天然起到分隔作用 */
  function pmInMath(p) {
    return p.replace(/±(?=[A-Za-z])/g, '\\pm{}').replace(/±/g, '\\pm');
  }

  function escapeText(s, opts) {
    s = String(s == null ? '' : s).replace(/\r?\n/g, ' ');
    if (!opts.escape) return s;
    var parts = s.split(/(\$[^$]*\$)/g);
    return parts.map(function (p) {
      if (/^\$[^$]*\$$/.test(p)) return pmInMath(p);              /* 数学模式 */
      if (/^\\\(.*\\\)$/.test(p)) return pmInMath(p);
      if (opts.preserveCommands && p.indexOf('\\') >= 0) return p.replace(/±/g, '\\ensuremath{\\pm}');
      return p
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/([&%$#_{}])/g, '\\$1')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/±/g, '\\ensuremath{\\pm}');
    }).join('');
  }

  /* ---------------- 单元格正文 ---------------- */
  function cellBody(cell, pkg, opts) {
    var t = escapeText(cell.t || '', opts);
    if (!t && !cell.bg && !cell.fg) return '';
    if (t) {
      if (cell.sup) t = '\\textsuperscript{' + t + '}';
      if (cell.sub) t = '\\textsubscript{' + t + '}';
      if (cell.s) { t = '\\sout{' + t + '}'; pkg.add('ulem'); }
      if (cell.u) { t = '\\underline{' + t + '}'; }
      if (cell.i) t = '\\textit{' + t + '}';
      if (cell.b) t = '\\textbf{' + t + '}';
    }
    if (cell.fg) {
      pkg.add('xcolor');
      t = '\\textcolor[HTML]{' + hex(cell.fg) + '}' + (t ? '{' + t + '}' : '{}');
    }
    if (cell.bg) {
      pkg.add('xcolor', 'table');
      t = '\\cellcolor[HTML]{' + hex(cell.bg) + '}' + t;
    }
    return t;
  }

  function hex(c) { return String(c || '#FFFFFF').replace('#', '').toUpperCase(); }

  function vSpec(doc, j) {
    var v = doc.vlines[j];
    if (v === 'single') return '|';
    if (v === 'double') return '||';
    return '';
  }

  /* ---------------- tabular 入口 ---------------- */
  function entryFor(doc, r, c, cell, pkg, opts) {
    var body = cellBody(cell, pkg, opts);
    var colAl = ALIGN_OK[doc.colAlign[c]] ? doc.colAlign[c] : 'c';
    var al = ALIGN_OK[cell.align] ? cell.align : colAl;
    var s = body;

    if (cell.cs > 1 || al !== colAl) {
      var spec = vSpec(doc, c) + al + vSpec(doc, c + cell.cs);
      s = '\\multicolumn{' + cell.cs + '}{' + spec + '}{' + (s || '') + '}';
    }
    if (cell.rs > 1) {
      s = '\\multirow{' + cell.rs + '}{*}{' + (s || '') + '}';
      pkg.add('multirow');
    }
    return s;
  }

  function rowLine(doc, r, pkg, opts) {
    var nC = M.nCols(doc);
    var parts = [];
    for (var c = 0; c < nC; c++) {
      var cell = doc.cells[r][c];
      if (!cell || cell.cov) continue;
      parts.push(entryFor(doc, r, c, cell, pkg, opts));
    }
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts.join(' & ') + ' \\\\';
  }

  function ruleLines(doc, boundary, pkg) {
    var nC = M.nCols(doc);
    var segs = doc.hlines[boundary] || [];
    var out = [];
    segs.forEach(function (seg) {
      var style = M.ruleById(seg.s);
      var full = (seg.from === 0 && seg.to === nC - 1);
      var a = seg.from + 1, b = seg.to + 1;
      if (style.pkg) pkg.add(style.pkg);
      if (style.id === 'thick' && full) pkg.add('booktabs');
      out.push(full ? style.full : style.part(a, b));
    });
    return out;
  }

  function colSpec(doc, opts, pkg) {
    var nC = M.nCols(doc);
    var s = '';
    for (var c = 0; c < nC; c++) {
      s += vSpec(doc, c);
      var al = ALIGN_OK[doc.colAlign[c]] ? doc.colAlign[c] : 'c';
      if (opts.fit === 'tabularx') {
        pkg.add('array'); pkg.add('tabularx');
        var pre = al === 'l' ? '\\raggedright' : al === 'r' ? '\\raggedleft' : '\\centering';
        s += '>{\\' + pre + '\\arraybackslash}X';
      } else if (opts.fit === 'scale') {
        s += al;
      } else {
        s += al;
      }
    }
    s += vSpec(doc, nC);
    return s;
  }

  /* ---------------- 主体构建 ---------------- */
  function buildCore(doc, opts, pkg, log) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var ind = opts.compact ? '' : '  ';
    var lines = [];
    var useLong = !!opts.longtable;
    if (useLong) pkg.add('longtable');
    var spec = colSpec(doc, opts, pkg);
    var env, begin, end;

    if (opts.fit === 'tabularx' && !useLong) {
      env = 'tabularx';
      begin = '\\begin{tabularx}{\\textwidth}{' + spec + '}';
      end = '\\end{tabularx}';
    } else if (useLong) {
      begin = '\\begin{longtable}{' + spec + '}';
      end = '\\end{longtable}';
    } else {
      begin = '\\begin{tabular}{' + spec + '}';
      end = '\\end{tabular}';
    }

    lines.push(begin);
    for (var r = 0; r <= nR; r++) {
      ruleLines(doc, r, pkg).forEach(function (l) { lines.push(ind + l); });
      if (r < nR) {
        lines.push(ind + rowLine(doc, r, pkg, opts));
        if (useLong && r === 0 && nR > 1) lines.push(ind + '\\endhead');
      }
    }
    lines.push(end);

    return lines;
  }

  function wrap(lines, doc, opts, pkg) {
    var out = lines.slice();

    if (opts.fontsize) out = [opts.fontsize].concat(out);

    if (opts.fit === 'scale') {
      pkg.add('graphicx');
      out = ['\\begin{adjustbox}{max width=\\textwidth}'].concat(out, ['\\end{adjustbox}']);
      pkg.add('adjustbox');
    }

    var cap = String(opts.caption || '').trim();
    var lab = String(opts.label || '').trim();
    var needFloat = !!opts.float || !!cap || !!lab;

    if (needFloat && opts.longtable) {
      needFloat = false;                 /* longtable 不能放进浮动体 */
    }
    if (needFloat) out = ['\\begin{table}[htbp]'].concat(opts.centering ? ['\\centering'] : [], out);
    else if (opts.centering) out = ['\\centering'].concat(out);

    if (cap) out = out.concat(['\\caption{' + cap + '}']);
    if (lab) out = out.concat(['\\label{' + lab + '}']);
    if (needFloat) out = out.concat(['\\end{table}']);

    if (opts.landscape) {
      pkg.add('pdflscape');
      out = ['\\begin{landscape}'].concat(out, ['\\end{landscape}']);
    }
    return out;
  }

  LT.emit.latex = function (doc, overrides) {
    var opts = Object.assign({}, doc.options, overrides || {});
    var pkg = new Pkgs();
    var log = [];
    if (opts.longtable && (opts.float || String(opts.caption || '').trim() || String(opts.label || '').trim())) {
      log.push('longtable 环境下浮动体/标题会被忽略（LaTeX 限制），已自动跳过 \\begin{table}。');
    }
    var core = buildCore(doc, opts, pkg, log);
    var lines = wrap(core, doc, opts, pkg, 'tabular');
    return { code: lines.join('\n'), packages: pkg.list(), log: log };
  };

  /* ---------------- 完整文档 ---------------- */
  LT.emit.mwe = function (doc, overrides) {
    var opts = Object.assign({}, doc.options, overrides || {});
    var r = LT.emit.latex(doc, opts);
    var out = ['\\documentclass{article}'];
    r.packages.forEach(function (p) {
      out.push('\\usepackage' + (p.opt ? '[' + p.opt + ']' : '') + '{' + p.name + '}');
    });
    out.push('');
    out.push('\\begin{document}');
    out.push('');
    out.push(r.code);
    out.push('');
    out.push('\\end{document}');
    return { code: out.join('\n'), packages: r.packages, log: r.log };
  };

  /* ---------------- tabularray ---------------- */
  var TR_WIDTH = {
    hline: '0.4pt', hline2: '0.8pt', toprule: '1pt', midrule: '0.5pt',
    bottomrule: '1pt', thick: '1.2pt', hdashline: ['0.4pt', 'dashed'], dotted: ['0.4pt', 'dotted']
  };

  function trSpec(styleId) {
    var w = TR_WIDTH[styleId] || '0.4pt';
    if (Array.isArray(w)) return '{' + w[0] + ',' + w[1] + '}';
    return '{' + w + '}';
  }

  LT.emit.tabularray = function (doc, overrides) {
    var opts = Object.assign({}, doc.options, overrides || {});
    var pkg = new Pkgs();
    pkg.add('tabularray');
    var log = [];
    var nR = M.nRows(doc), nC = M.nCols(doc);

    /* colspec */
    var spec = '';
    for (var c = 0; c < nC; c++) {
      if (doc.vlines[c]) spec += '|';
      spec += ALIGN_OK[doc.colAlign[c]] ? doc.colAlign[c] : 'c';
    }
    if (doc.vlines[nC]) spec += '|';

    var keys = ['  colspec = {' + spec + '},'];

    /* 横线 */
    for (var h = 0; h <= nR; h++) {
      var segs = doc.hlines[h] || [];
      if (!segs.length) continue;
      var idx = h + 1 === nR + 1 ? 'Z' : String(h + 1);
      var full = [], parts = [];
      segs.forEach(function (sg) {
        var w = trSpec(sg.s);
        if (sg.from === 0 && sg.to === nC - 1) full.push(w);
        else parts.push('hline{' + idx + '}={ ' + (sg.from + 1) + '-' + (sg.to + 1) + ' }' + w);
      });
      if (full.length) keys.push('  hline{' + idx + '} = ' + full[0] + ',');
      parts.forEach(function (p) { keys.push('  ' + p + ','); });
    }

    /* 竖线 */
    for (var v = 1; v <= nC + 1; v++) {
      var kind = doc.vlines[v - 1];
      if (!kind) continue;
      keys.push('  vline{' + (v === nC + 1 ? 'Z' : v) + '} = {' + (kind === 'double' ? '0.8pt' : '0.4pt') + '},');
    }
    if (keys.length) keys[keys.length - 1] = keys[keys.length - 1].replace(/,$/, '');

    var lines = ['\\begin{tblr}{', keys.join('\n'), '}'];
    var ind = '  ';

    for (var r = 0; r < nR; r++) {
      var parts2 = [];
      for (var c2 = 0; c2 < nC; c2++) {
        var cell = doc.cells[r][c2];
        if (!cell || cell.cov) continue;
        var body = cellBody(cell, pkg, opts);
        var ko = [];
        if (cell.rs > 1) ko.push('r=' + cell.rs);
        if (cell.cs > 1) ko.push('c=' + cell.cs);
        var al = ALIGN_OK[cell.align] ? cell.align : (ALIGN_OK[doc.colAlign[c2]] ? doc.colAlign[c2] : 'c');
        if (al !== (ALIGN_OK[doc.colAlign[c2]] ? doc.colAlign[c2] : 'c')) ko.push(al);
        if (cell.valign === 'top') ko.push('t');
        if (cell.valign === 'bottom') ko.push('b');
        if (cell.bg) { ko.push('bg=' + hex(cell.bg)); pkg.add('xcolor'); }
        if (cell.fg) { ko.push('fg=' + hex(cell.fg)); pkg.add('xcolor'); }
        if (ko.length) body = '\\SetCell[' + ko.join(',') + '] ' + body;
        parts2.push(body === '' ? '{}' : body);
      }
      lines.push(ind + parts2.join(', ') + ',');
    }
    lines.push('\\end{tblr}');

    var out = wrap(lines, doc, opts, pkg, 'tblr');
    return { code: out.join('\n'), packages: pkg.list(), log: log };
  };

  /* 供其它生成器复用 */
  LT.emit._helpers = { escapeText: escapeText, hex: hex, vSpec: vSpec, ALIGN_OK: ALIGN_OK };
})();
