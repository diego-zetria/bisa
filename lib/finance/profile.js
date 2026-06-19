// lib/finance/profile.js
// Family financial profile for the FIN tab PLAN card. profile.json is
// hand-maintained (sources: Diego's plan 2026-06-10 + the Santander CGI
// contract review in ~/projects/debt-analysis); Gabriela's questionnaire
// answers (onboarding/latest.json) refine the goals when present.
//
// Loan math is SAC only (fixed amortization + rate on the declining balance)
// because that's what the one real loan uses — no Price tables here.

const path = require('path');
const fs = require('fs');

const FINANCE_DIR = process.env.BISA_FINANCE_DIR
  || path.join(__dirname, '..', '..', 'codex', 'finance');
const PROFILE_FILE = path.join(FINANCE_DIR, 'profile.json');
const OB_LATEST = path.join(FINANCE_DIR, 'onboarding', 'latest.json');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const loadProfile = () => {
  try { return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch { return null; }
};

const saveProfile = (profile) => {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2) + '\n', 'utf8');
};

// Edit the planned amount (BRL) of a budget line, found by category. Drops any
// amountUSD so the line becomes a plain BRL value she controls. Returns the
// updated line, or null if there's no profile / no line with that category.
const updateBudgetAmount = (category, amount) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.budget)) return null;
  const line = profile.budget.find((b) => b.category === category);
  if (!line) return null;
  line.amount = r2(amount);
  delete line.amountUSD;
  saveProfile(profile);
  return line;
};

// Reordena profile.budget para casar com a sequência de categorias dada (ordem
// final desejada, achatada). Categorias ausentes da lista vão ao fim, mantendo
// a ordem relativa original. Retorna o budget reordenado, ou null sem perfil.
const reorderBudget = (orderedCategories) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.budget)) return null;
  const idx = new Map(orderedCategories.map((c, i) => [String(c), i]));
  const at = (cat) => (idx.has(cat) ? idx.get(cat) : Infinity);
  profile.budget = profile.budget
    .map((line, i) => ({ line, i }))
    .sort((a, b) => (at(a.line.category) - at(b.line.category)) || (a.i - b.i))
    .map((x) => x.line);
  saveProfile(profile);
  return profile.budget;
};

// nth installment due date as YYYY-MM-DD (n is 1-based).
const dueDateOf = (firstDueDate, n) => {
  const [y, m, d] = firstDueDate.split('-').map(Number);
  const t = y * 12 + (m - 1) + (n - 1);
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Current state of a SAC loan: how many installments are paid (assumes the
// auto-debit never misses — see profile warnings), the balance, and the next
// installment's number/date/value.
const loanState = (loan, today = new Date()) => {
  const { principal: P, monthlyAmortization: A, monthlyRate, installments: N } = loan;
  const [fy, fm] = loan.firstDueDate.split('-').map(Number);
  const monthsSinceFirst = (today.getFullYear() - fy) * 12 + (today.getMonth() + 1 - fm);
  const dueThisMonth = monthsSinceFirst + 1; // installment number that falls in the current month
  let paid = dueThisMonth - (today.getDate() < (loan.dueDay || 1) ? 1 : 0);
  paid = Math.min(N, Math.max(0, paid));
  const settled = paid >= N;
  const next = settled ? null : paid + 1;
  return {
    id: loan.id, label: loan.label, system: loan.system,
    paid, total: N, settled,
    balance: r2(P - paid * A),
    next: settled ? null : {
      n: next,
      dueDate: dueDateOf(loan.firstDueDate, next),
      value: r2(A + (P - (next - 1) * A) * monthlyRate),
    },
    endDate: dueDateOf(loan.firstDueDate, N).slice(0, 7),
    totalIfHeld: loan.totalIfHeld,
    opportunity: loan.opportunity || null,
    warnings: loan.warnings || [],
  };
};

// Questionnaire status + the few answers the PLAN card uses (NOT the full
// payload — the Excel paste can be 200kb).
const onboardingStatus = () => {
  try {
    const rec = JSON.parse(fs.readFileSync(OB_LATEST, 'utf8'));
    const a = rec.answers || {};
    return { answered: true, ts: rec.ts, reserva_onde: a.reserva_onde || null };
  } catch { return { answered: false }; }
};

module.exports = { loadProfile, saveProfile, updateBudgetAmount, reorderBudget, loanState, onboardingStatus };
