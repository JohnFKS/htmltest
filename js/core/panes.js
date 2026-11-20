// 通用左右分栏：拖拽改宽度 + 折叠/展开 + 本地记忆
// 用法：Panes.bind(root, { key, initial, min, max, side: 'left'|'right' })
// 约定：侧栏标记 data-pane="side"，主区标记 data-pane="main"；手柄由本模块自动插入。
window.Panes = (() => {
  const prefix = 'zhixue.pane.';
  const read = (key, fallback) => {
    try {
      const v = localStorage.getItem(prefix + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
  };

  function bind(root, { key, side = 'left', initial = 260, min = 180, max = 480 } = {}) {
    if (!root) return null;
    const sideEl = root.querySelector('[data-pane="side"]');
    const mainEl = root.querySelector('[data-pane="main"]');
    if (!sideEl || !mainEl) return null;

    let width = Number(read(key + '.width', initial)) || initial;
    let collapsed = !!read(key + '.collapsed', false);
    const clamp = w => Math.max(min, Math.min(max, Number(w) || initial));

    let handle = root.querySelector('[data-pane-handle]');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'pane-handle';
      handle.dataset.paneHandle = '1';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.tabIndex = 0;
      handle.innerHTML = '<button class="pane-collapse-btn" type="button" title="折叠 / 展开侧栏">‹</button>';
      (side === 'right' ? sideEl : mainEl).before(handle);
    }
    const btn = handle.querySelector('.pane-collapse-btn');

    function apply() {
      width = clamp(width);
      root.style.setProperty('--pane-side-w', width + 'px');
      root.classList.toggle('pane-side-right', side === 'right');
      root.classList.toggle('pane-collapsed', collapsed);
      handle.setAttribute('aria-expanded', String(!collapsed));
      handle.setAttribute('aria-label', collapsed ? '展开侧栏' : '折叠侧栏');
      btn.textContent = collapsed ? (side === 'right' ? '›' : '‹') : (side === 'right' ? '‹' : '›');
    }

    function setWidth(w, persist = true) {
      width = clamp(w);
      apply();
      if (persist) write(key + '.width', width);
    }

    function toggle(force) {
      collapsed = typeof force === 'boolean' ? force : !collapsed;
      apply();
      write(key + '.collapsed', collapsed);
    }

    handle.addEventListener('dblclick', e => { if (!e.target.closest('.pane-collapse-btn')) toggle(); });
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    handle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 40 : 12);
        setWidth(width + (side === 'right' ? -delta : delta));
      }
    });
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('.pane-collapse-btn') || window.innerWidth <= 900) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('pane-resizing');
      const rect = root.getBoundingClientRect();
      const onMove = ev => {
        const raw = side === 'right' ? rect.right - ev.clientX : ev.clientX - rect.left;
        setWidth(raw, false);
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.classList.remove('pane-resizing');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        write(key + '.width', width);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    apply();
    return {
      toggle,
      setWidth,
      get width() { return width; },
      get collapsed() { return collapsed; },
    };
  }

  return { bind };
})();
