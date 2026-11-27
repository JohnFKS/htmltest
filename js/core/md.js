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
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
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

  // ---------- HTML → Markdown：导出笔记时保留标题/列表/表格/代码/公式/颜色等结构 ----------
  const escMd = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/([`*_\[\]<>|])/g, '\\$1').replace(/\r\n?/g, '\n');
  const escAttr = s => U.esc(String(s ?? ''));
  const mdInline = node => {
    if (node.nodeType === Node.TEXT_NODE) return escMd(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const kids = () => [...node.childNodes].map(mdInline).join('');
    if (tag === 'br') return '  \n';
    if (tag === 'strong' || tag === 'b') return `**${kids()}**`;
    if (tag === 'em' || tag === 'i') return `*${kids()}*`;
    if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${kids()}~~`;
    if (tag === 'code') return `\`${node.textContent || ''}\``;
    if (tag === 'a') return `[${kids()}](${escAttr(node.getAttribute('href') || '')})`;
    if (tag === 'img') return `![${escAttr(node.getAttribute('alt') || '')}](${escAttr(node.getAttribute('src') || '')})`;
    if (tag === 'input' && node.getAttribute('type') === 'checkbox') return node.hasAttribute('checked') ? '[x]' : '[ ]';
    if (tag === 'sup' || tag === 'sub') return `<${tag}>${kids()}</${tag}>`;
    if (tag === 'mark') {
      const style = node.getAttribute('style');
      return style ? `<mark style="${escAttr(style)}">${kids()}</mark>` : `==${kids()}==`;
    }
    if (tag === 'span') {
      if (node.classList.contains('katex-inline') || node.hasAttribute('data-tex')) {
        const tex = node.getAttribute('data-tex') || node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
        if (tex) return `$${tex.trim()}$`;
      }
      const style = node.getAttribute('style');
      const cls = node.getAttribute('class');
      if (style || cls) return `<span${style ? ` style="${escAttr(style)}"` : ''}${cls ? ` class="${escAttr(cls)}"` : ''}>${kids()}</span>`;
    }
    return kids();
  };

  const mdList = (el, depth = 0) => {
    const pad = '  '.repeat(depth);
    const ordered = el.tagName.toLowerCase() === 'ol';
    const start = Number(el.getAttribute('start') || 1) || 1;
    return [...el.children].filter(li => li.tagName.toLowerCase() === 'li').map((li, i) => {
      const box = li.querySelector(':scope > input[type="checkbox"]');
      let text = '', nested = '';
      [...li.childNodes].forEach(n => {
        if (n === box) return;
        if (n.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(n.tagName)) nested += '\n' + mdList(n, depth + 1);
        else text += mdInline(n);
      });
      const prefix = ordered ? `${start + i}. ` : '- ';
      return `${pad}${prefix}${box ? (box.hasAttribute('checked') ? '[x] ' : '[ ] ') : ''}${text.trim()}${nested}`;
    }).join('\n');
  };

  const mdTable = el => {
    const cell = c => mdInline(c).replace(/\|/g, '\\|');
    const rows = [...el.querySelectorAll('tr')];
    if (!rows.length) return '';
    const head = [...rows[0].children].filter(c => /^(TH|TD)$/.test(c.tagName)).map(cell);
    const body = rows.slice(1).map(r => '| ' + [...r.children].filter(c => /^(TH|TD)$/.test(c.tagName)).map(cell).join(' | ') + ' |');
    return `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${body.join('\n')}`.trim();
  };

  const mdBlocks = root => {
    const out = [];
    [...root.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/\s+/g, ' ');
        if (t.trim()) out.push(escMd(t.trim()));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) out.push(`${'#'.repeat(+tag[1])} ${mdInline(node)}`);
      else if (tag === 'p' || tag === 'div' || tag === 'figure' || tag === 'figcaption') {
        const inner = node.querySelector('p,div,ul,ol,table,pre,blockquote,details') ? mdBlocks(node) : mdInline(node);
        if (inner.trim()) out.push(inner.trim());
      } else if (tag === 'ul' || tag === 'ol') out.push(mdList(node));
      else if (tag === 'pre') {
        const code = node.querySelector('code') || node;
        const lang = (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
        out.push('```' + lang + '\n' + (code.textContent || '').replace(/\n$/, '') + '\n```');
      } else if (tag === 'blockquote') out.push(mdBlocks(node).split('\n').map(l => `> ${l}`).join('\n'));
      else if (tag === 'table') out.push(mdTable(node));
      else if (tag === 'hr') out.push('---');
      else if (tag === 'details') {
        const summary = node.querySelector('summary');
        const rest = document.createElement('div');
        [...node.childNodes].forEach(n => { if (n !== summary) rest.appendChild(n.cloneNode(true)); });
        out.push(`<details${node.hasAttribute('open') ? ' open' : ''}><summary>${summary ? mdInline(summary) : '详情'}</summary>\n\n${mdBlocks(rest).trim()}\n\n</details>`);
      } else {
        const inner = mdInline(node);
        if (inner.trim()) out.push(inner.trim());
      }
    });
    return out.filter(Boolean).join('\n\n');
  };

  return {
    /** HTML → Markdown（导出笔记；公式还原为 $...$，自定义颜色保留为内联 HTML） */
    toMarkdown(html = '', title = '') {
      const holder = document.createElement('div');
      holder.innerHTML = Sanitize.html(html);
      const body = mdBlocks(holder).trim();
      const cleanTitle = String(title || '').trim();
      const firstH1 = holder.firstElementChild?.tagName === 'H1' ? holder.firstElementChild.textContent.trim() : '';
      const head = cleanTitle && firstH1 !== cleanTitle ? `# ${escMd(cleanTitle)}\n\n` : '';
      return (head + body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    },
    /** 完整 HTML 文件 → 可编辑富文本笔记（去脚本样式/KaTeX 渲染层，保留白名单标签与内联颜色） */
    importHtml(raw = '') {
      const doc = new DOMParser().parseFromString(String(raw), 'text/html');
      const title = (doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || '')
        .replace(/\s+/g, ' ').trim().slice(0, 80) || '导入的 HTML';
      const source = doc.querySelector('article, main') || doc.body || doc.documentElement;
      source.querySelectorAll('script, style, noscript, nav, header, footer, .export-toc').forEach(el => el.remove());
      source.querySelectorAll('font[color]').forEach(font => {
        const span = doc.createElement('span');
        span.setAttribute('style', `color:${font.getAttribute('color')}`);
        while (font.firstChild) span.appendChild(font.firstChild);
        font.replaceWith(span);
      });
      source.querySelectorAll('annotation[encoding="application/x-tex"]').forEach(ann => {
        const tex = ann.textContent.trim();
        const host = ann.closest('.katex') || ann.parentElement?.parentElement;
        if (!tex || !host) return;
        const span = doc.createElement('span');
        span.setAttribute('data-tex', tex);
        span.textContent = `$${tex}$`;
        host.replaceWith(span);
      });
      source.querySelectorAll('.katex, .katex-inline').forEach(el => {
        if (!el.hasAttribute('data-tex')) el.replaceWith(doc.createTextNode(el.textContent || ''));
      });
      let html = Sanitize.html(source.innerHTML);
      if (!U.stripHtml(html)) html = `<p>${U.esc((source.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000))}</p>`;
      return { title, html };
    },
    /** MD 文本 → HTML 片段（内联数学公式保持原文，交给 KaTeX 渲染） */
    toHtml(mdText = '') {
      const m = mdit();
      if (m) {
        const html = m.render(String(mdText))
          .replace(/==([^=\n<]+)==/g, '<mark>$1</mark>')
          // markdown-it 默认把 - [x] 渲染成普通文本；归一化为应用内可勾选的待办块
          .replace(/<li>\s*\[([ xX])\]\s*([\s\S]*?)<\/li>/g,
            (all, mark, inner) => `<li><input type="checkbox"${mark.toLowerCase() === 'x' ? ' checked' : ''}><span>${inner}</span></li>`);
        return html.replace(/<ul>((?:\s*<li><input type="checkbox"[\s\S]*?<\/li>)+)\s*<\/ul>/g, '<ul class="todo-list">$1</ul>');
      }
      return block(String(mdText).replace(/\r\n?/g, '\n').split('\n'), []);
    },
    /** 检测文本是否像 Markdown（用于粘贴自动转换） */
    looksLikeMd(text = '') {
      const s = text.slice(0, 2000);
      return /^#{1,6}\s/m.test(s) || /^[-*]\s+\S/m.test(s) || /```/.test(s)
        || /\*\*[^*]+\*\*/.test(s) || /==[^=]+==/.test(s) || /^\d+[.、)]\s/m.test(s) || /^>\s/m.test(s);
    },
  };
})();
