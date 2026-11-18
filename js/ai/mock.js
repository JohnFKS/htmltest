// 演示模式：未配置真实 AI 时的本地模拟输出（全部明确标注「演示」）
// 目的：保证导入→作答→批改→归档→模板→相似度全流程离线可走通
window.Mock = (() => {
  const badge = '<div class="ai-demo-badge">⚑ 演示模式输出（未配置大模型，仅模拟格式）</div>';

  function keywordsOf(text) {
    const found = window.Sim.KEYWORDS.filter(k => (text || '').includes(k));
    return found.slice(0, 6);
  }

  function hashScore(str, lo, hi) {
    let h = 0;
    for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) % 997;
    return lo + (h % (hi - lo + 1));
  }

  function grade(question, answer) {
    const ansText = (answer.text || '').trim();
    const ref = U.stripHtml(question.answer || '');
    let verdict, score, color, comment;
    if (!ansText && !answer.hasImage) {
      verdict = '未作答'; score = 0; color = 'hl-bad';
      comment = '没有检测到任何作答内容。先把思路写下来，哪怕是错的也有分析价值。';
    } else if (ansText && ref && Sim.normalize(ref).length > 2 && Sim.normalize(ansText).includes(Sim.normalize(ref).slice(0, Math.min(12, Sim.normalize(ref).length)))) {
      verdict = '正确'; score = hashScore(ansText, 88, 100); color = 'hl-good';
      comment = '关键结论与参考答案一致，步骤完整度良好。';
    } else if (ansText.length >= 12 || answer.hasImage) {
      verdict = '部分正确'; score = hashScore(ansText, 45, 72); color = 'hl-warn';
      comment = '能看出作答思路，但与参考解法存在偏差：可能是关键步骤缺失或模型识别不对。';
    } else {
      verdict = '错误'; score = hashScore(ansText, 12, 38); color = 'hl-bad';
      comment = '作答过于简短或方向不对，建议回看题目考察的核心模型。';
    }
    const kws = keywordsOf(U.stripHtml(question.stem));
    const vmap = { '正确': 'correct', '部分正确': 'partial', '错误': 'wrong', '未作答': 'wrong' };
    return { verdict: vmap[verdict] || null, score, html: `${badge}
<h4>批改结论</h4>
<p>判定：<span class="${color}">${verdict}</span>　得分：<b>${score}</b> / 100</p>
<p>${comment}</p>
<h4>独立求解</h4>
<details><summary>展开演示解题过程（模拟）</summary>
<p><span class="muted">演示模式不调用真实大模型，以下为占位过程：</span></p>
<ol><li>审题，识别考察对象${kws.length ? `（检测到关键词：${kws.map(k => `<span class="tag">${k}</span>`).join('')}）` : ''}</li>
<li>建立模型并选择通法</li><li>执行计算与推理</li><li>检验结果合理性</li></ol></details>
<h4>对比分析</h4>
<ul><li>结论层：学生结论与参考答案的对应关系见上方判定</li>
<li>过程层：演示模式无法逐行核对手写过程，配置真实 AI 后可获得逐步对比</li></ul>
<h4>评分细则</h4>
<table><thead><tr><th>步骤</th><th>分值</th><th>学生表现</th><th>得分</th></tr></thead>
<tbody>
<tr><td>识别模型/列式</td><td>30</td><td>${verdict === '错误' ? '未识别' : '部分达成'}</td><td>${Math.round(score * 0.3)}</td></tr>
<tr><td>推理/计算过程</td><td>40</td><td>${score > 60 ? '基本完整' : '存在缺口'}</td><td>${Math.round(score * 0.4)}</td></tr>
<tr><td>结论正确性</td><td>30</td><td>${verdict === '正确' ? '正确' : '有误'}</td><td>${Math.round(score * 0.3)}</td></tr>
</tbody></table>
<h4>改进建议</h4>
<ul><li>对照解析，定位自己的第一处偏差（从哪一步开始分叉）</li>
<li>把本题的"本质思路"记入错题本，用模板本固化通法</li>
<li>配置真实大模型 API 后，此处将输出针对你作答的逐句分析</li></ul>`, demo: true };
  }

  function essence(question, analysis, gradeSummary) {
    const stem = U.stripHtml(question.stem || '');
    const kws = keywordsOf(stem);
    const model = kws[0] || '综合应用';
    return { html: `${badge}
<h4>本质思路</h4>
<h5>核心模型</h5>
<p>本题表面是${kws[1] || '一道常规题'}，底层考察<b>${model}</b>相关的模型与思想：把题设条件翻译成数学对象 → 用${model}的通法处理 → 回到题目要求作答。</p>
<h5>通法拆解</h5>
<ol><li>圈出条件与目标，明确"已知什么、求什么"</li><li>把文字条件翻译为符号/图形语言</li><li>选择${model}的标准流程执行</li><li>检查定义域、取值范围与实际意义</li></ol>
<h5>常见易错点</h5>
<ul><li>忽略隐藏条件（定义域/取值范围）</li><li>分类讨论不完整，漏掉边界情形</li><li>计算失误导致后续全错，建议关键节点回验</li></ul>
<h4>AI 评价</h4>
<p>${gradeSummary ? '结合你的作答：' + U.esc(gradeSummary.slice(0, 60)) + '……' : '暂无作答记录'}。本题${kws.length ? `围绕 ${kws.slice(0, 3).join('、')}` : ''}是适合反复研习的典型题，建议研读本质思路后归入对应题本并生成做题模板。</p>`, demo: true };
  }

  function tags(question, analysis) {
    const kws = keywordsOf(U.stripHtml(question.stem || '') + ' ' + U.stripHtml(analysis || ''));
    const tags = kws.length >= 3 ? kws.slice(0, 6) : ['数学', '综合题', '基础训练', '通法演练'];
    return { tags, demo: true };
  }

  function templateGen(question, analysis, essenceHtml) {
    const stem = U.stripHtml(question.stem || '');
    const kws = keywordsOf(stem);
    const name = kws[0] ? `${kws[0]}典型题·通法模板` : `典型题·通法模板`;
    return { data: {
      name,
      essence: `以${kws[0] || '核心'}模型为主线的解题模板：识别特征 → 建立模型 → 按通法执行 → 检验作答。`,
      signals: kws.length ? kws.slice(0, 4) : ['题干出现待求量与已知条件的明确对应关系'],
      steps: ['圈出条件与目标', '翻译条件为符号/图形语言', `套用${kws[0] || '核心'}通法逐步执行`, '检查定义域与边界', '回代验证并规范书写'],
      disguises: ['换一个实际情境包装同一模型', '把已知与所求互换（逆向设问）', '增加参数需要分类讨论'],
      pitfalls: ['漏掉隐藏的定义域/取值范围', '分类讨论不完整', '计算失误未回验'],
      summary: '演示生成的模板骨架，配置真实 AI 后将得到针对本题的精准归纳。',
    }, demo: true };
  }

  function expand(template) {
    return { data: {
      newDisguises: ['与数列/不等式小综合（新增）', '以图像信息代替解析式给出条件（新增）'],
      newPitfalls: ['图像读数误差导致模型选错（新增）'],
      variants: [
        { title: '变式一（演示）', description: '把结论改为存在性提问（"是否存在…使得…"），解题前半段不变，末段增加存在性判定。' },
        { title: '变式二（演示）', description: '增加恒成立条件，转化为最值问题，通法步骤 3 替换为求最值流程。' },
      ],
      note: '演示模式扩容，配置真实 AI 后由大模型依据模板内容定制生成。',
    }, demo: true };
  }

  function verdict(hybrid, threshold) {
    const same = hybrid.score >= threshold;
    return { data: {
      same_type: same,
      confidence: Math.min(0.95, Math.round((hybrid.score + 0.08) * 100) / 100),
      reason: `演示裁决：混合相似度 ${hybrid.score}（≥ 阈值 ${threshold} 判同类）。分项：bigram Jaccard ${hybrid.parts.jaccard}、TF-IDF 余弦 ${hybrid.parts.tfidf}、关键词重叠 ${hybrid.parts.keyword}。`,
      advice: same ? 'merge' : 'new',
    }, demo: true };
  }

  function ask(questionText, shape) {
    return { html: `${badge}
<h4>演示回答</h4>
<p>你在图上用<b>${U.esc(shape)}</b>圈出的区域已收到（多模态答疑需要配置视觉模型）。</p>
<ul><li>关于"${U.esc((questionText || '').slice(0, 40))}"：请先确认圈选区域对应的题面条件/步骤</li>
<li>建议：把圈选处的"这一步在做什么"用一句话写出来，往往卡点就解开了</li>
<li>配置真实多模态 API 后，这里将基于圈选图像给出针对性讲解</li></ul>`, demo: true };
  }

  // 演示：从笔记生成练习题（摘取原句做判断题，标注演示）
  function notesGen(raw) {
    const sentences = String(raw || '')
      .replace(/<[^>]+>/g, ' ')
      .split(/[。；\n]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 15 && s.length <= 90 && /[一-龥]/.test(s) && !/微信|课件|资料/.test(s));
    const seen = new Set();
    const picks = [];
    for (const s of sentences) {
      const head = s.slice(0, 20);
      if (seen.has(head)) continue;
      seen.add(head);
      picks.push(s);
      if (picks.length >= 5) break;
    }
    if (!picks.length) picks.push('未能在文本中找到可用的知识点语句（演示）');
    return { data: {
      bankName: '笔记出题（演示）',
      questions: picks.map((s, i) => ({
        number: String(i + 1), chapter: '', stem: `判断：「${s}」这一表述与原文一致。`,
        options: ['A. 正确', 'B. 错误'], answer: 'A',
        analysis: `原文语句：「${s}」。此为演示模式的摘句判断题，配置真实 AI 后将生成规范的单选/多选题。`,
        knowledge: '',
      })),
    }, demo: true };
  }

  // 演示：右键选中文本答疑
  function ctxAsk(selection, question) {
    return { html: `${badge}
<h4>演示回答</h4>
<p>针对选中文本「${U.esc(String(selection || '').slice(0, 60))}」的问题「${U.esc(String(question || '').slice(0, 40))}」：</p>
<ul><li>演示模式不调用真实大模型，此处为占位回答</li>
<li>配置真实 AI 后，这里将基于选中文本给出针对性讲解（HTML 报告，支持表格与公式）</li></ul>`, demo: true };
  }

  // 演示：笔记右侧多轮对话（承接轮次，明确标注演示）
  function ctxChat({ selection, question, history = [], noteTitle, summary = '', context = {} } = {}) {
    const turns = history.filter(m => m.role === 'user').length;
    const sel = String(selection || '').trim().slice(0, 80);
    return { html: `${badge}
<h4>演示回答 · 第 ${turns + 1} 轮</h4>
<p>围绕「${U.esc(noteTitle || '当前笔记')}」，你问的是「${U.esc(String(question || '').slice(0, 60))}」${sel ? `，本轮选中文本是「${U.esc(sel)}」` : ''}。</p>
<ul>
<li>演示模式不调用真实大模型：这里展示的是分层上下文的排版与占位。</li>
<li>${turns ? `已识别到前文 ${turns} 轮；本轮送入近期对话 ${context.recent || 0} 条、相关历史召回 ${context.recalled || 0} 条。` : '这是本会话的第一轮；配置真实 AI 后将基于整篇笔记与选中文本作答。'}</li>
<li>${summary ? '已加载长期记忆摘要；旧对话不会再逐字重复送入模型。' : '暂无长期记忆摘要；对话变长后会自动压缩旧轮次。'}</li>
<li>配置真实 AI 后，答案会用表格、公式与折叠块呈现，并支持一键追加回当前笔记。</li>
</ul>`, demo: true, context };
  }

  // 演示：本地抽取式压缩（不调用模型，保留最近问答要点）
  function compactChat({ summary = '', messages = [] } = {}) {
    const points = (messages || []).map(m => {
      const text = U.stripHtml(U.asText(m.role === 'assistant' ? (m.html || m.text || '') : (m.text || ''))).slice(0, 90);
      return `- ${m.role === 'user' ? '问' : '答'}：${text}`;
    }).slice(-8);
    const text = [`${U.asText(summary || '').slice(0, 1000)}`, '⚑ 演示压缩（配置真实 AI 后生成结构化摘要）', ...points].filter(Boolean).join('\n').slice(0, 1800);
    return { text, demo: true };
  }

  // 演示：从题目生成复习卡片（本地规则，无需 LLM）
  function makeCards(question, analysis) {
    const stem = U.stripHtml(question.stem || '').slice(0, 120);
    const ans = U.stripHtml(question.answer || '').slice(0, 60) || '见解析';
    const kws = keywordsOf(U.stripHtml(question.stem || ''));
    const cards = [
      { front: `【${kws[0] || '考点'}】${stem.length > 40 ? stem.slice(0, 40) + '……这道题考察什么？' : '这道题的答案是什么？'}`, back: ans },
    ];
    if (kws[1]) cards.push({ front: `「${kws[0]}」与「${kws[1]}」分别指什么？`, back: `${kws[0]}：见题目解析；${kws[1]}：见题目解析（演示卡片，配置 AI 后自动提炼最小记忆点）` });
    return { data: { cards }, demo: true };
  }

  // 演示：PDF 片段笔记化（保底：保留原文并加结构提示）
  function pdfNotes(chunk, pageFrom, pageTo) {
    return { md: `#### 第 ${pageFrom}-${pageTo} 页（演示整理）

> ⚑ 演示模式不调用大模型，以下为原文降噪保留。配置 AI 后将输出结构化学习笔记（考点标注 + 表格保留）。

${String(chunk || '').slice(0, 3000)}

<span class="tag">考点：见原文</span>`, demo: true };
  }

  return { grade, essence, tags, templateGen, expand, verdict, ask, notesGen, ctxAsk, ctxChat, compactChat, makeCards, pdfNotes };
})();
