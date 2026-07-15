// screens/biso.js — tela "Biso": dirige o biso (workstation Claude Code, :7777)
// pelo iPad, dentro do bisa. Pencil-first.
//
// A aba principal é o CADERNO (write-first, visual "cyberdeck" do gate): um
// CONSOLE de escrita fixo no TOPO onde a caneta escreve (Scribble → texto); o
// envio é SEMPRE manual — botão "Enviar ↑" no console (ou Enter), sem pílula
// nem contagem automática (removidas a pedido, 2026-07-02). O texto vira
// pergunta ao Claude (protocolo WS biso.llm.*) e a troca vai APARECENDO no
// transcript na parte de baixo, com chips de follow-up (claude -p em
// /biso-followups) p/ avançar só tocando. Demais sub-views (Diário/Arquivos/
// Buscar/GAIN) usam o REST do biso pelo proxy /biso/*. Temas + menu radial.
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

  // ── Persistência do transcript (localStorage, por dispositivo) ────────────
  // A sessão do Claude sobrevive no Mac via --resume, mas `convo` morria a cada
  // reload — o caderno abria vazio conversando com um Claude que lembrava de
  // tudo. Guarda os últimos 60 turnos (sem refs de DOM) e re-hidrata no mount.
  const CONVO_KEY = 'biso.convo.v1';
  function saveConvo() {
    try {
      const slim = convo.slice(-60).map((m) => (m.role === 'user'
        ? { role: 'user', text: m.text }
        : { role: 'claude', text: m.text, tools: m.tools || [], suggestions: m.suggestions || [] }));
      localStorage.setItem(CONVO_KEY, JSON.stringify({ focus: chatFocus.current, convo: slim }));
    } catch {}
  }
  function restoreConvo() {
    if (convo.length) return;   // já tem conversa nesta visita — não sobrescreve
    try {
      const v = JSON.parse(localStorage.getItem(CONVO_KEY));
      if (v && Array.isArray(v.convo) && v.convo.length) convo = v.convo;
    } catch {}
  }
  let streaming = null;           // { msg, el } da anotação do Claude em andamento
  let streamRaf = 0;              // rAF pendente do repaint do stream (1 flush/frame)
  let sessionState = 'idle';      // idle | starting | running
  let lastUserText = '';
  let nbScroll = null, nbPage = null, nbStatus = null, nbInterrupt = null, nbWrap = null, nbFoot = null;
  let respPill = null, respPillScroll = null;      // pílula "↓ resposta pronta"
  let runTimer = 0, runT0 = 0, curTool = null, curToolDetail = null;   // cronômetro + ferramenta corrente (+input)
  let speaking = null;                             // TTS: {btn} do card falando
  let selChip = null, selHandler = null, selTimer = 0;  // "✎ usar trecho" (seleção)
  // Foco do caderno (projeto da sessão): 'geral' ou um id de projeto do biso.
  // Trocar o foco limpa o transcript local — cada foco tem sessão --resume própria.
  let chatFocus = { current: 'geral', projects: [] };

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

  // Tema do CADERNO (independente do tema do shell): '' = Tinta · dia (Flexoki),
  // 'noite' = Tinta · noite, 'deck' = cyberdeck néon legado. Alternador ◐ no rodapé.
  const NB_THEME_KEY = 'biso.nb.theme';
  const NB_THEMES = [{ id: '', name: 'Tinta · dia' }, { id: 'noite', name: 'Tinta · noite' }, { id: 'deck', name: 'Cyberdeck' }];
  function nbTheme() { try { return localStorage.getItem(NB_THEME_KEY) || ''; } catch { return ''; } }
  function applyNbTheme(id) {
    if (nbWrap) { nbWrap.classList.toggle('nb-noite', id === 'noite'); nbWrap.classList.toggle('nb-deck', id === 'deck'); }
    try { localStorage.setItem(NB_THEME_KEY, id); } catch {}
  }

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
    { id: 'caderno', label: 'Caderno' }, { id: 'notas', label: 'Notas' }, { id: 'canvas', label: 'Canvas' }, { id: 'fit', label: 'Fit' },
    { id: 'journal', label: 'Diário' }, { id: 'files', label: 'Arquivos' }, { id: 'ask', label: 'Buscar' }, { id: 'gain', label: 'GAIN' },
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
    stopDictation();   // mic não sobrevive à troca de view (alvo some do DOM)
    if (currentView === 'notas' && window.BISO_NOTAS) window.BISO_NOTAS.unmount();   // limpa listeners da escrita
    if (currentView === 'canvas' && window.BISO_CANVAS) window.BISO_CANVAS.unmount();
    if (currentView === 'fit' && window.BISO_FIT) window.BISO_FIT.unmount();
    currentView = id;
    root.querySelectorAll('.biso-tab').forEach((b, i) => b.classList.toggle('active', VIEWS[i].id === id));
    renderView();
  }
  function renderView() {
    if (currentView !== 'caderno') { nbScroll = nbPage = nbStatus = nbInterrupt = nbWrap = nbFoot = null; }
    contentEl.innerHTML = '';
    if (radialFab) radialFab.style.display = (currentView === 'notas' || currentView === 'canvas' || currentView === 'fit') ? 'none' : '';   // FAB de ações é do dev-chat
    if (currentView === 'caderno') renderNotebook();
    else if (currentView === 'notas') { if (window.BISO_NOTAS) window.BISO_NOTAS.mount(contentEl); else contentEl.innerHTML = '<p class="biso-muted" style="padding:20px">notas.js não carregou.</p>'; }
    else if (currentView === 'canvas') { if (window.BISO_CANVAS) window.BISO_CANVAS.mount(contentEl); else contentEl.innerHTML = '<p class="biso-muted" style="padding:20px">canvas.js não carregou.</p>'; }
    else if (currentView === 'fit') { if (window.BISO_FIT) window.BISO_FIT.mount(contentEl); else contentEl.innerHTML = '<p class="biso-muted" style="padding:20px">fit.js não carregou.</p>'; }
    else if (currentView === 'journal') renderJournal();
    else if (currentView === 'files') renderFiles();
    else if (currentView === 'ask') renderAsk();
    else if (currentView === 'gain') renderGain();
  }

  // ── CADERNO ────────────────────────────────────────────────────────────
  // Layout "deck" (estética do gate cyberdeck): transcript em tela cheia — o
  // console fixo do topo foi removido (pedido 2026-07-09) para a conversa
  // respirar; escrever/ditar acontece no overlay "✎ Escrever…" (chip nos
  // outputs; 🎤 do rodapé abre o overlay já ditando). Foco do projeto no rodapé.
  function renderNotebook() {
    const wrap = elx('div', 'biso-nb');
    const scroll = elx('div', 'biso-nb-scroll');
    const page = elx('div', 'biso-nb-page');
    scroll.appendChild(page);
    const foot = elx('div', 'biso-nb-foot');
    foot.innerHTML = `<button class="biso-icon-btn" data-mic title="Ditar">🎤</button>
      <button class="biso-icon-btn" data-vozloop title="Conversa por voz">🗣</button>
      <button class="con-proj" data-proj>◈ …</button>
      <button class="con-proj" data-lang>🌐 …</button>
      <span class="biso-nb-status" data-status></span><span class="spacer" style="flex:1"></span>
      <button class="biso-icon-btn" data-snd title="Som ao terminar">🔔</button>
      <button class="biso-icon-btn" data-font title="Tamanho da fonte">Aa</button>
      <button class="biso-icon-btn" data-nbtheme title="Tema do caderno">◐</button>
      <button class="biso-interrupt-btn" data-int style="display:none">■ parar</button>`;
    wrap.append(scroll, foot);
    contentEl.appendChild(wrap);

    nbScroll = scroll; nbPage = page; nbWrap = wrap; nbFoot = foot;
    nbStatus = foot.querySelector('[data-status]');
    nbInterrupt = foot.querySelector('[data-int]');
    respPill = null; respPillScroll = null;
    onTap(nbInterrupt, () => BISA.wsSend({ type: 'biso.llm.interrupt' }));
    onTap(foot.querySelector('[data-proj]'), (e) => openFocusPicker(e.currentTarget || foot.querySelector('[data-proj]')));
    onTap(foot.querySelector('[data-mic]'), () => openWritePad({ dictate: true }));
    const vlBtn = foot.querySelector('[data-vozloop]');
    vlBtn.classList.toggle('active', vozLoop);
    onTap(vlBtn, () => {
      vozLoop = !vozLoop;
      try { localStorage.setItem(VOZLOOP_KEY, vozLoop ? '1' : '0'); } catch {}
      vlBtn.classList.toggle('active', vozLoop);
      BISA.toast(vozLoop
        ? 'Conversa por voz LIGADA: resposta é lida e o 🎤 reabre. Envio segue manual.'
        : 'Conversa por voz desligada.');
    });
    onTap(foot.querySelector('[data-lang]'), () => setCadernoLang(cadernoLang === 'en' ? 'pt' : 'en'));
    paintLangChips(); fetchCadernoLang();
    const sndBtn = foot.querySelector('[data-snd]');
    const paintSnd = () => { sndBtn.textContent = doneSndOn() ? '🔔' : '🔕'; sndBtn.classList.toggle('off', !doneSndOn()); };
    paintSnd();
    onTap(sndBtn, () => {
      try { localStorage.setItem(DONE_SND_KEY, doneSndOn() ? '0' : '1'); } catch {}
      paintSnd();
      if (doneSndOn()) { armDoneSound(); playDoneSound(); }   // prova de som no próprio gesto
      BISA.toast(doneSndOn() ? 'Bip quando a resposta ficar pronta (respostas >8s).' : 'Som de resposta desligado.');
    });
    onTap(foot.querySelector('[data-font]'), cycleFont);
    applyFont();
    applyNbTheme(nbTheme());
    onTap(foot.querySelector('[data-nbtheme]'), () => {
      const ids = NB_THEMES.map(t => t.id);
      const next = ids[(ids.indexOf(nbTheme()) + 1) % ids.length];
      applyNbTheme(next);
      BISA.toast('Tema do caderno: ' + NB_THEMES.find(t => t.id === next).name);
    });

    // toque num bloco de código = copiar (selecionar texto no iPad é sofrível);
    // se há seleção ativa dentro do bloco, o toque é da seleção — não copia.
    page.addEventListener('click', (e) => {
      const pre = e.target && e.target.closest ? e.target.closest('pre') : null;
      if (!pre || !page.contains(pre)) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const txt = pre.innerText.trim(); if (!txt) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => BISA.toast('Código copiado.'), () => BISA.toast('Não consegui copiar.'));
      }
    });

    // seletor de foco na tela inicial (some após a 1ª troca, via CSS .empty)
    const fc = elx('div', 'biso-focus-card');
    fc.innerHTML = '<div class="fc-lbl">◈ foco do caderno</div><div class="biso-focus-row"></div>';
    page.appendChild(fc);

    // conversa rápida: quando não quer escrever, um toque abre o papo — a saudação
    // define o idioma da conversa (Olá → pt · Hello → en; regra no CLAUDE.md do Geral).
    // Fica COLADA abaixo do console (não no transcript), só no estado inicial.
    const qs = elx('div', 'biso-quickstart');
    qs.innerHTML = `<div class="fc-lbl">▶ conversa rápida</div>
      <div class="qs-row"><button class="qs-btn" data-t="Olá">Iniciar · Olá</button>
      <button class="qs-btn en" data-t="Hello">Start · Hello</button></div>`;
    qs.querySelectorAll('.qs-btn').forEach(b => onTap(b, () => commitText(b.dataset.t)));
    wrap.insertBefore(qs, scroll);

    // reconstrói o histórico
    let lastClaudeEl = null;
    const doneCards = [];
    convo.forEach(m => {
      if (m.role === 'user') { page.appendChild(entryUserEl(m.text)); return; }
      const live = !!(streaming && m === streaming.msg);
      const card = entryClaudeEl(m, live); page.appendChild(card);
      if (live) { lastClaudeEl = card; }
      else { m.cardEl = card; fillChips(card, m); doneCards.push(card); }   // resposta finalizada → chips no rodapé do card
    });
    // outputs longos do histórico recolhem (a resposta MAIS RECENTE fica aberta)
    doneCards.slice(0, -1).forEach(maybeCollapse);

    setupNbGestures(scroll);
    paintFocus();          // pinta com o cache e...
    fetchFocus();          // ...atualiza do servidor em background

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
    msg._blkEls = null;   // card novo → cache de blocos do stream recomeça neste corpo
    paintClaude(card, msg, live);
    return card;
  }
  // Chips de ferramenta agregados por nome ("✓ grep ×12") — sessão longa gerava
  // dezenas de chips repetidos "ferramenta" sem dizer nada.
  function toolChips(tools) {
    const list = tools || [];
    if (!list.length) return '';
    const counts = new Map();
    let running = null;
    list.forEach((t) => {
      const name = t.name || 'ferramenta';
      counts.set(name, (counts.get(name) || 0) + 1);
      if (t.status !== 'done') running = t;
    });
    if (running) {
      return `<span class="biso-nb-tool">🔧 ${esc(running.summaryPt || running.name || 'ferramenta')}</span>`;
    }
    return [...counts.entries()]
      .map(([name, n]) => `<span class="biso-nb-tool done">✓ ${esc(name)}${n > 1 ? ' ×' + n : ''}</span>`)
      .join('');
  }

  // Render de stream append-only: divide o markdown em blocos de topo (ciente de
  // ``` p/ não quebrar code fences), congela os blocos fechados (re-render só quando
  // mudam) e re-renderiza apenas o ÚLTIMO bloco (o vivo) a cada frame. Evita custo
  // O(n²) e o "flash de markdown quebrado". Ver memória notebook-pencil-ai-ux.
  function splitTopBlocks(md) {
    const lines = (md || '').split('\n'); const blocks = []; let cur = [], inFence = false;
    for (const ln of lines) {
      if (/^```/.test(ln.trim())) inFence = !inFence;
      if (ln.trim() === '' && !inFence) { if (cur.length) { blocks.push(cur.join('\n')); cur = []; } }
      else cur.push(ln);
    }
    if (cur.length) blocks.push(cur.join('\n'));
    return blocks.length ? blocks : [''];
  }
  // fecha sintaxe incompleta SÓ p/ renderizar o bloco vivo (não altera msg.text).
  // Context-aware: se o texto todo tem nº ímpar de ```, estamos DENTRO de um fence
  // → fecha o fence e não mexe em ** / ` (senão quebra `2 ** 3` em código).
  function repairLive(block, fullText) {
    let s = block;
    if (((fullText.match(/```/g) || []).length) % 2 === 1) return s + '\n```';
    if (((s.match(/`/g) || []).length) % 2 === 1) s += '`';
    if (((s.match(/\*\*/g) || []).length) % 2 === 1) s += '**';
    return s;
  }
  function cursorSpan() { const s = document.createElement('span'); s.className = 'biso-nb-cursor'; return s; }
  function renderLiveBody(body, msg) {
    const text = msg.text || '';
    const blocks = splitTopBlocks(text);
    if (!msg._blkEls) { body.innerHTML = ''; msg._blkEls = []; body.appendChild(cursorSpan()); }
    const blkEls = msg._blkEls;
    let cursor = body.querySelector('.biso-nb-cursor'); if (!cursor) { cursor = cursorSpan(); body.appendChild(cursor); }
    for (let i = 0; i < blocks.length; i++) {
      const isLive = i === blocks.length - 1;
      const src = isLive ? repairLive(blocks[i], text) : blocks[i];
      if (!blkEls[i]) { blkEls[i] = document.createElement('div'); blkEls[i].className = 'nb-blk'; body.insertBefore(blkEls[i], cursor); }
      if (blkEls[i]._src !== src) { blkEls[i].innerHTML = BISA.renderMarkdown(src); blkEls[i]._src = src; }
    }
    for (let i = blocks.length; i < blkEls.length; i++) if (blkEls[i]) blkEls[i].remove();
    blkEls.length = blocks.length;
    body.appendChild(cursor);   // cursor sempre no fim
  }
  // Fronteiras de segmento vêm do servidor (<!--biso-seg--> a cada ferramenta):
  // no render FINAL, tudo antes do último segmento é "processo" (narração de
  // trabalho) e fica recolhido — a resposta em destaque é o que se relê.
  // No live, o texto flui inteiro (acompanhar o processo é o ponto).
  const SEG_RE = /\n*<!--biso-seg-->\n*/;

  // ── HUD de atividade (enquanto o turno roda) ──────────────────────────────
  // Preenche o vazio do "pensando" com o que está acontecendo por trás dos
  // panos (vídeo 2026-07-15: 20s de tela preta + pílula minúscula): checklist
  // do TodoWrite, timeline de ferramentas com duração, pensamento colapsável
  // e ticker de tokens/modelo. Colapsa no finalize — o accordion "processo"
  // vira o histórico.
  const HUD_STEP_ICON = { read: '📖', bash: '⚡', web: '🌐', edit: '✍️' };
  const fmtTokens = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n || 0);
  const fmtModel = (m) => String(m || '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
  const fmtDur = (ms) => ms == null ? '' : ms < 1000 ? '<1s' : Math.round(ms / 1000) + 's';
  function paintHud(card, msg) {
    let hud = card.querySelector('.nb-hud');
    if (!hud) {
      hud = elx('div', 'nb-hud');
      hud.innerHTML = '<div class="hud-todos"></div><div class="hud-steps"></div><div class="hud-think"></div><div class="hud-tick"></div>';
      const head = card.querySelector('.resp-head');
      if (head) head.after(hud); else card.prepend(hud);
    }
    // checklist viva (TodoWrite)
    const todosEl = hud.querySelector('.hud-todos');
    if (msg.todos && msg.todos.length) {
      const html = msg.todos.map((t) => {
        const st = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'run' : 'todo';
        const ic = st === 'done' ? '☑' : st === 'run' ? '▸' : '○';
        return `<div class="hud-todo ${st}"><span>${ic}</span>${esc(t.content)}</div>`;
      }).join('');
      if (todosEl._html !== html) { todosEl.innerHTML = html; todosEl._html = html; }
    }
    // timeline de ferramentas — últimas 4 + resumo das anteriores
    const stepsEl = hud.querySelector('.hud-steps');
    const tools = msg.tools || [];
    if (tools.length) {
      const MAXV = 4;
      const older = tools.length > MAXV ? tools.slice(0, tools.length - MAXV) : [];
      const shown = tools.slice(-MAXV);
      let html = older.length
        ? `<div class="hud-step done sum">✓ ${older.length} ${older.length === 1 ? 'passo anterior' : 'passos anteriores'}</div>` : '';
      html += shown.map((t) => {
        const run = t.status !== 'done';
        const ic = HUD_STEP_ICON[toolMsgKey(t.name)] || '🔧';
        const dur = run ? '' : `<span class="hud-dur">${fmtDur(t.durationMs)}</span>`;
        return `<div class="hud-step ${run ? 'run' : 'done'}">` +
          `<span class="hud-ic">${run ? '<i class="hud-spin"></i>' : '✓'}</span>` +
          `${ic} ${esc(toolLabel(t.name, t.detail) || t.summaryPt || t.name || 'ferramenta')}${dur}</div>`;
      }).join('');
      if (stepsEl._html !== html) { stepsEl.innerHTML = html; stepsEl._html = html; }
    }
    // pensamento (colapsa sozinho quando a resposta/ferramentas começam)
    const thinkEl = hud.querySelector('.hud-think');
    if (msg.thinking) {
      if (!thinkEl._built) {
        thinkEl._built = true;
        thinkEl.innerHTML = '<button class="hud-think-tg">💭 pensando…</button><div class="hud-think-bd"></div>';
        onTap(thinkEl.querySelector('.hud-think-tg'), () => {
          thinkEl._open = !thinkEl._open;
          thinkEl.querySelector('.hud-think-bd').style.display = thinkEl._open ? '' : 'none';
        });
        thinkEl._open = true;
      }
      const bd = thinkEl.querySelector('.hud-think-bd');
      const tail = msg.thinking.slice(-600);
      if (bd._txt !== tail) { bd.textContent = tail; bd._txt = tail; bd.scrollTop = bd.scrollHeight; }
      // auto-colapso: primeira ferramenta ou texto de resposta chegou
      if (thinkEl._open && !thinkEl._autoDone && ((msg.tools || []).length || msg.text)) {
        thinkEl._autoDone = true; thinkEl._open = false; bd.style.display = 'none';
      }
      thinkEl.querySelector('.hud-think-tg').textContent = (thinkEl._open ? '▾' : '▸') + ' 💭 pensando…';
    }
    // ticker: tokens · modelo · tempo (o tempo atualiza no tick do paintRunStatus)
    const tickEl = hud.querySelector('.hud-tick');
    const u = msg.usage;
    const sec = Math.max(0, Math.floor((Date.now() - runT0) / 1000));
    const t = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const parts = [];
    // usage dos eventos assistant reporta ~1-5 tokens por snapshot (quirk do
    // streaming — teste 2026-07-15 mostrou "27 tokens" num turno de parágrafos);
    // estima pelo texto streamado (~4 chars/token) e usa o maior dos dois.
    const est = Math.round((String(msg.text || '').length + String(msg.thinking || '').length) / 4);
    const out = Math.max((u && u.out) || 0, est);
    if (out) parts.push('⚡ ~' + fmtTokens(out) + ' tokens');
    if (u && u.model) parts.push(esc(fmtModel(u.model)));
    tickEl.innerHTML = parts.map((p) => `<span>${p}</span>`).join('<span class="hud-sep">·</span>') +
      (parts.length ? '<span class="hud-sep">·</span>' : '') + `<span class="hud-tick-t">${t}</span>`;
  }

  // pós-render da resposta final: tabela nunca quebra palavra (vídeo: "Alemanh/a")
  // — rola horizontal dentro do card; blocos de código ganham botão copiar.
  function enhanceRespBody(body) {
    body.querySelectorAll('table').forEach((tb) => {
      if (tb.closest('.nb-tbl-scroll')) return;
      const w = elx('div', 'nb-tbl-scroll');
      tb.before(w); w.appendChild(tb);
    });
    body.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.nb-copy') || !pre.textContent.trim()) return;
      const b = elx('button', 'nb-copy', '⧉ copiar');
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pre.textContent.replace(/⧉ copiar$/, '')); b.textContent = '✓ copiado'; }
        catch { b.textContent = '✗'; }
        setTimeout(() => { b.textContent = '⧉ copiar'; }, 1600);
      });
      pre.appendChild(b);
    });
  }

  // 📁 arquivos criados/editados no turno → chips tocáveis com preview
  function renderTurnFiles(card, msg) {
    if (card.querySelector('.nb-files')) return;
    const files = new Map();   // path → 'criado' | 'editado'
    (msg.tools || []).forEach((t) => {
      if (toolMsgKey(t.name) !== 'edit') return;
      const f = t.detail && (t.detail.file_path || t.detail.path || t.detail.notebook_path);
      if (!f) return;
      const kind = /^write/i.test(t.name || '') && !files.has(String(f)) ? 'criado' : (files.get(String(f)) || 'editado');
      files.set(String(f), kind);
    });
    if (!files.size) return;
    const wrap = elx('div', 'nb-files');
    wrap.appendChild(elx('span', 'nb-files-lbl', '📁 arquivos deste turno'));
    for (const [p, kind] of files) {
      const b = elx('button', 'nb-file-chip', (kind === 'criado' ? '✚ ' : '✎ ') + p.split('/').pop());
      b.title = p;
      onTap(b, () => openFilePreview(p));
      wrap.appendChild(b);
    }
    const foot = card.querySelector('.resp-foot');
    if (foot) card.insertBefore(wrap, foot); else card.appendChild(wrap);
  }
  const FILE_ICON = [[/\.(md|markdown)$/i, '📝'], [/\.(sh|zsh|bash)$/i, '⚡'], [/\.(tf|tfvars|ya?ml|toml|ini|conf)$/i, '⚙️'], [/\.(js|ts|jsx|tsx|py|rb|go|rs)$/i, '🧩'], [/\.(json|csv)$/i, '🗂']];
  const fileIcon = (name) => (FILE_ICON.find(([re]) => re.test(name)) || [0, '📄'])[1];
  async function openFilePreview(absPath) {
    const name = absPath.split('/').pop();
    const ov = elx('div', 'nb-file-ov');
    const box = elx('div', 'nb-file-box');
    box.innerHTML = `<div class="nb-file-head">` +
      `<span class="nb-file-ic">${fileIcon(name)}</span>` +
      `<div class="nb-file-tt"><span class="nb-file-name">${esc(name)}</span><span class="nb-file-path">${esc(absPath)}</span></div>` +
      `<button class="nb-file-x">✕</button></div>` +
      `<div class="nb-file-bd biso-resp"><div class="resp-body"><span class="biso-muted">carregando…</span></div></div>`;
    // DENTRO do .biso-root: os tokens --biso-* (e o tema ativo) são escopados
    // nele — no body os var() caíam em fallback cinza (leitura ruim, vídeo
    // 2026-07-15 18:11).
    (document.querySelector('.biso-root') || document.body).appendChild(ov);
    ov.appendChild(box);
    ov.addEventListener('click', () => ov.remove());
    box.addEventListener('click', (e) => e.stopPropagation());
    onTap(box.querySelector('.nb-file-x'), () => ov.remove());
    const bd = box.querySelector('.resp-body');
    try {
      const r = await BISA.api('/biso-chat/file?path=' + encodeURIComponent(absPath));
      if (/\.(md|markdown)$/i.test(r.name)) {
        bd.innerHTML = BISA.renderMarkdown(r.content);
        enhanceRespBody(bd);   // tabelas roláveis + copiar nos fences, como nos cards
      } else {
        const pre = elx('pre', 'nb-file-pre', ''); pre.textContent = r.content;
        bd.innerHTML = ''; bd.appendChild(pre);
      }
    } catch (e) { bd.innerHTML = `<span class="biso-muted">⚠ ${esc(e.message || 'não deu para abrir')}</span>`; }
  }

  function paintClaude(card, msg, live) {
    const toolsEl = card.querySelector('.resp-tools');
    const body = card.querySelector('.resp-body');
    if (toolsEl) toolsEl.innerHTML = toolChips(msg.tools);
    if (!body) return;
    if (live) { paintHud(card, msg); renderLiveBody(body, msg); return; }
    const hud = card.querySelector('.nb-hud'); if (hud) hud.remove();
    msg._blkEls = null;
    const parts = String(msg.text || '').split(SEG_RE).map((s) => s.trim());
    const answer = parts.length ? parts[parts.length - 1] : '';
    const proc = parts.slice(0, -1).filter(Boolean);
    if (!proc.length || !answer) {
      body.innerHTML = BISA.renderMarkdown(parts.filter(Boolean).join('\n\n')) || '<span class="biso-muted">…</span>';
      enhanceRespBody(body);
      renderTurnFiles(card, msg);
      return;
    }
    body.innerHTML = '';
    const tg = elx('button', 'nb-proc-toggle', `▸ processo · ${proc.length} ${proc.length === 1 ? 'etapa' : 'etapas'}`);
    const bd = elx('div', 'nb-proc-body');
    bd.innerHTML = BISA.renderMarkdown(proc.join('\n\n'));
    // o processo guarda a timeline do turno: passos com duração viram histórico
    const steps = (msg.tools || []).filter((t) => t.name);
    if (steps.length) {
      const tl = elx('div', 'nb-proc-steps');
      tl.innerHTML = steps.map((t) =>
        `<div class="hud-step done">✓ ${HUD_STEP_ICON[toolMsgKey(t.name)] || '🔧'} ${esc(toolLabel(t.name, t.detail) || t.name)}<span class="hud-dur">${fmtDur(t.durationMs)}</span></div>`).join('');
      bd.prepend(tl);
    }
    bd.style.display = 'none';
    tg.addEventListener('click', () => {
      const open = bd.style.display === 'none';
      bd.style.display = open ? '' : 'none';
      tg.textContent = (open ? '▾' : '▸') + tg.textContent.slice(1);
    });
    const ans = elx('div', 'nb-answer');
    ans.innerHTML = BISA.renderMarkdown(answer);
    body.append(tg, bd, ans);
    enhanceRespBody(body);
    renderTurnFiles(card, msg);
  }
  // preenche o rodapé do card com chips de sugestão + ESCREVER + OUVIR (inline)
  function fillChips(card, msg) {
    const foot = card.querySelector('.resp-foot');
    if (!foot) return;
    foot.innerHTML = '';
    (msg.suggestions || []).forEach(s => { const b = elx('button', 'biso-nb-chip', s); onTap(b, () => commitText(s)); foot.appendChild(b); });
    const w = elx('button', 'biso-nb-chip biso-nb-chip-write', '✎ Escrever…');
    onTap(w, () => openWritePad());
    foot.appendChild(w);
    if (window.speechSynthesis) {
      const sp = elx('button', 'biso-nb-chip biso-nb-chip-speak', '🔊 ouvir');
      // 'click', NÃO onTap: o onTap dispara no pointerdown e o iOS só libera
      // áudio em gesto completo (click/touchend) — com onTap o speak() era
      // engolido em silêncio.
      sp.addEventListener('click', () => toggleSpeak(msg, sp));
      foot.appendChild(sp);
    }
  }

  // ── TTS da resposta (speechSynthesis, fila por sentença) ─────────────────
  // Markdown vira fala legível: código não é lido letra a letra, links viram
  // "link". Um card falando por vez; tocar de novo para.
  const ttsPlain = (t) => String(t || '')
    .replace(/<!--biso-seg-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' Trecho de código. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/^[ \t]*[#>*-]+[ \t]*/gm, '')
    .replace(/[*_]{1,3}/g, '')
    .replace(/\|/g, ', ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')   // emoji não é lido em voz alta
    .trim();
  // Player de mídia (<audio> + /tts gerado no Mac) em vez de speechSynthesis:
  // toca em modo silencioso, sobrevive à tela bloqueada, pausa/velocidade de
  // graça. O elemento é destravado SINCRONAMENTE no toque (iOS exige gesto no
  // primeiro play; destravado, o play() pós-fetch é honrado). speechSynthesis
  // vira reserva se o /tts falhar.
  const TTS_RATE_KEY = 'biso.tts.rate';
  // Conversa por voz (toggle 🗣 no rodapé, opt-in): mensagem DITADA enviada →
  // resposta é lida no TTS e, no fim natural do áudio, o 🎤 reabre sozinho.
  // O ENVIO continua manual sempre (decisão do usuário, não mexer).
  const VOZLOOP_KEY = 'biso.vozloop';
  let vozLoop = localStorage.getItem(VOZLOOP_KEY) === '1';
  let voiceReplyPending = false;   // a mensagem em curso veio de ditado
  let afterSpeakOnce = null;       // callback de fim NATURAL da leitura
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  const rateLbl = (r) => (Math.abs(r - 1.25) < .01 ? '1,25×' : Math.abs(r - 1.5) < .01 ? '1,5×' : '1×');
  let ttsAudio = null;
  function getTtsAudio() {
    if (!ttsAudio) { ttsAudio = new Audio(); ttsAudio.setAttribute('playsinline', ''); }
    return ttsAudio;
  }
  function stopSpeak() {
    afterSpeakOnce = null;   // parada manual NÃO reabre o mic (só fim natural)
    if (speaking) {
      speaking.btn.classList.remove('speaking'); speaking.btn.textContent = '🔊 ouvir';
      if (speaking.rateChip) speaking.rateChip.remove();
      speaking = null;
    }
    if (ttsAudio) { try { ttsAudio.pause(); ttsAudio.removeAttribute('src'); ttsAudio.load(); } catch {} }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch {}
  }
  function toggleSpeak(msg, btn) {
    if (speaking && speaking.btn === btn) {
      const a = getTtsAudio();
      if (speaking.state === 'playing') { a.pause(); speaking.state = 'paused'; btn.textContent = '▶ continuar'; }
      else if (speaking.state === 'paused') { a.play().catch(() => {}); speaking.state = 'playing'; btn.textContent = '⏸ pausar'; }
      else if (speaking.state === 'siri') stopSpeak();
      return;   // 'loading': ignora toques até o áudio chegar
    }
    stopSpeak();
    const text = ttsPlain(msg.text); if (!text) return;
    const a = getTtsAudio();
    try { a.src = SILENT_WAV; a.play().catch(() => {}); } catch {}   // unlock no gesto
    // Fila por sentença: a voz começa quando o áudio da 1ª frase fica pronto
    // (~1s) e as próximas são geradas DURANTE a fala (prefetch) — em vez de
    // esperar o m4a da resposta inteira. Sentenças curtas são agrupadas em
    // blocos ≥120 chars p/ não multiplicar chamadas /tts (cache por hash vale
    // por bloco). Pausar/continuar/velocidade valem para o bloco corrente.
    const sents = text.match(/[^.!?\n]+[.!?…]*\s*/g) || [text];
    const chunks = []; let acc = '';
    for (const sTxt of sents) {
      acc = acc ? acc + ' ' + sTxt.trim() : sTxt.trim();
      if (acc.length >= 120) { chunks.push(acc); acc = ''; }
    }
    if (acc) chunks.push(acc);
    speaking = { btn, state: 'loading', rateChip: null, urls: [] };
    const st = speaking;
    btn.classList.add('speaking'); btn.textContent = '⏳ gerando…';
    const fetchChunk = (i) => {
      if (i >= chunks.length) return null;
      if (!st.urls[i]) st.urls[i] = BISA.api('/tts', { method: 'POST', json: { texto: chunks[i] } }).then((r) => r.url);
      return st.urls[i];
    };
    const showControls = () => {
      if (speaking !== st || st.rateChip) return;
      st.state = 'playing'; btn.textContent = '⏸ pausar';
      const rc = elx('button', 'biso-nb-chip biso-nb-chip-rate', rateLbl(a.playbackRate));
      rc.addEventListener('click', () => {
        const order = [1, 1.25, 1.5];
        const nxt = order[(order.findIndex((x) => Math.abs(x - a.playbackRate) < .01) + 1) % order.length];
        a.playbackRate = nxt; rc.textContent = rateLbl(nxt);
        try { localStorage.setItem(TTS_RATE_KEY, String(nxt)); } catch {}
      });
      btn.after(rc); st.rateChip = rc;
    };
    const playChunk = (i) => {
      if (speaking !== st) return;
      if (i >= chunks.length) {                        // fim NATURAL da fila
        const cb = afterSpeakOnce; afterSpeakOnce = null;
        stopSpeak(); if (cb) cb();
        return;
      }
      fetchChunk(i).then((url) => {
        if (speaking !== st) return;
        a.src = url;
        a.onended = () => playChunk(i + 1);
        const p = a.play() || Promise.resolve();
        a.playbackRate = parseFloat(localStorage.getItem(TTS_RATE_KEY) || '1') || 1;  // src novo reseta a taxa
        fetchChunk(i + 1);                             // prefetch durante a fala
        return p.then(showControls);
      }).catch(() => { if (speaking === st) speakSiri(msg, btn); });
    };
    playChunk(0);
  }
  // reserva: speechSynthesis (se o /tts falhar por qualquer motivo)
  function speakSiri(msg, btn) {
    const synth = window.speechSynthesis;
    if (!synth) { stopSpeak(); BISA.toast('Leitura indisponível.'); return; }
    const text = ttsPlain(msg.text); if (!text) { stopSpeak(); return; }
    try { synth.resume(); } catch {}
    const voices = synth.getVoices();
    const voice = voices.find(v => /^pt[-_]?BR/i.test(v.lang)) || null;
    speaking = { btn, state: 'siri', rateChip: null };
    btn.classList.add('speaking'); btn.textContent = '■ parar leitura';
    const parts = text.match(/[^.!?\n]+[.!?]?/g) || [text];
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.trim());
      if (voice) u.voice = voice;
      u.lang = 'pt-BR'; u.rate = 1.05;
      if (i === parts.length - 1) u.onend = () => {
        const cb = afterSpeakOnce; afterSpeakOnce = null;
        if (speaking && speaking.btn === btn) stopSpeak();
        if (cb) cb();
      };
      synth.speak(u);
    });
  }

  // ── pílula "↓ resposta pronta" ────────────────────────────────────────────
  // Não autoscrollamos durante o stream (decisão antiga, certa) — mas quando a
  // resposta termina fora da tela, nada avisava. Some ao tocar ou ao rolar até lá.
  function hideRespPill() {
    if (respPill) respPill.remove(); respPill = null;
    if (respPillScroll && nbScroll) nbScroll.removeEventListener('scroll', respPillScroll);
    respPillScroll = null;
  }
  function showRespPill(cardEl) {
    hideRespPill();
    if (!nbWrap || !nbScroll) return;
    const p = elx('button', 'biso-resp-pill', '↓ resposta pronta');
    onTap(p, () => { cardEl.scrollIntoView({ block: 'end', behavior: 'smooth' }); hideRespPill(); });
    nbWrap.appendChild(p); respPill = p;
    respPillScroll = () => {
      const r = cardEl.getBoundingClientRect(), sr = nbScroll.getBoundingClientRect();
      if (r.bottom <= sr.bottom + 8) hideRespPill();
    };
    nbScroll.addEventListener('scroll', respPillScroll, { passive: true });
  }

  // ── recolher outputs longos do histórico ─────────────────────────────────
  function maybeCollapse(card) {
    const body = card.querySelector('.resp-body');
    if (!body || card.querySelector('.resp-expand')) return;
    if (body.scrollHeight <= 560) return;
    body.classList.add('clamped');
    const b = elx('button', 'resp-expand', '▾ mostrar tudo');
    onTap(b, () => { const on = body.classList.toggle('clamped'); b.textContent = on ? '▾ mostrar tudo' : '▴ recolher'; });
    body.after(b);
  }

  // ── modo leitura (tamanho da fonte, persiste no dispositivo) ─────────────
  const FONT_KEY = 'biso.font';
  function applyFont() {
    if (!nbWrap) return;
    const v = localStorage.getItem(FONT_KEY) || '';
    nbWrap.classList.toggle('font-lg', v === 'lg');
    nbWrap.classList.toggle('font-xl', v === 'xl');
  }
  function cycleFont() {
    const order = ['', 'lg', 'xl'];
    const cur = localStorage.getItem(FONT_KEY) || '';
    const nxt = order[(order.indexOf(cur) + 1) % order.length];
    try { localStorage.setItem(FONT_KEY, nxt); } catch {}
    applyFont();
    BISA.toast('Fonte: ' + (nxt === 'lg' ? 'grande' : nxt === 'xl' ? 'extra' : 'normal'));
  }

  // estado inicial = transcript vazio mostra a dica "as anotações aparecem aqui"
  // (via CSS .biso-nb.empty); o console de escrita já está no topo desde o início.
  function updateEmptyState() { if (nbWrap) nbWrap.classList.toggle('empty', convo.length === 0); }

  // ── Idioma do caderno (UM toggle p/ tudo) ─────────────────────────────────
  // 🌐 PT/EN controla: motor do ditado (Whisper pt ou en), idioma das RESPOSTAS
  // do Claude (system prompt por turno no servidor) e, por tabela, a voz da
  // leitura (segue o texto). Fonte da verdade: servidor (/biso-chat/lang);
  // localStorage espelha p/ o ditado.
  let cadernoLang = localStorage.getItem('biso.ditado.lang') === 'en' ? 'en' : 'pt';
  function paintLangChips() {
    const lbl = '🌐 ' + cadernoLang.toUpperCase();
    document.querySelectorAll('[data-lang], .wp-lang').forEach((b) => { b.textContent = lbl; });
  }
  async function fetchCadernoLang() {
    try {
      const r = await BISA.api('/biso-chat/lang');
      if (r && (r.lang === 'pt' || r.lang === 'en')) {
        cadernoLang = r.lang;
        try { localStorage.setItem('biso.ditado.lang', cadernoLang); } catch {}
        paintLangChips();
      }
    } catch {}
  }
  function setCadernoLang(lang) {
    cadernoLang = lang === 'en' ? 'en' : 'pt';
    try { localStorage.setItem('biso.ditado.lang', cadernoLang); } catch {}
    paintLangChips();
    BISA.api('/biso-chat/lang', { method: 'POST', json: { lang: cadernoLang } })
      .catch(() => BISA.toast('Não salvou no servidor — ditado trocado mesmo assim.'));
    BISA.toast(cadernoLang === 'en' ? 'Caderno em inglês — ditado e respostas.' : 'Caderno em português — ditado e respostas.');
  }

  // ── Foco do caderno (projeto da sessão) ───────────────────────────────────
  const focusIcon = (id) => (id === 'geral' ? '◈ ' : '▣ ');
  function focusName() { const p = (chatFocus.projects || []).find(x => x.id === chatFocus.current); return p ? p.name : chatFocus.current; }
  async function fetchFocus() {
    try { const r = await BISA.api('/biso-chat/project'); if (r && r.current) chatFocus = r; } catch {}
    paintFocus();
  }
  function paintFocus() {
    if (!nbWrap) return;
    const chip = nbWrap.querySelector('[data-proj]');
    if (chip) chip.textContent = focusIcon(chatFocus.current) + focusName() + ' ▾';
    const row = nbWrap.querySelector('.biso-focus-row');
    if (row) {
      row.innerHTML = '';
      (chatFocus.projects || []).forEach(p => {
        const t = elx('button', 'biso-focus-tile' + (p.id === chatFocus.current ? ' on' : ''), focusIcon(p.id) + p.name);
        onTap(t, () => setFocus(p.id));
        row.appendChild(t);
      });
    }
  }
  async function setFocus(id) {
    if (id === chatFocus.current) { paintFocus(); return; }
    if (sessionState !== 'idle') { BISA.toast('Aguarde o Claude terminar.'); return; }
    try {
      const r = await BISA.api('/biso-chat/project', { method: 'POST', json: { id } });
      chatFocus.current = r.current;
      convo = []; streaming = null;   // transcript local zera — a sessão do foco retoma via --resume
      try { localStorage.removeItem(CONVO_KEY); } catch {}
      renderView();
      BISA.toast('Foco: ' + focusName());
    } catch (e) { BISA.toast('Erro: ' + e.message); }
  }
  // popover ancorado no chip (padrão iPad/Pencil) — dentro do .biso-nb p/ herdar a paleta
  function openFocusPicker(anchor) {
    const ov = elx('div', 'biso-radial-overlay show');
    const card = elx('div', 'biso-focus-pop');
    (chatFocus.projects || []).forEach(p => {
      const b = elx('button', 'biso-focus-item' + (p.id === chatFocus.current ? ' on' : ''));
      b.innerHTML = `<span class="nm">${focusIcon(p.id)}${esc(p.name)}</span>` + (p.desc ? `<span class="ds">${esc(p.desc)}</span>` : '');
      onTap(b, () => { ov.remove(); setFocus(p.id); });
      card.appendChild(b);
    });
    ov.appendChild(card);
    (nbWrap || document.body).appendChild(ov);
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const M = 8, cw = card.offsetWidth, ch = card.offsetHeight;
    const left = r ? r.left : (window.innerWidth - cw) / 2, top = r ? r.bottom + 8 : 80;
    card.style.left = Math.max(M, Math.min(window.innerWidth - cw - M, left)) + 'px';
    card.style.top = Math.max(M, Math.min(window.innerHeight - ch - M, top)) + 'px';
    ov.onclick = () => ov.remove(); card.onclick = (e) => e.stopPropagation();
  }

  // status com tempo decorrido — "pensando… · 1:32" diz se está lento ou travado
  function setStatus(s) {
    const wasBusy = sessionState === 'running' || sessionState === 'starting';
    sessionState = s;
    const busy = s === 'running' || s === 'starting';
    if (busy && !wasBusy) runT0 = Date.now();
    if (busy && !runTimer) runTimer = setInterval(paintRunStatus, 1000);
    if (!busy && runTimer) { clearInterval(runTimer); runTimer = 0; }
    paintRunStatus();
  }
  // pílula "thinking": sprite 8-bit sorteado por rodada + frases de fliperama
  // girando (por ferramenta corrente; de paciência após 60s) + cronômetro.
  // O idioma segue o 🌐 do caderno. Monta o DOM uma vez e só atualiza texto/tempo
  // por tick — recriar reiniciaria as animações CSS a cada segundo.
  const THINK_MSGS = {
    pt: ['pensando', 'carregando sabedoria', 'comendo os pontinhos', 'rolando 1d20', 'fugindo dos fantasmas', 'subindo de nível', 'farmando xp', 'procurando a chave da fase'],
    en: ['thinking', 'loading wisdom', 'eating the dots', 'rolling 1d20', 'dodging ghosts', 'leveling up', 'grinding xp', 'searching for the key'],
  };
  const TOOL_MSGS = {
    pt: { read: ['cavando os arquivos', 'lendo os pergaminhos', 'explorando o mapa'],
          bash: ['conjurando bash', 'girando as engrenagens', 'apertando botões do console'],
          web: ['explorando a masmorra da web', 'caçando tesouro na rede'],
          edit: ['forjando o código', 'martelando os pixels'] },
    en: { read: ['digging the files', 'reading the scrolls', 'exploring the map'],
          bash: ['casting bash spells', 'turning the gears', 'mashing console buttons'],
          web: ['raiding the web dungeon', 'hunting treasure online'],
          edit: ['forging the code', 'hammering the pixels'] },
  };
  const SLOW_MSGS = {
    pt: ['o chefe da fase demorou…', 'o boss tem muita vida', 'carregando a fase secreta', 'ainda farmando…'],
    en: ['long boss fight…', 'the boss has too much hp', 'loading the secret level', 'still grinding…'],
  };
  // agrupa o nome da ferramenta (Read, Bash, WebSearch, mcp__…) numa família de frases
  function toolMsgKey(name) {
    const n = (name || '').toLowerCase().replace(/^mcp__/, '');
    if (!n) return null;
    if (/^(read|grep|glob|ls)/.test(n)) return 'read';
    if (/(bash|shell|command)/.test(n)) return 'bash';
    if (/(web|fetch|search|browser|playwright)/.test(n)) return 'web';
    if (/(edit|write|patch)/.test(n)) return 'edit';
    return null;
  }
  // a pílula mostra O QUE a ferramenta está fazendo, não só o nome (vídeo
  // 2026-07-14: ~55s de "raiding the web dungeon" sem dizer o que buscava):
  // WebSearch → a query · WebFetch → o domínio · Read/Edit → o arquivo ·
  // Bash → a descrição/comando. detail = input da ferramenta (biso.llm.tool).
  function toolLabel(name, detail) {
    if (!name) return '';
    const d = detail || {};
    try {
      if (/search/i.test(name) && d.query) return name + ' · “' + String(d.query).slice(0, 44) + '”';
      if (d.url) return name + ' · ' + new URL(d.url).hostname.replace(/^www\./, '');
      const f = d.file_path || d.path || d.notebook_path;
      if (f) return name + ' · ' + String(f).split('/').pop();
      if (/bash/i.test(name) && (d.description || d.command)) return name + ' · ' + String(d.description || d.command).slice(0, 44);
    } catch {}
    return name;
  }
  const THINK_SPRITES = ['', 'ghost', 'slime', 'mago'];   // '' = invasor
  const INV_HI_KEY = 'biso.inv.hi';
  let invScore = 0;   // pontos do easter egg na rodada corrente
  function paintRunStatus() {
    if (!nbStatus) return;
    const busy = sessionState === 'running' || sessionState === 'starting';
    if (!busy) { nbStatus.innerHTML = ''; if (nbInterrupt) nbInterrupt.style.display = 'none'; return; }
    const sec = Math.max(0, Math.floor((Date.now() - runT0) / 1000));
    const t = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const en = cadernoLang === 'en';
    const lang = en ? 'en' : 'pt';
    const toolKey = toolMsgKey(curTool);
    const msgs = sec >= 60 ? SLOW_MSGS[lang] : (toolKey ? TOOL_MSGS[lang][toolKey] : THINK_MSGS[lang]);
    const lbl = sessionState === 'starting' ? 'insert coin' : msgs[Math.floor(sec / 5) % msgs.length];
    let pill = nbStatus.querySelector('.biso-think');
    if (!pill) {
      const sp = THINK_SPRITES[Math.floor(runT0 / 1000) % THINK_SPRITES.length];   // sorteio estável na rodada
      nbStatus.innerHTML = '<span class="biso-think"><span class="think-inv' + (sp ? ' ' + sp : '') + '"></span><span class="think-lbl"></span><span class="think-tool"></span><span class="think-t"></span><span class="think-score"></span></span>';
      pill = nbStatus.querySelector('.biso-think');
      invScore = 0;
      onTap(pill.querySelector('.think-inv'), tapSprite);
    }
    pill.classList.toggle('turbo', sec >= 60);
    pill.querySelector('.think-lbl').textContent = lbl;
    pill.querySelector('.think-tool').textContent = toolLabel(curTool, curToolDetail);   // o que ele está fazendo agora
    pill.querySelector('.think-t').textContent = t;
    // o relógio do HUD acompanha o mesmo tick de 1s
    const hudT = document.querySelector('.nb-hud .hud-tick-t');
    if (hudT) hudT.textContent = t;
    if (nbInterrupt) { nbInterrupt.style.display = ''; nbInterrupt.textContent = en ? '■ stop' : '■ parar'; }
  }
  // easter egg: acertar o sprite dá +10; recorde por dispositivo no localStorage
  function tapSprite() {
    const pill = nbStatus && nbStatus.querySelector('.biso-think'); if (!pill) return;
    invScore += 10;
    let hi = 0; try { hi = parseInt(localStorage.getItem(INV_HI_KEY) || '0', 10) || 0; } catch {}
    if (invScore > hi) { hi = invScore; try { localStorage.setItem(INV_HI_KEY, String(hi)); } catch {} }
    pill.querySelector('.think-score').textContent = invScore + ' · hi ' + hi;
    const spr = pill.querySelector('.think-inv');
    spr.classList.remove('hit'); void spr.offsetWidth; spr.classList.add('hit');   // re-dispara o pulo
    const plus = elx('span', 'think-plus', '+10');
    pill.appendChild(plus); setTimeout(() => plus.remove(), 650);
  }
  // explosão pixelada de ~0,4s quando a resposta termina (só no done — erro não celebra)
  function boomStatus() {
    if (!nbStatus) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    nbStatus.innerHTML = '<span class="think-boom"></span>';
    setTimeout(() => { if (nbStatus && nbStatus.querySelector('.think-boom')) nbStatus.innerHTML = ''; }, 520);
  }

  // envia um texto: vira entrada do usuário + cria a anotação do Claude (streaming)
  // Só pontuação/espaço NÃO é mensagem — um toque da Pencil vira "." via
  // Scribble e resíduo de ditado vira "…" (vídeos de 2026-07-13).
  const hasRealText = (t) => /[\p{L}\p{N}]/u.test(t || '');

  // métricas locais (loops de medição): fire-and-forget, nunca trava a UI
  const logMetric = (kind, data) => {
    BISA.api('/metrics/log', { method: 'POST', json: { kind, data } }).catch(() => {});
  };

  // bip 8-bit de "resposta pronta" (🔔 no rodapé liga/desliga). O AudioContext
  // é criado/resumido DENTRO do gesto do envio (armDoneSound no commitText) —
  // play programático fora de gesto é engolido pelo iOS.
  const DONE_SND_KEY = 'biso.done.sound';
  const doneSndOn = () => { try { return localStorage.getItem(DONE_SND_KEY) !== '0'; } catch { return true; } };
  let sndCtx = null;
  const armDoneSound = () => {
    if (!doneSndOn()) return;
    try {
      sndCtx = sndCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (sndCtx.state === 'suspended') sndCtx.resume();
    } catch {}
  };
  const playDoneSound = () => {
    if (!doneSndOn() || !sndCtx || sndCtx.state !== 'running') return;
    try {   // duas notas quadradas curtas — 1-up de fliperama, casa com a pílula
      const t0 = sndCtx.currentTime;
      [[660, 0, .09], [990, .1, .16]].forEach(([f, at, dur]) => {
        const o = sndCtx.createOscillator(), g = sndCtx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(.05, t0 + at);
        g.gain.exponentialRampToValueAtTime(.001, t0 + at + dur);
        o.connect(g); g.connect(sndCtx.destination);
        o.start(t0 + at); o.stop(t0 + at + dur);
      });
    } catch {}
  };

  function commitText(text) {
    text = (text || '').trim(); if (!text) return;
    if (!hasRealText(text)) { BISA.toast('Nada para enviar — só pontuação.'); return; }
    if (sessionState === 'running' || sessionState === 'starting') { BISA.toast('Aguarde o Claude terminar.'); return; }
    if (currentView !== 'caderno') switchView('caderno');
    lastUserText = text;

    convo.push({ role: 'user', text });
    const ue = entryUserEl(text);
    nbPage.appendChild(ue);

    const cmsg = { role: 'claude', text: '', html: '', tools: [], suggestions: [], todos: null, thinking: '', usage: null };
    convo.push(cmsg);
    const cel = entryClaudeEl(cmsg, true);
    nbPage.appendChild(cel);
    streaming = { msg: cmsg, el: cel };
    updateEmptyState();   // saiu do estado inicial → vira caderno

    saveConvo();
    setStatus('running');
    armDoneSound();   // ainda dentro do gesto do envio (iOS)
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
      case 'biso.llm.thinking': streamThinking(ev.delta); break;
      case 'biso.llm.todos': streamTodos(ev.todos); break;
      case 'biso.llm.usage': streamUsage(ev); break;
      case 'biso.llm.done': finalizeStream(); break;
      case 'biso.llm.error': errorStream(ev.message); break;
    }
  }
  function flushStream() {
    streamRaf = 0;
    if (streaming && streaming.el) paintClaude(streaming.el, streaming.msg, true);  // sem scroll (achado NN/g)
  }
  function scheduleStreamPaint() { if (!streamRaf) streamRaf = requestAnimationFrame(flushStream); }
  function streamDelta(delta) {
    if (!streaming) return;
    streaming.msg.text += delta;
    if (streaming.el) scheduleStreamPaint();   // 1 repaint por frame, não por token
  }
  function streamTool(ev) {
    if (!streaming) return;
    const tools = streaming.msg.tools;
    if (ev.status === 'done') {
      // done agora chega com id (correlação servidor); fallback: mais antiga aberta
      const i = ev.id ? tools.findIndex(t => t.id === ev.id)
        : tools.findIndex(t => t.status !== 'done');
      if (i >= 0) tools[i] = Object.assign({}, tools[i], { status: 'done', durationMs: ev.durationMs });
      if (tools.every(t => t.status === 'done')) { curTool = null; curToolDetail = null; paintRunStatus(); }
    } else {
      const i = ev.id ? tools.findIndex(t => t.id === ev.id)
        : tools.findIndex(t => t.name === ev.name && t.status === 'start');
      if (i >= 0) tools[i] = Object.assign({}, tools[i], ev); else tools.push(ev);
    }
    if (ev.status === 'start' && ev.name) { curTool = ev.name; curToolDetail = ev.detail || null; paintRunStatus(); }
    if (streaming.el) scheduleStreamPaint();
  }
  // 💭 thinking do agente (colapsável no HUD); acumula por turno
  function streamThinking(delta) {
    if (!streaming || !delta) return;
    streaming.msg.thinking = (streaming.msg.thinking || '') + delta;
    if (streaming.el) scheduleStreamPaint();
  }
  // ☑ checklist viva do TodoWrite — snapshot substitui o anterior
  function streamTodos(todos) {
    if (!streaming || !Array.isArray(todos)) return;
    streaming.msg.todos = todos;
    if (streaming.el) scheduleStreamPaint();
  }
  // ⚡ tokens/modelo do turno (ticker do HUD)
  function streamUsage(u) {
    if (!streaming) return;
    streaming.msg.usage = { out: u.out || 0, in: u.in || 0, model: u.model || '' };
    if (streaming.el) scheduleStreamPaint();
  }
  function finalizeStream() {
    if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = 0; }
    if (streaming && streaming.el) paintClaude(streaming.el, streaming.msg, false);
    const done = streaming;
    const tookMs = Date.now() - runT0;
    streaming = null; curTool = null; curToolDetail = null;
    setStatus('idle');
    boomStatus();   // vitória: explosãozinha pixelada antes do rodapé esvaziar
    // resposta demorada + sem conversa por voz → bip curto (dá p/ esperar
    // olhando outra coisa; vídeo 2026-07-14: usuário na Central de Controle)
    if (!voiceReplyPending && tookMs > 8000) playDoneSound();
    if (done && done.msg && done.el) {
      done.msg.cardEl = done.el;
      fillChips(done.el, done.msg);   // rodapé do card com a opção "Escrever…" (mesmo sem sugestões ainda)
      // conversa por voz: lê a resposta e, no fim NATURAL do áudio, reabre o 🎤.
      // afterSpeakOnce é setado DEPOIS do toggleSpeak (que começa com stopSpeak
      // e limparia o callback).
      if (voiceReplyPending) {
        voiceReplyPending = false;
        const sp = done.el.querySelector('.biso-nb-chip-speak');
        if (sp) {
          toggleSpeak(done.msg, sp);
          afterSpeakOnce = () => openWritePad({ dictate: true });
        }
      }
      fetchFollowups(done.msg);
      saveConvo();
      // resposta terminou fora da tela → avisa sem roubar o scroll
      if (nbScroll) {
        const r = done.el.getBoundingClientRect(), sr = nbScroll.getBoundingClientRect();
        if (r.bottom > sr.bottom + 40) showRespPill(done.el);
      }
    }
  }
  function errorStream(message) {
    voiceReplyPending = false;   // erro não dispara leitura nem reabre o mic
    if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = 0; }
    if (streaming && streaming.el) paintClaude(streaming.el, streaming.msg, false);
    streaming = null; curTool = null; curToolDetail = null;
    setStatus('idle');
    saveConvo();
    if (nbPage) { const e = elx('div', 'biso-nb-err', '⚠ ' + (message || 'Erro.')); nbPage.appendChild(e); }
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
      saveConvo();
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

  // ── Ditado — motor em screens/ditado.js (Whisper local + Siri de reserva)
  const bindMic = (btn, getBox, opts) => {
    if (window.BISO_DITADO) window.BISO_DITADO.bind(btn, getBox, opts);
    else btn.style.display = 'none';
  };
  const stopDictation = () => { if (window.BISO_DITADO) window.BISO_DITADO.stopAll(); };

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

  // ── Seleção com a Pencil → "✎ usar trecho" ────────────────────────────────
  // Selecionou texto num output do Claude (caneta ou dedo) → chip flutuante
  // perto da seleção; tocar abre o Escrever com o trecho citado (aí dita/escreve
  // a instrução: "encurta isso", "explica essa parte"...). Instrução livre —
  // sem gramática de comandos (achado da pesquisa: contexto > comandos).
  function hideSelChip() { if (selChip) { selChip.remove(); selChip = null; } }
  function checkSelection() {
    hideSelChip();
    if (!nbPage || currentView !== 'caderno') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const txt = String(sel).trim();
    if (txt.length < 3 || txt.length > 4000) return;
    const n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!n || !n.closest || !n.closest('.resp-body')) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const chip = elx('button', 'biso-selchip', '✎ usar trecho');
    onTap(chip, () => {
      hideSelChip();
      try { window.getSelection().removeAllRanges(); } catch {}
      openWritePad({ quote: txt });
    });
    (nbWrap || document.body).appendChild(chip);
    chip.style.left = Math.max(8, Math.min(window.innerWidth - chip.offsetWidth - 8, r.left + r.width / 2 - chip.offsetWidth / 2)) + 'px';
    chip.style.top = Math.min(window.innerHeight - 64, r.bottom + 10) + 'px';
    selChip = chip;
  }

  // ── Modo escrita (chip "✎ Escrever…") ─────────────────────────────────────
  // Overlay de FOCO TOTAL: opaco (nada sangra por trás), uma tarefa só na tela.
  // Fluxo vertical: 1) vão no topo com dica ⌨ p/ ancorar o teclado flutuante do
  // iPad; 2) quadro de escrita pautado; 3) ações grandes logo abaixo da mão;
  // 4) dock "ao vivo" pinado embaixo espelhando o texto EM TEMPO REAL.
  // Enviar commita no caderno; Cancelar descarta.
  const DRAFT_KEY = 'biso.writepad.draft';
  function openWritePad(opts = {}) {
    if (!nbWrap || nbWrap.querySelector('.biso-write-pad')) return;
    const pad = elx('div', 'biso-write-pad');
    pad.innerHTML = `
      <div class="wp-kb"><span>⌨ ancore o teclado aqui</span></div>
      <div class="biso-nb-console wp-card">
        <div class="con-head"><span class="con-lbl">✎ resposta</span><span class="con-sys">biso://caderno</span><button class="wp-lang"></button><span class="wp-count">0 palavras</span><button class="wp-send-mini" disabled>Enviar ↑</button></div>
        <div class="biso-nb-input wp-box" contenteditable="true" data-ph="✎ Escreva aqui com a caneta…" autocapitalize="sentences" spellcheck="false"></div>
      </div>
      <div class="wp-predict"></div>
      <div class="wp-actions">
        <button class="wp-cancel">✕ Cancelar</button>
        <button class="wp-mic" title="Ditar">🎤 Ditar</button>
        <button class="wp-swap" style="display:none"></button>
        <button class="wp-send">Enviar ↑</button>
      </div>
      <div class="wp-modes">
        <span class="wp-modes-lbl">✦ limpar</span>
        <button class="wp-mode" data-m="mensagem">Mensagem</button>
        <button class="wp-mode" data-m="nota">Nota</button>
        <button class="wp-mode" data-m="lista">Lista</button>
        <button class="wp-orig" style="display:none">↩ original</button>
      </div>
      <div class="wp-dock"><div class="wp-dock-lbl">▸ ao vivo · como entra no caderno</div><div class="wp-live"></div></div>
      <div class="wp-spacer"></div>`;
    nbWrap.appendChild(pad);   // dentro do .biso-nb → herda a paleta e some no re-render

    const box = pad.querySelector('.wp-box'), live = pad.querySelector('.wp-live');
    const dock = pad.querySelector('.wp-dock'), count = pad.querySelector('.wp-count');
    // 'input' (não keydown) — é o que o Scribble dispara; ver nota do console
    box.addEventListener('input', () => {
      const t = box.innerText;
      live.textContent = t;
      live.classList.remove('clean');   // texto novo → a prévia limpa era de outro momento
      const n = t.trim() ? t.trim().split(/\s+/).length : 0;
      count.textContent = n + (n === 1 ? ' palavra' : ' palavras');
      // envio alternativo no TOPO do pad — o teclado flutuante do iPad cobria o
      // "Enviar ↑" de baixo (vídeo 2026-07-15: botão cortado como "nviar ↑")
      const mini = pad.querySelector('.wp-send-mini');
      if (mini) mini.disabled = !hasRealText(t);
      dock.scrollTop = dock.scrollHeight;   // dock acompanha o fim do texto
      // rascunho persistente: o pad "some no re-render" (ver close abaixo) —
      // re-render/reload/troca de app não pode custar texto ditado
      try { localStorage.setItem(DRAFT_KEY, t); } catch {}
    });
    box.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPad(); } });

    const mic = pad.querySelector('.wp-mic'), sendBtn = pad.querySelector('.wp-send');
    let usedDictation = false;   // p/ conversa por voz: esta mensagem foi ditada?
    // 🔮 previsão ao vivo: ~0,9s de pausa no texto (≥3 palavras) → /biso-predict
    // devolve % de contexto (quão previsível já está a intenção) + complementos
    // prováveis; tocar num chip anexa a continuação. Respostas velhas (seq) e
    // pad fechado são descartados.
    const predEl = pad.querySelector('.wp-predict');
    let predSeq = 0, predTimer = 0, predEma = null;
    const renderPredict = ({ confidence, completions }, draft) => {
      predEl.innerHTML = '';
      if (!confidence && !(completions || []).length) return;
      // EMA: o % cru saltava sem lógica aparente (85→28→75 no vídeo 2026-07-15)
      // — suaviza para o medidor contar uma história em vez de piscar.
      const conf = Math.round(predEma == null ? confidence : 0.55 * predEma + 0.45 * (confidence || 0));
      predEma = conf;
      const meter = elx('div', 'wp-pred-meter');
      meter.innerHTML = `<span class="wp-pred-lbl">🔮 contexto</span>` +
        `<span class="wp-pred-bar"><i style="width:${conf}%"></i></span>` +
        `<span class="wp-pred-pct">${conf}%</span>`;
      predEl.appendChild(meter);
      logMetric('previsao', { confidence, n: (completions || []).length });
      (completions || []).forEach((c) => {
        const b = elx('button', 'wp-pred-chip', '… ' + c);
        onTap(b, () => {
          box.innerText = box.innerText.replace(/\s+$/, '') + ' ' + c;
          box.dispatchEvent(new Event('input', { bubbles: true }));
          // aceite vira few-shot do próprio preditor (loop de medição)
          logMetric('previsao-aceita', { draft: draft.slice(0, 300), completion: c, confidence });
        });
        predEl.appendChild(b);
      });
    };
    const runPredict = async () => {
      const draft = box.innerText.trim();
      if (draft.split(/\s+/).filter(Boolean).length < 3) { predEl.innerHTML = ''; return; }
      const seq = ++predSeq;
      try {
        const history = convo.filter((m) => m.role === 'user' && m.text).slice(-8).map((m) => m.text);
        const r = await BISA.api('/biso-predict', { method: 'POST', json: { draft, history } });
        if (seq !== predSeq || !pad.isConnected) return;
        renderPredict(r, draft);
      } catch {}
    };
    box.addEventListener('input', () => { clearTimeout(predTimer); predTimer = setTimeout(runPredict, 900); });

    // troca de idioma NO MEIO do ditado (vídeo 2026-07-14: whisper·EN preso a
    // sessão toda) — botão só aparece enquanto grava; mostra o idioma DESTINO.
    const swap = pad.querySelector('.wp-swap');
    const doSwap = () => {
      setCadernoLang(cadernoLang === 'en' ? 'pt' : 'en');
      swap.textContent = '⇄ ' + (cadernoLang === 'en' ? 'PT' : 'EN');
      swap.classList.remove('attn');
      if (window.BISO_DITADO && window.BISO_DITADO.activeBtn() === mic) window.BISO_DITADO.restart();
    };
    onTap(swap, doSwap);
    // comandos de voz existem mas eram invisíveis (vídeo 2026-07-14: usuário
    // corrigiu repetindo a palavra 3×): dica rotativa no rótulo do dock
    // enquanto o 🎤 grava; o rótulo original volta quando o ditado para.
    const dockLbl = pad.querySelector('.wp-dock-lbl');
    const DOCK_LBL_IDLE = dockLbl.textContent;
    const MIC_HINTS = {
      pt: ['💡 diga "apaga isso" p/ corrigir a última frase', '💡 diga "apaga tudo" p/ recomeçar', '💡 diga "nova linha" ou "novo parágrafo" p/ quebrar'],
      en: ['💡 say "scratch that" to drop the last sentence', '💡 say "delete everything" to start over', '💡 say "new line" or "new paragraph" to break'],
    };
    let hintTimer = 0, hintI = 0;
    const startHints = (lang) => {
      const hints = MIC_HINTS[lang === 'en' ? 'en' : 'pt'];
      clearInterval(hintTimer); hintI = 0;
      dockLbl.textContent = hints[0];
      hintTimer = setInterval(() => { dockLbl.textContent = hints[++hintI % hints.length]; }, 7000);
    };
    const stopHints = () => { clearInterval(hintTimer); hintTimer = 0; dockLbl.textContent = DOCK_LBL_IDLE; };
    // prévia limpa no dock em pausas de fala: o quadro segue com o BRUTO (fonte
    // do whisper); o AO VIVO antecipa como o texto VAI entrar pós-limpeza.
    let prevSeq = 0, prevLast = '';
    bindMic(mic, () => box, {
      // pílula de estado: motor + idioma visíveis enquanto grava
      onState: (st) => {
        usedDictation = true; mic.textContent = `🎤 ${st.engine} · ${st.lang.toUpperCase()}`;
        swap.style.display = ''; swap.textContent = '⇄ ' + (st.lang === 'en' ? 'PT' : 'EN');
        startHints(st.lang);
      },
      onLangHint: (looks) => {
        swap.classList.add('attn');
        BISA.toast(looks === 'pt' ? 'Parece português — toque ⇄ PT para trocar o ditado.'
          : 'Sounds like English — tap ⇄ EN to switch dictation.');
        logMetric('ditado-lang-hint', { de: cadernoLang, para: looks });
      },
      onPause: async () => {
        if (!pad.isConnected) return;
        const t = box.innerText.trim();
        if (!hasRealText(t) || t.split(/\s+/).length < 6 || t === prevLast) return;
        prevLast = t;
        const seq = ++prevSeq;
        try {
          const r = await BISA.api('/ditado/limpar', { method: 'POST', json: { texto: t, modo: 'mensagem', lang: cadernoLang } });
          if (seq !== prevSeq || !pad.isConnected) return;
          if (box.innerText.trim() !== t) return;   // voltou a falar — prévia velha morre
          live.textContent = '✦ ' + r.texto;
          live.classList.add('clean');
          dock.scrollTop = dock.scrollHeight;
        } catch {}
      },
      // fim do ditado (pós-consolidação): rótulo de volta, limpeza automática
      // via /ditado/limpar e realce do Enviar — o ENVIO segue manual.
      onStop: async () => {
        mic.textContent = '🎤 Ditar';
        swap.style.display = 'none'; swap.classList.remove('attn');
        stopHints();
        if (!pad.isConnected) return;
        const t = box.innerText.trim();
        if (hasRealText(t) && t.split(/\s+/).length >= 4) {
          count.textContent = '✦ limpando…';
          await cleanWith('mensagem');
          box.dispatchEvent(new Event('input', { bubbles: true }));   // re-pinta contagem/dock
        }
        if (hasRealText(box.innerText)) {
          sendBtn.classList.add('attn');
          setTimeout(() => sendBtn.classList.remove('attn'), 8000);
        }
      },
    });
    // idioma do caderno; com o 🎤 deste pad ativo, religa já no novo idioma
    paintLangChips();
    onTap(pad.querySelector('.wp-lang'), () => {
      setCadernoLang(cadernoLang === 'en' ? 'pt' : 'en');
      if (window.BISO_DITADO && window.BISO_DITADO.activeBtn() === mic) window.BISO_DITADO.restart();
    });
    // Rascunho pendente = pad morreu sem Enviar/Cancelar (re-render, reload,
    // crash) → restaura antes de qualquer ditado (vira o `base` da sessão 🎤).
    if (!opts.quote) {
      const draft = (() => { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; } })();
      if (draft.trim()) {
        box.innerText = draft;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        BISA.toast('Rascunho restaurado — ✕ Cancelar descarta.');
      }
    }
    // 🎤 do rodapé abre já ditando — .click() síncrono preserva a ativação do
    // gesto do usuário (getUserMedia do iOS exige).
    if (opts.dictate) pad.querySelector('.wp-mic').click();
    // "✎ usar trecho": abre com a seleção citada; a instrução vem depois dela
    if (opts.quote) {
      box.innerText = '> ' + opts.quote.replace(/\n/g, '\n> ') + '\n\n';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Limpeza com o Claude (fase 3): o bruto é a fonte — trocar de modo
    // re-processa sempre o MESMO bruto (não o resultado anterior); qualquer
    // edição manual/ditado novo invalida o snapshot e esconde o "original".
    let rawText = null, applyingClean = false;
    const origBtn = pad.querySelector('.wp-orig');
    const setBox = (t) => {
      applyingClean = true;
      box.innerText = t; box.dispatchEvent(new Event('input', { bubbles: true }));
      applyingClean = false;
    };
    box.addEventListener('input', () => {
      if (!applyingClean) { rawText = null; origBtn.style.display = 'none'; }
    });
    // limpeza via /ditado/limpar — chamada pelos chips E pela limpeza
    // automática pós-ditado (onStop do 🎤); o bruto é o snapshot-fonte.
    async function cleanWith(modo) {
      const cur = box.innerText.trim();
      if (!cur && rawText == null) { BISA.toast('Nada para limpar.'); return; }
      if (rawText == null) rawText = cur;
      try {
        const r = await BISA.api('/ditado/limpar', { method: 'POST', json: { texto: rawText, modo, lang: cadernoLang } });
        setBox(r.texto);
        origBtn.style.display = '';
        logMetric('limpeza', { modo, bruto: rawText.slice(0, 600), limpo: String(r.texto || '').slice(0, 600) });
      } catch (e) { BISA.toast('Limpeza falhou: ' + e.message); }
    }
    pad.querySelectorAll('.wp-mode').forEach((b) => onTap(b, async () => {
      if (b.disabled) return;
      const lbl = b.textContent; b.textContent = '…'; b.disabled = true;
      await cleanWith(b.dataset.m);
      b.textContent = lbl; b.disabled = false;
    }));
    onTap(origBtn, () => {
      if (rawText != null) { setBox(rawText); origBtn.style.display = 'none'; }
    });

    const close = () => {
      const mb = window.BISO_DITADO && window.BISO_DITADO.activeBtn();
      if (mb && pad.contains(mb)) stopDictation();
      clearTimeout(predTimer); clearInterval(hintTimer);
      try { localStorage.removeItem(DRAFT_KEY); } catch {}   // saída explícita = rascunho morre
      pad.remove();
    };
    function sendPad() {
      const t = box.innerText.trim();
      if (!t) { close(); return; }
      if (!hasRealText(t)) { BISA.toast('Nada para enviar — só pontuação.'); return; }     // não fecha — deixa completar
      if (sessionState !== 'idle') { BISA.toast('Aguarde o Claude terminar.'); return; }   // não fecha — texto preservado
      // conversa por voz: mensagem ditada + 🗣 ligado → a resposta será lida.
      // Destrava o <audio> AGORA (ainda dentro do gesto do toque no Enviar) —
      // sem isso o play() programático do finalizeStream é engolido pelo iOS.
      voiceReplyPending = vozLoop && usedDictation;
      if (voiceReplyPending) { const a = getTtsAudio(); try { a.src = SILENT_WAV; a.play().catch(() => {}); } catch {} }
      logMetric('envio', { ditado: usedDictation, texto: t.slice(0, 600) });
      close(); commitText(t);
    }
    onTap(pad.querySelector('.wp-send'), sendPad);
    onTap(pad.querySelector('.wp-send-mini'), sendPad);
    onTap(pad.querySelector('.wp-cancel'), close);
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
    mount(el) {
      restoreConvo();   // transcript da última visita (a sessão já retoma via --resume)
      unsub = BISA.onWs(handleWs);
      selHandler = () => { clearTimeout(selTimer); selTimer = setTimeout(checkSelection, 250); };
      document.addEventListener('selectionchange', selHandler);
      renderShell(el);
    },
    unmount() {
      if (unsub) { unsub(); unsub = null; }
      if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = 0; }
      if (selHandler) { document.removeEventListener('selectionchange', selHandler); selHandler = null; }
      clearTimeout(selTimer); hideSelChip(); hideRespPill(); stopSpeak();
      if (runTimer) { clearInterval(runTimer); runTimer = 0; }
      stopDictation();
      if (currentView === 'notas' && window.BISO_NOTAS) window.BISO_NOTAS.unmount();
      if (currentView === 'canvas' && window.BISO_CANVAS) window.BISO_CANVAS.unmount();
      if (currentView === 'fit' && window.BISO_FIT) window.BISO_FIT.unmount();
      document.querySelectorAll('.biso-radial-overlay, .notas-ov, .cv-ov, .cv-imgview, .ia-root, .iae-root, .ia-notepop').forEach(o => o.remove());
      saveConvo();      // preserva o transcript p/ a próxima visita
      convo = []; streaming = null; sessionState = 'idle';
      root = contentEl = nbScroll = nbPage = nbStatus = nbInterrupt = nbWrap = nbFoot = null;
    },
  };
})();
