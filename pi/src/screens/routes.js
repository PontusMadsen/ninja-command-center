/**
 * Express routes for screen modules.
 * 
 * /screen/:id — renders module as full HTML page (for Chromium)
 * /api/modules — CRUD API for module management
 * /api/screens — screen assignment management
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getModules, getModule, createModule, updateModule, deleteModule, renderModuleHTML } from './modules.js';
import { DEFAULT_MODULES } from './default-modules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

function seedDefaults() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const existing = getModules();
  let changed = false;
  const mods = [...existing];
  for (const def of DEFAULT_MODULES) {
    if (!mods.find(m => m.id === def.id)) {
      mods.push({ ...def, createdAt: Date.now(), updatedAt: Date.now() });
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(join(DATA_DIR, 'screen-modules.json'), JSON.stringify(mods, null, 2));
  }
}

export function registerScreenRoutes(app, htmlRenderer) {
  seedDefaults();

  // --- Serve module as HTML page ---
  app.get('/screen/:id', (req, res) => {
    const mod = getModule(req.params.id);
    if (!mod) return res.status(404).send('Module not found');

    const dataHooks = {
      local_tz: process.env.LOCAL_TZ || 'Asia/Tokyo',
      remote_tz: process.env.REMOTE_TZ || 'Europe/Stockholm',
      remote_label: process.env.REMOTE_LABEL || 'Sweden',
      tenor_key: process.env.TENOR_API_KEY || 'LIVDSRZULELA',
      gif_tag: process.env.GIF_TAG || 'cat pixelart',
    };

    res.send(renderModuleHTML(mod, dataHooks));
  });

  // --- Module CRUD API ---
  app.get('/api/modules', (req, res) => {
    res.json({ modules: getModules().filter(m => m.category !== 'system') });
  });

  app.get('/api/modules/:id', (req, res) => {
    const mod = getModule(req.params.id);
    if (!mod) return res.status(404).json({ error: 'not found' });
    res.json(mod);
  });

  app.post('/api/modules', (req, res) => {
    const mod = createModule(req.body);
    res.json({ ok: true, module: mod });
  });

  app.put('/api/modules/:id', (req, res) => {
    const mod = updateModule(req.params.id, req.body);
    if (!mod) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, module: mod });

    // If this module is on a screen, reload it
    if (htmlRenderer) {
      const assignments = htmlRenderer.getScreenAssignments();
      for (const [idx, modId] of Object.entries(assignments)) {
        if (modId === req.params.id) {
          htmlRenderer.setScreen(parseInt(idx), modId);
        }
      }
    }
  });

  app.delete('/api/modules/:id', (req, res) => {
    const ok = deleteModule(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  // --- Screen assignment API ---
  app.get('/api/screens', (req, res) => {
    res.json({ screens: htmlRenderer?.getScreenAssignments() || {} });
  });

  app.post('/api/screens/:idx', (req, res) => {
    const idx = parseInt(req.params.idx);
    const { moduleId } = req.body;
    if (!moduleId) return res.status(400).json({ error: 'moduleId required' });
    if (htmlRenderer) {
      htmlRenderer.setScreen(idx, moduleId);
    }
    res.json({ ok: true });
  });
}
