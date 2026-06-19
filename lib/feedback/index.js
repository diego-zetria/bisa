// lib/feedback/index.js — caixa de entrada de anotações da usuária (iPad+Pencil).
// Ela entra no "Modo Anotar", toca num elemento da tela e escreve o que mudar;
// gravamos em <CWD>/feedback/inbox.jsonl (uma anotação por linha) para o dev
// (Claude Code, no Mac) ler e aplicar. v1: só captura + leitura, sem recarga
// automática. Padrão de router factory com injeção, como os demais módulos.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

const AGENT_SCRIPT = path.join(__dirname, 'run-agent.js');
const REPO_DIR = path.resolve(__dirname, '..', '..');

module.exports = function makeFeedbackRouter({ requireAuth, getCwd, broadcast }) {
  const router = express.Router();
  const fileOf = () => path.join(getCwd(), 'feedback', 'inbox.jsonl');

  // Modo automático (BISA_FEEDBACK_AGENT=1): dispara o agente destacado, que
  // aplica as anotações abertas editando public/ e recarrega o iPad. Não bloqueia
  // a resposta; sobrevive a reinícios do servidor (detached + unref).
  const maybeRunAgent = () => {
    if (process.env.BISA_FEEDBACK_AGENT !== '1') return;
    try {
      spawn(process.execPath, [AGENT_SCRIPT], {
        cwd: REPO_DIR, env: process.env, detached: true, stdio: 'ignore',
      }).unref();
    } catch (e) { console.error('[feedback] agent spawn falhou:', e.message); }
  };

  const readAll = () => {
    try {
      return fs.readFileSync(fileOf(), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch { return []; }
  };
  const writeAll = (items) => {
    const f = fileOf();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''), 'utf8');
  };
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);

  // POST /feedback — grava uma anotação. Body: {screen, selector, elementText,
  // request?, ink?}. `ink` é um data URL PNG (escrita à mão da Pencil); gravamos
  // o PNG e referenciamos em inkFile. Precisa de request OU ink.
  router.post('/feedback', requireAuth, (req, res) => {
    const b = req.body || {};
    const request = s(b.request, 2000).trim();
    const ink = typeof b.ink === 'string' ? b.ink : '';
    if (!request && !ink) return res.status(400).json({ error: 'request or ink required' });

    const id = 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const item = {
      id,
      ts: new Date().toISOString(),
      screen: s(b.screen, 60),
      selector: s(b.selector, 400),
      elementText: s(b.elementText, 200),
      request,
      status: 'open',
    };

    if (ink) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(ink);
      if (!m) return res.status(400).json({ error: 'ink must be a png data URL' });
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'ink too large' });
      const rel = path.join('feedback', 'ink', id + '.png');
      const abs = path.join(getCwd(), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
      item.inkFile = rel;
    }

    const f = fileOf();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(item) + '\n', 'utf8');
    maybeRunAgent(); // modo automático: aplica e recarrega (se ligado)
    res.json({ ok: true, item });
  });

  // GET /feedback?status=open — lista anotações (mais recentes primeiro).
  router.get('/feedback', requireAuth, (req, res) => {
    let items = readAll();
    if (req.query.status) items = items.filter((x) => x.status === req.query.status);
    items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    res.json({ items });
  });

  // POST /feedback/resolve {id} — marca como resolvida (usado pelo dev/curl).
  router.post('/feedback/resolve', requireAuth, (req, res) => {
    const id = s((req.body || {}).id, 40);
    const items = readAll();
    const it = items.find((x) => x.id === id);
    if (!it) return res.status(404).json({ error: 'not found' });
    it.status = 'resolved';
    it.resolvedAt = new Date().toISOString();
    writeAll(items);
    res.json({ ok: true });
  });

  // POST /feedback/reload — manda os PWAs recarregarem (o dev chama após aplicar
  // uma mudança, p/ a usuária ver o resultado no iPad sem atualizar à mão).
  router.post('/feedback/reload', requireAuth, (req, res) => {
    if (broadcast) broadcast({ type: 'reload' });
    res.json({ ok: true });
  });

  return router;
};
