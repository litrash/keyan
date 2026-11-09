/* =========================================================
 * app.js — 界面装配与全部交互逻辑
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT, U = LT.util, M = LT.model, OPS = LT.ops, UI = LT.ui;

  var STORE_KEY = 'lt-editor-doc-v1';
  var THEME_KEY = 'lt-editor-theme';
  var FORMAT_EXT = {
    latex: 'tex', tabularray: 'tex', mwe: 'tex', context: 'tex', plaintex: 'tex',
    markdown: 'md', textile: 'textile', typst: 'typ',
    html: 'html', bbcode: 'txt', wikicode: 'wiki',
    csv: 'csv', tsv: 'tsv', json: 'json'
  };

  var state = (LT.state = {
    doc: null,
    sel: new LT.Selection(),
    hist: new LT.History(150),
    format: 'latex',
    ruleStyle: 'hline',
    lastOut: { code: '', packages: [], log: [] }
  });

  /* =================== 初始化 =================== */
  function defaultDoc() {
    var doc = M.create(4, 4);
    for (var c = 0; c < 4; c++) doc.cells[0][c].b = true;
    doc.hlines[0] = [{ s: 'toprule', from: 0, to: 3 }];
    doc.hlines[1] = [{ s: 'midrule', from: 0, to: 3 }];
    doc.hlines[4] = [{ s: 'bottomrule', from: 0, to: 3 }];
    M.normalize(doc);
    return doc;
  }

  function boot() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }

    if (saved && saved.doc && saved.doc.cells) {
      state.doc = M.normalize(saved.doc);
      if (saved.format) state.format = saved.format;
      if (saved.ruleStyle) state.ruleStyle = saved.ruleStyle;
    } else {
      state.doc = defaultDoc();
    }

    var theme = 'light';
    try { theme = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) {}
    setTheme(theme);

    document.getElementById('format').value = state.format;
    syncOptionInputs();
    renderRuleList();

    state.sel.reset(0, 0);
    renderAll();
    bind();
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.body.classList.toggle('theme-dark', t === 'dark');
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }

  /* =================== 渲染 =================== */
  var saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }

  function saveNow() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        doc: state.doc, format: state.format, ruleStyle: state.ruleStyle, at: Date.now()
      }));
      var el = document.getElementById('autosave');
      if (el) {
        var d = new Date();
        el.textContent = '已自动保存 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      }
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function renderAll() {
    LT.grid.render();
    renderCode();
    LT.grid.updateStatus();
  }

  var codeTimer = null;
  function renderCodeSoon() {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(function () { renderCode(); saveSoon(); }, 150);
  }

  function renderCode() {
    var out;
    try {
      out = LT.emit.render(state.doc, state.format);
    } catch (e) {
      document.getElementById('code').textContent = '% 生成失败：' + e.message;
      return;
    }
    state.lastOut = out;
    document.getElementById('code').textContent = out.code;

    var pk = document.getElementById('pkgs');
    pk.innerHTML = '';
    (out.packages || []).forEach(function (p) {
      pk.appendChild(U.el('span', {
        class: 'pkg',
        text: '\\usepackage' + (p.opt ? '[' + p.opt + ']' : '') + '{' + p.name + '}'
      }));
    });
    if (!(out.packages || []).length) {
      pk.appendChild(U.el('span', { class: 'pkg', style: 'background:var(--bg3);color:var(--text3)', text: '无需额外宏包' }));
    }

    var log = document.getElementById('log');
    log.innerHTML = '';
    (out.log || []).forEach(function (l) {
      log.appendChild(U.el('div', { class: 'warn', text: '• ' + l }));
    });
  }

  function paintSelection() {
    var sel = state.sel;
    document.querySelectorAll('#grid td.cell').forEach(function (td) {
      var r = +td.dataset.r, c = +td.dataset.c;
      td.classList.toggle('is-sel', sel.contains(r, c));
      td.classList.toggle('is-anchor', sel.isAnchor(r, c));
    });
    LT.grid.updateStatus();
  }

  /* =================== 提交（含撤销） =================== */
  function commit(fn, silent) {
    var before = JSON.stringify(state.doc);
    var snap = state.sel.snapshot();
    var r = fn() || {};
    M.normalize(state.doc);
    var after = JSON.stringify(state.doc);
    if (after !== before) {
      state.hist.push({ doc: before, sel: snap });
      if (!silent) saveSoon();
    }
    if (r.log && r.log.length) {
      r.log.forEach(function (l, i) { setTimeout(function () { UI.toast(l, 2800); }, i * 180); });
    }
    renderAll();
    saveSoon();
  }

  function undo() {
    var cur = { doc: JSON.stringify(state.doc), sel: state.sel.snapshot() };
    var prev = state.hist.undo(cur);
    if (!prev) { UI.toast('没有可撤销的操作'); return; }
    state.doc = M.normalize(JSON.parse(prev.doc));
    state.sel.restore(prev.sel);
    renderAll(); saveSoon();
  }

  function redo() {
    var cur = { doc: JSON.stringify(state.doc), sel: state.sel.snapshot() };
    var next = state.hist.redo(cur);
    if (!next) { UI.toast('没有可重做的操作'); return; }
    state.doc = M.normalize(JSON.parse(next.doc));
    state.sel.restore(next.sel);
    renderAll(); saveSoon();
  }

  /* =================== 线型图标 =================== */
  function swatchFor(css) {
    var base = 'display:block;width:34px;height:10px;';
    switch (css) {
      case 'hline2': return base + 'border-top:2px solid var(--text2);border-bottom:2px solid var(--text2)';
      case 'toprule': return base + 'border-top:3px solid var(--text2)';
      case 'midrule': return base + 'border-top:1px solid var(--text2)';
      case 'bottomrule': return base + 'border-top:3px solid var(--text2)';
      case 'thick': return base + 'border-top:4px solid var(--text2)';
      case 'hdashline': return base + 'border-top:1px dashed var(--text2)';
      case 'dotted': return base + 'border-top:2px dotted var(--text2)';
      default: return base + 'border-top:1px solid var(--text2)';
    }
  }

  function renderRuleList() {
    var wrap = document.getElementById('ruleList');
    if (!wrap) return;
    wrap.innerHTML = '';
    M.RULE_STYLES.forEach(function (st) {
      var b = U.el('button', {
        class: state.ruleStyle === st.id ? 'is-on' : '',
        'data-act': 'pickRule',
        'data-rule': st.id
      }, [U.el('span', { class: 'swatch', style: swatchFor(st.css) })]);
      b.appendChild(U.el('span', { text: st.label }));
      wrap.appendChild(b);
    });
  }

  /* =================== 选项同步 =================== */
  function syncOptionInputs() {
    var o = state.doc.options;
    document.querySelectorAll('[data-opt]').forEach(function (el) {
      var k = el.dataset.opt;
      if (el.type === 'checkbox') el.checked = !!o[k];
      else el.value = o[k] == null ? '' : o[k];
    });
    syncNoSpaceBtn();
  }

  /* =================== 动作表 =================== */
  var actions = {};

  actions.undo = undo;
  actions.redo = redo;

  actions.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(cur);
  };

  /* 去除空格：按钮一键开关，与「选项 → 代码输出」里的勾选框同一个状态 */
  function syncNoSpaceBtn() {
    var b = document.getElementById('btnNoSpace');
    if (b) b.classList.toggle('is-on', !!state.doc.options.noSpace);
  }
  actions.noSpace = function () {
    state.doc.options.noSpace = !state.doc.options.noSpace;
    syncOptionInputs();
    syncNoSpaceBtn();
    renderCode();
    saveSoon();
  };

  actions.new = function () {
    var rows = U.el('input', { type: 'number', value: 4, min: 1, max: 300, style: 'width:90px' });
    var cols = U.el('input', { type: 'number', value: 4, min: 1, max: 50, style: 'width:90px' });
    UI.modal({
      title: '新建表格',
      width: '420px',
      body: U.el('div', {}, [
        U.el('div', { class: 'field' }, [U.el('span', { text: '行数' }), rows]),
        U.el('div', { class: 'field' }, [U.el('span', { text: '列数' }), cols]),
        U.el('p', { class: 'hint', text: '新建会替换当前表格，可用 Ctrl+Z 撤销。' })
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '创建', primary: true, onClick: function () {
            var r = Math.max(1, Math.min(300, parseInt(rows.value, 10) || 4));
            var c = Math.max(1, Math.min(50, parseInt(cols.value, 10) || 4));
            commit(function () {
              state.doc = M.create(r, c);
              state.sel.reset(0, 0);
              return { changed: true, log: ['已创建 ' + r + ' × ' + c + ' 表格'] };
            });
          }
        }
      ]
    });
  };

  actions.openJson = function () { pickFile('json'); };
  actions.loadFile = function () { pickFile('any'); };

  actions.saveJson = function () {
    U.download('table.json', JSON.stringify(state.doc, null, 2), 'application/json');
    UI.toast('已导出 table.json');
  };

  actions.transpose = function () {
    commit(function () { return OPS.transpose(state.doc); });
  };

  actions.clearSel = function () {
    commit(function () { return OPS.clearContent(state.doc, state.sel); });
  };

  actions.clearAll = function () {
    UI.confirm('清空整个表格', '将删除所有内容、合并与边框，可用 Ctrl+Z 撤销。', function () {
      commit(function () { return OPS.clearAll(state.doc); });
    });
  };

  actions.selectAll = function () {
    state.sel.ranges = [{ r1: 0, c1: 0, r2: M.nRows(state.doc) - 1, c2: M.nCols(state.doc) - 1 }];
    state.sel.anchor = { r: 0, c: 0 };
    state.sel.head = { r: M.nRows(state.doc) - 1, c: M.nCols(state.doc) - 1 };
    paintSelection();
  };

  actions.rowAbove = function () { commit(function () { return OPS.insertRow(state.doc, state.sel, 'above'); }); };
  actions.rowBelow = function () { commit(function () { return OPS.insertRow(state.doc, state.sel, 'below'); }); };
  actions.colBefore = function () { commit(function () { return OPS.insertCol(state.doc, state.sel, 'before'); }); };
  actions.colAfter = function () { commit(function () { return OPS.insertCol(state.doc, state.sel, 'after'); }); };
  actions.rowDelete = function () { commit(function () { return OPS.deleteRow(state.doc, state.sel); }); };
  actions.colDelete = function () { commit(function () { return OPS.deleteCol(state.doc, state.sel); }); };

  actions.colAlign = function (el) {
    var v = el.dataset.v;
    commit(function () { return OPS.setColAlign(state.doc, state.sel, v); });
  };

  actions.cycleAlign = function (el) {
    var c = +el.dataset.c;
    var order = { l: 'c', c: 'r', r: 'l' };
    var next = order[state.doc.colAlign[c]] || 'c';
    commit(function () { state.doc.colAlign[c] = next; return { changed: true }; });
  };

  actions.fmt = function (el) {
    var key = el.dataset.v;
    commit(function () { return OPS.toggleFmt(state.doc, state.sel, key); });
  };

  actions.cellAlign = function (el) {
    var v = el.dataset.v;
    commit(function () { return OPS.setProp(state.doc, state.sel, 'align', v); });
  };

  actions.clearFmt = function () {
    commit(function () { return OPS.clearFmt(state.doc, state.sel); });
  };

  actions.bg = function () {
    var cell = firstSelectedCell();
    UI.colorPicker('单元格背景色', (cell && cell.bg) || '#FFFFFF', function (c) {
      commit(function () { return OPS.setProp(state.doc, state.sel, 'bg', c); });
    });
  };

  actions.fg = function () {
    var cell = firstSelectedCell();
    UI.colorPicker('文字颜色', (cell && cell.fg) || '#000000', function (c) {
      commit(function () { return OPS.setProp(state.doc, state.sel, 'fg', c); });
    });
  };

  actions.clearColor = function () {
    commit(function () {
      OPS.setProp(state.doc, state.sel, 'bg', null);
      return OPS.setProp(state.doc, state.sel, 'fg', null);
    });
  };

  function firstSelectedCell() {
    var list = state.sel.origins(state.doc);
    if (!list.length) return null;
    return state.doc.cells[list[0].r][list[0].c];
  }

  actions.mergeH = function () { commit(function () { return OPS.merge(state.doc, state.sel, 'h'); }); };
  actions.mergeV = function () { commit(function () { return OPS.merge(state.doc, state.sel, 'v'); }); };
  actions.mergeAll = function () { commit(function () { return OPS.merge(state.doc, state.sel, 'all'); }); };
  actions.split = function () { commit(function () { return OPS.split(state.doc, state.sel); }); };

  actions.borderTop = function () { commit(function () { return OPS.setBorder(state.doc, state.sel, 'top', state.ruleStyle); }); };
  actions.borderBottom = function () { commit(function () { return OPS.setBorder(state.doc, state.sel, 'bottom', state.ruleStyle); }); };
  actions.borderClearTop = function () { commit(function () { return OPS.clearBorder(state.doc, state.sel, 'top'); }); };
  actions.borderClearBottom = function () { commit(function () { return OPS.clearBorder(state.doc, state.sel, 'bottom'); }); };
  actions.vlineToggle = function () { commit(function () { return OPS.toggleVlines(state.doc, state.sel); }); };
  actions.vlineOff = function () {
    commit(function () {
      for (var j = 0; j < state.doc.vlines.length; j++) state.doc.vlines[j] = null;
      return { changed: true };
    });
  };
  actions.booktabs = function () { commit(function () { return OPS.booktabs(state.doc); }); };
  actions.allBorders = function () { commit(function () { return OPS.allBorders(state.doc); }); };
  actions.noBorders = function () { commit(function () { return OPS.noBorders(state.doc); }); };

  actions.pickRule = function (el) {
    state.ruleStyle = el.dataset.rule;
    renderRuleList();
    UI.toast('当前线型：' + M.ruleById(state.ruleStyle).label);
  };

  actions.edgeH = function (el) {
    var b = +el.dataset.b;
    var nC = M.nCols(state.doc);
    var items = [{ label: '无（清除该边界）', onPick: function () { commit(function () { return OPS.setBoundary(state.doc, b, null, 0, nC - 1); }); } }, { sep: true }];
    M.RULE_STYLES.forEach(function (st) {
      items.push({
        label: st.label, swatch: swatchFor(st.css) + ';align-self:center',
        on: (state.doc.hlines[b] || []).some(function (s) { return s.s === st.id && s.from === 0 && s.to === nC - 1; }),
        onPick: function () { commit(function () { return OPS.setBoundary(state.doc, b, st.id, 0, nC - 1); }); }
      });
    });
    UI.popover(el, { title: '第 ' + (b + 1) + ' 条横线边界', items: items });
  };

  actions.edgeV = function (el) {
    var j = +el.dataset.b;
    UI.popover(el, {
      title: '第 ' + (j + 1) + ' 条列边界',
      items: [
        { label: '无竖线', on: !state.doc.vlines[j], onPick: function () { commit(function () { return OPS.setVline(state.doc, j, null); }); } },
        { label: '单竖线 |', on: state.doc.vlines[j] === 'single', onPick: function () { commit(function () { return OPS.setVline(state.doc, j, 'single'); }); } },
        { label: '双竖线 ||', on: state.doc.vlines[j] === 'double', onPick: function () { commit(function () { return OPS.setVline(state.doc, j, 'double'); }); } }
      ]
    });
  };

  actions.math = function () { insertText('$x$', 2, 1); };
  actions.footnote = function () { insertText('\\footnote{}', 1, 0); };

  function insertText(txt, back, extend) {
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains('inner')) {
      try {
        document.execCommand('insertText', false, txt);
        var sel = window.getSelection();
        if (sel && sel.modify) {
          for (var i = 0; i < back; i++) sel.modify('move', 'backward', 'character');
          if (extend) sel.modify('extend', 'forward', 'character');
        }
        return;
      } catch (e) { /* 落到下方追加 */ }
    }
    var p = state.sel.anchor || { r: 0, c: 0 };
    commit(function () {
      var cell = state.doc.cells[p.r][p.c];
      cell.t = (cell.t || '') + txt;
      return { changed: true };
    });
    LT.grid.focusCell(p.r, p.c, true);
  }

  actions.copy = function () {
    UI.copy(state.lastOut.code).then(function (ok) {
      UI.toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择代码');
    });
  };

  actions.download = function () { downloadCurrent(); };

  function downloadCurrent() {
    var ext = FORMAT_EXT[state.format] || 'txt';
    U.download('table.' + ext, state.lastOut.code, 'text/plain');
    UI.toast('已下载 table.' + ext);
  }

  actions.resetOptions = function () {
    commit(function () {
      state.doc.options = M.defaultOptions();
      syncOptionInputs();
      return { changed: true };
    });
  };

  /* ---------------- 导入 / 导出 ---------------- */
  actions.import = function () { dlgImport(); };
  actions.pasteTable = function () { dlgPaste(); };

  function applyDoc(newDoc, log) {
    commit(function () {
      state.doc = newDoc;
      state.sel.reset(0, 0);
      return { changed: true, log: log || [] };
    });
  }

  function dlgImport() {
    var ta = U.el('textarea', { placeholder: '在此粘贴：LaTeX 表格 / CSV / Markdown / HTML 表格 源码' });
    var header = U.el('input', { type: 'checkbox', checked: true });
    var info = U.el('div', { class: 'hint', text: '自动识别格式；LaTeX 需包含 \\begin{tabular} 等环境。' });

    UI.modal({
      title: '导入表格',
      body: U.el('div', {}, [
        ta,
        U.el('label', { class: 'chk' }, [header, U.el('span', { text: '首行作为表头（加粗 + 中线）' })]),
        info
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '导入', primary: true, onClick: function () {
            var txt = ta.value;
            if (!txt.trim()) { UI.toast('内容为空'); return false; }
            try {
              var r = LT.parse.smart(txt);
              if (r.doc) {
                applyDoc(r.doc, (r.log || []).concat('已按 LaTeX 解析'));
              } else {
                applyDoc(OPS.fromMatrix(r.matrix, { header: header.checked }), ['已按 ' + r.kind.toUpperCase() + ' 解析：' + r.matrix.length + ' 行']);
              }
            } catch (err) {
              UI.toast('导入失败：' + err.message, 4200);
              return false;
            }
          }
        }
      ]
    });
  }

  function dlgPaste() {
    var zone = U.el('div', { class: 'pastezone', tabindex: '0', text: '点击此处，然后按 Ctrl+V 粘贴（支持 Word / Excel / 网页表格）' });
    var payload = { html: '', text: '' };

    zone.addEventListener('paste', function (e) {
      e.preventDefault();
      payload.html = (e.clipboardData && e.clipboardData.getData('text/html')) || '';
      payload.text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      zone.textContent = '已捕获 ' + (payload.html ? 'HTML 表格' : '纯文本 ' + payload.text.length + ' 字符') + '，点「导入」继续';
      zone.style.borderColor = 'var(--accent)';
      zone.style.color = 'var(--accent)';
    });

    UI.modal({
      title: '粘贴表格',
      body: U.el('div', {}, [zone, U.el('p', { class: 'hint', text: '从 Excel / LibreOffice 复制会得到制表符分隔文本，从网页复制会得到 HTML 表格，两者都能识别。' })]),
      buttons: [
        { label: '取消' },
        {
          label: '导入', primary: true, onClick: function () {
            if (!payload.html && !payload.text) { UI.toast('还没有粘贴任何内容'); return false; }
            try {
              var matrix = payload.html ? LT.parse.html(payload.html) : LT.parse.smart(payload.text).matrix;
              applyDoc(OPS.fromMatrix(matrix, { header: false }), ['已导入 ' + matrix.length + ' 行表格']);
            } catch (err) {
              UI.toast('导入失败：' + err.message, 4200);
              return false;
            }
          }
        }
      ]
    });
    setTimeout(function () { zone.focus(); }, 40);
  }

  function dlgFind() {
    var find = U.el('input', { type: 'text', placeholder: '查找内容' });
    var repl = U.el('input', { type: 'text', placeholder: '替换为' });
    var scope = U.el('select', {}, [
      U.el('option', { value: 'all', text: '全部单元格' }),
      U.el('option', { value: 'sel', text: '仅选中单元格' }),
      U.el('option', { value: 'unsel', text: '仅未选中单元格' })
    ]);
    var regex = U.el('input', { type: 'checkbox' });

    UI.modal({
      title: '查找与替换',
      width: '520px',
      body: U.el('div', {}, [
        U.el('div', { class: 'field' }, [U.el('span', { text: '查找' }), find]),
        U.el('div', { class: 'field' }, [U.el('span', { text: '替换为' }), repl]),
        U.el('div', { class: 'field' }, [U.el('span', { text: '范围' }), scope]),
        U.el('label', { class: 'chk' }, [regex, U.el('span', { text: '使用正则表达式' })])
      ]),
      buttons: [
        { label: '取消' },
        {
          label: '全部替换', primary: true, onClick: function () {
            var res = null;
            commit(function () {
              res = OPS.findReplace(state.doc, state.sel, find.value, repl.value, scope.value, regex.checked);
              return res;
            });
            if (find.value) UI.toast(res && res.log.length ? res.log[0] : '完成');
          }
        }
      ]
    });
    setTimeout(function () { find.focus(); }, 40);
  }
  actions.find = dlgFind;

  /* ---------------- 帮助 ---------------- */
  actions.help = function () {
    UI.modal({
      title: '使用说明',
      width: '720px',
      body: '<div class="help">' +
        '<h3>这是什么</h3>' +
        '<p>本页面是 <code>latex-tables.com</code> 的本地离线复刻：所见即所得地编辑表格，实时生成 LaTeX、Typst、Markdown、HTML、CSV 等代码。所有数据只保存在你的浏览器 localStorage 中，不联网、不上传。</p>' +
        '<h3>选择单元格</h3>' +
        '<ul><li><b>单击</b>：选中并使用 Ctrl+点击 追加选择；<b>Shift+点击</b> 连续选区；按住鼠标拖动可框选。</li>' +
        '<li><b>Enter</b> 向下移动，<b>Tab</b> 向右移动，<b>方向键</b> 在光标位于首尾时跨格移动。</li></ul>' +
        '<h3>边框与线型</h3>' +
        '<ul><li>表格左侧的小按钮是<b>行边界</b>，列头上方的小按钮是<b>列边界</b>，点击即可选择线型（\\hline、\\toprule、\\hdashline…）。</li>' +
        '<li>LaTeX 的竖线属于列格式（colspec），所以竖线只能整列生效；横线可以按区间生成 \\cline / \\cmidrule。</li>' +
        '<li>「自动三线表」会生成 booktabs 的 \\toprule / \\midrule / \\bottomrule 组合。</li></ul>' +
        '<h3>导入</h3>' +
        '<ul><li>支持 LaTeX（tabular / tabularx / longtable / tblr，含 \\multicolumn、\\multirow、\\cline、\\cmidrule、\\cellcolor）、CSV/TSV、Markdown、HTML 表格、JSON 工程文件，以及 .xlsx 表格（内置零依赖解压）。</li>' +
        '<li>「粘贴表格」可以直接从 Excel、Word、网页复制：带 HTML 时解析 HTML，否则解析制表符文本。</li></ul>' +
        '<h3>快捷键</h3>' +
        '<ul><li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销，<kbd>Ctrl</kbd>+<kbd>Y</kbd> 重做，<kbd>Ctrl</kbd>+<kbd>S</kbd> 下载当前格式</li>' +
        '<li><kbd>Ctrl</kbd>+<kbd>B</kbd> / <kbd>I</kbd> / <kbd>U</kbd> 加粗 / 斜体 / 下划线</li>' +
        '<li><kbd>Ctrl</kbd>+<kbd>A</kbd>（在非编辑状态）全选单元格</li></ul>' +
        '<h3>常见问题</h3>' +
        '<p><b>表格太宽？</b>在「选项 → 宽度适配」里选择「缩放整体」或「自动列宽（tabularx）」。</p>' +
        '<p><b>表格太长？</b>勾选「允许跨页（longtable）」。</p>' +
        '<p><b>中文编译？</b>生成的代码是标准 LaTeX，用 XeLaTeX + ctex 宏包编译即可。</p>' +
        '</div>',
      buttons: [{ label: '知道了', primary: true }]
    });
  };

  actions.about = function () {
    UI.modal({
      title: '关于',
      body: '<div class="help"><p>LaTeX 表格编辑器 · 本地离线版 v1.0</p>' +
        '<p>纯静态页面，无框架、无网络请求、无第三方依赖。<br>' +
        '存储位置：浏览器 localStorage（键名 <code>lt-editor-doc-v1</code>）。</p>' +
        '<p>功能参考 <a href="https://www.latex-tables.com/" target="_blank" rel="noreferrer">latex-tables.com</a>，代码全部本地实现。</p></div>',
      buttons: [{ label: '关闭', primary: true }]
    });
  };

  /* =================== 菜单 =================== */
  function openMenu(name, anchor) {
    var items;
    if (name === 'file') {
      items = [
        { label: '新建表格…', onPick: actions.new },
        { label: '打开 JSON…', onPick: actions.openJson },
        { label: '保存 JSON', onPick: actions.saveJson },
        { sep: true },
        { label: '导入（LaTeX / CSV / Markdown / HTML）…', onPick: actions.import },
        { label: '粘贴表格…', onPick: actions.pasteTable },
        { label: '从文件载入（.tex/.csv/.md/.xlsx）…', onPick: actions.loadFile },
        { sep: true },
        { label: '导出 LaTeX 文件（.tex）', onPick: function () { state.format = 'latex'; document.getElementById('format').value = 'latex'; renderCode(); downloadCurrent(); } },
        { label: '导出当前格式…', onPick: actions.download }
      ];
    } else if (name === 'table') {
      items = [
        { label: '转置（行列互换）', onPick: actions.transpose },
        { label: '全选', onPick: actions.selectAll },
        { label: '清空选区内容', onPick: actions.clearSel },
        { label: '查找与替换…', onPick: actions.find },
        { sep: true },
        { label: '自动三线表', onPick: actions.booktabs },
        { label: '添加全部边框', onPick: actions.allBorders },
        { label: '移除全部边框', onPick: actions.noBorders }
      ];
    } else if (name === 'output') {
      items = [
        { label: '复制代码', onPick: actions.copy },
        { label: '下载文件', onPick: actions.download },
        { sep: true },
        { label: '生成最小可编译文档（MWE）', onPick: function () { state.format = 'mwe'; document.getElementById('format').value = 'mwe'; renderCode(); saveSoon(); } },
        { label: '切换为 tabularray', onPick: function () { state.format = 'tabularray'; document.getElementById('format').value = 'tabularray'; renderCode(); saveSoon(); } }
      ];
    } else {
      items = [
        { label: '使用说明', onPick: actions.help },
        { label: '关于', onPick: actions.about }
      ];
    }
    UI.popover(anchor, { items: items });
  }

  /* =================== 文件 =================== */
  var fileMode = 'any';
  function pickFile(mode) {
    fileMode = mode;
    var input = document.getElementById('fileInput');
    input.value = '';
    input.accept = mode === 'json' ? '.json,application/json' : '.tex,.txt,.csv,.tsv,.md,.markdown,.json,.xlsx,.xlsm,.html,.htm';
    input.click();
  }

  function applyFile(file) {
    var name = (file.name || '').toLowerCase();
    if (fileMode === 'json' || /\.json$/.test(name)) {
      U.readFile(file).then(function (txt) {
        var r = LT.parse.json(txt);
        if (r.doc) applyDoc(r.doc, ['已载入 JSON 工程文件']);
        else applyDoc(OPS.fromMatrix(r.matrix, { header: false }), ['已载入 JSON 数组']);
      }).catch(function (e) { UI.toast('读取失败：' + e.message, 4000); });
      return;
    }
    if (/\.(xlsx|xlsm)$/.test(name)) {
      U.readFile(file, 'buffer').then(function (buf) {
        return LT.parse.xlsx(buf);
      }).then(function (matrix) {
        applyDoc(OPS.fromMatrix(matrix, { header: false }), ['已从 ' + file.name + ' 载入 ' + matrix.length + ' 行']);
      }).catch(function (e) { UI.toast('xlsx 读取失败：' + e.message, 4600); });
      return;
    }
    U.readFile(file).then(function (txt) {
      var r = LT.parse.smart(txt);
      if (r.doc) applyDoc(r.doc, (r.log || []).concat('已从 ' + file.name + ' 载入 LaTeX 表格'));
      else applyDoc(OPS.fromMatrix(r.matrix, { header: false }), ['已从 ' + file.name + ' 载入 ' + r.matrix.length + ' 行']);
    }).catch(function (e) { UI.toast('读取失败：' + e.message, 4000); });
  }

  /* =================== 事件绑定 =================== */
  function bind() {
    /* 动作委派 */
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.dataset.act;
      if (actions[act]) {
        e.preventDefault();
        actions[act](btn);
      }
    });

    /* 菜单 */
    document.querySelectorAll('[data-menu]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        openMenu(b.dataset.menu, b);
      });
    });

    /* 标签页 */
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        document.querySelectorAll('[data-pane]').forEach(function (p) {
          p.classList.toggle('is-active', p.dataset.pane === b.dataset.tab);
        });
      });
    });

    /* 输出格式 */
    document.getElementById('format').addEventListener('change', function () {
      state.format = this.value;
      renderCode();
      saveSoon();
    });

    /* 选项 */
    document.querySelectorAll('[data-opt]').forEach(function (el) {
      var handler = function () {
        var key = el.dataset.opt;
        state.doc.options[key] = el.type === 'checkbox' ? el.checked : el.value;
        syncNoSpaceBtn();
        renderCode();
        saveSoon();
      };
      el.addEventListener('change', handler);
      if (el.type === 'text') el.addEventListener('input', handler);
    });

    /* 文件选择 */
    document.getElementById('fileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) applyFile(this.files[0]);
    });

    /* 拖拽导入 */
    var wrap = document.getElementById('gridWrap');
    wrap.addEventListener('dragover', function (e) { e.preventDefault(); });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) applyFile(e.dataTransfer.files[0]);
    });

    bindGrid();
    bindKeyboard();
  }

  /* ---------------- 网格交互 ---------------- */
  function bindGrid() {
    var gridEl = document.getElementById('grid');
    var dragging = false;

    gridEl.addEventListener('mousedown', function (e) {
      var pos = LT.grid.cellFromEvent(e);
      if (!pos) return;
      if (e.button !== 0) return;
      var mode = (e.ctrlKey || e.metaKey) ? 'add' : (e.shiftKey ? 'range' : 'single');
      state.sel.select(pos.r, pos.c, mode);
      dragging = mode !== 'add';
      paintSelection();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var pos = LT.grid.cellFromEvent(e);
      if (!pos) return;
      state.sel.dragTo(pos.r, pos.c);
      paintSelection();
    });

    document.addEventListener('mouseup', function () { dragging = false; });

    /* 输入：只更新模型，不重建网格（保留光标） */
    gridEl.addEventListener('input', function (e) {
      var inner = e.target.closest ? e.target.closest('.inner') : null;
      if (!inner) return;
      var r = +inner.dataset.r, c = +inner.dataset.c;
      var cell = state.doc.cells[r] && state.doc.cells[r][c];
      if (!cell) return;
      cell.t = inner.textContent;
      renderCodeSoon();
    });

    /* 粘贴：强制纯文本 */
    gridEl.addEventListener('paste', function (e) {
      var inner = e.target.closest ? e.target.closest('.inner') : null;
      if (!inner) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      text = text.replace(/\r?\n/g, ' ');
      document.execCommand('insertText', false, text);
    });

    /* 键盘导航 */
    gridEl.addEventListener('keydown', function (e) {
      var inner = e.target.closest ? e.target.closest('.inner') : null;
      if (!inner) return;
      var r = +inner.dataset.r, c = +inner.dataset.c;
      var nR = M.nRows(state.doc), nC = M.nCols(state.doc);

      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); moveFocus(r + 1, c); return; }
      if (e.key === 'Tab') { e.preventDefault(); moveFocus(r, c + (e.shiftKey ? -1 : 1)); return; }
      if (e.key === 'Escape') { inner.blur(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(r - 1, c); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(r + 1, c); return; }
      if (e.key === 'ArrowRight') {
        var off = LT.grid.caretOffset(inner), len = (inner.textContent || '').length;
        if (off >= len) { e.preventDefault(); moveFocus(r, c + 1); }
        return;
      }
      if (e.key === 'ArrowLeft') {
        var off2 = LT.grid.caretOffset(inner);
        if (off2 <= 0) { e.preventDefault(); moveFocus(r, c - 1); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        actions.selectAll();
        return;
      }
    });
  }

  function moveFocus(r, c) {
    var nR = M.nRows(state.doc), nC = M.nCols(state.doc);
    r = U.clamp(r, 0, nR - 1);
    c = U.clamp(c, 0, nC - 1);
    var cell = state.doc.cells[r][c];
    if (cell && cell.cov && cell.org) { r = cell.org.r; c = cell.org.c; }
    state.sel.select(r, c, 'single');
    paintSelection();
    LT.grid.focusCell(r, c, true);
  }

  /* ---------------- 全局快捷键 ---------------- */
  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      var t = e.target;
      var editing = t && t.classList && (t.classList.contains('inner') || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); downloadCurrent(); return; }
      if (mod && !editing && e.key.toLowerCase() === 'a') { e.preventDefault(); actions.selectAll(); return; }
      if (mod && editing && e.key.toLowerCase() === 'b') { e.preventDefault(); actions.fmt({ dataset: { v: 'b' } }); return; }
      if (mod && editing && e.key.toLowerCase() === 'i') { e.preventDefault(); actions.fmt({ dataset: { v: 'i' } }); return; }
      if (mod && editing && e.key.toLowerCase() === 'u') { e.preventDefault(); actions.fmt({ dataset: { v: 'u' } }); return; }
      if (e.key === '?') { /* noop */ }
    });
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
