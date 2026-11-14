// UI 基础件：toast / modal / confirm / prompt / spinner / 空状态
window.UI = (() => {
  function toast(msg, type = 'info', ms = 2600) {
    const wrap = document.getElementById('toast-wrap');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /**
   * modal({title, body(html), width?, raw?, actions, onClose}) → {close, el, bodyEl}
   * raw=false（默认）：body 先经白名单消毒（用于拼接了 AI/用户内容且未预消毒的场景）
   * raw=true：body 为应用内部构造的可信 HTML（动态字符串已 U.esc、AI HTML 已过 provider.cleanHtml）
   */
  function modal({ title = '', body = '', width = 680, raw = false, actions = [], onClose }) {
    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" style="max-width:${width}px">
        <div class="modal-head">
          <div class="modal-title">${U.esc(title)}</div>
          <button class="modal-x" title="关闭">×</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>`;
    const bodyEl = mask.querySelector('.modal-body');
    if (raw) bodyEl.innerHTML = body;
    else Sanitize.into(bodyEl, body);
    const close = () => {
      mask.remove();
      onClose && onClose();
    };
    mask.querySelector('.modal-x').onclick = close;
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    const foot = mask.querySelector('.modal-foot');
    for (const act of [...actions].reverse()) {
      const btn = document.createElement('button');
      btn.className = `btn ${act.primary ? 'btn-primary' : 'btn-ghost'} ${act.danger ? 'btn-danger' : ''}`;
      btn.textContent = act.label;
      btn.onclick = () => act.onClick ? act.onClick(close) : close();
      foot.prepend(btn);
    }
    root.appendChild(mask);
    return { close, el: mask, bodyEl };
  }

  const confirm = (msg, { danger = false } = {}) => new Promise(resolve => {
    modal({
      title: '确认', body: `<p>${U.esc(msg)}</p>`, width: 420, raw: true,
      onClose: () => resolve(false),
      actions: [
        { label: '取消' },
        { label: danger ? '删除' : '确定', primary: !danger, danger, onClick: close => { resolve(true); close(); } },
      ],
    });
  });

  const prompt = (title, def = '', placeholder = '') => new Promise(resolve => {
    const m = modal({
      title, body: `<input class="input" id="ui-prompt-input" value="${U.esc(def)}" placeholder="${U.esc(placeholder)}">`,
      width: 460, raw: true,
      onClose: () => resolve(null),
      actions: [
        { label: '取消' },
        { label: '确定', primary: true, onClick: close => { resolve(m.el.querySelector('#ui-prompt-input').value.trim()); close(); } },
      ],
    });
    const input = m.el.querySelector('#ui-prompt-input');
    input.focus(); input.select();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { resolve(input.value.trim()); m.close(); } });
  });

  let spinnerCount = 0;
  function spinner(show, text = '处理中…') {
    let el = document.getElementById('ui-spinner');
    spinnerCount = Math.max(0, spinnerCount + (show ? 1 : -1));
    if (show && !el) {
      el = document.createElement('div');
      el.id = 'ui-spinner';
      el.className = 'spinner-mask';
      el.innerHTML = `<div class="spinner"></div><div class="spinner-text"></div>`;
      document.body.appendChild(el);
    }
    if (el) {
      el.querySelector('.spinner-text').textContent = text;
      el.style.display = spinnerCount > 0 ? 'flex' : 'none';
      if (spinnerCount === 0) el.remove();
    }
  }

  const emptyState = (text, extra = '') =>
    `<div class="empty"><div class="empty-icon">🗂</div><div>${U.esc(text)}</div>${extra}</div>`;

  /** 简易 tab 切换：tabsEl 内 .tab 按钮对应 panelEl 内 .tab-panel[data-name] */
  function tabs(tabsEl, panelEl, onChange) {
    tabsEl.addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      const name = btn.dataset.name;
      panelEl.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.name === name));
      onChange && onChange(name);
    });
  }

  /** 按钮的 loading 态包装 */
  async function busy(btn, fn, text = '处理中…') {
    if (btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = `⏳ ${text}`;
    spinner(true, text);
    try { return await fn(); }
    catch (e) { toast(e.message || '操作失败', 'error'); }
    finally {
      btn.disabled = false; btn.textContent = old;
      spinner(false);
    }
  }

  return { toast, modal, confirm, prompt, spinner, emptyState, tabs, busy };
})();
