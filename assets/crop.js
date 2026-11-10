/* ============================================================
 * 图片裁剪器（纯前端、零依赖）
 * 支持任意浏览器可解码的格式：PNG / JPEG / WebP / GIF / BMP / SVG / AVIF / ICO…
 * 输出可选 PNG / JPEG / WebP，可调质量与缩放。
 * 图片不落盘、不上传，全部在本机内存中处理。
 * ============================================================ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  /* ---------------- 状态 ---------------- */
  const S = {
    inited: false,
    img: null,          // 已按旋转烘焙好的 ImageBitmap/HTMLImageElement
    srcCanvas: null,    // 旋转后的源画布（真实像素）
    iw: 0, ih: 0,       // 源图像素尺寸
    dispW: 0, dispH: 0, // 画布显示尺寸（CSS px）
    ratio: 1,           // 显示尺寸 / 图像尺寸
    rect: null,         // 选区（图像像素坐标）
    ratioLock: null,    // null=自由，否则 number = w/h
    fileName: 'crop',
    format: 'image/png',
    quality: 0.92,
    userScale: 100,
    drag: null,
    lastBlob: null
  };

  /* ---------------- 工具 ---------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v) => Math.round(v * 1000) / 1000;

  function baseName(name) {
    return String(name || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'crop';
  }

  function extFor(mime) {
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'eps') return 'eps';
    return 'png';
  }
  const isEpsFormat = () => S.format === 'eps';

  /* ---------------- 载入图片 ---------------- */
  function loadFile(file) {
    if (!file) return;

    /* EPS / PS 走 PostScript 解码路径 */
    const looksEps = /\.(eps|epsf|epsi|ps)$/i.test(file.name || '') ||
      file.type === 'application/postscript' || file.type === 'image/x-eps';
    if (looksEps) {
      const fr = new FileReader();
      fr.onload = () => loadEps(fr.result, file.name);
      fr.onerror = () => toast('读取 EPS 文件失败');
      fr.readAsArrayBuffer(file);
      return;
    }

    if (!/^image\//.test(file.type) && !/\.(svg|ico|bmp|avif)$/i.test(file.name || '')) {
      toast('这个文件看起来不是图片：' + (file.name || file.type));
      return;
    }
    S.fileName = baseName(file.name);

    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const w = im.naturalWidth || im.width;
      const h = im.naturalHeight || im.height;
      if (!w || !h) {
        toast('无法获取图片尺寸（可能是缺少宽高的 SVG）');
        return;
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(im, 0, 0);
      adoptSource(c);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      toast('浏览器无法解码这个图片格式：' + (file.name || file.type));
    };
    im.src = url;
  }

  /* EPS 走专门的解码路径（浏览器不能直接渲染 PostScript） */
  function loadEps(arrayBuffer, fileName) {
    if (!window.EPS) { toast('EPS 模块未加载'); return; }
    S.fileName = baseName(fileName);
    const bytes = new Uint8Array(arrayBuffer);
    const srcName = { postscript: '矢量解释器', epsi: 'EPSI 内嵌预览', tiff: 'TIFF 内嵌预览' };

    toast('正在解析 EPS…');
    Promise.resolve()
      .then(() => window.EPS.decode(bytes, {}))
      .then((res) => {
        adoptSource(res.canvas);
        const via = srcName[res.source] || res.source;
        const extra = res.notes && res.notes.length ? '　' + res.notes[res.notes.length - 1] : '';
        toast('EPS 已载入（' + via + '，' + res.canvas.width + '×' + res.canvas.height + '）' + extra);
        const info = document.getElementById('cropInfo');
        if (info) info.dataset.eps = res.source;
        S.epsSource = res.source;
      })
      .catch((e) => {
        const msg = String(e && e.message ? e.message : e);
        toast(msg);
      });
  }

  /* 把一张画布作为新的源图（旋转也走这里） */
  function adoptSource(canvas, keepRect) {
    S.srcCanvas = canvas;
    S.iw = canvas.width;
    S.ih = canvas.height;
    if (!S.iw || !S.ih) { toast('图片尺寸为 0，无法处理'); return; }

    $('#cropDrop').hidden = true;
    $('#cropWork').hidden = false;

    layout();
    if (keepRect && S.rect) {
      S.rect = clampRect(S.rect);
    } else {
      S.rect = { x: 0, y: 0, w: S.iw, h: S.ih };
    }
    if (S.ratioLock) fitRatio();
    draw();
    syncInputs();
    preview();
  }

  /* 计算显示尺寸并绘制 */
  function layout() {
    const wrap = $('.crop-stage-wrap');
    const avail = wrap ? wrap.clientWidth : 800;
    const maxW = Math.max(240, avail - 4);
    const maxH = Math.max(240, Math.round(window.innerHeight * 0.62));
    const r = Math.min(maxW / S.iw, maxH / S.ih, 1);
    S.ratio = r;
    S.dispW = Math.max(1, Math.round(S.iw * r));
    S.dispH = Math.max(1, Math.round(S.ih * r));

    const cv = $('#cropCanvas');
    cv.width = S.dispW;
    cv.height = S.dispH;
    cv.style.width = S.dispW + 'px';
    cv.style.height = S.dispH + 'px';

    const stage = $('#cropStage');
    stage.style.width = S.dispW + 'px';
    stage.style.height = S.dispH + 'px';

    $('#cropInfo').textContent =
      `原图 ${S.iw} × ${S.ih}px　显示 ${Math.round(r * 100)}%`;
  }

  function draw() {
    const cv = $('#cropCanvas');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(S.srcCanvas, 0, 0, cv.width, cv.height);
    renderBox();
  }

  /* ---------------- 选区框渲染 ---------------- */
  function renderBox() {
    const box = $('#cropBox');
    if (!S.rect) { box.hidden = true; return; }
    box.hidden = false;
    const r = S.rect, k = S.ratio;
    box.style.left = (r.x * k) + 'px';
    box.style.top = (r.y * k) + 'px';
    box.style.width = (r.w * k) + 'px';
    box.style.height = (r.h * k) + 'px';

    const outW = Math.max(1, Math.round(r.w * S.userScale / 100));
    const outH = Math.max(1, Math.round(r.h * S.userScale / 100));
    $('#cropSize').textContent = `${Math.round(r.w)} × ${Math.round(r.h)}` +
      (S.userScale !== 100 ? ` → ${outW} × ${outH}` : '');
  }

  /* ---------------- 选区约束 ---------------- */
  function clampRect(r) {
    r.w = clamp(Math.round(r.w), 1, S.iw);
    r.h = clamp(Math.round(r.h), 1, S.ih);
    r.x = clamp(Math.round(r.x), 0, Math.max(0, S.iw - r.w));
    r.y = clamp(Math.round(r.y), 0, Math.max(0, S.ih - r.h));
    return r;
  }

  /* 手动输入时用「位置优先」约束：
     用户改 X/Y 时不希望被当前宽度挤回去，改为把宽高收缩到剩余空间。
     （鼠标拖拽仍走 clampRect：尺寸优先、位置受限） */
  function clampRectInput(r) {
    r.w = clamp(Math.round(r.w), 1, S.iw);
    r.h = clamp(Math.round(r.h), 1, S.ih);
    r.x = clamp(Math.round(r.x), 0, S.iw - 1);
    r.y = clamp(Math.round(r.y), 0, S.ih - 1);
    if (S.ratioLock) {
      r.h = Math.round(r.w / S.ratioLock);
      if (r.y + r.h > S.ih) { r.h = S.ih - r.y; r.w = Math.round(r.h * S.ratioLock); }
    }
    if (r.x + r.w > S.iw) r.w = S.iw - r.x;
    if (r.y + r.h > S.ih) r.h = S.ih - r.y;
    r.w = Math.max(1, r.w);
    r.h = Math.max(1, r.h);
    return r;
  }

  /* 按当前锁定比例把选区调整为最大可用 */
  function fitRatio() {
    if (!S.ratioLock || !S.rect) return;
    const a = S.ratioLock;
    let w = S.iw, h = w / a;
    if (h > S.ih) { h = S.ih; w = h * a; }
    w = Math.round(w); h = Math.round(h);
    const cx = S.rect.x + S.rect.w / 2, cy = S.rect.y + S.rect.h / 2;
    S.rect = clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  /* ---------------- 鼠标交互 ---------------- */
  function stagePoint(ev) {
    const stage = $('#cropStage');
    const b = stage.getBoundingClientRect();
    return {
      x: clamp((ev.clientX - b.left) / S.ratio, 0, S.iw),
      y: clamp((ev.clientY - b.top) / S.ratio, 0, S.ih)
    };
  }

  function onDown(ev) {
    if (!S.srcCanvas) return;
    const handle = ev.target.closest && ev.target.closest('.crop-h');
    const inside = ev.target.closest && ev.target.closest('#cropBox');
    const p = stagePoint(ev);

    if (handle) {
      S.drag = { mode: 'resize', h: handle.dataset.h, start: p, orig: Object.assign({}, S.rect) };
    } else if (inside) {
      S.drag = { mode: 'move', start: p, orig: Object.assign({}, S.rect) };
    } else {
      S.drag = { mode: 'new', start: p };
      S.rect = { x: p.x, y: p.y, w: 1, h: 1 };
    }
    ev.preventDefault();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onMove(ev) {
    if (!S.drag) return;
    const p = stagePoint(ev);
    const d = S.drag;

    if (d.mode === 'new') {
      let x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y);
      let w = Math.abs(p.x - d.start.x), h = Math.abs(p.y - d.start.y);
      let r = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
      if (S.ratioLock) {
        r.h = r.w / S.ratioLock;
        if (y + r.h > S.ih) { r.h = S.ih - y; r.w = r.h * S.ratioLock; }
        if (p.y < d.start.y) { r.y = d.start.y - r.h; }
      }
      S.rect = clampRect(r);
    } else if (d.mode === 'move') {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      S.rect = clampRect({ x: d.orig.x + dx, y: d.orig.y + dy, w: d.orig.w, h: d.orig.h });
    } else if (d.mode === 'resize') {
      S.rect = clampRect(resizeBy(d.h, d.orig, p, d.start));
    }
    draw(); syncInputs(); preview();
  }

  function onUp() {
    S.drag = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }

  /* 按手柄方向缩放 */
  function resizeBy(h, o, p, start) {
    let { x, y, w, h: hh } = o;
    const right = x + w, bottom = y + hh;
    let nx = x, ny = y, nw = w, nh = hh;

    if (h.includes('w')) { nx = clamp(p.x, 0, right - 1); nw = right - nx; }
    if (h.includes('e')) { nw = clamp(p.x - x, 1, S.iw - x); }
    if (h.includes('n')) { ny = clamp(p.y, 0, bottom - 1); nh = bottom - ny; }
    if (h.includes('s')) { nh = clamp(p.y - y, 1, S.ih - y); }

    let r = { x: nx, y: ny, w: nw, h: nh };

    if (S.ratioLock) {
      const a = S.ratioLock;
      /* 角柄：以宽为准；边柄：按被拖动的方向为准 */
      if (h.length === 2) {
        r.h = r.w / a;
        if (h.includes('n')) r.y = bottom - r.h;
        if (h.includes('w')) r.x = right - r.w;
      } else if (h === 'e' || h === 'w') {
        r.h = r.w / a;
        r.y = o.y + (o.h - r.h) / 2;
      } else {
        r.w = r.h * a;
        r.x = o.x + (o.w - r.w) / 2;
      }
      if (r.w > S.iw) { r.w = S.iw; r.h = r.w / a; }
      if (r.h > S.ih) { r.h = S.ih; r.w = r.h * a; }
    }
    return r;
  }

  /* ---------------- 输入框同步 ---------------- */
  function syncInputs() {
    if (!S.rect) return;
    $('#cropX').value = Math.round(S.rect.x);
    $('#cropY').value = Math.round(S.rect.y);
    $('#cropW').value = Math.round(S.rect.w);
    $('#cropH').value = Math.round(S.rect.h);
    renderBox();
  }

  function readInputs() {
    if (!S.srcCanvas) return;
    let x = Number($('#cropX').value) || 0;
    let y = Number($('#cropY').value) || 0;
    let w = Number($('#cropW').value) || 1;
    let h = Number($('#cropH').value) || 1;
    if (S.ratioLock) {
      /* 锁定比例时以高度为基准修正宽度，保持用户输入的比例语义 */
      w = Math.max(1, Math.round(h * S.ratioLock));
    }
    S.rect = clampRectInput({ x, y, w, h });
    draw(); syncInputs(); preview();
  }

  /* ---------------- 预览 ---------------- */
  let previewTimer = null;
  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(doPreview, 120);
  }

  function cropCanvas() {
    if (!S.rect || !S.srcCanvas) return null;
    const r = S.rect;
    const w = Math.max(1, Math.round(r.w));
    const h = Math.max(1, Math.round(r.h));
    const outW = Math.max(1, Math.round(w * S.userScale / 100));
    const outH = Math.max(1, Math.round(h * S.userScale / 100));

    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const g = c.getContext('2d');
    /* JPEG 没有透明通道，先铺白底，避免透明区域变黑 */
    if (S.format === 'image/jpeg') {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, outW, outH);
    }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(S.srcCanvas, Math.round(r.x), Math.round(r.y), w, h, 0, 0, outW, outH);
    return c;
  }

  function doPreview() {
    const c = cropCanvas();
    const box = $('#cropPreview');
    if (!c) return;
    const url = c.toDataURL('image/png');
    box.innerHTML = '';
    const im = new Image();
    im.src = url;
    im.alt = '裁剪预览';
    box.appendChild(im);
    const tag = document.createElement('span');
    tag.className = 'crop-preview-size';
    tag.textContent = `${c.width} × ${c.height}px`;
    box.appendChild(tag);

    if (isEpsFormat()) {
      S.lastBlob = null;
      $('#cropHint').textContent =
        `输出 ${c.width} × ${c.height}pt　EPS（点下方按钮时生成，矢量封装内嵌位图）`;
      return;
    }

    c.toBlob((blob) => {
      S.lastBlob = blob;
      if (blob) {
        $('#cropHint').textContent =
          `输出 ${c.width} × ${c.height}px　约 ${(blob.size / 1024).toFixed(1)} KB　${extFor(S.format).toUpperCase()}`;
      }
    }, S.format, S.quality);
  }

  /* ---------------- 下载 / 复制 ---------------- */
  function download() {
    const c = cropCanvas();
    if (!c) { toast('还没有选区'); return; }

    if (isEpsFormat()) {
      if (!window.EPS) { toast('EPS 模块未加载'); return; }
      const name = `${S.fileName}_crop.eps`;
      window.EPS.build(c, { title: S.fileName }).then((blob) => {
        saveBlob(blob, name, `已生成并下载 ${name}（${(blob.size / 1024).toFixed(1)} KB）`);
      }).catch((e) => toast('EPS 生成失败：' + (e && e.message ? e.message : e)));
      return;
    }

    c.toBlob((blob) => {
      if (!blob) { toast('导出失败，试试换个输出格式'); return; }
      saveBlob(blob, `${S.fileName}_crop.${extFor(S.format)}`);
    }, S.format, S.quality);
  }

  function saveBlob(blob, filename, msg) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(msg || ('已下载 ' + filename));
  }

  async function copyToClipboard() {
    try {
      if (!navigator.clipboard || !window.ClipboardItem) {
        toast('当前浏览器不支持复制图片，请用下载');
        return;
      }
      const c = cropCanvas();
      if (!c) { toast('还没有选区'); return; }
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('已复制到剪贴板（PNG）');
    } catch (e) {
      toast('复制失败：' + (e && e.message ? e.message : e));
    }
  }

  /* ---------------- 轻提示 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('cropToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cropToast';
      el.className = 'crop-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------------- 旋转 ---------------- */
  function rotate(dir) {
    if (!S.srcCanvas) return;
    const w = S.srcCanvas.width, h = S.srcCanvas.height;
    const c = document.createElement('canvas');
    c.width = h; c.height = w;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    g.rotate(dir * Math.PI / 2);
    g.drawImage(S.srcCanvas, -w / 2, -h / 2);
    /* 旋转后选区形状也转一下，尽量保留用户意图 */
    if (S.rect) {
      const r = S.rect;
      const nr = dir > 0
        ? { x: h - (r.y + r.h), y: r.x, w: r.h, h: r.w }
        : { x: r.y, y: w - (r.x + r.w), w: r.h, h: r.w };
      S.rect = nr;
    }
    adoptSource(c, true);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    const pick = () => $('#cropFile').click();
    $('#cropPick').addEventListener('click', pick);
    $('#cropPick2').addEventListener('click', pick);
    $('#cropFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFile(f);
      e.target.value = '';
    });

    /* 拖拽 */
    const drop = $('#cropDrop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, (e) => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, (e) => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    /* 工作区也接受拖放替换 */
    const work = $('#cropWork');
    work.addEventListener('dragover', (e) => e.preventDefault());
    work.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    /* 粘贴 */
    document.addEventListener('paste', (e) => {
      if (!document.getElementById('panel-crop')) return;
      if (!document.getElementById('panel-crop').classList.contains('active')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) { loadFile(f); e.preventDefault(); }
          return;
        }
      }
    });

    /* 舞台交互 */
    $('#cropStage').addEventListener('mousedown', onDown);

    /* 数值输入 */
    ['cropX', 'cropY', 'cropW', 'cropH'].forEach(id => {
      $('#' + id).addEventListener('change', readInputs);
      $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') readInputs(); });
    });

    /* 比例 */
    $('#cropRatios').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ratio]');
      if (!b) return;
      $$('#cropRatios .chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const v = b.dataset.ratio;
      S.ratioLock = v === 'free' ? null : (() => {
        const p = v.split(':');
        return Number(p[0]) / Number(p[1]);
      })();
      if (S.ratioLock) fitRatio();
      draw(); syncInputs(); preview();
    });

    $('#cropRatioApply').addEventListener('click', () => {
      const a = Number($('#cropRatioW').value), b = Number($('#cropRatioH').value);
      if (!a || !b) { toast('请输入宽和高的比例数值'); return; }
      S.ratioLock = a / b;
      $$('#cropRatios .chip').forEach(x => x.classList.remove('active'));
      fitRatio(); draw(); syncInputs(); preview();
    });

    /* 输出设置 */
    $('#cropFormat').addEventListener('change', (e) => {
      S.format = e.target.value;
      $('#cropQualityRow').hidden = (S.format === 'image/png' || S.format === 'eps');
      preview();
    });
    $('#cropQuality').addEventListener('input', (e) => {
      S.quality = Number(e.target.value);
      $('#cropQualityVal').textContent = Math.round(S.quality * 100) + '%';
      preview();
    });
    $('#cropScale').addEventListener('input', (e) => {
      S.userScale = clamp(Number(e.target.value) || 100, 10, 400);
      renderBox(); preview();
    });

    /* 操作按钮 */
    $('#cropDownload').addEventListener('click', download);
    $('#cropCopy').addEventListener('click', copyToClipboard);
    $('#cropRotateL').addEventListener('click', () => rotate(-1));
    $('#cropRotateR').addEventListener('click', () => rotate(1));
    $('#cropSelectAll').addEventListener('click', () => {
      if (!S.srcCanvas) return;
      S.rect = { x: 0, y: 0, w: S.iw, h: S.ih };
      if (S.ratioLock) fitRatio();
      draw(); syncInputs(); preview();
    });
    $('#cropReset').addEventListener('click', () => {
      if (!S.srcCanvas) return;
      const m = Math.round(Math.min(S.iw, S.ih) * 0.6);
      S.rect = clampRect({
        x: Math.round((S.iw - m) / 2), y: Math.round((S.ih - m) / 2), w: m, h: m
      });
      if (S.ratioLock) fitRatio();
      draw(); syncInputs(); preview();
    });
    $('#cropClear').addEventListener('click', () => {
      S.srcCanvas = null; S.img = null; S.rect = null; S.lastBlob = null;
      $('#cropWork').hidden = true;
      $('#cropDrop').hidden = false;
      $('#cropPreview').innerHTML = '<span>裁切后在此预览</span>';
      $('#cropHint').textContent = '格式与原图无关，按需要选择即可。';
    });

    /* 窗口尺寸变化时重排 */
    let rt = null;
    window.addEventListener('resize', () => {
      if (!S.srcCanvas) return;
      clearTimeout(rt);
      rt = setTimeout(() => { layout(); draw(); }, 150);
    });

    /* 键盘微调 */
    document.addEventListener('keydown', (e) => {
      const panel = document.getElementById('panel-crop');
      if (!panel || !panel.classList.contains('active')) return;
      if (!S.rect) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const step = e.shiftKey ? 10 : 1;
      let moved = false;
      if (e.key === 'ArrowLeft') { S.rect.x -= step; moved = true; }
      if (e.key === 'ArrowRight') { S.rect.x += step; moved = true; }
      if (e.key === 'ArrowUp') { S.rect.y -= step; moved = true; }
      if (e.key === 'ArrowDown') { S.rect.y += step; moved = true; }
      if (moved) {
        e.preventDefault();
        S.rect = clampRect(S.rect);
        draw(); syncInputs(); preview();
      }
    });
  }

  /* ---------------- 初始化（懒执行） ---------------- */
  function init() {
    if (S.inited) {
      /* 已经初始化过：面板重新显示时重排一次，避免隐藏时算出的尺寸为 0 */
      if (S.srcCanvas) { layout(); draw(); }
      return;
    }
    if (!$('#panel-crop')) return;
    S.inited = true;
    bind();
    /* 默认格式对应的质量行状态 */
    $('#cropQualityRow').hidden = true;
  }

  window.CropTool = { init: init, loadFile: loadFile };
})();
