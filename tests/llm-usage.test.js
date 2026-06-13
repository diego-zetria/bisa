// tests/llm-usage.test.js
// Unit tests for lib/llm/usage.js — JSONL append / read / summarize.
// Uses a temp directory so no real data is touched.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { appendUsage, readUsage, monthlyApiSpend, summarize } = require('../lib/llm/usage');

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bisa-usage-test-'));
});

after(() => {
  // Clean up temp dir
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('appendUsage / readUsage', () => {
  test('appends a row and reads it back', () => {
    const dir = path.join(tmpDir, 'test1');
    appendUsage(dir, { kind: 'session', model: 'claude-opus-4-8', in_tokens: 100, out_tokens: 50, cost_usd: 0.01, via: 'cli' });
    const rows = readUsage(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'session');
    assert.equal(rows[0].model, 'claude-opus-4-8');
    assert.equal(rows[0].in_tokens, 100);
    assert.equal(rows[0].via, 'cli');
    assert.ok(rows[0].ts, 'should have timestamp');
  });

  test('appends multiple rows', () => {
    const dir = path.join(tmpDir, 'test2');
    appendUsage(dir, { kind: 'job', model: 'claude-sonnet-4-6', in_tokens: 200, out_tokens: 80, cost_usd: 0.02, via: 'api' });
    appendUsage(dir, { kind: 'micro', model: 'claude-haiku-4-5', in_tokens: 50, out_tokens: 20, cost_usd: 0.001, via: 'api' });
    const rows = readUsage(dir);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'job');
    assert.equal(rows[1].kind, 'micro');
  });

  test('returns empty array when file does not exist', () => {
    const dir = path.join(tmpDir, 'nonexistent-dir');
    const rows = readUsage(dir);
    assert.deepEqual(rows, []);
  });

  test('since filter excludes older rows', () => {
    const dir = path.join(tmpDir, 'test3');
    // Write a row with a past timestamp by patching directly
    const metaDir = path.join(dir, '.meta');
    fs.mkdirSync(metaDir, { recursive: true });
    const usageFile = path.join(metaDir, 'llm-usage.jsonl');
    const oldRow = JSON.stringify({ ts: '2020-01-01T00:00:00Z', kind: 'job', model: 'x', in_tokens: 1, out_tokens: 1, cost_usd: 0, via: 'api' });
    const newRow = JSON.stringify({ ts: '2099-01-01T00:00:00Z', kind: 'session', model: 'y', in_tokens: 2, out_tokens: 2, cost_usd: 0, via: 'cli' });
    fs.writeFileSync(usageFile, oldRow + '\n' + newRow + '\n', 'utf8');
    const rows = readUsage(dir, { since: '2098-01-01T00:00:00Z' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'session');
  });

  test('skips malformed lines gracefully', () => {
    const dir = path.join(tmpDir, 'test4');
    const metaDir = path.join(dir, '.meta');
    fs.mkdirSync(metaDir, { recursive: true });
    const usageFile = path.join(metaDir, 'llm-usage.jsonl');
    fs.writeFileSync(usageFile, 'not-json\n{"kind":"session","ts":"2099-01-01","model":"x","cost_usd":0.5,"via":"api"}\n', 'utf8');
    const rows = readUsage(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'session');
  });
});

describe('monthlyApiSpend', () => {
  test('sums only api rows for current month', () => {
    const dir = path.join(tmpDir, 'test5');
    const metaDir = path.join(dir, '.meta');
    fs.mkdirSync(metaDir, { recursive: true });
    const usageFile = path.join(metaDir, 'llm-usage.jsonl');
    const thisMonth = new Date().toISOString().slice(0, 7);
    const rows = [
      { ts: `${thisMonth}-01T00:00:00Z`, kind: 'job', model: 'x', in_tokens: 0, out_tokens: 0, cost_usd: 1.50, via: 'api' },
      { ts: `${thisMonth}-02T00:00:00Z`, kind: 'session', model: 'y', in_tokens: 0, out_tokens: 0, cost_usd: 2.00, via: 'cli' }, // cli — excluded
      { ts: `${thisMonth}-03T00:00:00Z`, kind: 'micro', model: 'z', in_tokens: 0, out_tokens: 0, cost_usd: 0.50, via: 'api' },
      { ts: '2020-01-01T00:00:00Z', kind: 'job', model: 'q', in_tokens: 0, out_tokens: 0, cost_usd: 999, via: 'api' }, // old month — excluded
    ];
    fs.writeFileSync(usageFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    const spend = monthlyApiSpend(dir);
    // Should be 1.50 + 0.50 = 2.00 (cli row and old row excluded)
    assert.ok(Math.abs(spend - 2.00) < 0.001, `expected ~2.00, got ${spend}`);
  });

  test('returns 0 when no usage file exists', () => {
    const dir = path.join(tmpDir, 'empty-dir');
    assert.equal(monthlyApiSpend(dir), 0);
  });
});

describe('summarize', () => {
  test('aggregates totals correctly', () => {
    const rows = [
      { kind: 'job',     model: 'claude-sonnet-4-6', in_tokens: 100, out_tokens: 50, cost_usd: 1.0, via: 'api' },
      { kind: 'session', model: 'claude-sonnet-4-6', in_tokens: 200, out_tokens: 80, cost_usd: 2.0, via: 'cli' },
      { kind: 'micro',   model: 'claude-haiku-4-5',  in_tokens: 30,  out_tokens: 10, cost_usd: 0.1, via: 'api' },
    ];
    const s = summarize(rows);
    assert.ok(Math.abs(s.totalCostUsd - 3.1) < 0.001);
    assert.equal(s.byKind.job.count, 1);
    assert.equal(s.byKind.session.count, 1);
    assert.equal(s.byKind.micro.count, 1);
    assert.equal(s.byModel['claude-sonnet-4-6'].count, 2);
    assert.equal(s.byModel['claude-haiku-4-5'].count, 1);
    assert.equal(s.byModel['claude-sonnet-4-6'].inTokens, 300);
  });

  test('handles empty rows', () => {
    const s = summarize([]);
    assert.equal(s.totalCostUsd, 0);
    assert.deepEqual(s.byKind, {});
    assert.deepEqual(s.byModel, {});
  });
});
