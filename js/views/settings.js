// 设置：AI 配置 / 相似度参数 / 提示词编辑 / 数据管理
window.Views = window.Views || {};

Views.settings = {
  render(container) {
    const cfg = Store.config;
    const ai = cfg.ai, sim = cfg.similarity;
    container.innerHTML = `
      <h1 class="page-title">设置</h1>
      <div class="page-sub">配置大模型 API、调参提示词与相似度算法、管理数据</div>
      <div class="settings-grid">
        <!-- AI 配置 -->
        <div class="card">
          <div class="card-title">🤖 大模型 API <span id="ai-status" class="chip ${Store.aiLive() ? 'chip-good' : ''}">${Store.aiLive() ? '已配置' : '未配置（演示模式）'}</span></div>
          <div class="field">
            <label class="field-label">接口地址 baseUrl</label>
            <input class="input" id="ai-url" value="${U.esc(ai.baseUrl)}" placeholder="https://api.deepseek.com/v1 或 https://api.openai.com/v1">
            <div class="field-hint">OpenAI 兼容接口；以 /v1 结尾会自动拼接 /chat/completions</div>
          </div>
          <div class="field">
            <label class="field-label">API Key</label>
            <input class="input" id="ai-key" type="password" value="${U.esc(ai.apiKey)}" placeholder="sk-…">
            <div class="field-hint">仅保存在本机 data/config.json，经本地服务器代理调用</div>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">对话模型（批改/模板/裁决）</label>
              <input class="input" id="ai-chat" value="${U.esc(ai.chatModel)}" placeholder="deepseek-chat / gpt-4o-mini / qwen-plus">
            </div>
            <div class="field">
              <label class="field-label">视觉模型（手写照片/圈选提问）</label>
              <input class="input" id="ai-vision" value="${U.esc(ai.visionModel)}" placeholder="qwen-vl-max / gpt-4o（留空则图片不可批改）">
            </div>
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label">向量模型（相似度精排，可选）</label>
              <input class="input" id="ai-embed" value="${U.esc(ai.embedModel)}" placeholder="text-embedding-3-small 等">
            </div>
            <div class="field">
              <label class="field-label">温度 temperature（${ai.temperature}）</label>
              <input type="range" id="ai-temp" min="0" max="1" step="0.1" value="${ai.temperature}">
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" id="ai-save">保存配置</button>
            <button class="btn" id="ai-test">连接测试</button>
          </div>
          <div class="field-hint" id="ai-test-result"></div>
        </div>

        <!-- 相似度参数 -->
        <div class="card">
          <div class="card-title">📐 相似度算法参数</div>
          <div class="field-hint">混合分 = wJ×bigram-Jaccard + wT×TF-IDF余弦 + wK×关键词重叠（权重和应为 1）</div>
          <div class="slider-row"><span>bigram Jaccard 权重 wJ</span></div>
          <div class="slider-row"><input type="range" id="sim-wj" min="0" max="1" step="0.05" value="${sim.wJaccard}"><b id="sim-wj-v">${sim.wJaccard}</b></div>
          <div class="slider-row"><span>TF-IDF 余弦权重 wT</span></div>
          <div class="slider-row"><input type="range" id="sim-wt" min="0" max="1" step="0.05" value="${sim.wTfidf}"><b id="sim-wt-v">${sim.wTfidf}</b></div>
          <div class="slider-row"><span>关键词重叠权重 wK</span></div>
          <div class="slider-row"><input type="range" id="sim-wk" min="0" max="1" step="0.05" value="${sim.wKeyword}"><b id="sim-wk-v">${sim.wKeyword}</b></div>
          <div class="slider-row"><span>召回候选数 top-K</span></div>
          <div class="slider-row"><input type="range" id="sim-k" min="1" max="10" step="1" value="${sim.recallTopK}"><b id="sim-k-v">${sim.recallTopK}</b></div>
          <div class="slider-row"><span>LLM 自动归并置信阈值</span></div>
          <div class="slider-row"><input type="range" id="sim-conf" min="0.5" max="1" step="0.05" value="${sim.autoMergeConfidence}"><b id="sim-conf-v">${sim.autoMergeConfidence}</b></div>
          <div class="slider-row"><span>演示模式归并阈值（混合分）</span></div>
          <div class="slider-row"><input type="range" id="sim-demo" min="0.3" max="0.95" step="0.01" value="${sim.demoThreshold}"><b id="sim-demo-v">${sim.demoThreshold}</b></div>
          <button class="btn btn-primary" id="sim-save" style="margin-top:8px">保存参数</button>
          <div class="field-hint">调参建议：误归并（不同题型被合并）→ 降低阈值/提高 LLM 置信阈值；漏归并（同题型没归进）→ 提高阈值/增大 wK</div>
        </div>

        <!-- 提示词 -->
        <div class="card">
          <div class="card-title">✍️ 提示词（全部可编辑，调参即改这里）</div>
          <div id="prompts"></div>
        </div>

        <!-- 数据管理 -->
        <div class="card">
          <div class="card-title">💾 数据管理</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" id="data-export">导出全部数据（JSON）</button>
            <button class="btn" id="data-export-img">导出（含图片内嵌）</button>
            <button class="btn" id="data-import">导入备份</button>
            <button class="btn btn-danger" id="data-clear">清空全部数据</button>
          </div>
          <div class="field-hint">数据存储在 data/db.json + data/images/；导出含图片的备份体积较大，导入时自动重建图片文件</div>
          <div class="field" style="margin-top:12px">
            <label class="field-label">OCR（预留，暂未实现）</label>
            <label class="checkbox-row" style="opacity:.5"><input type="checkbox" disabled><span>启用本地 OCR 识别手写/照片作答（后续可接 PaddleOCR）</span></label>
          </div>
        </div>
      </div>`;

    // ---------- AI 配置 ----------
    container.querySelector('#ai-temp').oninput = e => e.target.previousElementSibling;
    const collectAI = () => ({
      ...Store.config.ai,
      baseUrl: container.querySelector('#ai-url').value.trim(),
      apiKey: container.querySelector('#ai-key').value.trim(),
      chatModel: container.querySelector('#ai-chat').value.trim(),
      visionModel: container.querySelector('#ai-vision').value.trim(),
      embedModel: container.querySelector('#ai-embed').value.trim(),
      temperature: +container.querySelector('#ai-temp').value,
    });
    container.querySelector('#ai-save').onclick = async () => {
      Store.config.ai = collectAI();
      await Store.saveConfig();
      container.querySelector('#ai-status').className = `chip ${Store.aiLive() ? 'chip-good' : ''}`;
      container.querySelector('#ai-status').textContent = Store.aiLive() ? '已配置' : '未配置（演示模式）';
      UI.toast('AI 配置已保存', 'success');
    };
    container.querySelector('#ai-test').onclick = async e => {
      Store.config.ai = collectAI();
      await Store.saveConfig();
      const out = container.querySelector('#ai-test-result');
      out.textContent = '测试中…';
      try {
        const r = await Api.aiChat({ messages: [{ role: 'user', content: '只回复四个字：连接成功' }], temperature: 0 });
        const text = String(r.content || '').trim().slice(0, 40);
        out.innerHTML = `<span style="color:var(--good)">✓ 对话模型连通，返回：${U.esc(text)}</span>`;
        if ((Store.config.ai.embedModel || '').trim()) {
          try {
            await Api.aiEmbed({ input: ['测试'] });
            out.innerHTML += '<br><span style="color:var(--good)">✓ 向量模型连通</span>';
          } catch (e2) {
            out.innerHTML += `<br><span style="color:var(--warn)">⚠ 向量模型异常：${U.esc(e2.message)}（相似度精排将被跳过）</span>`;
          }
        }
      } catch (e3) {
        out.innerHTML = `<span style="color:var(--danger)">✗ ${U.esc(e3.message)}</span>`;
      }
    };

    // ---------- 相似度参数 ----------
    ['sim-wj', 'sim-wt', 'sim-wk', 'sim-k', 'sim-conf', 'sim-demo'].forEach(id => {
      container.querySelector(`#${id}`).oninput = e => {
        container.querySelector(`#${id}-v`).textContent = e.target.value;
      };
    });
    container.querySelector('#sim-save').onclick = async () => {
      Store.config.similarity = {
        wJaccard: +container.querySelector('#sim-wj').value,
        wTfidf: +container.querySelector('#sim-wt').value,
        wKeyword: +container.querySelector('#sim-wk').value,
        recallTopK: +container.querySelector('#sim-k').value,
        autoMergeConfidence: +container.querySelector('#sim-conf').value,
        demoThreshold: +container.querySelector('#sim-demo').value,
      };
      const sum = Store.config.similarity.wJaccard + Store.config.similarity.wTfidf + Store.config.similarity.wKeyword;
      await Store.saveConfig();
      UI.toast(sum === 1 ? '参数已保存' : `参数已保存（注意：权重和为 ${sum}，建议为 1）`, sum === 1 ? 'success' : 'warn');
    };

    // ---------- 提示词 ----------
    const promptsEl = container.querySelector('#prompts');
    promptsEl.innerHTML = Object.entries(Prompts.meta).map(([key, meta]) => {
      const customized = Store.config.prompts?.[key] && Store.config.prompts[key].trim();
      return `
      <div class="prompt-item" data-key="${key}">
        <div class="prompt-head">
          <span><b>${meta.name}</b> <span class="muted small">${meta.desc}</span></span>
          <span style="display:flex;gap:8px;align-items:center">
            ${customized ? '<span class="customized-mark">已自定义</span>' : ''}
            <span class="muted small">${key}</span>
          </span>
        </div>
        <div class="prompt-body">
          <textarea class="textarea" data-ta="${key}">${U.esc(Store.prompt(key))}</textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-sm btn-primary" data-save="${key}">保存</button>
            <button class="btn btn-sm" data-reset="${key}">重置为默认</button>
          </div>
        </div>
      </div>`;
    }).join('');
    promptsEl.querySelectorAll('.prompt-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('open'));
    promptsEl.querySelectorAll('[data-save]').forEach(btn => btn.onclick = async () => {
      const key = btn.dataset.save;
      Store.setPrompt(key, promptsEl.querySelector(`[data-ta="${key}"]`).value);
      await Store.saveConfig();
      UI.toast(`提示词「${Prompts.meta[key].name}」已保存`, 'success');
      this.render(container);
    });
    promptsEl.querySelectorAll('[data-reset]').forEach(btn => btn.onclick = async () => {
      const key = btn.dataset.reset;
      Store.setPrompt(key, '');
      promptsEl.querySelector(`[data-ta="${key}"]`).value = Prompts.defaults[key];
      await Store.saveConfig();
      UI.toast('已重置为默认提示词', 'success');
      this.render(container);
    });

    // ---------- 数据管理 ----------
    const collectImageUrls = () => {
      const urls = new Set();
      const db = Store.db;
      for (const n of db.notes || []) {
        const d = document.createElement('div');
        d.innerHTML = n.content || '';
        d.querySelectorAll('img[src]').forEach(i => { if (i.getAttribute('src').startsWith('/images/')) urls.add(i.getAttribute('src')); });
      }
      for (const a of db.annots || []) {
        if (a.imageUrl?.startsWith('/images/')) urls.add(a.imageUrl);
        if (a.exportedUrl?.startsWith('/images/')) urls.add(a.exportedUrl);
        for (const k of a.asks || []) if (k.imageUrl?.startsWith('/images/')) urls.add(k.imageUrl);
      }
      for (const r of db.records || []) if (r.imageUrl?.startsWith('/images/')) urls.add(r.imageUrl);
      for (const e of db.entries || []) if (e.myAnswer?.imageUrl?.startsWith('/images/')) urls.add(e.myAnswer.imageUrl);
      return [...urls];
    };
    const exportData = async withImages => {
      const db = JSON.parse(JSON.stringify(Store.db));
      if (withImages) {
        const urls = collectImageUrls();
        const map = {};
        for (const u of urls) {
          try { map[u] = await AI.urlToData(u); } catch { /* 跳过失败图片 */ }
        }
        db.__images = map;
      }
      U.download(`智学笔记备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ db, config: { ...Store.config, ai: { ...Store.config.ai, apiKey: '' } } }));
      UI.toast('备份已导出（API Key 不包含在备份中）', 'success');
    };
    container.querySelector('#data-export').onclick = () => exportData(false);
    container.querySelector('#data-export-img').onclick = () => exportData(true);

    container.querySelector('#data-import').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/json';
      input.onchange = async () => {
        if (!input.files[0]) return;
        try {
          const parsed = JSON.parse(await input.files[0].text());
          if (!parsed.db) throw new Error('文件中缺少 db 字段');
          if (!await UI.confirm('导入将覆盖当前全部数据，确定继续？', { danger: true })) return;
          const db = parsed.db;
          // 重建图片文件
          if (db.__images) {
            const raw = JSON.stringify(db);
            let restored = raw;
            for (const [url, dataUrl] of Object.entries(db.__images)) {
              try {
                const newUrl = await Api.upload(dataUrl);
                restored = restored.split(url).join(newUrl);
              } catch { /* 跳过 */ }
            }
            delete db.__images;
            Object.assign(Store.db, JSON.parse(restored));
          } else {
            Object.assign(Store.db, db);
          }
          if (parsed.config) {
            Store.config = { ...Store.config, ...parsed.config, ai: { ...Store.config.ai, ...parsed.config.ai } };
            await Store.saveConfig();
          }
          await Store.saveNow();
          UI.toast('备份导入完成', 'success');
          App.route('settings');
        } catch (e) {
          UI.toast(`导入失败：${e.message}`, 'error');
        }
      };
      input.click();
    };
    container.querySelector('#data-clear').onclick = async () => {
      if (!await UI.confirm('清空全部数据（笔记/题库/记录/三本/模板/批注）？此操作不可撤销！', { danger: true })) return;
      if (!await UI.confirm('再次确认：真的要清空吗？建议先导出备份。', { danger: true })) return;
      Store.db = { meta: { version: 1, app: 'zhixue-notes' }, notes: [], annots: [], banks: [], records: [], entries: [], templates: [] };
      await Store.saveNow();
      UI.toast('已清空', 'success');
      App.route('notes');
    };
  },
};
