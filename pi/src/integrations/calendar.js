import { google } from 'googleapis';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../google-calendar-key.json');
const logger = pino({ name: 'calendar' });

let events = [];
let pollingTimer = null;

// --- Auth ---

function createAuth() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return auth;
}

// --- Fetch ---

async function fetchEvents() {
  try {
    const auth = createAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const timeMax = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const res = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    events = (res.data.items || []).map((ev) => ({
      id: ev.id,
      title: ev.summary || '(no title)',
      start: ev.start.dateTime || ev.start.date,
      end: ev.end.dateTime || ev.end.date,
      allDay: !ev.start.dateTime,
      location: ev.location || null,
    }));

    logger.info({ count: events.length }, 'calendar events refreshed');
  } catch (err) {
    logger.error({ err: err.message }, 'failed to fetch calendar events');
  }
}

// --- Public API ---

export function getEvents() {
  return events;
}

export function getNextEvent() {
  return events[0] || null;
}

export function isConnected() {
  return existsSync(KEY_PATH);
}

export function startPolling(intervalMs = 60000) {
  if (pollingTimer) return;
  fetchEvents();
  pollingTimer = setInterval(fetchEvents, intervalMs);
  logger.info({ intervalMs }, 'calendar polling started');
}

export function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    logger.info('calendar polling stopped');
  }
}
