import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 智学笔记 · 真实 AI（Dots dots3-note-prev）分阶段测试

const BASE = 'http://127.0.0.1:8765';
const SHOTS = path.join(__dirname, 'shots-real');
fs.mkdirSync(SHOTS, { recursive: true });
const NOTES_FILE = path.join(__dirname, '..', 'sample', '2026年基金从业《证券投资基金》三色笔记-已解锁.pdf_by_PaddleOCR-VL-1.6.md');

let passed = 0, failed = 0;
const ok = (c, name) => { if (c) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`); } };
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n) });
async function closeAllModals(p) {
  while (await p.locator('.modal-mask').count()) { await p.locator('.modal-mask .modal-x').first().click(); await p.waitForTimeout(150); }
}
async function waitForEval(page, fn, timeoutMs = 300000, interval = 4000, desc = '') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await page.evaluate(fn); if (v) return v; } catch { /* ignore */ }
    await page.waitForTimeout(interval);
  }
  console.log(`  ⏳ 等待超时：${desc}`);
  return null;
}

async function resetDB() {
  const db = { meta: { version: 1, app: 'zhixue-notes' }, notes: [], annots: [], banks: [], records: [], entries: [], templates: [] };
  await fetch(`${BASE}/api/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db }) });
}

const browser = await chromium.launch({ headless: true });

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  ⚠️ pageerror:', e.message));
  page.setDefaultTimeout(60000);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  return page;
}

const phase = process.argv[2] || 'import';

try {
  if (phase === 'import') {
    console.log('== [导入] 笔记出题模式（真实 LLM 从 OCR 讲义命题）==');
    await resetDB();
    const page = await newPage();
    ok(await page.locator('#ai-badge.live').count() === 1, '顶部徽章 = AI 已连接');
    await page.click('#nav a[data-view="quiz"]');
    await page.waitForTimeout(300);
    await page.click('.tab[data-name="import"]');
    await page.waitForTimeout(300);
    const md = fs.readFileSync(NOTES_FILE, 'utf-8');
    await page.evaluate(t => { document.getElementById('imp-text').value = t; }, md);
    await page.check('#imp-genmode');
    console.log(`  输入文档：${md.length} 字符`);
    await page.click('#imp-ai');
    const ready = await waitForEval(page,
      () => document.querySelector('#imp-list .pv-question') ? document.querySelectorAll('#imp-list .pv-question').length : null,
      420000, 5000, 'LLM 命题');
    if (!ready) { await shot(page, 'R1-import-fail.png'); throw new Error('LLM 命题超时或失败'); }
    ok(ready >= 10, `LLM 生成并解析出 ${ready} 题（≥10）`);
    const meta = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#imp-list .pv-question .chip')].map(c => c.textContent.trim());
      const firstStem = document.querySelector('#imp-list .pv-stem')?.innerText.slice(0, 80);
      return { chips: chips.slice(0, 8), firstStem };
    });
    console.log(`  示例题干：${meta.firstStem}`);
    await shot(page, 'R1-import-preview.png');
    await page.fill('#imp-bankname', '基金从业三色笔记（AI 出题）');
    await page.click('#imp-save');
    await page.waitForTimeout(800);
    const bankLen = await page.evaluate(() => Store.db.banks[0]?.questions?.length || 0);
    ok(bankLen >= 10, `题库入库 ${bankLen} 题`);
    // 抽查答案与解析质量
    const q1 = await page.evaluate(() => Store.db.banks[0].questions[0]);
    ok(!!(q1.answer && q1.analysis), `第 1 题带答案与解析（答案=${(q1.answer || '').slice(0, 12)}）`);
    await page.close();
  }

  if (phase === 'features') {
    console.log('== [批改] 真实 AI 批改 / 本质思路 / 标签 / 归档 ==');
    const page = await newPage();
    await page.click('#nav a[data-view="quiz"]');
    await page.waitForTimeout(400);
    await page.click('.atab[data-a="text"]');
    // 读取第 1 题的正确答案，故意提交一个错误选项，测试 AI 的错因分析
    const wrongAns = await page.evaluate(() => {
      const q = Store.db.banks[0].questions[0];
      const correct = (q.answer || 'A').trim().toUpperCase().charAt(0);
      const letters = (q.options || []).map(o => o.charAt(0).toUpperCase());
      const wrong = letters.filter(l => l !== correct).at(-1) || (correct === 'A' ? 'B' : 'A');
      return { correct, wrong, stem: U.stripHtml(q.stem).slice(0, 60) };
    });
    console.log(`  第 1 题：${wrongAns.stem}…（正确 ${wrongAns.correct}，将答错选 ${wrongAns.wrong}）`);
    await page.fill('#ans-text', `我选 ${wrongAns.wrong}。理由：凭印象选的，感觉这个说法比较常见。`);
    await page.click('#ans-grade');
    const graded = await waitForEval(page, () => {
      const r = Store.db.records.find(r => r.aiGrade);
      return r ? { demo: r.aiGrade.demo, len: r.aiGrade.html.length, hasTable: r.aiGrade.html.includes('<table') } : null;
    }, 300000, 5000, 'AI 批改');
    ok(!!graded && graded.demo === false, '真实 AI 批改完成（非演示）');
    ok(!!graded && graded.len > 300 && graded.hasTable, `批改报告含评分细则表（${graded?.len} 字符 HTML）`);
    await shot(page, 'R2-real-grade.png');
    // 本质思路
    await page.click('#ans-essence');
    const ess = await waitForEval(page, () => {
      const r = Store.db.records.find(r => r.essence);
      return r ? { demo: r.essence.demo, len: r.essence.html.length } : null;
    }, 300000, 5000, '本质思路');
    ok(!!ess && ess.demo === false && ess.len > 200, `真实 AI 本质思路已生成（${ess?.len} 字符）`);
    await shot(page, 'R2-essence.png');
    // 标签
    await page.click('#ans-suggest-tags');
    const tags = await waitForEval(page, () => {
      const chips = document.querySelectorAll('#tag-chips .chip-tag');
      return chips.length ? [...chips].map(c => c.textContent.replace('×', '')) : null;
    }, 300000, 5000, '标签建议');
    ok(Array.isArray(tags) && tags.length >= 2, `AI 标签建议：${(tags || []).join('、')}`);
    await page.click('#tag-save');
    await page.waitForTimeout(400);
    // 归档错题本
    await page.check('#bk-wrong');
    await page.click('#ans-archive');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => Store.db.entries.filter(e => e.kind === 'wrong').length === 1), '已归档错题本');
    // 再归档两道同库题目到模板本（供模板流程）
    for (const i of [1, 2]) {
      await page.locator('#q-nav .quiz-nav-item').nth(i).click();
      await page.waitForTimeout(300);
      await page.click('.atab[data-a="text"]');
      await page.fill('#ans-text', '不确定，选了 B');
      await page.click('#ans-save');
      await page.waitForTimeout(500);
      await page.check('#bk-tpl');
      await page.click('#ans-archive');
      await page.waitForTimeout(400);
    }
    ok(await page.evaluate(() => Store.db.entries.filter(e => e.kind === 'template').length === 2), '两题已归档模板本');
    await page.close();
  }

  if (phase === 'templates') {
    console.log('== [模板] 真实 LLM 模板生成 + 相似度裁决 ==');
    const page = await newPage();
    // 在生成题库中自动找出最相似的题对（真实考察召回与裁决）
    const pairIdx = await page.evaluate(() => {
      const qs = Store.db.banks[0].questions;
      let best = [0, 1, 0];
      for (let i = 0; i < Math.min(qs.length, 20); i++)
        for (let j = i + 1; j < Math.min(qs.length, 20); j++) {
          const s = Sim.hybridScore(U.stripHtml(qs[i].stem), U.stripHtml(qs[j].stem)).score;
          if (s > best[2]) best = [i, j, s];
        }
      return best;
    });
    console.log(`  最相似题对：第 ${pairIdx[0] + 1} 题 ↔ 第 ${pairIdx[1] + 1} 题（混合分 ${pairIdx[2]}）`);
    // 幂等：归档这两道题到模板本
    for (const i of [pairIdx[0], pairIdx[1]]) {
      await page.click('#nav a[data-view="quiz"]');
      await page.waitForTimeout(400);
      await page.locator('#q-nav .quiz-nav-item').nth(i).click();
      await page.waitForTimeout(300);
      await page.click('.atab[data-a="text"]');
      await page.fill('#ans-text', '我选 B，不太确定');
      await page.click('#ans-save');
      await page.waitForTimeout(400);
      await page.check('#bk-tpl');
      await page.click('#ans-archive');
      await page.waitForTimeout(400);
    }
    await page.click('#nav a[data-view="books"]');
    await page.waitForTimeout(400);
    await page.click('.book-tab[data-k="template"]');
    await page.waitForTimeout(300);
    // 选一个尚未生成过模板的条目（无「已生成模板」chip）
    const pending = () => page.locator('.entry-card.k-tpl').filter({ hasNot: page.locator('.chip-tpl') }).first();
    await pending().locator('[data-act="totpl"]').click();
    const m1 = await waitForEval(page, () => {
      const modal = document.querySelector('.modal');
      if (!modal) return null;
      const rows = modal.querySelectorAll('.sim-table tbody tr').length;
      const badge = modal.querySelector('.verdict-badge')?.textContent || '';
      return { rows, badge, text: modal.innerText.slice(0, 120) };
    }, 300000, 5000, '第一个模板流水线');
    ok(!!m1, '流水线 modal 弹出');
    console.log(`  候选 ${m1?.rows} 个，裁决：${m1?.badge}`);
    if (m1 && m1.rows === 0) {
      const nb = page.locator('.modal-foot .btn', { hasText: '新建模板' });
      if (await nb.count() > 0) { await nb.first().click(); await page.waitForTimeout(1500); }
    } else if (m1) {
      const mb = page.locator('.modal-foot .btn-primary', { hasText: '归并' });
      if (await mb.count() > 0) await mb.click();
      else { const rm = page.locator('.sim-table [data-merge]'); if (await rm.count() > 0) await rm.first().click(); else { const nb = page.locator('.modal-foot .btn', { hasText: '新建模板' }); await nb.first().click(); } }
      await page.waitForTimeout(2500);
    }
    await closeAllModals(page);
    const t1 = await page.evaluate(() => ({ n: Store.db.templates.length, name: Store.db.templates[0]?.name }));
    ok(t1.n >= 1, `模板已入库：「${t1.name}」`);
    await shot(page, 'R3-template-1.png');
    // 第二题 → 真实 LLM 裁决（生成后页面会跳到模板库，先回到三本）
    await page.click('#nav a[data-view="books"]');
    await page.waitForTimeout(400);
    await page.click('.book-tab[data-k="template"]');
    await page.waitForTimeout(300);
    await pending().locator('[data-act="totpl"]').click();
    const m2 = await waitForEval(page, () => {
      const modal = document.querySelector('.modal');
      if (!modal) return null;
      const rows = modal.querySelectorAll('.sim-table tbody tr').length;
      const badge = modal.querySelector('.verdict-badge')?.textContent || '';
      const reason = modal.querySelector('.ai-report p')?.textContent || '';
      const bar = modal.querySelector('.score-bar div')?.style?.width || '';
      return { rows, badge, reason: reason.slice(0, 90), bar };
    }, 300000, 5000, '相似度裁决');
    ok(!!m2 && m2.rows >= 1, `召回候选 ${m2?.rows} 个，裁决：${m2?.badge}，分数条：${m2?.bar}`);
    console.log(`  LLM 裁决理由：${m2?.reason}`);
    await shot(page, 'R3-verdict.png');
    const mb2 = page.locator('.modal-foot .btn-primary', { hasText: '归并' });
    if (await mb2.count() > 0) { await mb2.click(); }
    else { const rm = page.locator('.sim-table [data-merge]'); if (await rm.count() > 0) await rm.first().click(); else { const nb = page.locator('.modal-foot .btn', { hasText: '新建模板' }); await nb.first().click(); } }
    await waitForEval(page, () => (document.querySelector('.modal') ? null : true), 60000, 1000, '扩容完成');
    await closeAllModals(page);
    const t2 = await page.evaluate(() => ({
      n: Store.db.templates.length,
      maxMembers: Math.max(...Store.db.templates.map(t => t.members.length)),
      variants: Math.max(...Store.db.templates.map(t => (t.variants || []).length)),
      verdictReal: Store.db.templates.some(t => (t.history || []).some(h => h.verdict && h.verdict.reason)),
    }));
    ok(t2.maxMembers >= 2, `归并/覆写成功：候选模板成员题增至 ${t2.maxMembers} 道`);
    ok(t2.verdictReal, '真实 LLM 裁决理由已记录到判定历史');
    ok(t2.variants >= 1, `真实 LLM 扩容变式 ${t2.variants} 个`);
    await page.click('#nav a[data-view="templates"]');
    await page.waitForTimeout(300);
    await page.locator('.entry-card.k-tpl [data-act="detail"]').first().click();
    await page.waitForTimeout(400);
    await shot(page, 'R3-template-detail.png');
    await closeAllModals(page);
    await page.close();
  }

  if (phase === 'vision') {
    console.log('== [多模态] 手写作答图片 → 真实视觉模型批改 ==');
    const page = await newPage();
    await page.click('#nav a[data-view="quiz"]');
    await page.waitForTimeout(400);
    await page.click('.atab[data-a="draw"]');
    const canvas = page.locator('#draw-canvas');
    const box = await canvas.boundingBox();
    // 在手写板上"写"出答案轨迹（模拟手写）
    await page.mouse.move(box.x + 40, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 90, { steps: 8 });
    await page.mouse.move(box.x + 220, box.y + 150, { steps: 8 });
    await page.mouse.move(box.x + 310, box.y + 100, { steps: 6 });
    await page.mouse.up();
    await page.click('#ans-grade');
    const graded = await waitForEval(page, () => {
      const r = Store.db.records.find(r => r.aiGrade && r.mode === 'draw');
      return r ? { demo: r.aiGrade.demo, len: r.aiGrade.html.length, img: r.imageUrl } : null;
    }, 300000, 5000, '视觉批改');
    ok(!!graded && graded.demo === false, '视觉模型真实批改完成（非演示）');
    ok(!!graded && (graded.img || '').startsWith('/images/'), '手写图片已随记录落盘');
    await shot(page, 'R4-vision-grade.png');
    const verdictTxt = await page.evaluate(() => {
      const r = Store.db.records.find(r => r.aiGrade && r.mode === 'draw');
      return U.stripHtml(r.aiGrade.html).slice(0, 150);
    });
    console.log(`  视觉批改摘要：${verdictTxt}`);
    await page.close();
  }

  if (phase === 'ask') {
    console.log('== [多模态] 圈选提问（真实视觉答疑）==');
    const page = await newPage();
    page.on('dialog', async d => { await d.accept('这道题的考点是什么？如何快速作答？'); });
    await page.click('#nav a[data-view="annotator"]');
    await page.waitForTimeout(500);
    const imgFile = path.join(SHOTS, '_askimg.png');
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 500;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, 800, 500);
      ctx.fillStyle = '#26231d'; ctx.font = '26px serif';
      ctx.fillText('【基金基础】根据《证券投资基金法》，', 40, 120);
      ctx.fillText('基金份额持有人享有的权利不包括：', 40, 160);
      ctx.fillText('A. 分享基金财产收益    B. 参与基金财产的清算分配', 40, 220);
      ctx.fillText('C. 对基金份额持有人大会行使表决权', 40, 260);
      ctx.fillText('D. 决定基金投资的具体标的选择  ← 我选了这个', 40, 300);
      return c.toDataURL('image/png');
    });
    fs.writeFileSync(imgFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
    const chooserP = page.waitForEvent('filechooser');
    await page.click('#btn-upload');
    await (await chooserP).setFiles(imgFile);
    await page.waitForTimeout(1000);
    await page.click('.tool-btn[data-tool="ask"]');
    const ob = await page.locator('#annot-overlay').boundingBox();
    await page.mouse.move(ob.x + 60, ob.y + 280);
    await page.mouse.down();
    await page.mouse.move(ob.x + 620, ob.y + 320, { steps: 4 });
    await page.mouse.up();
    const asked = await waitForEval(page, () => {
      const a = Store.db.annots[0]?.asks?.[0];
      return a ? { demo: a.demo, len: a.answer.length } : null;
    }, 300000, 5000, '圈选答疑');
    ok(!!asked && asked.demo === false, '圈选提问真实视觉答疑完成（非演示）');
    if (await page.locator('.modal:visible').count()) await shot(page, 'R5-circle-ask.png');
    await closeAllModals(page);
    const answerHead = await page.evaluate(() => U.stripHtml(Store.db.annots[0].asks[0].answer).slice(0, 150));
    console.log(`  答疑摘要：${answerHead}`);
    await page.close();
  }
} finally {
  if (phase === 'all') await browser.close(); else await browser.close();
}

console.log(`\n======== [${phase}] 完成：${passed} 通过，${failed} 失败 ========`);
process.exit(failed ? 1 : 0);
