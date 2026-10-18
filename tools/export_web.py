#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/corpus.json 导出为前端可直接 import 的 ES 模块 web/data/corpus.js"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "corpus.json")
OUT = os.path.join(ROOT, "web", "data", "corpus.js")

def main():
    c = json.load(open(SRC, encoding="utf-8"))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bad = [s["id"] for s in c["sentences"] if not s["words"]]
    if bad:
        raise SystemExit(f"语料异常：以下句子口语形式为空 {bad}")
    # tts 字段只供离线合成使用，不必下发给前端
    c["sentences"] = [{k: v for k, v in s.items() if k != "tts"} for s in c["sentences"]]
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("export default ")
        json.dump(c, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"OK -> {OUT} ({os.path.getsize(OUT)//1024} KB, {len(c['sentences'])} 句)")

if __name__ == "__main__":
    main()
