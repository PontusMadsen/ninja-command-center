import logger from './logger.js';
import { FUN_ANIMS, QUICK_FACES } from './face-reactions.js';

const SLEEPY_TIME = 8 * 60 * 1000;   // 8 min → sleepy
const SLEEP_TIME = 10 * 60 * 1000;   // 10 min → sleeping

export default class IdleBehaviors {
  constructor({ setFace, playOnce }) {
    this.setFace = setFace;
    this.playOnce = playOnce;
    this.lastInteraction = Date.now();
    this.timer = null;
    this.sleeping = false;
    this.sleepy = false;
    this.enabled = true;
  }

  start() {
    this.scheduleNext();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  noteInteraction() {
    this.lastInteraction = Date.now();
    if (this.sleeping || this.sleepy) {
      this.sleeping = false;
      this.sleepy = false;
      this.setFace('happy');
      setTimeout(() => {
        if (!this.sleeping) this.setFace('idle');
      }, 1500);
    }
  }

  scheduleNext() {
    const delay = 20000 + Math.random() * 20000; // 20-40 seconds
    this.timer = setTimeout(() => this.doBehavior(), delay);
  }

  async doBehavior() {
    if (!this.enabled) {
      this.scheduleNext();
      return;
    }

    const idleTime = Date.now() - this.lastInteraction;

    // Phase 3: sleeping (10+ min idle)
    if (idleTime > SLEEP_TIME && !this.sleeping) {
      this.sleeping = true;
      this.sleepy = false;
      this.setFace('sleeping');
      logger.info('Ninja fell asleep');
      this.scheduleNext();
      return;
    }

    // Phase 2: sleepy (8-10 min idle)
    if (idleTime > SLEEPY_TIME && !this.sleepy && !this.sleeping) {
      this.sleepy = true;
      this.setFace('sleepy');
      logger.info('Ninja getting sleepy');
      this.scheduleNext();
      return;
    }

    if (this.sleeping) {
      this.scheduleNext();
      return;
    }

    // If sleepy, only do sleepy animations
    if (this.sleepy) {
      if (Math.random() > 0.7) {
        this.setFace('idle');
        setTimeout(() => this.setFace('sleepy'), 2000);
      }
      this.scheduleNext();
      return;
    }

    // Phase 1: active idle — play random animations
    // 40% chance of doing nothing
    if (Math.random() > 0.6) {
      this.scheduleNext();
      return;
    }

    // Pick from fun anims or quick faces, always playOnce
    const allAnims = [...FUN_ANIMS, ...QUICK_FACES.map(f => f.state)];
    const anim = allAnims[Math.floor(Math.random() * allAnims.length)];
    logger.debug({ behavior: anim }, 'Idle animation');
    if (this.playOnce) {
      await this.playOnce(anim);
      this.setFace('idle');
    }

    this.scheduleNext();
  }
}
