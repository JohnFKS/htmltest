// 白名单 HTML 消毒器
// 所有将写入 DOM 的富文本（用户笔记、AI 输出）都必须先经过这里，防 XSS / 提示注入攻击。
window.Sanitize = (() => {
  // 允许的标签（AI 提示词约定用 h4-h6；h1-h3 供笔记富文本使用）
  const ALLOWED_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'b', 'strong', 'i', 'em', 'u', 's', 'del', 'mark', 'code', 'pre', 'blockquote',
    'hr', 'br', 'span', 'div', 'a', 'img', 'details', 'summary', 'sup', 'sub',
    'figure', 'figcaption', 'label', 'input',
  ]);
  // 直接丢弃（含子树）的标签
  const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'button', 'video', 'audio', 'svg', 'math', 'base', 'template']);
  const ALLOWED_ATTRS = {
    '*': ['class'],
    a: ['href', 'title', 'target'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    input: ['type', 'checked', 'disabled'],
    ol: ['start'],
    details: ['open'],
    span: ['class', 'data-tex'],
  };
  const CLASS_RE = /^[a-zA-Z0-9_\- ]{0,120}$/;
  const SAFE_URL_RE = /^(https?:|\/|\.\/|#|data:image\/)/i;

  function safeUrl(v) {
    v = String(v || '').trim();
    // 禁止 javascript: / vbscript: 等协议
    return SAFE_URL_RE.test(v) && !v.toLowerCase().includes('javascript:') ? v : '';
  }

  function clean(root) {
    for (const node of [...root.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); continue; }
      const tag = node.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { node.remove(); continue; }
      if (!ALLOWED_TAGS.has(tag)) {
        // 不在白名单：保留子内容（unwrap），如 font、section 等
        clean(node);
        node.replaceWith(...node.childNodes);
        continue;
      }
      // 属性过滤
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const allow = (ALLOWED_ATTRS[tag] || []).concat(ALLOWED_ATTRS['*']);
        if (name.startsWith('on') || !allow.includes(name)) { node.removeAttribute(attr.name); continue; }
        if (name === 'href' || name === 'src') {
          const v = safeUrl(attr.value);
          if (!v) { node.removeAttribute(attr.name); continue; }
          node.setAttribute(name, v);
        } else if (name === 'class') {
          if (!CLASS_RE.test(attr.value)) node.removeAttribute(name);
        } else if (name === 'target') {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        } else if (name === 'type' && tag === 'input') {
          if (attr.value !== 'checkbox') node.removeAttribute(name);
        }
      }
      if (tag === 'img' && !node.getAttribute('src')) { node.remove(); continue; }
      clean(node);
    }
  }

  return {
    /** 返回消毒后的 HTML 字符串 */
    html(str = '') {
      const holder = document.createElement('div');
      holder.innerHTML = String(str);
      clean(holder);
      return holder.innerHTML;
    },
    /** 消毒并写入目标元素 */
    into(el, html) { el.innerHTML = this.html(html); return el; },
  };
})();
