// tests/path-confinement.test.js
// F3 R13 — validates resolveInsideCwd (path traversal defense).
// Covers the regression vector that would let /file or /fs/* escape CWD.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeResolveInsideCwd } = require('../lib/bootstrap');

const CWD = path.resolve('/tmp/biso-test-cwd');
const resolveInsideCwd = makeResolveInsideCwd(() => CWD);

test('rejects ..', () => {
  assert.equal(resolveInsideCwd('..'), null);
});

test('rejects nested .. escape', () => {
  assert.equal(resolveInsideCwd('foo/../..'), null);
});

test('rejects nested .. escape to specific target', () => {
  assert.equal(resolveInsideCwd('../etc/passwd'), null);
});

test('rejects deeply nested .. escape', () => {
  assert.equal(resolveInsideCwd('a/b/c/../../../..'), null);
});

test('rejects absolute path outside CWD', () => {
  assert.equal(resolveInsideCwd('/etc/passwd'), null);
});

test('rejects absolute path that is exactly CWD parent', () => {
  assert.equal(resolveInsideCwd(path.dirname(CWD)), null);
});

test('rejects non-string input', () => {
  assert.equal(resolveInsideCwd(null), null);
  assert.equal(resolveInsideCwd(undefined), null);
  assert.equal(resolveInsideCwd(123), null);
  assert.equal(resolveInsideCwd({}), null);
  assert.equal(resolveInsideCwd([]), null);
});

test('rejects empty string', () => {
  assert.equal(resolveInsideCwd(''), null);
});

test('accepts CWD itself ("." resolves to CWD root)', () => {
  assert.equal(resolveInsideCwd('.'), CWD);
});

test('accepts valid relative path', () => {
  assert.equal(resolveInsideCwd('foo/bar.txt'), path.join(CWD, 'foo/bar.txt'));
});

test('accepts nested relative path with ./', () => {
  // Note: path.resolve normalizes ./ — equivalent to foo/bar.txt
  assert.equal(resolveInsideCwd('./foo/bar.txt'), path.join(CWD, 'foo/bar.txt'));
});

test('accepts foo/../bar (normalized to bar, still inside CWD)', () => {
  // path.resolve normalizes — this is bar, which is inside CWD
  assert.equal(resolveInsideCwd('foo/../bar'), path.join(CWD, 'bar'));
});

test('rejects absolute path that resembles CWD root with extra segment', () => {
  // e.g. /tmp/biso-test-cwd-other vs /tmp/biso-test-cwd
  const sibling = CWD + '-other';
  assert.equal(resolveInsideCwd(sibling), null);
});

test('follows CWD mutation via getter (project switching)', () => {
  let cwd = '/tmp/biso-test-cwd';
  const resolver = makeResolveInsideCwd(() => cwd);
  assert.equal(resolver('foo'), path.join(cwd, 'foo'));
  cwd = '/tmp/biso-other';
  assert.equal(resolver('foo'), path.join(cwd, 'foo'));
});
