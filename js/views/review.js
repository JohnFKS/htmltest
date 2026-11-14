// 复习卡片：SM-2 简化版间隔重复 + 卡片增删改查
// 卡片来源：错题/好题/模板本条目一键生成（AI 提炼最小记忆点）、手动新建
window.Views = window.Views || {};

// ---------- SRS 调度（简化 SM-2） ----------
window.Srs = {
  grade(card, g) { // g: again | hard | good | easy
    const s = card.srs ||= { ease: 2.5, interval: 0, reps: 0, lapses: 0 };
    if (g === 'again') {
      s.reps = 0; s.interval = 0; s.lapses++;
      s.ease = Math.max(1.3, s.ease - 0.2);
      s.due = U.now(); // 立刻重新排队
    } else {
      s.reps++;
      const q = { hard: 1.2, good: s.ease, easy: s.ease * 1.3 }[g];
      if (g === 'hard') s.ease = Math.max(1.3, s.ease - 0.05);
      if (g === 'easy') s.ease += 0.15;
      s.interval = s.reps === 1 ? (g === 'hard' ? 1 : 2)
        : s.reps === 2 ? 6
        : Math.max(1, Math.round(s.interval * q));
      s.due = new Date(Date.now() + s.interval * 864e5).toISOString();
    }
    return s;
  },
  isDue(card) {
    const s = card.srs;
    if (!s || s.reps === 0) return true; // 新卡立即学
    return !s.due || new Date(s.due) <= new Date();
  },
  dueLabel(card) {
    const s = card.srs || {};
    if (!s.reps) return '新卡';
    if (this.isDue(card)) return '到期';
    const days = Math.ceil((new Date(s.due) - Date.now()) / 864e5);
    return `${days} 天后`;
  },
};

Views.review = {
  queue: [], idx: 0, flipped: false, session: { total: 0, again: 0, hard: 0, good: 0, easy: 0 },

  render(container) {
    container.innerHTML = `<div id="review-body"></div>`;
    this.renderBody(container.querySelector('#review-body'));
  },

  renderBody(el) {
    const cards = Store.coll('cards');
    const due = cards.filter(c => Srs.isDue(c));
    el.innerHTML = `
      <h1 class="page-title">复习卡片</h1>
      <div class="page-sub">间隔重复（SM-2 简化版）：在快忘记的时候复习，用最少的时间记住最多考点</div>
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="card stat-card"><div class="stat-num">${cards.length}</div><div class="stat-label">卡片总数</div></div>
        <div class="card stat-card"><div class="stat-num" style="color:${due.length ? 'var(--accent)' : 'var(--good)'}">${due.length}</div><div class="stat-label">今日到期</div></div>
        <div class="card stat-card"><div class="stat-num">${cards.filter(c => (c.srs?.interval || 0) >= 21).length}</div><div class="stat-label">已掌握</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn btn-primary" id="rv-start" ${due.length ? '' : 'disabled'}>▶ 开始复习（${due.length}）</button>
        <button class="btn" id="rv-gen">✨ 从题本生成卡片</button>
        <button class="btn" id="rv-add">＋ 手动新建</button>
      </div>
      <div class="section-title">卡片列表</div>
      <div id="rv-list" style="max-height:46vh;overflow-y:auto"></div>`;

    el.querySelector('#rv-start').onclick = () => { this.startQueue(due); this.renderSession(el); };
    el.querySelector('#rv-gen').onclick = () => this.generateFromEntries(el);
    el.querySelector('#rv-add').onclick = () => this.editCard(null, el);
    const listEl = el.querySelector('#rv-list');
    listEl.innerHTML = cards.map(c => `
      <div class="record-card" style="display:flex;gap:8px;align-items:center">
        <span class="chip ${Srs.isDue(c) ? 'chip-wrong' : 'chip-good'}">${Srs.dueLabel(c)}</span>
        <span class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(U.stripHtml(c.front).slice(0, 50))}</span>
        ${(c.tags || []).slice(0, 2).map(t => `<span class="chip chip-tag">${U.esc(t)}</span>`).join('')}
        <button class="btn btn-ghost btn-sm" data-edit="${c.id}">编辑</button>
        <button class="btn btn-ghost btn-sm" data-del="${c.id}" style="color:var(--danger)">删除</button>
      </div>`).join('') || '<div class="muted">还没有卡片——从错题本/好题本一键生成，或手动新建</div>';
    listEl.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => this.editCard(Store.find('cards', b.dataset.edit), el));
    listEl.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (await UI.confirm('删除这张卡片？', { danger: true })) { Store.remove('cards', b.dataset.del); this.renderBody(el); }
    });
    Ktx.renderMath(el);
  },

  editCard(card, el) {
    let m;
    m = UI.modal({
      title: card ? '编辑卡片' : '新建卡片', width: 560, raw: true,
      body: `
        <div class="field"><label class="field-label">正面（问题 / 挖空）</label>
          <textarea class="textarea" id="c-front" rows="2">${U.esc(card?.front || '')}</textarea></div>
        <div class="field"><label class="field-label">反面（答案 / 最小记忆点）</label>
          <textarea class="textarea" id="c-back" rows="3">${U.esc(card?.back || '')}</textarea></div>
        <div class="field"><label class="field-label">标签（逗号分隔，可选）</label>
          <input class="input" id="c-tags" value="${U.esc((card?.tags || []).join(','))}"></div>`,
      actions: [
        { label: '取消' },
        { label: '保存', primary: true, onClick: close => {
          const front = m.el.querySelector('#c-front').value.trim();
          const back = m.el.querySelector('#c-back').value.trim();
          if (!front || !back) return UI.toast('正面和反面都不能为空', 'warn');
          const tags = m.el.querySelector('#c-tags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean);
          if (card) Store.update('cards', card.id, { front: Sanitize.html(MD.toHtml(front)), back: Sanitize.html(MD.toHtml(back)), tags });
          else Store.insert('cards', { id: U.uid('card'), front: Sanitize.html(MD.toHtml(front)), back: Sanitize.html(MD.toHtml(back)), tags, srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0 }, createdAt: U.now() });
          close(); this.renderBody(el);
        } },
      ],
    });
  },

  async generateFromEntries(el) {
    const entries = Store.coll('entries');
    if (!entries.length) return UI.toast('三本中还没有题目，先去刷题归档', 'warn');
    const m = UI.modal({
      title: '从题本生成复习卡片', width: 720, raw: true,
      body: `<div class="muted" style="margin-bottom:8px">勾选要生成卡片的条目（AI 提炼最小记忆点${Store.aiLive() ? '' : '，演示模式为本地规则'}）</div>
        <div style="max-height:44vh;overflow-y:auto">
        ${entries.map(e => `
          <label class="checkbox-row" style="padding:6px 4px;border-bottom:1px dashed var(--line)">
            <input type="checkbox" value="${e.id}" checked>
            <span class="chip ${{ wrong: 'chip-wrong', good: 'chip-good', template: 'chip-tpl' }[e.kind]}">${{ wrong: '错题', good: '好题', template: '模板' }[e.kind]}</span>
            <span class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(U.stripHtml(e.snapshot.stem).slice(0, 56))}</span>
          </label>`).join('')}
        </div>`,
      actions: [
        { label: '取消' },
        { label: '✨ 生成卡片', primary: true, onClick: close => {
          const ids = [...m.el.querySelectorAll('input:checked')].map(i => i.value);
          close();
          this.doGenerate(ids, el);
        } },
      ],
    });
  },

  async doGenerate(ids, el) {
    UI.spinner(true, '生成卡片中…');
    let made = 0;
    for (const id of ids) {
      const e = Store.find('entries', id);
      if (!e) continue;
      try {
        const r = await AI.makeCards(e.snapshot, e.snapshot.analysis, e.essence?.html);
        for (const c of r.data.cards) {
          if (!c.front || !c.back) continue;
          Store.insert('cards', {
            id: U.uid('card'),
            front: Sanitize.html(MD.toHtml(c.front)), back: Sanitize.html(MD.toHtml(c.back)),
            tags: e.tags || [], source: { entryId: e.id, questionId: e.questionId || null },
            srs: { ease: 2.5, interval: 0, reps: 0, lapses: 0 }, createdAt: U.now(),
          });
          made++;
        }
      } catch (err) { UI.toast(`生成失败：${err.message}`, 'error'); }
    }
    UI.spinner(false);
    UI.toast(`已生成 ${made} 张卡片`, 'success');
    this.renderBody(el);
  },

  startQueue(due) {
    this.queue = [...due]; this.idx = 0; this.flipped = false;
    this.session = { total: due.length, again: 0, hard: 0, good: 0, easy: 0 };
  },

  renderSession(el) {
    if (this.idx >= this.queue.length) {
      const s = this.session;
      el.innerHTML = `
        <div class="card" style="text-align:center;padding:40px">
          <div style="font-size:44px">🎉</div>
          <div class="card-title" style="justify-content:center">本轮复习完成（${s.total} 张）</div>
          <div class="muted">忘了 ${s.again} · 模糊 ${s.hard} · 记得 ${s.good} · 轻松 ${s.easy}</div>
          <div style="margin-top:14px"><button class="btn btn-primary" id="rv-back">返回卡片列表</button></div>
        </div>`;
      el.querySelector('#rv-back').onclick = () => this.renderBody(el);
      return;
    }
    const card = this.queue[this.idx];
    el.innerHTML = `
      <div class="muted" style="margin-bottom:8px">${this.idx + 1} / ${this.queue.length}　${(card.tags || []).map(t => `<span class="chip chip-tag">${U.esc(t)}</span>`).join(' ')}</div>
      <div class="card review-card" id="rv-card">
        <div class="rv-front rich">${Sanitize.html(card.front)}</div>
        <div class="rv-back rich" id="rv-back-face" style="display:none;border-top:1px dashed var(--line);margin-top:14px;padding-top:14px">${Sanitize.html(card.back)}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:center;flex-wrap:wrap" id="rv-actions"></div>`;
    Ktx.renderMath(el);

    const actions = el.querySelector('#rv-actions');
    if (!this.flipped) {
      actions.innerHTML = `<button class="btn btn-primary" id="rv-flip">🔄 翻转看答案</button>`;
      el.querySelector('#rv-flip').onclick = () => {
        this.flipped = true;
        el.querySelector('#rv-back-face').style.display = 'block';
        el.querySelector('#rv-flip').remove();
        actions.innerHTML = `
          <button class="btn btn-danger" data-g="again">😅 忘了</button>
          <button class="btn" data-g="hard">😵 模糊</button>
          <button class="btn btn-primary" data-g="good">🙂 记得</button>
          <button class="btn btn-accent" data-g="easy">😎 轻松</button>`;
        actions.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
          const g = b.dataset.g;
          Srs.grade(card, g);
          this.session[g]++;
          Store.update('cards', card.id, { srs: card.srs });
          this.flipped = false; this.idx++;
          this.renderSession(el);
        });
      };
    }
  },
};
