import SpotifyWebApi from 'spotify-web-api-node';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(__dirname, '../../data/spotify-tokens.json');
const logger = pino({ name: 'spotify' });

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
];

const spotify = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

let nowPlaying = { playing: false };
let pollingTimer = null;
let connected = false;

// --- Token persistence ---

async function saveTokens(tokens) {
  await mkdir(dirname(TOKENS_PATH), { recursive: true });
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

async function loadTokens() {
  try {
    const raw = await readFile(TOKENS_PATH, 'utf-8');
    const tokens = JSON.parse(raw);
    if (tokens.accessToken) spotify.setAccessToken(tokens.accessToken);
    if (tokens.refreshToken) spotify.setRefreshToken(tokens.refreshToken);
    connected = true;
    logger.info('Loaded Spotify tokens from disk');
  } catch {
    // No saved tokens — that's fine
  }
}

async function refreshAccessToken() {
  try {
    const data = await spotify.refreshAccessToken();
    const accessToken = data.body.access_token;
    spotify.setAccessToken(accessToken);

    const tokens = {
      accessToken,
      refreshToken: spotify.getRefreshToken(),
    };
    await saveTokens(tokens);
    logger.info('Spotify access token refreshed');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh Spotify access token');
    connected = false;
    throw err;
  }
}

// --- Auth ---

export function getAuthUrl() {
  return spotify.createAuthorizeURL(SCOPES, 'ninja');
}

export async function handleCallback(code) {
  const data = await spotify.authorizationCodeGrant(code);
  const { access_token: accessToken, refresh_token: refreshToken } = data.body;

  spotify.setAccessToken(accessToken);
  spotify.setRefreshToken(refreshToken);

  await saveTokens({ accessToken, refreshToken });
  connected = true;
  logger.info('Spotify OAuth complete, tokens saved');
}

// --- Now Playing ---

function parseTrack(item, isPlaying, progressMs) {
  if (!item) return { playing: false };

  const images = item.album?.images || [];
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));

  return {
    playing: isPlaying,
    track: item.name,
    artist: (item.artists || []).map((a) => a.name).join(', '),
    album: item.album?.name || '',
    albumArt: sorted[0]?.url || '',
    albumArtSmall: sorted[sorted.length - 1]?.url || '',
    progressMs: progressMs || 0,
    durationMs: item.duration_ms || 0,
    trackId: item.id || '',
  };
}

async function fetchNowPlaying() {
  try {
    const data = await spotify.getMyCurrentPlaybackState();

    if (!data.body || !data.body.item) {
      nowPlaying = { playing: false };
    } else {
      nowPlaying = parseTrack(
        data.body.item,
        data.body.is_playing,
        data.body.progress_ms,
      );
    }
  } catch (err) {
    if (err.statusCode === 401) {
      await refreshAccessToken();
      return fetchNowPlaying();
    }
    logger.error({ err }, 'Error fetching now playing');
  }
}

export function getNowPlaying() {
  return nowPlaying;
}

// --- Playback control ---

export async function control(action) {
  async function exec() {
    switch (action) {
      case 'play':
        await spotify.play();
        break;
      case 'pause':
        await spotify.pause();
        break;
      case 'next':
        await spotify.skipToNext();
        break;
      case 'prev':
        await spotify.skipToPrevious();
        break;
      default:
        throw new Error(`Unknown Spotify action: ${action}`);
    }
  }

  try {
    await exec();
  } catch (err) {
    if (err.statusCode === 401) {
      await refreshAccessToken();
      await exec();
    } else {
      throw err;
    }
  }

  // Wait for Spotify state to settle, then fetch updated state
  await new Promise((r) => setTimeout(r, 500));
  await fetchNowPlaying();
  return nowPlaying;
}

// --- Connection status ---

export function isConnected() {
  return connected;
}

// --- Polling ---

export function startPolling(intervalMs = 3000) {
  if (pollingTimer) return;
  logger.info({ intervalMs }, 'Starting Spotify now-playing polling');
  fetchNowPlaying();
  pollingTimer = setInterval(fetchNowPlaying, intervalMs);
}

export function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    logger.info('Stopped Spotify now-playing polling');
  }
}

// Load tokens on import
loadTokens();
