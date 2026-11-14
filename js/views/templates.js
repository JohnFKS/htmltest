// 模板库 + 相似度归类流水线（TplFlow）
// 流水线：归一化签名 → 快速召回（bigram Jaccard + TF-IDF + 关键词）→ 可选 embedding 精排 → LLM 裁决 → 人工决策
// 可靠性原则：分数全程透明展示 + LLM 只在候选存在时裁决 + 人工覆写永远可用 + 判定历史可回溯
window.Views = window.Views || {};

Views.templates = {
  search: '',

  render(container) {
    const templates = Store.coll('templates');
    container.innerHTML = `
      <h1 class="page-title">做题模板库</h1>
      <div class="page-sub">每道新题入库前，都会先与库内模板做三级相似度比对，由大模型裁决归并或新建——证据全程透明，可人工覆写</div>
      <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap">
        <input class="input" id="tpl-search" style="max-width:280px" placeholder="搜索模板…" value="${U.esc(this.search)}">
        <span class="muted">共 <b>${templates.length}</b> 个模板</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" id="tpl-export">导出模板库（JSON）</button>
      </div>
      <div id="tpl-list"></div>`;

    container.querySelector('#tpl-search').oninput = U.debounce(e => {
      this.search = e.target.value.trim();
      this.renderList(container);
    }, 300);
    container.querySelector('#tpl-export').onclick = () =>
      U.download('模板库.json', JSON.stringify(Store.coll('templates'), null, 1));

    this.renderList(container);
  },

  renderList(container) {
    const listEl = container.querySelector('#tpl-list');
    let templates = Store.coll('templates');
    if (this.search) {
      const s = Sim.normalize(this.search);
      templates = templates.filter(t => Sim.normalize([t.name, t.essence, ...(t.signals || [])].join(' ')).includes(s));
    }
    if (!templates.length) {
      listEl.innerHTML = UI.emptyState('模板库还是空的', '<div class="muted">去「三本」页选一道题，点「✨ 生成做题模板」开始建库</div>');
      return;
    }
    listEl.innerHTML = templates.map(t => `
      <div class="card entry-card k-tpl" data-id="${t.id}">
        <div class="card-title">
          📐 ${U.esc(t.name)}
          <span class="chip">${(t.members || []).length} 成员题</span>
          ${(t.variants || []).length ? `<span class="chip">${t.variants.length} 变式</span>` : ''}
          ${(t.disguises || []).length ? `<span class="chip">${t.disguises.length} 伪装</span>` : ''}
          <span style="flex:1"></span>
          <span class="muted">${U.fmt(t.updatedAt || t.createdAt)}</span>
        </div>
        <div class="small" style="color:var(--ink-2)">${U.esc(t.essence || '').slice(0, 120)}</div>
        <div style="margin-top:6px">${(t.signals || []).slice(0, 4).map(s => `<span class="chip chip-tpl">${U.esc(s)}</span>`).join('')}</div>
        <div class="entry-foot">
          <span style="flex:1"></span>
          <button class="btn btn-sm" data-act="detail">详情</button>
          <button class="btn btn-sm" data-act="expand">✨ 扩容变式</button>
          <button class="btn btn-sm" data-act="add">＋ 添加成员题</button>
          <button class="btn btn-sm btn-ghost" data-act="del" style="color:var(--danger)">删除</button>
        </div>
      </div>`).join('');

    listEl.querySelectorAll('.entry-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
        const t = Store.find('templates', id);
        if (!t) return;
        if (btn.dataset.act === 'detail') this.showDetail(t);
        if (btn.dataset.act === 'del' && await UI.confirm(`删除模板「${t.name}」？（成员题不受影响）`, { danger: true })) {
          Store.remove('templates', id);
          this.render(container);
        }
        if (btn.dataset.act === 'expand') await TplFlow.expandTemplate(t);
        if (btn.dataset.act === 'add') await TplFlow.pickEntryThenGenerate(t.id);
      });
    });
  },

  showDetail(t) {
    const arr = a => (a || []).length ? `<ul>${a.map(x => `<li>${U.esc(x)}</li>`).join('')}</ul>` : '<span class="muted">暂无</span>';
    UI.modal({
      title: t.name,
      raw: true,
      width: 780,
      body: `
        <div class="ai-report">
          <h4>本质模型</h4><p>${U.esc(t.essence || '')}</p>
          <h4>适用信号 / 特征</h4>${arr(t.signals)}
          <h4>解题步骤</h4>${arr(t.steps)}
          <h4>常见变式与伪装</h4>${arr(t.disguises)}
          <h4>易错点</h4>${arr(t.pitfalls)}
          ${t.summary ? `<blockquote>${U.esc(t.summary)}</blockquote>` : ''}
          ${t.variants?.length ? `<h4>扩容变式题</h4>${t.variants.map(v => `<details><summary>${U.esc(v.title || '变式')}</summary><p>${U.esc(v.description || '')}</p></details>`).join('')}` : ''}
          <h4>成员题（${(t.members || []).length}）</h4>
          ${arr((t.members || []).map(m => (m.number ? m.number + '. ' : '') + (m.stemText || '').slice(0, 60)))}
          ${t.history?.length ? `<h4>判定历史</h4>
            <table><thead><tr><th>时间</th><th>题目</th><th>动作</th><th>相似度</th><th>裁决</th></tr></thead><tbody>
            ${t.history.map(h => `<tr><td>${U.fmt(h.time)}</td><td>${U.esc((h.questionText || '').slice(0, 24))}…</td>
              <td>${{ merge: '归并', new: '新建', 'override-merge': '人工归并', 'override-new': '人工新建' }[h.action] || h.action}</td>
              <td>${h.score ?? '-'}</td>
              <td>${h.verdict ? `${h.verdict.same_type ? '同类' : '不同类'} (${h.verdict.confidence})${h.verdict.demo ? ' 演示' : ''}` : '-'}</td></tr>`).join('')}
            </tbody></table>` : ''}
        </div>`,
      actions: [{ label: '关闭' }],
    });
    Ktx.renderMath(document.getElementById('modal-root'));
  },
};

// ---------- 相似度归类流水线 ----------
window.TplFlow = {
  normalizeTpl(data) {
    return {
      name: String(data.name || '未命名模板').slice(0, 40),
      essence: String(data.essence || ''),
      signals: (data.signals || []).map(String),
      steps: (data.steps || []).map(String),
      disguises: (data.disguises || []).map(String),
      pitfalls: (data.pitfalls || []).map(String),
      summary: String(data.summary || ''),
    };
  },

  // 入口 1：从三本条目生成模板（三本页「生成做题模板」按钮）
  async fromEntry(entry) {
    UI.spinner(true, 'AI 生成做题模板中…');
    let tplData;
    try {
      const result = await AI.templateGen(entry.snapshot, entry.snapshot.analysis, entry.essence?.html);
      tplData = this.normalizeTpl(result.data);
      tplData.demo = result.demo;
    } catch (e) {
      UI.spinner(false);
      return UI.toast(e.message, 'error');
    }
    UI.spinner(false);
    const qText = U.stripHtml(entry.snapshot.stem);
    await this.pipeline(tplData, qText, entry);
  },

  // 入口 2：从模板库为既有模板添加成员题（先选题，再做相似度对比）
  async pickEntryThenGenerate(targetTemplateId) {
    const entries = Store.coll('entries');
    if (!entries.length) return UI.toast('三本中还没有题目', 'warn');
    const m = UI.modal({
      title: '选择要加入的题目',
      raw: true,
      width: 720,
      body: `<div style="max-height:55vh;overflow-y:auto">
        ${entries.map(e => `
          <div class="pv-question" style="display:flex;gap:10px;align-items:center">
            <span class="chip ${{ wrong: 'chip-wrong', good: 'chip-good', template: 'chip-tpl' }[e.kind] || ''}">${{ wrong: '错题', good: '好题', template: '模板' }[e.kind]}</span>
            <div class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(U.stripHtml(e.snapshot.stem).slice(0, 56))}</div>
            <button class="btn btn-sm" data-eid="${e.id}">对比入库</button>
          </div>`).join('')}
      </div>`,
      actions: [{ label: '取消' }],
    });
    m.bodyEl.querySelectorAll('[data-eid]').forEach(btn => btn.onclick = async () => {
      const entry = Store.find('entries', btn.dataset.eid);
      m.close();
      const target = Store.find('templates', targetTemplateId);
      const qText = U.stripHtml(entry.snapshot.stem);
      // 直接与目标模板对比
      await this.pipelineWithTarget(target, qText, entry);
    });
  },

  // 相似度流水线主流程
  async pipeline(tplData, qText, entry) {
    const templates = Store.coll('templates');
    const cfg = Store.config.similarity;

    if (!templates.length) {
      // 空库：直接新建
      await this.finishNew(tplData, qText, entry, null);
      return;
    }
    // Stage 1+2：快速召回
    // 对每个模板取「模板全文」与「各成员题干」的最大相似度——与库中题目对比是第一信号
    const pool = templates.map(t => {
      const wholeText = [t.name, t.essence, (t.signals || []).join(' '), ...(t.members || []).slice(0, 3).map(x => x.stemText || '')].join('。');
      const cands = [
        { text: wholeText, ...Sim.hybridScore(qText, wholeText, cfg), against: '模板全文' },
        ...(t.members || []).slice(0, 3).map(m => ({
          text: m.stemText || '', ...Sim.hybridScore(qText, m.stemText || '', cfg), against: `成员题${m.number ? ' ' + m.number : ''}`,
        })).filter(x => x.text),
      ].sort((a, b) => b.score - a.score);
      const best = cands[0] || { text: wholeText, score: 0, parts: { jaccard: 0, tfidf: 0, keyword: 0 }, against: '模板全文' };
      return { id: t.id, ref: t, text: wholeText, matchedText: best.text, against: best.against, ...best };
    });
    let candidates = pool.filter(c => c.score >= 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.recallTopK ?? 5)
      .map(c => ({ ...c, sigA: Sim.normalize(qText), sigB: Sim.normalize(c.matchedText) }));

    // Stage 3：可选 embedding 精排（配置了 embedModel 且 AI 可用）
    let embedUsed = false;
    if (candidates.length > 1 && Store.aiLive() && (Store.config.ai.embedModel || '').trim()) {
      try {
        UI.spinner(true, 'embedding 精排中…');
        const { vectors } = await Api.aiEmbed({ input: [qText.slice(0, 1000), ...candidates.map(c => c.text.slice(0, 1000))] });
        candidates.forEach((c, i) => { c.embed = Sim.cosineVec(vectors[0], vectors[i + 1]); });
        candidates.sort((a, b) => (0.7 * b.score + 0.3 * b.embed) - (0.7 * a.score + 0.3 * a.embed));
        embedUsed = true;
      } catch (e) {
        UI.toast(`embedding 精排失败（${e.message}），已使用混合分数排序`, 'warn');
      }
      UI.spinner(false);
    }

    // Stage 4：LLM 裁决（对 top-1）
    let verdict = null;
    if (candidates.length) {
      UI.spinner(true, Store.aiLive() ? '大模型裁决中…' : '演示裁决中…');
      try {
        verdict = await AI.verdict(qText, this.describeTemplate(candidates[0].ref), candidates[0]);
        if (verdict) verdict.hybridScore = candidates[0].score;
      } catch (e) {
        UI.spinner(false);
        UI.toast(`裁决失败（${e.message}），可用人工覆写完成归类`, 'error');
      }
      UI.spinner(false);
    }
    this.showPipelineModal(tplData, qText, entry, candidates, verdict, embedUsed);
  },

  async pipelineWithTarget(target, qText, entry) {
    const cfg = Store.config.similarity;
    const text = [target.name, target.essence, (target.signals || []).join(' '), ...(target.members || []).slice(0, 3).map(x => x.stemText || '')].join('。');
    const cand = { id: target.id, ref: target, text, ...Sim.hybridScore(qText, text, cfg), sigA: Sim.normalize(qText), sigB: Sim.normalize(text) };
    let verdict = null;
    UI.spinner(true, Store.aiLive() ? '大模型裁决中…' : '演示裁决中…');
    try {
      verdict = await AI.verdict(qText, this.describeTemplate(target), cand);
      if (verdict) verdict.hybridScore = cand.score;
    }
    catch (e) { UI.toast(`裁决失败（${e.message}）`, 'error'); }
    UI.spinner(false);
    this.showPipelineModal(null, qText, entry, [cand], verdict, false, target);
  },

  describeTemplate(t) {
    return JSON.stringify({
      name: t.name, essence: t.essence, signals: (t.signals || []).slice(0, 6),
      steps: (t.steps || []).slice(0, 8), disguises: (t.disguises || []).slice(0, 6),
      memberExamples: (t.members || []).slice(0, 3).map(m => U.stripHtml(m.stemText || '').slice(0, 100)),
    });
  },

  // 流水线决策 UI：证据全部展示，决策权交给用户
  showPipelineModal(tplData, qText, entry, candidates, verdict, embedUsed, fixedTarget) {
    const cfg = Store.config.similarity;
    const scoreBar = (v, cls = '') => `<div class="score-bar ${cls}" style="width:110px;display:inline-block;vertical-align:middle"><div style="width:${Math.round(U.clamp(v, 0, 1) * 100)}%"></div></div> ${v}`;

    const candRows = candidates.map((c, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><b>${U.esc(c.ref.name)}</b></td>
        <td>${scoreBar(c.score, c.score >= cfg.demoThreshold ? 'high' : c.score < 0.3 ? 'low' : '')}</td>
        <td class="small muted">${c.against || ''} · J:${c.parts?.jaccard ?? '-'} / T:${c.parts?.tfidf ?? '-'} / K:${c.parts?.keyword ?? '-'}${c.embed != null ? ` / E:${Math.round(c.embed * 100) / 100}` : ''}</td>
        <td><button class="btn btn-sm" data-merge="${c.id}">归并</button></td>
      </tr>`).join('');

    const top = candidates[0];
    const diff = top ? Sim.diffHtml(qText, top.matchedText || top.text) : null;
    const aiSuggestMerge = verdict?.data?.same_type && verdict.data.confidence >= cfg.autoMergeConfidence;

    const verdictHtml = verdict ? `
      <div style="display:flex;gap:10px;align-items:center;margin:8px 0">
        <span class="verdict-badge ${verdict.data.same_type ? 'verdict-same' : 'verdict-diff'}">
          ${verdict.data.same_type ? '✔ 同一题型' : '✘ 不同题型'}（置信度 ${verdict.data.confidence}）
        </span>
        ${verdict.demo ? '<span class="ai-demo-badge" style="margin:0">⚑ 演示裁决：由混合分数阈值代替 LLM</span>' : ''}
        ${aiSuggestMerge ? '<span class="chip chip-good">达到自动归并阈值</span>' : ''}
      </div>
      <div class="ai-report"><p>${U.esc(verdict.data.reason)}</p></div>` : `
      <div class="muted">未产生 LLM 裁决${top ? '（可人工判断）' : '：召回候选为空，直接新建模板'}</div>`;

    const m = UI.modal({
      title: '模板入库 · 相似度判定',
      raw: true,
      width: 860,
      body: `
        ${tplData ? `<div class="card" style="box-shadow:none;background:var(--surface-2)">
          <b>${U.esc(tplData.name)}</b> ${tplData.demo ? '<span class="ai-demo-badge" style="margin:0">⚑ 演示生成</span>' : ''}
          <div class="small" style="color:var(--ink-2);margin-top:4px">${U.esc(tplData.essence)}</div>
        </div>` : `<div class="card" style="box-shadow:none;background:var(--surface-2)"><b>目标模板：${U.esc(fixedTarget?.name || top?.ref.name || '')}</b></div>`}
        <div class="section-title" style="margin-top:14px">① 快速召回（top-${candidates.length}）${embedUsed ? ' · 已用 embedding 精排' : ''}</div>
        ${candidates.length ? `<table class="sim-table"><thead><tr><th>#</th><th>模板</th><th>混合分</th><th>分项</th><th></th></tr></thead><tbody>${candRows}</tbody></table>`
          : '<div class="muted">没有候选模板（混合分数低于召回线）</div>'}
        ${top ? `<div class="section-title">② 结构对照（归一化签名 diff，黄色 = 共同结构）</div>${diff.html}
          <div class="muted">共同结构占比 ${diff.commonRatio}</div>` : ''}
        <div class="section-title">③ 裁决</div>
        ${verdictHtml}
        <div class="muted" style="margin-top:10px">无论裁决结果如何，最终决策权在你：可归并到任一候选、或坚持新建模板。</div>`,
      actions: [
        ...(tplData ? [{ label: '新建模板（覆写）', onClick: close => { this.finishNew(tplData, qText, entry, verdict, true, top?.score); close(); } }] : []),
        { label: '取消' },
        ...(top && aiSuggestMerge ? [{
          label: `✔ 归并到「${top.ref.name}」并扩容`, primary: true,
          onClick: close => { this.finishMerge(top.ref, qText, entry, verdict, false, top.score); close(); },
        }] : []),
      ],
    });

    m.bodyEl.querySelectorAll('[data-merge]').forEach(btn => btn.onclick = () => {
      const t = Store.find('templates', btn.dataset.merge);
      if (!t) return;
      const cand = candidates.find(c => c.id === btn.dataset.merge);
      m.close();
      // 归并到既有模板：不重复生成模板内容，只加成员 + 记历史
      this.finishMerge(t, qText, entry, verdict, true, cand?.score);
    });
  },

  // 决策落库：归并（触发扩容）
  async finishMerge(tpl, qText, entry, verdict, override, score) {
    tpl.members = tpl.members || [];
    tpl.members.push({
      questionId: entry?.questionId || null,
      stemText: qText.slice(0, 500),
      number: entry?.snapshot?.number || '',
      source: entry?.snapshot?.bankName || (entry?.kind ? ({ wrong: '错题本', good: '好题本', template: '模板本' })[entry.kind] : '外部'),
      addedAt: U.now(),
    });
    tpl.history = tpl.history || [];
    tpl.history.unshift({
      time: U.now(), questionText: qText.slice(0, 120),
      action: override ? 'override-merge' : 'merge',
      score: score ?? verdict?.hybridScore ?? null, verdict: verdict?.data || null,
    });
    Store.update('templates', tpl.id, { members: tpl.members, history: tpl.history });
    if (entry) Store.update('entries', entry.id, { templateId: tpl.id });

    UI.toast(`已归并到模板「${tpl.name}」，正在扩容变式…`, 'success');
    await this.expandTemplate(tpl, true);
    App.route('templates');
  },

  // 决策落库：新建
  finishNew(tplData, qText, entry, verdict, override, score) {
    const tpl = {
      id: U.uid('tpl'), ...tplData,
      members: [{
        questionId: entry?.questionId || null, stemText: qText.slice(0, 500),
        number: entry?.snapshot?.number || '', source: entry?.snapshot?.bankName || '外部', addedAt: U.now(),
      }],
      variants: [], history: [{
        time: U.now(), questionText: qText.slice(0, 120),
        action: override ? 'override-new' : 'new',
        score: score ?? verdict?.hybridScore ?? null, verdict: verdict?.data || null,
      }],
      createdAt: U.now(), updatedAt: U.now(),
    };
    Store.insert('templates', tpl);
    if (entry) Store.update('entries', entry.id, { templateId: tpl.id });
    UI.toast(`新模板「${tpl.name}」已建立`, 'success');
    App.route('templates');
  },

  // 扩容：LLM 生成更多变式 / 伪装 / 易错点
  async expandTemplate(tpl, silent) {
    UI.spinner(true, Store.aiLive() ? '大模型扩容中…' : '演示扩容中…');
    try {
      const result = await AI.expand(tpl, (tpl.members || []).map(m => m.stemText || ''));
      const d = result.data;
      const tagNew = list => (list || []).map(x => `${x}`);
      tpl.disguises = [...(tpl.disguises || []), ...tagNew(d.newDisguises)];
      tpl.pitfalls = [...(tpl.pitfalls || []), ...tagNew(d.newPitfalls)];
      tpl.variants = [...(tpl.variants || []), ...(d.variants || []).map(v => ({
        title: `${v.title || '变式'}`,
        description: `${v.description || ''}`,
        demo: result.demo, addedAt: U.now(),
      }))];
      Store.update('templates', tpl.id, {
        disguises: tpl.disguises, pitfalls: tpl.pitfalls, variants: tpl.variants,
      });
      UI.spinner(false);
      if (!silent) {
        UI.modal({
          title: `「${tpl.name}」扩容结果`,
      raw: true,
          width: 640,
          body: `<div class="ai-report">
            ${result.demo ? '<div class="ai-demo-badge">⚑ 演示模式扩容</div>' : ''}
            <h4>新增伪装</h4>${(d.newDisguises || []).length ? `<ul>${d.newDisguises.map(x => `<li>${U.esc(x)}</li>`).join('')}</ul>` : '<span class="muted">无</span>'}
            <h4>新增易错点</h4>${(d.newPitfalls || []).length ? `<ul>${d.newPitfalls.map(x => `<li>${U.esc(x)}</li>`).join('')}</ul>` : '<span class="muted">无</span>'}
            <h4>新变式</h4>${(d.variants || []).length ? (d.variants || []).map(v => `<details><summary>${U.esc(v.title || '')}</summary><p>${U.esc(v.description || '')}</p></details>`).join('') : '<span class="muted">无</span>'}
            ${d.note ? `<blockquote>${U.esc(d.note)}</blockquote>` : ''}
          </div>`,
          actions: [{ label: '关闭' }],
        });
        Ktx.renderMath(document.getElementById('modal-root'));
      } else {
        UI.toast(`扩容完成：+${(d.newDisguises || []).length} 伪装 +${(d.variants || []).length} 变式`, 'success');
      }
    } catch (e) {
      UI.spinner(false);
      UI.toast(`扩容失败：${e.message}`, 'error');
    }
  },
};
