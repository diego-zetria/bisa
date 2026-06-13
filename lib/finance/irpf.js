// lib/finance/irpf.js
// Pure tax engine for Brazilian renda-variável IRPF (declaração 2027 = ano-base
// 2026). Consumes the investment-ops ledger (lib/finance/store.js) and produces
// the numbers the Receita program asks for. NO side effects, NO I/O — fully
// unit-testable (tests/finance-irpf.test.js).
//
// Rules implemented (swing trade / pessoa física):
//   - Custo médio ponderado: buys fold fees into the average price; sells
//     realize qty*(sellPrice - avg) - sellFees and keep the average unchanged.
//   - stock  : 15% on monthly net gain; EXEMPT month when total stock sales
//              <= R$ 20.000 (gains stay exempt, losses still carry forward).
//   - etf/bdr: 15%, no sales exemption. Shares the loss-carry pool with stock
//              ("operações comuns" modality).
//   - fii    : 20%, no exemption, own loss-carry pool.
//   - crypto : 15%; EXEMPT month when total crypto sales <= R$ 35.000 (IN 1888
//              GCAP regime — losses are NOT compensable, by design).
//   - DARF 6015 due only when the month's tax >= R$ 10; smaller amounts roll
//     into the next month's DARF (residual accumulator).
//   - dividend = exempt income; jcp = exclusive withholding income;
//     rent (FII rendimento) = exempt income.
//
// Deliberate scope cuts (documented in docs/finance.md): day trade, options,
// futures, IRRF "dedo-duro" 0.005% offset, stock lending. If you operate those,
// the numbers here are incomplete.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SALES_EXEMPTION = { stock: 20000, crypto: 35000 };
const TAX_RATE = { stock: 0.15, etf: 0.15, bdr: 0.15, fii: 0.20, crypto: 0.15 };
// Loss-carry pools: comuns (stock/etf/bdr) compensate each other; FII is its
// own pool; crypto has no pool (losses not compensable under IN 1888).
const CARRY_POOL = { stock: 'common', etf: 'common', bdr: 'common', fii: 'fii', crypto: null };
const MIN_DARF = 10;

// Bens e Direitos group/code suggestions (IRPF 2025 program layout).
// TODO entries must be confirmed inside the Receita program before filing.
const BENS_CODES = {
  stock: { grupo: '03', codigo: '01', label: 'Ações (inclusive as listadas em bolsa)' },
  fii: { grupo: '07', codigo: '03', label: 'Fundos de Investimento Imobiliário (FII)' },
  etf: { grupo: '07', codigo: 'TODO', label: 'ETF — confirm code in the IRPF program' },
  bdr: { grupo: '04', codigo: 'TODO', label: 'BDR — confirm code in the IRPF program' },
  crypto: { grupo: '08', codigo: '01/02', label: 'Criptoativos (01 = BTC, 02 = demais)' },
};

// --- positions (custo médio ponderado) --------------------------------------

// Walk ops chronologically up to and including `untilDate` (YYYY-MM-DD, optional).
// Returns { 'class:SYMBOL': { assetClass, symbol, qty, avgPrice, totalCost } }.
// Also annotates each sell op with its realized result (used by monthlyResults).
const computePositions = (ops, untilDate) => {
  const pos = {};
  const realized = []; // { date, month, assetClass, symbol, qty, salesValue, result }
  for (const op of ops) {
    if (untilDate && op.date > untilDate) continue;
    if (op.type !== 'buy' && op.type !== 'sell') continue;
    const key = `${op.assetClass}:${op.symbol}`;
    const p = pos[key] || (pos[key] = {
      assetClass: op.assetClass, symbol: op.symbol, qty: 0, avgPrice: 0, totalCost: 0,
    });
    if (op.type === 'buy') {
      const cost = op.qty * op.price + (op.fees || 0);
      p.totalCost = p.totalCost + cost;
      p.qty = p.qty + op.qty;
      p.avgPrice = p.qty > 0 ? p.totalCost / p.qty : 0;
    } else {
      const qty = Math.min(op.qty, p.qty); // selling more than held → clamp, flagged below
      const salesValue = op.qty * op.price - (op.fees || 0);
      const result = op.qty * op.price - (op.fees || 0) - qty * p.avgPrice;
      p.qty = p.qty - qty;
      p.totalCost = p.qty * p.avgPrice;
      realized.push({
        date: op.date, month: op.date.slice(0, 7),
        assetClass: op.assetClass, symbol: op.symbol,
        qty: op.qty, salesValue: round2(salesValue), result: round2(result),
        oversold: op.qty > qty,
      });
    }
  }
  for (const k of Object.keys(pos)) {
    pos[k].qty = Math.round(pos[k].qty * 1e8) / 1e8; // tolerate fractional crypto (8 dp)
    pos[k].avgPrice = round2(pos[k].avgPrice);
    pos[k].totalCost = round2(pos[k].totalCost);
    if (pos[k].qty <= 0) delete pos[k];
  }
  return { positions: pos, realized };
};

// --- monthly results + DARF ---------------------------------------------------

// For a calendar year: per-month, per-class sales totals, taxable/exempt gains,
// loss carry-forward per pool, tax due and DARF schedule (with <R$10 residual).
const monthlyResults = (ops, year) => {
  const { realized } = computePositions(ops);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  // carry pools persist across months and INTO the year from prior years' ops
  const carry = { common: 0, fii: 0 };
  // warm up carry with realized results before Jan 1 of `year`
  for (const r of realized) {
    if (r.month >= `${year}-01`) continue;
    const pool = CARRY_POOL[r.assetClass];
    if (!pool) continue;
    const exempt = exemptionForMonth(realized, r.month, r.assetClass);
    if (r.result < 0) carry[pool] += -r.result;
    else if (!exempt) carry[pool] = Math.max(0, carry[pool] - r.result);
  }

  let residual = 0; // DARF < R$10 rolls forward
  const out = [];
  for (const m of months) {
    const inMonth = realized.filter((r) => r.month === m);
    const classes = {};
    let monthTax = 0;
    for (const cls of Object.keys(TAX_RATE)) {
      const rows = inMonth.filter((r) => r.assetClass === cls);
      if (!rows.length) continue;
      const sales = round2(rows.reduce((s, r) => s + r.salesValue, 0));
      const result = round2(rows.reduce((s, r) => s + r.result, 0));
      const exempt = SALES_EXEMPTION[cls] != null && sales <= SALES_EXEMPTION[cls];
      const pool = CARRY_POOL[cls];

      let taxable = 0, exemptGain = 0, tax = 0;
      if (result < 0) {
        if (pool) carry[pool] += -result; // losses always carry (even exempt months)
      } else if (exempt) {
        exemptGain = result;
      } else {
        let gain = result;
        if (pool && carry[pool] > 0) {
          const used = Math.min(carry[pool], gain);
          carry[pool] = round2(carry[pool] - used);
          gain = round2(gain - used);
        }
        taxable = gain;
        tax = round2(gain * TAX_RATE[cls]);
      }
      monthTax += tax;
      classes[cls] = {
        sales, result, exempt, exemptGain: round2(exemptGain),
        taxable: round2(taxable), tax: round2(tax),
        carryAfter: pool ? round2(carry[pool]) : null,
      };
    }
    monthTax = round2(monthTax + residual);
    let darf = 0;
    if (monthTax >= MIN_DARF) { darf = monthTax; residual = 0; }
    else { residual = monthTax; }
    if (Object.keys(classes).length || darf) {
      out.push({ month: m, classes, tax: round2(darf), residual: round2(residual), darfCode: '6015' });
    }
  }
  return { months: out, carryEnd: { common: round2(carry.common), fii: round2(carry.fii) } };
};

const exemptionForMonth = (realized, month, cls) => {
  if (SALES_EXEMPTION[cls] == null) return false;
  const sales = realized
    .filter((r) => r.month === month && r.assetClass === cls)
    .reduce((s, r) => s + r.salesValue, 0);
  return sales <= SALES_EXEMPTION[cls];
};

// --- income (proventos) -------------------------------------------------------

const incomeReport = (ops, year) => {
  const inYear = ops.filter((o) => o.date.slice(0, 4) === String(year));
  const sum = (type) => round2(inYear.filter((o) => o.type === type)
    .reduce((s, o) => s + (o.amount || 0), 0));
  const bySymbol = (type) => {
    const acc = {};
    for (const o of inYear.filter((x) => x.type === type)) {
      acc[o.symbol] = round2((acc[o.symbol] || 0) + (o.amount || 0));
    }
    return acc;
  };
  return {
    dividends: { total: sum('dividend'), bySymbol: bySymbol('dividend'), ficha: 'Rendimentos Isentos — cód. 09' },
    jcp: { total: sum('jcp'), bySymbol: bySymbol('jcp'), ficha: 'Tributação Exclusiva — cód. 10' },
    fiiRent: { total: sum('rent'), bySymbol: bySymbol('rent'), ficha: 'Rendimentos Isentos — cód. 26' },
  };
};

// --- bens e direitos (positions on Dec 31) -------------------------------------

const bensEDireitos = (ops, year) => {
  const { positions } = computePositions(ops, `${year}-12-31`);
  return Object.values(positions).map((p) => ({
    ...p,
    ...BENS_CODES[p.assetClass],
    discriminacao: `${p.qty} ${p.symbol} — custo total R$ ${p.totalCost.toFixed(2)} (preço médio R$ ${p.avgPrice.toFixed(2)})`,
  })).sort((a, b) => a.symbol.localeCompare(b.symbol));
};

// --- day-trade detection --------------------------------------------------------

// Same class:symbol bought AND sold on the same date = day trade, which has
// its own rules (20%, no sales exemption, own IRRF/DARF) that this engine
// does NOT compute — it would silently tax these as swing trade. Detect and
// surface in the report notes so a wrong month never goes unnoticed.
const detectDayTrades = (ops, year) => {
  const seen = {};
  for (const op of ops) {
    if (op.type !== 'buy' && op.type !== 'sell') continue;
    if (op.date.slice(0, 4) !== String(year)) continue;
    const k = `${op.date}|${op.assetClass}:${op.symbol}`;
    (seen[k] = seen[k] || {})[op.type] = true;
  }
  return Object.keys(seen).filter((k) => seen[k].buy && seen[k].sell).sort()
    .map((k) => { const [date, asset] = k.split('|'); return { date, asset }; });
};

// --- full report ----------------------------------------------------------------

const irpfReport = (ops, year) => {
  const monthly = monthlyResults(ops, year);
  const darfs = monthly.months.filter((m) => m.tax > 0)
    .map((m) => ({ month: m.month, code: m.darfCode, amount: m.tax }));
  const dayTrades = detectDayTrades(ops, year);
  return {
    year,
    declaracao: year + 1,
    monthly: monthly.months,
    carryEnd: monthly.carryEnd,
    darfs,
    income: incomeReport(ops, year),
    bens: bensEDireitos(ops, year),
    dayTrades,
    notes: [
      ...(dayTrades.length ? [
        `DAY TRADE detected (${dayTrades.map((d) => `${d.date} ${d.asset}`).join(', ')}) — `
        + 'this engine taxes it as swing trade; those months\' numbers are WRONG '
        + '(day trade: 20%, no exemption, own DARF). Compute them outside.',
      ] : []),
      'Day trade, options, futures and stock lending are NOT computed — see docs/finance.md.',
      'IRRF "dedo-duro" (0.005% on sales) is not offset against the DARF.',
      'Confirm TODO group/codes inside the official Receita program before filing.',
    ],
  };
};

module.exports = {
  round2, SALES_EXEMPTION, TAX_RATE, CARRY_POOL, MIN_DARF, BENS_CODES,
  computePositions, monthlyResults, incomeReport, bensEDireitos, irpfReport,
  detectDayTrades,
};
