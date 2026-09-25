# -*- coding: utf-8 -*-
"""生成程序图标（纯标准库，不依赖 Pillow）。

图形：深色圆角底 + 2x2 反馈格子（绿/黄/灰/浅），一眼看出是「猜谜反馈」。
多尺寸 ICO，内部用 4 倍超采样再缩小，边缘平滑。
用法：python app/make_icon.py
"""
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "icons"

BG = (0x2C, 0x2C, 0x2A, 255)
CELLS = [
    (0x63, 0x99, 0x22, 255),   # 绿
    (0xEF, 0x9F, 0x27, 255),   # 黄
    (0x88, 0x87, 0x80, 255),   # 灰
    (0xEA, 0xF3, 0xDE, 255),   # 浅
]
SS = 4  # 超采样倍数


def rounded_rect_mask(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def render(size):
    """返回 size*size 的 RGBA 像素（bytes）"""
    S = size * SS
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]

    outer_r = S * 0.22
    for y in range(S):
        for x in range(S):
            if rounded_rect_mask(x, y, 0, 0, S - 1, S - 1, outer_r):
                px[y][x] = BG

    pad = S * 0.17
    gap = S * 0.075
    cell = (S - 2 * pad - gap) / 2.0
    cell_r = cell * 0.18
    for idx, color in enumerate(CELLS):
        col, row = idx % 2, idx // 2
        x0 = pad + col * (cell + gap)
        y0 = pad + row * (cell + gap)
        for y in range(int(y0), int(y0 + cell) + 1):
            for x in range(int(x0), int(x0 + cell) + 1):
                if 0 <= x < S and 0 <= y < S and rounded_rect_mask(x, y, x0, y0, x0 + cell, y0 + cell, cell_r):
                    px[y][x] = color

    # 缩小（盒式平均）
    out = bytearray()
    for y in range(size):
        out.append(0)  # PNG 行过滤字节
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = px[y * SS + dy][x * SS + dx]
                    r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3]
            n = SS * SS
            if a:
                out += bytes((r // a, g // a, b // a, a // n))
            else:
                out += b"\x00\x00\x00\x00"
    return bytes(out)


def png(size, rgba_rows):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(rgba_rows, 9)) + chunk(b"IEND", b""))


def ico(entries):
    header = struct.pack("<HHH", 0, 1, len(entries))
    dirs, datas, offset = b"", b"", 6 + 16 * len(entries)
    for size, data in entries:
        w = 0 if size >= 256 else size
        dirs += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        datas += data
    return header + dirs + datas


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    entries = []
    for s in sizes:
        entries.append((s, png(s, render(s))))
    ico_path = OUT_DIR / "app.ico"
    ico_path.write_bytes(ico(entries))
    (OUT_DIR / "preview-256.png").write_bytes(png(256, render(256)))
    print("已生成 %s（%d 字节，含 %s）" % (ico_path, ico_path.stat().st_size, "/".join(str(s) for s in sizes)))
    print("预览图 %s" % (OUT_DIR / "preview-256.png"))


if __name__ == "__main__":
    main()
