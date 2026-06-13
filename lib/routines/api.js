// lib/routines/api.js
// Express router for the daily-routines (recurring habits) feature. Pure I/O
// over lib/routines/store.js. Mounted in server.js under /codex/routines/*.
//
// deps.logCompletion(text) is optional — when present, the toggle endpoint
// appends a journal log entry the moment a habit (with logOnComplete, or when
// a note is given) is completed for *today*. This is the codex integration.

const express = require('express');

module.exports = function makeRoutinesRouter(deps) {
  const { requireAuth, routinesStore, logCompletion } = deps;
  const {
    load, save, genId, validDate, todayISO,
    dueOn, valueOf, isSkipped, isCompleted, computeStreak, strength,
    weeklyProgress, heatmap, analyticsByWeekday, CATEGORIES, SCHEDULE_TYPES,
  } = routinesStore;

  const router = express.Router();

  const sanitizeSchedule = (sched) => {
    const s = sched && typeof sched === 'object' ? sched : {};
    const type = SCHEDULE_TYPES.includes(s.type) ? s.type : 'daily';
    if (type === 'specific_days') {
      const days = Array.isArray(s.days)
        ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : [];
      return { type, days: days.length ? days : [1, 2, 3, 4, 5] };
    }
    if (type === 'times_per_week') {
      return { type, target: Math.max(1, Math.min(7, parseInt(s.target, 10) || 3)) };
    }
    return { type: 'daily' };
  };

  // Apply kind/target/unit from a body onto a habit object (used by create+patch).
  // kind ∈ binary | numeric (value vs target) | text (free note, no target).
  const applyKind = (h, b) => {
    if (typeof b.kind === 'string') h.kind = ['numeric', 'text'].includes(b.kind) ? b.kind : 'binary';
    if (h.kind === 'numeric') {
      if (b.target !== undefined) h.target = Math.max(1, Math.min(100000, parseInt(b.target, 10) || 1));
      if (!h.target) h.target = 1;
      if (typeof b.unit === 'string') h.unit = b.unit.slice(0, 12);
    } else {
      delete h.target; delete h.unit;
    }
  };

  const publicHabit = (h, data, date) => ({
    id: h.id, name: h.name, icon: h.icon || '',
    category: h.category || 'other', time: h.time || '',
    schedule: h.schedule || { type: 'daily' },
    kind: h.kind || 'binary', target: h.target || null, unit: h.unit || '',
    polarity: h.polarity || 'do',
    logOnComplete: !!h.logOnComplete,
    done: isCompleted(h, data, date),
    skipped: isSkipped(data, date, h.id),
    value: valueOf(data, date, h.id),
    streak: computeStreak(h, data, todayISO()),
    strength: strength(h, data, todayISO()),
    weekly: weeklyProgress(h, data, todayISO()),
  });

  // GET /codex/routines/day?date=YYYY-MM-DD
  router.get('/codex/routines/day', requireAuth, (req, res) => {
    const date = validDate(req.query.date) ? req.query.date : todayISO();
    try {
      const data = load();
      const items = data.habits.filter((h) => dueOn(h, date)).map((h) => publicHabit(h, data, date));
      // a 'do' habit counts as done; an 'avoid' habit counts when still clean
      const done = items.filter((x) => x.done && !x.skipped).length;
      res.json({ date, items, done, total: items.length, mood: data.moods[date] || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /codex/routines/heatmap?days=30
  router.get('/codex/routines/heatmap', requireAuth, (req, res) => {
    const days = Math.max(7, Math.min(366, parseInt(req.query.days, 10) || 30));
    try { res.json(heatmap(load(), days, todayISO())); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /codex/routines/analytics?id=h-xxx&days=90 — consistency by weekday.
  router.get('/codex/routines/analytics', requireAuth, (req, res) => {
    const days = Math.max(14, Math.min(366, parseInt(req.query.days, 10) || 90));
    if (!req.query.id) return res.status(400).json({ error: 'id required' });
    try {
      const out = analyticsByWeekday(load(), req.query.id, days, todayISO());
      if (!out) return res.status(404).json({ error: 'habit not found' });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /codex/routines — create a habit.
  router.post('/codex/routines', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }
    try {
      const data = load();
      const habit = {
        id: genId(),
        name: b.name.trim().slice(0, 120),
        category: CATEGORIES.includes(b.category) ? b.category : 'other',
        icon: typeof b.icon === 'string' ? b.icon.slice(0, 4) : '',
        schedule: sanitizeSchedule(b.schedule),
        time: typeof b.time === 'string' && /^\d{2}:\d{2}$/.test(b.time) ? b.time : '',
        kind: 'binary',
        polarity: b.polarity === 'avoid' ? 'avoid' : 'do',
        logOnComplete: !!b.logOnComplete,
        createdAt: todayISO(),
        archivedAt: null,
      };
      if (habit.polarity !== 'avoid') applyKind(habit, b); // avoid habits are binary
      data.habits.push(habit);
      save(data);
      res.json({ ok: true, habit });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /codex/routines/:id — edit a habit.
  router.patch('/codex/routines/:id', requireAuth, (req, res) => {
    const b = req.body || {};
    try {
      const data = load();
      const h = data.habits.find((x) => x.id === req.params.id);
      if (!h) return res.status(404).json({ error: 'habit not found' });
      if (typeof b.name === 'string' && b.name.trim()) h.name = b.name.trim().slice(0, 120);
      if (CATEGORIES.includes(b.category)) h.category = b.category;
      if (typeof b.icon === 'string') h.icon = b.icon.slice(0, 4);
      if (b.schedule) h.schedule = sanitizeSchedule(b.schedule);
      if (typeof b.time === 'string' && (b.time === '' || /^\d{2}:\d{2}$/.test(b.time))) h.time = b.time;
      if (typeof b.logOnComplete === 'boolean') h.logOnComplete = b.logOnComplete;
      if (b.polarity === 'do' || b.polarity === 'avoid') h.polarity = b.polarity;
      if (h.polarity !== 'avoid' && (b.kind !== undefined || b.target !== undefined || b.unit !== undefined)) applyKind(h, b);
      save(data);
      res.json({ ok: true, habit: h });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /codex/routines/:id — soft-archive (preserve history). ?hard=1 purges.
  router.delete('/codex/routines/:id', requireAuth, (req, res) => {
    try {
      const data = load();
      const idx = data.habits.findIndex((x) => x.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'habit not found' });
      if (req.query.hard === '1') {
        const hid = req.params.id;
        data.habits.splice(idx, 1);
        for (const d of Object.keys(data.completions)) {
          data.completions[d] = data.completions[d].filter((id) => id !== hid);
          if (!data.completions[d].length) delete data.completions[d];
        }
        for (const d of Object.keys(data.values)) {
          delete data.values[d][hid];
          if (!Object.keys(data.values[d]).length) delete data.values[d];
        }
        for (const d of Object.keys(data.skips)) {
          data.skips[d] = data.skips[d].filter((x) => x !== hid);
          if (!data.skips[d].length) delete data.skips[d];
        }
      } else {
        data.habits[idx].archivedAt = todayISO();
      }
      save(data);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /codex/routines/toggle { id|name, date, done?, value?, note? }
  // Binary: set/flip completion. Numeric: set the day's `value` (or done→target).
  // `name` (unique active match) lets the CLI check off without an id. On the
  // transition to completed for *today*, appends a journal log entry when the
  // habit has logOnComplete set or a note was supplied.
  router.post('/codex/routines/toggle', requireAuth, (req, res) => {
    const { id, name, date, done, value, note } = req.body || {};
    const targetDate = validDate(date) ? date : todayISO();
    try {
      const data = load();
      let h = null;
      if (id) {
        h = data.habits.find((x) => x.id === id);
      } else if (name && typeof name === 'string') {
        const q = name.trim().toLowerCase();
        const matches = data.habits.filter((x) => !x.archivedAt && x.name.toLowerCase() === q);
        if (matches.length > 1) return res.status(409).json({ error: 'multiple habits match that name — use id' });
        h = matches[0] || null;
      } else {
        return res.status(400).json({ error: 'id or name required' });
      }
      if (!h) return res.status(404).json({ error: 'habit not found' });

      const before = isCompleted(h, data, targetDate);

      if (h.kind === 'numeric') {
        const dayVals = data.values[targetDate] = data.values[targetDate] || {};
        let v;
        if (typeof value === 'number' && isFinite(value)) v = Math.max(0, Math.round(value));
        else if (typeof done === 'boolean') v = done ? (h.target || 1) : 0;
        else v = before ? 0 : (h.target || 1); // bare toggle
        if (v > 0) dayVals[h.id] = v; else delete dayVals[h.id];
        if (!Object.keys(dayVals).length) delete data.values[targetDate];
      } else if (h.kind === 'text') {
        // free note for the day; no target. value sets it; done:false clears.
        const dayVals = data.values[targetDate] = data.values[targetDate] || {};
        if (typeof value === 'string') {
          const t = value.trim().slice(0, 500);
          if (t) dayVals[h.id] = t; else delete dayVals[h.id];
        } else if (done === false) {
          delete dayVals[h.id];
        } // done:true without a value is a no-op (can't "complete" text without text)
        if (!Object.keys(dayVals).length) delete data.values[targetDate];
      } else {
        // completions[date] holds: a completion (do habit) OR a slip (avoid habit).
        const list = data.completions[targetDate] = data.completions[targetDate] || [];
        const at = list.indexOf(h.id);
        const present = at >= 0;
        // `done` (and bare toggle) are always expressed as desired *success*.
        const wantSuccess = (typeof done === 'boolean') ? done : !before;
        // success ⇔ present (do) | absent (avoid)
        const wantPresent = (h.polarity === 'avoid') ? !wantSuccess : wantSuccess;
        if (wantPresent && !present) list.push(h.id);
        if (!wantPresent && present) list.splice(at, 1);
        if (!list.length) delete data.completions[targetDate];
      }

      save(data);
      const after = isCompleted(h, data, targetDate);

      if (h.polarity !== 'avoid' && !before && after && targetDate === todayISO()
          && (h.logOnComplete || (typeof note === 'string' && note.trim()))
          && typeof logCompletion === 'function') {
        const extra = (typeof note === 'string' && note.trim()) ? ': ' + note.trim().slice(0, 200) : '';
        const valStr = h.kind === 'numeric' ? ` (${valueOf(data, targetDate, h.id)}${h.unit ? ' ' + h.unit : ''})` : '';
        try { logCompletion(`✓ ${h.name}${valStr}${extra} #routine`); } catch (_) { /* best-effort */ }
      }

      res.json({
        ok: true, id: h.id, name: h.name, date: targetDate,
        done: after, value: valueOf(data, targetDate, h.id),
        streak: computeStreak(h, data, todayISO()),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /codex/routines/skip { id, date, skipped? } — excuse a habit for a day
  // (vacation / sick). id '*' skips all habits that day. Skipped days don't
  // break or count toward streaks. Omit `skipped` to toggle.
  router.post('/codex/routines/skip', requireAuth, (req, res) => {
    const { id, name, date, skipped } = req.body || {};
    const targetDate = validDate(date) ? date : todayISO();
    try {
      const data = load();
      let key = id;
      if (!key && name && typeof name === 'string') {
        const q = name.trim().toLowerCase();
        const matches = data.habits.filter((x) => !x.archivedAt && x.name.toLowerCase() === q);
        if (matches.length > 1) return res.status(409).json({ error: 'multiple habits match that name — use id' });
        key = matches[0] && matches[0].id;
      }
      if (!key) return res.status(400).json({ error: 'id or name required (id "*" skips all)' });
      if (key !== '*' && !data.habits.find((x) => x.id === key)) {
        return res.status(404).json({ error: 'habit not found' });
      }
      const list = data.skips[targetDate] = data.skips[targetDate] || [];
      const at = list.indexOf(key);
      const want = (typeof skipped === 'boolean') ? skipped : !(at >= 0);
      if (want && at < 0) list.push(key);
      if (!want && at >= 0) list.splice(at, 1);
      if (!list.length) delete data.skips[targetDate];
      save(data);
      res.json({ ok: true, id: key, date: targetDate, skipped: want });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /codex/routines/mood { date, mood } — set the day's mood (1–5); 0 or
  // null clears it. Used for habit↔mood correlation in analytics.
  router.post('/codex/routines/mood', requireAuth, (req, res) => {
    const { date, mood } = req.body || {};
    const targetDate = validDate(date) ? date : todayISO();
    try {
      const data = load();
      const m = parseInt(mood, 10);
      if (Number.isInteger(m) && m >= 1 && m <= 5) data.moods[targetDate] = m;
      else delete data.moods[targetDate];
      save(data);
      res.json({ ok: true, date: targetDate, mood: data.moods[targetDate] || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
