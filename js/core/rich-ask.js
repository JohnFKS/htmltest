// 右键 AI 提问：在富文本区域（笔记/题目/批改报告/三本条目）选中文本后右键，
// 即可向 AI 提问或让 AI 解释，回答可一键追加到笔记。
// 无选中时保留浏览器原生菜单；菜单为自绘（避免依赖页面自身的 contextmenu 实现）。
window.RichAsk = (() => {
  // 接管右键的范围：一切富文本内容区
  const SCOPE = '.rich, .q-stem, .q-options, .ai-report, .entry-stem, .diff-box';
  let menu = null;

  function scopeEl(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return el && el.closest(SCOPE) ? el : null;
  }

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const el = scopeEl(sel.anchorNode) || scopeEl(sel.focusNode);
    if (!el) return null;
    return {
      text: text.slice(0, 1200),
      // 仅在笔记编辑器内选中时才绑定当前笔记；题目/报告等场景走「通用问答」
      noteId: el.closest('.notes-editor, #editor-area') ? (Views.notes?.currentId || null) : null,
    };
  }

  function hide() { menu?.remove(); menu = null; }
  document.addEventListener('click', e => { if (menu && !menu.contains(e.target)) hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });

  document.addEventListener('contextmenu', e => {
    if (!e.target.closest?.(SCOPE)) { hide(); return; }
    const sel = selectionInfo();
    if (!sel) { hide(); return; } // 无选中 → 原生右键菜单
    e.preventDefault();
    hide();
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = `
      <button data-act="ask">🤖 在右侧对话栏提问…</button>
      <button data-act="explain">✨ 让 AI 解释这段（右侧）</button>`;
    menu.style.left = U.clamp(e.clientX, 8, Math.max(8, innerWidth - 240)) + 'px';
    menu.style.top = U.clamp(e.clientY, 8, Math.max(8, innerHeight - 96)) + 'px';
    document.body.appendChild(menu);
    menu.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      const preset = btn.dataset.act === 'explain' ? '请解释这段内容：它说了什么？为什么重要？' : '';
      hide();
      openAsk(sel, preset);
    });
  });

  // 选中文本后打开右侧对话栏：解释类预设直接发送，自由提问则聚焦输入框
  function openAsk(sel, preset = '') {
    if (!window.NoteChat) return UI.toast('对话栏尚未就绪，请刷新页面', 'error');
    NoteChat.open({
      noteId: sel.noteId,
      selection: sel.text,
      newSession: true,
      ...(preset ? { question: preset, autoSend: true } : { draft: '' }),
    });
  }

  /** 把问答块追加到指定笔记（不传则当前笔记；无目标则新建一篇） */
  function appendToNote(question, selText, answerHtml, targetNoteId) {
    const noteId = targetNoteId !== undefined ? targetNoteId : (Views.notes?.currentId || null);
    let note = noteId ? Store.find('notes', noteId) : null;
    const q = U.asText(question || '');
    const quote = U.asText(selText || '');
    const safeAnswer = Sanitize.html(U.asText(answerHtml || ''));
    const block = `<details open class="ctx-qa"><summary>🤖 AI 问答：${U.esc(q.slice(0, 40))}</summary>
      ${quote ? `<blockquote>${U.esc(quote.slice(0, 200))}</blockquote>` : ''}
      ${safeAnswer}
      <p class="muted" style="font-size:12px">— AI 生成于 ${U.fmt(U.now())}，关键结论请自行校验</p></details><p></p>`;
    if (!note) {
      note = Store.insert('notes', {
        id: U.uid('note'), title: (q || 'AI 问答').slice(0, 20),
        content: Sanitize.html(block), createdAt: U.now(), updatedAt: U.now(),
      });
      if (Views.notes) Views.notes.currentId = note.id;
      UI.toast(`已创建笔记「${note.title}」并写入问答`);
      return;
    }
    Store.update('notes', note.id, { content: (note.content || '') + Sanitize.html(block) });
    UI.toast(`已追加到笔记「${note.title}」`);
    // 仅当编辑器正打开同一篇笔记时同步插入，避免写错笔记
    if (App.currentView === 'notes' && Views.notes?.currentId === note.id) {
      const ed = document.getElementById('editor-area');
      if (ed) { ed.insertAdjacentHTML('beforeend', Sanitize.html(block)); Ktx.renderMath(ed); }
    }
  }

  return { openAsk, appendToNote };
})();
