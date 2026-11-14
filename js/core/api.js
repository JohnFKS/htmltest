// 后端 API 封装：所有请求走相对路径（由 server.py 提供服务）
window.Api = {
  async _post(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败 (${resp.status})`);
    return data;
  },

  async _get(path) {
    const resp = await fetch(path);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `请求失败 (${resp.status})`);
    return data;
  },

  getState() { return this._get('/api/state').then(d => d.db); },
  saveState(db) { return this._post('/api/state', { db }); },

  getConfig() { return this._get('/api/config').then(d => d.config); },
  saveConfig(config) { return this._post('/api/config', { config }); },

  // dataURL 存为图片文件，返回 {url}
  async upload(dataUrl, name) {
    const d = await this._post('/api/upload', { dataUrl, name });
    return d.url;
  },

  // 大模型对话（服务端代理）。payload: {messages, model?, temperature?, max_tokens?}
  aiChat(payload) { return this._post('/api/ai/chat', payload); },

  // 向量（可选）。payload: {input: [text, ...]}
  aiEmbed(payload) { return this._post('/api/ai/embed', payload); },
};
