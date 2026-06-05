/**
 * Ninja Web UI — Express API server
 * BBS-style control panel for the Little Gamers Ninja
 */
import express from 'express';
import { execSync, exec } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { taskComplete, allTasksDone, habitChecked, allHabitsDone, streakMilestone, focusComplete, breakStart } from '../face-reactions.js';
import {
  getTasks, addTask, updateTask, deleteTask, getWorkspaces,
  getHabits, addHabit, updateHabit, checkHabit, uncheckHabit, deleteHabit,
  addFocusSession, getFocusStats,
  getConversationLog, addConversation,
} from './data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PI_ROOT = join(__dirname, '../..');
const REPO_ROOT = join(__dirname, '../../..');
const PORT = process.env.WEB_PORT || 8888;

let app = null;
let ninjaState = null; // set by orchestrator

export async function startWebServer(state) {
  ninjaState = state;

  const spotify = await import('../integrations/spotify.js');
  const calendar = await import('../integrations/calendar.js');
  const mail = await import('../integrations/mail.js');
  const weather = await import('../integrations/weather.js');

  app = express();
  app.use(express.json({ limit: '1mb' }));

  // Redirect to setup wizard if no API keys configured
  app.get('/', (req, res, next) => {
    if (req.query['skip-setup'] !== undefined) return next();
    const envPath = join(PI_ROOT, '.env');
    try {
      const env = readFileSync(envPath, 'utf-8');
      if (!env.includes('GROQ_API_KEY=') || !env.includes('ANTHROPIC_API_KEY=') ||
          env.includes('GROQ_API_KEY=your_') || env.includes('ANTHROPIC_API_KEY=your_')) {
        return res.redirect('/setup.html');
      }
    } catch {
      return res.redirect('/setup.html');
    }
    next();
  });

  app.use(express.static(join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
    }
  }));

  // --- Patreon latest post (cached) ---
  let patreonCache = { post: null, fetchedAt: 0 };
  const PATREON_CACHE_MS = 60 * 60 * 1000; // 1 hour

  async function fetchLatestPatreonPost() {
    const token = process.env.PATREON_ACCESS_TOKEN;
    if (!token) return null;
    const campaignId = '5268316';
    const baseUrl = `https://www.patreon.com/api/oauth2/v2/campaigns/${campaignId}/posts`;
    const fields = 'fields%5Bpost%5D=title,published_at,url';

    // API returns oldest first, paginate to find newest
    let cursor = '';
    let lastPost = null;
    for (let i = 0; i < 10; i++) {
      const url = `${baseUrl}?${fields}&page%5Bcount%5D=200${cursor ? `&page%5Bcursor%5D=${encodeURIComponent(cursor)}` : ''}`;
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) break;
      const data = await resp.json();
      const posts = data.data || [];
      if (posts.length > 0) lastPost = posts[posts.length - 1];
      cursor = data.meta?.pagination?.cursors?.next;
      if (!cursor) break;
    }
    if (!lastPost) return null;

    return {
      title: lastPost.attributes.title,
      date: lastPost.attributes.published_at,
      url: `https://www.patreon.com${lastPost.attributes.url}`,
    };
  }

  app.get('/api/patreon/latest', async (req, res) => {
    try {
      if (patreonCache.post && Date.now() - patreonCache.fetchedAt < PATREON_CACHE_MS) {
        return res.json(patreonCache.post);
      }
      const post = await fetchLatestPatreonPost();
      if (post) {
        patreonCache = { post, fetchedAt: Date.now() };
        return res.json(post);
      }
      res.json(null);
    } catch (e) {
      logger.warn({ err: e.message }, 'Patreon fetch failed');
      res.json(patreonCache.post || null);
    }
  });

  // --- External link redirect (works in Nativefier/Electron) ---
  app.get('/api/goto/:url', (req, res) => {
    res.redirect(302, decodeURIComponent(req.params.url));
  });

  // --- Status ---
  app.get('/api/status', (req, res) => {
    res.json({
      face: ninjaState.currentFace || 'idle',
      wakeWordActive: ninjaState.wakeWordActive || false,
      voiceActive: ninjaState.voiceActive || false,
      uptime: process.uptime(),
      conversations: ninjaState.conversationLog?.length || 0,
    });
  });

  // --- Volume ---
  app.get('/api/volume', (req, res) => {
    try {
      let out;
      try { out = execSync('amixer -c UACDemoV10 get PCM 2>/dev/null').toString(); } catch {
        out = execSync('amixer -c 0 get Speaker 2>/dev/null').toString();
      }
      const match = out.match(/\[(\d+)%\]/);
      res.json({ volume: match ? parseInt(match[1]) : 50 });
    } catch {
      res.json({ volume: 50 });
    }
  });

  // Restore saved volume on startup
  try {
    const savedVol = JSON.parse(readFileSync(join(PI_ROOT, 'data/volume.json'), 'utf-8'));
    if (savedVol.volume != null) {
      try { execSync(`amixer -c UACDemoV10 set PCM ${savedVol.volume}%`); } catch {
        try { execSync(`amixer -c 0 set Speaker ${savedVol.volume}%`); } catch {}
      }
      logger.info({ volume: savedVol.volume }, 'Volume restored');
    }
  } catch {}

  app.post('/api/volume', (req, res) => {
    const { volume } = req.body;
    if (volume == null || volume < 0 || volume > 100) return res.status(400).json({ error: 'Invalid volume' });
    try {
      // Try both card types
      try { execSync(`amixer -c UACDemoV10 set PCM ${volume}%`); } catch {
        execSync(`amixer -c 0 set Speaker ${volume}%`);
      }
      // Save for next boot
      writeFileSync(join(PI_ROOT, 'data/volume.json'), JSON.stringify({ volume }));
      // Play volume feedback with TTS voice
      (async () => {
        try {
          const { synthesize } = await import('../tts/voicevox.js');
          const { playFile } = await import('../audio/playback.js');
          const audioDevice = process.env.AUDIO_DEVICE || 'plughw:UACDemoV10,0';
          const file = await synthesize(`${volume}%`);
          if (file) await playFile(file, audioDevice);
        } catch {}
      })();
      res.json({ ok: true, volume });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Faces ---
  app.get('/api/faces', (req, res) => {
    try {
      const framesDir = ninjaState.framesDir || join(PI_ROOT, 'frames');
      const faces = readdirSync(framesDir).filter(f => {
        try { return readdirSync(join(framesDir, f)).some(ff => ff.endsWith('.jpg') || ff.endsWith('.pbm')); } catch { return false; }
      }).sort();
      res.json({ faces });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/face', (req, res) => {
    const { face, playOnce: once } = req.body;
    if (!face) return res.status(400).json({ error: 'Missing face' });
    if (once && ninjaState.playOnce) {
      ninjaState.playOnce(face).then(() => ninjaState.setFace('idle'));
      res.json({ ok: true, face, playOnce: true });
    } else if (ninjaState.setFace) {
      ninjaState.setFace(face);
      res.json({ ok: true, face });
    } else {
      res.status(500).json({ error: 'Display not connected' });
    }
  });

  // --- Wake Word ---
  app.get('/api/wake', (req, res) => {
    res.json({ active: ninjaState.wakeWordActive || false });
  });

  app.post('/api/wake', (req, res) => {
    const { active } = req.body;
    if (active && ninjaState.startWakeWord) {
      ninjaState.startWakeWord();
      res.json({ ok: true, active: true });
    } else if (!active && ninjaState.stopWakeWord) {
      ninjaState.stopWakeWord();
      res.json({ ok: true, active: false });
    } else {
      res.status(400).json({ error: 'Invalid request' });
    }
  });

  // --- Conversation Log ---
  app.get('/api/conversations', (req, res) => {
    res.json({ log: getConversationLog() });
  });

  // --- Personality ---
  const DEFAULT_PERSONALITY_PATH = join(__dirname, '../personality/ninja-base.md'); // in git, never modified
  const USER_PERSONALITY_PATH = join(PI_ROOT, 'data/personality.md'); // user-editable, survives updates

  // Copy default to user path on first run
  try {
    if (!existsSync(USER_PERSONALITY_PATH)) {
      writeFileSync(USER_PERSONALITY_PATH, readFileSync(DEFAULT_PERSONALITY_PATH, 'utf-8'));
    }
  } catch {}

  app.get('/api/personality', (req, res) => {
    try {
      const text = readFileSync(USER_PERSONALITY_PATH, 'utf-8');
      const defaultText = readFileSync(DEFAULT_PERSONALITY_PATH, 'utf-8');
      res.json({ text, isDefault: text === defaultText });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/personality', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    try {
      writeFileSync(USER_PERSONALITY_PATH, text);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/personality/reset', (req, res) => {
    try {
      const defaultText = readFileSync(DEFAULT_PERSONALITY_PATH, 'utf-8');
      writeFileSync(USER_PERSONALITY_PATH, defaultText);
      res.json({ ok: true, text: defaultText });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- TTS Settings ---
  app.get('/api/tts', (req, res) => {
    try {
      const cfg = JSON.parse(readFileSync(join(PI_ROOT, 'data/tts-config.json'), 'utf-8'));
      res.json({ voice: cfg.voice || 'ja-JP-Chirp3-HD-Fenrir', speakingRate: cfg.speakingRate || 1.1 });
    } catch {
      res.json({ voice: 'ja-JP-Chirp3-HD-Fenrir', speakingRate: 1.1 });
    }
  });

  app.post('/api/tts', (req, res) => {
    const { voice, speakingRate } = req.body;
    try {
      let cfg = {};
      try { cfg = JSON.parse(readFileSync(join(PI_ROOT, 'data/tts-config.json'), 'utf-8')); } catch {}
      if (voice) cfg.voice = voice;
      if (speakingRate) cfg.speakingRate = speakingRate;
      writeFileSync(join(PI_ROOT, 'data/tts-config.json'), JSON.stringify(cfg, null, 2));
      res.json({ ok: true, note: 'Applied immediately' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- API Keys ---
  app.get('/api/keys', (req, res) => {
    const keys = {};
    const envVars = ['GROQ_API_KEY', 'ANTHROPIC_API_KEY'];
    for (const k of envVars) {
      const val = process.env[k];
      keys[k] = val ? `${val.substring(0, 8)}...${val.slice(-4)}` : 'NOT SET';
    }
    // Check Google TTS key
    try {
      const gkey = JSON.parse(readFileSync(join(PI_ROOT, 'google-tts-key.json'), 'utf-8'));
      keys['GOOGLE_TTS'] = gkey.client_email ? `${gkey.client_email.substring(0, 20)}...` : 'NOT SET';
    } catch {
      keys['GOOGLE_TTS'] = 'NOT SET';
    }
    res.json({ keys });
  });

  app.post('/api/keys', (req, res) => {
    const { key, value } = req.body;
    if (!key || !value) return res.status(400).json({ error: 'Missing key or value' });
    const allowed = ['GROQ_API_KEY', 'ANTHROPIC_API_KEY'];
    if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid key name' });
    try {
      const envPath = join(PI_ROOT, '.env');
      let env = readFileSync(envPath, 'utf-8');
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(env)) {
        env = env.replace(regex, `${key}=${value}`);
      } else {
        env += `\n${key}=${value}\n`;
      }
      writeFileSync(envPath, env);
      process.env[key] = value;
      res.json({ ok: true, note: 'Applied immediately' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Test Buttons ---
  app.post('/api/test/speaker', async (req, res) => {
    try {
      const { synthesize } = await import('../tts/voicevox.js');
      const { playFile } = await import('../audio/playback.js');
      const audioDevice = process.env.AUDIO_DEVICE || 'plughw:UACDemoV10,0';
      const file = await synthesize('I give you happy poopy time');
      if (file) await playFile(file, audioDevice);
      res.json({ ok: true });
    } catch (e) {
      // Fallback to espeak
      const audioDevice = process.env.AUDIO_DEVICE || 'plughw:UACDemoV10,0';
      exec(`espeak-ng "Testing speaker" --stdout | aplay -D ${audioDevice}`, (err) => {
        res.json({ ok: !err });
      });
    }
  });

  app.post('/api/test/mic', (req, res) => {
    const micDevice = process.env.MIC_DEVICE || 'plughw:sndrpigooglevoi,0';
    const audioDevice = process.env.AUDIO_DEVICE || 'plughw:UACDemoV10,0';
    exec(`arecord -D ${micDevice} -f S16_LE -r 16000 -c 1 -d 1 /tmp/test_mic.wav`, (err) => {
      if (err) return res.json({ ok: false });
      exec(`aplay -D ${audioDevice} /tmp/test_mic.wav`, () => {
        res.json({ ok: true });
      });
    });
  });

  app.post('/api/test/display', (req, res) => {
    if (ninjaState.setFace) {
      ninjaState.setFace('happy');
      setTimeout(() => ninjaState.setFace('idle'), 2000);
      res.json({ ok: true });
    } else {
      res.json({ ok: false });
    }
  });

  // --- Tasks ---
  app.get('/api/tasks', (req, res) => {
    const { workspace, date } = req.query;
    let tasks = getTasks();
    if (workspace) tasks = tasks.filter(t => t.workspace === workspace);
    if (date) {
      const d = new Date(date);
      const dow = d.getDay(); // 0=Sun
      tasks = tasks.filter(t => {
        if ((t.date || '') === date) return true; // exact date match
        if (!t.date) return true; // no date = show everywhere
        if (!t.repeat) return false; // non-recurring, wrong date
        // Recurring: show if it would apply to this day
        if (t.repeat === 'daily') return true;
        if (t.repeat === 'weekdays') return dow >= 1 && dow <= 5;
        if (t.repeat === 'weekly') return new Date(t.date).getDay() === dow;
        return false;
      });
    }
    res.json({ tasks, workspaces: getWorkspaces() });
  });

  app.post('/api/tasks', (req, res) => {
    const { text, deadline, workspace, priority, date, repeat } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const task = addTask(text, deadline || null, workspace || 'default', priority || 2, date || null, repeat || null);
    if (ninjaState.setFace) {
      ninjaState.setFace('focused');
      setTimeout(() => ninjaState.setFace('idle'), 1000);
    }
    res.json({ ok: true, task });
  });

  app.put('/api/tasks/:id', (req, res) => {
    const task = updateTask(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Not found' });
    // React to task completion
    if (req.body.done && ninjaState.playOnce) {
      // Check if all tasks done
      const allDone = getTasks().every(t => t.done);
      const anim = allDone ? allTasksDone() : taskComplete();
      ninjaState.playOnce(anim).then(() => ninjaState.setFace('idle'));
    }
    res.json({ ok: true, task });
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const ok = deleteTask(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  app.post('/api/tasks/reorder', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Missing ids' });
    const tasks = getTasks();
    const reordered = ids.map(id => tasks.find(t => t.id === id)).filter(Boolean);
    tasks.forEach(t => { if (!ids.includes(t.id)) reordered.push(t); });
    writeFileSync(join(PI_ROOT, 'data/tasks.json'), JSON.stringify(reordered, null, 2));
    res.json({ ok: true });
  });

  // --- Habits ---
  app.get('/api/habits', (req, res) => {
    res.json({ habits: getHabits(req.query.date || null) });
  });

  app.post('/api/habits', (req, res) => {
    const { name, days } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const habit = addHabit(name, days || [0,1,2,3,4,5,6]);
    res.json({ ok: true, habit });
  });

  app.put('/api/habits/:id', (req, res) => {
    const habit = updateHabit(req.params.id, req.body);
    if (!habit) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, habit });
  });

  app.post('/api/habits/:id/check', (req, res) => {
    const habit = checkHabit(req.params.id, req.body.date || null);
    if (!habit) return res.status(404).json({ error: 'Not found' });
    if (ninjaState.playOnce) {
      // Check if all habits done today
      const allDone = getHabits(req.body.date).every(h => h.checkedOnDate);
      if (allDone) {
        ninjaState.playOnce(allHabitsDone()).then(() => ninjaState.setFace('idle'));
      } else if (habit.streak > 0 && habit.streak % 7 === 0) {
        ninjaState.playOnce(streakMilestone()).then(() => ninjaState.setFace('idle'));
      } else {
        ninjaState.playOnce(habitChecked()).then(() => ninjaState.setFace('idle'));
      }
    }
    res.json({ ok: true, habit });
  });

  app.post('/api/habits/:id/uncheck', (req, res) => {
    const habit = uncheckHabit(req.params.id, req.body.date || null);
    if (!habit) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, habit });
  });

  app.delete('/api/habits/:id', (req, res) => {
    const ok = deleteHabit(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  app.post('/api/habits/reorder', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Missing ids' });
    const habits = getHabits();
    const reordered = ids.map(id => habits.find(h => h.id === id)).filter(Boolean);
    habits.forEach(h => { if (!ids.includes(h.id)) reordered.push(h); });
    writeFileSync(join(PI_ROOT, 'data/habits.json'), JSON.stringify(reordered, null, 2));
    res.json({ ok: true });
  });

  // --- Focus Sessions ---
  app.post('/api/focus', (req, res) => {
    const { duration } = req.body;
    if (!duration) return res.status(400).json({ error: 'Missing duration' });
    addFocusSession(duration);
    res.json({ ok: true });
  });

  app.get('/api/focus/stats', (req, res) => {
    res.json(getFocusStats());
  });

  // --- Chat ---
  app.post('/api/chat', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    try {
      const { respondStreaming } = await import('../llm/claude-stream.js');
      const { synthesize } = await import('../tts/voicevox.js');
      const { playFile } = await import('../audio/playback.js');

      let fullText = '';
      const sentences = [];
      const onSentence = (s) => { fullText += s + ' '; sentences.push(s); };

      if (ninjaState.setFace) ninjaState.setFace('focused');
      const result = await respondStreaming(text, onSentence);
      if (!result) return res.json({ reply: 'Cannot think right now', mood: 'confused' });

      // Play TTS through speaker
      if (ninjaState.setFace) ninjaState.setFace('talking');
      for (const sentence of sentences) {
        try {
          const file = await synthesize(sentence);
          if (file) await playFile(file, 'plughw:UACDemoV10,0');
        } catch {}
      }

      const mood = result.mood || 'idle';
      if (ninjaState.setFace) {
        ninjaState.setFace(mood);
        setTimeout(() => ninjaState.setFace('idle'), 2000);
      }

      addConversation(text, fullText.trim());

      res.json({ reply: fullText.trim(), mood });
    } catch (e) {
      logger.error({ err: e.message }, 'Chat failed');
      res.json({ reply: 'Something went wrong', mood: 'confused' });
    }
  });

  // --- Daily Summary ---
  app.post('/api/summary', async (req, res) => {
    try {
      const tasks = getTasks();
      const habits = getHabits();
      const stats = getFocusStats();
      const done = tasks.filter(t => t.done).length;
      const total = tasks.length;
      const habitsDone = habits.filter(h => h.checkedOnDate).length;

      const prompt = `Give me a very brief grumpy ninja daily summary. Tasks: ${done}/${total} done. Habits: ${habitsDone}/${habits.length} done. Focus: ${stats.focusToday} minutes. Be sarcastic and short.`;

      const { respondStreaming } = await import('../llm/claude-stream.js');
      const { synthesize } = await import('../tts/voicevox.js');
      const { playFile } = await import('../audio/playback.js');

      let fullText = '';
      const sentences = [];
      const onSentence = (s) => { fullText += s + ' '; sentences.push(s); };

      if (ninjaState.setFace) ninjaState.setFace('focused');
      const result = await respondStreaming(prompt, onSentence);

      if (ninjaState.setFace) ninjaState.setFace('talking');
      for (const sentence of sentences) {
        try {
          const file = await synthesize(sentence);
          if (file) await playFile(file, 'plughw:UACDemoV10,0');
        } catch {}
      }

      if (ninjaState.setFace) {
        ninjaState.setFace(result?.mood || 'idle');
        setTimeout(() => ninjaState.setFace('idle'), 2000);
      }

      res.json({ summary: fullText.trim() });
    } catch (e) {
      logger.error({ err: e.message }, 'Summary failed');
      res.json({ summary: 'Cannot summarize right now' });
    }
  });

  app.post('/api/keys/remove-google', (req, res) => {
    try {
      const keyPath = join(PI_ROOT, 'google-tts-key.json');
      if (existsSync(keyPath)) writeFileSync(keyPath, '{}');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Setup Wizard ---
  app.post('/api/setup/google-key', (req, res) => {
    const { json } = req.body;
    if (!json) return res.status(400).json({ error: 'Missing JSON' });
    try {
      JSON.parse(json); // validate
      writeFileSync(join(PI_ROOT, 'google-tts-key.json'), json);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' });
    }
  });

  app.post('/api/setup/complete', (req, res) => {
    // Ensure .env exists with the keys
    const envPath = join(PI_ROOT, '.env');
    try {
      readFileSync(envPath, 'utf-8');
    } catch {
      writeFileSync(envPath, '');
    }
    res.json({ ok: true });
  });

  // --- Service Control ---
  app.post('/api/restart', (req, res) => {
    res.json({ ok: true, note: 'Restarting...' });
    setTimeout(() => {
      exec('sudo systemctl restart ninja.service');
    }, 500);
  });

  app.get('/api/version', (req, res) => {
    exec('cd ' + REPO_ROOT + ' && git rev-parse --short HEAD && git log -1 --format=%s', (err, stdout) => {
      if (err) return res.json({ hash: '?', message: '?' });
      const [hash, message] = stdout.trim().split('\n');
      res.json({ hash, message });
    });
  });

  app.post('/api/check-update', (req, res) => {
    exec('cd ' + REPO_ROOT + ' && git fetch origin main 2>/dev/null; git rev-parse --short HEAD; git rev-parse --short origin/main; git log HEAD..origin/main --oneline', (err, stdout) => {
      if (err) return res.json({ available: false });
      const lines = stdout.trim().split('\n').filter(l => l.trim());
      const local = lines[0];
      const remote = lines[1];
      const newCommits = lines.slice(2);
      res.json({ available: local !== remote, local, remote, commits: newCommits });
    });
  });

  app.post('/api/update', (req, res) => {
    exec('cd ' + REPO_ROOT + ' && git checkout -- . && git pull origin main', (err, stdout, stderr) => {
      if (err) return res.json({ ok: false, output: stderr });
      const output = stdout.trim();
      logger.info({ output }, 'Git pull');
      if (output.includes('Already up to date')) {
        return res.json({ ok: true, output, restarting: false });
      }
      res.json({ ok: true, output, restarting: true });
      setTimeout(() => {
        exec('sudo systemctl restart ninja.service');
      }, 2000);
    });
  });

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

  // Album art proxy — downloads, resizes to 150x150, serves as raw RGB565
  let artCache = { url: null, data: null };
  app.get('/api/spotify/albumart', async (req, res) => {
    const np = spotify.getNowPlaying();
    const artUrl = np?.albumArt || np?.albumArtSmall;
    if (!artUrl) return res.status(404).send('No art');

    try {
      // Return cached if same URL
      if (artCache.url === artUrl && artCache.data) {
        res.set('Content-Type', 'application/octet-stream');
        return res.send(artCache.data);
      }

      const { execSync } = await import('child_process');
      // Use Python to download, resize, convert to RGB565
      const script = `
import sys, struct, urllib.request
from PIL import Image
from io import BytesIO
url = sys.argv[1]
data = urllib.request.urlopen(url).read()
img = Image.open(BytesIO(data)).resize((150, 150)).convert('RGB')
import numpy as np
arr = np.array(img, dtype=np.uint16)
rgb565 = ((arr[:,:,0] >> 3) << 11) | ((arr[:,:,1] >> 2) << 5) | (arr[:,:,2] >> 3)
sys.stdout.buffer.write(rgb565.astype('>u2').tobytes())
`;
      const result = execSync(`python3 -c '${script.replace(/'/g, "'\\''")}' '${artUrl}'`, {
        maxBuffer: 150 * 150 * 2 + 1024,
        timeout: 5000,
      });

      artCache = { url: artUrl, data: result };
      res.set('Content-Type', 'application/octet-stream');
      res.send(result);
    } catch (e) {
      logger.warn({ err: e.message }, 'Album art proxy failed');
      res.status(500).send('Failed');
    }
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

  // --- Weather ---
  app.get('/api/weather', (req, res) => {
    res.json(weather.getWeather() || { temp: null });
  });

  app.get('/api/weather/status', (req, res) => {
    res.json({ connected: weather.isConnected() });
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
      weather: { connected: weather.isConnected(), ...weather.getWeather() },
      ninja: { thought: currentThought, face: ninjaState.currentFace },
    });
  });

  // Start polling for connected integrations
  spotify.startPolling();
  calendar.startPolling();
  mail.startPolling();
  weather.startPolling();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Web UI running');
  });
}
