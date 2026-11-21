// AI 门面：统一入口，自动路由「真实 API / 演示模式」
// 所有真实调用经服务端代理（/api/ai/chat），输出按用途做 JSON 提取或 HTML 消毒
window.AI = (() => {
  const live = () => Store.aiLive();

  function fill(tpl, map) {
    let s = String(tpl || '');
    // 用函数式替换，避免笔记中的 $& / $' / $$ 被当成替换模式展开
    for (const [k, v] of Object.entries(map)) s = s.replaceAll(`{${k}}`, () => String(v ?? ''));
    return s;
  }

  // 取消息正文（assistant 可能是 HTML，统一压成纯文本用于上下文/摘要）
  function msgText(m) {
    if (!m) return '';
    return U.asText(m.role === 'assistant' ? (m.html || m.text || '') : (m.text || m.html || ''));
  }

  // 围绕选中位置截取笔记：成熟对话系统常用的「焦点上下文窗口」，避免长笔记只取开头
  function noteExcerpt(text, selection, budget = 10000) {
    const full = U.asText(text || '');
    if (!full) return '（笔记内容为空）';
    if (full.length <= budget) return full;
    // 长笔记必须让模型知道这是节选，否则会误以为笔记只有开头几章
    const head = `（笔记全文约 ${full.length} 字，以下仅是节选，并非全文；完整章节结构见【笔记结构目录】，其余内容用 read_content 的 blockFrom/blockTo 分段读取）\n`;
    const sel = U.asText(selection || '').replace(/\s+/g, ' ').trim();
    const probe = sel.slice(0, Math.min(60, sel.length));
    const idx = probe ? full.indexOf(probe) : -1;
    if (idx < 0) return head + full.slice(0, budget) + '\n…（未定位到选中位置，已取笔记开头节选）';
    const start = Math.max(0, idx - Math.round(budget * 0.3));
    const end = Math.min(full.length, start + budget);
    return head + (start ? '…' : '') + full.slice(start, end) + (end < full.length ? '…' : '');
  }

  // 分层上下文：近期保真轮次 + 按当前问题召回的相关旧轮次（摘要在系统提示里单独传）
  function assembleHistory(history, question) {
    const items = (history || [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ id: m.id, role: m.role, text: msgText(m), compacted: !!m.compacted }))
      .filter(m => m.text);
    const recent = [];
    let chars = 0;
    for (let i = items.length - 1; i >= 0 && recent.length < 12; i--) {
      const m = items[i];
      const text = m.text.slice(0, m.role === 'assistant' ? 3000 : 1500);
      if (chars + text.length > 14000 && recent.length) break;
      recent.unshift({ role: m.role, content: text, id: m.id });
      chars += text.length;
    }
    const recentIds = new Set(recent.map(m => m.id));
    const pool = items.filter(m => !recentIds.has(m.id)).map(m => ({ id: m.id, role: m.role, text: m.text.slice(0, 600) }));
    const hits = pool.length && window.Sim?.rank ? Sim.rank(question, pool, { recallTopK: 3 }) : [];
    const recalled = hits.filter(h => h.score >= 0.12);
    const recallText = recalled.map(h => `- [${h.role === 'user' ? '学生' : '助教'}] ${h.text}`).join('\n');
    return { recent, recallText, stats: { recent: recent.length, recalled: recalled.length, compacted: items.filter(m => m.compacted).length } };
  }

  // 从模型返回中提取 JSON（容忍代码围栏与前后杂文）
  function extractJson(text) {
    let t = U.asText(text).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    if (start < 0) throw new Error('模型未返回 JSON');
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (!depth) { end = i; break; } }
    }
    if (end < 0) throw new Error('JSON 结构不完整');
    return JSON.parse(t.slice(start, end + 1));
  }

  // 把 AI 输出 HTML 里残留的 markdown 表格/代码围栏/加粗标记转成真 HTML
  function convertMdBlocks(html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;

    // 1) 行内残留：**加粗** → <strong>（只处理文本节点，不碰已有标签）
    const walkText = node => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent.includes('**')) {
            const frag = document.createElement('span');
            frag.innerHTML = U.esc(child.textContent)
              .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            child.replaceWith(...frag.childNodes);
          }
        } else if (child.nodeType === Node.ELEMENT_NODE && !['PRE', 'CODE'].includes(child.tagName)) {
          walkText(child);
        }
      }
    };
    walkText(holder);

    // 2) 块级残留：markdown 表格（含被压缩成单行/列数不齐的畸形表格）与代码围栏
    for (const el of [...holder.querySelectorAll('p, li, td, div, blockquote, h4, h5, h6, span')]) {
      if (el.querySelector('table, pre, ul, ol, blockquote')) continue;
      // 强调标签往返为 markdown 标记，避免 textContent 抹掉格式（表格单元格里的加粗仍能保留）
      const raw = (el.innerHTML || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
        .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
        .replace(/<code>([\s\S]*?)<\/code>/gi, '`$2`');
      const tmp = document.createElement('div');
      tmp.innerHTML = raw;
      const text = tmp.textContent || '';
      const pipeCount = (text.match(/\|/g) || []).length;
      const isTable = pipeCount >= 4 && /\|[^|]*\|/.test(text);
      const isFence = /```/.test(text);
      if (!isTable && !isFence) continue;
      // 先试 markdown-it 原生解析；失败（畸形表格）再用 token 重建
      let frag = document.createElement('div');
      frag.innerHTML = MD.toHtml(text);
      if (!frag.querySelector('table') && isTable) {
        const rebuilt = rebuildTable(text);
        if (rebuilt) {
          frag = document.createElement('div');
          frag.innerHTML = MD.toHtml(rebuilt);
        }
      }
      if (frag.querySelector('table, pre')) el.replaceWith(...frag.childNodes);
    }
    return holder.innerHTML;
  }

  // 从畸形 markdown 表格文本重建规范表格：
  // 用「|」切 token，定位连续的纯分隔符 token 行，空 token 即行边界（适配 LLM 压缩成单行的表格）
  function rebuildTable(text) {
    const tokens = text.split('|').map(t => t.trim());
    let s = -1, e = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] && /^[-: ]+$/.test(tokens[i]) && tokens[i].includes('-')) {
        if (s < 0) s = i;
        e = i + 1;
      } else if (s >= 0) break;
    }
    if (s < 0 || e - s < 2) return null;
    const header = tokens.slice(0, s).filter(t => t !== '');
    const cols = Math.max(header.length, e - s);
    const rest = tokens.slice(e);
    const rows = [];
    let cur = [];
    for (const t of rest) {
      if (t === '') { if (cur.length) { rows.push(cur); cur = []; } }
      else cur.push(t);
    }
    if (cur.length) rows.push(cur);
    if (!header.length || !rows.length) return null;
    const build = cells => '|' + Array.from({ length: cols }, (_, i) => ` ${cells[i] || ''} `).join('|') + '|';
    return [build(header), build(Array(cols).fill('---')),
      ...rows.map(r => build(r))].join('\n');
  }

  // 归一化模型常用但语义含糊的装饰写法：==高亮== → <mark>；<font color> → <span style="color">
  function normalizeDecor(t) {
    return t
      .replace(/==([^=\n]{1,200}?)==/g, '<mark>$1</mark>')
      .replace(/<font\s+color="([^"]+)"[^>]*>/gi, '<span style="color: $1">')
      .replace(/<\/font\s*>/gi, '</span>');
  }

  // 清理 markdown 围栏、转换残留 markdown 块后交给消毒器
  function cleanHtml(text) {
    let t = U.asText(text).trim();
    // 仅当整段被代码围栏包裹时剥离（内嵌的代码围栏保留给 convertMdBlocks 渲染）
    const wrapped = t.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?\s*```$/);
    if (wrapped) t = wrapped[1].trim();
    // 模型常直接输出裸 Markdown（含 GFM 表格），先整体转成 HTML 再做残留修复
    const hasAnyTag = /<[a-z][\s\S]*>/i.test(t);
    const hasTable = /<table\b/i.test(t);
    const mdTable = /(^|\n)\s*\|.*\|\s*(\n|$)/.test(t) && /(^|\n)\s*\|?[\s:|-]+\|[\s:|-]*\s*(\n|$)/.test(t);
    if (!hasAnyTag || (mdTable && !hasTable)) {
      try { t = MD.toHtml(t); } catch (e) { /* 转换失败保底原文 */ }
    }
    try { t = convertMdBlocks(t); } catch (e) { /* 转换失败保底原文 */ }
    return Sanitize.html(normalizeDecor(t));
  }

  // /images/xx → dataURL（供多模态模型）
  async function urlToData(url) {
    if (url.startsWith('data:')) return url;
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('图片读取失败'));
      r.readAsDataURL(blob);
    });
  }

  // 服务端代理返回 {content, tool_calls, usage}；content 可能是字符串、内容块数组或对象，统一取文本
  async function rawChat(payload, raw = false) {
    const resp = await Api.aiChat(payload);
    if (raw) {
      return {
        content: U.asText(resp?.content ?? ''),
        toolCalls: Array.isArray(resp?.tool_calls) ? resp.tool_calls : [],
        usage: resp?.usage || {},
      };
    }
    return U.asText(resp?.content ?? '');
  }

  // 对话输出上限：配置值过小（如 1000）会截断富 HTML 回答与 tool_calls 参数，这里设 4096 下限
  function chatMaxTokens() {
    return Math.min(Math.max(Number(Store.config?.ai?.maxTokens) || 0, 4096), 16000);
  }

  async function callChat({ key, filled, images, model, temperature, maxTokens }) {
    const cfg = Store.config.ai;
    const content = images && images.length
      ? [{ type: 'text', text: filled }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))]
      : filled;
    const messages = [{ role: 'user', content }];
    const useModel = model || (images && images.length ? cfg.visionModel || cfg.chatModel : cfg.chatModel);
    if (images && images.length && !(cfg.visionModel || '').trim()) {
      throw new Error('图片作答需要配置「视觉模型」才能批改，请在设置中填写，或改用文本作答');
    }
    return rawChat({
      messages,
      model: useModel,
      temperature: temperature ?? cfg.temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    });
  }

  // ---------- 各用途 ----------
  async function grade(question, answer) {
    if (!live()) return Mock.grade(question, answer);
    const qText = `题干：${U.stripHtml(question.stem)}\n${(question.options || []).length ? '选项：' + question.options.join(' | ') + '\n' : ''}参考答案：${question.answer || '（题库未提供）'}\n解析：${U.stripHtml(question.analysis || '（无）')}`;
    const aText = answer.text?.trim() || (answer.hasImage ? '（学生以手写/拍照图片作答，见附图）' : '（未作答）');
    const prompt = fill(Store.prompt('grade'), { question: qText, answer: aText });
    const images = answer.imageDataUrl ? [answer.imageDataUrl] : null;
    const raw = await callChat({ key: 'grade', filled: prompt, images });
    const html = cleanHtml(raw);
    // 解析判定与得分（供仪表盘统计考点掌握度）
    const cls = html.match(/class="hl-(good|warn|bad)"/);
    const verdict = cls ? { 'hl-good': 'correct', 'hl-warn': 'partial', 'hl-bad': 'wrong' }[cls[1]] : null;
    const scoreM = html.match(/得分[：:]\s*(\d{1,3})/);
    return { html, demo: false, verdict, score: scoreM ? U.clamp(+scoreM[1], 0, 100) : null };
  }

  async function essence(question, analysis, gradeSummary) {
    if (!live()) return Mock.essence(question, analysis, gradeSummary);
    const qText = `${U.stripHtml(question.stem)}\n${(question.options || []).join(' | ')}`;
    const prompt = fill(Store.prompt('essence'), {
      question: qText, analysis: analysis || '（无）', gradeSummary: gradeSummary || '（无）',
    });
    return { html: cleanHtml(await callChat({ key: 'essence', filled: prompt })), demo: false };
  }

  async function tags(question, analysis) {
    if (!live()) return Mock.tags(question, analysis);
    const prompt = fill(Store.prompt('tags'), {
      question: U.stripHtml(question.stem), analysis: analysis || '（无）',
    });
    const data = extractJson(await callChat({ key: 'tags', filled: prompt, temperature: 0.2 }));
    if (!Array.isArray(data.tags)) throw new Error('标签返回格式异常');
    return { tags: data.tags.map(t => String(t)).slice(0, 10), demo: false };
  }

  async function templateGen(question, analysis, essenceHtml) {
    if (!live()) return Mock.templateGen(question, analysis, essenceHtml);
    const prompt = fill(Store.prompt('templateGen'), {
      question: `${U.stripHtml(question.stem)}\n${(question.options || []).join(' | ')}`,
      analysis: analysis || '（无）', essence: U.stripHtml(essenceHtml || '（无）'),
    });
    return { data: extractJson(await callChat({ key: 'templateGen', filled: prompt })), demo: false };
  }

  async function expand(template, members) {
    if (!live()) return Mock.expand(template);
    const prompt = fill(Store.prompt('expand'), {
      template: JSON.stringify({ name: template.name, essence: template.essence, signals: template.signals, steps: template.steps, disguises: template.disguises, pitfalls: template.pitfalls }, null, 1),
      members: members.map(m => U.stripHtml(m).slice(0, 120)).join('\n---\n'),
    });
    return { data: extractJson(await callChat({ key: 'expand', filled: prompt })), demo: false };
  }

  async function verdict(questionText, templateDesc, hybrid) {
    const threshold = Store.config.similarity.autoMergeConfidence;
    if (!live()) return Mock.verdict(hybrid, Store.config.similarity.demoThreshold);
    const prompt = fill(Store.prompt('verdict'), {
      question: U.stripHtml(questionText).slice(0, 800),
      template: templateDesc,
    });
    const data = extractJson(await callChat({ key: 'verdict', filled: prompt, temperature: 0.1 }));
    return { data: { same_type: !!data.same_type, confidence: U.clamp(Number(data.confidence) || 0, 0, 1), reason: String(data.reason || ''), advice: data.advice === 'merge' ? 'merge' : 'new' }, demo: false, threshold };
  }

  async function ask(questionText, shape, imageDataUrl) {
    if (!live()) return Mock.ask(questionText, shape);
    const prompt = fill(Store.prompt('ask'), { shape, q: questionText });
    const raw = await callChat({ key: 'ask', filled: prompt, images: [imageDataUrl] });
    return { html: cleanHtml(raw), demo: false };
  }

  // 题库智能解析 / 从笔记出题：真实 API 走大模型；未配置时回退本地规则解析器（quiz 视图注入 window.LocalBankParser）
  async function bankParse(raw, opts = {}) {
    const mode = opts.mode === 'generate' ? 'generate' : 'parse';
    if (!live()) {
      if (mode === 'generate') return Mock.notesGen(raw);
      if (!window.LocalBankParser) throw new Error('本地解析器未就绪');
      return { data: window.LocalBankParser.parse(raw), demo: true };
    }
    const key = mode === 'generate' ? 'notesGen' : 'bankParse';
    const maxChars = opts.maxChars || 60000;
    const prompt = fill(Store.prompt(key), { raw: String(raw).slice(0, maxChars) });
    // 出题/解析输出体量大（长 JSON），放宽输出上限，防止思考型模型截断
    const data = extractJson(await callChat({ key, filled: prompt, temperature: 0.2, maxTokens: 16000 }));
    if (!Array.isArray(data.questions)) throw new Error('解析返回格式异常：缺少 questions 数组');
    return { data, demo: false };
  }

  // 右键选中文本提问（学习助教，基于选中文本作答，输出受控 HTML）
  async function ctxAsk({ selection, question }) {
    if (!live()) return Mock.ctxAsk(selection, question);
    const prompt = fill(Store.prompt('ctxAsk'), {
      selection: String(selection).slice(0, 1500), question: String(question || '请解释这段内容'),
    });
    return { html: cleanHtml(await callChat({ key: 'ctxAsk', filled: prompt })), demo: false };
  }

  // Function calling：受控工具定义。读取类由 NoteRefs 执行（普通对话也可用）；编辑类由 NoteAgent 执行（需编辑模式，逐项确认）。
  const NOTE_READ_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'search_content',
        description: '在全部笔记/题库/三本/模板/卡片/作答/批注/历史对话中按关键词搜索，返回可引用的条目 ID。需要跨内容找资料时调用。',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '搜索关键词' }, limit: { type: 'integer', minimum: 1, maximum: 20, description: '返回条数，默认 8' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_content',
        description: '按类型与 ID 读取任意一条内容的完整文本（笔记全文、整本题库、三本条目、模板、批注问答、历史对话等），用于跨对话/跨文档引用与对比；读笔记时附带编号块列表。长笔记用 blockFrom/blockTo 读取指定区间的块全文（配合【笔记结构目录】定位章节）。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['note', 'annot', 'bank', 'entry', 'template', 'card', 'record', 'session'], description: '内容类型' },
            id: { type: 'string', description: '内容 ID，来自【全局内容摘要】或 search_content 结果' },
            blockFrom: { type: 'integer', minimum: 0, description: '可选（仅 kind=note）：起始块编号，与 blockTo 一起读取该区间的块全文' },
            blockTo: { type: 'integer', minimum: 0, description: '可选（仅 kind=note）：结束块编号（含）' },
          },
          required: ['kind', 'id'],
        },
      },
    },
  ];
  const NOTE_EDIT_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'edit_note',
        description: '编辑笔记。默认编辑当前打开的笔记；传 noteId 可编辑任意笔记（跨笔记编辑）。用户只是提问时不要调用。每次调用只做一个操作。',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string', enum: ['replace_selection', 'replace_block', 'insert_after_block', 'append', 'replace_all', 'rename_title'],
              description: 'replace_selection=改写用户选中的文本；replace_block=改写第 blockIndex 个块；insert_after_block=在第 blockIndex 块后插入；append=追加到末尾；replace_all=重写整篇（慎用）；rename_title=改标题',
            },
            html: { type: 'string', description: '要写入的受控 HTML 片段（replace_all 时为整篇 HTML）。高亮重点用 <span style="background-color: #FFF3A3">…</span> 或 <mark>…</mark>；字体颜色用 <span style="color: #C0392B">…</span>；style 属性仅允许 background-color 与 color 两种颜色值。禁止 script/img/a/id/事件属性及其他任何 style，可用 p/h4-h6/ul/ol/li/table/b/strong/i/em/mark/u/s/code/pre/blockquote/span 及 $公式$。' },
            title: { type: 'string', description: 'rename_title 时的新标题' },
            blockIndex: { type: 'integer', minimum: 0, description: '块序号，从 0 开始，对应目标笔记的块列表' },
            noteId: { type: 'string', description: '必填：目标笔记 ID。编辑当前打开的笔记也请传它的 ID（见系统提示【当前笔记】）；编辑其他笔记时用【全局内容摘要】或 read_content 结果里的 ID，块编号用该笔记 read_content 返回的块列表编号' },
            reason: { type: 'string', description: '用一句话说明这次编辑做了什么，展示给用户确认' },
          },
          required: ['action', 'reason', 'noteId'],
        },
      },
    },
    ...NOTE_READ_TOOLS,
  ];

  async function toolResult(call, onToolCall, onRead) {
    const fn = call?.function || {};
    const name = String(fn.name || '');
    let args = {};
    try { args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : (fn.arguments || {}); }
    catch (e) { return { ok: false, error: '工具参数不是合法 JSON' }; }
    if (name === 'search_content') {
      const q = String(args.query || '').trim();
      if (!q) return { ok: false, error: '搜索关键词不能为空' };
      try {
        const hits = (onRead?.search || (() => []))(q, U.clamp(Number(args.limit) || 8, 1, 20));
        return { ok: true, hits, message: hits.length ? `找到 ${hits.length} 条相关内容` : '没有找到匹配内容' };
      } catch (e) { return { ok: false, error: e.message || '搜索失败' }; }
    }
    if (name === 'read_content') {
      const kind = String(args.kind || ''), id = String(args.id || '');
      if (!kind || !id) return { ok: false, error: '缺少 kind 或 id' };
      try {
        // 长笔记两步定位法第二步：按块区间读取全文
        const blockFrom = Number.isInteger(args.blockFrom) ? args.blockFrom : null;
        const blockTo = Number.isInteger(args.blockTo) ? args.blockTo : null;
        if (kind === 'note' && (blockFrom !== null || blockTo !== null) && typeof onRead?.readRange === 'function') {
          return onRead.readRange(id, blockFrom, blockTo);
        }
        const r = (onRead?.resolve || (() => ({ ok: false, error: '读取能力未就绪' })))({ kind, id });
        // 笔记附带编号块列表与 noteId：跨笔记 replace_block / insert_after_block 需要块编号与目标 ID
        if (r?.ok && kind === 'note' && typeof onRead?.blocks === 'function') {
          const bl = String(onRead.blocks(id) || '').trim();
          if (bl) r.text += `\n\n【该笔记的块列表（noteId: ${id}，编号从 0 起，供 replace_block / insert_after_block 使用）】\n${bl.slice(0, 12000)}`;
        }
        return r;
      } catch (e) { return { ok: false, error: e.message || '读取失败' }; }
    }
    if (name !== 'edit_note') return { ok: false, error: `未知工具：${name}` };
    if (typeof onToolCall !== 'function') return { ok: false, error: '编辑模式未开启，无法修改笔记（可在对话栏右上角开启 ✎ 编辑模式）' };
    // noteId 必填：防止模型漏传时把改动静默写进"当前打开的笔记"（错误目标也显示成功）
    const noteId = String(args.noteId || '').trim();
    if (!noteId) {
      return {
        ok: false,
        error: '缺少 noteId（必填）。请确定要编辑哪篇笔记：当前笔记的 ID 见系统提示【当前笔记】，其他笔记的 ID 来自【全局内容摘要】或 read_content 结果；带上 noteId 重新调用本工具',
      };
    }
    const action = String(args.action || '');
    if (!['replace_selection', 'replace_block', 'insert_after_block', 'append', 'replace_all', 'rename_title'].includes(action)) {
      return { ok: false, error: `不支持的操作：${action}` };
    }
    if (action === 'rename_title') {
      if (!String(args.title || '').trim()) return { ok: false, error: '新标题不能为空' };
    } else if (!String(args.html || '').trim() && action !== 'replace_all') {
      return { ok: false, error: '缺少 html 内容' };
    }
    try {
      return await onToolCall({
        action,
        html: cleanHtml(String(args.html || '')),
        title: String(args.title || '').trim(),
        blockIndex: Number.isInteger(args.blockIndex) ? args.blockIndex : null,
        noteId,
        reason: String(args.reason || '编辑笔记').slice(0, 200),
      });
    } catch (e) {
      return { ok: false, error: e.message || '编辑执行失败' };
    }
  }

  // 笔记右侧对话栏：长期记忆摘要 + 焦点笔记 + 近期轮次 + 相关历史召回 + @引用 + 全局内容摘要
  // onToolCall 或 onRead 存在时启用 function calling：编辑模式可改笔记；普通模式只带只读检索工具，可查全部内容。
  async function ctxChat({ noteTitle, noteText, selection, question, history = [], summary = '', onToolCall = null, noteBlocks = '', refsText = '', globalDigest = '', onRead = null, noteId = '' }) {
    const q = U.asText(question || '').trim();
    if (!q) throw new Error('问题不能为空');
    const { recent, recallText, stats } = assembleHistory(history, q);
    if (!live()) return Mock.ctxChat({ noteTitle, selection, question: q, history, summary, context: stats, refsText, globalDigest });
    // 编辑模式：edit_note + 读取工具；普通模式：仅只读检索工具（提示词仍用普通模板，不提编辑块列表）
    const canEdit = typeof onToolCall === 'function';
    const useTools = canEdit || onRead != null;
    let system = fill(Store.prompt(canEdit ? 'ctxChatAgent' : 'ctxChat'), {
      noteTitle: U.asText(noteTitle || '当前笔记').slice(0, 80),
      noteText: noteExcerpt(noteText, selection),
      noteBlocks: U.asText(noteBlocks || '（无块信息）').slice(0, 12000),
      selection: U.asText(selection || '').slice(0, 1500) || '（本轮没有选中文本）',
      summary: U.asText(summary || '').slice(0, 2500) || '（暂无长期记忆摘要）',
      refsText: U.asText(refsText || '').slice(0, 20000) || '（本轮没有 @ 引用）',
      globalDigest: U.asText(globalDigest || '').slice(0, 16000) || '（暂无全局内容）',
      noteId: U.asText(noteId || '').slice(0, 80) || '未知',
      question: q,
    });
    if (recallText) system += `\n\n【相关历史召回】\n${recallText}`;
    const messages = [
      { role: 'system', content: system },
      ...recent,
      { role: 'user', content: q },
    ];
    if (!useTools) {
      const raw = await rawChat({ messages, max_tokens: chatMaxTokens() });
      return { html: cleanHtml(raw), demo: false, context: stats };
    }

    // 工具循环：最多 8 轮——整章高亮等批量修改需要逐块编辑，4 轮不够（防无限循环仍保留上限）
    const edits = [];
    let finalText = '';
    for (let round = 0; round < 8; round++) {
      const res = await rawChat({
        messages,
        tools: canEdit ? NOTE_EDIT_TOOLS : NOTE_READ_TOOLS,
        tool_choice: 'auto',
        max_tokens: chatMaxTokens(),
      }, true);
      if (!res.toolCalls.length) { finalText = res.content; break; }
      messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        const result = await toolResult(call, onToolCall, onRead);
        edits.push({ name: call?.function?.name || 'edit_note', args: call?.function?.arguments || '', result });
        messages.push({ role: 'tool', tool_call_id: call.id || U.uid('call'), content: JSON.stringify(result) });
      }
      if (round === 7) finalText = '本轮工具调用已达次数上限，尚未完成的编辑请让学生再次提出。';
    }
    const okCount = edits.filter(e => e.result?.ok).length;
    const prefix = okCount
      ? `<p class="hl-good">已按你的要求编辑笔记（成功 ${okCount} 项${edits.length > okCount ? `、跳过 ${edits.length - okCount} 项` : ''}，编辑前已存版本快照，可在「历史」中恢复）。</p>`
      : '';
    return { html: prefix + cleanHtml(finalText), demo: false, context: stats, edits };
  }

  // 把旧对话压缩为长期记忆摘要（ConversationSummaryBuffer 风格）
  async function compactChat({ summary = '', messages = [] }) {
    const lines = (messages || []).map(m => `[${m.role === 'user' ? '学生' : '助教'}] ${msgText(m).slice(0, 500)}`).join('\n').slice(0, 8000);
    if (!live()) return Mock.compactChat({ summary, messages });
    const prompt = fill(Store.prompt('chatCompact'), {
      summary: U.asText(summary || '').slice(0, 2000) || '（暂无）',
      messages: lines || '（暂无新增对话）',
    });
    const text = U.asText(await callChat({ key: 'chatCompact', filled: prompt, temperature: 0.1, maxTokens: 1200 })).trim();
    return { text: text.slice(0, 2500), demo: false };
  }

  // 从题目/本质思路生成复习卡片（JSON：{cards:[{front, back}]}）
  async function makeCards(question, analysis, essenceHtml) {
    if (!live()) return Mock.makeCards(question, analysis);
    const prompt = fill(Store.prompt('makeCards'), {
      question: U.stripHtml(question.stem).slice(0, 500), analysis: analysis || '（无）', essence: U.stripHtml(essenceHtml || ''),
    });
    const data = extractJson(await callChat({ key: 'makeCards', filled: prompt, temperature: 0.3 }));
    if (!Array.isArray(data.cards)) throw new Error('卡片返回格式异常');
    return { data: { cards: data.cards.slice(0, 5).map(c => ({ front: String(c.front || ''), back: String(c.back || '') })) }, demo: false };
  }

  // PDF 教材片段 → 结构化学习笔记（markdown）；分块长转换，放宽输出
  async function pdfNotes(chunk, pageFrom, pageTo) {
    if (!live()) return Mock.pdfNotes(chunk, pageFrom, pageTo);
    const prompt = fill(Store.prompt('pdfNotes'), {
      chunk: String(chunk).slice(0, 24000), pageFrom, pageTo,
    });
    const raw = await callChat({ key: 'pdfNotes', filled: prompt, temperature: 0.2, maxTokens: 8000 });
    let t = U.asText(raw).trim();
    const fence = t.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    return { md: t, demo: false };
  }

  return { live, extractJson, cleanHtml, urlToData, grade, essence, tags, templateGen, expand, verdict, ask, bankParse, ctxAsk, ctxChat, compactChat, makeCards, pdfNotes, NOTE_EDIT_TOOLS };
})();
