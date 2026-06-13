// lib/planner/ics.js
// Fetches and parses ICS calendar events for a given date.
// Uses node-ical with a 15-minute in-memory cache.
// BISA_ICS_URL empty → icsConnected:false, events:[].
// Network errors keep the last cache entry and log once.

'use strict';

const nodeIcal = require('node-ical');

const ICS_URL   = process.env.BISA_ICS_URL || '';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

// { data: raw ical events map, fetchedAt: timestamp }
let cache = null;
let lastErrorLogged = 0;

/**
 * Expand a single VEVENT (possibly recurring) into concrete occurrences
 * that fall on the given date string (YYYY-MM-DD), America/Sao_Paulo-safe
 * by working with local midnight boundaries.
 */
function expandEventOnDate(event, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Local midnight boundaries for the requested day
  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const dayEnd   = new Date(year, month - 1, day, 23, 59, 59, 999);

  const occurrences = [];

  if (event.type !== 'VEVENT') return occurrences;

  // node-ical expands RRULEs into separate keyed events with the same uid;
  // each one has its own start/end. We just check if this occurrence overlaps.
  const start = event.start;
  const end   = event.end || event.start;

  if (!(start instanceof Date)) return occurrences;

  // All-day events have start.dateOnly === true (node-ical convention)
  const allDay = !!event.start.dateOnly;

  if (allDay) {
    // All-day: start is midnight UTC of the day; compare date strings
    const evDateStr = start.toISOString().slice(0, 10);
    if (evDateStr === dateStr) {
      occurrences.push({
        start: null,
        end:   null,
        title: event.summary || '(sem título)',
        allDay: true,
      });
    }
  } else {
    // Timed event: check if it overlaps the requested day in local time
    if (start <= dayEnd && end >= dayStart) {
      occurrences.push({
        start: start.toISOString(),
        end:   end.toISOString(),
        title: event.summary || '(sem título)',
        allDay: false,
      });
    }
  }

  return occurrences;
}

/**
 * Fetch (or return cached) raw ical data using the provided fetcher function.
 * fetcher(url) must return a Promise resolving to a node-ical events map.
 * Defaults to nodeIcal.async.fromURL.
 */
async function fetchRaw(url, fetcher) {
  const fn = fetcher || nodeIcal.async.fromURL;
  const now = Date.now();
  if (cache && (now - cache.fetchedAt) < CACHE_TTL) return cache.data;

  try {
    const data = await fn(url);
    cache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    const sinceLastLog = now - lastErrorLogged;
    if (sinceLastLog > 60 * 60 * 1000) { // log at most once per hour
      console.error('[planner/ics] fetch error:', err.message);
      lastErrorLogged = now;
    }
    // Keep stale cache if available
    if (cache) return cache.data;
    return {};
  }
}

/**
 * Get calendar events for a specific date.
 * @param {string} dateStr  YYYY-MM-DD
 * @param {Function} [fetcher]  Injected for tests (avoids real network call)
 * @returns {Promise<{ icsConnected: boolean, events: Array }>}
 */
async function getEventsForDate(dateStr, fetcher) {
  if (!ICS_URL) {
    return { icsConnected: false, events: [] };
  }

  const data = await fetchRaw(ICS_URL, fetcher);
  const events = [];

  for (const key of Object.keys(data)) {
    const event = data[key];
    const occs = expandEventOnDate(event, dateStr);
    events.push(...occs);
  }

  // Sort by start time (all-day first, then chronological)
  events.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    if (!a.start || !b.start) return 0;
    return a.start.localeCompare(b.start);
  });

  return { icsConnected: true, events };
}

/** Expose cache control for tests */
function clearCache() { cache = null; }

module.exports = { getEventsForDate, clearCache };
