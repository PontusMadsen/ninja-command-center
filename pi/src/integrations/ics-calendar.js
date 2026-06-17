/**
 * ICS Calendar feed integration — fetches public/published calendars.
 * Supports webcal:// and https:// URLs. Multiple feeds supported.
 * 
 * Configure via .env:
 *   CALENDAR_FEEDS=webcal://url1,webcal://url2,webcal://url3
 */

import pino from 'pino';

const logger = pino({ name: 'ics-calendar' });

let events = [];
let pollingTimer = null;

function getFeeds() {
  const raw = process.env.CALENDAR_FEEDS || '';
  return raw.split(',').map(u => u.trim()).filter(Boolean);
}

export function isConnected() {
  return getFeeds().length > 0;
}

function parseICSDate(str, tzid) {
  if (!str) return null;
  const match = str.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  if (h) {
    if (str.includes('Z')) {
      return new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s));
    }
    // Treat as local time
    return new Date(+y, +m - 1, +d, +h, +min, +s);
  }
  return new Date(+y, +m - 1, +d);
}

function parseICS(icsText) {
  const results = [];
  const vevents = icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  const now = new Date();
  const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days ahead

  for (const vevent of vevents) {
    // Unfold long lines (RFC 5545: lines starting with space are continuations)
    const unfolded = vevent.replace(/\r?\n[ \t]/g, '');

    const get = (key) => {
      const match = unfolded.match(new RegExp(`^${key}[^:]*:(.+)`, 'm'));
      return match ? match[1].trim() : null;
    };

    const dtStartLine = unfolded.match(/^DTSTART[^:]*:(.+)/m);
    const dtEndLine = unfolded.match(/^DTEND[^:]*:(.+)/m);
    const allDay = unfolded.includes('VALUE=DATE') && !unfolded.includes('VALUE=DATE-TIME');

    const start = parseICSDate(dtStartLine?.[1]);
    const end = parseICSDate(dtEndLine?.[1]);

    // Skip past events and events too far in future
    if (!start || start > cutoff) continue;
    if (end && end < now) continue;
    if (!end && start < now && !allDay) continue;

    results.push({
      id: get('UID') || Math.random().toString(36),
      title: (get('SUMMARY') || '(no title)').replace(/\\\\/g, '\\').replace(/\\,/g, ',').replace(/\\n/g, ' '),
      start: start.toISOString(),
      end: end?.toISOString() || null,
      allDay,
      location: get('LOCATION')?.replace(/\\\\/g, '\\').replace(/\\,/g, ',') || null,
    });
  }

  return results;
}

async function fetchFeed(url) {
  // Convert webcal:// to https://
  const httpUrl = url.replace(/^webcal:\/\//, 'https://');

  try {
    const res = await fetch(httpUrl, {
      headers: { 'User-Agent': 'NinjaCommandCenter/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    return parseICS(text);
  } catch (e) {
    logger.warn({ url: url.substring(0, 60), err: e.message }, 'Feed fetch failed');
    return [];
  }
}

async function fetchAll() {
  const feeds = getFeeds();
  if (!feeds.length) return;

  const allEvents = [];
  for (const feed of feeds) {
    const feedEvents = await fetchFeed(feed);
    allEvents.push(...feedEvents);
  }

  // Sort by start, dedupe by ID
  const seen = new Set();
  events = allEvents
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .slice(0, 20);

  logger.info({ feeds: feeds.length, events: events.length }, 'Calendar feeds refreshed');
}

export function getEvents() {
  return events;
}

export function getNextEvent() {
  const now = new Date();
  return events.find(e => new Date(e.start) >= now) || null;
}

export function startPolling(intervalMs = 300_000) { // every 5 min
  if (pollingTimer) return;
  fetchAll();
  pollingTimer = setInterval(fetchAll, intervalMs);
  logger.info({ intervalMs, feeds: getFeeds().length }, 'ICS calendar polling started');
}

export function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
