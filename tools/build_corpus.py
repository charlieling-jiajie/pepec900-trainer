#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PEPEC 900 语料构建：PDF -> 900 句 -> ICAO 口语形式（spoken form）

输出 data/corpus.json：
{
  "meta": {...},
  "sentences": [
    {"id":1,"ch":1,"text":"Maintaining FL310.","spoken":"maintaining flight level tree wun zero",
     "words":["maintaining","flight","level","tree","wun","zero"],"hints":["tree","wun"],"syl":[3,1,2,1,1,2]}
  ]
}
"""
import json, re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = r"C:\Users\31383\Desktop\PEPEC900.pdf"
OUT = os.path.join(ROOT, "data", "corpus.json")

CHAPTERS = [
    (1, 1, 86, "基本通话术语"),
    (2, 87, 223, "机场通话术语"),
    (3, 224, 294, "雷达通话术语"),
    (4, 295, 381, "进近通话术语"),
    (5, 382, 440, "区域通话术语"),
    (6, 441, 700, "紧急情况通话术语"),
    (7, 701, 800, "气象及其他机场信息通话术语"),
    (8, 801, 900, "其它情况通话术语"),
]

# ---------------- ICAO 数字读法（仅 3 / 9 / 小数点特殊） ----------------
DIGIT = {"0": "zero", "1": "one", "2": "two", "3": "tree", "4": "four",
         "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "niner"}

# ---------------- ICAO 字母表（字母一律读拼读词） ----------------
ALPHA = {
    "A": "alfa", "B": "bravo", "C": "charlie", "D": "delta", "E": "echo",
    "F": "foxtrot", "G": "golf", "H": "hotel", "I": "india", "J": "juliett",
    "K": "kilo", "L": "lima", "M": "mike", "N": "november", "O": "oscar",
    "P": "papa", "Q": "quebec", "R": "romeo", "S": "sierra", "T": "tango",
    "U": "uniform", "V": "victor", "W": "whiskey", "X": "x-ray", "Y": "yankee",
    "Z": "zulu",
}
ALPHA_WORDS = set(ALPHA.values())


def spell(s: str) -> str:
    """逐字母直接读：BKM -> b k m（通话习惯）"""
    return " ".join(c.lower() for c in s if c.isalpha())


def spell_icao(s: str) -> str:
    """ICAO 拼读词：BKM -> bravo kilo mike（仅作参考表/特殊场合）"""
    return " ".join(ALPHA.get(c, c.lower()) for c in s if c.isalpha())


UNIT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen"]
TEN = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]


def digits(s):
    """逐位读：310 -> tree wun zero"""
    return " ".join(DIGIT[c] for c in s if c.isdigit())


def num_words(n):
    """英式数词（用于高度/百位）：3000 -> three thousand"""
    if n == 0:
        return "zero"
    if n < 20:
        return UNIT[n]
    if n < 100:
        w = TEN[n // 10]
        return w if n % 10 == 0 else w + " " + UNIT[n % 10]
    if n < 1000:
        w = UNIT[n // 100] + " hundred"
        return w if n % 100 == 0 else w + " and " + num_words(n % 100)
    if n < 1000000:
        w = num_words(n // 1000) + " thousand"
        return w if n % 1000 == 0 else w + " " + num_words(n % 1000)
    return " ".join(UNIT[int(c)] for c in str(n))


def alt_words(n):
    """高度读法：10000 -> one zero thousand（逐位 + 千）"""
    if n >= 10000 and n % 1000 == 0:
        return digits(str(n // 1000)) + " thousand"
    return num_words(n)


# ---------------- 读法策略 ----------------
# 通话中的缩写 / 航路点：直接读字母（V O R、B K M），这是实际陆空通话习惯
# ICAO 拼读词（Alfa/Bravo…）只用于需要逐字确认的场合，本工具在「读法表」中作为参考
# 直接读字母的常用航空缩写（用户指定：ILS 这一类 / 设备与频段缩写）
LETTER_ABBR = {"VOR", "DME", "ILS", "NDB", "QNH", "QFE", "HF", "VHF", "UHF", "SSR",
               "ATC", "ADS", "ELT"}

WORD_ABBR = {
    "FL": "flight level",
    "NOTAM": "notam", "CAVOK": "cavok", "METAR": "metar", "TAF": "taf",
    "SIGMET": "sig met",
    "EICAS": "eicas", "ECAM": "ecam", "ETOPS": "etops", "SELCAL": "selcal",
    "MAYDAY": "mayday", "PAN": "pan", "WILCO": "wilco", "ROGER": "roger",
    "NOT": "not",
}

# 按「词」读的特定缩写
SPECIAL = {
    "LOC": "localizer",
    "RNAV": "ar nav",
    "TCAS": "t cas",
    "RAIM": "raim",
}

HINT_NAME = {
    "tree": "3 读 TREE（非 three）",
    "niner": "9 读 NINER（非 nine）",
    "decimal": "小数点读 DECIMAL",
    "alpha": "字母按 ICAO 拼读词（Alfa/Bravo…）；VOR/ILS/QNH 等直接读字母",
}


# ---------------- 书面 -> 口语 ----------------
def clean(text: str) -> str:
    t = text
    t = t.replace("，", ", ").replace("。", ". ").replace("？", "? ").replace("（", " (")
    t = t.replace("）", ") ").replace("、", ", ").replace("’", "'")
    t = t.replace("“", '"').replace("”", '"')
    t = t.replace("／", "/")
    t = re.sub(r"\s+", " ", t).strip()

    # 删除不读的括号注释（保留 TORA/ASDA/TODA 这类要读的术语）
    t = re.sub(r"\((?:ten-ninety|East|east|West|west)\)", " ", t)

    # 无法用通用规则还原的专名（逐条列出，便于复核）
    t = t.replace("JEMMYvia", "JEMMY via")
    t = t.replace("BK-1ADeparture", "BK-1A Departure")
    t = t.replace("1AArrival", "1A Arrival")

    # 修补 PDF 抽取造成的单词粘连（字体切换丢失空格）
    # aB -> a B ; a1 -> a 1 ; 1a -> 1 a
    t = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t)
    t = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", t)
    t = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", t)

    # ADS-B / ADS-C 按字母读，先于连字符拆分处理
    t = t.replace("ADS-B", "a d s b").replace("ADS-C", "a d s c")

    t = re.sub(r"(?<=[A-Z0-9])-(?=[A-Z0-9])", " ", t)   # BK-1A -> BK 1 A

    # 规则无法判别的残留（逐个列出，便于复核）
    fixes = [
        (r"\bAapproved\b", "A approved"),
        (r"\bAto\b", "A to"),
        (r"\bAat\b", "A at"),
        (r"\bft\b", "feet"),
        (r"\bRNPapproach\b", "RNP approach"),
    ]
    for pat, rep in fixes:
        t = re.sub(pat, rep, t)
    return re.sub(r"\s+", " ", t).strip()


def expand_segment(t: str, protect_head: bool = False):
    """把一段（不含标点）的书面文本展开为口语词表，返回 words"""
    t = t.strip().rstrip(".")

    # 1) FL 高度层
    def _fl(m):
        return "flight level " + digits(m.group(1))
    t = re.sub(r"\bFL\s?(\d{2,3})\b", _fl, t)

    # 2) 跑道号
    def _rwy(m):
        suf = {"L": " left", "C": " center", "R": " right"}.get((m.group(2) or "").upper(), "")
        return "runway " + digits(m.group(1)) + suf
    t = re.sub(r"\b[Rr]unway\s?(\d{1,2})\s?([LCRlcr])?\b(?!\w)", _rwy, t)

    # 3) QNH / QFE 数值
    t = re.sub(r"\bQNH\s?(\d{3,4})\b", lambda m: "q n h " + digits(m.group(1)), t)
    t = re.sub(r"\bQFE\s?(\d{3,4})\b", lambda m: "q f e " + digits(m.group(1)), t)

    # 4) Mach point/decimal -> 统一 ICAO decimal
    t = re.sub(r"(?i)\bmach\s+(?:decimal|point)\s+(\d+)", lambda m: "mach decimal " + digits(m.group(1)), t)
    t = re.sub(r"(?i)\bpoint\s+(\d+)\b", lambda m: "decimal " + digits(m.group(1)), t)

    # 5) 频率 / 小数（118.7、29.91）
    t = re.sub(r"\b(\d+)\.(\d+)\b",
               lambda m: digits(m.group(1)) + " decimal " + digits(m.group(2)), t)

    # 5.5) 进近类别 CAT II -> category two
    t = re.sub(r"(?i)\bCAT\s+(III|II|I)\b",
               lambda m: "category " + {"I": "one", "II": "two", "III": "three"}[m.group(1).upper()], t)

    # 5.6) 质量/容积等单位 -> 数词
    t = re.sub(r"\b(\d+)\s*(kilograms|kilogram|kg|tonnes|tonne|pounds|pound|lbs|litres|liters|liter)\b",
               lambda m: num_words(int(m.group(1))) + " " + m.group(2), t)

    # 6) 高度 / 高度变化率：带 feet 的数词
    t = re.sub(r"\b(\d{1,2}),(\d{3})\b", lambda m: m.group(1) + m.group(2), t)
    t = re.sub(r"\b(\d+)\s*(feet|foot)\b", lambda m: alt_words(int(m.group(1))) + " " + m.group(2), t)

    # 7) 度 / 航向 / 航迹 / 径向线 / 距离 / 速度 -> 逐位
    t = re.sub(r"\b(heading|track|radial|course)\s+(\d{1,3})\b",
               lambda m: m.group(1) + " " + digits(m.group(2).zfill(3) if len(m.group(2)) <= 2 else m.group(2)), t)
    t = re.sub(r"\b(\d{1,3})\s*(degrees|degree)\b", lambda m: digits(m.group(1)) + " " + m.group(2), t)
    t = re.sub(r"\b(\d{1,3})\s*(miles|mile)\b", lambda m: digits(m.group(1)) + " " + m.group(2), t)
    t = re.sub(r"\b(\d{1,3})\s*(knots|knot)\b", lambda m: digits(m.group(1)) + " " + m.group(2), t)
    t = re.sub(r"\b(\d{1,3})\s*(meters|meter)\b", lambda m: digits(m.group(1)) + " " + m.group(2), t)

    # 8) 其余裸数字 -> 逐位（时间、编号、高度层之外的编号）
    t = re.sub(r"\b(\d+)\b", lambda m: digits(m.group(1)), t)

    # 9) 大写缩写 / 航路点 -> 按 ICAO 字母表拼读
    t = re.sub(r"(?<=[A-Z0-9])-(?=[A-Z0-9])", " ", t)   # BK-1A -> BK 1 A（仅限大写/数字段）

    def _up(m):
        w = m.group(0)
        if w in SPECIAL:
            return SPECIAL[w]
        if w in WORD_ABBR:
            return WORD_ABBR[w]
        plain = w in LETTER_ABBR
        parts = re.split(r"([-])", w)
        out = []
        for p in parts:
            if p == "-":
                out.append(" ")
            elif p.isdigit():
                out.append(digits(p))
            else:
                out.append(spell(p) if plain else spell_icao(p))
        return " ".join(out)

    t = re.sub(r"\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b", _up, t)   # 带连字符优先
    t = re.sub(r"\b[A-Z]{2,}\d*\b", _up, t)

    # 单个大写字母（information P / taxiway A）按拼读词读；句首冠词 A 除外
    head = ""
    if protect_head and t.startswith("A "):
        head, t = "A ", t[2:]
    t = re.sub(r"(?<![\w-])([A-HJ-Z])(?![\w-])", lambda m: ALPHA[m.group(1)], t)
    t = head + t

    t = re.sub(r"\s+", " ", t).strip().lower()
    # 标点清理
    t = re.sub(r"[^a-z0-9 \-']", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return [w for w in t.split(" ") if w]


def spoken_of(text: str):
    """按标点切段展开；返回 (words, hints, tts_text)

    words  —— 供界面显示与逐词比对（不含标点）
    tts_text —— 供语音合成，保留 , . 等标点以获得自然停顿
    """
    t = clean(text)
    segs = re.split(r"([,;:?!]|\.(?=\s|$))", t)
    words, hints, gaps = [], [], []
    tts = ""
    first = True
    for seg in segs:
        if not seg:
            continue
        if re.fullmatch(r"[,;:?!.]", seg):
            tts = tts.rstrip() + ("," if seg == ";" else seg) + " "
            # 记录停顿位置：在下一个词之前插静音（末尾停顿无意义，忽略）
            gaps.append({"at": len(words), "dur": 0.42 if seg in ".?!" else 0.16})
            continue
        w = expand_segment(seg, protect_head=first)
        first = False
        if not w:
            continue
        words += w
        tts += " ".join(w) + " "

    for x in ("tree", "niner", "decimal"):
        if x in words:
            hints.append(x)
    if "alpha" not in hints and (
            any(x in ALPHA_WORDS for x in words)
            or any(len(x) == 1 and x != "a" for x in words)):
        hints.insert(0, "alpha")

    gaps = [g for g in gaps if 0 < g["at"] < len(words)]
    return words, hints, tts.strip(), gaps


def syllables(w: str) -> int:
    g = re.findall(r"[aeiouy]+", w)
    return max(1, len(g))


def main():
    import pdfplumber
    lines = []
    with pdfplumber.open(PDF) as pdf:
        for pg in pdf.pages:
            for ln in (pg.extract_text() or "").splitlines():
                lines.append(ln.strip())

    num = re.compile(r"^(\d{1,3})[.．、]\s*(.*)$")
    chap = re.compile(r"^第[一二三四五六七八九十]+章")
    page_no = re.compile(r"^\d{1,3}$")

    raw, cur, buf = {}, None, []

    def flush():
        if cur and buf:
            s = re.sub(r"\s+", " ", " ".join(buf)).strip()
            raw[cur] = s

    for ln in lines:
        if not ln or page_no.match(ln) or chap.match(ln):
            continue
        m = num.match(ln)
        # 仅当编号后有正文才视为新句；PDF 折行会产生 "24." 这类伪编号
        if m and 1 <= int(m.group(1)) <= 900 and m.group(2).strip():
            flush()
            cur, buf = int(m.group(1)), [m.group(2)]
        elif cur:
            buf.append(ln)
    flush()

    def ch_of(i):
        for c, a, b, _ in CHAPTERS:
            if a <= i <= b:
                return c
        return 0

    out = []
    for i in range(1, 901):
        text = raw.get(i, "")
        words, hints, tts, gaps = spoken_of(text)
        out.append({
            "id": i, "ch": ch_of(i), "text": text, "spoken": " ".join(words),
            "tts": tts, "gaps": gaps, "words": words, "syl": [syllables(w) for w in words], "hints": hints,
        })

    meta = {
        "title": "PEPEC 900 句复诵训练器", "count": len(out),
        "chapters": [{"id": c, "name": n, "from": a, "to": b} for c, a, b, n in CHAPTERS],
        "hintText": HINT_NAME,
        "alphabet": {k: v.capitalize() for k, v in ALPHA.items()},
        "digitSpecial": [{"k": "3", "v": "Tree"}, {"k": "9", "v": "Niner"}, {"k": ".", "v": "Decimal"}],
        "digitNormal": "其余数字按常规读法：zero / one / two / four / five / six / seven / eight",
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "sentences": out}, f, ensure_ascii=False, indent=1)

    print(f"OK -> {OUT}  {len(out)} 句")
    print("多词句校验：")
    for i in (18, 33, 34, 55, 219, 330, 451, 900):
        s = out[i - 1]
        print(f"  {i:>3} | {s['text'][:62]}")
        print(f"      -> {s['spoken']}")


if __name__ == "__main__":
    main()
