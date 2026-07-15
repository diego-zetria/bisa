// lib/stt/index.js — proxy reverso do bisa → WhisperLiveKit (ditado local).
// O iPad manda áudio PCM por WebSocket e recebe transcrição parcial/final.
// DOIS motores (detecção auto por streaming é instável — testado 2026-07-09,
// saiu sopa pt/en): um por idioma, o cliente escolhe via ?lang=.
//   /stt/asr?lang=pt (default) → ws://127.0.0.1:8100/asr  (com.bisa.stt)
//   /stt/asr?lang=en           → ws://127.0.0.1:8102/asr  (com.bisa.stt-en)
// Whisper large-v3-turbo via MLX na GPU; nada exposto fora da tailnet,
// mesma origem HTTPS do bisa (auth do bisa cobre; ver wsAuthed no server.js).

const express = require('express');
const httpProxy = require('http-proxy');

module.exports = function makeStt({ requireAuth }) {
  const TARGETS = {
    pt: process.env.STT_URL || 'http://127.0.0.1:8100',
    en: process.env.STT_EN_URL || 'http://127.0.0.1:8102',
  };
  const PREFIX = '/stt';

  const mkProxy = (target) => {
    const p = httpProxy.createProxyServer({ target, ws: true, changeOrigin: true });
    p.on('error', (_err, _req, res) => {
      try {
        if (res && res.writeHead && !res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Motor de ditado (WhisperLiveKit) indisponível.');
        } else if (res && res.destroy) res.destroy();
      } catch {}
    });
    return p;
  };
  const proxies = { pt: mkProxy(TARGETS.pt), en: mkProxy(TARGETS.en) };
  const langOf = (url) => {
    try { return new URL(url, 'http://x').searchParams.get('lang') === 'en' ? 'en' : 'pt'; } catch { return 'pt'; }
  };

  const router = express.Router();
  router.use(PREFIX, requireAuth, (req, res) => proxies[langOf(req.originalUrl)].web(req, res));

  // Upgrade de WebSocket p/ /stt/* (áudio → transcrição). Auth no server.js.
  const upgrade = (req, socket, head) => {
    const lang = langOf(req.url);
    req.url = req.url.replace(/^\/stt/, '') || '/';
    proxies[lang].ws(req, socket, head);
  };

  return { router, upgrade, PREFIX };
};
