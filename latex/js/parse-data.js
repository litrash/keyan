/* =========================================================
 * parse-data.js — CSV / TSV / Markdown / HTML / JSON / XLSX 读取
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var M = LT.model;
  var U = LT.util;

  /* ---------------- 分隔符文本 ---------------- */
  function parseDelimited(text, delim) {
    var rows = [], row = [], cur = '', i = 0;
    var inQuotes = false;
    text = String(text).replace(/^\uFEFF/, '');

    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"' && cur === '') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++;
    }
    row.push(cur);
    rows.push(row);
    /* 去掉末尾空行 */
    while (rows.length && rows[rows.length - 1].length === 1 && !rows[rows.length - 1][0]) rows.pop();
    return rows;
  }

  function detectDelimiter(text) {
    var sample = String(text).split(/\r?\n/).slice(0, 8).join('\n');
    var cands = [',', ';', '\t', '|'];
    var best = ',', bestScore = -1;
    cands.forEach(function (d) {
      var rows = parseDelimited(sample, d);
      if (rows.length < 2) return;
      var counts = rows.map(function (r) { return r.length; });
      var first = counts[0];
      if (first < 2) return;
      var consistent = counts.filter(function (c) { return c === first; }).length;
      var score = first * 10 + consistent;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  LT.parse.delimited = parseDelimited;
  LT.parse.csv = function (text) { return parseDelimited(text, detectDelimiter(text)); };
  LT.parse.tsv = function (text) { return parseDelimited(text, '\t'); };

  /* ---------------- Markdown ---------------- */
  LT.parse.markdown = function (text) {
    var lines = String(text).split(/\r?\n/);
    var picked = [];
    lines.forEach(function (ln) {
      if (ln.indexOf('|') >= 0) picked.push(ln);
    });
    var rows = [];
    picked.forEach(function (ln, idx) {
      var s = ln.trim();
      if (s.charAt(0) === '|') s = s.slice(1);
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
      var cells = s.split(/(?<!\\)\|/).map(function (c) {
        return c.replace(/\\\|/g, '|').trim();
      });
      /* 跳过 |---|---| 分隔行 */
      if (cells.length && cells.every(function (c) { return /^:?-{2,}:?$/.test(c.replace(/\s/g, '')); })) return;
      rows.push(cells);
    });
    if (!rows.length) throw new Error('没有找到 Markdown 表格（需要以 | 分隔的行）');
    return rows;
  };

  /* ---------------- HTML ---------------- */
  LT.parse.html = function (html) {
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    var table = doc.querySelector('table');
    if (!table) throw new Error('HTML 中没有 <table> 元素');
    var trs = Array.prototype.slice.call(table.querySelectorAll('tr'));
    var grid = [], spanMap = {};

    trs.forEach(function (tr, r) {
      if (!grid[r]) grid[r] = [];
      var col = 0;
      Array.prototype.slice.call(tr.children).forEach(function (td) {
        if (td.tagName !== 'TD' && td.tagName !== 'TH') return;
        while (spanMap[r + ':' + col]) col++;
        var rs = Math.max(1, parseInt(td.getAttribute('rowspan') || '1', 10) || 1);
        var cs = Math.max(1, parseInt(td.getAttribute('colspan') || '1', 10) || 1);
        var text = (td.textContent || '').replace(/\s+/g, ' ').trim();
        for (var dr = 0; dr < rs; dr++) {
          for (var dc = 0; dc < cs; dc++) {
            var rr = r + dr, cc = col + dc;
            if (!grid[rr]) grid[rr] = [];
            if (dr === 0 && dc === 0) grid[rr][cc] = text;
            else { grid[rr][cc] = ''; spanMap[rr + ':' + cc] = 1; }
          }
        }
        col += cs;
      });
    });

    var out = [];
    grid.forEach(function (row) {
      var r = row || [];
      out.push(r.map(function (v) { return v == null ? '' : v; }));
    });
    if (!out.length) throw new Error('HTML 表格为空');
    return out;
  };

  /* ---------------- JSON ---------------- */
  LT.parse.json = function (text) {
    var data = JSON.parse(text);
    if (data && Array.isArray(data.cells)) {
      var doc = M.normalize(data);
      return { doc: doc };
    }
    if (Array.isArray(data)) {
      if (data.length && Array.isArray(data[0])) return { matrix: data.map(function (r) { return r.map(String); }) };
      return { matrix: data.map(function (v) { return [String(v)]; }) };
    }
    throw new Error('无法识别的 JSON：既不是本编辑器文档，也不是二维数组');
  };

  /* ---------------- XLSX（零依赖读取） ---------------- */
  function inflateEntry(buf, entry) {
    if (entry.method === 0) return Promise.resolve(entry.data);
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('当前浏览器不支持 DecompressionStream，无法解压 xlsx'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([entry.data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function readZip(buffer) {
    var dv = new DataView(buffer);
    var eocd = -1;
    var min = Math.max(0, buffer.byteLength - 66000);
    for (var i = buffer.byteLength - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip/xlsx 容器');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var files = {};
    var dec = new TextDecoder();
    for (var k = 0; k < count; k++) {
      if (p + 46 > buffer.byteLength) break;
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
      var lnLen = dv.getUint16(localOff + 26, true);
      var leLen = dv.getUint16(localOff + 28, true);
      var dataStart = localOff + 30 + lnLen + leLen;
      files[name] = { method: method, data: new Uint8Array(buffer, dataStart, compSize) };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  }

  function colIndexOf(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function pickSheet(files) {
    var names = Object.keys(files);
    var sheets = names.filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); });
    sheets.sort(function (a, b) {
      var na = parseInt((/sheet(\d+)/.exec(a) || [0, 0])[1], 10);
      var nb = parseInt((/sheet(\d+)/.exec(b) || [0, 0])[1], 10);
      return na - nb;
    });
    return sheets[0];
  }

  LT.parse.xlsx = function (arrayBuffer) {
    var files = readZip(arrayBuffer);
    var sheetName = pickSheet(files);
    if (!sheetName) throw new Error('xlsx 中没有工作表');
    var sharedName = 'xl/sharedStrings.xml';
    var jobs = [inflateEntry(arrayBuffer, files[sheetName])];
    if (files[sharedName]) jobs.push(inflateEntry(arrayBuffer, files[sharedName]));

    return Promise.all(jobs).then(function (outs) {
      var dec = new TextDecoder();
      var sheetXml = dec.decode(outs[0]);

      var shared = [];
      if (outs[1]) {
        var sx = new DOMParser().parseFromString(dec.decode(outs[1]), 'application/xml');
        Array.prototype.slice.call(sx.getElementsByTagName('si')).forEach(function (si) {
          var txt = '';
          Array.prototype.slice.call(si.getElementsByTagName('t')).forEach(function (t) { txt += t.textContent; });
          shared.push(txt);
        });
      }

      var xml = new DOMParser().parseFromString(sheetXml, 'application/xml');
      var rows = Array.prototype.slice.call(xml.getElementsByTagName('row'));
      var grid = [], maxC = 0;

      rows.forEach(function (row) {
        var rIdx = parseInt(row.getAttribute('r') || '0', 10) - 1;
        if (rIdx < 0) rIdx = grid.length;
        var cells = [];
        Array.prototype.slice.call(row.getElementsByTagName('c')).forEach(function (c) {
          var ci = colIndexOf(c.getAttribute('r'));
          var t = c.getAttribute('t');
          var vEl = c.getElementsByTagName('v')[0];
          var val = '';
          if (t === 's') {
            var idx = vEl ? parseInt(vEl.textContent, 10) : -1;
            val = shared[idx] != null ? shared[idx] : '';
          } else if (t === 'inlineStr') {
            var isEl = c.getElementsByTagName('t')[0];
            val = isEl ? isEl.textContent : '';
          } else if (t === 'b') {
            val = vEl && vEl.textContent === '1' ? 'TRUE' : 'FALSE';
          } else {
            val = vEl ? vEl.textContent : '';
          }
          cells[ci] = val;
          if (ci + 1 > maxC) maxC = ci + 1;
        });
        grid[rIdx] = cells;
      });

      var out = [];
      for (var r = 0; r < grid.length; r++) {
        var row = grid[r] || [];
        var line = [];
        for (var c = 0; c < maxC; c++) line.push(row[c] == null ? '' : String(row[c]));
        out.push(line);
      }
      if (!out.length) throw new Error('工作表为空');
      return out;
    });
  };

  /* ---------------- 智能识别 ---------------- */
  LT.parse.smart = function (text) {
    var s = String(text || '');
    if (!s.trim()) throw new Error('内容为空');
    if (/<table[\s>]/i.test(s)) {
      return { kind: 'html', matrix: LT.parse.html(s) };
    }
    if (/\\begin\s*\{|\\hline|\\multicolumn|\\toprule/.test(s) && s.indexOf('&') >= 0) {
      var r = LT.parse.latex(s);
      return { kind: 'latex', doc: r.doc, log: r.log };
    }
    if (/\n\s*\|?[\s:-]*\|[\s:|-]*\n/.test(s) && s.indexOf('|') >= 0) {
      try { return { kind: 'markdown', matrix: LT.parse.markdown(s) }; } catch (e) { /* 继续 */ }
    }
    if (s.indexOf('\t') >= 0) return { kind: 'tsv', matrix: LT.parse.tsv(s) };
    var d = detectDelimiter(s);
    var matrix = parseDelimited(s, d);
    if (matrix.length === 1 && matrix[0].length === 1) {
      /* 单列纯文本 */
      return { kind: 'text', matrix: s.split(/\r?\n/).map(function (ln) { return [ln]; }) };
    }
    return { kind: d === '\t' ? 'tsv' : 'csv', matrix: matrix };
  };

  /* ---------------- 矩阵 -> 文档 ---------------- */
  LT.parse.toDoc = function (matrix, opts) {
    return LT.ops.fromMatrix(matrix, opts || {});
  };
})();
