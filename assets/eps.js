/* ============================================================
 * EPS 支持（纯前端、零依赖）
 *
 * 浏览器不能直接解码 EPS（它是 PostScript 程序，不是位图）。
 * 这里提供三条互补的路径：
 *   1) 有限 PostScript 解释器 —— 按矢量重绘，质量最好
 *   2) EPSI 内嵌预览（%%BeginPreview 十六进制位图）
 *   3) DOS-EPS 二进制头里的 TIFF 预览
 *
 * 另提供 build()：把裁剪结果封装成合法 EPS（Flate + ASCII85）。
 *
 * 已知限制（会在返回值里如实上报）：
 *   - 解释器只覆盖常见绘图子集，不支持图像算子(image/colorimage)、
 *     图案/渐变(shading/pattern)、裁剪路径以外的复杂特性、完整字体度量
 *   - 无预览且解释器失败时，只能提示用户先用 Ghostscript/Inkscape 转换
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 一、基础工具
   * ============================================================ */

  function isDelim(ch) {
    return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' ||
      ch === '\f' || ch === '\0' || ch === '%' || ch === '(' ||
      ch === ')' || ch === '<' || ch === '>' || ch === '[' ||
      ch === ']' || ch === '{' || ch === '}' || ch === '/';
  }

  function bytesToLatin1(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return s;
  }

  function hexToString(hex) {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    for (let i = 0; i + 1 < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
    }
    return out;
  }

  /* ============================================================
   * 二、PostScript 词法 + 语法
   * ============================================================ */

  function tokenize(src) {
    const out = [];
    let i = 0;
    const n = src.length;

    while (i < n) {
      const c = src[i];

      /* 注释到行尾 */
      if (c === '%') {
        while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0') { i++; continue; }

      /* 过程 { } 与数组 [ ] —— 必须产出 token，
         否则 parseBlocks 收不到，用户自定义过程与矩阵参数都会丢失 */
      if (c === '{' || c === '}' || c === '[' || c === ']') {
        out.push(c);
        i++;
        continue;
      }

      /* 字符串 ( ... ) */
      if (c === '(') {
        let depth = 1, j = i + 1, s = '';
        while (j < n && depth > 0) {
          const ch = src[j];
          if (ch === '\\') {
            const nx = src[j + 1];
            if (nx === '\n') { j += 2; continue; }
            if (nx === '\r') { j += (src[j + 2] === '\n') ? 3 : 2; continue; }
            if (nx >= '0' && nx <= '7') {
              let oct = '', k = j + 1;
              while (k < n && oct.length < 3 && src[k] >= '0' && src[k] <= '7') { oct += src[k]; k++; }
              s += String.fromCharCode(parseInt(oct, 8) & 0xFF);
              j = k; continue;
            }
            const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
            s += (map[nx] !== undefined ? map[nx] : nx);
            j += 2; continue;
          }
          if (ch === '(') { depth++; s += ch; j++; continue; }
          if (ch === ')') { depth--; if (depth === 0) { j++; break; } s += ch; j++; continue; }
          s += ch; j++;
        }
        out.push({ str: s });
        i = j;
        continue;
      }

      /* 字典括号 << >> */
      if (c === '<' && src[i + 1] === '<') { out.push('<<'); i += 2; continue; }
      if (c === '>' && src[i + 1] === '>') { out.push('>>'); i += 2; continue; }

      /* 十六进制字符串 < ... > */
      if (c === '<') {
        let j = i + 1, hex = '';
        while (j < n && src[j] !== '>') { hex += src[j]; j++; }
        out.push({ str: hexToString(hex) });
        i = j + 1;
        continue;
      }

      /* 名字 /name */
      if (c === '/') {
        let j = i + 1, name = '';
        while (j < n && !isDelim(src[j])) { name += src[j]; j++; }
        out.push({ name: name });
        i = j;
        continue;
      }

      /* 其它：数字或算子 */
      let j = i, tok = '';
      while (j < n && !isDelim(src[j])) { tok += src[j]; j++; }
      if (j === i) { i++; continue; }
      i = j;

      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) out.push(Number(tok));
      else out.push({ op: tok });
    }
    return out;
  }

  /* 把 { } 变成过程、[ ] 变成数组 */
  function parseBlocks(tokens) {
    let idx = 0;

    function readUntil(closer) {
      const arr = [];
      while (idx < tokens.length) {
        const t = tokens[idx];
        if (t === closer) { idx++; return arr; }
        if (t === '{') { idx++; arr.push({ proc: readUntil('}') }); continue; }
        if (t === '[') { idx++; arr.push({ arr: readUntil(']') }); continue; }
        if (t === '<<') { idx++; arr.push({ dict: readUntil('>>') }); continue; }
        arr.push(t);
        idx++;
      }
      return arr;
    }
    return readUntil(null);
  }

  /* 把 << /K V ... >> 的条目两两配对成对象 */
  function dictFromPairs(list) {
    const out = Object.create(null);
    for (let i = 0; i + 1 < list.length; i += 2) {
      const k = list[i], v = list[i + 1];
      if (k && k.name !== undefined) out[k.name] = v;
    }
    return out;
  }

  /* ============================================================
   * 三、图形状态
   * ============================================================ */

  function mul(m1, m2) {
    /* m1 ∘ m2 ：先应用 m2 再应用 m1 */
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function applyPt(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  function GState(ctx, bbox, scale) {
    this.ctx = ctx;
    this.bbox = bbox;
    this.scale = scale;
    this.ctm = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.lineWidth = 1;
    this.strokeColor = '#000';
    this.fillColor = '#000';
    this.dash = [];
    this.lineCap = 0;
    this.lineJoin = 0;
    this.font = { name: 'Helvetica', size: 12 };
    this.cp = [0, 0];      /* current point（用户坐标） */
    this.stack2 = [];      /* gsave 栈 */
  }

  /* 用户坐标 → 画布设备坐标 的完整矩阵 */
  GState.prototype.deviceMatrix = function () {
    const s = this.scale;
    const b = this.bbox;
    /* B: x' = s*x - b.llx*s ; y' = -s*y + b.ury*s */
    const B = [s, 0, 0, -s, -b.llx * s, b.ury * s];
    return mul(B, this.ctm);
  };

  GState.prototype.apply = function () {
    const m = this.deviceMatrix();
    this.ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    this.ctx.lineWidth = Math.max(0.1, this.lineWidth);
    this.ctx.lineCap = ['butt', 'round', 'square'][this.lineCap] || 'butt';
    this.ctx.lineJoin = ['miter', 'round', 'bevel'][this.lineJoin] || 'miter';
    this.ctx.strokeStyle = this.strokeColor;
    this.ctx.fillStyle = this.fillColor;
    try { this.ctx.setLineDash(this.dash || []); } catch (e) { /* 忽略 */ }
  };

  GState.prototype.save = function () {
    this.stack2.push({
      ctm: this.ctm.slice(),
      lineWidth: this.lineWidth,
      strokeColor: this.strokeColor,
      fillColor: this.fillColor,
      dash: this.dash.slice(),
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      font: { name: this.font.name, size: this.font.size },
      cp: this.cp.slice()
    });
  };

  GState.prototype.restore = function () {
    const s = this.stack2.pop();
    if (!s) return;
    this.ctm = s.ctm;
    this.lineWidth = s.lineWidth;
    this.strokeColor = s.strokeColor;
    this.fillColor = s.fillColor;
    this.dash = s.dash;
    this.lineCap = s.lineCap;
    this.lineJoin = s.lineJoin;
    this.font = s.font;
    this.cp = s.cp;
    this.ctx.restore && 0;
  };

  /* ============================================================
   * 四之前：内嵌图像（image 算子）支持
   *   EPS 里常见 /DataSource currentfile 的图像，数据跟在 image 之后。
   *   这里先扫描出所有 image 字典与数据起始位置，预先解码成像素，
   *   执行到 image 时按顺序取用（同步绘制）。
   * ============================================================ */

  function ascii85ToBytes(text, start) {
    const out = [];
    let tuple = [];
    let i = start;

    const flush = (count) => {
      let n = 0;
      for (const t of tuple) n = n * 85 + t;
      const bytes = [
        Math.floor(n / 16777216) & 255,
        Math.floor(n / 65536) & 255,
        Math.floor(n / 256) & 255,
        n & 255
      ];
      for (let k = 0; k < count; k++) out.push(bytes[k]);
    };

    while (i < text.length) {
      const ch = text[i++];
      if (ch === '~') { if (text[i] === '>') i++; break; }
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f') continue;
      if (ch === 'z') { out.push(0, 0, 0, 0); continue; }
      const v = ch.charCodeAt(0) - 33;
      if (v < 0 || v > 84) continue;
      tuple.push(v);
      if (tuple.length === 5) { flush(4); tuple = []; }
    }
    if (tuple.length > 1) {
      const m = tuple.length;
      while (tuple.length < 5) tuple.push(84);
      flush(m - 1);
    }
    return out;
  }

  function asciiHexToBytes(text, start) {
    const out = [];
    let hex = '';
    let i = start;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '>') break;
      if (/[0-9a-fA-F]/.test(ch)) {
        hex += ch;
        if (hex.length === 2) { out.push(parseInt(hex, 16)); hex = ''; }
      }
    }
    if (hex.length === 1) out.push(parseInt(hex + '0', 16));
    return out;
  }

  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 FlateDecode');
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function numOf(v, dflt) {
    if (typeof v === 'number') return v;
    if (v && v.n !== undefined) return Number(v.n) || dflt;
    return dflt;
  }

  /* 从 token 或栈值里取出名字。
     注意：词法器产出的名字 token 是 {name}，入栈后才是 {n}，
     解析字典时拿到的是 token，必须用 .name。 */
  function tokName(x) {
    if (x == null) return null;
    if (x.name !== undefined) return x.name;
    if (x.n !== undefined) return x.n;
    if (typeof x === 'string') return x;
    return null;
  }

  function tokOp(x) {
    if (x == null) return null;
    if (x.op !== undefined) return x.op;
    return null;
  }

  /* 专门解析图像字典。
     注意 /DataSource 的值不是单个 token：`currentfile /ASCII85Decode filter`
     是一条过滤器链，必须单独吞掉，否则后面的键值会整体错位、Filter 丢失。 */
  function parseImageDict(list) {
    const out = Object.create(null);
    let filters = [];
    let i = 0;

    while (i < list.length) {
      const t = list[i];
      const key = tokName(t);
      if (key === null) { i++; continue; }

      const v = list[i + 1];

      if (key === 'Filter' || key === 'F') {
        if (v && v.arr) {
          filters = v.arr.map(tokName).filter(Boolean);
        } else {
          const one = tokName(v);
          if (one) filters = [one];
        }
        i += 2;
        continue;
      }

      if (key === 'DataSource') {
        let j = i + 1;
        const chain = [];
        /* `currentfile` 在正文里是算子 token */
        const isCurrentFile = tokName(v) === 'currentfile' || tokOp(v) === 'currentfile';
        if (isCurrentFile) {
          j = i + 2;
          while (j + 1 < list.length) {
            const a = list[j], b = list[j + 1];
            const fname = tokName(a);
            const kw = tokOp(b) || tokName(b);
            if (fname && kw === 'filter') { chain.push(fname); j += 2; }
            else break;
          }
        }
        out.FileSource = true;
        if (chain.length) filters = chain;
        i = j;
        continue;
      }

      out[key] = v;
      i += 2;
    }

    out._filters = filters;
    return out;
  }

  function filterList(d) {
    if (d && Array.isArray(d._filters)) return d._filters;
    const f = d.Filter !== undefined ? d.Filter : d.F;
    if (f === undefined) return [];
    if (f && f.arr) return f.arr.map(tokName).filter(Boolean);
    const one = tokName(f);
    return one ? [one] : [];
  }

  /* 扫描文本中所有 `<<...>> image`，返回字典与数据起点 */
  function indexImages(text) {
    const out = [];
    const re = /(?:^|[^A-Za-z0-9\/])(image)\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const imgPos = m.index + m[0].indexOf('image');
      const closeIdx = text.lastIndexOf('>>', imgPos);
      if (closeIdx < 0) continue;

      /* lastIndexOf 返回 `>>` 的首字符位置；配对检测按「以 i 结尾」判断，
         所以从 closeIdx+1（第二个 >）开始往回扫 */
      let i = closeIdx + 1, depth = 0, openIdx = -1;
      while (i >= 1) {
        if (text[i] === '>' && text[i - 1] === '>') { depth++; i -= 2; continue; }
        if (text[i] === '<' && text[i - 1] === '<') {
          const pairStart = i - 1;      /* 指向 `<<` 的第一个 < */
          depth--;
          i -= 2;
          if (depth === 0) { openIdx = pairStart; break; }
          continue;
        }
        i--;
      }
      if (openIdx < 0) continue;

      const inner = text.slice(openIdx + 2, closeIdx);
      let pairs;
      try { pairs = parseImageDict(parseBlocks(tokenize(inner))); } catch (e) { pairs = {}; }

      let p = imgPos + 5;
      while (p < text.length && /[\s]/.test(text[p])) p++;

      out.push({ dict: pairs, dataStart: p });
      if (out.length > 64) break;
    }
    return out;
  }

  async function prepareImages(text) {
    const found = indexImages(text);
    const result = [];

    for (const item of found) {
      const d = item.dict || {};
      const width = numOf(d.Width, 0);
      const height = numOf(d.Height, 0);
      if (!width || !height || width > 20000 || height > 20000) { result.push(null); continue; }

      const bpc = numOf(d.BitsPerComponent, 8);
      const spp = numOf(d.SamplesPerPixel, 3);
      const im = d.ImageMatrix && d.ImageMatrix.arr ? d.ImageMatrix.arr.map(v => numOf(v, 0)) : [1, 0, 0, 1, 0, 1];
      const filters = filterList(d);

      let bytes = null;
      try {
        if (filters[0] === 'ASCII85Decode') {
          bytes = ascii85ToBytes(text, item.dataStart);
          if (filters[1] === 'FlateDecode') bytes = await inflate(new Uint8Array(bytes));
        } else if (filters[0] === 'ASCIIHexDecode') {
          bytes = asciiHexToBytes(text, item.dataStart);
          if (filters[1] === 'FlateDecode') bytes = await inflate(new Uint8Array(bytes));
        } else {
          /* 无过滤器：按字节原样读 */
          const need = width * height * spp * (bpc / 8);
          const slice = text.slice(item.dataStart, item.dataStart + need);
          bytes = [];
          for (let k = 0; k < slice.length; k++) bytes.push(slice.charCodeAt(k) & 255);
        }
      } catch (e) {
        result.push(null);
        continue;
      }

      if (!bytes || !bytes.length) { result.push(null); continue; }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext('2d');
      const imgData = g.createImageData(width, height);
      const px = imgData.data;

      if (bpc === 8 && spp >= 3) {
        for (let k = 0, s = 0, o = 0; k < width * height; k++, s += spp, o += 4) {
          px[o] = bytes[s] || 0;
          px[o + 1] = bytes[s + 1] || 0;
          px[o + 2] = bytes[s + 2] || 0;
          px[o + 3] = 255;
        }
      } else if (bpc === 8) {
        for (let k = 0, s = 0, o = 0; k < width * height; k++, s++, o += 4) {
          const v = bytes[s] || 0;
          px[o] = px[o + 1] = px[o + 2] = v;
          px[o + 3] = 255;
        }
      } else {
        result.push(null);
        continue;
      }
      g.putImageData(imgData, 0, 0);
      result.push({ width: width, height: height, canvas: canvas, imageMatrix: im });
    }
    return result;
  }

  /* ============================================================
   * 四、解释器
   * ============================================================ */

  const FONT_MAP = {
    helvetica: 'Helvetica, Arial, sans-serif',
    times: '"Times New Roman", Times, serif',
    courier: '"Courier New", Courier, monospace',
    symbol: 'Symbol, serif',
    zapfdingbats: 'serif'
  };

  function fontFamily(name) {
    const k = String(name || 'Helvetica').toLowerCase().replace(/[-_]/g, '');
    for (const key in FONT_MAP) if (k.indexOf(key) === 0 || k.indexOf(key) >= 0) return FONT_MAP[key];
    return 'Helvetica, Arial, sans-serif';
  }

  function Interp(text, ctx, bbox, scale, images) {
    this.tokens = parseBlocks(tokenize(text));
    this.stack = [];
    this.dict = Object.create(null);
    this.g = new GState(ctx, bbox, scale);
    this.budget = 4000000;
    this.unknown = Object.create(null);
    this.ops = buildOps(this);
    this.ctx = ctx;
    this.pathStarted = false;
    this.dirty = false;
    this.lastPathBBox = null;
    this.hasPainted = false;
    this.images = images || [];
    this.imgIdx = 0;
  }

  Interp.prototype.run = function () {
    try { this.exec(this.tokens); } catch (e) { this.err = e && e.message; }
    return this;
  };

  Interp.prototype.exec = function (arr) {
    for (let i = 0; i < arr.length; i++) {
      if (--this.budget <= 0) throw new Error('执行步数超限（可能是死循环）');
      this.step(arr[i]);
    }
  };

  Interp.prototype.execProc = function (p) {
    if (p && p.proc) this.exec(p.proc);
  };

  Interp.prototype.step = function (t) {
    if (t === null || t === undefined) return;

    if (typeof t === 'number') { this.stack.push(t); return; }
    if (t.str !== undefined) { this.stack.push(t.str); return; }
    if (t.name !== undefined) { this.stack.push({ n: t.name }); return; }
    if (t.proc !== undefined) { this.stack.push(t); return; }
    if (t.arr !== undefined) { this.stack.push(t.arr); return; }
    if (t.dict !== undefined) { this.stack.push({ d: dictFromPairs(t.dict) }); return; }

    if (t.op === undefined) return;

    const name = t.op;
    const fn = this.ops[name];
    if (fn) { fn.call(this); return; }

    /* 用户定义的过程 / 变量 */
    const v = this.dict[name];
    if (v !== undefined) {
      if (v && v.proc) this.exec(v.proc);
      else this.stack.push(v);
      return;
    }
    /* 未知算子：记录后忽略 */
    this.unknown[name] = (this.unknown[name] || 0) + 1;
  };

  Interp.prototype.popNum = function () {
    const v = this.stack.pop();
    if (typeof v === 'number') return v;
    if (v && v.n) return 0;
    return Number(v) || 0;
  };
  Interp.prototype.popArr = function () {
    const v = this.stack.pop();
    if (Array.isArray(v)) return v;
    if (v && v.arr) return v.arr;
    return [];
  };
  Interp.prototype.popName = function () {
    const v = this.stack.pop();
    if (v && v.n) return v.n;
    if (typeof v === 'string') return v;
    return '';
  };

  function buildOps(I) {
    const g = () => I.g;
    const ctx = () => I.ctx;
    const num = () => I.popNum();

    const ops = {};

    /* ---------- 栈 ---------- */
    ops.dup = function () { const v = this.stack[this.stack.length - 1]; this.stack.push(v); };
    ops.pop = function () { this.stack.pop(); };
    ops.exch = function () {
      const a = this.stack.pop(), b = this.stack.pop();
      this.stack.push(a); this.stack.push(b);
    };
    ops.index = function () {
      const i = Math.round(num());
      const v = this.stack[this.stack.length - 1 - i];
      this.stack.push(v);
    };
    ops.copypop = function () { };
    ops.copy = function () {
      const n = Math.round(num());
      const src = this.stack.slice(this.stack.length - n);
      for (const v of src) this.stack.push(v);
    };
    ops.roll = function () {
      const j = Math.round(num()), n = Math.round(num());
      if (n <= 1) return;
      const start = this.stack.length - n;
      const part = this.stack.splice(start, n);
      const k = ((j % n) + n) % n;
      this.stack.push.apply(this.stack, part.slice(n - k).concat(part.slice(0, n - k)));
    };
    ops.clear = function () { this.stack.length = 0; };
    ops.count = function () { this.stack.push(this.stack.length); };
    ops["true"] = function () { this.stack.push(1); };
    ops["false"] = function () { this.stack.push(0); };

    /* ---------- 算术 ---------- */
    const bin = (f) => function () { const b = num(), a = num(); this.stack.push(f(a, b)); };
    ops.add = bin((a, b) => a + b);
    ops.sub = bin((a, b) => a - b);
    ops.mul = bin((a, b) => a * b);
    ops.div = bin((a, b) => (b === 0 ? 0 : a / b));
    ops.idiv = bin((a, b) => (b === 0 ? 0 : Math.trunc(a / b)));
    ops.mod = bin((a, b) => (b === 0 ? 0 : a % b));
    ops.neg = function () { this.stack.push(-num()); };
    ops.abs = function () { this.stack.push(Math.abs(num())); };
    ops.ceiling = function () { this.stack.push(Math.ceil(num())); };
    ops.floor = function () { this.stack.push(Math.floor(num())); };
    ops.round = function () { this.stack.push(Math.round(num())); };
    ops.truncate = function () { this.stack.push(Math.trunc(num())); };
    ops.sqrt = function () { this.stack.push(Math.sqrt(Math.abs(num()))); };
    ops.sin = function () { this.stack.push(Math.sin(num() * Math.PI / 180)); };
    ops.cos = function () { this.stack.push(Math.cos(num() * Math.PI / 180)); };
    ops.atan = function () {
      const x = num(), y = num();
      let d = Math.atan2(y, x) * 180 / Math.PI;
      if (d < 0) d += 360;
      this.stack.push(d);
    };
    ops.exp = bin((a, b) => Math.pow(a, b));
    ops.ln = function () { this.stack.push(Math.log(Math.abs(num()))); };
    ops.log = function () { this.stack.push(Math.log(Math.abs(num())) / Math.LN10); };

    /* ---------- 比较 / 逻辑 ---------- */
    const cmp = (f) => function () {
      const b = this.stack.pop(), a = this.stack.pop();
      const toN = (v) => (typeof v === 'number' ? v : (v && v.n ? v.n : v));
      a = toN(a); b = toN(b);
      this.stack.push(f(a, b) ? 1 : 0);
    };
    ops.eq = cmp((a, b) => String(a) === String(b));
    ops.ne = cmp((a, b) => String(a) !== String(b));
    ops.gt = cmp((a, b) => a > b);
    ops.ge = cmp((a, b) => a >= b);
    ops.lt = cmp((a, b) => a < b);
    ops.le = cmp((a, b) => a <= b);
    ops.and = cmp((a, b) => a && b);
    ops.or = cmp((a, b) => a || b);
    ops.not = function () { this.stack.push(num() ? 0 : 1); };

    /* ---------- 字典 / 名字 ---------- */
    ops.def = function () {
      const val = this.stack.pop();
      const name = I.popName();
      if (name) this.dict[name] = val;
    };
    ops.bind = function () { };
    ops.dict = function () { num(); this.stack.push({}); };
    ops.begin = function () { this.stack.pop(); };
    ops.end = function () { };
    ops.currentdict = function () { this.stack.push({}); };
    ops.where = function () { this.stack.pop(); this.stack.push(0); };
    ops.load = function () { const n = I.popName(); this.stack.push(this.dict[n]); };
    ops.store = function () { const v = this.stack.pop(); const n = I.popName(); this.dict[n] = v; };
    ops.exec = function () { const p = this.stack.pop(); if (p && p.proc) this.exec(p.proc); };
    ops.xcheck = function () { this.stack.pop(); this.stack.push(1); };

    /* ---------- 控制流 ---------- */
    ops["if"] = function () { const p = this.stack.pop(); const c = num(); if (c) this.execProc(p); };
    ops.ifelse = function () {
      const p2 = this.stack.pop(), p1 = this.stack.pop(), c = num();
      this.execProc(c ? p1 : p2);
    };
    ops["for"] = function () {
      const p = this.stack.pop();
      const end = num(), inc = num(), start = num();
      if (!inc) return;
      let guard = 0;
      if (inc > 0) { for (let v = start; v <= end + 1e-9; v += inc) { this.stack.push(v); this.execProc(p); if (++guard > 200000) break; } }
      else { for (let v = start; v >= end - 1e-9; v += inc) { this.stack.push(v); this.execProc(p); if (++guard > 200000) break; } }
    };
    ops.repeat = function () {
      const p = this.stack.pop();
      let n = Math.round(num());
      if (n > 200000) n = 200000;
      for (let k = 0; k < n; k++) this.execProc(p);
    };
    ops.loop = function () {
      const p = this.stack.pop();
      for (let k = 0; k < 200000; k++) {
        this.execProc(p);
        if (this._stopped) { this._stopped = false; break; }
      }
    };
    ops.exit = function () { this._stopped = true; };
    ops.stop = function () { this._stopped = true; };
    ops.quit = function () { this._stopped = true; this.budget = 0; };

    /* ---------- 图状态 ---------- */
    ops.gsave = function () { g().save(); };
    ops.grestore = function () { g().restore(); g().apply(); };
    ops.grestoreall = function () { while (g().stack2.length) g().restore(); g().apply(); };
    ops.newpath = function () { ctx().beginPath(); I.pathStarted = false; };
    ops.initgraphics = function () {
      g().ctm = [1, 0, 0, 1, 0, 0];
      g().lineWidth = 1; g().stack2.length = 0;
      g().apply(); ctx().beginPath();
    };
    ops.setlinewidth = function () { g().lineWidth = num(); g().apply(); };
    ops.setlinecap = function () { g().lineCap = Math.round(num()); g().apply(); };
    ops.setlinejoin = function () { g().lineJoin = Math.round(num()); g().apply(); };
    ops.setmiterlimit = function () { num(); };
    ops.setdash = function () {
      const off = num();
      const arr = I.popArr().filter(v => typeof v === 'number' && v >= 0);
      g().dash = arr.length ? arr.map(v => Math.max(0.1, v)).concat([Math.max(0.1, off)]) : [];
      g().apply();
    };

    const gray = function () {
      const v = Math.max(0, Math.min(1, num()));
      const c = Math.round(v * 255);
      return 'rgb(' + c + ',' + c + ',' + c + ')';
    };
    ops.setgray = function () { const c = gray(); g().strokeColor = c; g().fillColor = c; g().apply(); };
    ops.setrgbcolor = function () {
      const b = Math.max(0, Math.min(1, num())), gg = Math.max(0, Math.min(1, num())), r = Math.max(0, Math.min(1, num()));
      const c = 'rgb(' + Math.round(r * 255) + ',' + Math.round(gg * 255) + ',' + Math.round(b * 255) + ')';
      g().strokeColor = c; g().fillColor = c; g().apply();
    };
    ops.setcmykcolor = function () {
      const k = num(), y = num(), m = num(), c = num();
      const f = (v) => Math.round((1 - Math.min(1, v + k)) * 255);
      const col = 'rgb(' + f(c) + ',' + f(m) + ',' + f(y) + ')';
      g().strokeColor = col; g().fillColor = col; g().apply();
    };
    ops.sethsbcolor = function () {
      const b = Math.max(0, Math.min(1, num())), s = Math.max(0, Math.min(1, num())), h = num();
      /* HSB → RGB */
      const i = Math.floor(((h % 360) / 60)), f = ((h % 360) / 60) - i;
      const p = b * (1 - s), q = b * (1 - s * f), t = b * (1 - s * (1 - f));
      let r, gg, bb;
      switch (i % 6) {
        case 0: r = b; gg = t; bb = p; break;
        case 1: r = q; gg = b; bb = p; break;
        case 2: r = p; gg = b; bb = t; break;
        case 3: r = p; gg = q; bb = b; break;
        case 4: r = t; gg = p; bb = b; break;
        default: r = b; gg = p; bb = q;
      }
      const col = 'rgb(' + Math.round(r * 255) + ',' + Math.round(gg * 255) + ',' + Math.round(bb * 255) + ')';
      g().strokeColor = col; g().fillColor = col; g().apply();
    };

    /* ---------- 坐标变换 ---------- */
    ops.translate = function () {
      const ty = num(), tx = num();
      g().ctm = mul(g().ctm, [1, 0, 0, 1, tx, ty]); g().apply();
    };
    ops.scale = function () {
      const sy = num(), sx = num();
      g().ctm = mul(g().ctm, [sx, 0, 0, sy, 0, 0]); g().apply();
    };
    ops.rotate = function () {
      const a = num() * Math.PI / 180;
      const c = Math.cos(a), s = Math.sin(a);
      g().ctm = mul(g().ctm, [c, s, -s, c, 0, 0]); g().apply();
    };
    ops.concat = function () {
      const m = I.popArr();
      if (m.length >= 6) g().ctm = mul(g().ctm, m.slice(0, 6)); g().apply();
    };
    ops.transform = function () {
      const y = num(), x = num();
      const p = applyPt(I.g.deviceMatrix(), x, y);
      this.stack.push(p[0]); this.stack.push(p[1]);
    };
    ops.itransform = function () {
      const y = num(), x = num();
      const m = I.g.deviceMatrix();
      const det = m[0] * m[3] - m[1] * m[2] || 1;
      const dx = x - m[4], dy = y - m[5];
      this.stack.push((m[3] * dx - m[2] * dy) / det);
      this.stack.push((-m[1] * dx + m[0] * dy) / det);
    };

    /* ---------- 路径 ---------- */
    ops.moveto = function () {
      const y = num(), x = num();
      g().cp = [x, y];
      ctx().moveTo(x, y);
      I.pathStarted = true;
    };
    ops.rmoveto = function () {
      const dy = num(), dx = num();
      const nx = g().cp[0] + dx, ny = g().cp[1] + dy;
      g().cp = [nx, ny];
      ctx().moveTo(nx, ny);
      I.pathStarted = true;
    };
    ops.lineto = function () {
      const y = num(), x = num();
      g().cp = [x, y];
      ctx().lineTo(x, y);
      I.pathStarted = true;
    };
    ops.rlineto = function () {
      const dy = num(), dx = num();
      const nx = g().cp[0] + dx, ny = g().cp[1] + dy;
      g().cp = [nx, ny];
      ctx().lineTo(nx, ny);
      I.pathStarted = true;
    };
    ops.curveto = function () {
      const y3 = num(), x3 = num(), y2 = num(), x2 = num(), y1 = num(), x1 = num();
      ctx().bezierCurveTo(x1, y1, x2, y2, x3, y3);
      g().cp = [x3, y3];
      I.pathStarted = true;
    };
    ops.rcurveto = function () {
      const dy3 = num(), dx3 = num(), dy2 = num(), dx2 = num(), dy1 = num(), dx1 = num();
      const c = g().cp;
      ctx().bezierCurveTo(c[0] + dx1, c[1] + dy1, c[0] + dx2, c[1] + dy2, c[0] + dx3, c[1] + dy3);
      g().cp = [c[0] + dx3, c[1] + dy3];
      I.pathStarted = true;
    };
    ops.closepath = function () { ctx().closePath(); I.pathStarted = true; };
    ops.currentpoint = function () {
      this.stack.push(g().cp[0]); this.stack.push(g().cp[1]);
    };

    const arcTo = function (clockwise) {
      const ang2 = num(), ang1 = num(), r = num(), y = num(), x = num();
      const a1 = ang1 * Math.PI / 180, a2 = ang2 * Math.PI / 180;
      if (clockwise) ctx().arc(x, y, Math.abs(r), a2, a1, false);
      else ctx().arc(x, y, Math.abs(r), a1, a2, false);
      g().cp = [x + Math.abs(r) * Math.cos(a2), y + Math.abs(r) * Math.sin(a2)];
      I.pathStarted = true;
    };
    ops.arc = function () { arcTo.call(this, false); };
    ops.arcn = function () { arcTo.call(this, true); };

    /* ---------- 绘制 ---------- */
    const doStroke = function () {
      g().apply();
      ctx().stroke();
      I.hasPainted = true;
      I.dirty = true;
    };
    const doFill = function (rule) {
      g().apply();
      ctx().fill(rule || 'nonzero');
      I.hasPainted = true;
      I.dirty = true;
    };
    ops.stroke = doStroke;
    ops.fill = function () { doFill('nonzero'); };
    ops.eofill = function () { doFill('evenodd'); };
    ops.clip = function () { g().apply(); ctx().clip(); };
    ops.eoclip = function () { g().apply(); ctx().clip('evenodd'); };
    ops.rectfill = function () {
      const h = num(), w = num(), y = num(), x = num();
      g().apply();
      ctx().fillRect(x, y, w, h);
      I.hasPainted = true;
    };
    ops.rectstroke = function () {
      const h = num(), w = num(), y = num(), x = num();
      g().apply();
      ctx().strokeRect(x, y, w, h);
      I.hasPainted = true;
    };
    ops.erasepage = function () {
      const m = I.g.deviceMatrix();
      ctx().save();
      ctx().setTransform(1, 0, 0, 1, 0, 0);
      ctx().fillStyle = '#fff';
      ctx().fillRect(0, 0, ctx().canvas.width, ctx().canvas.height);
      ctx().restore();
      ctx().setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    };
    ops.showpage = function () { };

    /* ---------- 文字 ---------- */
    ops.findfont = function () {
      const n = I.popName();
      this.stack.push({ font: { name: n, size: 12 } });
    };
    ops.scalefont = function () {
      const size = num();
      const f = this.stack.pop();
      const name = (f && f.font && f.font.name) || 'Helvetica';
      this.stack.push({ font: { name: name, size: size } });
    };
    ops.makefont = function () {
      const n = I.popName();
      this.stack.push({ font: { name: n, size: 12 } });
    };
    ops.setfont = function () {
      const f = this.stack.pop();
      if (f && f.font) this.g.font = { name: f.font.name, size: f.font.size };
    };
    ops.setfontsize = function () { this.g.font.size = num(); };
    ops.stringwidth = function () {
      const str = this.stack.pop();
      const sz = this.g.font.size;
      this.stack.push(String(str == null ? '' : str).length * sz * 0.5);
      this.stack.push(sz);
    };
    ops.charpath = function () { this.stack.pop(); };

    ops.show = function () {
      const s = this.stack.pop();
      const text = String(s == null ? '' : s);
      if (!text) return;
      const m = I.g.deviceMatrix();
      const p = applyPt(m, I.g.cp[0], I.g.cp[1]);
      /* 设备空间下的字号（纵向缩放） */
      const sy = Math.hypot(m[1], m[3]) || 1;
      const sx = Math.hypot(m[0], m[2]) || 1;
      const sizeDevice = I.g.font.size * sy;

      ctx().save();
      ctx().setTransform(1, 0, 0, 1, 0, 0);
      ctx().font = Math.max(1, sizeDevice) + 'px ' + fontFamily(I.g.font.name);
      ctx().textBaseline = 'alphabetic';
      ctx().fillStyle = I.g.fillColor;
      ctx().fillText(text, p[0], p[1]);

      const w = ctx().measureText(text).width;
      ctx().restore();
      ctx().setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

      I.g.cp = [I.g.cp[0] + (w / (sx || 1)), I.g.cp[1]];
      I.hasPainted = true;
    };
    ops.ashow = function () {
      const ay = num(), ax = num();
      ops.show.call(this);
      I.g.cp = [I.g.cp[0] + ax, I.g.cp[1] + ay];
    };
    ops.widthshow = function () {
      const arr = I.popArr();
      const str = this.stack.pop();
      const m = I.g.deviceMatrix();
      const p = applyPt(m, I.g.cp[0], I.g.cp[1]);
      const sy = Math.hypot(m[1], m[3]) || 1;
      const sx = Math.hypot(m[0], m[2]) || 1;
      ctx().save();
      ctx().setTransform(1, 0, 0, 1, 0, 0);
      ctx().font = Math.max(1, I.g.font.size * sy) + 'px ' + fontFamily(I.g.font.name);
      ctx().fillStyle = I.g.fillColor;
      let x = p[0];
      for (let k = 0; k < arr.length; k++) {
        const w = arr[k];
        if (typeof w === 'number') { x += w * (k % 2 === 0 ? sx : sy); continue; }
        const t = String(w);
        ctx().fillText(t, x, p[1]);
        x += ctx().measureText(t).width;
      }
      ctx().restore();
      ctx().setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      I.g.cp = [I.g.cp[0] + (x - p[0]) / (sx || 1), I.g.cp[1]];
      I.hasPainted = true;
    };

    /* ---------- 内嵌图像 ---------- */
    ops.image = function () {
      this.stack.pop();                    /* 弹出图像字典 */
      const meta = I.images[I.imgIdx++];
      if (!meta) { I.unknown['image(未解码)'] = 1; return; }

      const full = mul(I.g.ctm, meta.imageMatrix);
      const s = I.g.scale, b = I.g.bbox;
      const B = [s, 0, 0, -s, -b.llx * s, b.ury * s];
      const dev = mul(B, full);

      ctx().save();
      ctx().setTransform(dev[0], dev[1], dev[2], dev[3], dev[4], dev[5]);
      ctx().imageSmoothingEnabled = true;
      ctx().imageSmoothingQuality = 'high';
      ctx().drawImage(meta.canvas, 0, 0, 1, 1);
      ctx().restore();

      const cur = I.g.deviceMatrix();
      ctx().setTransform(cur[0], cur[1], cur[2], cur[3], cur[4], cur[5]);
      I.hasPainted = true;
    };
    ops.colorimage = ops.image;

    /* ---------- 兜底：忽略但不报错 ---------- */
    ['nulldevice', 'setstrokeadjust', 'setflat', 'setgraylevel', 'composefont',
      'definefont', 'undefinefont', 'setcachedevice', 'charstrings', 'setcharwidth',
      'showpage', 'banddevice', 'setpagedevice', 'makeimagedevice', 'copypage',
      'settransfer', 'setscreen', 'setcolorscreen', 'setcolortransfer',
      'imagescale', 'imagemask', 'setbbox'
    ].forEach(function (k) { if (!ops[k]) ops[k] = function () { }; });

    return ops;
  }

  /* ============================================================
   * 五、BoundingBox / 结构解析
   * ============================================================ */

  const DOS_EPS_MAGIC = 0xC5D0D3C6;

  function parseDosEps(bytes) {
    if (bytes.length < 30) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== DOS_EPS_MAGIC) return null;
    const psOff = dv.getUint32(4, true), psLen = dv.getUint32(8, true);
    const wmfOff = dv.getUint32(12, true), wmfLen = dv.getUint32(16, true);
    const tifOff = dv.getUint32(20, true), tifLen = dv.getUint32(24, true);
    return {
      ps: psLen ? bytes.subarray(psOff, psOff + psLen) : null,
      tiff: tifLen ? bytes.subarray(tifOff, tifOff + tifLen) : null,
      wmf: wmfLen ? bytes.subarray(wmfOff, wmfOff + wmfLen) : null
    };
  }

  function parseBBox(ps) {
    let hi = ps.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
    if (hi) {
      return { llx: +hi[1], lly: +hi[2], urx: +hi[3], ury: +hi[4], exact: true };
    }
    const bb = ps.match(/%%BoundingBox:\s*([-\d]+)\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)/);
    if (bb) {
      return { llx: +bb[1], lly: +bb[2], urx: +bb[3], ury: +bb[4], exact: false };
    }
    return null;
  }

  /* EPSI 预览：%%BeginPreview: w h depth lines 之后是十六进制数据 */
  function parseEpsiPreview(ps) {
    const m = ps.match(/%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (!m) return null;
    const w = +m[1], h = +m[2], depth = +m[3], lines = +m[4];
    if (!w || !h) return null;

    const start = ps.indexOf(m[0]) + m[0].length;
    const end = ps.indexOf('%%EndPreview', start);
    let body = end > 0 ? ps.slice(start, end) : ps.slice(start, start + lines * 512);
    const clean = body.replace(/[^0-9a-fA-F]/g, '');

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    const img = g.createImageData(w, h);

    if (depth === 1) {
      /* 1 位：每行按字节对齐 */
      const rowBytes = Math.ceil(w / 8);
      let p = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const byteIdx = p + (x >> 3);
          if (byteIdx * 2 + 1 >= clean.length) break;
          const byte = parseInt(clean.substr(byteIdx * 2, 2), 16);
          const bit = (byte >> (7 - (x & 7))) & 1;
          const v = bit ? 0 : 255;   /* 1 = 黑 */
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
        p += rowBytes;
      }
    } else if (depth === 8) {
      /* 8 位灰度 */
      let p = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if ((p + x) * 2 + 1 >= clean.length) break;
          const v = parseInt(clean.substr((p + x) * 2, 2), 16);
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
        p += w;
      }
    } else {
      return null;
    }
    g.putImageData(img, 0, 0);
    return { canvas: canvas, width: w, height: h, depth: depth };
  }

  /* ---------- TIFF 预览解码（最小实现）---------- */
  function decodeTiff(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 8) return null;
    let le;
    const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
    if (b0 === 0x49 && b1 === 0x49) le = true;
    else if (b0 === 0x4D && b1 === 0x4D) le = false;
    else return null;

    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);

    if (u16(2) !== 42) return null;
    let ifd = u32(4);
    if (ifd + 2 > bytes.length) return null;
    const count = u16(ifd);

    const T = {};
    for (let k = 0; k < count; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > bytes.length) break;
      const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
      let valOff = e + 8;
      const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 1;
      const total = typeSize * n;
      const readVals = () => {
        const base = total <= 4 ? e + 8 : u32(e + 8);
        const out = [];
        for (let q = 0; q < n; q++) {
          const o = base + q * typeSize;
          if (o + typeSize > bytes.length) break;
          if (type === 3) out.push(u16(o));
          else if (type === 4) out.push(u32(o));
          else out.push(dv.getUint8(o));
        }
        return out;
      };
      T[tag] = readVals();
    }

    const width = (T[256] || [0])[0];
    const height = (T[257] || [0])[0];
    if (!width || !height) return null;
    const bps = (T[258] || [8])[0];
    const compression = (T[259] || [1])[0];
    const photometric = (T[262] || [1])[0];
    const spp = (T[277] || [1])[0];
    const rowsPerStrip = (T[278] || [height])[0];
    const strips = T[273] || [];
    const stripBytes = T[279] || [];
    if (!strips.length) return null;

    let data = [];
    for (let s = 0; s < strips.length; s++) {
      const off = strips[s], len = stripBytes[s] || (bytes.length - off);
      const raw = bytes.subarray(off, Math.min(bytes.length, off + len));
      let dec;
      if (compression === 1) dec = raw;
      else if (compression === 32773) dec = packBits(raw);
      else if (compression === 5) dec = lzwDecode(raw);
      else return null;
      for (let q = 0; q < dec.length; q++) data.push(dec[q]);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d');
    const img = g.createImageData(width, height);

    if (bps === 8 && spp >= 3) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const s = (y * width + x) * spp;
          const o = (y * width + x) * 4;
          img.data[o] = data[s] || 0;
          img.data[o + 1] = data[s + 1] || 0;
          img.data[o + 2] = data[s + 2] || 0;
          img.data[o + 3] = 255;
        }
      }
    } else if (bps === 8) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const v = data[y * width + x] || 0;
          const o = (y * width + x) * 4;
          const c = (photometric === 0) ? (255 - v) : v;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = c;
          img.data[o + 3] = 255;
        }
      }
    } else if (bps === 1) {
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = data[y * rowBytes + (x >> 3)] || 0;
          const bit = (byte >> (7 - (x & 7))) & 1;
          const c = (photometric === 0) ? (bit ? 0 : 255) : (bit ? 255 : 0);
          const o = (y * width + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = c;
          img.data[o + 3] = 255;
        }
      }
    } else {
      return null;
    }

    g.putImageData(img, 0, 0);
    return { canvas: canvas, width: width, height: height };
  }

  function packBits(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const n = (src[i] << 24) >> 24;
      i++;
      if (n >= 0) {
        for (let k = 0; k <= n && i < src.length; k++) out.push(src[i++]);
      } else if (n !== -128) {
        const v = src[i++];
        for (let k = 0; k < 1 - n; k++) out.push(v);
      }
    }
    return out;
  }

  function lzwDecode(src) {
    const out = [];
    let dict = [];
    const reset = () => {
      dict = [];
      for (let k = 0; k < 256; k++) dict.push([k]);
      dict.push(null); dict.push(null);  /* 256 clear, 257 eoi */
    };
    reset();
    let codeLen = 9;
    let bitBuf = 0, bitCnt = 0, pos = 0;
    let prev = null;

    const readCode = () => {
      while (bitCnt < codeLen) {
        if (pos >= src.length) return -1;
        bitBuf = (bitBuf << 8) | src[pos++];
        bitCnt += 8;
      }
      const code = (bitBuf >> (bitCnt - codeLen)) & ((1 << codeLen) - 1);
      bitCnt -= codeLen;
      return code;
    };

    for (;;) {
      const code = readCode();
      if (code < 0 || code === 257) break;
      if (code === 256) { reset(); codeLen = 9; prev = null; continue; }

      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat([prev[0]]);
      else break;

      for (let k = 0; k < entry.length; k++) out.push(entry[k]);

      if (prev) dict.push(prev.concat([entry[0]]));
      prev = entry;

      /* TIFF 的 early change：下一码将超出时提前加宽 */
      if (dict.length + 1 >= (1 << codeLen) && codeLen < 12) codeLen++;
      if (out.length > 60000000) break;
    }
    return out;
  }

  /* ============================================================
   * 六、对外：解码
   * ============================================================ */

  /* 统计画布上非白像素数量，用于判断「解释器其实什么也没画出来」 */
  function nonWhiteCount(canvas) {
    try {
      const g = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const stepX = Math.max(1, Math.floor(W / 220));
      const stepY = Math.max(1, Math.floor(H / 220));
      let count = 0, total = 0;
      const d = g.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += stepY) {
        for (let x = 0; x < W; x += stepX) {
          const o = (y * W + x) * 4;
          total++;
          if (d[o + 3] > 8 && (d[o] < 246 || d[o + 1] < 246 || d[o + 2] < 246)) count++;
        }
      }
      return { count: count, total: total, ratio: total ? count / total : 0 };
    } catch (e) {
      return { count: 1, total: 1, ratio: 1 };
    }
  }

  function isEpsLike(name, bytes) {
    if (/\.(eps|ps|epsf|epsi)$/i.test(name || '')) return true;
    if (!bytes || bytes.length < 4) return false;
    if (bytes[0] === 0xC5 && bytes[1] === 0xD0 && bytes[2] === 0xD3 && bytes[3] === 0xC6) return true;
    /* %!PS */
    return bytes[0] === 0x25 && bytes[1] === 0x21;
  }

  /**
   * 解码 EPS。
   * @returns {{canvas: HTMLCanvasElement, source: string, bbox: object, notes: string[]}}
   */
  async function decode(bytes, opts) {
    opts = opts || {};
    const notes = [];
    let psText = null;
    let tiffBytes = null;

    const dos = parseDosEps(bytes);
    if (dos) {
      if (dos.ps) psText = bytesToLatin1(dos.ps);
      if (dos.tiff) tiffBytes = dos.tiff;
      notes.push('检测到 DOS-EPS 二进制封装');
    } else {
      psText = bytesToLatin1(bytes);
    }

    if (!psText) throw new Error('EPS 中找不到 PostScript 部分');

    const bbox = parseBBox(psText) || { llx: 0, lly: 0, urx: 595, ury: 842, exact: false };
    if (!parseBBox(psText)) notes.push('未找到 BoundingBox，按默认页面推断');

    /* 目标渲染尺寸 */
    const wPt = Math.max(1, bbox.urx - bbox.llx);
    const hPt = Math.max(1, bbox.ury - bbox.lly);
    const targetW = Math.max(1, Math.round(opts.scale ? wPt * opts.scale : Math.min(wPt * 4, 2400)));
    const scale = targetW / wPt;
    const targetH = Math.max(1, Math.round(hPt * scale));

    /* 1) 先试解释器 */
    let rendered = null;
    let images = [];
    try {
      images = await prepareImages(psText);
      const okImgs = images.filter(Boolean).length;
      if (images.length) notes.push('内嵌图像 ' + images.length + ' 个，预解码成功 ' + okImgs + ' 个');
    } catch (e) {
      notes.push('内嵌图像预解码失败：' + (e && e.message ? e.message : e));
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);

      const interp = new Interp(psText, ctx, bbox, scale, images);
      interp.run();
      const painted = interp.hasPainted || interp.unknown && Object.keys(interp.unknown).length === 0;

      if (interp.err) notes.push('解释器异常：' + interp.err);
      const unk = Object.keys(interp.unknown || {});
      if (unk.length) notes.push('解释器忽略的算子：' + unk.slice(0, 12).join(', ') + (unk.length > 12 ? ' 等' : ''));

      const ink = nonWhiteCount(canvas);
      if (interp.hasPainted && ink.ratio > 0.0008) {
        rendered = { canvas: canvas, source: 'postscript' };
      } else if (interp.hasPainted) {
        notes.push('解释器只画出空白（可能是图像/渐变类 EPS），改用内嵌预览');
      } else {
        notes.push('解释器没有绘制出内容（可能是图像/渐变类 EPS）');
      }
    } catch (e) {
      notes.push('解释器失败：' + (e && e.message ? e.message : e));
    }

    if (rendered) return { canvas: rendered.canvas, source: rendered.source, bbox: bbox, notes: notes, width: wPt, height: hPt };

    /* 2) EPSI 预览 */
    const epsi = parseEpsiPreview(psText);
    if (epsi) {
      notes.push('已回退到 EPSI 内嵌预览（' + epsi.depth + ' 位，' + epsi.width + '×' + epsi.height + '）');
      return { canvas: epsi.canvas, source: 'epsi', bbox: bbox, notes: notes, width: wPt, height: hPt };
    }

    /* 3) TIFF 预览 */
    if (tiffBytes) {
      const tif = decodeTiff(tiffBytes);
      if (tif) {
        notes.push('已回退到 TIFF 内嵌预览（' + tif.width + '×' + tif.height + '）');
        return { canvas: tif.canvas, source: 'tiff', bbox: bbox, notes: notes, width: wPt, height: hPt };
      }
      notes.push('TIFF 预览无法解码');
    }

    throw new Error(
      '这个 EPS 既没有可渲染的矢量内容，也没有内嵌预览。\n' +
      '请先用 Ghostscript 或 Inkscape 转成 PDF/PNG 再裁剪：\n' +
      '  gswin64c -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r300 -sOutputFile=out.png in.eps\n' +
      '  inkscape in.eps --export-type=png --export-dpi=300'
    );
  }

  /* ============================================================
   * 七、对外：生成 EPS
   * ============================================================ */

  function ascii85Encode(bytes) {
    let out = '';
    let i = 0;
    const n = bytes.length;
    while (i < n) {
      const chunk = [];
      let k = 0;
      for (; k < 4 && i + k < n; k++) chunk.push(bytes[i + k]);
      const m = chunk.length;
      while (chunk.length < 4) chunk.push(0);

      let v = ((chunk[0] << 24) >>> 0) + (chunk[1] << 16) + (chunk[2] << 8) + chunk[3];
      v = v >>> 0;

      if (v === 0 && m === 4) { out += 'z'; }
      else {
        const chars = [];
        for (let q = 0; q < 5; q++) {
          chars.unshift(String.fromCharCode((v % 85) + 33));
          v = Math.floor(v / 85);
        }
        out += chars.join('').slice(0, m + 1);
      }
      i += 4;
      if (out.length > 60000) { out += '\n'; }
    }
    return out + '~>';
  }

  async function deflateBytes(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate');
      const stream = new Blob([u8]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  }

  /**
   * 把画布封装成 EPS。
   * @returns {Promise<Blob>}
   */
  async function build(canvas, opts) {
    opts = opts || {};
    const W = canvas.width, H = canvas.height;
    const g = canvas.getContext('2d');
    const img = g.getImageData(0, 0, W, H).data;

    /* 去透明：EPS 没有 alpha，透明一律铺白 */
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0, j = 0; i < img.length; i += 4) {
      const a = img[i + 3] / 255;
      rgb[j++] = Math.round(img[i] * a + 255 * (1 - a));
      rgb[j++] = Math.round(img[i + 1] * a + 255 * (1 - a));
      rgb[j++] = Math.round(img[i + 2] * a + 255 * (1 - a));
    }

    const deflated = await deflateBytes(rgb);
    const useFlate = !!deflated;
    const payload = useFlate ? deflated : rgb;
    const a85 = ascii85Encode(payload);

    const title = String(opts.title || 'crop').replace(/[()\\]/g, '_');

    const head = [
      '%!PS-Adobe-3.0 EPSF-3.0',
      '%%BoundingBox: 0 0 ' + W + ' ' + H,
      '%%HiResBoundingBox: 0 0 ' + W + ' ' + H,
      '%%Creator: 科研进度管理 / 图片裁剪',
      '%%Title: ' + title + '.eps',
      '%%CreationDate: ' + new Date().toISOString(),
      '%%LanguageLevel: 2',
      '%%Pages: 1',
      '%%EndComments',
      '%%BeginProlog',
      '%%EndProlog',
      '%%Page: 1 1',
      'gsave',
      '' + W + ' ' + H + ' scale',
      '/DeviceRGB setcolorspace',
      '<<',
      '  /ImageType 1',
      '  /Width ' + W,
      '  /Height ' + H,
      '  /BitsPerComponent 8',
      '  /Decode [0 1 0 1 0 1]',
      '  /ImageMatrix [1 0 0 -1 0 1]',
      '  /DataSource currentfile' + (useFlate ? ' /ASCII85Decode filter /FlateDecode filter' : ' /ASCII85Decode filter'),
      '>> image',
      a85,
      'grestore',
      'showpage',
      '%%EOF',
      ''
    ].join('\n');

    return new Blob([head], { type: 'application/postscript' });
  }

  window.EPS = {
    isEpsLike: isEpsLike,
    decode: decode,
    build: build,
    _internal: {
      tokenize: tokenize, parseBlocks: parseBlocks, parseBBox: parseBBox,
      parseEpsiPreview: parseEpsiPreview, decodeTiff: decodeTiff,
      packBits: packBits, lzwDecode: lzwDecode, ascii85Encode: ascii85Encode,
      ascii85ToBytes: ascii85ToBytes, indexImages: indexImages, prepareImages: prepareImages,
      parseImageDict: parseImageDict, nonWhiteCount: nonWhiteCount, Interp: Interp
    }
  };
})();
