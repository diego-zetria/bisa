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
    loadTransactions, addTransaction, updateTransaction, deleteTransaction,
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
    let income = 0, expense = 0, pendingIncome = 0, pendingExpense = 0;
    const byCategory = {};
    const incomeByCategory = {}; // manual only — feeds the budget's money-in rows
    for (const t of manual) {
      // pendente (renda "a receber" / aporte provisionado) fica fora do caixa
      if (t.kind === 'income') {
        if (t.pending) { pendingIncome += t.amount; continue; }
        income += t.amount;
        incomeByCategory[t.category] = r2((incomeByCategory[t.category] || 0) + t.amount);
      } else {
        if (t.pending) { pendingExpense += t.amount; continue; }
        expense += t.amount; byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
      }
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
        pendingIncome: r2(pendingIncome), pendingExpense: r2(pendingExpense),
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

  // POST /finance/budget {label, bucket, dueDay, amount, amountUSD, tags} — cria
  // um item de custo. category é derivada do label (slug único).
  router.post('/finance/budget', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!b.label || !String(b.label).trim()) return res.status(400).json({ error: 'label required' });
    const line = profileMod.addBudgetItem(b);
    if (!line) return res.status(404).json({ error: 'no profile' });
    res.status(201).json({ ok: true, line });
  });

  // PATCH /finance/budget {category, ...campos} — edita um item: label, bucket,
  // dueDay (omita/0 = sem vencimento), amount | amountUSD, tags.
  router.patch('/finance/budget', requireAuth, (req, res) => {
    const { category, ...fields } = req.body || {};
    if (!category) return res.status(400).json({ error: 'category required' });
    for (const k of ['amount', 'amountUSD']) {
      if (fields[k] != null && (!Number.isFinite(Number(fields[k])) || Number(fields[k]) < 0)) {
        return res.status(400).json({ error: `${k} must be a non-negative number` });
      }
    }
    const line = profileMod.updateBudgetItem(String(category), fields);
    if (!line) return res.status(404).json({ error: 'budget line not found' });
    res.json({ ok: true, line });
  });

  // DELETE /finance/budget?category=... — remove um item de custo.
  router.delete('/finance/budget', requireAuth, (req, res) => {
    if (!req.query.category) return res.status(400).json({ error: 'category required' });
    res.json({ ok: profileMod.deleteBudgetItem(String(req.query.category)) });
  });

  // POST /finance/tags {name, bucket} — cria/atualiza uma tag (bucket null = todas).
  router.post('/finance/tags', requireAuth, (req, res) => {
    const { name, bucket } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const tags = profileMod.addTagDef({ name, bucket: bucket || null });
    if (!tags) return res.status(404).json({ error: 'no profile' });
    res.json({ ok: true, tags });
  });

  // DELETE /finance/tags?name=... — remove uma tag do vocabulário.
  router.delete('/finance/tags', requireAuth, (req, res) => {
    if (!req.query.name) return res.status(400).json({ error: 'name required' });
    res.json({ ok: profileMod.deleteTagDef(String(req.query.name)) });
  });

  // --- objetivos (planos que acumulam aportes) ---
  router.post('/finance/objectives', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!b.label || !String(b.label).trim()) return res.status(400).json({ error: 'label required' });
    const o = profileMod.addObjective(b);
    if (!o) return res.status(404).json({ error: 'no profile' });
    res.status(201).json({ ok: true, objective: o });
  });
  router.patch('/finance/objectives', requireAuth, (req, res) => {
    const { id, ...fields } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const o = profileMod.updateObjective(String(id), fields);
    if (!o) return res.status(404).json({ error: 'objective not found' });
    res.json({ ok: true, objective: o });
  });
  router.delete('/finance/objectives', requireAuth, (req, res) => {
    if (!req.query.id) return res.status(400).json({ error: 'id required' });
    res.json({ ok: profileMod.deleteObjective(String(req.query.id)) });
  });

  // PATCH /finance/fx {rate} — cotação padrão de planejamento (R$/US$).
  router.patch('/finance/fx', requireAuth, (req, res) => {
    const fx = profileMod.updateFx((req.body || {}).rate);
    if (!fx) return res.status(400).json({ error: 'rate must be a positive number / no profile' });
    res.json({ ok: true, fx });
  });

  // PATCH /finance/allocation {bucket, pct|amount|rest} — meta de um envelope
  // (AUVP). pct = % da renda (0–100). amount = valor fixo em R$ (>0 fixa a meta;
  // null/0 desafixa e volta a usar a %). rest = true marca o envelope como
  // "resto da renda" (meta = renda − demais; único por perfil), false desmarca.
  router.patch('/finance/allocation', requireAuth, (req, res) => {
    const { bucket, pct, amount, rest } = req.body || {};
    if (!bucket) return res.status(400).json({ error: 'bucket required' });
    if (rest !== undefined) {
      const r = profileMod.updateAllocationRest(String(bucket), !!rest);
      if (!r) return res.status(404).json({ error: 'no profile / invalid bucket' });
      return res.json({ ok: true, ...r });
    }
    if (amount !== undefined) {
      const a = Number(amount);
      if (amount !== null && (!Number.isFinite(a) || a < 0)) {
        return res.status(400).json({ error: 'amount must be a non-negative number' });
      }
      const allocationFixed = profileMod.updateAllocationFixed(String(bucket), amount);
      if (!allocationFixed) return res.status(404).json({ error: 'no profile / invalid bucket' });
      return res.json({ ok: true, allocationFixed });
    }
    const n = Number(pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: 'pct must be 0–100' });
    const allocation = profileMod.updateAllocation(String(bucket), n);
    if (!allocation) return res.status(404).json({ error: 'no profile / invalid bucket' });
    res.json({ ok: true, allocation });
  });

  // --- manual cash transactions ---
  // creditGoal: true faz o servidor creditar o objetivo vinculado (tx.goalId)
  // no mesmo request da gravação — o frontend não precisa de um 2º request
  // (que, falhando, deixava tx e objetivo divergentes). Só credita aporte
  // efetivado (expense, não-pendente).
  const maybeCreditGoal = (tx, wanted, sign = 1) => {
    if (!wanted || !tx || tx.kind !== 'expense' || !tx.goalId || tx.pending) return null;
    return profileMod.creditObjective(tx.goalId, sign * tx.amount);
  };
  router.post('/finance/tx', requireAuth, (req, res) => {
    const { creditGoal, ...body } = req.body || {};
    try {
      const tx = addTransaction(body);
      const objective = maybeCreditGoal(tx, creditGoal);
      res.json({ ok: true, tx, ...(objective ? { objective } : {}) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // PATCH /finance/tx {id, ...campos} — edita in-place (amount, desc, date,
  // category, bucket, goalId, pending; pending:false efetiva um provisionado).
  router.patch('/finance/tx', requireAuth, (req, res) => {
    const { id, creditGoal, ...fields } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const tx = updateTransaction(String(id), fields);
      if (!tx) return res.status(404).json({ error: 'tx not found' });
      const objective = maybeCreditGoal(tx, creditGoal);
      res.json({ ok: true, tx, ...(objective ? { objective } : {}) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // DELETE /finance/tx?id=...&creditGoal=1 — creditGoal desconta do objetivo
  // vinculado o aporte que está sendo removido (desfazer).
  router.delete('/finance/tx', requireAuth, (req, res) => {
    if (!req.query.id) return res.status(400).json({ error: 'id required' });
    const id = String(req.query.id);
    const tx = loadTransactions().find((t) => t.id === id) || null;
    const ok = deleteTransaction(id);
    if (ok) maybeCreditGoal(tx, req.query.creditGoal === '1', -1);
    res.json({ ok });
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
