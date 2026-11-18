// AI 门面：统一入口，自动路由「真实 API / 演示模式」
// 所有真实调用经服务端代理（/api/ai/chat），输出按用途做 JSON 提取或 HTML 消毒
window.AI = (() => {
  const live = () => Store.aiLive();

  function fill(tpl, map) {
    let s = tpl;
    for (const [k, v] of Object.entries(map)) s = s.replaceAll(`{${k}}`, v ?? '');
    return s;
  }

  // 从模型返回中提取 JSON（容忍代码围栏与前后杂文）
  function extractJson(text) {
    let t = String(text || '').trim();
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

  // 清理 markdown 围栏、转换残留 markdown 块后交给消毒器
  function cleanHtml(text) {
    let t = String(text || '').trim();
    // 仅当整段被代码围栏包裹时剥离（内嵌的代码围栏保留给 convertMdBlocks 渲染）
    const wrapped = t.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?\s*```$/);
    if (wrapped) t = wrapped[1].trim();
    try { t = convertMdBlocks(t); } catch (e) { /* 转换失败保底原文 */ }
    return Sanitize.html(t);
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
    const resp = await Api.aiChat({
      messages,
      model: useModel,
      temperature: temperature ?? cfg.temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    });
    return resp.content;
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

  // 笔记右侧对话栏：整篇笔记 + 选中文本 + 历史轮次的连续答疑
  async function ctxChat({ noteTitle, noteText, selection, question, history = [] }) {
    const q = String(question || '').trim();
    if (!q) throw new Error('问题不能为空');
    if (!live()) return Mock.ctxChat({ noteTitle, selection, question: q, history });
    const system = fill(Store.prompt('ctxChat'), {
      noteTitle: String(noteTitle || '当前笔记').slice(0, 80),
      noteText: String(noteText || '').slice(0, 12000) || '（笔记内容为空）',
      selection: String(selection || '').slice(0, 1500) || '（本轮没有选中文本）',
      question: q,
    });
    const turns = (history || []).slice(-8).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.role === 'assistant'
        ? U.stripHtml(m.html || m.text || '').slice(0, 4000)
        : String(m.text || '').slice(0, 2000),
    }));
    const messages = [
      { role: 'system', content: system },
      ...turns,
      { role: 'user', content: q },
    ];
    const raw = await Api.aiChat({ messages });
    return { html: cleanHtml(raw), demo: false };
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
    let t = String(raw || '').trim();
    const fence = t.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    return { md: t, demo: false };
  }

  return { live, extractJson, cleanHtml, urlToData, grade, essence, tags, templateGen, expand, verdict, ask, bankParse, ctxAsk, ctxChat, makeCards, pdfNotes };
})();
