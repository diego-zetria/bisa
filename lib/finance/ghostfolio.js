// lib/finance/ghostfolio.js
// Minimal Ghostfolio client. Deliberately restricted to the STABLE documented
// surface: POST /api/v1/auth/anonymous (token) and POST /api/v1/import.
// Internal read endpoints (/portfolio/details etc.) are "use at your own
// risk" per the maintainer and have had breaking changes — the Biso ledger
// (lib/finance/store.js) is the read model instead. Config via .env:
//   GHOSTFOLIO_URL    e.g. http://localhost:3333
//   GHOSTFOLIO_TOKEN  the user's Security Token (Ghostfolio → My Ghostfolio)

const cfg = () => ({
  url: (process.env.GHOSTFOLIO_URL || '').replace(/\/$/, ''),
  token: process.env.GHOSTFOLIO_TOKEN || '',
});

const configured = () => { const c = cfg(); return !!(c.url && c.token); };

let bearer = null; // { token, at }

const auth = async () => {
  const c = cfg();
  if (bearer && Date.now() - bearer.at < 10 * 60 * 1000) return bearer.token;
  const r = await fetch(`${c.url}/api/v1/auth/anonymous`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessToken: c.token }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`ghostfolio auth failed: HTTP ${r.status}`);
  const data = await r.json();
  if (!data.authToken) throw new Error('ghostfolio auth: no authToken in response');
  bearer = { token: data.authToken, at: Date.now() };
  return bearer.token;
};

// Map a ledger op (lib/finance/store.js) to a Ghostfolio activity.
// B3 tickers get the Yahoo `.SA` suffix; crypto defaults to `SYMBOL-BRL`
// (Yahoo quotes BTC-BRL etc.). Override per-op with `gfSymbol` when the
// default mapping doesn't resolve on Yahoo.
const toActivity = (op) => {
  const symbol = op.gfSymbol
    || (op.assetClass === 'crypto' ? `${op.symbol}-BRL` : `${op.symbol}.SA`);
  const base = {
    currency: 'BRL',
    dataSource: 'YAHOO',
    date: `${op.date}T00:00:00.000Z`,
    fee: op.fees || 0,
    symbol,
    comment: `biso:${op.id}`,
  };
  if (op.type === 'buy' || op.type === 'sell') {
    return { ...base, type: op.type.toUpperCase(), quantity: op.qty, unitPrice: op.price };
  }
  // dividend / jcp / rent → DIVIDEND with the total as unitPrice on qty 1
  return { ...base, type: 'DIVIDEND', quantity: 1, unitPrice: op.amount || 0 };
};

// Import ops one activity per request: Ghostfolio rejects the WHOLE batch with
// 400 when any activity is a duplicate, and a duplicate just means it was
// already pushed — per-op requests let us mark it synced and move on.
const pushOps = async (ops) => {
  const c = cfg();
  const token = await auth();
  const okIds = [], errors = [];
  for (const op of ops) {
    try {
      const r = await fetch(`${c.url}/api/v1/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ activities: [toActivity(op)] }),
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 201) { okIds.push(op.id); continue; }
      const body = await r.json().catch(() => ({}));
      const msg = Array.isArray(body.message) ? body.message.join('; ') : String(body.message || r.status);
      if (r.status === 400 && /duplicate/i.test(msg)) { okIds.push(op.id); continue; }
      errors.push({ id: op.id, symbol: op.symbol, error: msg });
    } catch (e) {
      errors.push({ id: op.id, symbol: op.symbol, error: e.message });
    }
  }
  return { okIds, errors };
};

const health = async () => {
  const c = cfg();
  if (!c.url) return { configured: false, up: false };
  try {
    const r = await fetch(`${c.url}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    return { configured: configured(), up: r.ok };
  } catch { return { configured: configured(), up: false }; }
};

module.exports = { configured, pushOps, toActivity, health };
