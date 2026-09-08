#!/usr/bin/env python3
"""Иконки приложения: спокойный зелёный знак «стрелка вверх» на светлой подложке."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), 'dist')
os.makedirs(OUT, exist_ok=True)

BG_LIGHT = (244, 246, 245, 255)
GREEN    = (24, 164, 107, 255)
DEEP     = (12, 26, 20, 255)


def rounded(size, radius_ratio, bg):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=bg)
    return img


def glyph(img, size, color, inset=0.0):
    """Стрелка роста: три отрезка ломаной, скруглённые концы."""
    d = ImageDraw.Draw(img)
    s = size
    pad = s * (0.26 + inset)
    w = max(2, int(s * 0.085))

    pts = [
        (pad,               s - pad),
        (pad + (s - 2*pad) * 0.33, s - pad - (s - 2*pad) * 0.34),
        (pad + (s - 2*pad) * 0.62, s - pad - (s - 2*pad) * 0.16),
        (s - pad,           pad),
    ]
    d.line(pts, fill=color, width=w, joint='curve')
    # Скруглённые торцы
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - w/2, p[1] - w/2, p[0] + w/2, p[1] + w/2], fill=color)
    # Наконечник
    tip = pts[-1]
    arm = (s - 2*pad) * 0.15
    d.line([(tip[0] - arm, tip[1]), tip], fill=color, width=w, joint='curve')
    d.line([tip, (tip[0], tip[1] + arm)], fill=color, width=w, joint='curve')
    d.ellipse([tip[0] - arm - w/2, tip[1] - w/2, tip[0] - arm + w/2, tip[1] + w/2], fill=color)
    d.ellipse([tip[0] - w/2, tip[1] + arm - w/2, tip[0] + w/2, tip[1] + arm + w/2], fill=color)
    return img


def build(size, path, bg, fg, radius=0.22, inset=0.0):
    img = rounded(size, radius, bg)
    glyph(img, size, fg, inset)
    img.save(path, 'PNG')
    return path


build(192, os.path.join(OUT, 'icon-192.png'), BG_LIGHT, GREEN)
build(512, os.path.join(OUT, 'icon-512.png'), BG_LIGHT, GREEN)
# Maskable: подложка на всю площадь, знак с запасом под обрезку
build(512, os.path.join(OUT, 'icon-maskable-512.png'), GREEN, (255, 255, 255, 255), radius=0.0, inset=0.06)
build(180, os.path.join(OUT, 'apple-touch-icon.png'), BG_LIGHT, GREEN)
# Favicon
img = rounded(64, 0.22, DEEP)
glyph(img, 64, (143, 217, 184, 255))
img.save(os.path.join(OUT, 'favicon.png'), 'PNG')
img.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, 'favicon.ico'), sizes=[(32, 32)])

print('иконки готовы')
