// 帮助页：使用说明 / 题库格式规范 / 相似度算法说明 / 提示词说明 / FAQ
window.Views = window.Views || {};

Views.help = {
  render(container) {
    container.innerHTML = `
    <div class="help-doc">
      <h1 class="page-title">帮助</h1>
      <div class="page-sub">使用说明 · 题库格式规范 · 算法说明 · FAQ</div>

      <h2>① 快速上手</h2>
      <ol>
        <li><b>导入题库</b>：进入「刷题」→「题库导入」，可载入示例题库、选择 .md 文件或直接粘贴文本，解析预览无误后保存入库。</li>
        <li><b>做题</b>：「刷题」→「练习」，选题作答（文本 / 手写板 / 上传照片），保存作答或直接 AI 批改。</li>
        <li><b>归档</b>：批改后可生成「本质思路 + AI 评价」、打知识点标签，勾选错题本 / 好题本 / 模板本归档。</li>
        <li><b>建模板库</b>：到「三本」对任意题目点「✨ 生成做题模板」，系统会先与库内模板做相似度比对再决定归并或新建。</li>
        <li><b>笔记与批注</b>：「笔记」是 HTML 原生富文档（表格 / 折叠块 / 公式 / 待办）；「截图批注」支持粘贴截图圈画、截取题目、圈选提问 AI，产物可插入笔记。</li>
      </ol>

      <h2>② 题库 Markdown 格式规范</h2>
      <p>本地解析器按以下规则离线拆题（乱格式可点「✨ LLM 智能解析」由大模型拆分）：</p>
      <pre># 题库名称（可选）
## 第一章 函数（章节名，可选）

1. 题干……（题号开头：数字 + . 或 、）
A. 选项一
B. 选项二
C. 选项三
D. 选项四

答案：B（或 解答题结论）
解析：解题过程……
【知识点】函数、二次函数</pre>
      <ul>
        <li>题号行触发新题：<code>1.</code> <code>1、</code> <code>1)</code> 均可；</li>
        <li>选项行：<code>A.</code> <code>A、</code> <code>(A)</code> 等，连续选项行归入该题；</li>
        <li>答案行以 <code>答案：</code> / <code>【答案】</code> 开头；解析行以 <code>解析：</code> / <code>【解析】</code> / <code>【分析】</code> 开头；</li>
        <li>知识点：支持 <code>【知识点】xxx</code> 行或题内 <code>【函数】</code> 短标签；</li>
        <li>数学公式用 <code>$...$</code>（行内）与 <code>$$...$$</code>（块级）书写，保存后自动渲染。</li>
      </ul>

      <h2>③ 相似度归类算法（为什么可靠）</h2>
      <p>新题进入模板库前必须经过三级流水线，每级证据都展示给你：</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><th style="border:1px solid #ddd;padding:6px 10px;background:#faf8f2">阶段</th><th style="border:1px solid #ddd;padding:6px 10px;background:#faf8f2">做法</th><th style="border:1px solid #ddd;padding:6px 10px;background:#faf8f2">作用</th></tr>
        <tr><td style="border:1px solid #ddd;padding:6px 10px">① 归一化签名</td><td style="border:1px solid #ddd;padding:6px 10px">数字→占位符 N、去标点空白、提取数学要素词</td><td style="border:1px solid #ddd;padding:6px 10px">消除"数字不同"的表面差异，保留结构</td></tr>
        <tr><td style="border:1px solid #ddd;padding:6px 10px">② 快速召回</td><td style="border:1px solid #ddd;padding:6px 10px">字符 bigram Jaccard + TF-IDF 余弦 + 关键词重叠，加权融合取 top-K</td><td style="border:1px solid #ddd;padding:6px 10px">毫秒级筛出候选，三种信号交叉验证互为兜底</td></tr>
        <tr><td style="border:1px solid #ddd;padding:6px 10px">③ 精排（可选）</td><td style="border:1px solid #ddd;padding:6px 10px">配置向量模型后，对候选做 embedding 余弦重排</td><td style="border:1px solid #ddd;padding:6px 10px">捕捉语义相似，弥补字面缺失</td></tr>
        <tr><td style="border:1px solid #ddd;padding:6px 10px">④ LLM 裁决</td><td style="border:1px solid #ddd;padding:6px 10px">大模型按判定标准输出 same_type / confidence / reason（JSON）</td><td style="border:1px solid #ddd;padding:6px 10px">理解"同一本质模型"而非表面相似</td></tr>
      </table>
      <p><b>可靠性兜底设计</b>：</p>
      <ul>
        <li>分数透明：候选表展示混合分 + 三项分项（+embedding 分），不黑箱；</li>
        <li>结构对照：归一化签名的 LCS diff 高亮共同结构，肉眼可验证；</li>
        <li>阈值卡控：LLM 置信度 ≥ 设置阈值才提示自动归并，否则默认新建；</li>
        <li>人工覆写：无论裁决结果如何，都可以"归并到任一候选"或"坚持新建"，覆写动作记入模板判定历史；</li>
        <li>判定历史：每个模板记录每次判定的分数与裁决，可回溯、可审计。</li>
      </ul>

      <h2>④ 提示词与大模型调参</h2>
      <ul>
        <li>全部 8 组提示词在「设置 → 提示词」可视化编辑，改完即时生效（存 data/config.json）；</li>
        <li>输出约定：报告类输出<b>受控 HTML 片段</b>（白名单标签，渲染成真正的报告：表格、红绿标注、折叠解析）；结构化类输出 <b>JSON</b>；</li>
        <li>所有 AI 产物入库前经白名单消毒器过滤（防提示注入 XSS）；</li>
        <li>批改提示词要求模型<b>先独立解题再对比作答</b>，避免被学生答案带偏；</li>
        <li>相似度裁决提示词要求"拿不准就降低 confidence"，宁可漏归并不误归并。</li>
      </ul>

      <h2>⑤ FAQ</h2>
      <details open><summary>演示模式和真实 AI 有什么区别？</summary>
        <p>未配置 API 时全部 AI 功能走本地演示模拟（输出明确标注 ⚑ 演示），流程可完整走通但内容为占位。配置 OpenAI 兼容 API 后即获得真实批改/裁决/模板生成。题库的「本地规则解析」与相似度「快速召回」是真实算法，离线可用。</p></details>
      <details><summary>公式渲染不出来？</summary>
        <p>公式依赖本地 KaTeX（vendor/katex/）。本仓库已内置；若文件缺失，重新下载 katex 发行包，把 <code>katex.min.css</code>、<code>katex.min.js</code>、<code>fonts/</code> 放入 <code>vendor/katex/</code> 即可，未安装时公式按原文显示。</p></details>
      <details><summary>手写/照片作答如何批改？</summary>
        <p>需要配置<b>视觉模型</b>（多模态），作答图片将以 base64 随题干发给模型。未配置视觉模型时请改用文本作答。OCR 识别为预留接口，后续可接 PaddleOCR 等。</p></details>
      <details><summary>数据存在哪里？如何备份？</summary>
        <p>全部数据在服务器目录 <code>data/</code>（db.json + config.json + images/）。「设置 → 数据管理」可导出 JSON 备份（可选图片内嵌），导入时自动重建图片文件。</p></details>
      <details><summary>相似度误判了怎么办？</summary>
        <p>判定界面可以人工归并到任一候选或坚持新建（覆写会记录在模板的判定历史里）。也可以在设置页调参：误归并 → 提高 LLM 置信阈值 / 降低归并阈值；漏归并 → 降低阈值 / 提高关键词权重。</p></details>
      <details><summary>支持哪些大模型服务？</summary>
        <p>任何 OpenAI 兼容接口：DeepSeek、通义千问（compatible-mode/v1）、OpenAI、Moonshot、GLM 等。接口地址以 /v1 结尾即可自动拼接。</p></details>
    </div>`;
  },
};
