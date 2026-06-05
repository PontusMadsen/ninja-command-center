#!/usr/bin/env python3
"""PiTFT framebuffer renderer for Little Gamers Ninja.

Long-running process that reads JPEG file paths from stdin (one per line),
renders each to the framebuffer via direct RGB565 writes, and writes 'K\n'
to stdout as ack.

Uses numpy for fast RGB→RGB565 conversion (~2ms per frame vs ~200ms).
Designed for Adafruit 2.8" PiTFT (320x240, ILI9341, SPI).
"""

import os
import sys
import numpy as np
from PIL import Image

FB_DEV = os.environ.get('SDL_FBDEV', '/dev/fb0')
SCREEN_W = 320
SCREEN_H = 240
FRAME_BYTES = SCREEN_W * SCREEN_H * 2  # RGB565 = 2 bytes/pixel


def rgb_to_565_numpy(img):
    """Convert PIL RGB image to RGB565 bytes using numpy (fast)."""
    arr = np.array(img, dtype=np.uint16)
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    return rgb565.astype('<u2').tobytes()


def main():
    # Disable console cursor on framebuffer
    try:
        with open('/sys/class/graphics/fbcon/cursor_blink', 'w') as f:
            f.write('0')
    except Exception:
        pass

    # Clear screen to black
    try:
        with open(FB_DEV, 'wb') as fb:
            fb.write(b'\x00\x00' * (SCREEN_W * SCREEN_H))
    except Exception as e:
        sys.stderr.write(f'fb init error: {e}\n')
        sys.stderr.flush()

    # Pre-open framebuffer for writes
    fb = open(FB_DEV, 'wb')

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue

        try:
            img = Image.open(path).resize((SCREEN_W, SCREEN_H)).convert('RGB')
            data = rgb_to_565_numpy(img)
            fb.seek(0)
            fb.write(data)
            fb.flush()
        except Exception as e:
            sys.stderr.write(f'render error: {e}\n')
            sys.stderr.flush()

        sys.stdout.write('K\n')
        sys.stdout.flush()

    fb.close()


if __name__ == '__main__':
    main()
