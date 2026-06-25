// lib/biso-bridge/index.js — proxy reverso do bisa → biso (workstation Claude Code).
// Espelha o padrão do lib/sentinel: embute o biso atrás do login do bisa, na mesma
// origem, alcançável pelo iPad SEM expor a porta do biso nem guardar o token dele.
//   /biso/*  → http://127.0.0.1:7777/*  (o mount remove o prefixo)
//   injeta x-biso-token no servidor → o iPad nunca vê/guarda o token do biso.
// Só HTTP (REST limpo do biso: codex, fs, echoes/ask, gain). O chat usa a sessão
// nativa do bisa apontada p/ o projeto do biso (ver server.js, biso.llm.*).

const express = require('express');
const httpProxy = require('http-proxy');

module.exports = function makeBisoBridge({ requireAuth, BISO_URL, BISO_TOKEN }) {
  const TARGET = BISO_URL || 'http://127.0.0.1:7777';
  const PREFIX = '/biso';

  const proxy = httpProxy.createProxyServer({ target: TARGET, changeOrigin: true });
  // Auth do biso injetada no servidor (header — biso lê query→header→body→cookie).
  proxy.on('proxyReq', (pr) => { if (BISO_TOKEN) pr.setHeader('x-biso-token', BISO_TOKEN); });
  proxy.on('error', (_err, _req, res) => {
    try {
      if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Biso indisponível. Suba o biso (porta 7777) no Mac.');
      } else if (res && res.destroy) res.destroy();
    } catch {}
  });

  const router = express.Router();
  // O mount em PREFIX remove "/biso" de req.url; encaminhamos o resto ao biso.
  // OBS: server.js pula o express.json p/ /biso, então o body chega íntegro ao proxy.
  router.use(PREFIX, requireAuth, (req, res) => proxy.web(req, res));

  return { router, PREFIX };
};
