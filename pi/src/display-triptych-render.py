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
from datetime import datetime

import numpy as np
from PIL import Image, ImageDraw, ImageFont

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
        self._cmd(0x36, [0x88])   # MADCTL portrait 180°
        self._cmd(0x3A, [0x55])   # 16-bit RGB565
        self._cmd(0xB1, [0x00, 0x18])
        self._cmd(0xB6, [0x08, 0x82, 0x27])
        self._cmd(0x29); time.sleep(0.05)  # Display on

    def push_frame(self, data):
        """Push 320×240 RGB565 big-endian frame data."""
        self._cmd(0x2A, [0x00, 0x00, 0x00, 0xEF])  # cols 0-239
        self._cmd(0x2B, [0x00, 0x00, 0x01, 0x3F])  # rows 0-319
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
        """Push 320×240 RGB565 little-endian frame data."""
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


# --- Clock renderer ---

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

# Pre-load fonts
PIXEL_FONT = '/usr/share/fonts/truetype/pressstart2p/PressStart2P-Regular.ttf'
FALLBACK = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
try:
    FONT_BIG = ImageFont.truetype(PIXEL_FONT, 32)
    FONT_TRACK = ImageFont.truetype(PIXEL_FONT, 21)
    FONT_MED = ImageFont.truetype(PIXEL_FONT, 14)
    FONT_SMALL = ImageFont.truetype(PIXEL_FONT, 10)
    FONT_LABEL = ImageFont.truetype(PIXEL_FONT, 8)
except Exception:
    FONT_BIG = ImageFont.truetype(FALLBACK, 48)
    FONT_TRACK = ImageFont.truetype(FALLBACK, 30)
    FONT_MED = ImageFont.truetype(FALLBACK, 24)
    FONT_SMALL = ImageFont.truetype(FALLBACK, 16)
    FONT_LABEL = ImageFont.truetype(FALLBACK, 12)


def render_clock(local_tz_name, remote_tz_name, remote_label):
    """Generate a 240×320 clock screen image."""
    canvas = Image.new('RGB', (SCREEN_W, SCREEN_H), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    local_tz = ZoneInfo(local_tz_name)
    remote_tz = ZoneInfo(remote_tz_name)
    now = datetime.now(local_tz)
    remote_now = datetime.now(remote_tz)

    # Local time — big, centered
    time_str = now.strftime('%H:%M')
    bbox = draw.textbbox((0, 0), time_str, font=FONT_BIG)
    tw = bbox[2] - bbox[0]
    draw.text(((SCREEN_W - tw) // 2, 60), time_str, fill=(255, 255, 255), font=FONT_BIG)

    # Date
    date_str = now.strftime('%a %d %b')
    bbox = draw.textbbox((0, 0), date_str, font=FONT_MED)
    tw = bbox[2] - bbox[0]
    draw.text(((SCREEN_W - tw) // 2, 140), date_str, fill=(180, 180, 180), font=FONT_MED)

    # Divider line
    draw.line([(40, 200), (SCREEN_W - 40, 200)], fill=(60, 60, 60), width=1)

    # Remote time
    remote_time_str = remote_now.strftime('%H:%M')
    bbox = draw.textbbox((0, 0), remote_time_str, font=FONT_MED)
    tw = bbox[2] - bbox[0]
    draw.text(((SCREEN_W - tw) // 2, 225), remote_time_str, fill=(100, 160, 255), font=FONT_MED)

    # Remote label
    bbox = draw.textbbox((0, 0), remote_label, font=FONT_LABEL)
    tw = bbox[2] - bbox[0]
    draw.text(((SCREEN_W - tw) // 2, 265), remote_label, fill=(80, 80, 80), font=FONT_LABEL)

    return canvas


# --- Spotify renderer ---

_spotify_icons = {}

def _load_spotify_icons():
    global _spotify_icons
    if _spotify_icons:
        return _spotify_icons
    icons_dir = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
    for name in ['spotify-icon', 'ninja-headphones', 'tape', 'audi-bars']:
        path = os.path.join(icons_dir, f'{name}.png')
        try:
            _spotify_icons[name] = Image.open(path).convert('RGBA')
        except Exception:
            pass
    return _spotify_icons


def _wrap_text(text, font, max_width, draw):
    """Word-wrap text to fit within max_width."""
    words = text.split(' ')
    lines = []
    current = ''
    for word in words:
        test = f'{current} {word}'.strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(current)
            current = word
        else:
            current = test
    if current:
        lines.append(current)
    return lines


def render_spotify(track, artist, album, album_art_url, progress_ms, duration_ms, track_id):
    """Generate a 240×320 Spotify now-playing screen."""
    bg = (0, 0, 0)              # black — backlight makes gray too bright
    fg = (225, 224, 216)        # #e1e0d8
    bar_bg = (80, 80, 75)

    canvas = Image.new('RGB', (SCREEN_W, SCREEN_H), bg)
    draw = ImageDraw.Draw(canvas)
    icons = _load_spotify_icons()
    margin = 15
    spacing = 12

    # ── Header: spotify icon + "Now playing" (vertically centered) ──
    header_y = 15
    icon = icons.get('spotify-icon')
    label_text = 'Now playing'
    label_bbox = draw.textbbox((0, 0), label_text, font=FONT_LABEL)
    label_h = label_bbox[3] - label_bbox[1]
    if icon:
        icon_h = icon.size[1]
        row_h = max(icon_h, label_h)
        icon_y = header_y + (row_h - icon_h) // 2
        label_y = header_y + (row_h - label_h) // 2
        canvas.paste(icon, (margin, icon_y), icon)
        draw.text((margin + icon.size[0] + 6, label_y), label_text, fill=fg, font=FONT_LABEL)
    else:
        draw.text((margin, header_y), label_text, fill=fg, font=FONT_LABEL)

    # ── Track name — big, word-wrapped ──
    track_text = track or ''
    lines = _wrap_text(track_text, FONT_TRACK, SCREEN_W - margin * 2, draw)
    y = 80
    line_h = 28
    for line in lines[:4]:
        draw.text((margin, y), line, fill=fg, font=FONT_TRACK)
        y += line_h

    # ── Artist — fixed spacing below track, word-wrapped ──
    y += spacing
    artist_text = artist or ''
    artist_lines = _wrap_text(artist_text, FONT_SMALL, SCREEN_W - margin * 2, draw)
    for line in artist_lines[:3]:
        draw.text((margin, y), line, fill=fg, font=FONT_SMALL)
        y += 18

    # ── Progress bar — fixed spacing below artist ──
    y += spacing
    if duration_ms and duration_ms > 0:
        progress = min(progress_ms / duration_ms, 1.0)
        bar_w = SCREEN_W - margin * 2
        bar_h = 8
        draw.rectangle([margin, y, margin + bar_w, y + bar_h], fill=bar_bg)
        draw.rectangle([margin, y, margin + int(bar_w * progress), y + bar_h], fill=fg)

    # ── Bottom icons: ninja-headphones (left), tape + audi-bars (right) ──
    # All icons align bottom to same baseline
    bottom_baseline = SCREEN_H - margin
    ninja = icons.get('ninja-headphones')
    if ninja:
        canvas.paste(ninja, (margin, bottom_baseline - ninja.size[1]), ninja)

    tape = icons.get('tape')
    bars = icons.get('audi-bars')
    if tape and bars:
        bars_x = SCREEN_W - margin - bars.size[0]
        tape_x = bars_x - 6 - tape.size[0]
        canvas.paste(tape, (tape_x, bottom_baseline - tape.size[1]), tape)
        canvas.paste(bars, (bars_x, bottom_baseline - bars.size[1]), bars)
    elif tape:
        canvas.paste(tape, (SCREEN_W - margin - tape.size[0], bottom_baseline - tape.size[1]), tape)

    return canvas

    return canvas


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
        cmd_type = cmd.get('type', 'image')

        try:
            if cmd_type == 'spotify':
                img = render_spotify(
                    cmd.get('track', ''),
                    cmd.get('artist', ''),
                    cmd.get('album', ''),
                    cmd.get('album_art_url', ''),
                    cmd.get('progress_ms', 0),
                    cmd.get('duration_ms', 0),
                    cmd.get('track_id', ''),
                )
                idx = int(screen)
                if 0 <= idx < len(screens):
                    screens[idx].push_frame(converters[idx](img))
            elif cmd_type == 'clock':
                img = render_clock(
                    cmd.get('local_tz', 'Asia/Tokyo'),
                    cmd.get('remote_tz', 'Europe/Stockholm'),
                    cmd.get('remote_label', 'Sweden'),
                )
                idx = int(screen)
                if 0 <= idx < len(screens):
                    screens[idx].push_frame(converters[idx](img))
            elif path:
                img = Image.open(path).convert('RGB')
                if screen == 'all':
                    img = img.resize((720, 320))
                    for i in range(3):
                        crop = img.crop((i * 240, 0, (i + 1) * 240, 320))
                        screens[i].push_frame(converters[i](crop))
                else:
                    idx = int(screen)
                    if 0 <= idx < len(screens):
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
