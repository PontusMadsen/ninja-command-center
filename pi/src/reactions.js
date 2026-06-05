import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default class ReactionEngine {
  constructor(uart) {
    this.uart = uart;
    this.reactions = [];
    this.cooldowns = new Map(); // reaction index -> last fired timestamp
    this.currentFace = 'idle';
    this.returnTimer = null;
    this.loadReactions();
  }

  loadReactions() {
    try {
      const path = join(__dirname, '../config/reactions.json');
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      this.reactions = data.reactions || [];
      logger.info({ count: this.reactions.length }, 'Reactions loaded');
    } catch (e) {
      logger.error({ err: e }, 'Failed to load reactions.json');
    }
  }

  handleEvent(msg) {
    logger.debug({ incoming: msg }, 'Event received');
    const now = Date.now();

    for (let i = 0; i < this.reactions.length; i++) {
      const rule = this.reactions[i];

      // Check if event matches the rule
      if (!this.matches(msg, rule.match)) continue;

      // Check cooldown
      const lastFired = this.cooldowns.get(i) || 0;
      if (now - lastFired < rule.cooldown) continue;

      // Apply probability — skip randomly
      if (Math.random() > rule.probability) continue;

      // Fire the reaction
      this.cooldowns.set(i, now);
      this.setFace(rule.face, rule.duration);

      logger.info({
        event: msg.event,
        face: rule.face,
        duration: rule.duration
      }, 'Reaction fired');

      return; // Only fire first matching rule
    }
  }

  matches(msg, pattern) {
    for (const [key, value] of Object.entries(pattern)) {
      if (msg[key] !== value) return false;
    }
    return true;
  }

  setFace(face, duration) {
    // Cancel any pending return-to-idle
    if (this.returnTimer) {
      clearTimeout(this.returnTimer);
      this.returnTimer = null;
    }

    this.currentFace = face;
    this.uart.send({ cmd: 'face', state: face });

    // If duration > 0, return to idle after duration
    if (duration > 0) {
      this.returnTimer = setTimeout(() => {
        this.currentFace = 'idle';
        this.uart.send({ cmd: 'face', state: 'idle' });
        this.returnTimer = null;
      }, duration);
    }
  }
}
