// tests/finance-irpf.test.js
// Pure-engine tests for lib/finance/irpf.js (no I/O). Money values in BRL.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computePositions, monthlyResults, incomeReport, bensEDireitos, irpfReport,
} = require('../lib/finance/irpf');

const buy = (date, symbol, qty, price, fees = 0, assetClass = 'stock') =>
  ({ date, type: 'buy', assetClass, symbol, qty, price, fees });
const sell = (date, symbol, qty, price, fees = 0, assetClass = 'stock') =>
  ({ date, type: 'sell', assetClass, symbol, qty, price, fees });

test('average price folds buy fees in', () => {
  const ops = [buy('2026-01-10', 'PETR4', 100, 30, 10), buy('2026-02-10', 'PETR4', 100, 40, 10)];
  const { positions } = computePositions(ops);
  const p = positions['stock:PETR4'];
  assert.equal(p.qty, 200);
  // (100*30+10 + 100*40+10) / 200 = 7020/200 = 35.10
  assert.equal(p.avgPrice, 35.10);
  assert.equal(p.totalCost, 7020);
});

test('sell realizes against average price and keeps avg unchanged', () => {
  const ops = [buy('2026-01-10', 'PETR4', 100, 30), sell('2026-03-05', 'PETR4', 50, 35, 5)];
  const { positions, realized } = computePositions(ops);
  assert.equal(positions['stock:PETR4'].qty, 50);
  assert.equal(positions['stock:PETR4'].avgPrice, 30);
  assert.equal(realized.length, 1);
  // 50*35 - 5 - 50*30 = 1750 - 5 - 1500 = 245
  assert.equal(realized[0].result, 245);
  assert.equal(realized[0].salesValue, 1745);
});

test('stock sales <= 20k in month are exempt (gain not taxed)', () => {
  const ops = [buy('2026-01-05', 'VALE3', 100, 50), sell('2026-02-10', 'VALE3', 100, 80)];
  const { months } = monthlyResults(ops, 2026);
  const feb = months.find((m) => m.month === '2026-02');
  assert.equal(feb.classes.stock.exempt, true);
  assert.equal(feb.classes.stock.exemptGain, 3000);
  assert.equal(feb.classes.stock.tax, 0);
  assert.equal(feb.tax, 0);
});

test('stock sales > 20k pay 15% and emit a DARF', () => {
  const ops = [buy('2026-01-05', 'VALE3', 1000, 50), sell('2026-02-10', 'VALE3', 500, 60)];
  const { months } = monthlyResults(ops, 2026);
  const feb = months.find((m) => m.month === '2026-02');
  assert.equal(feb.classes.stock.exempt, false); // sales = 30000
  assert.equal(feb.classes.stock.taxable, 5000);
  assert.equal(feb.classes.stock.tax, 750);
  assert.equal(feb.tax, 750);
});

test('FII has no exemption, 20% rate', () => {
  const ops = [
    buy('2026-01-05', 'HGLG11', 10, 100, 0, 'fii'),
    sell('2026-03-10', 'HGLG11', 10, 150, 0, 'fii'),
  ];
  const { months } = monthlyResults(ops, 2026);
  const mar = months.find((m) => m.month === '2026-03');
  assert.equal(mar.classes.fii.exempt, false); // sales 1500, way under 20k — still taxed
  assert.equal(mar.classes.fii.tax, 100); // 500 * 20%
});

test('losses carry forward inside the pool and offset later gains', () => {
  const ops = [
    buy('2026-01-05', 'VALE3', 1000, 50),
    sell('2026-02-10', 'VALE3', 500, 40),  // loss 5000 (sales 20000 → exempt month, loss still carries)
    sell('2026-04-10', 'VALE3', 500, 110), // gain 30000, sales 55000 → taxable, offset by 5000
  ];
  const { months } = monthlyResults(ops, 2026);
  const feb = months.find((m) => m.month === '2026-02');
  assert.equal(feb.classes.stock.result, -5000);
  const apr = months.find((m) => m.month === '2026-04');
  assert.equal(apr.classes.stock.taxable, 25000);
  assert.equal(apr.classes.stock.tax, 3750);
});

test('ETF loss offsets stock gain (shared common pool); FII pool is separate', () => {
  const ops = [
    buy('2026-01-05', 'BOVA11', 100, 100, 0, 'etf'),
    sell('2026-02-10', 'BOVA11', 100, 50, 0, 'etf'),    // loss 5000 → common pool
    buy('2026-01-05', 'PETR4', 1000, 30),
    sell('2026-03-10', 'PETR4', 1000, 33),               // gain 3000, sales 33000 → taxable
    buy('2026-01-05', 'HGLG11', 100, 100, 0, 'fii'),
    sell('2026-03-10', 'HGLG11', 100, 110, 0, 'fii'),    // FII gain 1000 — must NOT use common pool
  ];
  const { months } = monthlyResults(ops, 2026);
  const mar = months.find((m) => m.month === '2026-03');
  assert.equal(mar.classes.stock.taxable, 0);            // 3000 fully absorbed by 5000 carry
  assert.equal(mar.classes.stock.carryAfter, 2000);
  assert.equal(mar.classes.fii.tax, 200);                // 1000 * 20%, untouched by common pool
});

test('crypto: <=35k month exempt; losses do NOT carry', () => {
  const ops = [
    buy('2026-01-05', 'BTC', 1, 30000, 0, 'crypto'),
    sell('2026-02-10', 'BTC', 1, 34000, 0, 'crypto'),   // sales 34000 <= 35000 → exempt gain
    buy('2026-03-05', 'ETH', 10, 4000, 0, 'crypto'),
    sell('2026-04-10', 'ETH', 10, 3000, 0, 'crypto'),   // loss 10000 — not compensable
    buy('2026-05-05', 'BTC', 1, 30000, 0, 'crypto'),
    sell('2026-06-10', 'BTC', 1, 70000, 0, 'crypto'),   // gain 40000, sales 70000 → taxable in full
  ];
  const { months } = monthlyResults(ops, 2026);
  const feb = months.find((m) => m.month === '2026-02');
  assert.equal(feb.classes.crypto.exempt, true);
  const jun = months.find((m) => m.month === '2026-06');
  assert.equal(jun.classes.crypto.taxable, 40000);      // ETH loss did not reduce it
  assert.equal(jun.classes.crypto.tax, 6000);
});

test('DARF under R$10 rolls into next month', () => {
  const ops = [
    buy('2026-01-05', 'BOVA11', 10, 100, 0, 'etf'),
    sell('2026-02-10', 'BOVA11', 4, 110, 0, 'etf'),  // gain 40 → tax 6.00 (<10, residual)
    sell('2026-03-10', 'BOVA11', 4, 110, 0, 'etf'),  // gain 40 → tax 6.00 + 6.00 residual = 12 → DARF
  ];
  const { months } = monthlyResults(ops, 2026);
  const feb = months.find((m) => m.month === '2026-02');
  assert.equal(feb.tax, 0);
  assert.equal(feb.residual, 6);
  const mar = months.find((m) => m.month === '2026-03');
  assert.equal(mar.tax, 12);
  assert.equal(mar.residual, 0);
});

test('prior-year losses warm up the carry pool', () => {
  const ops = [
    buy('2025-06-05', 'PETR4', 1000, 50),
    sell('2025-07-10', 'PETR4', 500, 40),   // 2025 loss 5000
    sell('2026-02-10', 'PETR4', 500, 110),  // 2026 gain 30000 sales 55000
  ];
  const { months } = monthlyResults(ops, 2026);
  const feb = months.find((m) => m.month === '2026-02');
  assert.equal(feb.classes.stock.taxable, 25000);
});

test('income report splits dividend / jcp / fii rent', () => {
  const ops = [
    { date: '2026-03-01', type: 'dividend', assetClass: 'stock', symbol: 'PETR4', amount: 120.5 },
    { date: '2026-04-01', type: 'jcp', assetClass: 'stock', symbol: 'ITUB4', amount: 80 },
    { date: '2026-05-01', type: 'rent', assetClass: 'fii', symbol: 'HGLG11', amount: 55.25 },
    { date: '2025-12-01', type: 'dividend', assetClass: 'stock', symbol: 'PETR4', amount: 999 }, // other year
  ];
  const inc = incomeReport(ops, 2026);
  assert.equal(inc.dividends.total, 120.5);
  assert.equal(inc.jcp.total, 80);
  assert.equal(inc.fiiRent.total, 55.25);
  assert.equal(inc.dividends.bySymbol.PETR4, 120.5);
});

test('bens e direitos lists Dec-31 positions with discriminação', () => {
  const ops = [
    buy('2026-01-10', 'PETR4', 100, 30, 10),
    buy('2026-11-10', 'HGLG11', 50, 160, 0, 'fii'),
    sell('2026-12-15', 'PETR4', 40, 35),
  ];
  const bens = bensEDireitos(ops, 2026);
  assert.equal(bens.length, 2);
  const petr = bens.find((b) => b.symbol === 'PETR4');
  assert.equal(petr.qty, 60);
  assert.equal(petr.grupo, '03');
  assert.match(petr.discriminacao, /60 PETR4/);
  const fii = bens.find((b) => b.symbol === 'HGLG11');
  assert.equal(fii.grupo, '07');
});

test('same-day buy+sell is flagged as day trade in the report', () => {
  const ops = [
    buy('2026-03-10', 'PETR4', 100, 30),
    sell('2026-03-10', 'PETR4', 100, 31),  // same date → day trade
    buy('2026-01-05', 'VALE3', 100, 50),
    sell('2026-02-10', 'VALE3', 100, 60),  // swing — must NOT be flagged
  ];
  const r = irpfReport(ops, 2026);
  assert.deepEqual(r.dayTrades, [{ date: '2026-03-10', asset: 'stock:PETR4' }]);
  assert.match(r.notes[0], /DAY TRADE detected/);
});

test('no day-trade warning when there is none', () => {
  const r = irpfReport([buy('2026-01-05', 'VALE3', 10, 50)], 2026);
  assert.equal(r.dayTrades.length, 0);
  assert.ok(!r.notes.some((n) => /DAY TRADE detected/.test(n)));
});

test('full report shape', () => {
  const ops = [buy('2026-01-05', 'VALE3', 1000, 50), sell('2026-02-10', 'VALE3', 500, 60)];
  const r = irpfReport(ops, 2026);
  assert.equal(r.year, 2026);
  assert.equal(r.declaracao, 2027);
  assert.equal(r.darfs.length, 1);
  assert.equal(r.darfs[0].code, '6015');
  assert.ok(Array.isArray(r.bens));
  assert.ok(r.notes.length >= 3);
});
