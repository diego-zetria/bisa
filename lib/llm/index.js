// lib/llm/index.js
// Factory for the LLM subsystem: session, API client, policy, usage.
//
// Exports:
//   router          — Express Router: GET /llm/status, POST /llm/permission,
//                     GET /llm/usage
//   handleWsMessage — dispatch llm.send / llm.interrupt / llm.permission WS msgs
//   attachLoop      — receive the loop object (not used yet, wired for future use)
//   runHeadlessForJob(jobName, ...args) — route a job through policy
//   microTask(kind, text)              — haiku micro-task, returns string | null

'use strict';

const express = require('express');
const policy  = require('./policy');
const makeApi = require('./api');
const makeSession = require('./session');
const { readUsage, summarize, monthlyApiSpend } = require('./usage');

module.exports = function makeLlm(deps) {
  const {
    requireAuth, requireSupervisor, isSupervisor,
    CWD, CLAUDE_CMD, USER_SHELL, CODEX_DIR,
    headless, dispatchNotification, broadcast,
  } = deps;

  // ── API client ──────────────────────────────────────────────────────────────
  const api = makeApi({ CWD, dispatchNotification });

  // ── Interactive session ──────────────────────────────────────────────────────
  const session = makeSession({
    CWD, CLAUDE_CMD, USER_SHELL,
    broadcast, dispatchNotification,
  });

  // ── Loop reference (for future use) ─────────────────────────────────────────
  let _loop = null;
  const attachLoop = (loop) => { _loop = loop; };

  // ── Express Router ───────────────────────────────────────────────────────────
  const router = express.Router();

  // GET /llm/status
  router.get('/llm/status', requireAuth, (req, res) => {
    const pol = policy.snapshot();
    const usedUsd = monthlyApiSpend(CWD);
    res.json({
      session: session.getState(),
      policy: pol,
      apiBudget: {
        usedUsd,
        capUsd: pol.apiBudgetMonthlyUsd,
      },
    });
  });

  // POST /llm/permission { requestId, allow }
  // In -p mode, permissions are auto-granted by the CLI; this endpoint exists
  // for protocol completeness but has no running session to forward to.
  router.post('/llm/permission', requireAuth, (req, res) => {
    const { requestId, allow } = req.body || {};
    if (!requestId) return res.status(400).json({ error: 'requestId required' });
    // No active permission flow in -p mode: acknowledge silently.
    console.log(`[llm] permission decision: requestId=${requestId} allow=${allow}`);
    res.json({ ok: true });
  });

  // GET /llm/usage (supervisor only)
  router.get('/llm/usage', requireSupervisor, (req, res) => {
    const since = req.query.since || undefined;
    const rows = readUsage(CWD, { since });
    const summary = summarize(rows);
    res.json({ rows, summary });
  });

  // ── WS message handler ───────────────────────────────────────────────────────
  const handleWsMessage = (ws, msg) => {
    switch (msg.type) {
      case 'llm.send': {
        const text = typeof msg.text === 'string' ? msg.text.trim() : '';
        if (!text) return;
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        session.send(text, attachments).catch((e) => {
          // Errors are already broadcast inside session; swallow here.
        });
        break;
      }

      case 'llm.interrupt': {
        session.interrupt();
        break;
      }

      case 'llm.permission': {
        // Same as POST /llm/permission — no active flow in -p mode.
        const { requestId, allow } = msg;
        console.log(`[llm] ws permission: requestId=${requestId} allow=${allow}`);
        break;
      }

      default:
        break;
    }
  };

  // ── runHeadlessForJob ────────────────────────────────────────────────────────
  // Routes a scheduled job through policy:
  //   'api'      → call Anthropic API, return text (same shape as headless)
  //   'claude-p' → delegate to headless.runClaudeHeadless (subscription billing)
  //   'off'      → resolve with empty string (loop tolerates this)
  const runHeadlessForJob = (jobName, prompt, cwd, timeoutMs, opts) => {
    const route = policy.resolveRoute(jobName);

    if (route === 'off') {
      console.log(`[llm] job "${jobName}" is off — skipping`);
      return Promise.resolve('');
    }

    if (route === 'claude-p') {
      return headless.runClaudeHeadless(prompt, cwd || CWD, timeoutMs, opts);
    }

    // route === 'api'
    const model = process.env.API_MODEL_JOBS || 'claude-sonnet-4-6';
    return api.runJobViaApi(prompt, { kind: 'job', job: jobName, model });
  };

  // ── microTask ────────────────────────────────────────────────────────────────
  // Returns trimmed string or null. Never throws.
  const microTask = (kind, text) => {
    const route = policy.resolveMicroRoute();
    if (route === 'off') return Promise.resolve(null);
    if (route === 'claude-p') {
      // Fall back: run a headless micro call with a short timeout
      return headless.runClaudeHeadless(text, CWD, 30000, { feature: 'micro-' + kind })
        .then((out) => out.trim() || null)
        .catch(() => null);
    }
    // route === 'api'
    return api.microTask(kind, text);
  };

  return { router, handleWsMessage, attachLoop, runHeadlessForJob, microTask };
};
