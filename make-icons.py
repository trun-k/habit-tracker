"""Generates the app icons: a small heatmap patch on the app's dark ground."""
from PIL import Image, ImageDraw

BG = (13, 14, 18)
BLANK = (30, 34, 43)
HUES = [(96, 165, 250), (45, 212, 191), (167, 139, 250), (251, 191, 36)]
# Which cell gets which hue and how strongly, read row by row.
PATTERN = [
    [(0, 0.35), (0, 0.70), None,       (1, 0.45)],
    [(1, 1.00), None,      (1, 0.60),  (2, 0.85)],
    [None,      (2, 0.55), (2, 1.00),  (3, 0.40)],
    [(3, 0.75), (3, 1.00), None,       (0, 0.90)],
]


def blend(rgb, alpha):
    return tuple(round(BG[i] + (rgb[i] - BG[i]) * alpha) for i in range(3))


def draw(size, inset_ratio):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    inset = size * inset_ratio
    span = size - 2 * inset
    gap = span * 0.085
    cell = (span - 3 * gap) / 4
    radius = max(1, int(cell * 0.24))
    for r, row in enumerate(PATTERN):
        for c, spec in enumerate(row):
            x = inset + c * (cell + gap)
            y = inset + r * (cell + gap)
            color = BLANK if spec is None else blend(HUES[spec[0]], 0.16 + 0.84 * spec[1])
            d.rounded_rectangle([x, y, x + cell, y + cell], radius=radius, fill=color)
    return img


draw(192, 0.17).save("app/icon-192.png")
draw(512, 0.17).save("app/icon-512.png")
# Maskable art must survive a circular crop, so it sits further in.
draw(512, 0.27).save("app/icon-maskable-512.png")
print("icons written")
