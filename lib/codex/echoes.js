// lib/codex/echoes.js
// Extracted from server.js R5c (2026-05-24). Echoes — relevance search over
// the journal so an agent can surface prior decisions/learnings/blockers
// without re-deriving them.
//
// Two endpoints live here: GET /codex/echoes (explicit query) and
// GET /codex/echoes/auto (no-query, importance + recency + access ranking
// for SessionStart injection). Both append to codex/.meta/echoes-usage.jsonl
// so adoption + zero-result rate are observable.
//
// Deps injected:
//   - requireAuth (bootstrap)
//   - CODEX_DIR (codexStore) — for the usage file path
//   - loadJournal (codexStore)
//
// Exports a router factory + `countEchoesHealth` (consumed by efficacy
// telemetry which still lives in server.js).

const express = require('express');
const fs = require('fs');
const path = require('path');

const ECHOES_STOPWORDS = new Set([
  'a','an','and','as','at','be','but','by','do','for','from','has','have','i',
  'if','in','is','it','its','my','no','not','of','on','or','our','so','that',
  'the','this','to','was','we','were','what','when','where','which','who','why',
  'will','with','you','your','de','o','a','que','é','para','com','um','uma','se',
  'na','no','dos','das','ao','aos','é','são','será','também'
]);
const ECHOES_TAG_TYPE_BOOST = {
  decision: 1.6, learning: 1.3, blocker: 1.2, bug: 1.2,
  userpref: 1.0, milestone: 0.8, redirect: 0.6,
};

const extractTagsFromText = (text) => {
  // Strip "..." and '...' first so `grep -n "#decision|..."` style commands
  // don't get treated as having a #decision tag. Backticks too — same risk
  // for code-snippet log entries.
  const stripped = String(text || '')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const tags = new Set();
  const re = /#([a-zA-Z0-9][\w/.-]*)/g;
  let m;
  while ((m = re.exec(stripped))) tags.add(m[1].toLowerCase());
  return Array.from(tags);
};

const tokenizeForEchoes = (text) => {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^\w/-]+/)) {
    if (!raw || raw.length < 3) continue;
    if (ECHOES_STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
};

module.exports = function makeEchoes(deps) {
  const { requireAuth, CODEX_DIR, loadJournal } = deps;

  const ECHOES_USAGE_FILE = path.join(CODEX_DIR, '.meta', 'echoes-usage.jsonl');

  const appendEchoesUsage = (record) => {
    try {
      fs.appendFileSync(ECHOES_USAGE_FILE, JSON.stringify(record) + '\n', 'utf8');
    } catch (e) { console.warn('[echoes] usage append:', e.message); }
  };

  // score: tag overlap (×2) + word overlap (×0.5) + type boost + recency decay
  const searchEchoes = (query, { limit = 5, minScore = 0.5, sinceDate = null } = {}) => {
    const queryTags = extractTagsFromText(query);
    const queryWords = tokenizeForEchoes(query);
    if (!queryWords.size && !queryTags.length) return [];

    const todayMs = Date.now();
    const days = loadJournal();
    const hits = [];
    for (const day of days) {
      if (sinceDate && day.date < sinceDate) continue;
      const dayMs = Date.parse(day.date + 'T12:00:00Z');
      const ageDays = Math.max(0, (todayMs - dayMs) / 86400000);
      const decay = Math.exp(-ageDays / 90);  // ~62d half-life
      const sections = day.sections || {};
      const candidates = [
        ...(sections.log || []).map((it) => ({ ...it, _section: 'log' })),
        ...(sections.goals || []).map((it) => ({ ...it, _section: 'goals' })),
        ...(sections.notes ? [{ id: 'notes-' + day.date, text: sections.notes, _section: 'notes' }] : []),
      ];
      for (const it of candidates) {
        const text = it.text || '';
        if (!text) continue;
        const tags = extractTagsFromText(text);
        const words = tokenizeForEchoes(text);
        let s = 0;
        let matchTags = 0;
        for (const qt of queryTags) if (tags.includes(qt)) { s += 2.0; matchTags++; }
        let matchWords = 0;
        for (const qw of queryWords) if (words.has(qw)) { s += 0.5; matchWords++; }
        if (s === 0) continue;
        for (const t of tags) if (ECHOES_TAG_TYPE_BOOST[t]) s += ECHOES_TAG_TYPE_BOOST[t];
        s *= decay;
        if (s < minScore) continue;
        hits.push({
          date: day.date, weekday: day.weekday, section: it._section,
          time: it.time || null, text, tags, id: it.id || null,
          score: +s.toFixed(3), matched_tags: matchTags, matched_words: matchWords,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  };

  // --- echoes auto-mode (no query) ---
  // Pattern adapted from rohitg00/agentmemory (trending, 6.9k⭐ week of 2026-05-23):
  // when no explicit query is provided, score every journal entry by
  //   importance (0.5) + recency (0.3) + access frequency (0.2)
  // and return the top-N. Default off — caller opts in via /codex/echoes/auto
  // or via the BISA_INJECT_ECHOES env flag picked up by the SessionStart hook.
  // Closes the loop on efficacy review T+30 finding F8 (echoes only smoketested).

  const echoAccessCounts = () => {
    const counts = Object.create(null);
    if (!fs.existsSync(ECHOES_USAGE_FILE)) return counts;
    try {
      const lines = fs.readFileSync(ECHOES_USAGE_FILE, 'utf8').split('\n').filter(Boolean);
      for (const ln of lines) {
        let rec;
        try { rec = JSON.parse(ln); } catch { continue; }
        const ids = Array.isArray(rec.surfaced_ids) ? rec.surfaced_ids : [];
        for (const id of ids) {
          if (!id) continue;
          counts[id] = (counts[id] || 0) + 1;
        }
      }
    } catch { /* missing or unreadable — return empty */ }
    return counts;
  };

  const searchEchoesAuto = ({ limit = 5, sinceDate = null, halfLifeDays = 60 } = {}) => {
    const access = echoAccessCounts();
    // Normalize access counts to 0..1 so the 0.2 weight stays meaningful.
    const maxAccess = Math.max(0, ...Object.values(access));
    const todayMs = Date.now();
    const days = loadJournal();
    const hits = [];
    for (const day of days) {
      if (sinceDate && day.date < sinceDate) continue;
      const dayMs = Date.parse(day.date + 'T12:00:00Z');
      const ageDays = Math.max(0, (todayMs - dayMs) / 86400000);
      const recency = Math.exp(-ageDays / halfLifeDays); // 0..1
      const sections = day.sections || {};
      const candidates = [
        ...(sections.log || []).map((it) => ({ ...it, _section: 'log' })),
        ...(sections.goals || []).map((it) => ({ ...it, _section: 'goals' })),
      ];
      for (const it of candidates) {
        const text = it.text || '';
        if (!text) continue;
        const tags = extractTagsFromText(text);
        // importance = max tag-type boost, normalized to ~0..1 (boosts cap ~1.6 in ECHOES_TAG_TYPE_BOOST)
        let importance = 0;
        for (const t of tags) {
          const b = ECHOES_TAG_TYPE_BOOST[t];
          if (b && b > importance) importance = b;
        }
        importance = Math.min(1, importance / 1.6);
        if (importance === 0) continue; // skip un-tagged noise
        const accCount = access[it.id || ''] || 0;
        const accNorm = maxAccess > 0 ? Math.min(1, accCount / Math.max(3, maxAccess)) : 0;
        // composite score, 0..1 range
        const score = importance * 0.5 + recency * 0.3 + accNorm * 0.2;
        hits.push({
          date: day.date, weekday: day.weekday, section: it._section,
          time: it.time || null, text, tags, id: it.id || null,
          score: +score.toFixed(3),
          breakdown: {
            importance: +importance.toFixed(3),
            recency: +recency.toFixed(3),
            access: +accNorm.toFixed(3),
            access_count: accCount,
          },
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  };

  const countEchoesHealth = (windowStart) => {
    if (!fs.existsSync(ECHOES_USAGE_FILE)) return { calls: 0, zeroResultCalls: 0, byFeature: {} };
    let calls = 0, zero = 0, totalReturned = 0;
    const byFeature = {};
    try {
      const lines = fs.readFileSync(ECHOES_USAGE_FILE, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (windowStart && row.ts && row.ts.slice(0, 10) < windowStart) continue;
        calls++;
        const n = Number(row.returned || 0);
        totalReturned += n;
        if (n === 0) zero++;
        const f = String(row.caller || 'unknown');
        byFeature[f] = (byFeature[f] || 0) + 1;
      }
    } catch (e) { console.warn('[echoes] health read:', e.message); }
    return {
      calls,
      zeroResultCalls: zero,
      avgReturned: calls ? +(totalReturned / calls).toFixed(2) : 0,
      byCaller: byFeature,
    };
  };

  const router = express.Router();

  router.get('/codex/echoes', requireAuth, (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 500);
    if (!q) return res.status(400).json({ error: 'q (query) required' });
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit, 10) || 5));
    const minScore = Math.max(0, parseFloat(req.query.min_score) || 0.5);
    const sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since) ? req.query.since : null;
    const caller = String(req.query.caller || 'unknown').slice(0, 64);
    const t0 = Date.now();
    let hits = [];
    try {
      hits = searchEchoes(q, { limit, minScore, sinceDate });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    const duration = Date.now() - t0;
    appendEchoesUsage({
      ts: new Date().toISOString(),
      caller,
      q_chars: q.length,
      q_tags: extractTagsFromText(q),
      returned: hits.length,
      top_score: hits[0] ? hits[0].score : 0,
      duration_ms: duration,
    });
    res.json({ query: q, count: hits.length, results: hits, duration_ms: duration });
  });

  // Auto-mode: no `q` required. Surfaces relevant journal entries scored by
  // importance (tag type) + recency + past access frequency. Designed to be
  // called by the SessionStart hook when BISA_INJECT_ECHOES=true so Claude
  // gets a curated context block at session start. Each call records the
  // surfaced IDs so access frequency self-balances over time.
  router.get('/codex/echoes/auto', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit, 10) || 5));
    const caller = String(req.query.caller || 'auto').slice(0, 64);
    const sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since) ? req.query.since : null;
    const halfLife = Math.max(7, Math.min(180, parseInt(req.query.half_life_days, 10) || 60));
    const t0 = Date.now();
    let hits = [];
    try {
      hits = searchEchoesAuto({ limit, sinceDate, halfLifeDays: halfLife });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    const duration = Date.now() - t0;
    appendEchoesUsage({
      ts: new Date().toISOString(),
      caller, mode: 'auto',
      q_chars: 0, q_tags: [],
      returned: hits.length,
      top_score: hits[0] ? hits[0].score : 0,
      surfaced_ids: hits.map((h) => h.id).filter(Boolean),
      duration_ms: duration,
    });
    // Adoption signal: count session-start calls in the last 24h, so the UI
    // can show whether the hook is actually firing rather than guessing at
    // the env flag (which lives in hook-env, not the server process env).
    const sinceMs = Date.now() - 24 * 3600 * 1000;
    let recentSessionStarts = 0;
    if (fs.existsSync(ECHOES_USAGE_FILE)) {
      try {
        const lines = fs.readFileSync(ECHOES_USAGE_FILE, 'utf8').split('\n').filter(Boolean);
        for (const ln of lines) {
          let rec; try { rec = JSON.parse(ln); } catch { continue; }
          if (rec.caller !== 'session-start') continue;
          if (Date.parse(rec.ts || '') < sinceMs) continue;
          recentSessionStarts++;
        }
      } catch { /* ignore */ }
    }
    res.json({
      mode: 'auto', limit, half_life_days: halfLife,
      count: hits.length, results: hits, duration_ms: duration,
      injection: { active_24h: recentSessionStarts },
    });
  });

  return { router, countEchoesHealth };
};
