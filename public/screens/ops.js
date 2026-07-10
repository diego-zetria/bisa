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
      .ops-badge { font-size:.7rem; font-weight:600; color:#fff; background:var(--danger,#c0392b);
        border-radius:4px; padding:1px 5px; margin-left:6px; vertical-align:middle; }
      .ops-params { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
      .ops-params input, .ops-params select { font-size:.85rem; padding:6px 8px;
        border:1px solid var(--line); border-radius:6px; background:var(--surface-2); color:var(--ink); }
      .ops-action .mono { font-family:ui-monospace,monospace; font-size:.78rem; }
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
  const bpost = (p, json) => BISA.api('/biso' + p, json ? { method: 'POST', json } : { method: 'POST' });

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
  let corpTimer = null;

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

      // ---- corp break-glass card ----
      el.appendChild(elx('div', 'section-title', 'Corp break-glass'));
      const corpCard = elx('div', 'card');
      el.appendChild(corpCard);

      // Download a corp run's artifact (proxy authenticates by header → blob).
      async function downloadRun(runId, filename) {
        try {
          const resp = await fetch(`/biso/api/corp/runs/${runId}/download`, { headers: { 'x-bisa-token': BISA.token } });
          if (!resp.ok) throw new Error('download failed');
          const url = URL.createObjectURL(await resp.blob());
          const a2 = document.createElement('a');
          a2.href = url; a2.download = filename || 'file';
          document.body.appendChild(a2); a2.click(); a2.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) { BISA.toast(`⚠ ${e.message}`); }
      }
      // Poll a corp run, streaming live output into `out`, until it settles.
      // Returns the final run. onPin (optional) adds a 📌 pin button for exec.
      async function pollCorpRun(runId, out, opts) {
        opts = opts || {};
        out.style.display = ''; out.textContent = '⏳ running on corp…';
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          let runs;
          try { runs = await bget('/api/corp/runs?limit=15'); } catch { continue; }
          const r = (runs.runs || []).find((x) => x.id === runId);
          if (!r) continue;
          const head = r.status === 'running' ? '⏳ running…'
            : `[${r.status}${r.exitCode != null ? ` · exit ${r.exitCode}` : ''}]`;
          out.textContent = `${head}\n${r.output || ''}`.trim();
          if (r.status !== 'running') {
            const extras = elx('div'); extras.style.marginTop = '6px';
            if (r.hasFile) {
              const dl = elx('button', 'btn ghost', '⬇ Full output');
              dl.style.minHeight = '36px'; dl.style.marginRight = '6px';
              dl.onclick = () => downloadRun(runId, opts.filename || 'output.txt');
              extras.appendChild(dl);
            }
            if (opts.onPin) {
              const pin = elx('button', 'btn ghost', '📌 Pin');
              pin.style.minHeight = '36px';
              pin.onclick = () => opts.onPin();
              extras.appendChild(pin);
            }
            if (extras.children.length) out.appendChild(extras);
            return r;
          }
        }
      }

      async function renderCorp() {
        let lock, runbooks, pins;
        try {
          [lock, runbooks, pins] = await Promise.all([
            bget('/api/corp/lock'), bget('/api/corp/runbooks').catch(() => ({ runbooks: [] })),
            bget('/api/corp/pins').catch(() => ({ pins: [] })),
          ]);
        } catch { corpCard.innerHTML = ''; corpCard.appendChild(elx('p', 'muted', '⚠ Could not read corp lock.')); return; }
        corpCard.innerHTML = '';

        // ---- runbooks (read-only, always available) ----
        for (const rb of (runbooks.runbooks || [])) {
          const row = elx('div', 'ops-action');
          const info = elx('div', 'info');
          info.append(elx('div', 'name', `📋 ${rb.name}`), elx('div', 'desc muted', (rb.steps || []).join(' · ')));
          const btn = elx('button', 'btn', '▶ Run');
          btn.style.minHeight = '40px';
          const out = elx('div', 'ops-out'); out.style.display = 'none';
          btn.onclick = async () => {
            btn.disabled = true;
            try { const { runId } = await bpost(`/api/corp/runbooks/${rb.id}/run`); await pollCorpRun(runId, out); }
            catch (e) { out.style.display = ''; out.textContent = `⚠ ${e.message}`; }
            btn.disabled = false;
          };
          row.append(info, btn);
          corpCard.append(row, out);
        }

        // ---- pinned commands (read-tier, always available) ----
        for (const pin of (pins.pins || [])) {
          const row = elx('div', 'ops-action');
          const info = elx('div', 'info');
          info.append(elx('div', 'name', `📌 ${pin.name}`), elx('div', 'desc muted mono', pin.cmd));
          const runBtn = elx('button', 'btn', '▶');
          runBtn.style.minHeight = '40px';
          const del = elx('button', 'btn ghost', '🗑');
          del.style.minHeight = '40px';
          const out = elx('div', 'ops-out'); out.style.display = 'none';
          runBtn.onclick = async () => {
            runBtn.disabled = true;
            try { const { runId } = await bpost(`/api/corp/pins/${pin.id}/run`); await pollCorpRun(runId, out); }
            catch (e) { out.style.display = ''; out.textContent = `⚠ ${e.message}`; }
            runBtn.disabled = false;
          };
          del.onclick = async () => {
            try { await BISA.api(`/biso/api/corp/pins/${pin.id}`, { method: 'DELETE' }); renderCorp(); }
            catch (e) { BISA.toast(`⚠ ${e.message}`); }
          };
          row.append(info, runBtn, del);
          corpCard.append(row, out);
        }

        // ---- break-glass status + toggle ----
        const statusRow = elx('div', 'ops-action');
        const info = elx('div', 'info');
        if (lock.masterDisabled) {
          info.append(elx('div', 'name', '⛔ Hard-disabled'), elx('div', 'desc muted', 'BISO_CORP_EXEC_DISABLED is set — arbitrary corp exec/fetch/push is off.'));
          statusRow.append(info); corpCard.appendChild(statusRow);
          clearTimeout(corpTimer); return;
        }
        if (lock.unlocked) {
          const mins = Math.max(0, Math.round((new Date(lock.until) - Date.now()) / 60000));
          info.append(elx('div', 'name', `🔓 Unlocked (~${mins} min left)`), elx('div', 'desc muted', lock.reason || 'Arbitrary corp exec + file transfer are active.'));
        } else {
          info.append(elx('div', 'name', '🔒 Break-glass locked'), elx('div', 'desc muted', 'Runbooks/pinned run read-only. Unlock for arbitrary exec/fetch/push.'));
        }
        const toggle = elx('button', lock.unlocked ? 'btn ghost' : 'btn', lock.unlocked ? 'Relock' : 'Unlock 15 min');
        toggle.style.minHeight = '40px';
        toggle.onclick = async () => {
          toggle.disabled = true;
          try {
            if (lock.unlocked) await bpost('/api/corp/lock', { enabled: false });
            else await bpost('/api/corp/lock', { minutes: 15, reason: 'iPad break-glass' });
          } catch (e) { BISA.toast(`⚠ ${e.message}`); }
          renderCorp();
        };
        statusRow.append(info, toggle);
        corpCard.appendChild(statusRow);

        if (lock.unlocked) {
          // arbitrary exec (live output + full-output download + pin)
          const exRow = elx('div', 'ops-cmdrow'); exRow.style.marginTop = '10px';
          const exIn = elx('input');
          exIn.placeholder = 'corp command, e.g. kubectl logs -f deploy/x';
          exIn.autocapitalize = 'off'; exIn.spellcheck = false;
          const exBtn = elx('button', 'btn', '▶'); exBtn.style.minHeight = '40px';
          const exOut = elx('div', 'ops-out'); exOut.style.display = 'none';
          const runEx = async () => {
            const cmd = exIn.value.trim(); if (!cmd) return;
            exBtn.disabled = true;
            try {
              const { runId } = await bpost('/api/corp/exec', { cmd });
              await pollCorpRun(runId, exOut, {
                filename: 'corp-output.txt',
                onPin: async () => {
                  const name = prompt('Pin name:', cmd.slice(0, 40));
                  if (name == null) return;
                  try { await bpost('/api/corp/pins', { name, cmd }); BISA.toast('Pinned ✓'); renderCorp(); }
                  catch (e) { BISA.toast(`⚠ ${e.message}`); }
                },
              });
            } catch (e) { exOut.style.display = ''; exOut.textContent = `⚠ ${e.message}`; }
            exBtn.disabled = false;
          };
          exBtn.onclick = runEx;
          exIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') runEx(); });
          exRow.append(exIn, exBtn);

          // file fetch (corp → iPad)
          const fRow = elx('div', 'ops-cmdrow'); fRow.style.marginTop = '8px';
          const fIn = elx('input');
          fIn.placeholder = 'fetch file, e.g. /var/log/system.log';
          fIn.autocapitalize = 'off'; fIn.spellcheck = false;
          const fBtn = elx('button', 'btn ghost', '⬇'); fBtn.style.minHeight = '40px';
          const fOut = elx('div', 'ops-out'); fOut.style.display = 'none';
          const runFetch = async () => {
            const p = fIn.value.trim(); if (!p) return;
            fBtn.disabled = true;
            try {
              const { runId } = await bpost('/api/corp/fetch', { path: p });
              const r = await pollCorpRun(runId, fOut, { filename: p.split('/').pop() });
              if (r && r.status === 'done' && r.hasFile) downloadRun(runId, p.split('/').pop());
            } catch (e) { fOut.style.display = ''; fOut.textContent = `⚠ ${e.message}`; }
            fBtn.disabled = false;
          };
          fBtn.onclick = runFetch;
          fIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFetch(); });
          fRow.append(fIn, fBtn);

          // push file (iPad → corp)
          const pPath = elx('input');
          pPath.placeholder = 'write to corp path, e.g. /tmp/hotfix.sh';
          pPath.autocapitalize = 'off'; pPath.spellcheck = false;
          pPath.style.cssText = 'width:100%;margin-top:8px;font-family:ui-monospace,monospace;font-size:.85rem;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--ink);';
          const pText = elx('textarea');
          pText.placeholder = 'file contents…';
          pText.style.cssText = 'width:100%;margin-top:6px;min-height:70px;font-family:ui-monospace,monospace;font-size:.82rem;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);color:var(--ink);';
          const pBtn = elx('button', 'btn', '⬆ Push to corp'); pBtn.style.cssText = 'margin-top:6px;min-height:40px;';
          const pOut = elx('div', 'ops-out'); pOut.style.display = 'none';
          pBtn.onclick = async () => {
            const path2 = pPath.value.trim(); const content = pText.value;
            if (!path2) return;
            pBtn.disabled = true;
            try { const { runId } = await bpost('/api/corp/push', { path: path2, content }); await pollCorpRun(runId, pOut); }
            catch (e) { pOut.style.display = ''; pOut.textContent = `⚠ ${e.message}`; }
            pBtn.disabled = false;
          };

          corpCard.append(exRow, exOut, fRow, fOut, pPath, pText, pBtn, pOut);
        }

        // Re-render to update the countdown / auto-relock.
        clearTimeout(corpTimer);
        if (lock.unlocked) corpTimer = setTimeout(renderCorp, 30000);
      }

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
          const nameLine = elx('div', 'name', a.name);
          if (a.risk === 'write') nameLine.append(elx('span', 'ops-badge', ' write'));
          info.append(nameLine, elx('div', 'desc muted', `${TARGET[a.target] || a.target}${a.description ? ' — ' + a.description : ''}`));

          // Parameter inputs (enum → select, else free text validated server-side).
          const paramEls = {};
          if (a.params && a.params.length) {
            const prow = elx('div', 'ops-params');
            for (const p of a.params) {
              let inp;
              if (p.enum && p.enum.length) {
                inp = elx('select');
                for (const opt of p.enum) { const o = elx('option', null, opt); o.value = opt; inp.appendChild(o); }
              } else {
                inp = elx('input');
                inp.placeholder = p.label || p.name;
              }
              paramEls[p.name] = inp;
              prow.appendChild(inp);
            }
            info.appendChild(prow);
          }

          const btn = elx('button', 'btn', '▶ Run');
          btn.style.minHeight = '40px';
          const last = lastByAction[a.id];
          if (last && last.status === 'running') btn.disabled = true;
          btn.onclick = async () => {
            btn.disabled = true;
            const params = {};
            for (const k in paramEls) params[k] = paramEls[k].value;
            try {
              await bpost(`/api/actions/${a.id}/run`, Object.keys(params).length ? { params } : undefined);
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
      renderCorp();
      renderActions();
      renderFeed();
    },
    unmount() {
      if (unsubWs) { unsubWs(); unsubWs = null; }
      clearTimeout(pollTimer);
      clearTimeout(corpTimer);
      pollTimer = null;
    },
  };
})();
