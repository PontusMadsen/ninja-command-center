/**
 * Habits screen module — shows daily habits from web UI data.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HABITS_FILE = join(__dirname, '..', '..', 'data', 'habits.json');
const REFRESH_INTERVAL = 10_000;

export default class HabitsScreen {
  constructor({ sendCommand, screen = 0 }) {
    this.sendCommand = sendCommand;
    this.screen = screen;
    this.timer = null;
    this.lastJson = '';
  }

  start() {
    logger.info({ screen: this.screen }, 'Habits screen started');
    this.tick();
    this.timer = setInterval(() => this.tick(), REFRESH_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    let habits = [];
    try {
      const raw = readFileSync(HABITS_FILE, 'utf8');
      habits = JSON.parse(raw);
    } catch {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const dow = (new Date().getDay() + 6) % 7; // 0=Mon

    // Filter habits scheduled for today
    const todayHabits = habits
      .filter(h => !h.days || h.days.includes(dow))
      .map(h => ({
        name: h.name,
        checked: (h.checks || []).includes(today),
      }));

    const json = JSON.stringify(todayHabits);
    if (json === this.lastJson) return;
    this.lastJson = json;

    this.sendCommand({
      screen: this.screen,
      type: 'habits',
      habits: todayHabits.slice(0, 5),
      total: todayHabits.length,
    });
  }
}
