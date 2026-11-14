// 笔记工作台：HTML 原生富文档编辑器
window.Views = window.Views || {};
Views.notes = {
  currentId: null,

  render(container) {
    const notes = Store.coll('notes');
    container.innerHTML = `
      <div class="notes-layout">
        <div class="notes-list">
          <button class="btn btn-primary" id="note-new" style="width:100%;margin-bottom:12px">＋ 新建笔记</button>
          <div id="note-list"></div>
        </div>
        <div class="notes-editor">
          <div class="note-editor-head">
            <input class="note-title-input" id="note-title" placeholder="笔记标题…">
            <button class="btn btn-ghost btn-sm" id="note-md-import" title="把 Markdown 文本转换为富文本块追加到笔记">MD 粘贴转换</button>
            <button class="btn btn-ghost btn-sm" id="note-import-md" title="导入 .md / .markdown / .txt 文件，自动生成一篇新笔记">📄 导入文件</button>
            <button class="btn btn-ghost btn-sm" id="note-insert-annot" title="插入截图批注产物">插入批注图</button>
            <button class="btn btn-ghost btn-sm" id="note-export" title="导出为独立 HTML 文件">导出 HTML</button>
          </div>
          <div class="editor-toolbar" id="editor-toolbar"></div>
          <div class="editor-area rich" id="editor-area" contenteditable="true" data-ph="开始书写…支持表格、折叠块、公式 $E=mc^2$、代码块，可直接 Ctrl+V 粘贴图片或 Markdown"></div>
          <div class="muted" style="margin-top:8px" id="note-status"></div>
        </div>
      </div>`;

    const listEl = container.querySelector('#note-list');
    const editor = container.querySelector('#editor-area');
    const titleInput = container.querySelector('#note-title');
    this.currentId = this.currentId && Store.find('notes', this.currentId) ? this.currentId : (notes[0]?.id || null);

    // ---------- 列表 ----------
    const renderList = () => {
      const notes2 = Store.coll('notes');
      if (!notes2.length) { listEl.innerHTML = UI.emptyState('还没有笔记，点上方「新建笔记」'); return; }
      listEl.innerHTML = notes2.map(n => `
        <div class="note-item ${n.id === this.currentId ? 'active' : ''}" data-id="${n.id}">
          <div class="note-item-title">${U.esc(n.title || '无标题')}</div>
          <div class="note-item-sub">${U.fmt(n.updatedAt || n.createdAt)}</div>
        </div>`).join('');
      listEl.querySelectorAll('.note-item').forEach(el => el.onclick = () => this.open(el.dataset.id, editor, titleInput));
      Ktx.renderMath(listEl);
    };

    // ---------- 打开 ----------
    this.open = (id, edEl, tEl) => {
      this.currentId = id;
      const n = Store.find('notes', id);
      if (!n) return;
      edEl.innerHTML = n.content || '';
      tEl.value = n.title || '';
      this.updateStatus();
      renderList();
    };

    // ---------- 新建 ----------
    container.querySelector('#note-new').onclick = () => {
      const n = Store.insert('notes', { id: U.uid('note'), title: '未命名笔记', content: '<p></p>', createdAt: U.now(), updatedAt: U.now() });
      this.currentId = n.id;
      this.open(n.id, editor, titleInput);
      titleInput.focus(); titleInput.select();
    };

    // ---------- 自动保存 ----------
    const saveCurrent = () => {
      if (!this.currentId) return;
      Store.update('notes', this.currentId, { title: titleInput.value.trim() || '未命名笔记', content: editor.innerHTML });
      this.updateStatus();
      const item = listEl.querySelector(`.note-item[data-id="${this.currentId}"] .note-item-title`);
      if (item) item.textContent = titleInput.value.trim() || '未标题';
    };
    const debouncedSave = U.debounce(saveCurrent, 900);
    editor.addEventListener('input', () => { debouncedSave(); this.updateStatus(); });
    titleInput.addEventListener('input', debouncedSave);
    titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') editor.focus(); });

    // ---------- 粘贴：图片上传 / MD 自动转富文本 ----------
    editor.addEventListener('paste', async e => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          e.preventDefault();
          const file = it.getAsFile();
          const dataUrl = await U.compressDataURL(await U.readFileDataURL(file));
          this.insertImage(editor, dataUrl);
          return;
        }
      }
      const text = e.clipboardData?.getData('text/plain') || '';
      if (text && MD.looksLikeMd(text)) {
        e.preventDefault();
        document.execCommand('insertHTML', false, Sanitize.html(MD.toHtml(text)));
        Ktx.renderMath(editor);
        debouncedSave();
        UI.toast('已按 Markdown 转换插入');
      }
    });

    // ---------- 工具栏 ----------
    this.buildToolbar(container.querySelector('#editor-toolbar'), editor, debouncedSave);

    // ---------- MD 导入 ----------
    container.querySelector('#note-md-import').onclick = async () => {
      const text = await UI.prompt('粘贴 Markdown 文本，将转换为富文本追加到笔记末尾', '', '# 标题\n- 列表');
      if (!text) return;
      editor.insertAdjacentHTML('beforeend', Sanitize.html(MD.toHtml(text)));
      Ktx.renderMath(editor);
      debouncedSave();
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

    // ---------- 插入批注产物 ----------
    container.querySelector('#note-insert-annot').onclick = () => this.pickAnnot(editor, debouncedSave);

    // ---------- 导出独立 HTML ----------
    container.querySelector('#note-export').onclick = () => {
      const n = Store.find('notes', this.currentId);
      if (!n) return UI.toast('请先选择笔记', 'warn');
      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${U.esc(n.title)}</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.7;color:#26231d}
h1{border-bottom:2px solid #e6e1d3;padding-bottom:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 12px}
blockquote{border-left:3px solid #ccc;margin:10px 0;padding:8px 16px;color:#555;background:#f9f8f4}pre{background:#2a2721;color:#eee;padding:12px 16px;border-radius:8px;overflow-x:auto}
code{font-family:Consolas,monospace}img{max-width:100%}</style></head>
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
    el.textContent = `已自动保存 · ${U.fmt(n?.updatedAt || n?.createdAt)} · 约 ${(U.stripHtml(n?.content || '').length / 1000).toFixed(1)} 千字`;
  },

  buildToolbar(bar, editor, save) {
    const insertHTML = html => {
      editor.focus();
      document.execCommand('insertHTML', false, html);
      Ktx.renderMath(editor);
      save();
    };
    const tools = [
      { icon: 'B', title: '加粗', cmd: () => document.execCommand('bold') },
      { icon: 'I', title: '斜体', cmd: () => document.execCommand('italic') },
      { icon: 'U', title: '下划线', cmd: () => document.execCommand('underline') },
      { sep: true },
      { icon: 'H1', title: '标题1', cmd: () => document.execCommand('formatBlock', false, 'h1') },
      { icon: 'H2', title: '标题2', cmd: () => document.execCommand('formatBlock', false, 'h2') },
      { icon: 'H3', title: '标题3', cmd: () => document.execCommand('formatBlock', false, 'h3') },
      { icon: '¶', title: '正文', cmd: () => document.execCommand('formatBlock', false, 'p') },
      { sep: true },
      { icon: '•', title: '无序列表', cmd: () => document.execCommand('insertUnorderedList') },
      { icon: '1.', title: '有序列表', cmd: () => document.execCommand('insertOrderedList') },
      { icon: '☑', title: '待办清单', cmd: () => insertHTML('<ul class="todo-list"><li><input type="checkbox"><span>待办事项</span></li><li><input type="checkbox"><span>待办事项</span></li></ul><p></p>') },
      { icon: '❝', title: '引用', cmd: () => document.execCommand('formatBlock', false, 'blockquote') },
      { sep: true },
      { icon: '⊞', title: '插入表格', cmd: () => insertHTML(this.tableHtml(3, 3) + '<p></p>') },
      { icon: '&lt;/&gt;', title: '代码块', cmd: () => insertHTML('<pre><code>// 代码</code></pre><p></p>') },
      { icon: '▾', title: '折叠块', cmd: () => insertHTML('<details><summary>折叠标题</summary><p>内容</p></details><p></p>') },
      { icon: '—', title: '分割线', cmd: () => insertHTML('<hr><p></p>') },
      { icon: '∑', title: '行内公式', cmd: async () => {
        const tex = await UI.prompt('输入 LaTeX 公式（行内）', 'x^2+y^2=z^2');
        if (tex) insertHTML(`<span data-tex="${U.esc(tex)}">$${U.esc(tex)}$</span> `);
      } },
      { icon: 'Σ', title: '块级公式', cmd: async () => {
        const tex = await UI.prompt('输入 LaTeX 公式（独立成段）', '\\int_a^b f(x)\\,dx');
        if (tex) insertHTML(`$$${U.esc(tex)}$$<p></p>`);
        Ktx.renderMath(editor);
      } },
      { icon: '🖼', title: '插入图片', cmd: () => this.pickImage(editor, save) },
      { icon: '✂', title: '去截图批注制作插图', cmd: () => { location.hash = 'annotator'; UI.toast('先在批注页制作插图，再回到这里「插入批注图」'); } },
    ];
    bar.innerHTML = tools.map((t, i) => t.sep ? '<div class="tb-sep"></div>' : `<button class="tb-btn" data-i="${i}" title="${t.title}">${t.icon}</button>`).join('');
    bar.querySelectorAll('.tb-btn').forEach(btn => {
      btn.onclick = () => { tools[+btn.dataset.i].cmd(); save(); };
    });
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

  async insertImage(editor, dataUrl) {
    const url = await Api.upload(dataUrl);
    editor.focus();
    const okIns = document.execCommand('insertHTML', false, `<img src="${url}">`);
    if (!okIns) editor.insertAdjacentHTML('beforeend', `<img src="${url}">`);
    Ktx.renderMath(editor);
    Store.save();
    UI.toast('图片已上传插入');
  },

  pickImage(editor, save) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      if (!input.files[0]) return;
      const dataUrl = await U.compressDataURL(await U.readFileDataURL(input.files[0]));
      this.insertImage(editor, dataUrl);
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
