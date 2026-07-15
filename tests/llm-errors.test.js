// tests/llm-errors.test.js
// lib/llm/errors — classificação + trava amigável (T6).

const test = require('node:test');
const assert = require('node:assert/strict');
const errors = require('../lib/llm/errors');

test.beforeEach(() => errors._reset());

test('classify: usage limit / credits / rate limit / other', () => {
  assert.equal(errors.classify('Claude usage limit reached. Your limit will reset at 7pm').kind, 'usage-limit');
  assert.equal(errors.classify('Your credit balance is too low').kind, 'credits');
  assert.equal(errors.classify('429 Too Many Requests').kind, 'rate-limit');
  assert.equal(errors.classify('API Error: overloaded_error').kind, 'rate-limit');
  assert.equal(errors.classify('spawn ENOENT').kind, 'other');
  assert.equal(errors.classify('').kind, 'other');
});

test('noteError: usage limit trava até a meia-noite com mensagem amigável', () => {
  const r = errors.noteError('usage limit reached');
  assert.equal(r.locked, true);
  assert.ok(r.until > Date.now());
  assert.ok(r.until <= Date.now() + errors.msUntilMidnight() + 1000);
  assert.match(r.friendly, /créditos.*acabaram/i);
  assert.equal(errors.status().locked, true);
});

test('noteError: rate limit trava só 60s', () => {
  const r = errors.noteError('rate limit exceeded');
  assert.ok(r.until - Date.now() <= 61 * 1000);
  assert.match(errors.status().friendly, /minutinho/);
});

test('noteError: erro comum não trava', () => {
  assert.equal(errors.noteError('segfault').locked, undefined || false);
  assert.equal(errors.status().locked, false);
});

test('noteError: resetAtMs explícito vence a meia-noite', () => {
  const at = Date.now() + 5000;
  const r = errors.noteError('usage limit reached', at);
  assert.equal(r.until, at);
});

test('noteError: trava mais longa não é encurtada por trava curta', () => {
  const far = Date.now() + 60 * 60 * 1000;
  errors.noteError('usage limit reached', far);
  errors.noteError('rate limit');            // 60s — não deve encurtar
  assert.equal(errors.status().until, far);
});

test('status: trava expira sozinha', () => {
  errors.noteError('usage limit reached', Date.now() + 5);
  const spin = Date.now() + 20;
  while (Date.now() < spin) { /* espera 20ms */ }
  assert.equal(errors.status().locked, false);
});

test('noteRateLimitEvent: só trava com status exceeded/reached, usa resetsAt', () => {
  assert.equal(errors.noteRateLimitEvent({ rate_limit: { status: 'allowed' } }), null);
  const resetSec = Math.floor(Date.now() / 1000) + 3600;
  const r = errors.noteRateLimitEvent({ rate_limit: { status: 'exceeded', resetsAt: resetSec } });
  assert.equal(r.locked, true);
  assert.ok(Math.abs(r.until - resetSec * 1000) < 1000);
});
