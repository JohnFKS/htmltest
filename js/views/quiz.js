// 刷题系统：题库导入（本地规则解析器 + LLM 智能解析）+ 练习作答（文本/手写/照片）+ AI 批改 + 归档
window.Views = window.Views || {};

// ---------- 本地题库解析器 ----------
window.LocalBankParser = (() => {
  const RE_Q = /^\s*(\d{1,3})\s*[.、．)）]\s*/;
  const RE_OPT = /^\s*\(?([A-Ka-k])\s*[.、．)）]\s*(.+)$/;
  const RE_ANS = /^\s*(?:【?答案】?|答)\s*[:：]?\s*(.*)$/;
  const RE_ANA = /^\s*(?:【?(解析|分析|解答)】?)\s*[:：]?\s*(.*)$/;
  const RE_KNW = /^\s*(?:【?知识点】?)\s*[:：]?\s*(.*)$/;
  const RE_TAG = /[【\[](知识点?[:：]?\s*)?([^】\]]{2,18})[】\]]/g;

  function parse(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let bankName = '';
    let chapter = '';
    const out = [];
    let cur = null;
    let section = 'stem'; // stem | options | answer | analysis

    const flush = () => {
      if (cur && cur.stem.trim()) out.push(cur);
      cur = null;
    };
    const newQ = num => {
      flush();
      cur = { number: num || String(out.length + 1), chapter, stem: '', options: [], answer: '', analysis: '', knowledge: '' };
      section = 'stem';
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // 文库名（首个一级标题）
      if (/^#\s+/.test(line)) { if (!bankName) bankName = line.replace(/^#\s+/, '').trim(); continue; }
      // 章节标题
      if (/^##+\s+/.test(line)) { chapter = line.replace(/^##+\s+/, '').trim(); continue; }
      // 分割线跳过
      if (/^(-{3,}|\*{3,})$/.test(line)) continue;

      // 新题开始
      const mq = line.match(RE_Q);
      const mopt = line.match(RE_OPT);
      if (mq && !mopt) {
        // 选项区结束后出现新编号才算新题；题干里的编号列表（如 (1)…）不会带字母选项
        newQ(mq[1]);
        cur.stem = line.replace(RE_Q, '');
        continue;
      }
      if (!cur) newQ('');

      if (mopt && ['stem', 'options'].includes(section)) {
        section = 'options';
        cur.options.push(`${mopt[1].toUpperCase()}. ${mopt[2].trim()}`);
        continue;
      }
      const mans = line.match(RE_ANS);
      if (mans && !mopt && !RE_ANA.test(line) && line.length < 200) {
        section = 'answer';
        cur.answer = (cur.answer ? cur.answer + ' ' : '') + mans[1].trim();
        continue;
      }
      const mana = line.match(RE_ANA);
      if (mana) {
        section = 'analysis';
        cur.analysis = (cur.analysis ? cur.analysis + '\n' : '') + mana[2].trim();
        continue;
      }
      const mknw = line.match(RE_KNW);
      if (mknw) { cur.knowledge = mknw[1].trim(); continue; }

      // 正文行
      if (section === 'stem') cur.stem += (cur.stem ? '\n' : '') + line;
      else if (section === 'options') cur.stem += '\n' + line; // 选项区里的普通行归回题干
      else if (section === 'answer') cur.answer += ' ' + line;
      else if (section === 'analysis') cur.analysis += '\n' + line;
    }
    flush();

    // 从题干/解析中提取【知识点】式标签
    for (const q of out) {
      if (q.knowledge) continue;
      const tags = [];
      for (const src of [q.stem, q.analysis]) {
        let m;
        RE_TAG.lastIndex = 0;
        while ((m = RE_TAG.exec(src))) {
          if (m[2] && !/^(答案|解析|分析|解答|题|注)$/.test(m[2]) && m[2].length <= 12 && !tags.includes(m[2])) tags.push(m[2]);
        }
      }
      q.knowledge = tags.slice(0, 3).join('、');
    }
    return { bankName: bankName || '导入题库', questions: out };
  }

  return { parse };
})();

// ---------- 刷题视图 ----------
Views.quiz = {
  state: { tab: 'practice', bankId: null, qIndex: 0 },

  render(container) {
    const st = this.state;
    if (!st.bankId) st.bankId = Store.coll('banks')[0]?.id || null;
    container.innerHTML = `
      <div class="tabs" id="quiz-tabs">
        <button class="tab ${st.tab === 'practice' ? 'active' : ''}" data-name="practice">📝 练习</button>
        <button class="tab ${st.tab === 'exam' ? 'active' : ''}" data-name="exam">🎯 模拟考试</button>
        <button class="tab ${st.tab === 'import' ? 'active' : ''}" data-name="import">📥 题库导入</button>
      </div>
      <div id="quiz-body"></div>`;
    UI.tabs(container.querySelector('#quiz-tabs'), container.querySelector('#quiz-body'), name => {
      st.tab = name;
      this.renderTab(container.querySelector('#quiz-body'));
    });
    this.renderTab(container.querySelector('#quiz-body'));
  },

  renderTab(body) {
    const st = this.state;
    body.innerHTML = `<div class="tab-panel ${st.tab === 'practice' ? 'active' : ''}" data-name="practice" id="panel-practice"></div>
                      <div class="tab-panel ${st.tab === 'exam' ? 'active' : ''}" data-name="exam" id="panel-exam"></div>
                      <div class="tab-panel ${st.tab === 'import' ? 'active' : ''}" data-name="import" id="panel-import"></div>`;
    if (st.tab === 'practice') this.renderPractice(body.querySelector('#panel-practice'));
    else if (st.tab === 'exam') this.renderExam(body.querySelector('#panel-exam'));
    else this.renderImport(body.querySelector('#panel-import'));
    Ktx.renderMath(body);
  },

  // ================= 导入 =================
  renderImport(panel) {
    panel.innerHTML = `
      <div class="card">
        <div class="card-title">导入题库（Markdown）</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-primary btn-sm" id="imp-file">选择 .md / .txt 文件</button>
          <button class="btn btn-sm" id="imp-sample">载入示例题库</button>
          <button class="btn btn-sm" id="imp-doc">格式规范</button>
        </div>
        <textarea class="textarea" id="imp-text" rows="8" placeholder="也可直接把题库文本粘贴到这里…&#10;支持：# 题库名 / ## 章节 / 1. 题干 / A. 选项 / 答案： / 解析： / 【知识点】"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="imp-parse">解析预览</button>
          <button class="btn" id="imp-ai" title="用大模型解析混乱格式的题库">✨ LLM 智能解析</button>
          <label class="checkbox-row" title="讲义/笔记里没有现成题目时，让 AI 基于原文内容命题（单选/多选/判断）">
            <input type="checkbox" id="imp-genmode"><span>📝 笔记出题模式</span>
          </label>
          <span class="muted">本地解析器离线可用；LLM 解析需在设置中配置 API</span>
        </div>
      </div>
      <div id="imp-preview"></div>`;

    panel.querySelector('#imp-file').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.md,.txt,.markdown';
      input.onchange = async () => {
        if (!input.files[0]) return;
        panel.querySelector('#imp-text').value = await input.files[0].text();
        UI.toast('已读入文件，点击「解析预览」');
      };
      input.click();
    };
    panel.querySelector('#imp-sample').onclick = async () => {
      const resp = await fetch('/sample/示例题库.md');
      panel.querySelector('#imp-text').value = await resp.text();
      UI.toast('示例题库已载入，点击「解析预览」');
    };
    panel.querySelector('#imp-doc').onclick = () => { location.hash = 'help'; };

    const doParse = async (useAI) => {
      const text = panel.querySelector('#imp-text').value;
      if (!text.trim()) return UI.toast('请先粘贴题库文本或载入示例', 'warn');
      const genMode = useAI && panel.querySelector('#imp-genmode')?.checked;
      let result;
      try {
        result = await (useAI
          ? AI.bankParse(text, genMode ? { mode: 'generate', maxChars: 150000 } : {})
          : Promise.resolve({ data: LocalBankParser.parse(text), demo: true }));
      } catch (e) {
        // LLM 解析失败回退本地解析
        if (useAI) {
          UI.toast(`LLM 解析失败（${e.message}），已回退本地规则解析`, 'warn');
          result = { data: LocalBankParser.parse(text), demo: true };
        } else return UI.toast(e.message, 'error');
      }
      this.showImportPreview(panel.querySelector('#imp-preview'), result.data, result.demo);
    };
    panel.querySelector('#imp-parse').onclick = () => doParse(false);
    panel.querySelector('#imp-ai').onclick = () => UI.busy(panel.querySelector('#imp-ai'), () => doParse(true), 'LLM 解析中');
  },

  showImportPreview(previewEl, data, demo) {
    if (!data.questions?.length) {
      previewEl.innerHTML = UI.emptyState('未能解析出题目：请检查题号/选项/答案的书写格式（点「格式规范」查看）');
      return;
    }
    const bankName = data.bankName || '导入题库';
    previewEl.innerHTML = `
      <div class="card">
        <div class="card-title">
          解析预览：<span style="color:var(--primary)">${U.esc(bankName)}</span>
          <span class="chip">${data.questions.length} 题</span>
          ${demo ? '<span class="chip">本地/演示解析</span>' : '<span class="chip chip-good">LLM 解析</span>'}
        </div>
        <div class="muted" style="margin-bottom:8px">若某题被错误拆分，点「并入上一题」合并；确认无误后保存入库。</div>
        <div class="import-preview" id="imp-list"></div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
          <input class="input" id="imp-bankname" style="max-width:280px" value="${U.esc(bankName)}" placeholder="题库名称">
          <button class="btn btn-primary" id="imp-save">保存入库</button>
        </div>
      </div>`;

    const questions = data.questions.map(q => ({ ...q, id: U.uid('q') }));
    const renderPreview = () => {
      const listEl = previewEl.querySelector('#imp-list');
      listEl.innerHTML = questions.map((q, i) => `
        <div class="pv-question">
          <div class="pv-head">
            <b>第 ${q.number || i + 1} 题 ${q.chapter ? `<span class="chip">${U.esc(q.chapter)}</span>` : ''} ${q.knowledge ? `<span class="chip chip-tag">${U.esc(q.knowledge)}</span>` : ''}</b>
            <span style="display:flex;gap:6px">
              ${i > 0 ? `<button class="btn btn-ghost btn-sm" data-merge="${i}">⇡ 并入上一题</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-del="${i}" style="color:var(--danger)">删除</button>
            </span>
          </div>
          <div class="pv-stem rich" style="margin-top:6px">${Sanitize.html(MD.toHtml(q.stem))}</div>
          ${q.options?.length ? `<div class="small" style="color:var(--ink-2);margin-top:4px">${q.options.map(U.esc).join('　')}</div>` : ''}
          ${q.answer ? `<div class="small" style="margin-top:4px"><span class="chip chip-good">答案</span> ${U.esc(q.answer)}</div>` : '<div class="small" style="color:var(--warn);margin-top:4px">⚠ 未识别到答案</div>'}
          ${q.analysis ? `<div class="small" style="color:var(--ink-3);margin-top:2px">解析：${U.esc(U.stripHtml(q.analysis).slice(0, 80))}…</div>` : ''}
        </div>`).join('');
      Ktx.renderMath(listEl);
      listEl.querySelectorAll('[data-merge]').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.merge;
        const prev = questions[i - 1], cur = questions[i];
        prev.stem += (prev.stem ? '\n' : '') + (cur.number ? `${cur.number}. ` : '') + cur.stem;
        if (cur.options?.length) prev.options = (prev.options || []).concat(cur.options);
        if (cur.answer) prev.answer = prev.answer ? `${prev.answer}\n${cur.number}. ${cur.answer}` : cur.answer;
        if (cur.analysis) prev.analysis = `${prev.analysis || ''}\n【${cur.number}】${cur.analysis}`;
        if (cur.knowledge && !prev.knowledge) prev.knowledge = cur.knowledge;
        questions.splice(i, 1);
        renderPreview();
      });
      listEl.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
        questions.splice(+btn.dataset.del, 1);
        renderPreview();
      });
    };
    renderPreview();

    previewEl.querySelector('#imp-save').onclick = () => {
      const name = previewEl.querySelector('#imp-bankname').value.trim() || bankName;
      if (!questions.length) return UI.toast('没有可保存的题目', 'warn');
      const bank = Store.insert('banks', {
        id: U.uid('bank'), name, createdAt: U.now(), updatedAt: U.now(),
        questions: questions.map(q => ({
          id: q.id || U.uid('q'), number: q.number || '', chapter: q.chapter || '',
          stem: q.stem || '', options: q.options || [], answer: q.answer || '',
          analysis: q.analysis || '', knowledge: q.knowledge || '',
        })),
      });
      this.state.bankId = bank.id;
      UI.toast(`题库「${name}」已入库（${bank.questions.length} 题）`, 'success');
      this.state.tab = 'practice';
      App.route('quiz');
    };
  },

  // ================= 练习 =================
  renderPractice(panel) {
    const banks = Store.coll('banks');
    const st = this.state;
    if (!banks.length) {
      panel.innerHTML = UI.emptyState('还没有题库，先去「题库导入」加一个吧', '<div style="margin-top:12px"><button class="btn btn-primary" id="go-import">去导入题库</button></div>');
      panel.querySelector('#go-import').onclick = () => { st.tab = 'import'; App.route('quiz'); };
      return;
    }
    const bank = Store.find('banks', st.bankId) || banks[0];
    st.bankId = bank.id;
    // 切换题库时重置题目索引；索引越界时钳制
    if (this._lastBank !== bank.id) { st.qIndex = 0; this._lastBank = bank.id; }
    st.qIndex = Math.min(st.qIndex, bank.questions.length - 1);
    panel.innerHTML = `
      <div class="quiz-layout">
        <div class="quiz-side">
          <div class="card" style="padding:12px">
            <div class="field-label">题库</div>
            <select class="select" id="bank-select">
              ${banks.map(b => `<option value="${b.id}" ${b.id === bank.id ? 'selected' : ''}>${U.esc(b.name)}（${b.questions.length}）</option>`).join('')}
            </select>
            <div id="q-nav" style="margin-top:10px;max-height:46vh;overflow-y:auto"></div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" id="rename-bank">重命名</button>
              <button class="btn btn-ghost btn-sm" id="manage-qs">管理题目</button>
            </div>
            <button class="btn btn-ghost btn-sm" id="del-bank" style="margin-top:8px;color:var(--danger)">删除当前题库</button>
          </div>
        </div>
        <div id="q-main"></div>
      </div>`;
    panel.querySelector('#bank-select').onchange = e => { st.bankId = e.target.value; st.qIndex = 0; this.renderTab(panel.closest('#quiz-body') || panel.parentElement); };
    panel.querySelector('#rename-bank').onclick = async () => {
      const name = await UI.prompt('重命名题库', bank.name);
      if (name && name !== bank.name) { Store.update('banks', bank.id, { name }); UI.toast('已重命名', 'success'); this.renderTab(panel.closest('#quiz-body') || panel.parentElement); }
    };
    panel.querySelector('#manage-qs').onclick = () => this.manageQuestions(bank);
    panel.querySelector('#del-bank').onclick = async () => {
      if (await UI.confirm(`删除题库「${bank.name}」及其全部题目？（作答记录保留）`, { danger: true })) {
        Store.remove('banks', bank.id);
        st.bankId = Store.coll('banks')[0]?.id || null;
        App.route('quiz');
      }
    };
    const navEl = panel.querySelector('#q-nav');
    const recordsOf = Store.coll('records');
    navEl.innerHTML = bank.questions.map((q, i) => {
      const recs = recordsOf.filter(r => r.questionId === q.id);
      const graded = recs.some(r => r.aiGrade);
      return `<div class="quiz-nav-item ${i === st.qIndex ? 'active' : ''}" data-i="${i}">
        <span>${U.esc(q.number || i + 1)}. ${U.esc(U.stripHtml(q.stem).replaceAll(/[$\\{}\[\]]/g, '').slice(0, 14))}</span>
        <span>${graded ? '✅' : recs.length ? '✏' : ''}</span>
      </div>`;
    }).join('');
    navEl.querySelectorAll('.quiz-nav-item').forEach(el => el.onclick = () => {
      st.qIndex = +el.dataset.i;
      this.renderTab(panel.closest('#quiz-body') || panel.parentElement);
    });
    this.renderQuestion(panel.querySelector('#q-main'), bank, bank.questions[st.qIndex] || bank.questions[0], st.qIndex);
  },

  renderQuestion(mainEl, bank, q, index) {
    if (!q) { mainEl.innerHTML = UI.emptyState('题库为空'); return; }
    const records = this.recordsOf(q);
    mainEl.innerHTML = `
      <div class="card q-card">
        <div class="q-meta">
          <span class="chip">第 ${U.esc(q.number || index + 1)} 题 / 共 ${bank.questions.length} 题</span>
          ${q.chapter ? `<span class="chip">${U.esc(q.chapter)}</span>` : ''}
          ${q.knowledge ? `<span class="chip chip-tag">${U.esc(q.knowledge)}</span>` : ''}
          <span style="flex:1"></span>
          <button class="btn btn-ghost btn-sm" id="q-prev" ${index <= 0 ? 'disabled' : ''}>← 上一题</button>
          <button class="btn btn-ghost btn-sm" id="q-next" ${index >= bank.questions.length - 1 ? 'disabled' : ''}>下一题 →</button>
        </div>
        <div class="q-stem rich">${Sanitize.html(MD.toHtml(q.stem))}</div>
        ${q.options?.length ? `<ul class="q-options">${q.options.map(o => `<li>${Sanitize.html(MD.toHtml(o))}</li>`).join('')}</ul>` : ''}
        <div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="q-showans">👁 查看答案与解析</button></div>
        <div id="q-answer-block" style="display:none">
          ${q.answer ? `<div class="q-analysis rich"><b>参考答案：</b>${Sanitize.html(MD.toHtml(q.answer))}</div>` : '<div class="q-analysis muted">题库未提供参考答案</div>'}
          ${q.analysis ? `<div class="q-analysis rich" style="border-left-color:var(--tpl)"><b>解析：</b>${Sanitize.html(MD.toHtml(q.analysis))}</div>` : ''}
        </div>
        <div class="section-title">作答区</div>
        ${this.answerAreaHtml()}
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center">
          <button class="btn" id="ans-save">保存作答</button>
          <button class="btn btn-primary" id="ans-grade">🤖 AI 批改</button>
          <button class="btn" id="ans-essence">💡 本质思路 + AI 评价</button>
          <button class="btn" id="ans-suggest-tags">🏷 AI 标签建议</button>
          <span class="muted" id="ocr-note" title="OCR 部署预留：后续可接 PaddleOCR 识别手写/照片文字">OCR：未启用（预留接口）</span>
        </div>
        <div style="display:flex;gap:14px;margin-top:14px;flex-wrap:wrap;align-items:center" id="archive-row">
          <b class="small">归档：</b>
          <label class="checkbox-row"><input type="checkbox" id="bk-wrong"><span style="color:var(--wrong)">错题本</span></label>
          <label class="checkbox-row"><input type="checkbox" id="bk-good"><span style="color:var(--good)">好题本</span></label>
          <label class="checkbox-row"><input type="checkbox" id="bk-tpl"><span style="color:var(--tpl)">模板本</span></label>
          <button class="btn btn-accent btn-sm" id="ans-archive">归档选中题本</button>
        </div>
        <div id="tag-row" style="margin-top:10px"></div>
        <div id="records-area"></div>
      </div>`;

    mainEl.querySelector('#q-prev').onclick = () => { this.state.qIndex = Math.max(0, index - 1); App.route('quiz'); };
    mainEl.querySelector('#q-next').onclick = () => { this.state.qIndex = Math.min(bank.questions.length - 1, index + 1); App.route('quiz'); };
    mainEl.querySelector('#q-showans').onclick = e => {
      const blk = mainEl.querySelector('#q-answer-block');
      blk.style.display = blk.style.display === 'none' ? 'block' : 'none';
      e.target.textContent = blk.style.display === 'none' ? '👁 查看答案与解析' : '🙈 收起答案与解析';
      Ktx.renderMath(blk);
    };
    Ktx.renderMath(mainEl.querySelector('.q-stem'));

    // ---------- 作答状态 ----------
    const draft = { text: '', imageDataUrl: null, mode: 'text' };
    this.bindAnswerArea(mainEl, draft);
    mainEl.querySelector('#ans-save').onclick = () => this.saveRecord(draft, q);
    mainEl.querySelector('#ans-grade').onclick = e => UI.busy(e.target, async () => {
      const rec = this.ensureRecord(draft, q);
      const img = draft.imageDataUrl || draft.drawDataUrl;
      const result = await AI.grade(q, { text: draft.text, hasImage: !!img, imageDataUrl: img });
      rec.aiGrade = { html: result.html, demo: result.demo, verdict: result.verdict || null, score: result.score ?? null, time: U.now() };
      if (draft.imageDataUrl && !rec.imageUrl) rec.imageUrl = await Api.upload(draft.imageDataUrl);
      else if (draft.drawDataUrl && !rec.imageUrl) rec.imageUrl = await Api.upload(draft.drawDataUrl);
      Store.save();
      this.renderRecords(mainEl.querySelector('#records-area'), q);
      UI.toast(result.demo ? '演示批改完成（配置 AI 后更精准）' : 'AI 批改完成', 'success');
    }, 'AI 批改中');

    mainEl.querySelector('#ans-essence').onclick = e => UI.busy(e.target, async () => {
      const rec = this.ensureRecord(draft, q);
      const gradeSummary = rec.aiGrade ? U.stripHtml(rec.aiGrade.html).slice(0, 200) : '';
      const result = await AI.essence(q, q.analysis, gradeSummary);
      rec.essence = { html: result.html, demo: result.demo, time: U.now() };
      Store.save();
      this.renderRecords(mainEl.querySelector('#records-area'), q);
      UI.toast('本质思路已生成', 'success');
    }, '生成中');

    mainEl.querySelector('#ans-suggest-tags').onclick = e => UI.busy(e.target, async () => {
      const result = await AI.tags(q, q.analysis);
      this.renderTagRow(mainEl.querySelector('#tag-row'), result.tags, q, draft);
      UI.toast('标签建议已生成（可增删后保存）', 'success');
    }, '生成标签');

    mainEl.querySelector('#ans-archive').onclick = async () => {
      if (!draft.text && !draft.imageDataUrl && !records.length) {
        if (!await UI.confirm('还没有作答记录，确定只把题目本身归档吗？')) return;
      }
      const kinds = [['bk-wrong', 'wrong'], ['bk-good', 'good'], ['bk-tpl', 'template']].filter(([id]) => mainEl.querySelector(`#${id}`).checked).map(([, k]) => k);
      if (!kinds.length) return UI.toast('请先勾选要归入的题本', 'warn');
      const latest = records[0];
      for (const kind of kinds) {
        Store.insert('entries', {
          id: U.uid('e'), kind, questionId: q.id, bankId: bank.id, recordId: latest?.id || null,
          snapshot: {
            stem: q.stem, options: q.options, answer: q.answer, analysis: q.analysis,
            number: q.number, chapter: q.chapter, knowledge: q.knowledge,
            bankName: bank.name,
          },
          myAnswer: { text: draft.text, imageUrl: draft.imageDataUrl, mode: draft.mode },
          aiGrade: latest?.aiGrade || null,
          essence: latest?.essence || null,
          tags: latest?.tags || [],
          createdAt: U.now(),
        });
      }
      Store.save();
      UI.toast(`已归档到：${kinds.map(k => ({ wrong: '错题本', good: '好题本', template: '模板本' })[k]).join('、')}`, 'success');
    };

    this.renderTagRow(mainEl.querySelector('#tag-row'), [], q, draft);
    this.renderRecords(mainEl.querySelector('#records-area'), q);
  },

  // ---------- 作答区（三 tab：文本/手写/照片） ----------
  answerAreaHtml() {
    return `
      <div class="answer-tabs">
        <div class="answer-tabs-head">
          <button class="atab active" data-a="text">⌨️ 文本作答</button>
          <button class="atab" data-a="draw">✍️ 手写作答</button>
          <button class="atab" data-a="photo">📷 上传照片</button>
        </div>
        <div class="answer-body">
          <div class="answer-panel active" data-a="text">
            <textarea class="textarea" id="ans-text" rows="4" placeholder="输入你的解答过程与结论…（公式可用 $...$ 书写）"></textarea>
          </div>
          <div class="answer-panel" data-a="draw">
            <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-sm" id="draw-clear">清空画板</button>
              <span class="muted">用鼠标/触屏手写解题过程，保存后随作答一起存档</span>
            </div>
            <div class="draw-canvas-wrap"><canvas id="draw-canvas" width="760" height="300"></canvas></div>
          </div>
          <div class="answer-panel" data-a="photo">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-sm" id="photo-pick">选择/拍摄照片</button>
              <span class="muted" id="photo-hint">支持拍照上传作答（多模态 AI 可直接批改图片）</span>
            </div>
            <div id="photo-preview" style="margin-top:8px"></div>
          </div>
        </div>
      </div>`;
  },

  bindAnswerArea(mainEl, draft) {
    const tabsEl = mainEl.querySelector('.answer-tabs-head');
    tabsEl.querySelectorAll('.atab').forEach(btn => btn.onclick = () => {
      tabsEl.querySelectorAll('.atab').forEach(b => b.classList.toggle('active', b === btn));
      mainEl.querySelectorAll('.answer-panel').forEach(p => p.classList.toggle('active', p.dataset.a === btn.dataset.a));
      draft.mode = btn.dataset.a;
      if (btn.dataset.a === 'draw') this.initDrawCanvas(mainEl, draft);
    });
    mainEl.querySelector('#ans-text').addEventListener('input', e => { draft.text = e.target.value; draft.mode = draft.imageDataUrl ? draft.mode : 'text'; });

    // 手写板
    this.initDrawCanvas(mainEl, draft);
    mainEl.querySelector('#draw-clear').onclick = () => this.initDrawCanvas(mainEl, draft, true);

    // 照片
    mainEl.querySelector('#photo-pick').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
      input.onchange = async () => {
        if (!input.files[0]) return;
        draft.imageDataUrl = await U.compressDataURL(await U.readFileDataURL(input.files[0]));
        mainEl.querySelector('#photo-preview').innerHTML = `<img src="${draft.imageDataUrl}" style="max-height:220px;border-radius:8px;border:1px solid var(--line)">`;
        UI.toast('照片已就绪，保存作答或直接 AI 批改');
      };
      input.click();
    };
  },

  initDrawCanvas(mainEl, draft, clear) {
    const canvas = mainEl.querySelector('#draw-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (clear) { draft.drawDataUrl = null; return; }
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#26231d';
    let drawing = false;
    const pos = e => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
    };
    canvas.onpointerdown = e => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill();
    };
    canvas.onpointermove = e => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
    canvas.onpointerup = () => {
      drawing = false;
      draft.drawDataUrl = canvas.toDataURL('image/png');
    };
  },

  ensureRecord(draft, q) {
    // 同一份草稿复用同一条记录（批改/本质/标签都写在这条上），保存图片后保留历史
    if (draft.recordId) {
      const rec = Store.find('records', draft.recordId);
      if (rec) return rec;
    }
    const text = draft.text?.trim() || '';
    const record = {
      id: U.uid('r'), questionId: q.id, bankId: this.state.bankId,
      mode: draft.imageDataUrl ? 'photo' : draft.drawDataUrl ? 'draw' : 'text',
      text, imageUrl: '', createdAt: U.now(), tags: [],
    };
    Store.insert('records', record);
    draft.recordId = record.id;
    return record;
  },

  async saveRecord(draft, q) {
    const rec = this.ensureRecord(draft, q);
    if (draft.imageDataUrl) rec.imageUrl = await Api.upload(draft.imageDataUrl);
    else if (draft.drawDataUrl) rec.imageUrl = await Api.upload(draft.drawDataUrl);
    Store.save();
    UI.toast('作答已保存', 'success');
    App.route('quiz');
  },

  recordsOf(q) {
    return Store.coll('records')
      .filter(r => r.questionId === q.id)
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  },

  renderTagRow(rowEl, suggestions, q, draft) {
    const latestRec = this.recordsOf(q)[0];
    const tags = [...new Set([...(latestRec?.tags || []), ...(suggestions || [])])];
    rowEl.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <b class="small">知识点标签：</b>
        <span id="tag-chips">${tags.map(t => `<span class="chip chip-tag">${U.esc(t)}<span class="chip-x" data-t="${U.esc(t)}">×</span></span>`).join('') || '<span class="muted">暂无</span>'}</span>
        <input class="input" id="tag-input" style="max-width:160px" placeholder="手动添加标签">
        <button class="btn btn-sm" id="tag-add">＋</button>
        <button class="btn btn-sm btn-primary" id="tag-save">保存标签到最新记录</button>
      </div>`;
    const persist = () => {
      const latest = this.recordsOf(q)[0];
      if (!latest) return UI.toast('请先保存一次作答再绑定标签', 'warn');
      latest.tags = tags;
      Store.save();
      UI.toast('标签已保存', 'success');
    };
    rowEl.querySelector('#tag-chips')?.addEventListener('click', e => {
      const x = e.target.closest('.chip-x');
      if (!x) return;
      const i = tags.indexOf(x.dataset.t);
      if (i >= 0) tags.splice(i, 1);
      this.renderTagRow(rowEl, tags, q, draft);
    });
    rowEl.querySelector('#tag-add').onclick = () => {
      const v = rowEl.querySelector('#tag-input').value.trim();
      if (v && !tags.includes(v)) { tags.push(v); this.renderTagRow(rowEl, tags, q, draft); }
    };
    rowEl.querySelector('#tag-save').onclick = persist;
  },

  renderRecords(areaEl, q) {
    const records = this.recordsOf(q);
    if (!records.length) {
      areaEl.innerHTML = '<div class="section-title">作答记录</div><div class="muted">还没有作答记录。作答后点「保存作答」或直接「AI 批改」。</div>';
      return;
    }
    areaEl.innerHTML = `<div class="section-title">作答记录（${records.length}）</div>` + records.map((r, i) => `
      <div class="record-card" data-rid="${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <b>#${records.length - i}　${U.fmt(r.createdAt)}</b>
          <span style="display:flex;gap:6px;align-items:center">
            ${r.tags?.length ? r.tags.map(t => `<span class="chip chip-tag">${U.esc(t)}</span>`).join('') : ''}
            <button class="btn btn-ghost btn-sm" data-del-rec="${r.id}" style="color:var(--danger)">删除</button>
          </span>
        </div>
        ${r.text ? `<div class="rich" style="margin-top:6px"><b>我的作答：</b>${Sanitize.html(MD.toHtml(r.text))}</div>` : ''}
        ${r.imageUrl ? `<img src="${r.imageUrl}" style="max-height:180px;border-radius:8px;margin-top:6px;border:1px solid var(--line)">` : ''}
        ${r.aiGrade ? `<div class="section-title" style="font-size:14px">AI 批改报告</div><div class="ai-report">${r.aiGrade.html}${r.aiGrade.demo ? '<div class="ai-demo-badge">⚑ 演示模式输出</div>' : ''}</div>` : ''}
        ${r.essence ? `<div class="section-title" style="font-size:14px">本质思路 + AI 评价</div><div class="ai-report">${r.essence.html}${r.essence.demo ? '<div class="ai-demo-badge">⚑ 演示模式输出</div>' : ''}</div>` : ''}
      </div>`).join('');
    Ktx.renderMath(areaEl);
    areaEl.querySelectorAll('[data-del-rec]').forEach(btn => btn.onclick = async () => {
      if (await UI.confirm('删除这条作答记录？', { danger: true })) {
        Store.remove('records', btn.dataset.delRec);
        App.route('quiz');
      }
    });
  },
  // ================= 模拟考试 =================
  renderExam(panel) {
    const banks = Store.coll('banks');
    if (!banks.length) {
      panel.innerHTML = UI.emptyState('还没有题库，先去「题库导入」加一个吧');
      return;
    }
    const exams = Store.coll('exams').slice(0, 8);
    panel.innerHTML = `
      <div class="card">
        <div class="card-title">🎯 组卷配置</div>
        <div class="form-row">
          <div class="field"><label class="field-label">题量</label>
            <select class="select" id="ex-count"><option value="10">10 题</option><option value="20" selected>20 题</option><option value="30">30 题</option><option value="all">全部</option></select></div>
          <div class="field"><label class="field-label">范围</label>
            <select class="select" id="ex-scope"><option value="all">全部题库</option>${banks.map(b => `<option value="${b.id}">${U.esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label">时长（分钟）</label>
            <input class="input" id="ex-duration" type="number" min="5" max="300" value="45"></div>
        </div>
        <div class="field-hint">客观题按选项自动判分，主观题标记后可逐题请求 AI 解析；错题自动归档错题本</div>
        <button class="btn btn-primary" id="ex-start">🚀 开始考试</button>
      </div>
      ${exams.length ? `<div class="section-title">历史成绩</div>` + exams.map(e => `
        <div class="record-card" style="display:flex;gap:10px;align-items:center">
          <b style="color:${e.score >= 60 ? 'var(--good)' : 'var(--wrong)'}">${e.score} 分</b>
          <span class="small">${e.total} 题 · 错 ${e.wrongCount} · 未答 ${e.unanswered}</span>
          <span class="muted small" style="flex:1">${U.fmt(e.finishedAt)}</span>
          <span class="chip">${U.esc(e.scopeName || '')}</span>
        </div>`).join('') : ''}`;

    panel.querySelector('#ex-start').onclick = () => {
      const scope = panel.querySelector('#ex-scope').value;
      const count = panel.querySelector('#ex-count').value;
      const duration = U.clamp(+panel.querySelector('#ex-duration').value || 45, 5, 300);
      const pool = (scope === 'all' ? banks.flatMap(b => b.questions.map(q => ({ ...q, bankName: b.name })))
        : (Store.find('banks', scope)?.questions || []).map(q => ({ ...q, bankName: Store.find('banks', scope).name })));
      if (pool.length < 3) return UI.toast('题量不足（至少 3 题）', 'warn');
      // 洗牌取前 N
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const qids = shuffled.slice(0, count === 'all' ? pool.length : Math.min(+count, pool.length));
      this.exam = { questions: qids, answers: {}, startedAt: Date.now(), durationMs: duration * 60000, scopeName: scope === 'all' ? '全部题库' : Store.find('banks', scope).name };
      this.renderExamRunner(panel);
    };
  },

  renderExamRunner(panel) {
    const ex = this.exam;
    if (!this._examTimer) clearInterval(this._examTimer);
    const renderQ = () => {
      const i = this.examIdx || 0;
      const q = ex.questions[i];
      const left = Math.max(0, ex.durationMs - (Date.now() - ex.startedAt));
      const mm = String(Math.floor(left / 60000)).padStart(2, '0');
      const ss = String(Math.floor(left % 60000 / 1000)).padStart(2, '0');
      panel.innerHTML = `
        <div class="card q-card">
          <div class="q-meta">
            <span class="chip">第 ${i + 1} / ${ex.questions.length} 题</span>
            ${q.chapter ? `<span class="chip">${U.esc(q.chapter)}</span>` : ''}
            <span class="exam-timer" style="margin-left:auto" id="ex-timer">⏱ ${mm}:${ss}</span>
          </div>
          <div class="q-stem rich">${Sanitize.html(MD.toHtml(q.stem))}</div>
          ${q.options?.length ? `<ul class="q-options">${q.options.map(o => `<li>${Sanitize.html(MD.toHtml(o))}</li>`).join('')}</ul>` : ''}
          <div class="section-title">作答（考试模式不显示答案）</div>
          <textarea class="textarea" id="ex-answer" rows="3" placeholder="写下选项或解答…">${U.esc(ex.answers[q.id] || '')}</textarea>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" id="ex-prev" ${i <= 0 ? 'disabled' : ''}>← 上一题</button>
            <button class="btn btn-ghost btn-sm" id="ex-next" ${i >= ex.questions.length - 1 ? 'disabled' : ''}>下一题 →</button>
            <span style="flex:1"></span>
            <button class="btn btn-accent" id="ex-submit">交卷</button>
          </div>
          <div style="display:flex;gap:4px;margin-top:10px;flex-wrap:wrap">${ex.questions.map((qq, k) =>
            `<span class="chip ${ex.answers[qq.id] ? 'chip-good' : ''}" style="cursor:pointer" data-jump="${k}">${k + 1}</span>`).join('')}</div>
        </div>`;
      panel.querySelector('#ex-answer').oninput = e => { ex.answers[q.id] = e.target.value; };
      panel.querySelector('#ex-prev').onclick = () => { this.examIdx = i - 1; renderQ(); };
      panel.querySelector('#ex-next').onclick = () => { this.examIdx = i + 1; renderQ(); };
      panel.querySelectorAll('[data-jump]').forEach(c => c.onclick = () => { this.examIdx = +c.dataset.jump; renderQ(); });
      panel.querySelector('#ex-submit').onclick = () => this.submitExam(panel);
      this._renderQ = renderQ;
    };
    renderQ();
    this._examTimer = setInterval(() => {
      const left = ex.durationMs - (Date.now() - ex.startedAt);
      if (left <= 0) { clearInterval(this._examTimer); this._examTimer = null; UI.toast('考试时间到，自动交卷', 'warn'); this.submitExam(panel); return; }
      const t = panel.querySelector('#ex-timer');
      if (t) t.textContent = `⏱ ${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor(left % 60000 / 1000)).padStart(2, '0')}`;
    }, 1000);
  },

  examCheck(q, given) {
    const givenText = U.stripHtml(given || '');
    if (!givenText) return null;
    const correctLetters = (q.answer || '').toUpperCase().match(/[A-K]/g) || [];
    if (q.options?.length && correctLetters.length) {
      const letters = givenText.toUpperCase().match(/[A-K]/g) || [];
      if (!letters.length) return null;
      const set = new Set(letters);
      return correctLetters.every(l => set.has(l));
    }
    const a = Sim.normalize(q.answer || ''), b = Sim.normalize(givenText);
    if (!a || a.length < 2) return null;
    return b.includes(a.slice(0, Math.min(20, a.length)));
  },

  async submitExam(panel) {
    if (this._examTimer) { clearInterval(this._examTimer); this._examTimer = null; }
    const ex = this.exam;
    const results = ex.questions.map(q => {
      const given = ex.answers[q.id] || '';
      const verdict = this.examCheck(q, given);
      return { q, given, verdict };
    });
    const answered = results.filter(r => r.verdict !== null);
    const correct = results.filter(r => r.verdict === true).length;
    const score = answered.length ? Math.round(correct / ex.questions.length * 100) : 0;
    const wrongList = results.filter(r => r.verdict !== true);
    // 错题自动归档错题本
    for (const r of wrongList) {
      Store.insert('entries', {
        id: U.uid('e'), kind: 'wrong', questionId: r.q.id, recordId: null,
        snapshot: { stem: r.q.stem, options: r.q.options, answer: r.q.answer, analysis: r.q.analysis, number: r.q.number, chapter: r.q.chapter, knowledge: r.q.knowledge, bankName: r.q.bankName, exam: true },
        myAnswer: { text: r.given, mode: 'text' }, tags: ['模拟考试'],
        createdAt: U.now(),
      });
    }
    Store.insert('exams', {
      id: U.uid('exam'), scopeName: ex.scopeName, total: ex.questions.length,
      correct, wrongCount: wrongList.filter(r => r.verdict === false).length,
      unanswered: results.filter(r => r.verdict === null).length,
      score, results: results.map(r => ({ qid: r.q.id, given: r.given, verdict: r.verdict })),
      finishedAt: U.now(),
    });
    this.exam = null;
    panel.innerHTML = `
      <div class="card" style="text-align:center;padding:30px">
        <div style="font-size:44px">${score >= 60 ? '🎉' : '💪'}</div>
        <div class="card-title" style="justify-content:center;font-size:26px">${score} 分</div>
        <div class="muted">${ex.questions.length} 题 · 正确 ${correct} · 错误 ${wrongList.filter(r => r.verdict === false).length} · 未答 ${results.filter(r => r.verdict === null).length} · 错题已自动归档错题本（${wrongList.length}）</div>
      </div>
      <div class="section-title">逐题结果</div>
      ${results.map((r, i) => `
        <div class="record-card" data-exq="${i}">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="chip ${r.verdict === true ? 'chip-good' : r.verdict === false ? 'chip-wrong' : ''}">${r.verdict === true ? '✓ 正确' : r.verdict === false ? '✗ 错误' : '— 未答'}</span>
            <b class="small">${U.esc(r.q.number || i + 1)}.</b>
            <span class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(U.stripHtml(r.q.stem).slice(0, 46))}</span>
            ${r.verdict !== true && AI.live() ? `<button class="btn btn-sm" data-ai="${i}">🤖 AI 解析此题</button>` : ''}
          </div>
          ${r.given ? `<div class="small" style="color:var(--ink-2);margin-top:4px">我的作答：${U.esc(r.given.slice(0, 80))}</div>` : ''}
          ${r.verdict !== true && r.q.answer ? `<div class="small" style="margin-top:2px"><span class="chip chip-good">参考答案</span> ${U.esc(U.stripHtml(r.q.answer).slice(0, 60))}</div>` : ''}
          <div class="ai-exam-report"></div>
        </div>`).join('')}
      <div style="margin-top:14px"><button class="btn btn-primary" id="ex-back">返回考试中心</button></div>`;
    panel.querySelector('#ex-back').onclick = () => this.renderExam(panel);
    panel.querySelectorAll('[data-ai]').forEach(btn => btn.onclick = async e => {
      const i = +btn.dataset.ai;
      const r = results[i];
      await UI.busy(btn, async () => {
        const res = await AI.grade(r.q, { text: r.given, hasImage: false });
        const card = panel.querySelector(`[data-exq="${i}"] .ai-exam-report`);
        card.innerHTML = `<div class="section-title" style="font-size:14px">AI 解析</div><div class="ai-report">${res.html}</div>`;
        Ktx.renderMath(card);
      }, 'AI 解析中');
    });
    Ktx.renderMath(panel);
    UI.toast('考试完成，错题已归档', 'success');
  },

  // ================= 题目增删改查 =================
  manageQuestions(bank) {
    let m;
    const renderList = () => {
      m.bodyEl.querySelector('#mq-list').innerHTML = bank.questions.map((q, i) => `
        <div style="display:flex;gap:8px;align-items:center;padding:7px 4px;border-bottom:1px dashed var(--line)">
          <span class="chip">${U.esc(q.number || i + 1)}</span>
          <span class="small" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${U.esc(U.stripHtml(q.stem).slice(0, 52))}</span>
          <button class="btn btn-sm" data-edit="${i}">编辑</button>
          <button class="btn btn-sm btn-ghost" data-del="${i}" style="color:var(--danger)">删除</button>
        </div>`).join('') || '<div class="muted">题库为空</div>';
      m.bodyEl.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => this.editQuestionModal(bank, bank.questions[+b.dataset.edit], renderList));
      m.bodyEl.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (await UI.confirm('删除这道题目？（已归档条目不受影响）', { danger: true })) {
          bank.questions.splice(+b.dataset.del, 1);
          Store.update('banks', bank.id, { questions: bank.questions });
          renderList();
        }
      });
    };
    m = UI.modal({
      title: `题目管理 · ${bank.name}`, width: 780, raw: true,
      body: `<div id="mq-list"></div>
        <button class="btn btn-primary" id="mq-add" style="margin-top:10px">＋ 手动添加题目</button>`,
      actions: [{ label: '完成', primary: true }],
    });
    m.bodyEl.querySelector('#mq-add').onclick = () => this.editQuestionModal(bank, null, renderList);
    renderList();
  },

  editQuestionModal(bank, q, onDone) {
    let m;
    m = UI.modal({
      title: q ? `编辑题目 ${q.number || ''}` : '添加题目', width: 720, raw: true,
      body: `
        <div class="form-row">
          <div class="field"><label class="field-label">题号</label><input class="input" id="eq-number" value="${U.esc(q?.number || '')}"></div>
          <div class="field"><label class="field-label">章节</label><input class="input" id="eq-chapter" value="${U.esc(q?.chapter || '')}"></div>
          <div class="field"><label class="field-label">知识点</label><input class="input" id="eq-knowledge" value="${U.esc(q?.knowledge || '')}"></div>
        </div>
        <div class="field"><label class="field-label">题干（支持 markdown / $公式$ / 原生 HTML 表格）</label>
          <textarea class="textarea" id="eq-stem" rows="4">${U.esc(q?.stem || '')}</textarea></div>
        <div class="field"><label class="field-label">选项（每行一个，如 A. xxx；无选项留空）</label>
          <textarea class="textarea" id="eq-options" rows="3">${U.esc((q?.options || []).join('\n'))}</textarea></div>
        <div class="form-row">
          <div class="field"><label class="field-label">答案</label><input class="input" id="eq-answer" value="${U.esc(q?.answer || '')}"></div>
        </div>
        <div class="field"><label class="field-label">解析</label>
          <textarea class="textarea" id="eq-analysis" rows="3">${U.esc(q?.analysis || '')}</textarea></div>`,
      actions: [
        { label: '取消' },
        { label: '保存', primary: true, onClick: close => {
          const stem = m.el.querySelector('#eq-stem').value.trim();
          if (!stem) return UI.toast('题干不能为空', 'warn');
          const patch = {
            number: m.el.querySelector('#eq-number').value.trim() || String(bank.questions.length + 1),
            chapter: m.el.querySelector('#eq-chapter').value.trim(),
            knowledge: m.el.querySelector('#eq-knowledge').value.trim(),
            stem,
            options: m.el.querySelector('#eq-options').value.split('\n').map(x => x.trim()).filter(Boolean),
            answer: m.el.querySelector('#eq-answer').value.trim(),
            analysis: m.el.querySelector('#eq-analysis').value.trim(),
          };
          if (q) Object.assign(q, patch);
          else bank.questions.push({ id: U.uid('q'), ...patch });
          Store.update('banks', bank.id, { questions: bank.questions });
          UI.toast(q ? '题目已更新' : '题目已添加', 'success');
          onDone && onDone();
          close();
        } },
      ],
    });
  },
};
