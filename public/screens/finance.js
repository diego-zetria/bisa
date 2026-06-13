// screens/finance.js — Tela de Finanças completa.
// Alcançada via BISA.go('finance') a partir do Hub, não está no nav inferior.
// Touch-first para iPad 11" + desktop. Texto em pt-BR.
//
// Endpoint shapes verificados em 2026-06-12:
//   GET /finance/summary  → {month, cash:{income,expense,net,byCategory,manual[]}, invest:{positions[],...}}
//   GET /finance/profile  → {profile: null | {...}, loans:[...], onboarding:{answered}}
//   GET /finance/status   → {actual:{configured,up}, ghostfolio:{configured,up}, ledger:{investments,unsynced}}
//   GET /finance/positions → {positions:[]}   — vazio se ledger vazio; hideable
//   GET /finance/irpf      → {year,monthly[],darfs[],bens[],...} — hideable
//   POST /finance/tx       → body {date,kind,amount,category,desc} → {ok,tx}
//   DELETE /finance/tx     → ?id=<id>

(function () {
  // Inject scoped styles once (progress bars + finance layout extras)
  if (!document.getElementById('fin-style')) {
    const s = document.createElement('style');
    s.id = 'fin-style';
    s.textContent = `
      .fin-hero-row { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:18px; }
      .fin-hero-card {
        flex:1 1 140px; background:var(--surface); border:1px solid var(--line);
        border-radius:var(--radius); box-shadow:var(--shadow); padding:16px 18px;
        min-width:130px;
      }
      .fin-hero-card .fin-label { font-size:.75rem; text-transform:uppercase;
        letter-spacing:.06em; color:var(--ink-soft); font-weight:600; margin-bottom:4px; }
      .fin-hero-card .fin-value { font-size:1.5rem; font-weight:700; line-height:1.2; }
      .fin-hero-card .fin-value.positive { color:var(--positive); }
      .fin-hero-card .fin-value.negative { color:var(--negative); }
      .fin-form-grid { display:grid; gap:10px; grid-template-columns:1fr 1fr; }
      @media (max-width:520px) { .fin-form-grid { grid-template-columns:1fr; } }
      .fin-tx-row {
        display:flex; align-items:center; gap:8px;
        padding:10px 4px; border-bottom:1px solid var(--line);
      }
      .fin-tx-row:last-child { border-bottom:none; }
      .fin-tx-date { font-size:.78rem; color:var(--ink-soft); min-width:52px; }
      .fin-tx-desc { flex:1; font-size:.95rem; }
      .fin-tx-cat  { font-size:.72rem; color:var(--ink-soft); padding:2px 7px;
        background:var(--surface-2); border-radius:999px; white-space:nowrap; }
      .fin-tx-amt  { font-weight:600; white-space:nowrap; min-width:80px; text-align:right; }
      .fin-tx-del  { background:none; border:none; color:var(--ink-soft); font-size:1rem;
        padding:6px 8px; cursor:pointer; border-radius:var(--radius-sm); min-height:var(--tap);
        min-width:var(--tap); display:flex; align-items:center; justify-content:center; }
      .fin-tx-del:hover { color:var(--negative); background:var(--surface-2); }
      .fin-progress-wrap { background:var(--surface-2); border-radius:999px; height:10px; overflow:hidden; margin:8px 0 4px; }
      .fin-progress-bar  { height:100%; border-radius:999px; background:var(--primary); transition:width .4s; }
      .fin-loan-row { display:flex; justify-content:space-between; font-size:.85rem; color:var(--ink-soft); }
      .fin-cat-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
      .fin-cat-name { flex:1; font-size:.9rem; }
      .fin-cat-bar-wrap { flex:2; background:var(--surface-2); border-radius:999px; height:8px; overflow:hidden; }
      .fin-cat-bar { height:100%; border-radius:999px; background:var(--negative); }
      .fin-cat-amt { min-width:80px; text-align:right; font-size:.85rem; color:var(--ink-soft); }
      .fin-back-btn { display:flex; align-items:center; gap:6px; background:none; border:none;
        color:var(--ink-soft); font-size:.95rem; padding:4px 0; margin-bottom:18px;
        cursor:pointer; min-height:var(--tap); }
      .fin-back-btn:hover { color:var(--ink); }
      .fin-month-nav { display:flex; align-items:center; gap:8px; margin-bottom:18px; }
      .fin-month-nav .fin-month-label { font-weight:600; font-size:1rem; flex:1; text-align:center; }
      .fin-month-btn { background:var(--surface-2); border:none; border-radius:var(--radius-sm);
        padding:0 14px; min-height:var(--tap); cursor:pointer; font-size:1rem; color:var(--ink); }
      .fin-month-btn:hover { background:var(--line); }
    `;
    document.head.appendChild(s);
  }

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

  window.BISA.screens['finance'] = {
    _el: null,
    _month: thisMonth(),
    _unsub: null,

    mount(el) {
      this._el = el;
      this._month = thisMonth();
      this._render();
    },

    unmount() {
      this._el = null;
    },

    _render() {
      const el = this._el;
      if (!el) return;
      el.innerHTML = '';

      // Back button
      const back = document.createElement('button');
      back.className = 'fin-back-btn';
      back.innerHTML = '← Hoje';
      back.onclick = () => BISA.go('hub');
      el.appendChild(back);

      // Page title + month nav
      const monthNav = document.createElement('div');
      monthNav.className = 'fin-month-nav';
      const prevBtn = document.createElement('button');
      prevBtn.className = 'fin-month-btn';
      prevBtn.textContent = '‹';
      prevBtn.setAttribute('aria-label', 'Mês anterior');
      prevBtn.onclick = () => { this._month = prevMonth(this._month); this._render(); };
      const nextBtn = document.createElement('button');
      nextBtn.className = 'fin-month-btn';
      nextBtn.textContent = '›';
      nextBtn.setAttribute('aria-label', 'Próximo mês');
      nextBtn.onclick = () => { this._month = nextMonth(this._month); this._render(); };
      const mlabel = document.createElement('span');
      mlabel.className = 'fin-month-label';
      mlabel.textContent = monthLabel(this._month);
      monthNav.append(prevBtn, mlabel, nextBtn);
      el.appendChild(monthNav);

      // Placeholder containers — filled async
      const heroWrap   = document.createElement('div');
      const formCard   = this._buildFormCard();
      const txCard     = document.createElement('div');
      const goalCard   = document.createElement('div');
      const investCard = document.createElement('div'); // hidden until data

      el.append(heroWrap, formCard, txCard, goalCard, investCard);

      // Load summary + profile in parallel; hide invest section if empty
      const month = this._month;
      Promise.all([
        BISA.api(`/finance/summary?month=${month}`).catch(() => null),
        BISA.api('/finance/profile').catch(() => null),
      ]).then(([summary, profileResp]) => {
        this._fillHero(heroWrap, summary);
        this._fillTxList(txCard, summary, month);
        this._fillGoals(goalCard, profileResp);
      });

      // Investments: only show if positions exist
      BISA.api('/finance/positions').then((data) => {
        const positions = (data && data.positions) || [];
        if (positions.length > 0) {
          this._fillInvestments(investCard, positions);
        }
        // else: investCard stays empty — no section shown
      }).catch(() => {});
    },

    // ── Hero tiles ──────────────────────────────────────────────────────────
    _fillHero(wrap, summary) {
      wrap.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'fin-hero-row';

      if (!summary || !summary.cash) {
        // Empty state: friendly tiles with zeros
        row.appendChild(this._heroTile('Receitas', brl(0), ''));
        row.appendChild(this._heroTile('Gastos', brl(0), ''));
        row.appendChild(this._heroTile('Saldo', brl(0), ''));
        wrap.appendChild(row);

        const hint = document.createElement('p');
        hint.className = 'muted';
        hint.style.textAlign = 'center';
        hint.style.marginBottom = '8px';
        hint.textContent = 'Nenhum lançamento ainda. Use o formulário abaixo para começar!';
        wrap.appendChild(hint);
        return;
      }

      const { income, expense, net } = summary.cash;
      row.appendChild(this._heroTile('Receitas', brl(income), 'positive'));
      row.appendChild(this._heroTile('Gastos',   brl(expense), expense > 0 ? 'negative' : ''));
      row.appendChild(this._heroTile('Saldo',    brl(net),    net >= 0 ? 'positive' : 'negative'));
      wrap.appendChild(row);

      // Category breakdown (top expenses) — only if there are entries
      const cats = Object.entries(summary.cash.byCategory || {});
      if (cats.length > 0) {
        const title = document.createElement('p');
        title.className = 'section-title';
        title.textContent = 'Por categoria';
        wrap.appendChild(title);

        const catCard = document.createElement('div');
        catCard.className = 'card';
        const maxVal = Math.max(...cats.map(([, v]) => v), 1);
        cats.sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([cat, val]) => {
          const row2 = document.createElement('div');
          row2.className = 'fin-cat-row';
          const name = document.createElement('span');
          name.className = 'fin-cat-name';
          name.textContent = cat;
          const barWrap = document.createElement('div');
          barWrap.className = 'fin-cat-bar-wrap';
          const bar = document.createElement('div');
          bar.className = 'fin-cat-bar';
          bar.style.width = `${Math.min(100, (val / maxVal) * 100).toFixed(1)}%`;
          barWrap.appendChild(bar);
          const amt = document.createElement('span');
          amt.className = 'fin-cat-amt';
          amt.textContent = brl(val);
          row2.append(name, barWrap, amt);
          catCard.appendChild(row2);
        });
        wrap.appendChild(catCard);
      }
    },

    _heroTile(label, value, colorClass) {
      const tile = document.createElement('div');
      tile.className = 'fin-hero-card';
      const lbl = document.createElement('div');
      lbl.className = 'fin-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'fin-value' + (colorClass ? ` ${colorClass}` : '');
      val.textContent = value;
      tile.append(lbl, val);
      return tile;
    },

    // ── Quick-add form ───────────────────────────────────────────────────────
    _buildFormCard() {
      const card = document.createElement('div');
      card.className = 'card';

      const title = document.createElement('h3');
      title.textContent = 'Lançar';
      title.style.margin = '0 0 14px';
      card.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'fin-form-grid';

      // Type select
      const kindSel = document.createElement('select');
      kindSel.innerHTML = '<option value="expense">Gasto</option><option value="income">Receita</option>';

      // Amount
      const amtInput = document.createElement('input');
      amtInput.type = 'number';
      amtInput.min = '0.01';
      amtInput.step = '0.01';
      amtInput.placeholder = 'Valor (R$)';
      amtInput.inputMode = 'decimal';

      // Description
      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.placeholder = 'Descrição (ex: mercado, almoço…)';
      descInput.maxLength = 200;

      // Category
      const catInput = document.createElement('input');
      catInput.type = 'text';
      catInput.placeholder = 'Categoria (ex: alimentação)';
      catInput.maxLength = 40;

      // Date
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.value = todayISO();

      grid.append(kindSel, amtInput, descInput, catInput);
      card.appendChild(grid);

      // Date row below grid (full width)
      const dateRow = document.createElement('div');
      dateRow.style.marginTop = '10px';
      const dateLabel = document.createElement('label');
      dateLabel.className = 'muted';
      dateLabel.style.fontSize = '.8rem';
      dateLabel.textContent = 'Data';
      dateInput.style.marginTop = '4px';
      dateRow.append(dateLabel, dateInput);
      card.appendChild(dateRow);

      // Submit
      const btn = document.createElement('button');
      btn.className = 'btn block';
      btn.style.marginTop = '14px';
      btn.textContent = 'Salvar lançamento';

      btn.onclick = async () => {
        const amount = parseFloat(amtInput.value);
        if (!amount || amount <= 0) { BISA.toast('Informe um valor válido'); return; }
        const desc = descInput.value.trim() || 'sem descrição';
        btn.disabled = true;
        btn.textContent = 'Salvando…';
        try {
          await BISA.api('/finance/tx', {
            method: 'POST',
            json: {
              kind: kindSel.value,
              amount,
              desc,
              category: catInput.value.trim() || 'outro',
              date: dateInput.value || todayISO(),
            },
          });
          BISA.toast('Lançamento salvo!');
          amtInput.value = '';
          descInput.value = '';
          catInput.value = '';
          dateInput.value = todayISO();
          // Refresh the full view to update hero tiles + tx list
          this._render();
        } catch (e) {
          BISA.toast(e.message || 'Erro ao salvar');
          btn.disabled = false;
          btn.textContent = 'Salvar lançamento';
        }
      };

      card.appendChild(btn);
      return card;
    },

    // ── Transactions list ────────────────────────────────────────────────────
    _fillTxList(wrap, summary, month) {
      wrap.innerHTML = '';

      const title = document.createElement('p');
      title.className = 'section-title';
      title.textContent = 'Lançamentos do mês';
      wrap.appendChild(title);

      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '8px 16px';

      const txs = (summary && summary.cash && summary.cash.manual) || [];
      // Show most recent first
      const sorted = [...txs].sort((a, b) => (a.date < b.date ? 1 : -1));

      if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = '<div style="font-size:2rem;margin-bottom:8px">💸</div>Nenhum lançamento em ' + monthLabel(month) + '.';
        card.appendChild(empty);
        wrap.appendChild(card);
        return;
      }

      sorted.forEach((tx) => {
        const row = document.createElement('div');
        row.className = 'fin-tx-row';

        const dateEl = document.createElement('span');
        dateEl.className = 'fin-tx-date';
        dateEl.textContent = fmtDate(tx.date);

        const descEl = document.createElement('span');
        descEl.className = 'fin-tx-desc';
        descEl.textContent = tx.desc || '—';

        const catEl = document.createElement('span');
        catEl.className = 'fin-tx-cat';
        catEl.textContent = tx.category || 'outro';

        const amtEl = document.createElement('span');
        amtEl.className = 'fin-tx-amt';
        const isExpense = tx.kind === 'expense';
        amtEl.style.color = isExpense ? 'var(--negative)' : 'var(--positive)';
        amtEl.textContent = (isExpense ? '−' : '+') + brl(tx.amount);

        const delBtn = document.createElement('button');
        delBtn.className = 'fin-tx-del';
        delBtn.title = 'Apagar lançamento';
        delBtn.textContent = '✕';
        delBtn.onclick = async () => {
          if (!confirm(`Apagar "${tx.desc || 'lançamento'}"?`)) return;
          try {
            await BISA.api(`/finance/tx?id=${encodeURIComponent(tx.id)}`, { method: 'DELETE' });
            BISA.toast('Lançamento apagado');
            this._render();
          } catch (e) {
            BISA.toast(e.message || 'Erro ao apagar');
          }
        };

        row.append(dateEl, descEl, catEl, amtEl, delBtn);
        card.appendChild(row);
      });

      wrap.appendChild(card);
    },

    // ── Objetivos / perfil ───────────────────────────────────────────────────
    _fillGoals(wrap, profileResp) {
      wrap.innerHTML = '';

      const title = document.createElement('p');
      title.className = 'section-title';
      title.textContent = 'Objetivos e plano';
      wrap.appendChild(title);

      const card = document.createElement('div');
      card.className = 'card';

      const profile = profileResp && profileResp.profile;
      const loans   = (profileResp && profileResp.loans) || [];

      if (!profile) {
        // No profile yet — friendly hint, not an error
        const hint = document.createElement('div');
        hint.className = 'empty';
        hint.innerHTML =
          '<div style="font-size:2rem;margin-bottom:8px">🎯</div>' +
          '<p style="margin:0 0 8px">Ainda sem perfil financeiro configurado.</p>' +
          '<p class="muted" style="margin:0;font-size:.9rem">Peça ao Claude para configurar seus objetivos quando quiser!</p>';
        card.appendChild(hint);
        wrap.appendChild(card);
        return;
      }

      // --- Goals (profile.goals []) ---
      const goals = profile.goals || [];
      if (goals.length > 0) {
        goals.forEach((g) => {
          const goalWrap = document.createElement('div');
          goalWrap.style.marginBottom = '14px';

          const nameRow = document.createElement('div');
          nameRow.className = 'row';
          const name = document.createElement('span');
          name.style.fontWeight = '600';
          name.textContent = g.label || g.name || 'Objetivo';
          const pct = document.createElement('span');
          pct.className = 'muted';
          pct.style.fontSize = '.85rem';
          const ratio = g.target > 0 ? Math.min(1, (g.current || 0) / g.target) : 0;
          pct.textContent = `${brl(g.current || 0)} de ${brl(g.target || 0)}`;
          nameRow.append(name, document.createElement('span'), pct); // spacer
          nameRow.querySelector('span:nth-child(2)').style.flex = '1';

          const barWrap = document.createElement('div');
          barWrap.className = 'fin-progress-wrap';
          const bar = document.createElement('div');
          bar.className = 'fin-progress-bar';
          bar.style.width = `${(ratio * 100).toFixed(1)}%`;
          barWrap.appendChild(bar);

          goalWrap.append(nameRow, barWrap);
          card.appendChild(goalWrap);
        });
      }

      // --- Loans ---
      if (loans.length > 0) {
        if (goals.length > 0) {
          const sep = document.createElement('hr');
          sep.style.border = 'none';
          sep.style.borderTop = '1px solid var(--line)';
          sep.style.margin = '14px 0';
          card.appendChild(sep);
        }

        const loanTitle = document.createElement('p');
        loanTitle.className = 'section-title';
        loanTitle.style.margin = '0 0 10px';
        loanTitle.textContent = 'Financiamentos';
        card.appendChild(loanTitle);

        loans.forEach((l) => {
          const lw = document.createElement('div');
          lw.style.marginBottom = '16px';

          const lname = document.createElement('div');
          lname.style.fontWeight = '600';
          lname.style.marginBottom = '2px';
          lname.textContent = l.label || l.system || 'Financiamento';

          const ratio = l.total > 0 ? Math.min(1, l.paid / l.total) : 0;
          const barWrap = document.createElement('div');
          barWrap.className = 'fin-progress-wrap';
          const bar = document.createElement('div');
          bar.className = 'fin-progress-bar';
          bar.style.background = 'var(--positive)';
          bar.style.width = `${(ratio * 100).toFixed(1)}%`;
          barWrap.appendChild(bar);

          const info = document.createElement('div');
          info.className = 'fin-loan-row';
          const paidSpan = document.createElement('span');
          paidSpan.textContent = `${l.paid} de ${l.total} parcelas pagas`;
          const balSpan = document.createElement('span');
          balSpan.textContent = `Saldo: ${brl(l.balance)}`;
          info.append(paidSpan, balSpan);

          if (l.next) {
            const nextInfo = document.createElement('div');
            nextInfo.className = 'fin-loan-row';
            nextInfo.style.marginTop = '2px';
            const ns = document.createElement('span');
            ns.textContent = `Próx. parcela (nº${l.next.n}): ${fmtDate(l.next.dueDate).replace('/', '/')}`;
            const nv = document.createElement('span');
            nv.style.fontWeight = '600';
            nv.textContent = brl(l.next.value);
            nextInfo.append(ns, nv);
            lw.append(lname, barWrap, info, nextInfo);
          } else {
            lw.append(lname, barWrap, info);
          }

          card.appendChild(lw);
        });
      }

      // If profile exists but has no goals AND no loans
      if (goals.length === 0 && loans.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'muted';
        hint.style.margin = '4px 0';
        hint.textContent = 'Configure seus objetivos com o Claude para ver o progresso aqui.';
        card.appendChild(hint);
      }

      wrap.appendChild(card);
    },

    // ── Investimentos (só aparece se posições existirem) ─────────────────────
    _fillInvestments(wrap, positions) {
      if (!positions || positions.length === 0) return;

      wrap.innerHTML = '';
      const title = document.createElement('p');
      title.className = 'section-title';
      title.textContent = 'Carteira';
      wrap.appendChild(title);

      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '8px 16px';

      positions.forEach((pos) => {
        const row = document.createElement('div');
        row.className = 'fin-tx-row';

        const sym = document.createElement('span');
        sym.style.fontWeight = '700';
        sym.style.minWidth = '60px';
        sym.textContent = pos.symbol || '—';

        const cls = document.createElement('span');
        cls.className = 'fin-tx-cat';
        cls.textContent = pos.assetClass || '';

        const qty = document.createElement('span');
        qty.className = 'fin-tx-desc muted';
        qty.style.fontSize = '.85rem';
        qty.textContent = `${pos.qty || 0} × ${brl(pos.avgPrice || 0)}`;

        const total = document.createElement('span');
        total.className = 'fin-tx-amt';
        total.textContent = brl(pos.totalCost || 0);

        row.append(sym, cls, qty, total);
        card.appendChild(row);
      });

      wrap.appendChild(card);
    },
  };
})();
