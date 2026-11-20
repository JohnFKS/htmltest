// 截图批注：图层式 Canvas 编辑器
// 工具：画笔/荧光笔/直线/箭头/矩形/椭圆/文字/橡皮/圈选提问；撤销重做；导出 PNG；截取题目；插入笔记
window.Views = window.Views || {};

Views.annotator = {
  currentId: null,
  tool: 'pen', color: '#bc4b2a', width: 4,
  layers: [], history: [], future: [],
  drawing: null, imgEl: null,
  _cleanup: null,

  COLORS: [
    { c: '#bc4b2a', n: '朱红' }, { c: '#26231d', n: '墨黑' }, { c: '#3457d5', n: '蓝' },
    { c: '#1d7a5f', n: '绿' }, { c: '#ffd54a', n: '黄' }, { c: '#ffffff', n: '白' },
  ],
  TOOLS: [
    ['pen', 'pen', '画笔'], ['hl', 'highlight', '荧光'], ['line', 'slash', '直线'], ['arrow', 'arrow', '箭头'],
    ['rect', 'square', '矩形'], ['ellipse', 'circle', '椭圆'], ['text', 'type', '文字'], ['eraser', 'eraser', '擦除'],
    ['ask', 'help', '圈选提问'],
  ],

  async render(container) {
    this._cleanup?.();
    const annots = Store.coll('annots');
    this.currentId = this.currentId && Store.find('annots', this.currentId) ? this.currentId : (annots[0]?.id || null);

    container.innerHTML = `
      <div class="annot-layout">
        <div class="annot-main">
          <div class="annot-stage-wrap" data-pane="main">
            <div class="annot-stage" id="annot-stage">
              <div class="annot-drop" id="annot-drop">
                <div style="font-size:40px">✂️</div>
                <div><b>导入底图开始批注</b></div>
                <div>Ctrl+V 粘贴截图 · 拖拽图片进来 · 或使用下方按钮</div>
                <div style="display:flex;gap:10px;margin-top:6px">
                  <button class="btn btn-primary btn-sm" id="drop-upload">上传图片</button>
                  <button class="btn btn-sm" id="drop-capture">📷 截取题目</button>
                  <button class="btn btn-sm" id="drop-url">图片 URL</button>
                </div>
              </div>
              <div class="annot-canvas-box" id="annot-box" style="display:none">
                <canvas id="annot-base"></canvas>
                <canvas class="annot-overlay" id="annot-overlay"></canvas>
              </div>
            </div>
          </div>
          <div class="annot-side" data-pane="side">
            <div class="card">
              <div class="card-title">工具</div>
              <div class="tool-grid" id="tool-grid"></div>
              <div style="margin-top:10px" class="color-dots" id="color-dots"></div>
              <div class="slider-row" style="margin-top:10px">
                <input type="range" id="width-range" min="2" max="26" value="4">
                <span class="small" id="width-val">4px</span>
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                <button class="btn btn-sm" id="btn-undo" title="撤销">↩ 撤销</button>
                <button class="btn btn-sm" id="btn-redo" title="重做">↪ 重做</button>
                <button class="btn btn-sm" id="btn-clear">清空批注</button>
              </div>
            </div>
            <div class="card">
              <div class="card-title">导出</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" id="btn-export">导出 PNG（落盘）</button>
                <button class="btn btn-sm" id="btn-copyimg">复制图片</button>
              </div>
              <div class="muted" style="margin-top:6px">导出后可到「笔记」页点「插入批注图」</div>
            </div>
            <div class="card">
              <div class="card-title">底图来源</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-sm" id="btn-upload">上传</button>
                <button class="btn btn-sm" id="btn-capture">📷 截取题目</button>
                <button class="btn btn-sm" id="btn-url">URL</button>
              </div>
            </div>
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div class="card-title" style="margin:0">批注文档</div>
                <button class="btn btn-sm btn-primary" id="btn-new-annot">＋ 新建</button>
              </div>
              <div id="annot-list" style="margin-top:10px"></div>
            </div>
          </div>
        </div>
      </div>`;

    this._panes = Panes.bind(container.querySelector('.annot-main'), { key: 'annotator', side: 'right', initial: 300, min: 240, max: 460 });

    // ---------- 元素 ----------
    const stage = container.querySelector('#annot-stage');
    const drop = container.querySelector('#annot-drop');
    const box = container.querySelector('#annot-box');
    const baseC = container.querySelector('#annot-base');
    const overlay = container.querySelector('#annot-overlay');
    const octx = overlay.getContext('2d');

    // ---------- 图层绘制 ----------
    const redraw = () => {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      for (const L of this.layers) this.drawLayer(octx, L);
    };

    this.drawLayer = (ctx, L) => {
      ctx.save();
      ctx.strokeStyle = L.color; ctx.fillStyle = L.color;
      ctx.lineWidth = L.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (L.type === 'hl') { ctx.globalAlpha = 0.35; ctx.lineWidth = L.width * 5; }
      const pts = L.points || [];
      switch (L.type) {
        case 'pen': case 'hl':
          if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, 7); ctx.fill(); }
          else { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.stroke(); }
          break;
        case 'line': {
          if (pts.length >= 2) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts.at(-1)[0], pts.at(-1)[1]); ctx.stroke(); }
          break;
        }
        case 'arrow': {
          if (pts.length >= 2) {
            const [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const head = Math.max(10, L.width * 3);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
            ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
            ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'rect': {
          if (pts.length >= 2) {
            const [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          }
          break;
        }
        case 'ellipse': {
          if (pts.length >= 2) {
            const [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
            ctx.beginPath();
            ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, 7);
            ctx.stroke();
          }
          break;
        }
        case 'text': {
          ctx.globalAlpha = 1;
          ctx.font = `${L.fontSize || 22}px sans-serif`;
          ctx.textBaseline = 'top';
          String(L.text || '').split('\n').forEach((line, i) => ctx.fillText(line, L.x, L.y + i * (L.fontSize || 22) * 1.3));
          break;
        }
        case 'ask': {
          // 圈选提问区域（朱红虚线椭圆）
          ctx.globalAlpha = 1; ctx.setLineDash([8, 6]); ctx.lineWidth = Math.max(3, L.width);
          if (pts.length >= 2) {
            const [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
            ctx.beginPath();
            ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, 7);
            ctx.stroke();
          }
          break;
        }
      }
      ctx.restore();
    };

    // ---------- 历史 ----------
    this.pushHistory = () => { this.history.push(JSON.stringify(this.layers)); this.future = []; this.saveDoc(); };
    container.querySelector('#btn-undo').onclick = () => {
      if (!this.history.length) return;
      this.future.push(JSON.stringify(this.layers));
      this.layers = JSON.parse(this.history.pop());
      redraw(); this.saveDoc();
    };
    container.querySelector('#btn-redo').onclick = () => {
      if (!this.future.length) return;
      this.history.push(JSON.stringify(this.layers));
      this.layers = JSON.parse(this.future.pop());
      redraw(); this.saveDoc();
    };
    container.querySelector('#btn-clear').onclick = async () => {
      if (!this.layers.length) return;
      if (await UI.confirm('清空当前文档的全部批注图层？')) { this.pushHistory(); this.layers = []; redraw(); }
    };

    // ---------- 工具栏 ----------
    const toolGrid = container.querySelector('#tool-grid');
    toolGrid.innerHTML = this.TOOLS.map(([id, icon, name]) =>
      `<button class="tool-btn ${this.tool === id ? 'active' : ''}" data-tool="${id}" title="${name}" aria-label="${name}">${Icon.svg(icon, 17)}</button>`).join('');
    toolGrid.querySelectorAll('.tool-btn').forEach(btn => btn.onclick = () => {
      this.tool = btn.dataset.tool;
      toolGrid.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === this.tool));
      overlay.style.cursor = this.tool === 'eraser' ? 'not-allowed' : 'crosshair';
    });

    const colorDots = container.querySelector('#color-dots');
    colorDots.innerHTML = this.COLORS.map(({ c, n }) =>
      `<div class="color-dot ${this.color === c ? 'active' : ''}" data-c="${c}" title="${n}" style="background:${c};${c === '#ffffff' ? 'border:1px solid var(--line-2)' : ''}"></div>`).join('');
    colorDots.querySelectorAll('.color-dot').forEach(d => d.onclick = () => {
      this.color = d.dataset.c;
      colorDots.querySelectorAll('.color-dot').forEach(x => x.classList.toggle('active', x === d));
    });

    const widthRange = container.querySelector('#width-range');
    widthRange.value = this.width;
    widthRange.oninput = () => { this.width = +widthRange.value; container.querySelector('#width-val').textContent = `${this.width}px`; };

    // ---------- 坐标换算 ----------
    const toCanvasXY = e => {
      const r = overlay.getBoundingClientRect();
      return [Math.round((e.clientX - r.left) * overlay.width / r.width), Math.round((e.clientY - r.top) * overlay.height / r.height)];
    };

    // ---------- 绘制交互 ----------
    overlay.addEventListener('pointerdown', e => {
      if (!this.doc?.imageUrl) return;
      overlay.setPointerCapture(e.pointerId);
      const [x, y] = toCanvasXY(e);
      if (this.tool === 'eraser') { this.eraseAt(x, y); return; }
      if (this.tool === 'text') {
        const text = prompt('输入批注文字（支持换行）：');
        if (text && text.trim()) {
          this.layers.push({ id: U.uid('L'), type: 'text', color: this.color, width: this.width, x, y, text: text.trim(), fontSize: Math.max(16, this.width * 5) });
          this.pushHistory(); redraw();
        }
        return;
      }
      this.drawing = { id: U.uid('L'), type: this.tool === 'ask' ? 'ask' : this.tool, color: this.tool === 'ask' ? '#bc4b2a' : this.color, width: this.width, points: [[x, y]] };
      this.history.push(JSON.stringify(this.layers));
    });
    overlay.addEventListener('pointermove', e => {
      if (!this.drawing) return;
      this.drawing.points.push(toCanvasXY(e));
      redraw();
      this.drawLayer(octx, this.drawing);
    });
    overlay.addEventListener('pointerup', e => {
      if (!this.drawing) return;
      this.drawing.points.push(toCanvasXY(e));
      const pts = this.drawing.points;
      const span = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
      const wasAsk = this.drawing.type === 'ask';
      // 过小的图形（误触）丢弃
      if (span < 4 && !['pen', 'hl'].includes(this.drawing.type)) this.history.pop();
      else this.layers.push(this.drawing);
      this.drawing = null;
      this.future = [];
      redraw(); this.saveDoc();
      if (this.layers.at(-1)?.type === 'ask' && wasAsk) this.circleAsk();
    });

    // ---------- 橡皮 ----------
    this.eraseAt = (x, y) => {
      for (let i = this.layers.length - 1; i >= 0; i--) {
        if (this.hitLayer(this.layers[i], x, y)) {
          this.layers.splice(i, 1);
          this.pushHistory(); redraw();
          return;
        }
      }
    };
    this.hitLayer = (L, x, y) => {
      const pad = 10 + L.width;
      const pts = L.points || [];
      if (L.type === 'text') {
        const w = Math.max(...String(L.text || '').split('\n').map(s => s.length)) * (L.fontSize || 22) * 0.6;
        const h = String(L.text || '').split('\n').length * (L.fontSize || 22) * 1.3;
        return x >= L.x - pad && x <= L.x + w + pad && y >= L.y - pad && y <= L.y + h + pad;
      }
      if (pts.length >= 2 && L.type !== 'pen' && L.type !== 'hl') {
        const [x1, y1] = pts[0], [x2, y2] = pts.at(-1);
        return x >= Math.min(x1, x2) - pad && x <= Math.max(x1, x2) + pad && y >= Math.min(y1, y2) - pad && y <= Math.max(y1, y2) + pad;
      }
      return pts.some(([px, py]) => Math.hypot(px - x, py - y) < pad);
    };

    // ---------- 底图 ----------
    this.setImage = async (dataUrl) => {
      const compressed = await U.compressDataURL(dataUrl, 2000, 0.9);
      const url = compressed.startsWith('data:') ? await Api.upload(compressed) : compressed;
      if (!this.doc) this.newDoc();
      this.doc.imageUrl = url;
      await this.loadImage(url);
      this.saveDoc();
      UI.toast('底图已导入');
    };

    this.loadImage = (url) => new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        this.imgEl = img;
        baseC.width = overlay.width = img.naturalWidth;
        baseC.height = overlay.height = img.naturalHeight;
        const bctx = baseC.getContext('2d');
        bctx.clearRect(0, 0, baseC.width, baseC.height);
        bctx.drawImage(img, 0, 0);
        drop.style.display = 'none';
        box.style.display = 'block';
        redraw();
        resolve();
      };
      img.onerror = () => { UI.toast('图片加载失败', 'error'); resolve(); };
      img.src = url;
    });

    this.newDoc = () => {
      const doc = Store.insert('annots', { id: U.uid('annot'), title: '未命名批注', imageUrl: '', layers: [], asks: [], createdAt: U.now(), updatedAt: U.now() });
      this.currentId = doc.id;
      this.doc = doc;
      return doc;
    };

    this.saveDoc = U.debounce(() => {
      if (!this.doc) return;
      Store.update('annots', this.doc.id, {
        imageUrl: this.doc.imageUrl, layers: this.layers, title: this.doc.title,
      });
      renderAnnotList();
    }, 600);

    // ---------- 导入入口 ----------
    container.querySelector('#btn-upload').onclick = container.querySelector('#drop-upload').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async () => { if (input.files[0]) await this.setImage(await U.readFileDataURL(input.files[0])); };
      input.click();
    };
    container.querySelector('#btn-url').onclick = container.querySelector('#drop-url').onclick = async () => {
      const url = await UI.prompt('输入图片 URL', '', 'https://… 或 /images/…');
      if (url) await this.setImage(url);
    };
    container.querySelector('#btn-capture').onclick = container.querySelector('#drop-capture').onclick = () => this.captureQuestion();

    // 拖拽导入
    stage.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    stage.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    stage.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('dragover');
      const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
      if (f) await this.setImage(await U.readFileDataURL(f));
    });

    // 粘贴导入（全局，视图激活时）
    const onPaste = async e => {
      if (!document.getElementById('annot-stage')) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        await this.setImage(await U.readFileDataURL(item.getAsFile()));
      }
    };
    document.addEventListener('paste', onPaste);

    // ---------- 导出 ----------
    const composite = () => {
      if (!this.imgEl) return null;
      const c = document.createElement('canvas');
      c.width = baseC.width; c.height = baseC.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(this.imgEl, 0, 0);
      for (const L of this.layers) this.drawLayer(ctx, L);
      return c;
    };
    container.querySelector('#btn-export').onclick = async () => {
      const c = composite();
      if (!c) return UI.toast('请先导入底图', 'warn');
      const dataUrl = c.toDataURL('image/png');
      const url = await Api.upload(dataUrl);
      if (this.doc) Store.update('annots', this.doc.id, { exportedUrl: url });
      U.download(`${this.doc?.title || '批注'}.png`, dataUrl, 'image/png');
      UI.toast('已导出并落盘，可在笔记页「插入批注图」');
      renderAnnotList();
    };
    container.querySelector('#btn-copyimg').onclick = async () => {
      const c = composite();
      if (!c) return UI.toast('请先导入底图', 'warn');
      try {
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        UI.toast('已复制到剪贴板，可直接粘贴到笔记或聊天');
      } catch { UI.toast('当前浏览器不支持复制图片，请用导出 PNG', 'warn'); }
    };

    // ---------- 批注文档列表 ----------
    const renderAnnotList = () => {
      const listEl = container.querySelector('#annot-list');
      const docs = Store.coll('annots');
      if (!docs.length) { listEl.innerHTML = '<div class="muted">暂无批注文档</div>'; return; }
      listEl.innerHTML = docs.map(a => `
        <div class="annot-list-item ${a.id === this.currentId ? 'active' : ''}" data-id="${a.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
            <b class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${U.esc(a.title || '未命名')}</b>
            <span class="chip">${a.layers?.length || 0} 层</span>
          </div>
          <div class="muted" style="font-size:11px">${U.fmt(a.updatedAt || a.createdAt)}</div>
        </div>`).join('');
      listEl.querySelectorAll('.annot-list-item').forEach(el => {
        el.onclick = async () => {
          await this.openDoc(el.dataset.id);
          renderAnnotList();
        };
        el.oncontextmenu = async e => {
          e.preventDefault();
          if (await UI.confirm('删除这份批注文档？', { danger: true })) {
            Store.remove('annots', el.dataset.id);
            if (this.currentId === el.dataset.id) { this.currentId = null; this.doc = null; }
            renderAnnotList();
            this.openDoc(Store.coll('annots')[0]?.id);
          }
        };
      });
    };
    container.querySelector('#btn-new-annot').onclick = async () => {
      const title = await UI.prompt('批注标题', '未命名批注');
      this.newDoc();
      if (this.doc && title) this.doc.title = title;
      this.layers = []; this.history = []; this.future = [];
      box.style.display = 'none'; drop.style.display = 'flex';
      renderAnnotList();
    };

    // ---------- 打开文档 ----------
    this.openDoc = async (id) => {
      const doc = Store.find('annots', id);
      this.currentId = id || null;
      this.doc = doc;
      this.layers = doc ? JSON.parse(JSON.stringify(doc.layers || [])) : [];
      this.history = []; this.future = [];
      if (doc?.imageUrl) await this.loadImage(doc.imageUrl);
      else { box.style.display = 'none'; drop.style.display = 'flex'; }
      renderAnnotList();
    };

    // ---------- 圈选提问 ----------
    this.circleAsk = async () => {
      const L = this.layers.at(-1);
      const q = prompt('你想问圈出的这块区域什么问题？');
      if (!q || !q.trim()) { this.layers.pop(); redraw(); this.saveDoc(); return; }
      const c = composite();
      if (!c) { this.layers.pop(); redraw(); return; }
      // 叠加提问图层并高亮
      const ctx = c.getContext('2d');
      this.drawLayer(ctx, { ...L, color: '#bc4b2a', width: Math.max(4, L.width) });
      const dataUrl = c.toDataURL('image/png');
      const url = await Api.upload(dataUrl);
      UI.spinner(true, 'AI 答疑中…');
      let result;
      try { result = await AI.ask(q.trim(), '椭圆区域', dataUrl); }
      catch (e) { UI.spinner(false); UI.toast(e.message, 'error'); return; }
      UI.spinner(false);
      const asks = (this.doc.asks ||= []);
      asks.unshift({ q: q.trim(), shape: '椭圆', imageUrl: url, answer: result.html, demo: result.demo, time: U.now() });
      this.saveDoc();
      UI.modal({
        title: '圈选提问 · 答疑',
      raw: true,
        width: 640,
        body: `<img src="${url}" style="max-width:100%;border-radius:8px;border:1px solid var(--line)">
               <div class="ai-report" style="margin-top:12px">${result.html}</div>`,
        actions: [{ label: '关闭' }],
      });
      Ktx.renderMath(document.querySelector('#modal-root'));
    };

    // ---------- 截取题目（html2canvas） ----------
    this.captureQuestion = () => {
      const banks = Store.coll('banks');
      if (!banks.length) return UI.toast('题库为空，请先在「刷题」页导入', 'warn');
      const m = UI.modal({
        title: '截取题目为底图',
      raw: true,
        width: 760,
        body: `<div style="max-height:60vh;overflow-y:auto">
          ${banks.map(b => `
            <div class="section-title" style="margin:10px 0 6px">${U.esc(b.name)}</div>
            ${b.questions.slice(0, 50).map(q => `
              <div class="pv-question" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                <div class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(q.number ? `${q.number}. ` : '')}${U.esc(U.stripHtml(q.stem).slice(0, 60))}</div>
                <button class="btn btn-sm" data-q="${q.id}" data-bank="${b.id}">截取</button>
              </div>`).join('')}`).join('')}
        </div><div class="muted" style="margin-top:8px">仅显示每库前 50 题；截图为浏览器端渲染，含公式排版。</div>`,
        actions: [{ label: '取消' }],
      });
      m.bodyEl.querySelectorAll('button[data-q]').forEach(btn => {
        btn.onclick = async () => {
          const bank = Store.find('banks', btn.dataset.bank);
          const q = bank.questions.find(x => x.id === btn.dataset.q);
          m.close();
          UI.spinner(true, '正在渲染截图…');
          try {
            const stageEl = document.createElement('div');
            stageEl.style.cssText = 'position:fixed;left:-9999px;top:0;width:720px;background:#fff;padding:28px 32px;font-size:16px;line-height:1.9';
            stageEl.className = 'q-stem-capture rich';
            stageEl.innerHTML = `<div style="color:#8d8677;font-size:12px;margin-bottom:8px">智学笔记 · 题目截图</div>
              <div>${MD.toHtml(`${q.number ? `**${q.number}.** ` : ''}${q.stem}`)}</div>
              ${q.options?.length ? `<div style="margin-top:6px">${q.options.map(o => `<div>${U.esc(o)}</div>`).join('')}</div>` : ''}`;
            document.body.appendChild(stageEl);
            Ktx.renderMath(stageEl);
            await new Promise(r => setTimeout(r, 300)); // 等字体/公式就绪
            const canvas = await html2canvas(stageEl, { scale: 2, backgroundColor: '#ffffff', logging: false });
            stageEl.remove();
            const dataUrl = canvas.toDataURL('image/png');
            await this.setImage(dataUrl);
          } catch (e) {
            UI.toast(`截图失败：${e.message}`, 'error');
          } finally { UI.spinner(false); }
        };
      });
    };

    // ---------- 初始化 ----------
    renderAnnotList();
    if (this.currentId) await this.openDoc(this.currentId);

    this._cleanup = () => {
      document.removeEventListener('paste', onPaste);
      this._cleanup = null;
    };
  },
};
