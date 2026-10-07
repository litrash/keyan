/* ============================================================
 * 云端同步层
 * - 账号：注册 / 登录 / 登出（邮箱 + 密码）
 * - 数据：GET/PUT /api/data，按账号在服务端隔离
 * - 离线优先：本地 localStorage 始终可写，联网后自动推送/拉取
 * ============================================================ */
(function () {
  'use strict';

  // 云端后端地址（Cloudflare Worker + D1）。
  // 如需自定义，可在 index.html 里于本文件之前设置 window.RESEARCH_API_BASE。
  const API_BASE = window.RESEARCH_API_BASE || 'https://rp.dahuajia.ccwu.cc';

  const TOKEN_KEY = 'research_progress_token';
  const USER_KEY  = 'research_progress_user';
  const REV_KEY   = 'research_progress_revision';

  const listeners = {};
  const emit = (evt, data) => (listeners[evt] || []).forEach(fn => fn(data));
  const on = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); };

  /* ---------- 令牌与会话状态 ---------- */
  // 注意：token 存 sessionStorage（关标签页即失效）以降低被 XSS 长期窃取的风险；
  // 若勾选「记住我」则改存 localStorage。
  const store = {
    get token() {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';
    },
    set token(v) {
      if (v) sessionStorage.setItem(TOKEN_KEY, v);
      else { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); }
    },
    get user() {
      try { return JSON.parse(sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY) || 'null'); }
      catch { return null; }
    },
    set user(u) {
      if (u) sessionStorage.setItem(USER_KEY, JSON.stringify(u));
      else { sessionStorage.removeItem(USER_KEY); localStorage.removeItem(USER_KEY); }
    },
    get revision() {
      const v = sessionStorage.getItem(REV_KEY);
      return v == null ? null : Number(v);
    },
    set revision(n) {
      if (n == null) sessionStorage.removeItem(REV_KEY);
      else sessionStorage.setItem(REV_KEY, String(n));
    },
    remember(flag) {
      // 把会话级 token 提升/降级为持久 token
      const t = sessionStorage.getItem(TOKEN_KEY);
      const u = sessionStorage.getItem(USER_KEY);
      if (flag && t) {
        localStorage.setItem(TOKEN_KEY, t); localStorage.setItem(USER_KEY, u);
      } else if (!flag) {
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
      }
    }
  };

  /* ---------- 底层请求 ---------- */
  async function api(path, { method = 'GET', body, auth = true, timeout = 15000 } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && store.token) headers['Authorization'] = 'Bearer ' + store.token;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method, headers, signal: ctrl.signal,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      clearTimeout(timer);
      const err = new Error(e.name === 'AbortError' ? '请求超时，请检查网络' : '无法连接服务器');
      err.network = true;
      throw err;
    }
    clearTimeout(timer);

    let data = null;
    try { data = await res.json(); } catch { /* 可能是空响应 */ }

    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || `请求失败 (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------- 认证 API ---------- */
  async function register(email, password, remember) {
    const d = await api('/api/register', { method: 'POST', body: { email, password }, auth: false });
    store.token = d.token; store.user = d.user; store.revision = null;
    store.remember(!!remember);
    emit('auth', { user: d.user });
    return d.user;
  }

  async function login(email, password, remember) {
    const d = await api('/api/login', { method: 'POST', body: { email, password }, auth: false });
    store.token = d.token; store.user = d.user; store.revision = null;
    store.remember(!!remember);
    emit('auth', { user: d.user });
    return d.user;
  }

  async function logout() {
    try { if (store.token) await api('/api/logout', { method: 'POST' }); } catch { /* 网络失败也要清本地 */ }
    store.token = ''; store.user = null; store.revision = null;
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
    emit('auth', { user: null });
  }

  const isLoggedIn = () => !!store.token;
  const currentUser = () => store.user;

  /* ---------- 校验本地 token 是否仍有效 ---------- */
  async function checkSession() {
    if (!store.token) return null;
    try {
      const d = await api('/api/me');
      store.user = d.user;
      return d.user;
    } catch (e) {
      if (e.status === 401) { store.token = ''; store.user = null; emit('auth', { user: null }); }
      return null;
    }
  }

  /* ---------- 数据同步 ---------- */
  async function pull() {
    const d = await api('/api/data');
    store.revision = d.revision;
    return d; // { payload, revision, updatedAt }
  }

  /**
   * 推送本地数据到云端。
   * 返回 { ok:true, revision } 或 { ok:false, conflict:true, remote }
   */
  async function push(payload, { baseRevision } = {}) {
    try {
      const d = await api('/api/data', { method: 'PUT', body: { payload, baseRevision } });
      store.revision = d.revision;
      return { ok: true, revision: d.revision, updatedAt: d.updatedAt };
    } catch (e) {
      if (e.status === 409) return { ok: false, conflict: true, remote: e.data };
      throw e;
    }
  }

  window.CloudAPI = {
    API_BASE, register, login, logout, isLoggedIn, currentUser, checkSession,
    pull, push, on, emit, store
  };
})();
