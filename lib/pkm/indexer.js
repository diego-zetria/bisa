// lib/pkm/indexer.js
// In-memory PKM index: entities, wikilinks, backlinks, graph.
// Watches pkm/ + codex/journal.md via chokidar; incremental reindex.
// Tolerant to malformed files (skip + warn, never crash).
'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

// ---------------------------------------------------------------------------
// Hand-rolled YAML frontmatter parser — flat scalars + string lists only.
// Handles:
//   key: value
//   key: [a, b, c]          (inline list)
//   key:                     (multi-line list with - items below)
//     - a
//     - b
// ---------------------------------------------------------------------------
function parseFrontmatter(text) {
  const fm = {};
  const lines = text.split('\n');
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    // Skip blank lines
    if (!line.trim()) { i++; continue; }
    // Match key: value or key: [...]
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)?$/);
    if (!m) { i++; continue; }
    const key = m[1];
    const rest = (m[2] || '').trim();
    // Inline list: key: [a, b, c]
    if (rest.startsWith('[')) {
      const inner = rest.replace(/^\[/, '').replace(/\].*$/, '');
      fm[key] = inner.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
      continue;
    }
    // No value on this line → check next lines for list items
    if (rest === '') {
      const list = [];
      i++;
      while (i < n && /^\s+-\s+(.*)$/.test(lines[i])) {
        const lm = lines[i].match(/^\s+-\s+(.*)$/);
        list.push(lm[1].trim());
        i++;
      }
      fm[key] = list.length > 0 ? list : '';
      continue;
    }
    // Scalar value — strip optional quotes
    fm[key] = rest.replace(/^['"]|['"]$/g, '');
    i++;
  }
  return fm;
}

// ---------------------------------------------------------------------------
// Extract frontmatter + body from a markdown file.
// Returns { fm, body } or throws on bad delimiter.
// ---------------------------------------------------------------------------
function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: text };
  const rawYaml = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\n/, '');
  const fm = parseFrontmatter(rawYaml);
  return { fm, body };
}

// ---------------------------------------------------------------------------
// Extract wikilinks from a text string.
// Recognises [[slug]], [[slug|label]], [[Path/slug]].
// Returns array of slugs (basename, kebab-case).
// ---------------------------------------------------------------------------
function extractWikilinks(text) {
  const slugs = [];
  const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    // Take basename if path-style (Path/slug)
    const base = raw.split('/').pop().trim();
    // Normalise to kebab
    const slug = slugify(base);
    if (slug) slugs.push(slug);
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// Slugify: lowercase, replace spaces/underscores with hyphens, strip
// non-alphanumeric except hyphens.
// ---------------------------------------------------------------------------
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Detect entity type from directory name.
// ---------------------------------------------------------------------------
function typeFromDir(dir) {
  const base = path.basename(dir).toLowerCase();
  if (base === 'people') return 'people';
  if (base === 'projects') return 'projects';
  if (base === 'documents') return 'documents';
  return 'document'; // fallback
}

// ---------------------------------------------------------------------------
// Makeshift excerpt: first ~120 chars of body that has non-whitespace.
// ---------------------------------------------------------------------------
function makeExcerpt(text, maxLen = 120) {
  const clean = text.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
                    .replace(/[#*_`]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

// ---------------------------------------------------------------------------
// Main indexer factory.
// ---------------------------------------------------------------------------
function makeIndexer({ CWD, broadcast }) {
  const PKM_DIR = path.join(CWD, 'pkm');
  const JOURNAL_FILE = path.join(CWD, 'codex', 'journal.md');

  // In-memory index
  // entities: Map<slug, {slug, type, fm, body, file, mtime}>
  // links: [{source, target}]  (slug → slug; journal day uses 'j:YYYY-MM-DD')
  // backlinks: Map<slug, [{source, date?, excerpt}]>
  const state = {
    entities: new Map(),
    links: [],
    backlinks: new Map(),
  };

  // --------------------------------------------------------------------------
  // Parse + index a single entity file.
  // --------------------------------------------------------------------------
  function indexEntityFile(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { console.warn('[pkm] cannot read', file, e.message); return; }

    let fm, body;
    try {
      const parsed = splitFrontmatter(text);
      fm = parsed.fm;
      body = parsed.body;
    } catch (e) {
      console.warn('[pkm] malformed frontmatter, skipping', file, e.message);
      return;
    }

    const relDir = path.relative(PKM_DIR, path.dirname(file));
    // Derive type from the first path segment (People, Projects, Documents)
    const topDir = relDir.split(path.sep)[0] || relDir;
    const type = typeFromDir(topDir);
    const slug = slugify(path.basename(file, '.md'));
    if (!slug) { console.warn('[pkm] cannot derive slug from', file); return; }

    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch {}

    state.entities.set(slug, { slug, type, fm, body, file, mtime });

    // Collect outbound wikilinks from body
    const targets = extractWikilinks(body);
    for (const target of targets) {
      state.links.push({ source: slug, target });
    }
  }

  // --------------------------------------------------------------------------
  // Parse journal and index wikilinks from each day section.
  // Adds 'j:YYYY-MM-DD' nodes to backlinks.
  // --------------------------------------------------------------------------
  function indexJournal() {
    let text;
    try { text = fs.readFileSync(JOURNAL_FILE, 'utf8'); }
    catch { return; } // journal may not exist yet

    // Split by day blocks (same as store.js: split on --- separator)
    const blocks = text.split(/\n^---\n/m)
      .map((s) => s.replace(/^---\n/m, '').trim())
      .filter(Boolean);

    for (const block of blocks) {
      const lines = block.split('\n');
      const h1 = lines[0].match(/^#\s+(\d{4}-\d{2}-\d{2})/);
      if (!h1) continue;
      const date = h1[1];
      const nodeId = `j:${date}`;
      const bodyText = lines.slice(1).join('\n');
      const targets = extractWikilinks(bodyText);
      for (const target of targets) {
        state.links.push({ source: nodeId, target });
        // Backlink: entity ← journal day
        const excerpt = makeExcerpt(bodyText);
        const bl = state.backlinks.get(target) || [];
        bl.push({ source: nodeId, date, excerpt });
        state.backlinks.set(target, bl);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Full reindex: scan all entity files + journal.
  // --------------------------------------------------------------------------
  function reindex() {
    state.entities.clear();
    state.links = [];
    state.backlinks.clear();

    // Walk pkm/ looking for .md files (exclude Inbox and assets)
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // Skip Inbox and assets — not entity directories
          if (e.name === 'Inbox' || e.name === 'assets') continue;
          walk(full);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          indexEntityFile(full);
        }
      }
    };
    walk(PKM_DIR);

    // Now build entity→entity backlinks from links array
    for (const { source, target } of state.links) {
      // Only entity→entity links here (journal ones already handled in indexJournal)
      if (source.startsWith('j:')) continue;
      const srcEntity = state.entities.get(source);
      if (!srcEntity) continue;
      const excerpt = makeExcerpt(srcEntity.body);
      const bl = state.backlinks.get(target) || [];
      bl.push({ source, excerpt });
      state.backlinks.set(target, bl);
    }

    // Index journal separately
    indexJournal();

    console.log(`[pkm] indexed ${state.entities.size} entities, ${state.links.length} links`);
    if (broadcast) broadcast({ type: 'pkm', event: 'index' });
  }

  // --------------------------------------------------------------------------
  // Debounced incremental reindex trigger (500ms).
  // --------------------------------------------------------------------------
  let reindexTimer = null;
  function scheduleReindex() {
    if (reindexTimer) clearTimeout(reindexTimer);
    reindexTimer = setTimeout(() => { reindexTimer = null; reindex(); }, 500);
  }

  // --------------------------------------------------------------------------
  // Start chokidar watcher. Returns a close() function.
  // --------------------------------------------------------------------------
  function start() {
    // Ensure pkm/ exists
    try { fs.mkdirSync(PKM_DIR, { recursive: true }); } catch {}

    reindex();

    const targets = [PKM_DIR];
    if (fs.existsSync(path.dirname(JOURNAL_FILE))) targets.push(JOURNAL_FILE);

    const watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: /\/(assets|Inbox)\//,
    });
    for (const ev of ['add', 'change', 'unlink']) {
      watcher.on(ev, () => scheduleReindex());
    }
    watcher.on('error', (e) => console.error('[pkm] watcher:', e.message));

    // Return a close function so callers (and tests) can tear down the watcher
    return () => {
      if (reindexTimer) { clearTimeout(reindexTimer); reindexTimer = null; }
      return watcher.close();
    };
  }

  // --------------------------------------------------------------------------
  // Graph builder: nodes + links with optional focus+hops subgraph.
  // --------------------------------------------------------------------------
  function buildGraph({ focus, hops = 1 } = {}) {
    if (!focus) {
      // Global graph
      const nodes = [];
      for (const [, e] of state.entities) {
        nodes.push({ id: e.slug, type: e.type, name: e.fm.name || e.slug, links: 0 });
      }
      // Add journal day nodes that appear as sources
      const dayNodes = new Set();
      for (const { source } of state.links) {
        if (source.startsWith('j:')) dayNodes.add(source);
      }
      for (const id of dayNodes) {
        nodes.push({ id, type: 'journal', name: id.replace('j:', ''), links: 0 });
      }
      // Drop dangling links: a wikilink may point at a slug that has no
      // entity file yet (e.g. she wrote [[fulano]] before the stub exists).
      // Graph renderers (force-graph) crash on a link whose endpoint is not
      // a node, so keep only links whose both ends are present in `nodes`.
      const nodeIds = new Set(nodes.map((n) => n.id));
      const links = state.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));
      // Count links per node
      const linkCount = {};
      for (const l of links) {
        linkCount[l.source] = (linkCount[l.source] || 0) + 1;
        linkCount[l.target] = (linkCount[l.target] || 0) + 1;
      }
      for (const n of nodes) n.links = linkCount[n.id] || 0;
      return { nodes, links };
    }

    // Subgraph within N hops of focus
    const visited = new Set();
    const queue = [{ id: focus, hop: 0 }];
    while (queue.length) {
      const { id, hop } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      if (hop >= hops) continue;
      for (const { source, target } of state.links) {
        if (source === id && !visited.has(target)) queue.push({ id: target, hop: hop + 1 });
        if (target === id && !visited.has(source)) queue.push({ id: source, hop: hop + 1 });
      }
    }

    const filteredLinks = state.links.filter(
      (l) => visited.has(l.source) && visited.has(l.target),
    );

    const nodes = [];
    for (const id of visited) {
      if (id.startsWith('j:')) {
        nodes.push({ id, type: 'journal', name: id.replace('j:', ''), links: 0 });
      } else {
        const e = state.entities.get(id);
        if (e) nodes.push({ id: e.slug, type: e.type, name: e.fm.name || e.slug, links: 0 });
        else nodes.push({ id, type: 'unknown', name: id, links: 0 });
      }
    }
    const linkCount = {};
    for (const l of filteredLinks) linkCount[l.source] = (linkCount[l.source] || 0) + 1;
    for (const n of nodes) n.links = linkCount[n.id] || 0;

    return { nodes, links: filteredLinks };
  }

  // --------------------------------------------------------------------------
  // Accent-insensitive search helper.
  // ---------------------------------------------------------------------------
  function normalizeForSearch(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  // --------------------------------------------------------------------------
  // Search: entities + journal full-text, accent-insensitive.
  // --------------------------------------------------------------------------
  function search(q) {
    const norm = normalizeForSearch(q);
    if (!norm) return { entities: [], journal: [] };

    const entities = [];
    for (const [, e] of state.entities) {
      const haystack = normalizeForSearch(
        [e.fm.name || '', e.slug, e.body, JSON.stringify(e.fm.tags || '')].join(' '),
      );
      if (haystack.includes(norm)) {
        entities.push({
          slug: e.slug,
          type: e.type,
          name: e.fm.name || e.slug,
          tags: e.fm.tags || [],
          excerpt: makeExcerpt(e.body),
        });
      }
    }

    // Journal search: read fresh from disk
    const journal = [];
    let text;
    try { text = fs.readFileSync(JOURNAL_FILE, 'utf8'); } catch { text = ''; }
    const blocks = text.split(/\n^---\n/m).map((s) => s.replace(/^---\n/m, '').trim()).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split('\n');
      const h1 = lines[0].match(/^#\s+(\d{4}-\d{2}-\d{2})/);
      if (!h1) continue;
      const date = h1[1];
      const body = lines.slice(1).join('\n');
      if (normalizeForSearch(body).includes(norm)) {
        journal.push({ date, excerpt: makeExcerpt(body) });
      }
    }

    return { entities, journal };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------
  return {
    start,
    reindex,
    getState: () => state,
    buildGraph,
    search,
    slugify,
    normalizeForSearch,
    // Exposed for testing
    parseFrontmatter,
    splitFrontmatter,
    extractWikilinks,
    makeExcerpt,
    indexEntityFile: (file) => { indexEntityFile(file); },
  };
}

module.exports = { makeIndexer, parseFrontmatter, splitFrontmatter, extractWikilinks, slugify };
