import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

import logger from './logger.js';
import { readFileSync } from 'fs';

// Display — PiTFT by default, or 'none' for headless testing
const DISPLAY_MODE = process.env.DISPLAY_MODE || 'pitft';
let displayMod;
if (DISPLAY_MODE === 'none') {
  displayMod = {
    init: async () => {},
    setFace: () => {},
    playOnce: async () => {},
    buzz: () => {},
    close: () => {},
  };
} else if (DISPLAY_MODE === 'triptych') {
  displayMod = await import('./display-triptych.js');
} else if (DISPLAY_MODE === 'pitft') {
  displayMod = await import('./display-pitft.js');
} else if (DISPLAY_MODE === 'oled') {
  displayMod = await import('./oled-display.js');
} else {
  displayMod = await import('./display-pitft.js');
}
const { init: displayInit, setFace, playOnce, close: displayClose } = displayMod;
const buzz = displayMod.buzz || (() => {});
const sendCommand = displayMod.sendCommand || null;

// Voice pipeline imports
import { recordAudio } from './audio/record.js';
import { playFile, speakText } from './audio/playback.js';
import { transcribe } from './stt/groq.js';
import { respondStreaming } from './llm/claude-stream.js';
import { synthesize } from './tts/voicevox.js';
import WakeWordListener from './wakeword/index.js';
import { playStockPhrase, preloadStockPhrases } from './audio/stock-phrases.js';
import IdleBehaviors from './idle-behaviors.js';
import NudgeScheduler from './nudges/index.js';
import { startWebServer } from './web/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AUDIO_DEVICE = process.env.AUDIO_DEVICE || 'plughw:wm8960soundcard,0';

import { hasAngryKeyword, angryReaction, moodFace, wakeWordDetected, thinking, speaking } from './face-reactions.js';
import { setOnScreenSwitch } from './llm/tools.js';

let voiceActive = false;
let wakeListener = null;
let idle = null;
let nudges = null;
let screenModules = {};
const conversationLog = [];

const MAX_CONVERSATION_TURNS = 5;

async function doSingleTurn(text) {
  logger.info({ text }, 'User said');

  // Pipeline: TTS + play each sentence as it streams from the LLM
  let fullText = '';
  let result = null;
  const sentenceQueue = [];
  let streamDone = false;
  let resolveNext = null;

  // --- Latency timestamps ---
  const t0 = Date.now(); // (a) user text sent to Claude
  let tFirstToken = 0;   // (b) first Claude token/sentence received
  let tFirstTTS = 0;     // (c) first TTS request sent
  let tFirstPlay = 0;    // (d) first audio playback started
  logger.info({ t0 }, '⏱ [a] Claude request sent');

  const onSentence = (sentence) => {
    if (!tFirstToken) {
      tFirstToken = Date.now();
      logger.info({ elapsed: tFirstToken - t0 }, '⏱ [b] First Claude sentence received (+%dms)', tFirstToken - t0);
    }
    logger.info({ sentence: sentence.substring(0, 50) }, 'Sentence ready');
    fullText += sentence + ' ';
    sentenceQueue.push(sentence);
    // Show ninja speech on right screen
    if (sendCommand) {
      sendCommand({ screen: 2, type: 'ninja_says', text: fullText.trim() });
    }
    if (resolveNext) { resolveNext(); resolveNext = null; }
  };

  setFace('focused');
  const streamPromise = respondStreaming(text, onSentence).then(r => {
    result = r;
    streamDone = true;
    if (resolveNext) { resolveNext(); resolveNext = null; }
  });

  // Wait for Claude to finish, then fire all TTS in parallel, play in order
  await streamPromise;

  if (sentenceQueue.length > 0) {
    setFace('talking');
    tFirstTTS = Date.now();
    logger.info({ elapsed: tFirstTTS - t0, sinceClaude: tFirstTTS - tFirstToken, sentences: sentenceQueue.length },
      '⏱ [c] All TTS requests fired in parallel (+%dms total)', tFirstTTS - t0);

    // Fire all TTS calls simultaneously — each writes unique file
    const ttsPromises = sentenceQueue.map(s => synthesize(s).catch(e => {
      logger.warn({ err: e.message }, 'Sentence TTS failed');
      return null;
    }));

    // Play in order as each resolves
    for (let i = 0; i < ttsPromises.length; i++) {
      const file = await ttsPromises[i];
      if (file) {
        if (!tFirstPlay) {
          tFirstPlay = Date.now();
          logger.info({ elapsed: tFirstPlay - t0, sinceTTS: tFirstPlay - tFirstTTS },
            '⏱ [d] First audio playback started (+%dms total, +%dms since TTS)', tFirstPlay - t0, tFirstPlay - tFirstTTS);
        }
        await playFile(file, AUDIO_DEVICE);
      }
    }
  }

  // --- Latency summary ---
  const tEnd = Date.now();
  logger.info({
    total: tEnd - t0,
    claudeWait: tFirstToken ? tFirstToken - t0 : null,
    ttsWait: tFirstTTS && tFirstToken ? tFirstTTS - tFirstToken : null,
    playWait: tFirstPlay && tFirstTTS ? tFirstPlay - tFirstTTS : null,
    playbackTotal: tFirstPlay ? tEnd - tFirstPlay : null,
  }, '⏱ LATENCY SUMMARY — Claude:%dms → TTS:%dms → Play:%dms — Total:%dms',
    tFirstToken ? tFirstToken - t0 : 0,
    tFirstTTS && tFirstToken ? tFirstTTS - tFirstToken : 0,
    tFirstPlay && tFirstTTS ? tFirstPlay - tFirstTTS : 0,
    tEnd - t0);

  if (!result) {
    setFace('confused');
    await speakText('hmm, I cannot think right now', AUDIO_DEVICE);
    return null;
  }

  // Log conversation (persistent)
  const { addConversation } = await import('./web/data.js');
  addConversation(text, fullText.trim());

  // Brief mood reaction — kept short so follow-up listening starts quickly
  if (hasAngryKeyword(fullText)) {
    const angryAnim = angryReaction();
    logger.info({ anim: angryAnim }, 'Angry trigger!');
    playOnce(angryAnim); // non-blocking — follow-up loop will cut it
  } else {
    const face = moodFace(result.mood || 'happy');
    setFace(face);
  }

  return result;
}

async function handleVoiceTurn() {
  if (voiceActive) return;

  voiceActive = true;
  if (idle) {
    idle.noteInteraction();
    idle.enabled = false;
  }
  if (nudges) nudges.pause();
  if (screenModules.htmlRenderer) screenModules.htmlRenderer.pause();


  try {
    if (wakeListener) wakeListener.stop();
    await new Promise(r => setTimeout(r, 300)); // wait for audio device release

    // Prevent BT audio restart during voice turn
    try {
      execSync('touch /tmp/ninja-voice-active');
    } catch {}

    // First turn — triggered by wake word
    setFace('surprised');
    // Say "Yeeeees?" so user knows ninja is listening
    try {
      const greeting = await synthesize('いぇーーーす？');
      if (greeting) await playFile(greeting, AUDIO_DEVICE);
    } catch {}

    let audio = await recordAudio(5);
    if (!audio) { setFace('idle'); return; }
    setFace('focused');
    playStockPhrase(AUDIO_DEVICE);

    let text = await transcribe(audio);
    if (!text || text.length < 2) {
      logger.info('No speech detected');
      setFace('idle');
      return;
    }

    let result = await doSingleTurn(text);
    if (!result) return;

    // Conversation loop — listen for follow-ups without wake word
    for (let turn = 1; turn < MAX_CONVERSATION_TURNS; turn++) {
      // Cut any animation and show listening face immediately
      setFace('surprised', { force: true });
      logger.info({ turn }, 'Listening for follow-up...');
      await new Promise(r => setTimeout(r, 100));

      audio = await recordAudio(5);
      if (!audio) {
        logger.info('Silent recording, ending conversation');
        break;
      }
      setFace('focused');

      text = await transcribe(audio);
      if (!text || text.length < 8) {
        logger.info('No follow-up detected, ending conversation');
        break;
      }

      result = await doSingleTurn(text);
      if (!result) break;
    }

    setFace('idle');

  } catch (e) {
    logger.error({ err: e.message }, 'Voice turn failed');
    setFace('confused');
  } finally {
    voiceActive = false;
    if (idle) idle.enabled = true;
    if (nudges) nudges.resume();
    // Restore screens
    if (screenModules.htmlRenderer) {
      // Force re-render by reloading the screen module
      screenModules.htmlRenderer.resume();
      const mod = screenModules.screen2Default || 'spotify';
      // Small delay to let voice turn fully complete
      setTimeout(() => {
        screenModules.htmlRenderer.setScreen(2, mod);
      }, 1500);
    } else if (screenModules.spotify) {
      screenModules.spotify.lastTrackId = null;
      screenModules.spotify.tick();
    }
    // Allow BT audio to resume
    try { execSync('rm -f /tmp/ninja-voice-active'); } catch {}
    // Restart wake word listener with delay to avoid TTS echo
    if (wakeListener) {
      wakeListener.stop();
      await new Promise(r => setTimeout(r, 5000));
      wakeListener.start();
    }
  }
}

async function main() {
  logger.info('Little Gamers Ninja — starting orchestrator');

  // Init streaming display
  await displayInit();
  logger.info('Display connected');

  // Start idle behaviors (now uses setFace directly)
  idle = new IdleBehaviors({ setFace, playOnce });

  // Pre-generate stock phrases with Google TTS voice
  await preloadStockPhrases();

  // Start wake word listener
  wakeListener = new WakeWordListener();
  wakeListener.on('wake', () => {
    logger.info('Wake word triggered!');
    handleVoiceTurn();
  });
  wakeListener.start();

  // Set initial face
  setFace('idle');

  // Start idle behavior loop
  idle.start();

  // Start screen modules (triptych only)
  if (sendCommand) {
    try {
      const { default: HtmlRenderer } = await import('./screens/html-renderer.js');
      screenModules.htmlRenderer = new HtmlRenderer({ sendCommand });
      await screenModules.htmlRenderer.start();
      screenModules.screen2Default = 'spotify';
      setOnScreenSwitch((screen, module) => {
        if (screen === 2) screenModules.screen2Default = module;
      });
      logger.info('HTML renderer ready — waiting for web server to register routes');
    } catch (e) {
      logger.warn({ err: e.message }, 'HTML renderer unavailable, using Python screens');
      const { default: ClockScreen } = await import('./screens/clock.js');
      const clock = new ClockScreen({ sendCommand, screen: 0 });
      clock.start();

      const { getNowPlaying } = await import('./integrations/spotify.js');
      const { default: SpotifyScreen } = await import('./screens/spotify.js');
      screenModules.spotify = new SpotifyScreen({ sendCommand, screen: 2, getNowPlaying });
      screenModules.spotify.start();
    }
  }

  // Start nudge scheduler
  nudges = new NudgeScheduler({
    setFace,
    playOnce,
    synthesize,
    playFile,
    audioDevice: AUDIO_DEVICE,
  });
  nudges.start();

  const ninjaState = {
    get currentFace() { return 'idle'; },
    get wakeWordActive() { return wakeListener?.running || false; },
    get voiceActive() { return voiceActive; },
    conversationLog,
    framesDir: join(__dirname, '..', 'frames-new'),
    setFace,
    playOnce,
    startWakeWord: () => wakeListener?.start(),
    stopWakeWord: () => wakeListener?.stop(),
    setThought: null,
    nudges,
  };

  // Start web UI
  const app = await startWebServer(ninjaState);

  // Start HTML screens + crossscreen now that Express is running
  if (screenModules.htmlRenderer && app) {
    const { default: CrossscreenPlayer } = await import('./crossscreen/index.js');
    const crossscreen = new CrossscreenPlayer({
      sendCommand,
      setFace,
      htmlRenderer: screenModules.htmlRenderer,
    });
    crossscreen.start();
    screenModules.crossscreen = crossscreen;

    const { registerScreenRoutes } = await import('./screens/routes.js');
    registerScreenRoutes(app, screenModules.htmlRenderer, crossscreen);
    await screenModules.htmlRenderer.setScreen(0, 'clock');
    await screenModules.htmlRenderer.setScreen(2, screenModules.screen2Default);
    logger.info('HTML screen modules + crossscreen started');
  }

  // --- Hub-aware ninja behaviors ---
  let lastTrackId = null;
  let lastMailCount = 0;
  let lastCalendarAlert = null;

  async function checkHubEvents() {
    try {
      const { getNowPlaying } = await import('./integrations/spotify.js');
      const np = getNowPlaying();
      if (np?.playing && np.trackId && np.trackId !== lastTrackId) {
        lastTrackId = np.trackId;
        if (ninjaState.setThought) {
          ninjaState.setThought(`♪ ${np.track} — ${np.artist}`, 'music');
        }
      }

      const { getMailState } = await import('./integrations/mail.js');
      const ms = getMailState();
      if (ms.unread > lastMailCount && lastMailCount >= 0) {
        const diff = ms.unread - lastMailCount;
        if (diff > 0 && ninjaState.setThought) {
          ninjaState.setThought(`${diff} new mail...`, 'alert');
        }
      }
      lastMailCount = ms.unread;

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

      const { getWeather } = await import('./integrations/weather.js');
      const w = getWeather();
      // Occasionally show weather in thought bubble (every ~5 min cycle)
      if (w && w.temp != null && !np?.playing && ms.unread === lastMailCount) {
        // Only show weather if nothing more interesting is happening
      }
    } catch {}
  }

  setInterval(checkHubEvents, 10000);

  logger.info('Orchestrator running — say "Hey Cookie" to talk');

  // Handle shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down');
    idle.stop();
    setFace('sleeping');
    await new Promise(r => setTimeout(r, 500));
    displayClose();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Orchestrator failed');
  process.exit(1);
});
