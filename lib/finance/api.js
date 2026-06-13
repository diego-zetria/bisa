// lib/finance/api.js
// Express router for the personal-finance feature. Mounted in server.js under
// /finance/*. Read model = Biso's own ledger (store.js); Actual Budget enriches
// the cash side when configured; Ghostfolio receives investment ops via its
// stable import API (push-only — see lib/finance/ghostfolio.js header).
//
// deps.runHeadless is the lazy `runClaudeHeadless` getter (same pattern as
// notify's broadcast) — used by POST /finance/insight for the monthly
// Claude-written analysis. Optional: endpoint 503s without it.

const express = require('express');
const profileMod = require('./profile');

module.exports = function makeFinanceRouter(deps) {
  const { requireAuth, financeStore, actual, ghostfolio, irpf, runHeadless, getCwd } = deps;
  const {
    validMonth, todayISO,
    loadTransactions, addTransaction, deleteTransaction,
    loadInvestments, addInvestment, deleteInvestment, markSynced,
  } = financeStore;

  const router = express.Router();
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const thisMonth = () => todayISO().slice(0, 7);

  // GET /finance/status — backend reachability for the tab header pills.
  router.get('/finance/status', requireAuth, async (_req, res) => {
    try {
      const [a, g] = await Promise.all([actual.health(), ghostfolio.health()]);
      const ops = loadInvestments();
      res.json({
        actual: a, ghostfolio: g,
        ledger: { investments: ops.length, unsynced: ops.filter((o) => !o.gf).length },
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Month payload shared by GET /finance/summary and POST /finance/insight.
  const buildSummary = async (month) => {
    // manual cash entries always count; Actual layers on top when configured
    const manual = loadTransactions().filter((t) => t.date.slice(0, 7) === month);
    let income = 0, expense = 0;
    const byCategory = {};
    const incomeByCategory = {}; // manual only — feeds the budget's money-in rows
    for (const t of manual) {
      if (t.kind === 'income') {
        income += t.amount;
        incomeByCategory[t.category] = r2((incomeByCategory[t.category] || 0) + t.amount);
      } else { expense += t.amount; byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; }
    }
    let actualData = { configured: false };
    if (actual.configured()) {
      try {
        actualData = await actual.monthSummary(month);
        income += actualData.income; expense += actualData.expense;
        for (const [k, v] of Object.entries(actualData.byCategory || {})) {
          byCategory[k] = r2((byCategory[k] || 0) + v);
        }
      } catch (e) { actualData = { configured: true, error: e.message }; }
    }
    for (const k of Object.keys(byCategory)) byCategory[k] = r2(byCategory[k]);

    const ops = loadInvestments();
    const { positions } = irpf.computePositions(ops);
    const monthOps = ops.filter((o) => o.date.slice(0, 7) === month);
    const invested = r2(monthOps.filter((o) => o.type === 'buy')
      .reduce((s, o) => s + o.qty * o.price + (o.fees || 0), 0));
    const incomeFromAssets = r2(monthOps.filter((o) => ['dividend', 'jcp', 'rent'].includes(o.type))
      .reduce((s, o) => s + (o.amount || 0), 0));

    return {
      month,
      cash: {
        income: r2(income), expense: r2(expense), net: r2(income - expense),
        byCategory, incomeByCategory, manualCount: manual.length, manual,
        actual: actualData,
      },
      invest: {
        positions: Object.values(positions),
        totalCost: r2(Object.values(positions).reduce((s, p) => s + p.totalCost, 0)),
        monthInvested: invested, monthIncome: incomeFromAssets,
        monthOps,
      },
    };
  };

  // GET /finance/summary?month=YYYY-MM — the FIN tab main payload.
  router.get('/finance/summary', requireAuth, async (req, res) => {
    const month = validMonth(req.query.month) ? req.query.month : thisMonth();
    try { res.json(await buildSummary(month)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /finance/profile — family plan + computed loan state (the PLAN card).
  router.get('/finance/profile', requireAuth, (_req, res) => {
    try {
      const profile = profileMod.loadProfile();
      if (!profile) return res.json({ profile: null });
      res.json({
        profile,
        loans: (profile.loans || []).map((l) => profileMod.loanState(l)),
        onboarding: profileMod.onboardingStatus(),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- manual cash transactions ---
  router.post('/finance/tx', requireAuth, (req, res) => {
    try { res.json({ ok: true, tx: addTransaction(req.body || {}) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.delete('/finance/tx', requireAuth, (req, res) => {
    if (!req.query.id) return res.status(400).json({ error: 'id required' });
    res.json({ ok: deleteTransaction(req.query.id) });
  });

  // --- investment ops (the IRPF ledger) ---
  router.get('/finance/invest', requireAuth, (req, res) => {
    const year = String(req.query.year || '').match(/^\d{4}$/) ? req.query.year : null;
    const ops = loadInvestments();
    res.json({ ops: year ? ops.filter((o) => o.date.slice(0, 4) === year) : ops });
  });
  router.post('/finance/invest', requireAuth, (req, res) => {
    try { res.json({ ok: true, op: addInvestment(req.body || {}) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.delete('/finance/invest', requireAuth, (req, res) => {
    if (!req.query.id) return res.status(400).json({ error: 'id required' });
    res.json({ ok: deleteInvestment(req.query.id) });
  });

  // GET /finance/positions — current holdings at average price.
  router.get('/finance/positions', requireAuth, (_req, res) => {
    try {
      const { positions } = irpf.computePositions(loadInvestments());
      res.json({ positions: Object.values(positions) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /finance/irpf?year=2026 — the full declaração-2027 working report.
  router.get('/finance/irpf', requireAuth, (req, res) => {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    try { res.json(irpf.irpfReport(loadInvestments(), year)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /finance/sync/ghostfolio — push un-synced ledger ops.
  router.post('/finance/sync/ghostfolio', requireAuth, async (_req, res) => {
    if (!ghostfolio.configured()) {
      return res.status(503).json({ error: 'Ghostfolio not configured (GHOSTFOLIO_URL / GHOSTFOLIO_TOKEN)' });
    }
    try {
      const pending = loadInvestments().filter((o) => !o.gf);
      if (!pending.length) return res.json({ ok: true, pushed: 0, errors: [] });
      const { okIds, errors } = await ghostfolio.pushOps(pending);
      if (okIds.length) markSynced(okIds);
      res.json({ ok: errors.length === 0, pushed: okIds.length, errors });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /finance/insight {month} — Claude-written monthly analysis (headless).
  router.post('/finance/insight', requireAuth, async (req, res) => {
    if (typeof runHeadless !== 'function') {
      return res.status(503).json({ error: 'headless runner unavailable' });
    }
    const month = validMonth((req.body || {}).month) ? req.body.month : thisMonth();
    try {
      const summary = await buildSummary(month);
      const year = parseInt(month.slice(0, 4), 10);
      const report = irpf.irpfReport(loadInvestments(), year);
      const ctx = {
        month,
        cash: summary.cash,
        invest: summary.invest,
        irpfMonth: report.monthly.find((m) => m.month === month) || null,
        darfsYear: report.darfs,
      };
      const prompt = [
        `You are the finance analyst inside bisa (personal tool). Analyze this month (${month}) of personal finances.`,
        'Data (BRL):', JSON.stringify(ctx),
        'Write a concise analysis in Portuguese (max ~250 words): cash-flow health,',
        'spending categories that stand out, investment moves, any DARF due and its deadline,',
        'and ONE concrete suggestion for next month. Plain text, no markdown headers.',
      ].join('\n');
      // Haiku: summarizing a JSON payload into ~250 words — same tier as english-coach.
      const text = await runHeadless(prompt, getCwd(), 120000,
        { feature: 'finance-insight', model: 'claude-haiku-4-5' });
      res.json({ ok: true, month, insight: text });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
