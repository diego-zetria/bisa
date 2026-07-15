// screens/fit.js — sub-view "Fit" da aba Biso: frontend iPad do fluxo fitness
// do biso (lib/fitness). Treinos, cardio, refeições, métricas e insights.
//
// Todos os dados vêm do biso via proxy /biso/* (o bridge injeta o token):
//   GET  /biso/codex/fitness/day?date=      — plano+estado do dia (payload central)
//   POST /biso/codex/fitness/confirm|unconfirm|skip|swap|item|dismiss|set|metric
//        — toda mutação devolve o dia inteiro atualizado (re-render direto, sem re-fetch)
//   GET  /biso/codex/fitness/week?date=     — tira Dom–Sáb
//   GET  /biso/codex/fitness/insights?date= — tendências 7d/28d, momentum, PRs
// A dose (shot) NÃO é registrada aqui — vive nas routines do biso; o card 💉
// é só leitura do payload. Proteína/água lançam por produto (lista fixa no
// código, const PRODUCTS) e o ✎ corrige o total declarado do dia via delta.
//
// O profile (plano-template) NÃO é editável por aqui, por design do biso: a UI
// só registra o que aconteceu. 409 = sem profile (estado vazio com instrução).
// Contrato de módulo: window.BISO_FIT.mount(el)/unmount() — padrão Notas/Canvas.
(function () {
  // ── Estilos (escopo .fit-root; herda os temas da aba via vars --biso-*) ──
  if (!document.getElementById('fit-style')) {
    const s = document.createElement('style');
    s.id = 'fit-style';
    s.textContent = `
      .fit-root { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch;
        padding:14px 16px 90px; color:var(--biso-ink); }
      .fit-inner { max-width:860px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }

      .fit-head { display:flex; align-items:center; gap:10px; }
      .fit-datebtn { background:var(--biso-surface-2, var(--biso-surface)); border:1px solid var(--biso-line);
        color:var(--biso-ink); border-radius:10px; min-width:44px; min-height:44px; font-size:1.1rem; cursor:pointer; }
      .fit-datelabel { flex:1; text-align:center; font-weight:700; font-size:1.05rem; }
      .fit-datelabel small { display:block; font-weight:400; font-size:.75rem; color:var(--biso-ink-soft); }
      .fit-todaybtn { background:none; border:1px dashed var(--biso-line); color:var(--biso-ink-soft);
        border-radius:10px; min-height:44px; padding:0 12px; cursor:pointer; font-size:.85rem; }

      .fit-card { background:var(--biso-surface); border:1px solid var(--biso-line);
        border-radius:14px; padding:14px 16px; }
      .fit-sec-title { font-size:.78rem; text-transform:uppercase; letter-spacing:.06em;
        color:var(--biso-ink-soft); font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:8px; }
      .fit-sec-title .sp { flex:1; }

      /* métricas do dia */
      .fit-metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; }
      .fit-met { background:var(--biso-surface); border:1px solid var(--biso-line); border-radius:12px;
        padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
      .fit-met .k { font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; color:var(--biso-ink-soft); font-weight:700; }
      .fit-met .k-row { display:flex; align-items:center; justify-content:space-between; }
      .fit-met-edit { background:none; border:none; color:var(--biso-ink-soft); font-size:.85rem;
        min-width:32px; min-height:28px; cursor:pointer; padding:0; }
      .fit-met .v { font-size:1.25rem; font-weight:700; }
      .fit-met .v small { font-size:.75rem; font-weight:400; color:var(--biso-ink-soft); }
      .fit-met-bar { height:6px; border-radius:999px; background:var(--biso-accent); overflow:hidden; }
      .fit-met-bar i { display:block; height:100%; border-radius:999px; background:var(--biso-primary); transition:width .3s; }
      .fit-met-bar.hit i { background:var(--biso-positive); }
      .fit-chiprow { display:flex; flex-wrap:wrap; gap:6px; }
      .fit-chip { background:var(--biso-accent); border:1px solid var(--biso-line); color:var(--biso-ink);
        border-radius:999px; min-height:34px; padding:0 12px; font-size:.8rem; cursor:pointer; }
      .fit-chip.on { background:var(--biso-primary); color:var(--biso-primary-ink); border-color:var(--biso-primary); }

      /* injeção */
      .fit-shot { display:flex; align-items:center; gap:10px; }
      .fit-shot .txt { flex:1; font-size:.9rem; }
      .fit-shot .txt small { display:block; color:var(--biso-ink-soft); font-size:.78rem; }
      .fit-shot.due { border-color:var(--biso-negative); }

      /* slots do plano */
      .fit-slot { border-bottom:1px solid var(--biso-line); padding:12px 0; }
      .fit-slot:last-child { border-bottom:none; padding-bottom:2px; }
      .fit-slot-top { display:flex; align-items:center; gap:10px; }
      .fit-slot-glyph { width:34px; height:34px; border-radius:10px; background:var(--biso-accent);
        display:flex; align-items:center; justify-content:center; font-size:1rem; flex:0 0 auto; }
      .fit-slot-main { flex:1; min-width:0; }
      .fit-slot-title { font-weight:600; font-size:.95rem; }
      .fit-slot-sub { font-size:.78rem; color:var(--biso-ink-soft); }
      .fit-state { font-size:.7rem; font-weight:700; padding:2px 9px; border-radius:999px; white-space:nowrap; }
      .fit-state.done    { background:var(--biso-positive); color:var(--biso-primary-ink, #fff); }
      .fit-state.skipped { background:var(--biso-line); color:var(--biso-ink-soft); }
      .fit-state.partial { background:var(--biso-primary); color:var(--biso-primary-ink); }
      .fit-slot-acts { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
      .fit-btn { background:var(--biso-surface-2, var(--biso-accent)); border:1px solid var(--biso-line);
        color:var(--biso-ink); border-radius:10px; min-height:40px; padding:0 14px; font-size:.85rem;
        font-weight:600; cursor:pointer; }
      .fit-btn.primary { background:var(--biso-primary); color:var(--biso-primary-ink); border-color:var(--biso-primary); }
      .fit-btn.ghost { background:none; color:var(--biso-ink-soft); }
      .fit-why { font-size:.75rem; color:var(--biso-ink-soft); font-style:italic; margin-top:6px; }

      /* meal1: checklist de itens */
      .fit-items { margin-top:8px; display:flex; flex-direction:column; }
      .fit-item { display:flex; align-items:center; gap:10px; min-height:42px; border:none;
        background:none; color:var(--biso-ink); font-size:.88rem; cursor:pointer; text-align:left; padding:0 2px; }
      .fit-item .box { width:22px; height:22px; border-radius:7px; border:2px solid var(--biso-line);
        display:flex; align-items:center; justify-content:center; font-size:.8rem; flex:0 0 auto; }
      .fit-item.on .box { background:var(--biso-positive); border-color:var(--biso-positive); color:#fff; }
      .fit-item .macro { margin-left:auto; font-size:.75rem; color:var(--biso-ink-soft); white-space:nowrap; }

      /* treino: exercícios + séries */
      .fit-ex { margin-top:8px; border-top:1px dashed var(--biso-line); padding-top:8px; }
      .fit-ex-row { display:flex; align-items:center; gap:8px; min-height:40px; }
      .fit-ex-name { flex:1; min-width:0; font-size:.88rem; }
      .fit-ex-target { font-size:.75rem; color:var(--biso-ink-soft); white-space:nowrap; }
      .fit-ex-sugg { font-size:.75rem; color:var(--biso-primary); white-space:nowrap; }
      .fit-ex-add { background:var(--biso-accent); border:1px solid var(--biso-line); color:var(--biso-ink);
        border-radius:8px; min-width:38px; min-height:34px; cursor:pointer; font-size:.95rem; }
      .fit-ex-note { font-size:.72rem; color:var(--biso-ink-soft); margin:0 0 4px 2px; }
      .fit-sets { font-size:.78rem; color:var(--biso-ink-soft); margin:2px 0 4px 2px; }
      .fit-sets b { color:var(--biso-ink); }
      .fit-setform { display:flex; gap:6px; align-items:center; margin:6px 0; flex-wrap:wrap; }
      .fit-setform input { width:64px; min-height:40px; background:var(--biso-surface-2, var(--biso-surface));
        border:1px solid var(--biso-line); border-radius:8px; color:var(--biso-ink); font-size:.9rem;
        text-align:center; }
      .fit-setform label { font-size:.72rem; color:var(--biso-ink-soft); }

      /* formulário numérico genérico (peso/passos/custom) */
      .fit-numform { display:flex; gap:8px; align-items:center; margin-top:6px; }
      .fit-numform input { flex:1; min-width:0; min-height:42px; background:var(--biso-surface-2, var(--biso-surface));
        border:1px solid var(--biso-line); border-radius:10px; color:var(--biso-ink); font-size:1rem;
        text-align:center; }

      /* semana */
      .fit-week { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center; }
      .fit-wd { display:flex; flex-direction:column; align-items:center; gap:5px; padding:6px 0;
        border-radius:10px; }
      .fit-wd.today { background:var(--biso-accent); }
      .fit-wd .d { font-size:.68rem; text-transform:uppercase; color:var(--biso-ink-soft); font-weight:700; }
      .fit-wd .w { width:16px; height:16px; border-radius:50%; border:2px solid var(--biso-line); }
      .fit-wd .w.done { background:var(--biso-positive); border-color:var(--biso-positive); }
      .fit-wd .w.skipped { background:var(--biso-line); }
      .fit-wd .w.none { border-style:dotted; opacity:.4; }
      .fit-wd .p { width:7px; height:7px; border-radius:50%; background:var(--biso-line); }
      .fit-wd .p.hit { background:var(--biso-primary); }

      /* insights */
      .fit-trend { display:flex; align-items:center; gap:10px; min-height:36px; font-size:.88rem; }
      .fit-trend .name { flex:1; }
      .fit-trend .arrow { font-weight:700; }
      .fit-trend .arrow.up { color:var(--biso-positive); }
      .fit-trend .arrow.down { color:var(--biso-negative); }
      .fit-trend .nums { color:var(--biso-ink-soft); font-size:.8rem; }
      .fit-pr { display:flex; gap:10px; font-size:.85rem; min-height:32px; align-items:center; }
      .fit-pr .ex { flex:1; }
      .fit-pr .w { font-weight:700; }
      .fit-micro { font-size:.8rem; color:var(--biso-primary); margin-top:4px; }

      /* popover de execução do exercício (2 quadros alternando) */
      .fit-viz-ov { position:fixed; inset:0; z-index:60; background:rgba(0,0,0,.25); }
      .fit-viz-pop { position:fixed; background:var(--biso-surface); border:1px solid var(--biso-line);
        border-radius:14px; padding:12px 14px; box-shadow:0 12px 40px rgba(0,0,0,.35);
        max-height:70vh; overflow-y:auto; display:flex; flex-direction:column; gap:14px; }
      .fit-viz-title { font-weight:700; font-size:.92rem; color:var(--biso-ink); }
      .fit-viz-mus { font-size:.75rem; color:var(--biso-ink-soft); margin-bottom:6px; }
      .fit-viz-frame { position:relative; width:100%; aspect-ratio:4/3; background:#fff;
        border-radius:10px; overflow:hidden; }
      .fit-viz-frame img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }
      .fit-viz-frame img + img { opacity:0; animation:fit-viz-flip 2s linear infinite; }
      @keyframes fit-viz-flip { 0%,49.9% { opacity:0; } 50%,100% { opacity:1; } }

      .fit-empty { text-align:center; padding:40px 20px; color:var(--biso-ink-soft); }
      .fit-empty .big { font-size:2.2rem; margin-bottom:10px; }
      .fit-empty code { font-family:var(--biso-mono); font-size:.8rem; }
      .fit-muted { color:var(--biso-ink-soft); }
    `;
    document.head.appendChild(s);
  }

  // ── Estado do módulo ─────────────────────────────────────────────────────
  let root = null;
  let date = null;          // dia exibido (YYYY-MM-DD)
  let day = null;           // payload de GET /day (ou de qualquer mutação)
  let weekData = null;      // payload de GET /week
  let profileData = null;   // payload de GET /profile (medication/cycleDays — 1 fetch por mount)
  let insightsData = null;  // payload de GET /insights (carrega ao abrir)
  let showInsights = false;
  const openForms = new Set(); // ids de formulários inline abertos (ex.: 'set:Supino', 'metric:weight')

  const GLYPH = { workout: '⚒', meal1: '◔', supplements: '✚', meal2: '◕', cardio: '⇗' };
  const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  // Produtos de lançamento rápido (proteína/água): cada toque loga 1 unidade
  // como evento de métrica normal no biso — o produto é só o atalho da UI.
  // Lista fixa no código de propósito (sem editor na tela: um ✕ acidental
  // apagava produto — incidente do Ovo, 2026-07-07). Para mudar, edite aqui.
  const PRODUCTS = {
    protein: [{ name: 'Ovo', value: 6 }, { name: 'Whey', value: 20 }],
    water: [{ name: 'Garrafa c/ gás', value: 500 }, { name: 'Copo', value: 250 }],
  };

  // ── Visualização de execução (free-exercise-db, domínio público) ────────
  // Imagens vendorizadas em /vendor/exercises/<id>/{0,1}.jpg (posição inicial
  // e final); o popover alterna os 2 quadros p/ mostrar o movimento. Match por
  // palavra-chave sobre o nome livre do exercício no profile — nomes compostos
  // ("Lat pulldown / pull-up", supersets) mostram todas as variantes.
  const VIZ_RULES = [
    { has: (n) => n.includes('bench') && n.includes('incline'), id: 'Barbell_Incline_Bench_Press_-_Medium_Grip', label: 'Supino inclinado', muscles: 'peitoral' },
    { has: (n) => n.includes('bench') && !n.includes('incline'), id: 'Barbell_Bench_Press_-_Medium_Grip', label: 'Supino reto', muscles: 'peitoral' },
    { has: (n) => n.includes('row'), id: 'Bent_Over_Barbell_Row', label: 'Remada curvada', muscles: 'costas' },
    { has: (n) => n.includes('shoulder press') || n.includes('overhead'), id: 'Dumbbell_Shoulder_Press', label: 'Desenvolvimento de ombros', muscles: 'ombros' },
    { has: (n) => n.includes('pulldown'), id: 'Wide-Grip_Lat_Pulldown', label: 'Puxada alta', muscles: 'dorsais' },
    { has: (n) => /pull-?up/.test(n), id: 'Pullups', label: 'Barra fixa', muscles: 'dorsais' },
    { has: (n) => n.includes('leg curl'), id: 'Seated_Leg_Curl', label: 'Cadeira flexora', muscles: 'posteriores de coxa' },
    { has: (n) => n.includes('curl') && !n.includes('leg curl'), id: 'Barbell_Curl', label: 'Rosca direta', muscles: 'bíceps' },
    { has: (n) => n.includes('triceps') || n.includes('tríceps'), id: 'Triceps_Pushdown_-_Rope_Attachment', label: 'Tríceps corda', muscles: 'tríceps' },
    { has: (n) => /romanian|stiff/.test(n), id: 'Romanian_Deadlift', label: 'Levantamento romeno', muscles: 'posteriores de coxa' },
    { has: (n) => n.includes('deadlift') && !/romanian|stiff/.test(n), id: 'Barbell_Deadlift', label: 'Levantamento terra', muscles: 'lombar' },
    { has: (n) => n.includes('squat'), id: 'Barbell_Squat', label: 'Agachamento livre', muscles: 'quadríceps' },
    { has: (n) => n.includes('leg press'), id: 'Leg_Press', label: 'Leg press', muscles: 'quadríceps' },
    { has: (n) => n.includes('lunge'), id: 'Dumbbell_Lunges', label: 'Afundo', muscles: 'quadríceps' },
    { has: (n) => n.includes('calf'), id: 'Standing_Calf_Raises', label: 'Panturrilha em pé', muscles: 'panturrilhas' },
  ];
  const vizOf = (name) => {
    const n = String(name || '').toLowerCase();
    return VIZ_RULES.filter((r) => r.has(n));
  };

  let vizOverlay = null;
  function closeViz() { if (vizOverlay) { vizOverlay.remove(); vizOverlay = null; } }

  // Popover ancorado no 👁 (padrão do projeto p/ iPad/Pencil — não bottom sheet).
  function openViz(anchor, matches) {
    closeViz();
    const ov = elx('div', 'fit-viz-ov');
    const pop = elx('div', 'fit-viz-pop');
    matches.forEach((m) => {
      const sec = elx('div');
      sec.appendChild(elx('div', 'fit-viz-title', m.label));
      sec.appendChild(elx('div', 'fit-viz-mus', m.muscles));
      const frame = elx('div', 'fit-viz-frame');
      const a = elx('img'); a.src = `/vendor/exercises/${m.id}/0.jpg`; a.alt = `${m.label} — posição inicial`;
      const b = elx('img'); b.src = `/vendor/exercises/${m.id}/1.jpg`; b.alt = `${m.label} — posição final`;
      frame.append(a, b);
      sec.appendChild(frame);
      pop.appendChild(sec);
    });
    ov.appendChild(pop);
    ov.onclick = (ev) => { if (ev.target === ov) closeViz(); };
    document.body.appendChild(ov);
    vizOverlay = ov;

    const r = anchor.getBoundingClientRect();
    const pw = Math.min(340, window.innerWidth - 24);
    pop.style.width = pw + 'px';
    pop.style.left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 12) + 'px';
    // abaixo do botão; sem espaço, acima
    requestAnimationFrame(() => {
      const ph = pop.offsetHeight;
      let top = r.bottom + 8;
      if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 8);
      pop.style.top = top + 'px';
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const elx = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const fitGet = (p) => BISA.api('/biso/codex/fitness' + p);
  const fitPost = (p, json) => BISA.api('/biso/codex/fitness' + p, { method: 'POST', json });

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const shiftISO = (iso, days) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const dateLabel = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${DOW[dt.getDay()]} · ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  };
  const parseNum = (s) => { const n = parseFloat(String(s || '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const fmt = (n) => (n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ','));

  // ── Dados ────────────────────────────────────────────────────────────────
  const noProfile = (e) => /no fitness profile/i.test(e && e.message || '');

  async function loadWeek() {
    try { weekData = await fitGet(`/week?date=${date}`); } catch { weekData = null; }
  }
  async function loadProfileData() {
    try { profileData = await fitGet('/profile'); } catch { profileData = null; }
  }
  async function loadInsights() {
    try { insightsData = await fitGet(`/insights?date=${date}`); } catch { insightsData = null; }
  }

  // Navegação rápida de dias: respostas podem chegar fora de ordem. Cada fluxo
  // captura o dia pedido e descarta a resposta se o usuário já trocou de dia
  // (ou saiu da view) — a resposta velha nunca sobrescreve a tela atual.
  const stale = (d) => d !== date || !root;

  // Toda mutação devolve o dia inteiro: troca o payload e re-renderiza no lugar.
  // A tira semanal é atualizada em background (mudou o estado de um dia dela).
  async function act(path, body) {
    const d = date;
    try {
      const resp = await fitPost(path, Object.assign({ date: d }, body || {}));
      if (stale(d)) return;
      day = resp;
      render(true);
      loadWeek().then(() => { if (!stale(d)) render(true); });
    } catch (e) { BISA.toast(e.message || 'Erro no Fit'); }
  }

  async function reload(preserveScroll) {
    const d = date;
    try {
      const resp = await fitGet(`/day?date=${d}`);
      if (stale(d)) return;
      day = resp;
      await loadWeek();
      if (!profileData) await loadProfileData();
      if (showInsights) await loadInsights();
      if (stale(d)) return;
      render(preserveScroll);
    } catch (e) {
      if (stale(d)) return;
      if (noProfile(e)) renderNoProfile();
      else renderError(e);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render(preserveScroll) {
    if (!root) return;
    const savedTop = preserveScroll ? root.scrollTop : 0;
    root.innerHTML = '';
    const inner = elx('div', 'fit-inner');
    root.appendChild(inner);
    if (!day) { inner.appendChild(elx('div', 'fit-empty', 'Carregando…')); return; }

    renderHeader(inner);
    renderShot(inner);
    renderMetrics(inner);
    renderPlan(inner);
    renderWeek(inner);
    renderInsights(inner);
    if (preserveScroll) root.scrollTop = savedTop;
  }

  function renderHeader(inner) {
    const head = elx('div', 'fit-head');
    const prev = elx('button', 'fit-datebtn', '‹');
    prev.onclick = () => { date = shiftISO(date, -1); openForms.clear(); reload(); };
    const next = elx('button', 'fit-datebtn', '›');
    next.onclick = () => { date = shiftISO(date, 1); openForms.clear(); reload(); };
    const label = elx('div', 'fit-datelabel', dateLabel(date));
    label.appendChild(elx('small', null, `${day.done}/${day.total} do plano`));
    head.append(prev, label, next);
    if (date !== todayISO()) {
      const today = elx('button', 'fit-todaybtn', 'Hoje');
      today.onclick = () => { date = todayISO(); openForms.clear(); reload(); };
      head.appendChild(today);
    }
    inner.appendChild(head);
  }

  // 💉 ciclo da medicação — só informativo: a dose é registrada nas routines
  // do biso (decisão 2026-07-07); aqui mostramos D+N do que veio no payload e
  // destacamos quando o ciclo venceu. Sem dose registrada, o card não aparece.
  function renderShot(inner) {
    const shot = day.shot;
    if (!shot) return;
    const med = (profileData && profileData.medication) || {};
    const cycle = Number(med.cycleDays) || 7;
    const due = shot.daysAgo >= cycle;
    const card = elx('div', 'fit-card fit-shot');
    if (due) card.classList.add('due');
    const t = elx('div', 'txt', `💉 Injeção D+${shot.daysAgo}`);
    t.appendChild(elx('small', null,
      `última em ${dateLabel(shot.date)} · ciclo ${cycle}d${due ? ' · dose vencendo' : ''}`));
    card.appendChild(t);
    inner.appendChild(card);
  }

  // Métricas do dia vs alvos; proteína/água lançam por PRODUTO (1 toque =
  // 1 unidade: garrafa, ovo, dose...), peso/passos com formulário inline
  // (valor absoluto, último vence).
  function renderMetrics(inner) {
    const m = day.metrics || {}, t = day.targets || {};
    const grid = elx('div', 'fit-metrics');

    grid.appendChild(productMetricCard({
      metric: 'protein', title: 'Proteína', unit: 'g',
      value: `${fmt(m.proteinG)}g`, suffix: t.proteinG ? `/ ${t.proteinG}g` : '',
      cur: m.proteinG, target: t.proteinG,
    }));

    grid.appendChild(productMetricCard({
      metric: 'water', title: 'Água', unit: 'ml',
      value: `${fmt((m.waterMl || 0) / 1000)}L`, suffix: t.waterMl ? `/ ${fmt(t.waterMl / 1000)}L` : '',
      cur: m.waterMl, target: t.waterMl,
    }));

    grid.appendChild(metricCard('Calorias', `${fmt(m.kcal)}`, t.kcal ? `/ ${t.kcal} kcal` : '',
      m.kcal, t.kcal, [], null, true));

    grid.appendChild(metricCard('Peso', m.weightKg != null ? `${fmt(m.weightKg)}kg` : '—', '',
      null, null, [['registrar', () => toggleForm('metric:weight')]],
      numForm('metric:weight', 'kg', (v) => act('/metric', { metric: 'weight', value: v }))));

    grid.appendChild(metricCard('Passos', m.steps != null ? fmt(m.steps) : '—', t.steps ? `/ ${t.steps}` : '',
      m.steps, t.steps, [['registrar', () => toggleForm('metric:steps')]],
      numForm('metric:steps', 'passos', (v) => act('/metric', { metric: 'steps', value: v }))));

    inner.appendChild(grid);
  }

  // Card de proteína/água: chips de produto (1 toque = 1 unidade lançada),
  // "outro" p/ somar valor livre e ✎ p/ CORRIGIR o total declarado do dia —
  // o form recebe o total desejado e envia a diferença (o biso aceita métrica
  // cumulativa negativa justamente para correção).
  function productMetricCard({ metric, title, unit, value, suffix, cur, target }) {
    const card = elx('div', 'fit-met');
    const k = elx('div', 'k-row');
    k.appendChild(elx('span', 'k', title));
    const edit = elx('button', 'fit-met-edit', '✎');
    edit.title = `Corrigir o total de ${title.toLowerCase()} do dia`;
    edit.onclick = () => toggleForm('fix:' + metric);
    k.appendChild(edit);
    card.appendChild(k);

    const v = elx('span', 'v', value);
    if (suffix) v.appendChild(elx('small', null, ' ' + suffix));
    card.appendChild(v);
    if (target > 0 && cur != null) {
      const bar = elx('div', 'fit-met-bar' + (cur >= target && cur > 0 ? ' hit' : ''));
      const fill = elx('i');
      fill.style.width = Math.min(100, Math.round((cur / target) * 100)) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    const row = elx('div', 'fit-chiprow');
    PRODUCTS[metric].forEach((p) => {
      const c = elx('button', 'fit-chip', `${p.name} +${p.value}${unit}`);
      c.onclick = () => {
        BISA.toast(`+${p.value}${unit} · ${p.name}`);
        act('/metric', { metric, value: p.value });
      };
      row.appendChild(c);
    });
    const other = elx('button', 'fit-chip', 'outro');
    other.onclick = () => toggleForm('metric:' + metric);
    row.appendChild(other);
    card.appendChild(row);

    const addForm = numForm('metric:' + metric, unit, (val) => act('/metric', { metric, value: val }));
    if (addForm) card.appendChild(addForm);

    const total = Number(cur) || 0;
    const fixForm = numForm('fix:' + metric, `total do dia (${unit})`, (val) => {
      const delta = Math.round((val - total) * 10) / 10;
      if (!delta) return;
      BISA.toast(`Total corrigido: ${val}${unit}`);
      act('/metric', { metric, value: delta });
    }, { initial: total, allowZero: true });
    if (fixForm) card.appendChild(fixForm);
    return card;
  }

  // Card de métrica: valor, barra vs alvo (kcal = teto: passa do alvo fica “hit”
  // invertido não — mantemos neutro), chips de ação e formulário inline opcional.
  function metricCard(name, value, suffix, cur, target, chips, form, ceiling) {
    const card = elx('div', 'fit-met');
    card.appendChild(elx('span', 'k', name));
    const v = elx('span', 'v', value);
    if (suffix) v.appendChild(elx('small', null, ' ' + suffix));
    card.appendChild(v);
    if (target > 0 && cur != null) {
      const pct = Math.min(100, Math.round((cur / target) * 100));
      const hit = ceiling ? cur <= target : cur >= target;
      const bar = elx('div', 'fit-met-bar' + (hit && cur > 0 ? ' hit' : ''));
      const fill = elx('i');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
    }
    if (chips.length) {
      const row = elx('div', 'fit-chiprow');
      chips.forEach(([lbl, fn]) => { const c = elx('button', 'fit-chip', lbl); c.onclick = fn; row.appendChild(c); });
      card.appendChild(row);
    }
    if (form) card.appendChild(form);
    return card;
  }

  // Formulário numérico inline (aparece quando o id está em openForms).
  // opts.initial pré-preenche (correção de total); opts.allowZero aceita 0.
  function numForm(id, placeholder, onSubmit, opts = {}) {
    if (!openForms.has(id)) return null;
    const f = elx('div', 'fit-numform');
    const input = elx('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.placeholder = placeholder;
    if (opts.initial != null) input.value = String(opts.initial).replace('.', ',');
    const ok = elx('button', 'fit-btn primary', '✓');
    const submit = () => {
      const v = parseNum(input.value);
      if (!(opts.allowZero ? v >= 0 : v > 0)) { BISA.toast('Informe um valor válido'); return; }
      openForms.delete(id);
      onSubmit(v);
    };
    ok.onclick = submit;
    input.onkeydown = (ev) => { if (ev.key === 'Enter') submit(); };
    f.append(input, ok);
    setTimeout(() => input.focus(), 0);
    return f;
  }

  function toggleForm(id) {
    if (openForms.has(id)) openForms.delete(id); else openForms.add(id);
    render(true);
  }

  // ── Plano do dia (slots) ────────────────────────────────────────────────
  function renderPlan(inner) {
    const card = elx('div', 'fit-card');
    const title = elx('div', 'fit-sec-title', 'Plano do dia');
    title.appendChild(elx('span', 'sp'));
    const pend = (day.slots || []).filter((s) => s.state === 'pending');
    if (pend.length > 1) {
      const all = elx('button', 'fit-btn ghost', '✓ tudo');
      all.onclick = () => act('/confirm', { slot: 'all' });
      title.appendChild(all);
    }
    card.appendChild(title);
    if (!(day.slots || []).length) card.appendChild(elx('div', 'fit-muted', 'Dia livre — nada agendado no plano.'));
    (day.slots || []).forEach((s) => card.appendChild(slotEl(s)));
    inner.appendChild(card);
  }

  function slotEl(s) {
    const el = elx('div', 'fit-slot');
    const top = elx('div', 'fit-slot-top');
    top.appendChild(elx('span', 'fit-slot-glyph', GLYPH[s.slot] || '·'));
    const main = elx('div', 'fit-slot-main');
    main.appendChild(elx('div', 'fit-slot-title', s.title || s.slot));
    const subBits = [];
    if (s.time) subBits.push(s.time);
    if (s.slot === 'meal1' || s.slot === 'meal2') subBits.push(`${s.proteinG || 0}g ptn · ${s.kcal || 0} kcal`);
    if (s.slot === 'workout' && s.rir) subBits.push(`RIR ${s.rir} · descanso ${s.restSec}s`);
    if (s.state === 'done' && s.alt) subBits.push(`feito: ${s.alt}`);
    if (subBits.length) main.appendChild(elx('div', 'fit-slot-sub', subBits.join(' · ')));
    top.appendChild(main);
    if (s.state !== 'pending') {
      const lbl = { done: 'feito', skipped: 'pulado', partial: 'parcial' }[s.state] || s.state;
      top.appendChild(elx('span', 'fit-state ' + s.state, lbl));
    }
    el.appendChild(top);

    // proposta aprendida (meal2/cardio) — mostra o porquê + como descartar
    if (s.why) el.appendChild(elx('div', 'fit-why', `proposto: ${s.proposed} — ${s.why}`));

    // corpo específico do slot
    if (s.slot === 'meal1') el.appendChild(mealItemsEl(s));
    if (s.slot === 'workout') el.appendChild(workoutEl(s));

    // ações
    const acts = elx('div', 'fit-slot-acts');
    if (s.state === 'pending' || s.state === 'partial') {
      const okLabel = (s.slot === 'meal2' && s.proposed) ? `✓ ${s.proposed}`
        : (s.slot === 'cardio' && s.proposed) ? `✓ ${s.proposed}` : '✓ Feito';
      const ok = elx('button', 'fit-btn primary', okLabel);
      ok.onclick = () => act('/confirm', { slot: s.slot });
      acts.appendChild(ok);

      // alternativas (meal2: options; cardio: alternatives) → swap em 1 toque
      const altNames = (s.slot === 'meal2' ? (s.options || []).map((o) => o.name)
        : s.slot === 'cardio' ? (s.alternatives || []) : [])
        .filter((n) => n && n !== s.proposed);
      if (altNames.length) {
        const swapBtn = elx('button', 'fit-btn', '⇄ outra');
        swapBtn.onclick = () => toggleForm('swap:' + s.slot);
        acts.appendChild(swapBtn);
      }
      const skip = elx('button', 'fit-btn ghost', '⏸ pular');
      skip.onclick = () => act('/skip', { slot: s.slot });
      acts.appendChild(skip);
      if (s.why) {
        const dis = elx('button', 'fit-btn ghost', 'não propor');
        dis.onclick = () => act('/dismiss', { slot: s.slot });
        acts.appendChild(dis);
      }
      el.appendChild(acts);

      if (openForms.has('swap:' + s.slot) && altNames.length) {
        const row = elx('div', 'fit-chiprow');
        row.style.marginTop = '8px';
        altNames.forEach((n) => {
          const c = elx('button', 'fit-chip', n);
          c.onclick = () => { openForms.delete('swap:' + s.slot); act('/swap', { slot: s.slot, alt: n }); };
          row.appendChild(c);
        });
        el.appendChild(row);
      }
    } else {
      const undo = elx('button', 'fit-btn ghost', 'desfazer');
      undo.onclick = () => act('/unconfirm', { slot: s.slot });
      acts.appendChild(undo);
      el.appendChild(acts);
    }
    return el;
  }

  // meal1: checklist por item (confirmação parcial — só o que foi comido credita macro)
  function mealItemsEl(s) {
    const box = elx('div', 'fit-items');
    const doneSet = new Set(s.itemsDone || []);
    (s.items || []).forEach((it) => {
      const on = doneSet.has(it.name) || s.state === 'done';
      const row = elx('button', 'fit-item' + (on ? ' on' : ''));
      row.appendChild(elx('span', 'box', on ? '✓' : ''));
      row.appendChild(elx('span', null, it.name));
      row.appendChild(elx('span', 'macro', `${it.proteinG || 0}g · ${it.kcal || 0} kcal`));
      if (s.state !== 'done' && s.state !== 'skipped') {
        row.onclick = () => act('/item', { slot: 'meal1', item: it.name, done: !doneSet.has(it.name) });
      }
      box.appendChild(row);
    });
    return box;
  }

  // treino: exercícios com sugestão de progressão + registro de séries
  function workoutEl(s) {
    const box = elx('div', 'fit-ex');
    const setsToday = s.sets || [];
    (s.exercises || []).forEach((ex) => {
      const row = elx('div', 'fit-ex-row');
      row.appendChild(elx('span', 'fit-ex-name', ex.name));
      row.appendChild(elx('span', 'fit-ex-target', `${ex.sets}×${ex.reps}`));
      if (ex.suggest && ex.suggest.weightKg) row.appendChild(elx('span', 'fit-ex-sugg', `${fmt(ex.suggest.weightKg)}kg`));
      const viz = vizOf(ex.name);
      if (viz.length) {
        const eye = elx('button', 'fit-ex-add', '👁');
        eye.title = 'Ver execução do movimento';
        eye.onclick = () => openViz(eye, viz);
        row.appendChild(eye);
      }
      const add = elx('button', 'fit-ex-add', '＋');
      add.title = 'Registrar série';
      add.onclick = () => toggleForm('set:' + ex.name);
      row.appendChild(add);
      box.appendChild(row);
      if (ex.suggest && ex.suggest.note) box.appendChild(elx('div', 'fit-ex-note', ex.suggest.note));

      const logged = setsToday.filter((x) => x.exercise === ex.name);
      if (logged.length) {
        const line = elx('div', 'fit-sets');
        line.innerHTML = logged.map((x) =>
          `<b>${fmt(x.weightKg)}kg×${x.reps}</b>${x.rir != null ? ` <span>RIR${x.rir}</span>` : ''}`).join(' · ');
        box.appendChild(line);
      }

      if (openForms.has('set:' + ex.name)) box.appendChild(setForm(ex, logged));
    });
    if (s.plankMin) box.appendChild(elx('div', 'fit-ex-note', `+ prancha ${s.plankMin} min`));
    return box;
  }

  function setForm(ex, logged) {
    const f = elx('div', 'fit-setform');
    const last = logged[logged.length - 1] || null;
    const mk = (ph, val) => {
      const i = elx('input');
      i.type = 'text'; i.inputMode = 'decimal'; i.placeholder = ph;
      if (val != null) i.value = String(val).replace('.', ',');
      return i;
    };
    // pré-preenche com a última série de hoje ou com a sugestão de progressão
    const kg = mk('kg', last ? last.weightKg : (ex.suggest && ex.suggest.weightKg) || null);
    const reps = mk('reps', last ? last.reps : null);
    const rir = mk('RIR', null);
    const ok = elx('button', 'fit-btn primary', '✓');
    ok.onclick = () => {
      const w = parseNum(kg.value), r = Math.round(parseNum(reps.value));
      if (!(w > 0) || !(r > 0)) { BISA.toast('Informe peso e reps'); return; }
      const body = { exercise: ex.name, weightKg: w, reps: r };
      const rv = parseNum(rir.value);
      if (rir.value.trim() !== '' && rv >= 0) body.rir = Math.round(rv);
      act('/set', body); // form fica aberto p/ a próxima série (openForms mantém)
    };
    f.append(mk1Label('kg'), kg, mk1Label('reps'), reps, mk1Label('RIR'), rir, ok);
    return f;
  }
  const mk1Label = (t) => elx('label', null, t);

  // ── Semana ───────────────────────────────────────────────────────────────
  function renderWeek(inner) {
    if (!weekData || !Array.isArray(weekData.days)) return;
    const card = elx('div', 'fit-card');
    card.appendChild(elx('div', 'fit-sec-title', 'Semana'));
    const grid = elx('div', 'fit-week');
    weekData.days.forEach((d) => {
      const col = elx('button', 'fit-wd' + (d.date === date ? ' today' : ''));
      col.style.border = 'none'; col.style.cursor = 'pointer'; col.style.background = d.date === date ? '' : 'none';
      col.onclick = () => { if (d.date !== date) { date = d.date; openForms.clear(); reload(); } };
      col.appendChild(elx('span', 'd', DOW[new Date(d.date + 'T12:00:00').getDay()]));
      const w = elx('span', 'w ' + (d.workout ? d.workout.state : 'none'));
      if (d.workout && d.workout.key) w.title = d.workout.key;
      col.appendChild(w);
      col.appendChild(elx('span', 'p' + (d.proteinHit ? ' hit' : '')));
      grid.appendChild(col);
    });
    card.appendChild(grid);
    inner.appendChild(card);
  }

  // ── Insights ─────────────────────────────────────────────────────────────
  function renderInsights(inner) {
    const card = elx('div', 'fit-card');
    const title = elx('div', 'fit-sec-title', 'Insights');
    title.appendChild(elx('span', 'sp'));
    const btn = elx('button', 'fit-btn ghost', showInsights ? 'fechar' : 'abrir');
    btn.onclick = async () => {
      showInsights = !showInsights;
      if (showInsights && !insightsData) await loadInsights();
      render(true);
    };
    title.appendChild(btn);
    card.appendChild(title);

    if (showInsights) {
      const ins = insightsData;
      if (!ins) card.appendChild(elx('div', 'fit-muted', 'Sem dados ainda — registre alguns dias.'));
      else {
        const ARROWS = { up: '↑', down: '↓', flat: '→' };
        const NAMES = { protein: 'Proteína (g)', kcal: 'Calorias', water: 'Água (ml)', steps: 'Passos' };
        Object.entries(ins.trends || {}).forEach(([k, tr]) => {
          if (tr.avg7 == null && tr.avg28 == null) return;
          const row = elx('div', 'fit-trend');
          row.appendChild(elx('span', 'name', NAMES[k] || k));
          row.appendChild(elx('span', 'arrow ' + tr.arrow, ARROWS[tr.arrow] || ''));
          row.appendChild(elx('span', 'nums', `7d ${fmt(tr.avg7)} · 28d ${fmt(tr.avg28)}${tr.target ? ` · alvo ${tr.target}` : ''}`));
          card.appendChild(row);
        });
        if (ins.trends && ins.trends.protein && ins.trends.protein.microGoal) {
          card.appendChild(elx('div', 'fit-micro', `🎯 ${ins.trends.protein.microGoal}`));
        }
        if (ins.weight) {
          const row = elx('div', 'fit-trend');
          row.appendChild(elx('span', 'name', 'Peso (kg)'));
          const delta = ins.weight.deltaKg;
          row.appendChild(elx('span', 'arrow ' + (delta < 0 ? 'up' : delta > 0 ? 'down' : 'flat'),
            `${delta > 0 ? '+' : ''}${fmt(delta)}kg`));
          row.appendChild(elx('span', 'nums', `${fmt(ins.weight.first)} → ${fmt(ins.weight.last)} (${ins.weight.n} pesagens)`));
          card.appendChild(row);
        }
        if (ins.momentum) {
          const m = ins.momentum;
          const row = elx('div', 'fit-trend');
          row.appendChild(elx('span', 'name', 'Momentum 30d'));
          row.appendChild(elx('span', 'nums',
            `${m.logged}/${m.days} dias · treinos ${m.workoutsDone}/${m.workoutsPlanned} · proteína ${m.proteinHit}/${m.proteinDays}`));
          card.appendChild(row);
        }
        if ((ins.bests || []).length) {
          card.appendChild(elx('div', 'fit-sec-title', 'Recordes'));
          ins.bests.slice(0, 8).forEach((b) => {
            const row = elx('div', 'fit-pr');
            row.appendChild(elx('span', 'ex', b.exercise));
            row.appendChild(elx('span', 'w', `${fmt(b.weightKg)}kg × ${b.reps}`));
            card.appendChild(row);
          });
        }
      }
    }
    inner.appendChild(card);
  }

  // ── Estados vazios ───────────────────────────────────────────────────────
  function renderNoProfile() {
    if (!root) return;
    root.innerHTML = '';
    const e = elx('div', 'fit-empty');
    e.appendChild(elx('div', 'big', '⚡'));
    e.appendChild(elx('div', null, 'Sem profile de fitness no biso.'));
    const p = elx('p', 'fit-muted');
    p.innerHTML = 'Crie <code>codex/fitness/profile.json</code> no biso (o plano-template é mantido à mão — veja docs/fitness.md).';
    e.appendChild(p);
    root.appendChild(e);
  }

  function renderError(err) {
    if (!root) return;
    root.innerHTML = '';
    const e = elx('div', 'fit-empty');
    e.appendChild(elx('div', 'big', '📴'));
    e.appendChild(elx('div', null, err && err.message ? err.message : 'Erro ao falar com o biso.'));
    const retry = elx('button', 'fit-btn', 'Tentar de novo');
    retry.style.marginTop = '14px';
    retry.onclick = () => reload();
    e.appendChild(retry);
    root.appendChild(e);
  }

  // ── Contrato do módulo (padrão BISO_NOTAS/BISO_CANVAS) ──────────────────
  window.BISO_FIT = {
    mount(el) {
      el.innerHTML = '';
      root = elx('div', 'fit-root');
      el.appendChild(root);
      date = todayISO();
      day = null; weekData = null; profileData = null; insightsData = null; showInsights = false;
      openForms.clear();
      render();
      reload();
    },
    unmount() {
      closeViz();
      root = null;
      day = null; weekData = null; profileData = null; insightsData = null;
      openForms.clear();
    },
  };
})();
