// screens/ops.js — Remote Ops: feed de eventos remotos (corp-watch → biso) +
// ações pré-definidas nos Macs (corp e pessoal), via o proxy /biso. Atualiza
// ao vivo pelo WS (type 'remote-event' vindo da events-bridge). Alcançada via
// BISA.go('ops'). UI strings in English (user preference).
(function () {
  if (!document.getElementById('ops-style')) {
    const s = document.createElement('style');
    s.id = 'ops-style';
    s.textContent = `
      .ops-bar { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .ops-bar .title { font-weight:600; }
      .ops-bar .spacer { flex:1; }
      .ops-action { display:flex; align-items:center; gap:10px; padding:10px 0;
        border-bottom:1px solid var(--line); }
      .ops-action:last-child { border-bottom:none; }
      .ops-action .info { flex:1; min-width:0; }
      .ops-action .name { font-weight:600; }
      .ops-action .desc { font-size:.82rem; }
      .ops-ev { display:flex; gap:10px; padding:9px 0; border-bottom:1px solid var(--line); }
      .ops-ev:last-child { border-bottom:none; }
      .ops-ev .body { flex:1; min-width:0; }
      .ops-ev .t { font-weight:600; font-size:.92rem; }
      .ops-ev .b { font-size:.85rem; }
      .ops-ev .when { font-size:.78rem; white-space:nowrap; }
      .ops-thread { margin-top:6px; padding:8px 10px; background:var(--surface-2);
        border-radius:8px; border-left:2px solid var(--line); }
      .ops-msg { font-size:.85rem; margin-bottom:4px; line-height:1.35; }
      .ops-msg:last-child { margin-bottom:0; }
      .ops-msg-author { font-weight:600; }
      .ops-triage { margin-top:8px; padding:10px 12px; background:var(--surface-2);
        border-radius:8px; border-left:2px solid var(--primary); font-size:.86rem; }
      .ops-triage h3 { font-size:.9rem; margin:8px 0 3px; }
      .ops-triage p { margin:3px 0; }
      .ops-triage code { font-size:.8rem; }
      .ops-out { font-family:ui-monospace,monospace; font-size:.78rem; white-space:pre-wrap;
        background:var(--surface-2); border-radius:8px; padding:8px 10px; margin-top:8px;
        max-height:180px; overflow:auto; }
      .ops-cmdrow { display:flex; gap:8px; }
      .ops-cmdrow input { flex:1; min-width:0; font-family:ui-monospace,monospace;
        font-size:.9rem; padding:10px 12px; border:1px solid var(--line);
        border-radius:8px; background:var(--surface-2); color:var(--ink); }
      .ops-recent { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      .ops-recent button { font-family:ui-monospace,monospace; font-size:.75rem;
        border:1px solid var(--line); background:var(--surface-2); color:var(--ink-soft);
        border-radius:999px; padding:4px 10px; max-width:100%; overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
    `;
    document.head.appendChild(s);
  }

  const elx = (t, c, txt) => {
    const e = document.createElement(t);
    if (c) e.className = c;
    if (txt != null) e.textContent = txt;
    return e;
  };

  const bget = (p) => BISA.api('/biso' + p);
  const bpost = (p) => BISA.api('/biso' + p, { method: 'POST' });

  const ICON = {
    'slack.mention': '📢', 'slack.dm': '💬', 'slack.activity': '💤',
    'watch.login-needed': '🔑', 'watch.degraded': '🩹',
    'approval.requested': '🙋', 'approval.resolved': '✅',
    'monitor.failed': '🚨', 'monitor.recovered': '💚',
    'slack.reply.sent': '↩', 'slack.reply.failed': '⚠', 'slack.opened': '👁',
  };
  const TARGET = { corp: '🏢 corp', personal: '🏠 personal' };

  let unsubWs = null;
  let pollTimer = null;

  window.BISA.screens['ops'] = {
    mount(el) {
      el.innerHTML = '';

      const bar = elx('div', 'ops-bar');
      const back = elx('button', 'btn ghost', '← Hoje');
      back.style.minHeight = '40px';
      back.onclick = () => BISA.go('hub');
      bar.append(back, elx('span', 'title', '🛰 Remote Ops'), elx('span', 'spacer'));
      el.appendChild(bar);

      // ---- approvals card (human-in-the-loop for agents) ----
      const apTitle = elx('div', 'section-title', 'Approvals');
      const apCard = elx('div', 'card');
      el.append(apTitle, apCard);

      async function renderApprovals() {
        let data;
        try { data = await bget('/api/approvals?status=pending'); }
        catch { apTitle.style.display = 'none'; apCard.style.display = 'none'; return; }
        const pending = data.approvals || [];
        // Only visible when there is something to decide — zero noise otherwise.
        apTitle.style.display = pending.length ? '' : 'none';
        apCard.style.display = pending.length ? '' : 'none';
        apCard.innerHTML = '';
        for (const a of pending) {
          const row = elx('div', 'ops-action');
          const info = elx('div', 'info');
          info.append(elx('div', 'name', `🙋 ${a.title}`));
          if (a.body) info.append(elx('div', 'desc muted', a.body));
          info.append(elx('div', 'desc muted', `from ${a.source} · ${new Date(a.ts).toLocaleTimeString()}`));
          const ok = elx('button', 'btn', '✅ Approve');
          ok.style.minHeight = '40px';
          const no = elx('button', 'btn ghost', '⛔ Deny');
          no.style.minHeight = '40px';
          const decide = (decision) => async () => {
            ok.disabled = no.disabled = true;
            try {
              await BISA.api(`/biso/api/approvals/${a.id}/resolve`, { method: 'POST', json: { decision } });
              BISA.toast(decision === 'approve' ? 'Approved ✅' : 'Denied ⛔');
            } catch (e) { BISA.toast(`⚠ ${e.message}`); }
            renderApprovals();
            renderFeed();
          };
          ok.onclick = decide('approve');
          no.onclick = decide('deny');
          row.append(info, ok, no);
          apCard.appendChild(row);
        }
      }

      // ---- command card (ad-hoc exec on the personal Mac) ----
      el.appendChild(elx('div', 'section-title', 'Command · personal Mac'));
      const cmdCard = elx('div', 'card');
      el.appendChild(cmdCard);

      const RECENT_KEY = 'bisa_ops_recent_cmds';
      const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
      const saveRecent = (cmd) => {
        try {
          const list = [cmd, ...loadRecent().filter((c) => c !== cmd)].slice(0, 8);
          localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        } catch {}
      };

      const cmdRow = elx('div', 'ops-cmdrow');
      const cmdInput = elx('input');
      cmdInput.placeholder = 'e.g. ls ~/Downloads | head';
      cmdInput.autocapitalize = 'off';
      cmdInput.autocomplete = 'off';
      cmdInput.spellcheck = false;
      const cmdBtn = elx('button', 'btn', '▶ Run');
      cmdBtn.style.minHeight = '40px';
      cmdRow.append(cmdInput, cmdBtn);
      const cmdOut = elx('div', 'ops-out');
      cmdOut.style.display = 'none';
      const recentRow = elx('div', 'ops-recent');
      cmdCard.append(cmdRow, recentRow, cmdOut);

      function renderRecent() {
        recentRow.innerHTML = '';
        for (const c of loadRecent()) {
          const chip = elx('button', null, c);
          chip.onclick = () => { cmdInput.value = c; cmdInput.focus(); };
          recentRow.appendChild(chip);
        }
      }

      async function runCmd() {
        const cmd = cmdInput.value.trim();
        if (!cmd) return;
        cmdBtn.disabled = true;
        cmdOut.style.display = '';
        cmdOut.textContent = '⏳ running…';
        try {
          const r = await BISA.api('/biso/api/exec', { method: 'POST', json: { cmd } });
          const head = r.timedOut ? '⏱ timed out'
            : `[exit ${r.exitCode} · ${r.ms}ms]`;
          cmdOut.textContent = `${head}\n${r.output || '(no output)'}`.trim();
          saveRecent(cmd);
          renderRecent();
        } catch (e) {
          cmdOut.textContent = `⚠ ${e.message}`;
        }
        cmdBtn.disabled = false;
      }
      cmdBtn.onclick = runCmd;
      cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCmd(); });
      renderRecent();

      // ---- actions card ----
      el.appendChild(elx('div', 'section-title', 'Actions'));
      const actionsCard = elx('div', 'card');
      el.appendChild(actionsCard);

      // ---- events feed ----
      el.appendChild(elx('div', 'section-title', 'Events'));
      const feedCard = elx('div', 'card');
      el.appendChild(feedCard);

      async function renderActions() {
        let cat, runs;
        try {
          [cat, runs] = await Promise.all([bget('/api/actions'), bget('/api/actions/runs?limit=5')]);
        } catch (e) {
          actionsCard.innerHTML = '';
          actionsCard.appendChild(elx('p', 'muted', `⚠ Could not reach biso (${e.message}). Is it running on port 7777?`));
          return;
        }
        actionsCard.innerHTML = '';
        if (!cat.actions.length) {
          actionsCard.appendChild(elx('p', 'muted', 'No actions configured (biso config/actions.json).'));
        }
        const lastByAction = {};
        for (const r of (runs.runs || [])) if (!lastByAction[r.actionId]) lastByAction[r.actionId] = r;

        for (const a of cat.actions) {
          const row = elx('div', 'ops-action');
          const info = elx('div', 'info');
          info.append(elx('div', 'name', a.name), elx('div', 'desc muted', `${TARGET[a.target] || a.target}${a.description ? ' — ' + a.description : ''}`));
          const btn = elx('button', 'btn', '▶ Run');
          btn.style.minHeight = '40px';
          const last = lastByAction[a.id];
          if (last && last.status === 'running') btn.disabled = true;
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              await bpost(`/api/actions/${a.id}/run`);
              BISA.toast(`Running "${a.name}"…`);
              schedulePoll();
            } catch (e) {
              BISA.toast(`⚠ ${e.message}`);
              btn.disabled = false;
            }
          };
          row.append(info, btn);
          actionsCard.appendChild(row);
          if (last && last.status !== 'running' && (last.output || last.status !== 'done')) {
            const out = elx('div', 'ops-out');
            out.textContent = `[${last.status}${last.exitCode != null ? ` · exit ${last.exitCode}` : ''} · ${new Date(last.startedAt).toLocaleTimeString()}]\n${last.output || ''}`.trim();
            actionsCard.appendChild(out);
          }
        }
      }

      async function renderFeed() {
        let data;
        try { data = await bget('/api/events?limit=50'); }
        catch { feedCard.innerHTML = ''; feedCard.appendChild(elx('p', 'muted', '⚠ Could not load events.')); return; }
        feedCard.innerHTML = '';
        const events = (data.events || []).slice().reverse();   // newest first
        if (!events.length) {
          feedCard.appendChild(elx('p', 'muted', 'No events yet. When corp-watch detects a Slack mention or DM, it shows up here.'));
        }
        for (const ev of events) {
          const row = elx('div', 'ops-ev');
          row.appendChild(elx('span', null, ICON[ev.type] || '·'));
          const body = elx('div', 'body');
          body.append(elx('div', 't', ev.title));
          if (ev.body) body.append(elx('div', 'b muted', ev.body));

          // Message preview: the actual last messages of the conversation.
          if (ev.data && Array.isArray(ev.data.messages) && ev.data.messages.length) {
            const thread = elx('div', 'ops-thread');
            for (const m of ev.data.messages) {
              const line = elx('div', 'ops-msg');
              if (m.author) line.append(elx('span', 'ops-msg-author', m.author + ': '));
              line.append(document.createTextNode(m.text));
              thread.appendChild(line);
            }
            body.appendChild(thread);
          }

          // Context-aware triage: headless claude researches the message against
          // the mcgraw repo + journal + memory and writes a note (F1).
          if ((ev.type === 'slack.mention' || ev.type === 'slack.dm') && ev.data && ev.data.key) {
            const triageBtn = elx('button', 'btn ghost', '🧠 Analyze with context');
            triageBtn.style.cssText = 'min-height:32px;font-size:.8rem;margin-top:6px;margin-right:6px;';
            const triageOut = elx('div', 'ops-triage');
            triageOut.style.display = 'none';
            const showTriage = (t) => {
              triageOut.style.display = '';
              if (t.status === 'analyzing') { triageOut.innerHTML = '<em>🧠 analyzing… (reading the repo, ~30-90s)</em>'; }
              else if (t.status === 'done') { triageOut.innerHTML = BISA.renderMarkdown(t.note || ''); }
              else { triageOut.textContent = `⚠ ${t.note || 'triage failed'}`; }
            };
            let triagePoll = null;
            const pollTriage = () => {
              clearTimeout(triagePoll);
              triagePoll = setTimeout(async () => {
                try {
                  const t = await bget(`/api/events/${ev.id}/triage`);
                  showTriage(t);
                  if (t.status === 'analyzing') pollTriage();
                } catch { pollTriage(); }
              }, 3000);
            };
            triageBtn.onclick = async () => {
              triageBtn.disabled = true;
              showTriage({ status: 'analyzing' });
              try {
                await bpost(`/api/events/${ev.id}/analyze`);
                pollTriage();
              } catch (e) { showTriage({ status: 'error', note: e.message }); }
              triageBtn.disabled = false;
            };
            // If a triage already exists (revisiting the feed), show it.
            bget(`/api/events/${ev.id}/triage`).then(showTriage).catch(() => {});
            body.append(triageBtn);
            body.append(triageOut);
          }

          // Two-way Slack: mentions/DMs get an inline reply box. The reply is
          // queued in biso and typed into Slack by corp-watch (~15s).
          if ((ev.type === 'slack.mention' || ev.type === 'slack.dm') && ev.data && ev.data.key) {
            const replyBtn = elx('button', 'btn ghost', '↩ Reply');
            replyBtn.style.cssText = 'min-height:32px;font-size:.8rem;margin-top:6px;';
            const replyBox = elx('div', 'ops-cmdrow');
            replyBox.style.cssText = 'display:none;margin-top:6px;';
            const replyInput = elx('input');
            replyInput.placeholder = `Reply to ${ev.data.key}…`;
            replyInput.autocapitalize = 'sentences';
            const sendBtn = elx('button', 'btn', 'Send');
            sendBtn.style.minHeight = '40px';
            replyBox.append(replyInput, sendBtn);
            replyBtn.onclick = () => {
              replyBox.style.display = replyBox.style.display === 'none' ? 'flex' : 'none';
              if (replyBox.style.display === 'flex') replyInput.focus();
            };
            const send = async () => {
              const text = replyInput.value.trim();
              if (!text) return;
              sendBtn.disabled = true;
              try {
                await BISA.api('/biso/api/watch/commands', {
                  method: 'POST',
                  json: { kind: 'slack.reply', payload: { key: ev.data.key, text } },
                });
                BISA.toast(`Reply queued — corp Mac types it in ~15s`);
                replyInput.value = '';
                replyBox.style.display = 'none';
              } catch (e) { BISA.toast(`⚠ ${e.message}`); }
              sendBtn.disabled = false;
            };
            sendBtn.onclick = send;
            replyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
            body.append(replyBtn, replyBox);
          }

          row.append(body, elx('span', 'when muted', new Date(ev.ts).toLocaleString()));
          feedCard.appendChild(row);
        }
      }

      // Re-poll while an action run is settling (output arrives async).
      function schedulePoll() {
        clearTimeout(pollTimer);
        let tries = 0;
        const tick = async () => {
          await renderActions();
          if (++tries < 10) pollTimer = setTimeout(tick, 2000);
        };
        pollTimer = setTimeout(tick, 1500);
      }

      unsubWs = BISA.onWs((m) => {
        if (m && m.type === 'remote-event') {
          renderFeed();
          if (m.event && String(m.event.type || '').startsWith('approval.')) renderApprovals();
        }
      });

      renderApprovals();
      renderActions();
      renderFeed();
    },
    unmount() {
      if (unsubWs) { unsubWs(); unsubWs = null; }
      clearTimeout(pollTimer);
      pollTimer = null;
    },
  };
})();
