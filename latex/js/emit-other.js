/* =========================================================
 * emit-other.js — 其它输出格式：Markdown / HTML / CSV / TSV /
 *                 Typst / ConTeXt / Plain TeX / BBCode /
 *                 Wikicode / Textile / JSON
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var M = LT.model;
  var U = LT.util;

  /* 逐行取 origin 单元格 */
  function rowsOf(doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc), out = [];
    for (var r = 0; r < nR; r++) {
      var row = [];
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        row.push(cell && !cell.cov ? cell : null);
      }
      out.push(row);
    }
    return out;
  }

  /* 纯文本（保留原样，仅把换行变空格） */
  function tx(cell) { return cell ? String(cell.t || '').replace(/\r?\n/g, ' ') : ''; }

  /* ---------------- Markdown ---------------- */
  LT.emit.markdown = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var log = [];
    var rows = rowsOf(doc);
    var esc = function (s) { return s.replace(/\|/g, '\\|'); };

    var lines = [];
    var sep = [];
    for (var c = 0; c < nC; c++) {
      var al = doc.colAlign[c] || 'c';
      sep.push(al === 'l' ? ':---' : al === 'r' ? '---:' : ':---:');
    }
    for (var r = 0; r < nR; r++) {
      var cells = [];
      for (var c2 = 0; c2 < nC; c2++) cells.push(esc(tx(rows[r][c2])));
      lines.push('| ' + cells.join(' | ') + ' |');
      if (r === 0) lines.push('| ' + sep.join(' | ') + ' |');
    }
    if (doc.hlinesHasMerge || hasMerges(doc)) log.push('Markdown 不支持单元格合并，已展开为空格占位。');
    return { code: lines.join('\n'), log: log };
  };

  function hasMerges(doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    for (var r = 0; r < nR; r++) for (var c = 0; c < nC; c++) {
      var cell = doc.cells[r][c];
      if (cell && !cell.cov && (cell.rs > 1 || cell.cs > 1)) return true;
    }
    return false;
  }

  /* ---------------- HTML ---------------- */
  LT.emit.html = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var log = [];
    var out = ['<table class="latex-table" style="border-collapse:collapse;">'];
    var AL = { l: 'left', c: 'center', r: 'right' };

    for (var r = 0; r < nR; r++) {
      out.push('  <tr>');
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        var st = [];
        var al = cell.align || doc.colAlign[c] || 'c';
        st.push('text-align:' + (AL[al] || 'center'));
        if (cell.valign === 'top') st.push('vertical-align:top');
        if (cell.valign === 'bottom') st.push('vertical-align:bottom');
        if (cell.bg) st.push('background-color:' + cell.bg);
        if (cell.fg) st.push('color:' + cell.fg);
        var rule = M.ruleOver(doc, r, c, c + cell.cs - 1);
        if (rule) st.push('border-top:' + cssRule(rule));
        var ruleB = M.ruleOver(doc, r + cell.rs, c, c + cell.cs - 1);
        if (ruleB) st.push('border-bottom:' + cssRule(ruleB));
        if (doc.vlines[c]) st.push('border-left:' + (doc.vlines[c] === 'double' ? '3px double #000' : '1px solid #000'));
        if (doc.vlines[c + cell.cs]) st.push('border-right:' + (doc.vlines[c + cell.cs] === 'double' ? '3px double #000' : '1px solid #000'));
        st.push('padding:4px 8px');

        var attrs = ' style="' + st.join(';') + '"';
        if (cell.rs > 1) attrs += ' rowspan="' + cell.rs + '"';
        if (cell.cs > 1) attrs += ' colspan="' + cell.cs + '"';
        var body = U.escapeHtml(tx(cell));
        if (cell.b) body = '<strong>' + body + '</strong>';
        if (cell.i) body = '<em>' + body + '</em>';
        if (cell.u) body = '<u>' + body + '</u>';
        if (cell.s) body = '<s>' + body + '</s>';
        if (cell.sup) body = '<sup>' + body + '</sup>';
        if (cell.sub) body = '<sub>' + body + '</sub>';
        out.push('    <td' + attrs + '>' + body + '</td>');
      }
      out.push('  </tr>');
    }
    out.push('</table>');
    log.push('单元格内的 LaTeX 命令（如 \\textbf、$x^2$）按原文输出，需要浏览器端数学渲染请自行引入 MathJax。');
    return { code: out.join('\n'), log: log };
  };

  function cssRule(id) {
    switch (id) {
      case 'hline2': return '3px double #000';
      case 'toprule': return '2px solid #000';
      case 'midrule': return '1px solid #000';
      case 'bottomrule': return '2px solid #000';
      case 'thick': return '2.5px solid #000';
      case 'hdashline': return '1px dashed #000';
      case 'dotted': return '1px dotted #000';
      default: return '1px solid #000';
    }
  }

  /* ---------------- CSV / TSV ---------------- */
  function csvEscape(s, delim) {
    s = String(s == null ? '' : s);
    if (s.indexOf('"') >= 0 || s.indexOf(delim) >= 0 || /\r|\n/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  LT.emit.csv = function (doc) {
    var rows = rowsOf(doc), nC = M.nCols(doc), out = [];
    rows.forEach(function (row) {
      var cells = [];
      for (var c = 0; c < nC; c++) cells.push(csvEscape(tx(row[c]), ','));
      out.push(cells.join(','));
    });
    return { code: out.join('\n'), log: ['CSV 不保留合并、颜色与对齐信息。'] };
  };

  LT.emit.tsv = function (doc) {
    var rows = rowsOf(doc), nC = M.nCols(doc), out = [];
    rows.forEach(function (row) {
      var cells = [];
      for (var c = 0; c < nC; c++) cells.push(tx(row[c]).replace(/[\t\r\n]+/g, ' '));
      out.push(cells.join('\t'));
    });
    return { code: out.join('\n'), log: ['TSV（制表符分隔）可直接粘贴到 Excel / LibreOffice。'] };
  };

  LT.emit.json = function (doc) {
    return { code: JSON.stringify(doc, null, 2), log: ['JSON 是本编辑器的无损保存格式，可用「打开 JSON」重新载入。'] };
  };

  /* ---------------- Typst ---------------- */
  function typstText(cell) {
    var s = String(cell.t || '').replace(/\r?\n/g, ' ');
    var parts = s.split(/(\$[^$]*\$)/g);
    var body = parts.map(function (p) {
      if (/^\$[^$]*\$$/.test(p)) return p;
      return p.replace(/([\\#*_`<>@\[\]$])/g, '\\$1');
    }).join('');
    if (!body) return '';
    if (cell.sup) body = '#super[' + body + ']';
    if (cell.sub) body = '#sub[' + body + ']';
    if (cell.s) body = '#strike[' + body + ']';
    if (cell.u) body = '#underline[' + body + ']';
    if (cell.i) body = '_' + body + '_';
    if (cell.b) body = '*' + body + '*';
    return body;
  }

  function typstStroke(id) {
    switch (id) {
      case 'toprule': return '1pt';
      case 'bottomrule': return '1pt';
      case 'midrule': return '0.5pt';
      case 'thick': return '1.5pt';
      case 'hline2': return '0.8pt + 2pt';
      case 'hdashline': return '(paint: black, thickness: 0.5pt, dash: "dashed")';
      case 'dotted': return '(paint: black, thickness: 0.5pt, dash: "dotted")';
      default: return '0.5pt';
    }
  }

  LT.emit.typst = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var log = [];
    var hasV = doc.vlines.some(function (v) { return !!v; });
    var hasH = doc.hlines.some(function (s) { return s && s.length; });

    var aligns = [];
    for (var c = 0; c < nC; c++) aligns.push(doc.colAlign[c] === 'l' ? 'left' : doc.colAlign[c] === 'r' ? 'right' : 'center');

    var out = ['#table(', '  columns: ' + nC + ','];
    out.push('  align: (' + aligns.join(', ') + '),');
    if (hasV) out.push('  stroke: (x: 0.5pt, y: none),');
    else out.push('  stroke: none,');

    var indent = '  ';
    (doc.hlines[0] || []).forEach(function (sg) {
      out.push(indent + 'table.hline(stroke: ' + typstStroke(sg.s) + '),');
    });
    for (var r = 0; r < nR; r++) {
      var parts = [];
      for (var c2 = 0; c2 < nC; c2++) {
        var cell = doc.cells[r][c2];
        if (!cell || cell.cov) continue;
        var args = [];
        if (cell.rs > 1) args.push('rowspan: ' + cell.rs);
        if (cell.cs > 1) args.push('colspan: ' + cell.cs);
        if (cell.bg) args.push('fill: rgb("' + String(cell.bg).toUpperCase() + '")');
        var al = cell.align || doc.colAlign[c2];
        if (al && al !== doc.colAlign[c2]) args.push('align: ' + (al === 'l' ? 'left' : al === 'r' ? 'right' : 'center'));
        var content = typstText(cell);
        var entry = '[' + content + ']';
        if (args.length) entry = 'table.cell(' + args.join(', ') + ')[' + content + ']';
        parts.push(entry);
      }
      out.push(indent + parts.join(', ') + ',');
      (doc.hlines[r + 1] || []).forEach(function (sg) {
        out.push(indent + 'table.hline(stroke: ' + typstStroke(sg.s) + '),');
      });
    }
    out.push(')');
    if (hasH) log.push('Typst 输出使用 table.hline 表达横线，行区间（\\cmidrule）会退化为整行横线。');
    if (hasMerges(doc)) log.push('合并单元格使用 table.cell(rowspan/colspan)。');
    return { code: out.join('\n'), log: log };
  };

  /* ---------------- ConTeXt ---------------- */
  LT.emit.context = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var AL = { l: 'flushleft', c: 'middle', r: 'flushright' };
    var out = ['\\starttext', '', '\\bTABLE[frame=off, align=middle]'];
    for (var r = 0; r < nR; r++) {
      var rowAttr = [];
      var top = M.ruleOver(doc, r, 0, nC - 1);
      if (top) rowAttr.push('topframe=on');
      var bottom = M.ruleOver(doc, r + 1, 0, nC - 1);
      if (r === nR - 1 && bottom) rowAttr.push('bottomframe=on');
      out.push('  \\bTR' + (rowAttr.length ? '[' + rowAttr.join(', ') + ']' : ''));
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        var opt = [];
        if (cell.cs > 1) opt.push('nc=' + cell.cs);
        if (cell.rs > 1) opt.push('nr=' + cell.rs);
        var al = cell.align || doc.colAlign[c] || 'c';
        opt.push('align=' + (AL[al] || 'middle'));
        if (cell.bg) opt.push('background=color, backgroundcolor=' + String(cell.bg).replace('#', ''));
        var body = tx(cell);
        if (cell.b) body = '\\bf ' + body;
        if (cell.i) body = '\\em ' + body;
        out.push('    \\bTD[' + opt.join(', ') + '] ' + body + ' \\eTD');
      }
      out.push('  \\eTR');
    }
    out.push('\\eTABLE', '', '\\stoptext');
    return { code: out.join('\n'), log: ['ConTeXt 输出使用 \\bTABLE/\\bTR/\\bTD 结构；颜色需 \\setupcolor 定义。'] };
  };

  /* ---------------- Plain TeX ---------------- */
  LT.emit.plaintex = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var log = [];
    var tmpl = [];
    for (var c = 0; c < nC; c++) {
      var al = doc.colAlign[c] || 'c';
      tmpl.push(al === 'l' ? '#\\hfil' : al === 'r' ? '\\hfil#' : '\\hfil#\\hfil');
    }
    var out = ['\\vbox{\\halign{' + tmpl.join(' & ') + '\\cr'];
    for (var r = 0; r < nR; r++) {
      var segs = doc.hlines[r] || [];
      segs.forEach(function () { out.push('\\noalign{\\hrule}'); });
      var cells = [];
      for (var c2 = 0; c2 < nC; c2++) {
        var cell = doc.cells[r][c2];
        if (!cell || cell.cov) continue;
        var body = tx(cell);
        if (cell.cs > 1) body = '\\multispan{' + cell.cs + '}' + (body ? ' ' + body : '');
        cells.push(body);
      }
      out.push(cells.join(' & ') + ' \\cr');
      if (r === nR - 1) {
        (doc.hlines[nR] || []).forEach(function () { out.push('\\noalign{\\hrule}'); });
      }
    }
    out.push('}}');
    if (hasMerges(doc)) log.push('Plain TeX 的 \\halign 不支持竖向合并（\\multirow），纵向合并的内容只输出一次。');
    return { code: out.join('\n'), log: log };
  };

  /* ---------------- BBCode ---------------- */
  LT.emit.bbcode = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var out = ['[table]'];
    for (var r = 0; r < nR; r++) {
      out.push('[tr]');
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        var body = U.escapeHtml(tx(cell));
        if (cell.b) body = '[b]' + body + '[/b]';
        if (cell.i) body = '[i]' + body + '[/i]';
        if (cell.u) body = '[u]' + body + '[/u]';
        var span = cell.cs > 1 ? ' colspan=' + cell.cs : '';
        out.push('[td' + span + ']' + body + '[/td]');
      }
      out.push('[/tr]');
    }
    out.push('[/table]');
    return { code: out.join('\n'), log: ['BBCode 的表格支持依赖论坛实现，纵向合并不被支持。'] };
  };

  /* ---------------- Wikicode ---------------- */
  LT.emit.wikicode = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var out = ['{| class="wikitable"'];
    for (var r = 0; r < nR; r++) {
      out.push('|-');
      var line = [];
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        var attrs = [];
        if (cell.rs > 1) attrs.push('rowspan="' + cell.rs + '"');
        if (cell.cs > 1) attrs.push('colspan="' + cell.cs + '"');
        var al = cell.align || doc.colAlign[c];
        if (al === 'c') attrs.push('style="text-align:center"');
        else if (al === 'r') attrs.push('style="text-align:right"');
        if (cell.bg) attrs.push('style="background:' + cell.bg + '"');
        var body = tx(cell) || ' ';
        var marker = (r === 0 ? '!' : '|');
        line.push(marker + (attrs.length ? ' ' + attrs.join(' ') + ' | ' : ' ') + body);
      }
      out.push(line.join('\n'));
    }
    out.push('|}');
    return { code: out.join('\n'), log: [] };
  };

  /* ---------------- Textile ---------------- */
  LT.emit.textile = function (doc) {
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var out = [];
    for (var r = 0; r < nR; r++) {
      var line = [];
      var head = r === 0;
      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        var marks = [];
        if (head) marks.push('_');
        var al = cell.align || doc.colAlign[c];
        if (al === 'c') marks.push('=.');
        if (al === 'r') marks.push('>.');
        if (cell.cs > 1) marks.push('\\' + cell.cs + '.');
        var attrs = marks.length ? marks.join('') : '';
        var body = tx(cell);
        if (cell.b) body = '*' + body + '*';
        if (cell.i) body = '_' + body + '_';
        line.push('|' + attrs + ' ' + body + ' ');
      }
      out.push(line.join('') + '|');
    }
    return { code: out.join('\n'), log: ['Textile 使用 |=.| 表头标记。'] };
  };

  /* ---------------- 分发 ---------------- */
  LT.emit.render = function (doc, format) {
    var fn = LT.emit[format] || LT.emit.latex;
    var r = fn(doc) || { code: '', log: [] };
    return { code: r.code, packages: r.packages || [], log: r.log || [] };
  };

  LT.emit.hasMerges = hasMerges;
})();
