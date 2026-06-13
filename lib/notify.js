// lib/notify.js
// Extracted from server.js R6a (2026-05-24). Notifications layer:
//   - OSC 9/99/777 parser (any PTY program can emit a toast via terminal escape)
//   - Warp CLI-agent stripper (removes inline JSON event payloads from xterm)
//   - dispatchNotification: routes to broadcast() + optional journal log
//   - logNotificationToCodex: appends a #-tagged log entry to today's day
//   - /api/notify + /api/log HTTP endpoints
//
// Deps injected:
//   - requireAuth (bootstrap)
//   - codexStore helpers (loadJournal, findOrCreateDay, saveJournal, genId,
//     todayCodex, nowHMCodex) — needed by logNotificationToCodex
//   - broadcast — getter wrapper, since the WSS-backed broadcast() is created
//     long after this module loads
//
// Exports the parser classes (used by the WS PTY handler in server.js),
// dispatchNotification (used by headless/loop/echoes/hooks), and a router
// (mounted in server.js right after this module is required).

const express = require('express');

class OSCNotificationParser {
  constructor(onNotify) {
    this.onNotify = onNotify;
    this.state = 'normal';    // 'normal' | 'escape' | 'osc' | 'osc_st'
    this.buf = [];
    this.MAX = 8192;
  }
  feed(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      switch (this.state) {
        case 'normal':
          if (b === 0x1b) this.state = 'escape';
          break;
        case 'escape':
          if (b === 0x5d) { this.state = 'osc'; this.buf = []; }
          else this.state = 'normal';
          break;
        case 'osc':
          if (b === 0x07) { this.flush(); this.state = 'normal'; }
          else if (b === 0x1b) this.state = 'osc_st';
          else {
            this.buf.push(b);
            if (this.buf.length > this.MAX) { this.buf = []; this.state = 'normal'; }
          }
          break;
        case 'osc_st':
          if (b === 0x5c) { this.flush(); this.state = 'normal'; }
          else { this.buf.push(0x1b, b); this.state = 'osc'; }
          break;
      }
    }
  }
  flush() {
    const str = Buffer.from(this.buf).toString('utf8');
    const m = str.match(/^(9|99|777);([\s\S]*)$/);
    if (!m) return;
    const [, code, payload] = m;
    let data;
    try { data = JSON.parse(payload); }
    catch { data = { text: payload }; }
    if (typeof data.text !== 'string' || !data.text.trim()) return;
    this.onNotify({
      code: Number(code),
      text: data.text.trim().slice(0, 500),
      log: !!data.log,
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 12).map((t) => String(t).slice(0, 40)) : [],
      silent: !!data.silent,
      source: 'osc',
    });
  }
}

// Warp CLI-agent notification stripper. Claude Code (and other CLI agents)
// emit plain-text payloads of the form `notify;warp://cli-agent;{json}` when
// they think they might be running inside Warp terminal. Outside Warp, these
// payloads are not wrapped in OSC escapes — they appear as raw text and
// pollute the biso terminal. This class buffers across chunks, strips the
// payload from the byte stream before it reaches xterm, parses the JSON,
// and forwards a silent notification with the event metadata.
class WarpCliAgentParser {
  constructor(onNotify) {
    this.onNotify = onNotify;
    this.MARKER = Buffer.from('notify;warp://cli-agent;');
    this.pending = Buffer.alloc(0);
    this.MAX_PENDING = 128 * 1024;
  }
  feed(chunk) {
    let work = this.pending.length ? Buffer.concat([this.pending, chunk]) : Buffer.from(chunk);
    const hadPending = this.pending.length > 0;
    this.pending = Buffer.alloc(0);
    const out = [];
    let sawMarker = false;
    while (work.length) {
      const idx = work.indexOf(this.MARKER);
      if (idx === -1) {
        // No marker — flush everything except a possible trailing prefix of MARKER
        const maxOverlap = Math.min(work.length, this.MARKER.length - 1);
        let overlap = 0;
        for (let n = maxOverlap; n > 0; n--) {
          if (this.MARKER.slice(0, n).equals(work.slice(work.length - n))) { overlap = n; break; }
        }
        if (overlap > 0) {
          out.push(work.slice(0, work.length - overlap));
          this.pending = work.slice(work.length - overlap);
        } else {
          out.push(work);
        }
        break;
      }
      // Marker found — flush bytes before it
      sawMarker = true;
      if (idx > 0) out.push(work.slice(0, idx));
      const rest = work.slice(idx + this.MARKER.length);
      const jsonEnd = this.findJsonEnd(rest);
      if (jsonEnd === -1) {
        // Incomplete JSON — hold from marker onward, stop processing
        if (work.length > this.MAX_PENDING) {
          // Oversize: give up, drop the unparsed portion
          this.pending = Buffer.alloc(0);
        } else {
          this.pending = work.slice(idx);
        }
        break;
      }
      const jsonStr = rest.slice(0, jsonEnd + 1).toString('utf8');
      try { this.handleEvent(JSON.parse(jsonStr)); }
      catch { /* malformed — drop silently */ }
      let after = jsonEnd + 1;
      while (after < rest.length && (rest[after] === 0x0a || rest[after] === 0x0d)) after++;
      work = rest.slice(after);
    }
    if (sawMarker || hadPending) {
      const inLen = chunk.length;
      const outLen = out.reduce((a, b) => a + b.length, 0);
      console.log(`[bisa][warp-agent] feed: in=${inLen} had_pending=${hadPending} saw_marker=${sawMarker} out=${outLen} pending=${this.pending.length}`);
    }
    return out.length === 1 ? out[0] : Buffer.concat(out);
  }
  findJsonEnd(buf) {
    if (buf.length === 0 || buf[0] !== 0x7b) return -1;
    let depth = 0, inStr = false, esc = false;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (b === 0x5c) esc = true;
        else if (b === 0x22) inStr = false;
        continue;
      }
      if (b === 0x22) inStr = true;
      else if (b === 0x7b) depth++;
      else if (b === 0x7d) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
  handleEvent(data) {
    if (!data || typeof data !== 'object') return;
    console.log(`[bisa][warp-agent] stripped event=${data.event || '?'} agent=${data.agent || '?'} session=${String(data.session_id || '').slice(0,8)}`);
    const event = String(data.event || 'event').slice(0, 40);
    const agent = String(data.agent || 'cli').slice(0, 40);
    const project = data.project ? String(data.project).slice(0, 60) : null;
    const query = data.query ? String(data.query) : null;
    let text;
    if (event === 'stop' && query) text = `${agent} finished: ${query.slice(0, 120)}`;
    else if (event === 'stop')     text = `${agent} finished turn`;
    else                           text = `${agent} ${event}`;
    const tags = ['warp-agent', agent, event];
    if (project) tags.push('proj/' + project.replace(/[^a-zA-Z0-9-]/g, ''));
    this.onNotify({
      code: 0,
      text: text.slice(0, 500),
      log: false,
      tags: tags.slice(0, 6),
      silent: true,
      source: 'warp-cli-agent',
    });
  }
}

module.exports = function makeNotify(deps) {
  const {
    requireAuth,
    loadJournal, findOrCreateDay, saveJournal, genId, todayCodex, nowHMCodex,
    broadcast,
  } = deps;

  const logNotificationToCodex = (notif) => {
    try {
      const days = loadJournal();
      const t = todayCodex();
      const day = findOrCreateDay(days, t.date);
      const tagStr = notif.tags.length ? ' ' + notif.tags.map((tg) => '#' + tg).join(' ') : '';
      day.sections.log.push({
        id: genId('l'),
        time: nowHMCodex(),
        text: notif.text + tagStr,
      });
      saveJournal(days);
      return true;
    } catch (e) {
      console.warn('[bisa] codex log from notification failed:', e.message);
      return false;
    }
  };

  const dispatchNotification = (notif) => {
    const logged = notif.log ? logNotificationToCodex(notif) : false;
    broadcast({
      type: 'notification',
      text: notif.text,
      tags: notif.tags || [],
      logged,
      silent: !!notif.silent,
      source: notif.source || 'osc',
      ts: Date.now(),
    });
  };

  const router = express.Router();

  router.post('/api/notify', requireAuth, (req, res) => {
    const { text, log, tags, silent } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }
    dispatchNotification({
      code: 9,
      text: text.trim().slice(0, 500),
      log: !!log,
      tags: Array.isArray(tags) ? tags.slice(0, 12).map((t) => String(t).slice(0, 40)) : [],
      silent: !!silent,
      source: 'http',
    });
    res.json({ ok: true });
  });

  router.post('/api/log', requireAuth, (req, res) => {
    // Always logs to codex; toast is suppressed unless `toast: true`.
    const { text, tags, toast } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text required' });
    }
    dispatchNotification({
      code: 9,
      text: text.trim().slice(0, 500),
      log: true,
      tags: Array.isArray(tags) ? tags.slice(0, 12).map((t) => String(t).slice(0, 40)) : [],
      silent: !toast,
      source: 'http',
    });
    res.json({ ok: true });
  });

  return { router, dispatchNotification, logNotificationToCodex };
};

module.exports.OSCNotificationParser = OSCNotificationParser;
module.exports.WarpCliAgentParser = WarpCliAgentParser;
