// lib/hooks/audit.js
// Extracted from server.js R6d (2026-05-24). Hook CVE-defense surface:
// scans every reachable .claude/settings.json (global + per-registered-
// project + caller-supplied path), fingerprints each hook command, and
// classifies as ok / allowlisted / foreign / tampered / missing. The
// allowlist lives at ~/.config/biso/hook-allowlist.json (chmod 600).
//
// Defends against CVE-2025-59536 / CVE-2026-21852 — simply opening a
// hostile repo with malicious .claude/settings.json could execute
// arbitrary shell on PreToolUse. The audit flags any cmd whose SHA isn't
// trusted; the user grants trust deliberately via POST /codex/hooks/trust.
//
// Deps injected:
//   - requireAuth (bootstrap)
//   - loadProjects (server.js — used to enumerate per-project settings)
//
// Exports a router + the building-block functions so F3 R16 tests can
// exercise classifyHookCommand and bisoOwnFingerprints directly.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BISA_OWN_HOOKS = ['bisa-observe.sh', 'bisa-english.sh', 'bisa-hook.sh'];
const HOOK_ALLOWLIST_PATH = path.join(
  require('os').homedir(), '.config', 'bisa', 'hook-allowlist.json'
);

const sha256Hex = (data) =>
  crypto.createHash('sha256').update(data).digest('hex');

const loadHookAllowlist = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(HOOK_ALLOWLIST_PATH, 'utf8'));
    return new Set(Array.isArray(raw.trusted) ? raw.trusted : []);
  } catch { return new Set(); }
};

const saveHookAllowlist = (set) => {
  const dir = path.dirname(HOOK_ALLOWLIST_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    HOOK_ALLOWLIST_PATH,
    JSON.stringify({ trusted: [...set].sort() }, null, 2) + '\n'
  );
  try { fs.chmodSync(HOOK_ALLOWLIST_PATH, 0o600); } catch { /* best effort */ }
};

// __dirname here is lib/hooks/, so step up two levels to find hooks/claude/.
const HOOK_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'hooks', 'claude');

const bisoOwnFingerprints = () => {
  const out = new Set();
  for (const name of BISA_OWN_HOOKS) {
    try {
      out.add(sha256Hex(fs.readFileSync(path.join(HOOK_SCRIPTS_DIR, name))));
    } catch { /* missing locally is fine — likely running from binary */ }
  }
  return out;
};

const classifyHookCommand = (cmd, ourFingerprints, allowlist) => {
  const cmdSha = sha256Hex(cmd);
  const firstToken = cmd.split(/\s+/)[0] || '';
  const base = path.basename(firstToken);
  if (BISA_OWN_HOOKS.includes(base)) {
    try {
      const content = fs.readFileSync(firstToken);
      if (ourFingerprints.has(sha256Hex(content))) {
        return { sha: cmdSha, status: 'ok', script: base };
      }
      return { sha: cmdSha, status: 'tampered', script: base };
    } catch {
      return { sha: cmdSha, status: 'missing', script: base };
    }
  }
  if (allowlist.has(cmdSha)) return { sha: cmdSha, status: 'allowlisted', script: base };
  return { sha: cmdSha, status: 'foreign', script: base };
};

const auditOneSettingsFile = (filePath, ourFingerprints, allowlist) => {
  let s;
  try { s = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return []; }
  const hooks = (s && typeof s === 'object' && s.hooks) || {};
  const findings = [];
  for (const [event, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    for (const matcherEntry of arr) {
      const matcher = (matcherEntry && matcherEntry.matcher) || '';
      const inner = (matcherEntry && Array.isArray(matcherEntry.hooks)) ? matcherEntry.hooks : [];
      for (const h of inner) {
        const cmd = String((h && h.command) || '').trim();
        if (!cmd) continue;
        const cls = classifyHookCommand(cmd, ourFingerprints, allowlist);
        findings.push({
          file: filePath, event, matcher,
          command: cmd.length > 240 ? cmd.slice(0, 237) + '...' : cmd,
          ...cls,
        });
      }
    }
  }
  return findings;
};

module.exports = function makeHookAudit(deps) {
  const { requireAuth, loadProjects } = deps;

  const collectAuditPaths = (extra) => {
    const out = new Set();
    const home = require('os').homedir();
    for (const p of [
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.claude', 'settings.local.json'),
    ]) if (fs.existsSync(p)) out.add(p);
    const state = loadProjects();
    for (const proj of (state && state.projects) || []) {
      if (!proj || !proj.path) continue;
      for (const p of [
        path.join(proj.path, '.claude', 'settings.json'),
        path.join(proj.path, '.claude', 'settings.local.json'),
      ]) if (fs.existsSync(p)) out.add(p);
    }
    if (extra) {
      try {
        const stat = fs.statSync(extra);
        if (stat.isDirectory()) {
          for (const p of [
            path.join(extra, '.claude', 'settings.json'),
            path.join(extra, '.claude', 'settings.local.json'),
            path.join(extra, 'settings.json'),
          ]) if (fs.existsSync(p)) out.add(p);
        } else if (stat.isFile()) out.add(extra);
      } catch { /* path missing — caller already validated */ }
    }
    return [...out];
  };

  const router = express.Router();

  router.get('/codex/hooks/audit', requireAuth, (req, res) => {
    const extra = typeof req.query.path === 'string' ? req.query.path : null;
    const ourFingerprints = bisoOwnFingerprints();
    const allowlist = loadHookAllowlist();
    const scanned = collectAuditPaths(extra);
    const findings = scanned.flatMap((p) =>
      auditOneSettingsFile(p, ourFingerprints, allowlist));
    const counts = { ok: 0, allowlisted: 0, foreign: 0, tampered: 0, missing: 0 };
    for (const f of findings) counts[f.status] = (counts[f.status] || 0) + 1;
    res.json({ scanned, counts, findings });
  });

  router.get('/codex/hooks/allowlist', requireAuth, (req, res) => {
    res.json({ trusted: [...loadHookAllowlist()].sort() });
  });

  router.post('/codex/hooks/trust', requireAuth, (req, res) => {
    const sha = String((req.body && req.body.sha) || '').trim();
    if (!/^[a-f0-9]{64}$/.test(sha)) {
      return res.status(400).json({ error: 'invalid sha (expected 64 hex chars)' });
    }
    const set = loadHookAllowlist();
    set.add(sha);
    saveHookAllowlist(set);
    res.json({ ok: true, trusted: [...set].sort() });
  });

  router.post('/codex/hooks/untrust', requireAuth, (req, res) => {
    const sha = String((req.body && req.body.sha) || '').trim();
    if (!/^[a-f0-9]{64}$/.test(sha)) {
      return res.status(400).json({ error: 'invalid sha (expected 64 hex chars)' });
    }
    const set = loadHookAllowlist();
    const had = set.delete(sha);
    if (had) saveHookAllowlist(set);
    res.json({ ok: true, removed: had, trusted: [...set].sort() });
  });

  return { router };
};

// Static exports for tests (F3 R16). The pure-logic functions don't need
// the factory deps — they take the relevant inputs directly.
module.exports.BISA_OWN_HOOKS = BISA_OWN_HOOKS;
module.exports.HOOK_ALLOWLIST_PATH = HOOK_ALLOWLIST_PATH;
module.exports.sha256Hex = sha256Hex;
module.exports.loadHookAllowlist = loadHookAllowlist;
module.exports.saveHookAllowlist = saveHookAllowlist;
module.exports.bisoOwnFingerprints = bisoOwnFingerprints;
module.exports.classifyHookCommand = classifyHookCommand;
module.exports.auditOneSettingsFile = auditOneSettingsFile;
