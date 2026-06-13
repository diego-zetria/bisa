// lib/planner/store.js
// Atomic read/write for .meta/planner.json.
// Schema mirrors docs/DESIGN.md §5.2.
// Atomic writes use tmp-file + rename to avoid corruption on crash.

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

/** Generate a planner task ID: "t-" + 8 hex chars. */
function genTaskId() {
  return 't-' + crypto.randomBytes(4).toString('hex');
}

/** Return today's date as YYYY-MM-DD (local time). */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Return ISO week string e.g. "2026-W24" for a given date string. */
function isoWeek(dateStr) {
  // Use the Thursday-in-the-week algorithm (ISO 8601)
  const d = new Date(dateStr + 'T12:00:00');
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // ISO: Mon=0 → Thu=3
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(
    ((thursday - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7
  );
  const year = thursday.getFullYear();
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/** Empty state factory. */
function emptyState() {
  return { days: {}, week: {}, tasks: {}, lastRollover: null };
}

/**
 * Load planner.json from disk. Returns empty state if file doesn't exist.
 * @param {string} cwd  Base data directory (CWD env, e.g. ~/bisa-data)
 */
function load(cwd) {
  const file = path.join(cwd, '.meta', 'planner.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    // Ensure top-level keys exist (forward-compat)
    if (!data.days)  data.days  = {};
    if (!data.week)  data.week  = {};
    if (!data.tasks) data.tasks = {};
    if (!('lastRollover' in data)) data.lastRollover = null;
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
}

/**
 * Atomically save state to planner.json.
 * Writes to a tmp file in the same directory then renames.
 * @param {string} cwd
 * @param {object} state
 */
function save(cwd, state) {
  const metaDir = path.join(cwd, '.meta');
  fs.mkdirSync(metaDir, { recursive: true });
  const file    = path.join(metaDir, 'planner.json');
  const tmpFile = path.join(metaDir, `planner.${process.pid}.tmp.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, file);
}

/**
 * Ensure a day record exists in state.days.
 * Does NOT save — caller must call save().
 */
function ensureDay(state, dateStr) {
  if (!state.days[dateStr]) {
    state.days[dateStr] = { blocks: { morning: [], afternoon: [] }, highlight: null, events: [] };
  }
  const day = state.days[dateStr];
  if (!day.blocks)           day.blocks = { morning: [], afternoon: [] };
  if (!day.blocks.morning)   day.blocks.morning = [];
  if (!day.blocks.afternoon) day.blocks.afternoon = [];
  if (!('highlight' in day)) day.highlight = null;
  if (!day.events)           day.events = [];
  return day;
}

/**
 * Ensure a week record exists in state.week.
 */
function ensureWeek(state, weekKey) {
  if (!state.week[weekKey]) {
    state.week[weekKey] = { goals: [] };
  }
  if (!state.week[weekKey].goals) state.week[weekKey].goals = [];
  return state.week[weekKey];
}

/**
 * Build the full Task object as returned by the API from a task record.
 * Task shape: { id, text, done, date|null, block|null, tags[], rolledFrom|null,
 *               highlight:bool, week:bool, created }
 *
 * Date resolution order:
 *   1. Block placement (task found in a day's morning/afternoon arrays)
 *   2. rec.date field on the task record (for unplanned tasks)
 *   3. null
 */
function hydrateTask(state, taskId) {
  const rec = state.tasks[taskId];
  if (!rec) return null;

  // Find which day this task belongs to via block placement
  let date  = null;
  let block = null;

  for (const [dateKey, dayData] of Object.entries(state.days)) {
    if ((dayData.blocks.morning || []).includes(taskId)) {
      date = dateKey; block = 'morning'; break;
    }
    if ((dayData.blocks.afternoon || []).includes(taskId)) {
      date = dateKey; block = 'afternoon'; break;
    }
  }

  // Fall back to the stored date field (unplanned tasks)
  if (!date && rec.date) date = rec.date;

  // Highlight: check if promoted as highlight for its day
  let highlight = false;
  if (date && state.days[date] && state.days[date].highlight === taskId) {
    highlight = true;
  }

  // Week goal: check week entries
  let week = false;
  for (const weekData of Object.values(state.week)) {
    if ((weekData.goals || []).includes(taskId)) { week = true; break; }
  }

  return {
    id:         taskId,
    text:       rec.text,
    done:       rec.done,
    date,
    block,
    tags:       rec.tags || [],
    rolledFrom: rec.rolledFrom || null,
    highlight,
    week,
    created:    rec.created,
  };
}

module.exports = { genTaskId, todayStr, isoWeek, load, save, ensureDay, ensureWeek, hydrateTask };
