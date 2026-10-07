/* ============================================================
 * 科研进度管理 - 应用逻辑
 * 纯前端静态页面：数据存 localStorage，可导出/导入 JSON
 * ============================================================
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'research_progress_v1';

  /* ---------------- 枚举配置 ---------------- */
  const TASK_STAGES = [
    { key: 'todo',    name: '待启动', dot: '#94a3b8' },
    { key: 'doing',   name: '进行中', dot: '#4361ee' },
    { key: 'blocked', name: '已阻塞', dot: '#ef4444' },
    { key: 'done',    name: '已完成', dot: '#16a34a' }
  ];
  const PRIORITIES = [
    { key: 'P0', name: 'P0 紧急', cls: 'p0' },
    { key: 'P1', name: 'P1 高',   cls: 'p1' },
    { key: 'P2', name: 'P2 常规', cls: 'p2' }
  ];
  const EXP_STATUS = [
    { key: 'plan', name: '计划中', cls: 'b-plan' },
    { key: 'run',  name: '进行中', cls: 'b-run' },
    { key: 'ok',   name: '已完成', cls: 'b-ok' },
    { key: 'fail', name: '已失败', cls: 'b-fail' }
  ];
  const PAPER_STATUS = [
    { key: 'idea',    name: '构思',   cls: 'b-idea' },
    { key: 'read',    name: '精读中', cls: 'b-read' },
    { key: 'writing', name: '撰写中', cls: 'b-writing' },
    { key: 'submit',  name: '已投稿', cls: 'b-submit' },
    { key: 'revise',  name: '返修中', cls: 'b-revise' },
    { key: 'accept',  name: '已接收', cls: 'b-accept' },
    { key: 'reject',  name: '被拒',   cls: 'b-reject' }
  ];

  /* ---------------- 工具 ---------------- */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const byName = (arr, k) => (arr.find(x => x.key === k) || {}).name || k || '';
  const clsOf  = (arr, k) => (arr.find(x => x.key === k) || {}).cls || '';
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  function relDue(dateStr) {
    if (!dateStr) return { text: '', cls: '' };
    const d = daysBetween(todayISO(), dateStr);
    if (d < 0)  return { text: `逾期 ${-d} 天`, cls: 'over' };
    if (d === 0) return { text: '今天截止', cls: 'over' };
    if (d <= 3) return { text: `还剩 ${d} 天`, cls: 'soon' };
    return { text: `还剩 ${d} 天`, cls: '' };
  }

  /* ---------------- 数据层 ---------------- */
  const COLLECTIONS = ['tasks', 'experiments', 'papers', 'milestones', 'journal'];
  // settings 存放随账号同步的轻量配置（如主题），不是数组
  const emptyDB = () => ({ tasks: [], experiments: [], papers: [], milestones: [], journal: [], settings: {} });
  let DB = emptyDB();

  /* ---- 云端同步状态 ---- */
  const Cloud = window.CloudAPI || null;
  let dirty = false;        // 本地有未推送的改动
  let syncTimer = null;
  let syncing = false;

  function setSyncState(text, cls) {
    const el = $('#syncState');
    if (el) { el.textContent = text ? '· ' + text : ''; el.className = cls || ''; }
  }

  /** 把任意来源的数据对象规范成完整 DB 结构（保证集合都是数组、settings 是对象） */
  function normalizeDB(obj) {
    const out = emptyDB();
    if (obj && typeof obj === 'object') {
      Object.assign(out, obj);
    }
    COLLECTIONS.forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
    if (!out.settings || typeof out.settings !== 'object' || Array.isArray(out.settings)) out.settings = {};
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        DB = normalizeDB(JSON.parse(raw));
      } else {
        // 首次访问：留空，等登录后从云端拉取。
        // 不再自动灌入示例数据——否则新账号会把示例数据当成自己的进度推到云端。
        DB = emptyDB();
      }
    } catch (e) {
      console.warn('读取本地数据失败，使用空数据', e);
      DB = emptyDB();
    }
  }

  /** 仅写本地缓存（离线优先，不触发云端推送） */
  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
    } catch (e) {
      flashHint('本地缓存失败：' + e.message);
    }
  }

  let saveTimer = null;
  /**
   * 保存：先落本地缓存，再排队推送到云端。
   * 离线时仅本地生效，联网后由 syncNow 自动补推。
   */
  function save() {
    saveLocal();
    flashHint('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    if (Cloud && Cloud.isLoggedIn()) {
      dirty = true;
      setSyncState('待同步…', 'saving');
      schedulePush();
    } else {
      setSyncState('仅本地', 'offline');
    }
  }

  function schedulePush(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow(); }, delay == null ? 800 : delay);
  }

  /** 把本地数据推送到云端；遇到冲突则以云端为准提示用户 */
  async function syncNow(opts) {
    if (!Cloud || !Cloud.isLoggedIn() || syncing) return;
    syncing = true;
    setSyncState('同步中…', 'saving');
    try {
      const res = await Cloud.push(DB, { baseRevision: Cloud.store.revision });
      if (res.ok) {
        dirty = false;
        setSyncState('已同步到云端', 'saved');
        setTimeout(() => {
          const el = $('#syncState');
          if (el && el.textContent.includes('已同步')) el.textContent = '';
        }, 2500);
      } else if (res.conflict) {
        // 其他设备改了数据：拉取云端版本覆盖本地，避免静默丢数据
        const remote = res.remote;
        const useRemote = opts && opts.forceRemote
          ? true
          : confirm('云端数据已被其他设备更新。\n\n点「确定」用云端版本覆盖本机，点「取消」用本机版本覆盖云端。');
        if (useRemote) {
          DB = normalizeDB(remote.payload);
          COLLECTIONS.forEach(k => { if (!Array.isArray(DB[k])) DB[k] = []; });
          Cloud.store.revision = remote.revision;
          saveLocal();
          renderAll();
          dirty = false;
          setSyncState('已采用云端数据', 'saved');
        } else {
          const r2 = await Cloud.push(DB, { baseRevision: remote.revision });
          if (r2.ok) { dirty = false; setSyncState('已用本机覆盖云端', 'saved'); }
        }
      }
    } catch (e) {
      if (e.status === 401) {
        setSyncState('登录已过期', 'error');
        showAuthGate();
      } else {
        setSyncState('离线，稍后自动重试', 'offline');
        schedulePush(15000);
      }
    } finally {
      syncing = false;
    }
  }

  /** 登录后拉取云端数据；若云端为空而本地有数据，则把本地推上去 */
  async function pullFromCloud() {
    if (!Cloud || !Cloud.isLoggedIn()) return;
    setSyncState('读取云端…', 'saving');
    try {
      const d = await Cloud.pull();
      const KEYS = COLLECTIONS;
      const remoteEmpty = KEYS.every(k => !Array.isArray(d.payload[k]) || d.payload[k].length === 0);
      const localHasData = KEYS.some(k => Array.isArray(DB[k]) && DB[k].length > 0);

      // 只在「账号是全新的（revision 0 且从未写过）」且「本机有数据」时，
      // 才把本机数据迁移上云。这是老用户第一次注册账号的场景。
      // revision > 0 说明云端已有内容，绝不能拿本机数据覆盖。
      if (remoteEmpty && localHasData && d.revision === 0) {
        const migrate = confirm(
          '检测到本机存在科研数据，而云端账号是空的。\n\n' +
          '点「确定」把本机数据上传到云端（推荐）。\n' +
          '点「取消」放弃本机数据，从空数据开始。'
        );
        if (migrate) {
          dirty = true;
          await syncNow();
          renderAll();
          return;
        }
      }

      // 默认：以云端为准
      DB = normalizeDB(d.payload);
      KEYS.forEach(k => { if (!Array.isArray(DB[k])) DB[k] = []; });
      saveLocal();
      renderAll();
      dirty = false;
      setSyncState(remoteEmpty ? '云端暂无数据' : '已从云端载入', 'saved');
    } catch (e) {
      if (e.status === 401) { setSyncState('登录已过期', 'error'); showAuthGate(); }
      else setSyncState('离线，使用本地缓存', 'offline');
    }
  }

  function flashHint(text) {
    const el = $('#saveHint');
    if (!el) return;
    el.textContent = '· ' + text;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  /* ============================================================
   * 渲染：进度看板
   * ============================================================ */
  function renderBoard() {
    const wrap = $('#kanban');
    wrap.innerHTML = TASK_STAGES.map(stage => {
      const items = DB.tasks.filter(t => t.stage === stage.key);
      const cards = items.map(taskCardHtml).join('');
      return `<div class="column" data-stage="${stage.key}">
        <div class="col-head">
          <span class="name"><i class="dot" style="background:${stage.dot}"></i>${stage.name}</span>
          <span class="count">${items.length}</span>
        </div>
        <div class="col-body" data-drop="${stage.key}">${cards}</div>
      </div>`;
    }).join('');
  }

  function taskCardHtml(t) {
    const pr = PRIORITIES.find(p => p.key === t.priority) || { name: t.priority || '', cls: '' };
    const due = relDue(t.due);
    const tags = (t.tags || []).map(x => `<span class="tag">${esc(x)}</span>`).join('');
    return `<div class="task-card" draggable="true" data-type="task" data-id="${t.id}">
      <div class="t-title">${esc(t.title) || '(未命名)'}</div>
      <div class="t-meta">
        ${t.priority ? `<span class="tag ${pr.cls}">${esc(pr.name)}</span>` : ''}
        ${due.text ? `<span class="due ${due.cls}">⏰ ${due.text}</span>` : ''}
        ${tags}
      </div>
    </div>`;
  }

  /* ---- 拖拽 ---- */
  let dragId = null;
  function bindBoardDnD() {
    const wrap = $('#kanban');
    wrap.addEventListener('dragstart', e => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {}
    });
    wrap.addEventListener('dragend', e => {
      const card = e.target.closest('.task-card');
      if (card) card.classList.remove('dragging');
      $$('.column.drag-over', wrap).forEach(c => c.classList.remove('drag-over'));
    });
    wrap.addEventListener('dragover', e => {
      const col = e.target.closest('.column');
      if (!col) return;
      e.preventDefault();
      $$('.column.drag-over', wrap).forEach(c => { if (c !== col) c.classList.remove('drag-over'); });
      col.classList.add('drag-over');
    });
    wrap.addEventListener('dragleave', e => {
      const col = e.target.closest('.column');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    wrap.addEventListener('drop', e => {
      const col = e.target.closest('.column');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      const t = DB.tasks.find(x => x.id === id);
      if (t && t.stage !== col.dataset.stage) {
        const prev = t.stage;
        t.stage = col.dataset.stage;
        t.updated = new Date().toISOString();
        // 记录真实的完成时间，供「近 8 周完成任务」统计使用；移出「已完成」则清除。
        if (t.stage === 'done' && !t.completed) t.completed = t.updated;
        if (t.stage !== 'done' && prev === 'done') t.completed = '';
        save(); renderBoard();
      }
      dragId = null;
    });
  }

  /* ============================================================
   * 渲染：实验记录
   * ============================================================ */
  function renderExperiments() {
    const q = ($('#expSearch').value || '').trim().toLowerCase();
    let list = DB.experiments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (q) {
      list = list.filter(e =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.note || '').toLowerCase().includes(q) ||
        (e.tags || []).join(' ').toLowerCase().includes(q));
    }
    $('#expEmpty').hidden = list.length > 0;
    $('#expList').innerHTML = list.map(e => {
      const st = EXP_STATUS.find(s => s.key === e.status) || { name: '', cls: '' };
      const tags = (e.tags || []).map(x => `<span class="tag">${esc(x)}</span>`).join('');
      const res = [e.metric, e.value].filter(Boolean).join('：');
      return `<div class="card" data-type="experiment" data-id="${e.id}">
        <h4>${esc(e.title) || '(未命名实验)'} <span class="badge ${st.cls}">${esc(st.name)}</span></h4>
        ${e.date ? `<div class="row">📅 <b>${esc(e.date)}</b></div>` : ''}
        ${e.params ? `<div class="row">⚙️ 条件：${esc(e.params)}</div>` : ''}
        ${res ? `<div class="row">📊 结果：<b>${esc(res)}</b></div>` : ''}
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>`;
    }).join('');
  }

  /* ============================================================
   * 渲染：论文文献
   * ============================================================ */
  let paperFilter = 'all';
  function renderPaperFilters() {
    const counts = {};
    DB.papers.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
    const chips = [`<button class="chip ${paperFilter === 'all' ? 'active' : ''}" data-status="all">全部 (${DB.papers.length})</button>`];
    PAPER_STATUS.forEach(s => {
      const n = counts[s.key] || 0;
      if (n === 0 && paperFilter !== s.key) return;
      chips.push(`<button class="chip ${paperFilter === s.key ? 'active' : ''}" data-status="${s.key}">${s.name} (${n})</button>`);
    });
    $('#paperFilters').innerHTML = chips.join('');
  }

  function renderPapers() {
    const q = ($('#paperSearch').value || '').trim().toLowerCase();
    let list = DB.papers.slice();
    if (paperFilter !== 'all') list = list.filter(p => p.status === paperFilter);
    if (q) {
      list = list.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.authors || '').toLowerCase().includes(q) ||
        (p.venue || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => (b.year || '').toString().localeCompare((a.year || '').toString()));
    $('#paperEmpty').hidden = list.length > 0;
    $('#paperList').innerHTML = list.map(p => {
      const st = PAPER_STATUS.find(s => s.key === p.status) || { name: '', cls: '' };
      const link = p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">打开链接 ↗</a>` : '';
      return `<div class="card" data-type="paper" data-id="${p.id}">
        <h4>${esc(p.title) || '(无标题)'} <span class="badge ${st.cls}">${esc(st.name)}</span></h4>
        ${p.authors ? `<div class="row">👤 ${esc(p.authors)}</div>` : ''}
        <div class="row">
          ${p.venue ? `📖 <b>${esc(p.venue)}</b>` : ''}
          ${p.year ? ` · ${esc(String(p.year))}` : ''}
        </div>
        ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
        ${link ? `<div class="row" style="margin-top:8px">${link}</div>` : ''}
      </div>`;
    }).join('');
  }

  /* ============================================================
   * 渲染：科研日记
   * ============================================================ */
  let journalFilter = 'all';     // all | 心情 key | 'tag:xxx'

  function renderJournal() {
    const q = ($('#journalSearch').value || '').trim().toLowerCase();
    let list = DB.journal.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (journalFilter !== 'all') {
      if (journalFilter.indexOf('tag:') === 0) {
        const tag = journalFilter.slice(4);
        list = list.filter(j => (j.tags || []).includes(tag));
      } else {
        list = list.filter(j => j.mood === journalFilter);
      }
    }
    if (q) {
      list = list.filter(j =>
        (j.title || '').toLowerCase().includes(q) ||
        (j.body || '').toLowerCase().includes(q) ||
        (j.tags || []).join(' ').toLowerCase().includes(q));
    }

    $('#journalEmpty').hidden = list.length > 0;
    if (!list.length) {
      $('#journalEmpty').textContent = DB.journal.length
        ? '没有符合条件的日记。'
        : '还没有日记，点右上角「写日记」记录今天。';
    }

    $('#journalList').innerHTML = list.map(j => {
      const m = moodOf(j.mood);
      const tags = (j.tags || []).map(x => `<span class="tag">${esc(x)}</span>`).join('');
      const linked = j.linkTask ? DB.tasks.find(t => t.id === j.linkTask) : null;
      return `<div class="j-item" data-type="journal" data-id="${j.id}">
        <div class="j-head">
          <span class="j-date">${esc(j.date || '未填日期')}</span>
          ${m ? `<span class="j-mood" title="${esc(m.n)}">${m.e}</span>` : ''}
          ${j.title ? `<span class="j-title">${esc(j.title)}</span>` : ''}
        </div>
        ${j.body ? `<div class="j-body">${esc(j.body)}</div>` : ''}
        ${linked ? `<div class="row" style="margin-top:6px;font-size:12.5px">🔗 关联任务：${esc(linked.title)}</div>` : ''}
        ${tags ? `<div class="j-tags">${tags}</div>` : ''}
      </div>`;
    }).join('');

    renderJournalFilters();
    renderJournalStats();
  }

  function renderJournalFilters() {
    const counts = {};
    const tagCounts = {};
    DB.journal.forEach(j => {
      if (j.mood) counts[j.mood] = (counts[j.mood] || 0) + 1;
      (j.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
    });
    const chips = [`<button class="chip ${journalFilter === 'all' ? 'active' : ''}" data-jf="all">全部 (${DB.journal.length})</button>`];
    MOODS.forEach(m => {
      const n = counts[m.k] || 0;
      if (n === 0 && journalFilter !== m.k) return;
      chips.push(`<button class="chip ${journalFilter === m.k ? 'active' : ''}" data-jf="${m.k}">${m.e} ${m.n} (${n})</button>`);
    });
    Object.keys(tagCounts).sort().forEach(t => {
      chips.push(`<button class="chip ${journalFilter === 'tag:' + t ? 'active' : ''}" data-jf="tag:${esc(t)}">#${esc(t)} (${tagCounts[t]})</button>`);
    });
    $('#journalFilters').innerHTML = chips.join('');
  }

  function renderJournalStats() {
    const total = DB.journal.length;
    // 连续记录天数：从今天（或昨天）往前数
    const days = new Set(DB.journal.map(j => j.date).filter(Boolean));
    let streak = 0;
    const d = new Date();
    if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }

    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthCount = DB.journal.filter(j => (j.date || '').indexOf(thisMonth) === 0).length;

    $('#journalStat').innerHTML =
      `<div>总篇数 <b>${total}</b></div>` +
      `<div>连续记录 <b>${streak}</b> 天</div>` +
      `<div>本月 <b>${monthCount}</b> 篇</div>`;

    // 近 12 周热力图（每格一天）
    const counts = {};
    DB.journal.forEach(j => { if (j.date) counts[j.date] = (counts[j.date] || 0) + 1; });
    const cells = [];
    const cur = new Date();
    cur.setDate(cur.getDate() - 83);
    for (let i = 0; i < 84; i++) {
      const key = cur.toISOString().slice(0, 10);
      const n = counts[key] || 0;
      const lvl = n === 0 ? '' : n === 1 ? 'l1' : n === 2 ? 'l2' : n <= 4 ? 'l3' : 'l4';
      cells.push(`<i class="${lvl}" title="${key}：${n} 篇"></i>`);
      cur.setDate(cur.getDate() + 1);
    }
    $('#journalHeat').innerHTML = cells.join('');
  }

  /* ============================================================
   * 设置面板
   * ============================================================ */
  function renderSettings() {
    // 主题卡片
    const tm = window.ThemeManager;
    if (tm && $('#themeGrid')) {
      $('#themeGrid').innerHTML = tm.list().map(t => {
        const sw = t.colors.map(c => `<i style="background:${c}"></i>`).join('');
        return `<button class="theme-opt ${tm.get() === t.key ? 'active' : ''}" data-theme-key="${t.key}">
          <div class="swatch">${sw}</div>
          <div class="tname">${esc(t.name)}</div>
          <div class="tdesc">${esc(t.desc)}</div>
        </button>`;
      }).join('');
    }

    // 番茄钟配置
    const p = window.Pomodoro && window.Pomodoro.getConfig();
    if (p && $('#setPomoFocus')) {
      $('#setPomoFocus').value = String(p.focus);
      $('#setPomoBreak').value = String(p.break);
      $('#setPomoNotify').checked = !!p.notify;
      $('#setPomoSound').checked = !!p.sound;
      $('#setPomoAutoBreak').checked = !!p.autoBreak;
    }

    // 数据概览
    const n = (k) => (DB[k] || []).length;
    const meta = $('#settingsMeta');
    if (meta) {
      meta.textContent =
        `当前：任务 ${n('tasks')} · 实验 ${n('experiments')} · 文献 ${n('papers')} · 日记 ${n('journal')} · 里程碑 ${n('milestones')}` +
        (Cloud && Cloud.store.revision != null ? ` · 云端版本 r${Cloud.store.revision}` : ' · 未同步');
    }

    // 账号
    const acc = $('#settingsAccount');
    if (acc) {
      const u = Cloud && Cloud.currentUser();
      acc.textContent = u
        ? `已登录：${u.email}。数据同步到云端，可在其他电脑登录同一账号访问。`
        : '未登录';
    }
  }

  /* ============================================================
   * 渲染：时间线
   * ============================================================ */
  function renderTimeline() {
    const list = DB.milestones.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    $('#tlEmpty').hidden = list.length > 0;
    $('#timeline').innerHTML = list.map(m => {
      const past = m.date && m.date < todayISO();
      const cls = m.done ? 'done' : (past ? 'past' : '');
      const check = m.done ? ' ✅' : '';
      return `<div class="tl-item ${cls}" data-type="milestone" data-id="${m.id}">
        <div class="tl-date">${esc(m.date || '未定日期')}</div>
        <div class="tl-title">${esc(m.title) || '(无标题)'}${check}</div>
        ${m.note ? `<div class="tl-note">${esc(m.note)}</div>` : ''}
      </div>`;
    }).join('');

    // 近期截止：任务 + 里程碑 未来 30 天内
    const tasks = DB.tasks
      .filter(t => t.due && t.stage !== 'done')
      .map(t => ({ title: t.title, due: t.due, kind: '任务' }));
    const ms = DB.milestones
      .filter(m => m.date && !m.done)
      .map(m => ({ title: m.title, due: m.date, kind: '里程碑' }));
    let due = tasks.concat(ms)
      .filter(x => daysBetween(todayISO(), x.due) <= 30)
      .sort((a, b) => a.due.localeCompare(b.due));

    $('#dueList').innerHTML = due.length === 0
      ? '<div class="empty" style="grid-column:1/-1">未来 30 天内没有截止项 🎉</div>'
      : due.map(x => {
          const r = relDue(x.due);
          return `<div class="card">
            <h4>${esc(x.title) || '(无标题)'}</h4>
            <div class="row">🏷 ${x.kind} · 📅 <b>${esc(x.due)}</b> · <span class="due ${r.cls}">${r.text}</span></div>
          </div>`;
        }).join('');
  }

  /* ============================================================
   * 渲染：统计
   * ============================================================ */
  const charts = {};
  function renderStats() {
    const doneTasks = DB.tasks.filter(t => t.stage === 'done').length;
    const accepted = DB.papers.filter(p => p.status === 'accept').length;
    const upcoming = DB.milestones.filter(m => !m.done && m.date && daysBetween(todayISO(), m.date) >= 0).length;

    $('#statsRow').innerHTML = [
      { n: DB.tasks.length, l: '任务总数', c: 'var(--accent)' },
      { n: doneTasks, l: '已完成任务', c: 'var(--green)' },
      { n: DB.experiments.length, l: '实验记录', c: 'var(--orange)' },
      { n: DB.papers.length, l: '文献 / 论文', c: 'var(--purple)' },
      { n: accepted, l: '已接收论文', c: 'var(--green)' },
      { n: upcoming, l: '待达成里程碑', c: 'var(--cyan)' }
    ].map(s => `<div class="stat-card"><div class="num" style="color:${s.c}">${s.n}</div><div class="label">${s.l}</div></div>`).join('');

    draw('ch-stage', 'doughnut', {
      labels: TASK_STAGES.map(s => s.name),
      datasets: [{ data: TASK_STAGES.map(s => DB.tasks.filter(t => t.stage === s.key).length), backgroundColor: TASK_STAGES.map(s => s.dot), borderWidth: 0 }]
    }, { plugins: { legend: { position: 'bottom' } } });

    draw('ch-priority', 'bar', {
      labels: PRIORITIES.map(p => p.name),
      datasets: [{ data: PRIORITIES.map(p => DB.tasks.filter(t => t.priority === p.key).length), backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'], borderRadius: 6 }]
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });

    draw('ch-exp', 'doughnut', {
      labels: EXP_STATUS.map(s => s.name),
      datasets: [{ data: EXP_STATUS.map(s => DB.experiments.filter(e => e.status === s.key).length), backgroundColor: ['#94a3b8', '#f59e0b', '#16a34a', '#ef4444'], borderWidth: 0 }]
    }, { plugins: { legend: { position: 'bottom' } } });

    draw('ch-paper', 'bar', {
      labels: PAPER_STATUS.map(s => s.name),
      datasets: [{ data: PAPER_STATUS.map(s => DB.papers.filter(p => p.status === s.key).length), backgroundColor: '#8b5cf6', borderRadius: 6 }]
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });

    // 近 8 周完成任务数
    // 归周依据应为「实际完成时间」。旧实现用 t.due（截止日期）统计，
    // 导致已完成任务的 due 不在窗口内时统计恒为 0，与「已完成任务」卡片自相矛盾。
    // 这里按 completed → updated → created → due 依次回退，保证老数据也能被归周。
    const weeks = [], labels = [];
    const now = new Date();
    const doneList = DB.tasks.filter(t => t.stage === 'done');
    const doneDate = (t) => {
      const raw = t.completed || t.updated || t.created || t.due;
      return raw ? String(raw).slice(0, 10) : '';
    };
    for (let i = 7; i >= 0; i--) {
      const end = new Date(now); end.setDate(now.getDate() - i * 7);
      const start = new Date(end); start.setDate(end.getDate() - 6);
      const s = start.toISOString().slice(0, 10), e2 = end.toISOString().slice(0, 10);
      weeks.push(doneList.filter(t => { const d = doneDate(t); return d && d >= s && d <= e2; }).length);
      labels.push(`${start.getMonth() + 1}/${start.getDate()}`);
    }
    draw('ch-weekly', 'line', {
      labels,
      datasets: [{ label: '完成任务', data: weeks, borderColor: '#4361ee', backgroundColor: 'rgba(67,97,238,.15)', fill: true, tension: .3, pointRadius: 4 }]
    }, { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } });
  }

  function draw(id, type, data, options) {
    const el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, { type, data, options: Object.assign({ responsive: true, maintainAspectRatio: false }, options) });
  }

  /* ============================================================
   * 表单定义 + 弹窗
   * ============================================================ */
  const SCHEMAS = {
    task: {
      title: '任务',
      fields: [
        { k: 'title', label: '任务标题', type: 'text', required: true, full: true },
        { k: 'stage', label: '阶段', type: 'select', options: TASK_STAGES.map(s => [s.key, s.name]) },
        { k: 'priority', label: '优先级', type: 'select', options: PRIORITIES.map(p => [p.key, p.name]) },
        { k: 'due', label: '截止日期', type: 'date' },
        { k: 'tagsText', label: '标签（逗号分隔）', type: 'text' },
        { k: 'note', label: '备注', type: 'textarea', full: true }
      ],
      defaults: { stage: 'todo', priority: 'P2', due: '', tagsText: '', note: '', title: '' }
    },
    experiment: {
      title: '实验',
      fields: [
        { k: 'title', label: '实验名称', type: 'text', required: true, full: true },
        { k: 'status', label: '状态', type: 'select', options: EXP_STATUS.map(s => [s.key, s.name]) },
        { k: 'date', label: '日期', type: 'date' },
        { k: 'params', label: '实验条件 / 参数', type: 'text', full: true },
        { k: 'metric', label: '指标名（如 准确率）', type: 'text' },
        { k: 'value', label: '指标值', type: 'text' },
        { k: 'tagsText', label: '标签（逗号分隔）', type: 'text', full: true },
        { k: 'note', label: '结果分析 / 结论', type: 'textarea', full: true }
      ],
      defaults: { title: '', status: 'plan', date: todayISO(), params: '', metric: '', value: '', tagsText: '', note: '' }
    },
    paper: {
      title: '文献 / 论文',
      fields: [
        { k: 'title', label: '标题', type: 'text', required: true, full: true },
        { k: 'authors', label: '作者', type: 'text' },
        { k: 'venue', label: '期刊 / 会议' , type: 'text' },
        { k: 'status', label: '状态', type: 'select', options: PAPER_STATUS.map(s => [s.key, s.name]) },
        { k: 'year', label: '年份', type: 'text' },
        { k: 'url', label: '链接 / DOI', type: 'text', full: true },
        { k: 'note', label: '摘要 / 笔记', type: 'textarea', full: true }
      ],
      defaults: { title: '', authors: '', venue: '', status: 'idea', year: '', url: '', note: '' }
    },
    milestone: {
      title: '里程碑',
      fields: [
        { k: 'title', label: '里程碑名称', type: 'text', required: true, full: true },
        { k: 'date', label: '目标日期', type: 'date' },
        { k: 'done', label: '是否已完成', type: 'checkbox' },
        { k: 'note', label: '说明', type: 'textarea', full: true }
      ],
      defaults: { title: '', date: todayISO(), done: false, note: '' }
    },
    journal: {
      title: '日记',
      fields: [
        { k: 'date', label: '日期', type: 'date' },
        { k: 'mood', label: '心情', type: 'mood' },
        { k: 'title', label: '标题', type: 'text', full: true, placeholder: '今天的一句话总结…' },
        { k: 'linkTask', label: '关联任务（可选）', type: 'tasks' },
        { k: 'tagsText', label: '标签（逗号分隔）', type: 'text', full: true },
        { k: 'body', label: '正文', type: 'textarea', full: true, rows: 9 }
      ],
      defaults: { date: todayISO(), mood: '', title: '', linkTask: '', tagsText: '', body: '' }
    }
  };

  /* 心情选项（日记用） */
  const MOODS = [
    { k: 'great', e: '😄', n: '很棒' },
    { k: 'good',  e: '🙂', n: '不错' },
    { k: 'ok',    e: '😐', n: '一般' },
    { k: 'tired', e: '😮‍💨', n: '疲惫' },
    { k: 'bad',   e: '😣', n: '糟糕' }
  ];
  const moodOf = (k) => MOODS.find(m => m.k === k) || null;

  const DATA_KEY = { task: 'tasks', experiment: 'experiments', paper: 'papers', milestone: 'milestones', journal: 'journal' };
  let editing = { type: null, id: null };

  function fieldHtml(f, val) {
    const v = val == null ? '' : val;
    let inner;
    if (f.type === 'select') {
      inner = `<select name="${f.k}">${f.options.map(([k, n]) =>
        `<option value="${esc(k)}" ${String(v) === String(k) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      inner = `<textarea name="${f.k}" ${f.rows ? `rows="${f.rows}"` : ''}>${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="field"><label><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''} style="width:auto;margin-right:6px">${esc(f.label)}</label></div>`;
    } else if (f.type === 'mood') {
      // 心情选择器：隐藏域存值，按钮负责切换
      inner = `<input type="hidden" name="${f.k}" value="${esc(v)}">
        <div class="mood-pick" data-mood-for="${f.k}">
          ${MOODS.map(m => `<button type="button" data-mood="${m.k}" title="${esc(m.n)}"
             class="${String(v) === m.k ? 'active' : ''}">${m.e}</button>`).join('')}
        </div>`;
    } else if (f.type === 'tasks') {
      const opts = ['<option value="">（不关联）</option>'].concat(
        DB.tasks.map(t => `<option value="${esc(t.id)}" ${String(v) === String(t.id) ? 'selected' : ''}>${esc((t.title || '(未命名)').slice(0, 40))}</option>`)
      );
      inner = `<select name="${f.k}">${opts.join('')}</select>`;
    } else {
      inner = `<input type="${f.type}" name="${f.k}" value="${esc(v)}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
    }
    return `<div class="field" ${f.full ? 'style="grid-column:1/-1"' : ''}><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${inner}</div>`;
  }

  function openModal(type, id) {
    const schema = SCHEMAS[type];
    if (!schema) return;
    editing = { type, id: id || null };
    const list = DB[DATA_KEY[type]];
    const item = id ? list.find(x => x.id === id) : null;
    const src = item
      ? Object.assign({}, item, { tagsText: (item.tags || []).join(', ') })
      : Object.assign({}, schema.defaults);

    $('#modalTitle').textContent = (item ? '编辑' : '新建') + schema.title;
    $('#modalForm').innerHTML = schema.fields.map(f => fieldHtml(f, src[f.k])).join('');
    $('#btnDelete').hidden = !item;
    $('#modal').hidden = false;
    const first = $('#modalForm input, #modalForm select, #modalForm textarea');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function closeModal() {
    $('#modal').hidden = true;
    editing = { type: null, id: null };
    $('#modalForm').innerHTML = '';
  }

  function saveModal(e) {
    e.preventDefault();
    const { type, id } = editing;
    if (!type) return;
    const schema = SCHEMAS[type];
    const form = $('#modalForm');
    const obj = {};
    schema.fields.forEach(f => {
      const el = form.elements[f.k];
      if (!el) return;
      obj[f.k] = f.type === 'checkbox' ? el.checked : el.value.trim();
    });
    // 标签处理
    const tags = (obj.tagsText || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
    delete obj.tagsText;
    obj.tags = tags;

    const list = DB[DATA_KEY[type]];
    if (id) {
      const it = list.find(x => x.id === id);
      const wasDone = it.stage === 'done';
      Object.assign(it, obj, { updated: new Date().toISOString() });
      // 通过表单把任务改为「已完成」时，同样记录完成时间（保持与拖拽行为一致）
      if (type === 'task') {
        if (it.stage === 'done' && !wasDone && !it.completed) it.completed = it.updated;
        if (it.stage !== 'done' && wasDone) it.completed = '';
      }
    } else {
      obj.id = uid();
      obj.created = new Date().toISOString();
      if (type === 'task' && obj.stage === 'done') obj.completed = obj.created;
      list.push(obj);
    }
    save();
    renderAll();
    closeModal();
  }

  function deleteCurrent() {
    const { type, id } = editing;
    if (!type || !id) return;
    if (!confirm('确定删除这一条？该操作不可撤销。')) return;
    const list = DB[DATA_KEY[type]];
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list.splice(i, 1);
    save();
    renderAll();
    closeModal();
  }

  /* ============================================================
   * 导入 / 导出 / 清空 / 示例
   * ============================================================ */
  function exportData() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-progress-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!obj || typeof obj !== 'object') throw new Error('格式不正确');
        if (!confirm('导入将覆盖当前所有数据，确定继续？')) return;
        DB = normalizeDB(obj);
        save(); renderAll();
        alert('导入成功！');
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm('清空所有数据？建议先「导出」备份。此操作不可撤销。')) return;
    DB = emptyDB();
    save(); renderAll();
  }

  function demoData() {
    const d = (offset) => { const t = new Date(); t.setDate(t.getDate() + offset); return t.toISOString().slice(0, 10); };
    return {
      tasks: [
        { id: uid(), title: '完成文献综述初稿', stage: 'doing', priority: 'P1', due: d(5), tags: ['写作'], note: '目标 8000 字，覆盖近 5 年工作。' },
        { id: uid(), title: '补齐消融实验', stage: 'todo', priority: 'P0', due: d(2), tags: ['实验'], note: '需 GPU，等服务器排期。' },
        { id: uid(), title: '数据预处理脚本重构', stage: 'blocked', priority: 'P2', due: d(10), tags: ['工程'], note: '依赖上游数据接口。' },
        { id: uid(), title: '完成开题报告', stage: 'done', priority: 'P1', due: d(-6), tags: ['写作'], note: '' }
      ],
      experiments: [
        { id: uid(), title: '基线模型对比实验', status: 'ok', date: d(-8), params: 'lr=1e-3, batch=64, 5 folds', metric: '准确率', value: '92.4%', tags: ['baseline'], note: '优于 SOTA 1.2%，可作为主结果。' },
        { id: uid(), title: '超参敏感性分析', status: 'run', date: d(-1), params: 'lr ∈ {1e-4,1e-3,1e-2}', metric: 'F1', value: '待跑', tags: ['调参'], note: '关注 lr 对收敛影响。' }
      ],
      papers: [
        { id: uid(), title: 'Attention Is All You Need', authors: 'Vaswani et al.', venue: 'NeurIPS', status: 'read', year: '2017', url: 'https://arxiv.org/abs/1706.03762', note: 'Transformer 基础，重点引用于方法章节。' },
        { id: uid(), title: '本课题主论文', authors: '我', venue: '目标: CVPR', status: 'writing', year: '2026', url: '', note: '框架已定，2 周内完成方法章节。' }
      ],
      milestones: [
        { id: uid(), title: '开题答辩', date: d(-6), done: true, note: '顺利通过。' },
        { id: uid(), title: '中期检查', date: d(20), done: false, note: '需准备进度 PPT。' },
        { id: uid(), title: '论文投递', date: d(60), done: false, note: '目标会议截稿前完成。' }
      ],
      journal: [
        { id: uid(), date: d(0), mood: 'good', title: '方法章节开了个头',
          body: '今天把方法部分的框架列出来了，主要是三块：问题定义、模型结构、训练策略。\n写的时候发现之前的 baseline 描述不够严谨，明天需要回头补一下公式。',
          tags: ['写作', '方法'], linkTask: '' },
        { id: uid(), date: d(-1), mood: 'tired', title: '调参调到怀疑人生',
          body: 'lr 从 1e-4 扫到 1e-2，F1 波动只有 0.3 个点，怀疑是数据划分的问题。\n明天试试固定随机种子重跑一遍。',
          tags: ['实验', '调参'], linkTask: '' },
        { id: uid(), date: d(-2), mood: 'great', title: '消融实验跑通了',
          body: '去掉注意力模块后准确率掉 4.2%，说明这个模块确实有用，可以写进论文了。',
          tags: ['实验', '好结果'], linkTask: '' }
      ]
    };
  }

  /* ============================================================
   * 渲染调度
   * ============================================================ */
  function renderAll() {
    renderBoard();
    renderExperiments();
    renderPaperFilters();
    renderPapers();
    renderJournal();
    renderTimeline();
    renderStats();
    renderSettings();
  }
  function renderActive() {
    const tab = currentTab();
    if (tab === 'stats') renderStats();
  }

  let current = 'board';
  const currentTab = () => current;

  function switchTab(name) {
    current = name;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    if (name === 'journal') renderJournal();
  }

  /* ============================================================
   * 账号界面（登录 / 注册）
   * ============================================================ */
  let authMode = 'login'; // 'login' | 'register'

  function showAuthGate() {
    const gate = $('#authGate');
    if (!gate) return;
    gate.hidden = false;
    setAuthMode('login');
    setTimeout(() => { const e = $('#authEmail'); if (e) e.focus(); }, 60);
  }

  function hideAuthGate() {
    const gate = $('#authGate');
    if (gate) gate.hidden = true;
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isReg = mode === 'register';
    $('#authTitle').textContent = isReg ? '注册科研进度管理' : '登录科研进度管理';
    $('#authSub').textContent = isReg
      ? '创建账号后，进度会保存到云端'
      : '登录后可在任意电脑访问你的科研进度';
    $('#authConfirmWrap').hidden = !isReg;
    $('#authSubmit').textContent = isReg ? '注册并登录' : '登录';
    $('#authSwitchText').textContent = isReg ? '已有账号？' : '还没有账号？';
    $('#authSwitchLink').textContent = isReg ? '去登录' : '立即注册';
    $('#authPassword').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    authMsg('');
    $('#authForm').reset();
  }

  function authMsg(text, kind) {
    const el = $('#authMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-msg' + (kind ? ' ' + kind : '');
  }

  async function submitAuth(e) {
    e.preventDefault();
    if (!Cloud) { authMsg('同步模块未加载', 'err'); return; }

    const email = ($('#authEmail').value || '').trim();
    const pw = $('#authPassword').value || '';
    const remember = $('#authRemember').checked;

    if (!email) { authMsg('请输入邮箱', 'err'); return; }
    if (authMode === 'register') {
      if (pw.length < 8) { authMsg('密码至少 8 位', 'err'); return; }
      if (pw !== ($('#authPassword2').value || '')) { authMsg('两次输入的密码不一致', 'err'); return; }
    } else if (!pw) { authMsg('请输入密码', 'err'); return; }

    const btn = $('#authSubmit');
    btn.disabled = true;
    authMsg(authMode === 'register' ? '正在创建账号…' : '正在登录…');
    try {
      if (authMode === 'register') await Cloud.register(email, pw, remember);
      else await Cloud.login(email, pw, remember);
      authMsg('成功，正在载入数据…', 'ok');
      await afterLogin();
    } catch (err) {
      authMsg(err.message || '操作失败', 'err');
      btn.disabled = false;
    }
  }

  async function afterLogin() {
    const u = Cloud.currentUser();
    if (u) {
      $('#userEmail').textContent = u.email;
      $('#userBox').hidden = false;
    }
    hideAuthGate();
    await pullFromCloud();
    applySyncedTheme();
    renderAll();
    $('#authSubmit').disabled = false;
  }

  async function doLogout() {
    if (!confirm('退出登录？本机缓存会保留，重新登录即可继续使用。')) return;
    dirty = false;
    clearTimeout(syncTimer);
    await Cloud.logout();
    $('#userBox').hidden = true;
    $('#userEmail').textContent = '';
    setSyncState('');
    DB = emptyDB();
    saveLocal();
    renderAll();
    showAuthGate();
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind() {
    // 账号
    $('#authForm').addEventListener('submit', submitAuth);
    $('#authSwitchLink').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
    $('#btnLogout').addEventListener('click', doLogout);
    $('#btnCloudNow').addEventListener('click', () => syncNow({ forceRemote: false }));

    // 联网后自动补推
    window.addEventListener('online', () => { setSyncState('网络已恢复', 'saved'); if (dirty) syncNow(); });
    window.addEventListener('offline', () => setSyncState('离线，改动会暂存本机', 'offline'));

    // 关闭页面前尽量把改动推上去
    window.addEventListener('beforeunload', (e) => {
      if (dirty && Cloud && Cloud.isLoggedIn()) {
        // 用 sendBeacon 不可靠（需要鉴权头），退化为提示
        e.preventDefault();
        e.returnValue = '';
      }
    });

    $('#tabBar').addEventListener('click', e => {
      const b = e.target.closest('.tab-btn');
      if (b) switchTab(b.dataset.tab);
    });

    // 新建按钮
    $$('[data-new]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.new)));

    // 卡片 / 任务点击编辑（拖拽的除外）
    document.addEventListener('click', e => {
      if (e.target.closest('.task-card') || e.target.closest('.column')) return; // 看板走拖拽，不弹窗
      const card = e.target.closest('[data-type][data-id]');
      if (card) openModal(card.dataset.type, card.dataset.id);
    });
    // 看板：双击打开编辑
    $('#kanban').addEventListener('dblclick', e => {
      const c = e.target.closest('.task-card');
      if (c) openModal('task', c.dataset.id);
    });

    // 弹窗
    $('#btnSave').addEventListener('click', saveModal);
    $('#modalForm').addEventListener('submit', saveModal);
    $('#modalClose').addEventListener('click', closeModal);
    $('#btnCancel').addEventListener('click', closeModal);
    $('#btnDelete').addEventListener('click', deleteCurrent);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

    // 心情选择器（弹窗内，事件委托）
    $('#modalForm').addEventListener('click', e => {
      const btn = e.target.closest('.mood-pick button[data-mood]');
      if (!btn) return;
      e.preventDefault();
      const wrap = btn.closest('.mood-pick');
      const hidden = wrap.parentElement.querySelector('input[type=hidden]');
      const isSame = btn.classList.contains('active');
      // 再次点击同一个表情 = 取消选择
      Array.from(wrap.querySelectorAll('button')).forEach(b => b.classList.remove('active'));
      if (hidden) hidden.value = isSame ? '' : btn.dataset.mood;
      if (!isSame) btn.classList.add('active');
    });

    // 搜索
    $('#expSearch').addEventListener('input', renderExperiments);
    $('#paperSearch').addEventListener('input', renderPapers);
    $('#journalSearch').addEventListener('input', renderJournal);
    $('#journalFilters').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      journalFilter = c.dataset.jf;
      renderJournal();
    });
    $('#paperFilters').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      paperFilter = c.dataset.status;
      renderPaperFilters(); renderPapers();
    });

    // 导入导出
    $('#btnExport').addEventListener('click', exportData);
    $('#btnImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });
    $('#btnDemo').addEventListener('click', () => {
      if (!confirm('载入示例数据将覆盖当前数据，确定？')) return;
      DB = demoData(); save(); renderAll();
    });
    $('#btnClear').addEventListener('click', clearAll);

    /* ---- 设置：主题 ---- */
    $('#themeGrid').addEventListener('click', e => {
      const opt = e.target.closest('.theme-opt');
      if (!opt) return;
      const key = opt.dataset.themeKey;
      if (window.ThemeManager) window.ThemeManager.apply(key);
      // 主题作为普通数据项随账号同步（存 settings.theme）
      DB.settings = Object.assign({}, DB.settings, { theme: key });
      save();
      renderSettings();
    });

    /* ---- 设置：番茄钟 ---- */
    const pushPomoCfg = () => {
      if (!window.Pomodoro) return;
      window.Pomodoro.setConfig({
        focus: Number($('#setPomoFocus').value) || 25,
        break: Number($('#setPomoBreak').value) || 5,
        notify: $('#setPomoNotify').checked,
        sound: $('#setPomoSound').checked,
        autoBreak: $('#setPomoAutoBreak').checked
      });
    };
    ['#setPomoFocus', '#setPomoBreak'].forEach(sel =>
      $(sel).addEventListener('change', pushPomoCfg));
    $('#setPomoNotify').addEventListener('change', async () => {
      // 首次开启时申请通知权限
      if ($('#setPomoNotify').checked && window.Notification && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch (_) {}
      }
      pushPomoCfg();
    });
    $('#setPomoSound').addEventListener('change', pushPomoCfg);
    $('#setPomoAutoBreak').addEventListener('change', pushPomoCfg);

    /* ---- 番茄钟开关 ---- */
    $('#btnPomoToggle').addEventListener('click', () => {
      if (!window.Pomodoro) return;
      const panel = $('#pomo');
      if (panel.hidden) window.Pomodoro.open();
      else window.Pomodoro.close();
    });

    /* ---- 退出登录（设置里那个） ---- */
    $('#btnLogout2').addEventListener('click', doLogout);

    /* ---- 主题变化时重绘图表（颜色随主题变） ---- */
    document.addEventListener('themechange', () => {
      try { renderStats(); } catch (_) {}
    });

    // 供番茄钟读取任务列表
    window.__getTasks = () => DB.tasks;
    if (window.Pomodoro) window.Pomodoro.render();

    // 拖拽
    bindBoardDnD();

    // 窗口缩放时重绘图表尺寸
    window.addEventListener('resize', () => { Object.values(charts).forEach(c => { try { c.resize(); } catch (_) {} }); });
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  // 主题随账号同步：登录拉到数据后应用云端主题
  function applySyncedTheme() {
    const t = DB.settings && DB.settings.theme;
    if (t && window.ThemeManager) window.ThemeManager.apply(t);
  }

  async function init() {
    load();
    renderAll();
    bind();

    // 未登录则先要求登录，登录后才能进入主界面
    if (!Cloud || !Cloud.isLoggedIn()) {
      showAuthGate();
      return;
    }
    const user = await Cloud.checkSession();
    if (!user) { showAuthGate(); return; }
    $('#userEmail').textContent = user.email;
    $('#userBox').hidden = false;
    await pullFromCloud();
    applySyncedTheme();
    renderAll();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
