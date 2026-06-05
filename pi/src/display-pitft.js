/**
 * PiTFT display driver for Little Gamers Ninja.
 *
 * Spawns display-pitft-render.py, sends JPEG frame paths over stdin,
 * waits for ack ('K') before sending the next frame. Exposes the same
 * API as the original display.js: { init, setFace, playOnce, buzz, close }.
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
  surprised: 'WHAT', sleeping: 'sleeping', confused: 'dizzy',
  focused: 'squint', scared: 'scared', talking: 'talking',
  // Extended faces
  love: 'love', wow: 'wow', yell: 'yell', devil: 'devil_1',
  please: 'please', blink: 'blink', sleepy: 'sleepy_1',
  hehe: 'hehe', fumin: 'fumin', tounge: 'tounge',
};

let py = null;           // Python subprocess
let rl = null;           // readline on Python stdout
let ackResolve = null;   // resolves when Python sends 'K'
let loopTimer = null;    // current animation loop interval
let loopFrames = [];     // frames for current loop
let loopIdx = 0;         // current frame index in loop
let sending = false;     // true while waiting for ack

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

function sendFrame(framePath) {
  return new Promise((resolve, reject) => {
    if (!py || py.killed) { resolve(); return; }
    ackResolve = resolve;
    py.stdin.write(framePath + '\n');
  });
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
  try {
    await sendFrame(loopFrames[loopIdx]);
    loopIdx = (loopIdx + 1) % loopFrames.length;
  } catch (e) {
    logger.warn({ err: e.message }, 'Frame send failed');
  }
  sending = false;

  if (loopFrames.length > 0) {
    loopTimer = setTimeout(tickLoop, 80);  // ~12 fps
  }
}

// ── public API ───────────────────────────────────────────────────────

export async function init() {
  const script = join(__dirname, 'display-pitft-render.py');
  py = spawn('python3', [script], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  py.stderr.on('data', (d) => {
    logger.warn({ msg: d.toString().trim() }, 'pitft-render stderr');
  });

  py.on('exit', (code) => {
    logger.info({ code }, 'pitft-render exited');
    py = null;
  });

  rl = createInterface({ input: py.stdout });
  rl.on('line', onAck);

  logger.info('PiTFT display driver initialised');
}

export function setFace(state, opts) {
  const force = opts?.force || false;
  const animName = FACE_MAP[state] || state;

  // If forced or different animation, restart loop
  if (force || animName !== currentAnim()) {
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
}

function currentAnim() {
  if (loopFrames.length === 0) return '';
  // Derive anim name from the first frame's parent directory
  const parts = loopFrames[0].split('/');
  return parts[parts.length - 2] || '';
}

export function playOnce(animName) {
  return new Promise(async (resolve) => {
    stopLoop();
    const frames = loadFrames(animName);
    if (frames.length === 0) { resolve(); return; }

    for (const frame of frames) {
      if (!py || py.killed) break;
      await sendFrame(frame);
    }
    resolve();
  });
}

export function buzz() {
  // No haptic motor on PiTFT — no-op
}

export function close() {
  stopLoop();
  if (py && !py.killed) {
    py.stdin.end();
    py.kill();
    py = null;
  }
  if (rl) { rl.close(); rl = null; }
}
