// lib/codex/headless.js
// Extracted from server.js R5a (2026-05-24). Factory for the `claude -p`
// headless invocation surface: cost telemetry, monthly-budget alert,
// credit-style circuit breaker, env scrubbing (R1a), hardened flag set
// (R1c), and the shared constitution file (R1b).
//
// Deps injected: CODEX_DIR (codexStore), USER_SHELL (bootstrap),
// dispatchNotification (still in server.js until R6a).
//
// Pure constants/helpers (pricing tables, shell escape, env scrub) live
// at module scope — they are stateless and safe to evaluate at require
// time. Anything that touches disk paths or the breaker state closes
// over the factory deps.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CLAUDE_HEADLESS = process.env.CLAUDE_HEADLESS_CMD || 'claude';

// Shell-safe single-quote escape: wrap in '...' and replace embedded ' with '\''
// Prevents $VAR expansion, `cmd` substitution, zsh ** glob, etc. from the prompt body.
const shellSingleQuote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// Monthly credit. Default = Max 5x ($100). Set BISA_HEADLESS_BUDGET_USD=200 for Max 20x.
const HEADLESS_BUDGET_USD = (() => {
  const n = parseFloat(process.env.BISA_HEADLESS_BUDGET_USD || '100');
  return Number.isFinite(n) && n > 0 ? n : 100;
})();
const HEADLESS_ALERT_PCT = (() => {
  const n = parseFloat(process.env.BISA_HEADLESS_ALERT_PCT || '0.80');
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.80;
})();

// Per-million-token USD pricing. Refresh if Anthropic publishes new rates.
// Used only for biso-side cost estimation; the actual subscription credit
// is debited by Anthropic and not visible to us here.
const HEADLESS_MODEL_PRICING = {
  'claude-sonnet-4-6': { in: 3,    out: 15 },
  'claude-haiku-4-5':  { in: 0.80, out: 4  },
  'claude-opus-4-7':   { in: 15,   out: 75 },
};
// Assumed model when no --model override is passed. Matches the `claude -p`
// default in May 2026; bump when the CLI default changes.
const HEADLESS_DEFAULT_MODEL = 'claude-sonnet-4-6';

// Chars/4 ≈ tokens (English-heavy heuristic). Good enough for budget signal.
const headlessEstTokens = (chars) => Math.ceil((chars || 0) / 4);
const headlessEstCostUSD = (model, inTok, outTok) => {
  // Accept both alias ('claude-haiku-4-5') and dated ID ('claude-haiku-4-5-20251001').
  const stripped = String(model || '').replace(/-\d{8}$/, '');
  const p = HEADLESS_MODEL_PRICING[model]
        || HEADLESS_MODEL_PRICING[stripped]
        || HEADLESS_MODEL_PRICING[HEADLESS_DEFAULT_MODEL];
  return (inTok * p.in + outTok * p.out) / 1_000_000;
};

// Circuit-breaker tunables. Patterns are intentionally broad — Anthropic's
// exact post-2026-06-15 error strings aren't published yet. Refine once
// captured in headless-usage.jsonl.
const HEADLESS_BREAKER_THRESHOLD   = 3;
const HEADLESS_BREAKER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h
const HEADLESS_CREDIT_ERR_PATTERNS = [
  /\bcredit\b/i,
  /quota.*exceed/i,
  /insufficient.*(funds|balance|credit)/i,
  /agent.*sdk.*(credit|quota|limit)/i,
  /\b402\b/,
  /payment.*required/i,
  /billing/i,
];

// R1a — Scrub env vars that override OAuth/subscription billing. Anthropic's
// credential precedence chain puts BOTH ANTHROPIC_API_KEY and
// ANTHROPIC_AUTH_TOKEN above CLAUDE_CODE_OAUTH_TOKEN — either in env silently
// overrides Max-subscription billing. PAI documented a real $498 incident
// (Apr 2026). Set BISA_HEADLESS_PRESERVE_API_KEY=1 to opt out (rare use case).
const scrubSubscriptionEnv = (env) => {
  const out = { ...env };
  if (process.env.BISA_HEADLESS_PRESERVE_API_KEY !== '1') {
    delete out.ANTHROPIC_API_KEY;
    delete out.ANTHROPIC_AUTH_TOKEN;
  }
  delete out.CLAUDECODE; // permit nested claude invocation
  return out;
};

// R1c — Hardened flag set per PAI/TOOLS/Inference.ts pattern. Skips tool
// loading (faster startup), user-settings load (env drift), and the dynamic
// system-prompt sections that break Claude Code's prompt-prefix cache.
const HEADLESS_BASE_FLAGS = [
  '--tools', '',
  '--setting-sources', '',
  '--output-format', 'text',
  '--exclude-dynamic-system-prompt-sections',
];

module.exports = function makeHeadless({ CODEX_DIR, USER_SHELL, dispatchNotification }) {
  // ============================================================================
  // HEADLESS USAGE TELEMETRY — per-call cost accounting + monthly budget alert
  // for `claude -p`. Defends the Agent SDK credit pool that Anthropic splits
  // off from the interactive subscription pool starting 2026-06-15.
  // See docs/prd-headless-credit.md (R4).
  // ============================================================================
  const HEADLESS_USAGE_FILE = path.join(CODEX_DIR, '.meta', 'headless-usage.jsonl');
  const HEADLESS_STATE_FILE = path.join(CODEX_DIR, '.meta', 'headless-state.json');

  // R1b — Shared constitution loaded via Claude Code's --append-system-prompt-file
  // flag on every spawn. Survives context compaction, single source of truth for
  // rules currently duplicated across per-kind prompt templates.
  const LOOP_PROMPTS_DIR = path.join(CODEX_DIR, '.meta', 'prompts');
  const HEADLESS_CONSTITUTION_FILE = path.join(LOOP_PROMPTS_DIR, '_headless-constitution.md');

  const readHeadlessState = () => {
    try { return JSON.parse(fs.readFileSync(HEADLESS_STATE_FILE, 'utf8')); }
    catch { return { lastAlertDate: null, lastAlertPct: 0 }; }
  };
  const writeHeadlessState = (s) => {
    try { fs.writeFileSync(HEADLESS_STATE_FILE, JSON.stringify(s, null, 2) + '\n', 'utf8'); }
    catch (e) { console.warn('[headless] state write failed:', e.message); }
  };

  const appendHeadlessUsage = (row) => {
    try {
      fs.mkdirSync(path.dirname(HEADLESS_USAGE_FILE), { recursive: true });
      fs.appendFileSync(HEADLESS_USAGE_FILE, JSON.stringify(row) + '\n', 'utf8');
    } catch (e) { console.warn('[headless] append failed:', e.message); }
  };

  const summarizeHeadlessUsage = (sinceISO) => {
    let raw;
    try { raw = fs.readFileSync(HEADLESS_USAGE_FILE, 'utf8'); }
    catch { return { calls: 0, costUSD: 0, byFeature: {} }; }
    let calls = 0, costUSD = 0;
    const byFeature = {};
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (sinceISO && r.ts && r.ts < sinceISO) continue;
      calls += 1;
      costUSD += r.est_cost_usd || 0;
      const f = r.feature || 'unknown';
      if (!byFeature[f]) byFeature[f] = { calls: 0, costUSD: 0 };
      byFeature[f].calls += 1;
      byFeature[f].costUSD += r.est_cost_usd || 0;
    }
    return { calls, costUSD, byFeature };
  };

  // ----------------------------------------------------------------------------
  // Circuit breaker — pause a feature after repeated credit-style failures so we
  // don't hammer a broken endpoint. In-memory only (resets on restart). See
  // docs/prd-headless-credit.md (R6).
  // ----------------------------------------------------------------------------
  const headlessBreakerState = new Map(); // feature -> { fails, pausedUntil }

  const breakerCheck = (feature) => {
    const s = headlessBreakerState.get(feature);
    if (!s || !s.pausedUntil) return { open: false };
    if (Date.now() >= s.pausedUntil) {
      s.pausedUntil = 0; // cooldown elapsed; keep fails until first success
      return { open: false };
    }
    return { open: true, until: new Date(s.pausedUntil).toISOString() };
  };

  const breakerRecordSuccess = (feature) => {
    const s = headlessBreakerState.get(feature);
    if (s) { s.fails = 0; s.pausedUntil = 0; }
  };

  const breakerRecordFailure = (feature, errTail) => {
    if (!errTail) return;
    const matches = HEADLESS_CREDIT_ERR_PATTERNS.some((re) => re.test(errTail));
    if (!matches) return;
    const s = headlessBreakerState.get(feature) || { fails: 0, pausedUntil: 0 };
    s.fails += 1;
    if (s.fails >= HEADLESS_BREAKER_THRESHOLD && !s.pausedUntil) {
      s.pausedUntil = Date.now() + HEADLESS_BREAKER_COOLDOWN_MS;
      const untilISO = new Date(s.pausedUntil).toISOString();
      console.warn(`[circuit-breaker] paused ${feature} until ${untilISO}`);
      dispatchNotification({
        code: 9,
        text: `Headless circuit OPEN: ${feature} paused 6h (credit-style failure)`,
        log: false,
        tags: ['headless', 'circuit-breaker', feature],
        silent: false,
        source: 'headless-breaker',
      });
    }
    headlessBreakerState.set(feature, s);
  };

  const breakerSnapshot = () => {
    const now = Date.now();
    const out = {};
    for (const [feature, s] of headlessBreakerState) {
      out[feature] = {
        fails: s.fails || 0,
        paused_until: s.pausedUntil ? new Date(s.pausedUntil).toISOString() : null,
        open: s.pausedUntil > now,
      };
    }
    return out;
  };

  // At-most-once-per-day budget alert. Quiet when under the threshold.
  const checkHeadlessBudget = () => {
    const monthStart = new Date().toISOString().slice(0, 7) + '-01T00:00:00Z';
    const { costUSD } = summarizeHeadlessUsage(monthStart);
    const pct = HEADLESS_BUDGET_USD > 0 ? costUSD / HEADLESS_BUDGET_USD : 0;
    if (pct < HEADLESS_ALERT_PCT) return;
    const state = readHeadlessState();
    const today = new Date().toISOString().slice(0, 10);
    if (state.lastAlertDate === today) return;
    dispatchNotification({
      code: 9,
      text: `Headless credit ${Math.round(pct * 100)}% ($${costUSD.toFixed(2)} of $${HEADLESS_BUDGET_USD}) — GET /codex/headless/usage`,
      log: false,
      tags: ['headless', 'budget'],
      silent: false,
      source: 'headless-budget',
    });
    writeHeadlessState({ lastAlertDate: today, lastAlertPct: pct });
  };

  const runClaudeHeadless = (prompt, cwd, timeoutMs = 180000, opts = {}) => new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const ts = new Date(startedAt).toISOString();
    const feature = String(opts.feature || 'unknown').slice(0, 64);
    // opts.model wires R2 (Haiku for english-coach) — passing it adds --model
    // to the CLI invocation. Without override, Claude Code uses its default
    // (assumed Sonnet for cost accounting).
    const model = opts.model || HEADLESS_DEFAULT_MODEL;
    const modelFlag = opts.model ? ` --model ${shellSingleQuote(opts.model)}` : '';

    // Circuit breaker — refuse to spawn if the feature is paused. Logged as
    // exit_code=-2 in headless-usage so the short-circuit is observable.
    const breaker = breakerCheck(feature);
    if (breaker.open) {
      appendHeadlessUsage({
        ts, feature, model,
        prompt_chars: prompt.length,
        completion_chars: 0,
        duration_ms: 0,
        exit_code: -2,
        est_tokens: { prompt: 0, completion: 0 },
        est_cost_usd: 0,
        stderr_tail: `circuit-breaker open until ${breaker.until}`,
      });
      return reject(new Error(`circuit-breaker open for ${feature} until ${breaker.until}`));
    }

    // R1b — Append-system-prompt-file flag only when the constitution exists.
    // Lets users opt out by deleting the file; ships with biso by default.
    const sysFlag = fs.existsSync(HEADLESS_CONSTITUTION_FILE)
      ? ` --append-system-prompt-file ${shellSingleQuote(HEADLESS_CONSTITUTION_FILE)}`
      : '';

    // R1c — Compose hardened flag string. Quote VALUES (empty strings, text)
    // but leave standalone --flags alone.
    const flagStr = HEADLESS_BASE_FLAGS
      .map((f) => f.startsWith('--') ? f : shellSingleQuote(f))
      .join(' ');

    // R1d — Pipe prompt via stdin instead of inlining in argv. Defends ARG_MAX
    // (Linux 128KB, macOS 256KB) on long prompts (efficacy review, weekly).
    // Set BISA_DISABLE_STDIN_PIPE=1 to fall back to argv mode if Claude Code
    // version doesn't honor `-p` reading from stdin.
    const useStdin = process.env.BISA_DISABLE_STDIN_PIPE !== '1';
    const promptArg = useStdin ? '' : ` ${shellSingleQuote(prompt)}`;
    const stdioMode = useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];

    const child = spawn(
      USER_SHELL,
      ['-lic', `${CLAUDE_HEADLESS}${modelFlag}${sysFlag} ${flagStr} -p${promptArg}`],
      {
        cwd,
        env: scrubSubscriptionEnv(process.env), // R1a — defend $498-style billing leak
        stdio: stdioMode,
      },
    );

    if (useStdin) {
      try {
        child.stdin.write(prompt);
        child.stdin.end();
      } catch (e) {
        // Child may have died before stdin write completes — close handler will fire next.
        console.warn('[headless] stdin write failed:', e.message);
      }
    }

    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });

    let finalized = false;
    const finalize = (exitCode, errorTail) => {
      if (finalized) return;
      finalized = true;
      const inTok  = headlessEstTokens(prompt.length);
      const outTok = exitCode === 0 ? headlessEstTokens(out.length) : 0;
      appendHeadlessUsage({
        ts, feature, model,
        prompt_chars: prompt.length,
        completion_chars: out.length,
        duration_ms: Date.now() - startedAt,
        exit_code: exitCode,
        est_tokens: { prompt: inTok, completion: outTok },
        est_cost_usd: headlessEstCostUSD(model, inTok, outTok),
        stderr_tail: errorTail ? String(errorTail).slice(-200) : null,
      });
      if (exitCode === 0) breakerRecordSuccess(feature);
      else breakerRecordFailure(feature, errorTail);
      try { checkHeadlessBudget(); } catch (e) { console.warn('[headless] budget check:', e.message); }
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      finalize(-1, `headless timeout after ${timeoutMs}ms`);
      reject(new Error(`headless timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      finalize(code, code !== 0 ? (err || out) : null);
      if (code !== 0) reject(new Error(`exit ${code}: ${(err || out).slice(-500)}`));
      else resolve(out.trim());
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      finalize(-1, e.message);
      reject(e);
    });
  });

  return {
    runClaudeHeadless,
    summarizeHeadlessUsage,
    appendHeadlessUsage,
    breakerCheck,
    breakerRecordSuccess,
    breakerRecordFailure,
    breakerSnapshot,
    headlessBreakerState,
    checkHeadlessBudget,
    HEADLESS_BUDGET_USD,
    HEADLESS_ALERT_PCT,
    HEADLESS_MODEL_PRICING,
    HEADLESS_DEFAULT_MODEL,
    HEADLESS_BREAKER_THRESHOLD,
  };
};
