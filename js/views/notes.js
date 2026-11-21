// 笔记工作台：HTML 原生富文档编辑器
window.Views = window.Views || {};
Views.notes = {
  currentId: null,

  render(container) {
    const notes = Store.coll('notes');
    container.innerHTML = `
      <div class="notes-layout">
        <div class="notes-list" data-pane="side">
          <button class="btn btn-primary" id="note-new" style="width:100%;margin-bottom:12px">${Icon.svg('plus', 15)} 新建笔记</button>
          <input class="input" id="note-search" placeholder="搜索标题 / 正文…" style="width:100%;margin-bottom:10px">
          <div id="note-list"></div>
        </div>
        <div class="notes-editor" data-pane="main">
          <div class="note-editor-top">
            <div class="note-editor-head">
              <input class="note-title-input" id="note-title" placeholder="笔记标题…">
              <div class="note-head-actions">
                <button class="btn btn-primary btn-sm" id="note-save" title="保存为一个版本（Ctrl+S）">${Icon.svg('save', 14)} 保存</button>
                <button class="btn btn-ghost btn-sm" id="note-history" title="查看/恢复历史版本，永久保存或删除">${Icon.svg('history', 14)} 历史</button>
                <button class="btn btn-ghost btn-sm" id="note-autosave" title="设置自动保存间隔与版本保留数量">${Icon.svg('settings', 14)} 保存设置</button>
                <span class="note-head-sep"></span>
                <button class="btn btn-ghost btn-sm" id="note-md-import" title="把 Markdown 文本转换为富文本块追加到笔记">MD 粘贴转换</button>
                <button class="btn btn-ghost btn-sm" id="note-import-md" title="导入 .md / .markdown / .txt 文件，自动生成一篇新笔记">${Icon.svg('file', 14)} 导入文件</button>
                <button class="btn btn-ghost btn-sm" id="note-import-pdf" title="导入 PDF 教材：AI 按页整理成结构化学习笔记，可同时生成题库">${Icon.svg('book', 14)} 导入 PDF</button>
                <button class="btn btn-ghost btn-sm" id="note-insert-annot" title="插入截图批注产物">插入批注图</button>
                <button class="btn btn-ghost btn-sm" id="note-chat-open" title="打开右侧笔记助教：多轮提问与历史对话">${Icon.svg('message', 14)} 笔记助教</button>
                <button class="btn btn-ghost btn-sm" id="note-export" title="导出为独立 HTML 文件">${Icon.svg('download', 14)} 导出 HTML</button>
              </div>
            </div>
            <div class="editor-toolbar" id="editor-toolbar"></div>
          </div>
          <div class="editor-area rich" id="editor-area" contenteditable="true" data-ph="开始书写…支持表格、折叠块、公式 $E=mc^2$、代码块，可直接 Ctrl+V 粘贴图片或 Markdown"></div>
          <div class="muted" style="margin-top:8px" id="note-status"></div>
        </div>
      </div>`;

    this._panes = Panes.bind(container.querySelector('.notes-layout'), { key: 'notes', initial: 260, min: 200, max: 420 });

    const listEl = container.querySelector('#note-list');
    const searchEl = container.querySelector('#note-search');
    const editor = container.querySelector('#editor-area');
    const titleInput = container.querySelector('#note-title');
    this._search = '';
    this.currentId = this.currentId && Store.find('notes', this.currentId) ? this.currentId : (notes[0]?.id || null);

    // ---------- 保存状态 / 版本历史 ----------
    const notesCfg = () => Store.config.notes || { autoSaveSec: 60, maxVersions: 20 };
    const versionsOf = id => Store.coll('noteVersions')
      .filter(v => v.noteId === id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    let dirty = false;
    let lastEditAt = 0;
    let lastVersionAt = null;
    let autoTimer = null;
    const markDirty = () => { dirty = true; lastEditAt = Date.now(); this.updateStatus(); };
    this._markDirty = markDirty;
    this._statusInfo = () => ({ dirty, lastVersionAt, versions: versionsOf(this.currentId) });

    // ---------- 列表 ----------
    // 搜索命中片段高亮（先转义再包裹，避免 XSS）
    this._highlight = (text, q) => {
      const safe = U.esc(text);
      if (!q) return safe;
      const i = safe.toLowerCase().indexOf(U.esc(q).toLowerCase());
      if (i < 0) return safe;
      return safe.slice(0, i) + '<mark>' + safe.slice(i, i + U.esc(q).length) + '</mark>' + safe.slice(i + U.esc(q).length);
    };

    const renderList = () => {
      let notes2 = Store.coll('notes');
      if (!notes2.length) { listEl.innerHTML = UI.emptyState('还没有笔记，点上方「新建笔记」'); return; }
      // 本地全文搜索：标题 + 正文纯文本（大小写不敏感），结果按相关度粗排（标题命中优先）
      const q = this._search.trim().toLowerCase();
      if (q) {
        const hit = n => (n.title || '').toLowerCase().includes(q) || U.stripHtml(n.content || '').toLowerCase().includes(q);
        notes2 = notes2.filter(hit).sort((a, b) =>
          (b.title || '').toLowerCase().includes(q) - (a.title || '').toLowerCase().includes(q));
      }
      if (!notes2.length) { listEl.innerHTML = UI.emptyState(`没有匹配「${this._search}」的笔记`); return; }
      listEl.innerHTML = notes2.map(n => `
        <div class="note-item ${n.id === this.currentId ? 'active' : ''}" data-id="${n.id}">
          <div class="note-item-title">${this._highlight(n.title || '无标题', q)}</div>
          <div class="note-item-sub">${U.fmt(n.updatedAt || n.createdAt)}</div>
          <button class="note-del" data-del="${n.id}" title="删除这篇笔记">删除</button>
        </div>`).join('');
      listEl.querySelectorAll('.note-item').forEach(el => el.onclick = () => this.open(el.dataset.id, editor, titleInput));
      listEl.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async e => {
        e.stopPropagation();
        const id = btn.dataset.del;
        const n = Store.find('notes', id);
        if (!n) return;
        const vers = versionsOf(id).length;
        if (!await UI.confirm(`删除笔记《${n.title || '无标题'}》？\n将同时删除其 ${vers} 个历史版本；关联的历史对话会保留。此操作不可恢复，需要备份请先「导出 HTML」。`, { danger: true, confirmLabel: '允许删除' })) return;
        Store.remove('notes', id);
        (Store.coll('noteVersions') || []).filter(v => v.noteId === id).forEach(v => Store.remove('noteVersions', v.id));
        if (this.currentId === id) {
          this.currentId = null;
          editor.innerHTML = '<p></p>';
          titleInput.value = '';
          dirty = false;
          window.NoteChat?.onNoteChange?.(null);
        }
        renderList();
        this.updateStatus();
        UI.toast('笔记已删除');
      });
      Ktx.renderMath(listEl);
    };

    searchEl.oninput = U.debounce(e => { this._search = e.target.value; renderList(); }, 150);

    // ---------- 打开 ----------
    this.open = (id, edEl, tEl) => {
      this.currentId = id;
      dirty = false;
      lastEditAt = 0;
      lastVersionAt = versionsOf(id)[0]?.createdAt || null;
      const n = Store.find('notes', id);
      if (!n) return;
      edEl.innerHTML = n.content || '';
      tEl.value = n.title || '';
      // 切换笔记时清空撤销历史，同步基线快照
      undoStack.length = 0; redoStack.length = 0; lastSnap = takeSnap();
      this.updateStatus();
      renderList();
      window.NoteChat?.onNoteChange?.(id);
    };

    // ---------- 新建 ----------
    container.querySelector('#note-new').onclick = () => {
      const n = Store.insert('notes', { id: U.uid('note'), title: '未命名笔记', content: '<p></p>', createdAt: U.now(), updatedAt: U.now() });
      this.currentId = n.id;
      this.open(n.id, editor, titleInput);
      titleInput.focus(); titleInput.select();
    };

    // ---------- 草稿暂存 + 版本保存 ----------
    const saveDraft = () => {
      if (!this.currentId) return;
      Store.update('notes', this.currentId, { title: titleInput.value.trim() || '未命名笔记', content: editor.innerHTML });
      this.updateStatus();
      const item = listEl.querySelector(`.note-item[data-id="${this.currentId}"] .note-item-title`);
      if (item) item.textContent = titleInput.value.trim() || '未标题';
    };
    const debouncedSave = U.debounce(saveDraft, 600);
    const afterEdit = () => { markDirty(); debouncedSave(); };

    const pruneVersions = noteId => {
      const max = U.clamp(Number(notesCfg().maxVersions) || 20, 1, 200);
      const regular = versionsOf(noteId).filter(v => !v.pinned);
      regular.slice(max).forEach(v => Store.remove('noteVersions', v.id));
    };

    const createVersion = source => {
      if (!this.currentId) return null;
      saveDraft();
      const v = Store.insert('noteVersions', {
        id: U.uid('ver'), noteId: this.currentId,
        title: titleInput.value.trim() || '未命名笔记',
        content: editor.innerHTML, source: source || 'manual', pinned: false,
        createdAt: U.now(),
      });
      pruneVersions(this.currentId);
      dirty = false;
      lastVersionAt = v.createdAt;
      this.updateStatus();
      return v;
    };

    const manualSave = () => {
      createVersion('manual');
      UI.toast('已保存为一个版本', 'success');
    };

    const setupAutoSave = () => {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      const sec = U.clamp(Number(notesCfg().autoSaveSec) || 0, 0, 86400);
      if (!sec) { this.updateStatus(); return; }
      autoTimer = setInterval(() => {
        if (!dirty || Date.now() - lastEditAt < sec * 1000) return;
        createVersion('auto');
      }, 1000);
      this.updateStatus();
    };
    setupAutoSave();
    // ---------- 撤销/重做（快照式：程序化插入、防抖保存都不会破坏历史） ----------
    const undoStack = [], redoStack = [];
    let lastSnap = null;
    const takeSnap = () => ({ html: editor.innerHTML, title: titleInput.value });
    const syncSnap = () => {
      const cur = takeSnap();
      if (lastSnap && (cur.html !== lastSnap.html || cur.title !== lastSnap.title)) {
        undoStack.push(lastSnap);
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
      }
      lastSnap = cur;
    };
    const pushUndoSoon = U.debounce(syncSnap, 350);
    const restoreSnap = s => {
      editor.innerHTML = s.html;
      titleInput.value = s.title;
      lastSnap = s;
      Ktx.renderMath(editor);
      afterEdit();
    };
    const doUndo = () => {
      if (!undoStack.length) return UI.toast('没有可撤销的编辑');
      redoStack.push(lastSnap);
      restoreSnap(undoStack.pop());
    };
    const doRedo = () => {
      if (!redoStack.length) return UI.toast('没有可重做的编辑');
      undoStack.push(lastSnap);
      restoreSnap(redoStack.pop());
    };
    this._undo = { undo: doUndo, redo: doRedo, counts: () => ({ u: undoStack.length, r: redoStack.length }), sync: syncSnap };
    this._createVersion = createVersion;

    editor.addEventListener('input', () => { pushUndoSoon(); afterEdit(); });
    editor.addEventListener('click', e => {
      const trigger = e.target.closest?.('.ai-annotation-trigger');
      if (!trigger) return;
      const ann = trigger.closest('.ai-annotation');
      ann?.classList.toggle('open');
    });
    editor.addEventListener('focusout', e => {
      const card = e.target.closest?.('.ai-annotation-card');
      if (!card) return;
      Ktx.renderMath(card);
      syncSnap();
      afterEdit();
    });
    // 悬浮批注卡片定位：相对编辑区可视框做像素级钳制，保证左右/上下都不越界被 overflow 裁剪
    const placeCard = ann => {
      const card = ann.querySelector('.ai-annotation-card');
      if (!card) return;
      const er = editor.getBoundingClientRect();
      const ar = ann.getBoundingClientRect();
      const cw = card.offsetWidth || Math.min(520, window.innerWidth - 96);
      const ch = card.offsetHeight || Math.min(0.58 * window.innerHeight, 320);
      card.style.right = '';
      card.style.bottom = '';
      // 卡片 absolute 定位相对 ann；期望左边与触发标签对齐，再钳制到编辑区内（留 8px 余量）
      const pad = 8;
      const minLeft = er.left + pad - ar.left;
      const maxLeft = Math.max(minLeft, er.right - pad - cw - ar.left);
      card.style.left = U.clamp(0, minLeft, maxLeft) + 'px';
      // 默认向下弹出；下方空间不足且上方足够时向上弹出
      const below = er.bottom - ar.bottom;
      const above = ar.top - er.top;
      card.style.top = (below < ch + pad && above > ch + pad)
        ? -(ch + 6) + 'px'
        : (ar.height + 6) + 'px';
    };
    const placeAllCards = () => editor.querySelectorAll('.ai-annotation').forEach(placeCard);
    editor.addEventListener('pointerover', e => {
      const ann = e.target.closest?.('.ai-annotation');
      if (ann) placeCard(ann);
    });
    editor.addEventListener('focusin', e => {
      const ann = e.target.closest?.('.ai-annotation');
      if (ann) placeCard(ann);
    });
    editor.addEventListener('scroll', placeAllCards);
    window.addEventListener('resize', placeAllCards);
    titleInput.addEventListener('input', () => { pushUndoSoon(); afterEdit(); });
    titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') editor.focus(); });
    editor.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); doRedo(); }
    });

    // ---------- 粘贴：图片上传 / MD 自动转富文本 ----------
    editor.addEventListener('paste', async e => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          e.preventDefault();
          const file = it.getAsFile();
          const dataUrl = await U.compressDataURL(await U.readFileDataURL(file));
          this.insertImage(editor, dataUrl, afterEdit);
          return;
        }
      }
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text && MD.looksLikeMd(text)) {
        e.preventDefault();
        document.execCommand('insertHTML', false, Sanitize.html(MD.toHtml(text)));
        Ktx.renderMath(editor);
        afterEdit();
        UI.toast('已按 Markdown 转换插入');
        return;
      }
      // 外来 HTML 粘贴：先消毒再插入，避免 onclick/危险 style/javascript: 进入本地笔记
      const html = e.clipboardData?.getData('text/html') || '';
      if (html) {
        const safe = Sanitize.html(html);
        if (safe !== html) {
          e.preventDefault();
          document.execCommand('insertHTML', false, safe);
          Ktx.renderMath(editor);
          afterEdit();
          UI.toast('已过滤粘贴内容中的不安全 HTML', 'warn');
        }
      }
    });

    // ---------- 工具栏 ----------
    const toolbarCleanup = this.buildToolbar(container.querySelector('#editor-toolbar'), editor, afterEdit, { undo: doUndo, redo: doRedo });

    // ---------- MD 导入 ----------
    container.querySelector('#note-md-import').onclick = async () => {
      const text = await UI.prompt('粘贴 Markdown 文本，将转换为富文本追加到笔记末尾', '', '# 标题\n- 列表');
      if (!text) return;
      editor.insertAdjacentHTML('beforeend', Sanitize.html(MD.toHtml(text)));
      Ktx.renderMath(editor);
      afterEdit();
    };

    // ---------- 导入 MD 文件生成新笔记 ----------
    container.querySelector('#note-import-md').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt,text/plain,text/markdown';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) return UI.toast('文件超过 5MB 限制', 'warn');
        const text = await f.text();
        const html = Sanitize.html(MD.toHtml(text));
        if (!U.stripHtml(html)) return UI.toast('文件内容为空或无法解析', 'warn');
        const title = (text.match(/^#\s+(.+)$/m)?.[1]
          || text.match(/^##?\s+(.+)$/m)?.[1]
          || f.name.replace(/\.(md|markdown|txt)$/i, '')).trim().slice(0, 40) || f.name;
        const n = Store.insert('notes', {
          id: U.uid('note'), title, content: html, createdAt: U.now(), updatedAt: U.now(),
        });
        this.currentId = n.id;
        this.open(n.id, editor, titleInput);
        Ktx.renderMath(editor);
        UI.toast(`已导入「${title}」（约 ${Math.round(text.length / 100) / 10} 千字）`, 'success');
      };
      input.click();
    };

    // ---------- 导入 PDF 教材（pdf.js 提取文本 → AI 分块笔记化 → 可选出题） ----------
    container.querySelector('#note-import-pdf').onclick = () => {
      if (!window.pdfjsLib) return UI.toast('未检测到 pdf.js（vendor/pdfjs/），无法导入 PDF', 'error');
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.pdf,application/pdf';
      input.onchange = () => {
        const f = input.files[0];
        if (!f) return;
        let m;
        m = UI.modal({
          title: `导入 PDF 教材 · ${f.name.slice(0, 24)}`, width: 560, raw: true,
          body: `
            <div class="field"><label class="field-label">页码范围（先小范围试效果）</label>
              <div style="display:flex;gap:8px">
                <input class="input" id="pdf-from" type="number" min="1" value="1">
                <input class="input" id="pdf-to" type="number" min="1" value="20">
              </div>
              <div class="field-hint">每段交给 AI 整理为结构化学习笔记（保留定义/表格/考点标注）；扫描版 PDF 无文本层，暂不支持</div></div>
            <div class="field"><label class="field-label">每块页数</label><input class="input" id="pdf-per" type="number" min="2" max="20" value="8"></div>
            <label class="checkbox-row"><input type="checkbox" id="pdf-genq" checked><span>整理完成后，同时用 AI 生成配套题库</span></label>`,
          actions: [
            { label: '取消' },
            { label: '🚀 开始导入', primary: true, onClick: close => {
              const from = U.clamp(+m.el.querySelector('#pdf-from').value || 1, 1, 5000);
              const to = U.clamp(+m.el.querySelector('#pdf-to').value || 20, from, 5000);
              const per = U.clamp(+m.el.querySelector('#pdf-per').value || 8, 2, 20);
              const genq = m.el.querySelector('#pdf-genq').checked;
              close();
              this.importPdf(f, from, to, per, genq, editor, titleInput);
            } },
          ],
        });
      };
      input.click();
    };

    // ---------- 插入批注产物 ----------
    container.querySelector('#note-insert-annot').onclick = () => this.pickAnnot(editor, afterEdit);

    // ---------- 手动保存 / 历史版本 / 保存设置 ----------
    const sourceLabel = v => ({ manual: '手动', auto: '自动', restore: '恢复' }[v.source] || '版本');
    let versionModal = null;
    const renderVersionList = () => {
      if (!versionModal || !this.currentId) return;
      const list = versionsOf(this.currentId);
      const head = `<div class="version-summary">共 ${list.length} 个版本 · 永久保存 ${list.filter(v => v.pinned).length} 个 · 自动保存每 ${notesCfg().autoSaveSec || '关闭'} 秒 · 普通版本保留 ${notesCfg().maxVersions} 个</div>`;
      const body = list.length ? `<div class="version-list">${list.map(v => `
        <div class="version-item ${v.pinned ? 'pinned' : ''}" data-id="${v.id}">
          <div class="version-main">
            <div class="version-title"><span class="version-chip">${sourceLabel(v)}</span>${U.esc(v.title || '未命名笔记')}</div>
            <div class="version-sub">${U.fmt(v.createdAt)} · ${(v.content || '').length} 字符${v.pinned ? ' · 🔒 永久保存' : ''}</div>
          </div>
          <div class="version-ops">
            <button class="btn btn-ghost btn-xs" data-act="restore">恢复此版</button>
            <button class="btn btn-ghost btn-xs" data-act="pin">${v.pinned ? '取消永久' : '永久保存'}</button>
            <button class="btn btn-ghost btn-xs danger" data-act="delete">删除</button>
          </div>
        </div>`).join('')}</div>` : '<div class="empty" style="padding:30px;text-align:center;color:var(--ink-3)">还没有历史版本，点击「💾 保存」创建第一个版本。</div>';
      versionModal.bodyEl.innerHTML = head + body;
      versionModal.bodyEl.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.closest('.version-item')?.dataset.id;
          const v = Store.find('noteVersions', id);
          if (!v) return;
          if (btn.dataset.act === 'restore') {
            if (!await UI.confirm(`恢复「${U.fmt(v.createdAt)}」的版本？当前未保存修改会先存为一个版本，然后恢复到所选版本。`, { danger: true })) return;
            if (dirty) createVersion('auto');
            editor.innerHTML = Sanitize.html(v.content || '');
            titleInput.value = v.title || '';
            syncSnap();
            Ktx.renderMath(editor);
            afterEdit();
            createVersion('restore');
            renderList();
            versionModal.close();
            UI.toast('已恢复所选版本', 'success');
          } else if (btn.dataset.act === 'pin') {
            Store.update('noteVersions', id, { pinned: !v.pinned });
            renderVersionList();
            UI.toast(v.pinned ? '已取消永久保存' : '已永久保存', 'success');
          } else if (btn.dataset.act === 'delete') {
            if (!await UI.confirm(`删除「${U.fmt(v.createdAt)}」的版本？此操作不可撤销。`, { danger: true })) return;
            Store.remove('noteVersions', id);
            renderVersionList();
            this.updateStatus();
            UI.toast('版本已删除');
          }
        };
      });
    };
    container.querySelector('#note-history').onclick = () => {
      versionModal = UI.modal({ title: '笔记历史版本', width: 780, raw: true, body: '', actions: [{ label: '关闭' }] });
      renderVersionList();
    };
    container.querySelector('#note-save').onclick = manualSave;
    container.querySelector('#note-autosave').onclick = () => {
      const cfg = notesCfg();
      const m = UI.modal({
        title: '笔记保存设置', width: 480, raw: true,
        body: `<div class="form-row"><label>自动保存版本间隔（秒）</label>
                 <input class="input" id="cfg-auto-save" type="number" min="0" max="86400" step="10" value="${U.clamp(Number(cfg.autoSaveSec) || 0, 0, 86400)}">
                 <div class="field-hint">0 = 关闭自动版本；编辑内容仍会即时暂存到草稿，防止意外丢失。</div></div>
               <div class="form-row"><label>每篇笔记保留的历史版本数</label>
                 <input class="input" id="cfg-max-versions" type="number" min="1" max="200" step="1" value="${U.clamp(Number(cfg.maxVersions) || 20, 1, 200)}">
                 <div class="field-hint">超出数量的旧版本自动清理；已「永久保存」的版本不会被清理。</div></div>`,
        actions: [
          { label: '取消' },
          { label: '保存设置', primary: true, onClick: async close => {
            const sec = U.clamp(parseInt(document.getElementById('cfg-auto-save').value, 10) || 0, 0, 86400);
            const max = U.clamp(parseInt(document.getElementById('cfg-max-versions').value, 10) || 20, 1, 200);
            Store.config.notes = { ...notesCfg(), autoSaveSec: sec, maxVersions: max };
            await Store.saveConfig();
            if (this.currentId) pruneVersions(this.currentId);
            setupAutoSave();
            close();
            UI.toast('保存设置已更新', 'success');
          } },
        ],
      });
      void m;
    };

    const onSaveKey = e => {
      if (App.currentView !== 'notes') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); manualSave(); }
    };
    this._cleanup?.();
    document.addEventListener('keydown', onSaveKey);
    this._cleanup = () => {
      if (autoTimer) clearInterval(autoTimer);
      document.removeEventListener('keydown', onSaveKey);
      window.removeEventListener('resize', placeAllCards);
      toolbarCleanup?.();
    };

    // ---------- 右侧笔记助教 ----------
    container.querySelector('#note-chat-open').onclick = () => {
      if (window.NoteChat) NoteChat.toggle();
      else UI.toast('对话栏尚未就绪，请刷新页面', 'error');
    };

    // ---------- 导出独立 HTML ----------
    container.querySelector('#note-export').onclick = () => {
      const n = Store.find('notes', this.currentId);
      if (!n) return UI.toast('请先选择笔记', 'warn');
      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${U.esc(n.title)}</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.7;color:#26231d}
h1{border-bottom:2px solid #e6e1d3;padding-bottom:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 12px}
blockquote{border-left:3px solid #ccc;margin:10px 0;padding:8px 16px;color:#555;background:#f9f8f4}pre{background:#2a2721;color:#eee;padding:12px 16px;border-radius:8px;overflow-x:auto}
code{font-family:Consolas,monospace;background:#f4f2ec;padding:1px 5px;border-radius:4px}pre code{background:none;padding:0}img{max-width:100%;border-radius:8px}
a{color:#2d6a4f}mark{padding:1px 2px;border-radius:3px}del,s{color:#8d8677}sup,sub{font-size:.78em}
.todo-list{list-style:none;padding-left:6px}.todo-list li{display:flex;align-items:baseline;gap:8px;margin:4px 0}
details{border:1px solid #e6e1d3;border-radius:7px;padding:8px 14px;margin:10px 0}summary{cursor:pointer;font-weight:600}
hr{border:none;border-top:1px solid #e6e1d3;margin:18px 0}</style></head>
<body><h1>${U.esc(n.title)}</h1>${Sanitize.html(n.content)}</body></html>`;
      U.download(`${n.title || '笔记'}.html`, html, 'text/html');
    };

    if (this.currentId) this.open(this.currentId, editor, titleInput);
    else if (notes.length === 0) {
      // 首次使用引导笔记
      const welcome = Store.insert('notes', {
        id: U.uid('note'), title: '欢迎使用智学笔记', createdAt: U.now(), updatedAt: U.now(),
        content: Sanitize.html(`<h2>这是一份 HTML 原生笔记</h2>
<p>富文本的一切都可用：<b>加粗</b>、<i>斜体</i>、表格、折叠块、代码块、待办清单，还能插入截图批注产物。</p>
<h3>数学公式</h3><p>行内公式如 $E=mc^2$，块级公式如 $$\\int_a^b f(x)dx = F(b)-F(a)$$（需安装本地 KaTeX，见设置页）。</p>
<h3>试试折叠块</h3>
<details open><summary>点我可以折叠</summary><p>任何内容都能收进折叠块，信息密度拉满。</p></details>
<h3>待办</h3><ul class="todo-list"><li><input type="checkbox" checked><span>导入一个题库（刷题页）</span></li><li><input type="checkbox"><span>做一道题，试试 AI 批改</span></li><li><input type="checkbox"><span>截图圈画一道题，圈选提问</span></li></ul>`),
      });
      this.currentId = welcome.id;
      this.open(welcome.id, editor, titleInput);
    }
    renderList();
  },

  updateStatus() {
    const el = document.getElementById('note-status');
    if (!el || !this.currentId) return;
    const n = Store.find('notes', this.currentId);
    const info = this._statusInfo?.() || {};
    const cfg = Store.config.notes || { autoSaveSec: 60, maxVersions: 20 };
    const versions = info.versions || [];
    const latest = versions[0];
    const latestLabel = latest
      ? `最近版本 ${U.fmt(latest.createdAt)}（${latest.source === 'manual' ? '手动' : latest.source === 'restore' ? '恢复' : '自动'}）`
      : '尚无历史版本';
    el.textContent = `${info.dirty ? '● 草稿未存为版本' : '✓ 已保存版本'} · 草稿 ${U.fmt(n?.updatedAt || n?.createdAt)} · ${latestLabel} · ${versions.length} 版 · ${cfg.autoSaveSec ? `自动 ${cfg.autoSaveSec}s` : '自动关闭'}`;
  },

  buildToolbar(bar, editor, save, undoApi = {}) {
    const icon = (name, size = 16) => Icon.svg(name, size);
    const exec = (cmd, val) => { editor.focus(); document.execCommand(cmd, false, val); };
    const insertHTML = html => {
      editor.focus();
      document.execCommand('insertHTML', false, html);
      Ktx.renderMath(editor);
    };
    // 让 color/hiliteColor 产出稳定的内联 style（而非 font 标签），消毒与导出都能保留
    const useCss = () => { try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* 老浏览器忽略 */ } };

    const HL_COLORS = [
      { c: '#fff2a8', n: '黄' }, { c: '#d7f5e3', n: '绿' }, { c: '#d7eaff', n: '蓝' },
      { c: '#ffd9e6', n: '粉' }, { c: '#e7dcff', n: '紫' }, { c: '#ffe0bf', n: '橙' },
      { c: '#eceae4', n: '灰' }, { c: 'transparent', n: '清除高亮' },
    ];
    const FG_COLORS = [
      { c: '#26231d', n: '墨色' }, { c: '#bc4b2a', n: '朱红' }, { c: '#2d6a4f', n: '墨绿' },
      { c: '#3457d5', n: '蓝' }, { c: '#b98a2f', n: '金' }, { c: '#8d8677', n: '灰' },
    ];

    const tools = [
      { icon: 'undo', title: '撤销 (Ctrl+Z)', cmd: undoApi.undo || (() => {}) },
      { icon: 'redo', title: '重做 (Ctrl+Y)', cmd: undoApi.redo || (() => {}) },
      { sep: true },
      { icon: 'bold', title: '加粗 (Ctrl+B)', cmd: () => exec('bold') },
      { icon: 'italic', title: '斜体 (Ctrl+I)', cmd: () => exec('italic') },
      { icon: 'underline', title: '下划线 (Ctrl+U)', cmd: () => exec('underline') },
      { icon: 'strike', title: '删除线', cmd: () => exec('strikeThrough') },
      { sep: true },
      { icon: 'highlight', title: '彩色高亮', palette: 'hl' },
      { icon: 'textColor', title: '文字颜色', palette: 'fg' },
      { icon: 'sup', title: '上标', cmd: () => exec('superscript') },
      { icon: 'sub', title: '下标', cmd: () => exec('subscript') },
      { sep: true },
      { icon: 'h1', title: '标题1', cmd: () => exec('formatBlock', 'h1') },
      { icon: 'h2', title: '标题2', cmd: () => exec('formatBlock', 'h2') },
      { icon: 'h3', title: '标题3', cmd: () => exec('formatBlock', 'h3') },
      { icon: 'paragraph', title: '正文', cmd: () => exec('formatBlock', 'p') },
      { sep: true },
      { icon: 'list', title: '无序列表', cmd: () => exec('insertUnorderedList') },
      { icon: 'listOrdered', title: '有序列表', cmd: () => exec('insertOrderedList') },
      { icon: 'todo', title: '待办清单', cmd: () => insertHTML('<ul class="todo-list"><li><input type="checkbox"><span>待办事项</span></li><li><input type="checkbox"><span>待办事项</span></li></ul><p></p>') },
      { icon: 'quote', title: '引用', cmd: () => exec('formatBlock', 'blockquote') },
      { sep: true },
      { icon: 'link', title: '插入链接', cmd: async () => {
        const sel = window.getSelection();
        const picked = sel && !sel.isCollapsed ? sel.toString() : '';
        const url = await UI.prompt('输入链接地址', 'https://', 'https://… 或 #锚点');
        if (!url) return;
        const label = U.esc(picked || url);
        insertHTML(`<a href="${U.esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      } },
      { icon: 'table', title: '插入表格', cmd: () => insertHTML(this.tableHtml(3, 3) + '<p></p>') },
      { icon: 'code', title: '代码块', cmd: () => insertHTML('<pre><code>// 代码</code></pre><p></p>') },
      { icon: 'braces', title: '行内代码', cmd: () => insertHTML('<code>代码</code>&nbsp;') },
      { icon: 'details', title: '折叠块', cmd: () => insertHTML('<details><summary>折叠标题</summary><p>内容</p></details><p></p>') },
      { icon: 'minus', title: '分割线', cmd: () => insertHTML('<hr><p></p>') },
      { sep: true },
      { icon: 'sigma', title: '行内公式', cmd: async () => {
        const tex = await UI.prompt('输入 LaTeX 公式（行内）', 'x^2+y^2=z^2');
        if (tex) insertHTML(`<span data-tex="${U.esc(tex)}">$${U.esc(tex)}$</span> `);
      } },
      { icon: 'formula', title: '块级公式', cmd: async () => {
        const tex = await UI.prompt('输入 LaTeX 公式（独立成段）', '\\int_a^b f(x)\\,dx');
        if (tex) insertHTML(`$$${U.esc(tex)}$$<p></p>`);
        Ktx.renderMath(editor);
      } },
      { sep: true },
      { icon: 'eraser', title: '清除格式', cmd: () => exec('removeFormat') },
      { icon: 'image', title: '插入图片', cmd: () => this.pickImage(editor, save) },
      { icon: 'scissors', title: '去截图批注制作插图', cmd: () => { location.hash = 'annotator'; UI.toast('先在批注页制作插图，再回到这里「插入批注图」'); } },
    ];

    bar.innerHTML = tools.map((t, i) => t.sep
      ? '<span class="tb-sep"></span>'
      : `<button type="button" class="tb-btn${t.palette ? ' tb-palette-btn' : ''}" data-i="${i}" title="${t.title}" aria-label="${t.title}">${icon(t.icon)}</button>`
    ).join('') + '<div class="tb-popover" hidden></div>';

    const popover = bar.querySelector('.tb-popover');
    const closePop = () => { popover.hidden = true; };
    const openPop = (kind, btn) => {
      if (!popover.hidden && popover.dataset.kind === kind) { closePop(); return; }
      popover.dataset.kind = kind;
      const list = kind === 'hl' ? HL_COLORS : FG_COLORS;
      popover.innerHTML = `<div class="tb-pop-title">${kind === 'hl' ? '高亮颜色' : '文字颜色'}</div>`
        + `<div class="tb-swatches">${list.map(x =>
          `<button type="button" class="tb-swatch${x.c === 'transparent' ? ' swatch-clear' : ''}" data-color="${x.c}" title="${x.n}" style="--sw:${x.c === 'transparent' ? '#fff' : x.c}"></button>`).join('')}</div>`;
      const br = btn.getBoundingClientRect(), pr = bar.getBoundingClientRect();
      popover.style.left = Math.max(0, Math.min(br.left - pr.left, pr.width - 188)) + 'px';
      popover.hidden = false;
      popover.querySelectorAll('.tb-swatch').forEach(sw => {
        sw.onclick = () => {
          useCss();
          exec(kind === 'hl' ? 'hiliteColor' : 'foreColor', sw.dataset.color);
          closePop();
        };
      });
    };

    bar.querySelectorAll('.tb-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const t = tools[+btn.dataset.i];
        if (t.palette) { openPop(t.palette, btn); return; }
        closePop();
        t.cmd();
        save();
      };
    });
    const onDocDown = e => {
      if (!popover.hidden && !popover.contains(e.target) && !e.target.closest?.('.tb-palette-btn')) closePop();
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  },

  tableHtml(rows, cols) {
    let t = '<table><tbody>';
    for (let r = 0; r < rows; r++) {
      t += '<tr>';
      for (let c = 0; c < cols; c++) t += r === 0 ? `<th>${r * cols + c + 1}</th>` : `<td> </td>`;
      t += '</tr>';
    }
    return t + '</tbody></table>';
  },

  async insertImage(editor, dataUrl, after) {
    const url = await Api.upload(dataUrl);
    editor.focus();
    const okIns = document.execCommand('insertHTML', false, `<img src="${url}">`);
    if (!okIns) editor.insertAdjacentHTML('beforeend', `<img src="${url}">`);
    Ktx.renderMath(editor);
    if (after) after();
    else Store.save();
    UI.toast('图片已上传插入');
  },

  async importPdf(file, from, to, per, genq, editor, titleInput) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    UI.spinner(true, '读取 PDF…');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const pages = [];
      for (let p = from; p <= Math.min(to, doc.numPages); p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const text = tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (text) pages.push({ p, text });
      }
      if (!pages.length) { UI.spinner(false); return UI.toast('未提取到文本——可能是扫描版 PDF（无文字层），需要 OCR，暂未支持', 'warn'); }
      const chunks = [];
      for (let i = 0; i < pages.length; i += per) {
        const seg = pages.slice(i, i + per);
        chunks.push({ from: seg[0].p, to: seg[seg.length - 1].p, text: seg.map(x => `【第${x.p}页】${x.text}`).join('\n') });
      }
      let mdAll = `# ${file.name.replace(/\.pdf$/i, '')}（AI 整理笔记）\n`;
      let i = 0;
      for (const c of chunks) {
        i++;
        UI.spinner(true, `AI 整理教材 ${i}/${chunks.length}（第 ${c.from}-${c.to} 页）…`);
        const r = await AI.pdfNotes(c.text, c.from, c.to);
        mdAll += `\n\n${r.md}\n`;
      }
      const title = file.name.replace(/\.pdf$/i, '').slice(0, 40);
      const n = Store.insert('notes', { id: U.uid('note'), title, content: Sanitize.html(MD.toHtml(mdAll)), createdAt: U.now(), updatedAt: U.now(), source: 'pdf' });
      this.currentId = n.id;
      this.open(n.id, editor, titleInput);
      Ktx.renderMath(editor);
      UI.spinner(false);
      UI.toast(`PDF 已整理为笔记（${pages.length} 页 → ${chunks.length} 块）`, 'success');
      if (genq) {
        UI.spinner(true, 'AI 从教材生成题库…');
        try {
          const r = await AI.bankParse(mdAll, { mode: 'generate', maxChars: 60000 });
          const bank = Store.insert('banks', {
            id: U.uid('bank'), name: `${title}（AI 出题）`, createdAt: U.now(), updatedAt: U.now(),
            questions: (r.data.questions || []).map(q => ({ ...q, id: U.uid('q') })),
          });
          UI.toast(`已生成题库「${bank.name}」（${bank.questions.length} 题），去「刷题」页查看`, 'success');
        } catch (e) { UI.toast(`出题失败：${e.message}`, 'warn'); }
      }
    } catch (e) {
      UI.spinner(false);
      UI.toast(`PDF 导入失败：${e.message}`, 'error');
    }
  },

  pickImage(editor, save) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      if (!input.files[0]) return;
      const dataUrl = await U.compressDataURL(await U.readFileDataURL(input.files[0]));
      this.insertImage(editor, dataUrl, save);
    };
    input.click();
  },

  pickAnnot(editor, save) {
    const annots = Store.coll('annots');
    if (!annots.length) return UI.toast('还没有批注产物，请先到「截图批注」制作', 'warn');
    const m = UI.modal({
      title: '选择批注产物插入笔记',
      raw: true,
      body: `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
        ${annots.map(a => `
          <div class="annot-pick" data-url="${a.exportedUrl || ''}" data-id="${a.id}" style="cursor:pointer;border:1px solid var(--line);border-radius:8px;padding:6px;text-align:center">
            ${a.exportedUrl ? `<img src="${a.exportedUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:5px">` : '<div style="height:90px;display:flex;align-items:center;justify-content:center;color:var(--ink-3)">未导出</div>'}
            <div class="small" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${U.esc(a.title || '批注')}</div>
          </div>`).join('')}
      </div>`,
      actions: [{ label: '取消' }],
    });
    m.bodyEl.querySelectorAll('.annot-pick').forEach(el => {
      el.onclick = () => {
        if (!el.dataset.url) return UI.toast('该批注未导出过图片', 'warn');
        editor.focus();
        const html = `<figure><img src="${el.dataset.url}"><figcaption style="color:var(--ink-3);font-size:12px">${U.esc(Store.find('annots', el.dataset.id)?.title || '')}</figcaption></figure>`;
        const okIns = document.execCommand('insertHTML', false, html);
        if (!okIns) editor.insertAdjacentHTML('beforeend', html);
        Ktx.renderMath(editor);
        save();
        m.close();
      };
    });
  },
};
