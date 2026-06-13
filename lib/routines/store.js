// lib/routines/store.js
// Storage + analytics for the daily-routines (recurring habits) feature
// (medication, gym, reading, …). Habits are recurring *definitions*; per-day
// completion is tracked in a compact { date -> [habitId] } map.
//
// This is intentionally SEPARATE from the codex journal: the journal is an
// append-only per-day log whose past days must never be mutated, which does
// not model recurring habits with streaks/heatmaps. See codex/CLAUDE.md.
//
// File: <repo-root>/.meta/routines.json  (sibling of projects.json/jobs.json)

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const META_DIR = process.env.BISA_META_DIR || path.join(__dirname, '..', '..', '.meta');
const ROUTINES_FILE = path.join(META_DIR, 'routines.json');

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CATEGORIES = ['health', 'fitness', 'learning', 'work', 'mind', 'chores', 'social', 'other'];
const SCHEDULE_TYPES = ['daily', 'specific_days', 'times_per_week'];

const genId = () => `h-${crypto.randomBytes(4).toString('hex')}`;
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ISO 'YYYY-MM-DD' date math in local time (single-user, single-machine app)
const dowOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=sun … 6=sat
};
const shiftISO = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const startOfWeek = (iso) => shiftISO(iso, -dowOf(iso)); // back to the Sunday

const load = () => {
  let data;
  try { data = JSON.parse(fs.readFileSync(ROUTINES_FILE, 'utf8')); }
  catch { data = { habits: [], completions: {} }; }
  if (!Array.isArray(data.habits)) data.habits = [];
  if (!data.completions || typeof data.completions !== 'object') data.completions = {};
  if (!data.values || typeof data.values !== 'object') data.values = {};
  if (!data.skips || typeof data.skips !== 'object') data.skips = {};
  if (!data.moods || typeof data.moods !== 'object') data.moods = {};
  return data;
};

const save = (data) => {
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(ROUTINES_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
};

// Is `habit` scheduled to occur on date `iso`?
const dueOn = (habit, iso) => {
  if (habit.createdAt && iso < habit.createdAt) return false;
  if (habit.archivedAt && iso >= habit.archivedAt) return false;
  const s = habit.schedule || { type: 'daily' };
  if (s.type === 'specific_days') return Array.isArray(s.days) && s.days.includes(dowOf(iso));
  // 'daily' and 'times_per_week' can be checked off any day (weekly target is
  // enforced by the streak math, not by hiding the item).
  return true;
};

// Day's logged value for a habit. Number for 'numeric', string for 'text',
// 0/'' when unset.
const valueOf = (data, iso, habitId) =>
  (data.values && data.values[iso] && data.values[iso][habitId]) || 0;

// Is `habit` (or all habits, via '*') excused/skipped on `iso`? Skipped days
// are treated as not-due by the streak/consistency/strength math — they neither
// break nor count. Used for vacation / sick days.
const isSkipped = (data, iso, habitId) => {
  const s = data.skips && data.skips[iso];
  return Array.isArray(s) && (s.includes(habitId) || s.includes('*'));
};

// Whether the habit actually counts on `iso`: scheduled AND not skipped.
const effectiveDue = (habit, data, iso) => dueOn(habit, iso) && !isSkipped(data, iso, habit.id);

// Has `habit` succeeded on date `iso`?
//   - 'avoid' habits: success = stayed clean = NO slip recorded that day.
//   - numeric habits: the day's value meets the target.
//   - binary 'do' habits: a completion is recorded.
const isCompleted = (habit, data, iso) => {
  if (habit.polarity === 'avoid') {
    return !(Array.isArray(data.completions[iso]) && data.completions[iso].includes(habit.id));
  }
  if (habit.kind === 'numeric') return valueOf(data, iso, habit.id) >= (habit.target || 1);
  // 'text' habits: a day "counts" when a non-empty note was logged (no target).
  if (habit.kind === 'text') { const v = valueOf(data, iso, habit.id); return typeof v === 'string' && v.trim().length > 0; }
  return Array.isArray(data.completions[iso]) && data.completions[iso].includes(habit.id);
};

// Count days in [from,to] (inclusive) where the habit was completed.
const countCompleted = (habit, data, fromISO, toISO) => {
  let n = 0, cur = fromISO, guard = 0;
  while (cur <= toISO && guard++ < 400) {
    if (isCompleted(habit, data, cur)) n++;
    cur = shiftISO(cur, 1);
  }
  return n;
};

// Current streak. For daily/specific_days: consecutive scheduled days, counting
// backward from today, that are completed — today still being pending does NOT
// break it (habit-tracker convention: don't punish an in-progress day). For
// times_per_week: consecutive weeks that hit the weekly target; the current
// in-progress week never breaks the streak.
const computeStreak = (habit, data, today) => {
  const s = habit.schedule || { type: 'daily' };

  if (s.type === 'times_per_week') {
    const target = Math.max(1, s.target || 1);
    let streak = 0;
    let weekStart = startOfWeek(today);
    for (let i = 0; i < 520; i++) { // cap ~10y
      const weekEnd = shiftISO(weekStart, 6);
      if (habit.createdAt && weekEnd < habit.createdAt) break;
      if (countCompleted(habit, data, weekStart, weekEnd) >= target) streak++;
      else if (i !== 0) break; // current week may still be in progress
      weekStart = shiftISO(weekStart, -7);
    }
    return streak;
  }

  let streak = 0;
  let cur = today;
  for (let i = 0; i < 3660; i++) { // cap ~10y
    if (habit.createdAt && cur < habit.createdAt) break;
    if (effectiveDue(habit, data, cur)) {
      if (isCompleted(habit, data, cur)) streak++;
      // 'do' habits get a grace day for today (not-yet-done ≠ failed). An
      // 'avoid' habit that is "not completed" today means an explicit slip was
      // recorded → that breaks the streak immediately.
      else if (cur !== today || habit.polarity === 'avoid') break;
    }
    cur = shiftISO(cur, -1);
  }
  return streak;
};

// Longest streak ever (personal best). Same semantics as computeStreak but
// scans the whole history from createdAt → today and keeps the max run.
const computeLongestStreak = (habit, data, today) => {
  const s = habit.schedule || { type: 'daily' };
  const start = habit.createdAt || today;

  if (s.type === 'times_per_week') {
    const target = Math.max(1, s.target || 1);
    let best = 0, run = 0, guard = 0;
    let ws = startOfWeek(start);
    const curWS = startOfWeek(today);
    while (ws <= curWS && guard++ < 1040) {
      if (countCompleted(habit, data, ws, shiftISO(ws, 6)) >= target) { run++; if (run > best) best = run; }
      else if (ws !== curWS) run = 0; // current week may still be in progress
      ws = shiftISO(ws, 7);
    }
    return best;
  }

  let best = 0, run = 0, guard = 0;
  let cur = start;
  while (cur <= today && guard++ < 36600) {
    if (effectiveDue(habit, data, cur)) {
      if (isCompleted(habit, data, cur)) { run++; if (run > best) best = run; }
      else if (cur !== today || habit.polarity === 'avoid') run = 0; // today pending (do) doesn't break
    }
    cur = shiftISO(cur, 1);
  }
  return best;
};

// All-time consistency: % of completed due days (or weeks hitting target),
// excluding today/the current week which may still be in progress. null when
// there is nothing elapsed to measure yet.
const consistency = (habit, data, today) => {
  const s = habit.schedule || { type: 'daily' };
  const start = habit.createdAt || today;

  if (s.type === 'times_per_week') {
    const target = Math.max(1, s.target || 1);
    let met = 0, total = 0, guard = 0;
    let ws = startOfWeek(start);
    const curWS = startOfWeek(today);
    while (ws < curWS && guard++ < 1040) {
      total++;
      if (countCompleted(habit, data, ws, shiftISO(ws, 6)) >= target) met++;
      ws = shiftISO(ws, 7);
    }
    return total ? Math.round((met / total) * 100) : null;
  }

  let done = 0, total = 0, cur = start, guard = 0;
  while (cur <= today && guard++ < 36600) {
    if (cur !== today && effectiveDue(habit, data, cur)) {
      total++;
      if (isCompleted(habit, data, cur)) done++;
    }
    cur = shiftISO(cur, 1);
  }
  return total ? Math.round((done / total) * 100) : null;
};

// Habit "strength" 0–100 — an exponential moving average of completion (Loop
// Habit Tracker style). A miss after a long run only dents it; a few good days
// rebuild it. More forgiving than the streak's all-or-nothing chain. Skipped
// days are excluded; for times_per_week it's a per-week EMA.
const HALFLIFE_DAYS = 13;
const HALFLIFE_WEEKS = 8;
const strength = (habit, data, today) => {
  const s = habit.schedule || { type: 'daily' };
  const start = habit.createdAt || today;

  if (s.type === 'times_per_week') {
    const target = Math.max(1, s.target || 1);
    const m = Math.pow(0.5, 1 / HALFLIFE_WEEKS);
    let score = 0, ws = startOfWeek(start), guard = 0;
    const curWS = startOfWeek(today);
    while (ws <= curWS && guard++ < 1040) {
      const hit = countCompleted(habit, data, ws, shiftISO(ws, 6)) >= target ? 1 : 0;
      score = score * m + hit * (1 - m);
      ws = shiftISO(ws, 7);
    }
    return Math.round(score * 100);
  }

  const m = Math.pow(0.5, 1 / HALFLIFE_DAYS);
  let score = 0, cur = start, guard = 0;
  while (cur <= today && guard++ < 36600) {
    if (effectiveDue(habit, data, cur)) {
      score = score * m + (isCompleted(habit, data, cur) ? 1 : 0) * (1 - m);
    }
    cur = shiftISO(cur, 1);
  }
  return Math.round(score * 100);
};

// Current-week progress for times_per_week habits ({done,target}); null for
// other schedule types.
const weeklyProgress = (habit, data, today) => {
  const s = habit.schedule || {};
  if (s.type !== 'times_per_week') return null;
  const ws = startOfWeek(today);
  return {
    done: countCompleted(habit, data, ws, shiftISO(ws, 6)),
    target: Math.max(1, s.target || 1),
  };
};

// Per-habit completion grid over the last `days` calendar days (oldest→newest)
// plus current streak and window adherence — drives the heatmap UI.
const heatmap = (data, days, today) => {
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(shiftISO(today, -i));
  const habits = data.habits.filter((h) => !h.archivedAt);
  return {
    today,
    dates,
    habits: habits.map((h) => {
      const cells = dates.map((d) => ({
        date: d,
        due: dueOn(h, d),
        skipped: isSkipped(data, d, h.id),
        done: isCompleted(h, data, d),
      }));
      // adherence over due, non-skipped, elapsed days
      const counted = cells.filter((c) => c.due && !c.skipped && c.date < today);
      const adherence = counted.length
        ? Math.round((counted.filter((c) => c.done).length / counted.length) * 100)
        : null;
      return {
        id: h.id,
        name: h.name,
        icon: h.icon || '',
        category: h.category || 'other',
        schedule: h.schedule,
        kind: h.kind || 'binary',
        polarity: h.polarity || 'do',
        streak: computeStreak(h, data, today),
        longest: computeLongestStreak(h, data, today),
        consistency: consistency(h, data, today),
        strength: strength(h, data, today),
        adherence,
        cells,
      };
    }),
  };
};

// Consistency broken down by weekday (0=Sun…6=Sat) over the last `days`,
// for one habit. Powers the "patterns" analytics card. Excludes today.
const analyticsByWeekday = (data, habitId, days, today) => {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return null;
  const byDow = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
  const moodsDone = [], moodsMiss = [];
  let cur = shiftISO(today, -(days - 1)), guard = 0;
  while (cur <= today && guard++ < 400) {
    if (cur !== today && effectiveDue(habit, data, cur)) {
      const slot = byDow[dowOf(cur)];
      slot.due++;
      const done = isCompleted(habit, data, cur);
      if (done) slot.done++;
      const mood = data.moods && data.moods[cur];
      if (typeof mood === 'number') (done ? moodsDone : moodsMiss).push(mood);
    }
    cur = shiftISO(cur, 1);
  }
  const avg = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
  return {
    id: habit.id,
    name: habit.name,
    days,
    byDow: byDow.map((x, i) => ({
      dow: i,
      due: x.due,
      rate: x.due ? Math.round((x.done / x.due) * 100) : null,
    })),
    mood: { onDone: avg(moodsDone), onMiss: avg(moodsMiss), nDone: moodsDone.length, nMiss: moodsMiss.length },
  };
};

// Markdown block listing today's due habits, for injection into the 07:00
// codex briefing prompt. Empty string when nothing is scheduled.
const briefingContext = (data, date) => {
  const due = data.habits.filter((h) => !h.archivedAt && dueOn(h, date));
  if (!due.length) return '';
  const lines = ['## routines for today'];
  for (const h of due) {
    const mark = isCompleted(h, data, date) ? 'x' : ' ';
    const when = h.time ? h.time + ' ' : '';
    const tgt = h.kind === 'numeric'
      ? ` (target ${h.target || 1}${h.unit ? ' ' + h.unit : ''})`
      : '';
    lines.push(`- [${mark}] ${when}${h.name}${tgt}`);
  }
  return lines.join('\n');
};

module.exports = {
  ROUTINES_FILE, WEEKDAYS, CATEGORIES, SCHEDULE_TYPES,
  genId, validDate, todayISO, dowOf, shiftISO,
  load, save, dueOn, valueOf, isSkipped, effectiveDue, isCompleted, computeStreak,
  computeLongestStreak, consistency, strength, weeklyProgress, heatmap,
  analyticsByWeekday, briefingContext,
};
