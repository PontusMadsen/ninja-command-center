/**
 * CalDAV calendar integration — works with iCloud, Google, Nextcloud, etc.
 * 
 * Configure via .env:
 *   CALDAV_URL=https://caldav.icloud.com
 *   CALDAV_USERNAME=your@icloud.com
 *   CALDAV_PASSWORD=app-specific-password
 */

import { createDAVClient } from 'tsdav';
import pino from 'pino';

const logger = pino({ name: 'caldav' });

let events = [];
let pollingTimer = null;
let client = null;
let calendars = [];

function getConfig() {
  return {
    serverUrl: process.env.CALDAV_URL || '',
    credentials: {
      username: process.env.CALDAV_USERNAME || '',
      password: process.env.CALDAV_PASSWORD || '',
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  };
}

export function isConnected() {
  return Boolean(process.env.CALDAV_URL && process.env.CALDAV_USERNAME);
}

async function initClient() {
  if (client) return;
  if (!isConnected()) return;

  try {
    const config = getConfig();
    client = await createDAVClient(config);
    calendars = await client.fetchCalendars();
    logger.info({ calendars: calendars.length }, 'CalDAV connected');
  } catch (e) {
    logger.error({ err: e.message }, 'CalDAV connection failed');
    client = null;
  }
}

function parseICSDate(str) {
  if (!str) return null;
  // Handle DTSTART;VALUE=DATE:20260617 and DTSTART:20260617T100000Z
  const match = str.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  if (h) {
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}${str.includes('Z') ? 'Z' : ''}`);
  }
  return new Date(`${y}-${m}-${d}`);
}

function parseVEvent(data) {
  const events = [];
  const vevents = data.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  for (const vevent of vevents) {
    const get = (key) => {
      const match = vevent.match(new RegExp(`${key}[^:]*:(.+)`));
      return match ? match[1].trim() : null;
    };

    const dtStart = get('DTSTART');
    const dtEnd = get('DTEND');
    const allDay = vevent.includes('VALUE=DATE') && !vevent.includes('VALUE=DATE-TIME');

    events.push({
      id: get('UID') || Math.random().toString(36),
      title: get('SUMMARY') || '(no title)',
      start: parseICSDate(dtStart)?.toISOString() || null,
      end: parseICSDate(dtEnd)?.toISOString() || null,
      allDay,
      location: get('LOCATION') || null,
    });
  }

  return events;
}

async function fetchEvents() {
  if (!isConnected()) return;
  await initClient();
  if (!client || !calendars.length) return;

  try {
    const now = new Date();
    const timeMax = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const allEvents = [];
    for (const cal of calendars) {
      try {
        const objects = await client.fetchCalendarObjects({
          calendar: cal,
          timeRange: {
            start: now.toISOString(),
            end: timeMax.toISOString(),
          },
        });

        for (const obj of objects) {
          if (obj.data) {
            const parsed = parseVEvent(obj.data);
            allEvents.push(...parsed);
          }
        }
      } catch (e) {
        logger.warn({ calendar: cal.displayName, err: e.message }, 'Failed to fetch calendar');
      }
    }

    // Sort by start time, filter future events
    events = allEvents
      .filter(e => e.start && new Date(e.start) >= now)
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 10);

    logger.info({ count: events.length }, 'CalDAV events refreshed');
  } catch (e) {
    logger.error({ err: e.message }, 'CalDAV fetch failed');
  }
}

export function getEvents() {
  return events;
}

export function getNextEvent() {
  return events[0] || null;
}

export function startPolling(intervalMs = 60000) {
  if (pollingTimer) return;
  fetchEvents();
  pollingTimer = setInterval(fetchEvents, intervalMs);
  logger.info({ intervalMs }, 'CalDAV polling started');
}

export function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
