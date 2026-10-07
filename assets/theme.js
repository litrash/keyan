/* ============================================================
 * 主题（界面风格）模块
 * 通过 <html data-theme="..."> 切换，共 5 套 + 跟随系统
 * 主题选择会随科研数据一起同步到云端
 * ============================================================ */
(function () {
  'use strict';

  const THEME_KEY = 'research_progress_theme';

  const THEMES = [
    { key: 'auto',  name: '跟随系统', desc: '随操作系统明暗自动切换',
      colors: ['#f4f6fb', '#4361ee', '#1f2937'] },
    { key: 'light', name: '浅色',     desc: '默认明亮风格',
      colors: ['#f4f6fb', '#ffffff', '#4361ee'] },
    { key: 'dark',  name: '深色',     desc: '柔和的暗色，护眼',
      colors: ['#0f1420', '#171d2c', '#6d86ff'] },
    { key: 'night', name: '纯黑夜间', desc: 'OLED 省电，暗环境首选',
      colors: ['#000000', '#0b0b0d', '#7c8cff'] },
    { key: 'eye',   name: '护眼绿',   desc: '低蓝光，长时间阅读',
      colors: ['#c7edcc', '#e3f6e6', '#2f7d42'] },
    { key: 'warm',  name: '暖色羊皮纸', desc: '暖调低刺激，夜间友好',
      colors: ['#f7efe2', '#fffaf1', '#b45309'] }
  ];

  const VALID = THEMES.map(t => t.key);
  let current = 'auto';
  const listeners = [];

  function normalize(key) {
    return VALID.includes(key) ? key : 'auto';
  }

  /** 应用主题到 <html>，并写入本地缓存 */
  function apply(key, opts) {
    current = normalize(key);
    document.documentElement.setAttribute('data-theme', current);
    try { localStorage.setItem(THEME_KEY, current); } catch (_) {}
    // 通知图表等需要重绘的组件
    listeners.forEach(fn => { try { fn(current); } catch (_) {} });
    if (!(opts && opts.silent)) {
      document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: current } }));
    }
    return current;
  }

  function init() {
    let saved = 'auto';
    try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch (_) {}
    apply(saved, { silent: true });
  }

  const on = (fn) => listeners.push(fn);
  const get = () => current;
  const list = () => THEMES.slice();

  // 立即应用，避免首屏闪烁（脚本在 body 末尾，DOM 已就绪）
  init();

  window.ThemeManager = { init, apply, get, list, on, THEMES, VALID, normalize };
})();
