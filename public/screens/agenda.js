// screens/agenda.js — 📅 Agenda: sub-aba do Biso (iPad) p/ o controle de
// agenda do dia (codex do biso via proxy /biso/codex/*) + vínculo com as
// reuniões gravadas pelo Ziggy (índice meetings/links.jsonl via /file).
// Padrão de módulo: window.BISO_AGENDA.mount/unmount (igual fit.js).
(() => {
  const $id = (s) => document.getElementById(s);
  let rootEl = null;
  let curDate = null; // 'YYYY-MM-DD'

  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const shiftDate = (iso, delta) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + delta);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };
  const labelFor = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const wd = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][dt.getDay()];
    return `${wd}, ${pad(d)}/${pad(m)}`;
  };
  const hm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const CSS = `
    .ag-wrap { max-width: 760px; margin: 0 auto; padding: 18px 16px 90px; }
    .ag-nav { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
    .ag-nav h2 { flex:1; margin:0; font-size:1.15rem; text-align:center; }
    .ag-nav button { min-width:44px; min-height:44px; border-radius:12px; border:1px solid var(--biso-line,#3333);
      background:transparent; color:inherit; font-size:1rem; }
    .ag-nav .ag-today { font-size:.8rem; padding:0 12px; }
    .ag-list { display:flex; flex-direction:column; }
    .ag-item { display:flex; align-items:center; gap:12px; padding:12px 4px; border-bottom:1px solid var(--biso-line,#3333); }
    .ag-item.past { opacity:.45; }
    .ag-item.fixed { opacity:.7; }
    .ag-time { font-family:ui-monospace,monospace; font-size:.85rem; min-width:52px; font-variant-numeric:tabular-nums; }
    .ag-text { flex:1; line-height:1.45; }
    .ag-tag { font-size:.72rem; opacity:.75; border:1px solid var(--biso-line,#3333); border-radius:999px; padding:1px 8px; margin-left:5px; white-space:nowrap; }
    .ag-rec-badge { font-size:.95rem; }
    .ag-del { min-width:40px; min-height:40px; border:none; background:transparent; color:inherit; opacity:.5; font-size:1.05rem; }
    .ag-fx { opacity:.6; font-size:.9rem; min-width:40px; text-align:center; }
    .ag-form { display:flex; gap:8px; margin:16px 0 26px; }
    .ag-form input[type=time] { width:105px; }
    .ag-form input { border:1px solid var(--biso-line,#3333); background:transparent; color:inherit;
      border-radius:12px; padding:11px 12px; font-size:.95rem; }
    .ag-form input[type=text] { flex:1; }
    .ag-form button { min-width:52px; border-radius:12px; border:1px solid var(--biso-line,#3333); background:transparent; color:inherit; font-size:1.2rem; }
    .ag-h4 { font-family:ui-monospace,monospace; font-size:.68rem; letter-spacing:.14em; text-transform:uppercase; opacity:.6; margin:22px 0 8px; }
    .ag-rec { border:1px solid var(--biso-line,#3333); border-radius:14px; padding:13px 14px; margin-bottom:12px; }
    .ag-rec-head { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; margin-bottom:6px; }
    .ag-rec-head b { font-size:.98rem; }
    .ag-rec-head time { font-family:ui-monospace,monospace; font-size:.78rem; opacity:.7; }
    .ag-rec-meta { font-family:ui-monospace,monospace; font-size:.7rem; opacity:.6; margin-top:7px; }
    .ag-rec-sum { font-size:.9rem; line-height:1.5; opacity:.9; }
    .ag-rec-btns { display:flex; gap:8px; margin-top:9px; }
    .ag-rec-btns button { border:1px solid var(--biso-line,#3333); background:transparent; color:inherit;
      border-radius:999px; padding:7px 14px; font-size:.82rem; }
    .ag-empty { opacity:.55; padding:14px 4px; font-size:.9rem; }
    .ag-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:600; display:flex; align-items:center; justify-content:center; padding:24px; }
    .ag-sheet { background:var(--biso-surface, var(--biso-bg, #fff)); color:var(--biso-ink, #222);
      border-radius:18px; max-width:760px; width:100%;
      max-height:82vh; display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--biso-line,#3333); }
    .ag-sheet header { display:flex; align-items:center; padding:12px 16px; border-bottom:1px solid var(--biso-line,#3333); }
    .ag-sheet header b { flex:1; font-size:.95rem; }
    .ag-sheet header button { border:none; background:transparent; color:inherit; font-size:1.15rem; min-width:44px; min-height:40px; }
    .ag-md { margin:0; padding:16px 20px; overflow:auto; -webkit-overflow-scrolling:touch;
      font-size:.95rem; line-height:1.6; }
    .ag-md h1 { font-size:1.15rem; margin:18px 0 8px; }
    .ag-md h2 { font-size:1rem; margin:18px 0 6px; border-top:1px solid var(--biso-line,#3333); padding-top:14px; }
    .ag-md ul { padding-left:22px; }
    .ag-md li { margin:3px 0; }
    .ag-md input[type=checkbox] { transform:scale(1.15); margin-right:6px; }
    .ag-md p { margin:8px 0; }
    .ag-md strong { color:var(--biso-primary, inherit); }
  `;

  async function fetchDay(date) {
    const r = await BISA.api(`/biso/codex/day?date=${date}`);
    return (r.day && r.day.sections && r.day.sections.agenda) || [];
  }
  async function fetchLinks(date) {
    try {
      const r = await BISA.api('/file?path=' + encodeURIComponent('meetings/links.jsonl'));
      return (r.content || '').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((x) => x && x.date === date);
    } catch { return []; } // sem gravações ainda
  }

  function showFile(title, relPath) {
    const ov = document.createElement('div'); ov.className = 'ag-overlay';
    const sheet = document.createElement('div'); sheet.className = 'ag-sheet';
    const head = document.createElement('header');
    const b = document.createElement('b'); b.textContent = title;
    const x = document.createElement('button'); x.textContent = '✕';
    x.addEventListener('click', () => ov.remove());
    head.append(b, x);
    const body = document.createElement('div'); body.className = 'ag-md';
    body.textContent = 'carregando…';
    sheet.append(head, body); ov.appendChild(sheet);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    // dentro do root do Biso: a folha herda as variáveis do tema ativo
    // (no body ela pegava cor do tema da página — texto invisível no escuro).
    ((rootEl && rootEl.closest('.biso-root')) || document.body).appendChild(ov);
    BISA.api('/file?path=' + encodeURIComponent(relPath))
      .then((r) => { body.innerHTML = BISA.renderMarkdown(r.content || '(vazio)'); })
      .catch((e) => { body.textContent = 'erro: ' + e.message; });
  }

  // Item de agenda com gravação por perto? (mesma janela do vínculo do bridge)
  const recFor = (item, links) => {
    if (!item.time) return null;
    const [h, m] = item.time.split(':').map(Number);
    return links.find((L) => {
      if (!L.start) return false;
      const s = new Date(L.start);
      const diff = (s.getHours() * 60 + s.getMinutes()) - (h * 60 + m);
      return diff >= -20 && diff <= 40;
    }) || null;
  };

  async function render() {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'ag-wrap';

    const nav = document.createElement('div'); nav.className = 'ag-nav';
    const prev = document.createElement('button'); prev.textContent = '‹';
    const next = document.createElement('button'); next.textContent = '›';
    const tdy = document.createElement('button'); tdy.className = 'ag-today'; tdy.textContent = 'hoje';
    const h2 = document.createElement('h2'); h2.textContent = labelFor(curDate) + (curDate === todayISO() ? ' · hoje' : '');
    prev.addEventListener('click', () => { curDate = shiftDate(curDate, -1); render(); });
    next.addEventListener('click', () => { curDate = shiftDate(curDate, 1); render(); });
    tdy.addEventListener('click', () => { curDate = todayISO(); render(); });
    nav.append(prev, h2, next, tdy);
    wrap.appendChild(nav);

    // formulário de novo lembrete (grava no codex do biso, mesma agenda do browser)
    const form = document.createElement('form'); form.className = 'ag-form';
    const inTime = document.createElement('input'); inTime.type = 'time';
    const inText = document.createElement('input'); inText.type = 'text';
    inText.placeholder = 'novo lembrete…'; inText.maxLength = 200;
    const add = document.createElement('button'); add.type = 'submit'; add.textContent = '+';
    form.append(inTime, inText, add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = inText.value.trim();
      if (!text) return;
      try {
        await BISA.api('/biso/codex/append', { method: 'POST', json: { section: 'agenda', item: { text, time: inTime.value || '' }, date: curDate } });
        inText.value = ''; inTime.value = '';
        render();
      } catch (err) { alert('erro: ' + err.message); }
    });
    wrap.appendChild(form);

    const list = document.createElement('div'); list.className = 'ag-list';
    wrap.appendChild(list);
    const recH = document.createElement('div'); recH.className = 'ag-h4'; recH.textContent = '🎧 reuniões gravadas no dia';
    const recBox = document.createElement('div');

    let items = [], links = [];
    try { [items, links] = await Promise.all([fetchDay(curDate), fetchLinks(curDate)]); }
    catch (e) { list.innerHTML = `<p class="ag-empty">erro ao carregar: ${esc(e.message)}</p>`; rootEl.appendChild(wrap); return; }

    const now = new Date(); const nowHM = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const sorted = [...items.filter((x) => x.time).sort((a, b) => a.time.localeCompare(b.time)), ...items.filter((x) => !x.time)];
    if (!sorted.length) list.innerHTML = '<p class="ag-empty">nada agendado neste dia.</p>';
    for (const item of sorted) {
      const li = document.createElement('div');
      li.className = 'ag-item' + (item.fixed ? ' fixed' : '') + (curDate < todayISO() || (curDate === todayISO() && item.time && item.time < nowHM) ? ' past' : '');
      const tm = document.createElement('span'); tm.className = 'ag-time'; tm.textContent = item.time || '—';
      const tx = document.createElement('span'); tx.className = 'ag-text';
      const tags = item.text.match(/#[\w/-]+/g) || [];
      tx.textContent = item.text.replace(/#[\w/-]+/g, '').replace(/\s{2,}/g, ' ').trim();
      for (const tg of tags) { const c = document.createElement('span'); c.className = 'ag-tag'; c.textContent = tg; tx.appendChild(c); }
      li.append(tm, tx);
      const rec = recFor(item, links);
      if (rec) { const b = document.createElement('span'); b.className = 'ag-rec-badge'; b.title = 'reunião gravada'; b.textContent = '🎧'; li.appendChild(b); }
      if (item.fixed) {
        const fx = document.createElement('span'); fx.className = 'ag-fx'; fx.textContent = '↻'; fx.title = 'fixa semanal (codex/agenda-fixa.json)';
        li.appendChild(fx);
      } else {
        const del = document.createElement('button'); del.className = 'ag-del'; del.textContent = '✕'; del.title = 'remover';
        del.addEventListener('click', async () => {
          if (!confirm('Remover "' + item.text + '"?')) return;
          try { await BISA.api('/biso/codex/item', { method: 'DELETE', json: { id: item.id, date: curDate } }); render(); }
          catch (err) { alert('erro: ' + err.message); }
        });
        li.appendChild(del);
      }
      list.appendChild(li);
    }

    // gravações do dia (com ou sem vínculo de agenda)
    wrap.append(recH, recBox);
    if (!links.length) recBox.innerHTML = '<p class="ag-empty">' + (curDate > todayISO() ? 'dia ainda não chegou.' : 'nenhuma gravação neste dia.') + '</p>';
    for (const L of links) {
      const card = document.createElement('div'); card.className = 'ag-rec';
      const head = document.createElement('div'); head.className = 'ag-rec-head';
      const b = document.createElement('b');
      b.textContent = L.title ? `🎧 ${L.title}` : '🎧 reunião (sem vínculo de agenda)';
      const tspan = document.createElement('time');
      tspan.textContent = (L.start ? hm(L.start) : '?') + '–' + (L.end ? hm(L.end) : '?');
      head.append(b, tspan);
      for (const tg of L.tags || []) { const c = document.createElement('span'); c.className = 'ag-tag'; c.textContent = tg; head.appendChild(c); }
      const sum = document.createElement('div'); sum.className = 'ag-rec-sum'; sum.textContent = L.resumo || '';
      const meta = document.createElement('div'); meta.className = 'ag-rec-meta';
      meta.textContent = `${L.digests} digests · ${L.segs} blocos · ${L.acoes} ações`;
      const btns = document.createElement('div'); btns.className = 'ag-rec-btns';
      const bAta = document.createElement('button'); bAta.textContent = '📄 ata';
      bAta.addEventListener('click', () => showFile('Ata — ' + L.date, L.ata));
      btns.appendChild(bAta);
      if (L.acoesFile) {
        const bAc = document.createElement('button'); bAc.textContent = '☑️ ações';
        bAc.addEventListener('click', () => showFile('Ações — ' + L.date, L.acoesFile));
        btns.appendChild(bAc);
      }
      card.append(head, sum, meta, btns);
      recBox.appendChild(card);
    }

    rootEl.appendChild(wrap);
  }

  window.BISO_AGENDA = {
    mount(el) {
      if (!$id('ag-style')) {
        const st = document.createElement('style'); st.id = 'ag-style'; st.textContent = CSS;
        document.head.appendChild(st);
      }
      const sc = document.createElement('div'); sc.className = 'biso-scroll';
      el.appendChild(sc);
      rootEl = sc;
      curDate = curDate || todayISO();
      render();
    },
    unmount() { rootEl = null; },
  };
})();
