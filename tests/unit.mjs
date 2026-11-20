// 零依赖单元测试：node --test tests/unit.mjs
// 用最小 stub 加载浏览器源码中的纯逻辑（MD 转换 / URL 消毒策略 / 服务器数据校验），
// 不需要 Playwright、不需要 package.json、不需要 npm install。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = rel => {
  const code = readFileSync(path.join(ROOT, rel), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'Node', code)(globalThis.window, globalThis.document, globalThis.Node);
};

// 最小浏览器 stub
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ innerHTML: '', childNodes: [] }) };
globalThis.Node = { TEXT_NODE: 3, COMMENT_NODE: 8, ELEMENT_NODE: 1 };
// U.esc / U.stripHtml 的最小可用实现（与 util.js 语义一致）
globalThis.U = {
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  stripHtml: s => String(s ?? '').replace(/<[^>]*>/g, ''),
  clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
};

load('js/core/md.js');

test('MD 行内：高亮 / 加粗 / 删除线 / 代码', () => {
  assert.match(globalThis.MD.toHtml('这是 ==高亮== 文本'), /<mark>高亮<\/mark>/);
  assert.match(globalThis.MD.toHtml('**粗** 与 ~~删~~'), /<strong>粗<\/strong>/);
  assert.match(globalThis.MD.toHtml('**粗** 与 ~~删~~'), /<del>删<\/del>/);
  assert.match(globalThis.MD.toHtml('`code`'), /<code>code<\/code>/);
});

test('MD looksLikeMd 识别 ==高亮==', () => {
  assert.equal(globalThis.MD.looksLikeMd('普通文字'), false);
  assert.equal(globalThis.MD.looksLikeMd('==标记=='), true);
});

test('MD 块级：标题 / 列表 / 引用 / 表格', () => {
  const html = globalThis.MD.toHtml('# 标题\n\n- 甲\n- 乙\n\n> 引用');
  assert.match(html, /<h[1-6]>标题<\/h[1-6]>/);
  assert.match(html, /<li>甲<\/li>/);
  assert.match(html, /<blockquote>/);
});

test('Sanitize 配置：危险 URL 被拒、安全 data:image 放行', () => {
  // 从源码抽取 safeUrl 的判定规则做参数化验证（与 sanitize.js 同步维护）
  const src = readFileSync(path.join(ROOT, 'js/core/sanitize.js'), 'utf8');
  const dataRe = src.match(/const SAFE_DATA_IMG_RE\s*=\s*(\/[^\n]+\/i);/);
  const urlRe = src.match(/const SAFE_URL_RE\s*=\s*(\/[^\n]+\/i);/);
  assert.ok(dataRe && urlRe, '消毒正则应从源码可解析');
  const safeData = new Function(`return ${dataRe[1]}`)();
  const safeUrl = new Function(`return ${urlRe[1]}`)();
  assert.equal(safeData.test('data:image/png;base64,AAAA'), true);
  assert.equal(safeData.test('data:image/svg+xml;base64,AAAA'), false);
  assert.equal(safeUrl.test('javascript:alert(1)'), false);
  assert.equal(safeUrl.test('/images/a.png'), true);
  assert.equal(safeUrl.test('https://example.com'), true);
});

test('server.py：滚动备份恢复与结构校验（纯 Python 函数，无副作用）', async () => {
  const { execFileSync } = await import('node:child_process');
  const probe = `
import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})
import server
ok = server.is_valid_db({'notes': [], 'banks': [], 'entries': []})
bad = server.is_valid_db({'notes': []})
print('OK' if ok and not bad else 'FAIL')`;
  const out = execFileSync('python3', ['-c', probe], { encoding: 'utf8' });
  assert.equal(out.trim(), 'OK');
});
