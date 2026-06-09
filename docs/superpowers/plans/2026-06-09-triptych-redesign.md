# Ninja Command Center — Triptych Redesign

> **Status:** Planning / pre-hardware. Displays ordered, arriving soon.

**Date:** 2026-06-09  
**Replaces:** ESP32-based multi-board architecture  
**Inspired by:** @dokidek_ (Instagram) — 3-panel ILI9341 desk companion

---

## Vision

Three small TFT displays side-by-side, driven entirely by the Raspberry Pi. The ninja lives on the middle screen — same voice, same personality, same reactions — but now flanked by a clock/focus panel on the left and a Spotify/info panel on the right. 99% of the time each screen does its own thing. Special moments unite all three into one wide canvas.

---

## Hardware

### Displays
- **3× 2.8" ILI9341 SPI TFT LCD** — 240×320, with XPT2046 resistive touch
- All driven directly from Pi via SPI (no ESP32 needed)
- Mounted side-by-side in a 3D-printed or laser-cut triptych bracket

### Wiring — 3 displays on one SPI bus

All displays share MOSI / MISO / CLK. Only CS, DC, RST differ per display.

```
Pi SPI0:  MOSI=GPIO10, MISO=GPIO9, CLK=GPIO11

Display 1 (Left — Clock):
  CS=GPIO8,   DC=GPIO24,  RST=GPIO25
  T_CS=GPIO26, T_IRQ=GPIO19

Display 2 (Middle — Ninja):
  CS=GPIO7,   DC=GPIO23,  RST=GPIO27
  T_CS=GPIO20, T_IRQ=GPIO16

Display 3 (Right — Info):
  CS=GPIO5,   DC=GPIO22,  RST=GPIO17
  T_CS=GPIO21, T_IRQ=GPIO12

LED pins → 3.3V (always on) or shared PWM for brightness
```

### What's dropped
- ❌ Adafruit PiTFT (replaced by left+middle ILI9341s)
- ❌ ESP32 T-Display S3 boards (Pi handles all three displays directly)
- ❌ 2.42" OLED thought bubble (fold into right screen or clock screen)

### What stays
- ✅ Raspberry Pi 4 (brain)
- ✅ WM8960 HAT (audio)
- ✅ INMP441 mic + MAX98357A amp
- ✅ All voice pipeline hardware

---

## Software Stack

```
Python renderer (display-triptych-render.py)
  ├── Pillow           — compose 240×320 frames per screen
  ├── spidev           — raw SPI to push pixels
  ├── luma.lcd         — ILI9341 driver (wraps spidev)
  └── RPi.GPIO         — CS / DC / RST control

Node.js orchestrator (unchanged core)
  └── IPC to Python renderer — sends display commands
```

Each display runs in its own **thread** in the Python renderer, updating independently at its own framerate:
- Left (clock): 1 fps
- Middle (ninja face): 10–15 fps
- Right (info): 2 fps

During **crossscreen events** all three pause their independent loops and render from a shared 720×320 master canvas.

---

## Screen Layout

```
┌─────────────┬─────────────┬─────────────┐
│  12:47      │  (◕‿◕)      │  ♫ Nirvana  │
│  MON JUN 9  │             │  Come as..  │
│             │  idle...    │             │
│  🍅 18:32   │             │  📅 Standup │
│  remaining  │             │  in 12 min  │
└─────────────┴─────────────┴─────────────┘
     LEFT          MIDDLE         RIGHT
     240×320        240×320        240×320
```

---

## Screen 1 — Left (Clock + Focus)

**Primary content:**
- Big clock — time in large type, fills most of the screen
- Day + date beneath (e.g. "MON JUN 9")

**Secondary content (lower third):**
- Focus/Pomodoro timer — countdown when active, tomato icon
- Break indicator — "BREAK — 4:30" with soft color
- Upcoming event flash — brief overlay when next calendar event is <10 min away

**Touch (XPT2046):**
- Single tap → start/stop Pomodoro focus session (25 min default)
- Double tap → skip to next break / end break early
- Hold (2s) → reset current Pomodoro session

---

## Screen 2 — Middle (Ninja Face)

**Primary content:**
- Animated ninja face — same frame-based animation system as current project
- All existing face states: idle, talking, happy, angry, confused, sleeping, etc.
- Reacts to voice pipeline, calendar alerts, Spotify events

**Touch (XPT2046):**
- Single tap → **wake word trigger** — starts listening immediately (skip saying "hey ninja")
- Double tap → **pet interaction** — happy face + wiggle animation + soft sound
- Tap on face area vs. screen border → same effect (face = pet, border = wake)
- Hold → mute toggle / sleep mode

---

## Screen 3 — Right (Spotify + Info)

**Primary content — cycles or stacks:**
- Spotify now-playing: track name, artist, progress bar
- Calendar: next 2–3 events with times
- Mail: unread count badge
- Weather: current temp + condition (when Spotify is paused)

**Touch (XPT2046):**
- Tap top-third → skip Spotify track (next)
- Tap middle → play/pause
- Tap bottom-third → show/hide calendar view
- Swipe (if detectable) → cycle info panels

---

## Crossscreen Moments

The key feature. 99% of the time each screen is independent. These events unite all three into a single 720×320 canvas for a moment, then return to normal.

### How it works (code)
```python
# Compose 720×320 master canvas
canvas = Image.new("RGB", (720, 320))
# ... render full-width scene ...

# Slice and push simultaneously (3 threads)
left   = canvas.crop((0,   0, 240, 320))
middle = canvas.crop((240, 0, 480, 320))
right  = canvas.crop((480, 0, 720, 320))
push_to_all_three(left, middle, right)
```

### Triggered moments

| Trigger | Crossscreen effect |
|---|---|
| **Full hour** (01:00, 02:00 etc.) | Hour announcement — big kanji numeral sweeps across all 3, or massive typography billboard |
| **Pomodoro session complete** | Celebration burst — confetti/flash + "DONE" across all 3 |
| **Wake word detected** | All 3 screens pulse / attention flash — ninja "wakes up" |
| **New Spotify track** | Album art color washes left→right across all 3 |
| **Calendar event <5 min** | Warning sweep right→left, all 3 go alert state |
| **Ninja mood = angry** | Red tint bleeds across all 3 screens |
| **Pomodoro break starts** | Soft green wash, "BREAK TIME" centered across all 3 |
| **New mail** | Brief notification banner spans all 3 |

### Full-hour moment ideas (pick one per hour, rotate)
- **Big kanji hour** — `一 二 三...` in giant brush-stroke style centered on middle screen, bleeds to sides
- **Ninja runs** — pixel-art ninja sprints from left screen edge to right screen edge
- **Billboard** — "IT'S 3 O'CLOCK" in massive typography breaking across all 3 bezels
- **Ink splash** — sumi-e ink wipe reveals the hour, recedes back to layouts
- **All 3 faces** — left and right screens briefly show ninja face variants, all reacting together

---

## Focus / Pomodoro System

New feature. Managed by Node.js orchestrator, surfaced on left screen and crossscreen moments.

**Sessions:**
- Default: 25 min focus / 5 min break (classic Pomodoro)
- Long break after 4 sessions: 15 min
- Configurable via web UI

**States:**
- `idle` — no session running, clock shows normally
- `focus` — countdown timer, tomato icon, left screen dims slightly
- `break` — soft green timer, break countdown
- `done` — crossscreen celebration, then return to idle

**Ninja integration:**
- Ninja acknowledges session start/end via voice
- Face shifts to `focused` (squint) during focus sessions
- Face shifts to `happy` during breaks
- Nudges come from ninja's personality — gruff encouragement, not chipper corporate speak

---

## Break Nudges

Small messages surfaced by the ninja during breaks and idle moments.

**Delivery:**
- Appear as text overlay on the ninja screen (middle)
- Or as a brief full-width banner crossscreen
- Ninja speaks them aloud (TTS) on longer breaks

**Tone (matches ninja personality):**
- "Stand up. Your back is not your enemy." 
- "Five minutes. Go outside."
- "Water. Now."
- "You've been at this for 2 hours."
- "Break. Not optional."

**Sources:**
- Pre-written list in `personality/nudges.json`
- Claude can generate contextual ones based on time of day / session count
- Never twee, never corporate, always laconic

---

## What Carries Over (Unchanged)

| Component | Status |
|---|---|
| Voice pipeline (wake → STT → LLM → TTS → playback) | ✅ unchanged |
| Claude personality + system prompt | ✅ unchanged |
| Groq Whisper STT | ✅ unchanged |
| Voicevox / Google Cloud TTS | ✅ unchanged |
| OpenWakeWord listener | ✅ unchanged |
| Spotify integration | ✅ unchanged |
| Google Calendar integration | ✅ unchanged |
| Gmail IMAP integration | ✅ unchanged |
| Express web API + PWA dashboard | ✅ unchanged |
| Reactions engine | ✅ unchanged |
| Idle behaviors | ✅ unchanged |
| systemd service | ✅ unchanged |
| Stock phrases / latency masking | ✅ unchanged |
| Animation frame library (37 sets) | ✅ unchanged |

---

## What Changes

| Component | Change |
|---|---|
| `display-pitft.js` + `display-pitft-render.py` | → replaced by `display-triptych.js` + `display-triptych-render.py` |
| ESP32 firmware (both boards) | → deleted, no longer needed |
| Single-screen face rendering | → middle screen only (same logic, new target) |
| No focus/timer system | → new Pomodoro module |
| No crossscreen events | → new crossscreen event bus |
| No touch input | → XPT2046 handler for all 3 screens |
| No nudge system | → new nudge scheduler |

---

## New Files to Build

```
pi/src/
  display-triptych.js           # 3-display driver (JS side, IPC to Python)
  display-triptych-render.py    # Python renderer — 3 threads + crossscreen
  focus/
    pomodoro.js                 # Pomodoro state machine
    nudges.js                   # Nudge scheduler + delivery
  touch/
    handler.js                  # XPT2046 touch event router
  crossscreen/
    events.js                   # Crossscreen event bus
    animations.js               # Full-hour, celebration, wash, etc. renders

pi/config/
  nudges.json                   # Pre-written nudge messages
  focus.json                    # Pomodoro timing config

pi/personality/
  nudges.json                   # Nudge message bank (laconic, ninja-toned)
```

---

## Decisions (Resolved 2026-06-09)

- [x] **Clock aesthetic** → Japanese typography — clean digits + kanji day names (月火水木金土日), sumi-e vibe
- [x] **Right screen** → Spotify hero when playing, fallback to calendar → weather → mail when paused
- [x] **Full-hour animation** → Alternate every hour: kanji brush-stroke (odd hours) ↔ ninja run across all 3 (even hours)
- [x] **Enclosure** → 3D print (fast iteration, nicer v2 later)
- [x] **Rotary encoder** → Skip for v1 (touch on all 3 screens is sufficient)
- [x] **Frame orientation** → All portrait (240×320). Resize strategy TBD at step 3 — try different approaches on real hardware first

---

## Build Order

1. **Renderer** — get all 3 displays lighting up from Pi
2. **Clock screen** — basic time/date display
3. **Ninja face** — port existing animation system to middle display
4. **Touch handlers** — tap-to-wake, pet interaction
5. **Right screen** — Spotify now-playing
6. **Crossscreen** — full-hour animation as first hero moment
7. **Focus/Pomodoro** — timer on left screen + crossscreen done celebration
8. **Nudges** — break messages from ninja
9. **Right screen extras** — calendar, mail, weather rotation
10. **CalDAV calendar** — replace Google Calendar with CalDAV (iCloud, Google, any provider)
11. **Ninja nudges** — proactive messages from ninja (hydration, posture, break reminders, time-of-day awareness)
12. **Polish** — all other crossscreen moments, animations, refinement
