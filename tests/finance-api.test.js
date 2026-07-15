// tests/finance-api.test.js
// Endpoints de tx do router de finanças (POST/PATCH/DELETE + creditGoal) e a
// agregação do GET /finance/summary (pendentes fora do caixa). Sobe o router
// num express real em porta efêmera; Actual/Ghostfolio ficam de fora
// (stubs "não configurado"). BISA_FINANCE_DIR → diretório temporário.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bisa-fin-api-'));
process.env.BISA_FINANCE_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const financeStore = require('../lib/finance/store');
const profileMod = require('../lib/finance/profile');
const irpf = require('../lib/finance/irpf');
const makeFinanceRouter = require('../lib/finance/api');

const offline = { configured: () => false, health: async () => ({ configured: false, up: false }) };
const app = express();
app.use(express.json());
app.use(makeFinanceRouter({
  requireAuth: (_req, _res, next) => next(),
  financeStore,
  actual: offline,
  ghostfolio: offline,
  irpf,
}));

let base;
const srv = app.listen(0, () => { base = `http://127.0.0.1:${srv.address().port}`; });
test.before(() => new Promise((ok) => srv.on('listening', ok)));
test.after(() => srv.close());

const api = async (p, opts = {}) => {
  const r = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  });
  return { status: r.status, body: await r.json() };
};

const freshProfile = () => profileMod.saveProfile({
  fx: { BRLperUSD: 5 },
  objectives: [{ id: 'reserva', label: 'Reserva', bucket: 'liberdade', currency: 'BRL', current: 100, target: 0 }],
});
const objCurrent = () => profileMod.loadProfile().objectives[0].current;

test('POST /finance/tx + creditGoal credita o objetivo no mesmo request', async () => {
  freshProfile();
  const { status, body } = await api('/finance/tx', {
    method: 'POST',
    json: { kind: 'expense', amount: 40, category: 'aporte', bucket: 'liberdade', goalId: 'reserva', creditGoal: true },
  });
  assert.equal(status, 200);
  assert.equal(body.tx.goalId, 'reserva');
  assert.equal(body.objective.current, 140);
  assert.equal(objCurrent(), 140);
});

test('POST pendente com creditGoal NÃO credita (só quando efetivar)', async () => {
  freshProfile();
  const { body } = await api('/finance/tx', {
    method: 'POST',
    json: { kind: 'expense', amount: 40, bucket: 'liberdade', goalId: 'reserva', pending: true, creditGoal: true },
  });
  assert.equal(body.tx.pending, true);
  assert.equal(body.objective, undefined);
  assert.equal(objCurrent(), 100);

  // efetivar via PATCH pending:false + creditGoal → aí sim credita
  const up = await api('/finance/tx', {
    method: 'PATCH',
    json: { id: body.tx.id, pending: false, date: '2026-07-06', creditGoal: true },
  });
  assert.equal(up.status, 200);
  assert.equal(up.body.tx.pending, undefined);
  assert.equal(up.body.tx.date, '2026-07-06');
  assert.equal(objCurrent(), 140);
});

test('PATCH valida id e 404 em tx inexistente', async () => {
  assert.equal((await api('/finance/tx', { method: 'PATCH', json: { amount: 1 } })).status, 400);
  assert.equal((await api('/finance/tx', { method: 'PATCH', json: { id: 'tx-x', amount: 1 } })).status, 404);
});

test('DELETE com creditGoal=1 desconta o aporte removido do objetivo', async () => {
  freshProfile();
  const { body } = await api('/finance/tx', {
    method: 'POST',
    json: { kind: 'expense', amount: 30, bucket: 'liberdade', goalId: 'reserva', creditGoal: true },
  });
  assert.equal(objCurrent(), 130);
  const del = await api(`/finance/tx?id=${body.tx.id}&creditGoal=1`, { method: 'DELETE' });
  assert.equal(del.body.ok, true);
  assert.equal(objCurrent(), 100); // voltou ao saldo original
});

test('GET /finance/summary: pendentes ficam fora do caixa', async () => {
  // zera as transações deste arquivo de teste
  try { fs.unlinkSync(financeStore.TX_FILE); } catch {}
  await api('/finance/tx', { method: 'POST', json: { kind: 'income', amount: 1000, category: 'salario', date: '2026-07-01' } });
  await api('/finance/tx', { method: 'POST', json: { kind: 'income', amount: 500, category: 'bonus', date: '2026-07-02', pending: true } });
  await api('/finance/tx', { method: 'POST', json: { kind: 'expense', amount: 200, category: 'mercado', date: '2026-07-03' } });
  await api('/finance/tx', { method: 'POST', json: { kind: 'expense', amount: 80, category: 'aporte', date: '2026-07-04', pending: true } });

  const { body: s } = await api('/finance/summary?month=2026-07');
  assert.equal(s.cash.income, 1000);
  assert.equal(s.cash.pendingIncome, 500);
  assert.equal(s.cash.expense, 200);
  assert.equal(s.cash.pendingExpense, 80);
  assert.equal(s.cash.net, 800);
  assert.deepEqual(s.cash.byCategory, { mercado: 200 }); // pendente não entra
  assert.equal(s.cash.manual.length, 4); // mas aparece na lista do mês
});
