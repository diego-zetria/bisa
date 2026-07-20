// screens/finance-dash.js — Dashboards interativos de finanças (2026-07-19).
// Aberto pelo botão 📊 da tela de finanças (window.FIN_DASH.render). Estética
// "Claude design": ivory + terracotta, números em serifa editorial, cards
// planos com linha fina. Gráficos SVG à mão (sem lib), método do skill
// dataviz: paleta categórica VALIDADA (validate_palette.js, light #FAF9F5 e
// dark #1F1E1B — ambas passam; CVD 6-8 coberto por rótulos diretos + gaps),
// marcas finas, gaps de 2px, tooltip por marca, um eixo só, status nunca só
// por cor (ícone/texto junto).
//
// Dados: GET /finance/dash?months=N (agregados por mês) + GET /finance/summary
// ?month= (drill por transação, cacheado). Interações: período 3/6/12m,
// tocar um mês no fluxo → foca o mês inteiro; tocar envelope/categoria →
// painel de lançamentos.
(function () {
  'use strict';

  // ── Tokens (Claude design) + paletas validadas ────────────────────────────
  const THEME = {
    light: {
      bg: '#FAF9F5', card: '#FFFFFF', line: '#E8E4DA', ink: '#141413',
      muted: '#6E6A5E', accent: '#C15F3C', track: '#F0EDE5', tipBg: '#141413', tipInk: '#FAF9F5',
      cat: ['#C15F3C', '#3E7CB8', '#A87F10', '#9C5D9E', '#6C8C43', '#B34A6B'],
      other: '#8A8778', income: '#3E7CB8', expense: '#C15F3C',
      good: '#2F7D53', warn: '#A87F10', bad: '#B3362A',
    },
    dark: {
      bg: '#1F1E1B', card: '#262624', line: '#3A3733', ink: '#F0EEE7',
      muted: '#A8A395', accent: '#D9764E', track: '#31302C', tipBg: '#F0EEE7', tipInk: '#1F1E1B',
      cat: ['#D9764E', '#5E93CE', '#B58910', '#AF6BB1', '#7A9E4C', '#C9587D'],
      other: '#7A776C', income: '#5E93CE', expense: '#D9764E',
      good: '#4C9A6E', warn: '#B58910', bad: '#CC5A4C',
    },
  };
  const BUCKETS = [
    { id: 'custo-fixo', label: 'Custo fixo' },
    { id: 'conforto', label: 'Conforto' },
    { id: 'liberdade', label: 'Liberdade' },
    { id: 'metas', label: 'Metas' },
    { id: 'prazeres', label: 'Prazeres' },
    { id: 'conhecimento', label: 'Conhecimento' },
  ];
  const DEFAULT_ALLOC = { 'custo-fixo': 30, conforto: 15, liberdade: 25, metas: 15, prazeres: 10, conhecimento: 5 };
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const brl = (v, cents) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', cents
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
  const mLabel = (m, long) => { const [y, mm] = m.split('-'); const nm = MES[+mm - 1]; return long ? `${nm}/${y.slice(2)}` : nm; };
  const catLabel = (c) => (c || 'sem categoria').replace(/-/g, ' ');

  // ── Estilos (escopo .fin-dash, injeta uma vez) ────────────────────────────
  if (!document.getElementById('fin-dash-style')) {
    const s = document.createElement('style');
    s.id = 'fin-dash-style';
    s.textContent = `
      .fin-dash { --fd-bg:#FAF9F5; --fd-card:#FFFFFF; --fd-line:#E8E4DA; --fd-ink:#141413;
        --fd-muted:#6E6A5E; --fd-accent:#C15F3C; --fd-track:#F0EDE5;
        --fd-serif:"Tiempos Text","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
        background:var(--fd-bg); color:var(--fd-ink); margin:0 -4px; padding:2px 4px 40px;
        font-variant-numeric:tabular-nums; }
      .fin-dash.dark { --fd-bg:#1F1E1B; --fd-card:#262624; --fd-line:#3A3733; --fd-ink:#F0EEE7;
        --fd-muted:#A8A395; --fd-accent:#D9764E; --fd-track:#31302C; }

      /* cabeçalho editorial */
      .fd-head { display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; margin:6px 2px 18px; }
      .fd-title { font-family:var(--fd-serif); font-size:1.9rem; font-weight:600; letter-spacing:-.015em; margin:0; }
      .fd-title em { font-style:italic; color:var(--fd-accent); }
      .fd-head .spacer { flex:1; }
      .fd-seg { display:flex; border:1px solid var(--fd-line); border-radius:999px; overflow:hidden;
        background:var(--fd-card); }
      .fd-seg button { background:none; border:none; padding:8px 16px; min-height:40px; cursor:pointer;
        font-size:.82rem; color:var(--fd-muted); letter-spacing:.04em; }
      .fd-seg button.on { background:var(--fd-ink); color:var(--fd-bg); }

      .fd-kicker { font-size:.66rem; text-transform:uppercase; letter-spacing:.16em;
        color:var(--fd-muted); font-weight:600; }

      /* grade */
      .fd-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:14px; }
      .fd-grid { display:grid; gap:14px; }
      @media (min-width:900px) { .fd-grid { grid-template-columns:1fr 1fr; } .fd-span2 { grid-column:1 / -1; } }

      .fd-card { background:var(--fd-card); border:1px solid var(--fd-line); border-radius:16px;
        padding:16px 18px; min-width:0; }
      .fd-card-head { display:flex; align-items:baseline; gap:10px; margin-bottom:10px; }
      .fd-card-title { font-family:var(--fd-serif); font-size:1.08rem; font-weight:600; margin:0; }
      .fd-card-sub { font-size:.76rem; color:var(--fd-muted); margin-left:auto; }

      /* stat tiles — número herói em serifa */
      .fd-tile .fd-kicker { display:block; margin-bottom:6px; }
      .fd-tile-v { font-family:var(--fd-serif); font-size:1.72rem; font-weight:600; line-height:1.05;
        letter-spacing:-.02em; }
      .fd-tile-v.accent { color:var(--fd-accent); }
      .fd-tile-d { font-size:.74rem; color:var(--fd-muted); margin-top:5px; }
      .fd-tile-d b { font-weight:600; }

      /* legenda */
      .fd-legend { display:flex; gap:16px; flex-wrap:wrap; font-size:.78rem; color:var(--fd-muted); margin-top:8px; }
      .fd-legend .it { display:flex; align-items:center; gap:6px; }
      .fd-legend .sw { width:10px; height:10px; border-radius:3px; }

      svg.fd-svg { display:block; width:100%; height:auto; }
      svg.fd-svg text { font-family:inherit; }
      .fd-hit { cursor:pointer; }

      /* envelopes */
      .fd-env { display:flex; flex-direction:column; gap:4px; padding:9px 2px; border-radius:10px; cursor:pointer; }
      .fd-env:active { background:var(--fd-track); }
      .fd-env-top { display:flex; align-items:baseline; gap:8px; font-size:.86rem; }
      .fd-env-top .nm { display:flex; align-items:center; gap:7px; font-weight:600; }
      .fd-env-top .sw { width:10px; height:10px; border-radius:3px; }
      .fd-env-top .vals { margin-left:auto; font-size:.78rem; color:var(--fd-muted); }
      .fd-env-top .vals b { color:var(--fd-ink); font-weight:600; }
      .fd-env-badge { font-size:.68rem; font-weight:600; padding:1px 8px; border-radius:999px; }
      .fd-env-track { position:relative; height:12px; border-radius:999px; background:var(--fd-track); overflow:hidden; }
      .fd-env-fill { position:absolute; inset:0 auto 0 0; border-radius:999px; transition:width .45s cubic-bezier(.22,.8,.3,1); }
      .fd-env-over { position:absolute; inset:0 0 0 auto; border-radius:0 999px 999px 0; }

      /* donut + legenda com valores */
      .fd-donut-wrap { display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
      .fd-donut-wrap svg { flex:0 0 190px; }
      .fd-donut-legend { flex:1; min-width:200px; display:flex; flex-direction:column; }
      .fd-dl-row { display:flex; align-items:center; gap:9px; padding:7px 6px; border-radius:9px;
        font-size:.85rem; cursor:pointer; min-height:38px; }
      .fd-dl-row:active { background:var(--fd-track); }
      .fd-dl-row .sw { width:10px; height:10px; border-radius:3px; flex:0 0 auto; }
      .fd-dl-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .fd-dl-row .v { font-weight:600; }
      .fd-dl-row .p { color:var(--fd-muted); font-size:.74rem; width:38px; text-align:right; }

      /* sparklines (pequenos múltiplos) */
      .fd-sparks { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
      .fd-spark { border:1px solid var(--fd-line); border-radius:12px; padding:10px 12px 6px; cursor:pointer; }
      .fd-spark:active { background:var(--fd-track); }
      .fd-spark .nm { font-size:.78rem; font-weight:600; margin-bottom:2px; display:flex; align-items:center; gap:6px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .fd-spark .nm .sw { width:8px; height:8px; border-radius:2px; flex:0 0 auto; }
      .fd-spark .tot { font-family:var(--fd-serif); font-size:1.05rem; font-weight:600; }

      /* drill (lançamentos) */
      .fd-drill-head { display:flex; align-items:center; gap:10px; }
      .fd-drill-x { margin-left:auto; background:none; border:1px solid var(--fd-line); border-radius:999px;
        min-width:34px; min-height:34px; cursor:pointer; color:var(--fd-muted); font-size:.9rem; }
      .fd-tx { display:flex; align-items:center; gap:10px; padding:10px 2px; border-bottom:1px solid var(--fd-line);
        font-size:.88rem; }
      .fd-tx:last-child { border-bottom:none; }
      .fd-tx .d { color:var(--fd-muted); font-size:.76rem; width:44px; flex:0 0 auto; }
      .fd-tx .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .fd-tx .bk { font-size:.68rem; color:var(--fd-muted); border:1px solid var(--fd-line);
        border-radius:999px; padding:1px 8px; flex:0 0 auto; }
      .fd-tx .v { font-weight:600; flex:0 0 auto; }
      .fd-empty { color:var(--fd-muted); font-size:.86rem; padding:14px 2px; }

      /* tooltip por marca */
      .fd-tip { position:fixed; z-index:80; pointer-events:none; padding:7px 11px; border-radius:9px;
        font-size:.78rem; line-height:1.45; box-shadow:0 6px 20px rgba(0,0,0,.22); opacity:0;
        transition:opacity .12s; max-width:240px; }
      .fd-tip.show { opacity:1; }

      /* entrada suave dos cards */
      @media (prefers-reduced-motion: no-preference) {
        .fin-dash .fd-card, .fin-dash .fd-tile { animation:fd-in .45s cubic-bezier(.22,.8,.3,1) both; }
        .fin-dash .fd-card:nth-child(2) { animation-delay:.05s; }
        .fin-dash .fd-card:nth-child(3) { animation-delay:.1s; }
        .fin-dash .fd-card:nth-child(4) { animation-delay:.15s; }
        @keyframes fd-in { from { opacity:0; transform:translateY(10px); } }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Estado do board ───────────────────────────────────────────────────────
  const state = {
    host: null, opts: {}, t: THEME.light,
    range: 6, data: null, focus: null,           // focus = 'YYYY-MM'
    drill: null,                                  // { kind:'cat'|'bucket', id }
    sumCache: {},                                 // month → summary (drill)
  };

  let tipEl = null;
  const tip = (html, x, y) => {
    if (!tipEl) { tipEl = el('div', 'fd-tip'); document.body.appendChild(tipEl); }
    tipEl.style.background = state.t.tipBg; tipEl.style.color = state.t.tipInk;
    tipEl.innerHTML = html;
    tipEl.classList.add('show');
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    tipEl.style.top = Math.max(8, y - h - 14) + 'px';
  };
  const hideTip = () => { if (tipEl) tipEl.classList.remove('show'); };

  // hover + toque na mesma marca: pointerenter/move mostra, leave esconde,
  // click executa a ação de drill (quando houver)
  const wireMark = (node, html, onTap) => {
    node.classList.add('fd-hit');
    node.addEventListener('pointerenter', (e) => tip(html(), e.clientX, e.clientY));
    node.addEventListener('pointermove', (e) => tip(html(), e.clientX, e.clientY));
    node.addEventListener('pointerleave', hideTip);
    if (onTap) node.addEventListener('click', () => { hideTip(); onTap(); });
  };

  // ── Dados ─────────────────────────────────────────────────────────────────
  async function load() {
    state.data = await BISA.api('/finance/dash?months=' + state.range);
    const months = state.data.months || [];
    if (!months.find((r) => r.month === state.focus)) {
      state.focus = (months[months.length - 1] || {}).month || null;
    }
  }
  const focused = () => (state.data.months || []).find((r) => r.month === state.focus) || null;
  const prevRow = () => {
    const ms = state.data.months || [];
    const i = ms.findIndex((r) => r.month === state.focus);
    return i > 0 ? ms[i - 1] : null;
  };
  // cor por entidade (categoria): ranking FIXO pelo total do período inteiro —
  // trocar o mês focado não repinta ninguém (regra do dataviz)
  const catRank = () => {
    const tot = {};
    for (const r of state.data.months || []) {
      for (const [c, v] of Object.entries(r.byCategory || {})) tot[c] = (tot[c] || 0) + v;
    }
    return Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  };
  const catColor = (c) => {
    const i = catRank().indexOf(c);
    return i >= 0 && i < 5 ? state.t.cat[i] : state.t.other;
  };

  // ── Render raiz ───────────────────────────────────────────────────────────
  async function render(host, opts) {
    state.host = host; state.opts = opts || {};
    state.t = opts && opts.dark ? THEME.dark : THEME.light;
    if (opts && opts.month) state.focus = opts.month;
    host.innerHTML = '';
    const root = el('div', 'fin-dash' + (opts && opts.dark ? ' dark' : ''));
    host.appendChild(root);
    root.appendChild(el('div', 'fd-empty', 'carregando dashboards…'));
    try { await load(); } catch (e) {
      root.innerHTML = ''; root.appendChild(el('div', 'fd-empty', '⚠ ' + esc(e.message))); return;
    }
    paint(root);
  }

  function repaint() {
    const root = state.host && state.host.querySelector('.fin-dash');
    if (root) paint(root);
  }

  function paint(root) {
    root.innerHTML = '';
    const f = focused();

    // cabeçalho
    const head = el('div', 'fd-head');
    const back = el('button', 'fin-back-btn', '←');
    back.onclick = () => { hideTip(); state.opts.onExit && state.opts.onExit(); };
    head.appendChild(back);
    head.appendChild(el('h2', 'fd-title', `Finanças <em>·</em> ${f ? esc(mLabel(f.month, true)) : ''}`));
    head.appendChild(el('span', 'spacer'));
    const seg = el('div', 'fd-seg');
    [3, 6, 12].forEach((n) => {
      const b = el('button', state.range === n ? 'on' : '', n + 'm');
      b.onclick = async () => { state.range = n; await load(); repaint(); };
      seg.appendChild(b);
    });
    head.appendChild(seg);
    root.appendChild(head);

    if (!f) { root.appendChild(el('div', 'fd-empty', 'Nenhum lançamento no período ainda.')); return; }

    root.appendChild(tiles(f, prevRow()));

    const grid = el('div', 'fd-grid');
    grid.appendChild(cashflowCard());
    const right = el('div');
    right.style.cssText = 'display:flex;flex-direction:column;gap:14px;min-width:0;';
    right.appendChild(envelopesCard(f));
    grid.appendChild(right);
    grid.appendChild(donutCard(f));
    grid.appendChild(sparksCard());
    root.appendChild(grid);

    if (state.drill) drillCard(f).then((card) => { if (card && state.drill) grid.appendChild(card); });
  }

  // ── Stat tiles ────────────────────────────────────────────────────────────
  function tiles(f, prev) {
    const wrap = el('div', 'fd-tiles');
    const rate = f.income > 0 ? Math.round((f.net / f.income) * 100) : null;
    const delta = (cur, old, invert) => {
      if (!prev || !(old > 0)) return '';
      const d = Math.round(((cur - old) / old) * 100);
      if (!d) return '<b>=</b> vs mês anterior';
      const up = d > 0;
      const good = invert ? !up : up;
      return `<b style="color:${good ? state.t.good : state.t.bad}">${up ? '▲' : '▼'} ${Math.abs(d)}%</b> vs mês anterior`;
    };
    const tile = (kicker, val, cls, sub) => {
      const c = el('div', 'fd-card fd-tile');
      c.innerHTML = `<span class="fd-kicker">${kicker}</span>` +
        `<div class="fd-tile-v ${cls || ''}">${val}</div>` +
        (sub ? `<div class="fd-tile-d">${sub}</div>` : '');
      return c;
    };
    wrap.appendChild(tile('Saldo do mês', brl(f.net), f.net < 0 ? 'accent' : '',
      rate == null ? '' : `guardou <b>${rate}%</b> da renda`));
    wrap.appendChild(tile('Entrou', brl(f.income), '', delta(f.income, prev && prev.income)));
    wrap.appendChild(tile('Saiu', brl(f.expense), '', delta(f.expense, prev && prev.expense, true)));
    const nCat = Object.keys(f.byCategory || {}).length;
    const top = Object.entries(f.byCategory || {}).sort((a, b) => b[1] - a[1])[0];
    wrap.appendChild(tile('Maior categoria', top ? esc(catLabel(top[0])) : '—', '',
      top ? `${brl(top[1])} · ${nCat} categoria${nCat === 1 ? '' : 's'}` : 'sem gastos'));
    return wrap;
  }

  // ── Fluxo de caixa (barras pareadas por mês, 1 eixo) ─────────────────────
  function cashflowCard() {
    const t = state.t, ms = state.data.months || [];
    const card = el('div', 'fd-card fd-span2');
    const hd = el('div', 'fd-card-head');
    hd.appendChild(el('h3', 'fd-card-title', 'Fluxo de caixa'));
    hd.appendChild(el('span', 'fd-card-sub', 'toque num mês para focar'));
    card.appendChild(hd);

    const W = 760, H = 240, padL = 52, padR = 10, padT = 14, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const max = Math.max(1, ...ms.map((r) => Math.max(r.income, r.expense)));
    const yScale = (v) => padT + ih - (v / max) * ih;
    const slot = iw / ms.length;
    const bw = Math.min(26, Math.max(8, slot / 2 - 6));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'fd-svg');
    // clip: as barras descem 4px além da base p/ o rx só arredondar o topo
    const uid = 'fdclip' + Math.random().toString(36).slice(2, 7);
    let defs = `<defs><clipPath id="${uid}"><rect x="0" y="0" width="${W}" height="${padT + ih}"/></clipPath></defs>`;
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = (max / 3) * i, y = yScale(v);
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="${t.line}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="${t.muted}">${v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + 'k' : Math.round(v)}</text>`;
    }
    svg.innerHTML = defs + grid;

    ms.forEach((r, i) => {
      const cx = padL + slot * i + slot / 2;
      const on = r.month === state.focus;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const dim = on ? 1 : 0.5;
      const yIn = yScale(r.income), yOut = yScale(r.expense);
      g.innerHTML =
        (on ? `<rect x="${cx - slot / 2 + 2}" y="${padT - 6}" width="${slot - 4}" height="${ih + 10}" rx="9" fill="${t.track}" opacity=".55"/>` : '') +
        `<g clip-path="url(#${uid})">` +
        `<rect x="${cx - bw - 1}" y="${yIn}" width="${bw}" height="${padT + ih - yIn + 4}" rx="4" fill="${t.income}" opacity="${dim}"/>` +
        `<rect x="${cx + 1}" y="${yOut}" width="${bw}" height="${padT + ih - yOut + 4}" rx="4" fill="${t.expense}" opacity="${dim}"/>` +
        `</g>` +
        (on && r.income > 0 ? `<text x="${cx - bw / 2 - 1}" y="${yIn - 5}" text-anchor="middle" font-size="10" font-weight="600" fill="${t.ink}">${(r.income / 1000).toFixed(1).replace('.', ',')}k</text>` : '') +
        (on && r.expense > 0 ? `<text x="${cx + bw / 2 + 1}" y="${yOut - 5}" text-anchor="middle" font-size="10" font-weight="600" fill="${t.ink}">${(r.expense / 1000).toFixed(1).replace('.', ',')}k</text>` : '') +
        `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${on ? t.ink : t.muted}" ${on ? 'font-weight="700"' : ''}>${mLabel(r.month)}</text>` +
        `<rect x="${cx - slot / 2}" y="0" width="${slot}" height="${H}" fill="transparent"/>`;
      wireMark(g, () =>
        `<b>${mLabel(r.month, true)}</b><br>entrou ${brl(r.income, true)}<br>saiu ${brl(r.expense, true)}<br>saldo <b>${brl(r.net, true)}</b>`,
        () => { state.focus = r.month; state.drill = null; repaint(); });
      svg.appendChild(g);
    });
    card.appendChild(svg);

    const lg = el('div', 'fd-legend');
    lg.innerHTML = `<span class="it"><span class="sw" style="background:${t.income}"></span>entrou</span>` +
      `<span class="it"><span class="sw" style="background:${t.expense}"></span>saiu</span>`;
    card.appendChild(lg);
    return card;
  }

  // ── Envelopes AUVP (gasto vs alvo do mês focado) ─────────────────────────
  function envelopesCard(f) {
    const t = state.t;
    const card = el('div', 'fd-card');
    const hd = el('div', 'fd-card-head');
    hd.appendChild(el('h3', 'fd-card-title', 'Envelopes'));
    hd.appendChild(el('span', 'fd-card-sub', 'alvo AUVP do mês'));
    card.appendChild(hd);

    // alvo: fixa em R$ > "resto da renda" (allocationRest) > % da renda —
    // mesma precedência do card de envelopes da tela principal (devoOf)
    const alloc = state.data.allocation || DEFAULT_ALLOC;
    const fixed = state.data.allocationFixed || {};
    const restId = state.data.allocationRest || null;
    const targetOf = (id, income) => {
      if (fixed[id] != null) return fixed[id];
      if (id === restId) {
        const outras = BUCKETS.filter((b) => b.id !== id).reduce((s, b) =>
          s + (fixed[b.id] != null ? fixed[b.id] : (income * (Number(alloc[b.id]) || 0)) / 100), 0);
        return Math.max(0, income - outras);
      }
      return (income * (Number(alloc[id]) || 0)) / 100;
    };
    BUCKETS.forEach((b, i) => {
      const spent = (f.byBucket || {})[b.id] || 0;
      const target = targetOf(b.id, f.income);
      const pct = target > 0 ? spent / target : (spent > 0 ? 2 : 0);
      // liberdade é APORTE (dinheiro guardado): passar do alvo é vitória, não
      // estouro — valor em verde e excedente verde (feedback 2026-07-19)
      const saving = b.id === 'liberdade';
      const over = pct > 1, near = !saving && !over && pct >= 0.85;
      const row = el('div', 'fd-env');
      const badge = over
        ? (saving
          ? `<span class="fd-env-badge" style="color:${t.good};border:1px solid ${t.good}">✓ acima da meta</span>`
          : `<span class="fd-env-badge" style="color:${t.bad};border:1px solid ${t.bad}">⚠ estourou</span>`)
        : near ? `<span class="fd-env-badge" style="color:${t.warn};border:1px solid ${t.warn}">◔ quase</span>` : '';
      row.innerHTML =
        `<div class="fd-env-top"><span class="nm"><span class="sw" style="background:${t.cat[i]}"></span>${b.label}</span>${badge}` +
        `<span class="vals"><b${saving ? ` style="color:${t.good}"` : ''}>${brl(spent)}</b>${target > 0 ? ' / ' + brl(target) : ''}</span></div>` +
        `<div class="fd-env-track">` +
        `<div class="fd-env-fill" style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${t.cat[i]}"></div>` +
        (over ? `<div class="fd-env-over" style="width:${Math.min(28, (pct - 1) * 100).toFixed(1)}%;background:${saving ? t.good : t.bad}"></div>` : '') +
        `</div>`;
      wireMark(row, () =>
        `<b>${b.label}</b><br>${saving ? 'guardou ' : ''}${brl(spent, true)}${target > 0 ? ` de ${brl(target, true)} (${Math.round(pct * 100)}%)` : ' · sem alvo'}`,
        () => { state.drill = { kind: 'bucket', id: b.id }; repaint(); });
      card.appendChild(row);
    });
    return card;
  }

  // ── Categorias do mês (donut ≤6 com gaps de 2px + legenda com valores) ───
  function donutCard(f) {
    const t = state.t;
    const card = el('div', 'fd-card');
    const hd = el('div', 'fd-card-head');
    hd.appendChild(el('h3', 'fd-card-title', 'Para onde foi'));
    hd.appendChild(el('span', 'fd-card-sub', esc(mLabel(f.month, true))));
    card.appendChild(hd);

    const entries = Object.entries(f.byCategory || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) { card.appendChild(el('div', 'fd-empty', 'Sem gastos neste mês.')); return card; }
    const top = entries.slice(0, 5);
    const restSum = entries.slice(5).reduce((s, [, v]) => s + v, 0);
    const slices = top.map(([c, v]) => ({ id: c, label: catLabel(c), v, color: catColor(c) }));
    if (restSum > 0) slices.push({ id: '__outros', label: `outros (${entries.length - 5})`, v: restSum, color: t.other });
    const total = slices.reduce((s, x) => s + x.v, 0);

    const wrap = el('div', 'fd-donut-wrap');
    const R = 78, r0 = 52, C = 95;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 190 190');
    svg.setAttribute('class', 'fd-svg');
    const gapA = 2 / R;   // ~2px de vão entre fatias
    let a = -Math.PI / 2;
    const arc = (a0, a1, rr) => `${C + rr * Math.cos(a0)} ${C + rr * Math.sin(a0)} A ${rr} ${rr} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${C + rr * Math.cos(a1)} ${C + rr * Math.sin(a1)}`;
    slices.forEach((sl) => {
      const frac = sl.v / total;
      const a0 = a + gapA / 2, a1 = a + frac * 2 * Math.PI - gapA / 2;
      a += frac * 2 * Math.PI;
      if (a1 <= a0) return;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M ${arc(a0, a1, R)} L ${C + r0 * Math.cos(a1)} ${C + r0 * Math.sin(a1)} A ${r0} ${r0} 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${C + r0 * Math.cos(a0)} ${C + r0 * Math.sin(a0)} Z`);
      p.setAttribute('fill', sl.color);
      wireMark(p, () => `<b>${esc(sl.label)}</b><br>${brl(sl.v, true)} · ${Math.round((sl.v / total) * 100)}%`,
        sl.id === '__outros' ? null : () => { state.drill = { kind: 'cat', id: sl.id }; repaint(); });
      svg.appendChild(p);
    });
    const ctr = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ctr.setAttribute('x', C); ctr.setAttribute('y', C - 2); ctr.setAttribute('text-anchor', 'middle');
    ctr.setAttribute('font-size', '17'); ctr.setAttribute('font-weight', '600'); ctr.setAttribute('fill', t.ink);
    ctr.setAttribute('style', 'font-family:var(--fd-serif)');
    ctr.textContent = brl(total);
    const ctr2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ctr2.setAttribute('x', C); ctr2.setAttribute('y', C + 16); ctr2.setAttribute('text-anchor', 'middle');
    ctr2.setAttribute('font-size', '9'); ctr2.setAttribute('fill', t.muted);
    ctr2.setAttribute('letter-spacing', '.12em');
    ctr2.textContent = 'GASTO TOTAL';
    svg.append(ctr, ctr2);
    wrap.appendChild(svg);

    const lg = el('div', 'fd-donut-legend');
    slices.forEach((sl) => {
      const row = el('div', 'fd-dl-row');
      row.innerHTML = `<span class="sw" style="background:${sl.color}"></span>` +
        `<span class="nm">${esc(sl.label)}</span>` +
        `<span class="v">${brl(sl.v)}</span><span class="p">${Math.round((sl.v / total) * 100)}%</span>`;
      if (sl.id !== '__outros') row.onclick = () => { state.drill = { kind: 'cat', id: sl.id }; repaint(); };
      lg.appendChild(row);
    });
    wrap.appendChild(lg);
    card.appendChild(wrap);
    return card;
  }

  // ── Tendência por categoria (pequenos múltiplos) ─────────────────────────
  function sparksCard() {
    const t = state.t, ms = state.data.months || [];
    const card = el('div', 'fd-card fd-span2');
    const hd = el('div', 'fd-card-head');
    hd.appendChild(el('h3', 'fd-card-title', 'Tendência por categoria'));
    hd.appendChild(el('span', 'fd-card-sub', `últimos ${ms.length} meses`));
    card.appendChild(hd);

    const cats = catRank().slice(0, 4);
    if (!cats.length) { card.appendChild(el('div', 'fd-empty', 'Sem histórico de categorias ainda.')); return card; }
    const grid = el('div', 'fd-sparks');
    cats.forEach((c) => {
      const vals = ms.map((r) => (r.byCategory || {})[c] || 0);
      const tot = vals.reduce((s, v) => s + v, 0);
      const color = catColor(c);
      const W = 150, H = 44, max = Math.max(1, ...vals);
      const pt = (v, i) => `${(i / Math.max(1, vals.length - 1)) * (W - 10) + 5},${H - 6 - (v / max) * (H - 14)}`;
      const line = vals.map((v, i) => pt(v, i)).join(' ');
      const box = el('div', 'fd-spark');
      box.innerHTML = `<div class="nm"><span class="sw" style="background:${color}"></span>${esc(catLabel(c))}</div>` +
        `<div class="tot">${brl(tot)}</div>` +
        `<svg class="fd-svg" viewBox="0 0 ${W} ${H}">` +
        `<polyline points="${line} ${W - 5},${H - 2} 5,${H - 2}" fill="${color}" opacity=".1" stroke="none"/>` +
        `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${pt(vals[vals.length - 1], vals.length - 1).split(',')[0]}" cy="${pt(vals[vals.length - 1], vals.length - 1).split(',')[1]}" r="3.4" fill="${color}" stroke="${t.card}" stroke-width="2"/>` +
        `</svg>`;
      wireMark(box, () => {
        const rows = ms.map((r, i) => `${mLabel(r.month)} ${brl(vals[i])}`).join('<br>');
        return `<b>${esc(catLabel(c))}</b><br>${rows}`;
      }, () => { state.drill = { kind: 'cat', id: c }; repaint(); });
      grid.appendChild(box);
    });
    card.appendChild(grid);
    return card;
  }

  // ── Drill: lançamentos do envelope/categoria no mês focado ───────────────
  async function drillCard(f) {
    const d = state.drill;
    if (!state.sumCache[f.month]) {
      try { state.sumCache[f.month] = await BISA.api('/finance/summary?month=' + f.month); }
      catch { return null; }
    }
    const manual = ((state.sumCache[f.month].cash || {}).manual || [])
      .filter((tx) => tx.kind === 'expense' && !tx.pending)
      .filter((tx) => d.kind === 'cat' ? tx.category === d.id : tx.bucket === d.id)
      .sort((a, b) => b.amount - a.amount);
    const label = d.kind === 'cat' ? catLabel(d.id) : (BUCKETS.find((b) => b.id === d.id) || {}).label || d.id;
    const total = manual.reduce((s, tx) => s + tx.amount, 0);

    const card = el('div', 'fd-card fd-span2');
    const hd = el('div', 'fd-drill-head');
    hd.appendChild(el('h3', 'fd-card-title', `${esc(label)} · ${esc(mLabel(f.month, true))}`));
    hd.appendChild(el('span', 'fd-card-sub', manual.length ? `${manual.length} lançamento${manual.length === 1 ? '' : 's'} · ${brl(total, true)}` : ''));
    const x = el('button', 'fd-drill-x', '✕');
    x.onclick = () => { state.drill = null; repaint(); };
    hd.appendChild(x);
    card.appendChild(hd);

    if (!manual.length) {
      card.appendChild(el('div', 'fd-empty', 'Nenhum lançamento manual aqui neste mês.'));
      return card;
    }
    manual.forEach((tx) => {
      const row = el('div', 'fd-tx');
      row.innerHTML = `<span class="d">${tx.date.slice(8, 10)}/${tx.date.slice(5, 7)}</span>` +
        `<span class="nm">${esc(tx.desc || catLabel(tx.category))}</span>` +
        (d.kind === 'cat' && tx.bucket ? `<span class="bk">${esc((BUCKETS.find((b) => b.id === tx.bucket) || {}).label || tx.bucket)}</span>` : '') +
        (d.kind === 'bucket' ? `<span class="bk">${esc(catLabel(tx.category))}</span>` : '') +
        `<span class="v">${brl(tx.amount, true)}</span>`;
      card.appendChild(row);
    });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return card;
  }

  window.FIN_DASH = { render };
})();
