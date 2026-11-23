"""本地预览服务器（仅 127.0.0.1）。

用法：python serve.py [端口，默认 8765]
桌面浏览器打开 http://localhost:8765 即可用电脑摄像头测试。
注：手机访问需要 HTTPS（浏览器限制摄像头只能在安全上下文使用），见 README。
"""
import http.server
import socketserver
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), partial(Handler, directory=str(ROOT))) as httpd:
        print(f"Hand Melody: http://localhost:{PORT}")
        httpd.serve_forever()
