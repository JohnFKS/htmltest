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

  function pathOf(node, root) {
    if (!node || !root) return null;
    const path = [];
    let cur = node;
    while (cur && cur !== root) {
      const parent = cur.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, cur));
      cur = parent;
    }
    return cur === root ? path : null;
  }

  function nodeAtPath(root, path) {
    let node = root;
    for (const i of path || []) {
      if (!node?.childNodes?.[i]) return null;
      node = node.childNodes[i];
    }
    return node;
  }

  function blockOf(node, root) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && el !== root && !/^(P|LI|BLOCKQUOTE|H1|H2|H3|H4|H5|H6|PRE|DIV|TD|FIGCAPTURE)$/.test(el.tagName)) {
      el = el.parentElement;
    }
    return el && el !== root ? el : null;
  }

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return null;
    const el = scopeEl(sel.anchorNode) || scopeEl(sel.focusNode);
    if (!el) return null;
    const editor = el.closest('#editor-area');
    let anchor = null;
    if (editor) {
      const range = sel.getRangeAt(0);
      const startPath = pathOf(range.startContainer, editor);
      const endPath = pathOf(range.endContainer, editor);
      const block = blockOf(range.startContainer, editor) || blockOf(range.endContainer, editor);
      if (startPath && endPath) {
        anchor = { startPath, startOffset: range.startOffset, endPath, endOffset: range.endOffset, blockPath: pathOf(block, editor) };
      }
    }
    return {
      text: text.slice(0, 1200),
      // 仅在笔记编辑器内选中时才绑定当前笔记；题目/报告等场景走「通用问答」
      noteId: editor ? (Views.notes?.currentId || null) : null,
      anchor,
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
    // 弹窗层级(200)高于对话栏(120)：若从弹窗内提问，先关闭弹窗，否则对话栏被遮罩挡住无法操作
    document.querySelectorAll('.modal-mask .modal-x').forEach(x => x.click());
    NoteChat.open({
      noteId: sel.noteId,
      selection: sel.text,
      anchor: sel.anchor,
      newSession: true,
      ...(preset ? { question: preset, autoSend: true } : { draft: '' }),
    });
  }

  // 用 CSS Highlight API 高亮原选区：不修改原文 DOM，刷新后可退化为引用块高亮
  function highlightSelection(editor, anchor) {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined' || !anchor) return;
    try {
      const s = nodeAtPath(editor, anchor.startPath);
      const e = nodeAtPath(editor, anchor.endPath);
      if (!s || !e) return;
      const range = document.createRange();
      range.setStart(s, Math.min(anchor.startOffset || 0, s.textContent.length));
      range.setEnd(e, Math.min(anchor.endOffset || 0, e.textContent.length));
      if (!range.collapsed) CSS.highlights.set('ai-note-annotation', new Highlight(range));
    } catch (e) { /* 不支持时仅保留块级高亮 */ }
  }

  // 把批注块插到原选中文本所在块之后；不包裹或改写任何原始文本节点
  function insertAtAnchor(editor, html, anchor) {
    if (!editor || !anchor) return false;
    let target = anchor.blockPath ? nodeAtPath(editor, anchor.blockPath) : null;
    if (!target || !editor.contains(target)) {
      const start = nodeAtPath(editor, anchor.startPath);
      target = start?.nodeType === Node.ELEMENT_NODE ? start : start?.parentElement;
    }
    while (target && target !== editor && !/^(P|LI|BLOCKQUOTE|H1|H2|H3|H4|H5|H6|PRE|DIV|TD|FIGCAPTURE)$/.test(target.tagName || '')) {
      target = target.parentElement;
    }
    if (!target || target === editor || !editor.contains(target)) return false;
    const after = target.tagName === 'LI' && target.parentElement ? target.parentElement : target;
    after.insertAdjacentHTML('afterend', html);
    target.classList?.add('ai-annotated-block');
    highlightSelection(editor, anchor);
    return true;
  }

  /** 把问答块追加到指定笔记（不传则当前笔记；无目标则新建一篇） */
  function appendToNote(question, selText, answerHtml, targetNoteId, anchor) {
    const noteId = targetNoteId !== undefined ? targetNoteId : (Views.notes?.currentId || null);
    let note = noteId ? Store.find('notes', noteId) : null;
    const q = U.asText(question || '');
    const quote = U.asText(selText || '');
    const safeAnswer = Sanitize.html(U.asText(answerHtml || ''));
    const block = `<div class="ai-annotation" tabindex="0">
      <div class="ai-annotation-trigger"><span class="ai-annotation-chip">🤖 AI 批注</span><span class="ai-annotation-topic">${U.esc(q.slice(0, 36))}</span><span class="ai-annotation-caret">▾</span></div>
      <div class="ai-annotation-card" contenteditable="true">
        <div class="ai-annotation-quote">引用：${U.esc(quote.slice(0, 200))}</div>
        <div class="ai-annotation-answer ai-report">${safeAnswer}</div>
        <div class="ai-annotation-foot">AI 生成于 ${U.fmt(U.now())} · 悬浮显示 · 可直接修改，移开后自动暂存</div>
      </div>
    </div><p></p>`;
    if (!note) {
      note = Store.insert('notes', {
        id: U.uid('note'), title: (q || 'AI 问答').slice(0, 20),
        content: Sanitize.html(block), createdAt: U.now(), updatedAt: U.now(),
      });
      if (Views.notes) Views.notes.currentId = note.id;
      UI.toast(`已创建笔记「${note.title}」并写入问答`);
      return;
    }
    const safeBlock = Sanitize.html(block);
    if (App.currentView === 'notes' && Views.notes?.currentId === note.id) {
      const ed = document.getElementById('editor-area');
      if (ed) {
        const atAnchor = insertAtAnchor(ed, safeBlock, anchor);
        if (!atAnchor) ed.insertAdjacentHTML('beforeend', safeBlock);
        Ktx.renderMath(ed);
        Views.notes._undo?.sync();
        Views.notes._markDirty?.();
        Store.update('notes', note.id, { content: ed.innerHTML });
        UI.toast(atAnchor ? `已追加到选中文本下方 · ${note.title}` : `已追加到笔记末尾 · ${note.title}`, 'success');
        return;
      }
    }
    Store.update('notes', note.id, { content: (note.content || '') + safeBlock });
    UI.toast(`已追加到笔记「${note.title}」`);
  }

  // ---------- Function calling 工具执行器：AI 直接编辑笔记（受控块操作） ----------
  const BLOCK_RE = /^(P|LI|BLOCKQUOTE|H1|H2|H3|H4|H5|H6|PRE|DIV|HR|TABLE|FIGURE|UL|OL|TR|FIGCAPTURE)$/;
  const OUTLINE_BUDGET = 10500;   // 块列表预算：超过则降级为标题结构目录（长笔记两步定位法第一步）
  const blocksOf = note => {
    const holder = document.createElement('div');
    holder.innerHTML = Sanitize.html(note?.content || '');
    return [...holder.children].filter(el => BLOCK_RE.test(el.tagName));
  };
  const blockText = el => U.stripHtml(el.outerHTML).replace(/\s+/g, ' ').trim();

  const noteBlocks = (noteId) => {
    const note = Store.find('notes', noteId || Views.notes?.currentId || '');
    const blocks = blocksOf(note);
    const full = blocks.map((el, i) => `${i}. <${el.tagName.toLowerCase()}> ${blockText(el).slice(0, 140) || '（空块）'}`).join('\n');
    if (full.length <= OUTLINE_BUDGET) return `共 ${blocks.length} 块。\n${full}`;
    // 长笔记两步定位法第一步：只列标题级结构目录，章节全文用 read_content 的 blockFrom/blockTo 读取
    const pick = level => blocks
      .map((el, i) => ({ i, tag: el.tagName.toLowerCase(), text: blockText(el) }))
      .filter(x => new RegExp(`^h[1-${level}]$`).test(x.tag) && x.text);
    let heads = pick(3);
    if (!heads.length) heads = pick(6);
    if (heads.length) {
      return `共 ${blocks.length} 块（长笔记，以下仅列标题结构目录）。编辑前先用 read_content 的 blockFrom/blockTo 读取目标章节所在区间的块全文，再按块编号修改。\n`
        + heads.slice(0, 200).map(h => `块 ${h.i} · <${h.tag}> ${h.text.slice(0, 80)}`).join('\n');
    }
    // 无标题长笔记：紧凑预览每块开头
    const compact = blocks.map((el, i) => `${i}. ${blockText(el).slice(0, 40) || '（空块）'}`).join('\n');
    return `共 ${blocks.length} 块（长笔记且无标题结构，仅列每块开头预览）。用 read_content 的 blockFrom/blockTo 分段读取块全文。\n${compact.slice(0, OUTLINE_BUDGET)}`;
  };

  // 两步定位法第二步：读取指定区间的块全文（供长笔记定位章节后精确编辑）
  function readBlockRange(noteId, from, to) {
    const note = Store.find('notes', noteId || Views.notes?.currentId || '');
    if (!note) return { ok: false, error: '目标笔记不存在' };
    const blocks = blocksOf(note);
    if (!blocks.length) return { ok: true, text: `《${note.title}》共 0 块（空笔记）` };
    const f = Math.min(Math.max(Math.floor(Number(from)) || 0, 0), blocks.length - 1);
    const tRaw = (to === undefined || to === null || Number.isNaN(Number(to))) ? blocks.length - 1 : Math.floor(Number(to));
    const t = Math.min(Math.max(tRaw, f), blocks.length - 1);
    const lines = [];
    let used = 0, truncated = false;
    for (let i = f; i <= t; i++) {
      const line = `${i}. <${blocks[i].tagName.toLowerCase()}> ${blockText(blocks[i]).slice(0, 1500) || '（空块）'}`;
      if (used + line.length > 12000) { truncated = true; break; }
      lines.push(line); used += line.length;
    }
    const tail = truncated
      ? `\n…（已达单次读取上限，请缩小 blockFrom/blockTo 范围继续读取）`
      : (t < blocks.length - 1 ? `\n（以上为块 ${f}~${t}；该笔记共 ${blocks.length} 块）` : '');
    return { ok: true, text: `《${note.title}》共 ${blocks.length} 块，以下是块 ${f}~${t} 的全文：\n${lines.join('\n')}${tail}` };
  }

  // 未打开笔记的版本快照：schema 与 notes.js createVersion 一致，并按 maxVersions 裁剪
  function snapshotVersion(note) {
    const max = U.clamp(Number(Store.config?.notes?.maxVersions) || 20, 1, 200);
    Store.insert('noteVersions', {
      id: U.uid('ver'), noteId: note.id, title: note.title || '未命名笔记',
      content: note.content || '', source: 'ai-agent', pinned: false, createdAt: U.now(),
    });
    (Store.coll('noteVersions') || [])
      .filter(v => v.noteId === note.id && !v.pinned)
      .slice(max)
      .forEach(v => Store.remove('noteVersions', v.id));
  }

  async function executeNoteEdit({ action, html, title, blockIndex, reason, noteId }) {
    if (!Store.aiLive()) return { ok: false, error: '演示模式不支持编辑笔记，请先在设置里配置真实 AI' };
    // 目标笔记：不传 noteId 时编辑当前打开的笔记；传入 noteId 可编辑任意笔记（跨笔记编辑）
    const targetId = String(noteId || '').trim() || Views.notes?.currentId || '';
    const note = Store.find('notes', targetId);
    if (!note) return { ok: false, error: noteId ? `目标笔记不存在（${noteId}），可从【全局内容摘要】或 read_content 获取正确 ID` : '当前没有打开的笔记' };
    const editor = document.getElementById('editor-area');
    const titleInput = document.getElementById('note-title');
    // 只要编辑器当前加载的就是目标笔记就走实时路径（撤销栈可用）；编辑器不存在/断开连接时走离线路径
    const canLive = !!editor && editor.isConnected && !!titleInput && Views.notes?.currentId === targetId;
    if (action === 'rename_title' && !String(title || '').trim()) return { ok: false, error: '新标题为空' };

    // replace_selection 依赖当前编辑器的选区/anchor，仅对打开的笔记有意义
    if (action === 'replace_selection' && !canLive) {
      return { ok: false, error: `《${note.title}》未在编辑器中打开，无法改写"选中文本"（该操作需要选区）。请改用 replace_block / insert_after_block / append，块编号先用 read_content 获取该笔记的块列表` };
    }

    const label = { replace_selection: '改写选中文本', replace_block: '改写指定块', insert_after_block: '在指定块后插入', append: '追加到末尾', replace_all: '重写整篇', rename_title: '修改标题' }[action] || action;
    const hint = title ? `新标题「${title}」` : (html ? `内容：${U.stripHtml(html).replace(/\s+/g, ' ').slice(0, 90)}…` : '');
    if (!await UI.confirm(`AI 请求：${label}。\n理由：${reason}\n${hint}\n目标笔记：《${note.title}》${canLive ? '' : '（未在编辑器打开，将直接写入保存）'}\n\n执行前会自动保存一个版本快照，确定允许？`, { danger: action === 'replace_all' || !canLive, confirmLabel: '允许编辑' })) {
      return { ok: false, error: '用户取消了这次编辑' };
    }

    const safe = Sanitize.html(html || '');
    if (canLive) {
      Views.notes._createVersion?.('ai-agent');
      let changed = true;
      if (action === 'rename_title') {
        titleInput.value = title;
      } else if (action === 'append') {
        editor.insertAdjacentHTML('beforeend', safe || '<p></p>');
      } else if (action === 'replace_all') {
        editor.innerHTML = safe || '<p></p>';
      } else if (action === 'replace_block' || action === 'insert_after_block') {
        const blocks = [...editor.children].filter(el => BLOCK_RE.test(el.tagName));
        const target = blocks[blockIndex ?? -1];
        if (!target) return { ok: false, error: `块编号 ${blockIndex} 不存在（共 ${blocks.length} 块）` };
        if (action === 'insert_after_block') target.insertAdjacentHTML('afterend', safe || '<p></p>');
        else target.outerHTML = safe || '<p></p>';
      } else if (action === 'replace_selection') {
        const ctx = NoteChat?.getAnchor?.() || null;
        const anchor = ctx?.anchor || null;
        let range = null;
        if (anchor) {
          const s = nodeAtPath(editor, anchor.startPath), e = nodeAtPath(editor, anchor.endPath);
          if (s && e && editor.contains(s) && editor.contains(e)) {
            try { range = document.createRange(); range.setStart(s, anchor.startOffset || 0); range.setEnd(e, anchor.endOffset || 0); } catch (err) { range = null; }
          }
          // 陈旧 anchor 校验：先前编辑会让路径漂移，命中文本与会话记录的选中文本不符时弃用，
          // 避免"成功"替换到错误位置（学生看到的却是目标位置毫无变化）
          if (range && !range.collapsed && String(ctx.selection || '').trim()) {
            const hit = (range.toString() || '').replace(/\s+/g, ' ').trim();
            const want = String(ctx.selection).replace(/\s+/g, ' ').trim();
            if (!hit || (hit !== want && !want.includes(hit) && !hit.includes(want))) range = null;
          } else if (range?.collapsed) range = null;
        }
        if (!range) {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && sel.rangeCount && editor.contains(sel.anchorNode)) range = sel.getRangeAt(0);
        }
        if (!range) return { ok: false, error: '找不到要改写的选中文本（原选中位置可能已失效），请在笔记中重新选中后再试；或改用 replace_block 按块编号修改' };
        range.deleteContents();
        const frag = range.createContextualFragment(safe || '<span></span>');
        range.insertNode(frag);
      } else {
        changed = false;
      }
      if (!changed) return { ok: false, error: '未知操作' };

      Ktx.renderMath(editor);
      Views.notes._undo?.sync();
      Views.notes._markDirty?.();
      Store.update('notes', note.id, { title: titleInput.value.trim() || '未命名笔记', content: editor.innerHTML });
      return { ok: true, message: `《${note.title}》${label}完成，已存版本快照` };
    }

    // 离线路径：目标笔记未打开，在脱敏副本上执行同样的块操作后直接保存
    const holder = document.createElement('div');
    holder.innerHTML = note.content || '<p></p>';
    let changed = true;
    if (action === 'rename_title') {
      // 仅改标题，内容保持不变
    } else if (action === 'append') {
      holder.insertAdjacentHTML('beforeend', safe || '<p></p>');
    } else if (action === 'replace_all') {
      holder.innerHTML = safe || '<p></p>';
    } else if (action === 'replace_block' || action === 'insert_after_block') {
      const blocks = [...holder.children].filter(el => BLOCK_RE.test(el.tagName));
      const target = blocks[blockIndex ?? -1];
      if (!target) return { ok: false, error: `块编号 ${blockIndex} 不存在（《${note.title}》共 ${blocks.length} 块，可用 read_content 获取该笔记的块列表）` };
      if (action === 'insert_after_block') target.insertAdjacentHTML('afterend', safe || '<p></p>');
      else target.outerHTML = safe || '<p></p>';
    } else {
      changed = false;
    }
    if (!changed) return { ok: false, error: '未知操作' };

    snapshotVersion(note);
    Ktx.renderMath(holder);
    const patch = { content: holder.innerHTML };
    if (action === 'rename_title') patch.title = String(title).trim() || note.title;
    Store.update('notes', targetId, patch);
    return { ok: true, message: `《${note.title}》${label}完成（该笔记未在编辑器打开，已直接保存），已存版本快照` };
  }

  return { openAsk, appendToNote, noteBlocks, readBlockRange, executeNoteEdit };
})();
