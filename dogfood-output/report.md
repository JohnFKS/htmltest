# Dogfood Report: 智学笔记 · 笔记助教对话栏

| Field | Value |
|-------|-------|
| **Date** | 2026-11-18 |
| **App URL** | http://127.0.0.1:8899 |
| **Session** | notechat-ad45f54631b6 |
| **Scope** | 选中文本提问、多轮追问、多会话/历史会话、长期记忆压缩、笔记手动/自动保存、版本历史与回退、永久保存与清理、按选中位置插入 AI 批注、窄屏布局、真实 API、控制台错误 |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| **Total** | **1** |

已发现并修复 1 个低优先级 UX 问题；其余核心流程均通过，浏览器控制台与页面错误日志为空。

## Verified Flows

| 流程 | 结果 | 证据 |
|------|------|------|
| 笔记中创建内容并选中文字 | 通过 | `screenshots/02-notes.png`, `03-context-menu.png` |
| 右键菜单打开右侧对话栏并带出引用 | 通过 | `screenshots/04-drawer-open.png` |
| 首轮提问与演示回答 | 通过，`第 1 轮` | `screenshots/05-first-answer.png` |
| 追问与轮次编号 | 通过，`第 2 轮`，前文被识别 | `screenshots/06-two-turns.png` |
| 历史会话列表、新建第二段会话 | 通过 | `screenshots/08-two-sessions.png`, `10-history-visible.png` |
| 切换历史会话恢复消息 | 通过，恢复 2 问 2 答 | `screenshots/11-switch-session.png` |
| 重新生成第一轮回答 | 通过，消息顺序保持正确 | `screenshots/12-retry-first.png` |
| 追加回答到笔记 | 通过，笔记内容出现 AI 问答块 | `screenshots/13-append-to-note.png` |
| 窄屏 390×844 布局 | 通过，无横向滚动，抽屉占满屏宽 | `screenshots/14-mobile-drawer.png` |
| 刷新后持久化 | 通过，2 段会话与消息仍在 | `screenshots/15-after-reload.png` |
| 真实 API 内容块模拟 | 通过，输出正常文本，无 `[object Object]` | 浏览器内 eval 结果 |
| 真实平台连通（dots3-note-prev） | 通过，返回 `连接成功` | 本地代理 `/api/ai/chat` |
| 真实平台笔记提问 | 通过，返回正常中文回答，无 `[object Object]` | `screenshots/18-live-api-answer.png` |
| 真实平台多轮追问 | 通过，第二轮正确引用上一轮上下文 | `screenshots/19-live-multi-turn.png` |
| 长期记忆压缩（14 条历史） | 通过，压缩 4 条旧消息并生成结构化摘要 | `screenshots/20-memory-summary.png` |
| 摘要驱动的上下文追问 | 通过，偏好消息已被压缩且未被召回，回答仍准确使用摘要 | `screenshots/21-memory-context-answer.png` |
| 摘要查看弹窗 | 通过 | `screenshots/22-memory-view.png` |
| 新版笔记工具栏 | 通过，保存/历史/保存设置分组清晰 | `screenshots/23-new-toolbar.png` |
| 手动保存版本 | 通过，生成 1 个手动版本并更新状态栏 | `screenshots/24-manual-save.png` |
| 可配置自动保存 | 通过，设为 1 秒后自动生成版本 | `screenshots/25-auto-save.png` |
| 版本历史列表 | 通过，展示来源、时间、字符数与操作 | `screenshots/26-history-list.png` |
| 永久保存版本 | 通过，标记为 🔒 且不被数量清理 | `screenshots/27-pin-version.png` |
| 历史版本回退 | 通过，恢复内容并生成 restore 版本 | `screenshots/28-restore-version.png` |
| 版本数量清理 | 通过，仅保留 3 个普通版本，永久版本未受影响 | `screenshots/29-prune-versions.png` |
| 删除永久保存版本 | 通过，确认后可删除 | `screenshots/30-delete-pinned.png` |
| 选中文本提问保留锚点 | 通过，`context.anchor` 已持久化 | `screenshots/31-ask-with-anchor.png` |
| AI 批注插入原文下方 | 通过，插入目标段落之后；原文无 `<mark>` 包裹；CSS Highlight 生效 | `screenshots/32-annotation-inserted.png` |
| 批注默认悬浮折叠 | 通过，卡片默认 `display:none`，只显示标签 | `screenshots/33-hover-collapsed.png` |
| 悬浮展开与富文本渲染 | 通过，展开后表格 1 个、KaTeX 公式 2 个，与笔记/对话栏同款样式 | `screenshots/34-hover-expanded.png` |
| 悬浮内容直接编辑 | 通过，修改后自动写入笔记，表格结构保留 | `screenshots/35-hover-edited.png` |

## Issues

### ISSUE-001: toast 临时遮挡对话栏顶部操作按钮

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | ux / functional |
| **URL** | http://127.0.0.1:8899/#notes |
| **Repro Video** | N/A |

**Description**

对话栏展开时，全局 toast 仍固定在右上角 `top:64px; right:20px`，正好覆盖对话栏头部的「历史 / 新建 / 关闭」按钮。新建对话等操作会弹出 toast，用户立即点击历史按钮时会被 toast 拦截，需等待提示自动消失。预期 toast 不应遮挡可操作控件。

**Repro Steps**

1. 打开笔记页，点击「💬 笔记助教」展开右侧对话栏。
   ![对话栏](screenshots/04-drawer-open.png)

2. 在对话栏中点击头部「＋」新建对话，出现 toast。
   ![遮挡前](screenshots/16-toast-overlap-before.png)

3. 立即点击头部「🕘」历史按钮，agent-browser 报告按钮被 `div.toast` 覆盖，点击未生效。

4. 等待约 2 秒后 toast 消失，按钮恢复可点击。

**Fix**

`body.chat-open` 时把 toast 移到对话栏左侧底部；窄屏下移到视口右下角。

```css
body.chat-open .toast-wrap { top: auto; bottom: 20px; right: min(480px, 40vw); }
@media (max-width: 700px) {
  body.chat-open .toast-wrap { right: 12px; bottom: 12px; }
}
```

**Verification**

修复后连续点击「新建对话」和「历史」均无遮挡，toast 顶部坐标 837.7、对话栏头部底部 112，不再重叠。
![修复后](screenshots/17-toast-fixed.png)

---
