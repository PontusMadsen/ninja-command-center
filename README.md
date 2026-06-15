# Ninja Command Center

A grumpy ninja desk companion with voice interaction, animated face, and a triptych of displays. Built on a Raspberry Pi 4, evolving from the original [Desk Ninja](https://github.com/PontusMadsen/desk-ninja) project.

Say **"Hey Ninja"** and the ninja wakes up, listens, thinks, and responds — with a laconic Japanese-accented personality, animated face reactions, and integrations with Spotify, Google Calendar, Gmail, and weather.

## Triptych Display

Three 2.8" ILI9341 TFT displays side-by-side in a 3D-printed enclosure. Each display runs on its own SPI bus for clean signal integrity.

```
┌─────────────┬─────────────┬─────────────┐
│  10:04      │             │  ♫ Listen   │
│  Monday 15  │  (◕‿◕)      │  To The     │
│  June       │             │  Beat...    │
│             │  idle...    │             │
│  And in     │             │  London     │
│  Sweden     │             │  Funk       │
│  it's 03:04 │             │  Allstars   │
└─────────────┴─────────────┴─────────────┘
     LEFT          MIDDLE         RIGHT
    Clock        Ninja Face     Spotify /
    (HTML)       (Animated)     Modules
                                (HTML)
```

## Screen Modules (HTML/CSS/JS)

Each side screen runs an HTML module rendered by headless Chromium (Playwright). Modules are editable via a built-in web editor with live preview.

**Built-in modules:**
- **Clock** — big pixel time + secondary timezone
- **Spotify** — now playing with pixel art icons
- **Todo** — task list from web UI
- **Habits** — daily habit tracker with checkboxes
- **GIF** — random pixel art cat GIFs from Tenor
- **Ninja Says** — subtitles when the ninja speaks (system module)

**Custom modules:** Create your own HTML/CSS/JS modules in the web editor. Use `{{template}}` variables and `fetch('/api/...')` for live data.

## Features

**Voice Companion**
- Custom wake word detection ("Hey Ninja")
- Speech-to-text via Groq Whisper
- AI personality via Claude — grumpy ninja, English with Japanese accent
- Text-to-speech via Voicevox (Japanese voice) with Google Cloud TTS fallback
- Conversation mode — follow-up questions without repeating the wake word
- "Ninja Says" subtitles on the right display during conversation

**Display System**
- Left screen: HTML modules (default: clock with LanaPixel font)
- Middle screen: animated ninja face — frame-based animation, 37 expression sets
- Right screen: HTML modules (default: Spotify now-playing)
- Module hot-swap via web UI or API
- Brightness/saturation calibration per display

**Nudge System**
- Periodic reminders: hydration, posture, movement, eye breaks
- 40 original dark haiku written by the ninja
- Scheduled nudges (e.g., 15:45 "time to leave")
- Speaks via TTS with face animation

**Integrations**
- Spotify — now playing, playback control
- Google Calendar — upcoming events
- Gmail — unread count
- Weather — current conditions
- Tenor — random GIF display

**Web App** (http://command-center.local:8888)
- Task management with priorities and recurring tasks
- Habit tracking with streaks
- Pomodoro focus timer
- Focus insights and weekly stats
- **Screen manager** — assign modules to displays
- **Module editor** — create/edit HTML/CSS/JS modules with live preview
- Chat with the ninja
- Settings: volume, personality, TTS, API keys

## Hardware

### Components
| Part | Purpose |
|------|---------|
| Raspberry Pi 4 (4GB) | Brain |
| WM8960 Audio HAT | Audio I/O |
| 3× 2.8" ILI9341 SPI TFT (240×320) | Triptych displays |
| 3D-printed enclosure | Housing |

### Display Wiring — 3 Separate SPI Buses

Each display has its own SPI bus to avoid signal interference. No shared data lines.

| Pin | Display 1 (Left) | Display 2 (Middle) | Display 3 (Right) |
|-----|:---:|:---:|:---:|
| **SPI Bus** | SPI4 | SPI0 | SPI5 |
| **MOSI** | GPIO6 (pin 31) | GPIO10 (pin 19) | GPIO14 (pin 8) |
| **CLK** | GPIO7 (pin 26) | GPIO11 (pin 23) | GPIO15 (pin 10) |
| **CS** | GPIO4 (pin 7) | GPIO8 (pin 24) | GPIO12 (pin 32) |
| **DC** | GPIO24 (pin 18) | GPIO23 (pin 16) | GPIO22 (pin 15) |
| **RST** | GPIO25 (pin 22) | GPIO25 (pin 22) | GPIO25 (pin 22) |
| **VCC** | Pin 1 (3.3V) | Pin 1 (3.3V) | Pin 1 (3.3V) |
| **LED** | Pin 17 (3.3V) | Pin 17 (3.3V) | Pin 17 (3.3V) |
| **GND** | Pin 6 | Pin 9 | Pin 14 |

RST is shared (all 3 displays reset together). MISO not connected (write-only). Touch pins wired but not yet active.

**Display drivers:**
- Display 2 (Middle): `panel-mipi-dbi` DRM kernel driver → `/dev/fb0`
- Display 1 & 3 (Left/Right): Python spidev with manual DC/CS GPIO

### Reserved Pins (WM8960 HAT)
GPIO2/3 (I2C), GPIO18/19/20/21 (I2S) — do not use.

## Software Stack

```
Node.js orchestrator
  ├── Voice pipeline (wake → STT → LLM → TTS → playback)
  ├── Idle behaviors (random animations)
  ├── Nudge scheduler (reminders + haiku)
  ├── Integration polling (Spotify, Calendar, Mail, Weather)
  ├── Express web server + API
  │    ├── Screen module routes (/screen/:id)
  │    ├── Module CRUD API (/api/modules)
  │    └── Screen assignment API (/api/screens)
  └── HTML renderer (Playwright/Chromium)
       └── Screenshots → RGB565 → SPI displays

Python triptych renderer
  ├── Ninja face animation (frame-based, /dev/fb0 + spidev)
  ├── PIL-based screen renderers (clock, spotify, todo, etc.)
  └── GIF animation player (threaded)
```

## Quick Start

### 1. Flash & Connect
Flash Raspberry Pi OS to SD card. Connect WM8960 HAT + 3× ILI9341 displays per wiring table.

### 2. Install
```bash
git clone https://github.com/PontusMadsen/ninja-command-center.git
cd ninja-command-center/pi
./scripts/install.sh
sudo reboot
```

### 3. Configure
Open `http://command-center.local:8888`:
1. Enter API keys (Groq, Anthropic)
2. Optionally add Google Cloud TTS key
3. Connect Spotify
4. Say "Hey Ninja"

### 4. Boot Config (`/boot/firmware/config.txt`)
```
dtparam=i2c_arm=on
dtparam=i2s=on
dtoverlay=spi0-1cs
dtoverlay=i2s-mmap
dtoverlay=wm8960-soundcard

# Triptych displays
dtoverlay=mipi-dbi-spi,spi0-0,speed=32000000,width=240,height=320,reset-gpio=25,dc-gpio=23,write-only
dtoverlay=spi4-1cs
dtoverlay=spi5-1cs
```

## API Keys

| Service | Purpose | Get a key |
|---------|---------|-----------|
| [Groq](https://console.groq.com) | Speech-to-text (Whisper) | Free tier |
| [Anthropic](https://console.anthropic.com) | AI personality (Claude) | Pay-as-you-go |
| [Google Cloud](https://console.cloud.google.com) | TTS (optional) | Free tier: 1M chars/month |
| [Spotify](https://developer.spotify.com) | Now playing + control | Free |

## Project Structure

```
pi/
  src/
    orchestrator.js              # Main coordinator
    display-triptych.js          # Triptych display driver (JS)
    display-triptych-render.py   # Python renderer (PIL + SPI)
    face-reactions.js            # Event → face expression mapping
    idle-behaviors.js            # Random idle animations
    screens/
      modules.js                 # Module registry (CRUD)
      default-modules.js         # Built-in HTML modules
      html-renderer.js           # Playwright screenshot loop
      routes.js                  # Express routes for modules
      clock.js                   # Python clock (fallback)
      spotify.js                 # Python Spotify (fallback)
      todo.js                    # Python todo (fallback)
      habits.js                  # Python habits (fallback)
      giphy.js                   # Tenor GIF fetcher (fallback)
    nudges/
      index.js                   # Nudge scheduler
      nudge-bank.json            # 40 dark haiku + reminders
    audio/
      playback.js                # Speaker output
      record.js                  # Mic input
      stock-phrases.js           # Latency-masking phrases
    wakeword/
      index.js                   # Wake word coordinator
      listener.py                # OpenWakeWord listener
    stt/groq.js                  # Groq Whisper STT
    tts/voicevox.js              # Voicevox TTS
    llm/claude-stream.js         # Claude streaming responses
    integrations/
      spotify.js                 # Spotify Connect
      calendar.js                # Google Calendar
      mail.js                    # Gmail IMAP
      weather.js                 # Weather API
    web/
      server.js                  # Express web API
      data.js                    # File-based persistence
      public/
        index.html               # Main web UI (SPA)
        editor.html              # Module editor (separate window)
        fonts/lanapixel.ttf      # LanaPixel pixel font
        icons/                   # Pixel art icons
  assets/
    fonts/lanapixel.ttf          # LanaPixel font
    icons/                       # Source icons
  frames-pitft/                  # 37 face animation sets (JPEG frames)
  data/
    tasks.json                   # Task storage
    habits.json                  # Habit storage
    screen-modules.json          # Module definitions
  systemd/
    ninja-hub.service            # systemd service
```

## Ninja Personality

The ninja speaks English with a thick Japanese accent — drops articles, uses short phrases, sprinkles in kana (はい, なるほど). Laconic, grumpy, secretly fond of the user. Responses are 1–2 sentences max.

Dark haiku examples:
- *"Your code compiles clean. But so did the last version. Bugs hide in the light."*
- *"Coffee getting cold. Just like your forgotten dreams. Drink it anyway."*
- *"Wi-Fi signal strong. Connection to self is weak. Restart everything."*

## Roadmap

- [x] 3× display hardware + separate SPI buses
- [x] Ninja face animation on middle screen
- [x] HTML module system with Chromium rendering
- [x] Web UI module editor with live preview
- [x] Screen manager (assign modules to displays)
- [x] Template variables (`{{local_tz}}` etc.)
- [x] Clock, Spotify, Todo, Habits, GIF, Ninja Says modules
- [x] Nudge system with dark haiku
- [x] Voice conversation with subtitles
- [ ] Touch input (XPT2046) — swipe between modules
- [ ] Crossscreen moments (720×320 canvas events)
- [ ] Pomodoro timer module
- [ ] Weather module
- [ ] CalDAV calendar module
- [ ] Web UI drag & drop for screen assignment
- [ ] Module marketplace / sharing

## Previous Version

Evolved from [Desk Ninja](https://github.com/PontusMadsen/desk-ninja) — Pi Zero 2 W with 128×64 OLED.

## License

MIT

## Credits

- Ninja character from [Little Gamers](https://www.littlegamers.com) by Pontus Madsen
- Built with Claude, Groq, Voicevox, Google Cloud, OpenWakeWord
- LanaPixel font by eishiya
- Triptych concept inspired by [@dokidek_](https://instagram.com/dokidek_)
