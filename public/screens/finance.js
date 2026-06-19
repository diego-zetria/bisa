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

      /* ── Renda (fontes fixas + extras do mês) ────────────────────────── */
      .fin-inc-row { display:flex; align-items:center; gap:10px; padding:11px 4px;
        border-bottom:1px solid var(--line); min-height:var(--tap); }
      .fin-inc-row:last-of-type { border-bottom:none; }
      .fin-inc-left { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
      .fin-inc-name { font-size:.95rem; }
      .fin-inc-usd { align-self:flex-start; background:none; border:none; padding:0; cursor:pointer;
        font-size:.76rem; color:var(--ink-soft); border-bottom:1px dotted var(--ink-soft); }
      .fin-inc-usd:hover { color:var(--ink); }
      .fin-inc-got { flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
      .fin-inc-topline { display:flex; align-items:center; gap:8px; }
      .fin-inc-rate { font-size:.72rem; color:var(--ink-soft); }
      .fin-inc-amt { font-weight:600; white-space:nowrap; }
      .fin-sal { padding:11px 4px; border-bottom:1px solid var(--line); }
      .fin-sal:last-of-type { border-bottom:none; }
      .fin-sal-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
      .fin-sal-sub { display:flex; align-items:center; gap:10px; margin-top:10px; padding-left:4px;
        border-left:2px solid var(--line); }
      .fin-sal-lbl { flex:1; min-width:0; font-size:.85rem; color:var(--ink-soft); }
      .fin-inc-sub { font-size:.7rem; padding:1px 8px; border-radius:999px; font-weight:700;
        background:rgba(91,138,114,.18); color:var(--positive); }   /* badge "recebido" */
      .fin-inc-extrahead { font-size:.74rem; text-transform:uppercase; letter-spacing:.06em;
        color:var(--ink-soft); font-weight:600; margin:16px 2px 2px; }
      .fin-inc-add { width:100%; margin-top:14px; border:1px dashed var(--primary);
        background:var(--accent-soft); color:var(--primary); border-radius:var(--radius-sm);
        min-height:var(--tap); font-weight:600; font-size:.92rem; cursor:pointer; }
      .fin-inc-add:active { background:var(--line); }

      /* ── Envelopes (AUVP: % da renda do mês) ─────────────────────────── */
      .fin-env-meta { display:flex; justify-content:space-between; align-items:baseline;
        margin-bottom:14px; font-size:.9rem; color:var(--ink-soft); }
      .fin-env-meta strong { color:var(--ink); }
      .fin-env-total { font-weight:700; }
      .fin-env-total.off { color:var(--warn); }
      .fin-env-row { padding:11px 2px; border-bottom:1px solid var(--line); }
      .fin-env-row:last-child { border-bottom:none; }
      .fin-env-top { display:flex; align-items:center; gap:9px; font-size:.95rem; cursor:pointer; }
      .fin-env-dot { width:11px; height:11px; border-radius:50%; flex:0 0 auto; }
      .fin-env-name { flex:1; min-width:0; color:var(--positive); }
      .fin-env-caret { color:var(--ink-soft); font-size:.75rem; }
      .fin-env-pct { font-weight:700; color:var(--ink-soft); min-width:42px; text-align:right; }
      .fin-env-bar { position:relative; height:28px; background:var(--surface-2);
        border-radius:8px; overflow:hidden; margin-top:8px; }
      .fin-env-fill { position:absolute; left:0; top:0; bottom:0; border-radius:8px; transition:width .35s; }
      .fin-env-nums { position:absolute; inset:0; display:flex; align-items:center; justify-content:flex-end;
        gap:5px; padding:0 11px; font-size:.84rem; white-space:nowrap; pointer-events:none; }
      .fin-env-over { color:var(--negative); font-weight:700; font-size:.72rem; }
      .fin-env-slider { width:100%; margin-top:10px; height:30px; accent-color:var(--primary); cursor:pointer; }
      .fin-env-fit { margin-top:6px; border:1px dashed var(--primary); background:var(--accent-soft);
        color:var(--primary); border-radius:var(--radius-sm); min-height:34px; font-size:.82rem;
        font-weight:600; cursor:pointer; padding:0 12px; }
      .fin-env-fit:active { background:var(--line); }
      .fin-env-sublist { margin:8px 0 2px 20px; padding:4px 0 0; border-top:1px dashed var(--line); }
      .fin-env-addrow { display:flex; }
      .fin-env-add { margin-top:8px; border:1px dashed var(--line); background:none; color:var(--ink-soft);
        border-radius:var(--radius-sm); min-height:38px; font-size:.85rem; cursor:pointer; padding:0 14px; }
      .fin-env-add:active { background:var(--surface-2); }

      /* ── Contas com vencimento ───────────────────────────────────────── */
      .fin-bill-row { display:flex; align-items:center; gap:9px; padding:10px 2px;
        border-bottom:1px solid var(--line); min-height:var(--tap); }
      .fin-bill-row:last-of-type { border-bottom:none; }
      .fin-bill-main { flex:1; min-width:0; display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
      .fin-bill-label { min-width:0; font-size:.93rem; }
      .fin-bill-amt { font-weight:600; white-space:nowrap; font-size:.9rem; }
      .fin-bill-act { flex:0 0 auto; display:flex; align-items:center; }
      .fin-bills-foot { display:flex; justify-content:space-between; align-items:baseline;
        margin-top:12px; padding-top:10px; border-top:2px solid var(--line); font-weight:600; font-size:.92rem; }

      /* ── Gerenciar custos (CRUD dos itens, por categoria AUVP) ───────── */
      .fin-manage-topbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:4px 2px 16px; }
      .fin-manage-h { font-size:1.15rem; font-weight:700; margin:0; }
      .fin-tagrow { display:flex; align-items:center; gap:10px; padding:9px 2px; border-bottom:1px solid var(--line); }
      .fin-tagrow-name { flex:1; min-width:0; font-size:.92rem; }
      .fin-tagrow-scope { font-size:.72rem; color:var(--ink-soft); background:var(--surface-2); padding:2px 9px; border-radius:999px; white-space:nowrap; }
      .fin-tagdiv { height:1px; background:var(--line); margin:14px 0; }
      .fin-item-hint { font-size:.8rem; color:var(--ink-soft); }
      .fin-manage-card { margin-bottom:16px; }
      .fin-manage-head { display:flex; align-items:center; gap:9px; }
      .fin-manage-title { flex:1; font-weight:700; font-size:1rem; }
      .fin-manage-pct { font-weight:700; color:var(--ink-soft); }
      .fin-manage-desc { color:var(--ink-soft); font-size:.82rem; line-height:1.45; margin:7px 0 6px; }
      .fin-manage-row { display:flex; align-items:center; gap:10px; padding:11px 2px;
        border-top:1px solid var(--line); cursor:pointer; min-height:var(--tap); }
      .fin-manage-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
      .fin-manage-iname { font-size:.95rem; }
      .fin-manage-imeta { font-size:.76rem; color:var(--ink-soft); }
      .fin-manage-tags { display:flex; flex-wrap:wrap; gap:5px; margin-top:2px; }
      .fin-tag { font-size:.68rem; padding:1px 8px; border-radius:999px; background:var(--surface-2); color:var(--ink-soft); }
      .fin-manage-val { font-weight:600; white-space:nowrap; font-size:.9rem; }
      .fin-manage-empty { color:var(--ink-soft); font-size:.84rem; padding:8px 2px; border-top:1px solid var(--line); }

      /* Editor de item (modal) */
      .fin-item-modal { background:var(--surface); border-radius:var(--radius); box-shadow:var(--shadow);
        width:100%; max-width:430px; max-height:88vh; overflow-y:auto; padding:22px; }
      .fin-item-field { margin-bottom:15px; }
      .fin-item-flabel { font-size:.78rem; font-weight:600; color:var(--ink-soft); margin-bottom:7px; display:block; }
      .fin-item-inp { width:100%; border:2px solid var(--line); background:var(--surface-2);
        border-radius:var(--radius-sm); padding:11px 14px; font-size:1rem; color:var(--ink); outline:none; }
      .fin-item-inp:focus { border-color:var(--primary); }
      .fin-item-actions { display:flex; gap:10px; align-items:center; margin-top:4px; }
      .fin-item-del { margin-right:auto; background:none; border:none; color:var(--negative);
        font-weight:600; cursor:pointer; min-height:var(--tap); padding:0 6px; font-size:.9rem; }
      .fin-item-del.confirm { font-weight:700; }

      /* ── Categorias ──────────────────────────────────────────────────── */
      .fin-cat-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; margin:12px 0; }
      .fin-cat-name { flex:1; font-size:.9rem; text-transform:capitalize; }
      .fin-cat-bar-wrap { order:2; flex-basis:100%; background:var(--surface-2); border-radius:999px; height:8px; overflow:hidden; }
      .fin-cat-bar { height:100%; border-radius:999px; background:var(--negative); transition:width .4s; }
      .fin-cat-amt { order:1; min-width:84px; text-align:right; font-size:.85rem; color:var(--ink-soft); }

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
      .fin-obj { margin-bottom:14px; padding:8px 4px; border-radius:var(--radius-sm); cursor:pointer; }
      .fin-obj:active { background:var(--surface-2); }
      .fin-obj-meta { font-size:.74rem; color:var(--ink-soft); margin-top:3px; display:flex; align-items:center; gap:4px; }
      .fin-obj-tag { font-size:.68rem; padding:1px 8px; border-radius:999px; background:var(--surface-2); font-weight:600; }
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
      .fin-amount-desc { width:100%; border:2px solid var(--line); background:var(--surface-2);
        border-radius:var(--radius-sm); padding:10px 14px; font-size:1rem; color:var(--ink);
        outline:none; margin-bottom:10px; }
      .fin-amount-desc:focus { border-color:var(--primary); }
      .fin-amount-descchips { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:12px; }
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

  // Número pt-BR sem símbolo (0–2 casas) — usado p/ valores em US$.
  const fmtNum = (v) =>
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(v) || 0);

  // Cotação R$/US$ (2 casas): 7980/1500 → "R$ 5,32".
  const fmtRate = (v) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;

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

  // Aciona um botão no pointerdown (com preventDefault) p/ funcionar mesmo com o
  // teclado nativo aberto no iPad — onclick falharia (o 1º toque só fecha o
  // teclado e o layout desloca). Mantém o foco do input (preventDefault). Usar
  // nos botões de ação dos editores que têm campos de texto/número nativos.
  const onTap = (btn, fn) => {
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      // Se fn() remover o overlay, o `click` que vem depois cairia no elemento
      // que estava embaixo (ex.: a linha do objetivo → reabriria o editor).
      // Engole o próximo click (fase de captura) p/ evitar esse "click-through".
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 700);
      fn(ev);
    });
    btn.style.touchAction = 'manipulation';
  };

  // Envelopes AUVP — categorias, rótulos, cores e o que cada uma engloba.
  const BUCKETS = [
    { id: 'custo-fixo', label: 'Custos fixos', color: '#5b8fd6',
      desc: 'O que você não consegue cortar do dia para a noite: aluguel/financiamento, condomínio, contas de casa (luz, água, internet), escola, plano de saúde, parcela do carro e o mercado básico.' },
    { id: 'conforto', label: 'Conforto', color: '#5bbd8a',
      desc: 'O que melhora seu conforto mas dá para rebaixar: carro acima da necessidade, diarista, transporte por app, assinaturas extras, móveis e eletro não essenciais.' },
    { id: 'liberdade', label: 'Liberdade financeira', color: '#8a7fe0',
      desc: 'O que você guarda pensando no seu eu do futuro: aportes mensais em investimentos, reserva de emergência e previdência.' },
    { id: 'metas', label: 'Metas', color: '#e0c45b',
      desc: 'Provisão para objetivos planejados: viagens, troca de carro, presentes de fim de ano. Separe todo mês (ex.: no Tesouro Selic) para realizar sem dívida.' },
    { id: 'prazeres', label: 'Prazeres', color: '#d67fb8',
      desc: 'O que você faz só pelo prazer: bar, cerveja, cinema, churrasco, hobbies e restaurantes/delivery por lazer. Não deveria passar de ~10%.' },
    { id: 'conhecimento', label: 'Conhecimento', color: '#d6915b',
      desc: 'Cursos e formações que aumentam sua capacidade de ganhar mais: cursos técnicos, certificações, mentorias e livros profissionais.' },
  ];
  const DEFAULT_ALLOCATION = { 'custo-fixo': 30, conforto: 15, liberdade: 25, metas: 15, prazeres: 10, conhecimento: 5 };
  const bucketLabel = (id) => (BUCKETS.find((b) => b.id === id) || {}).label || id;

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
    _allocEdit: false, // editor de % das metas (envelopes) aberto?
    _expandedBuckets: new Set(), // envelopes com os lançamentos abertos
    _billSort: 'unpaid', // ordenação do quadro de contas: unpaid|due|amount|bucket
    _manageMode: false, // tela "Gerenciar custos" aberta?

    mount(el) {
      this._el = el;
      this._month = thisMonth();
      this._render();
    },

    unmount() {
      this._closeAmountSheet();
      this._closeSortMenu();
      this._closeItemEditor();
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

      // Modo "Gerenciar custos" — board próprio, fora da grade do mês.
      if (this._manageMode) {
        const back = elt('button', 'fin-back-btn');
        back.innerHTML = '← Controle do mês';
        back.onclick = () => { this._manageMode = false; this._render(); };
        el.appendChild(back);
        const topbar = elt('div', 'fin-manage-topbar');
        topbar.appendChild(elt('h2', 'fin-manage-h', 'Gerenciar custos'));
        const tagBtn = elt('button', 'fin-addbtn', '🏷 Tags');
        tagBtn.onclick = () => this._openTagManager();
        topbar.appendChild(tagBtn);
        el.appendChild(topbar);
        const board = elt('div');
        el.appendChild(board);
        BISA.api('/finance/profile').then((profileResp) => {
          this._fillManage(board, profileResp);
          if (preserveScroll && scroller) scroller.scrollTop = savedTop;
        }).catch(() => {});
        return;
      }

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

      // Coluna esquerda: saldo, renda, contas com vencimento, carteira.
      const heroWrap = elt('div');
      const incomeWrap = elt('div');
      const billsWrap = elt('div');
      const investCard = elt('div'); // escondido até haver posições
      colMain.append(heroWrap, incomeWrap, billsWrap, investCard);

      // Coluna direita: controle do mês, lançamentos, objetivos.
      const budgetWrap = elt('div');
      const txWrap = elt('div');
      const goalWrap = elt('div');
      colSide.append(budgetWrap, txWrap, goalWrap);

      // Carrega summary + profile em paralelo.
      const month = this._month;
      Promise.all([
        BISA.api(`/finance/summary?month=${month}`).catch(() => null),
        BISA.api('/finance/profile').catch(() => null),
      ]).then(([summary, profileResp]) => {
        this._summary = summary; // usado por _setRealized p/ achar os lançamentos a substituir
        this._objectives = (profileResp && profileResp.profile && profileResp.profile.objectives) || [];
        this._fillHero(heroWrap, summary);
        this._fillBills(billsWrap, profileResp, summary);
        this._fillIncome(incomeWrap, profileResp, summary);
        this._fillEnvelope(budgetWrap, profileResp, summary);
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
      const { income = 0, expense = 0 } = cash;
      // Foco no "valor para viver no mês": Receitas e Gastos NÃO contam a liberdade.
      // A liberdade (renda retida em dólar + aportes no bucket) fica só como número
      // informativo, fora do saldo e do gráfico.
      const manual = (cash.manual) || [];
      const r2 = (n) => Math.round(n * 100) / 100;
      const libAporte = r2(manual
        .filter((t) => t.kind === 'expense' && t.bucket === 'liberdade')
        .reduce((s, t) => s + t.amount, 0));
      const libIncome = r2(manual
        .filter((t) => t.kind === 'income' && t.category && t.category.endsWith('-lib'))
        .reduce((s, t) => s + t.amount, 0));
      const receitas = r2(income - libIncome);
      const gastos = r2(expense - libAporte);
      const saldo = r2(receitas - gastos); // o que sobra para viver

      const hero = elt('div', 'fin-hero');
      hero.appendChild(elt('div', 'fin-hero-label', `Saldo de ${monthLabel(this._month).split(' de ')[0]}`));

      const bal = elt('div', 'fin-hero-balance ' + (saldo >= 0 ? 'positive' : 'negative'), brl(saldo));
      hero.appendChild(bal);

      // Barra: das receitas (para viver), quanto foi gasto (vermelho) e quanto
      // sobrou (verde). Liberdade não entra.
      const base = receitas > 0 ? receitas : gastos || 1;
      const pct = (v) => `${Math.max(0, Math.min(100, (v / base) * 100))}%`;
      const seg = elt('div', 'fin-hero-seg');
      const segOut = elt('div', 'seg-out'); segOut.style.width = pct(gastos);
      const segIn = elt('div', 'seg-in'); segIn.style.width = pct(Math.max(0, saldo));
      seg.append(segOut, segIn);
      hero.appendChild(seg);

      const subs = elt('div', 'fin-hero-subs');
      const mkSub = (dotCls, label, value, dotColor) => {
        const sub = elt('div', 'fin-hero-sub');
        const k = elt('span', 'k');
        const dot = elt('span', 'dot ' + (dotCls || ''));
        if (dotColor) dot.style.background = dotColor;
        k.append(dot, document.createTextNode(label));
        sub.append(k, elt('span', 'v', value));
        return sub;
      };
      subs.append(mkSub('in', 'Receitas', brl(receitas)), mkSub('out', 'Gastos', brl(gastos)));
      if (libAporte > 0) subs.append(mkSub('', 'Liberdade', brl(libAporte), BUCKETS[2].color));
      hero.appendChild(subs);
      wrap.appendChild(hero);

      if (income + expense === 0) {
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
          json: {
            kind: tx.kind, amount, desc: tx.desc, category: tx.category, date: tx.date,
            ...(tx.bucket ? { bucket: tx.bucket } : {}),
          },
        });
        BISA.toast('Lançamento atualizado!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao atualizar'); }
    },

    // ── Renda (seção própria, colapsável) ────────────────────────────────
    // Quadro para registrar o que ENTROU no mês — sem previsão (a renda varia).
    // Fontes fixas (linhas kind:'income' do orçamento) aparecem todo mês para
    // tocar e lançar o valor recebido; extras (bônus, freela, venda...) são
    // lançamentos avulsos de receita, fáceis de adicionar.
    _fillIncome(wrap, profileResp, summary) {
      wrap.innerHTML = '';
      const profile = profileResp && profileResp.profile;
      if (!profile) return;

      const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      this._stdRate = fx; // cotação padrão atual, p/ o editor de salário
      const fixed = (profile.budget || []).filter((b) => b.kind === 'income');
      const fixedCats = new Set(fixed.map((b) => b.category));
      // categorias internas do salário (renda de liberdade) — não são "extras"
      const salaryLibCats = new Set(fixed.filter((b) => b.salaryUSD).map((b) => `${b.category}-lib`));
      const doneMap = (summary && summary.cash && summary.cash.incomeByCategory) || {};
      const manual = (summary && summary.cash && summary.cash.manual) || [];
      const extras = manual
        .filter((t) => t.kind === 'income' && !fixedCats.has(t.category) && !salaryLibCats.has(t.category))
        .sort((a, c) => (a.date < c.date ? 1 : -1));
      const receivedTotal = (summary && summary.cash && summary.cash.income) || 0;
      const collapsed = this._incomeCollapsed;

      // Cabeçalho clicável: alterna recolhido/expandido. Só o total recebido —
      // sem "/ planejado", já que não há previsão de renda.
      const head = elt('div', 'fin-collapse-head');
      head.append(
        elt('span', 'fin-collapse-caret', collapsed ? '▸' : '▾'),
        elt('span', 'fin-collapse-title', 'Renda'),
      );
      const tot = elt('span', 'fin-collapse-vals');
      tot.innerHTML = `<strong class="fin-value-pos">${brl(receivedTotal)}</strong> <span class="muted">recebido</span>`;
      head.appendChild(tot);
      head.onclick = () => { this._incomeCollapsed = !this._incomeCollapsed; this._render(true); };
      wrap.appendChild(head);
      if (collapsed) return;

      const card = elt('div', 'card');
      fixed.forEach((b) => {
        if (b.salaryUSD) this._incomeSalaryRow(card, b, fx, summary);
        else this._incomeFixedRow(card, b, Number(doneMap[b.category] || 0), this._planBRL(b, fx));
      });

      if (extras.length) {
        card.appendChild(elt('div', 'fin-inc-extrahead', 'Extras do mês'));
        extras.forEach((tx) => this._incomeExtraRow(card, tx));
      }

      const add = elt('button', 'fin-inc-add', '＋ Adicionar receita');
      add.onclick = () => this._openExtraIncome();
      card.appendChild(add);
      wrap.appendChild(card);
    },

    // Fonte fixa de renda (todo mês): tocar registra/corrige o valor recebido.
    // `plan` (o valor típico do orçamento) só alimenta o atalho "Usar" no teclado;
    // não é mostrado como previsão. Fontes em dólar (b.amountUSD) mostram o valor
    // em US$ (editável) e, ao registrar o R$ recebido, a cotação implícita.
    _incomeFixedRow(parent, b, done, plan) {
      const usd = (b.amountUSD != null && Number(b.amountUSD) > 0) ? Number(b.amountUSD) : null;
      const name = b.label || b.category || '—';
      const row = elt('div', 'fin-inc-row');

      const left = elt('span', 'fin-inc-left');
      left.appendChild(elt('span', 'fin-inc-name', name));
      if (usd != null) {
        const usdBtn = elt('button', 'fin-inc-usd', `US$ ${fmtNum(usd)}`);
        usdBtn.title = 'Editar o valor em dólar';
        usdBtn.onclick = () => this._editUSD(b, usd);
        left.appendChild(usdBtn);
      }
      row.appendChild(left);

      const right = elt('span', 'fin-inc-got');
      if (done > 0) {
        const top = elt('span', 'fin-inc-topline');
        top.append(
          elt('span', 'fin-inc-sub', 'recebido'),
          elt('strong', 'fin-inc-amt fin-value-pos', brl(done)),
        );
        const edit = elt('button', 'fin-bud-pay ghost', '✎');
        edit.title = 'Corrigir valor recebido';
        edit.onclick = () => this._openReceive(b, done, plan, usd);
        top.appendChild(edit);
        right.appendChild(top);
        if (usd != null) right.appendChild(elt('span', 'fin-inc-rate', `cotação ${fmtRate(done / usd)} / US$`));
      } else {
        const reg = elt('button', 'fin-bud-pay', 'Registrar');
        reg.title = 'Registrar o valor que entrou';
        reg.onclick = () => this._openReceive(b, null, plan, usd);
        right.appendChild(reg);
      }
      row.appendChild(right);
      parent.appendChild(row);
    },

    // Sheet para registrar/corrigir o R$ recebido de uma fonte fixa. Quando a
    // fonte é em dólar (usd), o sheet mostra a cotação implícita ao vivo.
    _openReceive(b, initial, plan, usd) {
      this._openAmountSheet({
        title: b.label || b.category || 'Valor',
        initial, plan, rateBase: usd || 0,
        allowZero: initial != null,
        confirmLabel: initial != null ? 'Corrigir recebido' : 'Salvar receita',
        onConfirm: (amount) => this._setRealized(b, amount, usd),
      });
    },

    // Editar o valor em dólar de uma fonte (persiste amountUSD no perfil).
    _editUSD(b, usd) {
      this._openAmountSheet({
        title: `Valor em dólar · ${b.label || b.category || ''}`,
        initial: usd, curLabel: 'US$', confirmLabel: 'Salvar US$',
        onConfirm: async (amount) => {
          try {
            await BISA.api('/finance/budget', { method: 'PATCH', json: { category: b.category, amountUSD: amount } });
            BISA.toast('Valor em dólar atualizado!');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
        },
      });
    },

    // Fonte de renda em salário-dólar (Diego): salário completo em US$, do qual
    // uma parte é transferida para reais (cotação real) e o resto fica em dólar,
    // destinado à liberdade financeira pela cotação padrão. `fx` = cotação padrão.
    _incomeSalaryRow(parent, b, fx, summary) {
      const doneMap = (summary && summary.cash && summary.cash.incomeByCategory) || {};
      const salaryUSD = Number(b.salaryUSD) || 0;
      const transferUSD = Number(b.amountUSD) || 0;
      const std = fx || 0;
      const libUSD = Math.max(0, salaryUSD - transferUSD);
      const libBRL = Math.round(libUSD * std * 100) / 100;
      const libCat = `${b.category}-lib`;
      const doneTransfer = Number(doneMap[b.category] || 0);
      const doneLib = Number(doneMap[libCat] || 0);

      const wrap = elt('div', 'fin-sal');
      const hd = elt('div', 'fin-sal-head');
      hd.appendChild(elt('span', 'fin-inc-name', b.label || 'Salário'));
      const cfg = elt('button', 'fin-inc-usd', `US$ ${fmtNum(salaryUSD)} · padrão ${fmtRate(std)}`);
      cfg.title = 'Editar salário, transferência e cotação padrão';
      cfg.onclick = () => this._openSalaryConfig(b);
      hd.appendChild(cfg);
      wrap.appendChild(hd);

      // Transferência (cotação real)
      const t = elt('div', 'fin-sal-sub');
      t.appendChild(elt('span', 'fin-sal-lbl', `Transferido US$ ${fmtNum(transferUSD)}`));
      const tr = elt('span', 'fin-inc-got');
      if (doneTransfer > 0) {
        const top = elt('span', 'fin-inc-topline');
        top.append(elt('span', 'fin-inc-sub', 'recebido'), elt('strong', 'fin-inc-amt fin-value-pos', brl(doneTransfer)));
        const e = elt('button', 'fin-bud-pay ghost', '✎');
        e.title = 'Corrigir recebido'; e.onclick = () => this._openReceive(b, doneTransfer, transferUSD * std, transferUSD);
        top.appendChild(e);
        tr.appendChild(top);
        tr.appendChild(elt('span', 'fin-inc-rate', `cotação real ${fmtRate(doneTransfer / transferUSD)} / US$`));
      } else {
        const reg = elt('button', 'fin-bud-pay', 'Registrar');
        reg.title = 'Registrar o R$ que caiu na conta'; reg.onclick = () => this._openReceive(b, null, transferUSD * std, transferUSD);
        tr.appendChild(reg);
      }
      t.appendChild(tr); wrap.appendChild(t);

      // Liberdade (cotação padrão) — atalho que lança renda + aporte no envelope
      const l = elt('div', 'fin-sal-sub');
      l.appendChild(elt('span', 'fin-sal-lbl', `Liberdade US$ ${fmtNum(libUSD)} → ${brl(libBRL)}`));
      const lr = elt('span', 'fin-inc-got');
      if (doneLib > 0) {
        const top = elt('span', 'fin-inc-topline');
        top.append(elt('span', 'fin-inc-sub', 'destinado'), elt('strong', 'fin-inc-amt fin-value-pos', brl(doneLib)));
        const un = elt('button', 'fin-bud-pay ghost', '✕');
        un.title = 'Desfazer destinação'; un.onclick = () => this._undoLiberdade(b);
        top.appendChild(un);
        lr.appendChild(top);
      } else {
        const dest = elt('button', 'fin-bud-pay', 'Destinar à liberdade');
        dest.onclick = () => this._destinarLiberdade(b, libBRL);
        lr.appendChild(dest);
      }
      l.appendChild(lr); wrap.appendChild(l);

      parent.appendChild(wrap);
    },

    // Atalho: lança o valor retido em dólar como RENDA (renda do mês completa) e
    // como APORTE no envelope Liberdade financeira (aparece no controle do mês).
    _destinarLiberdade(b, defaultBRL) {
      const libCat = `${b.category}-lib`;
      const objs = (this._objectives || []).filter((o) => o.bucket === 'liberdade');
      this._openAmountSheet({
        title: `Liberdade · ${b.label || ''}`,
        initial: defaultBRL > 0 ? defaultBRL : null, plan: defaultBRL,
        goalChips: objs.map((o) => ({ id: o.id, label: o.label })),
        confirmLabel: 'Destinar à liberdade',
        onConfirm: async (amount, _desc, goalId) => {
          try {
            await BISA.api('/finance/tx', { method: 'POST', json: { kind: 'income', amount, desc: `${b.label} — liberdade (US$ retido)`, category: libCat, date: todayISO() } });
            await BISA.api('/finance/tx', { method: 'POST', json: { kind: 'expense', amount, desc: `Aporte liberdade — ${b.label}`, category: libCat, bucket: 'liberdade', goalId: goalId || undefined, date: todayISO() } });
            await this._addToObjective(goalId, amount);
            BISA.toast('Destinado à liberdade!'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao destinar'); }
        },
      });
    },

    // Soma um aporte (em R$) ao saldo do objetivo, convertendo p/ a moeda dele
    // pela cotação padrão. delta negativo desconta (usado no desfazer).
    async _addToObjective(goalId, amountBRL) {
      if (!goalId) return;
      const obj = (this._objectives || []).find((o) => o.id === goalId);
      if (!obj) return;
      const std = this._stdRate || 0;
      const delta = obj.currency === 'USD' ? (std > 0 ? amountBRL / std : 0) : amountBRL;
      const next = Math.round((Number(obj.current || 0) + delta) * 100) / 100;
      await BISA.api('/finance/objectives', { method: 'PATCH', json: { id: goalId, current: Math.max(0, next) } });
    },

    // Desfaz a destinação: remove renda + aporte do mês e desconta o objetivo vinculado.
    async _undoLiberdade(b) {
      const libCat = `${b.category}-lib`;
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const matches = manual.filter((t) => t.category === libCat);
      try {
        for (const t of matches) {
          if (t.kind === 'expense' && t.goalId) await this._addToObjective(t.goalId, -t.amount);
          await BISA.api(`/finance/tx?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
        }
        BISA.toast('Destinação desfeita'); this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao desfazer'); }
    },

    // Editor do salário-dólar: salário completo (US$), quanto transfere (US$) e a
    // cotação padrão (R$/US$). Salva via PATCH budget (salaryUSD/amountUSD) + PATCH fx.
    _openSalaryConfig(b) {
      this._closeItemEditor();
      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-item-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', `Salário · ${b.label || ''}`));

      const numField = (labelText, val, ph) => {
        const f = elt('div', 'fin-item-field');
        f.appendChild(elt('label', 'fin-item-flabel', labelText));
        const inp = elt('input', 'fin-item-inp');
        inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = ph || '';
        if (val != null) inp.value = String(val).replace('.', ',');
        inp.oninput = () => {
          let v = inp.value.replace(/[^0-9,]/g, '');
          const i = v.indexOf(','); if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '');
          inp.value = v;
        };
        f.appendChild(inp); modal.appendChild(f);
        return inp;
      };
      const parseNum = (s) => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };

      const salInp = numField('Salário completo (US$)', b.salaryUSD, 'Ex: 5000');
      const transfInp = numField('Transfere para reais (US$)', b.amountUSD, 'Ex: 1500');
      const rateInp = numField('Cotação padrão (R$/US$)', (this._stdRate || ''), 'Ex: 5,00');

      const actions = elt('div', 'fin-item-actions');
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar'); onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', 'Salvar');
      onTap(save, async () => {
        const salaryUSD = parseNum(salInp.value);
        const amountUSD = parseNum(transfInp.value);
        const rate = parseNum(rateInp.value);
        try {
          await BISA.api('/finance/budget', { method: 'PATCH', json: { category: b.category, salaryUSD, amountUSD } });
          if (rate > 0) await BISA.api('/finance/fx', { method: 'PATCH', json: { rate } });
          BISA.toast('Salário atualizado!'); this._closeItemEditor(); this._render(true);
        } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
      });
      actions.append(cancel, save); modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeItemEditor(); };
      this._itemKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeItemEditor(); };
      document.addEventListener('keydown', this._itemKeyHandler);
      document.body.appendChild(overlay); this._itemOverlay = overlay; salInp.focus();
    },

    // Linha de uma receita extra (lançamento avulso): editar valor/descrição e
    // excluir (2 toques). Reaproveita o estilo dos lançamentos por categoria.
    _incomeExtraRow(parent, tx) {
      const srow = elt('div', 'fin-bud-subrow');
      const act = elt('span', 'fin-bud-subact');

      const edit = elt('button', 'fin-bud-subbtn', '✎');
      edit.title = 'Editar';
      edit.onclick = () => this._openAmountSheet({
        title: tx.desc || 'Receita extra', initial: tx.amount,
        withDesc: true, descInitial: tx.desc,
        confirmLabel: 'Salvar',
        onConfirm: (amount, desc) => this._editTx({ ...tx, desc: desc || tx.desc }, amount),
      });

      const del = elt('button', 'fin-bud-subbtn del', '✕');
      del.title = 'Excluir';
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
          BISA.toast('Receita excluída');
          this._render(true);
        } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
      };

      act.append(edit, del);
      srow.append(
        elt('span', 'fin-bud-subdate', fmtDate(tx.date)),
        elt('span', 'fin-bud-subdesc', tx.desc || '—'),
        elt('strong', 'fin-bud-subamt fin-value-pos', brl(tx.amount)),
        act,
      );
      parent.appendChild(srow);
    },

    // Adicionar uma receita extra (bônus, freela, venda...): descrição + valor.
    _openExtraIncome() {
      this._openAmountSheet({
        title: 'Nova receita', initial: null, withDesc: true,
        descPlaceholder: 'Descrição (ex: Bônus, Freela)',
        descChips: ['Bônus', 'Freela', 'Venda', '13º', 'Reembolso'],
        confirmLabel: 'Salvar receita',
        onConfirm: async (amount, desc) => {
          try {
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: { kind: 'income', amount, desc: desc || 'Receita extra', category: 'extra', date: todayISO() },
            });
            BISA.toast('Receita adicionada!');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
        },
      });
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

    // ── Contas com vencimento ────────────────────────────────────────────
    // Quadro das contas com data definida (linhas do orçamento com dueDay):
    // mostra status (pago/pendente/vencido/a vencer), o dia do vencimento e o
    // valor, ordenado por pendentes-primeiro. Pagar registra no envelope (bucket)
    // da conta. Independente da divisão por % — é a visão de "o que vence quando".
    _fillBills(wrap, profileResp, summary) {
      wrap.innerHTML = '';
      const profile = profileResp && profileResp.profile;
      if (!profile) return;
      const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const lines = (profile.budget || []).filter((b) => b.kind !== 'income' && b.dueDay);
      if (!lines.length) return;
      const doneMap = (summary && summary.cash && summary.cash.byCategory) || {};
      const isThisMonth = this._month === thisMonth();
      const today = new Date().getDate();

      const rows = this._sortBills(lines.map((b) => {
        const plan = this._planBRL(b, fx);
        const done = Number(doneMap[b.category] || 0);
        const paid = done > 0;
        const overdue = isThisMonth && !paid && today > b.dueDay;
        const soon = isThisMonth && !paid && !overdue && (b.dueDay - today <= 5);
        return { b, plan, done, paid, overdue, soon };
      }));

      const overdueN = rows.filter((e) => e.overdue).length;
      const soonN = rows.filter((e) => e.soon).length;
      const pendingTotal = rows.filter((e) => !e.paid).reduce((s, e) => s + e.plan, 0);

      const head = elt('div', 'fin-sec-head');
      head.appendChild(elt('span', 'fin-sec-title', 'Contas com vencimento'));
      const sortBtn = elt('button', 'fin-addbtn', '↕ Ordenar');
      sortBtn.onclick = () => this._openBillSort(sortBtn);
      head.appendChild(sortBtn);
      wrap.appendChild(head);

      const card = elt('div', 'card');
      if (overdueN) card.appendChild(elt('div', 'fin-bud-alert', `⚠ ${overdueN} ${overdueN > 1 ? 'contas vencidas' : 'conta vencida'}`));
      if (soonN) card.appendChild(elt('div', 'fin-bud-alert soft', `🗓 ${soonN} ${soonN > 1 ? 'vencem' : 'vence'} em breve`));
      rows.forEach((e) => this._billRow(card, e, isThisMonth));
      if (isThisMonth && pendingTotal > 0) {
        const foot = elt('div', 'fin-bills-foot');
        foot.append(elt('span', null, 'Falta pagar'), elt('strong', null, brl(pendingTotal)));
        card.appendChild(foot);
      }
      wrap.appendChild(card);
    },

    _billRow(parent, e, isThisMonth) {
      const { b, plan, done, paid, overdue, soon } = e;
      const row = elt('div', 'fin-bill-row');
      row.appendChild(elt('span', `fin-bud-status st-${overdue ? 'over' : paid ? 'ok' : 'pending'}`));
      const main = elt('span', 'fin-bill-main');
      main.appendChild(elt('span', 'fin-bill-label', b.label || b.category));
      const due = elt('span', 'fin-bud-due' + (paid ? ' paid' : overdue ? ' overdue' : soon ? ' soon' : ''));
      due.textContent = overdue ? `venceu dia ${b.dueDay}` : `dia ${b.dueDay}`;
      main.appendChild(due);
      if (paid) main.appendChild(elt('span', 'fin-bud-paid', 'pago'));
      row.appendChild(main);
      row.appendChild(elt('span', 'fin-bill-amt', brl(paid ? done : plan)));
      const act = elt('span', 'fin-bill-act');
      if (isThisMonth) {
        if (paid) act.appendChild(elt('span', 'fin-bud-check', '✓'));
        else { const pay = elt('button', 'fin-bud-pay', 'Pagar'); pay.onclick = () => this._payBill(b, plan); act.appendChild(pay); }
      }
      row.appendChild(act);
      parent.appendChild(row);
    },

    // Registrar pagamento de uma conta: teclado com o valor recorrente pré-pronto;
    // lança como gasto no envelope (bucket) e na categoria da conta.
    _payBill(b, plan) {
      this._openAmountSheet({
        title: b.label || b.category || 'Pagar', initial: null, plan,
        confirmLabel: 'Registrar pagamento',
        onConfirm: async (amount) => {
          try {
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: {
                kind: 'expense', amount, desc: b.label || b.category,
                category: b.category || 'outro', date: todayISO(),
                ...(b.bucket ? { bucket: b.bucket } : {}),
              },
            });
            BISA.toast('Pagamento registrado!'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao registrar'); }
        },
      });
    },

    // Ordena as contas conforme this._billSort. Empates caem para a ordem
    // original (sort estável via índice).
    _sortBills(rows) {
      const amt = (e) => (e.paid ? e.done : e.plan);
      const bidx = (e) => { const i = BUCKETS.findIndex((x) => x.id === e.b.bucket); return i < 0 ? 99 : i; };
      const keyed = rows.map((e, i) => ({ e, i }));
      const cmp = {
        unpaid: (a, b) => ((a.e.paid - b.e.paid) || (a.e.b.dueDay - b.e.b.dueDay)),
        due: (a, b) => (a.e.b.dueDay - b.e.b.dueDay),
        amount: (a, b) => (amt(b.e) - amt(a.e)),
        bucket: (a, b) => (bidx(a.e) - bidx(b.e)) || (a.e.b.dueDay - b.e.b.dueDay),
      }[this._billSort] || (() => 0);
      return keyed.sort((a, b) => (cmp(a, b) || (a.i - b.i))).map((k) => k.e);
    },

    // Popover "Ordenar" do quadro de contas, ancorado no botão (padrão Pencil/
    // iPad: abre coladinho onde tocou). Reusa o estilo/teardown do menu de sort.
    _openBillSort(anchor) {
      this._closeSortMenu();
      const scrim = elt('div', 'fin-sort-scrim');
      const pop = elt('div', 'fin-sort-pop');
      const pick = (mode) => { this._billSort = mode; this._closeSortMenu(); this._render(true); };
      [
        ['unpaid', 'Pendentes primeiro', 'O que falta pagar no topo'],
        ['due', 'Por vencimento', 'Quem vence antes primeiro'],
        ['amount', 'Maior valor', 'Contas mais caras primeiro'],
        ['bucket', 'Por categoria', 'Agrupadas pela categoria AUVP'],
      ].forEach(([mode, label, desc]) => {
        const on = this._billSort === mode;
        const row = elt('button', 'fin-sort-row' + (on ? ' on' : ''));
        const txt = elt('div', 'fin-sort-rtext');
        txt.append(elt('span', 'fin-sort-rlabel', label), elt('span', 'fin-sort-rdesc', desc));
        row.append(txt, elt('span', 'fin-sort-rcheck', on ? '✓' : ''));
        row.onclick = () => pick(mode);
        pop.appendChild(row);
      });

      scrim.onclick = () => this._closeSortMenu();
      this._sortKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeSortMenu(); };
      document.addEventListener('keydown', this._sortKeyHandler);
      document.body.append(scrim, pop);
      this._sortScrim = scrim;
      this._sortPop = pop;

      const r = anchor.getBoundingClientRect();
      const gap = 8, margin = 8;
      const left = Math.max(margin, r.right - pop.offsetWidth);
      let top = r.bottom + gap;
      if (top + pop.offsetHeight > window.innerHeight - margin) {
        top = r.top - gap - pop.offsetHeight;
        pop.classList.add('from-bottom');
      }
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      requestAnimationFrame(() => pop.classList.add('open'));
    },

    // ── Gerenciar custos ─────────────────────────────────────────────────
    // Board com as 6 categorias AUVP (descrição + itens). Cada item é uma linha
    // do orçamento; editar abre o editor (descrição, categoria, vencimento,
    // valor previsto, tags). Itens com vencimento aparecem em "Contas com
    // vencimento" automaticamente (o quadro filtra por dueDay).
    _fillManage(board, profileResp) {
      board.innerHTML = '';
      const profile = profileResp && profileResp.profile;
      if (!profile) { board.appendChild(elt('div', 'fin-bud-subempty', 'Sem perfil para gerenciar.')); return; }
      const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const alloc = Object.assign({}, DEFAULT_ALLOCATION, profile.allocation || {});
      const items = (profile.budget || []).filter((b) => b.kind !== 'income');
      this._tagDefs = profile.tagDefs || []; // usado pelo editor de item e gerenciador de tags

      BUCKETS.forEach((bk) => {
        const list = items.filter((b) => (b.bucket || 'custo-fixo') === bk.id);
        const card = elt('div', 'card fin-manage-card');
        const h = elt('div', 'fin-manage-head');
        const dot = elt('span', 'fin-env-dot'); dot.style.background = bk.color;
        h.append(dot, elt('span', 'fin-manage-title', bk.label), elt('span', 'fin-manage-pct', `${alloc[bk.id] || 0}%`));
        card.appendChild(h);
        card.appendChild(elt('p', 'fin-manage-desc', bk.desc));
        if (!list.length) card.appendChild(elt('div', 'fin-manage-empty', 'Nenhum item nesta categoria ainda.'));
        list.forEach((it) => this._manageItemRow(card, it, fx));
        const add = elt('button', 'fin-inc-add', `＋ Adicionar item em ${bk.label}`);
        add.onclick = () => this._openItemEditor(null, bk.id);
        card.appendChild(add);
        board.appendChild(card);
      });
    },

    _manageItemRow(card, it, fx) {
      const row = elt('div', 'fin-manage-row');
      const main = elt('span', 'fin-manage-main');
      main.appendChild(elt('span', 'fin-manage-iname', it.label || it.category));
      main.appendChild(elt('span', 'fin-manage-imeta', it.dueDay ? `vence dia ${it.dueDay}` : 'sem vencimento fixo'));
      if (it.tags && it.tags.length) {
        const tg = elt('span', 'fin-manage-tags');
        it.tags.forEach((t) => tg.appendChild(elt('span', 'fin-tag', t)));
        main.appendChild(tg);
      }
      row.appendChild(main);
      row.appendChild(elt('span', 'fin-manage-val', brl(this._planBRL(it, fx))));
      row.appendChild(elt('span', 'fin-bud-caret', '✎'));
      row.onclick = () => this._openItemEditor(it, it.bucket || 'custo-fixo');
      card.appendChild(row);
    },

    // Editor de um item de custo (criar/editar): descrição, categoria, vencimento,
    // valor previsto e tags. Salvar faz POST (novo) ou PATCH (edição).
    _openItemEditor(item, bucketId) {
      this._closeItemEditor();
      const editing = !!item;
      let bucket = (item && item.bucket) || bucketId || 'custo-fixo';
      const selectedTags = new Set((item && item.tags) || []);

      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-item-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', editing ? 'Editar item' : 'Novo item'));

      const field = (labelText, inp) => {
        const f = elt('div', 'fin-item-field');
        f.appendChild(elt('label', 'fin-item-flabel', labelText));
        f.appendChild(inp);
        modal.appendChild(f);
        return inp;
      };

      const labelInp = elt('input', 'fin-item-inp');
      labelInp.type = 'text'; labelInp.maxLength = 80; labelInp.placeholder = 'Ex: Aluguel, Mercado, Academia';
      if (item) labelInp.value = item.label || '';
      field('Descrição', labelInp);

      // Categoria (chips)
      const fBucket = elt('div', 'fin-item-field');
      fBucket.appendChild(elt('label', 'fin-item-flabel', 'Categoria'));
      const chips = elt('div', 'fin-chips');
      const chipEls = {};
      BUCKETS.forEach((bk) => {
        const c = elt('button', 'fin-chip' + (bk.id === bucket ? ' on' : ''), bk.label);
        c.onclick = () => {
          bucket = bk.id;
          Object.values(chipEls).forEach((e) => e.classList.remove('on'));
          c.classList.add('on');
          // some tags selecionadas que não valem mais para a nova categoria
          [...selectedTags].forEach((nm) => {
            const d = (this._tagDefs || []).find((t) => t.name === nm);
            if (d && d.bucket && d.bucket !== bucket) selectedTags.delete(nm);
          });
          renderTagChips();
        };
        chipEls[bk.id] = c; chips.appendChild(c);
      });
      fBucket.appendChild(chips); modal.appendChild(fBucket);

      const dueInp = elt('input', 'fin-item-inp');
      dueInp.type = 'text'; dueInp.inputMode = 'numeric'; dueInp.placeholder = 'Ex: 10';
      if (item && item.dueDay) dueInp.value = String(item.dueDay);
      dueInp.oninput = () => { dueInp.value = dueInp.value.replace(/[^0-9]/g, '').slice(0, 2); };
      field('Vencimento — dia do mês (vazio = sem vencimento)', dueInp);

      const valInp = elt('input', 'fin-item-inp');
      valInp.type = 'text'; valInp.inputMode = 'decimal'; valInp.placeholder = 'Ex: 1200';
      if (item && item.amount != null) valInp.value = String(item.amount).replace('.', ',');
      valInp.oninput = () => {
        let v = valInp.value.replace(/[^0-9,]/g, '');
        const i = v.indexOf(',');
        if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '');
        valInp.value = v;
      };
      field('Valor previsto (R$)', valInp);

      // Tags: chips selecionáveis, filtradas pela categoria do item (escopo da tag
      // = a categoria atual ou "todas"). Geridas em 🏷 Tags.
      const fTags = elt('div', 'fin-item-field');
      fTags.appendChild(elt('label', 'fin-item-flabel', 'Tags'));
      const tagsWrap = elt('div', 'fin-chips');
      fTags.appendChild(tagsWrap);
      modal.appendChild(fTags);
      const renderTagChips = () => {
        tagsWrap.innerHTML = '';
        const defs = (this._tagDefs || []).filter((t) => !t.bucket || t.bucket === bucket);
        if (!defs.length) {
          tagsWrap.appendChild(elt('span', 'fin-item-hint', 'Nenhuma tag para esta categoria. Crie em 🏷 Tags.'));
          return;
        }
        defs.forEach((t) => {
          const c = elt('button', 'fin-chip' + (selectedTags.has(t.name) ? ' on' : ''), t.name);
          c.onclick = () => {
            if (selectedTags.has(t.name)) selectedTags.delete(t.name); else selectedTags.add(t.name);
            c.classList.toggle('on');
          };
          tagsWrap.appendChild(c);
        });
      };
      renderTagChips();

      const actions = elt('div', 'fin-item-actions');
      if (editing) {
        const del = elt('button', 'fin-item-del', 'Excluir');
        let armed = false, timer = null;
        onTap(del, async () => {
          if (!armed) {
            armed = true; del.classList.add('confirm'); del.textContent = 'Confirmar exclusão';
            timer = setTimeout(() => { armed = false; del.classList.remove('confirm'); del.textContent = 'Excluir'; }, 3000);
            return;
          }
          clearTimeout(timer);
          try {
            await BISA.api(`/finance/budget?category=${encodeURIComponent(item.category)}`, { method: 'DELETE' });
            BISA.toast('Item excluído'); this._closeItemEditor(); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        });
        actions.appendChild(del);
      }
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar');
      onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', editing ? 'Salvar' : 'Criar item');
      const parseVal = (s) => {
        const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };
      onTap(save, async () => {
        const label = labelInp.value.trim();
        if (!label) { BISA.toast('Informe a descrição'); return; }
        const dueDay = dueInp.value ? Math.min(31, Math.max(1, parseInt(dueInp.value, 10) || 0)) : 0;
        const payload = { label, bucket, dueDay, amount: parseVal(valInp.value), tags: [...selectedTags] };
        try {
          if (editing) await BISA.api('/finance/budget', { method: 'PATCH', json: { category: item.category, ...payload } });
          else await BISA.api('/finance/budget', { method: 'POST', json: payload });
          BISA.toast(editing ? 'Item atualizado!' : 'Item criado!');
          this._closeItemEditor(); this._render(true);
        } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
      });
      actions.append(cancel, save);
      modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeItemEditor(); };
      this._itemKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeItemEditor(); };
      document.addEventListener('keydown', this._itemKeyHandler);
      document.body.appendChild(overlay);
      this._itemOverlay = overlay;
      labelInp.focus();
    },

    _closeItemEditor() {
      if (this._itemKeyHandler) { document.removeEventListener('keydown', this._itemKeyHandler); this._itemKeyHandler = null; }
      if (this._itemOverlay) { this._itemOverlay.remove(); this._itemOverlay = null; }
    },

    // Gerenciador de tags (modal): cria/remove tags e define o escopo de cada
    // uma — uma categoria ou "Todas". As tags aparecem como chips no editor de
    // item, filtradas pela categoria. Reusa o slot de modal do editor de item.
    _openTagManager() {
      this._closeItemEditor();
      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-item-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', 'Tags'));
      modal.appendChild(elt('p', 'fin-manage-desc',
        'Crie tags para marcar seus itens e consultar depois. Vincule a uma categoria (só aparece nela) ou a Todas.'));

      const listWrap = elt('div');
      modal.appendChild(listWrap);
      const renderList = () => {
        listWrap.innerHTML = '';
        const defs = this._tagDefs || [];
        if (!defs.length) { listWrap.appendChild(elt('div', 'fin-manage-empty', 'Nenhuma tag ainda.')); return; }
        defs.forEach((t) => {
          const row = elt('div', 'fin-tagrow');
          row.append(
            elt('span', 'fin-tagrow-name', t.name),
            elt('span', 'fin-tagrow-scope', t.bucket ? bucketLabel(t.bucket) : 'Todas'),
          );
          const del = elt('button', 'fin-bud-subbtn del', '✕');
          let armed = false, timer = null;
          onTap(del, async () => {
            if (!armed) {
              armed = true; del.classList.add('confirm'); del.textContent = 'Excluir?';
              timer = setTimeout(() => { armed = false; del.classList.remove('confirm'); del.textContent = '✕'; }, 3000);
              return;
            }
            clearTimeout(timer);
            try {
              await BISA.api(`/finance/tags?name=${encodeURIComponent(t.name)}`, { method: 'DELETE' });
              this._tagDefs = (this._tagDefs || []).filter((x) => x.name !== t.name);
              renderList(); BISA.toast('Tag removida');
            } catch (e) { BISA.toast(e.message || 'Erro ao remover'); }
          });
          row.appendChild(del);
          listWrap.appendChild(row);
        });
      };
      renderList();

      modal.appendChild(elt('div', 'fin-tagdiv'));

      const nameInp = elt('input', 'fin-item-inp');
      nameInp.type = 'text'; nameInp.maxLength = 40; nameInp.placeholder = 'Ex: essencial, joinville, gabi';
      const fName = elt('div', 'fin-item-field');
      fName.append(elt('label', 'fin-item-flabel', 'Nova tag'), nameInp);
      modal.appendChild(fName);

      let scope = null; // null = todas
      const fScope = elt('div', 'fin-item-field');
      fScope.appendChild(elt('label', 'fin-item-flabel', 'Vincular a'));
      const scopeChips = elt('div', 'fin-chips');
      const scopeEls = [];
      const mkScope = (id, label) => {
        const c = elt('button', 'fin-chip' + (scope === id ? ' on' : ''), label);
        c.onclick = () => { scope = id; scopeEls.forEach((e) => e.classList.remove('on')); c.classList.add('on'); };
        scopeEls.push(c); scopeChips.appendChild(c);
      };
      mkScope(null, 'Todas');
      BUCKETS.forEach((bk) => mkScope(bk.id, bk.label));
      fScope.appendChild(scopeChips); modal.appendChild(fScope);

      const addBtn = elt('button', 'fin-inc-add', '＋ Adicionar tag');
      onTap(addBtn, async () => {
        const n = nameInp.value.trim();
        if (!n) { BISA.toast('Informe o nome da tag'); return; }
        try {
          const r = await BISA.api('/finance/tags', { method: 'POST', json: { name: n, bucket: scope } });
          this._tagDefs = (r && r.tags) || this._tagDefs;
          nameInp.value = ''; renderList(); nameInp.focus(); BISA.toast('Tag adicionada');
        } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
      });
      modal.appendChild(addBtn);

      const actions = elt('div', 'fin-item-actions');
      const close = elt('button', 'fin-amount-cancel', 'Fechar');
      onTap(close, () => this._closeItemEditor());
      actions.appendChild(close);
      modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeItemEditor(); };
      this._itemKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeItemEditor(); };
      document.addEventListener('keydown', this._itemKeyHandler);
      document.body.appendChild(overlay);
      this._itemOverlay = overlay;
      nameInp.focus();
    },

    // ── Controle do mês (AUVP: envelopes por % da renda) ────────────────
    // A renda do mês é fatiada em 6 categorias com meta em %. "Devo gastar" =
    // %×renda; "Gasto" = soma dos lançamentos do bucket; a barra mostra o
    // utilizado e avisa quando passa. As % são editáveis em tempo real (modo
    // "Metas %"); cada categoria expande para ver/lançar os gastos.
    _fillEnvelope(wrap, profileResp, summary) {
      wrap.innerHTML = '';
      const profile = profileResp && profileResp.profile;
      if (!profile) return;
      const alloc = Object.assign({}, DEFAULT_ALLOCATION, profile.allocation || {});
      const renda = (summary && summary.cash && summary.cash.income) || 0;
      const manual = (summary && summary.cash && summary.cash.manual) || [];
      const isThisMonth = this._month === thisMonth();

      // mapa categoria→bucket (resolve lançamentos legados sem bucket próprio)
      const catBucket = {};
      (profile.budget || []).forEach((b) => { if (b.kind !== 'income' && b.bucket) catBucket[b.category] = b.bucket; });
      const bucketOf = (t) => (DEFAULT_ALLOCATION[t.bucket] != null ? t.bucket
        : (catBucket[t.category] || 'custo-fixo'));

      const gastoBy = {}; const txBy = {};
      BUCKETS.forEach((b) => { gastoBy[b.id] = 0; txBy[b.id] = []; });
      manual.filter((t) => t.kind === 'expense').forEach((t) => {
        const k = bucketOf(t); gastoBy[k] += t.amount; txBy[k].push(t);
      });

      const head = elt('div', 'fin-sec-head');
      head.appendChild(elt('span', 'fin-sec-title', 'Controle do mês'));
      const manageBtn = elt('button', 'fin-addbtn', '⚙ Gerenciar');
      manageBtn.onclick = () => { this._manageMode = true; this._render(); };
      head.appendChild(manageBtn);
      const editBtn = elt('button', 'fin-addbtn', this._allocEdit ? '✓ Concluir' : 'Metas %');
      editBtn.onclick = () => { this._allocEdit = !this._allocEdit; this._render(true); };
      head.appendChild(editBtn);
      wrap.appendChild(head);

      const card = elt('div', 'card');

      const totalPct = () => BUCKETS.reduce((s, b) => s + (Number(alloc[b.id]) || 0), 0);
      const meta = elt('div', 'fin-env-meta');
      meta.innerHTML = `<span>Renda do mês <strong>${brl(renda)}</strong></span>`;
      const tp = totalPct();
      const totEl = elt('span', 'fin-env-total' + (Math.abs(tp - 100) > 0.5 ? ' off' : ''), `Alocado ${tp.toFixed(0)}%`);
      meta.appendChild(totEl);
      card.appendChild(meta);

      const recomputeTotal = () => {
        const t = totalPct();
        totEl.textContent = `Alocado ${t.toFixed(0)}%`;
        totEl.classList.toggle('off', Math.abs(t - 100) > 0.5);
      };

      // refs dos sliders (modo edição) p/ redistribuir e salvar em lote
      const sliders = [];
      const persistAll = async () => {
        try { for (const s of BUCKETS) await BISA.api('/finance/allocation', { method: 'PATCH', json: { bucket: s.id, pct: Number(alloc[s.id]) || 0 } }); }
        catch (e) { BISA.toast(e.message || 'Erro ao salvar %'); }
      };

      BUCKETS.forEach((b) => {
        const pct = Number(alloc[b.id]) || 0;
        const gasto = Math.round((gastoBy[b.id] || 0) * 100) / 100;
        const devo = Math.round(renda * pct) / 100;
        const util = devo > 0 ? gasto / devo : (gasto > 0 ? 1 : 0);
        const over = gasto > devo + 0.005;

        const row = elt('div', 'fin-env-row');
        const top = elt('div', 'fin-env-top');
        const dot = elt('span', 'fin-env-dot'); dot.style.background = b.color;
        const caret = elt('span', 'fin-env-caret', this._expandedBuckets.has(b.id) ? '▾' : '▸');
        const pctEl = elt('span', 'fin-env-pct', `${pct.toFixed(0)}%`);
        top.append(dot, caret, elt('span', 'fin-env-name', b.label), pctEl);
        if (this._allocEdit) { caret.style.visibility = 'hidden'; top.style.cursor = 'default'; } else {
          top.onclick = () => {
            if (this._expandedBuckets.has(b.id)) this._expandedBuckets.delete(b.id);
            else this._expandedBuckets.add(b.id);
            this._render(true);
          };
        }
        row.appendChild(top);

        if (this._allocEdit) {
          const slider = elt('input', 'fin-env-slider');
          slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = String(pct);
          sliders.push({ id: b.id, el: slider, pctEl });
          slider.oninput = () => {
            const v = Number(slider.value);
            // nunca passar de 100%: ao subir esta, reduz as outras proporcionalmente
            const others = sliders.filter((s) => s.id !== b.id);
            const othersSum = others.reduce((s, o) => s + (Number(alloc[o.id]) || 0), 0);
            if (v + othersSum > 100) {
              const room = Math.max(0, 100 - v);
              let acc = 0;
              others.forEach((o, i) => {
                const nv = (i === others.length - 1)
                  ? Math.max(0, room - acc)
                  : Math.round(((Number(alloc[o.id]) || 0) * room) / (othersSum || 1));
                if (i < others.length - 1) acc += nv;
                alloc[o.id] = nv; o.el.value = String(nv); o.pctEl.textContent = `${nv}%`;
              });
            }
            alloc[b.id] = v; pctEl.textContent = `${v}%`; recomputeTotal();
          };
          slider.onchange = () => persistAll(); // salva todas (a redistribuição mexe em várias)
          row.appendChild(slider);
          // Atalho: fixar esta categoria no % já gasto e rebalancear o resto p/ 100%.
          if (renda > 0 && gasto > 0) {
            const tgt = Math.min(100, Math.round((gasto / renda) * 100));
            const fit = elt('button', 'fin-env-fit', `Ajustar ao gasto (${tgt}%) e rebalancear`);
            fit.onclick = () => this._fitAllocation(b.id, renda, gastoBy, alloc);
            row.appendChild(fit);
          }
        } else {
          const bar = elt('div', 'fin-env-bar');
          const fill = elt('div', 'fin-env-fill');
          fill.style.width = `${Math.min(100, util * 100).toFixed(0)}%`;
          fill.style.background = over ? 'var(--negative)' : 'var(--primary)';
          fill.style.opacity = over ? '0.45' : '0.30';
          const nums = elt('div', 'fin-env-nums');
          nums.append(
            elt('strong', over ? 'fin-value-neg' : null, brl(gasto)),
            elt('span', 'muted', '/'),
            elt('span', 'muted', brl(devo)),
          );
          if (over) nums.appendChild(elt('span', 'fin-env-over', '⚠'));
          bar.append(fill, nums);
          row.appendChild(bar);
          if (this._expandedBuckets.has(b.id)) this._renderBucketTxs(row, b, txBy[b.id], isThisMonth);
        }
        card.appendChild(row);
      });

      wrap.appendChild(card);
    },

    // Fixa a meta da categoria no % já gasto (gasto/renda) e rebalanceia as
    // outras proporcionalmente para o total fechar 100%. Persiste via PATCH.
    async _fitAllocation(catId, renda, gastoBy, alloc) {
      if (!(renda > 0)) { BISA.toast('Sem renda no mês para calcular'); return; }
      const target = Math.max(0, Math.min(100, Math.round(((gastoBy[catId] || 0) / renda) * 100)));
      const remaining = 100 - target;
      const others = BUCKETS.filter((b) => b.id !== catId);
      const othersSum = others.reduce((s, o) => s + (Number(alloc[o.id]) || 0), 0);
      const next = { [catId]: target };
      if (othersSum > 0) others.forEach((o) => { next[o.id] = Math.round(((Number(alloc[o.id]) || 0) * remaining) / othersSum); });
      else others.forEach((o) => { next[o.id] = Math.round(remaining / others.length); });
      // corrige arredondamento para somar exatamente 100 (joga a diferença no maior "outro")
      const sum = BUCKETS.reduce((s, b) => s + next[b.id], 0);
      if (sum !== 100 && others.length) {
        const big = others.slice().sort((a, b) => next[b.id] - next[a.id])[0];
        next[big.id] = Math.max(0, next[big.id] + (100 - sum));
      }
      try {
        for (const b of BUCKETS) await BISA.api('/finance/allocation', { method: 'PATCH', json: { bucket: b.id, pct: next[b.id] } });
        BISA.toast(`${bucketLabel(catId)} ajustado para ${target}%`);
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao ajustar'); }
    },

    // Lançamentos de um envelope no mês + botão de lançar (gasto direto no bucket).
    _renderBucketTxs(row, bucket, txs, isThisMonth) {
      const sub = elt('div', 'fin-env-sublist');
      const sorted = txs.slice().sort((a, c) => (a.date < c.date ? 1 : -1));
      if (!sorted.length) sub.appendChild(elt('div', 'fin-bud-subempty', 'Nenhum gasto nesta categoria neste mês.'));
      sorted.forEach((tx) => {
        const srow = elt('div', 'fin-bud-subrow');
        const act = elt('span', 'fin-bud-subact');
        const edit = elt('button', 'fin-bud-subbtn', '✎');
        edit.title = 'Editar valor';
        edit.onclick = () => this._openAmountSheet({
          title: tx.desc || bucketLabel(bucket.id), initial: tx.amount, withDesc: true, descInitial: tx.desc,
          confirmLabel: 'Salvar', onConfirm: (amount, desc) => this._editTx({ ...tx, desc: desc || tx.desc }, amount),
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
            BISA.toast('Gasto excluído'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        };
        act.append(edit, del);
        srow.append(
          elt('span', 'fin-bud-subdate', fmtDate(tx.date)),
          elt('span', 'fin-bud-subdesc', tx.desc || tx.category || '—'),
          elt('strong', 'fin-bud-subamt', brl(tx.amount)),
          act,
        );
        sub.appendChild(srow);
      });
      if (isThisMonth) {
        const addWrap = elt('div', 'fin-env-addrow');
        const add = elt('button', 'fin-env-add', `＋ Lançar em ${bucketLabel(bucket.id)}`);
        add.onclick = () => this._openExpense(bucket.id);
        addWrap.appendChild(add);
        sub.appendChild(addWrap);
      }
      row.appendChild(sub);
    },

    // Lançar um gasto direto num envelope (descrição + valor; bucket fixo).
    // Em liberdade/metas, permite vincular o aporte a um objetivo.
    _openExpense(bucketId) {
      const objs = (this._objectives || []).filter((o) => o.bucket === bucketId);
      this._openAmountSheet({
        title: `Gasto · ${bucketLabel(bucketId)}`, initial: null, withDesc: true,
        descPlaceholder: 'Descrição (ex: Mercado, Uber)',
        goalChips: objs.length ? objs.map((o) => ({ id: o.id, label: o.label })) : undefined,
        confirmLabel: 'Salvar gasto',
        onConfirm: async (amount, desc, goalId) => {
          try {
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: { kind: 'expense', amount, desc: desc || bucketLabel(bucketId),
                category: (desc || bucketId).slice(0, 40), bucket: bucketId, goalId: goalId || undefined, date: todayISO() },
            });
            await this._addToObjective(goalId, amount);
            BISA.toast('Gasto lançado!'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
        },
      });
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
    async _setRealized(b, amount, usd) {
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const matching = manual.filter((t) => t.kind === 'income' && t.category === b.category);
      try {
        for (const t of matching) {
          await BISA.api(`/finance/tx?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
        }
        if (amount > 0) {
          // Fonte em dólar: registra a cotação implícita na descrição (auditável).
          const desc = (usd > 0)
            ? `${b.label || b.category} — US$ ${fmtNum(usd)} a ${fmtRate(amount / usd)}`
            : (b.label || b.category);
          await BISA.api('/finance/tx', {
            method: 'POST',
            json: { kind: 'income', amount, desc, category: b.category || 'outro', date: todayISO() },
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
    // mesmo campo. opts: { title, initial, plan, confirmLabel, allowZero, onConfirm,
    //   withDesc, descInitial, descPlaceholder, descChips }. Com withDesc, um campo
    //   de descrição aparece acima do valor e onConfirm recebe (amount, desc).
    _openAmountSheet(opts) {
      const { title, initial, plan = 0, confirmLabel = 'Salvar', allowZero = false, onConfirm } = opts;
      this._closeAmountSheet();

      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-amount-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', title || 'Valor'));

      // Campo de descrição opcional (texto comum — teclado nativo/Scribble ok).
      let descInput = null;
      if (opts.withDesc) {
        descInput = elt('input', 'fin-amount-desc');
        descInput.type = 'text';
        descInput.placeholder = opts.descPlaceholder || 'Descrição';
        descInput.maxLength = 200;
        descInput.autocomplete = 'off';
        if (opts.descInitial) descInput.value = opts.descInitial;
        modal.appendChild(descInput);
        if (Array.isArray(opts.descChips) && opts.descChips.length) {
          const chips = elt('div', 'fin-amount-descchips');
          opts.descChips.forEach((c) => {
            const chip = elt('button', 'fin-chip', c);
            chip.onclick = () => { descInput.value = c; descInput.focus(); };
            chips.appendChild(chip);
          });
          modal.appendChild(chips);
        }
      }

      // Seleção de objetivo (aporte de liberdade/metas) — chips de objetivo.
      let selectedGoal = null;
      if (Array.isArray(opts.goalChips) && opts.goalChips.length) {
        const f = elt('div', 'fin-item-field');
        f.appendChild(elt('label', 'fin-item-flabel', 'Direcionar para'));
        const chips = elt('div', 'fin-chips');
        opts.goalChips.forEach((g) => {
          const chip = elt('button', 'fin-chip', g.label);
          chip.onclick = () => {
            selectedGoal = (selectedGoal === g.id ? null : g.id);
            [...chips.children].forEach((c) => c.classList.remove('on'));
            if (selectedGoal) chip.classList.add('on');
          };
          chips.appendChild(chip);
        });
        f.appendChild(chips);
        modal.appendChild(f);
      }

      const curLabel = opts.curLabel || 'R$';
      const rateBase = Number(opts.rateBase) || 0; // US$ p/ cotação implícita (modo R$)
      const fieldWrap = elt('div', 'fin-amount-fieldwrap');
      fieldWrap.appendChild(elt('span', 'fin-amount-cur', curLabel));
      const input = elt('input', 'fin-amount-input');
      input.type = 'text';
      input.inputMode = 'none'; // Scribble (Pencil) e o teclado abaixo escrevem aqui; teclado nativo fica de fora
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `Valor em ${curLabel} — ${title || ''}`);
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
      const refresh = () => {
        const n = parse(input.value);
        if (!(n > 0)) { preview.textContent = ''; return; }
        let txt = curLabel === 'R$' ? `= ${brl(n)}` : `= ${curLabel} ${fmtNum(n)}`;
        if (rateBase > 0) txt += ` · cotação ${fmtRate(n / rateBase)} / US$`;
        preview.textContent = txt;
      };
      // O campo de valor só aceita números: descarta letras/símbolos que o
      // Scribble ou um colar possam inserir (o teclado grande já é numérico),
      // mantendo no máximo uma vírgula decimal.
      input.oninput = () => {
        let v = input.value.replace(/[^0-9,]/g, '');
        const i = v.indexOf(',');
        if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '');
        if (v !== input.value) {
          const pos = Math.max(0, input.selectionStart - (input.value.length - v.length));
          input.value = v;
          try { input.setSelectionRange(pos, pos); } catch { /* ignore */ }
        }
        refresh();
      };
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

      // Atalho: preencher com o valor de referência (1 toque).
      if (plan > 0) {
        const chip = elt('button', 'fin-amount-chip', `Usar ${brl(plan)}`);
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
        onConfirm(amount, descInput ? descInput.value.trim() : undefined, selectedGoal);
      };
      save.onclick = submit;
      input.onkeydown = (ev) => { if (ev.key === 'Enter') submit(); };
      if (descInput) descInput.onkeydown = (ev) => { if (ev.key === 'Enter') input.focus(); };
      actions.append(cancel, save);
      modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeAmountSheet(); };
      this._amountKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeAmountSheet(); };
      document.addEventListener('keydown', this._amountKeyHandler);

      document.body.appendChild(overlay);
      this._amountOverlay = overlay;
      // Receita nova sem descrição: foca a descrição primeiro; senão, o valor.
      if (descInput && !opts.descInitial) {
        descInput.focus();
      } else {
        input.focus();
        const len = input.value.length; input.setSelectionRange(len, len);
      }
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
      const profile = profileResp && profileResp.profile;
      const loans = (profileResp && profileResp.loans) || [];

      const head = elt('div', 'fin-sec-head');
      head.appendChild(elt('span', 'fin-sec-title', 'Objetivos e plano'));
      if (profile) {
        const addBtn = elt('button', 'fin-addbtn', '＋ Objetivo');
        addBtn.onclick = () => this._openObjectiveEditor(null);
        head.appendChild(addBtn);
      }
      wrap.appendChild(head);

      const card = elt('div', 'card');

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

      const std = this._stdRate || (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const objectives = profile.objectives || [];
      if (!objectives.length) card.appendChild(elt('div', 'fin-bud-subempty', 'Nenhum objetivo ainda. Toque em ＋ Objetivo para criar.'));
      objectives.forEach((o) => {
        const cur = Number(o.current || 0);
        const curBRL = o.currency === 'USD' ? cur * std : cur;
        const ratio = o.target > 0 ? Math.min(1, curBRL / o.target) : 0;
        const color = o.bucket === 'metas' ? BUCKETS[3].color : BUCKETS[2].color;

        const goalWrap = elt('div', 'fin-obj');
        goalWrap.onclick = () => this._openObjectiveEditor(o);
        const nameRow = elt('div', 'row');
        const name = elt('span', null, o.label); name.style.fontWeight = '600';
        const spacer = elt('span'); spacer.style.flex = '1';
        const curTxt = o.currency === 'USD' ? `US$ ${fmtNum(cur)} (${brl(curBRL)})` : brl(curBRL);
        const val = elt('span', 'muted', `${curTxt} de ${brl(o.target || 0)}`);
        val.style.fontSize = '.85rem';
        nameRow.append(name, spacer, val);
        const barWrap = elt('div', 'fin-progress-wrap');
        const bar = elt('div', 'fin-progress-bar');
        bar.style.width = `${(ratio * 100).toFixed(1)}%`;
        bar.style.background = color;
        barWrap.appendChild(bar);
        const meta = elt('div', 'fin-obj-meta');
        meta.append(elt('span', 'fin-obj-tag', o.bucket === 'metas' ? 'Metas' : 'Liberdade'),
          document.createTextNode(` · ${(ratio * 100).toFixed(0)}% da meta`));
        goalWrap.append(nameRow, barWrap, meta);
        card.appendChild(goalWrap);
      });

      if (loans.length > 0) {
        if (objectives.length > 0) {
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

      wrap.appendChild(card);
    },

    // Editor de objetivo (criar/editar): rótulo, categoria (liberdade/metas),
    // moeda, saldo atual e meta. Saldo atual é o que você já tem acumulado; os
    // aportes vinculados somam por cima.
    _openObjectiveEditor(obj) {
      this._closeItemEditor();
      const editing = !!obj;
      let bucket = (obj && obj.bucket) || 'liberdade';
      let currency = (obj && obj.currency) || 'BRL';

      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-item-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', editing ? 'Editar objetivo' : 'Novo objetivo'));

      const labelInp = elt('input', 'fin-item-inp');
      labelInp.type = 'text'; labelInp.maxLength = 80; labelInp.placeholder = 'Ex: Reserva de emergência, Viagem Paris';
      if (obj) labelInp.value = obj.label || '';
      const fL = elt('div', 'fin-item-field'); fL.append(elt('label', 'fin-item-flabel', 'Nome'), labelInp); modal.appendChild(fL);

      // Categoria (liberdade/metas)
      const fB = elt('div', 'fin-item-field'); fB.appendChild(elt('label', 'fin-item-flabel', 'Categoria'));
      const bChips = elt('div', 'fin-chips'); const bEls = {};
      [['liberdade', 'Liberdade financeira'], ['metas', 'Metas']].forEach(([id, lbl]) => {
        const c = elt('button', 'fin-chip' + (id === bucket ? ' on' : ''), lbl);
        onTap(c, () => { bucket = id; Object.values(bEls).forEach((e) => e.classList.remove('on')); c.classList.add('on'); });
        bEls[id] = c; bChips.appendChild(c);
      });
      fB.appendChild(bChips); modal.appendChild(fB);

      // Moeda (BRL/USD)
      const fC = elt('div', 'fin-item-field'); fC.appendChild(elt('label', 'fin-item-flabel', 'Moeda do saldo'));
      const cChips = elt('div', 'fin-chips'); const cEls = {};
      [['BRL', 'Reais (R$)'], ['USD', 'Dólar (US$)']].forEach(([id, lbl]) => {
        const c = elt('button', 'fin-chip' + (id === currency ? ' on' : ''), lbl);
        onTap(c, () => { currency = id; Object.values(cEls).forEach((e) => e.classList.remove('on')); c.classList.add('on'); });
        cEls[id] = c; cChips.appendChild(c);
      });
      fC.appendChild(cChips); modal.appendChild(fC);

      const numInp = (labelText, val, ph) => {
        const inp = elt('input', 'fin-item-inp'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = ph || '';
        if (val != null) inp.value = String(val).replace('.', ',');
        inp.oninput = () => { let v = inp.value.replace(/[^0-9,]/g, ''); const i = v.indexOf(','); if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, ''); inp.value = v; };
        const f = elt('div', 'fin-item-field'); f.append(elt('label', 'fin-item-flabel', labelText), inp); modal.appendChild(f);
        return inp;
      };
      const curInp = numInp('Saldo atual (já acumulado)', obj && obj.current, 'Ex: 8977,62');
      const tgtInp = numInp('Meta (R$)', obj && obj.target, 'Ex: 80000');

      const parseNum = (s) => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; };

      const actions = elt('div', 'fin-item-actions');
      if (editing) {
        const del = elt('button', 'fin-item-del', 'Excluir');
        let armed = false, timer = null;
        onTap(del, async () => {
          if (!armed) { armed = true; del.classList.add('confirm'); del.textContent = 'Confirmar exclusão'; timer = setTimeout(() => { armed = false; del.classList.remove('confirm'); del.textContent = 'Excluir'; }, 3000); return; }
          clearTimeout(timer);
          try { await BISA.api(`/finance/objectives?id=${encodeURIComponent(obj.id)}`, { method: 'DELETE' }); BISA.toast('Objetivo excluído'); this._closeItemEditor(); this._render(true); }
          catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        });
        actions.appendChild(del);
      }
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar'); onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', editing ? 'Salvar' : 'Criar');
      onTap(save, async () => {
        const label = labelInp.value.trim();
        if (!label) { BISA.toast('Informe o nome'); return; }
        const payload = { label, bucket, currency, current: parseNum(curInp.value), target: parseNum(tgtInp.value) };
        try {
          if (editing) await BISA.api('/finance/objectives', { method: 'PATCH', json: { id: obj.id, ...payload } });
          else await BISA.api('/finance/objectives', { method: 'POST', json: payload });
          BISA.toast(editing ? 'Objetivo atualizado!' : 'Objetivo criado!');
          this._closeItemEditor(); this._render(true);
        } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
      });
      actions.append(cancel, save); modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeItemEditor(); };
      this._itemKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeItemEditor(); };
      document.addEventListener('keydown', this._itemKeyHandler);
      document.body.appendChild(overlay); this._itemOverlay = overlay; labelInp.focus();
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
