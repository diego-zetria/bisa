// screens/biso.js — tela "Biso": dirige o biso (workstation Claude Code, :7777)
// pelo iPad, dentro do bisa. Pencil-first.
//
// A aba principal é o CADERNO (write-first): você escreve na pauta com a caneta
// (Scribble → texto), ao pausar surge uma pílula "enviar" com contagem; o texto
// vira pergunta ao Claude (protocolo WS biso.llm.*), a resposta entra como ANOTAÇÃO
// logo abaixo, e chips de follow-up (gerados via claude -p em /biso-followups)
// deixam você avançar só tocando. Demais sub-views (Diário/Arquivos/Buscar/GAIN)
// usam o REST do biso pelo proxy /biso/*. Personalização: temas + menu radial.
//
// NOTA Scribble: keydown NÃO dispara; ouvimos 'input'. Não autoscrollamos durante
// o streaming (achado NN/g). Ver memória notebook-pencil-ai-ux.
(function () {
  // ── Estado do módulo ────────────────────────────────────────────────────
  let currentView = 'caderno';
  let unsub = null;
  let root = null, contentEl = null, radialFab = null;

  // Caderno
  let convo = [];                 // [{role:'user'|'claude', text, html?, tools?, suggestions?}]
  let streaming = null;           // { msg, el } da anotação do Claude em andamento
  let sessionState = 'idle';      // idle | starting | running
  let lastUserText = '';
  let nbScroll = null, nbPage = null, nbInput = null, nbStatus = null, nbInterrupt = null, nbWrap = null, nbFoot = null;
  let pendingEl = null, pendingActive = false, debounceTimer = null, countdownTimer = null, pendingDismiss = null;
  let micActive = false, recognition = null;

  const PAUSE_MS = 1100;          // pausa após escrever p/ surgir a pílula (> ~1s do Scribble)
  const COUNTDOWN = 3;            // segundos da pílula antes do envio automático

  // Radial
  const RADIAL_KEY = 'biso_radial';
  const RADIAL_DEFAULT = [
    { label: '▶ rodar testes', prompt: 'Rode os testes do projeto e me diga o resultado.' },
    { label: 'git status', prompt: 'Mostre o git status e um resumo das mudanças.' },
    { label: '📋 resumo do dia', prompt: 'Resuma o que fiz hoje a partir do journal do biso.' },
    { label: '🔎 explicar', prompt: 'Explique o que este projeto faz, em alto nível.' },
    { label: '🧹 limpar', prompt: 'Liste arquivos temporários/lixo que dá pra limpar (sem apagar nada).' },
    { label: '■ interromper', prompt: '__INTERRUPT__' },
  ];
  function radialCfg() { try { const v = JSON.parse(localStorage.getItem(RADIAL_KEY)); if (Array.isArray(v) && v.length === 6) return v; } catch {} return RADIAL_DEFAULT.slice(); }
  function saveRadial(cfg) { try { localStorage.setItem(RADIAL_KEY, JSON.stringify(cfg)); } catch {} }

  // Tema
  const THEME_KEY = 'biso_theme';
  const THEMES = [{ id: '', name: 'Padrão' }, { id: 'matrix', name: 'Matrix' }, { id: 'escuro', name: 'Escuro' }, { id: 'sepia', name: 'Sépia' }, { id: 'contraste', name: 'Alto contraste' }];
  function currentTheme() { try { return localStorage.getItem(THEME_KEY) || ''; } catch { return ''; } }
  function applyTheme(id) { if (root) root.setAttribute('data-theme', id || ''); try { localStorage.setItem(THEME_KEY, id || ''); } catch {} }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const elx = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const bget = (p) => BISA.api('/biso' + p);
  const bpost = (p, json) => BISA.api('/biso' + p, { method: 'POST', json });

  // Toque confiável p/ Apple Pencil: aciona no pointerdown com preventDefault (mantém
  // o foco do contenteditable e dispara mesmo com teclado aberto), e engole o 'click'
  // fantasma seguinte (evita click-through). Ver memória ipad-pencil-web-findings.
  function onTap(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 700);
      fn(e);
    });
  }

  // ── Shell ──────────────────────────────────────────────────────────────
  const VIEWS = [
    { id: 'caderno', label: 'Caderno' }, { id: 'notas', label: 'Notas' }, { id: 'canvas', label: 'Canvas' }, { id: 'journal', label: 'Diário' },
    { id: 'files', label: 'Arquivos' }, { id: 'ask', label: 'Buscar' }, { id: 'gain', label: 'GAIN' },
  ];

  function renderShell(el) {
    el.style.cssText = 'padding:0;height:100%;max-width:none;margin:0;display:flex;flex-direction:column;overflow:hidden;';
    root = elx('div', 'biso-root');
    root.setAttribute('data-theme', currentTheme());

    const header = elx('div', 'biso-header');
    const title = elx('div', 'biso-title'); title.innerHTML = 'Biso <small>caderno</small>';
    const tabs = elx('div', 'biso-tabs');
    VIEWS.forEach(v => { const b = elx('button', 'biso-tab' + (v.id === currentView ? ' active' : ''), v.label); onTap(b, () => switchView(v.id)); tabs.appendChild(b); });
    const themeBtn = elx('button', 'biso-theme-btn', '🎨'); themeBtn.title = 'Tema'; onTap(themeBtn, openThemePicker);
    header.append(title, tabs, themeBtn);

    contentEl = elx('div', 'biso-content');
    root.append(header, contentEl);
    el.appendChild(root);

    const fab = elx('button', 'biso-radial-fab', '⌗'); fab.title = 'Ações rápidas';
    root.appendChild(fab);
    radialFab = fab;
    // arrastável + snap-to-edge; toque simples abre o menu radial
    BISA.makeDraggableFab(fab, 'biso_radial_fab_pos', 56, openRadial);

    // mitigação swipe-back do Safari na borda esquerda
    root.addEventListener('touchstart', (e) => { const t = e.touches && e.touches[0]; if (t && t.clientX < 20) { try { e.preventDefault(); } catch {} } }, { passive: false });

    renderView();
  }

  function switchView(id) {
    if (id === currentView) return;
    if (currentView === 'notas' && window.BISO_NOTAS) window.BISO_NOTAS.unmount();   // limpa listeners da escrita
    if (currentView === 'canvas' && window.BISO_CANVAS) window.BISO_CANVAS.unmount();
    currentView = id;
    root.querySelectorAll('.biso-tab').forEach((b, i) => b.classList.toggle('active', VIEWS[i].id === id));
    renderView();
  }
  function renderView() {
    clearPending();
    if (currentView !== 'caderno') { nbScroll = nbPage = nbInput = nbStatus = nbInterrupt = nbWrap = nbFoot = null; }
    contentEl.innerHTML = '';
    if (radialFab) radialFab.style.display = (currentView === 'notas' || currentView === 'canvas') ? 'none' : '';   // FAB de ações é do dev-chat
    if (currentView === 'caderno') renderNotebook();
    else if (currentView === 'notas') { if (window.BISO_NOTAS) window.BISO_NOTAS.mount(contentEl); else contentEl.innerHTML = '<p class="biso-muted" style="padding:20px">notas.js não carregou.</p>'; }
    else if (currentView === 'canvas') { if (window.BISO_CANVAS) window.BISO_CANVAS.mount(contentEl); else contentEl.innerHTML = '<p class="biso-muted" style="padding:20px">canvas.js não carregou.</p>'; }
    else if (currentView === 'journal') renderJournal();
    else if (currentView === 'files') renderFiles();
    else if (currentView === 'ask') renderAsk();
    else if (currentView === 'gain') renderGain();
  }

  // ── CADERNO ────────────────────────────────────────────────────────────
  function renderNotebook() {
    const wrap = elx('div', 'biso-nb');
    const scroll = elx('div', 'biso-nb-scroll');
    const page = elx('div', 'biso-nb-page');
    scroll.appendChild(page);
    const foot = elx('div', 'biso-nb-foot');
    foot.innerHTML = `<button class="biso-icon-btn" data-mic title="Falar">🎤</button>
      <span class="biso-nb-status" data-status></span><span class="spacer" style="flex:1"></span>
      <button class="biso-interrupt-btn" data-int style="display:none">■ parar</button>`;
    wrap.append(scroll, foot);
    contentEl.appendChild(wrap);

    nbScroll = scroll; nbPage = page; nbWrap = wrap; nbFoot = foot;
    nbStatus = foot.querySelector('[data-status]');
    nbInterrupt = foot.querySelector('[data-int]');
    onTap(nbInterrupt, () => BISA.wsSend({ type: 'biso.llm.interrupt' }));
    setupVoice(foot.querySelector('[data-mic]'));

    // reconstrói o histórico
    let lastClaudeEl = null;
    convo.forEach(m => {
      if (m.role === 'user') { page.appendChild(entryUserEl(m.text)); return; }
      const live = !!(streaming && m === streaming.msg);
      const card = entryClaudeEl(m, live); page.appendChild(card);
      if (live) { lastClaudeEl = card; }
      else { m.cardEl = card; fillChips(card, m); }   // resposta finalizada → chips no rodapé do card
    });

    // linha viva (Scribble escreve aqui)
    nbInput = elx('div', 'biso-nb-input biso-nb-entry');
    nbInput.setAttribute('contenteditable', 'true');
    nbInput.setAttribute('data-ph', '✎ Escreva em qualquer lugar para começar…');
    nbInput.setAttribute('autocapitalize', 'sentences');
    nbInput.setAttribute('spellcheck', 'false');
    page.appendChild(nbInput);
    // IMPORTANTE: 'input' (não keydown) — é o que o Scribble dispara
    nbInput.addEventListener('input', () => { clearPending(); scheduleDebounce(); });
    nbInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitFromInput(); } });

    setupNbGestures(scroll);

    // se havia um stream em andamento, re-vincula o alvo
    if (streaming && convo.length && convo[convo.length - 1].role === 'claude') streaming.el = lastClaudeEl;
    setStatus(sessionState);
    updateEmptyState();
    scroll.scrollTop = scroll.scrollHeight;
  }

  function entryUserEl(text) { const d = elx('div', 'biso-nb-entry user'); d.textContent = text; return d; }
  // card "canvas" flutuante: cabeçalho (✦ Claude + tags de ferramenta) · corpo · rodapé (chips)
  function entryClaudeEl(msg, live) {
    const card = elx('div', 'biso-resp');
    card.innerHTML = '<div class="resp-head"><span class="resp-who">✦ Claude</span><span class="resp-tools"></span></div><div class="resp-body"></div><div class="resp-foot"></div>';
    paintClaude(card, msg, live);
    return card;
  }
  function toolChips(tools) { return (tools || []).map(t => `<span class="biso-nb-tool ${t.status === 'done' ? 'done' : ''}">${t.status === 'done' ? '✓' : '🔧'} ${esc(t.summaryPt || t.name || 'ferramenta')}</span>`).join(''); }
  function paintClaude(card, msg, live) {
    const toolsEl = card.querySelector('.resp-tools');
    const body = card.querySelector('.resp-body');
    if (toolsEl) toolsEl.innerHTML = toolChips(msg.tools);
    if (body) body.innerHTML = (BISA.renderMarkdown(msg.text || '') || (live ? '' : '<span class="biso-muted">…</span>')) + (live ? '<span class="biso-nb-cursor"></span>' : '');
  }
  // preenche o rodapé do card com chips de sugestão + a opção de ESCREVER (inline)
  function fillChips(card, msg) {
    const foot = card.querySelector('.resp-foot');
    if (!foot) return;
    foot.innerHTML = '';
    (msg.suggestions || []).forEach(s => { const b = elx('button', 'biso-nb-chip', s); onTap(b, () => commitText(s)); foot.appendChild(b); });
    const w = elx('button', 'biso-nb-chip biso-nb-chip-write', '✎ Escrever…');
    onTap(w, () => openWriteInline(card));
    foot.appendChild(w);
  }

  // estado inicial = captura grande "escreva em qualquer lugar" (sem pauta);
  // assim que há conversa, vira caderno (pauta + linha de entrada compacta).
  function updateEmptyState() { if (nbWrap) nbWrap.classList.toggle('empty', convo.length === 0); }

  function setStatus(s) {
    sessionState = s;
    const lbl = { idle: '', starting: 'iniciando…', running: 'Claude está pensando…' }[s] || '';
    if (nbStatus) nbStatus.textContent = lbl;
    if (nbInterrupt) nbInterrupt.style.display = (s === 'running' || s === 'starting') ? '' : 'none';
  }

  // pílula pendente (pausa → enviar)
  function scheduleDebounce() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (nbInput && nbInput.innerText.trim() && sessionState === 'idle' && !pendingActive) showPending();
    }, PAUSE_MS);
  }
  function showPending() {
    pendingActive = true;
    let n = COUNTDOWN;
    const preview = (nbInput ? nbInput.innerText.trim() : '').slice(0, 50);
    pendingEl = elx('div', 'biso-nb-pending');
    pendingEl.innerHTML = `<span class="lbl">Enviar: “${esc(preview)}”</span><span class="ring">◷ ${n}</span><button class="go">Enviar agora</button><button class="cancel">Cancelar</button>`;
    // barra própria acima do rodapé — NÃO sobrepõe a linha de escrita, então o toque
    // cai no botão (não no caderno atrás). Resolve o caret pulando ao tocar Cancelar.
    if (nbWrap && nbFoot) nbWrap.insertBefore(pendingEl, nbFoot);
    onTap(pendingEl.querySelector('.go'), commitFromInput);
    onTap(pendingEl.querySelector('.cancel'), () => clearPending());
    // Pílula = popover: tocar FORA dela (ex.: errar o ✕ e acertar a linha) cancela o
    // pendente — assim não dispara envio por engano nem é surpresa. (fase de captura,
    // roda antes do caret ser colocado pela linha tocada)
    pendingDismiss = (e) => { if (pendingEl && !pendingEl.contains(e.target)) clearPending(); };
    document.addEventListener('pointerdown', pendingDismiss, true);
    nbScroll.scrollTop = nbScroll.scrollHeight;
    countdownTimer = setInterval(() => {
      n--;
      if (n <= 0) { commitFromInput(); return; }
      const r = pendingEl && pendingEl.querySelector('.ring'); if (r) r.textContent = '◷ ' + n;
    }, 1000);
  }
  function clearPending() {
    pendingActive = false;
    clearInterval(countdownTimer); clearTimeout(debounceTimer);
    if (pendingDismiss) { document.removeEventListener('pointerdown', pendingDismiss, true); pendingDismiss = null; }
    if (pendingEl) { pendingEl.remove(); pendingEl = null; }
  }
  function commitFromInput() { const t = nbInput ? nbInput.innerText.trim() : ''; clearPending(); if (t) commitText(t); }

  // envia um texto: vira entrada do usuário + cria a anotação do Claude (streaming)
  function commitText(text) {
    text = (text || '').trim(); if (!text) return;
    if (sessionState === 'running' || sessionState === 'starting') { BISA.toast('Aguarde o Claude terminar.'); return; }
    if (currentView !== 'caderno') switchView('caderno');
    clearPending();
    lastUserText = text;

    convo.push({ role: 'user', text });
    const ue = entryUserEl(text);
    nbPage.insertBefore(ue, nbInput);
    if (nbInput) nbInput.innerHTML = '';

    const cmsg = { role: 'claude', text: '', html: '', tools: [], suggestions: [] };
    convo.push(cmsg);
    const cel = entryClaudeEl(cmsg, true);
    nbPage.insertBefore(cel, nbInput);
    streaming = { msg: cmsg, el: cel };
    updateEmptyState();   // saiu do estado inicial → vira caderno

    setStatus('running');
    BISA.wsSend({ type: 'biso.llm.send', text });
    // mostra a pergunta + começo da resposta UMA vez; não autoscrolla durante o stream
    ue.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ── WS (biso.llm.*) ───────────────────────────────────────────────────
  function handleWs(ev) {
    if (!ev || typeof ev.type !== 'string' || !ev.type.startsWith('biso.llm')) return;
    switch (ev.type) {
      case 'biso.llm.state': setStatus(ev.state); break;
      case 'biso.llm.text': if (ev.delta) streamDelta(ev.delta); break;
      case 'biso.llm.tool': streamTool(ev); break;
      case 'biso.llm.done': finalizeStream(); break;
      case 'biso.llm.error': errorStream(ev.message); break;
    }
  }
  function streamDelta(delta) {
    if (!streaming) return;
    streaming.msg.text += delta;
    if (streaming.el) paintClaude(streaming.el, streaming.msg, true);  // sem scroll (achado NN/g)
  }
  function streamTool(ev) {
    if (!streaming) return;
    const tools = streaming.msg.tools;
    const i = tools.findIndex(t => t.name === ev.name && t.status === 'start');
    if (i >= 0) tools[i] = Object.assign({}, tools[i], ev); else tools.push(ev);
    if (streaming.el) paintClaude(streaming.el, streaming.msg, true);
  }
  function finalizeStream() {
    if (streaming && streaming.el) paintClaude(streaming.el, streaming.msg, false);
    const done = streaming;
    streaming = null;
    setStatus('idle');
    if (done && done.msg && done.el) {
      done.msg.cardEl = done.el;
      fillChips(done.el, done.msg);   // rodapé do card com a opção "Escrever…" (mesmo sem sugestões ainda)
      fetchFollowups(done.msg);
    }
  }
  function errorStream(message) {
    if (streaming && streaming.el) paintClaude(streaming.el, streaming.msg, false);
    streaming = null;
    setStatus('idle');
    if (nbPage && nbInput) { const e = elx('div', 'biso-nb-err', '⚠ ' + (message || 'Erro.')); nbPage.insertBefore(e, nbInput); }
  }

  // chips de follow-up via /biso-followups (claude -p curto)
  async function fetchFollowups(claudeMsg) {
    const user = lastUserText, assistant = claudeMsg.text || '';
    if (!assistant.trim()) return;
    try {
      const r = await BISA.api('/biso-followups', { method: 'POST', json: { user, assistant } });
      const sug = (r && Array.isArray(r.suggestions)) ? r.suggestions.slice(0, 3) : [];
      if (!sug.length) return;
      claudeMsg.suggestions = sug;
      // atualiza o rodapé do card já existente (preserva a opção "Escrever…")
      if (claudeMsg.cardEl && claudeMsg.cardEl.isConnected) fillChips(claudeMsg.cardEl, claudeMsg);
    } catch {}
  }

  // gestos: 2 dedos = interromper
  function setupNbGestures(target) {
    let maxF = 0, t0 = 0, moved = false, sx = 0, sy = 0;
    target.addEventListener('touchstart', (e) => { maxF = Math.max(maxF, e.touches.length); if (e.touches.length === 1) { t0 = Date.now(); moved = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
    target.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t && (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12)) moved = true; }, { passive: true });
    target.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        if (Date.now() - t0 < 350 && !moved && maxF === 2 && (sessionState === 'running' || sessionState === 'starting')) { BISA.wsSend({ type: 'biso.llm.interrupt' }); BISA.toast('Interrompido (2 dedos).'); }
        maxF = 0;
      }
    }, { passive: true });
  }

  function setupVoice(micBtn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { micBtn.style.display = 'none'; return; }
    recognition = new SR(); recognition.lang = 'pt-BR'; recognition.continuous = false; recognition.interimResults = false;
    recognition.onresult = (e) => { const tr = e.results[0][0].transcript; if (nbInput) { nbInput.textContent = (nbInput.textContent ? nbInput.textContent + ' ' : '') + tr; clearPending(); scheduleDebounce(); } };
    recognition.onend = () => { micActive = false; micBtn.classList.remove('active'); };
    recognition.onerror = () => { micActive = false; micBtn.classList.remove('active'); };
    onTap(micBtn, () => { if (micActive) recognition.stop(); else { recognition.start(); micActive = true; micBtn.classList.add('active'); } });
  }

  // ── DIÁRIO (codex do biso) ───────────────────────────────────────────────
  async function renderJournal() {
    const scroll = elx('div', 'biso-scroll'); scroll.innerHTML = '<p class="biso-muted">Carregando diário do biso…</p>'; contentEl.appendChild(scroll);
    try {
      const data = await bget('/codex/today');
      scroll.innerHTML = '';
      const day = data.day || {};
      const h = elx('h2'); h.style.margin = '0 0 12px'; h.textContent = '📔 ' + (data.date || 'hoje'); scroll.appendChild(h);
      const sec = (day.sections) ? day.sections : day; // tolera formatos
      renderDaySection(scroll, 'Metas', sec.goals, 'goals');
      renderDaySection(scroll, 'Agenda', sec.agenda, 'agenda');
      renderDaySection(scroll, 'Log', sec.log, 'log');
      renderProse(scroll, 'Briefing', sec.briefing);
      renderProse(scroll, 'Reflexão', sec.reflection);
      const add = elx('div', 'biso-card'); add.innerHTML = '<h3>Anotar no log</h3>';
      const inp = elx('input', 'biso-input'); inp.placeholder = 'Nova entrada…';
      const btn = elx('button', 'biso-btn', 'Adicionar'); btn.style.marginTop = '8px';
      onTap(btn, async () => { const text = inp.value.trim(); if (!text) return; btn.disabled = true; try { await bpost('/codex/append', { section: 'log', item: { text } }); inp.value = ''; renderJournal(); } catch (e) { BISA.toast('Erro: ' + e.message); btn.disabled = false; } });
      add.append(inp, btn); scroll.appendChild(add);
    } catch (e) { scroll.innerHTML = `<p class="biso-muted">Não consegui falar com o biso (${esc(e.message)}). Ele está rodando na porta 7777?</p>`; }
  }
  function renderDaySection(parent, title, items, section) {
    if (!Array.isArray(items) || !items.length) return;
    parent.appendChild(elx('div', 'biso-sec-title', title));
    const card = elx('div', 'biso-card');
    items.forEach(it => {
      const li = elx('div', 'biso-li');
      if (section === 'goals') {
        const chk = elx('div', 'biso-check' + (it.done ? ' done' : ''), it.done ? '✓' : '');
        onTap(chk, async () => { try { await bpost('/codex/toggle', { id: it.id }); renderJournal(); } catch (e) { BISA.toast('Erro: ' + e.message); } });
        li.append(chk, elx('div', null, it.text));
      } else { if (it.time) li.appendChild(elx('div', 't', it.time)); li.appendChild(elx('div', null, it.text)); }
      card.appendChild(li);
    });
    parent.appendChild(card);
  }
  function renderProse(parent, title, md) { if (!md || !String(md).trim()) return; parent.appendChild(elx('div', 'biso-sec-title', title)); const card = elx('div', 'biso-card'); card.innerHTML = BISA.renderMarkdown(String(md)); parent.appendChild(card); }

  // ── ARQUIVOS ────────────────────────────────────────────────────────────
  function renderFiles() {
    const wrap = elx('div', 'biso-files');
    wrap.innerHTML = `
      <div class="biso-files-bar"><button class="biso-btn ghost" data-up title="Subir">↰</button>
        <div class="biso-muted" data-path style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--biso-mono);font-size:.82rem">.</div></div>
      <div class="biso-files-body"><div class="biso-tree"></div>
        <div class="biso-fileview"><p class="biso-muted" style="padding:16px">Selecione um arquivo.</p></div></div>`;
    contentEl.appendChild(wrap);
    const tree = wrap.querySelector('.biso-tree'), view = wrap.querySelector('.biso-fileview'), pathLbl = wrap.querySelector('[data-path]');
    let cur = '.';
    async function list(rel) {
      cur = rel; pathLbl.textContent = rel; tree.innerHTML = '<p class="biso-muted" style="padding:14px">…</p>';
      try {
        const data = await bget('/fs/list?path=' + encodeURIComponent(rel));
        tree.innerHTML = '';
        (data.entries || []).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)).forEach(en => {
          const li = elx('div', 'biso-li'); li.appendChild(elx('div', null, (en.dir ? '📁 ' : '📄 ') + en.name)); li.onclick = () => en.dir ? list(en.rel) : openFile(en.rel, view); tree.appendChild(li);
        });
        if (!data.entries || !data.entries.length) tree.innerHTML = '<p class="biso-muted" style="padding:14px">vazio</p>';
      } catch (e) { tree.innerHTML = `<p class="biso-muted" style="padding:14px">erro: ${esc(e.message)}</p>`; }
    }
    onTap(wrap.querySelector('[data-up]'), () => { if (cur === '.' || cur === '') return; const p = cur.split('/'); p.pop(); list(p.join('/') || '.'); });
    list('.');
  }
  async function openFile(rel, view) {
    view.innerHTML = '<p class="biso-muted" style="padding:16px">abrindo…</p>';
    try {
      const data = await bget('/file?path=' + encodeURIComponent(rel));
      if (data.binary) { view.innerHTML = `<p class="biso-muted" style="padding:16px">Binário (${data.size} bytes) — não editável aqui.</p>`; return; }
      view.innerHTML = '';
      const bar = elx('div', 'biso-files-bar'); bar.appendChild(elx('div', 'biso-muted', rel.split('/').pop())); const sp = elx('div'); sp.style.flex = '1'; bar.appendChild(sp);
      const saveBtn = elx('button', 'biso-btn', 'Salvar'); bar.appendChild(saveBtn);
      const ta = elx('textarea', 'biso-editor'); ta.value = data.content || ''; ta.spellcheck = false;
      onTap(saveBtn, async () => { saveBtn.disabled = true; try { await bpost('/fs/write', { path: rel, content: ta.value, ifMtimeMs: data.mtimeMs }); BISA.toast('Salvo ✓'); } catch (e) { BISA.toast('Erro ao salvar: ' + e.message); } saveBtn.disabled = false; });
      view.append(bar, ta);
    } catch (e) { view.innerHTML = `<p class="biso-muted" style="padding:16px">erro: ${esc(e.message)}</p>`; }
  }

  // ── BUSCAR (echoes/ask do biso) ──────────────────────────────────────────
  function renderAsk() {
    const scroll = elx('div', 'biso-scroll');
    scroll.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><input class="biso-input" data-q placeholder="Buscar no journal do biso… (tags, palavras)"><button class="biso-btn" data-go>Buscar</button></div><div data-results style="margin-top:14px"></div>`;
    contentEl.appendChild(scroll);
    const q = scroll.querySelector('[data-q]'), results = scroll.querySelector('[data-results]');
    async function run() {
      const term = q.value.trim(); if (!term) return; results.innerHTML = '<p class="biso-muted">Buscando…</p>';
      try {
        const data = await bget('/codex/echoes?q=' + encodeURIComponent(term) + '&limit=10');
        const rows = data.results || [];
        if (!rows.length) { results.innerHTML = '<p class="biso-muted">Nada encontrado.</p>'; return; }
        results.innerHTML = '';
        rows.forEach(r => { const card = elx('div', 'biso-card'); card.innerHTML = `<div class="biso-muted" style="font-size:.78rem;margin-bottom:4px">${esc(r.date || '')} · ${esc(r.section || '')}${r.score ? ' · score ' + r.score.toFixed(2) : ''}</div>`; card.appendChild(elx('div', null, r.text || '')); results.appendChild(card); });
      } catch (e) { results.innerHTML = `<p class="biso-muted">erro: ${esc(e.message)}</p>`; }
    }
    onTap(scroll.querySelector('[data-go]'), run);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }

  // ── GAIN (tokens/custo) ──────────────────────────────────────────────────
  async function renderGain() {
    const scroll = elx('div', 'biso-scroll'); scroll.innerHTML = '<p class="biso-muted">Carregando GAIN…</p>'; contentEl.appendChild(scroll);
    try {
      const [today, hist] = await Promise.all([bget('/codex/gain/today').catch(() => null), bget('/codex/gain/history?days=14').catch(() => null)]);
      scroll.innerHTML = '';
      if (today) {
        const c = elx('div', 'biso-card'); const t = today.totals || {};
        c.innerHTML = `<h3>Hoje</h3><div class="row" style="gap:18px;flex-wrap:wrap">
          <div><div class="biso-muted" style="font-size:.75rem">custo</div><div style="font-size:1.3rem;font-weight:700">$${(today.estCostUSD || 0).toFixed(2)}</div></div>
          <div><div class="biso-muted" style="font-size:.75rem">sessões</div><div style="font-size:1.3rem;font-weight:700">${today.sessionsToday || 0}</div></div>
          <div><div class="biso-muted" style="font-size:.75rem">in/out</div><div style="font-size:1.05rem">${fmtK(t.input)} / ${fmtK(t.output)}</div></div>
          <div><div class="biso-muted" style="font-size:.75rem">cache hit</div><div style="font-size:1.05rem">${today.cacheHitPct != null ? Math.round(today.cacheHitPct) + '%' : '—'}</div></div></div>`;
        scroll.appendChild(c);
      }
      if (hist && Array.isArray(hist.history) && hist.history.length) {
        scroll.appendChild(elx('div', 'biso-sec-title', 'Últimos 14 dias'));
        const card = elx('div', 'biso-card'); const max = Math.max(...hist.history.map(d => d.estCostUSD || 0), 0.01);
        hist.history.forEach(d => {
          const row = elx('div', 'biso-bar-row'); const dl = elx('div', 'biso-muted', (d.date || '').slice(5)); dl.style.cssText = 'min-width:42px;font-size:.75rem'; row.appendChild(dl);
          const bg = elx('div', 'biso-bar-bg'); const bar = elx('div', 'biso-bar'); bar.style.width = Math.round((d.estCostUSD || 0) / max * 100) + '%'; bg.appendChild(bar); row.appendChild(bg);
          const v = elx('div', null, '$' + (d.estCostUSD || 0).toFixed(2)); v.style.cssText = 'min-width:54px;text-align:right;font-size:.8rem'; row.appendChild(v); card.appendChild(row);
        });
        if (hist.estCostUSD != null) { const tot = elx('div', 'biso-muted', 'Total: $' + hist.estCostUSD.toFixed(2)); tot.style.cssText = 'margin-top:8px;font-size:.82rem'; card.appendChild(tot); }
        scroll.appendChild(card);
      }
      if (!today && !hist) scroll.innerHTML = '<p class="biso-muted">Sem dados de GAIN (o biso lê os transcripts de ~/.claude).</p>';
    } catch (e) { scroll.innerHTML = `<p class="biso-muted">erro: ${esc(e.message)}</p>`; }
  }
  function fmtK(n) { n = n || 0; return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

  // ── Menu radial (Pencil) ──────────────────────────────────────────────────
  // separa um ícone (símbolo/emoji inicial) do rótulo p/ os tiles da grade
  function tileParts(label) {
    const first = (label || '').trim().split(/\s+/)[0] || '';
    if (first && !/^[\p{L}\p{N}]/u.test(first)) return { icon: first, text: label.slice(first.length).trim() || label };
    return { icon: '•', text: label };
  }
  function openRadial() {
    const cfg = radialCfg();
    const ov = elx('div', 'biso-radial-overlay show');
    const card = elx('div', 'biso-actions-card');
    cfg.forEach((slot) => {
      const { icon, text } = tileParts(slot.label);
      const tile = elx('button', 'biso-action-tile');
      tile.innerHTML = `<span class="ic">${esc(icon)}</span><span class="lb">${esc(text)}</span>`;
      onTap(tile, () => { ov.remove(); runSlot(slot); });
      card.appendChild(tile);
    });
    const edit = elx('button', 'biso-action-tile edit');
    edit.innerHTML = '<span class="ic">✎</span><span class="lb">editar</span>';
    onTap(edit, () => { ov.remove(); editRadial(); });
    card.appendChild(edit);
    ov.appendChild(card);
    document.body.appendChild(ov);
    // posiciona o cartão junto ao FAB, abrindo p/ dentro da tela
    const fr = radialFab ? radialFab.getBoundingClientRect() : null;
    const M = 8, cw = card.offsetWidth, ch = card.offsetHeight;
    let left, top;
    if (fr) {
      const onRight = fr.left + fr.width / 2 > window.innerWidth / 2;
      const onBottom = fr.top + fr.height / 2 > window.innerHeight / 2;
      left = onRight ? (fr.right - cw) : fr.left;
      top = onBottom ? (fr.top - ch - 10) : (fr.bottom + 10);
    } else { left = window.innerWidth - cw - 16; top = window.innerHeight - ch - 90; }
    card.style.left = Math.max(M, Math.min(window.innerWidth - cw - M, left)) + 'px';
    card.style.top = Math.max(M, Math.min(window.innerHeight - ch - M, top)) + 'px';
    ov.onclick = () => ov.remove(); card.onclick = (e) => e.stopPropagation();
  }
  function runSlot(slot) { if (slot.prompt === '__INTERRUPT__') { BISA.wsSend({ type: 'biso.llm.interrupt' }); BISA.toast('Interrompido.'); return; } commitText(slot.prompt); }
  function editRadial() {
    const cfg = radialCfg(); const ov = elx('div', 'biso-radial-overlay show');
    const panel = elx('div', 'biso-card'); panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,460px);max-height:80vh;overflow:auto;background:var(--biso-surface)';
    panel.innerHTML = '<h3>Ações rápidas (radial)</h3>'; const inputs = [];
    cfg.forEach((slot) => { const row = elx('div'); row.style.marginBottom = '10px'; const l = elx('input', 'biso-input'); l.value = slot.label; l.placeholder = 'rótulo'; l.style.marginBottom = '4px'; const p = elx('input', 'biso-input'); p.value = slot.prompt; p.placeholder = 'prompt (ou __INTERRUPT__)'; row.append(l, p); panel.appendChild(row); inputs.push([l, p]); });
    const save = elx('button', 'biso-btn', 'Salvar'); save.style.width = '100%';
    onTap(save, () => { saveRadial(inputs.map(([l, p]) => ({ label: l.value.trim() || '—', prompt: p.value }))); ov.remove(); BISA.toast('Ações salvas.'); });
    panel.appendChild(save); ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation(); document.body.appendChild(ov);
  }

  // ── Popup de escrita (resposta à mão) ──────────────────────────────────────
  // Aberto pelo chip "✎ Escrever…": área grande contenteditable onde o Scribble
  // escreve em qualquer ponto; "Enviar" manda como próxima mensagem.
  // cartão de escrita INLINE — aparece logo abaixo da resposta (em contexto), com
  // borda/fundo claros e Enviar/Cancelar presos nele. Sem foco automático (Scribble).
  function openWriteInline(afterRow) {
    const existing = nbPage && nbPage.querySelector('.biso-write-card');
    if (existing) { existing.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const card = elx('div', 'biso-write-card');
    card.innerHTML = `
      <div class="biso-write-box" contenteditable="true" data-ph="✎ Escreva sua resposta aqui…" spellcheck="false"></div>
      <div class="biso-write-actions">
        <button class="biso-btn biso-write-send">Enviar ↑</button>
        <button class="biso-btn ghost biso-write-cancel">Cancelar</button>
      </div>`;
    if (afterRow && afterRow.parentNode) afterRow.parentNode.insertBefore(card, afterRow.nextSibling);
    else if (nbPage && nbInput) nbPage.insertBefore(card, nbInput);
    const box = card.querySelector('.biso-write-box');
    onTap(card.querySelector('.biso-write-send'), () => { const t = box.innerText.trim(); card.remove(); if (t) commitText(t); });
    onTap(card.querySelector('.biso-write-cancel'), () => card.remove());
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── Tema ──────────────────────────────────────────────────────────────────
  function openThemePicker() {
    const ov = elx('div', 'biso-radial-overlay show');
    const panel = elx('div', 'biso-card'); panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(86vw,360px);background:var(--biso-surface)';
    panel.innerHTML = '<h3>Tema</h3>'; const cur = currentTheme();
    THEMES.forEach(t => { const b = elx('button', 'biso-btn ' + (t.id === cur ? '' : 'ghost'), t.name); b.style.cssText = 'width:100%;margin-bottom:8px'; onTap(b, () => { applyTheme(t.id); ov.remove(); }); panel.appendChild(b); });
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation(); document.body.appendChild(ov);
  }

  // ── Registro da tela ──────────────────────────────────────────────────────
  window.BISA.screens['biso'] = {
    mount(el) { unsub = BISA.onWs(handleWs); renderShell(el); },
    unmount() {
      if (unsub) { unsub(); unsub = null; }
      if (recognition && micActive) { try { recognition.stop(); } catch {} }
      clearPending();
      if (currentView === 'notas' && window.BISO_NOTAS) window.BISO_NOTAS.unmount();
      if (currentView === 'canvas' && window.BISO_CANVAS) window.BISO_CANVAS.unmount();
      document.querySelectorAll('.biso-radial-overlay, .notas-ov, .cv-ov').forEach(o => o.remove());
      convo = []; streaming = null; sessionState = 'idle';
      root = contentEl = nbScroll = nbPage = nbInput = nbStatus = nbInterrupt = nbWrap = nbFoot = null; micActive = false;
    },
  };
})();
