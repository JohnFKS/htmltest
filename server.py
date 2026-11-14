#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
智学笔记 · 本地服务器（纯 Python 标准库，零第三方依赖）

  - 静态文件服务（/、/js、/css、/vendor、/sample）
  - 数据 API：GET/POST /api/state   （data/db.json 全量读写，单用户本地应用）
             GET/POST /api/config  （data/config.json：AI 配置/提示词/相似度参数）
  - 图片上传：POST /api/upload      （dataURL → data/images/ 落盘，返回 /images/... 地址）
  - 大模型代理：POST /api/ai/chat   （转发 OpenAI 兼容 /chat/completions，规避浏览器 CORS）
               POST /api/ai/embed  （转发 /embeddings，用于相似度精排，可选）

启动：python3 server.py [--port 8765] [--host 127.0.0.1]
"""
import argparse
import base64
import json
import mimetypes
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
IMAGES_DIR = DATA_DIR / "images"
DB_PATH = DATA_DIR / "db.json"
CONFIG_PATH = DATA_DIR / "config.json"

# 全量 db 的写锁（单用户本地应用，读写都很轻）
_io_lock = threading.Lock()

DEFAULT_DB = {
    "meta": {"version": 1, "app": "zhixue-notes"},
    "notes": [],      # HTML 富文档笔记
    "annots": [],     # 截图批注文档
    "banks": [],      # 题库
    "records": [],    # 作答记录
    "entries": [],    # 三本条目（wrong / good / template）
    "templates": [],  # 做题模板库
}

DEFAULT_CONFIG = {
    "ai": {
        "baseUrl": "",      # OpenAI 兼容接口，如 https://api.deepseek.com/v1
        "apiKey": "",
        "chatModel": "",    # 文本对话模型
        "visionModel": "",  # 多模态模型（批改手写/照片、圈选提问）
        "embedModel": "",   # 可选，相似度精排
        "authStyle": "bearer",  # bearer: Authorization: Bearer；apikey: api-key 头（Dots 等平台）
        "temperature": 0.4,
        "maxTokens": 4096,
    },
    "similarity": {
        "wJaccard": 0.4,        # 字符 bigram Jaccard 权重
        "wTfidf": 0.4,          # TF-IDF 余弦权重
        "wKeyword": 0.2,        # 数学要素关键词权重
        "recallTopK": 5,        # 快速召回候选数
        "autoMergeConfidence": 0.8,  # LLM 裁决自动归并的置信阈值
        "demoThreshold": 0.55,  # 演示模式（无 LLM）的归并阈值
    },
    "prompts": {},  # 提示词覆写（键同前端 prompts.js），空则用前端默认
}


def ensure_dirs():
    DATA_DIR.mkdir(exist_ok=True)
    IMAGES_DIR.mkdir(exist_ok=True)


def load_json(path: Path, default):
    if not path.exists():
        return json.loads(json.dumps(default, ensure_ascii=False))
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        # 损坏时不覆盖原文件，返回默认值并留痕
        backup = path.with_suffix(".corrupt.bak")
        try:
            shutil.copy2(path, backup)
        except OSError:
            pass
        return json.loads(json.dumps(default, ensure_ascii=False))


def save_json(path: Path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def ai_endpoint(base_url: str, kind: str) -> str:
    """把用户填的 baseUrl 规范化为完整接口地址。"""
    base = base_url.strip().rstrip("/")
    if base.endswith("/chat/completions") or base.endswith("/embeddings"):
        return base
    suffix = "/chat/completions" if kind == "chat" else "/embeddings"
    if base.endswith("/v1"):
        return base + suffix
    return base + "/v1" + suffix


def proxy_ai(payload: dict, cfg: dict, kind: str) -> dict:
    """转发到 OpenAI 兼容接口。"""
    ai = cfg.get("ai", {})
    if not ai.get("baseUrl") or not ai.get("apiKey"):
        raise RuntimeError("AI API 未配置：请在「设置」页填写接口地址与 API Key")
    url = ai_endpoint(ai["baseUrl"], kind)
    headers = {"Content-Type": "application/json"}
    if ai.get("authStyle") == "apikey":
        # 部分平台（如 Dots）使用自定义 api-key 头认证
        headers["api-key"] = ai["apiKey"]
    else:
        headers["Authorization"] = f"Bearer {ai['apiKey']}"
    if kind == "chat":
        body = {
            "model": payload.get("model") or ai.get("chatModel") or "",
            "messages": payload.get("messages", []),
            "temperature": payload.get("temperature", ai.get("temperature", 0.4)),
            "max_tokens": payload.get("max_tokens", ai.get("maxTokens", 4096)),
        }
        if not body["model"]:
            raise RuntimeError("未设置对话模型（chatModel）")
    else:
        body = {
            "model": payload.get("model") or ai.get("embedModel") or "",
            "input": payload.get("input", []),
        }
        if not body["model"]:
            raise RuntimeError("未设置向量模型（embedModel）")
    req = urllib.request.Request(
        url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"上游 API 错误 {e.code}：{detail}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"无法连接 AI 接口：{e.reason}")

    if kind == "chat":
        try:
            content = result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError(f"上游返回结构异常：{json.dumps(result, ensure_ascii=False)[:300]}")
        return {"content": content, "usage": result.get("usage", {})}
    try:
        vectors = [item["embedding"] for item in result["data"]]
    except (KeyError, TypeError):
        raise RuntimeError(f"上游返回结构异常：{json.dumps(result, ensure_ascii=False)[:300]}")
    return {"vectors": vectors}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ---------- 基础工具 ----------
    def end_headers(self):
        # 本地应用：所有资源用 no-cache（带 Last-Modified 条件请求，更新即生效，未变则 304）
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 64 * 1024 * 1024:
            raise ValueError("请求体为空或超过 64MB 限制")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def log_message(self, fmt, *args):  # 精简日志
        print(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}")

    def serve_file(self, path: Path):
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            return self.send_json({"error": "文件读取失败"}, 500)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---------- 路由 ----------
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            with _io_lock:
                return self.send_json({"db": load_json(DB_PATH, DEFAULT_DB)})
        if path == "/api/config":
            with _io_lock:
                return self.send_json({"config": load_json(CONFIG_PATH, DEFAULT_CONFIG)})
        m = re.match(r"^/images/([\w.\-]+)$", path)
        if m:
            f = IMAGES_DIR / m.group(1)
            if f.exists():
                return self.serve_file(f)
            return self.send_json({"error": "图片不存在"}, 404)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            data = self.read_json()
        except (ValueError, json.JSONDecodeError) as e:
            return self.send_json({"error": f"请求体解析失败：{e}"}, 400)

        if path == "/api/state":
            db = data.get("db")
            if not isinstance(db, dict):
                return self.send_json({"error": "db 必须是对象"}, 400)
            with _io_lock:
                save_json(DB_PATH, db)
            return self.send_json({"ok": True})

        if path == "/api/config":
            cfg = data.get("config")
            if not isinstance(cfg, dict):
                return self.send_json({"error": "config 必须是对象"}, 400)
            # 保证关键字段结构完整
            cfg.setdefault("ai", DEFAULT_CONFIG["ai"])
            cfg.setdefault("similarity", DEFAULT_CONFIG["similarity"])
            cfg.setdefault("prompts", {})
            with _io_lock:
                save_json(CONFIG_PATH, cfg)
            return self.send_json({"ok": True})

        if path == "/api/upload":
            return self.handle_upload(data)

        if path == "/api/ai/chat":
            try:
                cfg = load_json(CONFIG_PATH, DEFAULT_CONFIG)
                return self.send_json(proxy_ai(data, cfg, "chat"))
            except RuntimeError as e:
                return self.send_json({"error": str(e)}, 502)
            except Exception as e:  # noqa: BLE001
                return self.send_json({"error": f"代理异常：{e}"}, 500)

        if path == "/api/ai/embed":
            try:
                cfg = load_json(CONFIG_PATH, DEFAULT_CONFIG)
                return self.send_json(proxy_ai(data, cfg, "embed"))
            except RuntimeError as e:
                return self.send_json({"error": str(e)}, 502)
            except Exception as e:  # noqa: BLE001
                return self.send_json({"error": f"代理异常：{e}"}, 500)

        return self.send_json({"error": f"未知接口 {path}"}, 404)

    def handle_upload(self, data):
        data_url = data.get("dataUrl") or ""
        m = re.match(r"^data:image/(png|jpe?g|gif|webp);base64,(.+)$", data_url, re.S)
        if not m:
            return self.send_json({"error": "仅支持 data:image/png|jpeg|gif|webp 的 dataURL"}, 400)
        ext = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}[m.group(1)]
        try:
            raw = base64.b64decode(m.group(2), validate=True)
        except Exception:  # noqa: BLE001
            return self.send_json({"error": "base64 解码失败"}, 400)
        if len(raw) > 32 * 1024 * 1024:
            return self.send_json({"error": "图片超过 32MB 限制"}, 400)
        filename = f"img_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.{ext}"
        with _io_lock:
            (IMAGES_DIR / filename).write_bytes(raw)
        return self.send_json({"url": f"/images/{filename}"})


def main():
    parser = argparse.ArgumentParser(description="智学笔记本地服务器")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    ensure_dirs()
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("font/woff2", ".woff2")
    mimetypes.add_type("text/markdown", ".md")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("=" * 56)
    print("  智学笔记 已启动")
    print(f"  地址      http://{args.host}:{args.port}")
    print(f"  数据目录  {DATA_DIR}")
    print("  退出      Ctrl+C")
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")


if __name__ == "__main__":
    main()
