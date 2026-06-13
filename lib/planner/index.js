// lib/planner/index.js
// Express router factory for the planner module (Fase 3).
// Implements: GET /planner/day, POST /planner/task, PATCH /planner/task/:id,
//             DELETE /planner/task/:id, POST /planner/promote, GET /planner/week
//
// Factory: makePlanner({ requireAuth, CWD, dispatchNotification, quickAddLlm })
//   → { router, bridgeNotifications, start }
//
// Storage: <CWD>/.meta/planner.json — atomic writes via tmp+rename.

'use strict';

const express = require('express');
const store   = require('./store');
const ics     = require('./ics');
const { parseQuickAdd } = require('./quickadd');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate a YYYY-MM-DD string. */
function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Collect all task IDs that appear in unplanned for a day.
 * "Unplanned" = task whose date is this day but is not in morning or afternoon.
 */
function getUnplanned(state, dateStr) {
  const day = state.days[dateStr];
  if (!day) return [];
  const placed = new Set([...(day.blocks.morning || []), ...(day.blocks.afternoon || [])]);
  // Find tasks whose date resolves to dateStr but are not placed
  return Object.keys(state.tasks).filter((id) => {
    const t = store.hydrateTask(state, id);
    if (!t) return false;
    return t.date === dateStr && !placed.has(id);
  });
}

/**
 * Run rollover: on the first GET /planner/day for today, any non-done task
 * with date < today moves to today (block=null → unplanned).
 * Sets rolledFrom=originalDate; idempotent per day (uses lastRollover marker).
 * Returns count of rolled tasks (0 if already done today).
 */
function runRollover(state, today) {
  if (state.lastRollover === today) return 0; // already rolled today

  let count = 0;
  const rolled = [];

  // Find all tasks with a date strictly before today that are not done
  for (const [taskId, rec] of Object.entries(state.tasks)) {
    if (rec.done) continue;
    const t = store.hydrateTask(state, taskId);
    if (!t || !t.date || t.date >= today) continue;

    const oldDate = t.date;
    const oldBlock = t.block;

    // Remove from old day's block
    if (oldBlock && state.days[oldDate]) {
      const blockArr = state.days[oldDate].blocks[oldBlock];
      const idx = blockArr.indexOf(taskId);
      if (idx >= 0) blockArr.splice(idx, 1);
      // If the task was the highlight, clear it
      if (state.days[oldDate].highlight === taskId) {
        state.days[oldDate].highlight = null;
      }
    }

    // Mark rollover origin (only set if not already rolled before)
    if (!rec.rolledFrom) rec.rolledFrom = oldDate;

    // Move to today — leave unplanned (not in morning or afternoon)
    // Store the date on the task record so hydrateTask can resolve it
    rec.date = today;
    store.ensureDay(state, today);

    rolled.push(taskId);
    count++;
  }

  state.lastRollover = today;
  return { count, rolled };
}

/**
 * Build the full API response for GET /planner/day.
 */
function buildDayResponse(state, dateStr, icsResult) {
  const day = state.days[dateStr] || { blocks: { morning: [], afternoon: [] }, highlight: null, events: [] };

  const hydrate = (ids) => ids.map((id) => store.hydrateTask(state, id)).filter(Boolean);

  const morning   = hydrate(day.blocks.morning || []);
  const afternoon = hydrate(day.blocks.afternoon || []);
  const unplanned = getUnplanned(state, dateStr).map((id) => store.hydrateTask(state, id)).filter(Boolean);

  // Week goals for the ISO week of this date
  const weekKey  = store.isoWeek(dateStr);
  const weekData = state.week[weekKey] || { goals: [] };
  const weekGoals = hydrate(weekData.goals || []);

  return {
    date:         dateStr,
    blocks:       { morning, afternoon },
    unplanned,
    weekGoals,
    highlight:    day.highlight || null,
    events:       icsResult.events,
    icsConnected: icsResult.icsConnected,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

module.exports = function makePlanner({ requireAuth, CWD, dispatchNotification, quickAddLlm }) {
  const router = express.Router();

  // ---- GET /planner/day?date=YYYY-MM-DD ------------------------------------
  router.get('/planner/day', requireAuth, async (req, res) => {
    try {
      const today   = store.todayStr();
      const dateStr = validDate(req.query.date) ? req.query.date : today;

      const state = store.load(CWD);

      // Rollover on the first request of today
      if (dateStr === today) {
        const { count, rolled } = runRollover(state, today);
        if (count > 0) {
          store.save(CWD, state);
          // One silent notification listing how many tasks rolled
          try {
            dispatchNotification({
              text:   `${count} tarefa${count > 1 ? 's' : ''} movida${count > 1 ? 's' : ''} para hoje (rollover)`,
              silent: true,
              tags:   ['planner', 'rollover'],
            });
          } catch (_) { /* notification failure must not break the route */ }
        }
      }

      store.ensureDay(state, dateStr);

      // Fetch ICS events (non-blocking; errors handled inside ics module)
      let icsResult;
      try {
        icsResult = await ics.getEventsForDate(dateStr);
      } catch (_) {
        icsResult = { icsConnected: false, events: [] };
      }

      res.json(buildDayResponse(state, dateStr, icsResult));
    } catch (e) {
      console.error('[planner] GET /planner/day error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- POST /planner/task --------------------------------------------------
  // Body: { text, date?, block? }
  // Supports NL pt-BR quick-add ("amanhã 15h dentista #saude")
  router.post('/planner/task', requireAuth, async (req, res) => {
    try {
      const { text, date: bodyDate, block: bodyBlock } = req.body || {};
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text é obrigatório' });
      }

      const today = store.todayStr();
      let parsed  = parseQuickAdd(text);

      // If the regex parser produced an ambiguous result (no date AND no time
      // recognised), try the LLM for a richer parse. LLM is optional and may
      // return null if unavailable.
      const isAmbiguous = parsed.date === null && parsed.tags.length === 0 && parsed.block === null;
      if (isAmbiguous && typeof quickAddLlm === 'function') {
        try {
          const llmResult = await quickAddLlm(text);
          if (llmResult && typeof llmResult === 'object') {
            // LLM result merges over regex result; regex text wins unless LLM gives a better one
            parsed = {
              date:  llmResult.date  || parsed.date,
              block: llmResult.block || parsed.block,
              text:  llmResult.text  || parsed.text,
              tags:  llmResult.tags  || parsed.tags,
            };
          }
        } catch (_) {
          // LLM unavailable — treat task as plain text for today, unplanned
        }
      }

      // Body overrides take precedence over parsed values (explicit caller wins)
      const finalDate  = validDate(bodyDate)  ? bodyDate
                       : (parsed.date || today);
      const finalBlock = bodyBlock === 'morning' || bodyBlock === 'afternoon' ? bodyBlock
                       : parsed.block;

      const id  = store.genTaskId();
      const now = new Date().toISOString();

      const state = store.load(CWD);

      state.tasks[id] = {
        text:       parsed.text,
        done:       false,
        date:       finalDate,
        created:    now,
        rolledFrom: null,
        tags:       parsed.tags,
      };

      // Place in correct block if a block was inferred/specified
      store.ensureDay(state, finalDate);
      if (finalBlock) {
        state.days[finalDate].blocks[finalBlock].push(id);
      }
      // If no block, the task is "unplanned" for that date — no block insertion needed

      store.save(CWD, state);

      const task = store.hydrateTask(state, id);
      res.status(201).json({ ok: true, task });
    } catch (e) {
      console.error('[planner] POST /planner/task error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- PATCH /planner/task/:id ---------------------------------------------
  // Body: { done?, text?, date?, block?, position? }
  router.patch('/planner/task/:id', requireAuth, (req, res) => {
    try {
      const { id } = req.params;
      const { done, text, date: newDate, block: newBlock, position } = req.body || {};

      const state = store.load(CWD);
      const rec   = state.tasks[id];
      if (!rec) return res.status(404).json({ error: 'Tarefa não encontrada' });

      // Update scalar fields
      if (typeof done === 'boolean') rec.done = done;
      if (typeof text === 'string' && text.trim()) rec.text = text.trim();

      // Resolve current placement
      let currentDate  = null;
      let currentBlock = null;
      for (const [dk, dd] of Object.entries(state.days)) {
        if ((dd.blocks.morning || []).includes(id))   { currentDate = dk; currentBlock = 'morning';   break; }
        if ((dd.blocks.afternoon || []).includes(id)) { currentDate = dk; currentBlock = 'afternoon'; break; }
      }

      const targetDate  = validDate(newDate)  ? newDate  : currentDate;
      const targetBlock = (newBlock === 'morning' || newBlock === 'afternoon') ? newBlock
                        : (newBlock === null ? null : currentBlock);

      const dateChanged  = targetDate  !== currentDate;
      const blockChanged = targetBlock !== currentBlock;

      if (dateChanged || blockChanged) {
        // Remove from old position
        if (currentDate && currentBlock && state.days[currentDate]) {
          const arr = state.days[currentDate].blocks[currentBlock];
          const idx = arr.indexOf(id);
          if (idx >= 0) arr.splice(idx, 1);
          // Clear highlight if it was this task
          if (state.days[currentDate].highlight === id) state.days[currentDate].highlight = null;
        }

        // Update stored date on task record
        if (targetDate) rec.date = targetDate;

        // Insert at new position
        if (targetDate) {
          store.ensureDay(state, targetDate);
          if (targetBlock) {
            const arr = state.days[targetDate].blocks[targetBlock];
            if (typeof position === 'number' && position >= 0 && position <= arr.length) {
              arr.splice(position, 0, id);
            } else {
              arr.push(id);
            }
          }
        }
      } else if (typeof position === 'number' && currentDate && currentBlock) {
        // Reorder within the same block
        const arr  = state.days[currentDate].blocks[currentBlock];
        const from = arr.indexOf(id);
        if (from >= 0 && position >= 0 && position < arr.length) {
          arr.splice(from, 1);
          arr.splice(position, 0, id);
        }
      }

      store.save(CWD, state);
      const task = store.hydrateTask(state, id);
      if (!task.date && targetDate) task.date = targetDate;
      res.json({ ok: true, task });
    } catch (e) {
      console.error('[planner] PATCH /planner/task/:id error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- DELETE /planner/task/:id --------------------------------------------
  router.delete('/planner/task/:id', requireAuth, (req, res) => {
    try {
      const { id } = req.params;
      const state = store.load(CWD);
      if (!state.tasks[id]) return res.status(404).json({ error: 'Tarefa não encontrada' });

      // Remove from all block arrays
      for (const dayData of Object.values(state.days)) {
        dayData.blocks.morning   = (dayData.blocks.morning   || []).filter((x) => x !== id);
        dayData.blocks.afternoon = (dayData.blocks.afternoon || []).filter((x) => x !== id);
        if (dayData.highlight === id) dayData.highlight = null;
      }
      // Remove from week goals
      for (const weekData of Object.values(state.week)) {
        weekData.goals = (weekData.goals || []).filter((x) => x !== id);
      }
      // Delete task record
      delete state.tasks[id];

      store.save(CWD, state);
      res.json({ ok: true });
    } catch (e) {
      console.error('[planner] DELETE /planner/task/:id error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- POST /planner/promote -----------------------------------------------
  // Body: { id, scope: 'highlight'|'week', on: bool }
  router.post('/planner/promote', requireAuth, (req, res) => {
    try {
      const { id, scope, on } = req.body || {};
      if (!id || !['highlight', 'week'].includes(scope) || typeof on !== 'boolean') {
        return res.status(400).json({ error: 'id, scope (highlight|week), on (bool) são obrigatórios' });
      }

      const state = store.load(CWD);
      if (!state.tasks[id]) return res.status(404).json({ error: 'Tarefa não encontrada' });

      if (scope === 'highlight') {
        // Find which day this task lives in
        let taskDate = null;
        for (const [dk, dd] of Object.entries(state.days)) {
          if ((dd.blocks.morning || []).includes(id) ||
              (dd.blocks.afternoon || []).includes(id)) {
            taskDate = dk; break;
          }
        }
        // Highlight can also apply to unplanned tasks for a given day.
        // Default to today if task has no day placement yet.
        if (!taskDate) {
          // Try to find via week goals date
          taskDate = store.todayStr();
        }

        store.ensureDay(state, taskDate);

        if (on) {
          // Demote any existing highlight for this day
          state.days[taskDate].highlight = id;
        } else {
          if (state.days[taskDate].highlight === id) state.days[taskDate].highlight = null;
        }
      } else if (scope === 'week') {
        // Determine week from task's date; default to current week
        const t = store.hydrateTask(state, id);
        const taskDate = t && t.date ? t.date : store.todayStr();
        const weekKey  = store.isoWeek(taskDate);
        store.ensureWeek(state, weekKey);

        if (on) {
          if (!state.week[weekKey].goals.includes(id)) state.week[weekKey].goals.push(id);
          state.tasks[id].week = true;
        } else {
          state.week[weekKey].goals = state.week[weekKey].goals.filter((x) => x !== id);
          delete state.tasks[id].week;
        }
      }

      store.save(CWD, state);
      const task = store.hydrateTask(state, id);
      res.json({ ok: true, task });
    } catch (e) {
      console.error('[planner] POST /planner/promote error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- GET /planner/week?start=YYYY-MM-DD ----------------------------------
  // Returns 7 days from start (default: Monday of current week):
  // per day { date, counts:{planned,done}, highlight, events:firstTitleOnly }
  // + weekGoals array
  router.get('/planner/week', requireAuth, async (req, res) => {
    try {
      const today = store.todayStr();

      // Default start: Monday of current week
      let start;
      if (validDate(req.query.start)) {
        start = req.query.start;
      } else {
        // Find Monday of current week
        const d = new Date();
        const dow = (d.getDay() + 6) % 7; // Mon=0
        d.setDate(d.getDate() - dow);
        start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      const state = store.load(CWD);

      // Build 7-day array
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start + 'T12:00:00');
        d.setDate(d.getDate() + i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayData = state.days[dateStr] || { blocks: { morning: [], afternoon: [] }, highlight: null, events: [] };

        const allIds  = [...(dayData.blocks.morning || []), ...(dayData.blocks.afternoon || [])];
        // Unplanned for this day
        const unplannedIds = Object.keys(state.tasks).filter((id) => {
          const t = store.hydrateTask(state, id);
          return t && t.date === dateStr && !allIds.includes(id);
        });
        const totalIds = [...allIds, ...unplannedIds];

        let planned = 0;
        let done    = 0;
        for (const id of totalIds) {
          const rec = state.tasks[id];
          if (!rec) continue;
          planned++;
          if (rec.done) done++;
        }

        // First ICS event title only (from cached events)
        const firstEvent = (dayData.events || [])[0] || null;

        days.push({
          date:      dateStr,
          counts:    { planned, done },
          highlight: dayData.highlight || null,
          events:    firstEvent ? firstEvent.title : null,
        });
      }

      // Week goals for the week containing start
      const weekKey  = store.isoWeek(start);
      const weekData = state.week[weekKey] || { goals: [] };
      const weekGoals = (weekData.goals || []).map((id) => store.hydrateTask(state, id)).filter(Boolean);

      res.json({ start, days, weekGoals });
    } catch (e) {
      console.error('[planner] GET /planner/week error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  return {
    router,
    bridgeNotifications: () => {},
    start: () => {},
  };
};
