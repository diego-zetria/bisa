// lib/codex/store.js
// Extracted from server.js R3 (2026-05-24). Pure data layer for the codex
// living journal: parser, serializer, low-level helpers, and the
// load/save round-trip. No HTTP, no Express. Endpoints live in
// lib/codex/api.js (R4); scheduler loop lives in lib/codex/loop.js (R5).
//
// CODEX_DIR default points one directory up from lib/codex/ to the project
// root, matching the original `path.join(__dirname, 'codex')` semantics
// when this code lived in server.js at the project root.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODEX_DIR  = process.env.CODEX_DIR || path.join(__dirname, '..', '..', 'codex');
const JOURNAL_FILE = path.join(CODEX_DIR, 'journal.md');
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SECTIONS_STRUCT = ['goals', 'agenda', 'log'];

const todayCodex = () => {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { date, weekday: WEEKDAYS[d.getDay()] };
};

const nowHMCodex = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const weekdayFor = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
};

const genId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

const ensureJournalExists = () => {
  if (fs.existsSync(JOURNAL_FILE)) return;
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  const { date, weekday } = todayCodex();
  fs.writeFileSync(
    JOURNAL_FILE,
    `# ${date} (${weekday}) <!-- TODAY -->\n\n## goals\n\n## agenda\n\n## log\n\n## notes\n`,
    'utf8',
  );
};

const hmToMinutes = (hm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

const formatDuration = (minutes) => {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

const sessionMinutes = (start, end) => {
  const a = hmToMinutes(start);
  const b = hmToMinutes(end);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a);
};

const parseItem = (section, line) => {
  const idMatch = line.match(/<!--\s*id=([\w-]+)\s*-->/);
  const id = idMatch ? idMatch[1] : null;
  const clean = (idMatch ? line.replace(idMatch[0], '') : line).replace(/\s+$/, '');

  if (section === 'goals') {
    const m = clean.match(/^-\s+\[([ x])\]\s+(.*)$/);
    if (!m) return null;
    return { id: id || genId('g'), done: m[1] === 'x', text: m[2].trim() };
  }
  if (section === 'agenda') {
    const m = clean.match(/^-\s+(?:(\d{2}:\d{2})\s+)?(.*)$/);
    if (!m) return null;
    return { id: id || genId('a'), time: m[1] || '', text: m[2].trim() };
  }
  if (section === 'log') {
    const m = clean.match(/^>\s+(?:(\d{2}:\d{2})\s+[—\-]\s+)?(.*)$/);
    if (!m) return null;
    return { id: id || genId('l'), time: m[1] || '', text: m[2].trim() };
  }
  if (section === 'workday') {
    // `- HH:MM → HH:MM (Xh Ym)` or open: `- HH:MM → …`
    const m = clean.match(/^-\s+(\d{2}:\d{2})\s*(?:→|->|-)\s*(\d{2}:\d{2}|…|\.\.\.)(?:\s+\([^)]*\))?\s*$/);
    if (!m) return null;
    const start = m[1];
    const rawEnd = m[2];
    const end = (rawEnd === '…' || rawEnd === '...') ? null : rawEnd;
    return { id: id || genId('w'), start, end };
  }
  return null;
};

const serializeItem = (section, item) => {
  const tag = ` <!-- id=${item.id} -->`;
  if (section === 'goals')  return `- [${item.done ? 'x' : ' '}] ${item.text}${tag}`;
  if (section === 'agenda') return `- ${item.time ? item.time + ' ' : ''}${item.text}${tag}`;
  if (section === 'log')    return `> ${item.time ? item.time + ' — ' : ''}${item.text}${tag}`;
  if (section === 'workday') {
    if (!item.end) return `- ${item.start} → …${tag}`;
    const mins = sessionMinutes(item.start, item.end);
    const dur = mins > 0 ? ` (${formatDuration(mins)})` : '';
    return `- ${item.start} → ${item.end}${dur}${tag}`;
  }
  return '';
};

const parseJournal = (md) => {
  const days = [];
  // Split on lines that contain only "---"
  const blocks = md.split(/\n^---\n/m).map((s) => s.replace(/^---\n/m, '').trim()).filter(Boolean);
  const RAW = new Set(['briefing', 'notes', 'reflection', 'weekly']);
  const KNOWN_SECTIONS = new Set(['briefing', 'workday', 'goals', 'agenda', 'log', 'notes', 'reflection', 'weekly']);
  for (const block of blocks) {
    const lines = block.split('\n');
    const h1 = lines[0].match(/^#\s+(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]+)\))?(?:\s*<!--\s*([^>]*?)\s*-->)?\s*$/);
    if (!h1) continue;
    const [, date, weekday, marker] = h1;
    const sections = { briefing: '', workday: [], goals: [], agenda: [], log: [], notes: '', reflection: '', weekly: '' };
    let current = null;
    let rawBuf = [];
    const flushRaw = () => {
      if (current && RAW.has(current)) sections[current] = rawBuf.join('\n').trim();
    };
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // H2 header tolerates an optional trailing HTML comment:
      //   `## briefing` OR `## briefing <!-- auto · codex-loop -->`
      // Only treat as a section boundary if the name is a KNOWN section —
      // otherwise an LLM-generated sub-heading like `## shape` inside a raw
      // section would truncate the section body on parse.
      const sm = line.match(/^##\s+([\w-]+)(?:\s+<!--[^>]*-->)?\s*$/);
      if (sm && KNOWN_SECTIONS.has(sm[1].toLowerCase())) {
        flushRaw();
        current = sm[1].toLowerCase();
        rawBuf = [];
        continue;
      }
      if (!current) continue;
      if (RAW.has(current)) { rawBuf.push(line); continue; }
      const item = parseItem(current, line);
      if (item) sections[current].push(item);
    }
    flushRaw();
    days.push({
      date,
      weekday: weekday || weekdayFor(date),
      marker: (marker || '').trim(),
      sections,
    });
  }
  return days;
};

const serializeJournal = (days) => {
  const parts = [];
  for (const d of days) {
    const header = `# ${d.date} (${d.weekday})${d.marker ? ' <!-- ' + d.marker + ' -->' : ''}`;
    const body = [header, ''];
    if (d.sections.briefing) {
      body.push('## briefing <!-- auto · codex-loop -->');
      body.push(d.sections.briefing);
      body.push('');
    }
    if (Array.isArray(d.sections.workday) && d.sections.workday.length) {
      body.push('## workday');
      for (const w of d.sections.workday) body.push(serializeItem('workday', w));
      body.push('');
    }
    body.push('## goals');
    for (const g of d.sections.goals) body.push(serializeItem('goals', g));
    body.push('');
    body.push('## agenda');
    for (const a of d.sections.agenda) body.push(serializeItem('agenda', a));
    body.push('');
    body.push('## log');
    for (const l of d.sections.log) body.push(serializeItem('log', l));
    body.push('');
    body.push('## notes');
    if (d.sections.notes) body.push(d.sections.notes);
    if (d.sections.reflection) {
      body.push('');
      body.push('## reflection <!-- auto · codex-loop -->');
      body.push(d.sections.reflection);
    }
    if (d.sections.weekly) {
      body.push('');
      body.push('## weekly <!-- auto · codex-loop -->');
      body.push(d.sections.weekly);
    }
    parts.push(body.join('\n').replace(/\n+$/, ''));
  }
  return parts.join('\n\n---\n\n') + '\n';
};

const loadJournal = () => {
  ensureJournalExists();
  return parseJournal(fs.readFileSync(JOURNAL_FILE, 'utf8'));
};
const saveJournal = (days) => fs.writeFileSync(JOURNAL_FILE, serializeJournal(days), 'utf8');

const findOrCreateDay = (days, date) => {
  let day = days.find((d) => d.date === date);
  if (day) return day;
  day = {
    date,
    weekday: weekdayFor(date),
    marker: date === todayCodex().date ? 'TODAY' : '',
    sections: { briefing: '', workday: [], goals: [], agenda: [], log: [], notes: '', reflection: '' },
  };
  // clear stale TODAY markers
  const t = todayCodex().date;
  for (const d of days) if (d.marker === 'TODAY' && d.date !== t) d.marker = '';
  // insert in correct position (reverse chronological)
  let idx = days.findIndex((d) => d.date < date);
  if (idx < 0) idx = days.length;
  days.splice(idx, 0, day);
  return day;
};

const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const findItemAcrossDays = (days, id, preferredDate) => {
  const scan = (d) => {
    for (const sec of SECTIONS_STRUCT) {
      const idx = d.sections[sec].findIndex((x) => x.id === id);
      if (idx >= 0) return { day: d, section: sec, item: d.sections[sec][idx], idx };
    }
    return null;
  };
  if (preferredDate) {
    const d = days.find((x) => x.date === preferredDate);
    if (d) { const hit = scan(d); if (hit) return hit; }
  }
  for (const d of days) { const hit = scan(d); if (hit) return hit; }
  return null;
};

// ---- workday helpers --------------------------------------------------------

const summarizeWorkday = (sessions, nowHM) => {
  const list = (sessions || []).map((s) => {
    const end = s.end || nowHM;
    const minutes = s.end ? sessionMinutes(s.start, s.end) : Math.max(0, sessionMinutes(s.start, end));
    return { id: s.id, start: s.start, end: s.end, minutes, open: !s.end };
  });
  const totalMinutes = list.reduce((sum, x) => sum + x.minutes, 0);
  const open = list.find((x) => x.open) || null;
  return { sessions: list, totalMinutes, totalLabel: formatDuration(totalMinutes), open };
};

// Find any past-day workday sessions that were never ended (forgot to click
// "End day"), close them using the day's last log entry as end fallback.
// Idempotent: callers can invoke freely without checking state.
const autoCloseStaleWorkdaySessions = () => {
  const today = todayCodex().date;
  const days = loadJournal();
  let mutated = false;
  for (const d of days) {
    if (d.date === today) continue;
    const sessions = d.sections.workday || [];
    for (const s of sessions) {
      if (s.end) continue;
      const logTimes = (d.sections.log || []).map((l) => l.time).filter(Boolean).sort();
      const lastLog = logTimes[logTimes.length - 1];
      s.end = lastLog && hmToMinutes(lastLog) > hmToMinutes(s.start) ? lastLog : s.start;
      mutated = true;
      console.log(`[codex] auto-closed stale workday session ${s.id} on ${d.date}: end=${s.end}`);
    }
  }
  if (mutated) saveJournal(days);
};

module.exports = {
  // constants
  CODEX_DIR, JOURNAL_FILE, WEEKDAYS, SECTIONS_STRUCT,
  // date/time
  todayCodex, nowHMCodex, weekdayFor, validDate,
  // ids
  genId,
  // io
  ensureJournalExists, loadJournal, saveJournal,
  // duration helpers
  hmToMinutes, formatDuration, sessionMinutes,
  // parse / serialize
  parseItem, serializeItem, parseJournal, serializeJournal,
  // day / item lookups
  findOrCreateDay, findItemAcrossDays,
  // workday
  summarizeWorkday, autoCloseStaleWorkdaySessions,
};
