// lib/hooks/receivers.js
// Extracted from server.js R6b (2026-05-24). Claude Code lifecycle hook
// receivers (fire-and-forget observability) + the Stop-hook stale-link
// audit (R6c was folded in here — small enough not to warrant its own
// file).
//
// Endpoints exposed (all under the returned router):
//   POST /api/hook/pretooluse       — Bash tool calls → #bash journal entry
//   POST /api/hook/<event>          — for each HOOK_GENERIC_EVENTS entry
//   GET  /codex/hooks/status        — last-fire info per event (Map dump)
//
// On `stop`, the handler invokes the stale-link audit which walks the
// transcript for .md edits and logs broken refs as #stale-link entries.
//
// Deps injected:
//   - requireAuth (bootstrap)
//   - projectFromCwd (server.js; uses loadProjects which hasn't been
//     extracted yet)
//   - dispatchNotification (lib/notify)
//   - getCwd (lib/bootstrap pattern — server.js owns `let CWD`)
//
// `inferCwdTag` is internal to this module since every callsite was a
// hook handler.

const express = require('express');
const fs = require('fs');
const path = require('path');

const STALE_LINK_MAX_FILES      = 50;             // cap edited files per session
const STALE_LINK_MAX_FILE_BYTES = 500 * 1024;     // skip files > 500KB
const STALE_LINK_MAX_PER_FILE   = 10;             // cap broken refs per file

// Match markdown link target and inline-backtick file refs.
// Group 1 is the candidate path in both.
const STALE_LINK_REGEXES = [
  /\[(?:[^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  /`([^`]+\.(?:md|js|ts|tsx|jsx|sh|json|yaml|yml|css|html))`/g,
];
const STALE_LINK_SKIP_PREFIX = /^(https?:|mailto:|tel:|ftp:|#|\/)/;

// Strip fenced code blocks so example code inside doesn't get parsed as
// real markdown links. Inline backticks stay — that's our second pattern.
const stripFencedBlocks = (content) => content.replace(/```[\s\S]*?```/g, '');

const auditStaleRefsInFile = (filePath) => {
  let content;
  try {
    const st = fs.statSync(filePath);
    if (st.size > STALE_LINK_MAX_FILE_BYTES) return [];
    content = fs.readFileSync(filePath, 'utf8');
  } catch { return []; }

  const stripped = stripFencedBlocks(content);
  const dir = path.dirname(filePath);
  const broken = [];
  const seen = new Set(); // dedupe identical refs in same file

  for (const re of STALE_LINK_REGEXES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const ref = m[1].trim();
      if (!ref || seen.has(ref)) continue;
      // Skip URLs / anchors / mailto / absolute paths
      if (STALE_LINK_SKIP_PREFIX.test(ref)) continue;
      // Skip code-line refs like "server.js:1234" — not paths, line citations
      if (/:\d+$/.test(ref)) continue;
      // Strip anchor + query fragments for existence check
      const cleanRef = ref.split('#')[0].split('?')[0];
      if (!cleanRef) continue;
      const resolved = path.resolve(dir, cleanRef);
      try { fs.statSync(resolved); }
      catch { broken.push({ ref, resolved }); seen.add(ref); }
      if (broken.length >= STALE_LINK_MAX_PER_FILE) break;
    }
    if (broken.length >= STALE_LINK_MAX_PER_FILE) break;
  }
  return broken;
};

module.exports = function makeHookReceivers(deps) {
  const { requireAuth, projectFromCwd, dispatchNotification, getCwd } = deps;

  // Claude Code PreToolUse hook receiver — fire-and-forget observability.
  // The hook streams the raw Claude Code payload to us; we derive project
  // by cwd (longest-prefix match) and log Bash tool calls to the journal.
  // Registered cwd → `#bash #proj/<id>`; unregistered cwd → `#bash
  // #cwd/<basename>` so entries stay slice-able by origin even for
  // Claude Code sessions outside biso's project list.
  // Non-Bash tools are ignored (add more later if there's demand).
  const inferCwdTag = (cwd) => {
    const proj = projectFromCwd(cwd);
    if (proj) return { tag: 'proj/' + proj.id, registered: true };
    if (!cwd) return { tag: null, registered: false };
    const base = path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    return { tag: base ? 'cwd/' + base : null, registered: false };
  };

  // In-memory registry of last hook firings (per event). Powers
  // `biso install-hook --status` so users see whether each registered
  // event has actually been receiving traffic.
  const HOOKS_RECENT = new Map(); // event -> { ts, project, text, count }
  const recordHookFire = (event, projectTag, text) => {
    const cur = HOOKS_RECENT.get(event) || { count: 0 };
    HOOKS_RECENT.set(event, {
      ts: new Date().toISOString(),
      project: projectTag || null,
      text: (text || '').slice(0, 120),
      count: (cur.count || 0) + 1,
    });
  };

  const HOOK_GENERIC_EVENTS = [
    'sessionstart', 'sessionend',
    'posttooluse', 'stop', 'subagentstop',
    'precompact', 'notification',
  ];

  const summarizeHookPayload = (event, body) => {
    if (event === 'posttooluse') {
      const tn = body.tool_name || '?';
      const status = body.tool_response && body.tool_response.is_error ? ' err' : '';
      return `posttooluse · ${tn}${status}`;
    }
    if (event === 'notification') {
      const t = body.notification_type || body.message || '';
      return `notification · ${t}`.slice(0, 200);
    }
    if (event === 'precompact') {
      return `precompact · trigger=${body.trigger || '?'}`;
    }
    if (event === 'subagentstop') {
      return `subagentstop · ${body.agent_type || body.agent_id || ''}`.trim();
    }
    return event;
  };

  const dispatchGenericHook = (event, body) => {
    const cwd = typeof body.cwd === 'string' ? body.cwd : '';
    const inf = inferCwdTag(cwd);
    const tags = ['hook', event];
    if (inf.tag) tags.push(inf.tag);
    const text = summarizeHookPayload(event, body);
    recordHookFire(event, inf.tag, text);
    dispatchNotification({
      code: 9,
      text: text.slice(0, 500),
      log: true,
      tags,
      silent: true,
      source: 'hook',
    });
  };

  // ----------------------------------------------------------------------------
  // Stop-hook stale-link audit (R2 of prd-headless-audit-ratings).
  // Walks the Stop hook's transcript_path for Write/Edit/MultiEdit on .md files,
  // regex-scans each for broken markdown links + inline file refs, logs a
  // #stale-link #proj/<id> journal entry only when broken refs exist.
  // Pure JS — no `claude -p` call.
  // ----------------------------------------------------------------------------
  const auditStaleRefsAfterStop = (body) => {
    const transcriptPath = body.transcript_path;
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

    const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : getCwd();
    const inf = inferCwdTag(cwd);
    const projTag = inf.tag;
    const projectRoot = path.resolve(cwd);

    // Walk JSONL for Write/Edit/MultiEdit tool_use entries on .md files
    // that resolve inside the project root.
    const editedMd = new Set();
    let raw;
    try { raw = fs.readFileSync(transcriptPath, 'utf8'); }
    catch { return; }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      if (d.type !== 'assistant') continue;
      const blocks = d.message && d.message.content;
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks) {
        if (!b || b.type !== 'tool_use') continue;
        if (!['Write', 'Edit', 'MultiEdit'].includes(b.name)) continue;
        const fp = b.input && b.input.file_path;
        if (!fp || typeof fp !== 'string' || !fp.endsWith('.md')) continue;
        const absFp = path.resolve(fp);
        // Confine to project root (path traversal defense + relevance)
        if (!absFp.startsWith(projectRoot + path.sep) && absFp !== projectRoot) continue;
        editedMd.add(absFp);
        if (editedMd.size >= STALE_LINK_MAX_FILES) break;
      }
      if (editedMd.size >= STALE_LINK_MAX_FILES) break;
    }

    if (!editedMd.size) return;

    let totalBroken = 0;
    const perFile = [];
    for (const fp of editedMd) {
      const broken = auditStaleRefsInFile(fp);
      if (broken.length) {
        totalBroken += broken.length;
        perFile.push({ file: path.relative(projectRoot, fp), broken });
      }
    }
    if (!totalBroken) return;

    const summary = `${totalBroken} stale ref${totalBroken === 1 ? '' : 's'} in ${perFile.length} file${perFile.length === 1 ? '' : 's'}`;
    const details = perFile
      .slice(0, 5)
      .map((f) => {
        const head = f.broken.slice(0, 3).map((b) => b.ref).join(', ');
        const more = f.broken.length > 3 ? ` (+${f.broken.length - 3})` : '';
        return `${f.file}: ${head}${more}`;
      })
      .join('; ');

    const tags = ['stale-link'];
    if (projTag) tags.push(projTag);

    dispatchNotification({
      code: 9,
      text: `${summary} — ${details}`,
      log: true,
      tags,
      silent: true,
      source: 'stop-audit',
    });
  };

  const router = express.Router();

  router.post('/api/hook/pretooluse', requireAuth, (req, res) => {
    res.json({ ok: true }); // respond first — never block the hook
    try {
      const body = req.body || {};
      if (body.tool_name !== 'Bash') return;
      const command = body.tool_input && typeof body.tool_input.command === 'string'
        ? body.tool_input.command.trim() : '';
      if (!command) return;
      const cwd = typeof body.cwd === 'string' ? body.cwd : '';
      const tags = ['bash'];
      const inf = inferCwdTag(cwd);
      if (inf.tag) tags.push(inf.tag);
      recordHookFire('pretooluse', inf.tag, command);
      dispatchNotification({
        code: 9,
        text: command.slice(0, 500),
        log: true,
        tags,
        silent: true,
        source: 'hook',
      });
    } catch (e) {
      console.warn('[bisa] hook/pretooluse failed:', e.message);
    }
  });

  for (const ev of HOOK_GENERIC_EVENTS) {
    router.post(`/api/hook/${ev}`, requireAuth, (req, res) => {
      res.json({ ok: true });
      try { dispatchGenericHook(ev, req.body || {}); }
      catch (e) { console.warn(`[bisa] hook/${ev} failed:`, e.message); }
      // R2 of prd-headless-audit-ratings — on Stop, audit edited .md files for
      // broken cross-references. Deterministic regex + fs.existsSync; no LLM.
      if (ev === 'stop') {
        try { auditStaleRefsAfterStop(req.body || {}); }
        catch (e) { console.warn('[bisa] stop stale-link audit failed:', e.message); }
      }
    });
  }

  router.get('/codex/hooks/status', requireAuth, (req, res) => {
    const events = {};
    for (const [ev, info] of HOOKS_RECENT) events[ev] = info;
    res.json({ events });
  });

  return { router, inferCwdTag, recordHookFire, HOOKS_RECENT };
};
