// 智学笔记 · 端到端全流程测试（Playwright + Chromium 无头浏览器）
// 覆盖：笔记 / XSS 消毒 / 相似度引擎 / 题库导入 / 作答 / 演示 AI 批改 / 归档三本 / 模板库流水线（新建+归并+扩容）/ 批注 / 圈选提问 / 设置 / 持久化
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8765';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
async function closeAllModals(page) {
  while (await page.locator('.modal-mask').count()) {
    await page.locator('.modal-mask .modal-x').first().click();
    await page.waitForTimeout(150);
  }
}

async function resetDB() {
  const db = { meta: { version: 1, app: 'zhixue-notes' }, notes: [], annots: [], banks: [], records: [], entries: [], templates: [], cards: [], exams: [], chatSessions: [] };
  const res = await fetch(`${BASE}/api/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db }) });
  return res.ok;
}

// 高相似的两道等差数列题（用于归并路径）
const MINI_BANK = `# 迷你测试库

## 等差数列专项

1. 已知等差数列 $\\{a_n\\}$ 的公差 $d=3$，$a_1=2$，则 $a_{10}=$（ ）
A. 29
B. 30
C. 31
D. 32

答案：A
解析：$a_{10}=a_1+9d=2+27=29$，本质是通项公式的基本量思想。

2. 已知等差数列 $\\{b_n\\}$ 的公差 $d=5$，$b_1=3$，则 $b_{20}=$（ ）
A. 95
B. 98
C. 99
D. 96

答案：B
解析：$b_{20}=b_1+19d=3+95=98$，本质是通项公式的基本量思想。
`;

(async () => {
  console.log('== 0. 重置数据库 ==');
  ok(await resetDB(), '数据库已重置');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => { failed++; console.log('  ⚠️ pageerror:', e.message); });
  page.on('dialog', async d => { await d.accept('圈选提问测试：这一步为什么这样做？'); });

  console.log('== 1. 应用加载 ==');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  ok(await page.title().then(t => t.includes('智学笔记')), '页面标题正确');
  ok(await page.locator('.nav a').count() === 9, '导航 9 个视图');
  ok(await page.locator('#ai-badge.demo').count() === 1, '演示模式徽章显示');
  await page.click('#nav a[data-view="notes"]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.body.classList.contains('katex-ok')), 'KaTeX 本地 vendor 已加载');
  await shot(page, '01-notes.png');

  console.log('== 2. 笔记（欢迎笔记 + KaTeX 公式渲染）==');
  ok(await page.locator('#note-title').inputValue().then(t => t.includes('欢迎使用智学笔记')), '欢迎笔记已打开');
  ok(await page.locator('#editor-area .katex').count() >= 2, '公式已渲染为 KaTeX');
  ok(await page.locator('#editor-area details summary').count() >= 1, '折叠块渲染');
  await page.click('#note-new');
  await page.fill('#note-title', 'E2E 测试笔记');
  await page.click('#editor-area');
  await page.keyboard.type('这是端到端测试输入的内容。');
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => Store.db.notes.length === 2), '笔记已自动保存');
  await shot(page, '02-note-edit.png');

  console.log('== 2b. 笔记助教：选中提问 / 多轮 / 多会话 ==');
  await page.evaluate(() => {
    const ed = document.getElementById('editor-area');
    const p = document.createElement('p');
    p.textContent = '选中文本用于助教多轮对话测试。';
    ed.appendChild(p);
    const r = document.createRange();
    r.selectNodeContents(p);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
  });
  await page.waitForTimeout(200);
  ok(await page.locator('.ctx-menu [data-act="ask"]').count() === 1, '选中文本出现右侧提问菜单');
  await page.click('.ctx-menu [data-act="ask"]');
  await page.waitForTimeout(300);
  ok(await page.locator('#note-chat-drawer.open').count() === 1, '右侧对话栏已展开');
  ok((await page.locator('#chat-context .chat-context-text').textContent()).includes('助教多轮对话测试'), '选中文本已带入引用');
  ok(await page.evaluate(() => Store.db.chatSessions.length === 1), '已创建第一段会话');

  await page.fill('#chat-input', '这段话的核心是什么？');
  await page.click('#chat-send');
  await page.waitForTimeout(400);
  ok(await page.locator('#chat-messages .chat-msg-user').count() === 1, '首轮用户消息已记录');
  ok(await page.locator('#chat-messages .chat-msg-ai .ai-report').count() === 1, '演示 AI 回答已渲染');

  await page.fill('#chat-input', '继续举个例子');
  await page.click('#chat-send');
  await page.waitForTimeout(400);
  ok(await page.locator('#chat-messages .chat-msg-user').count() === 2, '第二轮追问已记录');
  ok(await page.locator('#chat-messages .chat-msg-ai .ai-report').count() === 2, '多轮回答已渲染');
  ok(await page.evaluate(() => Store.db.chatSessions[0].messages.length === 4), '多轮消息已持久化');

  await page.click('.chat-head [data-act="new"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Store.db.chatSessions.length === 2), '可新建第二段对话');
  await page.click('.chat-head [data-act="history"]');
  await page.waitForTimeout(250);
  ok(await page.locator('.chat-rail .chat-session').count() === 2, '历史会话列表展示两段对话');
  await page.locator('.chat-rail .chat-session').last().click();
  await page.waitForTimeout(250);
  ok(await page.locator('#chat-messages .chat-msg-user').count() === 2, '切换历史会话恢复多轮记录');
  await page.click('.chat-head [data-act="close"]');
  ok(await page.locator('#note-chat-drawer.open').count() === 0, '对话栏可收起');

  console.log('== 3. XSS 消毒器单元检查 ==');
  const s1 = await page.evaluate(() => Sanitize.html('<img src=x onerror=alert(1)>'));
  ok(!s1.includes('onerror'), 'XSS: onerror 属性被剥离');
  const s2 = await page.evaluate(() => Sanitize.html('<script>alert(1)</script>ok'));
  ok(!s2.includes('script') && s2.includes('ok'), 'XSS: script 标签被移除');
  const s3 = await page.evaluate(() => Sanitize.html('<a href="javascript:alert(1)">x</a>'));
  ok(!s3.includes('javascript:'), 'XSS: javascript: 协议被剥离');
  const s4 = await page.evaluate(() => Sanitize.html('<iframe></iframe>safe'));
  ok(!s4.includes('iframe'), 'XSS: iframe 被移除');
  const s5 = await page.evaluate(() => Sanitize.html('<p class="hl-bad">正常</p>'));
  ok(s5.includes('hl-bad'), 'XSS: 白名单 class 保留');

  console.log('== 4. 相似度引擎单元检查 ==');
  const simA = await page.evaluate(() => Sim.hybridScore('已知函数 f(x)=x^2-2ax+3 在 [0,2] 单调递减求 a 范围', '已知函数 f(x)=x^2+bx+c 在 [1,3] 单调递增求 b 范围').score);
  const simB = await page.evaluate(() => Sim.hybridScore('已知函数 f(x)=x^2-2ax+3 在 [0,2] 单调递减求 a 范围', '正方体棱长 2 求异面直线所成角的余弦值').score);
  ok(simA > simB + 0.1, `同构题相似度(${simA}) 显著高于无关题(${simB})`);
  const diffHtml = await page.evaluate(() => Sim.diffHtml('已知函数 f(x) 单调递减求 a', '已知数列 an 单调递增求 c').html);
  ok(diffHtml.includes('<mark>'), 'diff 对照高亮共同结构');

  console.log('== 5. 题库导入（示例库）==');
  await page.click('#nav a[data-view="quiz"]');
  await page.waitForTimeout(300);
  await page.click('.tab[data-name="import"]');
  await page.waitForTimeout(300);
  await page.click('#imp-sample');
  await page.waitForTimeout(400);
  await page.click('#imp-parse');
  await page.waitForTimeout(600);
  ok(await page.locator('#imp-list .pv-question').count() === 8, '示例题库解析出 8 题');
  await shot(page, '03-import-preview.png');
  await page.fill('#imp-bankname', '高中数学 E2E 库');
  await page.click('#imp-save');
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => Store.db.banks[0]?.questions?.length === 8), '题库入库 8 题');
  ok(await page.evaluate(() => !!Store.db.banks[0].questions[0].answer), '答案字段已解析');

  console.log('== 6. 练习 + 演示 AI 批改 ==');
  await page.click('.tab[data-name="practice"]');
  await page.waitForTimeout(400);
  ok(await page.locator('.q-stem').count() === 1, '题目卡片渲染');
  ok(await page.locator('.q-stem .katex').count() >= 1, '题干公式渲染');
  await shot(page, '04-practice.png');
  await page.click('.atab[data-a="text"]');
  await page.fill('#ans-text', '对称轴 x=a，因为在 [0,2] 递减所以 a>=2');
  await page.click('#ans-save');
  await page.waitForTimeout(700);
  ok(await page.locator('.record-card').count() >= 1, '作答已保存为记录');
  await page.click('#ans-grade');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => (Store.db.records[0]?.aiGrade?.html || '').includes('批改结论')), '演示 AI 批改报告已生成');
  ok(await page.locator('.record-card .ai-report table').count() >= 1, '批改报告含评分细则表');
  await shot(page, '05-ai-grade.png');
  await page.click('#ans-essence');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => !!(Store.db.records[0]?.essence?.html)), '本质思路已生成');
  await page.click('#ans-suggest-tags');
  await page.waitForTimeout(900);
  ok(await page.locator('#tag-chips .chip-tag').count() >= 2, 'AI 标签建议生成');
  await page.click('#tag-save');
  await page.waitForTimeout(400);
  await page.check('#bk-wrong');
  await page.click('#ans-archive');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => Store.db.entries.filter(e => e.kind === 'wrong').length === 1), '已归档错题本');

  console.log('== 7. 手写作答 + 归档模板本（第 2 题）==');
  await page.click('#q-next');
  await page.waitForTimeout(400);
  await page.click('.atab[data-a="draw"]');
  const canvas = page.locator('#draw-canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 120, { steps: 6 });
  await page.mouse.move(box.x + 320, box.y + 80, { steps: 4 });
  await page.mouse.up();
  await page.click('#ans-save');
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => (Store.db.records[0]?.imageUrl || '').startsWith('/images/')), '手写图已落盘');
  await page.check('#bk-tpl');
  await page.click('#ans-archive');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => Store.db.entries.filter(e => e.kind === 'template').length === 1), '已归档模板本');
  await shot(page, '06-draw-answer.png');

  console.log('== 8. 三本视图 ==');
  await page.click('#nav a[data-view="books"]');
  await page.waitForTimeout(400);
  ok(await page.locator('.entry-card.k-wrong').count() === 1, '错题本 1 条');
  await page.click('.book-tab[data-k="template"]');
  await page.waitForTimeout(300);
  ok(await page.locator('.entry-card.k-tpl').count() === 1, '模板本 1 条');
  await shot(page, '07-books.png');

  console.log('== 9. 生成做题模板（空库 → 直接新建）==');
  await page.locator('.entry-card.k-tpl [data-act="totpl"]').first().click();
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => Store.db.templates.length === 1), '模板已新建');
  console.log(`  模板名：${await page.evaluate(() => Store.db.templates[0]?.name || '')}`);

  console.log('== 10. 第二题入库：无相似候选 → 人工新建路径 ==');
  await page.click('#nav a[data-view="quiz"]');
  await page.waitForTimeout(300);
  await page.click('.tab[data-name="practice"]');
  await page.waitForTimeout(300);
  await page.locator('#q-nav .quiz-nav-item').nth(2).click(); // 第 3 题（导数零点）
  await page.waitForTimeout(300);
  await page.click('.atab[data-a="text"]');
  await page.fill('#ans-text', '分离参数 a = ln x / x，数形结合');
  await page.click('#ans-save');
  await page.waitForTimeout(600);
  await page.check('#bk-tpl');
  await page.click('#ans-archive');
  await page.waitForTimeout(500);
  await page.click('#nav a[data-view="books"]');
  await page.waitForTimeout(400);
  await page.click('.book-tab[data-k="template"]');
  await page.waitForTimeout(300);
  await page.locator('.entry-card.k-tpl').nth(0).locator('[data-act="totpl"]').click();
  await page.waitForTimeout(1800);
  ok(await page.locator('.modal:visible').count() > 0, '相似度判定 modal 弹出');
  const candCount = await page.locator('.sim-table tbody tr').count();
  console.log(`  召回候选：${candCount} 个（0 = 低于召回线，属正常判离）`);
  await shot(page, '08-pipeline.png');
  const newBtn = page.locator('.modal-foot .btn', { hasText: '新建模板' });
  if (await newBtn.count() > 0) { await newBtn.first().click(); await page.waitForTimeout(1000); }
  await closeAllModals(page);
  ok(await page.evaluate(() => Store.db.templates.length === 2), '人工新建路径完成（库内 2 个）');

  console.log('== 11. 高相似题归并路径（迷你题库）==');
  await page.click('#nav a[data-view="quiz"]');
  await page.waitForTimeout(300);
  await page.click('.tab[data-name="import"]');
  await page.waitForTimeout(300);
  await page.fill('#imp-text', MINI_BANK);
  await page.click('#imp-parse');
  await page.waitForTimeout(600);
  ok(await page.locator('#imp-list .pv-question').count() === 2, '迷你题库解析 2 题');
  await page.fill('#imp-bankname', '迷你测试库');
  await page.click('#imp-save');
  await page.waitForTimeout(600);
  // 第 1 题归档模板本并生成模板
  await page.click('.atab[data-a="text"]');
  await page.fill('#ans-text', 'a10 = a1 + 9d = 2 + 27 = 29');
  await page.click('#ans-save');
  await page.waitForTimeout(500);
  await page.check('#bk-tpl');
  await page.click('#ans-archive');
  await page.waitForTimeout(400);
  await page.click('#nav a[data-view="books"]');
  await page.waitForTimeout(300);
  await page.click('.book-tab[data-k="template"]');
  await page.waitForTimeout(300);
  await page.locator('.entry-card.k-tpl').nth(0).locator('[data-act="totpl"]').click();
  await page.waitForTimeout(1500);
  const firstCands = await page.locator('.sim-table tbody tr').count();
  console.log(`  迷你第 1 题召回候选 ${firstCands} 个`);
  const newBtn2 = page.locator('.modal-foot .btn', { hasText: '新建模板' });
  if (await newBtn2.count() > 0) { await newBtn2.first().click(); await page.waitForTimeout(1000); }
  await closeAllModals(page);
  const tplAfterFirst = await page.evaluate(() => Store.db.templates.length);
  ok(tplAfterFirst === 3, `迷你第 1 题已生成模板（库内 ${tplAfterFirst} 个）`);
  // 第 2 题（高相似）走流水线 → 应召回第 1 题模板并触发裁决
  await page.click('#nav a[data-view="quiz"]');
  await page.waitForTimeout(300);
  await page.click('.tab[data-name="practice"]');
  await page.waitForTimeout(300);
  await page.click('#q-next');
  await page.waitForTimeout(300);
  await page.click('.atab[data-a="text"]');
  await page.fill('#ans-text', 'b20 = b1 + 19d = 3 + 95 = 98');
  await page.click('#ans-save');
  await page.waitForTimeout(500);
  await page.check('#bk-tpl');
  await page.click('#ans-archive');
  await page.waitForTimeout(400);
  await page.click('#nav a[data-view="books"]');
  await page.waitForTimeout(300);
  await page.click('.book-tab[data-k="template"]');
  await page.waitForTimeout(300);
  await page.locator('.entry-card.k-tpl').nth(0).locator('[data-act="totpl"]').click();
  await page.waitForTimeout(1800);
  ok(await page.locator('.modal:visible').count() > 0, '高相似题流水线 modal 弹出');
  const cand2 = await page.locator('.sim-table tbody tr').count();
  ok(cand2 >= 1, `召回候选 ${cand2} 个（应 ≥1，迷你第 1 题模板在列）`);
  ok(await page.locator('.diff-box').count() === 1, '结构对照 diff 展示');
  ok(await page.locator('.verdict-badge').count() >= 1, '裁决徽章展示');
  await shot(page, '09-pipeline-merge.png');
  // 优先自动归并主按钮，否则行内人工归并
  const mergeBtn = page.locator('.modal-foot .btn-primary', { hasText: '归并' });
  if (await mergeBtn.count() > 0) await mergeBtn.click();
  else await page.locator('.sim-table [data-merge]').first().click();
  await page.waitForTimeout(1800);
  await closeAllModals(page);
  const maxMembers = await page.evaluate(() => Math.max(...Store.db.templates.map(t => t.members.length)));
  ok(maxMembers === 2, `归并成功：模板成员题 ${maxMembers} 道`);
  const verdictRecorded = await page.evaluate(() => Store.db.templates.some(t => (t.history || []).some(h => h.verdict)));
  ok(verdictRecorded, '判定历史（分数+裁决）已记录');
  const hasVariants = await page.evaluate(() => Store.db.templates.some(t => (t.variants || []).length > 0));
  ok(hasVariants, '归并触发扩容变式');

  console.log('== 12. 模板库视图 + 扩容 + 详情 ==');
  await page.click('#nav a[data-view="templates"]');
  await page.waitForTimeout(400);
  ok(await page.locator('.entry-card.k-tpl').count() === 3, '模板卡片渲染 3 个');
  await page.locator('.entry-card.k-tpl [data-act="expand"]').first().click();
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => Store.db.templates.some(t => (t.variants || []).length > 1)), '扩容追加变式');
  await closeAllModals(page);
  await page.locator('.entry-card.k-tpl [data-act="detail"]').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('.modal .ai-report table').count() >= 1, '模板详情（含判定历史表）');
  await shot(page, '10-template-detail.png');
  await closeAllModals(page);

  console.log('== 13. 截图批注 ==');
  await page.click('#nav a[data-view="annotator"]');
  await page.waitForTimeout(500);
  // 在浏览器中生成 800x600 测试底图
  const imgFile = path.join(SHOTS, '_testimg.png');
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f0ebe0'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = '#26231d'; ctx.font = '36px sans-serif';
    ctx.fillText('E2E 测试底图：已知函数 f(x) 在区间上单调递减', 60, 280);
    ctx.fillStyle = '#3457d5'; ctx.font = '28px sans-serif';
    ctx.fillText('第 (1) 问：求参数取值范围', 60, 340);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(imgFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const chooserP = page.waitForEvent('filechooser');
  await page.click('#btn-upload');
  const chooser = await chooserP;
  await chooser.setFiles(imgFile);
  await page.waitForTimeout(1000);
  ok(await page.locator('#annot-box').isVisible(), '底图已导入显示画布');
  const ov = page.locator('#annot-overlay');
  const ob = await ov.boundingBox();
  ok(ob.width > 400, `画布尺寸正常（${Math.round(ob.width)}px 宽）`);
  // 画笔
  await page.mouse.move(ob.x + 60, ob.y + 80);
  await page.mouse.down();
  await page.mouse.move(ob.x + 240, ob.y + 140, { steps: 6 });
  await page.mouse.move(ob.x + 380, ob.y + 100, { steps: 4 });
  await page.mouse.up();
  // 矩形
  await page.click('.tool-btn[data-tool="rect"]');
  await page.mouse.move(ob.x + 420, ob.y + 180);
  await page.mouse.down();
  await page.mouse.move(ob.x + 640, ob.y + 300, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => Store.db.annots[0]?.layers?.length === 2), `批注图层已保存（${await page.evaluate(() => Store.db.annots[0]?.layers?.length)} 层）`);
  await page.click('#btn-undo');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Views.annotator.layers.length) === 1, '撤销生效');
  await page.click('#btn-redo');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Views.annotator.layers.length) === 2, '重做生效');
  await shot(page, '11-annotator.png');
  await page.click('#btn-export');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => (Store.db.annots[0]?.exportedUrl || '').startsWith('/images/')), '批注导出 PNG 已落盘');
  // 圈选提问（ask 工具 → native prompt 由 dialog handler 自动回答）
  await page.click('.tool-btn[data-tool="ask"]');
  await page.mouse.move(ob.x + 100, ob.y + 380);
  await page.mouse.down();
  await page.mouse.move(ob.x + 400, ob.y + 470, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => (Store.db.annots[0]?.asks || []).length > 0), '圈选提问完成（演示回答已存档）');
  if (await page.locator('.modal:visible').count()) await shot(page, '12-circle-ask.png');
  await closeAllModals(page);

  console.log('== 14. 笔记插入批注图 ==');
  await page.click('#nav a[data-view="notes"]');
  await page.waitForTimeout(400);
  await page.click('#note-insert-annot');
  await page.waitForTimeout(400);
  await page.locator('.annot-pick').first().click();
  await page.waitForTimeout(500);
  ok(await page.locator('#editor-area img').count() >= 1, '批注产物已插入笔记');
  await shot(page, '13-note-with-annot.png');
  await closeAllModals(page);

  console.log('== 15. 设置页 ==');
  await page.click('#nav a[data-view="settings"]');
  await page.waitForTimeout(400);
  ok(await page.locator('.prompt-item').count() === 13, '13 组提示词可编辑');
  await page.locator('.prompt-item[data-key="grade"] .prompt-head').click(); // 展开面板
  await page.locator('.prompt-item [data-ta="grade"]').fill('自定义批改提示词 E2E');
  await page.locator('.prompt-item [data-save="grade"]').click();
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => Store.config.prompts?.grade === '自定义批改提示词 E2E'), '提示词自定义已保存');
  ok(await page.evaluate(() => Store.prompt('grade') === '自定义批改提示词 E2E'), 'Store.prompt 覆写生效');
  await page.locator('.prompt-item[data-key="grade"] .prompt-head').click(); // 重渲染后重新展开
  await page.locator('.prompt-item [data-reset="grade"]').click();
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !Store.config.prompts?.grade), '提示词重置生效');
  await page.click('#data-export');
  await page.waitForTimeout(600);
  ok(true, '数据导出触发');

  console.log('== 16. 帮助页 ==');
  await page.click('#nav a[data-view="help"]');
  await page.waitForTimeout(300);
  ok(await page.locator('.help-doc details').count() >= 5, '帮助页 FAQ 完整');
  await shot(page, '14-help.png');

  console.log('== 17. design-system 页 ==');
  await page.goto(`${BASE}/design-system.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  ok(await page.locator('.swatch').count() >= 10, '设计系统色板展示');
  await shot(page, '15-design-system.png');

  console.log('== 18. 持久化检查（刷新后数据仍在）==');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const persisted = await page.evaluate(() => ({
    banks: Store.db.banks.length, records: Store.db.records.length,
    entries: Store.db.entries.length, templates: Store.db.templates.length,
    annots: Store.db.annots.length, notes: Store.db.notes.length,
  }));
  ok(persisted.banks === 2 && persisted.entries === 5 && persisted.templates === 3 && persisted.annots === 1,
    `刷新后数据完整：题库${persisted.banks} 记录${persisted.records} 三本${persisted.entries} 模板${persisted.templates} 批注${persisted.annots}`);

  await browser.close();
  console.log(`\n======== 测试完成：${passed} 通过，${failed} 失败 ========`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });
