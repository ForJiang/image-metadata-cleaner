#!/usr/bin/env python3
"""
纯 Python SVG 风格图标光栅化：按 assets/favicon.svg 的几何（圆角矩形渐变底 +
开口圆环 + 内环 + 8 根刻度）生成 192/512 PNG。
解析求交（SDF + smoothstep 覆盖率），无需 PIL/numpy。
"""
import zlib, struct, math, os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')

# favicon.svg 的颜色
BG_A = (0x2a / 255, 0x2c / 255, 0x33 / 255)
BG_B = (0x10 / 255, 0x11 / 255, 0x14 / 255)
INK = (0xe8 / 255, 0xeb / 255, 0xf1 / 255)

# favicon.svg 的开口圆环：235.4° → 264.3°（屏幕坐标，y 向下）之间留缺口
RING_FROM = math.radians(235.4)
RING_TO = math.radians(264.3)

def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v

def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)

def sd_round_rect(px, py, hx, hy, r):
    """圆角矩形 SDF（单位=viewBox）"""
    qx, qy = abs(px) - (hx - r), abs(py) - (hy - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r

def sd_ring(px, py, cx, cy, radius, half_w):
    return abs(math.hypot(px - cx, py - cy) - radius) - half_w

def sd_segment(px, py, x1, y1, x2, y2, half_w):
    """点到线段距离 SDF"""
    dx, dy = x2 - x1, y2 - y1
    fx, fy = px - x1, py - y1
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else clamp((fx * dx + fy * dy) / L2)
    return math.hypot(fx - dx * t, fy - dy * t) - half_w

def ring_has_gap(px, py, cx, cy):
    ang = math.atan2(py - cy, px - cx) % (2 * math.pi)
    return not (RING_FROM <= ang <= RING_TO)

def render(size):
    scale = size / 64.0
    cx = cy = 32.0
    rows = []
    for j in range(size):
        row = bytearray()
        y = (j + 0.5) / scale
        for i in range(size):
            x = (i + 0.5) / scale
            # —— 圆角渐变底 ——
            d = sd_round_rect(x - cx, y - cy, 32.0, 32.0, 14.0)
            a_bg = smoothstep(0.5, -0.5, d * scale)
            t = clamp((x / 64.0 + y / 64.0) / 2.0)
            r = BG_A[0] + (BG_B[0] - BG_A[0]) * t
            g = BG_A[1] + (BG_B[1] - BG_A[1]) * t
            b = BG_A[2] + (BG_B[2] - BG_A[2]) * t
            # —— 外环（带缺口，35% 不透明度）——
            if ring_has_gap(x, y, cx, cy):
                d = sd_ring(x, y, cx, cy, 19.0, 1.7)
                a = smoothstep(0.5, -0.5, d * scale) * 0.35
                r, g, b = r + (INK[0] - r) * a, g + (INK[1] - g) * a, b + (INK[2] - b) * a
            # —— 内环 ——
            d = sd_ring(x, y, cx, cy, 7.5, 1.7)
            a = smoothstep(0.5, -0.5, d * scale)
            r, g, b = r + (INK[0] - r) * a, g + (INK[1] - g) * a, b + (INK[2] - b) * a
            # —— 8 根刻度（55% 不透明度）——
            for k in range(8):
                ang = math.radians(k * 45.0)
                ux, uy = math.cos(ang), math.sin(ang)
                d = sd_segment(x, y, cx + ux * 7.0, cy + uy * 7.0, cx + ux * 11.6, cy + uy * 11.6, 1.7)
                a = smoothstep(0.5, -0.5, d * scale) * 0.55
                r, g, b = r + (INK[0] - r) * a, g + (INK[1] - g) * a, b + (INK[2] - b) * a
            row += bytes((int(r * 255 + 0.5), int(g * 255 + 0.5), int(b * 255 + 0.5), int(a_bg * 255 + 0.5)))
        rows.append(bytes(row))
    return rows

def write_png(path, size, rows):
    def chunk(tag, payload):
        c = struct.pack('>I', len(payload)) + tag + payload
        return c + struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    raw = b''.join(b'\x00' + row for row in rows)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)
    print(f'{path}: {size}x{size}, {len(data)} bytes')

if __name__ == '__main__':
    for s in (192, 512):
        write_png(os.path.join(OUT_DIR, f'icon-{s}.png'), s, render(s))
