#!/usr/bin/env python3
"""Triple-tap on PiTFT to shutdown the Pi."""
import struct
import time
import os
import subprocess

# Find the stmpe-ts touch input device
TOUCH_DEV = None
for i in range(10):
    try:
        with open(f'/sys/class/input/event{i}/device/name') as f:
            if 'stmpe' in f.read():
                TOUCH_DEV = f'/dev/input/event{i}'
                break
    except:
        continue

if not TOUCH_DEV:
    print('[TOUCH] No stmpe touch device found, exiting')
    exit(1)

print(f'[TOUCH] Listening for triple-tap on {TOUCH_DEV}')

# evdev event struct: time_sec, time_usec, type, code, value
EVENT_SIZE = struct.calcsize('llHHI')
EV_KEY = 0x01
BTN_TOUCH = 330

taps = []
TAP_WINDOW = 1.5  # seconds to get 3 taps in

with open(TOUCH_DEV, 'rb') as f:
    while True:
        data = f.read(EVENT_SIZE)
        if not data:
            continue
        _, _, ev_type, code, value = struct.unpack('llHHI', data)

        # BTN_TOUCH press (value=1)
        if ev_type == EV_KEY and code == BTN_TOUCH and value == 1:
            now = time.time()
            taps.append(now)
            # Keep only taps within window
            taps = [t for t in taps if now - t < TAP_WINDOW]

            if len(taps) >= 3:
                print('[TOUCH] Triple-tap detected — shutting down!')
                subprocess.run(['sudo', 'shutdown', '-h', 'now'])
                break
