// lib/codex/api.js
// Extracted from server.js R4 (2026-05-24). Express router factory for
// codex journal CRUD + workday endpoints. Pure I/O layer over
// lib/codex/store.js. Loop/ask/echoes endpoints are R5; hooks/audit
// endpoints are R6; copilot/english/gain are R7.

const express = require('express');
const fs = require('fs');

module.exports = function makeCodexApiRouter(deps) {
  const { requireAuth, codexStore } = deps;
  const {
    JOURNAL_FILE, SECTIONS_STRUCT,
    todayCodex, nowHMCodex, validDate, genId,
    ensureJournalExists, loadJournal, saveJournal,
    hmToMinutes, formatDuration,
    findOrCreateDay, findItemAcrossDays,
    summarizeWorkday,
  } = codexStore;

  const router = express.Router();

  router.get('/codex/today', requireAuth, (req, res) => {
    try {
      const { date } = todayCodex();
      const days = loadJournal();
      const day = findOrCreateDay(days, date);
      // refresh TODAY marker on load
      for (const d of days) d.marker = (d.date === date ? 'TODAY' : '');
      saveJournal(days);
      res.json({ date, day, dates: days.map((d) => d.date) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/codex/day', requireAuth, (req, res) => {
    if (!validDate(req.query.date)) return res.status(400).json({ error: 'invalid date' });
    try {
      const days = loadJournal();
      const day = days.find((d) => d.date === req.query.date);
      res.json({ date: req.query.date, day: day || null, dates: days.map((d) => d.date) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/codex/raw', requireAuth, (req, res) => {
    try {
      ensureJournalExists();
      res.type('text/markdown').send(fs.readFileSync(JOURNAL_FILE, 'utf8'));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/codex/append', requireAuth, (req, res) => {
    const { section, item = {}, date } = req.body || {};
    if (!SECTIONS_STRUCT.includes(section)) {
      return res.status(400).json({ error: 'section must be goals|agenda|log' });
    }
    if (!item.text || typeof item.text !== 'string' || !item.text.trim()) {
      return res.status(400).json({ error: 'item.text required' });
    }
    const targetDate = validDate(date) ? date : todayCodex().date;
    try {
      const days = loadJournal();
      const day = findOrCreateDay(days, targetDate);
      const newItem = { id: genId(section[0]), text: item.text.trim().slice(0, 500) };
      if (section === 'goals')  newItem.done = !!item.done;
      if (section === 'agenda') newItem.time = (item.time || '').slice(0, 5);
      if (section === 'log')    newItem.time = item.time && /^\d{2}:\d{2}$/.test(item.time) ? item.time : nowHMCodex();
      day.sections[section].push(newItem);
      saveJournal(days);
      res.json({ ok: true, item: newItem, date: targetDate });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/codex/notes', requireAuth, (req, res) => {
    const { text, date } = req.body || {};
    if (typeof text !== 'string') return res.status(400).json({ error: 'text required' });
    const targetDate = validDate(date) ? date : todayCodex().date;
    try {
      const days = loadJournal();
      const day = findOrCreateDay(days, targetDate);
      day.sections.notes = text.slice(0, 20000);
      saveJournal(days);
      res.json({ ok: true, date: targetDate });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/codex/toggle', requireAuth, (req, res) => {
    const { id, date } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const days = loadJournal();
      const hit = findItemAcrossDays(days, id, validDate(date) ? date : null);
      if (!hit) return res.status(404).json({ error: 'item not found' });
      if (!('done' in hit.item)) return res.status(400).json({ error: 'item is not toggleable' });
      hit.item.done = !hit.item.done;
      saveJournal(days);
      res.json({ ok: true, item: hit.item, date: hit.day.date });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/codex/update', requireAuth, (req, res) => {
    const { id, text, time, date } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const days = loadJournal();
      const hit = findItemAcrossDays(days, id, validDate(date) ? date : null);
      if (!hit) return res.status(404).json({ error: 'item not found' });
      if (typeof text === 'string') hit.item.text = text.trim().slice(0, 500);
      if (typeof time === 'string' && (time === '' || /^\d{2}:\d{2}$/.test(time))) hit.item.time = time;
      saveJournal(days);
      res.json({ ok: true, item: hit.item, date: hit.day.date });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/codex/item', requireAuth, (req, res) => {
    const { id, date } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const days = loadJournal();
      const hit = findItemAcrossDays(days, id, validDate(date) ? date : null);
      if (!hit) return res.status(404).json({ error: 'item not found' });
      hit.day.sections[hit.section].splice(hit.idx, 1);
      saveJournal(days);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- workday endpoints --------------------------------------------------

  router.get('/codex/workday/today', requireAuth, (req, res) => {
    try {
      const { date } = todayCodex();
      const days = loadJournal();
      const day = findOrCreateDay(days, date);
      res.json({ date, ...summarizeWorkday(day.sections.workday, nowHMCodex()) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/codex/workday/start', requireAuth, (req, res) => {
    try {
      const { date } = todayCodex();
      const days = loadJournal();
      const day = findOrCreateDay(days, date);
      const sessions = day.sections.workday = day.sections.workday || [];
      const open = sessions.find((s) => !s.end);
      if (open) return res.status(409).json({ error: 'day already started', open });
      const session = { id: genId('w'), start: nowHMCodex(), end: null };
      sessions.push(session);
      saveJournal(days);
      res.json({ ok: true, date, ...summarizeWorkday(sessions, nowHMCodex()) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/codex/workday/end', requireAuth, (req, res) => {
    try {
      const today = todayCodex().date;
      const date = validDate(req.query.date) ? req.query.date : today;
      const days = loadJournal();
      const day = date === today ? findOrCreateDay(days, date) : days.find((d) => d.date === date);
      if (!day) return res.status(404).json({ error: 'day not found' });
      const sessions = day.sections.workday = day.sections.workday || [];
      const open = sessions.find((s) => !s.end);
      if (!open) return res.status(404).json({ error: 'no open session' });

      // end precedence: explicit ?end=HH:MM → today's wall clock → last log time → start
      let end = null;
      const explicit = req.query.end;
      if (typeof explicit === 'string' && /^\d{2}:\d{2}$/.test(explicit)) end = explicit;
      else if (date === today) end = nowHMCodex();
      else {
        const logTimes = (day.sections.log || []).map((l) => l.time).filter(Boolean).sort();
        end = logTimes[logTimes.length - 1] || open.start;
      }
      // guard against clocks reading backwards; never accept end < start
      if (hmToMinutes(end) < hmToMinutes(open.start)) open.end = open.start;
      else open.end = end;
      saveJournal(days);
      res.json({ ok: true, date, ...summarizeWorkday(sessions, date === today ? nowHMCodex() : null) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/codex/workday/session', requireAuth, (req, res) => {
    const id = req.query.id;
    const date = validDate(req.query.date) ? req.query.date : todayCodex().date;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const days = loadJournal();
      const day = days.find((d) => d.date === date);
      if (!day) return res.status(404).json({ error: 'day not found' });
      const sessions = day.sections.workday || [];
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx < 0) return res.status(404).json({ error: 'session not found' });
      sessions.splice(idx, 1);
      saveJournal(days);
      res.json({ ok: true, date, ...summarizeWorkday(sessions, nowHMCodex()) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/codex/workday/history', requireAuth, (req, res) => {
    const n = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 14));
    try {
      const days = loadJournal();
      const today = todayCodex().date;
      const now = nowHMCodex();
      const out = days.slice(0, n).map((d) => {
        const summary = summarizeWorkday(d.sections.workday, d.date === today ? now : null);
        return {
          date: d.date,
          weekday: d.weekday,
          sessions: summary.sessions,
          totalMinutes: summary.totalMinutes,
          totalLabel: summary.totalLabel,
          open: !!summary.open,
        };
      });
      // week totals: ISO-ish week = last 7 calendar days ending today
      const last7 = out.filter((x) => {
        const diff = (new Date(today) - new Date(x.date)) / 86400000;
        return diff >= 0 && diff < 7;
      });
      const weekMinutes = last7.reduce((s, x) => s + x.totalMinutes, 0);
      const tracked = out.filter((x) => x.totalMinutes > 0);
      const avgMinutes = tracked.length ? Math.round(tracked.reduce((s, x) => s + x.totalMinutes, 0) / tracked.length) : 0;
      res.json({
        days: out,
        weekMinutes,
        weekLabel: formatDuration(weekMinutes),
        avgMinutes,
        avgLabel: formatDuration(avgMinutes),
        trackedDays: tracked.length,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
