// lib/llm/api.js
// Anthropic Messages API client via global fetch (no SDK dependency).
//
// Provides:
//   callApi(messages, opts)      — call /v1/messages, return { text, usage }
//   runJobViaApi(prompt, opts)   — single-turn job (returns text string)
//   microTask(kind, text, opts)  — haiku single-turn, returns trimmed string or null
//
// Budget enforcement:
//   - Reads monthly spend from llm-usage.jsonl (via:'api' rows)
//   - Hard-stops when API_BUDGET_MONTHLY_USD is reached
//   - Calls dispatchNotification at 80% (once per session via in-memory flag)

'use strict';

const { appendUsage, monthlyApiSpend } = require('./usage');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Per-million-token USD pricing table.
// Accept both short alias and dated ID (strip trailing -YYYYMMDD suffix).
const PRICE_TABLE = {
  'claude-sonnet-4-5': { in: 3,    out: 15  },
  'claude-sonnet-4-6': { in: 3,    out: 15  },
  'claude-haiku-4-5':  { in: 0.80, out: 4   },
  'claude-opus-4-8':   { in: 15,   out: 75  },
};

const priceFor = (model) => {
  const stripped = String(model || '').replace(/-\d{8}$/, '');
  return PRICE_TABLE[model] || PRICE_TABLE[stripped] || PRICE_TABLE['claude-sonnet-4-6'];
};

const computeCostUsd = (model, inTokens, outTokens) => {
  const p = priceFor(model);
  return (inTokens * p.in + outTokens * p.out) / 1_000_000;
};

// In-memory flag: warn at most once per server session per threshold crossing.
let _warnedAt80 = false;

module.exports = function makeApi({ CWD, dispatchNotification }) {
  const budgetCap = parseFloat(process.env.API_BUDGET_MONTHLY_USD || '25') || 25;

  // Check spend vs. cap. Returns { ok, usedUsd, capUsd, pct }.
  const checkBudget = () => {
    const usedUsd = monthlyApiSpend(CWD);
    const pct = budgetCap > 0 ? usedUsd / budgetCap : 0;
    return { ok: pct < 1, usedUsd, capUsd: budgetCap, pct };
  };

  // Low-level Anthropic API call. Returns { text, usage, model }.
  const callApi = async (messages, opts = {}) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY não configurada');

    // Budget hard-stop
    const budget = checkBudget();
    if (!budget.ok) {
      throw new Error(
        `Limite mensal de API atingido ($${budget.usedUsd.toFixed(2)} de $${budget.capUsd}) — aguarde o próximo mês ou aumente API_BUDGET_MONTHLY_USD`,
      );
    }

    // 80% warning (once per session)
    if (!_warnedAt80 && budget.pct >= 0.8 && dispatchNotification) {
      _warnedAt80 = true;
      dispatchNotification({
        code: 9,
        text: `API LLM: ${Math.round(budget.pct * 100)}% do orçamento mensal usado ($${budget.usedUsd.toFixed(2)} de $${budget.capUsd})`,
        log: false,
        tags: ['llm', 'budget'],
        silent: false,
        source: 'llm-api',
      });
    }

    const model = opts.model || process.env.API_MODEL_JOBS || 'claude-sonnet-4-6';
    const maxTokens = opts.maxTokens || 4096;

    const body = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (opts.system) body.system = opts.system;

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': API_VERSION,
        'x-api-key': key,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    const inTok  = data.usage?.input_tokens  || 0;
    const outTok = data.usage?.output_tokens || 0;
    const costUsd = computeCostUsd(model, inTok, outTok);

    // Record usage
    appendUsage(CWD, {
      kind: opts.kind || 'job',
      job: opts.job || undefined,
      model,
      in_tokens: inTok,
      out_tokens: outTok,
      cost_usd: costUsd,
      via: 'api',
    });

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return { text, usage: data.usage, model, costUsd };
  };

  // Convenience: single-turn job. Returns the trimmed text string.
  const runJobViaApi = async (prompt, opts = {}) => {
    const { text } = await callApi(
      [{ role: 'user', content: prompt }],
      { kind: 'job', ...opts },
    );
    return text.trim();
  };

  // Micro-task via Haiku: returns trimmed string or null on error.
  const microTask = async (kind, text, opts = {}) => {
    try {
      const model = process.env.API_MODEL_MICRO || 'claude-haiku-4-5-20251001';
      const { text: result } = await callApi(
        [{ role: 'user', content: text }],
        { kind: 'micro', job: kind, model, maxTokens: 512, ...opts },
      );
      return result.trim() || null;
    } catch (e) {
      console.warn(`[llm/api] microTask(${kind}) failed:`, e.message);
      return null;
    }
  };

  return { callApi, runJobViaApi, microTask, checkBudget, computeCostUsd };
};
