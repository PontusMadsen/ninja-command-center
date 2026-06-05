import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default class WakeWordListener extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.paused = false;
  }

  start() {
    const script = join(__dirname, 'listener.py');
    this.process = spawn('python3', [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'wakeword') {
            logger.info({ model: msg.model, score: msg.score }, 'Wake word detected!');
            this.emit('wake', msg);
          }
        } catch {}
      }
    });

    this.process.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) logger.debug({ wake: text }, 'wakeword stderr');
    });

    this.process.on('close', (code) => {
      logger.warn({ code }, 'Wake word process exited');
      // Auto-restart after 3 seconds
      if (!this.stopped) {
        setTimeout(() => this.start(), 3000);
      }
    });

    this.stopped = false;
    logger.info('Wake word listener started');
  }

  pause() {
    if (this.process && !this.paused) {
      this.process.stdin.write('pause\n');
      this.paused = true;
    }
  }

  resume() {
    if (this.process && this.paused) {
      this.process.stdin.write('resume\n');
      this.paused = false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
