/**
 * HTML Screen Renderer — uses Playwright to render HTML modules
 * as screenshots and push them to the triptych displays.
 * 
 * Manages a headless Chromium instance with one tab per screen.
 * Takes screenshots at a configurable FPS and sends to the display driver.
 */

import { chromium } from 'playwright';
import logger from '../logger.js';
import { getModule, renderModuleHTML } from './modules.js';

const SCREENSHOT_INTERVAL = 200; // ms between screenshots (5 fps)
const BASE_URL = `http://localhost:${process.env.WEB_PORT || 8888}`;

export default class HtmlRenderer {
  constructor({ sendCommand }) {
    this.sendCommand = sendCommand;
    this.browser = null;
    this.screens = {};  // screenIdx → { page, moduleId, timer, dataHooks }
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
    for (const [idx, screen] of Object.entries(this.screens)) {
      if (screen.timer) clearInterval(screen.timer);
      if (screen.page) await screen.page.close().catch(() => {});
    }
    this.screens = {};
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
  }

  /**
   * Assign a module to a screen and start rendering.
   */
  async setScreen(screenIdx, moduleId, dataHooks = {}) {
    // Stop existing screen
    if (this.screens[screenIdx]) {
      if (this.screens[screenIdx].timer) clearInterval(this.screens[screenIdx].timer);
      if (this.screens[screenIdx].page) await this.screens[screenIdx].page.close().catch(() => {});
    }

    const mod = getModule(moduleId);
    if (!mod) {
      logger.warn({ moduleId }, 'Module not found');
      return;
    }

    const page = await this.browser.newPage({
      viewport: { width: 240, height: 320 },
    });

    // Load module as HTML page served by Express
    const url = `${BASE_URL}/screen/${moduleId}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      // Wait a bit for JS to initialize
      await page.waitForTimeout(500);
    } catch (e) {
      logger.warn({ err: e.message, moduleId }, 'Failed to load module page');
      await page.close().catch(() => {});
      return;
    }

    this.screens[screenIdx] = {
      page,
      moduleId,
      dataHooks,
      timer: null,
    };

    // Start screenshot loop
    this.screens[screenIdx].timer = setInterval(
      () => this._screenshot(screenIdx),
      SCREENSHOT_INTERVAL,
    );

    logger.info({ screen: screenIdx, module: mod.name }, 'Screen module assigned');
  }

  /**
   * Update data hooks for a screen (e.g., ninja says text).
   */
  async updateData(screenIdx, dataHooks) {
    const screen = this.screens[screenIdx];
    if (!screen?.page) return;
    screen.dataHooks = { ...screen.dataHooks, ...dataHooks };
    try {
      await screen.page.evaluate((data) => {
        window.NINJA_DATA = { ...window.NINJA_DATA, ...data };
      }, dataHooks);
    } catch (e) {
      // Page might have navigated
    }
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  async _screenshot(screenIdx) {
    const screen = this.screens[screenIdx];
    if (!screen?.page || !this.running || this.paused) return;

    try {
      const buf = await screen.page.screenshot({ type: 'png' });
      // Save to temp file and send path to renderer
      const path = `/tmp/screen_${screenIdx}.png`;
      const { writeFileSync } = await import('fs');
      writeFileSync(path, buf);
      this.sendCommand({ screen: screenIdx, path });
    } catch (e) {
      // Ignore transient errors
    }
  }

  /**
   * Get which module is on which screen.
   */
  getScreenAssignments() {
    const result = {};
    for (const [idx, screen] of Object.entries(this.screens)) {
      result[idx] = screen.moduleId;
    }
    return result;
  }
}
