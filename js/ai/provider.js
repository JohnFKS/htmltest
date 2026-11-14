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

  // 清理 markdown 围栏后交给消毒器
  function cleanHtml(text) {
    let t = String(text || '').trim();
    const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
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
    return { html: cleanHtml(raw), demo: false };
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

  return { live, extractJson, cleanHtml, urlToData, grade, essence, tags, templateGen, expand, verdict, ask, bankParse };
})();
