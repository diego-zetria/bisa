// lib/fs-api.js
// Extracted from server.js R2 (2026-05-24). Express router factory for
// filesystem CRUD endpoints. Depends on bootstrap-provided primitives
// (requireAuth, resolveInsideCwd, MIME tables, helpers) plus a CWD
// getter so the module follows project-switching transparently.
//
// /upload stays in server.js for now — it depends on codex helpers
// (loadJournal, findOrCreateDay, saveJournal, genId, todayCodex,
// nowHMCodex) that don't migrate until R3/R4. Will move once codex
// is extracted.
//
// /self/cli, /self/agent, /self/hooks/:name also stay in server.js —
// they're biso-metadata endpoints, not file CRUD.

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const MAX_WRITE_BYTES = 5 * 1024 * 1024;

module.exports = function makeFsRouter(deps) {
  const {
    requireAuth, resolveInsideCwd, getCwd,
    safeEq, extractToken, AUTH_TOKEN,
    MAX_FILE_BYTES, EXT_BINARY, EXT_IMAGE, MIME,
    copyRecursive, moveToTrash,
  } = deps;

  const router = express.Router();

  // Inline auth check for /fs/list and /file matches the original behavior
  // (those endpoints reject early with a custom JSON body, not the generic
  // requireAuth middleware response).
  const checkAuth = (req, res) => {
    if (!safeEq(extractToken(req), AUTH_TOKEN)) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  };

  router.get('/fs/list', (req, res) => {
    if (!checkAuth(req, res)) return;
    const CWD = getCwd();
    const rel = req.query.path || '.';
    const abs = resolveInsideCwd(rel);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    try {
      const entries = fs.readdirSync(abs, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.') && d.name !== 'node_modules')
        .map((d) => {
          let isDir = d.isDirectory();
          if (d.isSymbolicLink()) {
            try { isDir = fs.statSync(path.join(abs, d.name)).isDirectory(); }
            catch { isDir = false; }
          }
          return { name: d.name, dir: isDir, rel: path.relative(CWD, path.join(abs, d.name)) };
        })
        .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
      res.json({ root: CWD, rel: path.relative(CWD, abs) || '.', entries });
    } catch (e) {
      if (e.code === 'ENOENT')  return res.status(404).json({ error: 'not found' });
      if (e.code === 'ENOTDIR') return res.status(400).json({ error: 'not a directory' });
      if (e.code === 'EACCES' || e.code === 'EPERM') return res.status(403).json({ error: 'permission denied' });
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/file', (req, res) => {
    if (!checkAuth(req, res)) return;
    const CWD = getCwd();
    const abs = resolveInsideCwd(req.query.path);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    let stat;
    try { stat = fs.statSync(abs); } catch { return res.status(404).json({ error: 'not found' }); }
    if (!stat.isFile()) return res.status(400).json({ error: 'not a file' });

    const ext = path.extname(abs).toLowerCase();

    if (EXT_IMAGE.has(ext) || ext === '.pdf') {
      res.type(MIME[ext] || 'application/octet-stream');
      return fs.createReadStream(abs).pipe(res);
    }

    if (stat.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'file too large', size: stat.size, max: MAX_FILE_BYTES });
    }

    if (EXT_BINARY.has(ext)) {
      return res.json({ binary: true, size: stat.size, mtimeMs: stat.mtimeMs, ext });
    }

    try {
      const content = fs.readFileSync(abs, 'utf8');
      res.json({
        path: path.relative(CWD, abs),
        ext,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        content,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/archive', requireAuth, (req, res) => {
    const CWD = getCwd();
    const abs = resolveInsideCwd(req.query.path);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    let stat;
    try { stat = fs.statSync(abs); } catch { return res.status(404).json({ error: 'not found' }); }
    if (abs === path.resolve(CWD)) return res.status(400).json({ error: 'refusing to archive CWD root' });
    const parent = path.dirname(abs);
    const name = path.basename(abs);
    const base = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const kind = stat.isDirectory() ? 'dir' : 'file';
    res.type('application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.tar.gz"`);
    res.setHeader('X-Biso-Archive-Kind', kind);
    const tar = spawn('tar', ['-czf', '-', '-C', parent, name], { stdio: ['ignore', 'pipe', 'pipe'] });
    tar.stdout.pipe(res);
    let err = '';
    tar.stderr.on('data', (d) => { err += d.toString('utf8'); });
    tar.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: `tar exit ${code}: ${err.slice(-300)}` });
      } else if (code !== 0) {
        console.warn(`[bisa] tar ${abs} exit ${code}: ${err.slice(-300)}`);
        res.end();
      }
    });
    tar.on('error', (e) => {
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
  });

  router.post('/fs/mkdir', requireAuth, (req, res) => {
    const CWD = getCwd();
    const abs = resolveInsideCwd(req.body && req.body.path);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    try {
      fs.mkdirSync(abs, { recursive: false });
      res.json({ ok: true, path: path.relative(CWD, abs) });
    } catch (e) {
      res.status(e.code === 'EEXIST' ? 409 : 500).json({ error: e.message });
    }
  });

  router.post('/fs/touch', requireAuth, (req, res) => {
    const CWD = getCwd();
    const abs = resolveInsideCwd(req.body && req.body.path);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    try {
      const fd = fs.openSync(abs, 'wx');
      fs.closeSync(fd);
      res.json({ ok: true, path: path.relative(CWD, abs) });
    } catch (e) {
      res.status(e.code === 'EEXIST' ? 409 : 500).json({ error: e.message });
    }
  });

  router.post('/fs/rename', requireAuth, (req, res) => {
    const CWD = getCwd();
    const from = resolveInsideCwd(req.body && req.body.from);
    const to   = resolveInsideCwd(req.body && req.body.to);
    if (!from || !to) return res.status(400).json({ error: 'invalid path' });
    if (!fs.existsSync(from)) return res.status(404).json({ error: 'source not found' });
    if (fs.existsSync(to))    return res.status(409).json({ error: 'destination exists' });
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      res.json({ ok: true, from: path.relative(CWD, from), to: path.relative(CWD, to) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/fs/copy', requireAuth, (req, res) => {
    const CWD = getCwd();
    const from = resolveInsideCwd(req.body && req.body.from);
    const to   = resolveInsideCwd(req.body && req.body.to);
    if (!from || !to) return res.status(400).json({ error: 'invalid path' });
    if (!fs.existsSync(from)) return res.status(404).json({ error: 'source not found' });
    if (fs.existsSync(to))    return res.status(409).json({ error: 'destination exists' });
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      copyRecursive(from, to);
      res.json({ ok: true, from: path.relative(CWD, from), to: path.relative(CWD, to) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/fs/write', requireAuth, express.json({ limit: '5mb' }), (req, res) => {
    const CWD = getCwd();
    const abs = resolveInsideCwd(req.body && req.body.path);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    const content = req.body && req.body.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      return res.status(413).json({ error: 'content too large', max: MAX_WRITE_BYTES });
    }
    const ifMtimeMs = req.body && req.body.ifMtimeMs;
    let existed = false;
    try {
      const stat = fs.statSync(abs);
      existed = true;
      if (!stat.isFile()) return res.status(400).json({ error: 'not a file' });
      if (typeof ifMtimeMs === 'number' && Math.abs(stat.mtimeMs - ifMtimeMs) > 2) {
        return res.status(409).json({ error: 'file changed on disk', currentMtimeMs: stat.mtimeMs });
      }
    } catch (e) {
      if (e.code !== 'ENOENT') return res.status(500).json({ error: e.message });
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      const stat = fs.statSync(abs);
      res.json({
        ok: true,
        path: path.relative(CWD, abs),
        created: !existed,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/fs/delete', requireAuth, (req, res) => {
    const CWD = getCwd();
    const abs = resolveInsideCwd(req.query.path);
    if (!abs) return res.status(400).json({ error: 'invalid path' });
    if (abs === path.resolve(CWD)) return res.status(400).json({ error: 'refusing to delete CWD' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not found' });
    try {
      const trashed = moveToTrash(abs);
      res.json({ ok: true, path: path.relative(CWD, abs), trashedTo: trashed });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
