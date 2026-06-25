// annotate.js — "Modo Anotar": no iPad (Pencil), ela toca num elemento da tela
// e indica o que mudar via chips de ação (+ detalhe opcional digitado/ditado);
// mandamos pra POST /feedback (inbox que o dev lê no Mac).
// Independente das telas: opera sobre o que estiver em #screen no momento do toque.
// Popover ancorado no elemento tocado (padrão Pencil) — sem fundo escurecido.
(function () {
  if (!window.BISA) return;

  // ── estilos (injeta uma vez) ──────────────────────────────────────────
  const css = `
    #bisa-annot-fab { position:fixed; right:18px; bottom:calc(80px + env(safe-area-inset-bottom));
      z-index:900; width:52px; height:52px; border-radius:50%; border:none; cursor:grab; touch-action:none;
      background:var(--surface); color:var(--ink); box-shadow:var(--shadow); font-size:1.4rem;
      display:flex; align-items:center; justify-content:center; }
    #bisa-annot-fab.on { background:var(--primary); color:var(--primary-ink); }
    #gate.show ~ #bisa-annot-fab, #gate.show ~ #bisa-annot-banner { display:none !important; }
    body.bisa-annot-mode #screen * { cursor:crosshair; }
    .bisa-annot-target { outline:2px solid var(--primary) !important; outline-offset:2px;
      border-radius:4px; }
    #bisa-annot-banner { position:fixed; top:calc(8px + env(safe-area-inset-top)); left:50%;
      transform:translateX(-50%); z-index:900; background:var(--primary); color:var(--primary-ink);
      font-size:.85rem; font-weight:600; padding:7px 14px; border-radius:999px; box-shadow:var(--shadow); }
    .bisa-annot-scrim { position:fixed; inset:0; z-index:1000; background:none; }
    .bisa-annot-pop { position:fixed; z-index:1001; width:320px; max-width:calc(100vw - 24px);
      background:var(--surface); border:1px solid var(--line); border-radius:16px;
      box-shadow:0 10px 34px rgba(0,0,0,.16); padding:14px;
      opacity:0; transition:opacity .14s ease; }   /* só opacidade: transform quebra input no iOS */
    .bisa-annot-pop.open { opacity:1; }
    .bisa-annot-tgt { font-size:.76rem; color:var(--ink-soft); margin-bottom:8px; word-break:break-word; }
    .bisa-annot-tgt b { color:var(--ink); font-weight:600; }
    .bisa-annot-label { font-size:.82rem; color:var(--ink-soft); margin:2px 0 8px; }
    .bisa-annot-chips { display:flex; flex-wrap:wrap; gap:8px; }
    .bisa-annot-chip { min-height:40px; padding:0 14px; border:1px solid var(--line);
      background:var(--surface-2); color:var(--ink); border-radius:999px; font:inherit;
      font-size:.92rem; cursor:pointer; }
    .bisa-annot-chip.on { background:var(--accent-soft); border-color:var(--primary);
      color:var(--primary); font-weight:600; }
    .bisa-annot-detail { width:100%; margin-top:10px; }
    .bisa-annot-acts { display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:12px; }
    .bisa-annot-cancel { min-height:var(--tap); border:1px solid var(--line); background:var(--surface-2);
      color:var(--ink); border-radius:var(--radius-sm); font-weight:600; cursor:pointer; }

    /* Janela de clarificação (pedido ambíguo → análise + opções) */
    .bisa-clar-overlay { position:fixed; inset:0; z-index:1100; background:rgba(0,0,0,.38);
      display:flex; align-items:center; justify-content:center; padding:20px; }
    .bisa-clar-modal { background:var(--surface); border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,.22);
      width:100%; max-width:430px; max-height:86vh; overflow-y:auto; padding:20px; }
    .bisa-clar-action { font-size:.72rem; color:var(--ink-soft); text-transform:uppercase;
      letter-spacing:.06em; font-weight:700; }
    .bisa-clar-title { font-weight:700; font-size:1.1rem; margin:2px 0 6px; }
    .bisa-clar-interp { color:var(--ink); font-size:.96rem; line-height:1.4; margin-bottom:4px; }
    .bisa-clar-in { font-size:.76rem; color:var(--ink-soft); margin-bottom:10px; word-break:break-word; }
    .bisa-clar-in b { color:var(--ink); }
    .bisa-clar-lbl { font-size:.78rem; color:var(--ink-soft); font-weight:600; margin:8px 0 6px; }
    .bisa-clar-opts { display:flex; flex-direction:column; gap:8px; }
    .bisa-clar-opt { text-align:left; min-height:var(--tap); padding:11px 14px; border:1px solid var(--line);
      background:var(--surface-2); color:var(--ink); border-radius:12px; font:inherit; font-size:.95rem; cursor:pointer; }
    .bisa-clar-opt:active { background:var(--accent-soft); border-color:var(--primary); }
    .bisa-clar-other { width:100%; margin-top:10px; }
    .bisa-clar-acts { display:grid; grid-template-columns:1fr 2fr; gap:10px; margin-top:12px; }

    /* Selo "request rodando" (o agente do Modo Anotar está aplicando) */
    #bisa-annot-run { position:fixed; top:calc(8px + env(safe-area-inset-top)); left:50%;
      transform:translateX(-50%); z-index:901; display:none; align-items:center; gap:9px;
      background:var(--surface); color:var(--ink); border:1px solid var(--line); box-shadow:var(--shadow);
      font-size:.84rem; font-weight:600; padding:7px 14px; border-radius:999px; max-width:calc(100vw - 24px); }
    #bisa-annot-run.show { display:flex; }
    #bisa-annot-run .spin { width:14px; height:14px; flex:0 0 auto; border-radius:50%;
      border:2px solid var(--line); border-top-color:var(--primary); animation:bisa-spin .7s linear infinite; }
    #bisa-annot-run .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @keyframes bisa-spin { to { transform:rotate(360deg); } }

    /* Selo "Desfazer" da última mudança aplicada */
    #bisa-annot-undo { position:fixed; left:50%; transform:translateX(-50%);
      bottom:calc(86px + env(safe-area-inset-bottom)); z-index:901; display:none; align-items:center; gap:8px;
      background:var(--ink); color:var(--surface); box-shadow:var(--shadow);
      font-size:.84rem; padding:8px 10px 8px 15px; border-radius:999px; max-width:calc(100vw - 24px); }
    #bisa-annot-undo.show { display:flex; }
    #bisa-annot-undo .u-txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #bisa-annot-undo .u-btn { background:var(--surface); color:var(--ink); border:none; border-radius:999px;
      font:inherit; font-weight:700; font-size:.82rem; padding:5px 13px; min-height:32px; cursor:pointer; flex:0 0 auto; }
    #bisa-annot-undo .u-x { background:none; border:none; color:var(--surface); opacity:.65; cursor:pointer;
      font-size:1rem; padding:2px 4px; flex:0 0 auto; }
  `;
  const st = document.createElement('style');
  st.id = 'bisa-annot-style'; st.textContent = css;
  document.head.appendChild(st);

  // ── helpers ───────────────────────────────────────────────────────────
  const elt = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const screenName = () => (location.hash || '').replace('#', '') || 'hub';

  // Caminho tag.classes do elemento até #screen (curto; basta pro dev achar o código).
  const describe = (el) => {
    const parts = [];
    let n = el, i = 0;
    while (n && n.id !== 'screen' && n !== document.body && i < 4) {
      let sel = n.tagName.toLowerCase();
      // ignora a classe de destaque do próprio modo anotar (não faz parte da UI)
      const cls = n.classList ? Array.from(n.classList).filter((c) => c !== 'bisa-annot-target') : [];
      if (cls.length) sel += '.' + cls.join('.');
      parts.unshift(sel); n = n.parentElement; i++;
    }
    return parts.join(' > ');
  };
  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

  // Contexto: texto do ancestral mais próximo que ACRESCENTA informação (ex.: o
  // rótulo da linha). Essencial p/ componentes repetidos (as 6 barras de envelope
  // têm o mesmo seletor — só o contexto diz qual é "Conforto" vs "Metas").
  const contextOf = (el) => {
    const own = textOf(el);
    let n = el.parentElement, i = 0;
    while (n && n.id !== 'screen' && n !== document.body && i < 3) {
      const t = textOf(n);
      if (t && t.length > own.length + 4 && t.length <= 180) return t;
      n = n.parentElement; i++;
    }
    return '';
  };

  // ── estado ──────────────────────────────────────────────────────────
  let modeOn = false;
  let banner = null;
  let scrim = null, pop = null, keyHandler = null, targetEl = null;
  let clarOverlay = null; // janela de clarificação aberta

  const screenEl = () => document.getElementById('screen');

  function setMode(on) {
    modeOn = on;
    fab.classList.toggle('on', on);
    fab.textContent = on ? '✕' : '✎';
    fab.setAttribute('aria-label', on ? 'Sair do modo anotar' : 'Anotar mudança');
    document.body.classList.toggle('bisa-annot-mode', on);
    if (on && !banner) {
      banner = elt('div', null, 'Modo Anotar — toque no que quer mudar');
      banner.id = 'bisa-annot-banner';
      document.body.appendChild(banner);
    } else if (!on && banner) {
      banner.remove(); banner = null;
    }
    if (!on) closePop();
  }

  // Captura o toque dentro de #screen (fase de captura → vence os onclick das telas).
  function onPick(ev) {
    if (!modeOn || pop) return;
    const t = ev.target;
    if (!t || t.id === 'screen') return;
    ev.preventDefault(); ev.stopPropagation();
    openPop(t, ev.clientX, ev.clientY);
  }

  function openPop(el, x, y) {
    closePop();
    targetEl = el;
    el.classList.add('bisa-annot-target');

    scrim = elt('div', 'bisa-annot-scrim');
    pop = elt('div', 'bisa-annot-pop');

    const tgt = elt('div', 'bisa-annot-tgt');
    const txt = textOf(el);
    tgt.innerHTML = `Tela <b>${screenName()}</b>` + (txt ? ` · "${txt}"` : '');
    pop.appendChild(tgt);

    pop.appendChild(elt('div', 'bisa-annot-label', 'O que fazer aqui?'));

    // Chips de intenção (toques) — caminho rápido, sem digitar. Multi-seleção.
    const chosen = new Set();
    const chips = elt('div', 'bisa-annot-chips');
    [
      ['aumentar', 'Aumentar'], ['diminuir', 'Diminuir'],
      ['mudar a cor', 'Mudar cor'], ['mudar o texto', 'Mudar texto'],
      ['mover/reposicionar', 'Mover'], ['ajustar espaçamento', 'Espaçamento'],
      ['remover', 'Remover'], ['corrigir (está errado)', 'Corrigir'],
    ].forEach(([val, label]) => {
      const chip = elt('button', 'bisa-annot-chip', label);
      chip.onclick = () => {
        const on = chosen.has(val);
        if (on) chosen.delete(val); else chosen.add(val);
        chip.classList.toggle('on', !on);
      };
      chips.appendChild(chip);
    });
    pop.appendChild(chips);

    // Detalhe opcional: digitar OU microfone do teclado (confiável, sem Scribble).
    const detail = elt('input', 'bisa-annot-detail');
    detail.type = 'text';
    detail.placeholder = '+ detalhe (opcional)';
    detail.enterKeyHint = 'send'; // tecla de retorno do teclado vira "enviar"
    detail.setAttribute('aria-label', 'Detalhe opcional da mudança');
    pop.appendChild(detail);

    const acts = elt('div', 'bisa-annot-acts');
    const cancel = elt('button', 'bisa-annot-cancel', 'Cancelar');
    cancel.onclick = closePop;
    const send = elt('button', 'btn', 'Enviar');
    const submit = async () => {
      const extra = detail.value.trim();
      const parts = Array.from(chosen);
      if (parts.length === 0 && !extra) { BISA.toast('Toque numa ação ou escreva um detalhe'); return; }
      const request = [parts.join(', '), extra].filter(Boolean).join(' — ');
      send.disabled = true; send.textContent = 'Enviando…';
      try {
        await BISA.api('/feedback', {
          method: 'POST',
          json: { screen: screenName(), selector: describe(el), elementText: txt, context: contextOf(el), request },
        });
        closePop();
        setMode(false);
        BISA.toast('Anotação enviada ✓');
      } catch (e) {
        send.disabled = false; send.textContent = 'Enviar';
        BISA.toast(e.message || 'Erro ao enviar');
      }
    };
    send.onclick = submit;
    // Enter no teclado envia — o botão Enviar pode ficar coberto pelo teclado no iPad.
    detail.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    acts.append(cancel, send);
    pop.appendChild(acts);

    scrim.onclick = closePop;
    keyHandler = (e) => { if (e.key === 'Escape') closePop(); };
    document.addEventListener('keydown', keyHandler);

    document.body.append(scrim, pop);

    // Posiciona ancorado no elemento tocado (abaixo; vira p/ cima se não couber).
    const r = el.getBoundingClientRect();
    const gap = 8, margin = 12;
    let left = (x != null ? x : r.left + r.width / 2) - pop.offsetWidth / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pop.offsetWidth - margin));
    let top = r.bottom + gap;
    if (top + pop.offsetHeight > window.innerHeight - margin) {
      top = Math.max(margin, r.top - gap - pop.offsetHeight);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    requestAnimationFrame(() => pop.classList.add('open'));
  }

  function closePop() {
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (targetEl) { targetEl.classList.remove('bisa-annot-target'); targetEl = null; }
    if (scrim) { scrim.remove(); scrim = null; }
    const p = pop;
    if (!p) return;
    pop = null;
    p.classList.remove('open');
    setTimeout(() => p.remove(), 160);
  }

  // ── Janela de clarificação ────────────────────────────────────────────
  // O agente do Modo Anotar achou o pedido ambíguo: mostra a análise dele +
  // opções prováveis pra tocar. Tocar uma opção re-aplica com o pedido refinado.
  function closeClarify() { if (clarOverlay) { clarOverlay.remove(); clarOverlay = null; } }

  function showClarify(p) {
    closeClarify();
    const overlay = elt('div', 'bisa-clar-overlay');
    const modal = elt('div', 'bisa-clar-modal');
    overlay.appendChild(modal);

    if (p.action) modal.appendChild(elt('div', 'bisa-clar-action', p.action));
    modal.appendChild(elt('div', 'bisa-clar-title', 'O que você quer fazer?'));
    if (p.interpretation) modal.appendChild(elt('div', 'bisa-clar-interp', p.interpretation));
    if (p.elementText) {
      const e = elt('div', 'bisa-clar-in');
      e.innerHTML = `No elemento: <b>${(p.elementText || '').slice(0, 80)}</b>`;
      modal.appendChild(e);
    }

    const refine = async (request) => {
      try { await BISA.api('/feedback/refine', { method: 'POST', json: { id: p.id, request } }); closeClarify(); BISA.toast('Aplicando…'); }
      catch (e) { BISA.toast(e.message || 'Erro ao aplicar'); }
    };

    modal.appendChild(elt('div', 'bisa-clar-lbl', 'Opções prováveis'));
    const opts = elt('div', 'bisa-clar-opts');
    (p.options || []).forEach((o) => {
      const b = elt('button', 'bisa-clar-opt', o.label);
      b.onclick = () => refine(o.request);
      opts.appendChild(b);
    });
    modal.appendChild(opts);

    const other = elt('input', 'bisa-clar-other');
    other.type = 'text'; other.placeholder = 'Outro — descreva o que quer'; other.enterKeyHint = 'send';
    modal.appendChild(other);

    const acts = elt('div', 'bisa-clar-acts');
    const cancel = elt('button', 'bisa-annot-cancel', 'Cancelar');
    cancel.onclick = closeClarify;
    const apply = elt('button', 'btn', 'Aplicar');
    const submitOther = () => { const v = other.value.trim(); if (!v) { BISA.toast('Escolha uma opção ou descreva'); return; } refine(v); };
    apply.onclick = submitOther;
    other.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitOther(); } });
    acts.append(cancel, apply);
    modal.appendChild(acts);

    overlay.onclick = (e) => { if (e.target === overlay) closeClarify(); };
    clarOverlay = overlay;
    document.body.appendChild(overlay);
  }

  // ── Selo "request rodando" ────────────────────────────────────────────
  const runBadge = elt('div');
  runBadge.id = 'bisa-annot-run';
  runBadge.append(elt('span', 'spin'), elt('span', 'txt', 'Aplicando sua anotação…'));
  document.body.appendChild(runBadge);
  const showRun = (text) => {
    runBadge.querySelector('.txt').textContent = text ? `Aplicando: ${text}` : 'Aplicando sua anotação…';
    runBadge.classList.add('show');
  };
  const hideRun = () => runBadge.classList.remove('show');

  if (BISA.onWs) BISA.onWs((m) => {
    if (!m) return;
    if (m.type === 'annot-status') { if (m.state === 'running') showRun(m.text); else hideRun(); return; }
    if (m.type === 'annot-clarify' && m.payload) { hideRun(); showClarify(m.payload); }
  });

  // ── Selo "Desfazer" da última mudança aplicada ────────────────────────
  const undoBar = elt('div'); undoBar.id = 'bisa-annot-undo';
  const uTxt = elt('span', 'u-txt');
  const uBtn = elt('button', 'u-btn', 'Desfazer');
  const uX = elt('button', 'u-x', '✕');
  undoBar.append(uTxt, uBtn, uX);
  document.body.appendChild(undoBar);
  let undoId = null;
  const hideUndo = () => undoBar.classList.remove('show');
  const showUndo = (item) => {
    undoId = item.id;
    uTxt.textContent = `Aplicado: ${item.request || ''}`;
    uBtn.disabled = false; uBtn.textContent = 'Desfazer';
    undoBar.classList.add('show');
  };
  uBtn.onclick = async () => {
    if (!undoId) return;
    uBtn.disabled = true; uBtn.textContent = 'Desfazendo…';
    try { await BISA.api('/feedback/undo', { method: 'POST', json: { id: undoId } }); } // reload chega via WS
    catch (e) { uBtn.disabled = false; uBtn.textContent = 'Desfazer'; BISA.toast(e.message || 'Não consegui desfazer'); }
  };
  uX.onclick = () => { const id = undoId; hideUndo(); BISA.api('/feedback/seen', { method: 'POST', json: { id } }).catch(() => {}); };

  // Ao carregar: se houver mudança recente aplicada, oferece desfazer.
  BISA.api('/feedback/last').then((r) => { if (r && r.item) showUndo(r.item); }).catch(() => {});

  // ── FAB ───────────────────────────────────────────────────────────────
  const fab = elt('button', null, '✎');
  fab.id = 'bisa-annot-fab';
  fab.setAttribute('aria-label', 'Anotar mudança');
  document.body.appendChild(fab);
  // arrastável + snap-to-edge; toque simples abre/fecha o modo
  BISA.makeDraggableFab(fab, 'bisa_annot_fab_pos', 52, () => setMode(!modeOn));

  // Listener global em fase de captura (o #screen troca de conteúdo a cada tela).
  document.addEventListener('click', (ev) => {
    if (modeOn && screenEl() && screenEl().contains(ev.target)) onPick(ev);
  }, true);
})();
