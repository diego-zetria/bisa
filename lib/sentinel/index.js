// lib/sentinel/index.js — proxy reverso do bisa → Frigate (projeto sentinel).
// Embute a UI de câmeras do Frigate dentro do bisa: mesma origem, atrás do login,
// e alcançável pelo iPad através do próprio bisa (não precisa expor portas).
//   /sentinel/*  → http://127.0.0.1:5001/*  (o mount remove o prefixo)
//   header X-Ingress-Path: /sentinel  → o Frigate emite os assets já sob /sentinel
// HTTP + WebSocket (live view). Frigate roda com auth desligada (auth do bisa basta).

const express = require('express');
const httpProxy = require('http-proxy');

module.exports = function makeSentinel({ requireAuth }) {
  const TARGET = process.env.SENTINEL_FRIGATE_URL || 'http://127.0.0.1:5001';
  const PREFIX = '/sentinel';

  const proxy = httpProxy.createProxyServer({ target: TARGET, ws: true, changeOrigin: true });
  proxy.on('proxyReq', (pr) => pr.setHeader('X-Ingress-Path', PREFIX));
  proxy.on('proxyReqWs', (pr) => pr.setHeader('X-Ingress-Path', PREFIX));
  proxy.on('error', (_err, _req, res) => {
    try {
      if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Sistema de câmeras (sentinel/Frigate) indisponível. Suba o sentinel (make up).');
      } else if (res && res.destroy) res.destroy();
    } catch {}
  });

  const router = express.Router();
  // O mount em PREFIX remove "/sentinel" de req.url; encaminhamos o resto ao Frigate.
  router.use(PREFIX, requireAuth, (req, res) => proxy.web(req, res));

  // Upgrade de WebSocket p/ /sentinel/* (live view). Auth checada no server.js.
  const upgrade = (req, socket, head) => {
    req.url = req.url.replace(/^\/sentinel/, '') || '/';
    proxy.ws(req, socket, head);
  };

  return { router, upgrade, PREFIX };
};
