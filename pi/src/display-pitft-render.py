#!/usr/bin/env python3
"""PiTFT framebuffer renderer for Little Gamers Ninja.

Long-running process that reads JPEG file paths from stdin (one per line),
renders each to the framebuffer via direct RGB565 writes, and writes 'K\n'
to stdout as ack.

Works over SSH — no need for fbcon/SDL console access.
Designed for Adafruit 2.8" PiTFT (320x240, ILI9341, SPI).
"""

import os
import sys
import struct
from PIL import Image

FB_DEV = os.environ.get('SDL_FBDEV', '/dev/fb0')
SCREEN_W = 320
SCREEN_H = 240


def rgb_to_565(r, g, b):
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def render_to_fb(img_path):
    img = Image.open(img_path).resize((SCREEN_W, SCREEN_H)).convert('RGB')
    pixels = img.tobytes()

    fb_data = bytearray(SCREEN_W * SCREEN_H * 2)
    for i in range(0, len(pixels), 3):
        px = i // 3
        rgb565 = rgb_to_565(pixels[i], pixels[i+1], pixels[i+2])
        struct.pack_into('<H', fb_data, px * 2, rgb565)

    with open(FB_DEV, 'wb') as fb:
        fb.write(fb_data)


def main():
    # Fill black on startup
    black = b'\x00\x00' * (SCREEN_W * SCREEN_H)
    try:
        with open(FB_DEV, 'wb') as fb:
            fb.write(black)
    except Exception as e:
        sys.stderr.write(f'fb init error: {e}\n')
        sys.stderr.flush()

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue

        try:
            render_to_fb(path)
        except Exception as e:
            sys.stderr.write(f'render error: {e}\n')
            sys.stderr.flush()

        sys.stdout.write('K\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
