// 笔记助教：选中文本提问 → 多轮追问 → 多会话 / 历史会话管理
// 会话落盘于 db.chatSessions；每个窗口持有独立的会话/发送/缩小状态，可同时向多个问题发起提问。
window.NoteChat = (() => {
  const COLL = 'chatSessions';
  const QUICK = ['总结一下这段笔记', '列出核心考点', '举个例子说明', '我还容易混淆什么？'];
  const KEEP_RECENT = 10;      // 最近 N 条消息始终逐字保留
  const AUTO_COMPACT_AT = 8;   // 未压缩旧消息达到该数量时自动生成摘要

  const windows = [];          // 当前打开的对话窗口（每个窗口有独立 pending / 会话 / @ 状态）
  let seq = 0;
  let chatWidth = 460;
  let storeListenerBound = false;

  function setChatWidth(w, persist = true) {
    const max = Math.max(360, Math.min(760, window.innerWidth - 260));
    chatWidth = U.clamp(Number(w) || 460, 360, max);
    document.documentElement.style.setProperty('--chat-width', chatWidth + 'px');
    if (persist) {
      try { localStorage.setItem('zhixue.chatWidth', String(chatWidth)); } catch (e) { /* 隐私模式忽略 */ }
    }
  }
  try { setChatWidth(Number(localStorage.getItem('zhixue.chatWidth')) || 460, false); } catch (e) { setChatWidth(460, false); }

  const all = () => Store.coll(COLL);
  const active = win => all().find(s => s.id === win?.activeId) || null;
  const noteOf = s => Store.find('notes', s?.noteId) || null;
  const noteById = id => Store.find('notes', id) || null;
  const memoryOf = s => {
    if (!s) return { summary: '', compacted: 0, updatedAt: null };
    return (s.memory ||= { summary: '', compacted: 0, updatedAt: null });
  };
  const isOpen = () => windows.length > 0;
  const primary = () => windows.find(x => x.primary) || null;

  function noteText(note) {
    if (!note) return '';
    const d = document.createElement('div');
    d.innerHTML = Sanitize.html(note.content || '');
    d.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,figcaption').forEach(el => {
      el.insertAdjacentText('afterend', '\n');
    });
    return (d.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 40000);
  }

  function makeTitle(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '选中内容提问';
    return s.slice(0, 18) + (s.length > 18 ? '…' : '');
  }

  function latestForNote(noteId) {
    return all()
      .filter(s => (s.noteId || null) === (noteId || null))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
  }

  function createSession({ noteId = null, selection = '', anchor = null, title = '', source = null } = {}) {
    const note = noteById(noteId);
    const s = {
      id: U.uid('chat'), noteId: noteId || null, noteTitle: note?.title || '通用问答',
      title: title || '新对话', context: { selection: String(selection || '').slice(0, 1200), anchor: anchor || null, source },
      memory: { summary: '', compacted: 0, updatedAt: null },
      messages: [], createdAt: U.now(), updatedAt: U.now(),
    };
    Store.insert(COLL, s);
    return s;
  }

  const emptyForNote = id => all().find(s => (s.noteId || null) === (id || null) && !s.messages?.length) || null;

  // ---------- 窗口布局：同时只展开一个，其余缩小为底部标签（生成不中断） ----------
  function updateBodyState() {
    document.body.classList.toggle('chat-open', windows.some(w => !w.minimized));
  }
  function layoutWindows() {
    let mini = 0;
    windows.forEach((w, i) => {
      w.el.style.zIndex = String(120 + i);
      if (w.minimized) w.el.style.setProperty('--mini-index', String(mini++));
      else w.el.style.removeProperty('--mini-index');
    });
    updateBodyState();
  }
  function activateWindow(w) {
    windows.forEach(other => {
      other.minimized = other !== w;
      other.el.classList.toggle('minimized', other.minimized);
    });
    layoutWindows();
    renderHeader(w);
  }
  function toggleMinimize(w) {
    w.minimized = !w.minimized;
    w.el.classList.toggle('minimized', w.minimized);
    if (!w.minimized) windows.forEach(other => {
      if (other !== w) { other.minimized = true; other.el.classList.add('minimized'); }
    });
    hideSelectionBar(w);
    layoutWindows();
    renderHeader(w);
  }

  // ---------- @ 提及 ----------
  function closeAt(w) {
    w.atState = null;
    w.atMenuEl?.remove();
    w.atMenuEl = null;
  }
  function renderPendingRefs(w) {
    const refs = w.pendingRefs;
    if (!refs.length) { w.els.refs.hidden = true; w.els.refs.innerHTML = ''; return; }
    w.els.refs.hidden = false;
    w.els.refs.innerHTML = refs.map((r, i) =>
      `<span class="chat-ref-chip">${Icon.svg(NoteRefs.KINDS[r.kind]?.icon || 'file', 12)} ${U.esc(r.title)}<button data-unref="${i}" title="移除引用">×</button></span>`).join('');
    w.els.refs.querySelectorAll('[data-unref]').forEach(btn => btn.onclick = () => {
      refs.splice(+btn.dataset.unref, 1);
      renderPendingRefs(w);
    });
  }
  function openAt(w, query = '', start = -1) {
    const q = query.trim().toLowerCase();
    const items = NoteRefs.all()
      .filter(r => !(r.kind === 'session' && r.id === w.activeId))  // 当前对话自身不进 @ 列表
      .filter(r => !q || (r.title + ' ' + r.desc).toLowerCase().includes(q))
      .slice(0, 10);
    w.atState = { items, index: 0, query, start };
    let menu = w.atMenuEl;
    if (!menu || !menu.isConnected) {
      menu = document.createElement('div');
      menu.className = 'chat-at-menu';
      if (w.primary) menu.id = 'chat-at-menu';
      document.body.appendChild(menu);
      w.atMenuEl = menu;
    }
    if (!items.length) {
      menu.innerHTML = '<div class="chat-at-empty">没有匹配的内容</div>';
    } else {
      menu.innerHTML = `<div class="chat-at-head">@ 引用内容（↑↓ 选择 · Enter 确认 · Esc 关闭）</div>` + items.map((r, i) =>
        `<button class="chat-at-item ${i === 0 ? 'active' : ''}" data-i="${i}">
          <span class="chat-at-icon">${Icon.svg(NoteRefs.KINDS[r.kind]?.icon || 'file', 14)}</span>
          <span class="chat-at-text"><b>${U.esc(r.title)}</b><small>${U.esc(NoteRefs.KINDS[r.kind]?.label || r.kind)} · ${U.esc(r.desc.slice(0, 50))}</small></span>
        </button>`).join('');
    }
    // 空结果也要定位显示，避免沿用上次打开时的旧几何位置
    const ir = w.els.input.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(ir.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, ir.top - menu.offsetHeight - 6) + 'px';
    menu.querySelectorAll('.chat-at-item').forEach(btn => btn.onclick = () => pickAt(w, +btn.dataset.i));
  }
  function pickAt(w, i) {
    if (!w.atState) return;
    const ref = w.atState.items[i];
    if (!ref) return;
    if (!w.pendingRefs.some(r => r.kind === ref.kind && r.id === ref.id)) w.pendingRefs.push({ kind: ref.kind, id: ref.id, title: ref.title, desc: ref.desc });
    // 按记录的 @ 起始位置精确移除查询片段（多个 @ 混排时不会删错）
    const el = w.els.input, pos = el.selectionStart, val = el.value;
    const start = w.atState.start >= 0 && val[w.atState.start] === '@' ? w.atState.start : val.lastIndexOf('@', Math.max(0, pos - 1));
    if (start >= 0) el.value = val.slice(0, start) + val.slice(pos);
    renderPendingRefs(w);
    closeAt(w);
    el.focus();
  }
  function handleAtInput(w) {
    const el = w.els.input, pos = el.selectionStart;
    const before = el.value.slice(0, pos);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) { if (w.atState) closeAt(w); return; }
    openAt(w, m[1] || '', m.index + m[0].indexOf('@'));
  }

  // ---------- 选中 AI 回答的一部分：批注 / 嵌套追问 ----------
  function hideSelectionBar(w) {
    w.selBar?.remove();
    w.selBar = null;
  }
  function captureBubbleSelection(w) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const bubble = node?.closest?.('.chat-bubble.ai-report');
    if (!bubble || !w.el.contains(bubble) || !bubble.contains(range.startContainer) || !bubble.contains(range.endContainer)) return null;
    const msg = bubble.closest('[data-msg-id]');
    if (!msg) return null;
    const holder = document.createElement('div');
    holder.appendChild(range.cloneContents());
    let html = Sanitize.html(holder.innerHTML);
    if (!html) return null;
    if (!/<(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|figure)(?:\s|>)/i.test(html)) html = `<p>${html}</p>`;
    const s = active(w);
    return {
      msgId: msg.dataset.msgId, html, rect: range.getBoundingClientRect(),
      text: String(sel.toString() || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
      sessionId: s?.id || msg.dataset.sessionId || null, noteId: s?.noteId || null,
    };
  }
  function sourceOf(w, picked) {
    const s = active(w);
    if (!s) return null;
    const i = s.messages.findIndex(m => m.id === picked.msgId);
    if (i < 0) return null;
    const parent = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
    return {
      sessionId: s.id, msgId: picked.msgId,
      question: U.asText(parent?.text || s.title || '').slice(0, 1200),
      html: picked.html,
    };
  }
  function appendPartToNote(w, msgId, html) {
    const s = active(w);
    if (!s) return;
    const i = s.messages.findIndex(m => m.id === msgId);
    if (i < 0) return;
    const user = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
    RichAsk.appendToNote(user?.text || s.title || 'AI 回答', user?.selection || s.context?.selection || '', html, s.noteId, s.context?.anchor);
  }
  // 嵌套追问：只带来源片段与父问题，不继承父会话的消息/摘要；笔记与锚点沿用父会话
  function askAboutPart(w, picked) {
    const source = sourceOf(w, picked) || picked.source;
    if (!source) return UI.toast('找不到这段回答的来源，请重新选中后再试', 'warn');
    openWindow({
      noteId: picked.noteId ?? source.noteId ?? null,
      selection: picked.text,
      anchor: active(w)?.context?.anchor || null,
      source, draft: '',
    });
  }
  function showSelectionBar(w, picked) {
    hideSelectionBar(w);
    const bar = document.createElement('div');
    bar.className = 'chat-selection-bar';
    bar.innerHTML = '<span>已选中回答片段</span>'
      + '<button type="button" data-act="ask">针对这段追问</button>'
      + '<button type="button" data-act="annot">作为批注插入</button>';
    document.body.appendChild(bar);
    w.selBar = bar;
    bar.style.left = U.clamp(picked.rect.left, 8, Math.max(8, window.innerWidth - 330)) + 'px';
    bar.style.top = Math.max(8, picked.rect.top - 44) + 'px';
    bar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());  // 保住选区
    });
    bar.querySelector('[data-act="ask"]').onclick = () => { askAboutPart(w, picked); hideSelectionBar(w); window.getSelection()?.removeAllRanges(); };
    bar.querySelector('[data-act="annot"]').onclick = () => { appendPartToNote(w, picked.msgId, picked.html); hideSelectionBar(w); window.getSelection()?.removeAllRanges(); };
  }

  function ensure(w) {
    const idAttr = name => w.primary ? ` id="${name}"` : '';
    const drawer = document.createElement('aside');
    drawer.className = 'chat-drawer' + (w.primary ? '' : ' chat-drawer-extra');
    if (w.primary) drawer.id = 'note-chat-drawer';
    drawer.innerHTML = `
      <div class="chat-resizer" title="拖拽调整宽度 · 双击恢复默认"></div>
      <div class="chat-head">
        <div class="chat-head-main">
          <div class="chat-head-icon">✒</div>
          <div class="chat-head-text">
            <div class="chat-head-title"${idAttr('chat-title')}>笔记助教</div>
            <div class="chat-head-sub"${idAttr('chat-sub')}>针对当前笔记连续提问</div>
          </div>
        </div>
        <div class="chat-head-ops">
          <button class="chat-icon-btn" data-act="agent" title="编辑模式：允许 AI 直接改笔记（逐项确认）">✎</button>
          <button class="chat-icon-btn" data-act="compact" title="压缩历史上下文">🧠</button>
          <button class="chat-icon-btn" data-act="history" title="历史对话">🕘</button>
          <button class="chat-icon-btn" data-act="new" title="本窗口新建对话">＋</button>
          <button class="chat-icon-btn" data-act="window" title="新开一个窗口提问（可同时问多个问题）">⊞</button>
          <button class="chat-icon-btn" data-act="minimize" title="缩小窗口，回答会在后台继续">—</button>
          <button class="chat-icon-btn" data-act="close" title="关闭此窗口">×</button>
        </div>
      </div>
      <div class="chat-body">
        <div class="chat-rail"${idAttr('chat-rail')}></div>
        <div class="chat-main">
          <div class="chat-memory"${idAttr('chat-memory')}></div>
          <div class="chat-context"${idAttr('chat-context')}></div>
          <div class="chat-messages"${idAttr('chat-messages')}></div>
          <div class="chat-composer-wrap">
            <div class="chat-quick"${idAttr('chat-quick')}>${QUICK.map(q => `<button class="chat-quick-btn" data-q="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>
            <div class="chat-composer">
              <div class="chat-refs"${idAttr('chat-refs')} hidden></div>
              <textarea class="chat-input"${idAttr('chat-input')} rows="2" placeholder="继续针对这篇笔记提问… 输入 @ 引用笔记/题库等内容（Enter 发送，Shift+Enter 换行）"></textarea>
              <div class="chat-composer-foot">
                <span class="chat-status"${idAttr('chat-status')}></span>
                <button class="btn btn-primary btn-sm"${idAttr('chat-send')}>发送</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(drawer);
    w.el = drawer;
    w.els = {
      title: drawer.querySelector('.chat-head-title'),
      sub: drawer.querySelector('.chat-head-sub'),
      agent: drawer.querySelector('.chat-head [data-act="agent"]'),
      compact: drawer.querySelector('.chat-head [data-act="compact"]'),
      rail: drawer.querySelector('.chat-rail'),
      memory: drawer.querySelector('.chat-memory'),
      context: drawer.querySelector('.chat-context'),
      messages: drawer.querySelector('.chat-messages'),
      quick: drawer.querySelector('.chat-quick'),
      refs: drawer.querySelector('.chat-refs'),
      input: drawer.querySelector('.chat-input'),
      status: drawer.querySelector('.chat-status'),
      send: drawer.querySelector('.chat-composer-foot .btn'),
    };
    w.cleanups = [];

    const resizer = drawer.querySelector('.chat-resizer');
    resizer.addEventListener('dblclick', () => setChatWidth(460));
    resizer.addEventListener('pointerdown', e => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('dragging');
      document.body.classList.add('pane-resizing');
      const onMove = ev => setChatWidth(window.innerWidth - ev.clientX, false);
      const onUp = () => {
        resizer.classList.remove('dragging');
        document.body.classList.remove('pane-resizing');
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        resizer.removeEventListener('pointercancel', onUp);
        setChatWidth(chatWidth);
      };
      resizer.addEventListener('pointermove', onMove);
      resizer.addEventListener('pointerup', onUp);
      resizer.addEventListener('pointercancel', onUp);
    });

    drawer.querySelector('.chat-head').addEventListener('click', e => {
      const op = e.target.closest('[data-act]');
      if (!op) { if (w.minimized) toggleMinimize(w); return; }
      if (op.dataset.act === 'close') closeWindow(w);
      else if (op.dataset.act === 'minimize') toggleMinimize(w);
      else if (op.dataset.act === 'window') {
        const draft = w.els.input.value.trim();
        openWindow({ noteId: w.currentNoteId, selection: active(w)?.context?.selection || '', anchor: active(w)?.context?.anchor || null, draft });
      }
      else if (op.dataset.act === 'agent') {
        w.agentMode = !w.agentMode;
        UI.toast(w.agentMode ? '编辑模式已开启：可直接让 AI 改笔记，每项编辑会先征得你确认' : '已退出编辑模式', w.agentMode ? 'success' : 'info');
        renderAll(w);
      }
      else if (op.dataset.act === 'compact') compactNow(active(w), {}, w);
      else if (op.dataset.act === 'new') newSession(w);
      else if (op.dataset.act === 'history') drawer.classList.toggle('show-history');
    });

    w.els.rail.addEventListener('click', async e => {
      const op = e.target.closest('[data-act]');
      if (op) {
        e.stopPropagation();
        const id = op.closest('.chat-session')?.dataset.id;
        if (op.dataset.act === 'new') return newSession(w);
        if (!id) return;
        const s = Store.find(COLL, id);
        if (!s) return;
        if (op.dataset.act === 'rename') {
          const title = await UI.prompt('重命名对话', s.title || '未命名对话', '给这段对话起个名字');
          if (title) { Store.update(COLL, id, { title: title.slice(0, 40) }); renderAll(w); }
        } else if (op.dataset.act === 'delete') {
          if (w.pending || w.compacting) return UI.toast('请等待当前任务完成后再删除', 'warn');
          if (!await UI.confirm(`删除对话「${s.title || '未命名对话'}」？此操作不可撤销。`, { danger: true })) return;
          Store.remove(COLL, id);
          if (w.activeId === id) w.activeId = latestForNote(w.currentNoteId)?.id || null;
          renderAll(w);
          UI.toast('对话已删除');
        }
        return;
      }
      const item = e.target.closest('.chat-session');
      if (item) selectSession(w, item.dataset.id);
    });

    w.els.context.addEventListener('click', e => {
      if (!e.target.closest('[data-act="clear-context"]')) return;
      const s = active(w);
      if (!s) return;
      s.context = { ...(s.context || {}), selection: '' };
      Store.update(COLL, s.id, { context: s.context });
      renderAll(w);
    });

    w.els.memory.addEventListener('click', e => {
      if (!e.target.closest('[data-act="view-memory"]')) return;
      const s = active(w);
      if (!s) return;
      UI.modal({
        title: '长期记忆摘要', width: 640, raw: true,
        body: `<div class="chat-memory-text">${U.esc(memoryOf(s).summary || '暂无')}</div>
          <div class="field-hint" style="margin-top:8px">摘要由更早的对话压缩生成，用于后续回答的上下文；原始消息仍完整保留在历史记录中。</div>`,
        actions: [{ label: '关闭' }],
      });
    });

    w.els.messages.addEventListener('click', e => {
      const op = e.target.closest('[data-act]');
      if (!op) return;
      if (op.dataset.act === 'ref') { NoteRefs.jump(op.dataset.kind, op.dataset.id); return; }
      const s = active(w);
      const msg = s?.messages.find(m => m.id === op.dataset.id);
      if (!msg) return;
      const content = U.asText(msg.html || msg.text || '');
      if (op.dataset.act === 'copy') {
        U.copyText(U.stripHtml(content));
        UI.toast('已复制回答');
      } else if (op.dataset.act === 'append') {
        const i = s.messages.indexOf(msg);
        const user = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
        RichAsk.appendToNote(user?.text || 'AI 回答', user?.selection || s.context?.selection || '', content, s.noteId, s.context?.anchor);
      } else if (op.dataset.act === 'annot-part' || op.dataset.act === 'ask-part') {
        const fresh = captureBubbleSelection(w);
        const picked = fresh?.msgId === msg.id ? fresh
          : (w.pendingAnnotation?.msgId === msg.id ? w.pendingAnnotation : null);
        if (!picked) return UI.toast('请先用鼠标选中回答中的一段文字，再点对应按钮', 'warn');
        if (op.dataset.act === 'ask-part') askAboutPart(w, picked);
        else appendPartToNote(w, picked.msgId, picked.html);
        hideSelectionBar(w);
      } else if (op.dataset.act === 'retry') {
        retry(w, msg.id);
      }
    });

    const onSelect = () => {
      const picked = captureBubbleSelection(w);
      if (!picked) { hideSelectionBar(w); w.pendingAnnotation = null; return; }
      w.pendingAnnotation = picked;
      showSelectionBar(w, picked);
    };
    w.els.messages.addEventListener('mouseup', () => setTimeout(onSelect, 0));
    w.els.messages.addEventListener('keyup', e => { if (e.shiftKey || e.key.startsWith('Arrow')) setTimeout(onSelect, 0); });
    w.els.messages.addEventListener('scroll', () => hideSelectionBar(w));

    w.els.quick.addEventListener('click', e => {
      const btn = e.target.closest('[data-q]');
      if (!btn || w.pending) return;
      w.els.input.value = btn.dataset.q;
      send(w);
    });

    w.els.send.addEventListener('click', () => send(w));
    w.els.refs.addEventListener('click', e => e.stopPropagation());
    w.els.input.addEventListener('input', () => handleAtInput(w));
    w.els.input.addEventListener('keydown', e => {
      if (w.atState && !e.isComposing) {  // 中文输入法选词期间不拦截按键
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && w.atState.items.length) {
          e.preventDefault();
          const n = w.atState.items.length;
          w.atState.index = (w.atState.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
          w.atMenuEl?.querySelectorAll('.chat-at-item').forEach((b, i) => b.classList.toggle('active', i === w.atState.index));
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (w.atState.items.length) { pickAt(w, w.atState.index); return; }
          closeAt(w);  // 无匹配项：关掉菜单，Enter 落到下方正常发送
        }
        else if (e.key === 'Escape') { e.preventDefault(); closeAt(w); return; }
        else return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(w); }
    });
    const onPointerDown = e => {
      if (w.atState && !e.target.closest?.('.chat-at-menu, .chat-input')) closeAt(w);
      if (w.selBar && !w.selBar.contains(e.target) && !w.els.messages.contains(e.target)) hideSelectionBar(w);
    };
    document.addEventListener('pointerdown', onPointerDown);
    w.cleanups.push(() => document.removeEventListener('pointerdown', onPointerDown));
    const onKeyDown = e => {
      if (e.key === 'Escape' && drawer.classList.contains('open') && !document.getElementById('modal-root').children.length) {
        if (w.atState) { closeAt(w); return; }
        if (windows[windows.length - 1] === w) closeWindow(w);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    w.cleanups.push(() => document.removeEventListener('keydown', onKeyDown));

    if (!storeListenerBound) {
      Store.on('config-changed', () => windows.forEach(renderAll));
      storeListenerBound = true;
    }
  }

  function createWindow({ primary: isPrimary = false } = {}) {
    const w = {
      id: ++seq, primary: isPrimary, el: null, els: {}, cleanups: [],
      activeId: null, currentNoteId: null, pending: false, compacting: false,
      agentMode: false, atState: null, atMenuEl: null, pendingRefs: [],
      minimized: false, selBar: null, pendingAnnotation: null,
    };
    ensure(w);
    windows.push(w);
    w.el.classList.add('open');
    layoutWindows();
    return w;
  }
  function primaryWindow() {
    return primary() || createWindow({ primary: true });
  }
  function closeWindow(w) {
    if (!w) return;
    closeAt(w);
    hideSelectionBar(w);
    w.cleanups.forEach(fn => fn());
    w.el.remove();
    const i = windows.indexOf(w);
    if (i >= 0) windows.splice(i, 1);
    layoutWindows();
  }
  function closeAll() { [...windows].forEach(closeWindow); }

  function renderHeader(w) {
    if (!w?.els?.title) return;
    const s = active(w);
    const note = noteOf(s) || noteById(w.currentNoteId);
    const mem = memoryOf(s);
    w.els.title.textContent = s?.title || '新对话';
    const status = w.minimized
      ? (w.pending ? '回答中…' : w.compacting ? '整理记忆中…' : '已完成 · 点击展开')
      : `${note?.title || '通用问答'} · ${s?.messages?.length || 0} 条 · 摘要 ${mem.compacted || 0} 条 · ${Store.aiLive() ? 'AI 已连接' : '演示模式'}${w.agentMode ? ' · 编辑模式' : ''}`;
    w.els.sub.textContent = status;
    w.el.classList.toggle('is-working', w.pending || w.compacting);
    w.els.agent?.classList.toggle('on', w.agentMode);
    if (w.els.agent) w.els.agent.title = w.agentMode ? '编辑模式已开启：点击关闭' : '编辑模式：允许 AI 直接改笔记（逐项确认）';
  }

  function renderMemory(w) {
    const s = active(w);
    const mem = memoryOf(s);
    if (!mem.summary) { w.els.memory.innerHTML = ''; w.els.memory.classList.remove('has-content'); return; }
    w.els.memory.classList.add('has-content');
    w.els.memory.innerHTML = `<div class="chat-memory-card">
      <span>🧠 长期记忆 · 已压缩 ${mem.compacted || 0} 条</span>
      <button data-act="view-memory">查看摘要</button>
    </div>`;
  }

  function renderRail(w) {
    const list = all();
    const mine = list.filter(s => (s.noteId || null) === (w.currentNoteId || null));
    const others = list.filter(s => (s.noteId || null) !== (w.currentNoteId || null));
    const item = s => {
      const own = (s.noteId || null) === (w.currentNoteId || null);
      const openElsewhere = windows.some(x => x !== w && x.activeId === s.id);
      return `<div class="chat-session ${s.id === w.activeId ? 'active' : ''}" data-id="${s.id}">
        <div class="chat-session-main">
          <div class="chat-session-title">${U.esc(s.title || '未命名对话')}${openElsewhere ? ' · 其他窗口' : ''}</div>
          <div class="chat-session-sub">${s.messages?.length || 0} 条 · ${U.fmt(s.updatedAt)}${own ? '' : ' · ' + U.esc(s.noteTitle || '其他')}</div>
        </div>
        <div class="chat-session-ops">
          <button data-act="rename" title="重命名">✎</button>
          <button data-act="delete" title="删除">×</button>
        </div>
      </div>`;
    };
    const group = (label, arr) => arr.length ? `<div class="chat-group-label">${label}（${arr.length}）</div>${arr.map(item).join('')}` : '';
    w.els.rail.innerHTML = `<button class="chat-new-session" data-act="new">＋ 新建对话</button>`
      + group('当前笔记', mine) + group('其他笔记', others);
  }

  function renderContext(w) {
    const s = active(w);
    const sel = s?.context?.selection || '';
    if (!sel) { w.els.context.innerHTML = ''; w.els.context.classList.remove('has-content'); return; }
    w.els.context.classList.add('has-content');
    w.els.context.innerHTML = `<div class="chat-context-card">
      <div class="chat-context-label">📌 本轮引用${s.noteTitle ? ' · ' + U.esc(s.noteTitle) : ''}</div>
      <div class="chat-context-text">${U.esc(sel.slice(0, 180))}${sel.length > 180 ? '…' : ''}</div>
      <button data-act="clear-context" title="清除引用">×</button>
    </div>`;
  }

  function renderMessages(w) {
    const s = active(w);
    if (!s || !s.messages?.length) {
      w.els.messages.innerHTML = `<div class="chat-empty">
        <div class="chat-empty-icon">✒</div>
        <div class="chat-empty-title">围绕这篇笔记，随便问</div>
        <div class="chat-empty-desc">选中笔记中的文字后右键提问，会自动带出引用；这里支持连续追问，并为每篇笔记保留多段历史对话。回答中选中一段文字可只把这段作为批注插入。</div>
      </div>`;
      return;
    }
    const refChips = refs => (refs?.length ? `<div class="chat-ref-chips">${refs.map(r =>
      `<button class="chat-ref-chip" data-act="ref" data-kind="${U.esc(r.kind)}" data-id="${U.esc(r.id)}" title="跳转到 ${U.esc(r.title)}">${Icon.svg(NoteRefs.KINDS[r.kind]?.icon || 'file', 12)} ${U.esc(r.title)}</button>`).join('')}</div>` : '');
    w.els.messages.innerHTML = s.messages.map(m => {
      if (m.role === 'user') {
        return `<div class="chat-msg chat-msg-user">
          <div class="chat-bubble">
            ${m.selection ? `<div class="chat-user-quote">引用：${U.esc(String(m.selection).slice(0, 120))}${String(m.selection).length > 120 ? '…' : ''}</div>` : ''}
            ${refChips(m.refs)}
            <div class="chat-user-text">${U.esc(U.asText(m.text || '')).replace(/\n/g, '<br>')}</div>
          </div>
          <div class="chat-avatar">我</div>
        </div>`;
      }
      const answer = U.asText(m.html || m.text || '');
      return `<div class="chat-msg chat-msg-ai" data-msg-id="${m.id}" data-session-id="${w.activeId}">
        <div class="chat-avatar ai">✒</div>
        <div class="chat-msg-col">
          ${refChips(m.refs)}
          ${m.edits?.length ? `<div class="chat-edit-log">${m.edits.map(x =>
            `<div class="chat-edit-item ${x.result?.ok ? 'ok' : 'fail'}">${x.result?.ok ? '✓' : '✕'} ${U.esc((x.args && (() => { try { return JSON.parse(x.args).reason || JSON.parse(x.args).action; } catch (_) { return '编辑'; } })()) || '编辑')}${x.result?.error ? ' · ' + U.esc(x.result.error) : ''}</div>`).join('')}</div>` : ''}
          <div class="chat-bubble ai-report">${Sanitize.html(answer)}</div>
          <div class="chat-msg-ops">
            <button data-act="ask-part" data-id="${m.id}" title="先在回答中选中一段文字">选段追问</button>
            <button data-act="annot-part" data-id="${m.id}" title="先在回答中选中一段文字">选段批注</button>
            <button data-act="append" data-id="${m.id}" title="整段回答作为批注插入">整段批注</button>
            <button data-act="copy" data-id="${m.id}">复制</button>
            <button data-act="retry" data-id="${m.id}">重新生成</button>
          </div>
        </div>
      </div>`;
    }).join('') + (w.pending ? `<div class="chat-msg chat-msg-ai"><div class="chat-avatar ai">✒</div><div class="chat-bubble chat-typing"><i></i><i></i><i></i></div></div>` : '');
    Ktx.renderMath(w.els.messages);
    requestAnimationFrame(() => { w.els.messages.scrollTop = w.els.messages.scrollHeight; });
  }

  function renderAll(w) {
    if (!w?.el?.isConnected) return;
    renderHeader(w);
    renderRail(w);
    renderMemory(w);
    renderContext(w);
    renderMessages(w);
    setBusy(w);
  }

  function setBusy(w) {
    const blocked = w.pending || w.compacting;
    w.els.input.disabled = blocked;
    w.els.send.disabled = blocked;
    w.els.compact.disabled = blocked;
    w.els.status.textContent = w.pending ? 'AI 思考中…'
      : w.compacting ? '整理长期记忆…'
      : (Store.aiLive() ? '' : '演示模式：回答为本地模拟');
  }

  async function compactNow(s, { silent = false, force = false } = {}, w = null) {
    if (!s) return false;
    w ||= windows.find(x => x.activeId === s.id) || windows[0] || null;
    if (!w) return false;
    if (w.pending) { if (!silent) UI.toast('请等待当前回答完成后再压缩', 'warn'); return false; }
    if (w.compacting) return false;
    const mem = memoryOf(s);
    const candidates = s.messages.slice(0, Math.max(0, s.messages.length - KEEP_RECENT)).filter(m => !m.compacted && m.role);
    if (!candidates.length && !force) {
      if (!silent) UI.toast('暂无需要压缩的历史', 'warn');
      return false;
    }
    w.compacting = true;
    renderAll(w);
    try {
      const res = await AI.compactChat({ summary: mem.summary, messages: candidates });
      mem.summary = U.asText(res?.text || '').slice(0, 2500);
      mem.compacted = (mem.compacted || 0) + candidates.length;
      mem.updatedAt = U.now();
      candidates.forEach(m => { m.compacted = true; });
      Store.update(COLL, s.id, { messages: s.messages, memory: mem });
      if (!silent) UI.toast(`已压缩 ${candidates.length} 条历史`, 'success');
      return true;
    } catch (e) {
      if (!silent) UI.toast(e.message || '压缩失败', 'error');
      return false;
    } finally {
      w.compacting = false;
      if (Store.find(COLL, s.id)) renderAll(w);
    }
  }

  async function maybeCompact(w, s) {
    const candidates = s.messages.slice(0, Math.max(0, s.messages.length - KEEP_RECENT)).filter(m => !m.compacted && m.role);
    if (candidates.length >= AUTO_COMPACT_AT) await compactNow(s, { silent: true }, w);
  }

  // 从 AI 回答中解析引用来源（《标题》 或 @kind:id），挂为可点击 chip，实现跨笔记/跨对话跳转
  function extractRefs(html) {
    const text = U.stripHtml(U.asText(html || ''));
    const out = [];
    const seen = new Set();
    const push = r => {
      const key = `${r.kind}:${r.id}`;
      if (!r || seen.has(key)) return;
      seen.add(key);
      out.push({ kind: r.kind, id: r.id, title: r.title, desc: r.desc });
    };
    // 历史对话只认用户显式 @ 引用；不从回答里的《标题》自动挂载，避免旧会话被动回灌
    const allRefs = NoteRefs.all().filter(r => r.kind !== 'session');
    for (const m of text.matchAll(/《([^《》]{1,80})》/g)) {
      const hit = allRefs.find(r => r.title === m[1]);
      if (hit) push(hit);
    }
    for (const m of text.matchAll(/@(note|annot|bank|entry|template|card|record|session):([A-Za-z0-9_-]+)/g)) {
      const item = NoteRefs.find(m[1], m[2]);
      if (item) push({ kind: m[1], id: m[2], ...NoteRefs.metaOf(m[1], item) });
    }
    return out;
  }

  async function generate(w, s, question, selection, opts = {}) {
    const agentMode = w.agentMode;
    const history = opts.history || s.messages.slice(0, -1);
    const insertAt = opts.insertAt;
    w.pending = true;
    renderAll(w);
    const insert = msg => {
      if (insertAt == null) s.messages.push(msg);
      else s.messages.splice(Math.min(insertAt, s.messages.length), 0, msg);
    };
    try {
      const note = noteOf(s);
      // 编辑模式在任意视图生效：未打开的笔记由 executeNoteEdit 离线路径直接写入（不再要求必须在笔记页）
      const useAgent = agentMode && Store.aiLive() && !!note;
      // @ 引用与全局检索：refsText 携带引用全文，digest 让模型知道全局有什么，onRead 供 search/read 工具
      const refs = opts.refs || [];
      const refsText = refs.map(r => NoteRefs.resolve(r).text).join('\n\n');
      const globalDigest = NoteRefs.digest();
      // 嵌套提问：只把用户选中的 AI 回答片段与父问题作为定位上下文，不继承父会话的历史/摘要
      const source = opts.source || s.context?.source || null;
      const quotedAnswer = U.asText(source?.html || '').slice(0, 4000);
      const parentQuestion = U.asText(source?.question || '').slice(0, 800);
      const onRead = {
        search: NoteRefs.search,
        resolve: NoteRefs.resolve,
        blocks: id => RichAsk.noteBlocks(id),
        readRange: (id, from, to) => RichAsk.readBlockRange(id, from, to),
      };
      const res = useAgent
        ? await AI.ctxChat({
          noteTitle: s.noteTitle || note?.title || '当前笔记',
          noteText: noteText(note),
          noteBlocks: RichAsk.noteBlocks(),
          selection,
          question,
          history,
          summary: memoryOf(s).summary,
          refsText, globalDigest, onRead, quotedAnswer, parentQuestion,
          noteId: note?.id || '',
          onToolCall: RichAsk.executeNoteEdit,
          onCrud: RichAsk.executeAgentOp,
        })
        : await AI.ctxChat({
          noteTitle: s.noteTitle || note?.title || '当前笔记',
          noteText: noteText(note),
          selection,
          question,
          history,
          summary: memoryOf(s).summary,
          refsText, globalDigest, onRead, quotedAnswer, parentQuestion,
          noteId: note?.id || '',
        });
      const html = U.asText(res?.html ?? '');
      const cited = extractRefs(html);
      insert({
        id: U.uid('msg'), role: 'assistant', html, text: U.stripHtml(html),
        demo: !!res?.demo, context: res?.context || null, edits: res?.edits || null,
        refs: cited.length ? cited : undefined, createdAt: U.now(),
      });
      Store.update(COLL, s.id, { messages: s.messages });
      await maybeCompact(w, s);
    } catch (e) {
      insert({
        id: U.uid('msg'), role: 'assistant', text: e.message || 'AI 调用失败',
        html: `<p class="chat-error">AI 调用失败：${U.esc(e.message || '未知错误')}</p>`,
        error: true, createdAt: U.now(),
      });
      Store.update(COLL, s.id, { messages: s.messages });
      UI.toast(e.message || 'AI 调用失败', 'error');
    } finally {
      w.pending = false;
      if (Store.find(COLL, s.id)) renderAll(w);
      if (w.minimized) UI.toast(`「${s.title || '对话'}」回答已完成`, 'success');
      else if (w.el.isConnected) w.els.input.focus();
    }
  }

  async function send(w) {
    if (w.pending || w.compacting) return;
    const q = w.els.input.value.trim();
    if (!q) return UI.toast('请输入问题', 'warn');
    let s = active(w);
    if (!s) {
      s = createSession({ noteId: w.currentNoteId });
      w.activeId = s.id;
    }
    const selection = s.context?.selection || '';
    // 消费待发送的 @ 引用：存入用户消息（气泡渲染可点击 chip），并清空输入区 chips
    const refs = w.pendingRefs.splice(0).map(r => ({ ...r }));
    renderPendingRefs(w);
    s.messages.push({ id: U.uid('msg'), role: 'user', text: q, selection, refs: refs.length ? refs : undefined, createdAt: U.now() });
    if (s.messages.filter(m => m.role === 'user').length === 1 && (!s.title || s.title === '新对话')) {
      s.title = makeTitle(q);
    }
    Store.update(COLL, s.id, { messages: s.messages, title: s.title, context: s.context });
    w.els.input.value = '';
    await generate(w, s, q, selection, { history: s.messages.slice(0, -1), refs, source: s.context?.source });
  }

  async function retry(w, msgId) {
    if (w.pending || w.compacting) return UI.toast('请等待当前任务完成后再重新生成', 'warn');
    const s = active(w);
    if (!s) return;
    const i = s.messages.findIndex(m => m.id === msgId);
    if (i < 0 || s.messages[i].role !== 'assistant') return;
    const user = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
    if (!user) return;
    const userAt = s.messages.indexOf(user);
    const history = s.messages.slice(0, userAt);
    s.messages.splice(i, 1);
    Store.update(COLL, s.id, { messages: s.messages });
    await generate(w, s, U.asText(user.text), user.selection || s.context?.selection || '', { history, insertAt: i, refs: user.refs || [] });
  }

  function newSession(w = primaryWindow()) {
    if (w.pending || w.compacting) return UI.toast('请等待当前任务完成后再新建对话', 'warn');
    const s = createSession({ noteId: w.currentNoteId });
    w.activeId = s.id;
    renderAll(w);
    w.els.input.focus();
    UI.toast('已新建对话');
  }

  function selectSession(w, id) {
    if (w.pending || w.compacting) return UI.toast('请等待当前任务完成后再切换对话', 'warn');
    const s = Store.find(COLL, id);
    if (!s) return;
    w.activeId = id;
    w.currentNoteId = s.noteId || null;
    w.el.classList.remove('show-history');
    renderAll(w);
    w.els.input.focus();
  }

  function applySessionOpts(w, opts) {
    const hasNoteId = Object.prototype.hasOwnProperty.call(opts, 'noteId');
    w.currentNoteId = hasNoteId ? opts.noteId : (Views.notes?.currentId || w.currentNoteId || null);
    if (opts.sessionId && Store.find(COLL, opts.sessionId)) {
      w.activeId = opts.sessionId;
    } else if (opts.newSession || !active(w) || (active(w).noteId || null) !== (w.currentNoteId || null)) {
      // 不带 sessionId 的打开只复用「空会话」，绝不把上一次问答的消息/摘要带进新提问
      const reuse = opts.newSession ? null : emptyForNote(w.currentNoteId);
      w.activeId = (reuse || createSession({
        noteId: w.currentNoteId, selection: opts.selection, anchor: opts.anchor, source: opts.source || null,
      })).id;
    }
    const s = active(w);
    if (s && (opts.selection || opts.anchor || opts.source)) {
      s.context = {
        ...(s.context || {}),
        ...(opts.selection ? { selection: String(opts.selection).slice(0, 1200) } : {}),
        ...(opts.anchor ? { anchor: opts.anchor } : {}),
        ...(opts.source ? { source: opts.source } : {}),
      };
      Store.update(COLL, s.id, { context: s.context });
    }
    if (opts.draft !== undefined) w.els.input.value = opts.draft || '';
    if (opts.question) w.els.input.value = opts.question;
  }

  function open(opts = {}) {
    const existing = opts.sessionId ? windows.find(x => x.activeId === opts.sessionId) : null;
    if (existing) { activateWindow(existing); return; }
    const w = primaryWindow();
    if (opts.newSession && (w.pending || w.compacting)) {
      activateWindow(w);
      renderAll(w);
      UI.toast('请等待当前任务完成后再发起新提问', 'warn');
      return;
    }
    applySessionOpts(w, opts);
    activateWindow(w);
    renderAll(w);
    if (opts.question && opts.autoSend !== false) send(w);
    else setTimeout(() => w.els.input.focus(), 60);
  }

  /** 新开一个独立窗口提问：可与已有窗口的提问同时进行；首次调用复用主对话栏的 id */
  function openWindow(opts = {}) {
    const w = createWindow({ primary: windows.length === 0 });
    applySessionOpts(w, { ...opts, newSession: true });
    activateWindow(w);
    renderAll(w);
    if (opts.question && opts.autoSend !== false) send(w);
    else setTimeout(() => w.els.input.focus(), 60);
    return w.id;
  }

  function close() { closeAll(); }
  function toggle() {
    if (!windows.length) return open();
    if (windows.every(w => w.minimized)) return activateWindow(windows[windows.length - 1]);
    closeAll();
  }

  function onNoteChange(id) {
    windows.forEach(w => {
      if (w.pending || w.compacting) return;
      w.currentNoteId = id || null;
      const s = active(w);
      if (!s || (s.noteId || null) !== w.currentNoteId) {
        w.activeId = (emptyForNote(w.currentNoteId) || createSession({ noteId: w.currentNoteId })).id;
      }
      renderAll(w);
    });
  }

  const getAnchor = () => {
    const s = active(primary());
    if (!s?.context?.anchor) return null;
    // 同时返回会话记录的选中文本，供 replace_selection 校验 anchor 是否漂移
    return { anchor: s.context.anchor, selection: s.context.selection || '' };
  };

  return {
    open, openWindow, close, toggle, newSession, compactNow, onNoteChange, getAnchor,
    minimizeWindow: id => { const w = windows.find(x => x.id === id); if (w) toggleMinimize(w); },
    closeWindow: id => { const w = windows.find(x => x.id === id); if (w) closeWindow(w); },
    get windowCount() { return windows.length; },
    get isOpen() { return isOpen(); },
  };
})();
