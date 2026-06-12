/**
 * Giphy screen module — shows random GIF animations.
 * Fetches from Giphy API, downloads GIF, sends frames to renderer.
 */

import { get } from 'https';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import logger from '../logger.js';

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'dc6zaTOxFJmzC'; // public beta key
const GIF_INTERVAL = 120_000; // new GIF every 2 minutes (100 calls/hour limit)

export default class GiphyScreen {
  constructor({ sendCommand, screen = 2 }) {
    this.sendCommand = sendCommand;
    this.screen = screen;
    this.tag = process.env.GIPHY_TAG || 'cat';
    this.timer = null;
    this.active = false;
  }

  start() {
    logger.info({ screen: this.screen, tag: this.tag }, 'Giphy screen started');
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
        `https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_API_KEY}&tag=${encodeURIComponent(this.tag)}&rating=g`
      );

      const gif = data?.data;
      if (!gif) return;

      // Use fixed_height_small for reasonable size
      const url = gif.images?.fixed_height_small?.url
        || gif.images?.fixed_height?.url
        || gif.images?.original?.url;

      if (!url) return;

      logger.info({ tag: this.tag, id: gif.id }, 'Giphy: new GIF');

      this.sendCommand({
        screen: this.screen,
        type: 'gif',
        url: url,
      });

    } catch (e) {
      logger.warn({ err: e.message }, 'Giphy fetch failed');
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
    logger.info({ tag }, 'Giphy tag changed');
    this.fetchAndShow();
  }
}
