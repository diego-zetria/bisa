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
      .gate-settings .gs-see { min-height:36px; padding:0 14px; font-size:.85rem; }`;
    document.head.appendChild(s);
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

    root.innerHTML = `
      <h1>Tela de entrada</h1>
      <p class="muted" style="margin:-6px 0 16px">O “selo” que aparece quando você abre o bisa.</p>
      ${toggle}
      <div class="section-title">${rotating ? 'Temas na rotação' : 'Tema fixo'}</div>
      <div class="gs-card gs-list">${rows}</div>`;

    root.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act, name = b.dataset.name;
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

  function mount(pad) {
    if (!GATE) { pad.innerHTML = '<p class="empty">Sistema de selos indisponível.</p>'; return; }
    injectStyle();
    const root = document.createElement('div');
    root.className = 'gate-settings';
    pad.appendChild(root);
    render(root);
  }

  window.BISA.screens['ajustes'] = { mount, unmount() {} };
})();
