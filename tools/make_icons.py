#!/usr/bin/env python3
"""生成 PWA 图标 PNG（icon-192 / icon-512 / icon-512-maskable / apple-touch-icon）。

图案与 web/favicon.svg 一致：深底 + 蓝色 VOR 同心圆仪表 + 顶部声波弧线。
仅供一次性生成图标，生成后可删除。用法：python tools/make_icons.py
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web")

BG = (13, 21, 32, 255)        # #0d1520
BLUE = (76, 141, 255, 255)    # #4c8dff
SS = 8                         # 超采样倍数，降采样后边缘更顺


def arc_angles(cx, cy, x1, y1, x2, y2):
    """返回从点1到点2、顺时针（y 向下坐标系）经过圆顶部的 PIL 角度区间。"""
    a1 = math.degrees(math.atan2(y1 - cy, x1 - cx)) % 360
    a2 = math.degrees(math.atan2(y2 - cy, x2 - cx)) % 360
    return a1, a2


def draw_icon(size, rounded=True):
    s = size * SS
    k = s / 64  # favicon viewBox 为 64x64
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 底：圆角方块（rx=14）或满幅（maskable 用）
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=14 * k, fill=BG)
    else:
        d.rectangle([0, 0, s - 1, s - 1], fill=BG)

    # VOR 同心圆（cx=32 cy=34，stroke 2.5）
    cx, cy = 32 * k, 34 * k
    d.ellipse([cx - 17 * k, cy - 17 * k, cx + 17 * k, cy + 17 * k],
              outline=(76, 141, 255, 140), width=round(2.5 * k))
    d.ellipse([cx - 10 * k, cy - 10 * k, cx + 10 * k, cy + 10 * k],
              outline=(76, 141, 255, 217), width=round(2.5 * k))
    r = 3.2 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BLUE)

    # 指针：(32,34) → (46,20)
    d.line([cx, cy, 46 * k, 20 * k], fill=BLUE, width=round(2.5 * k))

    # 顶部声波弧：圆心(26,16) r=5 与 圆心(26,8+√41) r=11，各画经过顶部的一段
    for (ccx, ccy, rr, alpha) in ((26, 16, 5, 178), (26, 8 + math.sqrt(41), 11, 102)):
        x1, y1 = ccx - rr * 0.8, ccy - rr * 0.6   # 弧两端点 ≈ SVG 弦端
        x2, y2 = ccx + rr * 0.8, ccy - rr * 0.6
        a1, a2 = arc_angles(ccx, ccy, x1, y1, x2, y2)
        d.arc([ (ccx - rr) * k, (ccy - rr) * k, (ccx + rr) * k, (ccy + rr) * k ],
              start=a1, end=a2, fill=(230, 238, 252, alpha), width=round(2 * k))

    img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    jobs = [
        (512, "icon-512.png", True, False),            # RGBA，圆角
        (192, "icon-192.png", True, False),
        (512, "icon-512-maskable.png", False, False),  # 满幅，maskable 用
        (180, "apple-touch-icon.png", True, True),     # iOS 要求不透明
    ]
    for size, name, rounded, opaque in jobs:
        img = draw_icon(size, rounded)
        if opaque:
            flat = Image.new("RGB", (size, size), (13, 21, 32))
            flat.paste(img, (0, 0), img)
            img = flat
        path = os.path.join(OUT, name)
        img.save(path, "PNG")
        print(f"{name}: {size}x{size}  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
