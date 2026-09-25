#!/usr/bin/env python3
"""
纯 Python 图标生成器（无 PIL/numpy）：按 assets/favicon.svg 的几何生成全套站点图标。

圆角底 rx=14 + 斜向渐变 #2a2c33→#101114（与 rvc-sound-clone 同一套，保证
16px 标签页下圆角轮廓依然分明）；光圈 glyph 用实心墨色渐变 #ffffff→#c3c9d6
（对齐 rvc 音量柱的对比度——glyph 太淡会让圆角剪影在深色标签栏里显不出来）。
解析求交（SDF + smoothstep 覆盖率）做抗锯齿。
输出：icon-16/32/180/192/512.png + favicon.ico（内含 16/32 两张 PNG）。
"""
import zlib, struct, math, os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
SIZES = [16, 32, 180, 192, 512]

TILE_A = (0x2a / 255, 0x2c / 255, 0x33 / 255)
TILE_B = (0x10 / 255, 0x11 / 255, 0x14 / 255)
INK_TOP = (1.0, 1.0, 1.0)          # #ffffff
INK_BOTTOM = (0xc3 / 255, 0xc9 / 255, 0xd6 / 255)  # #c3c9d6

# favicon.svg 的开口圆环缺口（屏幕坐标，y 向下）
RING_FROM = math.radians(235.4)
RING_TO = math.radians(264.3)

def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v

def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)

def sd_round_rect(px, py, hx, hy, r):
    qx, qy = abs(px) - (hx - r), abs(py) - (hy - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r

def sd_ring(px, py, radius, half_w):
    return abs(math.hypot(px, py) - radius) - half_w

def sd_segment(px, py, x1, y1, x2, y2, half_w):
    dx, dy = x2 - x1, y2 - y1
    fx, fy = px - x1, py - y1
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else clamp((fx * dx + fy * dy) / L2)
    return math.hypot(fx - dx * t, fy - dy * t) - half_w

def render(size):
    scale = size / 64.0
    cx = cy = 32.0
    rows = []
    for j in range(size):
        row = bytearray()
        y = (j + 0.5) / scale
        # 墨色垂直渐变：顶 #ffffff → 底 #c3c9d6
        gy = clamp(y / 64.0)
        ink = (
            INK_TOP[0] + (INK_BOTTOM[0] - INK_TOP[0]) * gy,
            INK_TOP[1] + (INK_BOTTOM[1] - INK_TOP[1]) * gy,
            INK_TOP[2] + (INK_BOTTOM[2] - INK_TOP[2]) * gy,
        )
        for i in range(size):
            x = (i + 0.5) / scale
            # —— 圆角渐变底 ——
            d = sd_round_rect(x - cx, y - cy, 32.0, 32.0, 14.0)
            a_bg = smoothstep(0.5, -0.5, d * scale)
            t = clamp((x / 64.0 + y / 64.0) / 2.0)
            r = TILE_A[0] + (TILE_B[0] - TILE_A[0]) * t
            g = TILE_A[1] + (TILE_B[1] - TILE_A[1]) * t
            b = TILE_A[2] + (TILE_B[2] - TILE_A[2]) * t
            # —— 外环（带缺口，实心墨色）——
            ang = math.atan2(y - cy, x - cx) % (2 * math.pi)
            if not (RING_FROM <= ang <= RING_TO):
                d = sd_ring(x - cx, y - cy, 19.0, 1.8)
                a = smoothstep(0.5, -0.5, d * scale)
                r, g, b = r + (ink[0] - r) * a, g + (ink[1] - g) * a, b + (ink[2] - b) * a
            # —— 内环（实心墨色）——
            d = sd_ring(x - cx, y - cy, 7.5, 1.8)
            a = smoothstep(0.5, -0.5, d * scale)
            r, g, b = r + (ink[0] - r) * a, g + (ink[1] - g) * a, b + (ink[2] - b) * a
            # —— 8 根刻度（实心墨色 90%）——
            for k in range(8):
                a_ = math.radians(k * 45.0)
                ux, uy = math.cos(a_), math.sin(a_)
                d = sd_segment(x, y, cx + ux * 7.0, cy + uy * 7.0, cx + ux * 11.6, cy + uy * 11.6, 1.3)
                a = smoothstep(0.5, -0.5, d * scale) * 0.9
                r, g, b = r + (ink[0] - r) * a, g + (ink[1] - g) * a, b + (ink[2] - b) * a
            row += bytes((int(r * 255 + 0.5), int(g * 255 + 0.5), int(b * 255 + 0.5), int(a_bg * 255 + 0.5)))
        rows.append(bytes(row))
    return rows

def png_bytes(size, rows):
    def chunk(tag, payload):
        c = struct.pack('>I', len(payload)) + tag + payload
        return c + struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    raw = b''.join(b'\x00' + row for row in rows)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

def ico_bytes(pngs):
    """把若干 PNG 打进一个 ICO（Vista+ 支持 PNG 压缩条目）"""
    count = len(pngs)
    header = struct.pack('<HHH', 0, 1, count)
    offset = 6 + 16 * count
    entries = b''
    blob = b''
    for size, data in pngs:
        dim = 0 if size >= 256 else size  # 0 表示 256
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blob += data
    return header + entries + blob

if __name__ == '__main__':
    all_pngs = {}
    for s in SIZES:
        data = png_bytes(s, render(s))
        all_pngs[s] = data
        path = os.path.join(OUT_DIR, f'icon-{s}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'icon-{s}.png: {s}x{s}, {len(data)} bytes')
    ico = ico_bytes([(16, all_pngs[16]), (32, all_pngs[32])])
    with open(os.path.join(OUT_DIR, 'favicon.ico'), 'wb') as f:
        f.write(ico)
    print(f'favicon.ico: {len(ico)} bytes（含 16/32 PNG）')
    # 输出 32px 的 base64（供 index.html 内联主图标）
    import base64
    print('BASE64_32=' + base64.b64encode(all_pngs[32]).decode())
