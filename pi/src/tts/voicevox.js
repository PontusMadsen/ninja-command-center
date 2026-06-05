import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __ttsdir = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(__ttsdir, '../../google-tts-key.json');
const TTS_CONFIG = join(__ttsdir, '../../data/tts-config.json');

// Default settings — overridden by tts-config.json
const DEFAULTS = { voice: 'ja-JP-Standard-D', speakingRate: 1.1 };

function getTTSConfig() {
  try {
    const cfg = JSON.parse(readFileSync(TTS_CONFIG, 'utf-8'));
    return { ...DEFAULTS, ...cfg };
  } catch {
    return DEFAULTS;
  }
}

// Piper fallback
const HOME = process.env.HOME || '/home/ninja';
const PIPER_BIN = `${HOME}/.local/bin/piper`;
const PIPER_MODEL = `${HOME}/.local/share/piper/en_US-lessac-medium.onnx`;

// Cache token for 50 minutes (expires at 60)
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const key = JSON.parse(readFileSync(KEY_FILE, 'utf-8'));

  // Create JWT
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(key.private_key, 'base64url');

  const jwt = `${header}.${payload}.${signature}`;

  // Exchange JWT for access token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 50 * 60 * 1000; // cache for 50 min
  return cachedToken;
}

/**
 * Synthesize text via Google Cloud TTS (Japanese voice speaking English).
 * Falls back to Piper if Google fails.
 */
export async function synthesize(text) {
  if (!text) return null;

  const clean = text
    .replace(/[*_`#]/g, '')
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/\b(huh|hmm+|uh|eh|meh|pff+)\b/gi, '')
    .trim();
  if (!clean) return null;

  // Try Google Cloud TTS
  try {
    const startTime = Date.now();
    const token = await getAccessToken();

    const cfg = getTTSConfig();
    const body = {
      input: { text: clean },
      voice: {
        languageCode: 'ja-JP',
        name: cfg.voice,
      },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 24000,
        speakingRate: cfg.speakingRate,
      },
    };

    const resp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Google TTS ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    const audioBuffer = Buffer.from(data.audioContent, 'base64');
    writeFileSync('/tmp/ninja_tts.wav', audioBuffer);

    const duration = Date.now() - startTime;
    logger.info({ duration, engine: 'google', voice: cfg.voice }, 'TTS done');
    return '/tmp/ninja_tts.wav';
  } catch (e) {
    logger.warn({ err: e.message }, 'Google TTS failed, falling back to Piper');
  }

  // Fallback: Piper
  try {
    const escaped = clean.replace(/"/g, '\\"');
    execSync(
      `echo "${escaped}" | ${PIPER_BIN} --model ${PIPER_MODEL} --output_file /tmp/ninja_tts.wav 2>/dev/null`,
      { timeout: 30000 }
    );
    logger.info({ engine: 'piper' }, 'TTS done (fallback)');
    return '/tmp/ninja_tts.wav';
  } catch (e) {
    logger.error({ err: e.message }, 'TTS failed completely');
    return null;
  }
}
