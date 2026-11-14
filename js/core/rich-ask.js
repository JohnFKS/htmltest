// 右键 AI 提问：在富文本区域（笔记/题目/批改报告/三本条目）选中文本后右键，
// 即可向 AI 提问或让 AI 解释，回答可一键追加到笔记。
// 无选中时保留浏览器原生菜单；菜单为自绘（避免依赖页面自身的 contextmenu 实现）。
window.RichAsk = (() => {
  // 接管右键的范围：一切富文本内容区
  const SCOPE = '.rich, .q-stem, .q-options, .ai-report, .entry-stem, .diff-box';
  let menu = null;

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const node = sel.anchorNode;
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (!el || !el.closest(SCOPE)) return null;
    return { text: text.slice(0, 1200) };
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
      <button data-act="ask">🤖 就选中内容提问…</button>
      <button data-act="explain">✨ 让 AI 解释这段</button>`;
    menu.style.left = Math.min(e.clientX, innerWidth - 240) + 'px';
    menu.style.top = Math.min(e.clientY, innerHeight - 96) + 'px';
    document.body.appendChild(menu);
    menu.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      const preset = btn.dataset.act === 'explain' ? '请解释这段内容：它说了什么？为什么重要？' : '';
      hide();
      openAsk(sel, preset);
    });
  });

  function openAsk(sel, preset) {
    let m;
    m = UI.modal({
      title: 'AI 提问 · 选中文本',
      width: 640, raw: true,
      body: `<blockquote class="ctx-quote">${U.esc(sel.text.slice(0, 300))}${sel.text.length > 300 ? '…' : ''}</blockquote>
             <textarea class="textarea" id="ctx-q" rows="2" placeholder="想问什么？（留空则默认解释这段内容）">${U.esc(preset)}</textarea>`,
      actions: [
        { label: '取消' },
        { label: '🤖 提问', primary: true, onClick: close => {
          const q = m.el.querySelector('#ctx-q').value.trim() || '请解释这段内容';
          close();
          runAsk(sel, q);
        } },
      ],
    });
    m.el.querySelector('#ctx-q').focus();
  }

  async function runAsk(sel, q) {
    UI.spinner(true, 'AI 思考中…');
    let result;
    try { result = await AI.ctxAsk({ selection: sel.text, question: q }); }
    catch (e) { UI.spinner(false); return UI.toast(e.message, 'error'); }
    UI.spinner(false);
    const m = UI.modal({
      title: 'AI 回答', width: 700, raw: true,
      body: `<blockquote class="ctx-quote"><b>选中文本：</b>${U.esc(sel.text.slice(0, 200))}${sel.text.length > 200 ? '…' : ''}</blockquote>
             <blockquote class="ctx-quote"><b>我的问题：</b>${U.esc(q)}</blockquote>
             <div class="ai-report" id="ctx-answer" style="margin-top:10px">${result.html}</div>`,
      actions: [
        { label: '关闭' },
        { label: '📋 复制回答', onClick: () => { U.copyText(U.stripHtml(result.html)); UI.toast('已复制'); } },
        { label: '➕ 追加到笔记', primary: true, onClick: () => { appendToNote(q, sel.text, result.html); m.close(); } },
      ],
    });
    Ktx.renderMath(m.bodyEl);
  }

  /** 把问答块追加到当前笔记（无当前笔记则新建一篇） */
  function appendToNote(question, selText, answerHtml) {
    const noteId = Views.notes?.currentId;
    let note = noteId ? Store.find('notes', noteId) : null;
    const block = `<details open class="ctx-qa"><summary>🤖 AI 问答：${U.esc((question || '').slice(0, 40))}</summary>
      ${selText ? `<blockquote>${U.esc(selText.slice(0, 200))}</blockquote>` : ''}
      ${answerHtml}
      <p class="muted" style="font-size:12px">— AI 生成于 ${U.fmt(U.now())}，关键结论请自行校验</p></details><p></p>`;
    if (!note) {
      note = Store.insert('notes', {
        id: U.uid('note'), title: (question || 'AI 问答').slice(0, 20),
        content: Sanitize.html(block), createdAt: U.now(), updatedAt: U.now(),
      });
      if (Views.notes) Views.notes.currentId = note.id;
      UI.toast(`已创建笔记「${note.title}」并写入问答`);
      return;
    }
    Store.update('notes', note.id, { content: (note.content || '') + Sanitize.html(block) });
    UI.toast(`已追加到笔记「${note.title}」`);
    // 若正停留在笔记视图，同步插入编辑器并渲染
    if (App.currentView === 'notes') {
      const ed = document.getElementById('editor-area');
      if (ed) { ed.insertAdjacentHTML('beforeend', Sanitize.html(block)); Ktx.renderMath(ed); }
    }
  }

  return { openAsk, appendToNote };
})();
