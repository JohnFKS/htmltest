// 笔记工作台：HTML 原生富文档编辑器
window.Views = window.Views || {};
Views.notes = {
  currentId: null,

  // 悬浮色板与右键格式菜单共用同一套色板
  hlColors: [
    { c: '#fff2a8', n: '浅黄' }, { c: '#ffe599', n: '杏黄' }, { c: '#ffd6a5', n: '浅橙' },
    { c: '#ffc9c9', n: '浅红' }, { c: '#ffd9e6', n: '浅粉' }, { c: '#e7dcff', n: '浅紫' },
    { c: '#d7eaff', n: '浅蓝' }, { c: '#c8f0e8', n: '浅青' }, { c: '#d7f5e3', n: '浅绿' },
    { c: '#e8f4c7', n: '浅草绿' }, { c: '#eceae4', n: '浅灰' }, { c: '#f5e6d3', n: '米色' },
    { c: '#b8e0ff', n: '天蓝' }, { c: '#ffb3b3', n: '珊瑚红' }, { c: '#c9b6ff', n: '薰衣草' },
    { c: 'transparent', n: '清除高亮' },
  ],
  fgColors: [
    { c: '#26231d', n: '墨色' }, { c: '#5c564a', n: '深灰' }, { c: '#8d8677', n: '灰' },
    { c: '#bc4b2a', n: '朱红' }, { c: '#d9480f', n: '橘红' }, { c: '#e03131', n: '红' },
    { c: '#b98a2f', n: '金' }, { c: '#e67700', n: '橙' }, { c: '#2d6a4f', n: '墨绿' },
    { c: '#2b8a3e', n: '绿' }, { c: '#087f5b', n: '青绿' }, { c: '#3457d5', n: '蓝' },
    { c: '#1c7ed6', n: '天蓝' }, { c: '#6741d9', n: '紫' }, { c: '#9c36b5', n: '品红' },
    { c: '#495057', n: '石板灰' },
  ],

  // 供工具栏、右键格式菜单与格式刷共用的富文本格式能力
  format: {
    painter: { armed: false, data: null, source: null },

    // 复用给题库管理编辑器：buildToolbar 会注册当前编辑区；没有注册时回退到笔记编辑区
    editorEl() { return this._editor || document.getElementById('editor-area'); },
    setEditor(el) { this._editor = el || null; this.syncPaletteButtons(); },

    currentRange() {
      const sel = window.getSelection();
      const ed = this.editorEl();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !ed) return null;
      const range = sel.getRangeAt(0);
      return ed.contains(range.startContainer) && ed.contains(range.endContainer) ? range : null;
    },

    restore(range) {
      const ed = this.editorEl();
      if (!range || !ed || !ed.contains(range.startContainer)) return false;
      ed.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    },

    after() {
      Views.notes._afterEdit?.();
      Views.notes._toc?.refresh?.();
      Ktx.renderMath(this.editorEl());
    },

    exec(range, cmd, val) {
      if (!this.restore(range)) return false;
      try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* 老浏览器忽略 */ }
      document.execCommand(cmd, false, val);
      this.after();
      return true;
    },

    COLOR_KEY: kind => `note.color.recent.${kind}`,

    toHex(color) {
      const s = String(color || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
      const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (!m) return '';
      return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
    },

    recentColors(kind) {
      try {
        const arr = JSON.parse(localStorage.getItem(this.COLOR_KEY(kind)) || '[]');
        return Array.isArray(arr) ? arr.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8) : [];
      } catch (e) { return []; }
    },

    lastColor(kind) {
      return this.recentColors(kind)[0] || (kind === 'hl' ? '#fff2a8' : '#bc4b2a');
    },

    rememberColor(kind, color) {
      const hex = this.toHex(color);
      if (!hex) return;
      const list = [hex, ...this.recentColors(kind).filter(c => c !== hex)].slice(0, 8);
      try { localStorage.setItem(this.COLOR_KEY(kind), JSON.stringify(list)); } catch (e) { /* 隐私模式忽略 */ }
      this.syncPaletteButtons();
    },

    syncPaletteButtons() {
      for (const kind of ['hl', 'fg']) {
        const color = this.lastColor(kind);
        const label = kind === 'hl' ? '高亮' : '文字颜色';
        document.querySelectorAll(`.tb-palette-btn[data-palette="${kind}"]`).forEach(btn => {
          btn.style.setProperty('--last', color);
          btn.title = `${label}小刷子：左键应用上次颜色 ${color}，右键更换颜色`;
          btn.setAttribute('aria-label', btn.title);
        });
      }
    },

    applyLastColor(kind, range) {
      const target = range || this.currentRange();
      if (!target) return UI.toast('请先选中要设置的文字', 'warn');
      return kind === 'hl' ? this.highlight(target, this.lastColor(kind)) : this.color(target, this.lastColor(kind));
    },

    color(range, value) {
      const ok = this.exec(range, 'foreColor', value);
      if (ok) this.rememberColor('fg', value);
      return ok;
    },
    highlight(range, value) {
      const ok = this.exec(range, 'hiliteColor', value || 'transparent');
      if (ok && value !== 'transparent') this.rememberColor('hl', value);
      return ok;
    },
    block(range, tag) { return this.exec(range, 'formatBlock', tag); },

    fontSize(range, px) {
      const size = U.clamp(Number(px) || 16, 10, 48);
      if (!this.restore(range)) return false;
      const span = document.createElement('span');
      span.style.fontSize = size + 'px';
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
        const sel = window.getSelection();
        const next = document.createRange();
        next.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(next);
        this.after();
        return true;
      } catch (e) {
        UI.toast('设置字号失败', 'warn');
        return false;
      }
    },

    capture(range) {
      if (!range) return null;
      let node = range.startContainer;
      if (node.nodeType === Node.ELEMENT_NODE) {
        // 选区起点可能是 <p>，真正的颜色在某层 <span>/<mark> 上；向下找第一个落在选区内的文本节点
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let first = walker.nextNode();
        while (first && !range.intersectsNode(first)) first = walker.nextNode();
        node = first?.parentElement || node.firstElementChild || node;
      } else {
        node = node.parentElement || node;
      }
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
      const cs = window.getComputedStyle(node);
      const bg = cs.backgroundColor || '';
      return {
        color: cs.color || '',
        bg: /^(rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent)$/i.test(bg) ? '' : bg,
        bold: Number(cs.fontWeight) >= 600,
        italic: /italic|oblique/i.test(cs.fontStyle || ''),
        underline: /underline/.test(cs.textDecorationLine || ''),
        strike: /line-through/.test(cs.textDecorationLine || ''),
      };
    },

    sameRange(a, b) {
      return !!a && !!b
        && a.startContainer === b.startContainer && a.startOffset === b.startOffset
        && a.endContainer === b.endContainer && a.endOffset === b.endOffset;
    },

    syncPainterButton() {
      document.querySelector('#editor-toolbar .tb-format-painter')?.classList.toggle('on', this.painter.armed);
    },

    disarm() {
      this.painter.armed = false;
      this.painter.data = null;
      this.painter.source = null;
      this.syncPainterButton();
    },

    capturePainter(range) {
      const data = this.capture(range);
      if (!data) return false;
      this.painter.armed = true;
      this.painter.data = data;
      this.painter.source = range.cloneRange();
      this.syncPainterButton();
      UI.toast('已复制格式：选中目标文字即可刷上，再点格式刷取消', 'success');
      return true;
    },

    applyPainter(range) {
      const data = this.painter.data;
      if (!data || !this.restore(range)) return false;
      const run = (cmd, val) => { this.restore(range); document.execCommand(cmd, false, val); };
      try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* 忽略 */ }
      if (data.color) { run('foreColor', data.color); this.rememberColor('fg', data.color); }
      if (data.bg) { run('hiliteColor', data.bg); this.rememberColor('hl', data.bg); }
      else run('hiliteColor', 'transparent');
      for (const [cmd, on] of [['bold', data.bold], ['italic', data.italic], ['underline', data.underline], ['strikeThrough', data.strike]]) {
        let state = false;
        try { state = document.queryCommandState(cmd); } catch (e) { /* 忽略 */ }
        if (state !== on) run(cmd, null);
      }
      this.disarm();
      this.after();
      UI.toast('格式已刷到选中文字', 'success');
      return true;
    },

    togglePainter(range) {
      if (this.painter.armed) {
        if (range && !this.sameRange(range, this.painter.source)) this.applyPainter(range);
        else { this.disarm(); UI.toast('已取消格式刷'); }
        return;
      }
      if (!range || range.collapsed) return UI.toast('请先选中带有格式的文字', 'warn');
      this.capturePainter(range);
    },

    runMenuAction(act, range, value) {
      if (!range) return UI.toast('请先选中文字', 'warn');
      const cmds = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough' };
      if (cmds[act]) return this.exec(range, cmds[act]);
      if (act === 'color') return this.color(range, value);
      if (act === 'highlight') return this.highlight(range, value);
      if (act === 'block') return this.block(range, value);
      if (act === 'size') return this.fontSize(range, value);
      if (act === 'painter') return this.togglePainter(range);
      return false;
    },

    menuHtml() {
      const swatches = (list, act) => list.slice(0, 8).map(x =>
        `<button type="button" class="ctx-swatch" data-fmt="${act}" data-value="${x.c}" title="${U.esc(x.n)}" style="--sw:${x.c === 'transparent' ? '#fff' : x.c}"></button>`).join('');
      return `<div class="ctx-format">
        <div class="ctx-format-title">常用格式</div>
        <div class="ctx-row">
          <button type="button" data-fmt="bold" title="加粗"><b>B</b></button>
          <button type="button" data-fmt="italic" title="斜体"><i>I</i></button>
          <button type="button" data-fmt="underline" title="下划线"><u>U</u></button>
          <button type="button" data-fmt="strike" title="删除线"><s>S</s></button>
          <button type="button" data-fmt="painter" title="复制格式后刷到其他文字">${Icon.svg('formatPainter', 14)} 格式刷</button>
        </div>
        <div class="ctx-format-title">字体颜色</div>
        <div class="ctx-row ctx-swatches">${swatches(Views.notes.fgColors, 'color')}<label class="ctx-color-label" title="自定义字体颜色"><input type="color" data-fmt-custom="color" value="#bc4b2a"><span>自定义</span></label></div>
        <div class="ctx-format-title">高亮颜色</div>
        <div class="ctx-row ctx-swatches">${swatches(Views.notes.hlColors.slice(0, 8), 'highlight')}<button type="button" class="ctx-swatch ctx-clear" data-fmt="highlight" data-value="transparent" title="清除高亮"></button></div>
        <div class="ctx-format-title">标题级别 / 字号</div>
        <div class="ctx-row">${['h1', 'h2', 'h3', 'p'].map(t => `<button type="button" data-fmt="block" data-value="${t}" title="${t === 'p' ? '正文' : '标题 ' + t[1]}">${t.toUpperCase()}</button>`).join('')}</div>
        <div class="ctx-row">${[12, 14, 16, 18, 24].map(n => `<button type="button" data-fmt="size" data-value="${n}" title="字号 ${n}px">${n}px</button>`).join('')}</div>
      </div><div class="ctx-sep"></div>`;
    },
  },

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
                <button class="btn btn-ghost btn-sm" id="note-pin" title="置顶当前笔记（置顶笔记排在列表最前）">${Icon.svg('pin', 14)} <span>置顶</span></button>
                <button class="btn btn-ghost btn-sm" id="note-go-top" title="回到笔记开头">${Icon.svg('arrowUp', 14)} 开头</button>
                <button class="btn btn-ghost btn-sm" id="note-go-last" title="回到上次阅读位置">${Icon.svg('bookmark', 14)} 上次位置</button>
                <span class="note-head-sep"></span>
                <button class="btn btn-primary btn-sm" id="note-save" title="保存为一个版本（Ctrl+S）">${Icon.svg('save', 14)} 保存</button>
                <button class="btn btn-ghost btn-sm" id="note-history" title="查看/恢复历史版本，永久保存或删除">${Icon.svg('history', 14)} 历史</button>
                <button class="btn btn-ghost btn-sm" id="note-autosave" title="设置自动保存间隔与版本保留数量">${Icon.svg('settings', 14)} 保存设置</button>
                <span class="note-head-sep"></span>
                <button class="btn btn-ghost btn-sm" id="note-md-import" title="把 Markdown 文本转换为富文本块追加到笔记">MD 粘贴转换</button>
                <button class="btn btn-ghost btn-sm" id="note-import-md" title="导入 .md / .markdown / .txt 文件，自动生成一篇新笔记">${Icon.svg('file', 14)} 导入 MD</button>
                <button class="btn btn-ghost btn-sm" id="note-import-html" title="导入 .html / .htm 文件，安全解析为可编辑的富文本笔记">${Icon.svg('file', 14)} 导入 HTML</button>
                <button class="btn btn-ghost btn-sm" id="note-import-pdf" title="导入 PDF 教材：AI 按页整理成结构化学习笔记，可同时生成题库">${Icon.svg('book', 14)} 导入 PDF</button>
                <button class="btn btn-ghost btn-sm" id="note-insert-annot" title="插入截图批注产物">插入批注图</button>
                <button class="btn btn-ghost btn-sm" id="note-chat-open" title="打开右侧笔记助教：多轮提问与历史对话">${Icon.svg('message', 14)} 笔记助教</button>
                <button class="btn btn-ghost btn-sm" id="note-toc-toggle" title="显示/隐藏悬浮目录（自动提取 H1-H3 标题）">${Icon.svg('list', 14)} 目录</button>
                <button class="btn btn-ghost btn-sm" id="note-export-md" title="导出为 Markdown 文件（.md，可再次导入）">${Icon.svg('download', 14)} 导出 MD</button>
                <button class="btn btn-ghost btn-sm" id="note-export" title="导出为独立 HTML 文件">${Icon.svg('download', 14)} 导出 HTML</button>
              </div>
            </div>
            <div class="editor-toolbar" id="editor-toolbar"></div>
          </div>
          <div class="note-editor-body" id="note-editor-body">
            <div class="note-scroll-progress" id="note-scroll-progress"></div>
            <div class="editor-area rich" id="editor-area" contenteditable="true" data-ph="开始书写…支持表格、折叠块、公式 $E=mc^2$、代码块，可直接 Ctrl+V 粘贴图片或 Markdown"></div>
            <aside class="note-toc" id="note-toc" aria-label="笔记目录">
              <div class="note-toc-head">
                <span class="note-toc-title">目录 <em id="note-toc-count">0</em></span>
                <button type="button" class="note-toc-ai-btn" id="note-toc-ai-btn" title="打开/关闭 AI 笔记助教侧边栏" aria-label="打开/关闭 AI 笔记助教侧边栏">${Icon.svg('message', 15)}</button>
                <button type="button" class="note-toc-fold-btn" id="note-toc-fold-btn" title="折叠目录" aria-label="折叠目录">${Icon.svg('details', 15)}</button>
              </div>
              <div class="note-toc-body">
                <div class="note-toc-list" id="note-toc-list"></div>
                <div class="note-key-section" id="note-key-section" hidden>
                  <div class="note-toc-label">重点模块 <em id="note-key-count">0</em></div>
                  <div class="note-key-list" id="note-key-list"></div>
                </div>
                <div class="note-toc-foot">
                  <button type="button" data-act="top" title="回到笔记开头">回到开头</button>
                  <button type="button" data-act="last" title="回到上次阅读位置">上次位置</button>
                  <button type="button" data-act="fold" title="展开/收起全部折叠块">展开折叠</button>
                  <button type="button" data-act="copy" title="复制章节大纲">复制大纲</button>
                </div>
              </div>
            </aside>
            <button type="button" class="note-read-chip" id="note-read-chip" title="点击回到上次阅读位置" hidden></button>
          </div>
          <div class="muted" style="margin-top:8px" id="note-status"></div>
        </div>
      </div>`;

    this._panes = Panes.bind(container.querySelector('.notes-layout'), { key: 'notes', initial: 260, min: 200, max: 420 });

    const listEl = container.querySelector('#note-list');
    const searchEl = container.querySelector('#note-search');
    const editor = container.querySelector('#editor-area');
    const titleInput = container.querySelector('#note-title');
    this._search = '';
    const initialNote = [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))[0];
    this.currentId = this.currentId && Store.find('notes', this.currentId) ? this.currentId : (initialNote?.id || null);

    // ---------- 悬浮目录：自动提取 H1-H3，滚动高亮，点击跳转，折叠状态本地记忆 ----------
    const tocEl = container.querySelector('#note-toc');
    const tocListEl = container.querySelector('#note-toc-list');
    const tocCountEl = container.querySelector('#note-toc-count');
    const tocToggleBtn = container.querySelector('#note-toc-toggle');
    const foldBtn = tocEl.querySelector('[data-act="fold"]');
    const progressEl = container.querySelector('#note-scroll-progress');
    const keySectionEl = container.querySelector('#note-key-section');
    const keyListEl = container.querySelector('#note-key-list');
    const keyCountEl = container.querySelector('#note-key-count');
    const readChipEl = container.querySelector('#note-read-chip');
    const TOC_KEY = 'note.toc.collapsed';
    const READ_KEY = id => `note.readpos.${id}`;
    const getReadPos = id => {
      try { return Math.max(0, Number(localStorage.getItem(READ_KEY(id))) || 0); }
      catch (e) { return 0; }
    };
    const setReadPos = (id, top) => {
      if (!id) return;
      try { localStorage.setItem(READ_KEY(id), String(Math.max(0, Math.round(top)))); }
      catch (e) { /* 隐私模式忽略 */ }
    };
    const read = { top: 0, locked: false };
    let tocTargets = [], tocActive = -1, keyTargets = [], keyActive = -1, tocCollapsed = false;
    try { tocCollapsed = localStorage.getItem(TOC_KEY) === '1'; } catch (e) { /* 隐私模式忽略 */ }

    const persistScroll = U.debounce(top => {
      if (this.currentId && !read.locked) setReadPos(this.currentId, top);
    }, 400);
    const jumpTo = (top, msg) => {
      read.locked = true;
      editor.scrollTo({ top: Math.max(0, Number(top) || 0), behavior: 'smooth' });
      UI.toast(msg);
      setTimeout(() => { read.locked = false; }, 900);
    };
    const goLast = () => {
      const top = getReadPos(this.currentId);
      if (!top) return UI.toast('这篇笔记还没有记录阅读位置', 'warn');
      jumpTo(top, '已回到上次阅读位置');
    };
    const setKeyActive = i => {
      if (i === keyActive) return;
      keyListEl.querySelectorAll('.note-key-item').forEach((el, j) => el.classList.toggle('active', j === i));
      keyActive = i;
    };
    const updateKeyActive = () => {
      if (!keyTargets.length) return setKeyActive(-1);
      const line = editor.getBoundingClientRect().top + 48;
      let idx = -1;
      keyTargets.forEach((el, i) => { if (el.getBoundingClientRect().top <= line) idx = i; });
      setKeyActive(idx);
    };
    const updateReadChip = () => {
      if (!readChipEl) return;
      readChipEl.hidden = !this.currentId;
      if (!this.currentId) return;
      const range = editor.scrollHeight - editor.clientHeight;
      const pct = range > 0 ? Math.round(U.clamp(editor.scrollTop / range, 0, 1) * 100) : 100;
      const line = editor.getBoundingClientRect().top + 48;
      const current = [...tocTargets].reverse().find(h => h.getBoundingClientRect().top <= line);
      const full = current ? ((current.textContent || '').trim() || '未命名标题') : '开头';
      const label = full.length > 10 ? full.slice(0, 10) + '…' : full;
      readChipEl.innerHTML = `${Icon.svg('bookmark', 12)} ${pct}% · ${U.esc(label)}`;
    };
    readChipEl.onclick = goLast;

    const setTocActive = i => {
      if (i === tocActive) return;
      tocListEl.querySelectorAll('.note-toc-item').forEach((el, j) => el.classList.toggle('active', j === i));
      tocActive = i;
      tocListEl.querySelector('.note-toc-item.active')?.scrollIntoView({ block: 'nearest' });
    };
    const updateTocActive = () => {
      if (!tocTargets.length) return setTocActive(-1);
      // 滚到底部时最后一个标题可能仍差几十像素才越过判定线，直接视为当前章节
      if (editor.scrollTop + editor.clientHeight >= editor.scrollHeight - 2) return setTocActive(tocTargets.length - 1);
      const top = editor.getBoundingClientRect().top + 48;
      let idx = 0;
      tocTargets.forEach((h, i) => { if (h.getBoundingClientRect().top <= top) idx = i; });
      setTocActive(idx);
    };
    const updateProgress = () => {
      const range = editor.scrollHeight - editor.clientHeight;
      progressEl.style.width = (range > 0 ? U.clamp(editor.scrollTop / range, 0, 1) * 100 : 0).toFixed(1) + '%';
    };
    const refreshToc = () => {
      tocTargets = [...editor.querySelectorAll('h1, h2, h3')].filter(h => !h.closest('.ai-annotation'));
      tocActive = -1;
      tocCountEl.textContent = String(tocTargets.length);
      tocListEl.innerHTML = tocTargets.length ? tocTargets.map((h, i) => {
        const text = (h.textContent || '').trim() || '未命名标题';
        return `<button type="button" class="note-toc-item lv${h.tagName[1]}" data-i="${i}" title="${U.esc(text)}"><span>${U.esc(text)}</span></button>`;
      }).join('') : '<div class="note-toc-empty">暂无标题<br>用工具栏 H1 / H2 / H3 添加</div>';
      tocListEl.querySelectorAll('.note-toc-item').forEach(btn => {
        btn.onclick = () => {
          const i = +btn.dataset.i, target = tocTargets[i];
          if (!target) return;
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setTocActive(i);
          target.classList.add('toc-flash');
          setTimeout(() => target.classList.remove('toc-flash'), 1100);
        };
      });
      keyTargets = [...editor.children].filter(el =>
        el.nodeType === Node.ELEMENT_NODE && /(^|\s)imp-[123](\s|$)/.test(el.className || ''));
      keyActive = -1;
      keyCountEl.textContent = String(keyTargets.length);
      keySectionEl.hidden = !keyTargets.length;
      keyListEl.innerHTML = keyTargets.map((el, i) => {
        const level = (el.classList.contains('imp-3') ? '3' : el.classList.contains('imp-2') ? '2' : '1');
        const full = ((el.textContent || '').trim() || '未命名模块').replace(/\s+/g, ' ');
        const label = full.length > 18 ? full.slice(0, 18) + '…' : full;
        return `<button type="button" class="note-key-item" data-i="${i}" title="${U.esc(full)}"><span class="note-key-badge k${level}">${level}</span><span>${U.esc(label)}</span></button>`;
      }).join('');
      keyListEl.querySelectorAll('.note-key-item').forEach(btn => {
        btn.onclick = () => {
          const i = +btn.dataset.i, target = keyTargets[i];
          if (!target) return;
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setKeyActive(i);
          target.classList.add('toc-flash');
          setTimeout(() => target.classList.remove('toc-flash'), 1100);
        };
      });
      const blocks = [...editor.querySelectorAll('details')];
      foldBtn.textContent = blocks.length && blocks.every(d => d.open) ? '收起折叠' : '展开折叠';
      updateTocActive();
      updateKeyActive();
      updateProgress();
      updateReadChip();
    };
    const setTocCollapsed = collapsed => {
      tocCollapsed = collapsed;
      tocEl.classList.toggle('collapsed', collapsed);
      tocToggleBtn.classList.toggle('on', !collapsed);
      foldBtn.title = collapsed ? '展开目录' : '折叠目录';
      try { localStorage.setItem(TOC_KEY, collapsed ? '1' : '0'); } catch (e) { /* 忽略 */ }
      if (!collapsed) refreshToc();
    };
    tocToggleBtn.onclick = () => setTocCollapsed(!tocCollapsed);
    tocEl.querySelector('#note-toc-fold-btn').onclick = () => setTocCollapsed(!tocCollapsed);
    tocEl.querySelector('#note-toc-ai-btn').onclick = e => {
      e.stopPropagation();
      if (window.NoteChat) NoteChat.toggle();
      else UI.toast('对话栏尚未就绪，请刷新页面', 'error');
    };
    tocEl.querySelectorAll('.note-toc-foot button').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.act === 'top') { jumpTo(0, '已回到笔记开头'); return; }
        if (btn.dataset.act === 'last') { goLast(); return; }
        if (btn.dataset.act === 'fold') {
          const blocks = [...editor.querySelectorAll('details')];
          const open = blocks.some(d => !d.open);
          blocks.forEach(d => { d.open = open; });
          btn.textContent = open ? '收起折叠' : '展开折叠';
          afterEdit();
          return;
        }
        if (btn.dataset.act === 'copy') {
          const text = tocTargets.map(h => `${'  '.repeat(U.clamp(+h.tagName[1] - 1, 0, 2))}${(h.textContent || '').trim()}`).join('\n');
          if (!text) return UI.toast('当前笔记没有标题', 'warn');
          try { Promise.resolve(U.copyText(text)).then(() => UI.toast('大纲已复制', 'success')); }
          catch (e) { UI.toast('复制失败', 'warn'); }
        }
      };
    });
    container.querySelector('#note-go-top').onclick = () => jumpTo(0, '已回到笔记开头');
    container.querySelector('#note-go-last').onclick = goLast;
    editor.addEventListener('scroll', () => {
      updateTocActive(); updateKeyActive(); updateProgress(); updateReadChip();
      read.top = editor.scrollTop;
      persistScroll(read.top);
    });
    const tocObserver = new MutationObserver(U.debounce(refreshToc, 200));
    tocObserver.observe(editor, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    setTocCollapsed(tocCollapsed);
    this._toc = { refresh: refreshToc, update: updateProgress, chip: updateReadChip };

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

    const pinBtn = container.querySelector('#note-pin');
    const syncPinBtn = () => {
      const n = this.currentId ? Store.find('notes', this.currentId) : null;
      const on = !!n?.pinned;
      pinBtn.classList.toggle('on', on);
      pinBtn.querySelector('span').textContent = on ? '取消置顶' : '置顶';
      pinBtn.title = on ? '取消置顶当前笔记' : '置顶当前笔记（排在列表最前）';
    };
    const togglePin = id => {
      const n = Store.find('notes', id);
      if (!n) return;
      Store.update('notes', id, { pinned: !n.pinned });
      UI.toast(n.pinned ? '已取消置顶' : '已置顶笔记', 'success');
      syncPinBtn();
      renderList();
    };
    pinBtn.onclick = () => {
      if (this.currentId) togglePin(this.currentId);
      else UI.toast('请先选择一篇笔记', 'warn');
    };

    const renderList = () => {
      let notes2 = Store.coll('notes');
      if (!notes2.length) { listEl.innerHTML = UI.emptyState('还没有笔记，点上方「新建笔记」'); return; }
      // 本地全文搜索：标题 + 正文纯文本（大小写不敏感），结果按相关度粗排（标题命中优先）；置顶永远在前
      const pinFirst = arr => arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      const q = this._search.trim().toLowerCase();
      if (q) {
        const hit = n => (n.title || '').toLowerCase().includes(q) || U.stripHtml(n.content || '').toLowerCase().includes(q);
        notes2 = pinFirst(notes2.filter(hit).sort((a, b) =>
          (b.title || '').toLowerCase().includes(q) - (a.title || '').toLowerCase().includes(q)));
      } else {
        notes2 = pinFirst([...notes2]);
      }
      if (!notes2.length) { listEl.innerHTML = UI.emptyState(`没有匹配「${this._search}」的笔记`); return; }
      listEl.innerHTML = notes2.map(n => `
        <div class="note-item ${n.id === this.currentId ? 'active' : ''} ${n.pinned ? 'is-pinned' : ''}" data-id="${n.id}">
          <div class="note-item-title">${n.pinned ? `<span class="note-pin-mark" title="已置顶">${Icon.svg('pin', 12)}</span>` : ''}${this._highlight(n.title || '无标题', q)}</div>
          <div class="note-item-sub">${U.fmt(n.updatedAt || n.createdAt)}</div>
          <button class="note-pin${n.pinned ? ' on' : ''}" data-pin="${n.id}" title="${n.pinned ? '取消置顶这篇笔记' : '置顶这篇笔记'}">${Icon.svg('pin', 13)}</button>
          <button class="note-del" data-del="${n.id}" title="删除这篇笔记">删除</button>
        </div>`).join('');
      listEl.querySelectorAll('.note-item').forEach(el => el.onclick = () => this.open(el.dataset.id, editor, titleInput));
      listEl.querySelectorAll('[data-pin]').forEach(btn => btn.onclick = e => {
        e.stopPropagation();
        togglePin(btn.dataset.pin);
      });
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
      const prevId = this.currentId;
      if (prevId && prevId !== id) setReadPos(prevId, edEl.scrollTop);
      this.currentId = id;
      dirty = false;
      lastEditAt = 0;
      lastVersionAt = versionsOf(id)[0]?.createdAt || null;
      const n = Store.find('notes', id);
      if (!n) return;
      edEl.innerHTML = n.content || '';
      tEl.value = n.title || '';
      const stored = getReadPos(id);
      edEl.scrollTop = stored;
      read.top = stored;
      refreshToc();
      // 切换笔记时清空撤销历史，同步基线快照
      undoStack.length = 0; redoStack.length = 0; lastSnap = takeSnap();
      syncPinBtn();
      this.updateStatus();
      renderList();
      window.NoteChat?.onNoteChange?.(id);
      requestAnimationFrame(() => {
        edEl.scrollTop = stored;
        updateTocActive(); updateKeyActive(); updateProgress(); updateReadChip();
        if (stored > 0 && prevId !== id) UI.toast('已恢复到上次阅读位置');
      });
    };

    // ---------- 新建 ----------
    container.querySelector('#note-new').onclick = () => {
      const n = Store.insert('notes', { id: U.uid('note'), title: '未命名笔记', content: '<p></p>', pinned: false, createdAt: U.now(), updatedAt: U.now() });
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
      if (item) {
        const mark = item.querySelector('.note-pin-mark')?.outerHTML || '';
        item.innerHTML = mark + U.esc(titleInput.value.trim() || '未标题');
      }
    };
    const debouncedSave = U.debounce(saveDraft, 600);
    const afterEdit = () => { markDirty(); debouncedSave(); };
    this._afterEdit = afterEdit;

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
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = async () => {
        const f = input.files[0];
        input.remove();
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

    // ---------- 导入 HTML 文件生成新笔记（去脚本/样式，保留可编辑富文本） ----------
    container.querySelector('#note-import-html').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.html,.htm,text/html';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = async () => {
        const f = input.files[0];
        input.remove();
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) return UI.toast('文件超过 8MB 限制', 'warn');
        const text = await f.text();
        let parsed;
        try { parsed = MD.importHtml(text); }
        catch (e) { return UI.toast(`HTML 解析失败：${e.message}`, 'error'); }
        if (!U.stripHtml(parsed.html)) return UI.toast('文件内容为空或无法解析', 'warn');
        const title = parsed.title || f.name.replace(/\.html?$/i, '') || '导入的 HTML';
        const n = Store.insert('notes', {
          id: U.uid('note'), title, content: parsed.html, pinned: false,
          createdAt: U.now(), updatedAt: U.now(),
        });
        this.currentId = n.id;
        this.open(n.id, editor, titleInput);
        Ktx.renderMath(editor);
        UI.toast(`已导入 HTML「${title.slice(0, 20)}」，脚本/样式已过滤，格式可继续编辑`, 'success');
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
      tocObserver.disconnect();
      toolbarCleanup?.();
    };

    // ---------- 右侧笔记助教 ----------
    container.querySelector('#note-chat-open').onclick = () => {
      if (window.NoteChat) NoteChat.toggle();
      else UI.toast('对话栏尚未就绪，请刷新页面', 'error');
    };

    // ---------- 导出 Markdown（公式还原为 $...$，颜色/高亮保留为内联 HTML） ----------
    container.querySelector('#note-export-md').onclick = () => {
      const n = Store.find('notes', this.currentId);
      if (!n) return UI.toast('请先选择笔记', 'warn');
      const md = MD.toMarkdown(n.content || '', n.title || '未命名笔记');
      U.download(`${n.title || '笔记'}.md`, md, 'text/markdown');
      UI.toast('已导出 Markdown 文件', 'success');
    };

    // ---------- 导出独立 HTML（含可折叠目录与章节锚点） ----------
    container.querySelector('#note-export').onclick = () => {
      const n = Store.find('notes', this.currentId);
      if (!n) return UI.toast('请先选择笔记', 'warn');
      const safe = Sanitize.html(n.content);
      const entries = this.outlineFromHtml(safe);
      const anchored = this.withOutlineIds(safe);
      const tocHtml = entries.length
        ? `<details class="export-toc" open><summary>目录（${entries.length}）</summary><nav>${this.outlineNavHtml(entries)}</nav></details>`
        : '';
      const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${U.esc(n.title)}</title>
<style>html{scroll-behavior:smooth}body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;line-height:1.7;color:#26231d}
h1{border-bottom:2px solid #e6e1d3;padding-bottom:8px}h1,h2,h3{scroll-margin-top:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 12px}
blockquote{border-left:3px solid #ccc;margin:10px 0;padding:8px 16px;color:#555;background:#f9f8f4}pre{background:#2a2721;color:#eee;padding:12px 16px;border-radius:8px;overflow-x:auto}
code{font-family:Consolas,monospace;background:#f4f2ec;padding:1px 5px;border-radius:4px}pre code{background:none;padding:0}img{max-width:100%;border-radius:8px}
a{color:#2d6a4f}mark{padding:1px 2px;border-radius:3px}del,s{color:#8d8677}sup,sub{font-size:.78em}
.todo-list{list-style:none;padding-left:6px}.todo-list li{display:flex;align-items:baseline;gap:8px;margin:4px 0}
details{border:1px solid #e6e1d3;border-radius:7px;padding:8px 14px;margin:10px 0}summary{cursor:pointer;font-weight:600}
hr{border:none;border-top:1px solid #e6e1d3;margin:18px 0}
.imp-1{border-left:3px solid #2b8a3e;padding-left:10px;background:rgba(43,138,62,.06);border-radius:0 6px 6px 0}
.imp-2{border-left:3px solid #e67700;padding-left:10px;background:rgba(230,119,0,.07);border-radius:0 6px 6px 0}
.imp-3{border-left:3px solid #d9480f;padding-left:10px;background:rgba(217,72,15,.08);border-radius:0 6px 6px 0}
.export-toc{position:fixed;right:18px;top:18px;z-index:9;width:230px;max-height:70vh;overflow:auto;background:#fffef9;box-shadow:0 6px 28px rgba(38,35,29,.16);padding:8px 12px;font-size:13px}
.export-toc summary{color:#2d6a4f;font-weight:700}.export-toc nav{display:flex;flex-direction:column;margin-top:6px;padding-top:6px;border-top:1px solid #e6e1d3}
.export-toc nav a{display:block;padding:3px 6px;border-radius:5px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#5c564a}
.export-toc nav a:hover{background:#e7f0eb;color:#2d6a4f}.export-toc .toc-lv2{padding-left:16px}.export-toc .toc-lv3{padding-left:28px;font-size:12.5px}
@media(max-width:760px){.export-toc{position:static;width:auto;margin:0 0 18px}}</style></head>
<body>${tocHtml}<h1>${U.esc(n.title)}</h1>${anchored.html}</body></html>`;
      U.download(`${n.title || '笔记'}.html`, html, 'text/html');
    };

    if (this.currentId) this.open(this.currentId, editor, titleInput);
    else if (notes.length === 0) {
      // 首次使用引导笔记
      const welcome = Store.insert('notes', {
        id: U.uid('note'), title: '欢迎使用智学笔记', pinned: false, createdAt: U.now(), updatedAt: U.now(),
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
    const stats = this.wordStats(document.getElementById('editor-area')?.innerHTML ?? n?.content ?? '');
    const countLabel = stats.chars
      ? `${stats.chars} 字${stats.words ? ` / ${stats.words} 词` : ''} · 约 ${stats.minutes} 分钟`
      : '空笔记';
    el.textContent = `${info.dirty ? '● 草稿未存为版本' : '✓ 已保存版本'} · 草稿 ${U.fmt(n?.updatedAt || n?.createdAt)} · ${latestLabel} · ${versions.length} 版 · ${countLabel} · ${cfg.autoSaveSec ? `自动 ${cfg.autoSaveSec}s` : '自动关闭'}`;
  },

  // 纯文本统计：中文按字符、英文按词；阅读速度按 400 字/分钟估算
  wordStats(html = '') {
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
    const chars = text.replace(/\s/g, '').length;
    const words = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    return { chars, words, minutes: chars ? Math.max(1, Math.round(chars / 400)) : 0 };
  },

  // 导出用的纯字符串大纲工具（输入已消毒的 HTML，不写回笔记正文）
  outlineFromHtml(html = '') {
    const entries = [];
    String(html).replace(/<h([123])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi, (m, level, inner) => {
      entries.push({ level: +level, text: (U.stripHtml(inner) || '未命名标题').trim() });
      return m;
    });
    return entries;
  },

  withOutlineIds(html = '') {
    let i = 0;
    return { html: String(html).replace(/<h([123])(?:\s[^>]*)?>/gi, m => m.slice(0, -1) + ` id="sec-${i++}">`), count: i };
  },

  outlineNavHtml(entries) {
    return entries.map((e, i) => `<a class="toc-lv${e.level}" href="#sec-${i}">${U.esc(e.text)}</a>`).join('');
  },

  buildToolbar(bar, editor, save, undoApi = {}) {
    Views.notes.format.setEditor(editor);
    const icon = (name, size = 16) => Icon.svg(name, size);
    const exec = (cmd, val) => { editor.focus(); document.execCommand(cmd, false, val); };
    const insertHTML = html => {
      editor.focus();
      document.execCommand('insertHTML', false, html);
      Ktx.renderMath(editor);
    };
    // 三级重点：给选中（或光标所在）的顶层模块打 class，目录里生成可跳转的重点列表
    const IMP_CLASSES = ['imp-1', 'imp-2', 'imp-3'];
    const topBlockOf = node => {
      if (node === editor) return editor.firstElementChild;
      let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      while (el && el.parentElement !== editor) el = el.parentElement;
      return el && el.parentElement === editor ? el : null;
    };
    const levelOf = el => Number(el?.className.match(/imp-([123])/)?.[1] || 0);
    const markImportance = level => {
      const sel = window.getSelection();
      let blocks = [];
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const start = topBlockOf(range.startContainer), end = topBlockOf(range.endContainer);
        const kids = [...editor.children];
        const si = kids.indexOf(start), ei = kids.indexOf(end);
        if (si >= 0 && ei >= 0) blocks = kids.slice(Math.min(si, ei), Math.max(si, ei) + 1);
      }
      if (!blocks.length) {
        const block = topBlockOf(document.activeElement === editor ? sel?.anchorNode : editor.firstElementChild);
        if (block) blocks = [block];
      }
      if (!blocks.length) return UI.toast('请先选中要标记的模块，或把光标放在模块内', 'warn');
      const current = blocks.length === 1 ? levelOf(blocks[0]) : 0;
      blocks.forEach(el => {
        el.classList.remove(...IMP_CLASSES);
        if (current !== level) el.classList.add(`imp-${level}`);
      });
      this._toc?.refresh?.();
      UI.toast(current === level ? '已取消重点标记' : `已标记为 ${level} 级重点`, 'success');
    };

    const HL_COLORS = Views.notes.hlColors;
    const FG_COLORS = Views.notes.fgColors;

    const tools = [
      { icon: 'undo', title: '撤销 (Ctrl+Z)', cmd: undoApi.undo || (() => {}) },
      { icon: 'redo', title: '重做 (Ctrl+Y)', cmd: undoApi.redo || (() => {}) },
      { sep: true },
      { icon: 'bold', title: '加粗 (Ctrl+B)', cmd: () => exec('bold') },
      { icon: 'italic', title: '斜体 (Ctrl+I)', cmd: () => exec('italic') },
      { icon: 'underline', title: '下划线 (Ctrl+U)', cmd: () => exec('underline') },
      { icon: 'strike', title: '删除线', cmd: () => exec('strikeThrough') },
      { sep: true },
      { icon: 'brushHighlight', title: '高亮小刷子：16 色 + 自定义颜色', palette: 'hl', cls: 'tb-brush-hl' },
      { icon: 'brush', title: '文字颜色小刷子：16 色 + 自定义颜色', palette: 'fg', cls: 'tb-brush-fg' },
      { icon: 'formatPainter', title: '格式刷：复制选中文字的颜色/高亮等格式，再选中目标文字刷上（再点取消）', cmd: () => Views.notes.format.togglePainter(Views.notes.format.currentRange()), cls: 'tb-format-painter' },
      { icon: 'sup', title: '上标', cmd: () => exec('superscript') },
      { icon: 'sub', title: '下标', cmd: () => exec('subscript') },
      { sep: true },
      { icon: 'priority1', title: '把选中模块标为 1 级重点（再次点击取消）', cmd: () => markImportance(1), cls: 'tb-priority p1' },
      { icon: 'priority2', title: '把选中模块标为 2 级重点（再次点击取消）', cmd: () => markImportance(2), cls: 'tb-priority p2' },
      { icon: 'priority3', title: '把选中模块标为 3 级重点（再次点击取消）', cmd: () => markImportance(3), cls: 'tb-priority p3' },
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
      : `<button type="button" class="tb-btn${t.palette ? ' tb-palette-btn' : ''}${t.cls ? ' ' + t.cls : ''}" data-i="${i}"${t.palette ? ` data-palette="${t.palette}"` : ''} title="${t.title}" aria-label="${t.title}">${icon(t.icon)}</button>`
    ).join('') + '<div class="tb-popover" hidden></div>';
    Views.notes.format.syncPaletteButtons();

    const popover = bar.querySelector('.tb-popover');
    const closePop = () => { popover.hidden = true; };
    let paletteRange = null;
    const applyColor = (kind, color) => {
      const target = paletteRange || Views.notes.format.currentRange();
      if (target) {
        if (kind === 'hl') Views.notes.format.highlight(target, color);
        else Views.notes.format.color(target, color);
      } else if (color !== 'transparent') {
        Views.notes.format.rememberColor(kind, color);
        UI.toast('已设为默认颜色', 'success');
      }
      closePop();
      paletteRange = null;
    };
    const swatchHtml = (color, name, cls = '') =>
      `<button type="button" class="tb-swatch${cls}" data-color="${color}" title="${U.esc(name)}" style="--sw:${color === 'transparent' ? '#fff' : color}"></button>`;
    const openPop = (kind, btn, range) => {
      if (!popover.hidden && popover.dataset.kind === kind) { closePop(); paletteRange = null; return; }
      popover.dataset.kind = kind;
      paletteRange = range || Views.notes.format.currentRange();
      const list = kind === 'hl' ? HL_COLORS : FG_COLORS;
      const recent = Views.notes.format.recentColors(kind);
      popover.innerHTML = `<div class="tb-pop-title">${kind === 'hl' ? '高亮' : '文字颜色'}小刷子 · 右键更换颜色</div>`
        + `<div class="tb-swatches">${list.map(x => swatchHtml(x.c, x.n, x.c === 'transparent' ? ' swatch-clear' : '')).join('')}</div>`
        + (recent.length ? `<div class="tb-pop-title tb-pop-sub">最近使用</div><div class="tb-swatches">${recent.map(c => swatchHtml(c, c, ' swatch-recent')).join('')}</div>` : '')
        + `<div class="tb-color-custom"><span>自定义${kind === 'hl' ? '高亮' : '文字'}色</span>`
        + `<input type="color" data-custom value="${Views.notes.format.lastColor(kind)}" title="选择任意颜色">`
        + `<button type="button" data-apply>应用</button></div>`;
      const br = btn.getBoundingClientRect(), pr = bar.getBoundingClientRect();
      popover.style.left = Math.max(0, Math.min(br.left - pr.left, pr.width - 228)) + 'px';
      popover.hidden = false;
      popover.querySelectorAll('[data-color]').forEach(sw => {
        sw.onclick = () => applyColor(kind, sw.dataset.color);
      });
      const custom = popover.querySelector('[data-custom]');
      popover.querySelector('[data-apply]').onclick = () => applyColor(kind, custom.value);
    };

    bar.querySelectorAll('.tb-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const t = tools[+btn.dataset.i];
        if (t.palette) {
          closePop();
          paletteRange = null;
          Views.notes.format.applyLastColor(t.palette, Views.notes.format.currentRange());
          return;
        }
        closePop();
        t.cmd();
        save();
      };
      btn.oncontextmenu = e => {
        const t = tools[+btn.dataset.i];
        if (!t?.palette) return;
        e.preventDefault();
        e.stopPropagation();
        openPop(t.palette, btn, Views.notes.format.currentRange());
      };
    });
    const onDocDown = e => {
      if (!popover.hidden && !popover.contains(e.target) && !e.target.closest?.('.tb-palette-btn')) closePop();
    };
    // 格式刷武装后，下一次在编辑区完成选中即自动刷上（左键拖选 / 键盘 Shift+方向）
    const onPaintSelect = e => {
      const fmt = Views.notes.format;
      if (!fmt.painter.armed || e.button === 2) return;
      setTimeout(() => {
        const range = fmt.currentRange();
        if (range && !fmt.sameRange(range, fmt.painter.source)) fmt.applyPainter(range);
      }, 0);
    };
    document.addEventListener('pointerdown', onDocDown);
    editor.addEventListener('mouseup', onPaintSelect);
    editor.addEventListener('keyup', onPaintSelect);
    return () => {
      document.removeEventListener('pointerdown', onDocDown);
      editor.removeEventListener('mouseup', onPaintSelect);
      editor.removeEventListener('keyup', onPaintSelect);
      if (Views.notes.format.editorEl() === editor) Views.notes.format.setEditor(null);
      Views.notes.format.disarm();
    };
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
