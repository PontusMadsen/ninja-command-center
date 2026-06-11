#!/usr/bin/env python3
"""Triptych renderer — drives 3× ILI9341 displays from stdin commands.

Display 1 (left)   — SPI4 via spidev, DC=GPIO24
Display 2 (middle) — SPI0 via /dev/fb0 (DRM mipi-dbi)
Display 3 (right)  — SPI5 via spidev, DC=GPIO22

Protocol (stdin, one JSON line per command):
  {"screen": 0, "path": "/path/to/frame.jpg"}   — render to screen 0/1/2
  {"screen": "all", "path": "/path/to/wide.jpg"} — 720×320 across all 3

Acks each command with 'K\n' on stdout.
"""

import json
import os
import sys
import time

import numpy as np
from PIL import Image

SCREEN_W = 240
SCREEN_H = 320

# --- SPI display (for left + right) ---

try:
    import spidev
    import RPi.GPIO as GPIO
    HAS_HW = True
except ImportError:
    HAS_HW = False
    sys.stderr.write('spidev/GPIO not available — stub mode\n')
    sys.stderr.flush()


class ILI9341_SPI:
    """ILI9341 driven via spidev with manual DC pin."""

    def __init__(self, spi_bus, spi_dev, dc_pin, speed=32_000_000):
        self.dc_pin = dc_pin
        GPIO.setup(dc_pin, GPIO.OUT)

        self.spi = spidev.SpiDev()
        self.spi.open(spi_bus, spi_dev)
        self.spi.max_speed_hz = speed
        self.spi.mode = 0

        self._init_display()

    def _cmd(self, cmd, data=None):
        GPIO.output(self.dc_pin, GPIO.LOW)
        self.spi.writebytes2([cmd])
        if data:
            GPIO.output(self.dc_pin, GPIO.HIGH)
            self.spi.writebytes2(data)

    def _init_display(self):
        self._cmd(0x01); time.sleep(0.15)  # Software reset
        self._cmd(0x11); time.sleep(0.5)   # Sleep out
        self._cmd(0xCF, [0x00, 0xC1, 0x30])
        self._cmd(0xED, [0x64, 0x03, 0x12, 0x81])
        self._cmd(0xE8, [0x85, 0x00, 0x78])
        self._cmd(0xCB, [0x39, 0x2C, 0x00, 0x34, 0x02])
        self._cmd(0xF7, [0x20])
        self._cmd(0xEA, [0x00, 0x00])
        self._cmd(0xC0, [0x23])
        self._cmd(0xC1, [0x10])
        self._cmd(0xC5, [0x3E, 0x28])
        self._cmd(0xC7, [0x86])
        self._cmd(0x36, [0x88])   # MADCTL 180°
        self._cmd(0x3A, [0x55])   # 16-bit RGB565
        self._cmd(0xB1, [0x00, 0x18])
        self._cmd(0xB6, [0x08, 0x82, 0x27])
        self._cmd(0x29); time.sleep(0.05)  # Display on

    def push_frame(self, data):
        """Push 240×320 RGB565 big-endian frame data."""
        self._cmd(0x2A, [0x00, 0x00, 0x00, 0xEF])
        self._cmd(0x2B, [0x00, 0x00, 0x01, 0x3F])
        GPIO.output(self.dc_pin, GPIO.LOW)
        self.spi.writebytes2([0x2C])
        GPIO.output(self.dc_pin, GPIO.HIGH)
        self.spi.writebytes2(data)

    def clear(self):
        self.push_frame(b'\x00\x00' * (SCREEN_W * SCREEN_H))


class ILI9341_FB:
    """ILI9341 driven via /dev/fb0 (DRM mipi-dbi kernel driver)."""

    def __init__(self, fb_dev='/dev/fb0'):
        self.fb_dev = fb_dev
        self.fb = open(fb_dev, 'r+b')

    def push_frame(self, data):
        """Push 240×320 RGB565 little-endian frame data."""
        self.fb.seek(0)
        self.fb.write(data)
        self.fb.flush()

    def clear(self):
        self.push_frame(b'\x00\x00' * (SCREEN_W * SCREEN_H))


class StubDisplay:
    def push_frame(self, data): pass
    def clear(self): pass


# --- Image conversion ---

def rgb_to_565_be(img):
    """Convert PIL RGB image to big-endian RGB565 (for SPI displays)."""
    arr = np.array(img, dtype=np.uint16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    return rgb565.astype('>u2').tobytes()


def rgb_to_565_le(img):
    """Convert PIL RGB image to little-endian RGB565 (for framebuffer)."""
    arr = np.array(img, dtype=np.uint16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    return rgb565.astype('<u2').tobytes()


# --- Main ---

def main():
    if HAS_HW:
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)

        screens = [
            ILI9341_SPI(spi_bus=4, spi_dev=0, dc_pin=24),  # 0: left
            ILI9341_FB('/dev/fb0'),                          # 1: middle
            ILI9341_SPI(spi_bus=5, spi_dev=0, dc_pin=22),  # 2: right
        ]
        for s in screens:
            s.clear()
    else:
        screens = [StubDisplay() for _ in range(3)]

    # Converters per screen (SPI=big-endian, FB=little-endian)
    converters = [rgb_to_565_be, rgb_to_565_le, rgb_to_565_be]

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
                img = img.resize((720, 320))
                for i in range(3):
                    crop = img.crop((i * 240, 0, (i + 1) * 240, 320))
                    screens[i].push_frame(converters[i](crop))
            else:
                idx = int(screen)
                if 0 <= idx < len(screens):
                    w, h = img.size
                    if w > h:
                        img = img.transpose(Image.ROTATE_90)
                    img = img.resize((SCREEN_W, SCREEN_H))
                    screens[idx].push_frame(converters[idx](img))

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
