# Ninja Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-screen desk companion hub with the Little Gamers Ninja as the soul — Spotify controls, calendar/mail feed, voice interaction, and haiku thought bubbles across four displays driven by a Raspberry Pi 4.

**Architecture:** Pi 4 (1GB) runs Node.js orchestrator with Express API server, WM8960 HAT for audio, Adafruit PiTFT for ninja face rendering via framebuffer. Two ESP32-S3 T-Display S3 boards connect over WiFi to fetch data from the Pi's REST API. A 2.42" I2C OLED wired to one ESP32 shows the ninja's thought bubble.

**Tech Stack:** Node.js (ES modules), Express, Python (OpenWakeWord), PlatformIO/Arduino (ESP32), pygame (PiTFT rendering), Spotify Web API, Google Calendar API, IMAP, Claude Haiku, Groq Whisper, Google Cloud TTS/VOICEVOX, TFT_eSPI, U8g2

---

## File Structure

```
ninja-command-center/
├── pi/
│   ├── package.json
│   ├── .env.example
│   ├── config/
│   │   └── default.json
│   ├── frames/                     # copied from little-gamers-ninja
│   │   ├── default/
│   │   ├── smile/
│   │   ├── talking/
│   │   └── ... (37 animations)
│   ├── src/
│   │   ├── orchestrator.js         # main entry — forked from ninja project
│   │   ├── display-pitft.js        # NEW — PiTFT framebuffer renderer
│   │   ├── logger.js               # copied from ninja project
│   │   ├── face-reactions.js       # copied from ninja project
│   │   ├── idle-behaviors.js       # copied from ninja project
│   │   ├── reactions.js            # copied from ninja project
│   │   ├── audio/
│   │   │   ├── playback.js         # copied, adjusted for WM8960
│   │   │   ├── record.js           # copied, adjusted for WM8960
│   │   │   └── stock-phrases.js    # copied
│   │   ├── llm/
│   │   │   ├── claude-stream.js    # copied
│   │   │   └── claude.js           # copied
│   │   ├── stt/
│   │   │   └── groq.js             # copied
│   │   ├── tts/
│   │   │   ├── voicevox.js         # copied
│   │   │   └── piper.js            # copied
│   │   ├── wakeword/
│   │   │   ├── index.js            # copied
│   │   │   └── listener.py         # copied
│   │   ├── personality/
│   │   │   └── ninja-base.md       # copied
│   │   ├── integrations/
│   │   │   ├── spotify.js          # NEW — Spotify Web API client
│   │   │   ├── calendar.js         # NEW — Google Calendar client
│   │   │   └── mail.js             # NEW — IMAP mail checker
│   │   └── web/
│   │       ├── server.js           # forked — add hub API endpoints
│   │       ├── data.js             # copied
│   │       └── public/             # copied + extended
│   ├── models/
│   │   └── hey_ninja.onnx          # copied
│   ├── scripts/
│   │   └── install.sh              # NEW — setup script
│   └── systemd/
│       └── ninja-hub.service       # NEW — systemd unit
├── esp32/
│   ├── spotify-screen/
│   │   ├── platformio.ini
│   │   └── src/
│   │       └── main.cpp            # NEW — T-Display S3 Spotify UI
│   └── info-screen/
│       ├── platformio.ini
│       └── src/
│           └── main.cpp            # NEW — T-Display S3 info feed + OLED
├── docs/
│   └── superpowers/
│       └── plans/
│           └── 2026-06-05-ninja-command-center.md
└── README.md
```

---

## Task 1: Project Scaffolding & Ninja Code Fork

**Files:**
- Create: `pi/package.json`
- Create: `pi/.env.example`
- Create: `pi/config/default.json`
- Copy: all `pi/src/` modules from `little-gamers-ninja/pi/src/` (excluding `display.js`, `oled-display.js`, `oled-display.py`, `transport/`)

- [ ] **Step 1: Initialize project**

```bash
cd /Users/madsen/projects/ninja-command-center
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "ninja-command-center",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/orchestrator.js",
    "dev": "node --watch src/orchestrator.js"
  },
  "dependencies": {
    "express": "^5.1.0",
    "pino": "^9.0.0",
    "pino-pretty": "^13.0.0",
    "@anthropic-ai/sdk": "^0.52.0",
    "spotify-web-api-node": "^5.0.2",
    "googleapis": "^148.0.0",
    "imapflow": "^1.0.0"
  }
}
```

Write this to `pi/package.json`.

- [ ] **Step 3: Create .env.example**

```env
# Required API keys
GROQ_API_KEY=your_groq_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# Spotify (https://developer.spotify.com/dashboard)
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:8888/api/spotify/callback

# Google Calendar (service account or OAuth)
GOOGLE_CALENDAR_ID=your_calendar_id

# Mail (IMAP)
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your_email
IMAP_PASS=your_app_password

# Audio devices (WM8960 HAT)
AUDIO_DEVICE=plughw:wm8960soundcard,0
MIC_DEVICE=plughw:wm8960soundcard,0

# Display
DISPLAY_MODE=pitft

# Web UI
WEB_PORT=8888
```

Write to `pi/.env.example`.

- [ ] **Step 4: Create config/default.json**

```json
{
  "stt": { "provider": "groq", "groq": { "model": "whisper-large-v3-turbo" } },
  "llm": { "provider": "claude", "claude": { "model": "claude-haiku-4-5-20251001" }, "maxCallsPerHour": 200 },
  "tts": { "provider": "voicevox", "voicevox": { "host": "http://localhost:50021", "speakerId": 3 } },
  "wakeword": { "model": "hey_ninja", "sensitivity": 0.5 },
  "personality": { "promptPath": "src/personality/ninja-base.md" },
  "audio": { "sampleRate": 16000, "channels": 1, "silenceThresholdMs": 1500 },
  "reactions": { "defaultProbability": 0.7, "defaultCooldownMs": 3000 },
  "spotify": { "pollIntervalMs": 3000 },
  "calendar": { "pollIntervalMs": 60000 },
  "mail": { "pollIntervalMs": 30000 }
}
```

Write to `pi/config/default.json`.

- [ ] **Step 5: Copy ninja source files**

```bash
cd /Users/madsen/projects/ninja-command-center

# Core modules (everything except display drivers and transport)
mkdir -p pi/src/{audio,llm,stt,tts,wakeword,personality,web/public,integrations}
mkdir -p pi/{config,models,scripts,systemd,data}

# Copy source files
cp ../little-gamers-ninja/pi/src/logger.js pi/src/
cp ../little-gamers-ninja/pi/src/face-reactions.js pi/src/
cp ../little-gamers-ninja/pi/src/idle-behaviors.js pi/src/
cp ../little-gamers-ninja/pi/src/reactions.js pi/src/
cp ../little-gamers-ninja/pi/src/audio/*.js pi/src/audio/
cp ../little-gamers-ninja/pi/src/llm/*.js pi/src/llm/
cp ../little-gamers-ninja/pi/src/stt/*.js pi/src/stt/
cp ../little-gamers-ninja/pi/src/tts/*.js pi/src/tts/
cp ../little-gamers-ninja/pi/src/wakeword/*.js pi/src/wakeword/
cp ../little-gamers-ninja/pi/src/wakeword/*.py pi/src/wakeword/
cp ../little-gamers-ninja/pi/src/personality/*.md pi/src/personality/
cp ../little-gamers-ninja/pi/src/web/server.js pi/src/web/
cp ../little-gamers-ninja/pi/src/web/data.js pi/src/web/
cp -r ../little-gamers-ninja/pi/src/web/public/* pi/src/web/public/
cp ../little-gamers-ninja/pi/config/reactions.json pi/config/

# Wake word model
cp ../little-gamers-ninja/pi/models/*.onnx pi/models/ 2>/dev/null || true

# Frames (large — symlink for dev, copy for deploy)
ln -s /Users/madsen/projects/little-gamers-ninja/pi/frames pi/frames 2>/dev/null || true
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
.env
data/
frames/
*.onnx
google-tts-key.json
```

Write to `.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with forked ninja source files"
```

---

## Task 2: PiTFT Display Driver

**Files:**
- Create: `pi/src/display-pitft.js`

This replaces the UART-based `display.js` with a framebuffer renderer for the Adafruit 2.8" PiTFT (320x240, ILI9341, SPI). Uses a Python subprocess with pygame to render JPEG frames to the framebuffer (`/dev/fb1`).

- [ ] **Step 1: Create the Python framebuffer renderer**

Create `pi/src/display-pitft-render.py` — a long-running Python process that receives frame paths on stdin and renders them to the PiTFT framebuffer:

```python
#!/usr/bin/env python3
"""
PiTFT framebuffer renderer — receives JPEG paths on stdin, renders to /dev/fb1.
Designed to be spawned by display-pitft.js and kept alive.
"""
import sys
import os

os.environ['SDL_FBDEV'] = '/dev/fb1'
os.environ['SDL_VIDEODRIVER'] = 'fbcon'

import pygame

WIDTH, HEIGHT = 320, 240

def main():
    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.mouse.set_visible(False)
    screen.fill((0, 0, 0))
    pygame.display.flip()

    for line in sys.stdin:
        path = line.strip()
        if not path or not os.path.exists(path):
            continue
        try:
            img = pygame.image.load(path)
            img = pygame.transform.scale(img, (WIDTH, HEIGHT))
            screen.blit(img, (0, 0))
            pygame.display.flip()
            sys.stdout.write('K\n')
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f'render error: {e}\n')

if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Create the Node.js display driver**

Create `pi/src/display-pitft.js`:

```javascript
/**
 * PiTFT Display Driver — renders JPEG animation frames via Python/pygame
 * Drop-in replacement for display.js with same API: init(), setFace(), playOnce(), close()
 */
import { spawn } from 'child_process';
import { readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAME_DIR = join(__dirname, '../frames');

const FACE_MAP = {
  idle: 'default',
  happy: 'smile',
  sad: 'cry',
  angry: 'angry',
  surprised: 'WHAT',
  sleeping: 'sleeping',
  confused: 'dizzy',
  focused: 'squint',
  scared: 'scared',
  talking: 'talking',
};

let renderer = null;
let rl = null;
let currentAnim = null;
let frames = [];
let frameIdx = 0;
let running = false;
let waitingForAck = false;
let playOnceMode = false;
let playOnceResolve = null;
let frameInterval = null;

function loadAnimation(name) {
  const dir = join(FRAME_DIR, name);
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => join(dir, f));
  } catch {
    console.error(`[DISPLAY] Animation not found: ${name}`);
    return [];
  }
}

function sendFrame(path) {
  if (!renderer) return;
  renderer.stdin.write(path + '\n');
  waitingForAck = true;
}

function sendNextFrame() {
  if (!running || frames.length === 0 || waitingForAck) return;
  frameIdx++;

  if (frameIdx >= frames.length) {
    if (playOnceMode) {
      playOnceMode = false;
      running = false;
      if (playOnceResolve) {
        playOnceResolve();
        playOnceResolve = null;
      }
      return;
    }
    frameIdx = 0;
  }

  sendFrame(frames[frameIdx]);
}

export function setFace(state, { force = false } = {}) {
  if (playOnceMode && !force) return;

  if (playOnceMode) {
    playOnceMode = false;
    if (playOnceResolve) { playOnceResolve(); playOnceResolve = null; }
  }

  const animName = FACE_MAP[state] || state;
  if (animName === currentAnim && running) return;

  running = false;
  waitingForAck = false;
  currentAnim = animName;
  frames = loadAnimation(animName);
  frameIdx = 0;

  if (frames.length === 0) return;

  running = true;
  sendFrame(frames[0]);
}

export function playOnce(animName) {
  return new Promise((resolve) => {
    playOnceResolve = resolve;
    running = false;
    waitingForAck = false;
    currentAnim = animName;
    frames = loadAnimation(animName);
    frameIdx = 0;

    if (frames.length === 0) {
      resolve();
      return;
    }

    playOnceMode = true;
    running = true;
    sendFrame(frames[0]);
  });
}

export function buzz() {
  // No haptic on PiTFT — no-op
}

export async function init() {
  const scriptPath = join(__dirname, 'display-pitft-render.py');

  renderer = spawn('python3', [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  rl = createInterface({ input: renderer.stdout });
  rl.on('line', (line) => {
    if (line.trim() === 'K') {
      waitingForAck = false;
      sendNextFrame();
    }
  });

  renderer.stderr.on('data', (data) => {
    console.error(`[DISPLAY] ${data.toString().trim()}`);
  });

  renderer.on('close', (code) => {
    console.error(`[DISPLAY] Renderer exited with code ${code}`);
    running = false;
  });

  // Wait for pygame init
  await new Promise(r => setTimeout(r, 1000));
  console.log('[DISPLAY] PiTFT renderer started');
}

export function close() {
  running = false;
  if (renderer) {
    renderer.stdin.end();
    renderer.kill();
    renderer = null;
  }
}
```

- [ ] **Step 3: Update orchestrator to use PiTFT driver**

Modify `pi/src/orchestrator.js` — change the display import logic:

Replace:
```javascript
const DISPLAY_MODE = process.env.DISPLAY_MODE || 'esp32';
const displayMod = DISPLAY_MODE === 'oled'
  ? await import('./oled-display.js')
  : await import('./display.js');
```

With:
```javascript
const DISPLAY_MODE = process.env.DISPLAY_MODE || 'pitft';
let displayMod;
if (DISPLAY_MODE === 'pitft') {
  displayMod = await import('./display-pitft.js');
} else if (DISPLAY_MODE === 'oled') {
  displayMod = await import('./oled-display.js');
} else {
  displayMod = await import('./display.js');
}
```

Also update the default `AUDIO_DEVICE`:
```javascript
const AUDIO_DEVICE = process.env.AUDIO_DEVICE || 'plughw:wm8960soundcard,0';
```

- [ ] **Step 4: Commit**

```bash
git add pi/src/display-pitft.js pi/src/display-pitft-render.py pi/src/orchestrator.js
git commit -m "feat: add PiTFT framebuffer display driver"
```

---

## Task 3: Spotify Integration

**Files:**
- Create: `pi/src/integrations/spotify.js`

Uses the Spotify Web API via `spotify-web-api-node`. Handles OAuth PKCE flow, token refresh, and polling for now-playing state. Exposes a simple interface for the Express API to consume.

- [ ] **Step 1: Create Spotify client module**

Create `pi/src/integrations/spotify.js`:

```javascript
/**
 * Spotify Web API integration — OAuth flow + now-playing polling
 */
import SpotifyWebApi from 'spotify-web-api-node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(__dirname, '../../data/spotify-tokens.json');

const spotify = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:8888/api/spotify/callback',
});

let nowPlaying = null;
let pollTimer = null;

// Restore saved tokens on startup
function loadTokens() {
  try {
    if (existsSync(TOKEN_PATH)) {
      const tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
      spotify.setAccessToken(tokens.accessToken);
      spotify.setRefreshToken(tokens.refreshToken);
      return true;
    }
  } catch {}
  return false;
}

function saveTokens() {
  writeFileSync(TOKEN_PATH, JSON.stringify({
    accessToken: spotify.getAccessToken(),
    refreshToken: spotify.getRefreshToken(),
  }));
}

async function refreshAccessToken() {
  try {
    const data = await spotify.refreshAccessToken();
    spotify.setAccessToken(data.body.access_token);
    if (data.body.refresh_token) {
      spotify.setRefreshToken(data.body.refresh_token);
    }
    saveTokens();
    return true;
  } catch (e) {
    console.error('[SPOTIFY] Token refresh failed:', e.message);
    return false;
  }
}

async function fetchNowPlaying() {
  try {
    const data = await spotify.getMyCurrentPlaybackState();
    if (!data.body || !data.body.item) {
      nowPlaying = { playing: false };
      return;
    }
    const track = data.body.item;
    nowPlaying = {
      playing: data.body.is_playing,
      track: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[0]?.url || null,
      albumArtSmall: track.album.images[track.album.images.length - 1]?.url || null,
      progressMs: data.body.progress_ms,
      durationMs: track.duration_ms,
      trackId: track.id,
    };
  } catch (e) {
    if (e.statusCode === 401) {
      const ok = await refreshAccessToken();
      if (ok) return fetchNowPlaying();
    }
    console.error('[SPOTIFY] Fetch failed:', e.message);
  }
}

export function getAuthUrl() {
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
  ];
  return spotify.createAuthorizeURL(scopes, 'ninja-hub');
}

export async function handleCallback(code) {
  const data = await spotify.authorizationCodeGrant(code);
  spotify.setAccessToken(data.body.access_token);
  spotify.setRefreshToken(data.body.refresh_token);
  saveTokens();
}

export function getNowPlaying() {
  return nowPlaying;
}

export async function control(action) {
  try {
    switch (action) {
      case 'play': await spotify.play(); break;
      case 'pause': await spotify.pause(); break;
      case 'next': await spotify.skipToNext(); break;
      case 'prev': await spotify.skipToPrevious(); break;
    }
    // Fetch updated state after short delay
    setTimeout(fetchNowPlaying, 500);
    return true;
  } catch (e) {
    if (e.statusCode === 401) {
      await refreshAccessToken();
      return control(action);
    }
    console.error('[SPOTIFY] Control failed:', e.message);
    return false;
  }
}

export function isConnected() {
  return !!spotify.getAccessToken();
}

export function startPolling(intervalMs = 3000) {
  if (pollTimer) clearInterval(pollTimer);
  if (!spotify.getAccessToken()) return;
  fetchNowPlaying();
  pollTimer = setInterval(fetchNowPlaying, intervalMs);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Try loading tokens on import
loadTokens();
```

- [ ] **Step 2: Commit**

```bash
git add pi/src/integrations/spotify.js
git commit -m "feat: add Spotify Web API integration"
```

---

## Task 4: Calendar Integration

**Files:**
- Create: `pi/src/integrations/calendar.js`

Uses Google Calendar API via `googleapis`. Fetches upcoming events and caches them.

- [ ] **Step 1: Create calendar client module**

Create `pi/src/integrations/calendar.js`:

```javascript
/**
 * Google Calendar integration — fetch upcoming events
 */
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = join(__dirname, '../../google-calendar-key.json');

let events = [];
let pollTimer = null;

function getAuth() {
  if (!existsSync(KEY_PATH)) return null;
  const key = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
}

async function fetchEvents() {
  const auth = getAuth();
  if (!auth) return;

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch next 48 hours of events
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const res = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    events = (res.data.items || []).map(e => ({
      id: e.id,
      title: e.summary || '(no title)',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      allDay: !e.start.dateTime,
      location: e.location || null,
    }));
  } catch (e) {
    console.error('[CALENDAR] Fetch failed:', e.message);
  }
}

export function getEvents() {
  return events;
}

export function getNextEvent() {
  return events.length > 0 ? events[0] : null;
}

export function isConnected() {
  return existsSync(KEY_PATH);
}

export function startPolling(intervalMs = 60000) {
  if (pollTimer) clearInterval(pollTimer);
  if (!isConnected()) return;
  fetchEvents();
  pollTimer = setInterval(fetchEvents, intervalMs);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
```

- [ ] **Step 2: Commit**

```bash
git add pi/src/integrations/calendar.js
git commit -m "feat: add Google Calendar integration"
```

---

## Task 5: Mail Integration

**Files:**
- Create: `pi/src/integrations/mail.js`

Uses `imapflow` to check unread mail count and recent subjects.

- [ ] **Step 1: Create mail client module**

Create `pi/src/integrations/mail.js`:

```javascript
/**
 * IMAP mail checker — unread count + recent subjects
 */
import { ImapFlow } from 'imapflow';

let mailState = { unread: 0, recent: [] };
let pollTimer = null;

async function fetchMail() {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASS;

  if (!host || !user || !pass) return;

  const client = new ImapFlow({
    host,
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const status = await client.status('INBOX', { unseen: true });
      mailState.unread = status.unseen || 0;

      // Fetch 5 most recent unseen subjects
      const recent = [];
      if (mailState.unread > 0) {
        const msgs = client.fetch({ unseen: true }, { envelope: true }, { uid: true });
        let count = 0;
        for await (const msg of msgs) {
          recent.push({
            subject: msg.envelope.subject || '(no subject)',
            from: msg.envelope.from?.[0]?.name || msg.envelope.from?.[0]?.address || 'unknown',
            date: msg.envelope.date?.toISOString() || null,
          });
          count++;
          if (count >= 5) break;
        }
      }
      mailState.recent = recent.reverse();
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (e) {
    console.error('[MAIL] Fetch failed:', e.message);
  }
}

export function getMailState() {
  return mailState;
}

export function isConnected() {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS);
}

export function startPolling(intervalMs = 30000) {
  if (pollTimer) clearInterval(pollTimer);
  if (!isConnected()) return;
  fetchMail();
  pollTimer = setInterval(fetchMail, intervalMs);
}

export function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
```

- [ ] **Step 2: Commit**

```bash
git add pi/src/integrations/mail.js
git commit -m "feat: add IMAP mail checker integration"
```

---

## Task 6: Hub API Endpoints

**Files:**
- Modify: `pi/src/web/server.js`

Add REST endpoints that the ESP32 screens will poll. These go alongside the existing ninja web UI endpoints.

- [ ] **Step 1: Add hub API routes to server.js**

Add the following after the existing route definitions in `pi/src/web/server.js`, before the `app.listen()` call. Also add imports at the top of `startWebServer()`:

Add imports inside `startWebServer()` at the top:

```javascript
  // Hub integrations
  const spotify = await import('../integrations/spotify.js');
  const calendar = await import('../integrations/calendar.js');
  const mail = await import('../integrations/mail.js');
```

Add routes before `app.listen()`:

```javascript
  // ============ HUB API (for ESP32 screens) ============

  // --- Spotify ---
  app.get('/api/spotify/auth', (req, res) => {
    res.redirect(spotify.getAuthUrl());
  });

  app.get('/api/spotify/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');
    try {
      await spotify.handleCallback(code);
      spotify.startPolling();
      res.send('<h1>Spotify connected!</h1><p>You can close this tab.</p>');
    } catch (e) {
      res.status(500).send('Auth failed: ' + e.message);
    }
  });

  app.get('/api/spotify/now-playing', (req, res) => {
    res.json(spotify.getNowPlaying() || { playing: false });
  });

  app.post('/api/spotify/control', async (req, res) => {
    const { action } = req.body;
    if (!['play', 'pause', 'next', 'prev'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const ok = await spotify.control(action);
    res.json({ ok });
  });

  app.get('/api/spotify/status', (req, res) => {
    res.json({ connected: spotify.isConnected() });
  });

  // --- Calendar ---
  app.get('/api/calendar/events', (req, res) => {
    res.json({ events: calendar.getEvents() });
  });

  app.get('/api/calendar/next', (req, res) => {
    res.json({ event: calendar.getNextEvent() });
  });

  app.get('/api/calendar/status', (req, res) => {
    res.json({ connected: calendar.isConnected() });
  });

  // --- Mail ---
  app.get('/api/mail/unread', (req, res) => {
    res.json(mail.getMailState());
  });

  app.get('/api/mail/status', (req, res) => {
    res.json({ connected: mail.isConnected() });
  });

  // --- Ninja thought bubble (for OLED) ---
  let currentThought = { text: '', type: 'idle', timestamp: Date.now() };

  app.get('/api/ninja/thought', (req, res) => {
    res.json(currentThought);
  });

  app.post('/api/ninja/thought', (req, res) => {
    const { text, type } = req.body;
    currentThought = { text: text || '', type: type || 'haiku', timestamp: Date.now() };
    res.json({ ok: true });
  });

  // Expose thought setter for orchestrator
  ninjaState.setThought = (text, type = 'haiku') => {
    currentThought = { text, type, timestamp: Date.now() };
  };

  // --- Combined status for all hub screens ---
  app.get('/api/hub/status', (req, res) => {
    res.json({
      spotify: { connected: spotify.isConnected(), nowPlaying: spotify.getNowPlaying() },
      calendar: { connected: calendar.isConnected(), next: calendar.getNextEvent(), events: calendar.getEvents() },
      mail: { connected: mail.isConnected(), ...mail.getMailState() },
      ninja: { thought: currentThought, face: ninjaState.currentFace },
    });
  });

  // Start polling for connected integrations
  spotify.startPolling();
  calendar.startPolling();
  mail.startPolling();
```

- [ ] **Step 2: Commit**

```bash
git add pi/src/web/server.js
git commit -m "feat: add hub API endpoints for Spotify, calendar, mail, and thought bubble"
```

---

## Task 7: Orchestrator Integration Updates

**Files:**
- Modify: `pi/src/orchestrator.js`

Wire the ninja's brain to the hub — ninja reacts to Spotify tracks, mentions upcoming calendar events, and alerts on new mail.

- [ ] **Step 1: Add event-aware ninja behaviors**

Add to orchestrator.js after `idle.start()` and before `startWebServer()`:

```javascript
  // --- Hub-aware ninja behaviors ---
  let lastTrackId = null;
  let lastMailCount = 0;
  let lastCalendarAlert = null;

  async function checkHubEvents() {
    try {
      // React to new Spotify track
      const { getNowPlaying } = await import('./integrations/spotify.js');
      const np = getNowPlaying();
      if (np?.playing && np.trackId && np.trackId !== lastTrackId) {
        lastTrackId = np.trackId;
        // Update thought bubble with track info
        if (ninjaState.setThought) {
          ninjaState.setThought(`♪ ${np.track} — ${np.artist}`, 'music');
        }
      }

      // Alert on new mail
      const { getMailState } = await import('./integrations/mail.js');
      const mailState = getMailState();
      if (mailState.unread > lastMailCount && lastMailCount >= 0) {
        const diff = mailState.unread - lastMailCount;
        if (diff > 0 && ninjaState.setThought) {
          ninjaState.setThought(`${diff} new mail...`, 'alert');
        }
      }
      lastMailCount = mailState.unread;

      // Upcoming calendar event warning (10 min)
      const { getNextEvent } = await import('./integrations/calendar.js');
      const next = getNextEvent();
      if (next && !next.allDay) {
        const start = new Date(next.start);
        const minsUntil = (start - Date.now()) / 60000;
        if (minsUntil > 0 && minsUntil <= 10 && lastCalendarAlert !== next.id) {
          lastCalendarAlert = next.id;
          if (ninjaState.setThought) {
            ninjaState.setThought(`${next.title} in ${Math.round(minsUntil)}min`, 'calendar');
          }
        }
      }
    } catch {}
  }

  // Check hub events every 10 seconds
  setInterval(checkHubEvents, 10000);
```

Also update the `ninjaState` object passed to `startWebServer` to include `setThought`:

```javascript
  let setThought = null;
  const ninjaState = {
    get currentFace() { return 'idle'; },
    get wakeWordActive() { return wakeListener?.running || false; },
    get voiceActive() { return voiceActive; },
    conversationLog,
    framesDir: join(__dirname, '..', 'frames'),
    setFace,
    playOnce,
    startWakeWord: () => wakeListener?.start(),
    stopWakeWord: () => wakeListener?.stop(),
    setThought: null, // populated by server.js
  };
```

- [ ] **Step 2: Commit**

```bash
git add pi/src/orchestrator.js
git commit -m "feat: ninja reacts to Spotify tracks, calendar events, and new mail"
```

---

## Task 8: ESP32 Spotify Screen Firmware

**Files:**
- Create: `esp32/spotify-screen/platformio.ini`
- Create: `esp32/spotify-screen/src/main.cpp`

LilyGO T-Display S3 firmware. Connects to WiFi, polls the Pi's `/api/spotify/now-playing` endpoint, renders track info with album art. Touch zones for prev/play-pause/next.

- [ ] **Step 1: Create PlatformIO config**

Create `esp32/spotify-screen/platformio.ini`:

```ini
[env:t-display-s3]
platform = espressif32@6.9.0
board = lilygo-t-display-s3
framework = arduino
monitor_speed = 115200
upload_speed = 921600

lib_deps =
    bodmer/TFT_eSPI@^2.5.43
    bblanchon/ArduinoJson@^7.3.0
    https://github.com/Bodmer/TJpg_Decoder.git

build_flags =
    -DBOARD_HAS_PSRAM
    -DARDUINO_USB_CDC_ON_BOOT=1
    ; TFT_eSPI config for T-Display S3
    -DUSER_SETUP_LOADED
    -DST7789_DRIVER
    -DTFT_WIDTH=170
    -DTFT_HEIGHT=320
    -DTFT_BL=38
    -DTFT_MISO=-1
    -DTFT_MOSI=17
    -DTFT_SCLK=18
    -DTFT_CS=6
    -DTFT_DC=7
    -DTFT_RST=5
    -DTOUCH_CS=-1
    -DSPI_FREQUENCY=80000000
    -DLOAD_GLCD
    -DLOAD_FONT2
    -DLOAD_FONT4
    -DLOAD_GFXFF
```

- [ ] **Step 2: Create Spotify screen firmware**

Create `esp32/spotify-screen/src/main.cpp`:

```cpp
/**
 * Ninja Command Center — Spotify Screen
 * LilyGO T-Display S3 (170x320, ST7789)
 * Polls Pi hub API for now-playing, renders track info, touch controls.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <TJpg_Decoder.h>

// --- Config ---
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASS";
const char* HUB_HOST  = "http://ninja-hub.local:8888";
const int   POLL_MS   = 3000;

// --- Display ---
TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);

// --- State ---
struct NowPlaying {
  bool playing = false;
  String track;
  String artist;
  String album;
  String albumArtUrl;
  int progressMs = 0;
  int durationMs = 0;
} current, previous;

bool connected = false;
unsigned long lastPoll = 0;
unsigned long lastTouch = 0;

// --- Colors (ninja theme) ---
#define BG_COLOR     0x0000  // black
#define TEXT_PRIMARY  0xFFFF  // white
#define TEXT_SECONDARY 0x7BEF // grey
#define ACCENT_COLOR  0xFD20  // orange
#define CONTROL_COLOR 0x4208  // dark grey

// --- Touch pins (T-Display S3) ---
// Using the built-in touch on GPIO pins
#define TOUCH_PIN_1 14  // left zone (prev)
#define TOUCH_PIN_2 12  // center zone (play/pause)
// Right zone uses screen tap detection

void setupWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("Connecting...", 85, 160, 2);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    attempts++;
  }
  connected = (WiFi.status() == WL_CONNECTED);
}

void fetchNowPlaying() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(HUB_HOST) + "/api/spotify/now-playing";
  http.begin(url);
  http.setTimeout(2000);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      previous = current;
      current.playing = doc["playing"] | false;
      current.track = doc["track"] | "";
      current.artist = doc["artist"] | "";
      current.album = doc["album"] | "";
      current.albumArtUrl = doc["albumArtSmall"] | "";
      current.progressMs = doc["progressMs"] | 0;
      current.durationMs = doc["durationMs"] | 0;
    }
  }
  http.end();
}

void sendControl(const char* action) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(HUB_HOST) + "/api/spotify/control";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"action\":\"") + action + "\"}";
  http.POST(body);
  http.end();

  // Immediate feedback
  delay(300);
  fetchNowPlaying();
}

void drawProgressBar(int y, int progressMs, int durationMs) {
  if (durationMs <= 0) return;
  int barWidth = 150;
  int barX = 10;
  float pct = (float)progressMs / (float)durationMs;
  int filled = (int)(pct * barWidth);

  tft.fillRect(barX, y, barWidth, 3, CONTROL_COLOR);
  tft.fillRect(barX, y, filled, 3, ACCENT_COLOR);

  // Time labels
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  char buf[8];
  snprintf(buf, 8, "%d:%02d", progressMs / 60000, (progressMs / 1000) % 60);
  tft.drawString(buf, barX, y + 6, 1);

  snprintf(buf, 8, "%d:%02d", durationMs / 60000, (durationMs / 1000) % 60);
  tft.setTextDatum(TR_DATUM);
  tft.drawString(buf, barX + barWidth, y + 6, 1);
}

void drawControls(int y) {
  int cx = 85;
  // Prev
  tft.fillTriangle(cx - 50, y + 10, cx - 35, y, cx - 35, y + 20, TEXT_SECONDARY);
  // Play/Pause
  if (current.playing) {
    tft.fillRect(cx - 6, y, 5, 20, TEXT_PRIMARY);
    tft.fillRect(cx + 2, y, 5, 20, TEXT_PRIMARY);
  } else {
    tft.fillTriangle(cx - 6, y, cx - 6, y + 20, cx + 12, y + 10, TEXT_PRIMARY);
  }
  // Next
  tft.fillTriangle(cx + 35, y, cx + 50, y + 10, cx + 35, y + 20, TEXT_SECONDARY);
}

void drawScreen() {
  tft.fillScreen(BG_COLOR);

  if (!current.playing && current.track.isEmpty()) {
    // No music
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("No music", 85, 140, 4);
    tft.drawString("playing", 85, 170, 4);
    return;
  }

  // Album art placeholder (top area)
  tft.fillRect(10, 10, 150, 150, CONTROL_COLOR);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(TEXT_SECONDARY, CONTROL_COLOR);
  tft.drawString("ART", 85, 85, 4);

  // Track name (truncate if too long)
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TEXT_PRIMARY, BG_COLOR);
  String trackDisplay = current.track;
  if (trackDisplay.length() > 20) trackDisplay = trackDisplay.substring(0, 18) + "..";
  tft.drawString(trackDisplay, 10, 175, 4);

  // Artist
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  String artistDisplay = current.artist;
  if (artistDisplay.length() > 25) artistDisplay = artistDisplay.substring(0, 23) + "..";
  tft.drawString(artistDisplay, 10, 205, 2);

  // Progress bar
  drawProgressBar(230, current.progressMs, current.durationMs);

  // Controls
  drawControls(260);
}

void handleTouch() {
  // T-Display S3 has capacitive touch — check touch points
  // For simplicity, divide screen into 3 horizontal zones
  uint16_t x, y;
  if (tft.getTouch(&x, &y)) {
    if (millis() - lastTouch < 500) return; // debounce
    lastTouch = millis();

    if (y > 240) {
      // Control zone
      if (x < 57) {
        sendControl("prev");
      } else if (x < 113) {
        sendControl(current.playing ? "pause" : "play");
      } else {
        sendControl("next");
      }
    }
  }
}

void setup() {
  Serial.begin(115200);

  tft.init();
  tft.setRotation(0);
  tft.fillScreen(BG_COLOR);

  setupWiFi();

  if (connected) {
    tft.fillScreen(BG_COLOR);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(ACCENT_COLOR, BG_COLOR);
    tft.drawString("NINJA HUB", 85, 140, 4);
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("Spotify", 85, 170, 2);
    delay(1500);
  }
}

void loop() {
  if (millis() - lastPoll >= POLL_MS) {
    lastPoll = millis();
    fetchNowPlaying();
    drawScreen();
  }
  handleTouch();
  delay(50);
}
```

- [ ] **Step 3: Commit**

```bash
git add esp32/spotify-screen/
git commit -m "feat: add ESP32 T-Display S3 Spotify screen firmware"
```

---

## Task 9: ESP32 Info Feed Screen Firmware

**Files:**
- Create: `esp32/info-screen/platformio.ini`
- Create: `esp32/info-screen/src/main.cpp`

Second T-Display S3. Shows calendar events and mail count. Also drives the 2.42" OLED thought bubble over I2C.

- [ ] **Step 1: Create PlatformIO config**

Create `esp32/info-screen/platformio.ini`:

```ini
[env:t-display-s3]
platform = espressif32@6.9.0
board = lilygo-t-display-s3
framework = arduino
monitor_speed = 115200
upload_speed = 921600

lib_deps =
    bodmer/TFT_eSPI@^2.5.43
    bblanchon/ArduinoJson@^7.3.0
    olikraus/U8g2@^2.35.30

build_flags =
    -DBOARD_HAS_PSRAM
    -DARDUINO_USB_CDC_ON_BOOT=1
    -DUSER_SETUP_LOADED
    -DST7789_DRIVER
    -DTFT_WIDTH=170
    -DTFT_HEIGHT=320
    -DTFT_BL=38
    -DTFT_MISO=-1
    -DTFT_MOSI=17
    -DTFT_SCLK=18
    -DTFT_CS=6
    -DTFT_DC=7
    -DTFT_RST=5
    -DTOUCH_CS=-1
    -DSPI_FREQUENCY=80000000
    -DLOAD_GLCD
    -DLOAD_FONT2
    -DLOAD_FONT4
    -DLOAD_GFXFF
```

- [ ] **Step 2: Create info screen firmware**

Create `esp32/info-screen/src/main.cpp`:

```cpp
/**
 * Ninja Command Center — Info Feed Screen + OLED Thought Bubble
 * LilyGO T-Display S3 (170x320) + 2.42" OLED (128x64, SSD1309, I2C)
 */
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <U8g2lib.h>
#include <Wire.h>

// --- Config ---
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASS";
const char* HUB_HOST  = "http://ninja-hub.local:8888";
const int   POLL_MS   = 5000;

// --- Displays ---
TFT_eSPI tft = TFT_eSPI();

// 2.42" OLED on I2C — SDA=43, SCL=44 (available GPIOs on T-Display S3)
U8G2_SSD1309_128X64_NONAME0_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

// --- Colors ---
#define BG_COLOR       0x0000
#define TEXT_PRIMARY    0xFFFF
#define TEXT_SECONDARY  0x7BEF
#define ACCENT_COLOR   0xFD20
#define CALENDAR_COLOR 0x07E0  // green
#define MAIL_COLOR     0xF800  // red
#define DIVIDER_COLOR  0x2104

// --- State ---
struct CalendarEvent {
  String title;
  String start;
  bool allDay;
};

struct MailState {
  int unread = 0;
  String recentSubject;
  String recentFrom;
};

struct Thought {
  String text;
  String type;
};

CalendarEvent events[10];
int eventCount = 0;
MailState mailState;
Thought thought;
unsigned long lastPoll = 0;
unsigned long lastTouch = 0;
int currentView = 0; // 0=calendar, 1=mail

void setupWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("Connecting...", 85, 160, 2);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    attempts++;
  }
}

void fetchHubData() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;

  // Fetch calendar
  http.begin(String(HUB_HOST) + "/api/calendar/events");
  http.setTimeout(2000);
  if (http.GET() == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    JsonArray arr = doc["events"].as<JsonArray>();
    eventCount = 0;
    for (JsonObject ev : arr) {
      if (eventCount >= 10) break;
      events[eventCount].title = ev["title"] | "";
      events[eventCount].start = ev["start"] | "";
      events[eventCount].allDay = ev["allDay"] | false;
      eventCount++;
    }
  }
  http.end();

  // Fetch mail
  http.begin(String(HUB_HOST) + "/api/mail/unread");
  http.setTimeout(2000);
  if (http.GET() == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    mailState.unread = doc["unread"] | 0;
    JsonArray recent = doc["recent"].as<JsonArray>();
    if (recent.size() > 0) {
      mailState.recentSubject = recent[0]["subject"] | "";
      mailState.recentFrom = recent[0]["from"] | "";
    }
  }
  http.end();

  // Fetch thought bubble
  http.begin(String(HUB_HOST) + "/api/ninja/thought");
  http.setTimeout(2000);
  if (http.GET() == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    thought.text = doc["text"] | "";
    thought.type = doc["type"] | "idle";
  }
  http.end();
}

String formatTime(const String& isoTime) {
  // Extract HH:MM from ISO datetime
  int tIdx = isoTime.indexOf('T');
  if (tIdx < 0) return "all day";
  return isoTime.substring(tIdx + 1, tIdx + 6);
}

void drawCalendarView() {
  tft.fillScreen(BG_COLOR);

  // Header
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(CALENDAR_COLOR, BG_COLOR);
  tft.drawString("CALENDAR", 10, 10, 4);

  // Mail badge in top-right
  if (mailState.unread > 0) {
    tft.fillCircle(150, 18, 12, MAIL_COLOR);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TEXT_PRIMARY, MAIL_COLOR);
    tft.drawString(String(mailState.unread), 150, 18, 2);
  }

  // Divider
  tft.drawLine(10, 40, 160, 40, DIVIDER_COLOR);

  if (eventCount == 0) {
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
    tft.drawString("No events", 85, 160, 2);
    return;
  }

  // Events list
  int y = 50;
  for (int i = 0; i < eventCount && i < 6; i++) {
    // Time
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(ACCENT_COLOR, BG_COLOR);
    String time = events[i].allDay ? "ALL DAY" : formatTime(events[i].start);
    tft.drawString(time, 10, y, 2);

    // Title
    tft.setTextColor(TEXT_PRIMARY, BG_COLOR);
    String title = events[i].title;
    if (title.length() > 18) title = title.substring(0, 16) + "..";
    tft.drawString(title, 10, y + 18, 2);

    tft.drawLine(10, y + 38, 160, y + 38, DIVIDER_COLOR);
    y += 44;
  }
}

void drawMailView() {
  tft.fillScreen(BG_COLOR);

  // Header
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(MAIL_COLOR, BG_COLOR);
  tft.drawString("MAIL", 10, 10, 4);

  // Unread count
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(TEXT_PRIMARY, BG_COLOR);
  tft.drawString(String(mailState.unread), 85, 100, 7);

  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("unread", 85, 150, 2);

  // Latest mail
  if (!mailState.recentSubject.isEmpty()) {
    tft.drawLine(10, 180, 160, 180, DIVIDER_COLOR);
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(ACCENT_COLOR, BG_COLOR);
    String from = mailState.recentFrom;
    if (from.length() > 22) from = from.substring(0, 20) + "..";
    tft.drawString(from, 10, 190, 2);

    tft.setTextColor(TEXT_PRIMARY, BG_COLOR);
    String subj = mailState.recentSubject;
    if (subj.length() > 22) subj = subj.substring(0, 20) + "..";
    tft.drawString(subj, 10, 210, 2);
  }
}

void drawOled() {
  oled.clearBuffer();

  if (thought.text.isEmpty()) {
    // Show a small ninja icon or "..."
    oled.setFont(u8g2_font_helvR12_tr);
    oled.drawStr(40, 38, "...");
  } else {
    // Word-wrap the thought text
    oled.setFont(u8g2_font_helvR10_tr);
    String text = thought.text;
    int y = 14;
    int lineWidth = 0;
    String line = "";

    for (unsigned int i = 0; i < text.length(); i++) {
      char c = text[i];
      int charWidth = oled.getStrWidth(String(c).c_str());
      if (lineWidth + charWidth > 124 || c == '\n') {
        oled.drawStr(2, y, line.c_str());
        y += 16;
        line = "";
        lineWidth = 0;
        if (y > 62) break;
        if (c == '\n') continue;
      }
      line += c;
      lineWidth += charWidth;
    }
    if (line.length() > 0 && y <= 62) {
      oled.drawStr(2, y, line.c_str());
    }

    // Type indicator
    if (thought.type == "music") {
      oled.drawStr(118, 12, "~");
    } else if (thought.type == "alert") {
      oled.drawStr(118, 12, "!");
    }
  }

  oled.sendBuffer();
}

void handleTouch() {
  uint16_t x, y;
  if (tft.getTouch(&x, &y)) {
    if (millis() - lastTouch < 500) return;
    lastTouch = millis();
    // Toggle view
    currentView = (currentView + 1) % 2;
    if (currentView == 0) drawCalendarView();
    else drawMailView();
  }
}

void setup() {
  Serial.begin(115200);

  // Init TFT
  tft.init();
  tft.setRotation(0);
  tft.fillScreen(BG_COLOR);

  // Init OLED (I2C on custom pins)
  Wire.begin(43, 44);
  oled.begin();
  oled.clearBuffer();
  oled.setFont(u8g2_font_helvR10_tr);
  oled.drawStr(20, 38, "Starting...");
  oled.sendBuffer();

  setupWiFi();

  // Boot screen
  tft.fillScreen(BG_COLOR);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(ACCENT_COLOR, BG_COLOR);
  tft.drawString("NINJA HUB", 85, 140, 4);
  tft.setTextColor(TEXT_SECONDARY, BG_COLOR);
  tft.drawString("Info Feed", 85, 170, 2);
  delay(1500);
}

void loop() {
  if (millis() - lastPoll >= POLL_MS) {
    lastPoll = millis();
    fetchHubData();
    if (currentView == 0) drawCalendarView();
    else drawMailView();
    drawOled();
  }
  handleTouch();
  delay(50);
}
```

- [ ] **Step 3: Commit**

```bash
git add esp32/info-screen/
git commit -m "feat: add ESP32 info feed screen + OLED thought bubble firmware"
```

---

## Task 10: Install Script & Systemd Service

**Files:**
- Create: `pi/scripts/install.sh`
- Create: `pi/systemd/ninja-hub.service`

- [ ] **Step 1: Create install script**

Create `pi/scripts/install.sh`:

```bash
#!/bin/bash
set -e

echo "=== Ninja Command Center — Install ==="

# System deps
sudo apt-get update
sudo apt-get install -y python3-pygame python3-pip alsa-utils sox

# WM8960 HAT driver (if not installed)
if ! aplay -l 2>/dev/null | grep -q wm8960; then
  echo "Installing WM8960 driver..."
  git clone https://github.com/waveshare/WM8960-Audio-HAT.git /tmp/wm8960
  cd /tmp/wm8960
  sudo ./install.sh
  cd -
  echo "WM8960 installed — reboot required after setup"
fi

# PiTFT setup (if not configured)
if [ ! -e /dev/fb1 ]; then
  echo "NOTE: PiTFT needs manual setup."
  echo "Run: sudo apt-get install adafruit-pitft-helper"
  echo "Then: sudo adafruit-pitft-helper -t 28r"
fi

# Node deps
cd "$(dirname "$0")/.."
npm install

# OpenWakeWord
pip3 install openwakeword sounddevice numpy webrtcvad 2>/dev/null || true

# Create data dir
mkdir -p data

# Copy .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — edit with your API keys"
fi

# Install systemd service
sudo cp systemd/ninja-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ninja-hub.service

echo ""
echo "=== Install complete ==="
echo "1. Edit pi/.env with your API keys"
echo "2. Set up Spotify: open http://$(hostname).local:8888/api/spotify/auth"
echo "3. Start: sudo systemctl start ninja-hub"
```

- [ ] **Step 2: Create systemd service**

Create `pi/systemd/ninja-hub.service`:

```ini
[Unit]
Description=Ninja Command Center — multi-screen desk companion
After=network.target sound.target

[Service]
Type=simple
User=pontus
WorkingDirectory=/home/pontus/ninja-command-center/pi
ExecStart=/usr/bin/node src/orchestrator.js
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
Environment=PYTHONUNBUFFERED=1
Environment=NODE_ENV=production
Environment=SDL_FBDEV=/dev/fb1
Environment=SDL_VIDEODRIVER=fbcon
EnvironmentFile=/home/pontus/ninja-command-center/pi/.env

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Make install script executable and commit**

```bash
chmod +x pi/scripts/install.sh
git add pi/scripts/install.sh pi/systemd/ninja-hub.service
git commit -m "feat: add install script and systemd service"
```

---

## Task 11: WiFi Config System for ESP32s

**Files:**
- Modify: `esp32/spotify-screen/src/main.cpp`
- Modify: `esp32/info-screen/src/main.cpp`

Both ESP32 firmwares hardcode WiFi credentials. Add a shared `config.h` pattern so credentials are set once.

- [ ] **Step 1: Create shared config header for each ESP32 project**

Create `esp32/spotify-screen/src/config.h`:

```cpp
#pragma once

// WiFi
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASS";

// Pi Hub
const char* HUB_HOST = "http://ninja-hub.local:8888";

// Polling interval (ms)
const int POLL_MS = 3000;
```

Create `esp32/info-screen/src/config.h` with the same content but `POLL_MS = 5000`.

- [ ] **Step 2: Update both main.cpp files to include config.h**

In both firmware files, replace the config constants at the top with:

```cpp
#include "config.h"
```

Remove the duplicate `WIFI_SSID`, `WIFI_PASS`, `HUB_HOST`, `POLL_MS` declarations.

- [ ] **Step 3: Add config.h to .gitignore and create example**

Add to `.gitignore`:
```
esp32/*/src/config.h
```

Create `esp32/config.h.example`:
```cpp
#pragma once
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASS";
const char* HUB_HOST = "http://ninja-hub.local:8888";
const int POLL_MS = 3000;
```

- [ ] **Step 4: Commit**

```bash
git add esp32/ .gitignore
git commit -m "feat: add WiFi config system for ESP32 firmwares"
```

---

## Task 12: Hardware Verification Checklist

This is a physical verification task — no code, just testing.

- [ ] **Step 1: Pi HAT stacking test**

On the Pi 4:
1. Attach WM8960 HAT directly to GPIO header
2. Add stacking header on top of WM8960
3. Attach Adafruit PiTFT on top of stacking header

Verify:
```bash
# Check WM8960 is detected
aplay -l | grep wm8960

# Check PiTFT framebuffer exists
ls /dev/fb1

# Test audio recording
arecord -D plughw:wm8960soundcard,0 -f S16_LE -r 16000 -c 1 -d 2 /tmp/test.wav

# Test audio playback
aplay -D plughw:wm8960soundcard,0 /tmp/test.wav

# Test PiTFT
cat /dev/urandom > /dev/fb1  # should show static on PiTFT
```

- [ ] **Step 2: If GPIO conflicts exist**

Check pin usage:
```bash
# WM8960 uses: I2S (GPIO 18, 19, 20, 21) + I2C (GPIO 2, 3)
# PiTFT uses: SPI0 (GPIO 10, 9, 11, 8) + GPIO 25 (DC) + GPIO 24 (RST)
# No overlap expected — but verify with:
gpio readall
```

If conflicts exist, the PiTFT can alternatively be connected via SPI1 with jumper wires instead of the HAT connector.

---

## Summary

| Task | Component | Dependencies |
|------|-----------|--------------|
| 1 | Project scaffolding + code fork | None |
| 2 | PiTFT display driver | Task 1 |
| 3 | Spotify integration | Task 1 |
| 4 | Calendar integration | Task 1 |
| 5 | Mail integration | Task 1 |
| 6 | Hub API endpoints | Tasks 3, 4, 5 |
| 7 | Orchestrator integration | Tasks 2, 6 |
| 8 | ESP32 Spotify screen | Task 6 (API must exist) |
| 9 | ESP32 Info screen + OLED | Task 6 (API must exist) |
| 10 | Install script + systemd | Task 7 |
| 11 | WiFi config system | Tasks 8, 9 |
| 12 | Hardware verification | Physical — do anytime |

Tasks 3, 4, 5 can be done in parallel. Tasks 8, 9 can be done in parallel.
