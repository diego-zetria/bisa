// tests/codex-roundtrip.test.js
// F3 R14 — validates parseJournal/serializeJournal lossless roundtrip.
// This is the most load-bearing test: corruption here silently breaks the
// 2.7 MB curated journal.
//
// Strategy: (a) empty edge cases, (b) hand-built fixtures covering each
// section type, (c) fuzz against the real journal backup if present.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseJournal, serializeJournal } = require('../lib/codex/store');

test('empty input parses to empty array', () => {
  assert.deepEqual(parseJournal(''), []);
});

test('whitespace-only input parses to empty array', () => {
  assert.deepEqual(parseJournal('\n\n\n'), []);
});

test('single H1 with no body parses one day', () => {
  const md = '# 2026-05-24 (sat)\n';
  const days = parseJournal(md);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-05-24');
  assert.equal(days[0].weekday, 'sat');
});

test('day with goals roundtrips via serializer', () => {
  // Source-of-truth shape: what comes OUT of the serializer is canonical.
  const input = '# 2026-05-24 (sat)\n\n## goals\n- [ ] write tests <!-- id=g-abc12345 -->\n- [x] read PR <!-- id=g-def67890 -->\n\n## agenda\n\n## log\n\n## notes\n';
  const days = parseJournal(input);
  const round = serializeJournal(days);
  // Re-parse the serialized output and compare structurally — guarantees
  // the meaning survives even if whitespace policy differs.
  const reparsed = parseJournal(round);
  assert.deepEqual(reparsed, days);
});

test('day with agenda + log roundtrips structurally', () => {
  const input = '# 2026-05-24 (sat)\n\n## goals\n\n## agenda\n- 09:00 standup <!-- id=a-abc12345 -->\n- 14:00 1:1 with @maria <!-- id=a-def67890 -->\n\n## log\n> 10:42 — shipped tests <!-- id=l-abc12345 -->\n\n## notes\n';
  const days = parseJournal(input);
  const round = serializeJournal(days);
  const reparsed = parseJournal(round);
  assert.deepEqual(reparsed, days);
});

test('day with workday sessions roundtrips structurally', () => {
  const input = '# 2026-05-24 (sat)\n\n## workday\n- 09:00 → 12:00 (3h) <!-- id=w-abc12345 -->\n- 13:00 → … <!-- id=w-def67890 -->\n\n## goals\n\n## agenda\n\n## log\n\n## notes\n';
  const days = parseJournal(input);
  const round = serializeJournal(days);
  const reparsed = parseJournal(round);
  assert.deepEqual(reparsed, days);
  // Verify open session is preserved
  const open = days[0].sections.workday.find((w) => !w.end);
  assert.ok(open, 'open workday session should be preserved');
});

test('day with auto-sections (briefing/reflection) roundtrips structurally', () => {
  const input = '# 2026-05-24 (sat)\n\n## briefing <!-- auto · codex-loop -->\nFrom yesterday: shipped tests.\n\nToday: pivot to F2.\n\n## goals\n\n## agenda\n\n## log\n\n## notes\n\n## reflection <!-- auto · codex-loop -->\nFinished R4 on schedule.\n';
  const days = parseJournal(input);
  const round = serializeJournal(days);
  const reparsed = parseJournal(round);
  assert.deepEqual(reparsed, days);
  assert.equal(days[0].sections.briefing.includes('From yesterday'), true);
  assert.equal(days[0].sections.reflection.includes('Finished R4'), true);
});

test('multi-day separated by --- roundtrips structurally', () => {
  const input = '# 2026-05-24 (sat)\n\n## goals\n\n## agenda\n\n## log\n> 10:00 — today <!-- id=l-aaa11111 -->\n\n## notes\n\n---\n\n# 2026-05-23 (fri)\n\n## goals\n\n## agenda\n\n## log\n> 14:00 — yesterday <!-- id=l-bbb22222 -->\n\n## notes\n';
  const days = parseJournal(input);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-05-24');
  assert.equal(days[1].date, '2026-05-23');
  const round = serializeJournal(days);
  const reparsed = parseJournal(round);
  assert.deepEqual(reparsed, days);
});

test('LLM-generated sub-heading inside auto-section is NOT treated as section boundary', () => {
  // Parser-hardening edge case from prior shipment: a `## shape` heading
  // inside a `## briefing` raw block must not truncate the briefing.
  const input = '# 2026-05-24 (sat)\n\n## briefing <!-- auto · codex-loop -->\nHere is the briefing.\n\n## shape\nA sub-section the LLM wrote inside the briefing body.\n\nMore briefing text.\n\n## goals\n\n## agenda\n\n## log\n\n## notes\n';
  const days = parseJournal(input);
  assert.equal(days.length, 1);
  assert.equal(days[0].sections.briefing.includes('## shape'), true,
    'briefing must contain the LLM sub-heading (not treat it as boundary)');
  assert.equal(days[0].sections.briefing.includes('More briefing text'), true,
    'text after LLM sub-heading must remain inside briefing');
});

test('real biso journal backup roundtrips byte-identical (if backup present)', () => {
  const backupPath = path.join(__dirname, '..', 'codex', 'journal.md.bak-r3-2026-05-24');
  if (!fs.existsSync(backupPath)) {
    // Test is conditional on the R3 baseline backup being present.
    // Local-only; production CI would not have this file.
    return;
  }
  const orig = fs.readFileSync(backupPath, 'utf8');
  const days = parseJournal(orig);
  const round = serializeJournal(days);
  assert.equal(round, orig,
    'real journal roundtrip must be byte-identical (this is the load-bearing assertion)');
  // Sanity check counts
  assert.ok(days.length > 0, 'expected at least one parsed day');
});
