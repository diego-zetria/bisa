// lib/pair/index.js — pareamento por QR (rota de supervisor).
// O Diego abre /pair/qr no Mac; o PNG codifica a URL da LAN com o token DELA,
// ela escaneia no iPad e o cookie é setado pelo middleware de ?token=.

const express = require('express');
const os = require('os');
const QRCode = require('qrcode');

module.exports = function makePair(deps) {
  const { requireSupervisor, AUTH_TOKEN, PORT } = deps;
  const router = express.Router();

  const lanIp = () => {
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const i of ifaces || []) {
        if (i.family === 'IPv4' && !i.internal) return i.address;
      }
    }
    return 'localhost';
  };

  // URL de pareamento: IP da LAN + token DELA (não o de supervisor).
  router.get('/pair/url', requireSupervisor, (_req, res) => {
    res.json({ url: `http://${lanIp()}:${PORT}/?token=${AUTH_TOKEN}` });
  });

  router.get('/pair/qr', requireSupervisor, async (_req, res) => {
    const url = `http://${lanIp()}:${PORT}/?token=${AUTH_TOKEN}`;
    try {
      const png = await QRCode.toBuffer(url, { width: 320, margin: 2 });
      res.type('png').send(png);
    } catch (e) {
      res.status(500).json({ error: 'falha ao gerar QR' });
    }
  });

  return { router };
};
