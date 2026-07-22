// lib/diagnostico.js — botão "algo está estranho 🛟" (I6).
// Um toque na UI: baixa o pacote de diagnóstico do biso (/health/bundle:
// snapshot dos serviços + tail dos logs + versões), salva em
// .meta/diagnosticos/ na pasta de dados, e avisa o Diego com um toast no
// biso (/api/notify, com log no journal). Tudo best-effort: com o biso
// fora do ar, ainda grava um marcador local para o Diego investigar.

const express = require('express');
const fs = require('fs');
const path = require('path');

const fetchTimeout = async (url, opts, ms) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
};

module.exports = function makeDiagnostico({ requireAuth, CWD, BISO_URL, BISO_TOKEN }) {
  const router = express.Router();

  router.post('/diagnostico', requireAuth, async (req, res) => {
    const dir = path.join(CWD, '.meta', 'diagnosticos');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const headers = { 'x-biso-token': BISO_TOKEN };
    const nota = String(req.body && req.body.nota || '').slice(0, 300);

    let saved = null;
    try {
      const r = await fetchTimeout(`${BISO_URL}/health/bundle`, { headers }, 60000);
      if (r.ok) {
        saved = path.join(dir, `diagnostico-${stamp}.zip`);
        fs.writeFileSync(saved, Buffer.from(await r.arrayBuffer()));
      }
    } catch {}
    if (!saved) {
      // biso fora do ar — deixa um marcador com o que se sabe.
      saved = path.join(dir, `diagnostico-${stamp}.txt`);
      fs.writeFileSync(saved, `pedido de diagnóstico ${stamp}\nbiso indisponível em ${BISO_URL}\nnota: ${nota || '(sem nota)'}\n`);
    }

    let avisado = false;
    try {
      const r = await fetchTimeout(`${BISO_URL}/api/notify`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `🛟 bisa: pedido de diagnóstico${nota ? ` — "${nota}"` : ''} (pacote: ${path.basename(saved)})`,
          log: true,
          tags: ['bisa', 'diagnostico'],
        }),
      }, 10000);
      avisado = r.ok;
    } catch {}

    res.json({ ok: true, saved: path.relative(CWD, saved), avisado });
  });

  return router;
};
