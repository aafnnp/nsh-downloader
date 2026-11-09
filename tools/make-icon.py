#!/usr/bin/env python3
"""Draws the app icon and the browser extension's icons.

Needs Pillow (`pip install pillow`), which is only a build-time tool here:

    python3 tools/make-icon.py
"""

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCALE = 4
SIZE = 1024


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (1, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size - 1)
        draw.point(
            (0, y),
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return image.resize((size, size), Image.NEAREST)


def draw_icon(size: int) -> Image.Image:
    big = size * SCALE
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    body = gradient(big, (99, 102, 241), (91, 33, 182))
    canvas.paste(body, (0, 0), rounded_mask(big, round(big * 0.24)))

    draw = ImageDraw.Draw(canvas)
    white = (255, 255, 255, 255)
    shaft = (0.455, 0.20, 0.545, 0.57)
    draw.rounded_rectangle(
        tuple(round(v * big) for v in shaft), radius=round(big * 0.045), fill=white
    )
    draw.polygon(
        [
            (round(0.30 * big), round(0.53 * big)),
            (round(0.70 * big), round(0.53 * big)),
            (round(0.50 * big), round(0.74 * big)),
        ],
        fill=white,
    )
    draw.rounded_rectangle(
        (round(0.27 * big), round(0.80 * big), round(0.73 * big), round(0.875 * big)),
        radius=round(big * 0.038),
        fill=white,
    )
    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    icon = draw_icon(SIZE)
    icon.save(ROOT / "icon.png")
    icons = ROOT / "extension" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        icon.resize((size, size), Image.LANCZOS).save(icons / f"{size}.png")
    print("wrote icon.png and extension/icons/{16,32,48,128}.png")


if __name__ == "__main__":
    main()
