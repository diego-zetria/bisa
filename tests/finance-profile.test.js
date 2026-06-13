// tests/finance-profile.test.js
// SAC date/balance math in lib/finance/profile.js — loanState is pure given
// an explicit `today`, so no fs/profile.json involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loanState } = require('../lib/finance/profile');

const LOAN = {
  id: 'l1', label: 'Test SAC', system: 'SAC',
  principal: 12000, monthlyRate: 0.01, installments: 120,
  monthlyAmortization: 100,
  firstDueDate: '2025-11-23', dueDay: 23,
};

test('before the due day, the current month installment is still unpaid', () => {
  const s = loanState(LOAN, new Date(2026, 5, 11)); // 2026-06-11, due day 23
  assert.equal(s.paid, 7);
  assert.equal(s.balance, 11300);
  assert.equal(s.next.n, 8);
  assert.equal(s.next.dueDate, '2026-06-23');
  // amortization + rate on the declining balance: 100 + (12000 - 700) * 0.01
  assert.equal(s.next.value, 213);
});

test('on the due day, the installment counts as paid', () => {
  const s = loanState(LOAN, new Date(2026, 5, 23)); // 2026-06-23
  assert.equal(s.paid, 8);
  assert.equal(s.balance, 11200);
  assert.equal(s.next.n, 9);
  assert.equal(s.next.dueDate, '2026-07-23');
  assert.equal(s.next.value, 212);
});

test('due dates roll over the year boundary', () => {
  const s = loanState(LOAN, new Date(2026, 0, 10)); // 2026-01-10
  assert.equal(s.paid, 2); // Nov + Dec 2025
  assert.equal(s.next.n, 3);
  assert.equal(s.next.dueDate, '2026-01-23');
});

test('before the first due date nothing is paid', () => {
  const s = loanState(LOAN, new Date(2025, 10, 1)); // 2025-11-01
  assert.equal(s.paid, 0);
  assert.equal(s.balance, 12000);
  assert.equal(s.next.n, 1);
  assert.equal(s.next.dueDate, '2025-11-23');
  assert.equal(s.next.value, 220);
});

test('after the last installment the loan is settled', () => {
  const s = loanState(LOAN, new Date(2036, 0, 1));
  assert.equal(s.settled, true);
  assert.equal(s.paid, 120);
  assert.equal(s.balance, 0);
  assert.equal(s.next, null);
  assert.equal(s.endDate, '2035-10'); // 120th installment month
});
