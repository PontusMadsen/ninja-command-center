import { execSync, spawn } from 'child_process';
import { readFileSync } from 'fs';
import logger from '../logger.js';

/**
 * Record audio for a fixed duration, normalize, reject silence.
 */
export async function recordAudio(durationSec = 4) {
  return new Promise((resolve, reject) => {
    logger.info({ duration: durationSec }, 'Recording...');

    const micDevice = process.env.MIC_DEVICE || 'plughw:sndrpigooglevoi,0';
    const direct = process.env.MIC_DIRECT === '1';
    const recArgs = direct
      ? ['-D', micDevice, '-f', 'S16_LE', '-r', '16000', '-c', '1', '-d', String(durationSec), '-t', 'wav', '-q', '/tmp/ninja_rec_raw.wav']
      : ['-D', micDevice, '-f', 'S32_LE', '-r', '48000', '-c', '2', '-d', String(durationSec), '-t', 'wav', '-q', '/tmp/ninja_rec_raw.wav'];
    const rec = spawn('arecord', recArgs);

    rec.on('close', (code) => {
      if (code !== 0 && code !== null) return reject(new Error(`arecord exit ${code}`));
      try {
        const soxCmd = direct
          ? 'sox /tmp/ninja_rec_raw.wav -r 16000 -c 1 -b 16 /tmp/ninja_rec.wav norm'
          : 'sox /tmp/ninja_rec_raw.wav -r 16000 -c 1 -b 16 /tmp/ninja_rec.wav remix 1 norm';
        execSync(soxCmd, { timeout: 10000 });
        const buf = readFileSync('/tmp/ninja_rec.wav');
        const rms = execSync("sox /tmp/ninja_rec.wav -n stat 2>&1 | grep 'RMS.*amplitude' | awk '{print $NF}'").toString().trim();
        const rmsVal = parseFloat(rms) || 0;
        logger.info({ size: buf.length, rms: rmsVal }, 'Recording done');
        if (rmsVal < 0.02) {
          logger.info('Too quiet, skipping');
          resolve(null);
          return;
        }
        resolve(buf);
      } catch (e) {
        reject(e);
      }
    });

    rec.on('error', reject);
  });
}
