// tests/auth.test.js
// F3 R15 — validates auth primitives: constant-time compare, cookie
// parse/extract, token precedence.

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeEq, parseCookies, extractToken, COOKIE_NAME } = require('../lib/bootstrap');

// --- safeEq ----------------------------------------------------------------

test('safeEq: equal strings return true', () => {
  assert.equal(safeEq('abc', 'abc'), true);
});

test('safeEq: different strings (same length) return false', () => {
  assert.equal(safeEq('abc', 'abd'), false);
});

test('safeEq: different lengths return false (no timingSafeEqual throw)', () => {
  assert.equal(safeEq('abc', 'abcd'), false);
  assert.equal(safeEq('abcd', 'abc'), false);
});

test('safeEq: null/undefined handled as empty', () => {
  // Buffer.from('') is OK; safeEq normalizes via `|| ''`.
  assert.equal(safeEq(null, null), true);
  assert.equal(safeEq(undefined, undefined), true);
  assert.equal(safeEq(null, ''), true);
  assert.equal(safeEq('', null), true);
});

test('safeEq: empty string vs non-empty', () => {
  assert.equal(safeEq('', 'a'), false);
  assert.equal(safeEq('a', ''), false);
});

test('safeEq: long random tokens', () => {
  const a = 'a'.repeat(64);
  const b = 'a'.repeat(64);
  const c = 'a'.repeat(63) + 'b';
  assert.equal(safeEq(a, b), true);
  assert.equal(safeEq(a, c), false);
});

// --- parseCookies ----------------------------------------------------------

test('parseCookies: empty header returns {}', () => {
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('parseCookies: single cookie', () => {
  assert.deepEqual(parseCookies('foo=bar'), { foo: 'bar' });
});

test('parseCookies: multiple cookies separated by "; "', () => {
  assert.deepEqual(parseCookies('foo=bar; baz=qux'), { foo: 'bar', baz: 'qux' });
});

test('parseCookies: URL-encoded values are decoded', () => {
  assert.deepEqual(parseCookies('foo=bar%20baz'), { foo: 'bar baz' });
});

test('parseCookies: handles cookies with empty value', () => {
  assert.deepEqual(parseCookies('foo='), { foo: '' });
});

test('parseCookies: ignores entries without "="', () => {
  // The implementation skips parts that don't contain "=", so a malformed
  // bare token is silently dropped (matches existing behavior).
  const result = parseCookies('bareToken; foo=bar');
  assert.deepEqual(result, { foo: 'bar' });
});

// --- extractToken precedence ----------------------------------------------

const makeReq = ({ query = {}, header = '', cookie = '', body = {} } = {}) => ({
  query,
  headers: { cookie },
  get: (name) => name === 'x-bisa-token' ? header : '',
  body,
});

test('extractToken: query > header', () => {
  const req = makeReq({ query: { token: 'q' }, header: 'h' });
  assert.equal(extractToken(req), 'q');
});

test('extractToken: header > body', () => {
  const req = makeReq({ header: 'h', body: { token: 'b' } });
  assert.equal(extractToken(req), 'h');
});

test('extractToken: body > cookie', () => {
  const req = makeReq({ body: { token: 'b' }, cookie: `${COOKIE_NAME}=c` });
  assert.equal(extractToken(req), 'b');
});

test('extractToken: falls back to cookie when others empty', () => {
  const req = makeReq({ cookie: `${COOKIE_NAME}=c` });
  assert.equal(extractToken(req), 'c');
});

test('extractToken: returns empty string when nothing present', () => {
  const req = makeReq();
  assert.equal(extractToken(req), '');
});

test('extractToken: full precedence chain', () => {
  const req = makeReq({
    query: { token: 'q' },
    header: 'h',
    body: { token: 'b' },
    cookie: `${COOKIE_NAME}=c`,
  });
  assert.equal(extractToken(req), 'q');
});
