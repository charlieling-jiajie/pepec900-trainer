"""用 Chrome DevTools 协议驱动真实浏览器跑自检页（纯标准库，无需第三方包）。

用法：
  python tools/cdp_check.py <url> [timeout_seconds]

退出码 0 = 页面报告全部通过；非 0 = 有失败。
"""
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def http_get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return json.loads(r.read().decode())


def http_put(path):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method="PUT")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode())


class WS:
    """最小 WebSocket 客户端：只支持文本帧，够用"""

    def __init__(self, url):
        # url 形如 ws://127.0.0.1:9333/devtools/page/ABC
        hostport = url.split("/")[2]
        host, port = hostport.split(":")
        path = "/" + "/".join(url.split("/")[3:])
        self.sock = socket.create_connection((host, int(port)), timeout=240)
        self.sock.settimeout(240)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\nHost: {hostport}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if "101" not in buf.split(b"\r\n")[0].decode():
            raise RuntimeError("WebSocket 握手失败: " + buf[:120].decode("utf-8", "ignore"))

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytes([0x81])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def recv(self):
        head = self._recvn(2)
        length = head[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recvn(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recvn(8))[0]
        if head[1] & 0x80:
            self._recvn(4)  # 服务端一般不掩码
        return self._recvn(length).decode()

    def _recvn(self, n):
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise RuntimeError("连接已关闭")
            out += chunk
        return out

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def run(url, timeout=90):
    import shutil
    profile = os.path.join(os.environ.get("TEMP", "."), "chrome-cdp-pepec-" + os.urandom(4).hex())
    shutil.rmtree(profile, ignore_errors=True)
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-proxy-server", "--proxy-bypass-list=*",
         f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
         "--window-size=420,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        # 等 Chrome 起来
        for _ in range(50):
            try:
                http_get("/json/version")
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise RuntimeError("Chrome DevTools 端口未就绪")

        try:
            target = http_put("/json/new?about:blank")
        except Exception:
            target = http_get("/json/new?about:blank")

        ws = WS(target["webSocketDebuggerUrl"])
        msg_id = 0

        def call(method, params):
            nonlocal msg_id
            msg_id += 1
            ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
            while True:
                data = json.loads(ws.recv())
                if data.get("id") == msg_id:
                    return data

        call("Runtime.enable", {})
        call("Page.enable", {})
        call("Page.navigate", {"url": url})
        # 等页面加载完
        deadline = time.time() + 30
        while time.time() < deadline:
            data = json.loads(ws.recv())
            if data.get("method") == "Page.loadEventFired":
                break
        expr = (
            "new Promise((resolve) => {"
            "  const t0 = Date.now();"
            "  const tick = () => {"
            "    const title = document.title || '';"
            "    if (title.startsWith('SEL') || Date.now() - t0 > " + str(int(timeout * 1000)) + ") {"
            "      clearInterval(timer);"
            "      resolve((document.getElementById('out') || {}).innerText || '无结果');"
            "      return;"
            "    }"
            "  };"
            "  const timer = setInterval(tick, 300);"
            "  tick();"
            "})"
        )
        res = call("Runtime.evaluate", {
            "expression": expr, "awaitPromise": True, "returnByValue": True, "timeout": timeout * 1000,
        })
        ws.close()
        return (res.get("result", {}).get("result", {}) or {}).get("value", "无返回")
    finally:
        proc.terminate()


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/selftest.html"
    t = int(sys.argv[2]) if len(sys.argv) > 2 else 90
    text = run(url, t)
    print(text)
    sys.exit(0 if "总判定：全部通过" in text else 1)
