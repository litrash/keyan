/* =========================================================
 * ui.js — toast / modal / popover / 颜色选择器
 * ======================================================= */
(function () {
  'use strict';
  var LT = window.LT;
  var U = LT.util;
  var ui = (LT.ui = {});

  /* ---------------- toast ---------------- */
  ui.toast = function (msg, ms) {
    var root = document.getElementById('toastRoot');
    var t = U.el('div', { class: 'toast', text: msg });
    root.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .2s, transform .2s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(function () { t.remove(); }, 220);
    }, ms || 1800);
  };

  /* ---------------- modal ---------------- */
  ui.modal = function (opts) {
    var root = document.getElementById('modalRoot');
    root.hidden = false;
    root.innerHTML = '';

    var head = U.el('div', { class: 'modal-head' }, [
      U.el('span', { text: opts.title || '' }),
      U.el('button', { class: 'iconbtn x', text: '✕', onclick: close })
    ]);

    var body = U.el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    var foot = U.el('div', { class: 'modal-foot' });
    var btns = opts.buttons || [{ label: '关闭' }];
    btns.forEach(function (b) {
      var cls = 'btn2' + (b.primary ? '' : ' ghost');
      var btn = U.el('button', { class: cls, text: b.label });
      btn.addEventListener('click', function () {
        var keep = b.onClick ? b.onClick(close) : undefined;
        if (keep !== false) close();
      });
      foot.appendChild(btn);
    });

    var modal = U.el('div', { class: 'modal' }, [head, body, foot]);
    root.appendChild(modal);

    if (opts.width) modal.style.width = opts.width;

    function close() {
      root.hidden = true;
      root.innerHTML = '';
      if (opts.onClose) opts.onClose();
    }

    root.addEventListener('mousedown', function (e) {
      if (e.target === root) close();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    var first = body.querySelector('input, textarea, select, button');
    if (first) setTimeout(function () { first.focus(); }, 30);

    return { close: close, body: body, modal: modal };
  };

  ui.confirm = function (title, message, onYes) {
    ui.modal({
      title: title,
      body: '<p style="margin:0;font-size:13px;line-height:1.6">' + U.escapeHtml(message) + '</p>',
      buttons: [
        { label: '取消' },
        { label: '确定', primary: true, onClick: function () { onYes(); } }
      ]
    });
  };

  /* ---------------- popover ---------------- */
  var popCloser = null;

  ui.closePopover = function () {
    var root = document.getElementById('popoverRoot');
    root.hidden = true;
    root.innerHTML = '';
    document.querySelectorAll('.menubtn.is-open').forEach(function (b) { b.classList.remove('is-open'); });
    if (popCloser) { document.removeEventListener('mousedown', popCloser, true); popCloser = null; }
  };

  ui.popover = function (anchor, config) {
    ui.closePopover();
    var root = document.getElementById('popoverRoot');
    root.hidden = false;
    root.innerHTML = '';

    var pop = U.el('div', { class: 'popover' });
    if (config.title) pop.appendChild(U.el('div', { class: 'ph', text: config.title }));

    (config.items || []).forEach(function (it) {
      if (it.sep) { pop.appendChild(U.el('div', { class: 'sep' })); return; }
      var kids = [];
      if (it.swatch) kids.push(U.el('span', { class: 'swatch', style: it.swatch }));
      kids.push(U.el('span', { text: it.label }));
      var b = U.el('button', { class: it.on ? 'is-on' : '' }, kids);
      if (it.title) b.title = it.title;
      b.addEventListener('click', function () {
        ui.closePopover();
        if (it.onPick) it.onPick();
      });
      pop.appendChild(b);
    });

    root.appendChild(pop);

    var rect = anchor.getBoundingClientRect();
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = rect.left;
    var top = rect.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    if (anchor.classList.contains('menubtn')) anchor.classList.add('is-open');

    popCloser = function (e) {
      if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) ui.closePopover();
    };
    setTimeout(function () { document.addEventListener('mousedown', popCloser, true); }, 0);

    return pop;
  };

  /* ---------------- 颜色选择器 ---------------- */
  var PRESETS = ['#000000', '#37474F', '#607D8B', '#9E9E9E', '#CFD8DC', '#FFFFFF',
    '#C62828', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1',
    '#1E88E5', '#3949AB', '#8E24AA', '#D81B60', '#6D4C41', '#827717'];

  ui.colorPicker = function (title, current, onPick) {
    var body = U.el('div');
    var chip = U.el('div', { class: 'chip' });
    var native = U.el('input', { type: 'color', value: current || '#ffffff', style: 'width:52px;height:36px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)' });
    var hex = U.el('input', { type: 'text', value: (current || '#FFFFFF').toUpperCase(), style: 'width:110px' });
    body.appendChild(U.el('div', { class: 'colorpreview' }, [chip, U.el('div', {}, [native, U.el('div', { style: 'height:6px' }), hex])]));

    var sw = U.el('div', { class: 'swatches' });
    PRESETS.forEach(function (c) {
      sw.appendChild(U.el('button', { style: 'background:' + c, title: c, onclick: function () { set(c); } }));
    });
    body.appendChild(U.el('div', { style: 'margin-top:14px;font-size:12px;color:var(--text3)', text: '预设颜色' }));
    body.appendChild(sw);

    function set(c) {
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
      chip.style.background = c;
      native.value = c;
      hex.value = c.toUpperCase();
    }
    set(current || '#FFFFFF');

    native.addEventListener('input', function () { set(native.value); });
    hex.addEventListener('input', function () {
      var v = hex.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v)) set(v[0] === '#' ? v : '#' + v);
    });

    ui.modal({
      title: title,
      width: '420px',
      body: body,
      buttons: [
        { label: '取消' },
        { label: '清除颜色', onClick: function () { onPick(null); } },
        { label: '应用', primary: true, onClick: function () { onPick(native.value.toUpperCase()); } }
      ]
    });
  };
})();
