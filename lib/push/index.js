// lib/push/index.js — Web Push (VAPID) para a PWA do iPad.
// Chaves VAPID geradas no 1º boot e persistidas em <CWD>/.meta/push.json,
// junto das assinaturas. notify() envia a todos os dispositivos inscritos.

const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

module.exports = function makePush(deps) {
  const { requireAuth, CWD } = deps;
  const META = process.env.BISA_META_DIR || path.join(CWD, '.meta');
  const FILE = path.join(META, 'push.json');

  const load = () => {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch { return { vapid: null, subs: [] }; }
  };
  const save = (s) => {
    fs.mkdirSync(META, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, FILE);
  };

  const state = load();
  if (!state.vapid) {
    state.vapid = webpush.generateVAPIDKeys();
    save(state);
    console.log('[bisa/push] chaves VAPID geradas');
  }
  webpush.setVapidDetails('mailto:bisa@local', state.vapid.publicKey, state.vapid.privateKey);

  const sendAll = async (payload) => {
    const body = JSON.stringify(payload);
    const dead = [];
    await Promise.all(state.subs.map(async (sub) => {
      try { await webpush.sendNotification(sub, body); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint); }
    }));
    if (dead.length) {
      state.subs = state.subs.filter((s) => !dead.includes(s.endpoint));
      save(state);
    }
  };

  const router = express.Router();

  router.get('/push/vapid-key', requireAuth, (_req, res) => {
    res.json({ key: state.vapid.publicKey });
  });

  router.post('/push/subscribe', requireAuth, (req, res) => {
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription inválida' });
    if (!state.subs.some((s) => s.endpoint === sub.endpoint)) {
      state.subs.push(sub);
      save(state);
    }
    res.json({ ok: true });
  });

  router.post('/push/test', requireAuth, async (_req, res) => {
    await sendAll({ title: 'bisa', body: 'Notificações ativadas 🎉', tag: 'test' });
    res.json({ ok: true, subs: state.subs.length });
  });

  return {
    router,
    // Reservado: ligar dispatchNotification → push para notificações marcadas.
    bridgeNotifications: () => {},
    notify: (title, body, extra = {}) => sendAll({ title, body, ...extra }),
  };
};
