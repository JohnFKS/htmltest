// 笔记助教右侧对话栏：选中文本提问 → 多轮追问 → 多会话 / 历史会话管理
// 会话落盘于 db.chatSessions；每条会话绑定一篇笔记（或通用问答），保留选中文本引用与完整消息。
window.NoteChat = (() => {
  const COLL = 'chatSessions';
  const QUICK = ['总结一下这段笔记', '列出核心考点', '举个例子说明', '我还容易混淆什么？'];

  let drawer = null;
  let els = {};
  let activeId = null;
  let currentNoteId = null;
  let pending = false;

  const isOpen = () => !!drawer?.classList.contains('open');
  const all = () => Store.coll(COLL);
  const active = () => all().find(s => s.id === activeId) || null;
  const noteOf = s => Store.find('notes', s?.noteId) || null;
  const noteById = id => Store.find('notes', id) || null;

  function noteText(note) {
    if (!note) return '';
    const d = document.createElement('div');
    d.innerHTML = note.content || '';
    d.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,figcaption').forEach(el => {
      el.insertAdjacentText('afterend', '\n');
    });
    return (d.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
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

  function createSession({ noteId = null, selection = '', title = '' } = {}) {
    const note = noteById(noteId);
    const s = {
      id: U.uid('chat'), noteId: noteId || null, noteTitle: note?.title || '通用问答',
      title: title || '新对话', context: { selection: String(selection || '').slice(0, 1200) },
      messages: [], createdAt: U.now(), updatedAt: U.now(),
    };
    Store.insert(COLL, s);
    return s;
  }

  function ensure() {
    if (drawer) return;
    drawer = document.createElement('aside');
    drawer.className = 'chat-drawer';
    drawer.id = 'note-chat-drawer';
    drawer.innerHTML = `
      <div class="chat-head">
        <div class="chat-head-main">
          <div class="chat-head-icon">✒</div>
          <div class="chat-head-text">
            <div class="chat-head-title" id="chat-title">笔记助教</div>
            <div class="chat-head-sub" id="chat-sub">针对当前笔记连续提问</div>
          </div>
        </div>
        <div class="chat-head-ops">
          <button class="chat-icon-btn" data-act="history" title="历史对话">🕘</button>
          <button class="chat-icon-btn" data-act="new" title="新建对话">＋</button>
          <button class="chat-icon-btn" data-act="close" title="收起对话栏">×</button>
        </div>
      </div>
      <div class="chat-body">
        <div class="chat-rail" id="chat-rail"></div>
        <div class="chat-main">
          <div class="chat-context" id="chat-context"></div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-composer-wrap">
            <div class="chat-quick" id="chat-quick">${QUICK.map(q => `<button class="chat-quick-btn" data-q="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>
            <div class="chat-composer">
              <textarea class="chat-input" id="chat-input" rows="2" placeholder="继续针对这篇笔记提问…（Enter 发送，Shift+Enter 换行）"></textarea>
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
      rail: drawer.querySelector('#chat-rail'),
      context: drawer.querySelector('#chat-context'),
      messages: drawer.querySelector('#chat-messages'),
      quick: drawer.querySelector('#chat-quick'),
      input: drawer.querySelector('#chat-input'),
      status: drawer.querySelector('#chat-status'),
      send: drawer.querySelector('#chat-send'),
    };

    drawer.querySelector('.chat-head').addEventListener('click', e => {
      const op = e.target.closest('[data-act]');
      if (!op) return;
      if (op.dataset.act === 'close') close();
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

    els.messages.addEventListener('click', e => {
      const op = e.target.closest('[data-act]');
      if (!op) return;
      const s = active();
      const msg = s?.messages.find(m => m.id === op.dataset.id);
      if (!msg) return;
      if (op.dataset.act === 'copy') {
        U.copyText(U.stripHtml(msg.html || msg.text || ''));
        UI.toast('已复制回答');
      } else if (op.dataset.act === 'append') {
        const i = s.messages.indexOf(msg);
        const user = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
        RichAsk.appendToNote(user?.text || 'AI 回答', user?.selection || s.context?.selection || '', msg.html || msg.text || '');
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
    els.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen() && !document.getElementById('modal-root').children.length) close();
    });
  }

  function renderHeader() {
    const s = active();
    const note = noteOf(s) || noteById(currentNoteId);
    els.title.textContent = s?.title || '新对话';
    els.sub.textContent = `${note?.title || '通用问答'} · ${s?.messages?.length || 0} 条消息 · ${Store.aiLive() ? 'AI 已连接' : '演示模式'}`;
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
    els.messages.innerHTML = s.messages.map(m => {
      if (m.role === 'user') {
        return `<div class="chat-msg chat-msg-user">
          <div class="chat-bubble">
            ${m.selection ? `<div class="chat-user-quote">引用：${U.esc(String(m.selection).slice(0, 120))}${String(m.selection).length > 120 ? '…' : ''}</div>` : ''}
            <div class="chat-user-text">${U.esc(m.text || '').replace(/\n/g, '<br>')}</div>
          </div>
          <div class="chat-avatar">我</div>
        </div>`;
      }
      return `<div class="chat-msg chat-msg-ai">
        <div class="chat-avatar ai">✒</div>
        <div class="chat-msg-col">
          <div class="chat-bubble ai-report">${Sanitize.html(m.html || U.esc(m.text || ''))}</div>
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
    renderContext();
    renderMessages();
    setBusy(pending);
  }

  function setBusy(busy) {
    els.input.disabled = busy;
    els.send.disabled = busy;
    els.status.textContent = busy ? 'AI 思考中…' : (Store.aiLive() ? '' : '演示模式：回答为本地模拟');
  }

  async function generate(s, question, selection) {
    pending = true;
    renderAll();
    try {
      const note = noteOf(s);
      const res = await AI.ctxChat({
        noteTitle: s.noteTitle || note?.title || '当前笔记',
        noteText: noteText(note),
        selection,
        question,
        history: s.messages.slice(0, -1),
      });
      s.messages.push({
        id: U.uid('msg'), role: 'assistant', html: res.html, text: U.stripHtml(res.html),
        demo: !!res.demo, createdAt: U.now(),
      });
      Store.update(COLL, s.id, { messages: s.messages });
    } catch (e) {
      s.messages.push({
        id: U.uid('msg'), role: 'assistant', text: e.message || 'AI 调用失败',
        html: `<p class="chat-error">AI 调用失败：${U.esc(e.message || '未知错误')}</p>`,
        error: true, createdAt: U.now(),
      });
      Store.update(COLL, s.id, { messages: s.messages });
      UI.toast(e.message || 'AI 调用失败', 'error');
    } finally {
      pending = false;
      renderAll();
      els.input.focus();
    }
  }

  async function send() {
    if (pending) return;
    const q = els.input.value.trim();
    if (!q) return UI.toast('请输入问题', 'warn');
    let s = active();
    if (!s) {
      s = createSession({ noteId: currentNoteId });
      activeId = s.id;
    }
    const selection = s.context?.selection || '';
    s.messages.push({ id: U.uid('msg'), role: 'user', text: q, selection, createdAt: U.now() });
    if (s.messages.filter(m => m.role === 'user').length === 1 && (!s.title || s.title === '新对话')) {
      s.title = makeTitle(q);
    }
    Store.update(COLL, s.id, { messages: s.messages, title: s.title, context: s.context });
    els.input.value = '';
    await generate(s, q, selection);
  }

  async function retry(msgId) {
    if (pending) return;
    const s = active();
    if (!s) return;
    const i = s.messages.findIndex(m => m.id === msgId);
    if (i < 0 || s.messages[i].role !== 'assistant') return;
    const user = [...s.messages.slice(0, i)].reverse().find(m => m.role === 'user');
    if (!user) return;
    s.messages.splice(i, 1);
    Store.update(COLL, s.id, { messages: s.messages });
    await generate(s, user.text, user.selection || s.context?.selection || '');
  }

  function newSession() {
    const s = createSession({ noteId: currentNoteId });
    activeId = s.id;
    renderAll();
    els.input.focus();
    UI.toast('已新建对话');
  }

  function selectSession(id) {
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
    const hasNoteId = Object.prototype.hasOwnProperty.call(opts, 'noteId');
    currentNoteId = hasNoteId ? opts.noteId : (Views.notes?.currentId || currentNoteId || null);
    if (opts.sessionId && Store.find(COLL, opts.sessionId)) {
      activeId = opts.sessionId;
    } else if (opts.newSession || !active() || (active().noteId || null) !== (currentNoteId || null)) {
      const reuse = opts.newSession ? null : latestForNote(currentNoteId);
      activeId = (reuse || createSession({ noteId: currentNoteId })).id;
    }
    const s = active();
    if (s && opts.selection) {
      s.context = { ...(s.context || {}), selection: String(opts.selection).slice(0, 1200) };
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
    drawer.classList.remove('open', 'show-history');
    document.body.classList.remove('chat-open');
  }

  function toggle() { isOpen() ? close() : open(); }

  function onNoteChange(id) {
    currentNoteId = id || null;
    if (!isOpen()) return;
    const s = active();
    if (!s || (s.noteId || null) !== currentNoteId) {
      activeId = latestForNote(currentNoteId)?.id || null;
    }
    renderAll();
  }

  return { open, close, toggle, newSession, onNoteChange, get isOpen() { return isOpen(); } };
})();
