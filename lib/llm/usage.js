// lib/llm/usage.js
// Append and read LLM usage records to <data>/.meta/llm-usage.jsonl.
//
// Each row: { ts, kind, job?, model, in_tokens, out_tokens, cost_usd, via }
//   kind: 'session' | 'job' | 'micro'
//   via:  'cli' | 'claude-p' | 'api'
//
// This module is stateless — all I/O goes through the JSONL file. Safe to
// call from any context.

'use strict';

const fs = require('fs');
const path = require('path');

// Return the path to the usage file given the data directory.
const usagePath = (dataDir) => path.join(dataDir, '.meta', 'llm-usage.jsonl');

// Append a usage record. Creates the .meta dir if needed. Never throws.
const appendUsage = (dataDir, row) => {
  try {
    const file = usagePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...row,
    });
    fs.appendFileSync(file, line + '\n', 'utf8');
  } catch (e) {
    console.warn('[llm/usage] append failed:', e.message);
  }
};

// Read all usage records, optionally filtered by ISO timestamp prefix (e.g. '2026-06').
// Returns array of parsed rows; malformed lines are skipped.
const readUsage = (dataDir, { since } = {}) => {
  const file = usagePath(dataDir);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return []; }

  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); }
    catch { continue; }
    if (since && r.ts && r.ts < since) continue;
    rows.push(r);
  }
  return rows;
};

// Compute total API spend for the current calendar month (via:'api' rows only).
const monthlyApiSpend = (dataDir) => {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01T00:00:00Z';
  const rows = readUsage(dataDir, { since: monthStart });
  return rows
    .filter((r) => r.via === 'api')
    .reduce((sum, r) => sum + (r.cost_usd || 0), 0);
};

// Aggregate usage records into a summary { totalCostUsd, byKind, byModel }.
const summarize = (rows) => {
  let totalCostUsd = 0;
  const byKind = {};
  const byModel = {};
  for (const r of rows) {
    totalCostUsd += r.cost_usd || 0;
    if (r.kind) {
      byKind[r.kind] = byKind[r.kind] || { count: 0, costUsd: 0 };
      byKind[r.kind].count += 1;
      byKind[r.kind].costUsd += r.cost_usd || 0;
    }
    if (r.model) {
      byModel[r.model] = byModel[r.model] || { count: 0, inTokens: 0, outTokens: 0, costUsd: 0 };
      byModel[r.model].count += 1;
      byModel[r.model].inTokens += r.in_tokens || 0;
      byModel[r.model].outTokens += r.out_tokens || 0;
      byModel[r.model].costUsd += r.cost_usd || 0;
    }
  }
  return { totalCostUsd, byKind, byModel };
};

module.exports = { appendUsage, readUsage, monthlyApiSpend, summarize, usagePath };
