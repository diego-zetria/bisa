// screens/finance.js — Tela de Finanças (redesign 2026-06-13).
// Alcançada via BISA.go('finance') a partir do Hub, não está no nav inferior.
// Layout iPad-first: duas colunas (≥900px) — esquerda glanceável (saldo,
// análise da IA, categorias, carteira), direita acionável (controle do mês,
// lançamentos, objetivos). Vira coluna única no celular. Texto em pt-BR.
//
// Endpoint shapes verificados em 2026-06-12:
//   GET  /finance/summary   → {month, cash:{income,expense,net,byCategory,incomeByCategory,manual[]}, invest:{positions[]}}
//   GET  /finance/profile   → {profile: null | {goals[],loans[],budget[],fx}, loans:[...], onboarding:{answered}}
//   GET  /finance/positions → {positions:[]}   — vazio se ledger vazio; hideable
//   POST /finance/tx        → body {date,kind,amount,category,desc} → {ok,tx}
//   DELETE /finance/tx      → ?id=<id>
//   PATCH /finance/budget   → body {category, amount}

(function () {
  // Estilos com escopo (injeta uma vez) — layout + componentes da tela.
  if (!document.getElementById('fin-style')) {
    const s = document.createElement('style');
    s.id = 'fin-style';
    s.textContent = `
      /* ── Layout ──────────────────────────────────────────────────────── */
      .fin-grid { display:grid; gap:16px; }
      .fin-col  { display:flex; flex-direction:column; min-width:0; }
      @media (min-width:900px) {
        .fin-grid { grid-template-columns:1.02fr .98fr; gap:24px; align-items:start; }
      }

      /* ── Cabeçalho ───────────────────────────────────────────────────── */
      .fin-back-btn { display:flex; align-items:center; gap:6px; background:none; border:none;
        color:var(--ink-soft); font-size:.95rem; padding:4px 0; cursor:pointer; min-height:var(--tap); }
      .fin-back-btn:hover { color:var(--ink); }
      .fin-month-nav { display:flex; align-items:center; gap:8px; margin:2px 0 18px; }
      .fin-month-nav .fin-month-label { font-weight:600; font-size:1.05rem; flex:1; text-align:center; }
      .fin-month-nav .fin-month-label::first-letter { text-transform:uppercase; }
      .fin-month-btn { background:var(--surface-2); border:none; border-radius:var(--radius-sm);
        padding:0 16px; min-height:var(--tap); cursor:pointer; font-size:1.1rem; color:var(--ink); }
      .fin-month-btn:hover { background:var(--line); }

      /* ── Hero (saldo) ────────────────────────────────────────────────── */
      .fin-hero { background:var(--surface); border:1px solid var(--line);
        border-radius:var(--radius); box-shadow:var(--shadow); padding:20px 22px; margin-bottom:16px; }
      .fin-hero-label { font-size:.78rem; letter-spacing:.02em;
        color:var(--ink-soft); font-weight:600; }
      .fin-hero-balance { font-size:2.4rem; font-weight:700; line-height:1.1; margin:2px 0 16px;
        letter-spacing:-.02em; }
      .fin-hero-balance.positive { color:var(--positive); }
      .fin-hero-balance.negative { color:var(--negative); }
      .fin-hero-seg { display:flex; height:10px; border-radius:999px; overflow:hidden;
        background:var(--surface-2); margin-bottom:14px; }
      .fin-hero-seg .seg-in  { background:var(--positive); transition:width .4s; }
      .fin-hero-seg .seg-out { background:var(--negative); transition:width .4s; }
      .fin-hero-subs { display:flex; gap:22px; }
      .fin-hero-sub { display:flex; flex-direction:column; gap:1px; }
      .fin-hero-sub .k { font-size:.78rem; color:var(--ink-soft); display:flex; align-items:center; gap:5px; }
      .fin-hero-sub .v { font-size:1.05rem; font-weight:600; }
      .fin-hero-sub .dot { width:9px; height:9px; border-radius:50%; }
      .fin-hero-sub .dot.in  { background:var(--positive); }
      .fin-hero-sub .dot.out { background:var(--negative); }

      /* ── Cabeçalho colapsável (Renda) ────────────────────────────────── */
      .fin-collapse-head { display:flex; align-items:center; gap:8px; cursor:pointer;
        margin:18px 2px 8px; min-height:var(--tap); user-select:none; }
      .fin-collapse-caret { color:var(--ink-soft); font-size:.8rem; width:14px; flex:0 0 auto; }
      .fin-collapse-title { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em;
        color:var(--ink-soft); font-weight:600; }
      .fin-collapse-vals { flex:1; text-align:right; font-size:.82rem; white-space:nowrap; }

      /* ── Categorias ──────────────────────────────────────────────────── */
      .fin-cat-row { display:flex; align-items:center; gap:10px; margin:8px 0; }
      .fin-cat-name { flex:1; font-size:.9rem; text-transform:capitalize; }
      .fin-cat-bar-wrap { flex:2; background:var(--surface-2); border-radius:999px; height:8px; overflow:hidden; }
      .fin-cat-bar { height:100%; border-radius:999px; background:var(--negative); transition:width .4s; }
      .fin-cat-amt { min-width:84px; text-align:right; font-size:.85rem; color:var(--ink-soft); }

      /* ── Lançamentos ─────────────────────────────────────────────────── */
      .fin-sec-head { display:flex; align-items:center; gap:8px; margin:18px 2px 8px; }
      .fin-sec-head .fin-sec-title { flex:1; font-size:.8rem; text-transform:uppercase;
        letter-spacing:.06em; color:var(--ink-soft); font-weight:600; }
      .fin-addbtn { background:var(--surface-2); border:none; border-radius:999px; color:var(--ink);
        padding:0 14px; min-height:36px; cursor:pointer; font-size:.85rem; font-weight:600; }
      .fin-addbtn:hover { background:var(--line); }
      .fin-tx-row { display:flex; align-items:center; gap:8px; padding:11px 4px; border-bottom:1px solid var(--line); }
      .fin-tx-row:last-child { border-bottom:none; }
      .fin-tx-date { font-size:.78rem; color:var(--ink-soft); min-width:46px; }
      .fin-tx-desc { flex:1; font-size:.95rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .fin-tx-cat  { font-size:.72rem; color:var(--ink-soft); padding:2px 8px; text-transform:capitalize;
        background:var(--surface-2); border-radius:999px; white-space:nowrap; }
      .fin-tx-amt  { font-weight:600; white-space:nowrap; min-width:84px; text-align:right; }
      .fin-tx-del  { background:none; border:none; color:var(--ink-soft); font-size:.9rem;
        padding:6px 8px; cursor:pointer; border-radius:var(--radius-sm); min-height:var(--tap);
        min-width:var(--tap); display:flex; align-items:center; justify-content:center; }
      .fin-tx-del:hover { color:var(--negative); background:var(--surface-2); }
      .fin-tx-del.confirm { color:var(--negative); font-weight:700; font-size:.78rem; min-width:auto; padding:0 10px; }

      /* ── Sheet de lançamento avulso ──────────────────────────────────── */
      .fin-sheet { overflow:hidden; max-height:0; transition:max-height .28s ease; }
      .fin-sheet.open { max-height:560px; }
      .fin-form-grid { display:grid; gap:10px; grid-template-columns:1fr 1fr; }
      .fin-seg-kind { display:flex; background:var(--surface-2); border-radius:var(--radius-sm); padding:3px; gap:3px; }
      .fin-seg-kind button { flex:1; border:none; background:none; border-radius:8px; min-height:38px;
        font-weight:600; font-size:.9rem; color:var(--ink-soft); cursor:pointer; }
      .fin-seg-kind button.on { background:var(--surface); color:var(--ink); box-shadow:var(--shadow); }
      .fin-chips { display:flex; flex-wrap:wrap; gap:7px; margin:10px 0 2px; }
      .fin-chip { background:var(--surface-2); border:1px solid var(--line); border-radius:999px;
        padding:6px 12px; font-size:.85rem; color:var(--ink); cursor:pointer; text-transform:capitalize; min-height:34px; }
      .fin-chip.on { background:var(--accent-soft); border-color:var(--primary); color:var(--primary); font-weight:600; }

      /* ── Progresso (objetivos / financiamentos) ──────────────────────── */
      .fin-progress-wrap { background:var(--surface-2); border-radius:999px; height:10px; overflow:hidden; margin:8px 0 4px; }
      .fin-progress-bar  { height:100%; border-radius:999px; background:var(--primary); transition:width .4s; }
      .fin-loan-row { display:flex; justify-content:space-between; font-size:.85rem; color:var(--ink-soft); }

      /* ── Controle do mês (orçamento) ─────────────────────────────────── */
      .fin-bud-alert { display:flex; align-items:center; gap:8px; background:rgba(176,88,79,.1);
        color:var(--negative); border-radius:var(--radius-sm); padding:9px 12px; font-size:.86rem;
        font-weight:600; margin-bottom:14px; }
      .fin-bud-alert.soft { background:var(--warn-soft); color:var(--warn); }
      .fin-bud-group { margin-bottom:16px; }
      .fin-bud-ghead { display:flex; justify-content:space-between; align-items:baseline; font-weight:600;
        font-size:.92rem; margin:14px 0 6px; padding-bottom:4px; border-bottom:1px solid var(--line); }
      .fin-bud-ghead-vals { font-size:.82rem; white-space:nowrap; }
      .fin-bud-line { padding:10px 2px 8px; }
      .fin-bud-row { display:flex; align-items:center; gap:10px; font-size:.92rem; }
      .fin-bud-status { width:11px; height:11px; border-radius:50%; flex:0 0 auto; }
      .fin-bud-status.st-pending { background:var(--line); }
      .fin-bud-status.st-ok { background:var(--positive); }
      .fin-bud-status.st-over { background:var(--negative); }
      .fin-bud-label { flex:1; min-width:0; }
      .fin-bud-due { font-size:.7rem; color:var(--ink-soft); padding:1px 6px; background:var(--surface-2); border-radius:999px; }
      .fin-bud-due.overdue { background:rgba(176,88,79,.15); color:var(--negative); font-weight:600; }
      .fin-bud-due.soon { background:var(--warn-soft); color:var(--warn); font-weight:600; }
      .fin-bud-due.paid { text-decoration:line-through; opacity:.5; }   /* dia rabiscado quando pago */
      .fin-bud-paid { font-size:.7rem; padding:1px 8px; border-radius:999px; font-weight:700;
        background:rgba(91,138,114,.18); color:var(--positive); }       /* badge "pago" verde */
      .fin-bud-action { flex:0 0 auto; display:flex; align-items:center; gap:4px; }
      .fin-bud-pay { border:1px solid var(--line); background:var(--surface-2); color:var(--ink);
        border-radius:var(--radius-sm); padding:0 18px; min-height:var(--tap); min-width:var(--tap);
        font-size:.9rem; font-weight:600; cursor:pointer; white-space:nowrap; }
      .fin-bud-pay:hover { background:var(--line); }
      .fin-bud-pay.ghost { border:none; background:none; color:var(--ink-soft); min-width:var(--tap);
        padding:0 8px; font-size:1.2rem; font-weight:400; }
      .fin-bud-check { color:var(--positive); font-size:1.3rem; padding:0 4px; }
      /* Barra grossa com os números (gasto/plano) embutidos + % à direita */
      .fin-bud-bar2 { display:flex; align-items:center; gap:10px; margin:9px 0 0 21px; }
      .fin-bud-bar2track { position:relative; flex:1; min-width:0; height:30px;
        background:var(--surface-2); border-radius:9px; overflow:hidden; }
      .fin-bud-bar2fill { position:absolute; left:0; top:0; bottom:0; border-radius:9px; transition:width .4s; }
      .fin-bud-bar2nums { position:absolute; inset:0; display:flex; align-items:center;
        justify-content:flex-end; gap:5px; padding:0 11px; font-size:.86rem;
        white-space:nowrap; pointer-events:none; }
      .fin-bud-bar2plan { pointer-events:auto; background:none; border:none; font:inherit;
        font-size:.86rem; color:var(--ink-soft); cursor:pointer; padding:1px 2px;
        border-bottom:1px dotted var(--ink-soft); }
      .fin-bud-bar2plan:hover { color:var(--ink); }
      .fin-bud-caret { color:var(--ink-soft); font-size:.75rem; margin-right:6px; }
      /* Lançamentos expandidos por categoria de despesa */
      .fin-bud-sublist { margin:8px 0 2px 21px; padding:4px 0 0; border-top:1px dashed var(--line); }
      .fin-bud-subrow { display:flex; align-items:center; gap:8px; padding:6px 2px; }
      .fin-bud-subdate { font-size:.74rem; color:var(--ink-soft); min-width:42px; }
      .fin-bud-subdesc { flex:1; min-width:0; font-size:.86rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .fin-bud-subamt { font-weight:600; font-size:.86rem; white-space:nowrap; }
      .fin-bud-subact { flex:0 0 auto; display:flex; gap:2px; }
      .fin-bud-subbtn { background:none; border:none; color:var(--ink-soft); cursor:pointer;
        min-height:var(--tap); min-width:40px; border-radius:var(--radius-sm); font-size:1.05rem; }
      .fin-bud-subbtn:hover { background:var(--surface-2); color:var(--ink); }
      .fin-bud-subbtn.del.confirm { color:var(--negative); font-weight:700; font-size:.78rem; min-width:auto; padding:0 10px; }
      .fin-bud-subempty { color:var(--ink-soft); font-size:.84rem; padding:6px 2px; }

      /* Modo Ordenar (arrastar localidades e itens) */
      .fin-reorder-gblock { border:1px solid var(--line); border-radius:var(--radius-sm);
        margin-bottom:10px; overflow:hidden; background:var(--surface); }
      .fin-reorder-ghead { display:flex; align-items:center; gap:8px; background:var(--surface-2);
        padding:8px 10px; font-weight:600; font-size:.95rem; }
      .fin-reorder-gname { flex:1; min-width:0; }
      .fin-reorder-items { padding:2px 0; }
      .fin-reorder-item { display:flex; align-items:center; gap:8px; padding:6px 10px;
        border-top:1px solid var(--line); background:var(--surface); }
      .fin-reorder-iname { flex:1; min-width:0; font-size:.92rem; }
      .fin-reorder-handle { color:var(--ink-soft); font-size:1.35rem; cursor:grab; touch-action:none;
        flex:0 0 auto; min-width:34px; min-height:var(--tap); display:flex; align-items:center; justify-content:center; }
      .fin-bud-foot { margin-top:16px; padding-top:12px; border-top:2px solid var(--line); }
      .fin-bud-foot-row { display:flex; justify-content:space-between; align-items:baseline;
        font-size:.92rem; font-weight:600; padding:3px 2px; }
      .fin-bud-foot-left { margin-top:6px; padding-top:8px; border-top:1px dashed var(--line); }
      .fin-value-pos { color:var(--positive); }
      .fin-value-neg { color:var(--negative); }

      /* Popover do "Ordenar" — ancorado no botão (ideal p/ Pencil/ponteiro) */
      .fin-sort-scrim { position:fixed; inset:0; z-index:1000; background:none; }
      .fin-sort-pop { position:fixed; z-index:1001; width:262px; background:var(--surface);
        border:1px solid var(--line); border-radius:16px; box-shadow:0 10px 34px rgba(0,0,0,.16);
        padding:6px; transform-origin:top right; transform:scale(.94); opacity:0;
        transition:transform .15s ease, opacity .15s ease; }
      .fin-sort-pop.open { transform:scale(1); opacity:1; }
      .fin-sort-pop.from-bottom { transform-origin:bottom right; }
      .fin-sort-row { display:flex; align-items:center; gap:11px; width:100%; text-align:left;
        background:none; border:none; font:inherit; color:var(--ink); cursor:pointer;
        padding:10px 11px; border-radius:11px; min-height:var(--tap); }
      .fin-sort-row:active { background:var(--surface-2); }
      @media (hover:hover) { .fin-sort-row:hover { background:var(--surface-2); } }
      .fin-sort-row.on { background:var(--accent-soft); }
      .fin-sort-rtext { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
      .fin-sort-rlabel { font-size:.96rem; font-weight:600; }
      .fin-sort-row.on .fin-sort-rlabel { color:var(--primary); }
      .fin-sort-rdesc { font-size:.78rem; color:var(--ink-soft); }
      .fin-sort-rcheck { color:var(--primary); font-size:1.1rem; flex:0 0 auto; width:18px; text-align:center; }
      .fin-sort-rchev { color:var(--ink-soft); font-size:1.35rem; flex:0 0 auto; line-height:1; }
      .fin-sort-div { height:1px; background:var(--line); margin:5px 10px; }

      /* ── Sheet de valor (iPad + Pencil): campo Scribble + teclado grande ─ */
      .fin-amount-overlay { position:fixed; inset:0; background:rgba(0,0,0,.38);
        display:flex; align-items:center; justify-content:center; padding:20px; z-index:1000; }
      .fin-amount-modal { background:var(--surface); border-radius:var(--radius); box-shadow:var(--shadow);
        width:100%; max-width:340px; padding:20px; }
      .fin-amount-title { font-weight:600; font-size:1rem; margin-bottom:14px; text-align:center; }
      .fin-amount-fieldwrap { display:flex; align-items:center; gap:8px; background:var(--surface-2);
        border:2px solid var(--line); border-radius:var(--radius-sm); padding:10px 14px; }
      .fin-amount-fieldwrap:focus-within { border-color:var(--primary); }
      .fin-amount-cur { font-size:1.3rem; font-weight:600; color:var(--ink-soft); }
      .fin-amount-input { flex:1; min-width:0; border:none; background:none; outline:none; padding:0;
        font-size:2rem; font-weight:700; color:var(--ink); text-align:right; letter-spacing:-.01em; }
      .fin-amount-preview { text-align:right; color:var(--ink-soft); font-size:.9rem;
        margin:6px 2px 0; min-height:1.2em; }
      .fin-amount-pad { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:16px 0; }
      .fin-amount-key { min-height:58px; border:none; border-radius:var(--radius-sm); background:var(--surface-2);
        font-size:1.4rem; font-weight:600; color:var(--ink); cursor:pointer; }
      .fin-amount-key:active { background:var(--line); }
      .fin-amount-chip { width:100%; min-height:var(--tap); margin-bottom:10px; border:1px dashed var(--primary);
        background:var(--accent-soft); color:var(--primary); border-radius:var(--radius-sm);
        font-weight:600; font-size:.92rem; cursor:pointer; }
      .fin-amount-actions { display:grid; grid-template-columns:1fr 2fr; gap:10px; }
      .fin-amount-cancel { min-height:var(--tap); border:1px solid var(--line); background:var(--surface-2);
        color:var(--ink); border-radius:var(--radius-sm); font-weight:600; cursor:pointer; }
      /* Campo "Valor" do avulso: parece um input, mas abre o teclado grande. */
      .fin-amount-display { font-family:inherit; font-size:1rem; background:var(--surface);
        border:1px solid var(--line); border-radius:var(--radius-sm); padding:11px 13px; width:100%;
        min-height:var(--tap); text-align:left; color:var(--ink); cursor:pointer; }
      .fin-amount-display.is-empty { color:var(--ink-soft); }
    `;
    document.head.appendChild(s);
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  const brl = (v) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

  const fmtDate = (iso) => {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  };

  const monthLabel = (ym) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const prevMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const nextMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const thisMonth = () => todayISO().slice(0, 7);

  // Smart defaults: lembra o último tipo/categoria usados no lançamento avulso.
  const LAST_KEY = 'bisa_fin_last';
  const loadLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)) || {}; } catch { return {}; } };
  const saveLast = (o) => { try { localStorage.setItem(LAST_KEY, JSON.stringify(o)); } catch {} };

  // Categorias-base p/ os chips quando ainda não há orçamento nem histórico.
  const DEFAULT_CATS = ['alimentação', 'transporte', 'casa', 'lazer', 'saúde', 'outro'];

  const elt = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  window.BISA.screens['finance'] = {
    _el: null,
    _month: thisMonth(),
    _sheetOpen: false,
    _incomeCollapsed: false, // seção "Renda" recolhida?
    _expandedCats: new Set(), // categorias de despesa com os lançamentos abertos
    _reorderMode: false, // "Controle do mês" em modo de reordenação?
    _sortMode: 'manual', // ordenação rápida da vista: manual|due|unpaid|spend (temporária; não persiste)
    _sortables: [], // instâncias SortableJS ativas (modo ordenar)
    _incomeCatsOrder: [], // ordem das categorias de renda, preservada ao salvar a ordem

    mount(el) {
      this._el = el;
      this._month = thisMonth();
      this._render();
    },

    unmount() {
      this._closeAmountSheet();
      this._closeSortMenu();
      this._destroySortables();
      this._el = null;
    },

    _destroySortables() {
      this._sortables.forEach((s) => { try { s.destroy(); } catch {} });
      this._sortables = [];
    },

    // preserveScroll=true mantém a posição de scroll (re-render após editar/pagar/
    // excluir, que ficam na mesma vista). Navegação de mês reseta ao topo.
    _render(preserveScroll) {
      const el = this._el;
      if (!el) return;
      const scroller = el.parentNode; // #screen (overflow-y:auto)
      const savedTop = preserveScroll && scroller ? scroller.scrollTop : 0;
      el.innerHTML = '';

      // Cabeçalho: voltar + navegação de mês.
      const back = elt('button', 'fin-back-btn');
      back.innerHTML = '← Hoje';
      back.onclick = () => BISA.go('hub');
      el.appendChild(back);

      const monthNav = elt('div', 'fin-month-nav');
      const prevBtn = elt('button', 'fin-month-btn', '‹');
      prevBtn.setAttribute('aria-label', 'Mês anterior');
      prevBtn.onclick = () => { this._month = prevMonth(this._month); this._render(); };
      const nextBtn = elt('button', 'fin-month-btn', '›');
      nextBtn.setAttribute('aria-label', 'Próximo mês');
      nextBtn.onclick = () => { this._month = nextMonth(this._month); this._render(); };
      const mlabel = elt('span', 'fin-month-label', monthLabel(this._month));
      monthNav.append(prevBtn, mlabel, nextBtn);
      el.appendChild(monthNav);

      // Grade de duas colunas (iPad) / coluna única (celular).
      const grid = elt('div', 'fin-grid');
      const colMain = elt('div', 'fin-col'); // dashboard glanceável
      const colSide = elt('div', 'fin-col'); // ações
      grid.append(colMain, colSide);
      el.appendChild(grid);

      // Coluna esquerda: saldo, categorias, carteira.
      const heroWrap = elt('div');
      const catWrap = elt('div');
      const investCard = elt('div'); // escondido até haver posições
      colMain.append(heroWrap, catWrap, investCard);

      // Coluna direita: renda (colapsável), controle do mês, lançamentos, objetivos.
      const incomeWrap = elt('div');
      const budgetWrap = elt('div');
      const txWrap = elt('div');
      const goalWrap = elt('div');
      colSide.append(incomeWrap, budgetWrap, txWrap, goalWrap);

      // Carrega summary + profile em paralelo.
      const month = this._month;
      Promise.all([
        BISA.api(`/finance/summary?month=${month}`).catch(() => null),
        BISA.api('/finance/profile').catch(() => null),
      ]).then(([summary, profileResp]) => {
        this._summary = summary; // usado por _setRealized p/ achar os lançamentos a substituir
        this._fillHero(heroWrap, summary);
        this._fillCategories(catWrap, summary);
        this._fillIncome(incomeWrap, profileResp, summary);
        this._fillBudget(budgetWrap, profileResp, summary);
        this._fillTx(txWrap, summary, profileResp, month);
        this._fillGoals(goalWrap, profileResp);
        if (preserveScroll && scroller) scroller.scrollTop = savedTop;
      });

      // Investimentos: só aparece se houver posições.
      BISA.api('/finance/positions').then((data) => {
        const positions = (data && data.positions) || [];
        if (positions.length > 0) this._fillInvestments(investCard, positions);
      }).catch(() => {});
    },

    // ── Hero (saldo) ─────────────────────────────────────────────────────
    _fillHero(wrap, summary) {
      wrap.innerHTML = '';
      const cash = (summary && summary.cash) || { income: 0, expense: 0, net: 0 };
      const { income = 0, expense = 0, net = 0 } = cash;

      const hero = elt('div', 'fin-hero');
      hero.appendChild(elt('div', 'fin-hero-label', `Saldo de ${monthLabel(this._month).split(' de ')[0]}`));

      const bal = elt('div', 'fin-hero-balance ' + (net >= 0 ? 'positive' : 'negative'), brl(net));
      hero.appendChild(bal);

      // Barra segmentada receita × gasto.
      const total = income + expense;
      const seg = elt('div', 'fin-hero-seg');
      const segIn = elt('div', 'seg-in');
      const segOut = elt('div', 'seg-out');
      segIn.style.width = total > 0 ? `${(income / total) * 100}%` : '50%';
      segOut.style.width = total > 0 ? `${(expense / total) * 100}%` : '50%';
      seg.append(segIn, segOut);
      hero.appendChild(seg);

      const subs = elt('div', 'fin-hero-subs');
      const mkSub = (dotCls, label, value) => {
        const sub = elt('div', 'fin-hero-sub');
        const k = elt('span', 'k');
        k.append(elt('span', 'dot ' + dotCls), document.createTextNode(label));
        sub.append(k, elt('span', 'v', value));
        return sub;
      };
      subs.append(mkSub('in', 'Receitas', brl(income)), mkSub('out', 'Gastos', brl(expense)));
      hero.appendChild(subs);
      wrap.appendChild(hero);

      if (total === 0) {
        const hint = elt('p', 'muted');
        hint.style.cssText = 'text-align:center;margin:4px 0 8px;font-size:.9rem';
        hint.textContent = 'Sem movimento neste mês. Use o controle e os lançamentos ao lado.';
        wrap.appendChild(hint);
      }
    },

    // ── Categorias (gastos do mês) ───────────────────────────────────────
    _fillCategories(wrap, summary) {
      wrap.innerHTML = '';
      const cats = Object.entries((summary && summary.cash && summary.cash.byCategory) || {});
      if (cats.length === 0) return;

      wrap.appendChild(elt('p', 'section-title', 'Gastos por categoria'));
      const card = elt('div', 'card');
      const maxVal = Math.max(...cats.map(([, v]) => v), 1);
      cats.sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([cat, val]) => {
        const row = elt('div', 'fin-cat-row');
        const bar = elt('div', 'fin-cat-bar');
        bar.style.width = `${Math.min(100, (val / maxVal) * 100).toFixed(1)}%`;
        const barWrap = elt('div', 'fin-cat-bar-wrap');
        barWrap.appendChild(bar);
        row.append(elt('span', 'fin-cat-name', cat), barWrap, elt('span', 'fin-cat-amt', brl(val)));
        card.appendChild(row);
      });
      wrap.appendChild(card);
    },

    // ── Lançamentos do mês (com sheet de avulso) ─────────────────────────
    _fillTx(wrap, summary, profileResp, month) {
      wrap.innerHTML = '';

      // Cabeçalho da seção com botão de avulso.
      const head = elt('div', 'fin-sec-head');
      head.appendChild(elt('span', 'fin-sec-title', 'Lançamentos do mês'));
      const addBtn = elt('button', 'fin-addbtn', '+ Avulso');
      head.appendChild(addBtn);
      wrap.appendChild(head);

      // Sheet recolhível com o formulário avulso.
      const sheet = this._buildSheet(summary, profileResp);
      if (this._sheetOpen) sheet.classList.add('open');
      addBtn.onclick = () => {
        this._sheetOpen = !this._sheetOpen;
        sheet.classList.toggle('open', this._sheetOpen);
        addBtn.textContent = this._sheetOpen ? '× Fechar' : '+ Avulso';
      };
      if (this._sheetOpen) addBtn.textContent = '× Fechar';
      wrap.appendChild(sheet);

      // Lista.
      const card = elt('div', 'card');
      card.style.padding = '8px 16px';
      const txs = (summary && summary.cash && summary.cash.manual) || [];
      const sorted = [...txs].sort((a, b) => (a.date < b.date ? 1 : -1));

      if (sorted.length === 0) {
        const empty = elt('div', 'empty');
        empty.innerHTML = '<div style="font-size:2rem;margin-bottom:8px">💸</div>Nenhum lançamento em ' + monthLabel(month) + '.';
        card.appendChild(empty);
        wrap.appendChild(card);
        return;
      }

      sorted.forEach((tx) => {
        const row = elt('div', 'fin-tx-row');
        const amtEl = elt('span', 'fin-tx-amt');
        const isExpense = tx.kind === 'expense';
        amtEl.style.color = isExpense ? 'var(--negative)' : 'var(--positive)';
        amtEl.textContent = (isExpense ? '−' : '+') + brl(tx.amount);

        const delBtn = elt('button', 'fin-tx-del', '✕');
        delBtn.title = 'Apagar lançamento';
        // Delete em dois toques (sem confirm() nativo, melhor no iPad).
        let armed = false, timer = null;
        delBtn.onclick = async () => {
          if (!armed) {
            armed = true;
            delBtn.classList.add('confirm');
            delBtn.textContent = 'Apagar?';
            timer = setTimeout(() => {
              armed = false; delBtn.classList.remove('confirm'); delBtn.textContent = '✕';
            }, 3000);
            return;
          }
          clearTimeout(timer);
          try {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}`, { method: 'DELETE' });
            BISA.toast('Lançamento apagado');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao apagar'); }
        };

        row.append(
          elt('span', 'fin-tx-date', fmtDate(tx.date)),
          elt('span', 'fin-tx-desc', tx.desc || '—'),
          elt('span', 'fin-tx-cat', tx.category || 'outro'),
          amtEl, delBtn,
        );
        card.appendChild(row);
      });
      wrap.appendChild(card);
    },

    // Formulário avulso dentro do sheet. Chips de categoria (orçamento +
    // histórico recente) e smart defaults (último tipo/categoria).
    _buildSheet(summary, profileResp) {
      const sheet = elt('div', 'fin-sheet');
      const card = elt('div', 'card');

      const last = loadLast();
      const state = { kind: last.kind || 'expense', category: last.category || '', amount: 0 };

      // Seletor de tipo (segmentado).
      const segKind = elt('div', 'fin-seg-kind');
      const expBtn = elt('button', state.kind === 'expense' ? 'on' : '', 'Gasto');
      const incBtn = elt('button', state.kind === 'income' ? 'on' : '', 'Receita');
      expBtn.onclick = () => { state.kind = 'expense'; expBtn.classList.add('on'); incBtn.classList.remove('on'); };
      incBtn.onclick = () => { state.kind = 'income'; incBtn.classList.add('on'); expBtn.classList.remove('on'); };
      segKind.append(expBtn, incBtn);
      card.appendChild(segKind);

      // Valor (abre o teclado grande) + data.
      const grid = elt('div', 'fin-form-grid');
      grid.style.marginTop = '10px';
      const amtBtn = elt('button', 'fin-amount-display is-empty');
      const syncAmt = () => {
        amtBtn.textContent = state.amount > 0 ? brl(state.amount) : 'Valor (R$)';
        amtBtn.classList.toggle('is-empty', !(state.amount > 0));
      };
      syncAmt();
      amtBtn.onclick = () => this._openAmountSheet({
        title: 'Valor do lançamento',
        initial: state.amount || null,
        confirmLabel: 'OK',
        onConfirm: (amount) => { state.amount = amount; syncAmt(); },
      });
      const dateInput = elt('input');
      dateInput.type = 'date'; dateInput.value = todayISO();
      grid.append(amtBtn, dateInput);
      card.appendChild(grid);

      // Descrição.
      const descInput = elt('input');
      descInput.type = 'text'; descInput.placeholder = 'Descrição (ex: mercado, almoço…)';
      descInput.maxLength = 200; descInput.style.marginTop = '10px';
      card.appendChild(descInput);

      // Chips de categoria + campo livre.
      const catInput = elt('input');
      catInput.type = 'text'; catInput.placeholder = 'Categoria';
      catInput.maxLength = 40; catInput.style.marginTop = '10px';
      catInput.value = state.category;

      const chips = elt('div', 'fin-chips');
      const profile = profileResp && profileResp.profile;
      const budgetCats = (profile && profile.budget || []).map((b) => b.category).filter(Boolean);
      const recentCats = ((summary && summary.cash && summary.cash.manual) || []).map((t) => t.category).filter(Boolean);
      const cats = [...new Set([...budgetCats, ...recentCats, ...DEFAULT_CATS])].slice(0, 10);
      const syncChips = () => chips.querySelectorAll('.fin-chip').forEach((c) =>
        c.classList.toggle('on', c.dataset.cat === catInput.value.trim().toLowerCase()));
      cats.forEach((cat) => {
        const chip = elt('button', 'fin-chip', cat);
        chip.dataset.cat = cat.toLowerCase();
        chip.onclick = () => { catInput.value = cat; syncChips(); };
        chips.appendChild(chip);
      });
      catInput.oninput = syncChips;
      card.appendChild(chips);
      card.appendChild(catInput);
      syncChips();

      // Salvar.
      const btn = elt('button', 'btn block', 'Salvar lançamento');
      btn.style.marginTop = '14px';
      btn.onclick = async () => {
        const amount = state.amount;
        if (!amount || amount <= 0) { BISA.toast('Informe um valor válido'); return; }
        const category = catInput.value.trim() || 'outro';
        btn.disabled = true; btn.textContent = 'Salvando…';
        try {
          await BISA.api('/finance/tx', {
            method: 'POST',
            json: { kind: state.kind, amount, desc: descInput.value.trim() || 'sem descrição',
              category, date: dateInput.value || todayISO() },
          });
          saveLast({ kind: state.kind, category });
          BISA.toast('Lançamento salvo!');
          this._render(true);
        } catch (e) {
          BISA.toast(e.message || 'Erro ao salvar');
          btn.disabled = false; btn.textContent = 'Salvar lançamento';
        }
      };
      card.appendChild(btn);

      sheet.appendChild(card);
      return sheet;
    },

    // Realizado (BRL) de uma linha — entradas leem incomeByCategory, saídas byCategory.
    _planBRL(b, fx) {
      return (b.amount != null ? Number(b.amount)
        : (b.amountUSD != null && fx ? Number(b.amountUSD) * fx : 0)) || 0;
    },

    // Renderiza uma linha do orçamento (status, label+vencimento, realizado/plano,
    // controle de pagamento, barra) em `parent`. Reaproveitado por Renda e Despesas.
    // ctx: { fx, doneMap, isThisMonth, todayDay }. Retorna { plan, done }.
    _budgetLine(parent, b, ctx) {
      const income = b.kind === 'income';
      const plan = this._planBRL(b, ctx.fx);
      const done = Number(ctx.doneMap[b.category] || 0);
      let status = 'pending';
      if (done > 0) status = (!income && done > plan + 0.005) ? 'over' : 'ok';
      const overdue = ctx.isThisMonth && status === 'pending' && b.dueDay && ctx.todayDay > b.dueDay;
      const soon = ctx.isThisMonth && status === 'pending' && b.dueDay && !overdue && (b.dueDay - ctx.todayDay <= 5);

      const expanded = !income && this._expandedCats.has(b.category);

      const line = elt('div', 'fin-bud-line');
      const row = elt('div', 'fin-bud-row');

      const paid = done > 0; // pago/recebido: rabisca o dia e ganha o badge verde
      const label = elt('span', 'fin-bud-label', b.label || b.category || '—');
      if (b.dueDay) {
        const due = elt('span', 'fin-bud-due' + (paid ? ' paid' : overdue ? ' overdue' : soon ? ' soon' : ''));
        due.textContent = overdue ? `venceu dia ${b.dueDay}` : `dia ${b.dueDay}`;
        label.append(' ', due);
      }
      if (paid) label.append(' ', elt('span', 'fin-bud-paid', income ? 'recebido' : 'pago'));
      if (!income) {
        // Despesa: tocar no nome expande os lançamentos da categoria (editar/excluir).
        // Abre/fecha localmente (sem re-render) p/ não perder a posição de scroll.
        label.style.cursor = 'pointer';
        const caret = elt('span', 'fin-bud-caret', expanded ? '▾' : '▸');
        label.prepend(caret);
        label.onclick = () => {
          if (this._expandedCats.has(b.category)) {
            this._expandedCats.delete(b.category);
            const sub = line.querySelector('.fin-bud-sublist');
            if (sub) sub.remove();
            caret.textContent = '▸';
          } else {
            this._expandedCats.add(b.category);
            this._renderTxSublist(line, b);
            caret.textContent = '▾';
          }
        };
      }

      const action = elt('span', 'fin-bud-action');
      if (ctx.isThisMonth) this._renderPayControl(action, b, plan, done, income);
      row.append(elt('span', `fin-bud-status st-${overdue ? 'over' : status}`), label);
      line.appendChild(row);

      // Barra grossa: o gasto preenche a barra e os números (gasto / plano)
      // ficam sobre ela; a ação (Pagar/Receber) vai à direita, na mesma linha.
      // O plano segue editável (toque abre o teclado).
      const noCur = (v) => brl(v).replace(/^R\$\s?/, ''); // plano sem "R$" p/ não repetir
      const ratio = plan > 0 ? Math.min(1, done / plan) : (done > 0 ? 1 : 0);

      const fill = elt('div', 'fin-bud-bar2fill');
      fill.style.width = `${(ratio * 100).toFixed(0)}%`;
      fill.style.background = (overdue || status === 'over') ? 'rgba(176,88,79,.32)'
        : status === 'ok' ? 'rgba(91,138,114,.32)' : 'transparent';

      const doneEl = elt('strong', status === 'over' ? 'fin-value-neg' : null, done > 0 ? brl(done) : '—');
      const planEl = elt('button', 'fin-bud-bar2plan', noCur(plan));
      planEl.title = 'Editar valor planejado';
      planEl.onclick = () => this._editPlan(planEl, b, plan);
      const nums = elt('div', 'fin-bud-bar2nums');
      nums.append(doneEl, elt('span', 'muted', '/'), planEl);

      const track = elt('div', 'fin-bud-bar2track');
      track.append(fill, nums);

      const bar2 = elt('div', 'fin-bud-bar2');
      bar2.append(track, action);
      line.appendChild(bar2);

      if (expanded) this._renderTxSublist(line, b);

      parent.appendChild(line);
      return { plan, done };
    },

    // Lista de lançamentos de uma despesa (categoria) no mês exibido, com editar
    // (abre o teclado p/ novo valor) e excluir (2 toques). Usa this._summary.
    _renderTxSublist(line, b) {
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const txs = manual.filter((t) => t.kind === 'expense' && t.category === b.category)
        .sort((a, c) => (a.date < c.date ? 1 : -1));

      const sub = elt('div', 'fin-bud-sublist');
      if (txs.length === 0) {
        sub.appendChild(elt('div', 'fin-bud-subempty', 'Nenhum lançamento ainda neste mês.'));
        line.appendChild(sub);
        return;
      }

      txs.forEach((tx) => {
        const srow = elt('div', 'fin-bud-subrow');
        const act = elt('span', 'fin-bud-subact');

        const edit = elt('button', 'fin-bud-subbtn', '✎');
        edit.title = 'Editar valor';
        edit.onclick = () => this._openAmountSheet({
          title: tx.desc || b.label || b.category || 'Valor',
          initial: tx.amount,
          confirmLabel: 'Salvar',
          onConfirm: (amount) => this._editTx(tx, amount),
        });

        const del = elt('button', 'fin-bud-subbtn del', '✕');
        del.title = 'Excluir lançamento';
        let armed = false, timer = null;
        del.onclick = async () => {
          if (!armed) {
            armed = true; del.classList.add('confirm'); del.textContent = 'Excluir?';
            timer = setTimeout(() => { armed = false; del.classList.remove('confirm'); del.textContent = '✕'; }, 3000);
            return;
          }
          clearTimeout(timer);
          try {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}`, { method: 'DELETE' });
            BISA.toast('Lançamento excluído');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        };

        act.append(edit, del);
        srow.append(
          elt('span', 'fin-bud-subdate', fmtDate(tx.date)),
          elt('span', 'fin-bud-subdesc', tx.desc || '—'),
          elt('span', 'fin-bud-subamt', brl(tx.amount)),
          act,
        );
        sub.appendChild(srow);
      });
      line.appendChild(sub);
    },

    // Edita um lançamento (só o valor): apaga e recria com o mesmo dado e o novo
    // valor (o backend só tem POST/DELETE de tx, sem PATCH).
    async _editTx(tx, amount) {
      try {
        await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}`, { method: 'DELETE' });
        await BISA.api('/finance/tx', {
          method: 'POST',
          json: { kind: tx.kind, amount, desc: tx.desc, category: tx.category, date: tx.date },
        });
        BISA.toast('Lançamento atualizado!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao atualizar'); }
    },

    // ── Renda (seção própria, colapsável) ────────────────────────────────
    // As linhas kind:'income' do orçamento, fora do controle de despesas. O
    // cabeçalho mostra o total realizado/planejado mesmo quando recolhido.
    _fillIncome(wrap, profileResp, summary) {
      wrap.innerHTML = '';
      const profile = profileResp && profileResp.profile;
      const lines = ((profile && profile.budget) || []).filter((b) => b.kind === 'income');
      if (lines.length === 0) return;

      const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const ctx = {
        fx,
        doneMap: (summary && summary.cash && summary.cash.incomeByCategory) || {},
        isThisMonth: this._month === thisMonth(),
        todayDay: new Date().getDate(),
      };
      const planTotal = lines.reduce((s, b) => s + this._planBRL(b, fx), 0);
      const doneTotal = lines.reduce((s, b) => s + Number(ctx.doneMap[b.category] || 0), 0);
      const collapsed = this._incomeCollapsed;

      // Cabeçalho clicável: alterna recolhido/expandido (mantém o total visível).
      const head = elt('div', 'fin-collapse-head');
      head.append(
        elt('span', 'fin-collapse-caret', collapsed ? '▸' : '▾'),
        elt('span', 'fin-collapse-title', 'Renda'),
      );
      const tot = elt('span', 'fin-collapse-vals');
      tot.innerHTML = `<strong class="fin-value-pos">${brl(doneTotal)}</strong> <span class="muted">/ ${brl(planTotal)}</span>`;
      head.appendChild(tot);
      head.onclick = () => { this._incomeCollapsed = !this._incomeCollapsed; this._render(true); };
      wrap.appendChild(head);
      if (collapsed) return;

      const card = elt('div', 'card');
      lines.forEach((b) => this._budgetLine(card, b, ctx));
      wrap.appendChild(card);
    },

    // Popover do "Ordenar", ancorado no botão — ideal p/ Pencil/ponteiro no
    // iPad: abre coladinho onde tocou, com pouco deslocamento. Opções em duas
    // linhas com ✓ na ativa + a opção de reordenar manualmente (arrastar),
    // separada por ser outro fluxo. As ordenações rápidas são vista temporária.
    _openSortMenu(anchor) {
      this._closeSortMenu();
      const scrim = elt('div', 'fin-sort-scrim'); // captura o toque/clique fora
      const pop = elt('div', 'fin-sort-pop');

      const mkRow = (label, desc, trailing, isOn, onClick) => {
        const row = elt('button', 'fin-sort-row' + (isOn ? ' on' : ''));
        const txt = elt('div', 'fin-sort-rtext');
        txt.append(elt('span', 'fin-sort-rlabel', label), elt('span', 'fin-sort-rdesc', desc));
        row.append(txt, trailing);
        row.onclick = onClick;
        pop.appendChild(row);
      };

      const pick = (mode) => { this._sortMode = mode; this._closeSortMenu(); this._render(true); };
      [
        ['manual', 'Padrão', 'Ordem que você salvou'],
        ['due', 'Por vencimento', 'Contas que vencem antes primeiro'],
        ['unpaid', 'Pendentes primeiro', 'O que ainda não foi pago no topo'],
        ['spend', 'Maior gasto', 'Onde você mais gastou no mês'],
      ].forEach(([mode, label, desc]) => {
        const on = this._sortMode === mode;
        mkRow(label, desc, elt('span', 'fin-sort-rcheck', on ? '✓' : ''), on, () => pick(mode));
      });

      pop.appendChild(elt('div', 'fin-sort-div'));
      mkRow('Reordenar manualmente', 'Arraste para definir a ordem',
        elt('span', 'fin-sort-rchev', '›'), false,
        () => { this._closeSortMenu(); this._reorderMode = true; this._render(true); });

      scrim.onclick = () => this._closeSortMenu();
      this._sortKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeSortMenu(); };
      document.addEventListener('keydown', this._sortKeyHandler);

      document.body.append(scrim, pop);
      this._sortScrim = scrim;
      this._sortPop = pop;

      // Posiciona junto ao botão (alinhado à direita; vira p/ cima se não couber
      // abaixo). Medido após inserir no DOM.
      const r = anchor.getBoundingClientRect();
      const gap = 8, margin = 8;
      let left = Math.max(margin, r.right - pop.offsetWidth);
      let top = r.bottom + gap;
      if (top + pop.offsetHeight > window.innerHeight - margin) {
        top = r.top - gap - pop.offsetHeight;
        pop.classList.add('from-bottom');
      }
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;

      requestAnimationFrame(() => pop.classList.add('open')); // dispara a animação de entrada
    },

    _closeSortMenu() {
      if (this._sortKeyHandler) {
        document.removeEventListener('keydown', this._sortKeyHandler);
        this._sortKeyHandler = null;
      }
      if (this._sortScrim) { this._sortScrim.remove(); this._sortScrim = null; }
      const pop = this._sortPop;
      if (!pop) return;
      this._sortPop = null;
      pop.classList.remove('open');
      setTimeout(() => pop.remove(), 160); // aguarda a animação de saída
    },

    // Ordena uma cópia dos itens de um grupo conforme this._sortMode (vista
    // temporária). 'manual' preserva a ordem salva. Empates e itens sem dado
    // caem para o fim mantendo a ordem original (sort estável via índice).
    _sortItems(items, doneBRL) {
      const mode = this._sortMode;
      if (mode === 'manual') return items;
      const keyed = items.map((b, i) => ({ b, i }));
      const dueOf = (b) => (b.dueDay || 9999); // sem vencimento → fim (finito, evita NaN)
      const cmp = {
        // Vencimento: menor dia primeiro; sem vencimento por último.
        due: (x, y) => (dueOf(x.b) - dueOf(y.b)),
        // Pendentes: não pagos primeiro; dentro de cada bloco, por vencimento.
        unpaid: (x, y) => ((doneBRL(x.b) > 0.005) - (doneBRL(y.b) > 0.005))
          || (dueOf(x.b) - dueOf(y.b)),
        // Maior gasto: realizado decrescente.
        spend: (x, y) => (doneBRL(y.b) - doneBRL(x.b)),
      }[mode];
      return keyed.sort((x, y) => (cmp(x, y) || (x.i - y.i))).map((k) => k.b);
    },

    // ── Controle do mês (despesas planejadas × realizadas) ───────────────
    // Cada linha de despesa (profile.budget, kind ≠ income) é casada com o
    // realizado (summary.cash.byCategory) pela categoria. Mostra status, alerta
    // de contas vencidas/a vencer, e pagamento em 1 toque. Renda fica à parte.
    _fillBudget(wrap, profileResp, summary) {
      wrap.innerHTML = '';
      this._destroySortables();
      const profile = profileResp && profileResp.profile;
      const allBudget = (profile && profile.budget) || [];
      const budget = allBudget.filter((b) => b.kind !== 'income');
      if (budget.length === 0) return;
      this._incomeCatsOrder = allBudget.filter((b) => b.kind === 'income').map((b) => b.category);

      // Cabeçalho com botão Ordenar/Concluir.
      const head = elt('div', 'fin-sec-head');
      head.appendChild(elt('span', 'fin-sec-title', 'Controle do mês'));
      const orderBtn = elt('button', 'fin-addbtn', this._reorderMode ? '✓ Concluir' : '↕ Ordenar');
      head.appendChild(orderBtn);
      wrap.appendChild(head);

      if (this._reorderMode) {
        orderBtn.onclick = () => this._saveOrder(wrap);
        this._renderReorder(wrap, budget);
        return;
      }
      orderBtn.onclick = () => this._openSortMenu(orderBtn);

      const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const spentBy = (summary && summary.cash && summary.cash.byCategory) || {};
      const isThisMonth = this._month === thisMonth();
      const todayDay = new Date().getDate();
      const ctx = { fx, doneMap: spentBy, isThisMonth, todayDay };

      const planBRL = (b) => this._planBRL(b, fx);
      const doneBRL = (b) => Number(spentBy[b.category] || 0);

      const card = elt('div', 'card');

      // Agrupa preservando a ordem de aparição dos grupos.
      const groups = [];
      const byGroup = {};
      for (const b of budget) {
        const g = b.group || 'Outros';
        if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
        byGroup[g].push(b);
      }

      // Recurring bills: conta vencidas e a vencer (≤5 dias) entre as pendentes.
      let overdueCount = 0, soonCount = 0;
      if (isThisMonth) {
        for (const b of budget) {
          if (!b.dueDay) continue;
          if (doneBRL(b) > 0) continue;
          if (todayDay > b.dueDay) overdueCount++;
          else if (b.dueDay - todayDay <= 5) soonCount++;
        }
      }
      if (overdueCount > 0) {
        const a = elt('div', 'fin-bud-alert');
        a.textContent = `⚠ ${overdueCount} conta${overdueCount > 1 ? 's' : ''} vencida${overdueCount > 1 ? 's' : ''}` +
          (soonCount > 0 ? ` · ${soonCount} vence em breve` : '');
        card.appendChild(a);
      } else if (soonCount > 0) {
        const a = elt('div', 'fin-bud-alert soft');
        a.textContent = `🗓 ${soonCount} conta${soonCount > 1 ? 's' : ''} vence${soonCount > 1 ? 'm' : ''} em breve`;
        card.appendChild(a);
      }

      let planOut = 0, doneOut = 0, leftToPay = 0;

      groups.forEach((g) => {
        const items = byGroup[g];
        const gPlan = items.reduce((s, b) => s + planBRL(b), 0);
        const gDone = items.reduce((s, b) => s + doneBRL(b), 0);
        planOut += gPlan; doneOut += gDone;

        const gwrap = elt('div', 'fin-bud-group');
        const ghead = elt('div', 'fin-bud-ghead');
        const gtot = elt('span', 'fin-bud-ghead-vals');
        gtot.innerHTML = `<strong>${brl(gDone)}</strong> <span class="muted">/ ${brl(gPlan)}</span>`;
        ghead.append(elt('span', null, g), gtot);
        gwrap.appendChild(ghead);

        this._sortItems(items, doneBRL).forEach((b) => {
          const { plan, done } = this._budgetLine(gwrap, b, ctx);
          leftToPay += Math.max(0, plan - done);
        });

        card.appendChild(gwrap);
      });

      // Rodapé: realizado × planejado + quanto ainda falta pagar.
      const foot = elt('div', 'fin-bud-foot');
      const mk = (lbl, done, plan, cls) => {
        const r = elt('div', 'fin-bud-foot-row');
        const v = elt('span');
        v.innerHTML = `<strong class="${cls || ''}">${brl(done)}</strong> <span class="muted">/ ${brl(plan)}</span>`;
        r.append(elt('span', null, lbl), v);
        return r;
      };
      foot.appendChild(mk('Saídas', doneOut, planOut, doneOut > planOut ? 'fin-value-neg' : ''));
      if (isThisMonth) {
        const left = elt('div', 'fin-bud-foot-row fin-bud-foot-left');
        const v = elt('span', 'fin-value-neg', brl(leftToPay));
        left.append(elt('span', null, 'Ainda falta pagar'), v);
        foot.appendChild(left);
      }
      card.appendChild(foot);
      wrap.appendChild(card);
    },

    // ── Modo Ordenar (arrastar localidades e itens) ──────────────────────
    // Lista enxuta: cada grupo é arrastável pela alça do cabeçalho; cada item
    // é arrastável pela sua alça (Sortable independente por grupo → itens não
    // saem da localidade). "Concluir" coleta a ordem do DOM e persiste.
    _renderReorder(wrap, budget) {
      const card = elt('div', 'card');
      const hint = elt('p', 'muted', 'Arraste pela alça ≡ para reordenar as localidades e os itens dentro de cada uma.');
      hint.style.cssText = 'font-size:.84rem;margin:0 0 12px';
      card.appendChild(hint);

      // Agrupa preservando a ordem de aparição.
      const groups = [];
      const byGroup = {};
      for (const b of budget) {
        const g = b.group || 'Outros';
        if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
        byGroup[g].push(b);
      }

      const mkHandle = (extra) => elt('span', `fin-reorder-handle ${extra}`, '≡');

      const groupsBox = elt('div', 'fin-reorder-groups');
      groups.forEach((g) => {
        const gblock = elt('div', 'fin-reorder-gblock');
        gblock.dataset.group = g;

        const ghead = elt('div', 'fin-reorder-ghead');
        ghead.append(mkHandle('fin-reorder-ghandle'), elt('span', 'fin-reorder-gname', g));
        gblock.appendChild(ghead);

        const itemsBox = elt('div', 'fin-reorder-items');
        byGroup[g].forEach((b) => {
          const item = elt('div', 'fin-reorder-item');
          item.dataset.category = b.category;
          item.append(mkHandle('fin-reorder-ihandle'),
            elt('span', 'fin-reorder-iname', b.label || b.category));
          itemsBox.appendChild(item);
        });
        gblock.appendChild(itemsBox);
        groupsBox.appendChild(gblock);

        if (window.Sortable) {
          this._sortables.push(new Sortable(itemsBox, {
            handle: '.fin-reorder-ihandle', animation: 150,
            ghostClass: 'drag-ghost', chosenClass: 'drag-chosen',
          }));
        }
      });
      card.appendChild(groupsBox);

      if (window.Sortable) {
        this._sortables.push(new Sortable(groupsBox, {
          handle: '.fin-reorder-ghandle', animation: 150,
          ghostClass: 'drag-ghost', chosenClass: 'drag-chosen',
        }));
      }

      const done = elt('button', 'btn block', 'Concluir');
      done.style.marginTop = '14px';
      done.onclick = () => this._saveOrder(wrap);
      card.appendChild(done);

      wrap.appendChild(card);
    },

    // Coleta a ordem atual do DOM (grupos → itens), preserva a renda na frente,
    // persiste e sai do modo ordenar.
    async _saveOrder(wrap) {
      const expenseOrder = [];
      const groupsBox = wrap.querySelector('.fin-reorder-groups');
      if (groupsBox) {
        groupsBox.querySelectorAll('.fin-reorder-gblock').forEach((gb) => {
          gb.querySelectorAll('.fin-reorder-item').forEach((it) => {
            if (it.dataset.category) expenseOrder.push(it.dataset.category);
          });
        });
      }
      const order = [...this._incomeCatsOrder, ...expenseOrder];
      this._reorderMode = false;
      try {
        await BISA.api('/finance/budget/order', { method: 'PUT', json: { order } });
        BISA.toast('Ordem salva!');
      } catch (e) { BISA.toast(e.message || 'Erro ao salvar ordem'); }
      this._render(true);
    },

    // Controle de pagamento por linha.
    // Pendente: receita = 1 toque registra o planejado (+ ✎ p/ outro valor);
    //   despesa = "Pagar" abre o teclado p/ DEFINIR o valor real (planejado é só
    //   sugestão via chip, pois o gasto varia mês a mês).
    // Já lançado: receita = ✓ + ✎ p/ CORRIGIR o recebido (substitui); despesa =
    //   ✓ + ＋ p/ somar outro gasto na categoria (gastos acumulam vários).
    _renderPayControl(host, b, plan, done, income) {
      host.innerHTML = '';
      if (done > 0) {
        const chk = elt('span', 'fin-bud-check', '✓');
        if (income) {
          const edit = elt('button', 'fin-bud-pay ghost', '✎');
          edit.title = 'Corrigir valor recebido';
          edit.onclick = () => this._openAmountSheet({
            title: b.label || b.category || 'Valor',
            initial: done, plan, allowZero: true,
            confirmLabel: 'Corrigir recebido',
            onConfirm: (amount) => this._setRealized(b, amount),
          });
          host.append(chk, edit);
        } else {
          const more = elt('button', 'fin-bud-pay ghost', '＋');
          more.title = 'Lançar outro valor nesta categoria';
          more.onclick = () => this._openPayForm(host, b, plan, done, income);
          host.append(chk, more);
        }
        return;
      }
      if (income) {
        const pay = elt('button', 'fin-bud-pay', 'Receber');
        pay.title = plan > 0 ? `Receber ${brl(plan)} (planejado)` : 'Registrar recebimento';
        pay.onclick = () => (plan > 0 ? this._postPayment(b, plan, income)
          : this._openPayForm(host, b, plan, done, income));
        const edit = elt('button', 'fin-bud-pay ghost', '✎');
        edit.title = 'Receber outro valor';
        edit.onclick = () => this._openPayForm(host, b, plan, done, income);
        host.append(pay, edit);
      } else {
        const pay = elt('button', 'fin-bud-pay', 'Pagar');
        pay.title = plan > 0 ? `Pagar (planejado ${brl(plan)})` : 'Registrar pagamento';
        pay.onclick = () => this._openPayForm(host, b, plan, done, income);
        host.append(pay);
      }
    },

    // Corrige o realizado de uma RECEITA: apaga os lançamentos manuais dessa
    // categoria no mês exibido e grava um único com o novo valor (0 = só apaga).
    // Receita vem só de lançamentos manuais (incomeByCategory), então substituir
    // é seguro — ao contrário de gastos, que acumulam vários por categoria.
    async _setRealized(b, amount) {
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const matching = manual.filter((t) => t.kind === 'income' && t.category === b.category);
      try {
        for (const t of matching) {
          await BISA.api(`/finance/tx?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
        }
        if (amount > 0) {
          await BISA.api('/finance/tx', {
            method: 'POST',
            json: { kind: 'income', amount, desc: b.label || b.category,
              category: b.category || 'outro', date: todayISO() },
          });
        }
        BISA.toast('Receita atualizada!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao atualizar'); }
    },

    async _postPayment(b, amount, income) {
      if (!(amount > 0)) { BISA.toast('Defina um valor planejado primeiro'); return; }
      try {
        await BISA.api('/finance/tx', {
          method: 'POST',
          json: { kind: income ? 'income' : 'expense', amount,
            desc: b.label || b.category, category: b.category || 'outro', date: todayISO() },
        });
        BISA.toast(income ? 'Recebimento registrado!' : 'Pagamento registrado!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao registrar'); }
    },

    // Lançar um valor (receber/pagar) — campo vazio p/ definir o valor; o chip
    // "Usar planejado" preenche a previsão em 1 toque quando ela bate.
    _openPayForm(host, b, plan, done, income) {
      this._openAmountSheet({
        title: b.label || b.category || 'Valor',
        initial: null,
        plan,
        confirmLabel: income ? 'Salvar receita' : 'Registrar pagamento',
        onConfirm: (amount) => this._postPayment(b, amount, income),
      });
    },

    // Editar o valor planejado da linha.
    _editPlan(planEl, b, plan) {
      this._openAmountSheet({
        title: `Planejado · ${b.label || b.category || ''}`,
        initial: plan > 0 ? plan : null,
        allowZero: true,
        confirmLabel: 'Salvar plano',
        onConfirm: async (amount) => {
          try {
            await BISA.api('/finance/budget', { method: 'PATCH', json: { category: b.category, amount } });
            BISA.toast('Valor planejado atualizado!');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
        },
      });
    },

    // ── Sheet de valor (iPad + Pencil) ───────────────────────────────────
    // Campo grande Scribble-friendly (type=text, teclado nativo suprimido via
    // inputMode='none' p/ não brigar com o teclado abaixo) + teclado numérico
    // grande + chip do planejado. A Pencil (Scribble) e o teclado escrevem no
    // mesmo campo. opts: { title, initial, plan, confirmLabel, allowZero, onConfirm }.
    _openAmountSheet(opts) {
      const { title, initial, plan = 0, confirmLabel = 'Salvar', allowZero = false, onConfirm } = opts;
      this._closeAmountSheet();

      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-amount-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', title || 'Valor'));

      const fieldWrap = elt('div', 'fin-amount-fieldwrap');
      fieldWrap.appendChild(elt('span', 'fin-amount-cur', 'R$'));
      const input = elt('input', 'fin-amount-input');
      input.type = 'text';
      input.inputMode = 'none'; // Scribble (Pencil) e o teclado abaixo escrevem aqui; teclado nativo fica de fora
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `Valor em reais — ${title || ''}`);
      input.value = initial != null && initial > 0 ? initial.toFixed(2).replace('.', ',') : '';
      fieldWrap.appendChild(input);
      modal.appendChild(fieldWrap);

      const preview = elt('div', 'fin-amount-preview');
      modal.appendChild(preview);

      // Aceita vírgula (pt-BR) ou ponto; remove separador de milhar e ruído.
      const parse = (s) => {
        const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };
      const refresh = () => { const n = parse(input.value); preview.textContent = n > 0 ? `= ${brl(n)}` : ''; };
      input.oninput = refresh; // formata só na pré-visualização (não mexe no caret do campo)
      refresh();

      // Teclado numérico grande.
      const pad = elt('div', 'fin-amount-pad');
      const press = (ch) => {
        if (ch === '⌫') input.value = input.value.slice(0, -1);
        else if (ch === ',') { if (!input.value.includes(',')) input.value = (input.value || '0') + ','; }
        else input.value += ch;
        refresh();
        input.focus();
        const len = input.value.length; input.setSelectionRange(len, len);
      };
      ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'].forEach((ch) => {
        const k = elt('button', 'fin-amount-key', ch);
        k.onclick = () => press(ch);
        pad.appendChild(k);
      });
      modal.appendChild(pad);

      // Atalho: usar o valor planejado.
      if (plan > 0) {
        const chip = elt('button', 'fin-amount-chip', `Usar planejado ${brl(plan)}`);
        chip.onclick = () => { input.value = plan.toFixed(2).replace('.', ','); refresh(); input.focus(); };
        modal.appendChild(chip);
      }

      // Ações.
      const actions = elt('div', 'fin-amount-actions');
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar');
      cancel.onclick = () => this._closeAmountSheet();
      const save = elt('button', 'btn', confirmLabel);
      const submit = () => {
        const amount = parse(input.value);
        if (!(allowZero ? amount >= 0 : amount > 0)) { BISA.toast('Informe um valor válido'); return; }
        this._closeAmountSheet();
        onConfirm(amount);
      };
      save.onclick = submit;
      input.onkeydown = (ev) => { if (ev.key === 'Enter') submit(); };
      actions.append(cancel, save);
      modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeAmountSheet(); };
      this._amountKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeAmountSheet(); };
      document.addEventListener('keydown', this._amountKeyHandler);

      document.body.appendChild(overlay);
      this._amountOverlay = overlay;
      input.focus();
      const len = input.value.length; input.setSelectionRange(len, len);
    },

    _closeAmountSheet() {
      if (this._amountKeyHandler) {
        document.removeEventListener('keydown', this._amountKeyHandler);
        this._amountKeyHandler = null;
      }
      if (this._amountOverlay) { this._amountOverlay.remove(); this._amountOverlay = null; }
    },

    // ── Objetivos e plano ────────────────────────────────────────────────
    _fillGoals(wrap, profileResp) {
      wrap.innerHTML = '';
      wrap.appendChild(elt('p', 'section-title', 'Objetivos e plano'));
      const card = elt('div', 'card');

      const profile = profileResp && profileResp.profile;
      const loans = (profileResp && profileResp.loans) || [];

      if (!profile) {
        const hint = elt('div', 'empty');
        hint.innerHTML =
          '<div style="font-size:2rem;margin-bottom:8px">🎯</div>' +
          '<p style="margin:0 0 8px">Ainda sem perfil financeiro configurado.</p>' +
          '<p class="muted" style="margin:0;font-size:.9rem">Peça ao Claude para configurar seus objetivos quando quiser!</p>';
        card.appendChild(hint);
        wrap.appendChild(card);
        return;
      }

      const goals = profile.goals || [];
      goals.forEach((g) => {
        const goalWrap = elt('div');
        goalWrap.style.marginBottom = '14px';
        const nameRow = elt('div', 'row');
        const name = elt('span', null, g.label || g.name || 'Objetivo');
        name.style.fontWeight = '600';
        const spacer = elt('span'); spacer.style.flex = '1';
        const pct = elt('span', 'muted', `${brl(g.current || 0)} de ${brl(g.target || 0)}`);
        pct.style.fontSize = '.85rem';
        nameRow.append(name, spacer, pct);
        const barWrap = elt('div', 'fin-progress-wrap');
        const bar = elt('div', 'fin-progress-bar');
        const ratio = g.target > 0 ? Math.min(1, (g.current || 0) / g.target) : 0;
        bar.style.width = `${(ratio * 100).toFixed(1)}%`;
        barWrap.appendChild(bar);
        goalWrap.append(nameRow, barWrap);
        card.appendChild(goalWrap);
      });

      if (loans.length > 0) {
        if (goals.length > 0) {
          const sep = elt('hr');
          sep.style.cssText = 'border:none;border-top:1px solid var(--line);margin:14px 0';
          card.appendChild(sep);
        }
        const lt = elt('p', 'section-title', 'Financiamentos');
        lt.style.margin = '0 0 10px';
        card.appendChild(lt);

        loans.forEach((l) => {
          const lw = elt('div');
          lw.style.marginBottom = '16px';
          const lname = elt('div', null, l.label || l.system || 'Financiamento');
          lname.style.cssText = 'font-weight:600;margin-bottom:2px';
          const ratio = l.total > 0 ? Math.min(1, l.paid / l.total) : 0;
          const barWrap = elt('div', 'fin-progress-wrap');
          const bar = elt('div', 'fin-progress-bar');
          bar.style.background = 'var(--positive)';
          bar.style.width = `${(ratio * 100).toFixed(1)}%`;
          barWrap.appendChild(bar);
          const info = elt('div', 'fin-loan-row');
          info.append(elt('span', null, `${l.paid} de ${l.total} parcelas pagas`),
            elt('span', null, `Saldo: ${brl(l.balance)}`));
          if (l.next) {
            const nextInfo = elt('div', 'fin-loan-row');
            nextInfo.style.marginTop = '2px';
            const nv = elt('span', null, brl(l.next.value));
            nv.style.fontWeight = '600';
            nextInfo.append(elt('span', null, `Próx. parcela (nº${l.next.n}): ${fmtDate(l.next.dueDate)}`), nv);
            lw.append(lname, barWrap, info, nextInfo);
          } else {
            lw.append(lname, barWrap, info);
          }
          card.appendChild(lw);
        });
      }

      if (goals.length === 0 && loans.length === 0) {
        const hint = elt('p', 'muted', 'Configure seus objetivos com o Claude para ver o progresso aqui.');
        hint.style.margin = '4px 0';
        card.appendChild(hint);
      }
      wrap.appendChild(card);
    },

    // ── Investimentos (só aparece se houver posições) ────────────────────
    _fillInvestments(wrap, positions) {
      if (!positions || positions.length === 0) return;
      wrap.innerHTML = '';
      wrap.appendChild(elt('p', 'section-title', 'Carteira'));
      const card = elt('div', 'card');
      card.style.padding = '8px 16px';

      positions.forEach((pos) => {
        const row = elt('div', 'fin-tx-row');
        const sym = elt('span', null, pos.symbol || '—');
        sym.style.cssText = 'font-weight:700;min-width:60px';
        const qty = elt('span', 'fin-tx-desc muted', `${pos.qty || 0} × ${brl(pos.avgPrice || 0)}`);
        qty.style.fontSize = '.85rem';
        row.append(sym, elt('span', 'fin-tx-cat', pos.assetClass || ''), qty,
          elt('span', 'fin-tx-amt', brl(pos.totalCost || 0)));
        card.appendChild(row);
      });
      wrap.appendChild(card);
    },
  };
})();
