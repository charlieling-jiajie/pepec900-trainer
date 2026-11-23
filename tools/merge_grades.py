#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 data/levels.json（《PEPEC900句 排序分级表 中英文版.pdf》的难度列）合并进 data/corpus.json。

- 每句增加字段：level（原始难度 2-5）、grade（ICAO4=2/3/4，ICAO5=5）
- meta 增加 grades 统计与 levelNote（原表空白/笔误的处理说明）
- 合并后自动重导出 web/data/corpus.js

用法：python tools/merge_grades.py
（若 build_corpus.py 重建了 corpus.json，重跑本脚本即可恢复难度字段）
"""
import json
import os
import runpy
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = os.path.join(ROOT, "data", "levels.json")
CORPUS = os.path.join(ROOT, "data", "corpus.json")


def grade_of(level):
    return "ICAO5" if level == 5 else "ICAO4"


def main():
    with open(LEVELS, encoding="utf-8") as f:
        lv = json.load(f)
    levels = {int(k): v for k, v in lv["levels"].items()}
    note = lv.get("note", "")

    with open(CORPUS, encoding="utf-8") as f:
        corpus = json.load(f)

    n_ok = n_fix = 0
    for s in corpus["sentences"]:
        sid = s["id"]
        if sid not in levels:
            raise SystemExit(f"levels.json 缺少句子 {sid}")
        s["level"] = levels[sid]
        s["grade"] = grade_of(levels[sid])
        n_ok += 1

    g4 = sum(1 for s in corpus["sentences"] if s["grade"] == "ICAO4")
    g5 = sum(1 for s in corpus["sentences"] if s["grade"] == "ICAO5")
    corpus["meta"]["grades"] = {"ICAO4": g4, "ICAO5": g5}
    if note:
        corpus["meta"]["levelNote"] = note

    with open(CORPUS, "w", encoding="utf-8") as f:
        json.dump(corpus, f, ensure_ascii=False, separators=(",", ":"))
    print(f"merged {n_ok} sentences: ICAO4={g4}, ICAO5={g5}")

    # 重导出前端模块
    runpy.run_path(os.path.join(ROOT, "tools", "export_web.py"), run_name="__main__")
    print("web/data/corpus.js 已更新")


if __name__ == "__main__":
    main()
