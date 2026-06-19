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
      z-index:900; width:52px; height:52px; border-radius:50%; border:none; cursor:pointer;
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

  // ── estado ──────────────────────────────────────────────────────────
  let modeOn = false;
  let banner = null;
  let scrim = null, pop = null, keyHandler = null, targetEl = null;

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
          json: { screen: screenName(), selector: describe(el), elementText: txt, request },
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

  // ── FAB ───────────────────────────────────────────────────────────────
  const fab = elt('button', null, '✎');
  fab.id = 'bisa-annot-fab';
  fab.setAttribute('aria-label', 'Anotar mudança');
  fab.onclick = () => setMode(!modeOn);
  document.body.appendChild(fab);

  // Listener global em fase de captura (o #screen troca de conteúdo a cada tela).
  document.addEventListener('click', (ev) => {
    if (modeOn && screenEl() && screenEl().contains(ev.target)) onPick(ev);
  }, true);
})();
