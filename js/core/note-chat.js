// 笔记助教右侧对话栏：选中文本提问 → 多轮追问 → 多会话 / 历史会话管理
// 会话落盘于 db.chatSessions；每条会话绑定一篇笔记（或通用问答），保留选中文本引用与完整消息。
window.NoteChat = (() => {
  const COLL = 'chatSessions';
  const QUICK = ['总结一下这段笔记', '列出核心考点', '举个例子说明', '我还容易混淆什么？'];
  const KEEP_RECENT = 10;      // 最近 N 条消息始终逐字保留
  const AUTO_COMPACT_AT = 8;   // 未压缩旧消息达到该数量时自动生成摘要

  let drawer = null;
  let els = {};
  let activeId = null;
  let currentNoteId = null;
  let pending = false;
  let compacting = false;
  let chatWidth = 460;
  let agentMode = false;   // 编辑模式：允许 AI 通过 tool_calls 直接改笔记（需逐项确认）
  let atState = null;      // @ 提及弹层状态：{ start, query, items, index }
  const pendingRefs = [];  // 当前输入待发送的 @ 引用 [{kind,id,title,desc}]

  function setChatWidth(w, persist = true) {
    const max = Math.max(360, Math.min(760, window.innerWidth - 260));
    chatWidth = U.clamp(Number(w) || 460, 360, max);
    document.documentElement.style.setProperty('--chat-width', chatWidth + 'px');
    if (persist) {
      try { localStorage.setItem('zhixue.chatWidth', String(chatWidth)); } catch (e) { /* 隐私模式忽略 */ }
    }
  }
  try { setChatWidth(Number(localStorage.getItem('zhixue.chatWidth')) || 460, false); } catch (e) { setChatWidth(460, false); }

  const isOpen = () => !!drawer?.classList.contains('open');
  const all = () => Store.coll(COLL);
  const active = () => all().find(s => s.id === activeId) || null;
  const noteOf = s => Store.find('notes', s?.noteId) || null;
  const noteById = id => Store.find('notes', id) || null;
  const memoryOf = s => {
    if (!s) return { summary: '', compacted: 0, updatedAt: null };
    return (s.memory ||= { summary: '', compacted: 0, updatedAt: null });
  };

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

  function createSession({ noteId = null, selection = '', anchor = null, title = '' } = {}) {
    const note = noteById(noteId);
    const s = {
      id: U.uid('chat'), noteId: noteId || null, noteTitle: note?.title || '通用问答',
      title: title || '新对话', context: { selection: String(selection || '').slice(0, 1200), anchor: anchor || null },
      memory: { summary: '', compacted: 0, updatedAt: null },
      messages: [], createdAt: U.now(), updatedAt: U.now(),
    };
    Store.insert(COLL, s);
    return s;
  }

  // ---------- @ 提及 ----------
  function closeAt() {
    atState = null;
    document.querySelectorAll('#chat-at-menu').forEach(el => el.remove());
  }
  function renderPendingRefs() {
    if (!pendingRefs.length) { els.refs.hidden = true; els.refs.innerHTML = ''; return; }
    els.refs.hidden = false;
    els.refs.innerHTML = pendingRefs.map((r, i) =>
      `<span class="chat-ref-chip">${Icon.svg(NoteRefs.KINDS[r.kind]?.icon || 'file', 12)} ${U.esc(r.title)}<button data-unref="${i}" title="移除引用">×</button></span>`).join('');
    els.refs.querySelectorAll('[data-unref]').forEach(btn => btn.onclick = () => {
      pendingRefs.splice(+btn.dataset.unref, 1);
      renderPendingRefs();
    });
  }
  function openAt(query = '', start = -1) {
    const q = query.trim().toLowerCase();
    const items = NoteRefs.all()
      .filter(r => !(r.kind === 'session' && r.id === activeId))  // 当前对话自身不进 @ 列表
      .filter(r => !q || (r.title + ' ' + r.desc).toLowerCase().includes(q))
      .slice(0, 10);
    atState = { items, index: 0, query, start };
    let menu = document.getElementById('chat-at-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'chat-at-menu';
      menu.className = 'chat-at-menu';
      document.body.appendChild(menu);
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
    const ir = els.input.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(ir.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, ir.top - menu.offsetHeight - 6) + 'px';
    menu.querySelectorAll('.chat-at-item').forEach(btn => btn.onclick = () => pickAt(+btn.dataset.i));
  }
  function pickAt(i) {
    if (!atState) return;
    const ref = atState.items[i];
    if (!ref) return;
    if (!pendingRefs.some(r => r.kind === ref.kind && r.id === ref.id)) pendingRefs.push({ kind: ref.kind, id: ref.id, title: ref.title, desc: ref.desc });
    // 按记录的 @ 起始位置精确移除查询片段（多个 @ 混排时不会删错）
    const el = els.input, pos = el.selectionStart, val = el.value;
    const start = atState.start >= 0 && val[atState.start] === '@' ? atState.start : val.lastIndexOf('@', Math.max(0, pos - 1));
    if (start >= 0) el.value = val.slice(0, start) + val.slice(pos);
    renderPendingRefs();
    closeAt();
    el.focus();
  }
  function handleAtInput() {
    const el = els.input, pos = el.selectionStart;
    const before = el.value.slice(0, pos);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) { if (atState) closeAt(); return; }
    openAt(m[1] || '', m.index + m[0].indexOf('@'));
  }

  function ensure() {
    if (drawer) return;
    drawer = document.createElement('aside');
    drawer.className = 'chat-drawer';
    drawer.id = 'note-chat-drawer';
    drawer.innerHTML = `
      <div class="chat-resizer" title="拖拽调整宽度 · 双击恢复默认"></div>
      <div class="chat-head">
        <div class="chat-head-main">
          <div class="chat-head-icon">✒</div>
          <div class="chat-head-text">
            <div class="chat-head-title" id="chat-title">笔记助教</div>
            <div class="chat-head-sub" id="chat-sub">针对当前笔记连续提问</div>
          </div>
        </div>
        <div class="chat-head-ops">
          <button class="chat-icon-btn" data-act="agent" title="编辑模式：允许 AI 直接改笔记（逐项确认）">✎</button>
          <button class="chat-icon-btn" data-act="compact" title="压缩历史上下文">🧠</button>
          <button class="chat-icon-btn" data-act="history" title="历史对话">🕘</button>
          <button class="chat-icon-btn" data-act="new" title="新建对话">＋</button>
          <button class="chat-icon-btn" data-act="close" title="收起对话栏">×</button>
        </div>
      </div>
      <div class="chat-body">
        <div class="chat-rail" id="chat-rail"></div>
        <div class="chat-main">
          <div class="chat-memory" id="chat-memory"></div>
          <div class="chat-context" id="chat-context"></div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-composer-wrap">
            <div class="chat-quick" id="chat-quick">${QUICK.map(q => `<button class="chat-quick-btn" data-q="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>
            <div class="chat-composer">
              <div class="chat-refs" id="chat-refs" hidden></div>
              <textarea class="chat-input" id="chat-input" rows="2" placeholder="继续针对这篇笔记提问… 输入 @ 引用笔记/题库等内容（Enter 发送，Shift+Enter 换行）"></textarea>
              <div class="chat-composer-foot">
                <span class="chat-status" id="chat-status"></span>
                <button class="btn btn-primary btn-sm" id="chat-send">发送</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(drawer);

    els = {
      title: drawer.querySelector('#chat-title'),
      sub: drawer.querySelector('#chat-sub'),
      agent: drawer.querySelector('.chat-head [data-act="agent"]'),
      compact: drawer.querySelector('.chat-head [data-act="compact"]'),
      rail: drawer.querySelector('#chat-rail'),
      memory: drawer.querySelector('#chat-memory'),
      context: drawer.querySelector('#chat-context'),
      messages: drawer.querySelector('#chat-messages'),
      quick: drawer.querySelector('#chat-quick'),
      refs: drawer.querySelector('#chat-refs'),
      input: drawer.querySelector('#chat-input'),
      status: drawer.querySelector('#chat-status'),
      send: drawer.querySelector('#chat-send'),
    };

    Store.on('config-changed', () => { if (isOpen()) renderAll(); });

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
      if (!op) return;
      if (op.dataset.act === 'close') close();
      else if (op.dataset.act === 'agent') {
        agentMode = !agentMode;
        UI.toast(agentMode ? '编辑模式已开启：可直接让 AI 改笔记，每项编辑会先征得你确认' : '已退出编辑模式', agentMode ? 'success' : 'info');
        renderAll();
      }
      else if (op.dataset.act === 'compact') compactNow(active());
      else if (op.dataset.act === 'new') newSession();
      else if (op.dataset.act === 'history') drawer.classList.toggle('show-history');
    });

    els.rail.addEventListener('click', async e => {
      const op = e.target.closest('[data-act]');
      if (op) {
        e.stopPropagation();
        const id = op.closest('.chat-session')?.dataset.id;
        if (op.dataset.act === 'new') return newSession();
        if (!id) return;
        const s = Store.find(COLL, id);
        if (!s) return;
        if (op.dataset.act === 'rename') {
          const title = await UI.prompt('重命名对话', s.title || '未命名对话', '给这段对话起个名字');
          if (title) { Store.update(COLL, id, { title: title.slice(0, 40) }); renderAll(); }
        } else if (op.dataset.act === 'delete') {
          if (pending || compacting) return UI.toast('请等待当前任务完成后再删除', 'warn');
          if (!await UI.confirm(`删除对话「${s.title || '未命名对话'}」？此操作不可撤销。`, { danger: true })) return;
          Store.remove(COLL, id);
          if (activeId === id) activeId = latestForNote(currentNoteId)?.id || null;
          renderAll();
          UI.toast('对话已删除');
        }
        return;
      }
      const item = e.target.closest('.chat-session');
      if (item) selectSession(item.dataset.id);
    });

    els.context.addEventListener('click', e => {
      if (!e.target.closest('[data-act="clear-context"]')) return;
      const s = active();
      if (!s) return;
      s.context = { ...(s.context || {}), selection: '' };
      Store.update(COLL, s.id, { context: s.context });
      renderAll();
    });

    els.memory.addEventListener('click', e => {
      if (!e.target.closest('[data-act="view-memory"]')) return;
      const s = active();
      if (!s) return;
      UI.modal({
        title: '长期记忆摘要', width: 640, raw: true,
        body: `<div class="chat-memory-text">${U.esc(memoryOf(s).summary || '暂无')}</div>
          <div class="field-hint" style="margin-top:8px">摘要由更早的对话压缩生成，用于后续回答的上下文；原始消息仍完整保留在历史记录中。</div>`,
        actions: [{ label: '关闭' }],
      });
    });

    els.messages.addEventListener('click', e => {
      const op = e.target.closest('[data-act]');
      if (!op) return;
      if (op.dataset.act === 'ref') { NoteRefs.jump(op.dataset.kind, op.dataset.id); return; }
      const s = active();
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
      } else if (op.dataset.act === 'retry') {
        retry(msg.id);
      }
    });

    els.quick.addEventListener('click', e => {
      const btn = e.target.closest('[data-q]');
      if (!btn || pending) return;
      els.input.value = btn.dataset.q;
      send();
    });

    els.send.addEventListener('click', send);
    els.refs.addEventListener('click', e => e.stopPropagation());
    els.input.addEventListener('input', handleAtInput);
    els.input.addEventListener('keydown', e => {
      if (atState && !e.isComposing) {  // 中文输入法选词期间不拦截按键
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && atState.items.length) {
          e.preventDefault();
          const n = atState.items.length;
          atState.index = (atState.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
          document.querySelectorAll('.chat-at-item').forEach((b, i) => b.classList.toggle('active', i === atState.index));
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (atState.items.length) { pickAt(atState.index); return; }
          closeAt();  // 无匹配项：关掉菜单，Enter 落到下方正常发送
        }
        else if (e.key === 'Escape') { e.preventDefault(); closeAt(); return; }
        else return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    document.addEventListener('pointerdown', e => {
      if (atState && !e.target.closest?.('#chat-at-menu, #chat-input')) closeAt();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen() && !document.getElementById('modal-root').children.length) {
        if (atState) { closeAt(); return; }
        close();
      }
    });
  }

  function renderHeader() {
    const s = active();
    const note = noteOf(s) || noteById(currentNoteId);
    const mem = memoryOf(s);
    els.title.textContent = s?.title || '新对话';
    els.sub.textContent = `${note?.title || '通用问答'} · ${s?.messages?.length || 0} 条 · 摘要 ${mem.compacted || 0} 条 · ${Store.aiLive() ? 'AI 已连接' : '演示模式'}${agentMode ? ' · 编辑模式' : ''}`;
    els.agent?.classList.toggle('on', agentMode);
    if (els.agent) els.agent.title = agentMode ? '编辑模式已开启：点击关闭' : '编辑模式：允许 AI 直接改笔记（逐项确认）';
  }

  function renderMemory() {
    const s = active();
    const mem = memoryOf(s);
    if (!mem.summary) { els.memory.innerHTML = ''; els.memory.classList.remove('has-content'); return; }
    els.memory.classList.add('has-content');
    els.memory.innerHTML = `<div class="chat-memory-card">
      <span>🧠 长期记忆 · 已压缩 ${mem.compacted || 0} 条</span>
      <button data-act="view-memory">查看摘要</button>
    </div>`;
  }

  function renderRail() {
    const list = all();
    const mine = list.filter(s => (s.noteId || null) === (currentNoteId || null));
    const others = list.filter(s => (s.noteId || null) !== (currentNoteId || null));
    const item = s => {
      const own = (s.noteId || null) === (currentNoteId || null);
      return `<div class="chat-session ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">
        <div class="chat-session-main">
          <div class="chat-session-title">${U.esc(s.title || '未命名对话')}</div>
          <div class="chat-session-sub">${s.messages?.length || 0} 条 · ${U.fmt(s.updatedAt)}${own ? '' : ' · ' + U.esc(s.noteTitle || '其他')}</div>
        </div>
        <div class="chat-session-ops">
          <button data-act="rename" title="重命名">✎</button>
          <button data-act="delete" title="删除">×</button>
        </div>
      </div>`;
    };
    const group = (label, arr) => arr.length ? `<div class="chat-group-label">${label}（${arr.length}）</div>${arr.map(item).join('')}` : '';
    els.rail.innerHTML = `<button class="chat-new-session" data-act="new">＋ 新建对话</button>`
      + group('当前笔记', mine) + group('其他笔记', others);
  }

  function renderContext() {
    const s = active();
    const sel = s?.context?.selection || '';
    if (!sel) { els.context.innerHTML = ''; els.context.classList.remove('has-content'); return; }
    els.context.classList.add('has-content');
    els.context.innerHTML = `<div class="chat-context-card">
      <div class="chat-context-label">📌 本轮引用${s.noteTitle ? ' · ' + U.esc(s.noteTitle) : ''}</div>
      <div class="chat-context-text">${U.esc(sel.slice(0, 180))}${sel.length > 180 ? '…' : ''}</div>
      <button data-act="clear-context" title="清除引用">×</button>
    </div>`;
  }

  function renderMessages() {
    const s = active();
    if (!s || !s.messages?.length) {
      els.messages.innerHTML = `<div class="chat-empty">
        <div class="chat-empty-icon">✒</div>
        <div class="chat-empty-title">围绕这篇笔记，随便问</div>
        <div class="chat-empty-desc">选中笔记中的文字后右键提问，会自动带出引用；这里支持连续追问，并为每篇笔记保留多段历史对话。</div>
      </div>`;
      return;
    }
    const refChips = refs => (refs?.length ? `<div class="chat-ref-chips">${refs.map(r =>
      `<button class="chat-ref-chip" data-act="ref" data-kind="${U.esc(r.kind)}" data-id="${U.esc(r.id)}" title="跳转到 ${U.esc(r.title)}">${Icon.svg(NoteRefs.KINDS[r.kind]?.icon || 'file', 12)} ${U.esc(r.title)}</button>`).join('')}</div>` : '');
    els.messages.innerHTML = s.messages.map(m => {
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
      return `<div class="chat-msg chat-msg-ai">
        <div class="chat-avatar ai">✒</div>
        <div class="chat-msg-col">
          ${refChips(m.refs)}
          ${m.edits?.length ? `<div class="chat-edit-log">${m.edits.map(x =>
            `<div class="chat-edit-item ${x.result?.ok ? 'ok' : 'fail'}">${x.result?.ok ? '✓' : '✕'} ${U.esc((x.args && (() => { try { return JSON.parse(x.args).reason || JSON.parse(x.args).action; } catch (_) { return '编辑'; } })()) || '编辑')}${x.result?.error ? ' · ' + U.esc(x.result.error) : ''}</div>`).join('')}</div>` : ''}
          <div class="chat-bubble ai-report">${Sanitize.html(answer)}</div>
          <div class="chat-msg-ops">
            <button data-act="copy" data-id="${m.id}">复制</button>
            <button data-act="append" data-id="${m.id}">追加到笔记</button>
            <button data-act="retry" data-id="${m.id}">重新生成</button>
          </div>
        </div>
      </div>`;
    }).join('') + (pending ? `<div class="chat-msg chat-msg-ai"><div class="chat-avatar ai">✒</div><div class="chat-bubble chat-typing"><i></i><i></i><i></i></div></div>` : '');
    Ktx.renderMath(els.messages);
    requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
  }

  function renderAll() {
    if (!drawer) return;
    renderHeader();
    renderRail();
    renderMemory();
    renderContext();
    renderMessages();
    setBusy(pending);
  }

  function setBusy(busy) {
    const blocked = pending || compacting;
    els.input.disabled = blocked;
    els.send.disabled = blocked;
    els.compact.disabled = blocked;
    els.status.textContent = pending ? 'AI 思考中…'
      : compacting ? '整理长期记忆…'
      : (Store.aiLive() ? '' : '演示模式：回答为本地模拟');
  }

  async function compactNow(s, { silent = false, force = false } = {}) {
    if (!s) return false;
    if (pending) { if (!silent) UI.toast('请等待当前回答完成后再压缩', 'warn'); return false; }
    if (compacting) return false;
    const mem = memoryOf(s);
    const candidates = s.messages.slice(0, Math.max(0, s.messages.length - KEEP_RECENT)).filter(m => !m.compacted && m.role);
    if (!candidates.length && !force) {
      if (!silent) UI.toast('暂无需要压缩的历史', 'warn');
      return false;
    }
    compacting = true;
    renderAll();
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
      compacting = false;
      if (Store.find(COLL, s.id)) renderAll();
    }
  }

  async function maybeCompact(s) {
    const candidates = s.messages.slice(0, Math.max(0, s.messages.length - KEEP_RECENT)).filter(m => !m.compacted && m.role);
    if (candidates.length >= AUTO_COMPACT_AT) await compactNow(s, { silent: true });
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
    const allRefs = NoteRefs.all();
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

  async function generate(s, question, selection, opts = {}) {
    const history = opts.history || s.messages.slice(0, -1);
    const insertAt = opts.insertAt;
    pending = true;
    renderAll();
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
          refsText, globalDigest, onRead,
          noteId: note?.id || '',
          onToolCall: RichAsk.executeNoteEdit,
        })
        : await AI.ctxChat({
          noteTitle: s.noteTitle || note?.title || '当前笔记',
          noteText: noteText(note),
          selection,
          question,
          history,
          summary: memoryOf(s).summary,
          refsText, globalDigest, onRead,
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
      await maybeCompact(s);
    } catch (e) {
      insert({
        id: U.uid('msg'), role: 'assistant', text: e.message || 'AI 调用失败',
        html: `<p class="chat-error">AI 调用失败：${U.esc(e.message || '未知错误')}</p>`,
        error: true, createdAt: U.now(),
      });
      Store.update(COLL, s.id, { messages: s.messages });
      UI.toast(e.message || 'AI 调用失败', 'error');
    } finally {
      pending = false;
      if (Store.find(COLL, s.id)) renderAll();
      if (isOpen()) els.input.focus();
    }
  }

  async function send() {
    if (pending || compacting) return;
    const q = els.input.value.trim();
    if (!q) return UI.toast('请输入问题', 'warn');
    let s = active();
    if (!s) {
      s = createSession({ noteId: currentNoteId });
      activeId = s.id;
    }
    const selection = s.context?.selection || '';
    // 消费待发送的 @ 引用：存入用户消息（气泡渲染可点击 chip），并清空输入区 chips
    const refs = pendingRefs.splice(0).map(r => ({ ...r }));
    renderPendingRefs();
    s.messages.push({ id: U.uid('msg'), role: 'user', text: q, selection, refs: refs.length ? refs : undefined, createdAt: U.now() });
    if (s.messages.filter(m => m.role === 'user').length === 1 && (!s.title || s.title === '新对话')) {
      s.title = makeTitle(q);
    }
    Store.update(COLL, s.id, { messages: s.messages, title: s.title, context: s.context });
    els.input.value = '';
    await generate(s, q, selection, { history: s.messages.slice(0, -1), refs });
  }

  async function retry(msgId) {
    if (pending || compacting) return UI.toast('请等待当前任务完成后再重新生成', 'warn');
    const s = active();
    if (!s) return;
    const i = s.messages.findIndex(m => m.id === msgId);
    if (i < 0 || s.messages[i].role !== 'assistant') return;
    const user = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
    if (!user) return;
    const userAt = s.messages.indexOf(user);
    const history = s.messages.slice(0, userAt);
    s.messages.splice(i, 1);
    Store.update(COLL, s.id, { messages: s.messages });
    await generate(s, U.asText(user.text), user.selection || s.context?.selection || '', { history, insertAt: i, refs: user.refs || [] });
  }

  function newSession() {
    if (pending || compacting) return UI.toast('请等待当前任务完成后再新建对话', 'warn');
    const s = createSession({ noteId: currentNoteId });
    activeId = s.id;
    renderAll();
    els.input.focus();
    UI.toast('已新建对话');
  }

  function selectSession(id) {
    if (pending || compacting) return UI.toast('请等待当前任务完成后再切换对话', 'warn');
    const s = Store.find(COLL, id);
    if (!s) return;
    activeId = id;
    currentNoteId = s.noteId || null;
    drawer.classList.remove('show-history');
    renderAll();
    els.input.focus();
  }

  function open(opts = {}) {
    ensure();
    if (opts.newSession && (pending || compacting)) {
      drawer.classList.add('open');
      document.body.classList.add('chat-open');
      renderAll();
      UI.toast('请等待当前任务完成后再发起新提问', 'warn');
      return;
    }
    const hasNoteId = Object.prototype.hasOwnProperty.call(opts, 'noteId');
    currentNoteId = hasNoteId ? opts.noteId : (Views.notes?.currentId || currentNoteId || null);
    if (opts.sessionId && Store.find(COLL, opts.sessionId)) {
      activeId = opts.sessionId;
    } else if (opts.newSession || !active() || (active().noteId || null) !== (currentNoteId || null)) {
      const reuse = opts.newSession ? null : latestForNote(currentNoteId);
      activeId = (reuse || createSession({ noteId: currentNoteId, selection: opts.selection, anchor: opts.anchor })).id;
    }
    const s = active();
    if (s && (opts.selection || opts.anchor)) {
      s.context = {
        ...(s.context || {}),
        ...(opts.selection ? { selection: String(opts.selection).slice(0, 1200) } : {}),
        ...(opts.anchor ? { anchor: opts.anchor } : {}),
      };
      Store.update(COLL, s.id, { context: s.context });
    }
    if (opts.draft !== undefined) els.input.value = opts.draft || '';
    if (opts.question) els.input.value = opts.question;
    drawer.classList.add('open');
    document.body.classList.add('chat-open');
    renderAll();
    if (opts.question && opts.autoSend !== false) send();
    else setTimeout(() => els.input.focus(), 60);
  }

  function close() {
    if (!drawer) return;
    closeAt();
    drawer.classList.remove('open', 'show-history');
    document.body.classList.remove('chat-open');
  }

  function toggle() { isOpen() ? close() : open(); }

  function onNoteChange(id) {
    if (pending || compacting) return;
    currentNoteId = id || null;
    if (!isOpen()) return;
    const s = active();
    if (!s || (s.noteId || null) !== currentNoteId) {
      activeId = latestForNote(currentNoteId)?.id || null;
    }
    renderAll();
  }

  const getAnchor = () => {
    const s = active();
    if (!s?.context?.anchor) return null;
    // 同时返回会话记录的选中文本，供 replace_selection 校验 anchor 是否漂移
    return { anchor: s.context.anchor, selection: s.context.selection || '' };
  };

  return { open, close, toggle, newSession, compactNow, onNoteChange, getAnchor, get isOpen() { return isOpen(); } };
})();
