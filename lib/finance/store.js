// lib/finance/store.js
// Storage for the personal-finance feature: manual cash transactions and the
// investment-operations ledger (the IRPF source of truth — see lib/finance/irpf.js).
//
// Two append-friendly JSONL files under <repo>/codex/finance/ (gitignored —
// personal financial data, same posture as codex/recordings/):
//   transactions.jsonl  — manual cash entries  { id, date, kind, amount, category, desc }
//   investments.jsonl   — investment ops       { id, date, type, assetClass, symbol, qty, price, fees, note, gf }
//
// Cash from bank sync lives in Actual Budget (containers), NOT here — these
// manual entries exist so the FIN tab works before/without Actual configured.
// Amounts are BRL floats; rounding to cents happens at report time (irpf.js).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const FINANCE_DIR = process.env.BISA_FINANCE_DIR
  || path.join(__dirname, '..', '..', 'codex', 'finance');
const TX_FILE = path.join(FINANCE_DIR, 'transactions.jsonl');
const INVEST_FILE = path.join(FINANCE_DIR, 'investments.jsonl');

const TX_KINDS = ['income', 'expense'];
const OP_TYPES = ['buy', 'sell', 'dividend', 'jcp', 'rent']; // rent = FII rendimento
const ASSET_CLASSES = ['stock', 'fii', 'etf', 'bdr', 'crypto'];

const genId = (p) => `${p}-${crypto.randomBytes(4).toString('hex')}`;
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const validMonth = (s) => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const readJsonl = (file) => {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  return out;
};

const writeJsonl = (file, items) => {
  fs.mkdirSync(FINANCE_DIR, { recursive: true });
  fs.writeFileSync(file, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), 'utf8');
};

const appendJsonl = (file, item) => {
  fs.mkdirSync(FINANCE_DIR, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(item) + '\n', 'utf8');
};

// --- cash transactions -------------------------------------------------------

const loadTransactions = () => readJsonl(TX_FILE);

const addTransaction = ({ date, kind, amount, category, desc }) => {
  const tx = {
    id: genId('tx'),
    date: validDate(date) ? date : todayISO(),
    kind: TX_KINDS.includes(kind) ? kind : 'expense',
    amount: Math.abs(Number(amount) || 0),
    category: String(category || 'other').slice(0, 40),
    desc: String(desc || '').slice(0, 200),
  };
  if (!tx.amount) throw new Error('amount must be a positive number');
  appendJsonl(TX_FILE, tx);
  return tx;
};

const deleteTransaction = (id) => {
  const items = loadTransactions();
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return false;
  writeJsonl(TX_FILE, next);
  return true;
};

// --- investment operations ----------------------------------------------------

const loadInvestments = () => readJsonl(INVEST_FILE)
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// buy/sell: qty + price (unit) + fees. dividend/jcp/rent: amount (total received).
const addInvestment = ({ date, type, assetClass, symbol, qty, price, amount, fees, note, gfSymbol }) => {
  if (!OP_TYPES.includes(type)) throw new Error(`type must be one of ${OP_TYPES.join('|')}`);
  if (!ASSET_CLASSES.includes(assetClass)) throw new Error(`assetClass must be one of ${ASSET_CLASSES.join('|')}`);
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('symbol required');
  const op = {
    id: genId('iv'),
    date: validDate(date) ? date : todayISO(),
    type, assetClass, symbol: sym,
    fees: Math.abs(Number(fees) || 0),
    note: String(note || '').slice(0, 200),
    gf: false, // pushed to Ghostfolio yet?
  };
  if (type === 'buy' || type === 'sell') {
    op.qty = Number(qty) || 0;
    op.price = Number(price) || 0;
    if (op.qty <= 0 || op.price <= 0) throw new Error('buy/sell require positive qty and price');
  } else {
    op.amount = Math.abs(Number(amount) || 0);
    if (!op.amount) throw new Error(`${type} requires a positive amount`);
  }
  if (gfSymbol) op.gfSymbol = String(gfSymbol).trim();
  appendJsonl(INVEST_FILE, op);
  return op;
};

const deleteInvestment = (id) => {
  const items = readJsonl(INVEST_FILE);
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return false;
  writeJsonl(INVEST_FILE, next);
  return true;
};

const markSynced = (ids) => {
  const set = new Set(ids);
  const items = readJsonl(INVEST_FILE);
  for (const it of items) if (set.has(it.id)) it.gf = true;
  writeJsonl(INVEST_FILE, items);
};

module.exports = {
  FINANCE_DIR, TX_FILE, INVEST_FILE,
  TX_KINDS, OP_TYPES, ASSET_CLASSES,
  genId, validDate, validMonth, todayISO,
  loadTransactions, addTransaction, deleteTransaction,
  loadInvestments, addInvestment, deleteInvestment, markSynced,
};
