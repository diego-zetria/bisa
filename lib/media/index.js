// lib/media/index.js — inbox de mídia iPad → Mac (vídeos, fotos, arquivos).
// A usuária escolhe arquivos no iPad (Fotos/Arquivos) e o PWA faz upload em
// streaming para <CWD>/media/inbox/, onde o dev (Claude Code, no Mac) consome.
// Pipeline permanente: substitui Taildrop/AirDrop manuais. Padrão de router
// factory com injeção, como os demais módulos.
//
// Upload é corpo BRUTO em streaming (sem body parser — vídeo não cabe em RAM):
// grava num .tmp-, confere bytes contra o Content-Length e só então faz o
// rename atômico. Conexão caída/abortada nunca deixa arquivo parcial visível.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const chokidar = require('chokidar');

const MAX_BYTES = parseInt(process.env.BISA_MEDIA_MAX_BYTES, 10) || 8 * 1024 * 1024 * 1024; // 8 GB
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// Só o nome-base, sem separadores nem dotfile — o arquivo SEMPRE cai dentro do
// inbox, mesmo com name=../../x no query.
const sanitizeName = (raw) => {
  let n = String(raw || '').split(/[\\/]/).pop().normalize('NFC');
  n = n.replace(/[^\p{L}\p{N}._\- ()]/gu, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return n.slice(0, 140);
};
// colisão → "nome-2.ext", "nome-3.ext"…
const uniqueName = (dir, name) => {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    const cand = `${base}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, cand))) return cand;
  }
};

module.exports = function makeMediaRouter({ requireAuth, getCwd, moveToTrash, broadcast }) {
  const router = express.Router();
  const inboxDir = () => {
    const d = path.join(getCwd(), 'media', 'inbox');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  // Watcher do inbox: vídeo que chega → análise automática num processo
  // destacado (frames via ffmpeg + claude -p) → <video>.analysis.md ao lado +
  // aviso no iPad. Gravar a tela vira a forma mais rica de dar feedback.
  // Desligável com BISA_MEDIA_ANALYZE=0.
  if (process.env.BISA_MEDIA_ANALYZE !== '0') {
    try {
      chokidar.watch(inboxDir(), {
        ignoreInitial: true, depth: 0,
        awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 },
      }).on('add', (abs) => {
        if (!/\.(mp4|mov|m4v|webm)$/i.test(abs)) return;
        if (fs.existsSync(abs + '.analysis.md')) return;
        try {
          spawn(process.execPath, [path.join(__dirname, 'analyze-video.js'), abs], {
            env: process.env, detached: true, stdio: 'ignore',
          }).unref();
        } catch (e) { console.error('[media] analyze spawn:', e.message); }
      });
    } catch (e) { console.error('[media] watcher:', e.message); }
  }

  // varre .tmp- órfãos de uploads que morreram junto com o servidor (>1h)
  try {
    const dir = inboxDir();
    for (const f of fs.readdirSync(dir)) {
      if (!/^\..*\.tmp-/.test(f)) continue;
      try {
        if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 60 * 60 * 1000) fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  } catch {}

  // POST /media/upload?name=video.mp4 — corpo bruto (streaming). NÃO passa pelo
  // express.json (ver skip em server.js). Exige Content-Length e confere os
  // bytes gravados — upload truncado (rede caiu) é descartado, nunca fica pela
  // metade no inbox.
  router.post('/media/upload', requireAuth, (req, res) => {
    const dir = inboxDir();
    const name = sanitizeName(req.query.name);
    if (!name) return res.status(400).json({ error: 'name obrigatório (?name=arquivo.ext)' });
    const declared = parseInt(req.headers['content-length'], 10);
    if (!Number.isFinite(declared) || declared <= 0) return res.status(411).json({ error: 'Content-Length obrigatório' });
    if (declared > MAX_BYTES) return res.status(413).json({ error: `arquivo maior que o limite (${Math.round(MAX_BYTES / 1e9)} GB)` });

    const finalName = uniqueName(dir, name);
    const tmp = path.join(dir, '.' + finalName + '.tmp-' + process.pid + '-' + Date.now());
    const out = fs.createWriteStream(tmp);
    let failed = false;
    const fail = (code, msg) => {
      if (failed) return; failed = true;
      out.destroy();
      fs.unlink(tmp, () => {});
      if (!res.headersSent) res.status(code).json({ error: msg });
    };
    req.on('aborted', () => fail(400, 'upload interrompido'));
    req.on('error', () => fail(400, 'upload interrompido'));
    out.on('error', (e) => fail(500, 'falha ao gravar: ' + e.message));
    out.on('finish', () => {
      if (failed) return;
      if (out.bytesWritten !== declared) return fail(400, `upload truncado (${out.bytesWritten}/${declared} bytes)`);
      try {
        fs.renameSync(tmp, path.join(dir, finalName));   // atômico: só agora fica visível
      } catch (e) { return fail(500, 'falha ao gravar: ' + e.message); }
      const st = fs.statSync(path.join(dir, finalName));
      if (broadcast) broadcast({ type: 'media', event: 'add', name: finalName });
      res.json({ ok: true, file: { name: finalName, size: st.size, mtimeMs: st.mtimeMs } });
    });
    req.pipe(out);
  });

  // GET /media/list — arquivos do inbox, mais recentes primeiro.
  router.get('/media/list', requireAuth, (_req, res) => {
    try {
      const dir = inboxDir();
      const files = fs.readdirSync(dir)
        .filter((f) => !f.startsWith('.'))
        .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtimeMs: st.mtimeMs }; })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.json({ dir, files });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /media/raw?name= — devolve o arquivo, com suporte a Range (o <video>
  // do Safari só toca com 206; auth por cookie/?token=, como /vault/raw).
  router.get('/media/raw', requireAuth, (req, res) => {
    const name = sanitizeName(req.query.name);
    const abs = path.join(inboxDir(), name);
    if (!name || !fs.existsSync(abs)) return res.status(404).json({ error: 'não encontrado' });
    const st = fs.statSync(abs);
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-type', mimeOf(name));
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = st.size - 1, code = 200;
    if (m && (m[1] || m[2])) {
      start = m[1] ? parseInt(m[1], 10) : Math.max(0, st.size - parseInt(m[2], 10));
      end = (m[1] && m[2]) ? Math.min(parseInt(m[2], 10), st.size - 1) : end;
      if (start > end || start >= st.size) return res.status(416).setHeader('content-range', `bytes */${st.size}`).end();
      code = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${st.size}`);
    }
    res.status(code);
    res.setHeader('content-length', end - start + 1);
    fs.createReadStream(abs, { start, end }).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
  });

  // POST /media/delete {name} — Lixeira do Finder (recuperável), não rm.
  router.post('/media/delete', requireAuth, (req, res) => {
    const name = sanitizeName((req.body || {}).name);
    const abs = path.join(inboxDir(), name);
    if (!name || !fs.existsSync(abs)) return res.status(404).json({ error: 'não encontrado' });
    try { moveToTrash(abs); } catch (e) { return res.status(500).json({ error: e.message }); }
    if (broadcast) broadcast({ type: 'media', event: 'delete', name });
    res.json({ ok: true });
  });

  return router;
};
