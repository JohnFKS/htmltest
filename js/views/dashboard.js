// 学习仪表盘：统计总览 + 今日待办 + 考点掌握度 + 最近动态
window.Views = window.Views || {};

Views.dashboard = {
  render(container) {
    container.innerHTML = `<div id="dash-body"></div>`;
    this.renderBody(container.querySelector('#dash-body'));
  },

  renderBody(el) {
    const db = Store.db;
    const qcount = (db.banks || []).reduce((a, b) => a + (b.questions?.length || 0), 0);
    const records = db.records || [];
    const graded = records.filter(r => r.aiGrade?.verdict);
    const correct = graded.filter(r => r.aiGrade.verdict === 'correct').length;
    const partial = graded.filter(r => r.aiGrade.verdict === 'partial').length;
    const wrong = graded.filter(r => r.aiGrade.verdict === 'wrong').length;
    const accuracy = graded.length ? Math.round(((correct + partial * 0.5) / graded.length) * 100) : null;

    const dueCards = (db.cards || []).filter(c => Srs.isDue(c)).length;
    const cardsTotal = (db.cards || []).length;
    const mastered = (db.cards || []).filter(c => (c.srs?.interval || 0) >= 21).length;

    // 学习连续天数（按本地日期）
    const days = new Set();
    for (const r of records) days.add((r.createdAt || '').slice(0, 10));
    for (const e of db.entries || []) days.add((e.createdAt || '').slice(0, 10));
    let streak = 0;
    const d = new Date();
    for (;;) {
      const key = d.toISOString().slice(0, 10);
      if (days.has(key)) { streak++; d.setDate(d.getDate() - 1); } else break;
    }

    // 考点掌握度（按标签聚合判定结果）
    const byTag = {};
    for (const r of graded) {
      for (const t of r.tags || []) {
        (byTag[t] ||= { total: 0, ok: 0 });
        byTag[t].total++;
        if (r.aiGrade.verdict === 'correct') byTag[t].ok++;
        else if (r.aiGrade.verdict === 'partial') byTag[t].ok += 0.5;
      }
    }
    const mastery = Object.entries(byTag).map(([tag, v]) => ({
      tag, ratio: Math.round((v.ok / v.total) * 100), total: v.total,
    })).sort((a, b) => b.total - a.total).slice(0, 8);

    const stat = (num, label, cls = '', sub = '') => `
      <div class="card stat-card ${cls}">
        <div class="stat-num">${num}</div>
        <div class="stat-label">${label}</div>
        ${sub ? `<div class="muted small">${sub}</div>` : ''}
      </div>`;

    el.innerHTML = `
      <h1 class="page-title">学习仪表盘</h1>
      <div class="page-sub">目标：吃透教材 → 刷透题库 → 记牢考点 → 通过考试</div>

      <div class="dash-todo card" style="border-left:4px solid var(--accent)">
        <div class="card-title">📌 今日待办</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <span>${dueCards > 0 ? `🧠 有 <b style="color:var(--accent)">${dueCards}</b> 张复习卡片到期` : '🧠 复习卡片今日无到期'}</span>
          <button class="btn btn-primary btn-sm" id="dash-review">去复习</button>
          <button class="btn btn-sm" id="dash-exam">🎯 来一场模拟考试</button>
        </div>
      </div>

      <div class="stat-grid">
        ${stat(graded.length || records.length, '累计作答', '', streak > 1 ? `连续学习 ${streak} 天 🔥` : streak === 1 ? '今天已学习 ✓' : '开始今天的学习吧')}
        ${stat(accuracy === null ? '—' : accuracy + '%', '批改正确率', '', `正确 ${correct} · 部分 ${partial} · 错误 ${wrong}`)}
        ${stat(qcount, '题库题目', '', `${(db.banks || []).length} 个题库`)}
        ${stat(cardsTotal, '复习卡片', '', `掌握(≥21天) ${mastered}`)}
        ${stat((db.entries || []).filter(e => e.kind === 'wrong').length, '错题本', '', `好题 ${(db.entries || []).filter(e => e.kind === 'good').length} · 模板 ${(db.entries || []).filter(e => e.kind === 'template').length}`)}
        ${stat((db.templates || []).length, '做题模板', '', (db.templates || []).reduce((a, t) => a + (t.members?.length || 0), 0) + ' 道成员题')}
      </div>

      ${mastery.length ? `<div class="section-title">🎯 考点掌握度（按 AI 批改聚合，越低越要优先重练）</div>
      <div class="card">${mastery.map(m => `
        <div style="display:flex;align-items:center;gap:10px;margin:8px 0">
          <span class="chip chip-tag" style="min-width:150px;text-align:center">${U.esc(m.tag)}</span>
          <div class="score-bar ${m.ratio >= 80 ? 'high' : m.ratio < 50 ? 'low' : ''}" style="flex:1"><div style="width:${m.ratio}%"></div></div>
          <span class="small muted">${m.ratio}%（${m.total} 次）</span>
        </div>`).join('')}</div>` : `<div class="section-title">🎯 考点掌握度</div><div class="card muted">暂无数据——做题并让 AI 批改后，这里会按知识点标签统计掌握度</div>`}

      <div class="section-title">🕘 最近作答</div>
      <div class="card" id="dash-recent">${records.slice(0, 8).map(r => {
        const q = (db.banks || []).flatMap(b => b.questions || []).find(x => x.id === r.questionId);
        const v = r.aiGrade?.verdict;
        return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)">
          <span class="chip ${v === 'correct' ? 'chip-good' : v === 'wrong' ? 'chip-wrong' : ''}">${{ correct: '✓', partial: '~', wrong: '✗' }[v] || '·'}</span>
          <span class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(U.stripHtml(q?.stem || r.text || '（图片作答）').slice(0, 50))}</span>
          <span class="muted small">${U.fmt(r.createdAt)}</span>
        </div>`;
      }).join('') || '<span class="muted">还没有作答记录</span>'}</div>`;

    Ktx.renderMath(el);
    el.querySelector('#dash-review').onclick = () => App.route('review');
    el.querySelector('#dash-exam').onclick = () => { App.route('quiz'); Views.quiz.state.tab = 'exam'; };
  },
};
