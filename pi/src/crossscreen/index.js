/**
 * Crossscreen system — plays wide GIF animations across all 3 displays.
 * 
 * GIFs are 720×320 (3 screens side by side).
 * Triggered by: schedule, voice command, or API.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const GIFS_DIR = join(DATA_DIR, 'crossscreen-gifs');
const CONFIG_FILE = join(DATA_DIR, 'crossscreen-config.json');

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(GIFS_DIR)) mkdirSync(GIFS_DIR, { recursive: true });
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { schedule: [], defaultGif: 'ninja_run_crossscreen.gif' };
  }
}

function saveConfig(config) {
  ensureDirs();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export default class CrossscreenPlayer {
  constructor({ sendCommand, setFace, htmlRenderer }) {
    this.sendCommand = sendCommand;
    this.setFace = setFace;
    this.htmlRenderer = htmlRenderer;
    this.playing = false;
    this.timer = null;
    this.lastHour = -1;

    // Copy default GIF if not present
    ensureDirs();
    const defaultSrc = join(__dirname, '..', '..', 'assets', 'sprites', 'ninja_run_crossscreen.gif');
    const defaultDst = join(GIFS_DIR, 'ninja_run_crossscreen.gif');
    if (existsSync(defaultSrc) && !existsSync(defaultDst)) {
      try { execSync(`cp "${defaultSrc}" "${defaultDst}"`); } catch {}
    }
  }

  start() {
    // Check schedule every minute
    this.timer = setInterval(() => this._checkSchedule(), 60_000);
    logger.info('Crossscreen player started');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _checkSchedule() {
    if (this.playing) return;

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const config = loadConfig();

    // Check scheduled items
    for (const item of config.schedule || []) {
      if (item.hour === hour && item.minute === minute) {
        const gif = item.gif || config.defaultGif;
        this.play(gif);
        return;
      }
    }

    // Hourly trigger (on the hour, minute 0)
    if (minute === 0 && hour !== this.lastHour && config.hourly !== false) {
      this.lastHour = hour;
      this.play(config.defaultGif || 'ninja_run_crossscreen.gif');
    }
  }

  /**
   * Play a crossscreen GIF animation.
   * @param {string} gifName — filename in crossscreen-gifs/
   * @param {number} loops — number of times to loop (default 1)
   */
  async play(gifName, loops = 1) {
    if (this.playing) return;

    const gifPath = join(GIFS_DIR, gifName);
    if (!existsSync(gifPath)) {
      logger.warn({ gifName }, 'Crossscreen GIF not found');
      return;
    }

    this.playing = true;
    logger.info({ gif: gifName, loops }, 'Crossscreen playing');

    // Pause HTML renderer
    if (this.htmlRenderer) this.htmlRenderer.pause();

    // Send crossscreen command to Python renderer
    this.sendCommand({
      type: 'crossscreen',
      path: gifPath,
      loops,
    });

    // Wait for animation to finish (estimate from GIF duration)
    // Python renderer will ack when done
    // For now, estimate based on frame count
    try {
      const result = execSync(
        `python3 -c "from PIL import Image; g=Image.open('${gifPath}'); print(g.n_frames, g.info.get('duration',100))"`,
        { timeout: 5000 }
      ).toString().trim().split(' ');
      const frames = parseInt(result[0]) || 30;
      const duration = parseInt(result[1]) || 100;
      const totalMs = frames * Math.max(duration, 30) * loops + 1000;
      
      await new Promise(r => setTimeout(r, totalMs));
    } catch {
      await new Promise(r => setTimeout(r, 5000));
    }

    // Resume
    this.playing = false;
    if (this.htmlRenderer) this.htmlRenderer.resume();
    if (this.setFace) this.setFace('idle');

    logger.info('Crossscreen finished');
  }

  // --- API methods ---

  getGifs() {
    ensureDirs();
    return readdirSync(GIFS_DIR).filter(f => f.endsWith('.gif'));
  }

  getConfig() {
    return loadConfig();
  }

  updateConfig(updates) {
    const config = { ...loadConfig(), ...updates };
    saveConfig(config);
    return config;
  }

  addSchedule(hour, minute, gif) {
    const config = loadConfig();
    config.schedule = config.schedule || [];
    config.schedule.push({ hour, minute, gif });
    saveConfig(config);
    return config;
  }

  removeSchedule(index) {
    const config = loadConfig();
    config.schedule = config.schedule || [];
    config.schedule.splice(index, 1);
    saveConfig(config);
    return config;
  }
}
