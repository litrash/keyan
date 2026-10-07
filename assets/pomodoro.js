/* ============================================================
 * 番茄钟 / 计时器
 * 三种模式：专注倒计时、休息倒计时、正计时（秒表）
 * 状态持久化到 localStorage，刷新页面不丢
 * ============================================================ */
(function () {
  'use strict';

  const KEY = 'research_progress_pomo';
  const $ = (s) => document.querySelector(s);

  /* ---------- 配置（由设置面板读写） ---------- */
  const DEFAULTS = {
    focus: 25, break: 5,
    notify: false, sound: true, autoBreak: false
  };

  let cfg = Object.assign({}, DEFAULTS);

  /* ---------- 运行时状态 ---------- */
  let st = {
    mode: 'focus',        // focus | break | stopwatch
    running: false,
    startedAt: null,      // 本次计时的起始时间戳（用于正计时与恢复）
    elapsed: 0,           // 已累计毫秒（暂停时保存）
    remaining: null,      // 倒计时剩余毫秒
    mini: false,          // 是否最小化为悬浮球
    taskId: '',
    hidden: true
  };

  /* ---------- 统计（按日期记录番茄数与专注分钟） ---------- */
  let stats = loadStats();
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(KEY + '_stats') || '{}'); }
    catch { return {}; }
  }
  function saveStats() {
    try { localStorage.setItem(KEY + '_stats', JSON.stringify(stats)); } catch (_) {}
  }
  const todayKey = () => new Date().toISOString().slice(0, 10);
  function todayStat() {
    const k = todayKey();
    if (!stats[k]) stats[k] = { count: 0, minutes: 0 };
    return stats[k];
  }

  /* ---------- 持久化计时状态（刷新不丢） ---------- */
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        mode: st.mode, running: st.running, startedAt: st.startedAt,
        elapsed: st.elapsed, remaining: st.remaining, mini: st.mini,
        taskId: st.taskId, hidden: st.hidden
      }));
    } catch (_) {}
  }
  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      Object.assign(st, o);
      // 若之前在运行，按真实流逝时间补算
      if (st.running && st.startedAt) {
        const passed = Date.now() - st.startedAt;
        if (st.mode === 'stopwatch') {
          st.elapsed = (o.elapsed || 0) + passed;
        } else {
          st.remaining = Math.max(0, (o.remaining == null ? cfg.focus * 60000 : o.remaining) - passed);
          if (st.remaining === 0) { st.running = false; st.remaining = 0; }
        }
        st.startedAt = Date.now();
      }
    } catch (_) {}
  }

  /* ---------- 时间格式化 ---------- */
  function fmt(ms) {
    ms = Math.max(0, ms);
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  const durationOf = (mode) => (mode === 'break' ? cfg.break : cfg.focus) * 60000;

  function currentElapsed() {
    if (!st.running || !st.startedAt) return st.elapsed;
    return st.elapsed + (Date.now() - st.startedAt);
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const panel = $('#pomo'), fab = $('#pomoFab');
    if (!panel || !fab) return;

    panel.hidden = st.hidden || st.mini;
    fab.hidden = !(st.hidden === false && st.mini);

    // 悬浮球
    const label = fmt(displayRemaining());
    fab.textContent = label;
    fab.classList.toggle('running', st.running);

    if (panel.hidden) return;

    // 模式按钮
    Array.from(document.querySelectorAll('#pomoModes button')).forEach(b => {
      b.classList.toggle('active', b.dataset.mode === st.mode);
    });

    // 时钟
    const clock = $('#pomoClock');
    let ms;
    if (st.mode === 'stopwatch') {
      ms = currentElapsed();
      clock.classList.remove('over');
      $('#pomoBar').style.width = '100%';
      $('#pomoStatus').textContent = st.running ? '计时中…' : (ms > 0 ? '已暂停' : '准备开始');
    } else {
      ms = displayRemaining();
      clock.classList.toggle('over', ms === 0);
      const total = durationOf(st.mode);
      $('#pomoBar').style.width = Math.min(100, ((total - ms) / total * 100)).toFixed(1) + '%';
      if (ms === 0) $('#pomoStatus').textContent = st.mode === 'focus' ? '专注结束 🎉' : '休息结束';
      else if (st.running) $('#pomoStatus').textContent = '进行中…';
      else $('#pomoStatus').textContent = '已暂停';
    }
    clock.textContent = fmt(ms);

    const started = st.elapsed > 0 || (st.remaining != null && st.remaining < durationOf(st.mode)) || (st.mode === 'stopwatch' && ms > 0);
    $('#pomoStart').textContent = st.running ? '暂停' : (ms === 0 ? '重新开始' : (started ? '继续' : '开始'));
    $('#pomoReset').textContent = st.mode === 'stopwatch' ? '清零' : '重置';

    const t = todayStat();
    $('#pomoCount').textContent = t.count;
    $('#pomoMinutes').textContent = t.minutes;

    // 任务下拉
    const sel = $('#pomoTaskSel');
    if (sel) {
      const opts = ['<option value="">（不关联任务）</option>'];
      ((window.__getTasks && window.__getTasks()) || []).forEach(tk => {
        const lbl = (tk.title || '(未命名)').slice(0, 28);
        opts.push(`<option value="${tk.id}"${tk.id === st.taskId ? ' selected' : ''}>${escapeHtml(lbl)}</option>`);
      });
      sel.innerHTML = opts.join('');
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 计时循环 ---------- */
  // 采用「起始时间戳 + 已累计」推算，而不是每次自减，
  // 这样切到后台标签页被节流时也不会走慢。
  let tick = null;
  function startLoop() {
    if (tick) return;
    tick = setInterval(() => {
      if (!st.running) { render(); return; }
      if (st.mode === 'stopwatch') { render(); return; }

      // 倒计时：剩余 = 基准剩余 - 本段已流逝
      const base = st.remaining;                 // 开始/继续时锁定的剩余毫秒
      const passed = Date.now() - st.startedAt;
      const remain = base - passed;

      if (remain <= 0) {
        st.remaining = 0;
        st.running = false;
        st.startedAt = null;
        st.elapsed = 0;
        persist();
        render();
        onFinish();
        return;
      }
      render();
    }, 250);
  }

  /** 当前显示用的剩余毫秒（不修改状态） */
  function displayRemaining() {
    if (st.mode === 'stopwatch') return currentElapsed();
    if (st.remaining == null) return durationOf(st.mode);
    if (!st.running || !st.startedAt) return st.remaining;
    return Math.max(0, st.remaining - (Date.now() - st.startedAt));
  }

  /** 倒计时结束 */
  function onFinish() {
    const isFocus = st.mode === 'focus';
    if (isFocus) {
      const t = todayStat();
      t.count += 1;
      t.minutes += cfg.focus;
      saveStats();
    }
    notify(isFocus ? '专注结束' : '休息结束',
           isFocus ? `完成一个番茄钟（${cfg.focus} 分钟），休息一下吧。` : '休息结束，继续加油！');
    if (cfg.sound) beep();

    if (isFocus && cfg.autoBreak) {
      setTimeout(() => { setMode('break'); start(); }, 1200);
    }
  }

  function notify(title, body) {
    if (!cfg.notify) return;
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification(title, { body, icon: undefined });
      }
    } catch (_) {}
  }

  /** 用 WebAudio 合成提示音，避免依赖外部音频文件 */
  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      [0, 0.22, 0.44].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = i === 2 ? 1046 : 784;
        osc.type = 'sine';
        const t0 = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        osc.start(t0); osc.stop(t0 + 0.2);
      });
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1200);
    } catch (_) {}
  }

  /* ---------- 操作 ---------- */
  function start() {
    if (st.running) return;
    if (st.mode !== 'stopwatch') {
      // remaining 语义 = 开始/继续那一刻的剩余毫秒，作为本段倒计时的基准
      if (st.remaining == null) st.remaining = durationOf(st.mode);
      if (st.remaining <= 0) st.remaining = durationOf(st.mode);
    }
    st.running = true;
    st.startedAt = Date.now();
    startLoop();
    persist(); render();
  }

  function pause() {
    if (!st.running) return;
    const passed = Date.now() - st.startedAt;
    if (st.mode === 'stopwatch') {
      st.elapsed = (st.elapsed || 0) + passed;
    } else {
      // 把剩余量固化下来，作为下次继续的基准，避免重复计算流逝时间
      st.remaining = Math.max(0, (st.remaining == null ? durationOf(st.mode) : st.remaining) - passed);
    }
    st.running = false;
    st.startedAt = null;
    persist(); render();
  }

  function reset() {
    st.running = false;
    st.startedAt = null;
    st.elapsed = 0;
    st.remaining = st.mode === 'stopwatch' ? null : durationOf(st.mode);
    persist(); render();
  }

  function setMode(mode) {
    st.mode = mode;
    st.running = false;
    st.startedAt = null;
    st.elapsed = 0;
    st.remaining = mode === 'stopwatch' ? null : durationOf(mode);
    persist(); render();
  }

  function toggle() { st.running ? pause() : start(); }

  function open() { st.hidden = false; st.mini = false; persist(); render(); }
  function close() { st.hidden = true; persist(); render(); }
  function minimize() { st.mini = true; persist(); render(); }
  function expand() { st.mini = false; st.hidden = false; persist(); render(); }

  /* ---------- 配置读写 ---------- */
  function setConfig(patch) {
    Object.assign(cfg, patch);
    try { localStorage.setItem(KEY + '_cfg', JSON.stringify(cfg)); } catch (_) {}
    // 未开始计时时，让时钟跟随新的时长
    if (!st.running && st.elapsed === 0 && st.mode !== 'stopwatch') {
      st.remaining = durationOf(st.mode);
    }
    render();
  }
  function initConfig() {
    try {
      const raw = localStorage.getItem(KEY + '_cfg');
      if (raw) Object.assign(cfg, JSON.parse(raw));
    } catch (_) {}
  }
  const getConfig = () => Object.assign({}, cfg);
  const getStats = () => stats;

  /* ---------- 绑定 ---------- */
  function bind() {
    const panel = $('#pomo');
    if (!panel) return;

    $('#pomoStart').addEventListener('click', toggle);
    $('#pomoReset').addEventListener('click', reset);
    $('#pomoMin').addEventListener('click', minimize);
    $('#pomoClose').addEventListener('click', close);
    $('#pomoFab').addEventListener('click', expand);

    $('#pomoModes').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) setMode(b.dataset.mode);
    });
    $('#pomoTaskSel').addEventListener('change', e => { st.taskId = e.target.value; persist(); });

    // 键盘：空格开始/暂停（不在输入框内时）
    document.addEventListener('keydown', e => {
      if (e.code !== 'Space' || st.hidden) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.target.isContentEditable) return;
      e.preventDefault();
      toggle();
    });

    // 标题栏显示剩余时间
    startLoop();
  }

  function init() {
    initConfig();
    restore();
    bind();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Pomodoro = {
    init, open, close, minimize, expand, start, pause, reset, setMode, toggle,
    setConfig, getConfig, getStats, render,
    isRunning: () => st.running, getMode: () => st.mode
  };
})();
