import { spawn } from 'child_process';
import logger from '../logger.js';

/**
 * Play a WAV file through the speaker via aplay.
 */
export async function playFile(filePath, device = 'plughw:0,0') {
  return new Promise((resolve, reject) => {
    const player = spawn('aplay', ['-D', device, filePath]);
    player.on('close', (code) => {
      if (code !== 0) logger.warn({ code }, 'aplay exit non-zero');
      resolve();
    });
    player.on('error', reject);
  });
}

/**
 * Speak text using espeak-ng directly.
 */
export async function speakText(text, device = 'plughw:0,0') {
  return new Promise((resolve, reject) => {
    logger.info({ text: text.substring(0, 50) }, 'Speaking...');
    const espeak = spawn('espeak-ng', [
      '-v', 'en', '-s', '150', '-a', '100',
      '--stdout', text
    ]);
    const aplay = spawn('aplay', ['-D', device]);
    espeak.stdout.pipe(aplay.stdin);
    espeak.on('error', reject);
    aplay.on('error', reject);
    aplay.on('close', () => resolve());
  });
}
