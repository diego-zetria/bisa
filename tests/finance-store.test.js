// tests/finance-store.test.js
// Persistência JSONL de lib/finance/store.js (transações + operações) e o
// creditObjective de lib/finance/profile.js. BISA_FINANCE_DIR aponta p/ um
// diretório temporário ANTES do require (os módulos capturam o env no load).

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bisa-fin-store-'));
process.env.BISA_FINANCE_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/finance/store');
const profile = require('../lib/finance/profile');

const wipe = () => {
  for (const f of [store.TX_FILE, store.INVEST_FILE]) {
    try { fs.unlinkSync(f); } catch {}
  }
};

test('addTransaction: defaults, bucket só em despesa, pending', () => {
  wipe();
  const tx = store.addTransaction({ kind: 'nope', amount: -12.5, bucket: 'liberdade' });
  assert.equal(tx.kind, 'expense'); // kind inválido cai p/ expense
  assert.equal(tx.amount, 12.5); // valor absoluto
  assert.equal(tx.category, 'other');
  assert.equal(tx.bucket, 'liberdade');
  assert.equal(tx.pending, undefined);

  const inc = store.addTransaction({ kind: 'income', amount: 10, bucket: 'liberdade', goalId: 'g1', pending: true });
  assert.equal(inc.bucket, undefined); // receita não entra em envelope
  assert.equal(inc.goalId, undefined); // nem vincula objetivo
  assert.equal(inc.pending, true);

  assert.throws(() => store.addTransaction({ kind: 'expense', amount: 0 }), /positive/);
  assert.equal(store.loadTransactions().length, 2);
});

test('updateTransaction: edita in-place, limpa pending, valida amount', () => {
  wipe();
  const tx = store.addTransaction({ kind: 'income', amount: 100, category: 'salario', desc: 'a', pending: true });
  const up = store.updateTransaction(tx.id, { amount: 150.559, desc: 'b', pending: false, date: '2026-07-01' });
  assert.equal(up.amount, 150.559); // arredondamento é no report, não aqui
  assert.equal(up.desc, 'b');
  assert.equal(up.pending, undefined); // flag removido do registro
  assert.equal(up.date, '2026-07-01');

  const onDisk = store.loadTransactions().find((t) => t.id === tx.id);
  assert.deepEqual(onDisk, up);
  assert.equal(store.loadTransactions().length, 1); // editou, não duplicou

  assert.equal(store.updateTransaction('tx-nao-existe', { amount: 1 }), null);
  assert.throws(() => store.updateTransaction(tx.id, { amount: 0 }), /positive/);
  // data inválida é ignorada (mantém a atual)
  assert.equal(store.updateTransaction(tx.id, { date: '01/07/2026' }).date, '2026-07-01');
});

test('deleteTransaction remove só o id pedido', () => {
  wipe();
  const a = store.addTransaction({ kind: 'expense', amount: 1 });
  const b = store.addTransaction({ kind: 'expense', amount: 2 });
  assert.equal(store.deleteTransaction(a.id), true);
  assert.equal(store.deleteTransaction(a.id), false); // já foi
  assert.deepEqual(store.loadTransactions().map((t) => t.id), [b.id]);
});

test('addInvestment valida tipos e campos por tipo; markSynced marca gf', () => {
  wipe();
  assert.throws(() => store.addInvestment({ type: 'stake', assetClass: 'stock', symbol: 'X' }), /type/);
  assert.throws(() => store.addInvestment({ type: 'buy', assetClass: 'nft', symbol: 'X' }), /assetClass/);
  assert.throws(() => store.addInvestment({ type: 'buy', assetClass: 'stock', symbol: ' ' }), /symbol/);
  assert.throws(() => store.addInvestment({ type: 'buy', assetClass: 'stock', symbol: 'X', qty: 0, price: 10 }), /positive qty/);
  assert.throws(() => store.addInvestment({ type: 'dividend', assetClass: 'stock', symbol: 'X', amount: 0 }), /positive amount/);

  const buy = store.addInvestment({ type: 'buy', assetClass: 'stock', symbol: 'petr4', qty: 100, price: 30, fees: 5 });
  assert.equal(buy.symbol, 'PETR4');
  assert.equal(buy.gf, false);
  const div = store.addInvestment({ type: 'dividend', assetClass: 'stock', symbol: 'PETR4', amount: 50 });

  store.markSynced([buy.id]);
  const ops = store.loadInvestments();
  assert.equal(ops.find((o) => o.id === buy.id).gf, true);
  assert.equal(ops.find((o) => o.id === div.id).gf, false);
});

test('creditObjective: converte R$ p/ a moeda do objetivo e não fica negativo', () => {
  profile.saveProfile({
    fx: { BRLperUSD: 5 },
    objectives: [
      { id: 'reserva', label: 'Reserva', bucket: 'liberdade', currency: 'USD', current: 100, target: 0 },
      { id: 'viagem', label: 'Viagem', bucket: 'metas', currency: 'BRL', current: 50, target: 0 },
    ],
  });
  assert.equal(profile.creditObjective('reserva', 50).current, 110); // R$ 50 / 5 = US$ 10
  assert.equal(profile.creditObjective('viagem', 25.5).current, 75.5);
  assert.equal(profile.creditObjective('viagem', -1000).current, 0); // clampa em 0
  assert.equal(profile.creditObjective('nao-existe', 10), null);
});
