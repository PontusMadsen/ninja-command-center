/**
 * HTML Screen Renderer — uses Playwright to render HTML modules
 * as screenshots and push them to the triptych displays.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import logger from '../logger.js';
import { getModule, renderModuleHTML } from './modules.js';

const SCREENSHOT_INTERVAL_DEFAULT = 500; // ms for static content (clocks/text)
const BASE_URL = `http://localhost:${process.env.WEB_PORT || 8888}`;

export default class HtmlRenderer {
  constructor({ sendCommand }) {
    this.sendCommand = sendCommand;
    this.browser = null;
    this.screens = {};  // screenIdx → { page, moduleId, timer, screenshotting }
    this.running = false;
    this.paused = false;
  }

  async start() {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    this.running = true;
    logger.info('HTML renderer started (Playwright)');
  }

  async stop() {
    this.running = false;
    for (const screen of Object.values(this.screens)) {
      if (screen.timer) clearInterval(screen.timer);
      if (screen.page) await screen.page.close().catch(() => {});
    }
    this.screens = {};
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
  }

  pause() { this.paused = true; }
  resume() {
    this.paused = false;
    // Reset screenshotting flags that may have gotten stuck
    for (const screen of Object.values(this.screens)) {
      screen.screenshotting = false;
    }
  }

  async setScreen(screenIdx, moduleId, dataHooks = {}) {
    // Stop existing screen
    const existing = this.screens[screenIdx];
    if (existing) {
      if (existing.timer) clearInterval(existing.timer);
      if (existing.gifModule) existing.gifModule.stop();
      if (existing.page) await existing.page.close().catch(() => {});
      delete this.screens[screenIdx];
    }

    const mod = getModule(moduleId);
    if (!mod) {
      logger.warn({ moduleId }, 'Module not found');
      return;
    }

    const page = await this.browser.newPage({
      viewport: { width: 240, height: 320 },
      deviceScaleFactor: 1,
    });

    const url = `${BASE_URL}/screen/${moduleId}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(500);
    } catch (e) {
      logger.warn({ err: e.message, moduleId }, 'Failed to load module page');
      await page.close().catch(() => {});
      return;
    }

    this.screens[screenIdx] = {
      page,
      moduleId,
      timer: null,
      screenshotting: false,
    };

    // GIF module bypasses Playwright — use Python renderer directly
    if (mod.id === 'gif') {
      const { default: GifScreen } = await import('./giphy.js');
      const gif = new GifScreen({ sendCommand: this.sendCommand, screen: screenIdx });
      this.screens[screenIdx].gifModule = gif;
      gif.start();
      await page.close().catch(() => {});
      this.screens[screenIdx].page = null;
      logger.info({ screen: screenIdx }, 'GIF module using Python renderer');
      return;
    }

    // Take first screenshot immediately
    await this._screenshot(screenIdx);

    // Start screenshot loop
    this.screens[screenIdx].timer = setInterval(
      () => this._screenshot(screenIdx),
      SCREENSHOT_INTERVAL_DEFAULT,
    );

    logger.info({ screen: screenIdx, module: mod.name }, 'Screen module assigned');
  }

  async updateData(screenIdx, dataHooks) {
    const screen = this.screens[screenIdx];
    if (!screen?.page) return;
    try {
      await screen.page.evaluate((data) => {
        window.NINJA_DATA = { ...window.NINJA_DATA, ...data };
      }, dataHooks);
    } catch {}
  }

  async _screenshot(screenIdx) {
    const screen = this.screens[screenIdx];
    if (!screen?.page || !this.running || this.paused || screen.screenshotting) return;

    screen.screenshotting = true;
    try {
      const buf = await screen.page.screenshot({ type: 'png' });
      const path = `/tmp/screen_${screenIdx}.png`;
      writeFileSync(path, buf);
      this.sendCommand({ screen: screenIdx, path });
    } catch {}
    screen.screenshotting = false;
  }

  getScreenAssignments() {
    const result = {};
    for (const [idx, screen] of Object.entries(this.screens)) {
      result[idx] = screen.moduleId;
    }
    return result;
  }
}
