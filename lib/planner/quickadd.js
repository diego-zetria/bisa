// lib/planner/quickadd.js
// pt-BR natural-language quick-add parser for planner tasks.
// Primary regex parser; LLM is only for genuinely ambiguous input.
//
// Examples that must parse:
//   "amanhã 15h dentista #saude"   → date=tomorrow, block=afternoon, text="15:00 dentista", tags:["saude"]
//   "seg comprar presente do Jonas" → next Monday, block=null, text="comprar presente do Jonas"
//   "pagar boleto"                  → today, block=null, text="pagar boleto"

'use strict';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Return today's date string YYYY-MM-DD in local time. */
function todayStr() {
  const d = new Date();
  return localDateStr(d);
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add N days to today, return YYYY-MM-DD. */
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

/** Return the date of the next occurrence of a given weekday (0=Sun...6=Sat).
 *  If today is that weekday, returns next week's occurrence (7 days ahead). */
function nextWeekday(targetDow) {
  const now = new Date();
  const todayDow = now.getDay();
  let diff = targetDow - todayDow;
  if (diff <= 0) diff += 7;
  return addDays(diff);
}

// ---------------------------------------------------------------------------
// Accent normaliser for tag keys
// ---------------------------------------------------------------------------
function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------------------
// pt-BR weekday name → JS Day-Of-Week (0=Sun)
// ---------------------------------------------------------------------------
const WEEKDAY_MAP = {
  // Monday
  'segunda': 1, 'seg': 1, 'segunda-feira': 1,
  // Tuesday
  'terça': 2, 'terca': 2, 'ter': 2, 'terça-feira': 2, 'terca-feira': 2,
  // Wednesday
  'quarta': 3, 'qua': 3, 'quarta-feira': 3,
  // Thursday
  'quinta': 4, 'qui': 4, 'quinta-feira': 4,
  // Friday
  'sexta': 5, 'sex': 5, 'sexta-feira': 5,
  // Saturday
  'sábado': 6, 'sabado': 6, 'sab': 6,
  // Sunday
  'domingo': 0, 'dom': 0,
};

// ---------------------------------------------------------------------------
// Parse time string → { hour, minute } or null
// Accepts: "15h", "15:30", "9h30", "9h", "15:00"
// ---------------------------------------------------------------------------
function parseTime(str) {
  // 15:30 or 9:00
  let m = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (m) return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
  // 15h or 9h
  m = /^(\d{1,2})h$/.exec(str);
  if (m) return { hour: parseInt(m[1], 10), minute: 0 };
  // 9h30
  m = /^(\d{1,2})h(\d{2})$/.exec(str);
  if (m) return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
  return null;
}

/** Format { hour, minute } as "HH:MM". */
function fmtTime(t) {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

/** Infer block from hour (before 13h → morning, else afternoon). */
function blockFromHour(hour) {
  return hour < 13 ? 'morning' : 'afternoon';
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse a pt-BR quick-add string into a structured result.
 * Returns:
 *   { date: 'YYYY-MM-DD'|null, block: 'morning'|'afternoon'|null,
 *     text: string, tags: string[] }
 * date=null means "today" (caller assigns today's date if needed).
 */
function parseQuickAdd(raw) {
  let input = raw.trim();

  // --- 1. Extract tags (#palavra) anywhere in the string ---
  const tags = [];
  input = input.replace(/#([\wÀ-ÿ]+)/g, (_, tag) => {
    tags.push(stripAccents(tag.toLowerCase()));
    return '';
  }).replace(/\s+/g, ' ').trim();

  // --- 2. Tokenise ---
  const tokens = input.split(/\s+/);

  let date = null;   // YYYY-MM-DD or null (→ today)
  let time = null;   // { hour, minute }
  let consumed = 0;  // how many leading tokens consumed for date/time

  // --- 3. Try to extract date keyword from first token ---
  const first = tokens[0] ? tokens[0].toLowerCase() : '';

  // "hoje"
  if (first === 'hoje') {
    date = todayStr();
    consumed = 1;
  }
  // "amanhã" / "amanha"
  else if (first === 'amanhã' || first === 'amanha') {
    date = addDays(1);
    consumed = 1;
  }
  // "DD/MM" date literal
  else if (/^\d{1,2}\/\d{1,2}$/.test(first)) {
    const [d, mo] = first.split('/').map(Number);
    const y = new Date().getFullYear();
    const candidate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    // Validate it's a real date
    const dt = new Date(y, mo - 1, d);
    if (!isNaN(dt.getTime())) {
      date = candidate;
    }
    consumed = 1;
  }
  // Weekday name (normalise accents for lookup)
  else {
    const normalised = stripAccents(first);
    if (WEEKDAY_MAP[normalised] !== undefined) {
      date = nextWeekday(WEEKDAY_MAP[normalised]);
      consumed = 1;
    } else if (WEEKDAY_MAP[first] !== undefined) {
      date = nextWeekday(WEEKDAY_MAP[first]);
      consumed = 1;
    }
  }

  // --- 4. After date token, try to parse a time token ---
  if (consumed > 0 && tokens[consumed]) {
    const t = parseTime(tokens[consumed].toLowerCase());
    if (t) {
      time = t;
      consumed++;
    }
  }

  // --- 5. Build task text ---
  const rest = tokens.slice(consumed).join(' ').trim();
  let text = rest;
  if (time) {
    // Prefix text with time
    text = `${fmtTime(time)}${rest ? ' ' + rest : ''}`;
  }
  if (!text) text = raw.trim(); // fallback: use raw if nothing left

  // --- 6. Determine block from time ---
  let block = null;
  if (time) {
    block = blockFromHour(time.hour);
  }

  return {
    date,   // null → today (caller sets actual date)
    block,
    text,
    tags,
  };
}

module.exports = { parseQuickAdd };
