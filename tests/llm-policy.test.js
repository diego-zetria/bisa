// tests/llm-policy.test.js
// Unit tests for lib/llm/policy.js — routing logic from env vars.
// Uses Node.js built-in test runner (node:test).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// We need to reload the module with different env each time.
// Strategy: save and restore process.env keys between tests.

const POLICY_PATH = require('path').join(__dirname, '..', 'lib', 'llm', 'policy.js');

// Helper: reload the module fresh (clears require cache)
const reload = () => {
  delete require.cache[POLICY_PATH];
  return require(POLICY_PATH);
};

// Save/restore env keys we mutate
let savedEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
});
afterEach(() => {
  // Restore env
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
  // Clear module cache so next test gets fresh state
  delete require.cache[POLICY_PATH];
});

describe('policy.resolveRoute', () => {
  test('default is api when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.LLM_JOB_BRIEFING;
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('briefing'), 'api');
  });

  test('falls back to claude-p when ANTHROPIC_API_KEY is absent', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_JOB_BRIEFING;
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('briefing'), 'claude-p');
  });

  test('respects LLM_JOB_BRIEFING=claude-p even when API key present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.LLM_JOB_BRIEFING = 'claude-p';
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('briefing'), 'claude-p');
  });

  test('respects LLM_JOB_REFLECTION=off', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.LLM_JOB_REFLECTION = 'off';
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('reflection'), 'off');
  });

  test('ignores invalid LLM_JOB_ values, falls back to api', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.LLM_JOB_MYTEST = 'invalid-value';
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('mytest'), 'api');
  });

  test('job name with hyphen is uppercased and underscored', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.LLM_JOB_FINANCE_INSIGHT = 'off';
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('finance-insight'), 'off');
  });

  test('unknown job falls back to api (key present)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { resolveRoute } = reload();
    assert.equal(resolveRoute('nonexistent-job'), 'api');
  });

  test('null/undefined job falls back to api (key present)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { resolveRoute } = reload();
    assert.equal(resolveRoute(null), 'api');
    assert.equal(resolveRoute(undefined), 'api');
  });
});

describe('policy.resolveMicroRoute', () => {
  test('defaults to api when LLM_MICRO unset and key present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.LLM_MICRO;
    const { resolveMicroRoute } = reload();
    assert.equal(resolveMicroRoute(), 'api');
  });

  test('respects LLM_MICRO=off', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.LLM_MICRO = 'off';
    const { resolveMicroRoute } = reload();
    assert.equal(resolveMicroRoute(), 'off');
  });

  test('falls back to claude-p when no key and LLM_MICRO=api', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.LLM_MICRO = 'api';
    const { resolveMicroRoute } = reload();
    assert.equal(resolveMicroRoute(), 'claude-p');
  });
});

describe('policy.snapshot', () => {
  test('snapshot includes apiKeyPresent', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { snapshot } = reload();
    const s = snapshot();
    assert.ok('apiKeyPresent' in s);
    assert.equal(s.apiKeyPresent, true);
  });

  test('snapshot includes apiBudgetMonthlyUsd from env', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.API_BUDGET_MONTHLY_USD = '50';
    const { snapshot } = reload();
    const s = snapshot();
    assert.equal(s.apiBudgetMonthlyUsd, 50);
  });

  test('snapshot.jobDefault is claude-p when no key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { snapshot } = reload();
    const s = snapshot();
    assert.equal(s.jobDefault, 'claude-p');
  });

  test('snapshot.jobOverrides includes known job env vars', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.LLM_JOB_WEEKLY = 'off';
    process.env.LLM_JOB_LOOP = 'claude-p';
    const { snapshot } = reload();
    const s = snapshot();
    assert.equal(s.jobOverrides.weekly, 'off');
    assert.equal(s.jobOverrides.loop, 'claude-p');
  });
});
