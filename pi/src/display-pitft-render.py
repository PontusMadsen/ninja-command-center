#!/usr/bin/env python3
"""PiTFT framebuffer renderer for Little Gamers Ninja.

Long-running process that reads JPEG file paths from stdin (one per line),
renders each to /dev/fb1 via pygame, and writes 'K\\n' to stdout as ack.

Designed for Adafruit 2.8" PiTFT (320x240, ILI9341, SPI).
"""

import os
import sys
import pygame

# Force SDL to use the PiTFT framebuffer
os.environ['SDL_FBDEV'] = '/dev/fb1'
os.environ['SDL_VIDEODRIVER'] = 'fbcon'

SCREEN_W = 320
SCREEN_H = 240


def main():
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_W, SCREEN_H))
    pygame.mouse.set_visible(False)

    # Fill black on startup
    screen.fill((0, 0, 0))
    pygame.display.flip()

    # Flush stdout after every write so Node.js gets acks immediately
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue

        try:
            img = pygame.image.load(path)
            img = pygame.transform.scale(img, (SCREEN_W, SCREEN_H))
            screen.blit(img, (0, 0))
            pygame.display.flip()
        except Exception as e:
            # Skip bad frames but keep running
            sys.stderr.write(f'render error: {e}\n')
            sys.stderr.flush()

        # Ack — one frame rendered
        sys.stdout.write('K\n')
        sys.stdout.flush()

    pygame.quit()


if __name__ == '__main__':
    main()
