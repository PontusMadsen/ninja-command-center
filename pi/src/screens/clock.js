/**
 * Clock screen module — sends clock render commands to the triptych renderer.
 */

import logger from '../logger.js';

export default class ClockScreen {
  constructor({ sendCommand, screen = 0 }) {
    this.sendCommand = sendCommand;
    this.screen = screen;
    this.timer = null;
    this.localTz = process.env.LOCAL_TZ || 'Asia/Tokyo';
    this.remoteTz = process.env.REMOTE_TZ || 'Europe/Stockholm';
    this.remoteLabel = process.env.REMOTE_LABEL || 'Sweden';
  }

  start() {
    logger.info({ screen: this.screen }, 'Clock screen started');
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    this.sendCommand({
      screen: this.screen,
      type: 'clock',
      local_tz: this.localTz,
      remote_tz: this.remoteTz,
      remote_label: this.remoteLabel,
    });
  }
}
