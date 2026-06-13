// lib/llm/policy.js
// Resolves the LLM route ('api' | 'claude-p' | 'off') for a given job/kind.
//
// REGRAS DA POLÍTICA CLAUDE (junho/2026): texto oficial pendente — defaults
// definidos por Diego em 2026-06-12; ao receber o texto, codificar cada regra
// aqui com citação.
//
// Env vars consumed:
//   LLM_JOB_<NOME>          — per-job route override (api|claude-p|off)
//   LLM_MICRO               — micro-task route (api|claude-p|off)
//   ANTHROPIC_API_KEY       — if absent, 'api' falls back to 'claude-p' w/ warning
//   API_BUDGET_MONTHLY_USD  — monthly USD cap for API spend
//   API_MODEL_JOBS          — Anthropic model for scheduled jobs
//   API_MODEL_MICRO         — Anthropic model for micro tasks
//   BISA_HEADLESS_BUDGET_USD — claude-p monthly budget (for status snapshot)

'use strict';

const VALID_ROUTES = new Set(['api', 'claude-p', 'off']);

// Warn once when ANTHROPIC_API_KEY is absent and we fall back to claude-p.
let _warnedNoKey = false;

const resolveRoute = (job) => {
  // Per-job env override: LLM_JOB_BRIEFING, LLM_JOB_FINANCE_INSIGHT, etc.
  // Normalize job name to uppercase with underscores.
  if (job) {
    const envKey = 'LLM_JOB_' + String(job).toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const raw = (process.env[envKey] || '').trim().toLowerCase();
    if (VALID_ROUTES.has(raw)) {
      return applyApiKeyFallback(raw);
    }
  }
  // Default: api
  return applyApiKeyFallback('api');
};

const resolveMicroRoute = () => {
  const raw = (process.env.LLM_MICRO || '').trim().toLowerCase();
  const route = VALID_ROUTES.has(raw) ? raw : 'api';
  return applyApiKeyFallback(route);
};

// If route is 'api' but ANTHROPIC_API_KEY is absent, fall back to 'claude-p'
// with a one-time console warning.
const applyApiKeyFallback = (route) => {
  if (route !== 'api') return route;
  if (process.env.ANTHROPIC_API_KEY) return 'api';
  if (!_warnedNoKey) {
    console.warn('[llm/policy] ANTHROPIC_API_KEY ausente — jobs "api" usarão claude-p como fallback');
    _warnedNoKey = false; // keep warning once per call rather than truly once
  }
  _warnedNoKey = true;
  return 'claude-p';
};

// Reset the once-warning flag (useful in tests).
const resetWarnedFlag = () => { _warnedNoKey = false; };

const snapshot = () => ({
  jobDefault: applyApiKeyFallback('api'),
  microRoute: resolveMicroRoute(),
  apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
  apiModelJobs: process.env.API_MODEL_JOBS || 'claude-sonnet-4-6',
  apiModelMicro: process.env.API_MODEL_MICRO || 'claude-haiku-4-5-20251001',
  apiBudgetMonthlyUsd: parseFloat(process.env.API_BUDGET_MONTHLY_USD || '25') || 25,
  headlessBudgetUsd: parseFloat(process.env.BISA_HEADLESS_BUDGET_USD || '100') || 100,
  // Per-job overrides for status display
  jobOverrides: (() => {
    const out = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('LLM_JOB_') && VALID_ROUTES.has((v || '').trim().toLowerCase())) {
        out[k.slice('LLM_JOB_'.length).toLowerCase()] = (v || '').trim().toLowerCase();
      }
    }
    return out;
  })(),
});

module.exports = { resolveRoute, resolveMicroRoute, applyApiKeyFallback, snapshot, resetWarnedFlag };
