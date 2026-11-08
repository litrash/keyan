/* =========================================================
 * parse-latex.js — LaTeX 表格解析（tabular/tabularx/longtable/
 *                  tabularray(tblr) 等环境）
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var M = LT.model;

  var ENVS = ['tabular', 'tabular*', 'tabularx', 'tabularx*', 'tabulary', 'longtable', 'tabu',
    'longtabu', 'tblr', 'longtblr', 'talltblr', 'NiceTabular', 'NiceTabular*', 'NiceTabularX',
    'array', 'supertabular', 'supertabular*', 'mpxtabular', 'xtabular', 'ctable', 'tabu*'];

  var COLOR_NAMES = {
    red: '#FF0000', blue: '#0000FF', green: '#00FF00', black: '#000000', white: '#FFFFFF',
    gray: '#808080', grey: '#808080', yellow: '#FFFF00', orange: '#FF8000', purple: '#800080',
    cyan: '#00FFFF', magenta: '#FF00FF', brown: '#804000', pink: '#FFB0B0', lightgray: '#D0D0D0',
    lightgrey: '#D0D0D0', darkgray: '#404040', darkgrey: '#404040', olive: '#808000', teal: '#008080'
  };

  function matchBrace(s, i) {
    if (s[i] !== '{') return -1;
    var depth = 0;
    for (var k = i; k < s.length; k++) {
      var ch = s[k];
      if (ch === '\\') { k++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  }

  function takeGroup(s, i) {
    if (s[i] !== '{') return null;
    var e = matchBrace(s, i);
    if (e < 0) return null;
    return { body: s.slice(i + 1, e), end: e + 1 };
  }

  function stripComments(text) {
    var out = '', i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (ch === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
      if (ch === '%') {
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      out += ch; i++;
    }
    return out;
  }

  /* 顶层分割 */
  function splitTop(s, sep) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '\\') { cur += s.slice(i, i + 2); i++; continue; }
      if (ch === '{') depth++;
      if (ch === '}') depth = Math.max(0, depth - 1);
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  /* ---------------- 列格式 ---------------- */
  function expandStars(spec) {
    /* *{n}{...} -> 重复展开 */
    for (var pass = 0; pass < 25; pass++) {
      var m = /\*\{(\d+)\}\s*\{/.exec(spec);
      if (!m) break;
      var start = m.index;
      var bracePos = spec.indexOf('{', start + m[0].length - 1);
      var g = takeGroup(spec, bracePos);
      if (!g) break;
      var n = parseInt(m[1], 10) || 1;
      var rep = '';
      for (var i = 0; i < n; i++) rep += g.body;
      spec = spec.slice(0, start) + rep + spec.slice(g.end);
    }
    return spec;
  }

  function parseColspec(spec) {
    spec = expandStars(String(spec || '')).replace(/\s+/g, '');
    var aligns = [], vlines = [], pending = 0, i = 0;

    function pushCol(al) {
      vlines.push(pending >= 2 ? 'double' : pending === 1 ? 'single' : null);
      pending = 0;
      aligns.push(al);
    }

    while (i < spec.length) {
      var ch = spec[i];
      if (ch === '|') { pending++; i++; continue; }
      if (ch === '@' || ch === '!' || ch === '>' || ch === '<') {
        i++;
        if (spec[i] === '{') { var g0 = takeGroup(spec, i); i = g0 ? g0.end : i + 1; }
        continue;
      }
      if ('lLJ'.indexOf(ch) >= 0) { pushCol('l'); i++; continue; }
      if ('cCX'.indexOf(ch) >= 0) { pushCol('c'); i++; continue; }
      if ('rR'.indexOf(ch) >= 0) { pushCol('r'); i++; continue; }
      if ('pmbPMwW'.indexOf(ch) >= 0) {
        var al = (ch === 'm' || ch === 'M' || ch === 'w' || ch === 'W') ? 'c' : 'l';
        pushCol(al);
        i++;
        if (spec[i] === '{') { var g1 = takeGroup(spec, i); i = g1 ? g1.end : i + 1; }
        continue;
      }
      if (ch === 'D' || ch === 'F' || ch === 'd' || ch === 's' || ch === 'S') {
        /* 复杂列类型：尽量跳过其参数 */
        pushCol('c');
        i++;
        while (spec[i] === '{') { var g2 = takeGroup(spec, i); i = g2 ? g2.end : i + 1; }
        continue;
      }
      i++;
    }
    vlines.push(pending >= 2 ? 'double' : pending === 1 ? 'single' : null);
    return { aligns: aligns, vlines: vlines };
  }

  /* ---------------- 单元格解析 ---------------- */
  function tryCommand(s, name) {
    var tag = '\\' + name;
    if (s.slice(0, tag.length) !== tag) return null;
    var i = tag.length;
    if (s[i] && /[A-Za-z]/.test(s[i])) return null;
    var opt = null, args = [];
    var skip = function () { while (i < s.length && /\s/.test(s[i])) i++; };
    skip();
    if (s[i] === '(') {
      var pe = s.indexOf(')', i);
      if (pe > 0) { opt = s.slice(i + 1, pe); i = pe + 1; }
      skip();
    }
    if (s[i] === '[') {
      var be = s.indexOf(']', i);
      if (be > 0) { args.push({ opt: true, v: s.slice(i + 1, be) }); i = be + 1; }
      skip();
    }
    while (s[i] === '{') {
      var g = takeGroup(s, i);
      if (!g) break;
      args.push({ v: g.body });
      i = g.end;
      skip();
    }
    return { name: name, opt: opt, args: args, end: i, rest: s.slice(i) };
  }

  function colorToHex(v) {
    if (!v) return null;
    v = String(v).replace(/#/g, '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) return '#' + v.toUpperCase();
    if (/^[0-9a-fA-F]{3}$/.test(v)) return '#' + v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    var nm = COLOR_NAMES[v.toLowerCase().replace(/\s/g, '')];
    if (nm) return nm;
    return null;
  }

  /* 与生成端 escapeText 互为逆操作：把 \& 之类还原成字符 */
  function unescapeText(s) {
    var parts = String(s).split(/(\$[^$]*\$)/g);
    return parts.map(function (p) {
      if (/^\$[^$]*\$$/.test(p)) return p;
      return p
        .replace(/\\textbackslash\{\}/g, '\\')
        .replace(/\\textasciitilde\{\}/g, '~')
        .replace(/\\textasciicircum\{\}/g, '^')
        .replace(/\\([&%#_${}])/g, '$1');
    }).join('');
  }

  function parseCell(raw) {
    var st = M.newCell();
    var s = M.trim(raw);
    var guard = 0;
    /* 去掉可选参数（如 [HTML]），只保留花括号实参 */
    var A = function (r) {
      return r.args.filter(function (a) { return !a.opt; });
    };

    while (guard++ < 60) {
      if (!s) break;
      var r;

      if ((r = tryCommand(s, 'multicolumn'))) {
        var av = A(r);
        if (av.length >= 3) {
          st.cs = Math.max(1, parseInt(av[0].v, 10) || 1);
          var specTxt = av[1].v || '';
          var al = /[lcr]/.exec(specTxt.replace(/[^lcr]/g, ''));
          if (al) st.align = al[0];
          s = av[2].v + r.rest;
          continue;
        }
      }
      if ((r = tryCommand(s, 'multirow'))) {
        var am = A(r);
        if (am.length >= 3) {
          st.rs = Math.max(1, parseInt(am[0].v, 10) || 1);
          s = am[2].v + r.rest;
          continue;
        }
      }
      if ((r = tryCommand(s, 'cellcolor'))) {
        var ac = A(r);
        var hexv = ac.length ? colorToHex(ac[0].v) : null;
        if (hexv) st.bg = hexv;
        s = r.rest;
        continue;
      }
      if ((r = tryCommand(s, 'textcolor'))) {
        var at = A(r);
        var fgv = null;
        var body = '';
        if (at.length >= 2) { fgv = colorToHex(at[0].v); body = at[1].v; }
        if (fgv) st.fg = fgv;
        s = body + r.rest;
        continue;
      }
      if ((r = tryCommand(s, 'makecell'))) {
        if (r.args.length) { s = r.args[0].v + r.rest; continue; }
      }
      if ((r = tryCommand(s, 'resizebox'))) {
        if (r.args.length >= 3) { s = r.args[2].v + r.rest; continue; }
      }
      if ((r = tryCommand(s, 'textbf'))) { if (r.args.length) { st.b = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'textit'))) { if (r.args.length) { st.i = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'emph'))) { if (r.args.length) { st.i = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'textsl'))) { if (r.args.length) { st.i = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'underline'))) { if (r.args.length) { st.u = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'uline'))) { if (r.args.length) { st.u = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'sout'))) { if (r.args.length) { st.s = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'textsuperscript'))) { if (r.args.length) { st.sup = true; s = r.args[0].v + r.rest; continue; } }
      if ((r = tryCommand(s, 'textsubscript'))) { if (r.args.length) { st.sub = true; s = r.args[0].v + r.rest; continue; } }
      break;
    }

    st.text = unescapeText(M.trim(s));
    return st;
  }

  /* ---------------- 主体扫描 ---------------- */
  var RULE_NAMES = ['hline', 'toprule', 'midrule', 'bottomrule', 'hdashline', 'cline', 'cmidrule',
    'cdashline', 'Xhline', 'Xcline', 'tabucline', 'endhead', 'endfirsthead', 'endfoot',
    'endlastfoot', 'firsthline', 'lasthline', 'rowcolor', 'noalign'];

  function scanBody(body) {
    var tokens = [], depth = 0, buf = '', i = 0;
    function flush() { if (buf) { tokens.push({ t: 'text', v: buf }); buf = ''; } }

    while (i < body.length) {
      var ch = body[i];

      if (ch === '\\') {
        /* 行结束符 \\ */
        if (body[i + 1] === '\\') {
          if (depth === 0) {
            flush();
            var j = i + 2;
            if (body[j] === '[') { var be = body.indexOf(']', j); if (be > 0) j = be + 1; }
            tokens.push({ t: 'row' });
            i = j;
            continue;
          }
          buf += '\\\\';
          i += 2;
          continue;
        }

        if (depth === 0) {
          var rest = body.slice(i);
          var matched = null;
          for (var k = 0; k < RULE_NAMES.length; k++) {
            var rn = RULE_NAMES[k];
            if (rest.slice(0, rn.length + 1) === '\\' + rn && !/[A-Za-z]/.test(rest[rn.length + 1] || '')) {
              matched = rn; break;
            }
          }
          if (matched) {
            var r = tryCommand(rest, matched);
            if (r) {
              flush();
              tokens.push({ t: 'rule', name: matched, opt: r.opt, args: r.args });
              i += r.end;
              continue;
            }
          }
        }
        buf += ch;
        i++;
        continue;
      }

      if (ch === '{') { depth++; buf += ch; i++; continue; }
      if (ch === '}') { depth = Math.max(0, depth - 1); buf += ch; i++; continue; }
      buf += ch;
      i++;
    }
    flush();
    return tokens;
  }

  /* ---------------- 规则应用 ---------------- */
  function applyRules(doc, boundary, rules, nC, log) {
    rules.forEach(function (rl) {
      var name = rl.name;
      var arg0 = rl.args && rl.args.length ? rl.args[0].v : null;

      function range(str) {
        var m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(str || '');
        if (!m) return null;
        return { from: Math.max(0, parseInt(m[1], 10) - 1), to: Math.min(nC - 1, parseInt(m[2], 10) - 1) };
      }

      if (name === 'hline' || name === 'Xhline' || name === 'firsthline' || name === 'lasthline') {
        addFull('hline');
      } else if (name === 'toprule') addFull('toprule');
      else if (name === 'midrule') addFull('midrule');
      else if (name === 'bottomrule') addFull('bottomrule');
      else if (name === 'hdashline') addFull('hdashline');
      else if (name === 'cline' || name === 'Xcline') {
        var rg = range(arg0);
        if (rg) M.addSeg(doc, boundary, 'hline', rg.from, rg.to);
      } else if (name === 'cmidrule') {
        var rg2 = range(arg0);
        if (rg2) M.addSeg(doc, boundary, 'midrule', rg2.from, rg2.to);
      } else if (name === 'cdashline') {
        var rg3 = range(arg0);
        if (rg3) M.addSeg(doc, boundary, 'hdashline', rg3.from, rg3.to);
      } else if (name === 'tabucline') {
        var rg4 = range(arg0);
        if (rg4) M.addSeg(doc, boundary, 'hline', rg4.from, rg4.to);
      } else if (name === 'rowcolor') {
        log.push('\\rowcolor 未逐格还原，请自行设置背景色。');
      }

      function addFull(id) {
        var existing = doc.hlines[boundary] || [];
        var hasFull = existing.some(function (s) { return s.from === 0 && s.to === nC - 1; });
        if (hasFull && id === 'hline') {
          doc.hlines[boundary] = [{ s: 'hline2', from: 0, to: nC - 1 }];
          return;
        }
        M.addSeg(doc, boundary, id, 0, nC - 1);
      }
    });
  }

  /* ---------------- 主解析 ---------------- */
  LT.parse.latex = function (input) {
    var log = [];
    var text = stripComments(String(input || ''));

    /* 定位表格环境 */
    var envName = null, envStart = -1;
    for (var e = 0; e < ENVS.length; e++) {
      var re = new RegExp('\\\\begin\\s*\\{' + ENVS[e].replace('*', '\\*') + '\\}');
      var m = re.exec(text);
      if (m) { envName = ENVS[e]; envStart = m.index; break; }
    }
    if (!envName) throw new Error('未找到受支持的表格环境（tabular / tabularx / longtable / tblr …）');

    var headEnd = envStart + text.slice(envStart).indexOf('}') + 1;
    var i = headEnd;
    while (i < text.length && /\s/.test(text[i])) i++;

    /* tblr 允许一个可选参数 [..] */
    if (text[i] === '[') {
      var be = text.indexOf(']', i);
      if (be > 0) { i = be + 1; while (i < text.length && /\s/.test(text[i])) i++; }
    }

    var colspec = '';
    if (text[i] === '{') {
      var g = takeGroup(text, i);
      if (!g) throw new Error('列格式（colspec）解析失败：花括号不匹配');
      colspec = g.body;
      i = g.end;
    }

    /* tabularray：从 colspec 里取 colspec= {...} */
    var isRay = /^t|^longt|^tallt|^Nice/.test(envName) && /colspec|tblr/i.test(envName);
    if (/^tblr|^longtblr|^talltblr$/i.test(envName)) {
      var cm = /colspec\s*=\s*\{/.exec(colspec);
      if (cm) {
        var bracePos = colspec.indexOf('{', cm.index + cm[0].length - 1);
        var gg = takeGroup(colspec, bracePos);
        if (gg) colspec = gg.body;
      } else {
        colspec = colspec.split(',')[0].trim();
      }
      log.push('tabularray 环境：已提取 colspec，其余键（hlines/vlines 等）按边界规则近似还原。');
    }

    var endTag = '\\end{' + envName + '}';
    var endIdx = text.indexOf(endTag, i);
    if (endIdx < 0) throw new Error('未找到 ' + endTag);
    var body = text.slice(i, endIdx);

    /* 扫描 */
    var tokens = scanBody(body);
    var entries = [], cur = [], pending = [];
    tokens.forEach(function (tk) {
      if (tk.t === 'rule') { pending.push(tk); return; }
      if (tk.t === 'row') {
        entries.push({ cells: cur, rules: pending });
        cur = []; pending = [];
        return;
      }
      var parts = splitTop(tk.v, '&');
      if (!cur.length) cur.push('');
      cur[cur.length - 1] += parts[0];
      for (var p = 1; p < parts.length; p++) cur.push(parts[p]);
    });
    function isEmptyEntry(en) {
      if (!en.cells.length) return true;
      return en.cells.every(function (c) { return !M.trim(c); });
    }

    /* 最后一个 \\ 之后只剩空白与规则时，不构成新数据行（只保留规则） */
    var tailRules = [];
    if (cur.length || pending.length) {
      if (isEmptyEntry({ cells: cur })) {
        tailRules = pending;
      } else {
        entries.push({ cells: cur, rules: pending });
      }
    }

    var dataRows = entries;
    if (!dataRows.some(function (en) { return !isEmptyEntry(en); })) throw new Error('表格中没有数据行');

    var nR = dataRows.length;
    var nC = 1;
    dataRows.forEach(function (r) { nC = Math.max(nC, r.cells.length); });

    var spec = parseColspec(colspec);
    nC = Math.max(nC, spec.aligns.length);

    var doc = M.create(nR, nC);
    for (var c = 0; c < nC; c++) doc.colAlign[c] = spec.aligns[c] || 'c';
    doc.vlines = [];
    for (var v = 0; v <= nC; v++) doc.vlines.push(spec.vlines[v] || null);

    dataRows.forEach(function (row, r) {
      var col = 0;
      for (var ci = 0; ci < row.cells.length && col < nC; ci++) {
        var raw = row.cells[ci];
        if (!M.trim(raw)) { col += 1; continue; }
        var parsed = parseCell(raw);
        var target = doc.cells[r][col];
        target.t = parsed.text;
        target.rs = parsed.rs;
        target.cs = parsed.cs;
        target.align = parsed.align;
        target.b = parsed.b; target.i = parsed.i; target.u = parsed.u; target.s = parsed.s;
        target.sup = parsed.sup; target.sub = parsed.sub;
        target.bg = parsed.bg; target.fg = parsed.fg;
        col += parsed.cs;
      }
    });

    /* 规则：规则出现在某行之前 => 应用于该行的上边界 */
    var boundary = 0;
    entries.forEach(function (en) {
      if (en.rules.length) applyRules(doc, boundary, en.rules, nC, log);
      boundary++;
    });
    if (tailRules.length) applyRules(doc, boundary, tailRules, nC, log);

    M.normalize(doc);
    log.push('已导入 ' + nR + ' 行 × ' + nC + ' 列');
    return { doc: doc, log: log };
  };
})();
