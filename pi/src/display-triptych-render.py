#!/usr/bin/env python3
"""Triptych renderer — drives 3× ILI9341 SPI displays from stdin commands.

Protocol (stdin, one JSON line per command):
  {"screen": 0, "path": "/path/to/frame.jpg"}   — render image to screen 0/1/2
  {"screen": "all", "path": "/path/to/wide.jpg"} — render 720×320 across all 3

Acks each command with 'K\n' on stdout after the frame is pushed.

Screens: 0=left (240×320), 1=middle (240×320), 2=right (240×320)
All displays are ILI9341, portrait orientation, SPI0.
"""

import json
import os
import sys
import time
import threading

import numpy as np
from PIL import Image

try:
    import spidev
    import RPi.GPIO as GPIO
    HAS_HW = True
except ImportError:
    HAS_HW = False
    sys.stderr.write('spidev/RPi.GPIO not available — running in stub mode\n')
    sys.stderr.flush()

# --- Pin assignments per display ---
DISPLAYS = [
    {   # Screen 0 — Left (Clock)
        'cs': 8, 'dc': 24, 'rst': 25,
    },
    {   # Screen 1 — Middle (Ninja)
        'cs': 7, 'dc': 23, 'rst': 27,
    },
    {   # Screen 2 — Right (Info)
        'cs': 5, 'dc': 22, 'rst': 17,
    },
]

SCREEN_W = 240
SCREEN_H = 320
SPI_SPEED = 32_000_000  # 32 MHz — safe for ILI9341 over jumper wires


# --- ILI9341 driver ---

class ILI9341:
    """Minimal ILI9341 driver using spidev + GPIO. All CS managed manually."""

    def __init__(self, cfg, spi):
        self.dc = cfg['dc']
        self.rst = cfg['rst']
        self.cs = cfg['cs']
        self.spi = spi

        GPIO.setup(self.dc, GPIO.OUT)
        GPIO.setup(self.rst, GPIO.OUT)
        GPIO.setup(self.cs, GPIO.OUT)
        GPIO.output(self.cs, GPIO.HIGH)

        self._reset()
        self._init_display()

    def _reset(self):
        GPIO.output(self.rst, GPIO.HIGH)
        time.sleep(0.01)
        GPIO.output(self.rst, GPIO.LOW)
        time.sleep(0.02)
        GPIO.output(self.rst, GPIO.HIGH)
        time.sleep(0.15)

    def _cmd(self, cmd, data=None):
        GPIO.output(self.cs, GPIO.LOW)
        GPIO.output(self.dc, GPIO.LOW)
        self.spi.writebytes([cmd])
        if data:
            GPIO.output(self.dc, GPIO.HIGH)
            self.spi.writebytes(list(data))
        GPIO.output(self.cs, GPIO.HIGH)

    def _init_display(self):
        self._cmd(0x01)  # Software reset
        time.sleep(0.15)
        self._cmd(0x11)  # Sleep out
        time.sleep(0.15)

        # Pixel format: 16-bit RGB565
        self._cmd(0x3A, [0x55])

        # Memory access control: portrait, top-left origin
        # 0x48=normal, 0x88=180°. Flip if displays are mounted upside-down.
        madctl = int(os.environ.get('ILI9341_MADCTL', '0x88'), 16)
        self._cmd(0x36, [madctl])

        # Display on
        self._cmd(0x29)
        time.sleep(0.05)

    def set_window(self, x0, y0, x1, y1):
        self._cmd(0x2A, [x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF])  # Column
        self._cmd(0x2B, [y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF])  # Row

    def push_pixels(self, data):
        """Write raw RGB565 bytes to display RAM."""
        self.set_window(0, 0, SCREEN_W - 1, SCREEN_H - 1)

        GPIO.output(self.cs, GPIO.LOW)
        GPIO.output(self.dc, GPIO.LOW)
        self.spi.writebytes([0x2C])  # Memory write command
        GPIO.output(self.dc, GPIO.HIGH)

        # SPI transfer in chunks (spidev has a ~4096 byte limit)
        CHUNK = 4096
        mv = memoryview(data)
        for i in range(0, len(data), CHUNK):
            self.spi.writebytes2(mv[i:i + CHUNK])

        GPIO.output(self.cs, GPIO.HIGH)

    def clear(self):
        black = b'\x00\x00' * (SCREEN_W * SCREEN_H)
        self.push_pixels(black)


class StubDisplay:
    """No-op display for development without hardware."""
    def push_pixels(self, data): pass
    def clear(self): pass


# --- Image conversion ---

def rgb_to_565(img):
    """Convert PIL RGB image to big-endian RGB565 bytes for ILI9341."""
    arr = np.array(img, dtype=np.uint16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    # ILI9341 expects big-endian
    return rgb565.astype('>u2').tobytes()


# --- Main ---

def main():
    if HAS_HW:
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)

        # Single shared SPI bus — all CS toggled manually via GPIO
        spi = spidev.SpiDev()
        spi.open(0, 0)
        spi.max_speed_hz = SPI_SPEED
        spi.mode = 0
        spi.no_cs = True

        screens = [ILI9341(cfg, spi) for cfg in DISPLAYS]
        for s in screens:
            s.clear()
    else:
        screens = [StubDisplay() for _ in DISPLAYS]

    sys.stderr.write(f'triptych-render: {len(screens)} displays ready\n')
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stderr.write(f'json error: {e}\n')
            sys.stderr.flush()
            sys.stdout.write('K\n')
            sys.stdout.flush()
            continue

        path = cmd.get('path', '')
        screen = cmd.get('screen', 1)

        try:
            img = Image.open(path).convert('RGB')

            if screen == 'all':
                # Wide image: 720×320, slice into 3
                img = img.resize((720, 320))
                for i in range(3):
                    crop = img.crop((i * 240, 0, (i + 1) * 240, 320))
                    data = rgb_to_565(crop)
                    screens[i].push_pixels(data)
            else:
                idx = int(screen)
                if 0 <= idx < len(screens):
                    img = img.resize((SCREEN_W, SCREEN_H))
                    data = rgb_to_565(img)
                    screens[idx].push_pixels(data)

        except Exception as e:
            sys.stderr.write(f'render error: {e}\n')
            sys.stderr.flush()

        sys.stdout.write('K\n')
        sys.stdout.flush()

    # Cleanup
    if HAS_HW:
        for s in screens:
            s.clear()
        GPIO.cleanup()


if __name__ == '__main__':
    main()
