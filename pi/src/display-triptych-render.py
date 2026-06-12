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
import threading
import urllib.request
import io
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
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PIXEL_FONT = os.path.join(_SCRIPT_DIR, '..', 'assets', 'fonts', 'lanapixel.ttf')
CJK_FONT = '/usr/share/fonts/truetype/dotgothic16/DotGothic16-Regular.ttf'
FALLBACK = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def _draw_text_with_fallback(draw, pos, text, fill, font, cjk_font):
    """Draw text, using CJK fallback font for characters the primary font can't render."""
    x, y = pos
    for char in text:
        try:
            bbox = draw.textbbox((0, 0), char, font=font)
            # If bbox width is 0 or char renders as tofu, use fallback
            w = bbox[2] - bbox[0]
            if w == 0 or (ord(char) > 0x2E80 and cjk_font):
                draw.text((x, y), char, fill=fill, font=cjk_font)
                bbox = draw.textbbox((0, 0), char, font=cjk_font)
                x += bbox[2] - bbox[0]
            else:
                draw.text((x, y), char, fill=fill, font=font)
                x += w
        except Exception:
            draw.text((x, y), char, fill=fill, font=font)
            bbox = draw.textbbox((0, 0), char, font=font)
            x += bbox[2] - bbox[0]
try:
    FONT_BIG = ImageFont.truetype(PIXEL_FONT, 64)
    FONT_TIME = ImageFont.truetype(PIXEL_FONT, 168)
    FONT_TRACK = ImageFont.truetype(PIXEL_FONT, 50)
    FONT_MED = ImageFont.truetype(PIXEL_FONT, 32)
    FONT_SMALL = ImageFont.truetype(PIXEL_FONT, 32)
    FONT_LABEL = ImageFont.truetype(PIXEL_FONT, 24)
    FONT_CJK_MED = ImageFont.truetype(CJK_FONT, 18)
    FONT_CJK_SMALL = ImageFont.truetype(CJK_FONT, 14)
except Exception:
    FONT_BIG = ImageFont.truetype(FALLBACK, 48)
    FONT_TIME = ImageFont.truetype(FALLBACK, 140)
    FONT_TRACK = ImageFont.truetype(FALLBACK, 30)
    FONT_MED = ImageFont.truetype(FALLBACK, 24)
    FONT_SMALL = ImageFont.truetype(FALLBACK, 16)
    FONT_LABEL = ImageFont.truetype(FALLBACK, 12)
    FONT_CJK_MED = ImageFont.truetype(CJK_FONT, 28) if os.path.exists(CJK_FONT) else FONT_MED
    FONT_CJK_SMALL = ImageFont.truetype(CJK_FONT, 22) if os.path.exists(CJK_FONT) else FONT_SMALL


# Pre-load clock icon
_clock_icon = None

def _load_clock_icon():
    global _clock_icon
    if _clock_icon:
        return _clock_icon
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'icons', 'clock.png')
    try:
        _clock_icon = Image.open(path).convert('RGBA')
    except Exception:
        pass
    return _clock_icon


def render_clock(local_tz_name, remote_tz_name, remote_label):
    """Generate a 240×320 clock screen image."""
    fg = (210, 200, 150)        # nicotine eggshell
    canvas = Image.new('RGB', (SCREEN_W, SCREEN_H), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    margin = 15

    local_tz = ZoneInfo(local_tz_name)
    remote_tz = ZoneInfo(remote_tz_name)
    now = datetime.now(local_tz)
    remote_now = datetime.now(remote_tz)

    # Header: clock icon + date (same layout as spotify header)
    header_y = 15
    date_str = now.strftime('%A %d, %B')
    icon = _load_clock_icon()
    label_bbox = draw.textbbox((0, 0), date_str, font=FONT_LABEL)
    label_h = label_bbox[3] - label_bbox[1]
    if icon:
        icon_h = icon.size[1]
        row_h = max(icon_h, label_h)
        icon_y = header_y + (row_h - icon_h) // 2
        label_y = header_y + (row_h - label_h) // 2
        canvas.paste(icon, (margin, icon_y), icon)
        draw.text((margin + icon.size[0] + 6, label_y), date_str, fill=fg, font=FONT_LABEL)
    else:
        draw.text((margin, header_y), date_str, fill=fg, font=FONT_LABEL)

    # Local time — massive, fill width
    time_str = now.strftime('%H:%M')
    draw.text((margin, 57), time_str, fill=fg, font=FONT_TIME)

    # Remote section — bottom, same size for both lines, tight line height
    # Bottom section — align to same baseline as spotify icons (SCREEN_H - margin - 24)
    bottom_y = SCREEN_H - margin - 24
    remote_time_str = "it's " + remote_now.strftime('%H:%M')
    draw.text((margin, bottom_y), remote_time_str, fill=fg, font=FONT_SMALL)

    remote_label_text = f'And in {remote_label}'
    draw.text((margin, bottom_y - 30), remote_label_text, fill=fg, font=FONT_SMALL)



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
    fg = (210, 200, 150)        # warm off-white, nicotine eggshell
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
    if len(track_text) > 37:
        track_text = track_text[:36] + '...'
    lines = _wrap_text(track_text, FONT_TRACK, SCREEN_W - margin * 2, draw)
    y = 55
    line_h = 38
    for line in lines[:4]:
        draw.text((margin, y), line, fill=fg, font=FONT_TRACK)
        y += line_h

    # ── Artist — fixed spacing below track, word-wrapped ──
    y += spacing
    artist_text = artist or ''
    if len(artist_text) > 21:
        artist_text = artist_text[:20] + '...'
    draw.text((margin, y), artist_text, fill=fg, font=FONT_SMALL)
    y += 28

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
        # Horizontal align: side by side. Vertical: center both, align bottom to ninja
        pair_h = max(tape.size[1], bars.size[1])
        bars_x = SCREEN_W - margin - bars.size[0]
        tape_x = bars_x - 6 - tape.size[0]
        center_y = bottom_baseline - pair_h // 2
        canvas.paste(tape, (tape_x, center_y - tape.size[1] // 2), tape)
        canvas.paste(bars, (bars_x, center_y - bars.size[1] // 2), bars)
    elif tape:
        canvas.paste(tape, (SCREEN_W - margin - tape.size[0], bottom_baseline - tape.size[1]), tape)

    return canvas

    return canvas


# --- Ninja says renderer ---

_ninja_icon = None

def _load_ninja_icon():
    global _ninja_icon
    if _ninja_icon:
        return _ninja_icon
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'icons', 'ninja-face.png')
    try:
        _ninja_icon = Image.open(path).convert('RGBA')
    except Exception:
        pass
    return _ninja_icon


def render_ninja_says(text):
    """Generate a 240×320 'Ninja says' screen."""
    fg = (210, 200, 150)
    canvas = Image.new('RGB', (SCREEN_W, SCREEN_H), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    margin = 15

    # Header: ninja icon + "Ninja says!"
    header_y = 15
    icon = _load_ninja_icon()
    label = 'Ninja says!'
    label_bbox = draw.textbbox((0, 0), label, font=FONT_LABEL)
    label_h = label_bbox[3] - label_bbox[1]
    if icon:
        icon_h = icon.size[1]
        row_h = max(icon_h, label_h)
        canvas.paste(icon, (margin, header_y + (row_h - icon_h) // 2), icon)
        draw.text((margin + icon.size[0] + 6, header_y + (row_h - label_h) // 2), label, fill=fg, font=FONT_LABEL)
    else:
        draw.text((margin, header_y), label, fill=fg, font=FONT_LABEL)

    # Text — medium, word-wrapped, with CJK fallback
    lines = _wrap_text(text or '', FONT_MED, SCREEN_W - margin * 2, draw)
    y = 65
    line_h = 30
    for line in lines[:8]:
        _draw_text_with_fallback(draw, (margin, y), line, fg, FONT_MED, FONT_CJK_MED)
        y += line_h

    return canvas


# --- Todo renderer ---

_todo_icon = None

def _load_todo_icon():
    global _todo_icon
    if _todo_icon:
        return _todo_icon
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'icons', 'list.png')
    try:
        _todo_icon = Image.open(path).convert('RGBA')
    except Exception:
        pass
    return _todo_icon


def render_todo(tasks, total):
    """Generate a 240×320 todo list screen."""
    fg = (210, 200, 150)
    dim = (120, 115, 85)
    canvas = Image.new('RGB', (SCREEN_W, SCREEN_H), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    margin = 15

    # Header: list icon + "Todo!"
    header_y = 15
    icon = _load_todo_icon()
    label = 'Todo!'
    label_bbox = draw.textbbox((0, 0), label, font=FONT_LABEL)
    label_h = label_bbox[3] - label_bbox[1]
    if icon:
        icon_h = icon.size[1]
        row_h = max(icon_h, label_h)
        canvas.paste(icon, (margin, header_y + (row_h - icon_h) // 2), icon)
        draw.text((margin + icon.size[0] + 6, header_y + (row_h - label_h) // 2), label, fill=fg, font=FONT_LABEL)
    else:
        draw.text((margin, header_y), label, fill=fg, font=FONT_LABEL)

    # Task list
    y = 65
    box_size = 14
    item_spacing = 16
    max_items = 5
    shown = 0

    for task_text in tasks[:max_items]:
        # Task text — wrap if needed
        text_x = margin + box_size + 10
        max_w = SCREEN_W - text_x - margin
        lines = _wrap_text(task_text, FONT_LABEL, max_w, draw)

        # Checkbox — vertically centered with first line of text
        text_bbox = draw.textbbox((0, 0), lines[0], font=FONT_LABEL)
        text_h = text_bbox[3] - text_bbox[1]
        box_y = y + (text_h - box_size) // 2
        draw.rectangle([margin, box_y, margin + box_size, box_y + box_size], outline=fg, width=2)

        for line in lines[:2]:
            draw.text((text_x, y), line, fill=fg, font=FONT_LABEL)
            y += 20
        y += item_spacing
        shown += 1

    # "+ N more" at bottom right
    remaining = total - shown
    if remaining > 0:
        more_text = f'+ {remaining} more'
        bbox = draw.textbbox((0, 0), more_text, font=FONT_LABEL)
        tw = bbox[2] - bbox[0]
        draw.text((SCREEN_W - margin - tw, SCREEN_H - margin - 24), more_text, fill=dim, font=FONT_LABEL)

    return canvas


# --- GIF renderer (background loop) ---

_gif_threads = {}  # screen_idx → thread
_gif_stop = {}     # screen_idx → Event


def _gif_loop(screen_idx, frames, delays, screens, converter):
    """Loop GIF frames on a screen until stopped."""
    stop_event = _gif_stop[screen_idx]
    while not stop_event.is_set():
        for frame, delay in zip(frames, delays):
            if stop_event.is_set():
                break
            screens[screen_idx].push_frame(converter(frame))
            stop_event.wait(delay / 1000.0)


def stop_gif(screen_idx):
    """Stop any running GIF loop on a screen."""
    if screen_idx in _gif_stop:
        _gif_stop[screen_idx].set()
    if screen_idx in _gif_threads:
        _gif_threads[screen_idx].join(timeout=2)
        del _gif_threads[screen_idx]
        del _gif_stop[screen_idx]


def start_gif(screen_idx, url, screens, converter):
    """Download GIF, extract frames, start looping."""
    stop_gif(screen_idx)

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NinjaCommandCenter/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            gif = Image.open(io.BytesIO(resp.read()))
    except Exception as e:
        sys.stderr.write(f'gif download error: {e}\n')
        sys.stderr.flush()
        return

    frames = []
    delays = []
    try:
        while True:
            frame = gif.copy().convert('RGB').resize((SCREEN_W, SCREEN_H))
            frames.append(frame)
            delays.append(gif.info.get('duration', 100))
            gif.seek(gif.tell() + 1)
    except EOFError:
        pass

    if not frames:
        return

    sys.stderr.write(f'gif: {len(frames)} frames from {url[:60]}\n')
    sys.stderr.flush()

    _gif_stop[screen_idx] = threading.Event()
    t = threading.Thread(target=_gif_loop, args=(screen_idx, frames, delays, screens, converter), daemon=True)
    _gif_threads[screen_idx] = t
    t.start()


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
            if cmd_type == 'ninja_says':
                img = render_ninja_says(cmd.get('text', ''))
                idx = int(screen)
                if 0 <= idx < len(screens):
                    stop_gif(idx)
                    screens[idx].push_frame(converters[idx](img))
            elif cmd_type == 'todo':
                img = render_todo(
                    cmd.get('tasks', []),
                    cmd.get('total', 0),
                )
                idx = int(screen)
                if 0 <= idx < len(screens):
                    screens[idx].push_frame(converters[idx](img))
            elif cmd_type == 'gif':
                idx = int(screen)
                if 0 <= idx < len(screens):
                    start_gif(idx, cmd.get('url', ''), screens, converters[idx])
            elif cmd_type == 'spotify':
                stop_gif(int(screen))
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
                stop_gif(int(screen))
                img = render_clock(
                    cmd.get('local_tz', 'Asia/Tokyo'),
                    cmd.get('remote_tz', 'Europe/Stockholm'),
                    cmd.get('remote_label', 'Sweden'),
                )
                idx = int(screen)
                if 0 <= idx < len(screens):
                    screens[idx].push_frame(converters[idx](img))
            elif path:
                stop_gif(int(screen) if screen != 'all' else -1)
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
