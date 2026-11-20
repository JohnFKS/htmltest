// 全局内容引用：@ 提及索引、全文解析、全局摘要、跨视图跳转。
// 供笔记助教（NoteChat）与 AI（provider/工具）共用；不直接操作 DOM 输入，只提供纯数据与跳转能力。
window.NoteRefs = (() => {
  // 可被引用的集合及展示元信息（label 用于 @ 菜单分组与 chip 图标）
  const KINDS = {
    note:      { label: '笔记',   icon: 'file',     coll: 'notes' },
    annot:     { label: '批注',   icon: 'image',    coll: 'annots' },
    bank:      { label: '题库',   icon: 'book',     coll: 'banks' },
    entry:     { label: '三本',   icon: 'list',     coll: 'entries' },
    template:  { label: '模板',   icon: 'braces',   coll: 'templates' },
    card:      { label: '卡片',   icon: 'help',     coll: 'cards' },
    record:    { label: '作答',   icon: 'pen',      coll: 'records' },
    session:   { label: '对话',   icon: 'message',  coll: 'chatSessions' },
  };

  const txt = v => U.stripHtml(U.asText(v || '')).replace(/\s+/g, ' ').trim();
  const short = (s, n = 90) => { const t = txt(s); return t.length > n ? t.slice(0, n) + '…' : t; };

  // 每条引用的显示标题与摘要（用于 @ 菜单、消息 chip、全局摘要）
  function metaOf(kind, item) {
    if (!item) return null;
    switch (kind) {
      case 'note':      return { title: item.title || '无标题笔记', desc: short(item.content) };
      case 'annot':     return { title: item.title || '未命名批注', desc: short((item.asks || []).map(a => a.question || a.text).join(' ') || '截图批注') };
      case 'bank':      return { title: item.name || '未命名题库', desc: `${(item.questions || []).length} 道题 · ${short((item.questions || [])[0]?.stem)}` };
      case 'entry':     return { title: short(item.snapshot?.stem, 50) || '三本条目', desc: short(item.essence?.html || item.snapshot?.analysis || (item.tags || []).join(' ')) };
      case 'template':  return { title: item.name || '未命名模板', desc: short(item.essence || (item.steps || []).join(' ')) };
      case 'card':      return { title: short(item.front, 50) || '复习卡片', desc: short(item.back) };
      case 'record':    return { title: short(item.text, 50) || '作答记录', desc: item.mode || '' };
      case 'session':   return { title: item.title || '未命名对话', desc: `${(item.messages || []).length} 条 · ${short((item.messages || []).at(-1)?.text || (item.messages || []).at(-1)?.html)}` };
      default:          return { title: '未知内容', desc: '' };
    }
  }

  // 全部可 @ 的条目（排除空集合），按类型分组顺序展开
  function all() {
    const out = [];
    for (const [kind, cfg] of Object.entries(KINDS)) {
      for (const item of (Store.coll(cfg.coll) || [])) {
        const meta = metaOf(kind, item);
        if (meta) out.push({ kind, id: item.id, ...meta });
      }
    }
    return out;
  }

  function find(kind, id) {
    const cfg = KINDS[kind];
    if (!cfg || !id) return null;
    return Store.find(cfg.coll, id) || null;
  }

  // 解析引用为送进模型上下文的结构化文本（全文，带类型标注与预算上限）
  function resolve(ref, budget = 6000) {
    const item = find(ref?.kind, ref?.id);
    if (!item) return { ok: false, text: `【引用失效】${ref?.kind || '?'} ${ref?.id || ''} 已不存在` };
    const meta = metaOf(ref.kind, item);
    let body = '';
    switch (ref.kind) {
      case 'note':
        body = txt((() => {
          const d = document.createElement('div');
          d.innerHTML = Sanitize.html(item.content || '');
          d.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,figcaption').forEach(el => el.insertAdjacentText('afterend', '\n'));
          return d.textContent || '';
        })());
        break;
      case 'annot':
        body = [item.title, ...(item.asks || []).map(a => `问：${txt(a.question || a.text)}\n答：${txt(a.answer || a.html)}`)].join('\n');
        break;
      case 'bank':
        body = (item.questions || []).map((q, i) => `${i + 1}. ${txt(q.stem)} ${(q.options || []).join(' | ')}\n答：${txt(q.answer)} 析：${txt(q.analysis)}`).join('\n');
        break;
      case 'entry':
        body = `题干：${txt(item.snapshot?.stem)}\n作答：${txt(item.myAnswer)}\n批改：${txt(item.aiGrade?.html)}\n本质：${txt(item.essence?.html)}\n标签：${(item.tags || []).join('、')}`;
        break;
      case 'template':
        body = `名称：${item.name}\n本质：${txt(item.essence)}\n信号：${(item.signals || []).join('、')}\n步骤：${(item.steps || []).join(' → ')}\n伪装：${(item.disguises || []).join('、')}\n易错：${(item.pitfalls || []).join('、')}\n成员：${(item.members || []).map(m => txt(m.stemText)).join(' | ')}`;
        break;
      case 'card':
        body = `正面：${txt(item.front)}\n反面：${txt(item.back)}`;
        break;
      case 'record':
        body = `作答：${txt(item.text)}\n模式：${item.mode || ''}\n标签：${(item.tags || []).join('、')}`;
        break;
      case 'session':
        body = (item.messages || []).map(m => `[${m.role === 'user' ? '学生' : '助教'}] ${txt(m.text || m.html)}`).join('\n');
        break;
    }
    if (body.length > budget) body = body.slice(0, budget) + '\n…（内容过长已截断）';
    return { ok: true, text: `【引用：${KINDS[ref.kind]?.label || ref.kind}｜${meta.title}】\n${body}` };
  }

  // 全局内容摘要：让 agent 知道"项目里都有什么"，再按需用工具读全文
  function digest(limitPerKind = 15) {
    const parts = [];
    for (const [kind, cfg] of Object.entries(KINDS)) {
      const items = Store.coll(cfg.coll) || [];
      if (!items.length) continue;
      const lines = items.slice(0, limitPerKind).map(it => {
        const m = metaOf(kind, it);
        return `- @${kind}:${it.id} ${m.title}${m.desc ? ' — ' + short(m.desc, 60) : ''}`;
      });
      if (items.length > limitPerKind) lines.push(`- …另有 ${items.length - limitPerKind} 条，可用工具按 ID 读取或搜索`);
      parts.push(`【${cfg.label} · ${items.length} 条】\n${lines.join('\n')}`);
    }
    return parts.join('\n\n') || '（当前知识库为空）';
  }

  // 按关键词在全部内容中搜索，返回可引用条目（供 AI 工具 search_content 使用）
  function search(query, limit = 8) {
    const q = txt(query).toLowerCase();
    if (!q) return [];
    return all().filter(r => (r.title + ' ' + r.desc).toLowerCase().includes(q)).slice(0, limit)
      .map(r => ({ kind: r.kind, id: r.id, title: r.title, desc: r.desc }));
  }

  // 消息 chip 点击：切到对应视图并尽量定位到条目
  function jump(kind, id) {
    const item = find(kind, id);
    if (!item) return UI.toast('该内容已被删除，无法跳转', 'warn');
    switch (kind) {
      case 'note':
        Views.notes.currentId = id;
        App.route('notes');
        break;
      case 'annot':
        Views.annotator.currentId = id;
        App.route('annotator');
        break;
      case 'bank': {
        const qid = (item.questions || [])[0]?.id;
        if (Views.quiz?.state) { Views.quiz.state.bankId = id; Views.quiz.state.qIndex = 0; Views.quiz.state.tab = 'practice'; }
        App.route('quiz');
        if (qid) setTimeout(() => UI.toast(`已打开题库「${item.name}」`), 100);
        break;
      }
      case 'entry':
        if (Views.books?.state) Views.books.state.kind = item.kind || 'wrong';
        App.route('books');
        setTimeout(() => {
          const el = document.querySelector(`[data-entry-id="${id}"]`);
          if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('ref-highlight'); setTimeout(() => el.classList.remove('ref-highlight'), 2000); }
          else UI.toast('已切到三本，请在列表中查找该条目');
        }, 150);
        break;
      case 'template':
        App.route('templates');
        setTimeout(() => {
          const el = document.querySelector(`[data-template-id="${id}"]`);
          if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('ref-highlight'); setTimeout(() => el.classList.remove('ref-highlight'), 2000); }
          else UI.toast('已切到模板库，请在列表中查找该模板');
        }, 150);
        break;
      case 'card':
      case 'record':
        App.route(kind === 'card' ? 'review' : 'books');
        UI.toast(`已切到${kind === 'card' ? '复习' : '三本'}页`);
        break;
      case 'session':
        if (window.NoteChat) { NoteChat.open({ sessionId: id }); UI.toast('已切换到该对话'); }
        break;
      default:
        UI.toast(`暂不支持跳转到 ${kind}`, 'warn');
    }
  }

  return { KINDS, all, find, metaOf, resolve, digest, search, jump };
})();
