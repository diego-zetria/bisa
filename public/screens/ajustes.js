// screens/ajustes.js — Ajustes do bisa. Hoje: a "Tela de entrada" (o selo).
// Liga/desliga a rotação diária, escolhe os temas do pool (ou fixa um), e
// pré-visualiza cada tema ao vivo. Contrato de tela: { mount(el), unmount }.
(function () {
  'use strict';
  const G = window.BISA;
  const GATE = window.BISA_GATE;
  const EMOJI = { monolith: '🗿', biblioteca: '📚', cosmos: '🌌', zen: '🍵', cyberdeck: '🖥️' };

  function injectStyle() {
    if (document.getElementById('gate-settings-style')) return;
    const s = document.createElement('style');
    s.id = 'gate-settings-style';
    s.textContent = `
      .gate-settings .gs-card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:14px 16px; margin-bottom:14px; }
      .gate-settings .gs-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .gate-settings .gs-title { font-weight:600; }
      .gate-settings .gs-sub { font-size:.85rem; margin-top:2px; }
      .gate-settings .gs-today { margin-top:12px; font-size:.9rem; }
      .gate-settings .gs-switch { width:52px; height:30px; border-radius:999px; border:none; background:var(--surface-2); position:relative; transition:background .2s; flex:0 0 auto; cursor:pointer; }
      .gate-settings .gs-switch.on { background:var(--primary); }
      .gate-settings .gs-switch span { position:absolute; top:3px; left:3px; width:24px; height:24px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.3); transition:left .2s; }
      .gate-settings .gs-switch.on span { left:25px; }
      .gate-settings .gs-list { padding:4px 8px; }
      .gate-settings .gs-theme { display:flex; align-items:center; gap:12px; padding:11px 6px; border-bottom:1px solid var(--line); }
      .gate-settings .gs-theme:last-child { border-bottom:none; }
      .gate-settings .gs-name { flex:1; }
      .gate-settings .gs-swatch { width:14px; height:14px; border-radius:50%; background:var(--c); box-shadow:0 0 0 2px rgba(0,0,0,.06), 0 0 8px var(--c); flex:0 0 auto; }
      .gate-settings .gs-check { width:24px; height:24px; border-radius:7px; border:2px solid var(--line); display:flex; align-items:center; justify-content:center; font-size:.8rem; color:var(--primary-ink); cursor:pointer; flex:0 0 auto; }
      .gate-settings .gs-check.on { background:var(--primary); border-color:var(--primary); }
      .gate-settings .gs-radio { width:22px; height:22px; border-radius:50%; border:2px solid var(--line); cursor:pointer; flex:0 0 auto; }
      .gate-settings .gs-radio.on { border-color:var(--primary); box-shadow:inset 0 0 0 4px var(--primary); }
      .gate-settings .gs-see { min-height:36px; padding:0 14px; font-size:.85rem; }
      .gate-settings .gs-seg { display:flex; gap:4px; background:var(--surface-2); border-radius:999px; padding:3px; margin-top:12px; }
      .gate-settings .gs-seg button { flex:1; border:none; background:none; color:var(--ink-soft); border-radius:999px; min-height:38px; font:inherit; font-size:.9rem; font-weight:600; cursor:pointer; }
      .gate-settings .gs-seg button.on { background:var(--surface); color:var(--ink); box-shadow:var(--shadow); }`;
    document.head.appendChild(s);
  }

  // Aparência do app por aparelho: '' segue o sistema; 'light'/'dark' fixam;
  // 'excel' = tema Planilha (branco de verdade + verde Office; sempre claro).
  const APPEAR_KEY = 'bisa_appearance';
  const APPEARANCES = [{ id: '', label: 'Sistema' }, { id: 'light', label: 'Claro' }, { id: 'dark', label: 'Escuro' }, { id: 'excel', label: '🧮 Planilha' }];
  const appearance = () => { try { return localStorage.getItem(APPEAR_KEY) || ''; } catch { return ''; } };
  function setAppearance(v) {
    try { if (v) localStorage.setItem(APPEAR_KEY, v); else localStorage.removeItem(APPEAR_KEY); } catch {}
    if (v) document.documentElement.dataset.appearance = v;
    else delete document.documentElement.dataset.appearance;
  }

  const labelOf = (themes, name) => { const t = themes.find((x) => x.name === name); return t ? t.label : name; };

  function render(root) {
    const themes = GATE.themes();
    const rotating = GATE.isRotating();
    const pool = GATE.getPool();
    const current = GATE.getTheme();
    const today = GATE.todayTheme();
    const tomorrow = GATE.themeForDay(1);

    const toggle = `
      <div class="gs-card">
        <div class="gs-row">
          <div>
            <div class="gs-title">Trocar a cada dia</div>
            <div class="muted gs-sub">Um tema diferente, automaticamente, todo dia.</div>
          </div>
          <button class="gs-switch ${rotating ? 'on' : ''}" data-act="toggle" aria-pressed="${rotating}"><span></span></button>
        </div>
        ${rotating ? `<div class="gs-today muted">Hoje: <b>${EMOJI[today] || ''} ${labelOf(themes, today)}</b> · amanhã: ${EMOJI[tomorrow] || ''} ${labelOf(themes, tomorrow)}</div>` : ''}
      </div>`;

    const rows = themes.map((t) => {
      const inPool = pool.includes(t.name);
      const isFixed = !rotating && current === t.name;
      const mark = rotating
        ? `<span class="gs-check ${inPool ? 'on' : ''}" data-act="pool" data-name="${t.name}">${inPool ? '✓' : ''}</span>`
        : `<span class="gs-radio ${isFixed ? 'on' : ''}" data-act="fix" data-name="${t.name}"></span>`;
      return `<div class="gs-theme">${mark}
        <span class="gs-swatch" style="--c:${t.accent || '#888'}"></span>
        <span class="gs-name">${EMOJI[t.name] || ''} ${t.label}</span>
        <button class="btn ghost gs-see" data-act="see" data-name="${t.name}">Ver</button></div>`;
    }).join('');

    const ap = appearance();
    const apSeg = APPEARANCES.map((o) =>
      `<button class="${ap === o.id ? 'on' : ''}" data-act="appearance" data-name="${o.id}">${o.label}</button>`).join('');

    root.innerHTML = `
      <h1>Ajustes</h1>
      <div class="section-title">Aparência</div>
      <div class="gs-card">
        <div class="gs-title">Tema do app</div>
        <div class="muted gs-sub">“Sistema” segue o aparelho; Claro/Escuro fixam neste aparelho.</div>
        <div class="gs-seg">${apSeg}</div>
      </div>
      <div class="section-title">Tela de entrada</div>
      <p class="muted" style="margin:-2px 0 12px;font-size:.85rem">O “selo” que aparece quando você abre o bisa.</p>
      ${toggle}
      <div class="section-title">${rotating ? 'Temas na rotação' : 'Tema fixo'}</div>
      <div class="gs-card gs-list">${rows}</div>`;

    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act, name = b.dataset.name;
        if (act === 'appearance') { setAppearance(name); render(root); return; }
        if (act === 'see') { GATE.preview(name); return; }
        if (act === 'toggle') GATE.setRotation(!rotating);
        else if (act === 'fix') GATE.setTheme(name);
        else if (act === 'pool') {
          let p = pool.slice();
          if (p.includes(name)) {
            if (p.length <= 1) { G.toast('Deixe ao menos um tema na rotação.'); return; }
            p = p.filter((n) => n !== name);
          } else p.push(name);
          GATE.setPool(p.length === themes.length ? [] : p);  // todos → [] (= todos)
        }
        render(root);
      });
    });
  }

  // --- Notifications (Web Push) — precisa de HTTPS + PWA instalada no iOS.
  // Estado re-checado a cada mount: o iOS descarta subscriptions em silêncio;
  // se a permissão está dada mas a subscription sumiu, re-inscreve sozinho.
  const b64ToU8 = (b64) => {
    const fill = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + fill).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  async function subscribePush(reg) {
    const { key } = await G.api('/push/vapid-key');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToU8(key),
    });
    await G.api('/push/subscribe', { method: 'POST', json: { subscription: sub.toJSON() } });
  }

  async function renderPushCard(container) {
    container.innerHTML = `
      <div class="section-title">Notifications</div>
      <div class="gs-card">
        <div class="gs-row">
          <div>
            <div class="gs-title">Push notifications</div>
            <div class="muted gs-sub" data-push="status">Checking…</div>
          </div>
          <button class="btn" data-push="enable" style="min-height:40px">Enable</button>
        </div>
        <div class="gs-row" style="margin-top:10px">
          <div class="muted gs-sub">Native alerts for Slack mentions/DMs and reminders.</div>
          <button class="btn ghost" data-push="test" style="min-height:40px">Send test</button>
        </div>
      </div>`;
    const statusEl = container.querySelector('[data-push="status"]');
    const enableBtn = container.querySelector('[data-push="enable"]');
    const testBtn = container.querySelector('[data-push="test"]');

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported || !window.isSecureContext) {
      statusEl.textContent = 'Not available here — open the app from its HTTPS address and add it to the Home Screen.';
      enableBtn.disabled = true;
      testBtn.disabled = true;
      return;
    }

    const refresh = async () => {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (Notification.permission === 'granted' && !sub) {
        // permissão ok mas o iOS descartou a subscription → re-inscreve
        try { await subscribePush(reg); sub = await reg.pushManager.getSubscription(); } catch {}
      }
      if (Notification.permission === 'denied') {
        statusEl.textContent = 'Blocked in system settings for this app.';
        enableBtn.disabled = true;
      } else if (sub) {
        statusEl.textContent = 'Enabled on this device.';
        enableBtn.textContent = 'Enabled ✓';
        enableBtn.disabled = true;
      } else {
        statusEl.textContent = 'Off. Tap Enable to get alerts on this device.';
        enableBtn.disabled = false;
      }
    };

    enableBtn.onclick = async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { G.toast('Permission not granted.'); return; }
        await subscribePush(await navigator.serviceWorker.ready);
        G.toast('Push notifications enabled 🎉');
      } catch (e) {
        G.toast(`⚠ ${e.message}`);
      }
      refresh();
    };
    testBtn.onclick = async () => {
      try {
        const r = await G.api('/push/test', { method: 'POST' });
        G.toast(`Test sent to ${r.subs} device(s).`);
      } catch (e) { G.toast(`⚠ ${e.message}`); }
    };
    refresh().catch(() => { statusEl.textContent = 'Could not check push state.'; });
  }

  // --- Saúde & custos: gasto de API do mês (budget que já existia sem tela)
  // + status dos LaunchAgents da stack de voz (stt/stt-en/tts) e do servidor.
  async function renderHealthCard(container) {
    container.innerHTML = '<div class="section-title">Saúde & custos</div><div class="gs-card"><div class="muted gs-sub">Carregando…</div></div>';
    try {
      const h = await G.api('/ajustes/health');
      const pct = h.api.budgetUsd ? Math.min(100, Math.round(100 * h.api.monthUsd / h.api.budgetUsd)) : 0;
      const rows = h.agents.map((a) =>
        `<div class="gs-row" style="margin-top:6px"><span class="gs-sub">${a.up ? '🟢' : '🔴'} ${a.label}</span></div>`).join('');
      container.innerHTML = `
        <div class="section-title">Saúde & custos</div>
        <div class="gs-card">
          <div class="gs-title">API Anthropic${h.api.keyPresent ? '' : ' — sem chave (fallback claude -p)'}</div>
          <div class="muted gs-sub">US$ ${h.api.monthUsd.toFixed(2)} de US$ ${h.api.budgetUsd} no mês (${pct}%)</div>
          <div style="height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden;margin-top:8px"><div style="height:100%;width:${pct}%;background:var(--primary)"></div></div>
          <div style="margin-top:12px">${rows}</div>
        </div>`;
    } catch (e) {
      container.innerHTML = `<div class="section-title">Saúde & custos</div><div class="gs-card"><div class="muted gs-sub">⚠ ${e.message}</div></div>`;
    }
  }

  function mount(pad) {
    injectStyle();
    const healthRoot = document.createElement('div');
    healthRoot.className = 'gate-settings';
    pad.appendChild(healthRoot);
    renderHealthCard(healthRoot);
    const pushRoot = document.createElement('div');
    pushRoot.className = 'gate-settings';
    pad.appendChild(pushRoot);
    renderPushCard(pushRoot);
    if (!GATE) { pad.appendChild(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Sistema de selos indisponível.' })); return; }
    const root = document.createElement('div');
    root.className = 'gate-settings';
    pad.appendChild(root);
    render(root);
  }

  window.BISA.screens['ajustes'] = { mount, unmount() {} };
})();
