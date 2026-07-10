// tests/events-bridge.test.js
// Contract tests for lib/events-bridge — stub biso server serving canned
// events; spy push.notify + spy broadcast. Verifies: first sync only anchors
// the cursor (no history replay), push only for push:true, cursor persistence,
// re-anchor on cursorFound:false, resilience to 500s and to a 404 (old biso).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const makeEventsBridge = require('../lib/events-bridge');

const META = fs.mkdtempSync(path.join(os.tmpdir(), 'events-bridge-meta-'));

// ---- stub biso -------------------------------------------------------------
let feed = { events: [], latest: null };      // what GET /api/events returns
let forcedStatus = null;                      // force 404/500 responses
let lastQuery = null;

const stub = express();
stub.get('/api/events', (req, res) => {
  lastQuery = req.query;
  if (forcedStatus) return res.status(forcedStatus).json({ error: 'forced' });
  const payload = { events: feed.events, latest: feed.latest };
  if (req.query.after) payload.cursorFound = feed.cursorFound !== false;
  res.json(payload);
});
const server = stub.listen(0);
const BISO_URL = `http://127.0.0.1:${server.address().port}`;

// ---- spies -----------------------------------------------------------------
const pushed = [];
const broadcasts = [];
const push = { notify: async (title, body, extra) => { pushed.push({ title, body, extra }); } };
const broadcast = (m) => broadcasts.push(m);

const bridge = makeEventsBridge({
  BISO_URL, BISO_TOKEN: 't', push, broadcast, META,
  pollMs: 60 * 60 * 1000,   // never fires on its own — we drive ticks manually
});

// drive one poll cycle: start() runs an immediate tick; subsequent cycles via
// stop/start (the interval is unreachable at 1h).
const cycle = async () => {
  bridge.stop();
  bridge.start();
  await new Promise((r) => setTimeout(r, 80));
};

const ev = (id, over = {}) => ({
  id, ts: Date.now(), receivedAt: Date.now(), source: 'corp-watch',
  type: 'slack.mention', title: `mention ${id}`, body: 'b', push: true, data: { key: '#x' }, ...over,
});

test.after(() => { bridge.stop(); server.close(); });

test('first sync anchors the cursor without replaying history', async () => {
  feed = { events: [ev('ev-a'), ev('ev-b')], latest: 'ev-b' };
  await cycle();
  assert.equal(pushed.length, 0);
  assert.equal(broadcasts.length, 0);
  assert.equal(lastQuery.limit, '1');   // anchor probe only
  const cur = JSON.parse(fs.readFileSync(path.join(META, 'biso-events-cursor.json'), 'utf8'));
  assert.equal(cur.after, 'ev-b');
});

test('delivers new events: push only for push:true, broadcast for all', async () => {
  feed = {
    events: [ev('ev-c'), ev('ev-d', { type: 'slack.activity', push: false, title: 'activity ev-d' })],
    latest: 'ev-d',
  };
  await cycle();
  assert.equal(lastQuery.after, 'ev-b');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].title, 'mention ev-c');
  assert.equal(pushed[0].extra.tag, 'ev-#x');
  assert.equal(pushed[0].extra.url, '/#ops');
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0].type, 'remote-event');
  const cur = JSON.parse(fs.readFileSync(path.join(META, 'biso-events-cursor.json'), 'utf8'));
  assert.equal(cur.after, 'ev-d');
});

test('cursorFound:false re-anchors without re-delivering the tail', async () => {
  feed = { events: [ev('ev-old1'), ev('ev-old2')], latest: 'ev-old2', cursorFound: false };
  await cycle();
  assert.equal(pushed.length, 1);       // unchanged
  const cur = JSON.parse(fs.readFileSync(path.join(META, 'biso-events-cursor.json'), 'utf8'));
  assert.equal(cur.after, 'ev-old2');
  feed.cursorFound = true;
});

test('empty-store first sync anchors at "start" so the FIRST real event is delivered', async () => {
  const META2 = fs.mkdtempSync(path.join(os.tmpdir(), 'events-bridge-meta2-'));
  const pushed2 = [];
  const bridge2 = makeEventsBridge({
    BISO_URL, BISO_TOKEN: 't',
    push: { notify: async (title) => { pushed2.push(title); } },
    broadcast: () => {}, META: META2,
    pollMs: 60 * 60 * 1000,
  });
  const cycle2 = async () => { bridge2.stop(); bridge2.start(); await new Promise((r) => setTimeout(r, 80)); };

  feed = { events: [], latest: null };            // fresh install: nothing yet
  await cycle2();
  const cur = JSON.parse(fs.readFileSync(path.join(META2, 'biso-events-cursor.json'), 'utf8'));
  assert.equal(cur.after, 'start');

  feed = { events: [ev('ev-first')], latest: 'ev-first' };   // the very first event
  await cycle2();
  assert.deepEqual(pushed2, ['mention ev-first']);           // delivered, not swallowed
  bridge2.stop();
});

test('survives 500s and a 404 (old biso) without advancing the cursor', async () => {
  forcedStatus = 500;
  await cycle();
  forcedStatus = 404;
  await cycle();
  forcedStatus = null;
  assert.equal(pushed.length, 1);
  const cur = JSON.parse(fs.readFileSync(path.join(META, 'biso-events-cursor.json'), 'utf8'));
  assert.equal(cur.after, 'ev-old2');

  // and recovers on the next healthy poll
  feed = { events: [ev('ev-e')], latest: 'ev-e' };
  await cycle();
  assert.equal(pushed.length, 2);
  assert.equal(pushed[1].title, 'mention ev-e');
});
