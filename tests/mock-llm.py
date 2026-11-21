#!/usr/bin/env python3
"""零依赖 OpenAI 兼容 Mock LLM：模拟可返回 tool_calls 的对话模型，用于离线端到端测试
笔记助教的 function calling 链路（不依赖真实 API Key）。

用法：python3 tests/mock-llm.py [scenario] [port]
  scenario:
    nonoteid     第一轮返回 edit_note 且【不带 noteId】——复现"模型忘传 noteId 导致改错笔记"
    withnoteid   第一轮返回 edit_note 且带 noteId——从系统提示的【全局内容摘要】里解析目标笔记 ID
    multi        模拟 dots 式整章高亮：每轮 1 个 replace_block（blockIndex 递增，mark 包裹），
                 共 4 轮后收尾——用于验证多轮编辑累积与轮次上限
  行为：最后一条消息 role 为 user → 返回 tool_calls（第一轮）；否则 → 返回最终文本（收尾轮）。

配合 server.py：设置 AI baseUrl=http://127.0.0.1:<port>/v1、apiKey=mock、chatModel=mock 即可。
"""
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

SCENARIO = "nonoteid"
TARGET_TITLE = "欢迎使用智学笔记"   # withnoteid 场景要编辑的目标笔记标题（在摘要里按标题找 ID）
HIGHLIGHT_HTML = ('<p><span style="background-color: #FFF3A3">模拟高亮重点（span 背景色）</span>、'
                  '<mark>mark 标记高亮</mark>、<span style="color: #C0392B">红色字体（span 颜色）</span></p>')


def extract_target_note_id(system_text: str) -> str | None:
    """从【全局内容摘要】的 - @note:<id> <标题> 行里，按目标标题提取笔记 ID。"""
    for line in system_text.splitlines():
        if TARGET_TITLE in line:
            m = re.search(r"@note:([A-Za-z0-9_-]+)", line)
            if m:
                return m.group(1)
    ids = re.findall(r"@note:([A-Za-z0-9_-]+)", system_text)
    return ids[-1] if ids else None


def build_tool_call(with_note_id: bool, system_text: str, tool_round: int = 0):
    args = {"action": "append", "html": HIGHLIGHT_HTML, "reason": "mock：对重点考点做高亮批注"}
    if SCENARIO == "multi":
        # 模拟整章高亮：每轮改一个块（blockIndex 递增），mark 包裹，共 4 轮
        args = {
            "action": "replace_block",
            "blockIndex": tool_round,
            "html": f"<p><mark>第 {tool_round} 块已高亮（mock）</mark></p>",
            "reason": f"mock：高亮第 {tool_round} 块",
        }
        if with_note_id:
            nid = extract_target_note_id(system_text)
            if not nid:
                return None, "摘要中找不到目标笔记 ID"
            args["noteId"] = nid
    elif with_note_id:
        nid = extract_target_note_id(system_text)
        if not nid:
            return None, "摘要中找不到目标笔记 ID"
        args["noteId"] = nid
        args["reason"] = f"mock：编辑《{TARGET_TITLE}》高亮考点"
    return {
        "id": f"call_mock_{tool_round + 1}",
        "type": "function",
        "function": {"name": "edit_note", "arguments": json.dumps(args, ensure_ascii=False)},
    }, None


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        messages = body.get("messages", [])
        last = messages[-1] if messages else {}
        system_text = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
        tool_round = sum(1 for m in messages if m.get("role") == "tool")
        print(f"[mock-llm] path={self.path} scenario={SCENARIO} last_role={last.get('role')} msgs={len(messages)} tool_round={tool_round} max_tokens={body.get('max_tokens')} tools={len(body.get('tools') or [])}", flush=True)

        if last.get("role") == "user" or (SCENARIO == "multi" and last.get("role") == "tool" and tool_round < 4):
            call, err = build_tool_call(SCENARIO in ("withnoteid", "multi"), system_text, tool_round)
            if err:
                content, tool_calls = f"mock 内部错误：{err}", []
            else:
                content, tool_calls = None, [call]
        else:
            tool_feedback = ""
            if last.get("role") == "tool":
                tool_feedback = str(last.get("content", ""))[:200]
            content = f"（mock 收尾）本轮工具反馈：{tool_feedback}"
            tool_calls = []

        resp = {"choices": [{"message": {"role": "assistant", "content": content, "tool_calls": tool_calls}}], "usage": {}}
        data = json.dumps(resp, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # 静默默认访问日志（已有自定义打印）
        pass


if __name__ == "__main__":
    if len(sys.argv) > 1:
        SCENARIO = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 9999
    print(f"[mock-llm] scenario={SCENARIO} listening on http://127.0.0.1:{port}/v1/chat/completions", flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
