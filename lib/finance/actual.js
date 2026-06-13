// lib/finance/actual.js
// Thin wrapper around @actual-app/api (the ONLY headless surface Actual
// exposes — no REST; see docs/finance.md). Lazily initialized on first use so
// the server boots fine when Actual isn't configured or the dep isn't
// installed. Config via .env:
//   ACTUAL_SERVER_URL       e.g. http://localhost:5006
//   ACTUAL_SERVER_PASSWORD  sync-server password
//   ACTUAL_SYNC_ID          budget Sync ID (Actual UI → Settings → Advanced)
//   ACTUAL_BUDGET_PASSWORD  only when the budget file has E2E encryption
//
// Amounts from Actual are integer cents; everything returned here is BRL floats
// to match the rest of lib/finance.

const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.BISA_FINANCE_DIR
  ? path.join(process.env.BISA_FINANCE_DIR, '.actual-cache')
  : path.join(__dirname, '..', '..', 'codex', 'finance', '.actual-cache');

const cfg = () => ({
  url: process.env.ACTUAL_SERVER_URL || '',
  password: process.env.ACTUAL_SERVER_PASSWORD || '',
  syncId: process.env.ACTUAL_SYNC_ID || '',
  budgetPassword: process.env.ACTUAL_BUDGET_PASSWORD || '',
});

const configured = () => {
  const c = cfg();
  return !!(c.url && c.password && c.syncId);
};

let api = null;        // loaded module
let ready = null;      // in-flight/done init promise

const loadApi = () => {
  if (api) return api;
  // eslint-disable-next-line global-require
  api = require('@actual-app/api');
  return api;
};

const init = () => {
  if (!ready) {
    ready = (async () => {
      const c = cfg();
      const a = loadApi();
      fs.mkdirSync(DATA_DIR, { recursive: true });
      await a.init({ dataDir: DATA_DIR, serverURL: c.url, password: c.password });
      const opts = c.budgetPassword ? { password: c.budgetPassword } : undefined;
      await a.downloadBudget(c.syncId, opts);
      return a;
    })();
    // allow retry after a failed init (e.g. container still booting)
    ready.catch(() => { ready = null; });
  }
  return ready;
};

const centsToBRL = (n) => Math.round(Number(n) || 0) / 100;

// Month summary straight from the Actual budget: account balances plus
// income/expense/byCategory for YYYY-MM. `sync()` first so Pluggy-synced
// transactions pulled by the Actual UI/cron are visible here.
const monthSummary = async (month) => {
  const a = await init();
  try { await a.sync(); } catch { /* offline sync server — use local copy */ }

  const accounts = (await a.getAccounts()).filter((acc) => !acc.closed);
  const balances = [];
  for (const acc of accounts) {
    const bal = await a.getAccountBalance(acc.id);
    balances.push({ id: acc.id, name: acc.name, offBudget: !!acc.offbudget, balance: centsToBRL(bal) });
  }

  const categories = await a.getCategories();
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  let income = 0, expense = 0;
  const byCategory = {};
  for (const acc of accounts) {
    if (acc.offbudget) continue;
    const txs = await a.getTransactions(acc.id, start, end);
    for (const t of txs) {
      if (t.is_parent) continue; // children carry the split amounts
      const v = centsToBRL(t.amount);
      if (v >= 0) income += v;
      else {
        expense += -v;
        const name = catName[t.category] || 'uncategorized';
        byCategory[name] = (byCategory[name] || 0) + -v;
      }
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const k of Object.keys(byCategory)) byCategory[k] = r2(byCategory[k]);
  return {
    configured: true, month,
    accounts: balances,
    income: r2(income), expense: r2(expense), net: r2(income - expense),
    byCategory,
  };
};

const health = async () => {
  const c = cfg();
  if (!c.url) return { configured: false, up: false };
  try {
    const r = await fetch(c.url + '/info', { signal: AbortSignal.timeout(3000) });
    return { configured: configured(), up: r.ok };
  } catch { return { configured: configured(), up: false }; }
};

const shutdown = async () => {
  if (!ready) return;
  try { const a = await ready; await a.shutdown(); } catch { /* already down */ }
  ready = null;
};

module.exports = { configured, monthSummary, health, shutdown };
