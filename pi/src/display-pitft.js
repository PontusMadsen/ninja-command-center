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
const FRAMES_DIR = join(__dirname, '..', 'frames-new');

const FACE_MAP = {
  idle: 'ninja_idle', happy: 'ninja_happy', sad: 'ninja_confused', angry: 'ninja_angry',
  surprised: 'ninja_surprised', sleeping: 'ninja_sleeping', confused: 'ninja_confused',
  focused: 'ninja_listening', scared: 'ninja_scared', talking: 'ninja_talking',
  love: 'ninja_happy', wow: 'ninja_surprised', yell: 'ninja_angry',
  sleepy: 'drowsy', hehe: 'smile', dizzy: 'ninja_dizzy',
};

let py = null;           // Python subprocess
let rl = null;           // readline on Python stdout
let ackResolve = null;   // resolves when Python sends 'K'
let loopTimer = null;    // current animation loop interval
let loopFrames = [];     // frames for current loop
let loopIdx = 0;         // current frame index in loop
let sending = false;     // true while waiting for ack
let playingOnce = false; // true during playOnce — blocks setFace
let pendingFace = null;  // face queued during playOnce

const FRAME_DELAY_MS = 60;  // match original GIF timing (~16fps)

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
  const t0 = Date.now();
  try {
    await sendFrame(loopFrames[loopIdx]);
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

  // During playOnce, queue the face change for after it finishes
  if (playingOnce && !force) {
    pendingFace = animName;
    return;
  }

  // If forced, cancel playOnce
  if (playingOnce && force) {
    playingOnce = false;
  }

  if (animName !== currentAnim() || force) {
    startLoop(animName);
  }
}

function currentAnim() {
  if (loopFrames.length === 0) return '';
  const parts = loopFrames[0].split('/');
  return parts[parts.length - 2] || '';
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
      if (!playingOnce) break;  // force-interrupted
      const t0 = Date.now();
      await sendFrame(frame);
      const elapsed = Date.now() - t0;
      const wait = Math.max(FRAME_DELAY_MS - elapsed, 10);
      await new Promise(r => setTimeout(r, wait));
    }

    playingOnce = false;

    // Start queued face if one was set during playOnce
    if (pendingFace) {
      const face = pendingFace;
      pendingFace = null;
      startLoop(face);
    }

    resolve();
  });
}

export function buzz() {
  // No haptic motor on PiTFT — no-op
}

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
