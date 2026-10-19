#!/usr/bin/env python3
"""PEPEC 900 访问计数服务（标准库实现，无第三方依赖）

只记录：事件名 + 前端生成的随机 ID。
不记录：IP、UA、录音、任何内容。
数据落在 SQLite 单文件，按天聚合。

接口：
  POST /hit    {"e": "open|practice|asr", "v": "<随机ID>"}
  GET  /stats?t=<TOKEN>   返回总量与按天明细
"""
import json
import os
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB = os.environ.get("HIT_DB", "/var/lib/hitcounter/hit.db")
TOKEN = os.environ.get("HIT_TOKEN", "")
PORT = int(os.environ.get("HIT_PORT", "8787"))
ORIGIN = os.environ.get("HIT_ORIGIN", "https://charlieling-jiajie.github.io")
EVENTS = {"open", "practice", "asr"}


def db():
    return sqlite3.connect(DB, timeout=5)


def init():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    con = db()
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        "CREATE TABLE IF NOT EXISTS events("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " ts INTEGER NOT NULL,"
        " day TEXT NOT NULL,"
        " event TEXT NOT NULL,"
        " uid TEXT)"
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_day ON events(day, event)")
    con.commit()
    con.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "hit/1.0"

    def log_message(self, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if urlparse(self.path).path != "/hit":
            return self._json(404, {"e": "notfound"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(min(n, 512)).decode("utf-8", "ignore")
            data = json.loads(raw or "{}")
        except Exception:
            return self._json(400, {"e": "bad"})
        ev = str(data.get("e", ""))[:12]
        if ev not in EVENTS:
            return self._json(400, {"e": "event"})
        uid = str(data.get("v", ""))[:24]
        now = int(time.time())
        day = time.strftime("%Y-%m-%d", time.localtime(now))
        con = db()
        con.execute("INSERT INTO events(ts,day,event,uid) VALUES(?,?,?,?)", (now, day, ev, uid))
        con.commit()
        con.close()
        self._json(200, {"ok": 1})

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != "/stats":
            return self._json(404, {"e": "notfound"})
        if TOKEN and parse_qs(u.query).get("t", [""])[0] != TOKEN:
            return self._json(403, {"e": "forbidden"})
        con = db()
        rows = con.execute(
            "SELECT day, event, COUNT(*), COUNT(DISTINCT uid) FROM events "
            "GROUP BY day, event ORDER BY day"
        ).fetchall()
        tot = con.execute(
            "SELECT event, COUNT(*), COUNT(DISTINCT uid) FROM events GROUP BY event"
        ).fetchall()
        con.close()
        days = {}
        for day, ev, hits, uv in rows:
            days.setdefault(day, {})[ev] = {"hits": hits, "uv": uv}
        self._json(200, {
            "total": {ev: {"hits": h, "uv": u} for ev, h, u in tot},
            "days": days,
        })


if __name__ == "__main__":
    init()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
