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
  asText: v => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => globalThis.U.asText(x)).join('') : String(v)),
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

test('server.py：代理透传 tools 且回传 tool_calls（源码契约）', () => {
  const src = readFileSync(path.join(ROOT, 'server.py'), 'utf8');
  assert.match(src, /body\["tools"\] = tools/);
  assert.match(src, /"tool_calls": tool_calls/);
  assert.match(src, /payload\.get\("tool_choice"\)/);
});

test('provider：edit_note 工具定义包含 6 种受控操作（源码契约）', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/provider.js'), 'utf8');
  assert.match(src, /name: 'edit_note'/);
  for (const op of ['replace_selection', 'replace_block', 'insert_after_block', 'append', 'replace_all', 'rename_title', 'style_blocks']) {
    assert.ok(src.includes(`'${op}'`), `缺少操作 ${op}`);
  }
  assert.match(src, /for \(let round = 0; round < 8; round\+\+\)/, '工具循环应有轮次上限（8 轮，整章批量编辑需要）');
});

test('工具执行器：替换块操作使用 Sanitize.html 消毒（源码契约）', () => {
  const src = readFileSync(path.join(ROOT, 'js/core/rich-ask.js'), 'utf8');
  assert.match(src, /async function executeNoteEdit/);
  assert.match(src, /Views\.notes\._createVersion\?\.\('ai-agent'\)/, '编辑前应存版本快照');
  assert.match(src, /const safe = Sanitize\.html\(html/);
  assert.match(src, /UI\.confirm/);
});

// ---------- NoteRefs：全局内容引用层（@ 提及 / 全局摘要 / 工具读取的数据源） ----------
function loadNoteRefs() {
  // 最小 stub：note-refs 只依赖 Store/U/Sanitize（document/UI/Views/App 仅在 DOM 相关分支用到，本组测试不触发）
  const db = {
    notes: [{ id: 'note_a', title: '极限与连续', content: '<p>连续的定义</p>', createdAt: 1, updatedAt: 1 }],
    annots: [],
    banks: [{ id: 'bank_a', name: '高数第三章', questions: [{ id: 'q_1', stem: '求极限 lim x→0 sinx/x', options: [], answer: '1', analysis: '重要极限' }] }],
    entries: [],
    templates: [{ id: 'tpl_a', name: '极限题模板', essence: '先化简再夹逼', steps: ['化简', '夹逼'], signals: [], disguises: [], pitfalls: [], members: [] }],
    cards: [{ id: 'card_a', front: '连续的定义是什么', back: '极限存在且等于函数值' }],
    records: [],
    chatSessions: [{ id: 'chat_a', title: '关于极限的讨论', messages: [{ role: 'user', text: '什么是重要极限？' }, { role: 'assistant', html: '<p>sinx/x 趋于 1</p>' }] }],
  };
  globalThis.Store = {
    coll: name => db[name] || [],
    find: (name, id) => (db[name] || []).find(x => x.id === id) || null,
  };
  globalThis.Sanitize = { html: s => String(s ?? '') };
  load('js/core/note-refs.js');
}

test('NoteRefs：all 汇总全部可引用内容并带类型元信息', () => {
  loadNoteRefs();
  const all = globalThis.NoteRefs.all();
  assert.ok(all.some(r => r.kind === 'note' && r.id === 'note_a' && r.title === '极限与连续'));
  assert.ok(all.some(r => r.kind === 'bank' && r.id === 'bank_a'));
  assert.ok(all.some(r => r.kind === 'session' && r.id === 'chat_a'));
  assert.ok(all.some(r => r.kind === 'card' && r.id === 'card_a'));
  assert.ok(all.some(r => r.kind === 'template' && r.id === 'tpl_a'));
});

test('NoteRefs：search 按关键词命中标题与摘要', () => {
  const hits = globalThis.NoteRefs.search('极限');
  assert.ok(hits.length >= 2, '应同时命中笔记/模板/对话等标题含关键词的条目');
  assert.ok(hits.every(h => h.kind && h.id && h.title));
  assert.deepEqual(globalThis.NoteRefs.search('  '), [], '空白关键词返回空');
});

test('NoteRefs：digest 生成全局清单，agent 借此感知项目全部内容', () => {
  const d = globalThis.NoteRefs.digest();
  assert.match(d, /【笔记 · 1 条】/);
  assert.match(d, /@bank:bank_a/);
  assert.match(d, /@session:chat_a/);
});

test('NoteRefs：resolve 输出类型标注全文；失效引用与超预算截断有明确标记', () => {
  const bank = globalThis.NoteRefs.resolve({ kind: 'bank', id: 'bank_a' });
  assert.equal(bank.ok, true);
  assert.match(bank.text, /【引用：题库｜高数第三章】/);
  assert.match(bank.text, /求极限/);
  assert.match(bank.text, /答：1/);

  const session = globalThis.NoteRefs.resolve({ kind: 'session', id: 'chat_a' });
  assert.match(session.text, /\[学生\] 什么是重要极限/);
  assert.match(session.text, /\[助教\]/);

  const gone = globalThis.NoteRefs.resolve({ kind: 'note', id: 'nope' });
  assert.equal(gone.ok, false);
  assert.match(gone.text, /引用失效/);

  const truncated = globalThis.NoteRefs.resolve({ kind: 'card', id: 'card_a' }, 5);
  assert.match(truncated.text, /内容过长已截断/);
});

// ---------- @ 引用接线与只读工具门控（源码契约） ----------
test('note-chat：发送时附加并清空 refs，generate 传入引用全文/全局摘要/读取工具', () => {
  const src = readFileSync(path.join(ROOT, 'js/core/note-chat.js'), 'utf8');
  assert.match(src, /pendingRefs\.splice\(0\)/, '发送时应消费 pendingRefs');
  assert.match(src, /refs: refs\.length \? refs : undefined/, '用户消息应携带 refs（气泡渲染 chip）');
  assert.match(src, /NoteRefs\.digest\(\)/, 'generate 应传全局内容摘要');
  assert.match(src, /const onRead = \{\n        search: NoteRefs\.search,\n        resolve: NoteRefs\.resolve,\n        blocks: id => RichAsk\.noteBlocks\(id\),\n        readRange: \(id, from, to\) => RichAsk\.readBlockRange\(id, from, to\),\n      \};/, 'onRead 应接入结构目录与块区间读取');
  assert.match(src, /function extractRefs/, 'AI 回答应解析引用来源为可点击 chip');
  assert.match(src, /refs: cited\.length \? cited : undefined/, 'assistant 消息应携带解析出的引用');
  assert.match(src, /refs: user\.refs \|\| \[\]/, '重新生成应透传原引用');
});

test('provider：普通模式具备只读检索工具，edit_note 仅编辑模式可用', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/provider.js'), 'utf8');
  assert.match(src, /NOTE_READ_TOOLS/, '应拆分只读工具集');
  assert.match(src, /canEdit \? NOTE_EDIT_TOOLS : NOTE_READ_TOOLS/, '按模式选用工具数组');
  assert.match(src, /canEdit \? 'ctxChatAgent' : 'ctxChat'/, '提示词按编辑模式选择');
  assert.match(src, /编辑模式未开启/, '无执行器时 edit_note 应给出明确错误');
  assert.match(src, /refsText, globalDigest/, 'Mock 分支应透传引用上下文');
});

test('provider：edit_note 支持 noteId 跨笔记定位，read_content 附带块列表', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/provider.js'), 'utf8');
  assert.match(src, /noteId: \{ type: 'string'/, 'edit_note 应定义 noteId 参数');
  assert.match(src, /required: \['action', 'reason', 'noteId'\]/, 'noteId 应为必填，防止模型漏传时静默改错笔记');
  assert.match(src, /缺少 noteId（必填）/, '缺 noteId 应报错引导重试，而不是写进当前打开的笔记');
  assert.match(src, /noteId,\n/, 'toolResult 应透传已校验的 noteId');
  assert.match(src, /onRead\?\.blocks/, 'read_content 应可附加块列表');
  assert.match(src, /该笔记的块列表（noteId: \$\{id\}/, '块列表应带 noteId 供模型复用');
});

test('provider：对话请求显式携带输出上限，防止配置过小导致回复截断', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/provider.js'), 'utf8');
  assert.match(src, /function chatMaxTokens\(\)/, '应有输出上限计算函数');
  assert.match(src, /Math\.min\(Math\.max\(Number\(Store\.config\?\.ai\?\.maxTokens\) \|\| 0, 4096\), 16000\)/, '输出上限应设 4096 下限');
  assert.match(src, /max_tokens: chatMaxTokens\(\)/, '对话与工具循环请求都应携带 max_tokens');
});

test('note-chat：编辑模式不再要求处于笔记页，普通模式仍禁用编辑', () => {
  const src = readFileSync(path.join(ROOT, 'js/core/note-chat.js'), 'utf8');
  assert.match(src, /const useAgent = agentMode && Store\.aiLive\(\) && !!note;/, '编辑模式应在任意视图生效（离线路径兜底）');
  assert.match(src, /return \{ anchor: s\.context\.anchor, selection: s\.context\.selection \|\| '' \}/, 'getAnchor 应同时返回选中文本供漂移校验');
});

test('prompts：目标笔记默认规则与批量编辑引导', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/prompts.js'), 'utf8');
  assert.match(src, /学生要求编辑但未指明是哪篇笔记时，一律编辑当前笔记/, '未指明时应默认当前笔记，不得自行挑选');
  assert.match(src, /大范围修改（整章高亮、整章标红）优先用一次 style_blocks/, '批量修改应优先用区间样式一次到位');
});

test('prompts：agent 模板含工具报错重试规则', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/prompts.js'), 'utf8');
  assert.match(src, /不要因报错就声称没有编辑权限/, '报错后应修正重试而非误报无权限');
});

test('provider：允许颜色类内联样式，归一化 ==高亮== 与 <font color>', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/provider.js'), 'utf8');
  assert.match(src, /style 属性仅允许 background-color 与 color 两种颜色值/, 'edit_note 描述应允许颜色样式');
  assert.match(src, /function normalizeDecor/, '应有装饰写法归一化');
  assert.match(src, /<mark>\$1<\/mark>/, '==高亮== 应转 mark');
  assert.match(src, /<span style="color: \$1">/, 'font color 应转颜色 span');
});

test('prompts：agent 规则与 HTML_RULE 允许颜色类 style（不再一刀切禁止）', () => {
  const prompts = readFileSync(path.join(ROOT, 'js/ai/prompts.js'), 'utf8');
  assert.match(prompts, /高亮 <span style="background-color: #FFF3A3">/, '能力清单应给出高亮格式');
  assert.match(prompts, /style 属性仅允许颜色类/, 'HTML_RULE 应仅禁非颜色 style，不再一刀切');
});

test('rich-ask：跨笔记编辑（noteId 解析 / 离线保存 / ai-agent 快照 / 确认框显示目标笔记）', () => {
  const src = readFileSync(path.join(ROOT, 'js/core/rich-ask.js'), 'utf8');
  assert.match(src, /function executeNoteEdit\(\{ action, html, title, blockIndex, blockFrom, blockTo, styleType, colorValue, reason, noteId \}\)/);
  assert.match(src, /const note = Store\.find\('notes', targetId\)/, '应按 noteId 解析目标笔记');
  assert.match(src, /目标笔记：《/, '确认弹窗必须显示目标笔记名，避免编辑错对象');
  assert.match(src, /replace_selection' && !canLive/, '未打开的笔记应拒绝 replace_selection（无选区）');
  assert.match(src, /function snapshotVersion/, '离线编辑应有独立的版本快照逻辑');
  assert.match(src, /source: 'ai-agent'/, '离线快照来源应为 ai-agent');
  assert.match(src, /Store\.update\('notes', targetId, patch\)/, '离线编辑应持久化目标笔记');
  assert.match(src, /const noteBlocks = \(noteId\) =>/, 'noteBlocks 应支持任意笔记');
});

test('rich-ask：style_blocks 区间批量样式（颜色白名单 + 列表表格特殊处理）', () => {
  const src = readFileSync(path.join(ROOT, 'js/core/rich-ask.js'), 'utf8');
  assert.match(src, /SAFE_COLOR_RE = /, '颜色值应有白名单校验，杜绝 url() 注入');
  assert.match(src, /function applyStyleRange/, '应有区间批量样式函数');
  assert.match(src, /tag === 'TABLE'\) \[\.\.\.el\.querySelectorAll\('td,th'\)\]\.forEach\(wrap\)/, '表格应逐单元格包裹');
  assert.match(src, /style_blocks 需要 blockFrom\/blockTo/, '缺少区间参数应明确报错');
  assert.match(src, /styleType（highlight\/color\/both）|styleType 必须是 highlight \/ color \/ both/, 'styleType 非法应报错');
});

test('rich-ask：长笔记两步定位（结构目录降级 + 块区间全文读取）', () => {
  const src = readFileSync(path.join(ROOT, 'js/core/rich-ask.js'), 'utf8');
  assert.match(src, /OUTLINE_BUDGET/, '应有块列表预算阈值');
  assert.match(src, /长笔记，以下仅列标题结构目录/, '超预算时应降级为标题结构目录');
  assert.match(src, /function readBlockRange/, '应有块区间全文读取函数');
  assert.match(src, /已达单次读取上限/, '区间读取应有预算截断提示');
  assert.match(src, /readBlockRange, executeNoteEdit/, 'readBlockRange 应导出供工具层使用');
});

test('provider：read_content 支持块区间读取，长笔记节选需声明非全文', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/provider.js'), 'utf8');
  assert.match(src, /blockFrom: \{ type: 'integer'/, 'read_content 应定义 blockFrom 参数');
  assert.match(src, /onRead\.readRange\(id, blockFrom, blockTo\)/, '块区间读取应分发到 readRange');
  assert.match(src, /笔记全文约 \$\{full\.length\} 字，以下仅是节选/, '长笔记节选应声明并非全文');
});

test('prompts：长笔记两步定位工作流与结构目录说明', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/prompts.js'), 'utf8');
  assert.match(src, /【笔记结构目录（块编号从 0 开始/, 'agent 模板应有结构目录段');
  assert.match(src, /两步定位：先看【笔记结构目录】找到目标章节的块编号/, '应有两步定位工作流');
  assert.match(src, /不要因为它没提到某章节就断定笔记里没有/, '应防止模型因节选而误判笔记内容');
});

test('prompts：ctxChat 模板含 @ 引用/全局摘要占位符与工具说明', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/prompts.js'), 'utf8');
  assert.match(src, /\{refsText\}/);
  assert.match(src, /\{globalDigest\}/);
  assert.match(src, /search_content/, '普通模板应说明只读检索工具');
  assert.match(src, /noteId 必填/, 'agent 模板应说明跨笔记编辑规则');
  assert.match(src, /（ID：\{noteId\}，调用 edit_note 时作为 noteId 传入）/, 'agent 模板应注入当前笔记 ID 供 edit_note 使用');
  assert.match(src, /看到并操作整个学习项目的内容/, '提示词应声明全局视野与操作能力');
});

test('prompts：agent 提示词为成熟风格的能力清单 + 边界声明 + 反幻觉规则', () => {
  const src = readFileSync(path.join(ROOT, 'js/ai/prompts.js'), 'utf8');
  assert.match(src, /【你的能力】/, '应有能力总览段');
  assert.match(src, /不确定某内容是否存在时，先搜再答/, '检索能力应说明使用时机');
  assert.match(src, /先读后改：编辑非当前笔记前，先 read_content 拿到该笔记的块列表/, '应有 read-before-edit 工作流');
  assert.match(src, /结果以工具返回为准/, '应以工具结果为准');
  assert.match(src, /绝不编造编辑结果/, '应有反幻觉规则');
  assert.match(src, /超出能力的事（没有对应工具/, '应显式声明能力边界');
  assert.match(src, /新建或删除笔记、增删改题库与题目/, '边界应列明无工具的操作');
});
