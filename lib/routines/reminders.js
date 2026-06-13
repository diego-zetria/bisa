// lib/routines/reminders.js
// Per-minute ticker that fires a notification when a habit's reminder time
// arrives and it isn't done yet today. Reuses dispatchNotification (the same
// WebSocket toast path as the codex loop). One reminder per habit per day;
// the "already reminded" set is in-memory (a restart at the exact reminder
// minute could re-fire once — acceptable).

module.exports = function makeRoutinesReminders(deps) {
  const { routinesStore, dispatchNotification } = deps;
  const { load, dueOn, isCompleted, todayISO } = routinesStore;

  let remindedDate = null;
  let reminded = new Set();

  const nowHM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const tick = () => {
    const today = todayISO();
    if (remindedDate !== today) { remindedDate = today; reminded = new Set(); }
    const now = nowHM();

    let data;
    try { data = load(); } catch { return; }

    for (const h of data.habits) {
      if (!h.time || h.time !== now) continue;
      if (reminded.has(h.id)) continue;
      if (!dueOn(h, today)) continue;
      if (isCompleted(h, data, today)) continue;
      reminded.add(h.id);
      try {
        dispatchNotification({
          code: 9,
          text: `⏰ ${h.name}${h.icon ? ' ' + h.icon : ''} — ${h.time}`,
          log: false,
          tags: ['routine', 'reminder'],
          silent: false,
          source: 'routines',
        });
      } catch { /* notification best-effort */ }
    }
  };

  const timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  return { tick, stop: () => clearInterval(timer) };
};
