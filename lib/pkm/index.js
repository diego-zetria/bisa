// lib/pkm/index.js
// PKM module: entidades, wikilinks, backlinks, grafo, busca, inbox/fotos.
// Fase 5 — implementação real.
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { makeIndexer, slugify } = require('./indexer');
const codexStore = require('../codex/store');

// ---------------------------------------------------------------------------
// Sanitize an upload filename: strip leading dots/slashes, keep extension,
// strip dangerous characters. Collapse to safe basename.
// ---------------------------------------------------------------------------
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'upload';
  // Take basename (strip any directory parts)
  let base = path.basename(name);
  // Strip leading dots and hyphens
  base = base.replace(/^[.\-/\\]+/, '');
  // Replace dangerous chars with hyphens, keep alphanumerics, dots, hyphens
  base = base.replace(/[^a-zA-Z0-9.\-_]/g, '-');
  // Collapse multiple hyphens
  base = base.replace(/-{2,}/g, '-');
  // Strip leading/trailing hyphens
  base = base.replace(/^-+|-+$/g, '');
  return base || 'upload';
}

// ---------------------------------------------------------------------------
// Resolve a collision-safe filename in a directory.
// If baseName exists, try baseName-1, baseName-2, etc.
// ---------------------------------------------------------------------------
function resolveCollision(dir, baseName) {
  const candidate = path.join(dir, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const c = path.join(dir, `${stem}-${i}${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  // Fallback: timestamp suffix
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

// ---------------------------------------------------------------------------
// Factory: makePkm({ requireAuth, CWD, broadcast }) → { router }
// ---------------------------------------------------------------------------
function makePkm({ requireAuth, CWD, broadcast }) {
  const PKM_DIR = path.join(CWD, 'pkm');
  const JOURNAL_FILE = path.join(CWD, 'codex', 'journal.md');

  const indexer = makeIndexer({ CWD, broadcast });
  const closeWatcher = indexer.start();

  const router = express.Router();

  // Raw body middleware for inbox/photo upload routes
  const rawBody = express.raw({ type: '*/*', limit: '25mb' });

  // ---------------------------------------------------------------------------
  // GET /pkm/health → { ok: true, count }
  // ---------------------------------------------------------------------------
  router.get('/pkm/health', requireAuth, (req, res) => {
    const { entities } = indexer.getState();
    res.json({ ok: true, count: entities.size });
  });

  // ---------------------------------------------------------------------------
  // GET /pkm/reindex → trigger manual reindex
  // ---------------------------------------------------------------------------
  router.get('/pkm/reindex', requireAuth, (req, res) => {
    indexer.reindex();
    const { entities } = indexer.getState();
    res.json({ ok: true, count: entities.size });
  });

  // ---------------------------------------------------------------------------
  // GET /pkm/entities → list all entities [{slug,type,name,tags}]
  // Also supports legacy GET /pkm/list?type= from API.md
  // ---------------------------------------------------------------------------
  router.get('/pkm/entities', requireAuth, (req, res) => {
    const { entities } = indexer.getState();
    const typeFilter = req.query.type;
    const list = [];
    for (const [, e] of entities) {
      if (typeFilter && e.type !== typeFilter) continue;
      list.push({
        slug: e.slug,
        type: e.type,
        name: e.fm.name || e.slug,
        tags: e.fm.tags || [],
      });
    }
    // Sort by name
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    res.json(list);
  });

  // Legacy alias: /pkm/list (API.md mentions this endpoint too)
  router.get('/pkm/list', requireAuth, (req, res) => {
    const { entities } = indexer.getState();
    const typeFilter = req.query.type;
    const list = [];
    for (const [, e] of entities) {
      if (typeFilter && e.type !== typeFilter) continue;
      list.push({
        slug: e.slug,
        type: e.type,
        fm: e.fm,
        excerpt: e.body ? e.body.slice(0, 120).trim() : '',
      });
    }
    list.sort((a, b) => (a.fm.name || a.slug).localeCompare(b.fm.name || b.slug, 'pt-BR'));
    res.json(list);
  });

  // ---------------------------------------------------------------------------
  // GET /pkm/entity/:slug → { slug, type, fm, md, backlinks, neighbors }
  // md = raw markdown body (NOT html)
  // ---------------------------------------------------------------------------
  router.get('/pkm/entity/:slug', requireAuth, (req, res) => {
    const { entities, backlinks } = indexer.getState();
    const slug = req.params.slug;
    const entity = entities.get(slug);
    if (!entity) return res.status(404).json({ error: 'entidade não encontrada' });

    const bls = backlinks.get(slug) || [];

    // Neighbors: entities linked from or to this entity (1-hop, no journal days)
    const { links } = indexer.getState();
    const neighborSlugs = new Set();
    for (const { source, target } of links) {
      if (source === slug && !target.startsWith('j:')) neighborSlugs.add(target);
      if (target === slug && !source.startsWith('j:')) neighborSlugs.add(source);
    }
    const neighbors = [];
    for (const ns of neighborSlugs) {
      const ne = entities.get(ns);
      if (ne) neighbors.push({ slug: ne.slug, type: ne.type, name: ne.fm.name || ne.slug });
    }

    res.json({
      slug: entity.slug,
      type: entity.type,
      fm: entity.fm,
      md: entity.body,
      backlinks: bls,
      neighbors,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /pkm/graph?focus=slug&hops=N → { nodes, links }
  // ---------------------------------------------------------------------------
  router.get('/pkm/graph', requireAuth, (req, res) => {
    const focus = req.query.focus || null;
    const hops = Math.max(1, Math.min(5, parseInt(req.query.hops, 10) || 1));
    const graph = indexer.buildGraph({ focus, hops });
    res.json(graph);
  });

  // ---------------------------------------------------------------------------
  // GET /pkm/search?q= → { entities, journal }
  // ---------------------------------------------------------------------------
  router.get('/pkm/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ entities: [], journal: [] });
    const result = indexer.search(q);
    res.json(result);
  });

  // ---------------------------------------------------------------------------
  // POST /pkm/inbox?name=  (raw body) → save file to pkm/Inbox/
  // POST /pkm/inbox?kind=photo&name=&date=YYYY-MM-DD → save to pkm/assets/AAAA-MM/
  // ---------------------------------------------------------------------------
  router.post('/pkm/inbox', requireAuth, rawBody, (req, res) => {
    const kind = req.query.kind || 'file';
    const rawName = req.query.name || 'upload';
    const body = req.body; // Buffer from express.raw

    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'corpo vazio' });
    }

    const safeName = sanitizeFilename(rawName);

    if (kind === 'photo') {
      // Save to pkm/assets/YYYY-MM/YYYY-MM-DD-<slug>.<ext>
      const rawDate = req.query.date || new Date().toISOString().slice(0, 10);
      const dateMatch = rawDate.match(/^(\d{4}-\d{2})-\d{2}$/);
      const monthDir = dateMatch ? dateMatch[1] : rawDate.slice(0, 7);
      const dateStr = rawDate.slice(0, 10);

      const ext = path.extname(safeName) || '';
      const stem = slugify(path.basename(safeName, ext)) || 'foto';
      const fileName = `${dateStr}-${stem}${ext}`;
      const assetsDir = path.join(PKM_DIR, 'assets', monthDir);
      try { fs.mkdirSync(assetsDir, { recursive: true }); } catch (e) {
        return res.status(500).json({ error: 'erro ao criar diretório' });
      }

      const dest = resolveCollision(assetsDir, fileName);
      try { fs.writeFileSync(dest, body); } catch (e) {
        return res.status(500).json({ error: 'erro ao salvar foto' });
      }

      // Relative path from CWD for embed
      const rel = path.relative(CWD, dest);

      // Append embed to today's ## notes section in the journal
      try {
        const today = dateStr;
        // Override CODEX_DIR via env to use the CWD-based path
        const journalFile = JOURNAL_FILE;
        const text = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, 'utf8') : '';
        const days = codexStore.parseJournal(text);
        const day = codexStore.findOrCreateDay(days, today);
        const embed = `![[${rel}]]`;
        day.sections.notes = day.sections.notes
          ? day.sections.notes + '\n' + embed
          : embed;
        fs.writeFileSync(journalFile, codexStore.serializeJournal(days), 'utf8');
      } catch (e) {
        console.warn('[pkm] photo: erro ao adicionar embed ao journal:', e.message);
        // Still return success — file was saved
      }

      return res.json({ rel });
    }

    // Default: save to pkm/Inbox/
    const inboxDir = path.join(PKM_DIR, 'Inbox');
    try { fs.mkdirSync(inboxDir, { recursive: true }); } catch (e) {
      return res.status(500).json({ error: 'erro ao criar Inbox' });
    }

    const dest = resolveCollision(inboxDir, safeName);
    try { fs.writeFileSync(dest, body); } catch (e) {
      return res.status(500).json({ error: 'erro ao salvar arquivo' });
    }

    const rel = path.relative(CWD, dest);
    return res.json({ rel });
  });

  return {
    router,
    // close the chokidar watcher (useful in tests and graceful shutdown)
    close: () => closeWatcher && closeWatcher(),
  };
}

module.exports = makePkm;
