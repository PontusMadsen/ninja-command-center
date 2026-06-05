#!/usr/bin/env python3
"""
Wake word listener using openwakeword.
Outputs JSON to stdout when wake word detected.
Reads "pause"/"resume" commands from stdin to yield the mic during recording.

Supports two modes:
- MIC_DIRECT=1: file-based recording for ReSpeaker HAT (Zero)
- Default: pipe-based S32_LE 48kHz for INMP441 I2S (Pi 4)
"""
import sys
import os
import json
import subprocess
import time
import threading
import wave
import numpy as np
from openwakeword.model import Model

MIC_DEVICE = os.environ.get('MIC_DEVICE', 'plughw:sndrpigooglevoi,0')
MIC_DIRECT = os.environ.get('MIC_DIRECT', '')

SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280  # 80ms at 16kHz
THRESHOLD = 0.15
COOLDOWN_SEC = 10

def main():
    models_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'models')
    verifier = os.path.join(models_dir, 'hey_ninja_verifier')
    custom_model = os.path.join(models_dir, 'hey_cookie.onnx')

    # Use hey_ninja (hey_jarvis base + verifier) if available, else fall back to hey_cookie
    # Check for custom wake word model, or use hey_jarvis as "Hey Ninja" proxy
    wake_word = os.environ.get('WAKE_WORD', 'hey_cookie')
    wake_model = os.path.join(models_dir, f'{wake_word}.onnx')
    if not os.path.exists(wake_model):
        wake_model = custom_model  # fallback to hey_cookie
        wake_word = 'hey_cookie'

    sys.stderr.write(f"[WAKE] Loading {wake_word} model...\n")
    sys.stderr.flush()
    model = Model(wakeword_model_paths=[wake_model])
    target_model = wake_word
    threshold = THRESHOLD

    sys.stderr.write(f"[WAKE] Listening for '{wake_word}' (threshold: {threshold})\n")
    sys.stderr.flush()

    sys.stderr.write(f"[WAKE] Model loaded. Listening for wake word...\n")
    sys.stderr.flush()

    paused = False
    last_detection = 0

    def stdin_reader():
        nonlocal paused
        for line in sys.stdin:
            cmd = line.strip()
            if cmd == "pause":
                paused = True
                sys.stderr.write("[WAKE] Paused\n")
                sys.stderr.flush()
            elif cmd == "resume":
                model.reset()
                last_detection_local = time.time() + 5
                paused = False
                sys.stderr.write("[WAKE] Resumed (model reset, 5s grace)\n")
                sys.stderr.flush()

    t = threading.Thread(target=stdin_reader, daemon=True)
    t.start()

    while True:
        if paused:
            time.sleep(0.1)
            continue

        try:
            if MIC_DIRECT:
                # File-based: record 2s WAV, feed to model
                subprocess.run(
                    ['arecord', '-D', MIC_DEVICE, '-f', 'S16_LE', '-r', '16000',
                     '-c', '1', '-d', '2', '-q', '/tmp/wake_chunk.wav'],
                    timeout=5
                )
                if paused:
                    continue
                try:
                    wf = wave.open('/tmp/wake_chunk.wav', 'rb')
                    data = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
                    wf.close()
                except:
                    continue

                for i in range(0, len(data) - CHUNK_SAMPLES, CHUNK_SAMPLES):
                    model.predict(data[i:i+CHUNK_SAMPLES])
                    for name, scores in model.prediction_buffer.items():
                        if name != target_model: continue
                        score = scores[-1]
                        if score > threshold:
                            now = time.time()
                            if now - last_detection > COOLDOWN_SEC:
                                last_detection = now
                                model.reset()
                                result = {"event": "wakeword", "model": name, "score": round(float(score), 3)}
                                print(json.dumps(result), flush=True)

            else:
                # Pipe-based: S32_LE stereo 48kHz for INMP441
                proc = subprocess.Popen(
                    ['arecord', '-D', MIC_DEVICE, '-f', 'S32_LE', '-r', '48000',
                     '-c', '2', '-t', 'raw', '-q'],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
                )
                bytes_per_chunk = CHUNK_SAMPLES * 3 * 4 * 2

                while True:
                    if paused:
                        proc.kill()
                        proc.wait()
                        break

                    raw = proc.stdout.read(bytes_per_chunk)
                    if not raw or len(raw) < bytes_per_chunk:
                        break

                    samples_32 = np.frombuffer(raw, dtype=np.int32)
                    left = samples_32[0::2]
                    left_16k = left[::3]
                    left_16 = (left_16k >> 16).astype(np.int16)

                    model.predict(left_16)

                    for name, scores in model.prediction_buffer.items():
                        if name != target_model: continue
                        score = scores[-1]
                        if score > threshold:
                            now = time.time()
                            if now - last_detection > COOLDOWN_SEC:
                                last_detection = now
                                model.reset()
                                result = {"event": "wakeword", "model": name, "score": round(float(score), 3)}
                                print(json.dumps(result), flush=True)

                proc.kill()
                proc.wait()

        except Exception as e:
            sys.stderr.write(f"[WAKE] Error: {e}\n")
            sys.stderr.flush()
            time.sleep(1)

if __name__ == '__main__':
    main()
