// tests/planner-unit.test.js
// Unit tests for lib/planner: quick-add parsing, rollover idempotence,
// highlight single-slot, week-goal listing, and ICS module with injected fetcher.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os     = require('node:os');
const fs     = require('node:fs');
const path   = require('node:path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bisa-planner-'));
  return d;
}

/** Today's date string in local time (YYYY-MM-DD). */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Offset today by N days → YYYY-MM-DD. */
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Next occurrence of a weekday (0=Sun). */
function nextWeekday(targetDow) {
  const now = new Date();
  const todayDow = now.getDay();
  let diff = targetDow - todayDow;
  if (diff <= 0) diff += 7;
  return dayOffset(diff);
}

// ---------------------------------------------------------------------------
// Quick-add parsing (≥10 cases)
// ---------------------------------------------------------------------------

describe('parseQuickAdd', () => {
  const { parseQuickAdd } = require('../lib/planner/quickadd');

  test('plain text → today, no block, no tags', () => {
    const r = parseQuickAdd('pagar boleto');
    assert.equal(r.date, null);          // null → caller uses today
    assert.equal(r.block, null);
    assert.deepEqual(r.tags, []);
    assert.equal(r.text, 'pagar boleto');
  });

  test('amanhã 15h dentista #saude', () => {
    const r = parseQuickAdd('amanhã 15h dentista #saude');
    assert.equal(r.date, dayOffset(1));
    assert.equal(r.block, 'afternoon');
    assert.equal(r.text, '15:00 dentista');
    assert.deepEqual(r.tags, ['saude']);
  });

  test('amanha (without accent) works too', () => {
    const r = parseQuickAdd('amanha dentista');
    assert.equal(r.date, dayOffset(1));
  });

  test('hoje with time → morning block', () => {
    const r = parseQuickAdd('hoje 9h academia');
    assert.equal(r.date, todayStr());
    assert.equal(r.block, 'morning');
    assert.equal(r.text, '09:00 academia');
  });

  test('seg comprar presente → next Monday, no block', () => {
    const r = parseQuickAdd('seg comprar presente do Jonas');
    assert.equal(r.date, nextWeekday(1));
    assert.equal(r.block, null);
    assert.equal(r.text, 'comprar presente do Jonas');
  });

  test('segunda → next Monday', () => {
    const r = parseQuickAdd('segunda reunião com Maria');
    assert.equal(r.date, nextWeekday(1));
  });

  test('ter = terça → next Tuesday', () => {
    const r = parseQuickAdd('ter dentista');
    assert.equal(r.date, nextWeekday(2));
    assert.equal(r.text, 'dentista');
  });

  test('sexta 10h reunião #trabalho → morning, tag', () => {
    const r = parseQuickAdd('sexta 10h reunião #trabalho');
    assert.equal(r.date, nextWeekday(5));
    assert.equal(r.block, 'morning');
    assert.ok(r.text.startsWith('10:00'));
    assert.deepEqual(r.tags, ['trabalho']);
  });

  test('DD/MM literal date', () => {
    const now = new Date();
    const d   = String(now.getDate()).padStart(2, '0');
    const m   = String(now.getMonth() + 1).padStart(2, '0');
    const r   = parseQuickAdd(`${d}/${m} compras`);
    // Should parse the date (same day this year)
    assert.ok(r.date !== null, 'date should be set from DD/MM');
    assert.equal(r.text, 'compras');
  });

  test('time 15:30 → afternoon block, HH:MM prefix', () => {
    const r = parseQuickAdd('hoje 15:30 consulta');
    assert.equal(r.block, 'afternoon');
    assert.equal(r.text, '15:30 consulta');
  });

  test('time 9h30 format → morning, HH:MM prefix', () => {
    const r = parseQuickAdd('hoje 9h30 café com Jonas');
    assert.equal(r.block, 'morning');
    assert.equal(r.text, '09:30 café com Jonas');
  });

  test('multiple tags extracted', () => {
    const r = parseQuickAdd('hoje comprar #mercado #casa leite');
    assert.deepEqual(r.tags.sort(), ['casa', 'mercado']);
  });

  test('tag accent normalisation: #saúde → saude', () => {
    const r = parseQuickAdd('amanhã check-up #saúde');
    assert.deepEqual(r.tags, ['saude']);
  });
});

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

describe('store helpers', () => {
  const storeLib = require('../lib/planner/store');

  test('genTaskId starts with t- and is 10 chars', () => {
    const id = storeLib.genTaskId();
    assert.match(id, /^t-[0-9a-f]{8}$/);
  });

  test('isoWeek returns correct format', () => {
    const w = storeLib.isoWeek('2026-06-12');
    assert.match(w, /^\d{4}-W\d{2}$/);
    // 2026-06-12 is week 24
    assert.equal(w, '2026-W24');
  });

  test('load returns empty state when file missing', () => {
    const dir = tmpDir();
    const s = storeLib.load(dir);
    assert.deepEqual(s, { days: {}, week: {}, tasks: {}, lastRollover: null });
  });

  test('save + load round-trip', () => {
    const dir = tmpDir();
    const state = storeLib.load(dir);
    state.tasks['t-aabbccdd'] = { text: 'test', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    storeLib.save(dir, state);
    const loaded = storeLib.load(dir);
    assert.ok(loaded.tasks['t-aabbccdd']);
    assert.equal(loaded.tasks['t-aabbccdd'].text, 'test');
  });

  test('atomic write uses tmp then renames', () => {
    const dir   = tmpDir();
    const state = storeLib.load(dir);
    storeLib.save(dir, state);
    const file = path.join(dir, '.meta', 'planner.json');
    assert.ok(fs.existsSync(file));
    // No tmp file should remain
    const files = fs.readdirSync(path.join(dir, '.meta'));
    assert.equal(files.filter((f) => f.endsWith('.tmp.json')).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

describe('rollover', () => {
  const storeLib = require('../lib/planner/store');
  const makePlanner = require('../lib/planner');

  /** Build a minimal no-op requireAuth middleware. */
  function noAuth(req, res, next) { next(); }
  function noDispatch() {}

  /** Call GET /planner/day for a date, returning the JSON response. */
  async function getDay(router, date) {
    return new Promise((resolve, reject) => {
      const req  = { query: { date }, headers: {} };
      const body = {};
      req.headers = {};
      // Minimal mock request/response
      const res = {
        _status: 200,
        _body:   null,
        status(code) { this._status = code; return this; },
        json(data)   { this._body = data; resolve(data); },
      };
      // Find GET /planner/day route handler by running router's stack
      // We use a minimal dispatcher instead of supertest
      router.handle(
        Object.assign(req, {
          method: 'GET',
          url:    `/planner/day?date=${date}`,
          path:   '/planner/day',
          query:  { date },
          app:    { get: () => {} },
          socket: { remoteAddress: '127.0.0.1' },
        }),
        res,
        (err) => err ? reject(err) : resolve(res._body),
      );
    });
  }

  test('tasks from past days move to today on first GET', async () => {
    const cwd = tmpDir();

    // Seed: one non-done task from yesterday
    const yesterday = dayOffset(-1);
    const state     = storeLib.load(cwd);
    const id        = 't-deadbeef';
    state.tasks[id] = { text: 'task from yesterday', done: false, created: yesterday + 'T08:00:00.000Z', rolledFrom: null, tags: [] };
    storeLib.ensureDay(state, yesterday);
    state.days[yesterday].blocks.morning.push(id);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });

    const resp = await getDay(router, todayStr());

    // Task should now appear in unplanned (not in morning/afternoon)
    const allTasks = [...resp.blocks.morning, ...resp.blocks.afternoon, ...resp.unplanned];
    const ids = allTasks.map((t) => t.id);
    assert.ok(ids.includes(id), 'rolled task should appear today');

    // rolledFrom set
    const rolled = allTasks.find((t) => t.id === id);
    assert.equal(rolled.rolledFrom, yesterday);
  });

  test('rollover is idempotent (runs only once per day)', async () => {
    const cwd       = tmpDir();
    const yesterday = dayOffset(-1);
    const state     = storeLib.load(cwd);
    const id        = 't-deadbee2';
    state.tasks[id] = { text: 'task2', done: false, created: yesterday + 'T08:00:00.000Z', rolledFrom: null, tags: [] };
    storeLib.ensureDay(state, yesterday);
    state.days[yesterday].blocks.morning.push(id);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });

    await getDay(router, todayStr());
    await getDay(router, todayStr()); // second call

    // rolledFrom should still be yesterday, not overwritten
    const s2 = storeLib.load(cwd);
    assert.equal(s2.tasks[id].rolledFrom, yesterday);
    // lastRollover marker set
    assert.equal(s2.lastRollover, todayStr());
  });

  test('done tasks are NOT rolled over', async () => {
    const cwd       = tmpDir();
    const yesterday = dayOffset(-1);
    const state     = storeLib.load(cwd);
    const id        = 't-done0001';
    state.tasks[id] = { text: 'done task', done: true, created: yesterday + 'T08:00:00.000Z', rolledFrom: null, tags: [] };
    storeLib.ensureDay(state, yesterday);
    state.days[yesterday].blocks.morning.push(id);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });
    await getDay(router, todayStr());

    const s2 = storeLib.load(cwd);
    // Task should still be in yesterday's morning, not rolled
    assert.ok((s2.days[yesterday] || { blocks: { morning: [] } }).blocks.morning.includes(id));
    assert.equal(s2.tasks[id].rolledFrom, null);
  });
});

// ---------------------------------------------------------------------------
// Highlight single-slot
// ---------------------------------------------------------------------------

describe('highlight', () => {
  const storeLib   = require('../lib/planner/store');
  const makePlanner = require('../lib/planner');
  const express    = require('express');

  function noAuth(req, res, next) { next(); }
  function noDispatch() {}

  /** Call POST via router handle mock. */
  function callPost(router, urlPath, body) {
    return new Promise((resolve, reject) => {
      const req = {
        method:  'POST',
        url:     urlPath,
        path:    urlPath.split('?')[0],
        query:   {},
        body,
        headers: {},
        app:     { get: () => {} },
        socket:  { remoteAddress: '127.0.0.1' },
      };
      const res = {
        _status: 200,
        status(c) { this._status = c; return this; },
        json(d)   { resolve({ status: this._status, body: d }); },
      };
      router.handle(req, res, (err) => err ? reject(err) : resolve(null));
    });
  }

  test('promoting a new task as highlight demotes the previous one', async () => {
    const cwd   = tmpDir();
    const today = todayStr();
    const state = storeLib.load(cwd);

    // Create two tasks placed in morning
    const id1 = 't-hlt00001';
    const id2 = 't-hlt00002';
    state.tasks[id1] = { text: 'task 1', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    state.tasks[id2] = { text: 'task 2', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    storeLib.ensureDay(state, today);
    state.days[today].blocks.morning.push(id1, id2);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });

    // Promote id1 as highlight
    await callPost(router, '/planner/promote', { id: id1, scope: 'highlight', on: true });
    const s1 = storeLib.load(cwd);
    assert.equal(s1.days[today].highlight, id1);

    // Promote id2 → id1 should be demoted
    await callPost(router, '/planner/promote', { id: id2, scope: 'highlight', on: true });
    const s2 = storeLib.load(cwd);
    assert.equal(s2.days[today].highlight, id2, 'id2 should be highlight now');
  });

  test('de-promoting highlight clears it', async () => {
    const cwd   = tmpDir();
    const today = todayStr();
    const state = storeLib.load(cwd);
    const id1   = 't-hlt00003';
    state.tasks[id1] = { text: 'task hl', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    storeLib.ensureDay(state, today);
    state.days[today].blocks.morning.push(id1);
    state.days[today].highlight = id1;
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });
    await callPost(router, '/planner/promote', { id: id1, scope: 'highlight', on: false });

    const s2 = storeLib.load(cwd);
    assert.equal(s2.days[today].highlight, null);
  });
});

// ---------------------------------------------------------------------------
// Week-goal listing
// ---------------------------------------------------------------------------

describe('week goals', () => {
  const storeLib   = require('../lib/planner/store');
  const makePlanner = require('../lib/planner');

  function noAuth(req, res, next) { next(); }
  function noDispatch() {}

  function callPost(router, urlPath, body) {
    return new Promise((resolve, reject) => {
      const req = {
        method: 'POST', url: urlPath, path: urlPath.split('?')[0], query: {},
        body, headers: {}, app: { get: () => {} }, socket: { remoteAddress: '127.0.0.1' },
      };
      const res = {
        _status: 200,
        status(c) { this._status = c; return this; },
        json(d)   { resolve({ status: this._status, body: d }); },
      };
      router.handle(req, res, (err) => err ? reject(err) : resolve(null));
    });
  }

  function callGet(router, url) {
    return new Promise((resolve, reject) => {
      const [p, qs] = url.split('?');
      const query = {};
      if (qs) for (const pair of qs.split('&')) { const [k, v] = pair.split('='); query[k] = v; }
      const req = {
        method: 'GET', url, path: p, query,
        headers: {}, app: { get: () => {} }, socket: { remoteAddress: '127.0.0.1' },
      };
      const res = {
        _status: 200,
        status(c) { this._status = c; return this; },
        json(d)   { resolve({ status: this._status, body: d }); },
      };
      router.handle(req, res, (err) => err ? reject(err) : resolve(null));
    });
  }

  test('promoting task to week scope adds it to weekGoals in GET /planner/day', async () => {
    const cwd   = tmpDir();
    const today = todayStr();
    const state = storeLib.load(cwd);
    const id    = 't-wkgoal01';
    state.tasks[id] = { text: 'meta da semana', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    storeLib.ensureDay(state, today);
    state.days[today].blocks.morning.push(id);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });

    await callPost(router, '/planner/promote', { id, scope: 'week', on: true });
    const resp = await callGet(router, `/planner/day?date=${today}`);
    const goalIds = resp.body.weekGoals.map((t) => t.id);
    assert.ok(goalIds.includes(id));
  });

  test('GET /planner/week returns weekGoals for the week', async () => {
    const cwd   = tmpDir();
    const today = todayStr();
    const state = storeLib.load(cwd);
    const id    = 't-wkgoal02';
    state.tasks[id] = { text: 'meta semanal 2', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    const weekKey = storeLib.isoWeek(today);
    storeLib.ensureWeek(state, weekKey);
    state.week[weekKey].goals.push(id);
    storeLib.ensureDay(state, today);
    state.days[today].blocks.morning.push(id);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });
    const resp = await callGet(router, '/planner/week');
    const goalIds = resp.body.weekGoals.map((t) => t.id);
    assert.ok(goalIds.includes(id));
  });

  test('removing week scope removes from weekGoals', async () => {
    const cwd     = tmpDir();
    const today   = todayStr();
    const state   = storeLib.load(cwd);
    const id      = 't-wkgoal03';
    const weekKey = storeLib.isoWeek(today);
    state.tasks[id] = { text: 'remove me', done: false, created: new Date().toISOString(), rolledFrom: null, tags: [] };
    storeLib.ensureWeek(state, weekKey);
    state.week[weekKey].goals.push(id);
    storeLib.ensureDay(state, today);
    state.days[today].blocks.morning.push(id);
    storeLib.save(cwd, state);

    const { router } = makePlanner({ requireAuth: noAuth, CWD: cwd, dispatchNotification: noDispatch, quickAddLlm: null });
    await callPost(router, '/planner/promote', { id, scope: 'week', on: false });

    const s2 = storeLib.load(cwd);
    assert.ok(!(s2.week[weekKey].goals || []).includes(id));
  });
});

// ---------------------------------------------------------------------------
// ICS module with injected fetcher (no network)
// ---------------------------------------------------------------------------

describe('ICS module', () => {
  // Reset module cache to get fresh state with cleared ICS_URL
  let icsModule;

  // Fixture: a timed event on 2026-06-12 and an all-day event on 2026-06-13
  function makeFakeData() {
    return {
      'event1': {
        type:    'VEVENT',
        summary: 'Reunião de trabalho',
        start:   Object.assign(new Date('2026-06-12T14:00:00'), { dateOnly: false }),
        end:     Object.assign(new Date('2026-06-12T15:00:00'), { dateOnly: false }),
      },
      'event2': {
        type:    'VEVENT',
        summary: 'Aniversário da Ana',
        start:   Object.assign(new Date('2026-06-13T00:00:00Z'), { dateOnly: true }),
        end:     Object.assign(new Date('2026-06-14T00:00:00Z'), { dateOnly: true }),
      },
      'non-event': {
        type: 'VCALENDAR',
      },
    };
  }

  test('empty ICS_URL returns icsConnected:false and empty events', async () => {
    // Temporarily unset env var
    const saved = process.env.BISA_ICS_URL;
    delete process.env.BISA_ICS_URL;
    // Clear module cache so the module re-reads env
    delete require.cache[require.resolve('../lib/planner/ics')];
    icsModule = require('../lib/planner/ics');

    const result = await icsModule.getEventsForDate('2026-06-12');
    assert.equal(result.icsConnected, false);
    assert.deepEqual(result.events, []);

    process.env.BISA_ICS_URL = saved || '';
  });

  test('timed event on matching date is returned', async () => {
    process.env.BISA_ICS_URL = 'https://fake.example.com/calendar.ics';
    delete require.cache[require.resolve('../lib/planner/ics')];
    icsModule = require('../lib/planner/ics');
    icsModule.clearCache();

    const fakeFetcher = async () => makeFakeData();
    const result = await icsModule.getEventsForDate('2026-06-12', fakeFetcher);

    assert.equal(result.icsConnected, true);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, 'Reunião de trabalho');
    assert.equal(result.events[0].allDay, false);
  });

  test('all-day event on matching date is returned', async () => {
    process.env.BISA_ICS_URL = 'https://fake.example.com/calendar.ics';
    delete require.cache[require.resolve('../lib/planner/ics')];
    icsModule = require('../lib/planner/ics');
    icsModule.clearCache();

    const fakeFetcher = async () => makeFakeData();
    const result = await icsModule.getEventsForDate('2026-06-13', fakeFetcher);

    assert.equal(result.icsConnected, true);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].allDay, true);
    assert.equal(result.events[0].title, 'Aniversário da Ana');
  });

  test('event on different date is NOT returned', async () => {
    process.env.BISA_ICS_URL = 'https://fake.example.com/calendar.ics';
    delete require.cache[require.resolve('../lib/planner/ics')];
    icsModule = require('../lib/planner/ics');
    icsModule.clearCache();

    const fakeFetcher = async () => makeFakeData();
    const result = await icsModule.getEventsForDate('2026-06-15', fakeFetcher);
    assert.equal(result.events.length, 0);
  });

  test('network error keeps last cache and does not throw', async () => {
    process.env.BISA_ICS_URL = 'https://fake.example.com/calendar.ics';
    delete require.cache[require.resolve('../lib/planner/ics')];
    icsModule = require('../lib/planner/ics');
    icsModule.clearCache();

    // First call succeeds, populates cache
    const fakeFetcher = async () => makeFakeData();
    await icsModule.getEventsForDate('2026-06-12', fakeFetcher);

    // Second call throws → should return stale cache (no throw)
    const failingFetcher = async () => { throw new Error('Network error'); };
    let result;
    await assert.doesNotReject(async () => {
      result = await icsModule.getEventsForDate('2026-06-12', failingFetcher);
    });
    // Still connected (stale cache)
    assert.equal(result.icsConnected, true);
  });

  test('15-min cache: second call uses cache, not fetcher', async () => {
    process.env.BISA_ICS_URL = 'https://fake.example.com/calendar.ics';
    delete require.cache[require.resolve('../lib/planner/ics')];
    icsModule = require('../lib/planner/ics');
    icsModule.clearCache();

    let fetchCount = 0;
    const countingFetcher = async () => { fetchCount++; return makeFakeData(); };

    await icsModule.getEventsForDate('2026-06-12', countingFetcher);
    await icsModule.getEventsForDate('2026-06-12', countingFetcher);

    assert.equal(fetchCount, 1, 'fetcher should only be called once within cache TTL');
  });
});
