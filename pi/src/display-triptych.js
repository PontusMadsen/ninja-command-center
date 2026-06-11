/**
 * Triptych display driver — 3× ILI9341 SPI displays.
 *
 * Spawns display-triptych-render.py, sends JSON commands over stdin.
 * Screen 0 = left (clock), 1 = middle (ninja face), 2 = right (info).
 *
 * Exports the same API as display-pitft.js:
 *   { init, setFace, playOnce, buzz, close }
 *
 * Additionally exports for multi-screen control:
 *   { sendToScreen, sendToAll }
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = join(__dirname, '..', 'frames-pitft');

const FACE_MAP = {
  idle: 'this_is_default', happy: 'smile', sad: 'cry', angry: 'angry',
  surprised: 'hihi', sleeping: 'sleeping', confused: 'dizzy',
  focused: 'squint', scared: 'scared', talking: 'talking',
  love: 'love', wow: 'wow', yell: 'yell', devil: 'devil_1',
  please: 'please', blink: 'blink', sleepy: 'sleepy_1',
  hehe: 'hehe', fumin: 'fumin', tounge: 'tounge',
};

// Middle screen = ninja face
const NINJA_SCREEN = 1;

let py = null;
let rl = null;
let ackResolve = null;
let loopTimer = null;
let loopFrames = [];
let loopIdx = 0;
let sending = false;
let playingOnce = false;
let pendingFace = null;

const FRAME_DELAY_MS = 60;

// ── helpers ──────────────────────────────────────────────────────────

function loadFrames(animName) {
  const dir = join(FRAMES_DIR, animName);
  try {
    const files = readdirSync(dir)
      .filter(f => /\.(jpg|jpeg)$/i.test(f))
      .sort();
    return files.map(f => join(dir, f));
  } catch (e) {
    logger.warn({ dir, err: e.message }, 'Cannot read frames dir');
    return [];
  }
}

function sendCommand(cmd) {
  return new Promise((resolve) => {
    if (!py || py.killed) { resolve(); return; }
    ackResolve = resolve;
    py.stdin.write(JSON.stringify(cmd) + '\n');
  });
}

function sendFrame(framePath, screen = NINJA_SCREEN) {
  return sendCommand({ screen, path: framePath });
}

function onAck(line) {
  if (line.trim() === 'K' && ackResolve) {
    const r = ackResolve;
    ackResolve = null;
    r();
  }
}

function stopLoop() {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  loopFrames = [];
  loopIdx = 0;
}

async function tickLoop() {
  if (loopFrames.length === 0) return;
  if (sending) return;

  sending = true;
  const t0 = Date.now();
  try {
    await sendFrame(loopFrames[loopIdx], NINJA_SCREEN);
    loopIdx = (loopIdx + 1) % loopFrames.length;
  } catch (e) {
    logger.warn({ err: e.message }, 'Frame send failed');
  }
  const elapsed = Date.now() - t0;
  const wait = Math.max(FRAME_DELAY_MS - elapsed, 10);
  sending = false;

  if (loopFrames.length > 0) {
    loopTimer = setTimeout(tickLoop, wait);
  }
}

function startLoop(animName) {
  stopLoop();
  const frames = loadFrames(animName);
  if (frames.length === 0) {
    logger.warn({ animName }, 'No frames found');
    return;
  }
  loopFrames = frames;
  loopIdx = 0;
  tickLoop();
}

function currentAnim() {
  if (loopFrames.length === 0) return '';
  const parts = loopFrames[0].split('/');
  return parts[parts.length - 2] || '';
}

// ── public API (same as display-pitft.js) ────────────────────────────

export async function init() {
  const script = join(__dirname, 'display-triptych-render.py');
  py = spawn('python3', [script], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  py.stderr.on('data', (d) => {
    logger.warn({ msg: d.toString().trim() }, 'triptych-render stderr');
  });

  py.on('exit', (code) => {
    logger.info({ code }, 'triptych-render exited');
    py = null;
  });

  rl = createInterface({ input: py.stdout });
  rl.on('line', onAck);

  logger.info('Triptych display driver initialised (3× ILI9341)');
}

export function setFace(state, opts) {
  const force = opts?.force || false;
  const animName = FACE_MAP[state] || state;

  if (playingOnce && !force) {
    pendingFace = animName;
    return;
  }

  if (playingOnce && force) {
    playingOnce = false;
  }

  if (animName !== currentAnim() || force) {
    startLoop(animName);
  }
}

export function playOnce(animName) {
  return new Promise(async (resolve) => {
    stopLoop();
    const frames = loadFrames(animName);
    if (frames.length === 0) { resolve(); return; }

    playingOnce = true;
    pendingFace = null;

    for (const frame of frames) {
      if (!py || py.killed) break;
      if (!playingOnce) break;
      const t0 = Date.now();
      await sendFrame(frame, NINJA_SCREEN);
      const elapsed = Date.now() - t0;
      const wait = Math.max(FRAME_DELAY_MS - elapsed, 10);
      await new Promise(r => setTimeout(r, wait));
    }

    playingOnce = false;

    if (pendingFace) {
      const face = pendingFace;
      pendingFace = null;
      startLoop(face);
    }

    resolve();
  });
}

export function buzz() {}

export function close() {
  playingOnce = false;
  stopLoop();
  if (py && !py.killed) {
    py.stdin.end();
    py.kill();
    py = null;
  }
  if (rl) { rl.close(); rl = null; }
}

// ── multi-screen API (new for triptych) ──────────────────────────────

/**
 * Send an image to a specific screen.
 * @param {number} screen - 0=left, 1=middle, 2=right
 * @param {string} imagePath - path to 240×320 image
 */
export function sendToScreen(screen, imagePath) {
  return sendCommand({ screen, path: imagePath });
}

/**
 * Send a wide image across all 3 screens (720×320).
 * @param {string} imagePath - path to 720×320 image
 */
export function sendToAll(imagePath) {
  return sendCommand({ screen: 'all', path: imagePath });
}
