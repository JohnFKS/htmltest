// KaTeX 本地渲染：自动探测 vendor/katex 是否存在，扫描元素内文本节点的 $...$ / $$...$$
// 未安装 vendor 时优雅降级：公式按原文显示
window.Ktx = (() => {
  const state = { enabled: false, loaded: false, queue: [] };

  const SKIP = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);

  function walk(el) {
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) {
        if (node.nodeType === Node.ELEMENT_NODE && !SKIP.has(node.tagName)
          && !node.classList?.contains('katex') && !node.classList?.contains('katex-inline')) {
          walk(node);
        }
        continue;
      }
      const text = node.textContent;
      if (!text || !text.includes('$')) continue;
      // 先匹配块级 $$...$$，再匹配行内 $...$
      const re = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;
      let m; let found = false; const frag = document.createDocumentFragment(); let last = 0;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const tex = (m[1] ?? m[2]).trim();
        const span = document.createElement('span');
        span.className = 'katex-inline';
        try {
          window.katex.render(tex, span, { throwOnError: false, displayMode: !!m[1] });
        } catch (e) {
          span.textContent = m[0];
        }
        frag.appendChild(span);
        found = true;
        last = m.index + m[0].length;
      }
      if (found) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      }
    }
  }

  /** 渲染容器内所有文本节点上的公式；vendor 未就绪时挂起，加载完成后自动补渲染 */
  function renderNow(el) {
    if (!el) return;
    if (!state.enabled) {
      if (!state.loaded) load();
      if (el && !state.queue.includes(el)) state.queue.push(el);
      return;
    }
    walk(el);
    highlight(el);
  }

  /** 代码块语法高亮（highlight.js vendor 存在时） */
  function highlight(el) {
    if (!window.hljs || !el.querySelectorAll) return;
    try {
      el.querySelectorAll('pre code:not([data-hl])').forEach(b => {
        hljs.highlightElement(b);
        b.dataset.hl = '1';
      });
    } catch (e) { /* 高亮失败不影响内容 */ }
  }

  function load() {
    if (state.loaded) return;
    state.loaded = true;
    const js = document.createElement('script');
    js.src = '/vendor/katex/katex.min.js';
    js.onload = () => {
      state.enabled = true;
      document.body.classList.add('katex-ok');
      const q = state.queue; state.queue = [];
      q.forEach(el => renderNow(el));
    };
    js.onerror = () => { state.queue = []; };
    document.head.appendChild(js);
  }

  return {
    init() { load(); },
    get enabled() { return state.enabled; },
    renderMath: renderNow,
  };
})();
