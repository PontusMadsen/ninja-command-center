/**
 * GIF screen module — shows random GIF animations from Tenor.
 */

import { get } from 'https';
import logger from '../logger.js';

const TENOR_API_KEY = process.env.TENOR_API_KEY || 'LIVDSRZULELA';
const GIF_INTERVAL = 120_000; // new GIF every 2 minutes

export default class GifScreen {
  constructor({ sendCommand, screen = 2 }) {
    this.sendCommand = sendCommand;
    this.screen = screen;
    this.tag = process.env.GIF_TAG || 'cat';
    this.timer = null;
    this.active = false;
  }

  start() {
    logger.info({ screen: this.screen, tag: this.tag }, 'GIF screen started');
    this.active = true;
    this.fetchAndShow();
    this.timer = setInterval(() => this.fetchAndShow(), GIF_INTERVAL);
  }

  stop() {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async fetchAndShow() {
    if (!this.active) return;

    try {
      const data = await this._apiRequest(
        `https://g.tenor.com/v1/random?q=${encodeURIComponent(this.tag)}&key=${TENOR_API_KEY}&limit=1`
      );

      const result = data?.results?.[0];
      if (!result) return;

      const url = result.media?.[0]?.tinygif?.url
        || result.media?.[0]?.gif?.url;

      if (!url) return;

      logger.info({ tag: this.tag }, 'GIF: new');

      this.sendCommand({
        screen: this.screen,
        type: 'gif',
        url: url,
      });

    } catch (e) {
      logger.warn({ err: e.message }, 'GIF fetch failed');
    }
  }

  _apiRequest(url) {
    return new Promise((resolve, reject) => {
      get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  setTag(tag) {
    this.tag = tag;
    logger.info({ tag }, 'GIF tag changed');
    this.fetchAndShow();
  }
}
