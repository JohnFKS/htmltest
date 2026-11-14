// 三本：错题本 / 好题本 / 模板本
// 条目 = 题目快照 + 我的作答 + AI 批改 + 本质思路 + 标签；可搜索、按标签筛选；可生成做题模板入库
window.Views = window.Views || {};

Views.books = {
  kind: 'wrong',
  search: '',

  KINDS: [
    ['wrong', '📕 错题本', 'wrong'],
    ['good', '📗 好题本', 'good'],
    ['template', '📘 模板本', 'tpl'],
  ],

  render(container) {
    container.innerHTML = `
      <h1 class="page-title">三本</h1>
      <div class="page-sub">错题本 · 好题本 · 模板本——三本中的题目都可以「生成做题模板」进入模板库</div>
      <div class="book-tabs" id="book-tabs">
        ${this.KINDS.map(([k, label, cls]) => `<button class="book-tab ${k === this.kind ? 'active-' + cls : ''}" data-k="${k}">${label}</button>`).join('')}
      </div>
      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <input class="input" id="book-search" style="max-width:280px" placeholder="搜索题干 / 解析…" value="${U.esc(this.search)}">
        <span class="muted">共 <b id="book-count">0</b> 条</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" id="book-export">导出本本（JSON）</button>
      </div>
      <div id="book-list"></div>`;

    container.querySelectorAll('.book-tab').forEach(btn => btn.onclick = () => {
      this.kind = btn.dataset.k;
      container.querySelectorAll('.book-tab').forEach((b, i) => {
        b.className = `book-tab ${b.dataset.k === this.kind ? 'active-' + this.KINDS[i][2] : ''}`;
      });
      this.renderList(container);
    });
    container.querySelector('#book-search').oninput = U.debounce(e => {
      this.search = e.target.value.trim();
      this.renderList(container);
    }, 300);
    container.querySelector('#book-export').onclick = () => {
      const entries = Store.coll('entries').filter(e => e.kind === this.kind);
      U.download(`${this.kind}-本.json`, JSON.stringify(entries, null, 1));
    };

    this.renderList(container);
  },

  renderList(container) {
    const listEl = container.querySelector('#book-list');
    let entries = Store.coll('entries').filter(e => e.kind === this.kind);
    if (this.search) {
      const s = Sim.normalize(this.search);
      entries = entries.filter(e => Sim.normalize(U.stripHtml(e.snapshot.stem) + U.stripHtml(e.snapshot.analysis || '')).includes(s));
    }
    container.querySelector('#book-count').textContent = entries.length;

    if (!entries.length) {
      listEl.innerHTML = UI.emptyState(
        { wrong: '错题本还是空的——在「刷题」页作答后勾选归档', good: '好题本还是空的——把值得反复研读的题归档进来', template: '模板本还是空的——把值得总结成模板的题归档进来' }[this.kind],
      );
      return;
    }

    listEl.innerHTML = entries.map(e => {
      const stem = U.stripHtml(e.snapshot.stem);
      const kcls = { wrong: 'wrong', good: 'good', template: 'tpl' }[e.kind] || e.kind;
      return `
      <div class="card entry-card k-${kcls}" data-id="${e.id}">
        <div class="card-title">
          ${e.snapshot.number ? `第 ${U.esc(e.snapshot.number)} 题` : '题目'}
          ${e.snapshot.chapter ? `<span class="chip">${U.esc(e.snapshot.chapter)}</span>` : ''}
          ${e.snapshot.knowledge ? `<span class="chip chip-tag">${U.esc(e.snapshot.knowledge)}</span>` : ''}
          ${(e.tags || []).map(t => `<span class="chip chip-tag">${U.esc(t)}</span>`).join('')}
          <span style="flex:1"></span>
          <span class="muted">${U.fmt(e.createdAt)}</span>
        </div>
        <div class="entry-stem">${U.esc(stem.slice(0, 120))}${stem.length > 120 ? '…' : ''}</div>
        <div class="entry-foot">
          ${e.aiGrade ? '<span class="chip">已 AI 批改</span>' : ''}
          ${e.essence ? '<span class="chip">已提炼本质</span>' : ''}
          ${e.myAnswer?.text || e.myAnswer?.imageUrl ? '<span class="chip">有作答</span>' : ''}
          ${e.templateId ? `<span class="chip chip-tpl">已生成模板</span>` : ''}
          <span style="flex:1"></span>
          <button class="btn btn-sm" data-act="detail">详情</button>
          <button class="btn btn-sm btn-primary" data-act="totpl">✨ 生成做题模板</button>
          <button class="btn btn-sm btn-ghost" data-act="del" style="color:var(--danger)">删除</button>
        </div>
      </div>`;
    }).join('');
    Ktx.renderMath(listEl);

    listEl.querySelectorAll('.entry-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
        const entry = Store.find('entries', id);
        if (!entry) return;
        if (btn.dataset.act === 'detail') this.showDetail(entry);
        if (btn.dataset.act === 'del') {
          if (await UI.confirm('删除这条归档记录？（题目与作答记录不受影响）', { danger: true })) Store.remove('entries', id);
          this.render(container);
        }
        if (btn.dataset.act === 'totpl') {
          if (entry.templateId) {
            const t = Store.find('templates', entry.templateId);
            UI.toast(`该题已生成模板「${t?.name || '?'}」`, 'warn');
            return;
          }
          await TplFlow.fromEntry(entry);
        }
      });
    });
  },

  showDetail(entry) {
    const s = entry.snapshot;
    UI.modal({
      title: `题目详情${s.bankName ? ` · ${s.bankName}` : ''}`,
      raw: true,
      width: 760,
      body: `
        <div class="q-meta">${s.number ? `<span class="chip">第 ${U.esc(s.number)} 题</span>` : ''}
          ${s.chapter ? `<span class="chip">${U.esc(s.chapter)}</span>` : ''}
          ${(entry.tags || []).map(t => `<span class="chip chip-tag">${U.esc(t)}</span>`).join('')}
        </div>
        <div class="rich q-stem">${Sanitize.html(MD.toHtml(s.stem))}</div>
        ${s.options?.length ? `<ul class="q-options">${s.options.map(o => `<li>${Sanitize.html(MD.toHtml(o))}</li>`).join('')}</ul>` : ''}
        ${s.answer ? `<div class="q-analysis rich"><b>参考答案：</b>${Sanitize.html(MD.toHtml(s.answer))}</div>` : ''}
        ${s.analysis ? `<div class="q-analysis rich"><b>解析：</b>${Sanitize.html(MD.toHtml(s.analysis))}</div>` : ''}
        ${entry.myAnswer?.text || entry.myAnswer?.imageUrl ? `<div class="section-title">我的作答</div>
          ${entry.myAnswer.text ? `<div class="rich">${Sanitize.html(MD.toHtml(entry.myAnswer.text))}</div>` : ''}
          ${entry.myAnswer.imageUrl ? `<img src="${entry.myAnswer.imageUrl}" style="max-height:200px;border-radius:8px">` : ''}` : ''}
        ${entry.aiGrade ? `<div class="section-title">AI 批改</div><div class="ai-report">${entry.aiGrade.html}</div>` : ''}
        ${entry.essence ? `<div class="section-title">本质思路 + AI 评价</div><div class="ai-report">${entry.essence.html}</div>` : ''}`,
      actions: [{ label: '关闭' }],
    });
    Ktx.renderMath(document.getElementById('modal-root'));
  },
};
