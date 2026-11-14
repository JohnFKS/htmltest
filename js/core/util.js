// 通用工具函数
window.U = {
  uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  },

  now() { return new Date().toISOString(); },

  fmt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  esc(s = '') {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  },

  debounce(fn, ms = 800) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
    return wrapped;
  },

  clamp(v, min, max) { return Math.min(max, Math.max(min, v)); },

  readFileDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsDataURL(file);
    });
  },

  // 图片压缩（最长边限制，输出 JPEG/PNG dataURL），减小落盘体积
  async compressDataURL(dataUrl, maxEdge = 1600, quality = 0.85) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('图片解码失败'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    if (scale >= 1 && dataUrl.length < 400 * 1024) return dataUrl; // 小图不压
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const isPng = dataUrl.startsWith('data:image/png');
    return isPng && scale >= 1 ? dataUrl
      : c.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality);
  },

  download(filename, text, mime = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  },

  copyText(text) {
    return navigator.clipboard?.writeText(text)
      .catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
      });
  },

  // 从 HTML 提取纯文本（用于相似度计算、搜索）
  stripHtml(html = '') {
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  },
};
