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

function parseICSDate(str) {
  if (!str) return null;
  const match = str.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  if (h) {
    if (str.includes('Z')) {
      return new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s));
    }
    // Treat as local time (TZID handled by treating as local)
    return new Date(+y, +m - 1, +d, +h, +min, +s);
  }
  return new Date(+y, +m - 1, +d);
}

function parseDTLine(line) {
  // Parse DTSTART;TZID=Asia/Tokyo:20250815T123000 or DTSTART:20250815T123000Z
  if (!line) return null;
  const valPart = line.includes(':') ? line.split(':').pop() : line;
  return parseICSDate(valPart);
}

function expandRRule(rruleStr, dtStart, now, cutoff) {
  // Simple RRULE expansion for DAILY, WEEKLY, MONTHLY
  const parts = {};
  rruleStr.split(';').forEach(p => {
    const [k, v] = p.split('=');
    parts[k] = v;
  });

  const freq = parts.FREQ;
  const interval = parseInt(parts.INTERVAL || '1');
  const byday = parts.BYDAY ? parts.BYDAY.split(',') : null;
  const count = parts.COUNT ? parseInt(parts.COUNT) : null;
  const until = parts.UNTIL ? parseICSDate(parts.UNTIL) : null;

  const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const instances = [];
  const maxInstances = 100;
  let current = new Date(dtStart);
  let generated = 0;

  while (current <= cutoff && generated < maxInstances) {
    if (until && current > until) break;
    if (count && generated >= count) break;

    if (current >= now || (current.toDateString() === now.toDateString())) {
      if (freq === 'WEEKLY' && byday) {
        // Check if current day matches BYDAY
        const dayAbbr = ['SU','MO','TU','WE','TH','FR','SA'][current.getDay()];
        if (byday.includes(dayAbbr)) {
          instances.push(new Date(current));
        }
      } else {
        instances.push(new Date(current));
      }
    }

    generated++;
    if (freq === 'DAILY') {
      current = new Date(current.getTime() + interval * 86400000);
    } else if (freq === 'WEEKLY') {
      if (!byday) {
        current = new Date(current.getTime() + interval * 7 * 86400000);
      } else {
        current = new Date(current.getTime() + 86400000); // step day by day for BYDAY
      }
    } else if (freq === 'MONTHLY') {
      current = new Date(current.getFullYear(), current.getMonth() + interval, current.getDate(),
        current.getHours(), current.getMinutes(), current.getSeconds());
    } else if (freq === 'YEARLY') {
      current = new Date(current.getFullYear() + interval, current.getMonth(), current.getDate(),
        current.getHours(), current.getMinutes(), current.getSeconds());
    } else {
      break;
    }
  }

  return instances;
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

    const dtStartMatch = unfolded.match(/^(DTSTART[^:]*:.+)/m);
    const dtEndMatch = unfolded.match(/^(DTEND[^:]*:.+)/m);
    const allDay = unfolded.includes('VALUE=DATE') && !unfolded.includes('VALUE=DATE-TIME');
    const rrule = get('RRULE');

    const start = parseDTLine(dtStartMatch?.[1]);
    const end = parseDTLine(dtEndMatch?.[1]);
    const duration = (start && end) ? end.getTime() - start.getTime() : 0;

    const title = (get('SUMMARY') || '(no title)').replace(/\\\\/g, '\\').replace(/\\,/g, ',').replace(/\\n/g, ' ');
    const location = get('LOCATION')?.replace(/\\\\/g, '\\').replace(/\\,/g, ',') || null;
    const uid = get('UID') || Math.random().toString(36);

    if (!start) continue;

    if (rrule) {
      // Expand recurring events
      const instances = expandRRule(rrule, start, now, cutoff);
      for (const inst of instances) {
        const instEnd = duration ? new Date(inst.getTime() + duration) : null;
        if (instEnd && instEnd < now) continue;
        results.push({
          id: uid + '_' + inst.toISOString(),
          title, allDay, location,
          start: inst.toISOString(),
          end: instEnd?.toISOString() || null,
        });
      }
    } else {
      // Single event
      if (start > cutoff) continue;
      if (end && end < now) continue;
      if (!end && start < now && !allDay) continue;

      results.push({ id: uid, title, start: start.toISOString(), end: end?.toISOString() || null, allDay, location });
    }
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
