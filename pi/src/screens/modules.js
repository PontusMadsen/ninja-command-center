/**
 * Screen Module Registry — manages HTML/CSS/JS screen modules.
 * 
 * Each module has: id, name, html, css, js, icon, category.
 * Stored in pi/data/screen-modules.json.
 * Served as full HTML pages at /screen/:id
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const MODULES_FILE = join(DATA_DIR, 'screen-modules.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadModules() {
  try {
    return JSON.parse(readFileSync(MODULES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveModules(modules) {
  ensureDir();
  writeFileSync(MODULES_FILE, JSON.stringify(modules, null, 2));
}

export function getModules() {
  return loadModules();
}

export function getModule(id) {
  return SYSTEM_MODULES[id] || loadModules().find(m => m.id === id);
}

export function createModule({ name, html, css, js, icon, category }) {
  const modules = loadModules();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const mod = {
    id,
    name: name || 'Untitled',
    html: html || '<div class="module">New Module</div>',
    css: css || '.module { color: #d2cba6; }',
    js: js || '',
    icon: icon || '',
    category: category || 'custom',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  modules.push(mod);
  saveModules(modules);
  logger.info({ id, name: mod.name }, 'Module created');
  return mod;
}

export function updateModule(id, updates) {
  const modules = loadModules();
  const idx = modules.findIndex(m => m.id === id);
  if (idx === -1) return null;
  modules[idx] = { ...modules[idx], ...updates, updatedAt: Date.now() };
  saveModules(modules);
  logger.info({ id, name: modules[idx].name }, 'Module updated');
  return modules[idx];
}

export function deleteModule(id) {
  const modules = loadModules();
  const filtered = modules.filter(m => m.id !== id);
  if (filtered.length === modules.length) return false;
  saveModules(filtered);
  logger.info({ id }, 'Module deleted');
  return true;
}

/**
 * Render a module as a full HTML page for Chromium to display.
 * Injects data hooks as global JS variables.
 */
export const SYSTEM_MODULES = {
  'ninja-says': {
    id: 'ninja-says',
    name: 'Ninja Says',
    category: 'system',
    html: `
<div class="ninja-says-screen">
  <div class="header">
    <img src="/icons/ninja-face.png" class="icon">
    <span class="label">Ninja says!</span>
  </div>
  <div class="text" id="text"></div>
</div>`,
    css: `
.ninja-says-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .icon { width: 16px; height: 18px; }
.header .label { font-size: 24px; }
.text {
  font-size: 32px;
  margin-top: 25px;
  line-height: 1.3;
  word-wrap: break-word;
}`,
    js: `
function update() {
  const text = window.NINJA_DATA?.text || '';
  document.getElementById('text').textContent = text;
}
update();
setInterval(update, 200);`,
  },
};

export function renderModuleHTML(mod, dataHooks = {}) {
  const hooks = JSON.stringify(dataHooks);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=240,height=320,initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 240px;
    height: 320px;
    overflow: hidden;
    background: #000;
    font-family: 'LanaPixel', monospace;
    color: #d2cba6;
  }
  @font-face {
    font-family: 'LanaPixel';
    src: url('/fonts/lanapixel.ttf') format('truetype');
  }
  ${mod.css || ''}
</style>
</head>
<body>
<script>
  window.NINJA_DATA = ${hooks};
</script>
${mod.html || ''}
<script>${mod.js || ''}</script>
</body>
</html>`;
}
