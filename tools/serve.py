#!/usr/bin/env python3
"""本地静态服务器（start.bat 调用）。

用法：python tools/serve.py [端口，默认 8080]

相对 python -m http.server 的修正：
- 只绑定 127.0.0.1（不暴露到局域网）
- 端口被占用时给出友好提示而非裸 traceback
- .webmanifest 返回 application/manifest+json（Safari 识别 PWA manifest 需要）
- 服务就绪后才打开浏览器，避免“页面比服务先到”的竞态
"""
import os
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


class Server(ThreadingHTTPServer):
    # Windows 上 SO_REUSEADDR 会让第二个实例“绑定成功”共享端口，
    # 关掉它才能让端口占用可靠地抛 OSError、给出友好提示
    allow_reuse_address = False


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def end_headers(self):
        # 本地调试：始终回源，避免改了文件浏览器还拿旧缓存
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默访问日志


def main():
    if sys.version_info < (3, 7):
        print("需要 Python 3.7 及以上版本")
        sys.exit(1)
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"无效端口：{sys.argv[1]}")
            sys.exit(1)

    try:
        httpd = Server(("127.0.0.1", port), Handler)
    except OSError as e:
        print(f"[!] 127.0.0.1:{port} 无法监听（可能已被占用）：{e}")
        print("    关闭占用该端口的程序，或换一个端口：python tools\\serve.py 8081")
        sys.exit(1)

    url = f"http://127.0.0.1:{port}/"
    print(f"PEPEC 900 训练器已启动：{url}（Ctrl+C 停止）")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
