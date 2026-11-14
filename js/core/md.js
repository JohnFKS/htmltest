// Markdown → HTML 转换器
// 优先使用本地 vendor 的 markdown-it（CommonMark + GFM 表格，健壮）；缺失时降级为内置轻量实现
// 数学公式 $...$ / $$...$$ 保持原文输出，由 katex.js 统一扫描渲染
window.MD = (() => {
  let _mdit = null;
  function mdit() {
    if (!_mdit && window.markdownit) {
      // html: true —— 放行源文档中的原生 HTML（OCR 笔记的 <table> 等），
      // 渲染结果统一经过 Sanitize 白名单消毒，脚本/事件属性不会进入 DOM
      _mdit = window.markdownit({ html: true, linkify: true, breaks: true });
    }
    return _mdit;
  }

  function inline(s) {
    s = U.esc(s);
    // ![alt](src) 图片
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) =>
      /^(https?:|\/|data:image\/)/.test(src) ? `<img src="${src}" alt="${alt}">` : m);
    // [text](url) 链接
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, href) =>
      /^(https?:|\/|#)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>` : m);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }

  function block(lines, out) {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      // 代码围栏
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${U.esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out.push(`<h${U.clamp(h[1].length + 1, 4, 6)}>${inline(h[2])}</h${U.clamp(h[1].length + 1, 4, 6)}>`); i++; continue; }
      // 分割线
      if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      // 引用
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${block(buf, [])}</blockquote>`);
        continue;
      }
      // 表格 |a|b|
      if (/^\|.*\|/.test(line) && /^\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
        const cells = l => l.split('|').slice(1, -1).map(x => x.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|.*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
          + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      // 列表（含待办）
      const isTodo = /^[-*]\s+\[( |x|X)\]\s+/;
      const isUl = /^[-*]\s+/;
      const isOl = /^\d+[.、)]\s+/;
      if (isUl.test(line) || isOl.test(line) || isTodo.test(line)) {
        if (isTodo.test(line)) {
          const items = [];
          while (i < lines.length && isTodo.test(lines[i])) {
            const m = lines[i++].match(isTodo);
            items.push(`<li><input type="checkbox" ${m[1].toLowerCase() === 'x' ? 'checked' : ''}><span>${inline(lines && lines[i - 1].replace(isTodo, ''))}</span></li>`);
          }
          out.push(`<ul class="todo-list">${items.join('')}</ul>`);
          continue;
        }
        const ordered = isOl.test(line);
        const re = ordered ? isOl : isUl;
        const items = [];
        while (i < lines.length && re.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(re, ''))}</li>`);
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      // 段落（连续非空行）
      const buf = [];
      while (i < lines.length && lines[i].trim()
        && !/^(#{1,6}\s|```|>|[-*]\s|\d+[.、)]\s|\||-{3,})/.test(lines[i])) {
        buf.push(lines[i++]);
      }
      out.push(`<p>${inline(buf.join('\n')).replaceAll('\n', '<br>')}</p>`);
    }
    return out.join('');
  }

  return {
    /** MD 文本 → HTML 片段（内联数学公式保持原文，交给 KaTeX 渲染） */
    toHtml(mdText = '') {
      const m = mdit();
      if (m) return m.render(String(mdText));
      return block(String(mdText).replace(/\r\n?/g, '\n').split('\n'), []);
    },
    /** 检测文本是否像 Markdown（用于粘贴自动转换） */
    looksLikeMd(text = '') {
      const s = text.slice(0, 2000);
      return /^#{1,6}\s/m.test(s) || /^[-*]\s+\S/m.test(s) || /```/.test(s)
        || /\*\*[^*]+\*\*/.test(s) || /^\d+[.、)]\s/m.test(s) || /^>\s/m.test(s);
    },
  };
})();
