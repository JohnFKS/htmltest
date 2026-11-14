// 应用入口：视图注册表 + 顶部导航 + 路由
window.Views = window.Views || {};

window.App = {
  tabs: [
    ['dashboard', '仪表盘'],
    ['notes', '笔记'],
    ['annotator', '截图批注'],
    ['quiz', '刷题'],
    ['review', '复习'],
    ['books', '三本'],
    ['templates', '模板库'],
    ['settings', '设置'],
    ['help', '帮助'],
  ],

  async init() {
    await Store.init();
    Ktx.init();
    this.buildNav();
    Store.on('config-changed', () => this.updateBadge());
    this.updateBadge();
    window.addEventListener('hashchange', () => this.route(location.hash.slice(1)));
    this.route(location.hash.slice(1) || 'dashboard');
  },

  buildNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = this.tabs.map(([id, label]) =>
      `<a href="#${id}" data-view="${id}">${label}</a>`).join('');
  },

  updateBadge() {
    const badge = document.getElementById('ai-badge');
    if (Store.aiLive()) {
      badge.textContent = 'AI 已连接';
      badge.className = 'ai-badge live';
      badge.title = `模型：${Store.config.ai.chatModel}`;
    } else {
      badge.textContent = '演示模式';
      badge.className = 'ai-badge demo';
      badge.title = '在「设置」中配置大模型 API';
    }
  },

  route(name) {
    if (!Views[name]) name = 'dashboard';
    // 清理上一个视图的全局监听等副作用
    if (this.currentView && Views[this.currentView]?._cleanup) {
      try { Views[this.currentView]._cleanup(); } catch (e) { console.error(e); }
    }
    this.currentView = name;
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
    location.hash = name;
    const container = document.getElementById('view');
    container.innerHTML = '';
    try {
      const r = Views[name].render(container);
      if (r && typeof r.catch === 'function') {
        r.catch(e => {
          console.error(e);
          container.innerHTML = UI.emptyState(`视图加载失败：${e.message}`);
        });
      }
    } catch (e) {
      console.error(e);
      container.innerHTML = UI.emptyState(`视图加载失败：${e.message}`);
    }
    Ktx.renderMath(container);
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(e => {
    document.getElementById('view').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div><div>应用初始化失败：${U.esc(e.message)}<br><br>请确认已运行 <span class="kbd">python3 server.py</span> 并访问 <span class="kbd">http://127.0.0.1:8765</span></div></div>`;
  });
});
