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

// Edit the planned amount of a budget line, found by category. currency 'USD'
// stores it as amountUSD (a dollar-denominated source like Diego's transfer);
// anything else stores a plain BRL `amount`. The other field is dropped so the
// line is single-currency. Returns the updated line, or null if not found.
const updateBudgetAmount = (category, amount, currency) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.budget)) return null;
  const line = profile.budget.find((b) => b.category === category);
  if (!line) return null;
  if (currency === 'USD') { line.amountUSD = r2(amount); delete line.amount; }
  else { line.amount = r2(amount); delete line.amountUSD; }
  saveProfile(profile);
  return line;
};

// AUVP envelope buckets + default % allocation (soma 100).
const BUCKETS = ['custo-fixo', 'conforto', 'liberdade', 'metas', 'prazeres', 'conhecimento'];
const DEFAULT_ALLOCATION = { 'custo-fixo': 30, conforto: 15, liberdade: 25, metas: 15, prazeres: 10, conhecimento: 5 };

// Update one bucket's target % in profile.allocation (0–100). Returns the full
// allocation map, or null if there's no profile. Other buckets are untouched —
// the total may drift from 100% (the UI surfaces that, like AUVP's "Minhas Metas").
const updateAllocation = (bucket, pct) => {
  const profile = loadProfile();
  if (!profile) return null;
  if (!BUCKETS.includes(bucket)) return null;
  if (!profile.allocation) profile.allocation = { ...DEFAULT_ALLOCATION };
  profile.allocation[bucket] = Math.max(0, Math.min(100, r2(pct)));
  saveProfile(profile);
  return profile.allocation;
};

// Fixa a meta de um envelope num valor absoluto em R$ (guardado em
// profile.allocationFixed[bucket]) — usado quando o alvo não é um % redondo da
// renda (ex.: Liberdade = R$ 10.000 exatos). amount <= 0/inválido desafixa
// (volta a usar a %). Retorna o mapa, ou null sem perfil / bucket inválido.
const updateAllocationFixed = (bucket, amount) => {
  const profile = loadProfile();
  if (!profile) return null;
  if (!BUCKETS.includes(bucket)) return null;
  if (!profile.allocationFixed) profile.allocationFixed = {};
  const a = Number(amount);
  if (!(a > 0)) delete profile.allocationFixed[bucket];
  else profile.allocationFixed[bucket] = r2(a);
  saveProfile(profile);
  return profile.allocationFixed;
};

// Marca um envelope como "resto da renda": a meta dele passa a ser renda −
// metas dos demais (calculado na tela). Um único por perfil, guardado em
// profile.allocationRest. on=false desmarca (volta a usar a %).
const updateAllocationRest = (bucket, on) => {
  const profile = loadProfile();
  if (!profile) return null;
  if (!BUCKETS.includes(bucket)) return null;
  if (on) profile.allocationRest = bucket;
  else if (profile.allocationRest === bucket) delete profile.allocationRest;
  saveProfile(profile);
  return { allocationRest: profile.allocationRest || null };
};

// Cotação padrão de planejamento (R$/US$) — usada para valorar o dinheiro que
// fica em dólar (liberdade financeira). Guardada em profile.fx.BRLperUSD.
const updateFx = (rate) => {
  const profile = loadProfile();
  if (!profile) return null;
  const r = Number(rate);
  if (!(r > 0)) return null;
  if (!profile.fx) profile.fx = {};
  profile.fx.BRLperUSD = r2(r);
  saveProfile(profile);
  return profile.fx;
};

// --- budget item CRUD (the cost items managed in "Gerenciar custos") ---------

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 40);

const cleanTags = (tags) => (Array.isArray(tags)
  ? [...new Set(tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 12)
  : undefined);

const applyItemFields = (line, f) => {
  if (f.label != null) line.label = String(f.label).slice(0, 80);
  if (f.bucket !== undefined && BUCKETS.includes(f.bucket)) line.bucket = f.bucket;
  // salário completo em US$ (fonte de renda do Diego): o que excede o amountUSD
  // transferido fica em dólar e é destinado à liberdade financeira.
  if (f.salaryUSD !== undefined) { const s = Number(f.salaryUSD); if (s > 0) line.salaryUSD = r2(s); else delete line.salaryUSD; }
  if (f.dueDay !== undefined) {
    const d = parseInt(f.dueDay, 10);
    if (d >= 1 && d <= 31) line.dueDay = d; else delete line.dueDay; // sem vencimento
  }
  // single-currency: amount (BRL) e amountUSD são mutuamente exclusivos
  if (f.amountUSD !== undefined && f.amountUSD !== null) { line.amountUSD = r2(f.amountUSD); delete line.amount; }
  else if (f.amount !== undefined && f.amount !== null) { line.amount = r2(f.amount); delete line.amountUSD; }
  if (f.tags !== undefined) { const t = cleanTags(f.tags); if (t && t.length) line.tags = t; else delete line.tags; }
};

// Cria um item de custo (linha de despesa). category é derivada do label
// (slug único). Retorna a linha criada, ou null sem perfil.
const addBudgetItem = (fields) => {
  const profile = loadProfile();
  if (!profile) return null;
  if (!Array.isArray(profile.budget)) profile.budget = [];
  const base = slugify(fields.label) || 'item';
  let cat = base; let i = 2;
  while (profile.budget.some((b) => b.category === cat)) { cat = `${base}-${i}`; i += 1; }
  const line = { kind: 'expense', category: cat, label: String(fields.label || cat).slice(0, 80), bucket: 'custo-fixo' };
  applyItemFields(line, fields);
  if (line.amount == null && line.amountUSD == null) line.amount = 0;
  profile.budget.push(line);
  saveProfile(profile);
  return line;
};

// Edita campos de um item (label, bucket, dueDay, amount/amountUSD, tags).
const updateBudgetItem = (category, fields) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.budget)) return null;
  const line = profile.budget.find((b) => b.category === category);
  if (!line) return null;
  applyItemFields(line, fields);
  saveProfile(profile);
  return line;
};

const deleteBudgetItem = (category) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.budget)) return false;
  const next = profile.budget.filter((b) => b.category !== category);
  if (next.length === profile.budget.length) return false;
  profile.budget = next;
  saveProfile(profile);
  return true;
};

// --- objectives (objetivos/planos que acumulam aportes de liberdade/metas) ----
// Cada objetivo: { id, label, bucket: 'liberdade'|'metas', currency: 'USD'|'BRL',
// current (saldo atual na moeda), target (meta em BRL), note }. O saldo é mantido
// e os aportes vinculados somam por cima (frontend faz current += aporte).
const OBJ_BUCKETS = ['liberdade', 'metas'];

const applyObjectiveFields = (o, f) => {
  if (f.label != null) o.label = String(f.label).slice(0, 80);
  if (f.bucket !== undefined && OBJ_BUCKETS.includes(f.bucket)) o.bucket = f.bucket;
  if (f.currency !== undefined) o.currency = (f.currency === 'USD' ? 'USD' : 'BRL');
  if (f.current !== undefined && f.current !== null) o.current = r2(f.current);
  if (f.target !== undefined && f.target !== null) o.target = r2(f.target);
  if (f.note !== undefined) o.note = String(f.note || '').slice(0, 200);
};

const addObjective = (fields) => {
  const profile = loadProfile();
  if (!profile) return null;
  if (!Array.isArray(profile.objectives)) profile.objectives = [];
  const base = slugify(fields.label) || 'obj';
  let id = base; let i = 2;
  while (profile.objectives.some((o) => o.id === id)) { id = `${base}-${i}`; i += 1; }
  const o = { id, label: String(fields.label || id).slice(0, 80), bucket: 'liberdade', currency: 'BRL', current: 0, target: 0, note: '' };
  applyObjectiveFields(o, fields);
  profile.objectives.push(o);
  saveProfile(profile);
  return o;
};

const updateObjective = (id, fields) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.objectives)) return null;
  const o = profile.objectives.find((x) => x.id === id);
  if (!o) return null;
  applyObjectiveFields(o, fields);
  saveProfile(profile);
  return o;
};

// Credita (deltaBRL > 0) ou desconta (deltaBRL < 0) um valor em R$ no saldo de
// um objetivo, convertendo p/ a moeda dele pela cotação padrão (profile.fx).
// Chamado pelo próprio servidor junto com a gravação da tx (mesmo request) —
// evita a divergência tx-salva/objetivo-não-creditado do fluxo em 2 requests.
const creditObjective = (id, deltaBRL) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.objectives)) return null;
  const o = profile.objectives.find((x) => x.id === id);
  if (!o) return null;
  const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
  const delta = o.currency === 'USD' ? (fx > 0 ? deltaBRL / fx : 0) : deltaBRL;
  o.current = Math.max(0, r2(Number(o.current || 0) + delta));
  saveProfile(profile);
  return o;
};

const deleteObjective = (id) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.objectives)) return false;
  const next = profile.objectives.filter((o) => o.id !== id);
  if (next.length === profile.objectives.length) return false;
  profile.objectives = next;
  saveProfile(profile);
  return true;
};

// --- tag definitions (vocabulário de tags para marcar itens) -----------------
// Cada tag: { name, bucket }. bucket = uma categoria (escopo) ou null = todas.
// O editor de item mostra só as tags da categoria do item (+ as de escopo todas).

const addTagDef = ({ name, bucket }) => {
  const profile = loadProfile();
  if (!profile) return null;
  if (!Array.isArray(profile.tagDefs)) profile.tagDefs = [];
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return null;
  const b = BUCKETS.includes(bucket) ? bucket : null;
  const existing = profile.tagDefs.find((t) => t.name.toLowerCase() === n.toLowerCase());
  if (existing) existing.bucket = b; else profile.tagDefs.push({ name: n, bucket: b });
  saveProfile(profile);
  return profile.tagDefs;
};

const deleteTagDef = (name) => {
  const profile = loadProfile();
  if (!profile || !Array.isArray(profile.tagDefs)) return false;
  const next = profile.tagDefs.filter((t) => t.name.toLowerCase() !== String(name).toLowerCase());
  if (next.length === profile.tagDefs.length) return false;
  profile.tagDefs = next;
  saveProfile(profile);
  return true;
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

module.exports = {
  BUCKETS, DEFAULT_ALLOCATION,
  loadProfile, saveProfile, updateBudgetAmount, updateAllocation, updateAllocationFixed, updateAllocationRest, loanState, onboardingStatus,
  addBudgetItem, updateBudgetItem, deleteBudgetItem,
  addObjective, updateObjective, deleteObjective, creditObjective,
  addTagDef, deleteTagDef, updateFx,
};
