// lib/codex/loop.js
// Extracted from server.js R5b (2026-05-24). Codex auto-loop scheduler:
// state file + schema config, per-minute tick, briefing / reflection /
// weekly job runner, late-catchup checker, plus the small helpers used by
// /codex/ask and efficacy modules that still live in server.js.
//
// Deps injected:
//   - CODEX_DIR (from codexStore)
//   - codex helpers: todayCodex, weekdayFor, loadJournal, findOrCreateDay,
//     saveJournal, autoCloseStaleWorkdaySessions
//   - runClaudeHeadless (from lib/codex/headless)
//   - dispatchNotification (still in server.js)
//   - runCorrectionsJob (server.js — corrections detector ties to project
//     mgmt which hasn't been extracted yet; passed as ref so tickLoop can
//     fire it on schedule)
//   - loadCopilotConfig, buildCopilotBalanceContext (getter wrappers — see
//     R7 copilot; reflection enrichment is best-effort and wrapped in try/
//     catch so missing/late-init deps degrade gracefully)
//
// Exports the small helpers (extractPrompt, sectionAsText, sanitizeAutoOutput,
// sliceJournalByDays, daysBetweenISO, etc.) so /codex/ask and efficacy
// modules in server.js can share them without duplication.
//
// Side effect: setInterval(tickLoop, 60_000) starts on factory call.

const fs = require('fs');
const path = require('path');

module.exports = function makeLoop(deps) {
  const {
    CODEX_DIR,
    todayCodex, weekdayFor,
    loadJournal, findOrCreateDay, saveJournal, autoCloseStaleWorkdaySessions,
    runClaudeHeadless,
    dispatchNotification,
    runCorrectionsJob,
    loadCopilotConfig, buildCopilotBalanceContext,
    buildRoutinesContext,
  } = deps;

  const LOOP_STATE_FILE  = path.join(CODEX_DIR, '.meta', 'loop-state.json');
  const LOOP_ERRORS_LOG  = path.join(CODEX_DIR, '.meta', 'loop-errors.log');
  const LOOP_SCHEMA_FILE = path.join(CODEX_DIR, '.meta', 'schema.json');
  const LOOP_PROMPTS_DIR = path.join(CODEX_DIR, '.meta', 'prompts');

  const readLoopSchema = () => {
    try {
      const raw = JSON.parse(fs.readFileSync(LOOP_SCHEMA_FILE, 'utf8'));
      return raw.loop || {};
    } catch { return {}; }
  };

  const loopConfig = () => {
    const s = readLoopSchema();
    const VALID_WDAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    return {
      enabled: s.enabled !== false,
      briefingAt: /^\d{2}:\d{2}$/.test(s.briefingAt || '') ? s.briefingAt : '07:00',
      reflectionAt: /^\d{2}:\d{2}$/.test(s.reflectionAt || '') ? s.reflectionAt : '21:00',
      lateBriefingUntil: /^\d{2}:\d{2}$/.test(s.lateBriefingUntil || '') ? s.lateBriefingUntil : '12:00',
      weeklyAt: /^\d{2}:\d{2}$/.test(s.weeklyAt || '') ? s.weeklyAt : '20:00',
      weeklyDay: VALID_WDAYS.has(s.weeklyDay) ? s.weeklyDay : 'sun',
      weeklyLookbackDays: Number.isInteger(s.weeklyLookbackDays) && s.weeklyLookbackDays > 0 ? s.weeklyLookbackDays : 7,
      weeklyMinActiveDays: Number.isInteger(s.weeklyMinActiveDays) && s.weeklyMinActiveDays >= 0 ? s.weeklyMinActiveDays : 3,
      // Corrections loop (R4 of prd-discover-learn-teach). Pure JS formatter,
      // NO `claude -p` call — see § 3 of the PRD.
      correctionsEnabled: s.correctionsEnabled !== false,
      correctionsAt: /^\d{2}:\d{2}$/.test(s.correctionsAt || '') ? s.correctionsAt : '21:00',
      correctionsDay: VALID_WDAYS.has(s.correctionsDay) ? s.correctionsDay : 'sun',
      correctionsLookbackDays: Number.isInteger(s.correctionsLookbackDays) && s.correctionsLookbackDays > 0 ? s.correctionsLookbackDays : 7,
      correctionsMinRules: Number.isInteger(s.correctionsMinRules) && s.correctionsMinRules > 0 ? s.correctionsMinRules : 3,
    };
  };

  const readLoopState = () => {
    try { return JSON.parse(fs.readFileSync(LOOP_STATE_FILE, 'utf8')); }
    catch {
      return {
        briefing:   { lastDate: null, lastRunAt: null },
        reflection: { lastDate: null, lastRunAt: null },
        weekly:     { lastDate: null, lastRunAt: null },
      };
    }
  };

  const writeLoopState = (state) => {
    try { fs.writeFileSync(LOOP_STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8'); }
    catch (e) { console.warn('[codex-loop] failed to persist state:', e.message); }
  };

  const logLoopError = (kind, msg) => {
    const line = `[${new Date().toISOString()}] ${kind}: ${msg.replace(/\n/g, ' ')}\n`;
    try { fs.appendFileSync(LOOP_ERRORS_LOG, line, 'utf8'); }
    catch (e) { console.warn('[codex-loop]', line.trim()); }
  };

  const extractPrompt = (name) => {
    const p = path.join(LOOP_PROMPTS_DIR, name + '.md');
    return fs.readFileSync(p, 'utf8');
  };

  const sectionAsText = (day, kind) => {
    if (!day) return '(no section)';
    const s = day.sections;
    const parts = [`# ${day.date} (${day.weekday})`, ''];
    if (s.briefing)   parts.push('## briefing', s.briefing, '');
    if (s.goals.length) {
      parts.push('## goals');
      for (const g of s.goals) parts.push(`- [${g.done ? 'x' : ' '}] ${g.text}`);
      parts.push('');
    }
    if (s.agenda.length) {
      parts.push('## agenda');
      for (const a of s.agenda) parts.push(`- ${a.time ? a.time + ' ' : ''}${a.text}`);
      parts.push('');
    }
    if (s.log.length) {
      parts.push('## log');
      for (const l of s.log) parts.push(`> ${l.time ? l.time + ' — ' : ''}${l.text}`);
      parts.push('');
    }
    if (s.notes) { parts.push('## notes', s.notes, ''); }
    if (s.reflection) { parts.push('## reflection', s.reflection, ''); }
    if (s.weekly) { parts.push('## weekly', s.weekly, ''); }
    return parts.join('\n').trim();
  };

  const sanitizeAutoOutput = (raw, kind) => {
    let text = (raw || '').trim();
    // strip leading code fence
    text = text.replace(/^```(?:markdown)?\s*\n/, '').replace(/\n```\s*$/, '');
    // strip a leading `## briefing` or `## reflection` heading the model may include despite instruction
    const re = new RegExp(`^##\\s+${kind}\\b[^\\n]*\\n+`, 'i');
    text = text.replace(re, '');
    return text.trim();
  };

  const yesterdayISO = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  };

  const daysBetweenISO = (fromISO, toISO) => {
    const [fy, fm, fd] = fromISO.split('-').map(Number);
    const [ty, tm, td] = toISO.split('-').map(Number);
    return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000);
  };

  const isDayActive = (day) => {
    if (!day) return false;
    const s = day.sections;
    return (s.goals.length > 0) || (s.log.length > 0) || ((s.notes || '').trim().length > 0);
  };

  const sliceJournalByDays = (days, daysBack) => {
    const today = todayCodex().date;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(0, daysBack - 1));
    const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
    return days
      .filter((d) => d.date >= cutoffISO && d.date <= today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  };

  const runLoopJob = async (kind, { force = false } = {}) => {
    if (!['briefing', 'reflection', 'weekly'].includes(kind)) throw new Error('invalid kind');
    const cfg = loopConfig();
    if (!cfg.enabled && !force) throw new Error('codex loop disabled in schema.json');

    const state = readLoopState();
    const today = todayCodex().date;

    if (!force) {
      if (kind === 'weekly') {
        const last = state.weekly && state.weekly.lastDate;
        if (last) {
          const gap = daysBetweenISO(last, today);
          if (gap < 6) return { skipped: true, reason: `last weekly ran ${gap}d ago (threshold 7)` };
        }
      } else if (state[kind] && state[kind].lastDate === today) {
        return { skipped: true, reason: 'already ran today' };
      }
    }

    const days = loadJournal();
    const today_day = findOrCreateDay(days, today);

    // If the section already exists and we're not forcing, skip
    if (!force && today_day.sections[kind]) {
      return { skipped: true, reason: 'section already populated' };
    }

    let contextSection;
    let contextLabel;
    if (kind === 'briefing') {
      const yday = days.find((d) => d.date === yesterdayISO(today));
      contextSection = sectionAsText(yday, 'yesterday');
      // Surface today's recurring routines so the morning briefing can remind
      // the user of them (medication, gym, …). Best-effort; never blocks.
      try {
        if (typeof buildRoutinesContext === 'function') {
          const extra = buildRoutinesContext(today);
          if (extra) contextSection = contextSection + '\n\n' + extra;
        }
      } catch (e) { /* routines context is optional */ }
      contextLabel = 'yesterday';
    } else if (kind === 'reflection') {
      contextSection = sectionAsText(today_day, 'today');
      // Phase 3 — copilot coach: append "## copilot balance for today" if enabled.
      try {
        const cplCfg = loadCopilotConfig();
        if (cplCfg.enabled) {
          const extra = buildCopilotBalanceContext(today);
          if (extra) contextSection = contextSection + '\n\n' + extra;
        }
      } catch (e) { /* coach is best-effort, never block reflection */ }
      contextLabel = 'today';
    } else {
      const lookback = cfg.weeklyLookbackDays || 7;
      const windowDays = sliceJournalByDays(days, lookback);
      const minActive = cfg.weeklyMinActiveDays || 3;
      const activeCount = windowDays.filter(isDayActive).length;
      if (activeCount < minActive && !force) {
        return { skipped: true, reason: `only ${activeCount} active days in ${lookback}d window (need ${minActive})` };
      }
      contextSection = windowDays.map((d) => sectionAsText(d, 'weekly-day')).join('\n\n---\n\n');
      contextLabel = `last ${windowDays.length} days (${windowDays[0]?.date} → ${windowDays.at(-1)?.date})`;
    }

    const template = extractPrompt(kind);
    const fullPrompt = [
      template,
      '',
      '---',
      '',
      `# Context (${contextLabel})`,
      '',
      contextSection,
    ].join('\n');

    console.log(`[codex-loop] running ${kind} for ${today}`);
    let output;
    try {
      output = await runClaudeHeadless(fullPrompt, CODEX_DIR, undefined, { feature: kind });
    } catch (e) {
      logLoopError(kind, e.message);
      throw e;
    }

    const body = sanitizeAutoOutput(output, kind);
    if (!body) {
      logLoopError(kind, 'empty output');
      throw new Error('empty output from claude -p');
    }

    // Reload + mutate (something else may have touched journal during the spawn)
    const fresh = loadJournal();
    const freshToday = findOrCreateDay(fresh, today);
    freshToday.sections[kind] = body;
    saveJournal(fresh);

    state[kind] = { lastDate: today, lastRunAt: new Date().toISOString() };
    writeLoopState(state);

    dispatchNotification({
      code: 9,
      text: `codex ${kind} generated for ${today}`,
      log: false,
      tags: ['codex', kind],
      silent: false,
      source: 'codex-loop',
    });

    return { ok: true, kind, date: today, bytes: body.length };
  };

  const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  const tickLoop = async () => {
    const today = todayCodex().date;
    const state = readLoopState();

    // Day rollover: close any stale open workday sessions from previous days.
    // Runs regardless of loop.enabled so workday tracking self-heals independently
    // of briefing/reflection. Idempotent; saveJournal only fires when something
    // actually changed.
    if (state.lastAutoCloseDate !== today) {
      try { autoCloseStaleWorkdaySessions(); } catch (e) { console.warn('[codex] auto-close failed:', e.message); }
      state.lastAutoCloseDate = today;
      writeLoopState(state);
    }

    const cfg = loopConfig();
    if (!cfg.enabled) return;
    const now = hhmm();
    const todayWday = weekdayFor(today);

    // Briefing: on-time OR within the late-catch window (07:00..lateBriefingUntil).
    // This used to require a server restart to catch up after sleep/wake; now the
    // per-minute tick handles it so briefings survive laptop-sleep overnight.
    if (state.briefing?.lastDate !== today &&
        now >= cfg.briefingAt && now < cfg.lateBriefingUntil) {
      try { await runLoopJob('briefing'); } catch (e) { /* already logged */ }
    }
    // Reflection: on-time OR any time later the same day (no cutoff defined).
    if (state.reflection?.lastDate !== today && now >= cfg.reflectionAt) {
      try { await runLoopJob('reflection'); } catch (e) { /* already logged */ }
    }
    // Weekly: scheduled day at/after weeklyAt with 6+ day gap, OR any day with 7+ day gap.
    if (cfg.weeklyAt) {
      const last = state.weekly?.lastDate;
      const gap = last ? daysBetweenISO(last, today) : 999;
      const onSchedule = todayWday === (cfg.weeklyDay || 'sun') && now >= cfg.weeklyAt && gap >= 6;
      const late = gap >= 7;
      if (onSchedule || late) {
        try { await runLoopJob('weekly'); } catch (e) { /* already logged */ }
      }
    }
    // Corrections: same schedule shape as weekly but with its own day/time +
    // pure-JS formatter (no claude -p). See prd-discover-learn-teach § 2B.
    if (cfg.correctionsEnabled && cfg.correctionsAt) {
      const last = state.corrections?.lastDate;
      const gap = last ? daysBetweenISO(last, today) : 999;
      const onSchedule = todayWday === (cfg.correctionsDay || 'sun') && now >= cfg.correctionsAt && gap >= 6;
      const late = gap >= 7;
      if (onSchedule || late) {
        try { await runCorrectionsJob(); } catch (e) {
          logLoopError('corrections', e.message || String(e));
        }
      }
    }
  };

  const checkMissedRuns = async () => {
    const cfg = loopConfig();
    if (!cfg.enabled) return;
    const now = hhmm();
    const state = readLoopState();
    const today = todayCodex().date;

    if (now > cfg.briefingAt && now < cfg.lateBriefingUntil && state.briefing?.lastDate !== today) {
      console.log(`[codex-loop] running late briefing (now=${now}, due=${cfg.briefingAt}, cutoff=${cfg.lateBriefingUntil})`);
      try { await runLoopJob('briefing'); } catch (e) { /* already logged */ }
    }
    if (now > cfg.reflectionAt && state.reflection?.lastDate !== today) {
      console.log(`[codex-loop] running late reflection (now=${now}, due=${cfg.reflectionAt})`);
      try { await runLoopJob('reflection'); } catch (e) { /* already logged */ }
    }
    // Weekly late-catchup: run if gap since last weekly >= 7 days, regardless of today's weekday.
    // This handles server-off-on-Sunday: Monday boot catches it.
    if (cfg.weeklyAt) {
      const last = state.weekly?.lastDate;
      const gap = last ? daysBetweenISO(last, today) : 999;
      if (gap >= 7) {
        console.log(`[codex-loop] running late weekly (${gap}d since last run; never-run if 999)`);
        try { await runLoopJob('weekly'); } catch (e) { /* already logged */ }
      }
    }
    // Corrections late-catchup: same shape as weekly.
    if (cfg.correctionsEnabled && cfg.correctionsAt) {
      const last = state.corrections?.lastDate;
      const gap = last ? daysBetweenISO(last, today) : 999;
      if (gap >= 7) {
        console.log(`[codex-loop] running late corrections (${gap}d since last run; never-run if 999)`);
        try { await runCorrectionsJob(); } catch (e) {
          logLoopError('corrections', e.message || String(e));
        }
      }
    }
  };

  // tick every minute
  setInterval(() => { tickLoop().catch(() => {}); }, 60 * 1000);

  return {
    LOOP_PROMPTS_DIR,
    loopConfig, readLoopState, writeLoopState, logLoopError,
    extractPrompt, sectionAsText, sanitizeAutoOutput,
    yesterdayISO, daysBetweenISO, isDayActive, sliceJournalByDays,
    runLoopJob, hhmm, tickLoop, checkMissedRuns,
  };
};
