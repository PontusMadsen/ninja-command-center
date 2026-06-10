import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function loadBank() {
  const raw = readFileSync(join(__dirname, 'nudge-bank.json'), 'utf8');
  return JSON.parse(raw);
}

const TIME_RULES = [
  { category: 'time_awareness', after: 22, before: 6 },
];

const SCHEDULED_NUDGES = [
  { hour: 15, minute: 45, message: "It's time to leave soon, no?", category: 'time_awareness' },
];

export default class NudgeScheduler {
  constructor({ setFace, playOnce, synthesize, playFile, audioDevice }) {
    this.setFace = setFace;
    this.playOnce = playOnce;
    this.synthesize = synthesize;
    this.playFile = playFile;
    this.audioDevice = audioDevice;
    this.bank = loadBank();
    this.timer = null;
    this.enabled = true;
    this.paused = false;
    this.history = [];           // recent nudge categories to avoid repeats
    this.lastNudgeTime = 0;

    // Configurable intervals (ms)
    this.minInterval = 30 * 60 * 1000;  // 30 min minimum between nudges
    this.maxInterval = 60 * 60 * 1000;  // 60 min max
  }

  start() {
    logger.info('Nudge scheduler started');
    this.scheduleNext();
    this.startScheduledNudges();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.scheduledTimer) clearInterval(this.scheduledTimer);
    this.timer = null;
    this.scheduledTimer = null;
  }

  startScheduledNudges() {
    this.firedToday = new Set();
    this.scheduledTimer = setInterval(() => {
      if (!this.enabled || this.paused) return;
      const now = new Date();
      const key = `${now.getHours()}:${now.getMinutes()}`;
      if (this.firedToday.has(key)) return;
      for (const sn of SCHEDULED_NUDGES) {
        if (now.getHours() === sn.hour && now.getMinutes() === sn.minute) {
          this.firedToday.add(key);
          this.deliverMessage(sn.message, sn.category);
          break;
        }
      }
      // Reset fired set at midnight
      if (now.getHours() === 0 && now.getMinutes() === 0) this.firedToday.clear();
    }, 30_000);
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  scheduleNext() {
    if (this.timer) clearTimeout(this.timer);
    const delay = this.minInterval + Math.random() * (this.maxInterval - this.minInterval);
    this.timer = setTimeout(() => this.deliver(), delay);
  }

  pickCategory() {
    const hour = new Date().getHours();
    const categories = Object.keys(this.bank);

    // Time-based bias
    for (const rule of TIME_RULES) {
      if (hour >= rule.after || hour < rule.before) {
        if (Math.random() < 0.4) return rule.category;
      }
    }

    // Avoid repeating recent categories
    const recent = new Set(this.history.slice(-3));
    const available = categories.filter(c => !recent.has(c));
    return pick(available.length ? available : categories);
  }

  pickNudge(category) {
    const messages = this.bank[category];
    if (!messages?.length) return null;
    return pick(messages);
  }

  async deliver() {
    if (!this.enabled || this.paused) {
      this.scheduleNext();
      return;
    }

    const category = this.pickCategory();
    const message = this.pickNudge(category);
    if (!message) {
      this.scheduleNext();
      return;
    }

    this.history.push(category);
    if (this.history.length > 10) this.history.shift();
    this.lastNudgeTime = Date.now();

    logger.info({ category, message }, 'Nudge');
    await this.deliverMessage(message, category);
    this.scheduleNext();
  }

  // Trigger a nudge immediately (e.g. from web UI or voice command)
  async nudgeNow(category) {
    const cat = category || this.pickCategory();
    const message = this.pickNudge(cat);
    if (!message) return null;

    this.history.push(cat);
    if (this.history.length > 10) this.history.shift();
    this.lastNudgeTime = Date.now();

    logger.info({ category: cat, message }, 'Manual nudge');
    await this.deliverMessage(message, cat);
    return { category: cat, message };
  }

  async deliverMessage(message, category) {
    this.setFace('squint');
    try {
      const file = await this.synthesize(message);
      if (file) {
        this.setFace('talking');
        await this.playFile(file, this.audioDevice);
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'Nudge TTS failed');
    }
    this.setFace('idle');
  }

  getStatus() {
    return {
      enabled: this.enabled,
      paused: this.paused,
      lastNudgeTime: this.lastNudgeTime,
      history: this.history.slice(-5),
      minInterval: this.minInterval,
      maxInterval: this.maxInterval,
    };
  }
}
