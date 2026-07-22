// lib/llm/errors.js — classificação de erro do Claude + trava amigável (T6).
// Padrão OmniRoute (classifyErrorText/getMsUntilTomorrow): separa rate-limit
// transiente (espera curta, silenciosa) de limite de uso do dia (trava até o
// reset com mensagem calorosa em vez de "código 1"). Estado em memória —
// restart do bisa zera a trava, o que é seguro (pior caso: um erro a mais).

'use strict';

// Sinais em minúsculas; a checagem normaliza o texto antes.
const USAGE_LIMIT_SIGNALS = [
  'usage limit reached', 'limit will reset', 'usage limit',
  'out of extra usage', 'quota exceeded', 'exceeded your',
];
const CREDIT_SIGNALS = [
  'credit balance is too low', 'insufficient credit', 'out of credits',
  'payment required', 'billing',
];
const RATE_LIMIT_SIGNALS = [
  'rate limit', 'rate_limit', 'too many requests', 'overloaded',
  'overloaded_error', '429', '529', 'server is busy',
];

const RATE_LIMIT_HOLD_MS = 60 * 1000;

const msUntilMidnight = (now = new Date()) => {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  return next.getTime() - now.getTime();
};

const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const has = (text, signals) => {
  const t = String(text || '').toLowerCase();
  return signals.some((s) => t.includes(s));
};

// → { kind: 'usage-limit'|'credits'|'rate-limit'|'other' }
const classify = (text) => {
  if (has(text, USAGE_LIMIT_SIGNALS)) return { kind: 'usage-limit' };
  if (has(text, CREDIT_SIGNALS)) return { kind: 'credits' };
  if (has(text, RATE_LIMIT_SIGNALS)) return { kind: 'rate-limit' };
  return { kind: 'other' };
};

// ---- trava (module-level, uma por processo) --------------------------------
let _lock = null; // { kind, until, friendly }

const friendlyFor = (kind, until) => {
  if (kind === 'rate-limit') {
    return 'O Claude está ocupadinho agora — espera um minutinho e tenta de novo 💛';
  }
  if (kind === 'credits') {
    return 'O Claude ficou sem créditos por enquanto. O Diego já vai resolver 💛';
  }
  // usage-limit
  return `Os créditos do Claude de hoje acabaram 💛 Eles voltam ${hhmm(until)}. Até lá dá para usar o caderno e o diário normalmente.`;
};

// Registra um erro de turno; trava quando for limite/crédito. `resetAtMs`
// (epoch ms, opcional) vem do rate_limit_event do CLI quando disponível —
// senão usa-se meia-noite (usage-limit) ou 60s (rate-limit).
const noteError = (text, resetAtMs) => {
  const { kind } = classify(text);
  if (kind === 'other') return { kind, locked: false };
  const now = Date.now();
  const until = resetAtMs && resetAtMs > now ? resetAtMs
    : kind === 'rate-limit' ? now + RATE_LIMIT_HOLD_MS
    : now + msUntilMidnight();
  // Nunca encurta uma trava já existente mais longa.
  if (!_lock || until > _lock.until) {
    _lock = { kind, until, friendly: friendlyFor(kind, until) };
  }
  return { kind, locked: true, until: _lock.until, friendly: _lock.friendly };
};

// rate_limit_event do stream-json do CLI: formato defensivo (campos variam).
// Só trava quando o evento indica limite atingido/excedido.
const noteRateLimitEvent = (evt) => {
  const rl = (evt && (evt.rate_limit || evt)) || {};
  const status = String(rl.status || '').toLowerCase();
  if (!/exceeded|reached|rejected/.test(status)) return null;
  const resetAt = Number(rl.resetsAt || rl.resets_at || 0);
  const resetMs = resetAt > 1e12 ? resetAt : resetAt > 0 ? resetAt * 1000 : 0;
  return noteError('usage limit reached', resetMs || undefined);
};

const status = () => {
  if (!_lock) return { locked: false };
  if (Date.now() >= _lock.until) { _lock = null; return { locked: false }; }
  return { locked: true, kind: _lock.kind, until: _lock.until, friendly: _lock.friendly };
};

const _reset = () => { _lock = null; };

module.exports = { classify, noteError, noteRateLimitEvent, status, msUntilMidnight, _reset };
