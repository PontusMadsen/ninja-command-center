import { spawn } from 'child_process';
import { existsSync } from 'fs';
import logger from '../logger.js';
import { synthesize } from '../tts/voicevox.js';

const PHRASES = [
  'えええええっと',
];

let pregenerated = []; // file paths to pre-rendered WAVs

/**
 * Pre-generate stock phrases with Google TTS at startup.
 * Call once after service starts.
 */
export async function preloadStockPhrases() {
  logger.info('Pre-generating stock phrases...');
  for (let i = 0; i < PHRASES.length; i++) {
    try {
      const path = await synthesize(PHRASES[i]);
      if (path) {
        // Copy to a permanent location so TTS can reuse /tmp/ninja_tts.wav
        const dest = `/tmp/ninja_stock_${i}.wav`;
        const { execSync } = await import('child_process');
        execSync(`cp ${path} ${dest}`);
        pregenerated.push(dest);
      }
    } catch (e) {
      logger.warn({ phrase: PHRASES[i], err: e.message }, 'Failed to pre-generate phrase');
    }
  }
  logger.info({ count: pregenerated.length }, 'Stock phrases ready');
}

export function playStockPhrase(device = 'plughw:0,0') {
  if (pregenerated.length === 0) return;

  const path = pregenerated[Math.floor(Math.random() * pregenerated.length)];
  if (!existsSync(path)) return;

  logger.debug({ path }, 'Stock phrase');
  const player = spawn('aplay', ['-D', device, path]);
  player.on('error', () => {});
}
