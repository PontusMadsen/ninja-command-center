#!/usr/bin/env python3
"""
Convert face GIF animations to individual JPEG frames for the PiTFT display.
Usage: python3 convert-gifs.py /path/to/gifs /path/to/frames

Each GIF becomes a folder of numbered JPEG frames:
  angry.gif -> frames/angry/000.jpg, 001.jpg, ...

Frames are scaled to 320x240 (PiTFT resolution) with black letterboxing
to maintain aspect ratio.
"""
import sys
import os
from PIL import Image

TARGET_W, TARGET_H = 320, 240

def convert_gif(gif_path, output_dir):
    name = os.path.splitext(os.path.basename(gif_path))[0]
    out = os.path.join(output_dir, name)
    os.makedirs(out, exist_ok=True)

    img = Image.open(gif_path)
    frame_idx = 0

    while True:
        # Convert to RGBA to handle transparency, then composite on black
        frame = img.convert('RGBA')
        bg = Image.new('RGBA', frame.size, (0, 0, 0, 255))
        composite = Image.alpha_composite(bg, frame).convert('RGB')

        # Scale to fit 320x240 maintaining aspect ratio
        src_w, src_h = composite.size
        scale = min(TARGET_W / src_w, TARGET_H / src_h)
        new_w = int(src_w * scale)
        new_h = int(src_h * scale)
        scaled = composite.resize((new_w, new_h), Image.LANCZOS)

        # Center on black canvas
        canvas = Image.new('RGB', (TARGET_W, TARGET_H), (0, 0, 0))
        x = (TARGET_W - new_w) // 2
        y = (TARGET_H - new_h) // 2
        canvas.paste(scaled, (x, y))

        # Save as JPEG
        out_path = os.path.join(out, f'{frame_idx:03d}.jpg')
        canvas.save(out_path, 'JPEG', quality=90)
        frame_idx += 1

        try:
            img.seek(img.tell() + 1)
        except EOFError:
            break

    return frame_idx

def main():
    if len(sys.argv) != 3:
        print(f'Usage: {sys.argv[0]} <gif_dir> <output_dir>')
        sys.exit(1)

    gif_dir = sys.argv[1]
    output_dir = sys.argv[2]

    gifs = sorted(f for f in os.listdir(gif_dir) if f.endswith('.gif'))
    print(f'Converting {len(gifs)} GIF animations to JPEG frames...')
    print(f'Target: {TARGET_W}x{TARGET_H}\n')

    total = 0
    for gif in gifs:
        path = os.path.join(gif_dir, gif)
        count = convert_gif(path, output_dir)
        name = os.path.splitext(gif)[0]
        print(f'  {name}: {count} frames')
        total += count

    print(f'\nDone! {total} total frames in {output_dir}/')

if __name__ == '__main__':
    main()
