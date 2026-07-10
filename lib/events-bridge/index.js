// lib/events-bridge/index.js — ponte de eventos remotos biso → bisa.
// Faz poll (localhost, mesmo Mac) do GET /api/events do biso com cursor
// persistido; eventos push:true viram Web Push nativo no iPad, todos viram
// broadcast WS para telas abertas (tela ops). Poll em vez de webhook: os dois
// servidores estão na mesma máquina, o bisa já tem o token do biso, e o poll
// sobrevive a restart de qualquer um dos lados sem handshake.
// Ver biso/docs/remote-actions.md.

const fs = require('fs');
const path = require('path');

module.exports = function makeEventsBridge(deps) {
  const {
    BISO_URL, BISO_TOKEN, push, broadcast,
    META,
    pollMs = 4000,
  } = deps;

  const CURSOR_FILE = path.join(META, 'biso-events-cursor.json');

  const loadCursor = () => {
    try { return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')).after || null; }
    catch { return null; }
  };
  const saveCursor = (after) => {
    try {
      fs.mkdirSync(META, { recursive: true });
      fs.writeFileSync(CURSOR_FILE, JSON.stringify({ after }) + '\n', 'utf8');
    } catch (e) { console.warn('[bisa/events] cursor save failed:', e.message); }
  };

  let cursor = loadCursor();
  let warned404 = false;
  let timer = null;

  const tick = async () => {
    try {
      const q = cursor ? `?after=${encodeURIComponent(cursor)}&limit=50` : '?limit=1';
      const res = await fetch(`${BISO_URL}/api/events${q}`, {
        headers: { 'x-biso-token': BISO_TOKEN },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 404) {
        // biso antigo (sem lib/events) — loga uma vez e segue tentando.
        if (!warned404) { console.warn('[bisa/events] biso has no /api/events yet (old biso running?)'); warned404 = true; }
        return;
      }
      if (!res.ok) throw new Error(`GET /api/events → ${res.status}`);
      warned404 = false;
      const data = await res.json();

      if (!cursor) {
        // Primeira sincronização: não repassa histórico, só ancora o cursor.
        if (data.latest) { cursor = data.latest; saveCursor(cursor); }
        return;
      }
      if (data.cursorFound === false) {
        // Cursor caiu do store (trim/reset) — reancora sem reentregar a cauda.
        if (data.latest) { cursor = data.latest; saveCursor(cursor); }
        return;
      }
      for (const ev of data.events || []) {
        if (ev.push) {
          push.notify(ev.title, ev.body, {
            tag: 'ev-' + ((ev.data && ev.data.key) || ev.type),
            url: '/#ops',
          }).catch((e) => console.warn('[bisa/events] push failed:', e.message));
        }
        broadcast({ type: 'remote-event', event: ev });
      }
      if (data.events && data.events.length) {
        cursor = data.events[data.events.length - 1].id;
        saveCursor(cursor);
      }
    } catch (e) {
      if (e.name !== 'TimeoutError' && e.code !== 'ECONNREFUSED') {
        console.warn('[bisa/events] poll failed:', e.message);
      }
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, pollMs);
      timer.unref();
      tick();
      console.log(`[bisa] events bridge → ${BISO_URL}/api/events every ${pollMs}ms`);
    },
    stop() { clearInterval(timer); timer = null; },
  };
};
