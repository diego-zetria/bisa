// lib/feedback/index.js — caixa de entrada de anotações da usuária (iPad+Pencil).
// Ela entra no "Modo Anotar", toca num elemento da tela e escreve o que mudar;
// gravamos em <CWD>/feedback/inbox.jsonl (uma anotação por linha) para o dev
// (Claude Code, no Mac) ler e aplicar. v1: só captura + leitura, sem recarga
// automática. Padrão de router factory com injeção, como os demais módulos.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
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
      context: s(b.context, 300),
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

  // GET /feedback/last — a última mudança aplicada (não desfeita / não dispensada)
  // dentro de uma janela de tempo, p/ o iPad oferecer "Desfazer".
  router.get('/feedback/last', requireAuth, (_req, res) => {
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 min
    const it = readAll()
      .filter((x) => x.status === 'resolved' && x.commit && !x.undone && !x.undoSeen
        && x.resolvedAt && Date.parse(x.resolvedAt) >= cutoff)
      .sort((a, b) => (a.resolvedAt < b.resolvedAt ? 1 : -1))[0];
    res.json({ item: it ? { id: it.id, request: it.request, commit: it.commit, resolvedAt: it.resolvedAt } : null });
  });

  // POST /feedback/seen {id} — a usuária dispensou o "Desfazer" (não mostra mais).
  router.post('/feedback/seen', requireAuth, (req, res) => {
    const items = readAll();
    const it = items.find((x) => x.id === s((req.body || {}).id, 40));
    if (it) { it.undoSeen = true; writeAll(items); }
    res.json({ ok: true });
  });

  // POST /feedback/undo {id} — reverte o commit daquela mudança (git revert, só
  // public/) e manda recarregar. Aborta se houver conflito (mudança posterior).
  router.post('/feedback/undo', requireAuth, (req, res) => {
    const items = readAll();
    const it = items.find((x) => x.id === s((req.body || {}).id, 40));
    if (!it || !it.commit) return res.status(404).json({ error: 'mudança não encontrada' });
    if (it.undone) return res.json({ ok: true });
    const git = (args) => spawnSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' });
    const r = git(['revert', '--no-edit', it.commit]);
    if (r.status !== 0) {
      git(['revert', '--abort']); // limpa estado de revert pela metade
      return res.status(409).json({ error: 'não consegui desfazer automaticamente (uma mudança posterior conflita)' });
    }
    it.undone = true; it.undoneAt = new Date().toISOString();
    writeAll(items);
    if (broadcast) broadcast({ type: 'reload' });
    res.json({ ok: true });
  });

  // POST /feedback/reload — manda os PWAs recarregarem (o dev chama após aplicar
  // uma mudança, p/ a usuária ver o resultado no iPad sem atualizar à mão).
  router.post('/feedback/reload', requireAuth, (req, res) => {
    if (broadcast) broadcast({ type: 'reload' });
    res.json({ ok: true });
  });

  // POST /feedback/notify {text} — toast no iPad (o agente avisa quando uma
  // anotação foi enfileirada/ficou para revisão, sem recarregar a tela).
  router.post('/feedback/notify', requireAuth, (req, res) => {
    const text = s((req.body || {}).text, 200).trim();
    if (text && broadcast) broadcast({ type: 'annot', text });
    res.json({ ok: true });
  });

  // POST /feedback/status {state, text} — indicador de "request rodando" no iPad
  // (state: 'running' | 'idle'). O agente chama ao começar e ao terminar.
  router.post('/feedback/status', requireAuth, (req, res) => {
    const b = req.body || {};
    const state = b.state === 'running' ? 'running' : 'idle';
    if (broadcast) broadcast({ type: 'annot-status', state, text: s(b.text, 120) });
    res.json({ ok: true });
  });

  // POST /feedback/clarify {id, interpretation, action, options[], ...} — abre a
  // JANELA de clarificação no iPad (pedido ambíguo → análise + opções a tocar).
  router.post('/feedback/clarify', requireAuth, (req, res) => {
    const b = req.body || {};
    const payload = {
      id: s(b.id, 40), screen: s(b.screen, 60), elementText: s(b.elementText, 200),
      interpretation: s(b.interpretation, 300), action: s(b.action, 60),
      options: Array.isArray(b.options) ? b.options.slice(0, 6)
        .map((o) => ({ label: s(o.label, 60), request: s(o.request, 300) }))
        .filter((o) => o.label && o.request) : [],
    };
    if (broadcast) broadcast({ type: 'annot-clarify', payload });
    res.json({ ok: true });
  });

  // POST /feedback/refine {id, request} — a usuária escolheu uma opção na janela
  // (ou descreveu outra). Atualiza o pedido e re-dispara o agente p/ aplicar.
  router.post('/feedback/refine', requireAuth, (req, res) => {
    const b = req.body || {};
    const id = s(b.id, 40);
    const request = s(b.request, 2000).trim();
    if (!id || !request) return res.status(400).json({ error: 'id and request required' });
    const items = readAll();
    const it = items.find((x) => x.id === id);
    if (!it) return res.status(404).json({ error: 'not found' });
    it.request = request;
    it.status = 'open';
    it.refinedAt = new Date().toISOString();
    delete it.clarify; delete it.reason; delete it.needsReviewAt; delete it.blockedReason;
    writeAll(items);
    maybeRunAgent();
    res.json({ ok: true });
  });

  return router;
};
