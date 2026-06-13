#!/usr/bin/env node
// scripts/smoke-llm.js
// Smoke test for lib/llm/session.js — sends a real prompt to claude CLI
// and validates we receive a text response and llm.done event.
//
// Usage: node scripts/smoke-llm.js
// Exit 0 on success, 1 on failure.

'use strict';

const path = require('path');
const fs   = require('fs');

// Load .env from project root (before requiring lib/llm)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const CWD = process.env.CWD || path.join(require('os').homedir(), 'bisa-data');
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude';
const USER_SHELL = process.env.SHELL || '/bin/bash';

const makeSession = require('../lib/llm/session');

const broadcasts = [];
const broadcast = (msg) => {
  broadcasts.push(msg);
  console.log('[broadcast]', JSON.stringify(msg));
};

const session = makeSession({
  CWD,
  CLAUDE_CMD,
  USER_SHELL,
  broadcast,
  dispatchNotification: (n) => console.log('[notify]', n.text),
});

console.log(`\n[smoke] Initiating session in ${CWD}`);
console.log('[smoke] Sending: "Responda apenas: ok"\n');

const TIMEOUT_MS = 30_000;
let timedOut = false;

const timeout = setTimeout(() => {
  timedOut = true;
  console.error('[smoke] TIMEOUT — no response in 30s');
  process.exit(1);
}, TIMEOUT_MS);

session.send('Responda apenas: ok')
  .then(({ costUsd, sessionId }) => {
    clearTimeout(timeout);
    if (timedOut) return;

    console.log('\n[smoke] Turn complete.');
    console.log(`  sessionId: ${sessionId}`);
    console.log(`  costUsd:   ${costUsd}`);

    // Validate broadcasts
    const textEvents = broadcasts.filter((b) => b.type === 'llm.text');
    const doneEvents = broadcasts.filter((b) => b.type === 'llm.done');

    if (textEvents.length === 0) {
      console.error('[smoke] FAIL: no llm.text events received');
      process.exit(1);
    }
    if (doneEvents.length === 0) {
      console.error('[smoke] FAIL: no llm.done event received');
      process.exit(1);
    }

    const fullText = textEvents.map((b) => b.delta).join('');
    console.log(`\n[smoke] Assistant text: "${fullText}"`);
    console.log('[smoke] PASS');
    process.exit(0);
  })
  .catch((e) => {
    clearTimeout(timeout);
    if (timedOut) return;
    console.error('[smoke] FAIL:', e.message);
    process.exit(1);
  });
