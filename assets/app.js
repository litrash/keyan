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
  const emptyDB = () => ({ tasks: [], experiments: [], papers: [], milestones: [] });
  let DB = emptyDB();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        DB = Object.assign(emptyDB(), obj);
        // 保证是数组
        ['tasks', 'experiments', 'papers', 'milestones'].forEach(k => {
          if (!Array.isArray(DB[k])) DB[k] = [];
        });
      } else {
        DB = demoData();
        save();
      }
    } catch (e) {
      console.warn('读取本地数据失败，使用空数据', e);
      DB = emptyDB();
    }
  }

  let saveTimer = null;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
      flashHint('已自动保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (e) {
      flashHint('保存失败：' + e.message);
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
    }
  };

  const DATA_KEY = { task: 'tasks', experiment: 'experiments', paper: 'papers', milestone: 'milestones' };
  let editing = { type: null, id: null };

  function fieldHtml(f, val) {
    const v = val == null ? '' : val;
    let inner;
    if (f.type === 'select') {
      inner = `<select name="${f.k}">${f.options.map(([k, n]) =>
        `<option value="${esc(k)}" ${String(v) === String(k) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      inner = `<textarea name="${f.k}">${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="field"><label><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''} style="width:auto;margin-right:6px">${esc(f.label)}</label></div>`;
    } else {
      inner = `<input type="${f.type}" name="${f.k}" value="${esc(v)}" ${f.required ? 'required' : ''}>`;
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
        DB = Object.assign(emptyDB(), obj);
        ['tasks', 'experiments', 'papers', 'milestones'].forEach(k => { if (!Array.isArray(DB[k])) DB[k] = []; });
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
    renderTimeline();
    renderStats();
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
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bind() {
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

    // 搜索
    $('#expSearch').addEventListener('input', renderExperiments);
    $('#paperSearch').addEventListener('input', renderPapers);
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

    // 拖拽
    bindBoardDnD();

    // 窗口缩放时重绘图表尺寸
    window.addEventListener('resize', () => { Object.values(charts).forEach(c => { try { c.resize(); } catch (_) {} }); });
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function init() {
    load();
    renderAll();
    bind();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
