/* =========================================================
 * grid.js — 表格渲染（WYSIWYG 网格）
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var U = LT.util;
  var M = LT.model;
  var grid = (LT.grid = {});

  var RULE_CSS = {
    hline: '1px solid var(--rule)',
    hline2: '3px double var(--rule)',
    toprule: '2px solid var(--rule)',
    midrule: '1px solid var(--rule)',
    bottomrule: '2px solid var(--rule)',
    thick: '2.5px solid var(--rule)',
    hdashline: '1px dashed var(--rule)',
    dotted: '1px dotted var(--rule)'
  };

  /* ---------------- 光标 ---------------- */
  function caretOffset(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    var range = sel.getRangeAt(0);
    var pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }

  function setCaret(el, offset) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node, count = 0, last = null;
    while ((node = walker.nextNode())) {
      var len = node.nodeValue.length;
      if (count + len >= offset) {
        var r = document.createRange();
        r.setStart(node, Math.max(0, offset - count));
        r.collapse(true);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
      count += len;
      last = node;
    }
    if (last) {
      var r2 = document.createRange();
      r2.setStart(last, last.nodeValue.length);
      r2.collapse(true);
      var s2 = window.getSelection();
      s2.removeAllRanges();
      s2.addRange(r2);
    }
  }

  grid.focusCell = function (r, c, atEnd) {
    var inner = document.querySelector('.inner[data-r="' + r + '"][data-c="' + c + '"]');
    if (!inner) return;
    inner.focus();
    if (atEnd) {
      var range = document.createRange();
      range.selectNodeContents(inner);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  grid.blurCell = function () {
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains('inner')) a.blur();
  };

  /* ---------------- 渲染 ---------------- */
  function vchip(j, isTail) {
    var v = LT.state.doc.vlines[j];
    var el = U.el('button', {
      class: 'edge vid' + (v ? ' has' : '') + (isTail ? ' vedge' : ''),
      'data-act': 'edgeV',
      'data-b': j,
      title: '列分隔线（第 ' + (j + 1) + ' 条边界）：' + (v === 'double' ? '双竖线 ||' : v ? '单竖线 |' : '无'),
      text: v === 'double' ? '‖' : v ? '|' : '·'
    });
    return el;
  }

  function hchip(boundary, isTail) {
    var segs = LT.state.doc.hlines[boundary] || [];
    var first = segs.length ? segs[0] : null;
    var label = '·';
    if (first) {
      var st = M.ruleById(first.s);
      label = st.id === 'hline2' ? '=' : st.id === 'toprule' || st.id === 'bottomrule' ? '▔' : st.id === 'hdashline' ? '┄' : st.id === 'dotted' ? '┈' : '─';
    }
    return U.el('button', {
      class: 'edge hedge' + (segs.length ? ' has' : '') + (isTail ? ' tail' : ''),
      'data-act': 'edgeH',
      'data-b': boundary,
      title: '第 ' + (boundary + 1) + ' 条横线边界：' + (first ? M.ruleById(first.s).label : '无'),
      text: label
    });
  }

  grid.render = function () {
    var state = LT.state;
    var doc = state.doc, sel = state.sel;
    var nR = M.nRows(doc), nC = M.nCols(doc);
    var wrap = document.getElementById('gridWrap');
    var table = document.getElementById('grid');

    var scrollTop = wrap.scrollTop, scrollLeft = wrap.scrollLeft;

    var active = document.activeElement;
    var focusInfo = null;
    if (active && active.classList && active.classList.contains('inner')) {
      focusInfo = { r: +active.dataset.r, c: +active.dataset.c, caret: caretOffset(active) };
    }

    table.innerHTML = '';

    /* ---- 表头 ---- */
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    trh.appendChild(U.el('th', { class: 'corner', text: '#' }));
    for (var c0 = 0; c0 < nC; c0++) {
      var th = U.el('th', { class: 'colh' });
      var binner = U.el('div', { class: 'colh-inner' }, [
        U.el('button', {
          class: 'alignbtn',
          'data-act': 'cycleAlign',
          'data-c': c0,
          title: '点击切换该列对齐方式（l → c → r）',
          text: doc.colAlign[c0] || 'c'
        }),
        U.el('span', { class: 'colletter', text: U.colLetter(c0) })
      ]);
      th.appendChild(binner);
      th.appendChild(vchip(c0, false));
      if (c0 === nC - 1) th.appendChild(vchip(nC, true));
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    /* ---- 表体 ---- */
    var tbody = document.createElement('tbody');
    for (var r = 0; r < nR; r++) {
      var tr = document.createElement('tr');
      var gth = U.el('th', { class: 'rowh', text: String(r + 1) });
      gth.appendChild(hchip(r, r === nR - 1));
      tr.appendChild(gth);

      for (var c = 0; c < nC; c++) {
        var cell = doc.cells[r][c];
        if (!cell || cell.cov) continue;
        tr.appendChild(makeTd(doc, r, c, cell, sel));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.scrollTop = scrollTop; wrap.scrollLeft = scrollLeft;

    if (focusInfo) {
      var again = document.querySelector('.inner[data-r="' + focusInfo.r + '"][data-c="' + focusInfo.c + '"]');
      if (again) { again.focus(); setCaret(again, focusInfo.caret); }
    }

    grid.updateStatus();
  };

  function makeTd(doc, r, c, cell, sel) {
    var td = U.el('td', { class: 'cell', 'data-r': r, 'data-c': c });
    if (cell.rs > 1) td.rowSpan = cell.rs;
    if (cell.cs > 1) td.colSpan = cell.cs;

    var al = cell.align || doc.colAlign[c] || 'c';
    td.classList.add('al-' + al);
    if (cell.valign === 'top') td.classList.add('v-top');
    if (cell.valign === 'bottom') td.classList.add('v-bottom');

    if (cell.b) td.classList.add('f-b');
    if (cell.i) td.classList.add('f-i');
    if (cell.u) td.classList.add('f-u');
    if (cell.s) td.classList.add('f-s');
    if (cell.sup) td.classList.add('f-sup');
    if (cell.sub) td.classList.add('f-sub');

    if (cell.bg) td.style.background = cell.bg;

    var top = M.ruleOver(doc, r, c, c + cell.cs - 1);
    if (top) td.style.borderTop = RULE_CSS[M.ruleById(top).css] || RULE_CSS.hline;
    var bottom = M.ruleOver(doc, r + cell.rs, c, c + cell.cs - 1);
    if (bottom) td.style.borderBottom = RULE_CSS[M.ruleById(bottom).css] || RULE_CSS.hline;

    if (doc.vlines[c]) td.style.borderLeft = doc.vlines[c] === 'double' ? '3px double var(--rule)' : '1px solid var(--rule)';
    if (doc.vlines[c + cell.cs]) td.style.borderRight = doc.vlines[c + cell.cs] === 'double' ? '3px double var(--rule)' : '1px solid var(--rule)';

    if (sel.contains(r, c)) td.classList.add('is-sel');
    if (sel.isAnchor(r, c)) td.classList.add('is-anchor');

    var inner = U.el('div', {
      class: 'inner',
      'data-r': r,
      'data-c': c,
      'contenteditable': 'plaintext-only',
      'spellcheck': 'false'
    });
    if (cell.fg) inner.style.color = cell.fg;
    inner.appendChild(U.el('span', { class: 'tx', text: cell.t || '' }));
    td.appendChild(inner);
    return td;
  }

  grid.updateStatus = function () {
    var state = LT.state;
    if (!state) return;
    var nR = M.nRows(state.doc), nC = M.nCols(state.doc);
    var dims = document.getElementById('dims');
    if (dims) dims.textContent = nR + ' × ' + nC;
    var selEl = document.getElementById('statusSel');
    if (selEl) {
      var n = state.sel.count();
      var origins = state.sel.origins(state.doc).length;
      selEl.textContent = '已选 ' + origins + ' 个区域（' + n + ' 个位置）';
    }
  };

  /* ---------------- 事件辅助 ---------------- */
  grid.cellFromEvent = function (e) {
    var td = e.target.closest ? e.target.closest('td.cell') : null;
    if (!td) return null;
    return { r: +td.dataset.r, c: +td.dataset.c };
  };

  grid.caretOffset = caretOffset;
  grid.setCaret = setCaret;
})();
