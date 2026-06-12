/**
 * Todo screen module — shows task list from web UI data.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = join(__dirname, '..', '..', 'data', 'tasks.json');
const REFRESH_INTERVAL = 10_000; // refresh every 10 seconds

export default class TodoScreen {
  constructor({ sendCommand, screen = 0 }) {
    this.sendCommand = sendCommand;
    this.screen = screen;
    this.timer = null;
    this.lastJson = '';
  }

  start() {
    logger.info({ screen: this.screen }, 'Todo screen started');
    this.tick();
    this.timer = setInterval(() => this.tick(), REFRESH_INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    let tasks = [];
    try {
      const raw = readFileSync(TASKS_FILE, 'utf8');
      tasks = JSON.parse(raw);
    } catch {
      // No tasks file yet
    }

    // Filter: today's uncompleted tasks
    const today = new Date().toISOString().slice(0, 10);
    const active = tasks.filter(t => !t.done && (t.date === today || !t.date));

    // Only send if changed
    const json = JSON.stringify(active.map(t => t.text));
    if (json === this.lastJson) return;
    this.lastJson = json;

    this.sendCommand({
      screen: this.screen,
      type: 'todo',
      tasks: active.slice(0, 6).map(t => t.text),
      total: active.length,
    });
  }
}
