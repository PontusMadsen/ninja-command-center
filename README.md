# Ninja Command Center

A grumpy ninja desk companion with voice interaction, animated face, and a triptych of displays. Built on a Raspberry Pi 4, evolving from the original [Desk Ninja](https://github.com/PontusMadsen/desk-ninja) project.

Say **"Hey Ninja"** and the ninja wakes up, listens, thinks, and responds — with a laconic Japanese-accented personality, animated face reactions, and integrations with Spotify, Google Calendar, Gmail, and weather.

## What's New (Command Center)

The original Desk Ninja ran on a Pi Zero 2 W with a tiny 128×64 OLED. The Command Center upgrades everything:

- **Raspberry Pi 4** — faster voice pipeline, lower latency
- **3× 2.8" ILI9341 TFT displays** — triptych layout (240×320 each, 720×320 combined)
- **Touch input** — XPT2046 resistive touch on all 3 screens
- **Crossscreen moments** — all 3 displays unite into one canvas for special events
- **Focus/Pomodoro timer** — managed from web UI, displayed on clock screen
- **Spotify, Calendar, Mail, Weather** — live info on the right screen

```
┌─────────────┬─────────────┬─────────────┐
│  12:47      │             │  ♫ Nirvana  │
│  月 JUN 9   │  (◕‿◕)      │  Come as..  │
│             │             │             │
│  🍅 18:32   │  idle...    │  📅 Standup │
│  remaining  │             │  in 12 min  │
└─────────────┴─────────────┴─────────────┘
     LEFT          MIDDLE         RIGHT
   Clock +       Ninja Face     Spotify +
   Focus/🍅                    Calendar/Info
```

## Features

**Voice Companion**
- Custom wake word detection ("Hey Ninja")
- Speech-to-text via Groq Whisper
- AI personality via Claude Haiku — grumpy ninja, English with Japanese accent
- Text-to-speech via Voicevox (Japanese voice) with Google Cloud TTS fallback
- Conversation mode — follow-up questions without repeating the wake word
- Stock phrases mask latency while the LLM thinks

**Triptych Display**
- Left screen: clock with kanji day names (月火水木金土日), Pomodoro timer
- Middle screen: animated ninja face — reacts to voice, events, and idle time
- Right screen: Spotify now-playing, calendar, mail, weather (rotates when music is paused)
- Crossscreen moments: all 3 screens merge into a 720×320 canvas for special events

**Crossscreen Moments**
- Full-hour announcements — alternates between giant kanji brush-stroke and pixel ninja running across all 3 screens
- Pomodoro completion celebrations
- Wake word attention flash
- New Spotify track color wash
- Calendar event warnings
- Break time notifications

**Integrations**
- Spotify — now playing, track skip, play/pause via touch
- Calendar — upcoming events, <5 min warnings (CalDAV: supports iCloud Calendar, Google Calendar, and others)
- Gmail — unread count
- Weather — current conditions when Spotify is paused

**Calendar Support**
- CalDAV integration — works with Apple/iCloud Calendar, Google Calendar, and any CalDAV provider
- Configure via web UI with your CalDAV server URL and credentials

**Touch Interactions**
- Left screen: tap to start/stop Pomodoro, double-tap to skip break
- Middle screen: tap to wake (skip wake word), double-tap to pet the ninja
- Right screen: tap to skip track, play/pause, cycle info panels

**Productivity Web App** (http://ninja.local)
- Task management with priorities and recurring tasks
- Pomodoro focus timer linked to tasks
- Habit tracking with 7-day streaks
- Focus insights and weekly stats
- Chat with the ninja from your browser
- Settings panel with volume, personality, TTS voice, API keys

## Hardware

**Required:**
- Raspberry Pi 4
- WM8960 Audio HAT
- INMP441 MEMS microphone
- MAX98357A I2S amplifier + speaker
- 3× 2.8" ILI9341 SPI TFT LCD (240×320, with XPT2046 touch)

**Display Wiring — 3 displays on SPI0:**

All displays share MOSI (GPIO10), MISO (GPIO9), CLK (GPIO11). Only CS, DC, RST differ:

| Pin | Left (Clock) | Middle (Ninja) | Right (Info) |
|-----|-------------|----------------|-------------|
| CS | GPIO8 | GPIO7 | GPIO5 |
| DC | GPIO24 | GPIO23 | GPIO22 |
| RST | GPIO25 | GPIO27 | GPIO17 |
| T_CS | GPIO26 | GPIO20 | GPIO21 |
| T_IRQ | GPIO19 | GPIO16 | GPIO12 |

LED pins → 3.3V (always on) or shared PWM for brightness control.

## Quick Start

### 1. Flash Raspberry Pi OS
Use Raspberry Pi Imager to flash **Raspberry Pi OS** to your SD card. In settings:
- Set hostname (e.g., `ninja`)
- Enable SSH
- Configure WiFi

### 2. Connect Hardware
- Mount WM8960 Audio HAT on the Pi
- Wire INMP441 mic and MAX98357A amp
- Connect 3× ILI9341 displays via SPI (see wiring table above)

### 3. Install
```bash
git clone https://github.com/PontusMadsen/ninja-command-center.git
cd ninja-command-center
chmod +x setup.sh
./setup.sh
sudo reboot
```

### 4. Setup
Open `http://ninja.local` in your browser:
1. Enter API keys (Groq, Anthropic)
2. Optionally add Google Cloud TTS key
3. Connect Spotify
4. Add Google Calendar
5. Test speaker and microphone

### 5. Talk to it
Say **"Hey Ninja"** — the face reacts, then ask your question. Or just tap the middle screen.

## API Keys

| Service | Purpose | Get a key |
|---------|---------|-----------|
| [Groq](https://console.groq.com) | Speech-to-text (Whisper) | Free tier available |
| [Anthropic](https://console.anthropic.com) | AI personality (Claude Haiku) | Pay-as-you-go |
| [Google Cloud](https://console.cloud.google.com) | Text-to-speech (optional) | Free tier: 1M chars/month |
| [Spotify](https://developer.spotify.com) | Now playing + playback control | Free |
| CalDAV Calendar | Upcoming events (iCloud, Google, etc.) | Use your existing account |

## Project Structure

```
pi/
  src/
    orchestrator.js              # Main brain — coordinates everything
    display-pitft.js             # Display driver (JS side)
    display-pitft-render.py      # Python renderer (Pillow + SPI)
    face-reactions.js            # Maps events → face expressions
    idle-behaviors.js            # Random animations when idle
    reactions.js                 # Reaction engine
    personality/
      ninja-base.md              # Claude system prompt
    audio/
      playback.js                # Speaker output
      record.js                  # Mic input
      stock-phrases.js           # Latency-masking phrases
    wakeword/
      index.js                   # Wake word coordinator
      listener.py                # OpenWakeWord listener
    stt/
      groq.js                    # Groq Whisper STT
    tts/
      voicevox.js                # Voicevox TTS
      piper.js                   # Piper local TTS fallback
    llm/
      claude.js                  # Claude API
      claude-stream.js           # Streaming responses
    integrations/
      spotify.js                 # Spotify Connect
      calendar.js                # Google Calendar
      mail.js                    # Gmail IMAP
      weather.js                 # Weather API
    web/
      server.js                  # Express web API + PWA
      data.js                    # Persistence layer
  assets/
    sprites/ninja/               # Pixel art sprite frames
  config/
    default.json                 # Default configuration
    reactions.json               # Event → reaction mappings
```

## Ninja Personality

The ninja speaks English with a thick Japanese accent — drops articles, uses short phrases, sprinkles in kana (はい, バカ, なるほど). Laconic, slightly grumpy, secretly fond of the user. All responses are 1–2 sentences max.

Break nudges match the personality:
- *"Stand up. Your back is not your enemy."*
- *"Water. Now."*
- *"You've been at this for 2 hours."*
- *"Break. Not optional."*

## Sprite Animation

The crossscreen ninja run — a full-hour animation moment where the pixel ninja crosses all 3 displays:

![Ninja crossscreen run](pi/assets/sprites/ninja_run_crossscreen.gif)

10 run frames, 6 jump frames, 4 attack frames. The ninja jumps in from the left, runs across each screen, leaps over the bezels between displays, stops to throw a shuriken, then runs and jumps out the right side.

## Previous Version

This project evolved from [Desk Ninja](https://github.com/PontusMadsen/desk-ninja) — a simpler build using a Pi Zero 2 W with a 128×64 OLED display.

## License

MIT

## Credits

- Ninja character from [Little Gamers](https://www.littlegamers.com) by Pontus Madsen
- Built with Claude, Groq, Voicevox, Google Cloud, OpenWakeWord
- Triptych concept inspired by [@dokidek_](https://instagram.com/dokidek_)
