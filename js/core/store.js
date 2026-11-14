// 全局状态：db（业务数据）+ config（AI 配置/提示词/相似度参数）
// 保存策略：debounce 1.2s 全量写回 server.py（单用户本地应用，全量足够）
window.Store = {
  db: null,
  config: null,
  _listeners: {},

  on(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
  emit(evt, arg) { (this._listeners[evt] || []).forEach(fn => { try { fn(arg); } catch (e) { console.error(e); } }); },

  async init() {
    [this.db, this.config] = await Promise.all([Api.getState(), Api.getConfig()]);
    this.emit('ready');
  },

  _persist: null,
  save() {
    if (!this._persist) {
      this._persist = U.debounce(() => this.saveNow(), 1200);
    }
    this._persist();
  },
  async saveNow() {
    try {
      await Api.saveState(this.db);
    } catch (e) {
      UI.toast(`保存失败：${e.message}`, 'error');
    }
  },

  async saveConfig() {
    try {
      await Api.saveConfig(this.config);
      this.emit('config-changed');
    } catch (e) {
      UI.toast(`配置保存失败：${e.message}`, 'error');
    }
  },

  // ---------- 提示词：config.prompts 覆写优先，否则用内置默认 ----------
  prompt(key) {
    const override = this.config.prompts?.[key];
    return (override && override.trim()) ? override : Prompts.defaults[key];
  },
  setPrompt(key, value) {
    (this.config.prompts ||= {});
    if (!value || value === Prompts.defaults[key]) delete this.config.prompts[key];
    else this.config.prompts[key] = value;
  },

  // 是否已配置真实 AI
  aiLive() {
    const ai = this.config.ai || {};
    return !!(ai.baseUrl && ai.apiKey && ai.chatModel);
  },

  // ---------- 通用集合操作 ----------
  coll(name) { return (this.db[name] ||= []); },
  insert(name, obj) { this.coll(name).unshift(obj); this.save(); return obj; },
  update(name, id, patch) {
    const item = this.coll(name).find(x => x.id === id);
    if (item) Object.assign(item, patch, { updatedAt: U.now() });
    this.save();
    return item;
  },
  remove(name, id) {
    const c = this.coll(name);
    const i = c.findIndex(x => x.id === id);
    if (i >= 0) c.splice(i, 1);
    this.save();
  },
  find(name, id) { return this.coll(name).find(x => x.id === id); },
};
