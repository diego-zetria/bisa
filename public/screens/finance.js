// screens/finance.js — Tela de Finanças (redesign 2026-06-13).
// Alcançada via BISA.go('finance') a partir do Hub, não está no nav inferior.
// Layout iPad-first: duas colunas (≥900px) — esquerda glanceável (saldo,
// análise da IA, categorias, carteira), direita acionável (controle do mês,
// lançamentos, objetivos). Vira coluna única no celular. Texto em pt-BR.
//
// Endpoints usados (inventário completo em docs/finance.md):
//   GET    /finance/summary?month= · /finance/profile · /finance/positions
//   POST   /finance/tx {date,kind,amount,category,desc,bucket?,goalId?,pending?,creditGoal?}
//   PATCH  /finance/tx {id,...campos,creditGoal?} — edição in-place
//   DELETE /finance/tx?id=&creditGoal=1?
//   POST/PATCH/DELETE /finance/budget · /finance/objectives · /finance/tags
//   PATCH  /finance/allocation {bucket, pct|amount|rest} · /finance/fx {rate}

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
      .fin-hero-balance.positive { color:#2f9e63; } /* verde vivo no hero (pedido 2026-07-10); --positive (sage) segue no resto */
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
      .fin-hero-sub .dot.pend { background:var(--warn); }

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
        background:color-mix(in srgb, var(--positive) 18%, transparent); color:var(--positive); }   /* badge "recebido" */
      .fin-inc-sub.pend { background:var(--warn-soft); color:var(--warn); } /* badge "a receber" */
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
      .fin-bud-alert { display:flex; align-items:center; gap:8px; background:color-mix(in srgb, var(--negative) 10%, transparent);
        color:var(--negative); border-radius:var(--radius-sm); padding:9px 12px; font-size:.86rem;
        font-weight:600; margin-bottom:14px; }
      .fin-bud-alert.soft { background:var(--warn-soft); color:var(--warn); }
      .fin-bud-status { width:11px; height:11px; border-radius:50%; flex:0 0 auto; }
      .fin-bud-status.st-pending { background:var(--line); }
      .fin-bud-status.st-ok { background:var(--positive); }
      .fin-bud-status.st-over { background:var(--negative); }
      .fin-bud-label { flex:1; min-width:0; }
      .fin-bud-due { font-size:.7rem; color:var(--ink-soft); padding:1px 6px; background:var(--surface-2); border-radius:999px; }
      .fin-bud-due.overdue { background:color-mix(in srgb, var(--negative) 15%, transparent); color:var(--negative); font-weight:600; }
      .fin-bud-due.soon { background:var(--warn-soft); color:var(--warn); font-weight:600; }
      .fin-bud-due.paid { text-decoration:line-through; opacity:.5; }   /* dia rabiscado quando pago */
      .fin-bud-paid { font-size:.7rem; padding:1px 8px; border-radius:999px; font-weight:700;
        background:color-mix(in srgb, var(--positive) 18%, transparent); color:var(--positive); }       /* badge "pago" verde */
      .fin-bud-pay { border:1px solid var(--line); background:var(--surface-2); color:var(--ink);
        border-radius:var(--radius-sm); padding:0 18px; min-height:var(--tap); min-width:var(--tap);
        font-size:.9rem; font-weight:600; cursor:pointer; white-space:nowrap; }
      .fin-bud-pay:hover { background:var(--line); }
      .fin-bud-pay.ghost { border:none; background:none; color:var(--ink-soft); min-width:var(--tap);
        padding:0 8px; font-size:1.2rem; font-weight:400; }
      .fin-bud-check { color:var(--positive); font-size:1.3rem; padding:0 4px; }
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
      .fin-bud-subhead { display:flex; align-items:center; gap:10px; flex-wrap:wrap;
        font-size:.8rem; font-weight:650; color:var(--ink-soft);
        font-variant-numeric:tabular-nums; padding:2px 2px 6px; }
      .fin-bud-subhead.neg { color:var(--negative); }
      .fin-bud-subhead.free { color:var(--ink-soft); }
      .fin-bud-setmeta { border:1px dashed var(--primary); background:var(--accent-soft);
        color:var(--primary); border-radius:999px; font-size:.74rem; font-weight:600;
        padding:3px 12px; min-height:30px; cursor:pointer; }

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
      /* ── Agente de finanças (🤖): chat em overlay, veio da tela Ziggy ─── */
      .fin-agent-overlay { position:fixed; inset:0; background:rgba(0,0,0,.38);
        display:flex; align-items:center; justify-content:center; padding:20px; z-index:1000; }
      .fin-agent-modal { background:var(--surface); border-radius:var(--radius); box-shadow:var(--shadow);
        width:100%; max-width:560px; max-height:82vh; padding:16px; display:flex; flex-direction:column; gap:10px; }
      .fin-agent-hint { font-size:.78rem; color:var(--ink-soft); line-height:1.45; }
      .fin-agent-log { display:flex; flex-direction:column; gap:8px; overflow-y:auto; min-height:0; }
      .fin-agent-m { max-width:88%; padding:9px 13px; border-radius:14px; font-size:.92rem; line-height:1.5; flex:0 0 auto; }
      .fin-agent-m.u { align-self:flex-end; background:var(--primary); color:var(--primary-ink); border-bottom-right-radius:4px; }
      .fin-agent-m.a { align-self:flex-start; background:var(--surface-2); border:1px solid var(--line); border-bottom-left-radius:4px; overflow-x:auto; }
      .fin-agent-m.a p { margin:0 0 6px; }
      .fin-agent-m.a table { border-collapse:collapse; font-size:.85rem; }
      .fin-agent-m.a th, .fin-agent-m.a td { border:1px solid var(--line); padding:4px 7px; }
      .fin-agent-ta { width:100%; border:2px solid var(--line); background:var(--surface-2);
        border-radius:var(--radius-sm); padding:10px 14px; font-size:1rem; color:var(--ink);
        outline:none; min-height:64px; resize:vertical; font-family:inherit; }
      .fin-agent-ta:focus { border-color:var(--primary); }
      .fin-agent-st { font-size:.8rem; color:var(--ink-soft); }
      /* ── Provisões do mês (anel de progresso) ─────────────────────────── */
      .fin-prov-row { display:flex; align-items:center; gap:14px; padding:12px 0;
        border-bottom:1px solid var(--line); }
      .fin-prov-row:last-of-type { border-bottom:0; }
      .fin-prov-ring { --p:0; --c:#5b8fd6; width:52px; height:52px; flex:0 0 auto;
        border-radius:50%; display:grid; place-items:center; position:relative;
        background:conic-gradient(var(--c) calc(var(--p)*1%), var(--surface-2) 0); }
      .fin-prov-ring.warn { --c:var(--warn); }
      .fin-prov-ring.over { --c:var(--negative); }
      /* sem meta: anel cheio + valor gasto em destaque (maior/negrito) */
      .fin-prov-sub.free { color:var(--ink-soft); }
      .fin-prov-bigval { font-size:1.12rem; font-weight:700; color:var(--ink); }
      .fin-prov-ring::after { content:''; position:absolute; inset:6px; border-radius:50%;
        background:var(--surface); }
      .fin-prov-ring b { position:relative; z-index:1; font-size:.72rem; font-weight:800;
        font-variant-numeric:tabular-nums; }
      .fin-prov-mid { flex:1; min-width:0; cursor:pointer; }
      .fin-prov-name { font-weight:650; }
      .fin-prov-caret { color:var(--ink-soft); font-size:.72rem; }
      .fin-prov-sub { font-size:.8rem; color:var(--ink-soft); margin-top:2px;
        font-variant-numeric:tabular-nums; }
      .fin-prov-sub.neg { color:var(--negative); }
      .fin-prov-add { flex:0 0 auto; border:none; background:var(--accent-soft); color:var(--primary);
        border-radius:50%; width:36px; height:36px; min-height:36px; font-size:1.15rem;
        line-height:1; cursor:pointer; }
      .fin-prov-sublist-holder { padding-bottom:6px; }
      /* ── Controle do mês (Modelo A: anéis em linha) ───────────────────── */
      .fin-envview-seg { display:flex; gap:4px; background:var(--surface-2); border-radius:999px;
        padding:3px; margin:0 2px 14px; }
      .fin-envview-opt { flex:1; border:none; background:none; color:var(--ink-soft);
        border-radius:999px; padding:7px 10px; font:inherit; font-size:.82rem; font-weight:650;
        cursor:pointer; min-height:34px; }
      .fin-envview-opt.on { background:var(--surface); color:var(--ink); box-shadow:var(--shadow); }
      .fin-envA-rings { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
      .fin-envA-cell { flex:1; min-width:104px; text-align:center; cursor:pointer;
        background:none; border:none; color:inherit; font:inherit; padding:8px 4px;
        border-radius:var(--radius-sm); }
      .fin-envA-cell.on { background:var(--accent-soft); }
      .fin-envA-ring { --p:0; --c:#5b8fd6; width:76px; height:76px; margin:0 auto 8px;
        border-radius:50%; position:relative; display:grid; place-items:center;
        background:conic-gradient(var(--c) calc(var(--p)*1%), var(--surface-2) 0); }
      .fin-envA-ring::after { content:''; position:absolute; inset:8px; border-radius:50%;
        background:var(--surface); }
      .fin-envA-cell.on .fin-envA-ring::after { background:var(--accent-soft); }
      .fin-envA-ring b { position:relative; z-index:1; font-size:.86rem; font-weight:800;
        font-variant-numeric:tabular-nums; }
      .fin-envA-name { display:block; font-size:.82rem; font-weight:650; }
      .fin-envA-vals { display:block; font-size:.72rem; color:var(--ink-soft);
        font-variant-numeric:tabular-nums; }
      .fin-envA-vals.neg { color:var(--negative); }
      .fin-envA-sub { margin-top:10px; padding-top:10px; border-top:1px solid var(--line); }
      .fin-envA-subhead { display:flex; align-items:center; gap:8px; font-weight:650;
        font-size:.9rem; margin-bottom:4px; }
      .fin-envA-pin { font-size:.58rem; font-weight:700; color:var(--primary);
        background:var(--accent-soft); border-radius:4px; padding:1px 5px; margin-left:5px;
        vertical-align:middle; text-transform:uppercase; letter-spacing:.03em; }
      .fin-env-fixedrow { display:flex; gap:8px; align-items:center; margin-top:8px; }
      .fin-env-fixedval { flex:1; text-align:left; background:var(--surface-2); border:1px solid var(--line);
        border-radius:var(--radius-sm); padding:9px 12px; font:inherit; font-weight:650;
        color:var(--ink); cursor:pointer; min-height:var(--tap); }
      .fin-env-unpin { border:1px solid var(--line); background:none; color:var(--ink-soft);
        border-radius:var(--radius-sm); padding:9px 12px; font:inherit; font-size:.82rem;
        cursor:pointer; min-height:var(--tap); }

      /* ── Tema "Cofre" (private banking noturno) — alternável no ◐ do
         cabeçalho; o padrão Sage/Creme segue intacto sem a classe.
         body:has() redeclara os tokens enquanto a tela está montada com o
         tema ligado (nav e toasts entram junto) e reverte ao navegar. ─── */
      body:has(.fin-noite) {
        --bg:#14120f; --surface:#1c1915; --surface-2:#272219;
        --ink:#eae3d3; --ink-soft:#9a9082; --line:#332d23;
        --primary:#c6a15b; --primary-ink:#181307; --sage:#c6a15b;
        --positive:#8fb996; --negative:#d08476;
        --accent-soft:#2d2617; --warn:#d9b05e; --warn-soft:#33290f;
        --shadow:0 1px 3px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.35);
      }
      body:has(.fin-noite) input:focus, body:has(.fin-noite) textarea:focus,
      body:has(.fin-noite) select:focus {
        border-color:var(--primary); box-shadow:0 0 0 3px rgba(198,161,91,.28);
      }
      /* assinatura: números tabulares de extrato + saldo em serif editorial */
      .fin-noite { font-variant-numeric:tabular-nums; }
      .fin-noite .fin-hero { background:linear-gradient(155deg, #221d14 0%, #1c1915 55%, #191510 100%);
        border-color:color-mix(in srgb, var(--primary) 32%, var(--line)); }
      .fin-noite .fin-hero-balance { font-family:ui-serif, 'New York', Georgia, serif;
        font-weight:600; letter-spacing:0; }
      .fin-noite .fin-hero-label, .fin-noite .section-title, .fin-noite .fin-collapse-title,
      .fin-noite .fin-sec-head .fin-sec-title, .fin-noite .fin-inc-extrahead {
        color:color-mix(in srgb, var(--primary) 55%, var(--ink-soft)); letter-spacing:.1em; }
      .fin-noite .fin-progress-bar { background:linear-gradient(90deg, #ab8746, #e2c68a); }

      /* ── Tema "Rosé" (claro, paleta Rosé Pine Dawn) — 3º do ciclo ◐.
         Papel rosado, texto ardósia-lilás, acentos íris/rosa/pinho.
         Sem serif: o saldo fica na fonte padrão (pedido da Gabriela). ──── */
      body:has(.fin-rose) {
        --bg:#faf4ed; --surface:#fffaf3; --surface-2:#f1eae2;
        --ink:#575279; --ink-soft:#797593; --line:#e2dcd4;
        --primary:#907aa9; --primary-ink:#fffaf3; --sage:#d7827e;
        --positive:#286983; --negative:#b4637a;
        --accent-soft:#ece4f0; --warn:#a4711f; --warn-soft:#f7e7c3;
        --shadow:0 1px 3px rgba(87,82,121,.08), 0 6px 20px rgba(87,82,121,.07);
      }
      body:has(.fin-rose) input:focus, body:has(.fin-rose) textarea:focus,
      body:has(.fin-rose) select:focus {
        border-color:var(--primary); box-shadow:0 0 0 3px rgba(144,122,169,.25);
      }
      .fin-rose .fin-hero { background:linear-gradient(150deg, #fffaf3 30%, #f7eef5 100%);
        border-color:color-mix(in srgb, var(--primary) 26%, var(--line)); }
      .fin-rose .fin-hero-label, .fin-rose .section-title, .fin-rose .fin-collapse-title,
      .fin-rose .fin-sec-head .fin-sec-title, .fin-rose .fin-inc-extrahead {
        color:color-mix(in srgb, var(--primary) 60%, var(--ink-soft)); }
      .fin-rose .fin-progress-bar { background:linear-gradient(90deg, #907aa9, #d7827e); }
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

  // Tema da tela (persistido por aparelho), ciclado no ◐ do cabeçalho:
  // '' = Sage (claro, padrão) | 'noite' = Cofre (noturno) | 'rose' = Rosé (claro).
  const FIN_THEME_KEY = 'bisa_fin_theme';
  const FIN_THEMES = [
    { id: '', name: 'Sage (claro)' },
    { id: 'noite', name: 'Cofre (noturno)' },
    { id: 'rose', name: 'Rosé (claro)' },
  ];
  const finTheme = () => { try { return localStorage.getItem(FIN_THEME_KEY) || ''; } catch { return ''; } };
  const setFinTheme = (v) => { try { localStorage.setItem(FIN_THEME_KEY, v); } catch {} };

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
      // Engole só o click-fantasma DESTE toque (mesmas coordenadas ±12px);
      // um toque real em outro controle logo depois passa normalmente.
      const { clientX: x, clientY: y } = ev;
      const swallow = (e) => {
        if (Math.abs(e.clientX - x) > 12 || Math.abs(e.clientY - y) > 12) return;
        e.stopPropagation(); e.preventDefault();
        document.removeEventListener('click', swallow, { capture: true });
      };
      document.addEventListener('click', swallow, { capture: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 700);
      fn(ev);
    });
    btn.style.touchAction = 'manipulation';
  };

  // Exclusão em 2 toques (sem confirm() nativo — melhor no iPad): o 1º toque
  // arma o botão por 3s com o texto de confirmação; o 2º executa onConfirm.
  // tap=true registra via onTap (p/ editores com teclado nativo aberto).
  const armDelete = (btn, onConfirm, { label = '✕', armedLabel = 'Excluir?', tap = false } = {}) => {
    let armed = false, timer = null;
    const handler = () => {
      if (!armed) {
        armed = true; btn.classList.add('confirm'); btn.textContent = armedLabel;
        timer = setTimeout(() => { armed = false; btn.classList.remove('confirm'); btn.textContent = label; }, 3000);
        return;
      }
      clearTimeout(timer);
      onConfirm();
    };
    if (tap) onTap(btn, handler); else btn.onclick = handler;
  };

  // "1.234,56" → 1234.56 (aceita vírgula ou ponto decimal; ignora ruído).
  const parseDec = (s) => {
    const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // Sanitiza um input de valor pt-BR ao digitar: só dígitos e uma vírgula.
  const decimalInput = (inp, onInput) => {
    inp.oninput = () => {
      let v = inp.value.replace(/[^0-9,]/g, '');
      const i = v.indexOf(',');
      if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '');
      inp.value = v;
      if (onInput) onInput();
    };
  };

  // Campo numérico pt-BR (label + input decimal) anexado a um modal de editor.
  const numField = (modal, labelText, val, ph, onInput) => {
    const f = elt('div', 'fin-item-field');
    f.appendChild(elt('label', 'fin-item-flabel', labelText));
    const inp = elt('input', 'fin-item-inp');
    inp.type = 'text'; inp.inputMode = 'decimal'; inp.placeholder = ph || '';
    if (val != null) inp.value = String(val).replace('.', ',');
    decimalInput(inp, onInput);
    f.appendChild(inp); modal.appendChild(f);
    return inp;
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
  // Baldes ocultos do plano (não usados pela família). Mantidos no array BUCKETS
  // por causa de índices posicionais (cores), mas filtrados na exibição/edição.
  const HIDDEN_BUCKETS = new Set(['conforto', 'conhecimento']);
  const ACTIVE_BUCKETS = BUCKETS.filter((b) => !HIDDEN_BUCKETS.has(b.id));

  window.BISA.screens['finance'] = {
    _el: null,
    _month: thisMonth(),
    _sheetOpen: false,
    _incomeCollapsed: false, // seção "Renda" recolhida?
    _expandedCats: new Set(), // categorias de despesa com os lançamentos abertos
    _envView: 'used', // visualização do Controle do mês: 'used' (gasto) | 'free' (disponível)
    _allocEdit: false, // editor de % das metas (envelopes) aberto?
    _expandedBuckets: new Set(), // envelopes com os lançamentos abertos
    _billSort: 'unpaid', // ordenação do quadro de contas: unpaid|due|amount|bucket
    _manageMode: false, // tela "Gerenciar custos" aberta?
    _dashMode: false, // board "Dashboards" aberto? (screens/finance-dash.js)
    _agentLog: [], // histórico do chat do agente ({kind:'u'|'a', content, isMd})

    mount(el) {
      this._el = el;
      this._month = thisMonth();
      this._render();
    },

    unmount() {
      this._closeAmountSheet();
      this._closeSortMenu();
      this._closeItemEditor();
      this._el = null;
    },

    // Lançar por voz: fala → POST /finance/voz (Haiku extrai valor/categoria/
    // envelope AUVP) → resumo na tela → confirmar → POST /finance/tx (contrato
    // existente). O ditado reusa o motor BISO_DITADO (Whisper local).
    _openVoiceTx() {
      if (document.querySelector('.fin-voz-ov')) return;
      const ov = elt('div', 'fin-voz-ov');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;';
      const card = elt('div', 'card');
      card.style.cssText = 'width:min(92vw,480px);padding:16px;display:flex;flex-direction:column;gap:10px;';
      card.innerHTML = `
        <div class="section-title" style="margin:0">🎤 Lançar por voz</div>
        <div class="fin-voz-box" contenteditable="true"
          style="min-height:76px;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:1rem;"></div>
        <div class="fin-voz-sum muted" style="font-size:.9rem;min-height:1.2em;">Ex.: “mercado sessenta e dois reais” · “recebi 300 do freela”</div>
        <div style="display:flex;gap:8px;">
          <button class="btn ghost fin-voz-cancel" style="flex:1;min-height:46px;">Cancelar</button>
          <button class="btn ghost fin-voz-mic" style="flex:1;min-height:46px;">🎤 Ditar</button>
          <button class="btn fin-voz-go" style="flex:1.4;min-height:46px;">Analisar</button>
        </div>`;
      ov.appendChild(card);
      document.body.appendChild(ov);
      const box = card.querySelector('.fin-voz-box'), sum = card.querySelector('.fin-voz-sum');
      const go = card.querySelector('.fin-voz-go'), micB = card.querySelector('.fin-voz-mic');
      let parsed = null;
      const close = () => {
        if (window.BISO_DITADO && window.BISO_DITADO.activeBtn() === micB) window.BISO_DITADO.stopAll();
        ov.remove();
      };
      ov.onclick = (e) => { if (e.target === ov) close(); };
      card.querySelector('.fin-voz-cancel').onclick = close;
      if (window.BISO_DITADO) window.BISO_DITADO.bind(micB, () => box);
      else micB.style.display = 'none';
      box.addEventListener('input', () => { parsed = null; go.textContent = 'Analisar'; });
      go.onclick = async () => {
        const texto = box.innerText.trim();
        if (!texto) { box.focus(); return; }
        if (!parsed) {                       // passo 1: parse + resumo
          go.disabled = true; go.textContent = '…';
          try {
            const r = await BISA.api('/finance/voz', { method: 'POST', json: { texto } });
            parsed = r.parsed;
            sum.textContent = '→ ' + [
              'R$ ' + Number(parsed.amount).toFixed(2).replace('.', ','),
              parsed.kind === 'income' ? 'receita' : (parsed.bucket || 'gasto'),
              parsed.category, parsed.desc, parsed.date,
              parsed.pending ? 'provisionado' : '',
            ].filter(Boolean).join(' · ');
            go.textContent = '✓ Confirmar';
          } catch (e) { sum.textContent = '⚠ ' + e.message; go.textContent = 'Analisar'; }
          go.disabled = false;
          return;
        }
        go.disabled = true;                  // passo 2: cria a transação
        try {
          await BISA.api('/finance/tx', { method: 'POST', json: parsed });
          BISA.toast('Lançado ' + sum.textContent.slice(2));
          close(); this._render(true);
        } catch (e) { sum.textContent = '⚠ ' + e.message; go.disabled = false; }
      };
    },

    // Agente de finanças (veio da tela Ziggy): chat com acesso real aos dados
    // (leitura sempre; escrita sandboxada + confirmação em conversa no lado
    // servidor, via POST /ziggy/finagent). O histórico fica em _agentLog p/
    // sobreviver a fechar/reabrir o painel — o fluxo propõe → confirma é
    // multi-turno e o usuário pode querer conferir a tela no meio.
    _openAgentChat() {
      if (document.querySelector('.fin-agent-overlay')) return;
      const ov = elt('div', 'fin-agent-overlay');
      const card = elt('div', 'fin-agent-modal');
      card.innerHTML = `
        <div class="section-title" style="margin:0">🤖 Agente de finanças</div>
        <div class="fin-agent-hint">Ele lê profile.json e transactions.jsonl de verdade. Alterações: ele propõe → você confirma na conversa → ele edita (só na pasta do finance).</div>
        <div class="fin-agent-log"></div>
        <textarea class="fin-agent-ta" placeholder="pergunte ou peça ajustes… (ex: quanto sobrou no envelope do mercado? / aumenta a meta da luz pra 800)"></textarea>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn ghost fin-agent-close" style="min-height:46px;">Fechar</button>
          <span class="fin-agent-st" style="flex:1;text-align:right;"></span>
          <button class="btn fin-agent-go" style="min-height:46px;">Enviar</button>
        </div>`;
      ov.appendChild(card);
      document.body.appendChild(ov);
      const log = card.querySelector('.fin-agent-log');
      const ta = card.querySelector('.fin-agent-ta');
      const go = card.querySelector('.fin-agent-go');
      const st = card.querySelector('.fin-agent-st');
      const bubble = (kind, content, isMd) => {
        const b = elt('div', 'fin-agent-m ' + kind);
        if (isMd) b.innerHTML = BISA.renderMarkdown(content); else b.textContent = content;
        log.appendChild(b);
        b.scrollIntoView({ block: 'nearest' });
        return b;
      };
      for (const m of this._agentLog) bubble(m.kind, m.content, m.isMd);
      const close = () => ov.remove();
      ov.onclick = (e) => { if (e.target === ov) close(); };
      card.querySelector('.fin-agent-close').onclick = close;
      const send = async () => {
        const q = ta.value.trim();
        if (!q || go.disabled) return;
        ta.value = '';
        this._agentLog.push({ kind: 'u', content: q, isMd: false });
        bubble('u', q, false);
        go.disabled = true; st.textContent = 'consultando os dados… (~30-90s)';
        try {
          const d = await BISA.api('/ziggy/finagent', { method: 'POST', json: { text: q } });
          this._agentLog.push({ kind: 'a', content: d.answer || '', isMd: true });
          bubble('a', d.answer || '', true);
          st.textContent = '';
          this._render(true); // o agente pode ter editado os dados por baixo
        } catch (e) { st.textContent = 'falhou: ' + e.message; }
        go.disabled = false;
      };
      go.onclick = send;
      ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); });
    },

    // preserveScroll=true mantém a posição de scroll (re-render após editar/pagar/
    // excluir, que ficam na mesma vista). Navegação de mês reseta ao topo.
    _render(preserveScroll) {
      const el = this._el;
      if (!el) return;
      const scroller = el.parentNode; // #screen (overflow-y:auto)
      const savedTop = preserveScroll && scroller ? scroller.scrollTop : 0;
      el.innerHTML = '';
      el.classList.toggle('fin-noite', finTheme() === 'noite');
      el.classList.toggle('fin-rose', finTheme() === 'rose');

      // Modo "Dashboards" — board próprio (screens/finance-dash.js).
      if (this._dashMode && window.FIN_DASH) {
        window.FIN_DASH.render(el, {
          month: this._month,
          dark: finTheme() === 'noite',
          onExit: () => { this._dashMode = false; this._render(); },
        });
        return;
      }

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
      const themeBtn = elt('button', 'fin-month-btn', '◐');
      themeBtn.setAttribute('aria-label', 'Tema da tela');
      themeBtn.onclick = () => {
        const ids = FIN_THEMES.map((t) => t.id);
        const next = ids[(ids.indexOf(finTheme()) + 1) % ids.length];
        setFinTheme(next); this._render(true);
        BISA.toast('Tema: ' + FIN_THEMES.find((t) => t.id === next).name);
      };
      const vozBtn = elt('button', 'fin-month-btn', '🎤');
      vozBtn.setAttribute('aria-label', 'Lançar por voz');
      vozBtn.onclick = () => this._openVoiceTx();
      const dashBtn = elt('button', 'fin-month-btn', '📊');
      dashBtn.setAttribute('aria-label', 'Dashboards');
      dashBtn.onclick = () => { this._dashMode = true; this._render(); };
      const agentBtn = elt('button', 'fin-month-btn', '🤖');
      agentBtn.setAttribute('aria-label', 'Agente de finanças');
      agentBtn.onclick = () => this._openAgentChat();
      monthNav.append(prevBtn, mlabel, nextBtn, dashBtn, agentBtn, vozBtn, themeBtn);
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
      const provWrap = elt('div');
      const prazerWrap = elt('div');
      const investCard = elt('div'); // escondido até haver posições
      colMain.append(heroWrap, incomeWrap, billsWrap, provWrap, prazerWrap, investCard);

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
        this._fillProvisions(provWrap, profileResp, summary);
        this._fillProvisions(prazerWrap, profileResp, summary, 'prazeres', 'Prazeres do mês');
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
      // pendentes ficam fora: o backend já os exclui de income/expense, então os
      // ajustes de liberdade abaixo também só contam o que foi efetivado.
      const libAporte = r2(manual
        .filter((t) => t.kind === 'expense' && t.bucket === 'liberdade' && !t.pending)
        .reduce((s, t) => s + t.amount, 0));
      const libIncome = r2(manual
        .filter((t) => t.kind === 'income' && t.category && t.category.endsWith('-lib') && !t.pending)
        .reduce((s, t) => s + t.amount, 0));
      const receitas = r2(income - libIncome);
      const gastos = r2(expense - libAporte);
      const saldo = r2(receitas - gastos); // o que sobra para viver (só o que já entrou — caixa)
      // renda lançada mas ainda não paga — fora do saldo até ser confirmada.
      // Como nas receitas, a renda de liberdade (-lib) fica de fora: ela não
      // entra no caixa em R$ nem quando efetivada.
      const pendente = r2(manual
        .filter((t) => t.kind === 'income' && t.pending && !(t.category && t.category.endsWith('-lib')))
        .reduce((s, t) => s + t.amount, 0));

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
      if (pendente > 0) subs.append(mkSub('pend', 'A receber', brl(pendente)));
      if (libAporte > 0) subs.append(mkSub('', 'Investido', brl(libAporte), BUCKETS[2].color));
      hero.appendChild(subs);
      wrap.appendChild(hero);

      if (income + expense === 0) {
        const hint = elt('p', 'muted');
        hint.style.cssText = 'text-align:center;margin:4px 0 8px;font-size:.9rem';
        hint.textContent = 'Sem movimento neste mês. Use o controle e os lançamentos ao lado.';
        wrap.appendChild(hint);
      }
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
        amtEl.style.color = tx.pending ? 'var(--warn)' : (isExpense ? 'var(--negative)' : 'var(--positive)');
        amtEl.textContent = (isExpense ? '−' : '+') + brl(tx.amount);

        const delBtn = elt('button', 'fin-tx-del', '✕');
        delBtn.title = 'Apagar lançamento';
        armDelete(delBtn, async () => {
          try {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}&creditGoal=1`, { method: 'DELETE' });
            BISA.toast('Lançamento apagado');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao apagar'); }
        }, { armedLabel: 'Apagar?' });

        row.append(
          elt('span', 'fin-tx-date', fmtDate(tx.date)),
          elt('span', 'fin-tx-desc', tx.desc || '—'),
          elt('span', 'fin-tx-cat', tx.category || 'outro'),
        );
        if (tx.pending) row.appendChild(elt('span', 'fin-inc-sub pend', tx.kind === 'expense' ? 'provisionado' : 'a receber'));
        row.append(amtEl, delBtn);
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
      expBtn.onclick = () => { state.kind = 'expense'; expBtn.classList.add('on'); incBtn.classList.remove('on'); syncInvVis(); };
      incBtn.onclick = () => { state.kind = 'income'; incBtn.classList.add('on'); expBtn.classList.remove('on'); syncInvVis(); };
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

      // — Campo US$ SEMPRE visível (gasto ou receita): converte pela cotação
      // de planejamento (fx.BRLperUSD) e preenche o valor em R$ (o ledger é
      // BRL); o US$ digitado vira anotação na descrição ao salvar. —
      // "profile" (const do bloco de chips) ainda não existe aqui — cópia local
      const prof = profileResp && profileResp.profile;
      const fxRate = (prof && prof.fx && Number(prof.fx.BRLperUSD)) || 0;
      const usdRow = elt('div');
      usdRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:10px';
      const usdInput = elt('input');
      usdInput.type = 'text'; usdInput.inputMode = 'decimal';
      usdInput.placeholder = 'US$ (opcional)'; usdInput.style.width = '140px';
      const usdHint = elt('span', 'muted', '');
      usdHint.style.fontSize = '.78rem';
      usdInput.oninput = () => {
        const u = parseFloat(usdInput.value.replace(',', '.')) || 0;
        if (u > 0 && fxRate) {
          state.amount = Math.round(u * fxRate * 100) / 100; syncAmt();
          usdHint.textContent = `= ${brl(state.amount)} (cotação ${fxRate.toFixed(2)})`;
        } else usdHint.textContent = '';
      };
      usdRow.append(usdInput, usdHint);
      if (fxRate) card.appendChild(usdRow);   // sem cotação no perfil, sem campo

      // — Receita p/ investimento: esconde a convenção "-lib" do usuário —
      // Toggle único que (1) sufixa a categoria com -lib (fora da renda dos
      // envelopes) e (2) cria o aporte vinculado ao objetivo (creditGoal no
      // servidor converte p/ a moeda dele).
      const inv = { on: false, goalId: null };
      const invWrap = elt('div');
      invWrap.style.marginTop = '10px';
      const invToggle = elt('button', 'fin-chip', '🪙 Vai para investimento');
      const invSub = elt('div', 'muted', 'fora da renda do mês · cria o aporte junto');
      invSub.style.cssText = 'font-size:.72rem;margin:4px 2px 0';
      const invBody = elt('div');
      invBody.style.cssText = 'display:none;margin-top:8px';
      const goalLbl = elt('div', 'muted', 'Creditar no objetivo:');
      goalLbl.style.cssText = 'font-size:.78rem;margin:10px 0 4px';
      const goalRow = elt('div', 'fin-chips');
      const goals = ((prof && prof.objectives) || []).filter((o) => (o.current || 0) < (o.target || Infinity));
      goals.forEach((o, i) => {
        const c = elt('button', 'fin-chip', o.label || o.id);
        if (i === 0) { c.classList.add('on'); inv.goalId = o.id; }
        c.onclick = () => {
          inv.goalId = o.id;
          goalRow.querySelectorAll('.fin-chip').forEach((x) => x.classList.remove('on'));
          c.classList.add('on');
        };
        goalRow.appendChild(c);
      });
      invBody.append(goalLbl, goalRow);
      invToggle.onclick = () => {
        inv.on = !inv.on;
        invToggle.classList.toggle('on', inv.on);
        invBody.style.display = inv.on ? '' : 'none';
      };
      invWrap.append(invToggle, invSub, invBody);
      const syncInvVis = () => { invWrap.style.display = state.kind === 'income' ? '' : 'none'; };
      card.appendChild(invWrap);
      syncInvVis();

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
        const investing = state.kind === 'income' && inv.on;
        const rawCat = catInput.value.trim() || (investing ? 'freelance' : 'outro');
        // a convenção -lib (renda fora dos envelopes) é aplicada AQUI — o
        // usuário nunca digita o sufixo (pedido 2026-07-16)
        const category = investing && !rawCat.endsWith('-lib') ? rawCat + '-lib' : rawCat;
        let desc = descInput.value.trim() || 'sem descrição';
        // valor veio em dólar → anota o US$ na descrição (rastreabilidade)
        const usdVal = parseFloat((usdInput.value || '').replace(',', '.')) || 0;
        if (usdVal > 0 && !/us\$/i.test(desc)) desc += ` (US$ ${usdVal})`;
        const date = dateInput.value || todayISO();
        btn.disabled = true; btn.textContent = 'Salvando…';
        try {
          await BISA.api('/finance/tx', {
            method: 'POST',
            json: { kind: state.kind, amount, desc, category, date },
          });
          if (investing) {
            // aporte irmão: bucket liberdade + creditGoal (o servidor credita o
            // objetivo convertendo p/ a moeda dele)
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: { kind: 'expense', amount, desc: `Aporte liberdade — ${desc}`,
                category, bucket: 'liberdade', goalId: inv.goalId || undefined, date, creditGoal: true },
            });
          }
          saveLast({ kind: state.kind, category: rawCat });
          BISA.toast(investing ? 'Receita + aporte lançados!' : 'Lançamento salvo!');
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

    // Lista de lançamentos de uma despesa (categoria) no mês exibido, com editar
    // (abre o teclado p/ novo valor) e excluir (2 toques). Usa this._summary.
    _renderTxSublist(line, b, plan = 0, done = 0) {
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const txs = manual.filter((t) => t.kind === 'expense' && t.category === b.category)
        .sort((a, c) => (a.date < c.date ? 1 : -1));

      const sub = elt('div', 'fin-bud-sublist');

      // Cabeçalho espelhando o estado do anel: sem meta = "livre" neutro; com
      // meta = orçado/restam/estourou. Coerência com _provRow (pedido 2026-07-16).
      const noPlan = !(plan > 0);
      const over = !noPlan && done > plan + 0.005;
      const head = elt('div', 'fin-bud-subhead' + (over ? ' neg' : noPlan ? ' free' : ''));
      head.textContent = noPlan
        ? `${brl(done)} · livre (sem meta)`
        : over
          ? `${brl(done)} de ${brl(plan)} · estourou ${brl(done - plan)}`
          : `${brl(done)} de ${brl(plan)} · restam ${brl(plan - done)}`;
      sub.appendChild(head);
      // Sem meta: atalho pra definir uma (leva ao gerenciador de orçamento).
      if (noPlan) {
        const set = elt('button', 'fin-bud-setmeta', '＋ definir meta');
        set.onclick = () => { this._manageMode = true; this._render(true); };
        head.appendChild(set);
      }

      if (txs.length === 0) {
        sub.appendChild(elt('div', 'fin-bud-subempty', 'Nenhum lançamento ainda neste mês.'));
        line.appendChild(sub);
        return;
      }

      txs.forEach((tx) => {
        const srow = elt('div', 'fin-bud-subrow');
        const act = elt('span', 'fin-bud-subact');

        const edit = elt('button', 'fin-bud-subbtn', '✎');
        edit.title = 'Editar lançamento';
        edit.onclick = () => this._openAmountSheet({
          title: b.label || b.category || 'Valor',
          initial: tx.amount,
          withDesc: true, descFocus: false,
          descInitial: tx.desc || '',
          descPlaceholder: 'Observação (opcional)',
          confirmLabel: 'Salvar',
          onConfirm: (amount, note) => this._editTx(tx, amount, note),
        });

        const del = elt('button', 'fin-bud-subbtn del', '✕');
        del.title = 'Excluir lançamento';
        armDelete(del, async () => {
          try {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}&creditGoal=1`, { method: 'DELETE' });
            BISA.toast('Lançamento excluído');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        });

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

    // Edita um lançamento in-place (PATCH — 1 request, sem risco de sumir com
    // o dado no meio de um apaga-e-recria).
    async _editTx(tx, amount, note) {
      try {
        await BISA.api('/finance/tx', {
          method: 'PATCH',
          json: { id: tx.id, amount, desc: note != null ? note : tx.desc, pending: !!tx.pending },
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
      // receitas "a receber" por categoria (fontes fixas mostram o estado pendente)
      const pendMap = {};
      manual.filter((t) => t.kind === 'income' && t.pending)
        .forEach((t) => { pendMap[t.category] = t; });
      const extras = manual
        .filter((t) => t.kind === 'income' && !fixedCats.has(t.category) && !salaryLibCats.has(t.category))
        .sort((a, c) => (a.date < c.date ? 1 : -1));
      const receivedTotal = (summary && summary.cash && summary.cash.income) || 0;
      const pendingTotal = (summary && summary.cash && summary.cash.pendingIncome) || 0;
      const collapsed = this._incomeCollapsed;

      // Cabeçalho clicável: alterna recolhido/expandido. Só o total recebido —
      // sem "/ planejado", já que não há previsão de renda.
      const head = elt('div', 'fin-collapse-head');
      head.append(
        elt('span', 'fin-collapse-caret', collapsed ? '▸' : '▾'),
        elt('span', 'fin-collapse-title', 'Renda'),
      );
      const tot = elt('span', 'fin-collapse-vals');
      tot.innerHTML = `<strong class="fin-value-pos">${brl(receivedTotal)}</strong> <span class="muted">recebido</span>`
        + (pendingTotal > 0 ? ` · <strong>${brl(pendingTotal)}</strong> <span class="muted">a receber</span>` : '');
      head.appendChild(tot);
      head.onclick = () => { this._incomeCollapsed = !this._incomeCollapsed; this._render(true); };
      wrap.appendChild(head);
      if (collapsed) return;

      const card = elt('div', 'card');
      fixed.forEach((b) => {
        if (b.salaryUSD) this._incomeSalaryRow(card, b, fx, summary);
        else this._incomeFixedRow(card, b, Number(doneMap[b.category] || 0), this._planBRL(b, fx), pendMap[b.category]);
      });

      if (extras.length) {
        card.appendChild(elt('div', 'fin-inc-extrahead', 'Extras do mês'));
        extras.forEach((tx) => this._incomeExtraRow(card, tx));
      }

      const add = elt('button', 'fin-inc-add', '＋ Adicionar receita');
      add.onclick = () => this._openExtraIncome();
      card.appendChild(add);

      // Trazer da conta em dólar (resgate p/ cobrir um custo imprevisto). Só
      // aparece quando há uma reserva em US$ de onde tirar.
      if ((this._objectives || []).some((o) => o.currency === 'USD')) {
        const res = elt('button', 'fin-inc-add', '＋ Trazer do dólar');
        res.onclick = () => this._openResgateDolar();
        card.appendChild(res);
      }
      wrap.appendChild(card);
    },

    // Fonte fixa de renda (todo mês): tocar registra/corrige o valor recebido.
    // `plan` (o valor típico do orçamento) só alimenta o atalho "Usar" no teclado;
    // não é mostrado como previsão. Fontes em dólar (b.amountUSD) mostram o valor
    // em US$ (editável) e, ao registrar o R$ recebido, a cotação implícita.
    // `pendTx` = lançamento "a receber" da categoria (valor lançado, não pago).
    _incomeFixedRow(parent, b, done, plan, pendTx) {
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
      } else if (pendTx) {
        // Valor lançado, ainda não pago: mostra "a receber" + confirmação de entrada.
        const top = elt('span', 'fin-inc-topline');
        top.append(
          elt('span', 'fin-inc-sub pend', 'a receber'),
          elt('strong', 'fin-inc-amt', brl(pendTx.amount)),
        );
        const edit = elt('button', 'fin-bud-pay ghost', '✎');
        edit.title = 'Corrigir valor a receber';
        edit.onclick = () => this._openReceive(b, pendTx.amount, plan, usd, true);
        top.appendChild(edit);
        right.appendChild(top);
        const got = elt('button', 'fin-bud-pay', 'Entrou');
        got.title = 'Confirmar que o valor caiu na conta';
        got.onclick = () => this._confirmReceived(pendTx);
        right.appendChild(got);
      } else {
        const reg = elt('button', 'fin-bud-pay', 'Registrar');
        reg.title = 'Registrar o valor que entrou';
        reg.onclick = () => this._openReceive(b, null, plan, usd);
        right.appendChild(reg);
      }
      row.appendChild(right);
      parent.appendChild(row);
    },

    // Confirma que uma receita "a receber" caiu na conta: remove o flag e data
    // de hoje (o dia em que o dinheiro entrou de fato no caixa).
    async _confirmReceived(tx) {
      try {
        await BISA.api('/finance/tx', {
          method: 'PATCH',
          json: { id: tx.id, pending: false, date: todayISO() },
        });
        BISA.toast('Recebido!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao confirmar'); }
    },

    // Sheet para registrar/corrigir o R$ recebido de uma fonte fixa. Quando a
    // fonte é em dólar (usd), o sheet mostra a cotação implícita ao vivo.
    // pendingInitial pré-seleciona "A receber" (corrigir um valor ainda não pago).
    _openReceive(b, initial, plan, usd, pendingInitial) {
      this._openAmountSheet({
        title: b.label || b.category || 'Valor',
        initial, plan, rateBase: usd || 0,
        allowZero: initial != null,
        statusToggle: true, pendingInitial,
        confirmLabel: initial != null ? 'Corrigir valor' : 'Salvar receita',
        onConfirm: (amount, _desc, _goal, pending) => this._setRealized(b, amount, usd, pending),
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
      const manual = (summary && summary.cash && summary.cash.manual) || [];
      const pendTx = manual.find((t) => t.kind === 'income' && t.pending && t.category === b.category);
      const pendLib = manual.find((t) => t.kind === 'income' && t.pending && t.category === libCat);

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
      } else if (pendTx) {
        const top = elt('span', 'fin-inc-topline');
        top.append(elt('span', 'fin-inc-sub pend', 'a receber'), elt('strong', 'fin-inc-amt', brl(pendTx.amount)));
        const e = elt('button', 'fin-bud-pay ghost', '✎');
        e.title = 'Corrigir valor a receber'; e.onclick = () => this._openReceive(b, pendTx.amount, transferUSD * std, transferUSD, true);
        top.appendChild(e);
        tr.appendChild(top);
        const got = elt('button', 'fin-bud-pay', 'Entrou');
        got.title = 'Confirmar que o R$ caiu na conta'; got.onclick = () => this._confirmReceived(pendTx);
        tr.appendChild(got);
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
        top.append(elt('span', 'fin-inc-sub', 'investido'), elt('strong', 'fin-inc-amt fin-value-pos', brl(doneLib)));
        const un = elt('button', 'fin-bud-pay ghost', '✕');
        un.title = 'Desfazer investimento'; un.onclick = () => this._undoLiberdade(b);
        top.appendChild(un);
        lr.appendChild(top);
      } else if (pendLib) {
        // Aporte provisionado: reservado, aguardando o dinheiro entrar.
        const top = elt('span', 'fin-inc-topline');
        top.append(elt('span', 'fin-inc-sub pend', 'provisionado'), elt('strong', 'fin-inc-amt', brl(pendLib.amount)));
        const un = elt('button', 'fin-bud-pay ghost', '✕');
        un.title = 'Desfazer provisão'; un.onclick = () => this._undoLiberdade(b);
        top.appendChild(un);
        lr.appendChild(top);
        const got = elt('button', 'fin-bud-pay', 'Entrou');
        got.title = 'Confirmar: o dinheiro entrou e o aporte foi feito';
        got.onclick = () => this._confirmLiberdade(b);
        lr.appendChild(got);
      } else {
        // Se a transferência ainda está "a receber", a provisão é o default.
        const dest = elt('button', 'fin-bud-pay', 'Investir');
        dest.onclick = () => this._destinarLiberdade(b, libBRL, !!pendTx);
        lr.appendChild(dest);
      }
      l.appendChild(lr); wrap.appendChild(l);

      parent.appendChild(wrap);
    },

    // Atalho: lança o valor retido em dólar como RENDA (renda do mês completa) e
    // como APORTE no envelope Liberdade financeira (aparece no controle do mês).
    // Com "Provisionado", os dois lançamentos nascem pendentes: o aporte já fica
    // reservado, mas só conta (caixa, envelope, objetivo) quando o dinheiro entrar.
    _destinarLiberdade(b, defaultBRL, pendingDefault) {
      const libCat = `${b.category}-lib`;
      const objs = (this._objectives || []).filter((o) => o.bucket === 'liberdade');
      this._openAmountSheet({
        title: `Liberdade · ${b.label || ''}`,
        initial: defaultBRL > 0 ? defaultBRL : null, plan: defaultBRL,
        goalChips: objs.map((o) => ({ id: o.id, label: o.label })),
        statusToggle: true, pendingInitial: pendingDefault,
        statusLabels: ['Entrou', 'Provisionar'],
        confirmLabel: 'Investir',
        onConfirm: async (amount, _desc, goalId, pending) => {
          const flag = pending ? { pending: true } : {};
          try {
            await BISA.api('/finance/tx', { method: 'POST', json: { kind: 'income', amount, desc: `${b.label} — liberdade (US$ retido)`, category: libCat, date: todayISO(), ...flag } });
            // creditGoal: o servidor credita o objetivo junto com o aporte (1 request)
            await BISA.api('/finance/tx', { method: 'POST', json: { kind: 'expense', amount, desc: `Aporte liberdade — ${b.label}`, category: libCat, bucket: 'liberdade', goalId: goalId || undefined, date: todayISO(), creditGoal: true, ...flag } });
            BISA.toast(pending ? 'Provisionado — confirme quando entrar' : 'Investido!'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao destinar'); }
        },
      });
    },

    // Efetiva uma destinação provisionada: remove o flag pending (datando de
    // hoje); o servidor credita o objetivo vinculado no mesmo request (creditGoal).
    async _confirmLiberdade(b) {
      const libCat = `${b.category}-lib`;
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const matches = manual.filter((t) => t.category === libCat && t.pending);
      try {
        for (const t of matches) {
          await BISA.api('/finance/tx', {
            method: 'PATCH',
            json: { id: t.id, pending: false, date: todayISO(), creditGoal: true },
          });
        }
        BISA.toast('Investimento efetivado!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao confirmar'); }
    },

    // Desfaz a destinação: remove renda + aporte do mês; creditGoal=1 faz o
    // servidor descontar do objetivo o aporte efetivado que está sendo removido.
    async _undoLiberdade(b) {
      const libCat = `${b.category}-lib`;
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const matches = manual.filter((t) => t.category === libCat);
      try {
        for (const t of matches) {
          await BISA.api(`/finance/tx?id=${encodeURIComponent(t.id)}&creditGoal=1`, { method: 'DELETE' });
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

      const salInp = numField(modal, 'Salário completo (US$)', b.salaryUSD, 'Ex: 5000');
      const transfInp = numField(modal, 'Transfere para reais (US$)', b.amountUSD, 'Ex: 1500');
      const rateInp = numField(modal, 'Cotação padrão (R$/US$)', (this._stdRate || ''), 'Ex: 5,00');

      const actions = elt('div', 'fin-item-actions');
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar'); onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', 'Salvar');
      onTap(save, async () => {
        const salaryUSD = parseDec(salInp.value);
        const amountUSD = parseDec(transfInp.value);
        const rate = parseDec(rateInp.value);
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

      // Pendente: confirmar em 1 toque que o valor entrou na conta.
      if (tx.pending) {
        const got = elt('button', 'fin-bud-subbtn', '✓');
        got.title = 'Confirmar que entrou na conta';
        got.onclick = () => this._confirmReceived(tx);
        act.appendChild(got);
      }

      const edit = elt('button', 'fin-bud-subbtn', '✎');
      edit.title = 'Editar';
      edit.onclick = () => this._openAmountSheet({
        title: tx.desc || 'Receita extra', initial: tx.amount,
        withDesc: true, descInitial: tx.desc,
        statusToggle: true, pendingInitial: tx.pending,
        confirmLabel: 'Salvar',
        onConfirm: (amount, desc, _goal, pending) => this._editTx({ ...tx, desc: desc || tx.desc, pending }, amount),
      });

      const del = elt('button', 'fin-bud-subbtn del', '✕');
      del.title = 'Excluir';
      armDelete(del, async () => {
        try {
          await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}`, { method: 'DELETE' });
          BISA.toast('Receita excluída');
          this._render(true);
        } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
      });

      act.append(edit, del);
      srow.append(elt('span', 'fin-bud-subdate', fmtDate(tx.date)), elt('span', 'fin-bud-subdesc', tx.desc || '—'));
      if (tx.pending) srow.appendChild(elt('span', 'fin-inc-sub pend', 'a receber'));
      srow.append(
        elt('strong', 'fin-bud-subamt' + (tx.pending ? '' : ' fin-value-pos'), brl(tx.amount)),
        act,
      );
      parent.appendChild(srow);
    },

    // Adicionar uma receita extra (bônus, freela, venda...): descrição + valor +
    // status (Entrou = já no caixa; A receber = lançada, fora do saldo até confirmar).
    _openExtraIncome() {
      this._openAmountSheet({
        title: 'Nova receita', initial: null, withDesc: true,
        descPlaceholder: 'Descrição (ex: Bônus, Freela)',
        descChips: ['Bônus', 'Freela', 'Venda', '13º', 'Reembolso'],
        statusToggle: true,
        confirmLabel: 'Salvar receita',
        onConfirm: async (amount, desc, _goal, pending) => {
          try {
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: { kind: 'income', amount, desc: desc || 'Receita extra', category: 'extra', date: todayISO(),
                ...(pending ? { pending: true } : {}) },
            });
            BISA.toast(pending ? 'Receita lançada — a receber' : 'Receita adicionada!');
            this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
        },
      });
    },

    // Trazer dinheiro da conta em dólar para reais (ex.: cobrir um custo
    // imprevisto sem mexer no orçamento do mês). Registra o R$ que entrou como
    // receita do mês e desconta o valor em US$ do objetivo-fonte (a reserva em
    // dólar). A cotação do resgate é editável — costuma diferir da padrão.
    _openResgateDolar() {
      this._closeItemEditor();
      const usdObjs = (this._objectives || []).filter((o) => o.currency === 'USD');
      let sourceId = usdObjs.length ? usdObjs[0].id : null;
      const std = this._stdRate || 0;
      const source = () => usdObjs.find((o) => o.id === sourceId) || null;

      const overlay = elt('div', 'fin-amount-overlay');
      const modal = elt('div', 'fin-item-modal');
      overlay.appendChild(modal);
      modal.appendChild(elt('div', 'fin-amount-title', 'Trazer do dólar para reais'));

      // refresh é declaração (hoisted) — usada pelos campos abaixo já no closure.
      function refresh() { resgateRefresh(); }

      // Fonte (objetivo em US$). Com mais de um, vira chips; sozinho, fica fixo.
      if (usdObjs.length > 1) {
        const fS = elt('div', 'fin-item-field'); fS.appendChild(elt('label', 'fin-item-flabel', 'Tirar de'));
        const chips = elt('div', 'fin-chips'); const els = {};
        usdObjs.forEach((o) => {
          const c = elt('button', 'fin-chip' + (o.id === sourceId ? ' on' : ''), o.label);
          onTap(c, () => { sourceId = o.id; Object.values(els).forEach((e) => e.classList.remove('on')); c.classList.add('on'); refresh(); });
          els[o.id] = c; chips.appendChild(c);
        });
        fS.appendChild(chips); modal.appendChild(fS);
      } else if (usdObjs.length === 1) {
        const fS = elt('div', 'fin-item-field');
        fS.appendChild(elt('label', 'fin-item-flabel', 'Tirar de'));
        fS.appendChild(elt('div', 'muted', `${usdObjs[0].label} · US$ ${fmtNum(usdObjs[0].current || 0)}`));
        modal.appendChild(fS);
      }

      const usdInp = numField(modal, 'Valor em dólar (US$)', null, 'Ex: 200', refresh);
      const rateInp = numField(modal, 'Cotação do resgate (R$/US$)', std > 0 ? std : null, 'Ex: 5,40', refresh);
      const descInp = (() => {
        const f = elt('div', 'fin-item-field'); f.appendChild(elt('label', 'fin-item-flabel', 'Motivo (opcional)'));
        const inp = elt('input', 'fin-item-inp'); inp.type = 'text'; inp.maxLength = 200; inp.placeholder = 'Ex: Dentista, conserto do carro';
        f.appendChild(inp); modal.appendChild(f); return inp;
      })();

      const preview = elt('div', 'fin-amount-preview'); modal.appendChild(preview);
      const resgateRefresh = () => {
        const usd = parseDec(usdInp.value); const rate = parseDec(rateInp.value);
        if (!(usd > 0) || !(rate > 0)) { preview.textContent = ''; return; }
        const brlV = Math.round(usd * rate * 100) / 100;
        let txt = `= ${brl(brlV)}`;
        const src = source();
        if (src) { const after = Math.max(0, (Number(src.current) || 0) - usd); txt += ` · sobra US$ ${fmtNum(after)} na ${src.label}`; }
        preview.textContent = txt;
      };
      resgateRefresh();

      const actions = elt('div', 'fin-item-actions');
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar'); onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', 'Trazer para reais');
      onTap(save, async () => {
        const usd = parseDec(usdInp.value); const rate = parseDec(rateInp.value);
        if (!(usd > 0)) { BISA.toast('Informe o valor em dólar'); return; }
        if (!(rate > 0)) { BISA.toast('Informe a cotação'); return; }
        const brlV = Math.round(usd * rate * 100) / 100;
        const src = source();
        const desc = descInp.value.trim() || 'Resgate do dólar';
        try {
          await BISA.api('/finance/tx', { method: 'POST', json: { kind: 'income', amount: brlV, desc, category: 'resgate-dolar', date: todayISO() } });
          if (src) {
            const next = Math.max(0, Math.round(((Number(src.current) || 0) - usd) * 100) / 100);
            await BISA.api('/finance/objectives', { method: 'PATCH', json: { id: src.id, current: next } });
          }
          BISA.toast(`Trouxe ${brl(brlV)} do dólar`); this._closeItemEditor(); this._render(true);
        } catch (e) { BISA.toast(e.message || 'Erro ao trazer'); }
      });
      actions.append(cancel, save); modal.appendChild(actions);

      overlay.onclick = (ev) => { if (ev.target === overlay) this._closeItemEditor(); };
      this._itemKeyHandler = (ev) => { if (ev.key === 'Escape') this._closeItemEditor(); };
      document.addEventListener('keydown', this._itemKeyHandler);
      document.body.appendChild(overlay); this._itemOverlay = overlay; usdInp.focus();
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

    // ── Provisões do mês ─────────────────────────────────────────────────
    // Itens de um envelope SEM vencimento (ex.: Mercado no custo-fixo,
    // Restaurante nos prazeres): um valor provisionado no mês contra o qual se
    // lançam os gastos aos poucos — barra gasto/provisionado e lançamento
    // incremental ("Lançar" → ＋), com a lista de lançamentos expansível.
    // Renderizado uma vez por envelope que tem quadro (custo-fixo e prazeres).
    _fillProvisions(wrap, profileResp, summary, bucketId = 'custo-fixo', title = 'Provisões do mês') {
      wrap.innerHTML = '';
      const profile = profileResp && profileResp.profile;
      if (!profile) return;
      const fx = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const lines = (profile.budget || [])
        .filter((b) => b.kind !== 'income' && !b.dueDay && b.bucket === bucketId);
      if (!lines.length) return;
      const doneMap = (summary && summary.cash && summary.cash.byCategory) || {};
      const isThisMonth = this._month === thisMonth();
      const color = (BUCKETS.find((x) => x.id === bucketId) || {}).color;

      const head = elt('div', 'fin-sec-head');
      head.appendChild(elt('span', 'fin-sec-title', title));
      wrap.appendChild(head);

      const card = elt('div', 'card');
      lines.forEach((b) => this._provRow(card, b,
        this._planBRL(b, fx), Number(doneMap[b.category] || 0), isThisMonth, color));
      wrap.appendChild(card);
    },

    // Uma linha de provisão (Modelo 4): anel de % + nome + "gasto de provisão ·
    // restam", com ＋ p/ lançar e a lista de lançamentos expansível (tocar no
    // meio). Cor do anel: a do envelope → âmbar ≥85% → terracota ao estourar.
    _provRow(parent, b, plan, done, isThisMonth, color) {
      // Sem provisão (plan 0): categoria "livre" — gastar não é estouro, só não
      // tem meta própria; o teto real é o do envelope (bucket). Estado neutro,
      // sem vermelho nem 100% falso (pedido 2026-07-16).
      const noPlan = !(plan > 0);
      const ratio = noPlan ? 0 : done / plan;
      const pct = Math.round(ratio * 100);
      const over = !noPlan && done > plan + 0.005;
      const near = !over && !noPlan && ratio >= 0.85;
      const restam = Math.round((plan - done) * 100) / 100;
      const expanded = this._expandedCats.has(b.category);

      const row = elt('div', 'fin-prov-row');

      const ring = elt('div', 'fin-prov-ring' + (over ? ' over' : near ? ' warn' : ''));
      // sem meta: anel CHEIO (100%) na cor do envelope + valor em destaque
      // (pedido do Diego 2026-07-16). Com meta: % real como antes.
      if (color && !over && !near) ring.style.setProperty('--c', color);
      ring.style.setProperty('--p', String(noPlan ? 100 : Math.min(100, pct)));
      ring.appendChild(elt('b', null, noPlan ? '100%' : `${pct}%`));
      row.appendChild(ring);

      const mid = elt('div', 'fin-prov-mid');
      const name = elt('div', 'fin-prov-name');
      name.append(elt('span', 'fin-prov-caret', expanded ? '▾ ' : '▸ '),
        document.createTextNode(b.label || b.category));
      mid.appendChild(name);
      const sub = elt('div', 'fin-prov-sub' + (over ? ' neg' : noPlan ? ' free' : ''));
      if (noPlan) sub.innerHTML = `<strong class="fin-prov-bigval">${brl(done)}</strong> · livre`;
      else sub.textContent = over
        ? `${brl(done)} de ${brl(plan)} · estourou ${brl(-restam)}`
        : `${brl(done)} de ${brl(plan)} · restam ${brl(restam)}`;
      mid.appendChild(sub);
      mid.onclick = () => {
        if (this._expandedCats.has(b.category)) this._expandedCats.delete(b.category);
        else this._expandedCats.add(b.category);
        this._render(true);
      };
      row.appendChild(mid);

      if (isThisMonth) {
        const add = elt('button', 'fin-prov-add', '＋');
        add.title = 'Lançar gasto';
        add.onclick = () => this._openPayForm(null, b, plan, done, false);
        row.appendChild(add);
      }

      parent.appendChild(row);

      if (expanded) {
        const holder = elt('div', 'fin-prov-sublist-holder');
        this._renderTxSublist(holder, b, plan, done);
        parent.appendChild(holder);
      }
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
        withDesc: true, descFocus: false,
        descPlaceholder: 'Observação (opcional)',
        descChips: this._noteChips(b.category, b.label),
        confirmLabel: 'Registrar pagamento',
        onConfirm: async (amount, note) => {
          try {
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: {
                kind: 'expense', amount, desc: note || b.label || b.category,
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

      ACTIVE_BUCKETS.forEach((bk) => {
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
      ACTIVE_BUCKETS.forEach((bk) => {
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
      decimalInput(valInp);
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
        armDelete(del, async () => {
          try {
            await BISA.api(`/finance/budget?category=${encodeURIComponent(item.category)}`, { method: 'DELETE' });
            BISA.toast('Item excluído'); this._closeItemEditor(); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        }, { label: 'Excluir', armedLabel: 'Confirmar exclusão', tap: true });
        actions.appendChild(del);
      }
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar');
      onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', editing ? 'Salvar' : 'Criar item');
      onTap(save, async () => {
        const label = labelInp.value.trim();
        if (!label) { BISA.toast('Informe a descrição'); return; }
        const dueDay = dueInp.value ? Math.min(31, Math.max(1, parseInt(dueInp.value, 10) || 0)) : 0;
        const payload = { label, bucket, dueDay, amount: parseDec(valInp.value), tags: [...selectedTags] };
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
          armDelete(del, async () => {
            try {
              await BISA.api(`/finance/tags?name=${encodeURIComponent(t.name)}`, { method: 'DELETE' });
              this._tagDefs = (this._tagDefs || []).filter((x) => x.name !== t.name);
              renderList(); BISA.toast('Tag removida');
            } catch (e) { BISA.toast(e.message || 'Erro ao remover'); }
          }, { tap: true });
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
      ACTIVE_BUCKETS.forEach((bk) => mkScope(bk.id, bk.label));
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
      const fixed = profile.allocationFixed || {}; // metas fixas em R$ (sobrepõem a %)
      const manual = (summary && summary.cash && summary.cash.manual) || [];
      // O saldo inicial em caixa entra no saldo disponível (hero) mas NÃO é renda
      // do mês: não se aloca % de envelope sobre dinheiro que já se tinha. Mesma
      // lógica da renda de liberdade (categorias -lib), excluída do "saldo p/ viver".
      const saldoInicial = manual
        .filter((t) => t.kind === 'income' && t.category === 'saldo-inicial')
        .reduce((s, t) => s + t.amount, 0);
      // O controle do mês é a visão de PLANEJAMENTO: a renda inclui o que está
      // provisionado ("a receber") — é sobre esse total que os envelopes fatiam.
      // O caixa (hero) continua contando só o que já entrou.
      const cash = (summary && summary.cash) || {};
      const pendRenda = Number(cash.pendingIncome) || 0;
      const renda = (Number(cash.income) || 0) + pendRenda - saldoInicial;
      const isThisMonth = this._month === thisMonth();

      // mapa categoria→bucket (resolve lançamentos legados sem bucket próprio)
      const catBucket = {};
      (profile.budget || []).forEach((b) => { if (b.kind !== 'income' && b.bucket) catBucket[b.category] = b.bucket; });
      const bucketOf = (t) => (DEFAULT_ALLOCATION[t.bucket] != null ? t.bucket
        : (catBucket[t.category] || 'custo-fixo'));

      const gastoBy = {}; const txBy = {};
      BUCKETS.forEach((b) => { gastoBy[b.id] = 0; txBy[b.id] = []; });
      // aportes/gastos provisionados contam aqui (a renda pendente também conta):
      // o envelope mostra o plano do mês, não o caixa.
      manual.filter((t) => t.kind === 'expense').forEach((t) => {
        const k = bucketOf(t); gastoBy[k] += t.amount; txBy[k].push(t);
      });

      // destinado[bucket] = soma dos planos dos itens do envelope (o valor
      // provisionado de cada item, pago ou não) — base da visualização "Disponível".
      const fxRate = (profile.fx && Number(profile.fx.BRLperUSD)) || 0;
      const destinadoBy = {};
      BUCKETS.forEach((b) => { destinadoBy[b.id] = 0; });
      (profile.budget || []).forEach((it) => {
        if (it.kind === 'income') return;
        const k = DEFAULT_ALLOCATION[it.bucket] != null ? it.bucket : 'custo-fixo';
        destinadoBy[k] += this._planBRL(it, fxRate);
      });
      // Liberdade e Metas não têm itens de orçamento — o "destino" delas são os
      // aportes aos objetivos (lançamentos no próprio bucket). Contam como destinado.
      ['liberdade', 'metas'].forEach((k) => { destinadoBy[k] += gastoBy[k] || 0; });

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

      // Meta em R$ de um envelope: fixa em R$ > "resto da renda" (renda − metas
      // dos demais, o envelope marcado em profile.allocationRest) > % da renda.
      const restId = profile.allocationRest || null;
      const devoOf = (id) => {
        if (fixed[id] != null) return fixed[id];
        if (id === restId) {
          const outras = ACTIVE_BUCKETS.filter((b) => b.id !== id).reduce((s, b) => s
            + (fixed[b.id] != null ? fixed[b.id] : Math.round(renda * (Number(alloc[b.id]) || 0)) / 100), 0);
          return Math.max(0, Math.round((renda - outras) * 100) / 100);
        }
        return Math.round(renda * (Number(alloc[id]) || 0)) / 100;
      };
      // % efetiva de um envelope: metas fixas e "resto" derivam de R$÷renda.
      const effPct = (id) => ((fixed[id] != null || id === restId)
        ? (renda > 0 ? (devoOf(id) / renda) * 100 : 0)
        : (Number(alloc[id]) || 0));
      const totalPct = () => ACTIVE_BUCKETS.reduce((s, b) => s + effPct(b.id), 0);
      const meta = elt('div', 'fin-env-meta');
      meta.innerHTML = `<span>Renda do mês <strong>${brl(renda)}</strong>`
        + (pendRenda > 0 ? ` <span class="muted">(${brl(pendRenda)} a receber)</span>` : '') + '</span>';
      const tp = totalPct();
      const totEl = elt('span', 'fin-env-total' + (Math.abs(tp - 100) > 0.5 ? ' off' : ''), `Alocado ${tp.toFixed(0)}%`);
      meta.appendChild(totEl);
      card.appendChild(meta);

      // Alternador das 2 visualizações (só fora do modo edição de metas).
      if (!this._allocEdit) {
        const seg = elt('div', 'fin-envview-seg');
        [['used', 'Utilizado'], ['free', 'Disponível']].forEach(([mode, lbl]) => {
          const opt = elt('button', 'fin-envview-opt' + ((this._envView || 'used') === mode ? ' on' : ''), lbl);
          opt.onclick = () => { this._envView = mode; this._render(true); };
          seg.appendChild(opt);
        });
        card.appendChild(seg);
      }

      const recomputeTotal = () => {
        const t = totalPct();
        totEl.textContent = `Alocado ${t.toFixed(0)}%`;
        totEl.classList.toggle('off', Math.abs(t - 100) > 0.5);
      };

      // refs dos sliders (modo edição) p/ redistribuir e salvar em lote
      const sliders = [];
      const persistAll = async () => {
        try { for (const s of ACTIVE_BUCKETS) await BISA.api('/finance/allocation', { method: 'PATCH', json: { bucket: s.id, pct: Number(alloc[s.id]) || 0 } }); }
        catch (e) { BISA.toast(e.message || 'Erro ao salvar %'); }
      };

      if (this._allocEdit) {
        // Modo "Metas %": uma linha por envelope com slider (inalterado).
        ACTIVE_BUCKETS.forEach((b) => {
          const pct = Number(alloc[b.id]) || 0;
          const gasto = Math.round((gastoBy[b.id] || 0) * 100) / 100;

          // Envelope com meta fixa em R$: sem slider — mostra o valor (editável)
          // e um botão para voltar a usar %.
          if (fixed[b.id] != null) {
            const dpct = renda > 0 ? Math.round((fixed[b.id] / renda) * 100) : 0;
            const frow = elt('div', 'fin-env-row');
            const ftop = elt('div', 'fin-env-top');
            const fdot = elt('span', 'fin-env-dot'); fdot.style.background = b.color;
            const fcaret = elt('span', 'fin-env-caret', ''); fcaret.style.visibility = 'hidden';
            ftop.append(fdot, fcaret, elt('span', 'fin-env-name', b.label), elt('span', 'fin-env-pct', `${dpct}%`));
            ftop.style.cursor = 'default';
            frow.appendChild(ftop);
            const fxr = elt('div', 'fin-env-fixedrow');
            const fval = elt('button', 'fin-env-fixedval', `Meta fixa: ${brl(fixed[b.id])}`);
            fval.onclick = () => this._openAmountSheet({
              title: `Meta fixa · ${b.label}`, initial: fixed[b.id], confirmLabel: 'Salvar meta',
              onConfirm: (amount) => this._setEnvelopeFixed(b.id, amount),
            });
            const unpin = elt('button', 'fin-env-unpin', 'Usar %');
            unpin.onclick = () => this._setEnvelopeFixed(b.id, 0);
            fxr.append(fval, unpin);
            frow.appendChild(fxr);
            card.appendChild(frow);
            return;
          }

          // Envelope "resto da renda": sem slider — a meta é o que sobra depois
          // das metas fixas e das % dos demais.
          if (b.id === restId) {
            const devo = devoOf(b.id);
            const dpct = renda > 0 ? Math.round((devo / renda) * 100) : 0;
            const rrow = elt('div', 'fin-env-row');
            const rtop = elt('div', 'fin-env-top');
            const rdot = elt('span', 'fin-env-dot'); rdot.style.background = b.color;
            const rcaret = elt('span', 'fin-env-caret', ''); rcaret.style.visibility = 'hidden';
            rtop.append(rdot, rcaret, elt('span', 'fin-env-name', b.label), elt('span', 'fin-env-pct', `${dpct}%`));
            rtop.style.cursor = 'default';
            rrow.appendChild(rtop);
            const rxr = elt('div', 'fin-env-fixedrow');
            rxr.appendChild(elt('span', 'fin-env-fixedval', `Resto da renda: ${brl(devo)}`));
            const unrest = elt('button', 'fin-env-unpin', 'Usar %');
            unrest.onclick = () => this._setEnvelopeRest(b.id, false);
            rxr.appendChild(unrest);
            rrow.appendChild(rxr);
            card.appendChild(rrow);
            return;
          }

          const row = elt('div', 'fin-env-row');
          const top = elt('div', 'fin-env-top');
          const dot = elt('span', 'fin-env-dot'); dot.style.background = b.color;
          const caret = elt('span', 'fin-env-caret', ''); caret.style.visibility = 'hidden';
          const pctEl = elt('span', 'fin-env-pct', `${pct.toFixed(0)}%`);
          top.append(dot, caret, elt('span', 'fin-env-name', b.label), pctEl);
          top.style.cursor = 'default';
          row.appendChild(top);

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
          // Fixar esta meta num valor exato em R$ (para alvos que não são % redondo).
          const pin = elt('button', 'fin-env-fit', 'Fixar em R$');
          pin.onclick = () => this._openAmountSheet({
            title: `Meta fixa · ${b.label}`,
            initial: Math.round(renda * pct) / 100 || null,
            confirmLabel: 'Fixar meta',
            onConfirm: (amount) => this._setEnvelopeFixed(b.id, amount),
          });
          row.appendChild(pin);
          // Marcar este envelope como o "resto": recebe o que sobrar da renda
          // depois das metas fixas e das % dos outros (fecha os 100% sozinho).
          const restBtn = elt('button', 'fin-env-fit', 'Receber o resto da renda');
          restBtn.onclick = () => this._setEnvelopeRest(b.id, true);
          row.appendChild(restBtn);
          card.appendChild(row);
        });
      } else {
        // Modo visualização (Modelo A): anéis em linha. O anel mostra quanto do
        // envelope já foi usado (gasto ÷ devo); tocar abre os lançamentos abaixo.
        const noCur = (v) => brl(v).replace(/^R\$\s?/, '');
        const rings = elt('div', 'fin-envA-rings');
        ACTIVE_BUCKETS.forEach((b) => {
          const gasto = Math.round((gastoBy[b.id] || 0) * 100) / 100;
          const devo = devoOf(b.id);
          const destinado = Math.round((destinadoBy[b.id] || 0) * 100) / 100;

          let fillPct; let over; let valsText;
          if (this._envView === 'free') {
            // Disponível: anel = quanto ainda está LIVRE (orçado − destinado).
            // Nada destinado → 100% livre; é o contrário da vista "Utilizado".
            const livre = Math.max(0, devo - destinado);
            fillPct = devo > 0 ? Math.round((livre / devo) * 100) : (destinado > 0 ? 0 : 100);
            over = destinado > devo + 0.005; // envelope super-comprometido
            valsText = `${noCur(destinado)} / ${noCur(devo)}`;
          } else {
            // Utilizado: anel = quanto já foi GASTO do orçado.
            const util = devo > 0 ? gasto / devo : (gasto > 0 ? 1 : 0);
            fillPct = Math.round(util * 100);
            over = gasto > devo + 0.005;
            valsText = `${noCur(gasto)} / ${noCur(devo)}`;
          }

          const cell = elt('button', 'fin-envA-cell' + (this._expandedBuckets.has(b.id) ? ' on' : ''));
          const ring = elt('div', 'fin-envA-ring');
          ring.style.setProperty('--p', String(Math.min(100, Math.max(0, fillPct))));
          ring.style.setProperty('--c', over ? 'var(--negative)' : b.color);
          ring.appendChild(elt('b', over ? 'fin-value-neg' : null, `${fillPct}%`));
          const nameEl = elt('span', 'fin-envA-name', b.label);
          if (fixed[b.id] != null) nameEl.append(elt('span', 'fin-envA-pin', 'fixo'));
          else if (b.id === restId) nameEl.append(elt('span', 'fin-envA-pin', 'resto'));
          cell.append(
            ring,
            nameEl,
            elt('span', 'fin-envA-vals' + (over ? ' neg' : ''), valsText),
          );
          cell.onclick = () => {
            if (this._expandedBuckets.has(b.id)) this._expandedBuckets.delete(b.id);
            else this._expandedBuckets.add(b.id);
            this._render(true);
          };
          rings.appendChild(cell);
        });
        card.appendChild(rings);

        // Lançamentos do(s) envelope(s) aberto(s), logo abaixo da fileira.
        ACTIVE_BUCKETS.forEach((b) => {
          if (!this._expandedBuckets.has(b.id)) return;
          const sub = elt('div', 'fin-envA-sub');
          const sh = elt('div', 'fin-envA-subhead');
          const sdot = elt('span', 'fin-env-dot'); sdot.style.background = b.color;
          sh.append(sdot, elt('span', null, b.label));
          sub.appendChild(sh);
          this._renderBucketTxs(sub, b, txBy[b.id], isThisMonth);
          card.appendChild(sub);
        });
      }

      wrap.appendChild(card);
    },

    // Marca (on=true) ou desmarca um envelope como "resto da renda".
    async _setEnvelopeRest(bucketId, on) {
      try {
        await BISA.api('/finance/allocation', { method: 'PATCH', json: { bucket: bucketId, rest: on } });
        BISA.toast(on ? 'Envelope recebe o resto da renda' : 'Meta voltou para %');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
    },

    // Fixa (amount > 0) ou desafixa (amount <= 0) a meta de um envelope em R$.
    // Quando fixo, o "devo gastar" passa a ser o valor exato (não %×renda).
    async _setEnvelopeFixed(bucketId, amount) {
      try {
        await BISA.api('/finance/allocation', { method: 'PATCH', json: { bucket: bucketId, amount } });
        BISA.toast(Number(amount) > 0 ? 'Meta fixada em R$!' : 'Meta voltou para %');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao salvar meta'); }
    },

    // Fixa a meta da categoria no % já gasto (gasto/renda) e rebalanceia as
    // outras proporcionalmente para o total fechar 100%. Persiste via PATCH.
    async _fitAllocation(catId, renda, gastoBy, alloc) {
      if (!(renda > 0)) { BISA.toast('Sem renda no mês para calcular'); return; }
      const target = Math.max(0, Math.min(100, Math.round(((gastoBy[catId] || 0) / renda) * 100)));
      const remaining = 100 - target;
      const others = ACTIVE_BUCKETS.filter((b) => b.id !== catId);
      const othersSum = others.reduce((s, o) => s + (Number(alloc[o.id]) || 0), 0);
      const next = { [catId]: target };
      if (othersSum > 0) others.forEach((o) => { next[o.id] = Math.round(((Number(alloc[o.id]) || 0) * remaining) / othersSum); });
      else others.forEach((o) => { next[o.id] = Math.round(remaining / others.length); });
      // corrige arredondamento para somar exatamente 100 (joga a diferença no maior "outro")
      const sum = ACTIVE_BUCKETS.reduce((s, b) => s + next[b.id], 0);
      if (sum !== 100 && others.length) {
        const big = others.slice().sort((a, b) => next[b.id] - next[a.id])[0];
        next[big.id] = Math.max(0, next[big.id] + (100 - sum));
      }
      try {
        for (const b of ACTIVE_BUCKETS) await BISA.api('/finance/allocation', { method: 'PATCH', json: { bucket: b.id, pct: next[b.id] } });
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
        armDelete(del, async () => {
          try {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}&creditGoal=1`, { method: 'DELETE' });
            BISA.toast('Gasto excluído'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        });
        act.append(edit, del);
        srow.append(
          elt('span', 'fin-bud-subdate', fmtDate(tx.date)),
          elt('span', 'fin-bud-subdesc', tx.desc || tx.category || '—'),
        );
        if (tx.pending) srow.appendChild(elt('span', 'fin-inc-sub pend', 'provisionado'));
        srow.append(elt('strong', 'fin-bud-subamt', brl(tx.amount)), act);
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
            // creditGoal: objetivo vinculado é creditado pelo servidor (1 request)
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: { kind: 'expense', amount, desc: desc || bucketLabel(bucketId),
                category: (desc || bucketId).slice(0, 40), bucket: bucketId, goalId: goalId || undefined,
                date: todayISO(), creditGoal: true },
            });
            BISA.toast('Gasto lançado!'); this._render(true);
          } catch (e) { BISA.toast(e.message || 'Erro ao salvar'); }
        },
      });
    },

    // Corrige o realizado de uma RECEITA da categoria no mês exibido: edita o
    // lançamento existente in-place (PATCH) e remove eventuais duplicados; sem
    // lançamento ainda, cria um (0 = só apaga). Receita vem só de lançamentos
    // manuais (incomeByCategory), então corrigir substituindo é seguro.
    async _setRealized(b, amount, usd, pending) {
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const matching = manual.filter((t) => t.kind === 'income' && t.category === b.category);
      try {
        if (amount > 0) {
          // Fonte em dólar: registra a cotação implícita na descrição (auditável).
          const desc = (usd > 0)
            ? `${b.label || b.category} — US$ ${fmtNum(usd)} a ${fmtRate(amount / usd)}`
            : (b.label || b.category);
          if (matching.length) {
            await BISA.api('/finance/tx', {
              method: 'PATCH',
              json: { id: matching[0].id, amount, desc, date: todayISO(), pending: !!pending },
            });
          } else {
            await BISA.api('/finance/tx', {
              method: 'POST',
              json: { kind: 'income', amount, desc, category: b.category || 'outro', date: todayISO(),
                ...(pending ? { pending: true } : {}) },
            });
          }
          for (const t of matching.slice(1)) {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
          }
        } else {
          for (const t of matching) {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
          }
        }
        BISA.toast('Receita atualizada!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao atualizar'); }
    },

    async _postPayment(b, amount, income, note) {
      if (!(amount > 0)) { BISA.toast('Defina um valor planejado primeiro'); return; }
      try {
        await BISA.api('/finance/tx', {
          method: 'POST',
          json: { kind: income ? 'income' : 'expense', amount,
            desc: note || b.label || b.category, category: b.category || 'outro', date: todayISO(),
            ...(!income && b.bucket ? { bucket: b.bucket } : {}) },
        });
        BISA.toast(income ? 'Recebimento registrado!' : 'Pagamento registrado!');
        this._render(true);
      } catch (e) { BISA.toast(e.message || 'Erro ao registrar'); }
    },

    // Observações já usadas neste mês na categoria (chips de 1 toque no sheet
    // de lançamento — embrião do vocabulário de tags por item).
    _noteChips(category, label) {
      const manual = (this._summary && this._summary.cash && this._summary.cash.manual) || [];
      const seen = new Set();
      const chips = [];
      manual.filter((t) => t.kind === 'expense' && t.category === category).forEach((t) => {
        const d = (t.desc || '').trim();
        if (!d || d === label || seen.has(d.toLowerCase())) return;
        seen.add(d.toLowerCase());
        chips.push(d);
      });
      return chips.slice(0, 6);
    },

    // Lançar um valor (receber/pagar) — campo vazio p/ definir o valor; o chip
    // "Usar planejado" preenche a previsão em 1 toque quando ela bate.
    _openPayForm(host, b, plan, done, income) {
      this._openAmountSheet({
        title: b.label || b.category || 'Valor',
        initial: null,
        plan,
        withDesc: true, descFocus: false,
        descPlaceholder: 'Observação (ex: nome do remédio)',
        descChips: this._noteChips(b.category, b.label),
        confirmLabel: income ? 'Salvar receita' : 'Registrar pagamento',
        onConfirm: (amount, note) => this._postPayment(b, amount, income, note),
      });
    },

    // ── Sheet de valor (iPad + Pencil) ───────────────────────────────────
    // Campo grande Scribble-friendly (type=text, teclado nativo suprimido via
    // inputMode='none' p/ não brigar com o teclado abaixo) + teclado numérico
    // grande + chip do planejado. A Pencil (Scribble) e o teclado escrevem no
    // mesmo campo. opts: { title, initial, plan, confirmLabel, allowZero, onConfirm,
    //   withDesc, descInitial, descPlaceholder, descChips, descFocus, statusToggle,
    //   pendingInitial }. Com withDesc, um campo de descrição aparece acima do
    //   valor e onConfirm recebe (amount, desc); descFocus:false mantém o foco
    //   inicial no valor (descrição opcional, ex.: observação de um pagamento). Com statusToggle, chips Entrou/A receber (textos
    //   customizáveis via statusLabels) e onConfirm recebe (amount, desc, goalId, pending).
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

      // Status da receita (statusToggle): "Entrou" conta no caixa; "A receber"
      // fica fora do saldo até ser confirmada. onConfirm recebe o bool no 4º arg.
      let pending = !!opts.pendingInitial;
      if (opts.statusToggle) {
        const f = elt('div', 'fin-item-field');
        f.appendChild(elt('label', 'fin-item-flabel', 'Status'));
        const chips = elt('div', 'fin-chips');
        const mkStatus = (label, val) => {
          const chip = elt('button', 'fin-chip' + (pending === val ? ' on' : ''), label);
          chip.onclick = () => {
            pending = val;
            [...chips.children].forEach((c) => c.classList.remove('on'));
            chip.classList.add('on');
          };
          chips.appendChild(chip);
        };
        const [lblNow, lblPend] = opts.statusLabels || ['Entrou', 'A receber'];
        mkStatus(lblNow, false);
        mkStatus(lblPend, true);
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

      const refresh = () => {
        const n = parseDec(input.value);
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
        const amount = parseDec(input.value);
        if (!(allowZero ? amount >= 0 : amount > 0)) { BISA.toast('Informe um valor válido'); return; }
        this._closeAmountSheet();
        onConfirm(amount, descInput ? descInput.value.trim() : undefined, selectedGoal, pending);
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
      if (descInput && !opts.descInitial && opts.descFocus !== false) {
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

      const curInp = numField(modal, 'Saldo atual (já acumulado)', obj && obj.current, 'Ex: 8977,62');
      const tgtInp = numField(modal, 'Meta (R$)', obj && obj.target, 'Ex: 80000');

      const actions = elt('div', 'fin-item-actions');
      if (editing) {
        const del = elt('button', 'fin-item-del', 'Excluir');
        armDelete(del, async () => {
          try { await BISA.api(`/finance/objectives?id=${encodeURIComponent(obj.id)}`, { method: 'DELETE' }); BISA.toast('Objetivo excluído'); this._closeItemEditor(); this._render(true); }
          catch (e) { BISA.toast(e.message || 'Erro ao excluir'); }
        }, { label: 'Excluir', armedLabel: 'Confirmar exclusão', tap: true });
        actions.appendChild(del);
      }
      const cancel = elt('button', 'fin-amount-cancel', 'Cancelar'); onTap(cancel, () => this._closeItemEditor());
      const save = elt('button', 'btn', editing ? 'Salvar' : 'Criar');
      onTap(save, async () => {
        const label = labelInp.value.trim();
        if (!label) { BISA.toast('Informe o nome'); return; }
        const payload = { label, bucket, currency, current: parseDec(curInp.value), target: parseDec(tgtInp.value) };
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
