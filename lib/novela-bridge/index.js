// lib/novela-bridge/index.js — proxy reverso do bisa → API do novela-shorts.
// Mesmo padrão do lib/biso-bridge: embute a API do novela-shorts (porta 7779) atrás
// do login do bisa, na mesma origem, alcançável pelo iPad SEM expor a porta nem
// guardar o token. Só HTTP (REST read-only + mídia em /media).
//   /novela/*  → http://127.0.0.1:7779/*  (o mount remove o prefixo)

const express = require('express');
const httpProxy = require('http-proxy');

module.exports = function makeNovelaBridge({ requireAuth, NOVELA_URL, NOVELA_TOKEN }) {
  const TARGET = NOVELA_URL || 'http://127.0.0.1:7779';
  const PREFIX = '/novela';

  const proxy = httpProxy.createProxyServer({ target: TARGET, changeOrigin: true });
  proxy.on('proxyReq', (pr) => { if (NOVELA_TOKEN) pr.setHeader('x-novela-token', NOVELA_TOKEN); });
  proxy.on('error', (_err, _req, res) => {
    try {
      if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('novela-shorts indisponível. Suba a API no Mac: python api.py (porta 7779).');
      } else if (res && res.destroy) res.destroy();
    } catch {}
  });

  const router = express.Router();
  // O mount em PREFIX remove "/novela" de req.url; encaminhamos o resto à API.
  router.use(PREFIX, requireAuth, (req, res) => proxy.web(req, res));

  return { router, PREFIX };
};
