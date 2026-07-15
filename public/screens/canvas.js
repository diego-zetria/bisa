// screens/canvas.js — "Canvas": quadro infinito estilo Miro/Obsidian Canvas.
// Cartões de texto (markdown) + tinta à mão livre (Pencil). Cartões salvam como
// .canvas (JSON Canvas, abre no Obsidian); a tinta vai num irmão <path>.ink.json.
// Dedo = pan/zoom · caneta = ferramenta ativa (✎ Texto cria/edita/move cartão,
// ✏️ Tinta desenha). Mundo = um <div> com transform translate+scale (DOM cards
// mantêm Scribble nativo). Ink num <canvas> fixo, redesenhado a cada câmera.
// Exposto como window.BISO_CANVAS; a aba "Canvas" do Biso o monta.
(function () {
  if (!document.getElementById('cv-styles')) {
    const s = document.createElement('style'); s.id = 'cv-styles';
    s.textContent = `
      .cv-root { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--bg); }
      .cv-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; flex-shrink:0; overflow-x:auto;
        -webkit-overflow-scrolling:touch; border-bottom:1px solid var(--line); background:var(--surface); }
      .cv-name { flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cv-name .dot { color:var(--warn); }
      .cv-btn { background:var(--surface-2); border:1px solid var(--line); color:var(--ink); border-radius:10px; min-height:40px; padding:0 13px; font-size:.9rem; flex-shrink:0; }
      .cv-btn.primary { background:var(--primary); color:var(--primary-ink); border:none; }
      .cv-btn.on { background:var(--primary); color:var(--primary-ink); border-color:var(--primary); }
      .cv-stage { position:relative; flex:1; min-height:0; overflow:hidden; touch-action:none;
        background:var(--surface-2);
        background-image: radial-gradient(circle, var(--line) 1px, transparent 1px);
        background-size: 24px 24px; }
      .cv-world { position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform; }
      .cv-ink { position:absolute; inset:0; pointer-events:none; z-index:5; }
      /* conexões: SVG em coords de mundo, atrás dos cartões; só os hit-paths capturam toque */
      .cv-edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; }
      .cv-edges .cv-edge { stroke:var(--ink-soft); stroke-width:2; fill:none; }
      .cv-edges .cv-edge-arrow { fill:var(--ink-soft); stroke:none; }
      .cv-edges .cv-edge-hit { stroke:transparent; stroke-width:18; fill:none; pointer-events:stroke; cursor:pointer; }
      .cv-edges .cv-edge-temp { stroke:var(--primary); stroke-width:2; fill:none; stroke-dasharray:6 5; pointer-events:none; }
      .cv-edges .cv-edge-lbl { font-size:12px; fill:var(--ink-soft); paint-order:stroke; stroke:var(--surface); stroke-width:4; stroke-linejoin:round; }
      .cv-edge-pop { position:fixed; z-index:1250; width:232px; padding:12px; background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
      /* popover do ✦ Perguntar (ancorado no botão do cartão) */
      .cv-ask-pop { position:fixed; z-index:1250; width:min(88vw,320px); padding:12px; background:var(--surface);
        border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
      .cv-ask-pop .ask-hd { font-weight:600; font-size:.88rem; margin-bottom:8px; color:var(--primary); }
      .cv-ask-pop textarea { width:100%; min-height:64px; box-sizing:border-box; border:1px solid var(--line); border-radius:10px;
        background:var(--surface-2); color:var(--ink); padding:8px 10px; font-size:1rem; resize:vertical; }
      .cv-ask-pop .ask-row { display:flex; gap:8px; margin-top:8px; }
      .cv-ask-pop .ask-row .cv-btn { flex:1; }
      .cv-ask-pop .ask-status { margin-top:6px; color:var(--ink-soft); font-size:.82rem; min-height:1.1em; }
      .cv-edge-pop .cv-sw { width:30px; height:30px; border-radius:50%; border:2px solid transparent; cursor:pointer; }
      .cv-edge-pop .cv-sw.on { border-color:var(--ink); box-shadow:0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
      .cv-edge-pop .cv-sw-none { background:var(--surface-2); color:var(--ink-soft); font-size:.85rem; border:1px solid var(--line); }
      .cv-card { position:absolute; background:var(--surface); border:1px solid var(--line); border-radius:12px;
        box-shadow:var(--shadow); display:flex; flex-direction:column; overflow:hidden; min-width:120px; }
      .cv-card .hd { height:26px; flex-shrink:0; background:var(--surface-2); border-bottom:1px solid var(--line);
        display:flex; align-items:center; touch-action:none; }
      .cv-card .hd .cv-grip { flex:1; text-align:center; cursor:grab; touch-action:none; color:var(--ink-soft); font-size:.7rem; letter-spacing:2px; line-height:26px; }
      .cv-card .hd .cv-grip:active { cursor:grabbing; }
      .cv-card .hd .cv-card-del { width:30px; height:26px; flex-shrink:0; border:none; background:none; padding:0;
        color:var(--ink-soft); font-size:.82rem; line-height:1; cursor:pointer; }
      .cv-card .hd .cv-card-del:active { color:var(--warn, #c0392b); }
      .cv-card .hd .cv-card-ask { width:30px; height:26px; flex-shrink:0; border:none; background:none; padding:0;
        color:var(--primary); font-size:.9rem; line-height:1; cursor:pointer; }
      .cv-card .hd .cv-card-color { width:28px; height:26px; flex-shrink:0; border:none; background:none; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; }
      .cv-card .hd .cv-card-color .dot { width:13px; height:13px; border-radius:50%; background:var(--ink-soft); box-shadow:inset 0 0 0 1px rgba(0,0,0,.18); }
      .cv-card .cv-resize { position:absolute; right:0; bottom:0; width:22px; height:22px; cursor:nwse-resize; touch-action:none; z-index:2;
        background:linear-gradient(135deg, transparent 0 55%, var(--ink-soft) 55% 66%, transparent 66% 78%, var(--ink-soft) 78% 89%, transparent 89%); opacity:.45; }
      /* popover de cores (ancorado no botão de cor do cartão) */
      .cv-color-pop { position:fixed; z-index:1250; display:flex; gap:8px; flex-wrap:wrap; width:188px; padding:12px;
        background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
      .cv-color-pop .cv-sw { width:36px; height:36px; border-radius:50%; border:2px solid transparent; cursor:pointer; }
      .cv-color-pop .cv-sw.on { border-color:var(--ink); box-shadow:0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
      .cv-color-pop .cv-sw-none { background:var(--surface-2); color:var(--ink-soft); font-size:.9rem; border:1px solid var(--line); }
      .cv-ink-sizes { display:flex; gap:6px; width:100%; margin-top:4px; }
      .cv-ink-sizes .cv-btn { flex:1; }
      /* cartão selecionado (multisseleção) */
      .cv-card.cv-sel { outline:2px solid var(--primary); outline-offset:2px; }
      /* retângulo de marquee */
      .cv-marquee { position:absolute; z-index:40; border:1.5px dashed var(--primary); background:rgba(80,140,240,0.10); pointer-events:none; }
      /* barra de ações da seleção (tinta/cartões) */
      .cv-selbar { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); z-index:60; display:flex; gap:8px;
        background:var(--surface); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); padding:6px; }
      .cv-align-pop { position:fixed; z-index:1250; display:grid; grid-template-columns:repeat(3,1fr); gap:6px; width:160px; padding:10px;
        background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow); }
      .cv-search { position:fixed; left:50%; top:14px; transform:translateX(-50%); z-index:1250; display:flex; align-items:center; gap:6px;
        background:var(--surface); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); padding:6px 8px; max-width:92vw; }
      .cv-search-info { color:var(--ink-soft); font-size:.8rem; white-space:nowrap; padding:0 4px; }
      /* grupos: retângulo rotulado atrás de tudo; corpo click-through, só controles interagem */
      .cv-group { position:absolute; box-sizing:border-box; border:1.5px dashed var(--ink-soft); border-radius:14px; background:transparent; pointer-events:none; }
      .cv-group .cv-group-hd { display:flex; align-items:center; height:28px; padding:0 2px; pointer-events:auto;
        background:var(--surface-2); border-radius:12px 12px 0 0; border-bottom:1px solid var(--line); }
      .cv-group .cv-grip { cursor:grab; touch-action:none; color:var(--ink-soft); font-size:.7rem; letter-spacing:2px; padding:0 8px; line-height:28px; }
      .cv-group .cv-grip:active { cursor:grabbing; }
      .cv-group .cv-group-label { flex:1; min-width:0; font-size:.8rem; font-weight:600; color:var(--ink); outline:none; overflow:hidden; white-space:nowrap; padding:0 2px; }
      .cv-group .cv-group-label:empty::before { content:attr(data-ph); color:var(--ink-soft); font-weight:400; }
      .cv-group .cv-card-color { width:28px; height:28px; flex-shrink:0; border:none; background:none; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; pointer-events:auto; }
      .cv-group .cv-card-color .dot { width:13px; height:13px; border-radius:50%; background:var(--ink-soft); box-shadow:inset 0 0 0 1px rgba(0,0,0,.18); }
      .cv-group .cv-card-del { width:30px; height:28px; flex-shrink:0; border:none; background:none; padding:0; color:var(--ink-soft); font-size:.82rem; line-height:1; cursor:pointer; pointer-events:auto; }
      .cv-group .cv-card-del:active { color:var(--warn, #c0392b); }
      .cv-group .cv-resize { position:absolute; right:0; bottom:0; width:22px; height:22px; cursor:nwse-resize; touch-action:none; pointer-events:auto; z-index:2;
        background:linear-gradient(135deg, transparent 0 55%, var(--ink-soft) 55% 66%, transparent 66% 78%, var(--ink-soft) 78% 89%, transparent 89%); opacity:.45; }
      /* escudo durante o arraste do cartão: cobre tudo (não-editável) p/ o Scribble não engatar */
      .cv-drag-shield { position:absolute; inset:0; z-index:50; background:transparent; touch-action:none; cursor:grabbing; }
      .cv-card .bd { flex:1; padding:8px 10px; outline:none; font-size:15px; line-height:1.4; color:var(--ink);
        overflow:auto; white-space:pre-wrap; word-break:break-word; -webkit-user-modify:read-write; }
      .cv-card .bd:empty::before { content:'escreva…'; color:var(--ink-soft); }
      /* nós de mídia (arquivo/link) */
      .cv-card .bd.cv-media { padding:0; overflow:hidden; }
      .cv-card .bd.cv-media:empty::before { content:none; }
      .cv-media-img { width:100%; height:100%; object-fit:contain; display:block; background:var(--surface-2); pointer-events:none; }
      .cv-media-frame { width:100%; height:100%; border:none; background:#fff; }
      .cv-card .bd.cv-media-pdf { position:relative; background:#fff; display:flex; align-items:center; justify-content:center; }
      .cv-pdf-thumb { max-width:100%; max-height:100%; object-fit:contain; pointer-events:none; }
      .cv-pdf-open { position:absolute; right:8px; bottom:8px; border:none; border-radius:999px; padding:7px 13px;
        background:var(--ink); color:var(--bg); font-size:.82rem; font-weight:600; cursor:pointer; box-shadow:var(--shadow); }
      /* imagem no cartão: wrapper relativo p/ ancorar o pill "⤢ Ver" */
      .cv-card .bd.cv-media-imgwrap { position:relative; }
      /* visualizador de imagem (lightbox) — pinça = zoom · arrasto = mover · 2 toques = zoom */
      .cv-imgview { position:fixed; inset:0; z-index:1300; background:rgba(8,9,11,.96); display:flex; flex-direction:column; }
      .cv-imgview .iv-bar { display:flex; align-items:center; gap:10px; padding:8px 12px; flex-shrink:0; }
      .cv-imgview .iv-x { background:rgba(255,255,255,.12); border:none; color:#fff; border-radius:50%;
        min-width:44px; min-height:44px; font-size:1.05rem; flex-shrink:0; }
      .cv-imgview .iv-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        font-size:.9rem; color:#e8e8ea; }
      .cv-imgview .iv-act { background:rgba(255,255,255,.12); border:none; color:#fff; border-radius:999px;
        min-height:40px; padding:0 15px; font-size:.86rem; font-weight:600; flex-shrink:0; }
      .cv-imgview .iv-zoom { font-variant-numeric:tabular-nums; font-size:.8rem; color:#9a9aa2; min-width:48px;
        text-align:right; flex-shrink:0; }
      .cv-imgview .iv-stage { flex:1; min-height:0; position:relative; overflow:hidden; touch-action:none; }
      .cv-imgview .iv-img { position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform;
        max-width:none; user-select:none; -webkit-user-drag:none; pointer-events:none; }
      .cv-card .bd.cv-media-link { padding:10px 12px; }
      .cv-media-link a { color:var(--primary); text-decoration:none; display:flex; flex-direction:column; gap:4px; font-weight:600; }
      .cv-media-link .cv-media-sub { font-weight:400; font-size:.74rem; color:var(--ink-soft); word-break:break-all; }
      .cv-card .bd.cv-media-md { padding:10px 12px; overflow:auto; }
      .cv-media-md .cv-media-name { font-weight:600; margin-bottom:6px; color:var(--ink-soft); font-size:.8rem; }
      .cv-media-md .cv-muted { color:var(--ink-soft); }
      .cv-card .bd.cv-media-file { padding:14px; display:flex; align-items:center; }
      .cv-media-file a { color:var(--primary); }
      /* markdown renderizado dentro do cartão (modo leitura) */
      .cv-card .bd h1, .cv-card .bd h2, .cv-card .bd h3 { font-size:1.05em; margin:.2em 0; font-weight:700; }
      .cv-card .bd p { margin:0 0 .4em; } .cv-card .bd p:last-child { margin-bottom:0; }
      .cv-card .bd ul, .cv-card .bd ol { margin:.2em 0 .2em 1.15em; padding:0; }
      .cv-card .bd a { color:var(--primary); }
      .cv-card .bd code { background:var(--surface-2); border-radius:4px; padding:0 4px; font-family:ui-monospace,monospace; font-size:.9em; }
      .cv-card .bd strong { font-weight:700; }
      .cv-card.editing .bd { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:14px; }
      .cv-zoom { font-variant-numeric:tabular-nums; color:var(--ink-soft); font-size:.78rem; min-width:46px; text-align:center; }
      .cv-hint { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); z-index:6;
        background:var(--ink); color:var(--bg); border-radius:999px; padding:6px 14px; font-size:.78rem; opacity:.85; pointer-events:none; }
      .cv-ov { position:fixed; inset:0; z-index:1200; background:rgba(0,0,0,.34); }
      .cv-panel { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(94vw,440px); max-height:84vh; overflow:auto;
        background:var(--surface); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow); padding:16px; }
      .cv-li { display:flex; align-items:center; gap:10px; padding:11px 6px; border-bottom:1px solid var(--line); cursor:pointer; }
      .cv-li:last-child { border-bottom:none; }
    `;
    document.head.appendChild(s);
  }

  function onTap(el, fn) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault();
      const sw = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', sw, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', sw, { capture: true }), 500);
      fn(e); });
  }
  // toque tolerante a scroll: não dá preventDefault no pointerdown (preserva a rolagem
  // nativa da Pencil/dedo dentro de listas com overflow); só dispara se quase não houver arraste.
  function onScrollTap(el, fn) {
    let sx = 0, sy = 0, moved = false;
    el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; moved = false; });
    el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) moved = true; });
    el.addEventListener('pointerup', (e) => { if (!moved) fn(e); });
  }
  const elx = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => Date.now().toString(16) + Math.random().toString(16).slice(2, 8);

  // ── Estado ───────────────────────────────────────────────────────────────
  let root, stage, world, ink, ictx, nameEl, zoomEl;
  let cam = { x: 0, y: 0, zoom: 1 };
  let cards = [];                 // { id, x, y, width, height, text, el, bd }
  let groups = [];                // { id, x, y, width, height, label, color, el, labelEl }
  let strokes = [];               // { points:[[wx,wy,p]], size, color }
  let otherNodes = [], edges = [], extraKeys = {};   // round-trip do Obsidian
  let tool = 'text';              // 'text' | 'ink'
  let currentPath = null, dirty = false, baseHash = null;
  let getStroke = null;
  let drawRAF = 0;
  let ro = null;                  // ResizeObserver do stage
  let edgeSvg = null;             // camada SVG das conexões (dentro do .world)
  let toolBtns = {};              // { text, ink, link } → botões da barra

  // ── Desfazer / refazer (snapshots imutáveis do JSON do quadro) ──────────────
  // O estado é pequeno e serializável (cartões + traços). Snapshot por GESTO
  // (fim de traço, soltar cartão, sessão de edição de texto, criar) — nunca por
  // pointermove. beginChange() guarda o pré-estado; commitChange() empilha se mudou.
  let undoStack = [], redoStack = [], pendingSnap = null;
  function snapshot() {
    return JSON.stringify({
      cards: cards.map((c) => { const b = { id: c.id, kind: c.kind || 'text', x: c.x, y: c.y, width: Math.round(c.el.offsetWidth || c.width), height: Math.round(c.el.offsetHeight || c.height), color: c.color }; if ((c.kind || 'text') === 'text') b.text = c.text || ''; else if (c.kind === 'file') { b.file = c.file; if (c.subpath) b.subpath = c.subpath; } else if (c.kind === 'link') b.url = c.url; return b; }),
      groups: groups.map((g) => ({ id: g.id, x: g.x, y: g.y, width: g.width, height: g.height, label: g.labelEl.innerText, color: g.color })),
      strokes, otherNodes, edges, extraKeys,
    });
  }
  function beginChange() { if (pendingSnap == null) pendingSnap = snapshot(); }
  function commitChange() {
    if (pendingSnap == null) return;
    const now = snapshot();
    if (now !== pendingSnap) { undoStack.push(pendingSnap); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
    pendingSnap = null;
  }
  function resetHistory() { undoStack = []; redoStack = []; pendingSnap = null; }
  function restoreSnap(snap) {
    const s = JSON.parse(snap);
    clearBoard();
    otherNodes = s.otherNodes || []; edges = s.edges || []; extraKeys = s.extraKeys || {}; strokes = s.strokes || [];
    (s.groups || []).forEach((g) => addGroup(g));
    (s.cards || []).forEach((c) => ((c.kind && c.kind !== 'text') ? addMedia(c) : addCard(c)));
    renderEdges(); scheduleDraw();
  }
  function undo() { if (!undoStack.length) { BISA.toast('Nada para desfazer'); return; } redoStack.push(snapshot()); restoreSnap(undoStack.pop()); markDirty(); }
  function redo() { if (!redoStack.length) { BISA.toast('Nada para refazer'); return; } undoStack.push(snapshot()); restoreSnap(redoStack.pop()); markDirty(); }

  // ── Coordenadas ───────────────────────────────────────────────────────────
  function s2w(sx, sy) { return { x: sx / cam.zoom - cam.x, y: sy / cam.zoom - cam.y }; }
  function applyCam() {
    if (world) world.style.transform = `scale(${cam.zoom}) translate(${cam.x}px, ${cam.y}px)`;
    if (zoomEl) zoomEl.textContent = Math.round(cam.zoom * 100) + '%';
    scheduleDraw();
  }
  function stageXY(e) { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // ── Cartões ───────────────────────────────────────────────────────────────
  function addCard(node) {
    const c = Object.assign({ id: uid(), kind: 'text', x: 0, y: 0, width: 240, height: 120, text: '' }, node);
    const el = elx('div', 'cv-card'); el.dataset.kind = 'text';
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.width = c.width + 'px';
    // carregado/redimensionado (altura veio do nó) → altura fixa; novo cartão → cresce com o texto
    if (node && node.height != null) el.style.height = c.height + 'px'; else el.style.minHeight = c.height + 'px';
    const hd = elx('div', 'hd');
    const grip = elx('span', 'cv-grip', '⋯');            // arrastar
    const askBtn = elx('button', 'cv-card-ask', '✦'); askBtn.title = 'Perguntar ao Claude (resposta vira cartão filho)';
    const colorBtn = elx('button', 'cv-card-color'); colorBtn.title = 'Cor'; colorBtn.innerHTML = '<span class="dot"></span>';
    const del = elx('button', 'cv-card-del', '✕'); del.title = 'Apagar cartão';
    hd.append(grip, askBtn, colorBtn, del);
    const bd = elx('div', 'bd'); bd.setAttribute('spellcheck', 'false');
    const rz = elx('div', 'cv-resize'); rz.title = 'Redimensionar';
    el.append(hd, bd, rz); world.appendChild(el);
    c.el = el; c.bd = bd; c.colorBtn = colorBtn;
    renderCardView(c);                                         // começa em modo leitura (markdown)
    // tocar com a caneta entra em edição (cru); wikilink não edita, só avisa
    bd.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      const a = e.target.closest && e.target.closest('a[data-slug]');
      if (a) { e.preventDefault(); e.stopPropagation(); BISA.toast('Nota: ' + a.dataset.slug); return; }
      e.stopPropagation();
      if (bd.getAttribute('contenteditable') !== 'true') enterCardEdit(c);
    });
    bd.addEventListener('input', () => { if (bd.getAttribute('contenteditable') === 'true') { c.text = bd.innerText; markDirty(); } });
    bd.addEventListener('blur', () => exitCardEdit(c));
    grip.addEventListener('pointerdown', (e) => startCardDrag(e, c));   // arrastar pelo "⋯"
    rz.addEventListener('pointerdown', (e) => startCardResize(e, c));   // redimensionar pelo canto
    onTap(colorBtn, () => openColorPicker(c, colorBtn));
    onTap(askBtn, () => openAskPop(c, askBtn));
    onTap(del, () => deleteCard(c));
    applyCardColor(c);
    cards.push(c);
    return c;
  }

  // ── ✦ Perguntar no cartão (padrão Augmented Canvas) ─────────────────────────
  // A resposta do Claude vira um cartão FILHO conectado; a pergunta fica escrita
  // na aresta; a corrente de setas que leva até o cartão vira o histórico da
  // conversa. Perguntar de novo num cartão-resposta continua o fio.
  function chainTextFor(c) {
    const byId = new Map(cards.map((x) => [x.id, x]));
    const seen = new Set([c.id]); const parts = [];
    let cur = c;
    for (let i = 0; i < 12; i++) {   // sobe pelos ancestrais (mais antigo primeiro)
      const inc = edges.find((ed) => ed.toNode === cur.id && byId.get(ed.fromNode) && !seen.has(ed.fromNode));
      if (!inc) break;
      const parent = byId.get(inc.fromNode); seen.add(parent.id);
      const txt = (parent.kind || 'text') === 'text' ? String(parent.text || '').trim().slice(0, 600) : ('[arquivo] ' + (parent.file || parent.url || ''));
      parts.unshift(txt + (inc.label ? '\n[pergunta] ' + inc.label : ''));
      cur = parent;
    }
    return parts.join('\n---\n').slice(0, 9000);
  }
  function spawnAnswer(parent, question, answer) {
    beginChange();
    const pr = rectOf(parent);
    const kids = edges.filter((ed) => ed.fromNode === parent.id).length;   // desloca irmãos p/ não sobrepor
    const nc = addCard({ x: Math.round(pr.x + kids * 48), y: Math.round(pr.y + pr.h + 80), width: 320, text: answer });
    edges.push({ id: uid(), fromNode: parent.id, toNode: nc.id, toEnd: 'arrow', label: question ? question.slice(0, 100) : undefined });
    markDirty(); commitChange(); renderEdges();
    return nc;
  }
  function openAskPop(c, anchor) {
    const ov = elx('div', 'cv-ov'); ov.style.background = 'transparent';
    const pop = elx('div', 'cv-ask-pop');
    pop.innerHTML = `<div class="ask-hd">✦ Perguntar sobre este cartão</div>
      <textarea placeholder="Sua pergunta… (vazio = desenvolver o cartão)"></textarea>
      <div class="ask-row"><button class="cv-btn primary" data-go>✦ Perguntar</button></div>
      <div class="ask-status"></div>`;
    ov.appendChild(pop); document.body.appendChild(ov);
    ov.onclick = () => ov.remove(); pop.onclick = (e) => e.stopPropagation();
    const r = anchor.getBoundingClientRect(); const M = 8;
    pop.style.left = Math.max(M, Math.min(window.innerWidth - 320 - M, r.left - 60)) + 'px';
    pop.style.top = Math.max(M, Math.min(window.innerHeight - 220 - M, r.bottom + 8)) + 'px';
    const ta = pop.querySelector('textarea'), go = pop.querySelector('[data-go]'), status = pop.querySelector('.ask-status');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
    onTap(go, ask);
    async function ask() {
      const question = ta.value.trim();
      go.disabled = true; status.textContent = '✦ Claude pensando…';
      try {
        const cardTxt = (c.kind || 'text') === 'text' ? String(c.text || '') : ('[arquivo] ' + (c.file || c.url || ''));
        const r2 = await BISA.api('/canvas-ai', { method: 'POST', json: { mode: 'ask', card: cardTxt, question, chain: chainTextFor(c) } });
        const answer = ((r2 && r2.answer) || '').trim();
        if (!answer) { status.textContent = 'A IA não respondeu.'; go.disabled = false; return; }
        ov.remove();
        spawnAnswer(c, question, answer);
        BISA.toast('✦ Resposta no cartão filho');
      } catch (e) { status.textContent = 'Erro: ' + e.message; go.disabled = false; }
    }
  }
  // texto rico: leitura = markdown renderizado (c.text é a fonte); edição = cru
  function renderCardView(c) { const t = (c.text || '').trim(); c.bd.innerHTML = t ? BISA.renderMarkdown(c.text) : ''; }
  function enterCardEdit(c) {
    beginChange();
    c.bd.setAttribute('contenteditable', 'true'); c.bd.textContent = c.text || ''; c.el.classList.add('editing'); c.bd.focus();
    try { const r = document.createRange(); r.selectNodeContents(c.bd); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch {}
  }
  function exitCardEdit(c) {
    if (c.bd.getAttribute('contenteditable') !== 'true') return;
    c.text = c.bd.innerText; c.bd.removeAttribute('contenteditable'); c.el.classList.remove('editing');
    renderCardView(c); markDirty(); commitChange();
  }

  // ── Nós de mídia: arquivo (imagem/PDF/.md) e link (URL) ────────────────────
  // Entram no MESMO array `cards` (com c.kind) → arraste/resize/cor/conexões/
  // seleção/snap funcionam igual. Salvam como nós type:file / type:link do JSON Canvas.
  function rawUrl(p) { return '/vault/raw?path=' + encodeURIComponent(p) + '&token=' + encodeURIComponent(BISA.token || ''); }
  function extOf(name) { return (name && name.indexOf('.') >= 0) ? name.split('.').pop().toLowerCase() : ''; }
  function iconFor(name) { const e = extOf(name); if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return '🖼'; if (e === 'pdf') return '📕'; if (e === 'md') return '📄'; if (e === 'canvas') return '🗂'; return '📎'; }
  function mediaBody(c) {
    const bd = elx('div', 'bd cv-media');
    if (c.kind === 'link') {
      bd.classList.add('cv-media-link');
      let host = c.url; try { host = new URL(c.url).host || c.url; } catch {}
      bd.innerHTML = `<a href="${esc(c.url)}" target="_blank" rel="noopener">🔗 ${esc(host)}<span class="cv-media-sub">${esc(c.url)}</span></a>`;
      return bd;
    }
    const e = extOf(c.file);
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) {
      bd.classList.add('cv-media-imgwrap');
      const img = document.createElement('img'); img.className = 'cv-media-img'; img.src = rawUrl(c.file); img.alt = c.file;
      const open = elx('button', 'cv-pdf-open', '⤢ Ver');   // mesmo pill do PDF ("✎ Anotar")
      bd.append(img, open);
      onTap(open, () => openImageViewer(c.file));
    }
    else if (e === 'pdf') {
      bd.classList.add('cv-media-pdf');
      const thumb = document.createElement('canvas'); thumb.className = 'cv-pdf-thumb';
      const open = elx('button', 'cv-pdf-open', '✎ Anotar');
      bd.append(thumb, open);
      onTap(open, () => { if (window.BISO_PDF) window.BISO_PDF.open(c.file, { onCropCard: (rel) => placeMedia({ kind: 'file', file: rel }), onClose: () => window.BISO_PDF.thumb(c.file, thumb) }); });
      if (window.BISO_PDF) window.BISO_PDF.thumb(c.file, thumb);
    }
    else if (e === 'md') { bd.classList.add('cv-media-md'); bd.innerHTML = '<div class="cv-media-name">📄 ' + esc((c.file || '').split('/').pop()) + '</div><div class="cv-md-body cv-muted">…</div>'; BISA.api('/vault/file?path=' + encodeURIComponent(c.file)).then((r) => { const mb = bd.querySelector('.cv-md-body'); if (mb) { mb.classList.remove('cv-muted'); mb.innerHTML = BISA.renderMarkdown(r.content || ''); } }).catch(() => {}); }
    else { bd.classList.add('cv-media-file'); bd.innerHTML = `<a href="${rawUrl(c.file)}" target="_blank" rel="noopener">${iconFor(c.file)} ${esc((c.file || '').split('/').pop())}</a>`; }
    return bd;
  }
  function addMedia(node) {
    const c = Object.assign({ id: uid(), x: 0, y: 0, width: 300, height: 220 }, node);
    const el = elx('div', 'cv-card'); el.dataset.kind = c.kind;
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.width = c.width + 'px'; el.style.height = c.height + 'px';
    const hd = elx('div', 'hd');
    const grip = elx('span', 'cv-grip', '⋯');
    const askBtn = elx('button', 'cv-card-ask', '✦'); askBtn.title = 'Perguntar ao Claude';
    const colorBtn = elx('button', 'cv-card-color'); colorBtn.title = 'Cor'; colorBtn.innerHTML = '<span class="dot"></span>';
    const del = elx('button', 'cv-card-del', '✕'); del.title = 'Apagar';
    hd.append(grip, askBtn, colorBtn, del);
    const bd = mediaBody(c);
    const rz = elx('div', 'cv-resize'); rz.title = 'Redimensionar';
    el.append(hd, bd, rz); world.appendChild(el);
    c.el = el; c.bd = bd; c.colorBtn = colorBtn;
    grip.addEventListener('pointerdown', (e) => startCardDrag(e, c));
    rz.addEventListener('pointerdown', (e) => startCardResize(e, c));
    onTap(colorBtn, () => openColorPicker(c, colorBtn));
    onTap(askBtn, () => openAskPop(c, askBtn));
    onTap(del, () => deleteCard(c));
    applyCardColor(c);
    cards.push(c);
    return c;
  }
  function placeMedia(node) {
    const r = stage.getBoundingClientRect(), ctr = s2w(r.width / 2, r.height / 2);
    const def = node.kind === 'link' ? { width: 260, height: 92 } : { width: 300, height: 220 };
    beginChange();
    addMedia(Object.assign({ x: Math.round(ctr.x - def.width / 2), y: Math.round(ctr.y - def.height / 2) }, def, node));
    markDirty(); commitChange();
    BISA.toast('Adicionado ao canvas');
  }
  // ── Visualizador de imagem (lightbox, espelha o fluxo do PDF) ───────────────
  // Tela cheia: pinça = zoom (ancorado nos dedos) · arrasto = mover · toque duplo =
  // alterna ajustar↔2.5x no ponto tocado · ✕ fecha. Zoom mostrado relativo ao
  // "ajustar à tela" (100% = imagem inteira visível).
  function openImageViewer(file) {
    const ov = elx('div', 'cv-imgview');
    ov.innerHTML = `<div class="iv-bar"><button class="iv-x">✕</button>
      <div class="iv-name">🖼 ${esc((file || '').split('/').pop())}</div>
      <button class="iv-act" data-annot>✎ Anotar</button><button class="iv-act" data-edit>✂ Editar</button>
      <span class="iv-zoom">100%</span></div>
      <div class="iv-stage"></div>`;
    document.body.appendChild(ov);
    // Anotar (Pencil, sidecar .annot.json) e Editar (Cropper: recortar/girar → cópia png).
    // O derivado entra no canvas como cartão novo — o original fica intacto.
    onTap(ov.querySelector('[data-annot]'), () => { ov.remove(); if (window.BISO_IMG) BISO_IMG.open(file, { onCropCard: (rel) => placeMedia({ kind: 'file', file: rel }) }); });
    onTap(ov.querySelector('[data-edit]'), () => { ov.remove(); if (window.BISO_IMG) BISO_IMG.edit(file, { onSaved: (rel) => placeMedia({ kind: 'file', file: rel }) }); });
    const stg = ov.querySelector('.iv-stage'), zl = ov.querySelector('.iv-zoom');
    const img = document.createElement('img'); img.className = 'iv-img'; img.src = rawUrl(file); img.alt = file;
    stg.appendChild(img);

    let v = { x: 0, y: 0, z: 1 }, fit = 1, iw = 0, ih = 0;
    const apply = () => { img.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`; zl.textContent = Math.round((v.z / fit) * 100) + '%'; };
    const clamp = () => {   // eixo menor que a tela centraliza; maior fica sempre alcançável
      const r = stg.getBoundingClientRect(), w = iw * v.z, h = ih * v.z;
      v.x = w <= r.width ? (r.width - w) / 2 : Math.min(0, Math.max(r.width - w, v.x));
      v.y = h <= r.height ? (r.height - h) / 2 : Math.min(0, Math.max(r.height - h, v.y));
    };
    const fitImage = () => { const r = stg.getBoundingClientRect(); fit = Math.min(r.width / iw, r.height / ih, 1); v.z = fit; clamp(); apply(); };
    img.onload = () => { iw = img.naturalWidth || 1; ih = img.naturalHeight || 1; fitImage(); };
    const onResize = () => { if (iw) fitImage(); };
    window.addEventListener('resize', onResize);
    const close = () => { window.removeEventListener('resize', onResize); ov.remove(); };
    onTap(ov.querySelector('.iv-x'), close);

    // gestos (Pointer Events; dedo e Pencil valem igual num visualizador)
    const pts = new Map();
    let start = null, lastTap = 0;
    const mid = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 }; };
    stg.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { stg.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        const now = Date.now();
        if (now - lastTap < 300) {   // toque duplo
          const r = stg.getBoundingClientRect(), tx = e.clientX - r.left, ty = e.clientY - r.top;
          const target = v.z > fit * 1.1 ? fit : fit * 2.5;
          const k = target / v.z;
          v.x = tx - (tx - v.x) * k; v.y = ty - (ty - v.y) * k; v.z = target;
          clamp(); apply(); lastTap = 0;
        } else lastTap = now;
        start = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
      } else if (pts.size === 2) { start = { m: mid(), vx: v.x, vy: v.y, vz: v.z }; }
    });
    stg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1 && start && !start.m) {
        v.x = start.vx + (e.clientX - start.x); v.y = start.vy + (e.clientY - start.y);
        clamp(); apply();
      } else if (pts.size === 2 && start && start.m) {
        const m = mid(), r = stg.getBoundingClientRect();
        const z = Math.max(fit * 0.5, Math.min(8, start.vz * (m.d / start.m.d)));
        const k = z / start.vz;
        v.z = z;
        v.x = (m.x - r.left) - ((start.m.x - r.left) - start.vx) * k;
        v.y = (m.y - r.top) - ((start.m.y - r.top) - start.vy) * k;
        clamp(); apply();
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 1) { const a = [...pts.values()][0]; start = { x: a.x, y: a.y, vx: v.x, vy: v.y }; }   // 2→1 dedos: re-ancora o pan
      else if (!pts.size) start = null;
    };
    stg.addEventListener('pointerup', up); stg.addEventListener('pointercancel', up);
  }

  function openFilePicker() {
    const ov = elx('div', 'cv-ov'); const panel = elx('div', 'cv-panel');
    panel.innerHTML = '<h3 style="margin:0 0 10px">Inserir no canvas</h3>';
    const urlRow = elx('div'); urlRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px';
    const urlInp = document.createElement('input'); urlInp.placeholder = 'Colar um link (URL)…'; urlInp.style.cssText = 'flex:1;min-height:42px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);padding:8px 12px;font-size:1rem;';
    const urlBtn = elx('button', 'cv-btn primary', 'Add'); onTap(urlBtn, () => { const u = urlInp.value.trim(); if (!u) return; ov.remove(); placeMedia({ kind: 'link', url: u }); });
    urlRow.append(urlInp, urlBtn);
    const pathLbl = elx('div'); pathLbl.style.cssText = 'font-family:ui-monospace,monospace;font-size:.78rem;color:var(--ink-soft);margin-bottom:6px'; pathLbl.textContent = '.';
    const list = elx('div');
    panel.append(urlRow, pathLbl, list);
    ov.appendChild(panel); document.body.appendChild(ov); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation();
    async function go(rel) {
      pathLbl.textContent = rel; list.innerHTML = '<p style="color:var(--ink-soft)">…</p>';
      try {
        const data = await BISA.api('/vault/list?path=' + encodeURIComponent(rel)); list.innerHTML = '';
        if (rel !== '.') { const up = elx('div', 'cv-li', '📁 ..'); onScrollTap(up, () => { const p = rel.split('/'); p.pop(); go(p.join('/') || '.'); }); list.appendChild(up); }
        (data.entries || []).forEach((en) => { if (!en.dir && extOf(en.name) === 'canvas') return; const li = elx('div', 'cv-li', (en.dir ? '📁 ' : iconFor(en.name) + ' ') + esc(en.name)); onScrollTap(li, () => { if (en.dir) go(en.rel); else { ov.remove(); placeMedia({ kind: 'file', file: en.rel }); } }); list.appendChild(li); });
        if (!list.children.length) list.innerHTML = '<p style="color:var(--ink-soft)">vazio</p>';
      } catch (e) { list.innerHTML = `<p style="color:var(--ink-soft)">erro: ${esc(e.message)}</p>`; }
    }
    go('.');
  }
  // ── Cores (presets do JSON Canvas: "1".."6", ou hex) ───────────────────────
  const CV_COLORS = { '1': '#e05252', '2': '#e0902e', '3': '#ccab1f', '4': '#46b450', '5': '#25b0bf', '6': '#9061c2' };
  function colorHexOf(c) { return c.color ? (CV_COLORS[c.color] || c.color) : ''; }
  function applyCardColor(c) {
    if (!c.el) return;
    const hex = colorHexOf(c);
    c.el.style.borderColor = hex || '';
    c.el.style.boxShadow = hex ? `0 0 0 1px ${hex}, var(--shadow)` : 'var(--shadow)';
    const hd = c.el.querySelector('.hd'); if (hd) hd.style.background = hex ? (hex + '2a') : '';
    const dot = c.colorBtn && c.colorBtn.querySelector('.dot'); if (dot) dot.style.background = hex || 'var(--ink-soft)';
  }
  function setCardColor(o, k) { beginChange(); o.color = k || undefined; (o.labelEl ? applyGroupColor : applyCardColor)(o); markDirty(); commitChange(); }
  function openColorPicker(c, anchor) {
    const ov = elx('div', 'cv-ov'); ov.style.background = 'transparent';
    const pop = elx('div', 'cv-color-pop');
    Object.keys(CV_COLORS).forEach((k) => { const sw = elx('button', 'cv-sw' + (c.color === k ? ' on' : '')); sw.style.background = CV_COLORS[k]; onTap(sw, () => { setCardColor(c, k); ov.remove(); }); pop.appendChild(sw); });
    const none = elx('button', 'cv-sw cv-sw-none' + (c.color ? '' : ' on'), '✕'); none.title = 'Sem cor'; onTap(none, () => { setCardColor(c, null); ov.remove(); }); pop.appendChild(none);
    ov.appendChild(pop); document.body.appendChild(ov);
    ov.onclick = () => ov.remove(); pop.onclick = (e) => e.stopPropagation();
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
  }
  function startCardResize(e, c) {
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget, pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch {}
    const shield = elx('div', 'cv-drag-shield'); stage.appendChild(shield);   // sem Scribble durante o resize
    beginChange();
    const w0 = c.el.offsetWidth, h0 = c.el.offsetHeight, sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      c.width = Math.round(Math.max(120, w0 + (ev.clientX - sx) / cam.zoom));
      c.height = Math.round(Math.max(60, h0 + (ev.clientY - sy) / cam.zoom));
      c.el.style.width = c.width + 'px'; c.el.style.height = c.height + 'px'; c.el.style.minHeight = '';
      markDirty(); renderEdges();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shield.remove(); try { handle.releasePointerCapture(pid); } catch {} commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Conexões / setas (edges do JSON Canvas) ────────────────────────────────
  // SVG dentro do .world → segue pan/zoom pelo transform, sem redesenhar à câmera.
  // Só recomputamos quando um cartão move/redimensiona ou ao criar/apagar.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const SIDE_NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  function rectOf(c) { const w = c.el.offsetWidth || c.width, h = c.el.offsetHeight || c.height; return { x: c.x, y: c.y, w, h, cx: c.x + w / 2, cy: c.y + h / 2 }; }
  // ponto de ancoragem na BORDA do cartão, no meio do lado que aponta p/ (tx,ty)
  function cardAnchor(c, tx, ty) {
    const r = rectOf(c); const dx = tx - r.cx, dy = ty - r.cy;
    let side;
    if (Math.abs(dx) * r.h >= Math.abs(dy) * r.w) side = dx >= 0 ? 'right' : 'left';
    else side = dy >= 0 ? 'bottom' : 'top';
    if (side === 'right') return { x: r.x + r.w, y: r.cy, side };
    if (side === 'left') return { x: r.x, y: r.cy, side };
    if (side === 'bottom') return { x: r.cx, y: r.y + r.h, side };
    return { x: r.cx, y: r.y, side };
  }
  function ctrlPoint(a) { const n = SIDE_NORMAL[a.side] || [0, 0]; const k = 60; return { x: a.x + n[0] * k, y: a.y + n[1] * k }; }
  function edgePathD(a, b) {
    const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
    const na = SIDE_NORMAL[a.side] || [0, 0], nb = SIDE_NORMAL[b.side] || [0, 0];
    return `M ${a.x} ${a.y} C ${a.x + na[0] * k} ${a.y + na[1] * k} ${b.x + nb[0] * k} ${b.y + nb[1] * k} ${b.x} ${b.y}`;
  }
  function arrowD(tip, from) {   // triângulo com a ponta em tip, apontando de 'from' p/ tip
    let dx = tip.x - from.x, dy = tip.y - from.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const s = 11, px = -dy, py = dx;
    const bx = tip.x - dx * s, by = tip.y - dy * s;
    return `M ${tip.x} ${tip.y} L ${bx + px * s * 0.55} ${by + py * s * 0.55} L ${bx - px * s * 0.55} ${by - py * s * 0.55} Z`;
  }
  function svgEl(tag, cls) { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); return e; }
  function renderEdges() {
    if (!edgeSvg) return;
    edgeSvg.innerHTML = '';
    for (const ed of edges) {
      const from = cards.find((c) => c.id === ed.fromNode);
      const to = cards.find((c) => c.id === ed.toNode);
      if (!from || !to || from === to) continue;   // referência a nó não-cartão (grupo) → mantém em edges, não desenha
      const ra = rectOf(from), rb = rectOf(to);
      const a = cardAnchor(from, rb.cx, rb.cy), b = cardAnchor(to, ra.cx, ra.cy);
      ed.fromSide = a.side; ed.toSide = b.side;     // guarda os lados p/ o Obsidian
      const d = edgePathD(a, b);
      const hex = ed.color ? (CV_COLORS[ed.color] || ed.color) : '';
      const hit = svgEl('path', 'cv-edge-hit'); hit.setAttribute('d', d);
      hit.addEventListener('pointerdown', (e) => { e.stopPropagation(); openEdgeEditor(ed, e.clientX, e.clientY); });
      const line = svgEl('path', 'cv-edge'); line.setAttribute('d', d); if (hex) line.style.stroke = hex;
      edgeSvg.append(hit, line);
      if (ed.toEnd !== 'none') { const ar = svgEl('path', 'cv-edge-arrow'); ar.setAttribute('d', arrowD(b, ctrlPoint(b))); if (hex) ar.style.fill = hex; edgeSvg.appendChild(ar); }
      if (ed.label) { const mid = bezierMid(a, b); const t = svgEl('text', 'cv-edge-lbl'); t.setAttribute('x', mid.x); t.setAttribute('y', mid.y); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle'); if (hex) t.style.fill = hex; t.textContent = ed.label; edgeSvg.appendChild(t); }
    }
  }
  function bezierMid(a, b) {
    const k = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4); const na = SIDE_NORMAL[a.side] || [0, 0], nb = SIDE_NORMAL[b.side] || [0, 0];
    const c1x = a.x + na[0] * k, c1y = a.y + na[1] * k, c2x = b.x + nb[0] * k, c2y = b.y + nb[1] * k;
    return { x: (a.x + 3 * c1x + 3 * c2x + b.x) / 8, y: (a.y + 3 * c1y + 3 * c2y + b.y) / 8 };
  }
  function deleteEdge(ed) { beginChange(); const i = edges.indexOf(ed); if (i >= 0) edges.splice(i, 1); markDirty(); commitChange(); renderEdges(); BISA.toast('Conexão removida'); }
  // editor da conexão: rótulo + cor + apagar (tocar na seta abre)
  function openEdgeEditor(ed, cx, cy) {
    const ov = elx('div', 'cv-ov'); ov.style.background = 'transparent';
    const pop = elx('div', 'cv-edge-pop');
    const inp = document.createElement('input'); inp.placeholder = 'rótulo (opcional)'; inp.value = ed.label || '';
    inp.style.cssText = 'width:100%;min-height:38px;border-radius:9px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);padding:6px 10px;font-size:.95rem;box-sizing:border-box;margin-bottom:8px;';
    const sw = elx('div'); sw.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
    const none = elx('button', 'cv-sw cv-sw-none' + (ed.color ? '' : ' on'), '✕'); none.title = 'Sem cor'; sw.appendChild(none);
    const colSws = Object.keys(CV_COLORS).map((k) => { const b = elx('button', 'cv-sw' + (ed.color === k ? ' on' : '')); b.dataset.k = k; b.style.background = CV_COLORS[k]; sw.appendChild(b); return b; });
    const markOn = () => { none.classList.toggle('on', !ed.color); colSws.forEach((b) => b.classList.toggle('on', ed.color === b.dataset.k)); };
    const setCol = (k) => { beginChange(); ed.color = k || undefined; markDirty(); commitChange(); renderEdges(); markOn(); };
    onTap(none, () => setCol(null)); colSws.forEach((b) => onTap(b, () => setCol(b.dataset.k)));
    const del = elx('button', 'cv-btn', '🗑 Apagar conexão'); del.style.width = '100%'; onTap(del, () => { ov.remove(); deleteEdge(ed); });
    pop.append(inp, sw, del);
    ov.appendChild(pop); document.body.appendChild(ov);
    const save = () => { const v = inp.value.trim(); if (v !== (ed.label || '')) { beginChange(); ed.label = v || undefined; markDirty(); commitChange(); renderEdges(); } ov.remove(); };
    ov.onclick = save; pop.onclick = (e) => e.stopPropagation(); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 244, cx)) + 'px'; pop.style.top = Math.max(8, Math.min(window.innerHeight - 200, cy)) + 'px';
  }
  // arrastar de um cartão a outro (modo 🔗): cria edge from→to
  function startLink(e, from) {
    const shield = elx('div', 'cv-drag-shield'); stage.appendChild(shield);   // sem Scribble durante o arraste
    const temp = svgEl('path', 'cv-edge-temp'); edgeSvg.appendChild(temp);
    const draw = (wx, wy) => { const a = cardAnchor(from, wx, wy); temp.setAttribute('d', edgePathD(a, { x: wx, y: wy, side: 'left' })); };
    const w0 = s2w(...stageXY(e)); draw(w0.x, w0.y);
    const move = (ev) => { const [sx, sy] = stageXY(ev); const w = s2w(sx, sy); draw(w.x, w.y); };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      shield.remove(); temp.remove();   // remove ANTES do hit-test p/ enxergar o cartão de baixo
      const tEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const toEl = tEl && tEl.closest ? tEl.closest('.cv-card') : null;
      const to = toEl ? cards.find((c) => c.el === toEl) : null;
      if (to && to !== from) { beginChange(); edges.push({ id: uid(), fromNode: from.id, toNode: to.id, toEnd: 'arrow' }); markDirty(); commitChange(); renderEdges(); BISA.toast('Conectado'); }
      else BISA.toast('Solte sobre outro cartão p/ conectar');
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function onStageDownCapture(e) {
    if (e.pointerType === 'touch') return;
    const cardEl = e.target.closest && e.target.closest('.cv-card');
    if (tool === 'link') {                                        // 🔗: arrasta de um cartão a outro
      if (!cardEl) return; const from = cards.find((c) => c.el === cardEl); if (!from) return;
      e.preventDefault(); e.stopPropagation(); startLink(e, from); return;
    }
    if (tool === 'select' && cardEl) {                            // ⬚: tocar cartão = move a seleção (ou seleciona ele)
      const c = cards.find((x) => x.el === cardEl); if (!c) return;
      e.preventDefault(); e.stopPropagation();
      if (!selCards.includes(c)) { clearCardSel(); selCards = [c]; c.el.classList.add('cv-sel'); showCardSelBar(); }
      startCardsMove(e); return;
    }
  }

  // ── Grupos (node 'group' do JSON Canvas) ───────────────────────────────────
  // Retângulo rotulado ATRÁS dos cartões (e das conexões). Corpo click-through
  // (pointer-events:none) — só o cabeçalho e o canto de resize interagem. Arrastar
  // o grupo move junto os cartões cujo CENTRO está dentro dele (como no Obsidian).
  function addGroup(node) {
    const g = Object.assign({ id: uid(), x: 0, y: 0, width: 320, height: 240, label: '', color: undefined }, node);
    const el = elx('div', 'cv-group');
    el.style.left = g.x + 'px'; el.style.top = g.y + 'px'; el.style.width = g.width + 'px'; el.style.height = g.height + 'px';
    const hd = elx('div', 'cv-group-hd');
    const grip = elx('span', 'cv-grip', '⋯');
    const label = elx('div', 'cv-group-label'); label.setAttribute('contenteditable', 'true'); label.setAttribute('spellcheck', 'false'); label.dataset.ph = 'grupo'; label.textContent = g.label || '';
    const colorBtn = elx('button', 'cv-card-color'); colorBtn.title = 'Cor'; colorBtn.innerHTML = '<span class="dot"></span>';
    const del = elx('button', 'cv-card-del', '✕'); del.title = 'Apagar grupo';
    hd.append(grip, label, colorBtn, del);
    const rz = elx('div', 'cv-resize'); rz.title = 'Redimensionar';
    el.append(hd, rz);
    world.insertBefore(el, edgeSvg);   // antes da camada de conexões → atrás de tudo
    g.el = el; g.labelEl = label; g.colorBtn = colorBtn;
    label.addEventListener('focus', beginChange);
    label.addEventListener('input', () => { g.label = label.innerText; markDirty(); });
    label.addEventListener('blur', commitChange);
    label.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') e.stopPropagation(); });
    grip.addEventListener('pointerdown', (e) => startGroupDrag(e, g));
    rz.addEventListener('pointerdown', (e) => startGroupResize(e, g));
    onTap(colorBtn, () => openColorPicker(g, colorBtn));
    onTap(del, () => deleteGroup(g));
    applyGroupColor(g);
    groups.push(g);
    return g;
  }
  function applyGroupColor(g) {
    if (!g.el) return;
    const hex = colorHexOf(g);
    g.el.style.borderColor = hex || '';
    g.el.style.background = hex ? (hex + '14') : '';
    const hd = g.el.querySelector('.cv-group-hd'); if (hd) hd.style.background = hex ? (hex + '22') : '';
    const dot = g.colorBtn && g.colorBtn.querySelector('.dot'); if (dot) dot.style.background = hex || 'var(--ink-soft)';
  }
  function startGroupDrag(e, g) {
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget, pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch {}
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
    const shield = elx('div', 'cv-drag-shield'); stage.appendChild(shield);
    beginChange();
    const gx0 = g.x, gy0 = g.y, sx = e.clientX, sy = e.clientY;
    // cartões com o centro dentro do grupo no início → movem junto
    const inside = cards.filter((c) => { const r = rectOf(c); return r.cx >= g.x && r.cx <= g.x + g.width && r.cy >= g.y && r.cy <= g.y + g.height; }).map((c) => ({ c, x0: c.x, y0: c.y }));
    const move = (ev) => {
      const dx = (ev.clientX - sx) / cam.zoom, dy = (ev.clientY - sy) / cam.zoom;
      g.x = Math.round(gx0 + dx); g.y = Math.round(gy0 + dy); g.el.style.left = g.x + 'px'; g.el.style.top = g.y + 'px';
      inside.forEach(({ c, x0, y0 }) => { c.x = Math.round(x0 + dx); c.y = Math.round(y0 + dy); c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; });
      markDirty(); renderEdges();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shield.remove(); try { handle.releasePointerCapture(pid); } catch {} commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function startGroupResize(e, g) {
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget, pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch {}
    const shield = elx('div', 'cv-drag-shield'); stage.appendChild(shield);
    beginChange();
    const w0 = g.width, h0 = g.height, sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      g.width = Math.round(Math.max(140, w0 + (ev.clientX - sx) / cam.zoom));
      g.height = Math.round(Math.max(100, h0 + (ev.clientY - sy) / cam.zoom));
      g.el.style.width = g.width + 'px'; g.el.style.height = g.height + 'px'; markDirty();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shield.remove(); try { handle.releasePointerCapture(pid); } catch {} commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function deleteGroup(g) {
    confirmModal('Apagar este grupo? Os cartões dentro permanecem.', 'Apagar', () => {
      beginChange();
      const i = groups.indexOf(g); if (i >= 0) groups.splice(i, 1);
      edges = edges.filter((ed) => ed.fromNode !== g.id && ed.toNode !== g.id);
      if (g.el) g.el.remove();
      markDirty(); commitChange(); renderEdges();
      BISA.toast('Grupo removido');
    });
  }
  function deleteCard(c) {
    confirmModal('Apagar este cartão?', 'Apagar', () => {
      beginChange();
      const i = cards.indexOf(c); if (i >= 0) cards.splice(i, 1);
      edges = edges.filter((ed) => ed.fromNode !== c.id && ed.toNode !== c.id);   // some com as conexões dele
      if (c.el) c.el.remove();
      markDirty(); commitChange(); renderEdges();   // reversível pelo ↶
      BISA.toast('Cartão removido');
    });
  }
  function startCardDrag(e, c) {
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget, pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch {}   // arraste segue mesmo saindo do "⋯"
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
    // Escudo não-editável por cima de tudo: enquanto arrasta, o elemento sob a Pencil é
    // SEMPRE o escudo (não um campo editável). Como o Scribble do iPadOS só dispara sobre
    // regiões editáveis, ele não engata — sem rastro de tinta nem letra inserida ao soltar.
    // (o arraste em si continua pelo pointer capture, alheio ao escudo.)
    const shield = elx('div', 'cv-drag-shield');
    stage.appendChild(shield);
    beginChange();
    const startWX = c.x, startWY = c.y, sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      const nx = startWX + (ev.clientX - sx) / cam.zoom, ny = startWY + (ev.clientY - sy) / cam.zoom;
      const sn = snapDrag(c, nx, ny);          // alinha com cartões próximos + desenha guias
      c.x = sn.x; c.y = sn.y; c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; markDirty(); renderEdges(); scheduleDraw();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shield.remove(); guides = []; scheduleDraw(); try { handle.releasePointerCapture(pid); } catch {} commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Tinta ─────────────────────────────────────────────────────────────────
  function inkColor() { const cs = getComputedStyle(root); return (cs.getPropertyValue('--ink') || '#2f352b').trim(); }
  function scheduleDraw() { if (drawRAF) return; drawRAF = requestAnimationFrame(() => { drawRAF = 0; redrawInk(); }); }
  function resizeInk() { if (!ink) return; const r = stage.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; ink.width = r.width * dpr; ink.height = r.height * dpr; ink.style.width = r.width + 'px'; ink.style.height = r.height + 'px'; ictx.setTransform(dpr, 0, 0, dpr, 0, 0); scheduleDraw(); }
  function strokePath(st) {
    if (!getStroke) return null;
    const wpts = st.points.map((p) => [p[0], p[1], p[2]]);
    const outline = getStroke(wpts, { size: st.size, thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: false });
    if (!outline.length) return null;
    // pontos do contorno (mundo) → tela; a tinta é re-rasterizada a cada câmera, então
    // fica nítida em qualquer zoom/Retina (o ctx já está escalado por dpr em resizeInk).
    const pts = outline.map((pt) => [(pt[0] + cam.x) * cam.zoom, (pt[1] + cam.y) * cam.zoom]);
    const path = new Path2D();
    // curvas quadráticas entre pontos médios (técnica do perfect-freehand p/ SVG) —
    // contorno suave de verdade, sem facetas de segmentos retos ao ampliar.
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    path.closePath();
    return path;
  }
  function redrawInk() {
    if (!ictx) return;
    const r = stage.getBoundingClientRect(); ictx.clearRect(0, 0, r.width, r.height);
    for (const st of strokes) { const p = strokePath(st); if (p) { ictx.fillStyle = (selStrokes.length && selStrokes.includes(st)) ? 'rgba(80,140,240,0.92)' : (st.color || inkColor()); ictx.fill(p); } }
    if (curStroke) { const p = strokePath(curStroke); if (p) { ictx.fillStyle = curStroke.color || inkColor(); ictx.fill(p); } }
    // polígono do laço em desenho
    if (lassoPts && lassoPts.length > 1) {
      ictx.save(); ictx.setLineDash([6, 4]); ictx.strokeStyle = 'rgba(80,140,240,0.9)'; ictx.lineWidth = 1.5; ictx.beginPath();
      lassoPts.forEach((p, i) => { const sx = (p[0] + cam.x) * cam.zoom, sy = (p[1] + cam.y) * cam.zoom; i ? ictx.lineTo(sx, sy) : ictx.moveTo(sx, sy); });
      ictx.stroke(); ictx.restore();
    }
    // guias de alinhamento (snap)
    if (guides.length) {
      ictx.save(); ictx.setLineDash([4, 3]); ictx.strokeStyle = 'rgba(80,140,240,0.85)'; ictx.lineWidth = 1;
      for (const g of guides) { ictx.beginPath(); if (g.axis === 'x') { const sx = (g.at + cam.x) * cam.zoom; ictx.moveTo(sx, 0); ictx.lineTo(sx, r.height); } else { const sy = (g.at + cam.y) * cam.zoom; ictx.moveTo(0, sy); ictx.lineTo(r.width, sy); } ictx.stroke(); }
      ictx.restore();
    }
  }
  let curStroke = null;
  let inkSize = 4, inkCol = null;          // espessura e cor da caneta (null = cor do tema)
  let selStrokes = [], lassoPts = null, selBar = null;   // seleção de tinta (laço)
  let selCards = [], cardSelBar = null;    // seleção de cartões (marquee)
  let guides = [];                         // guias de alinhamento (snap), em coords de mundo
  let clip = [];                           // área de transferência interna (copiar/colar)
  let searchMatches = [], searchIdx = -1;  // busca nos cartões
  function startInk(e) {
    beginChange();
    const [sx, sy] = stageXY(e); const w = s2w(sx, sy);
    curStroke = { points: [[w.x, w.y, e.pressure || 0.5]], size: inkSize, color: inkCol || inkColor() };
    const move = (ev) => { const [mx, my] = stageXY(ev); const mw = s2w(mx, my); curStroke.points.push([mw.x, mw.y, ev.pressure || 0.5]); scheduleDraw(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (curStroke && curStroke.points.length > 1) { strokes.push(curStroke); markDirty(); } curStroke = null; scheduleDraw(); commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Borracha ───────────────────────────────────────────────────────────────
  function startErase(e) {
    beginChange();
    const rad = 14 / cam.zoom, r2 = rad * rad;   // raio ≈14px de tela, em coords de mundo
    const at = (ev) => {
      const [sx, sy] = stageXY(ev); const w = s2w(sx, sy); let hit = false;
      for (let i = strokes.length - 1; i >= 0; i--) {
        if (strokes[i].points.some((p) => { const dx = p[0] - w.x, dy = p[1] - w.y; return dx * dx + dy * dy <= r2; })) { strokes.splice(i, 1); hit = true; }
      }
      if (hit) { markDirty(); scheduleDraw(); }
    };
    at(e);
    const move = (ev) => at(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Laço (selecionar traços → mover/apagar) ────────────────────────────────
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function strokesBBox(list) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const st of list) for (const p of st.points) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
    return { minx: a, miny: b, maxx: c, maxy: d };
  }
  function clearSelection() { selStrokes = []; if (selBar) { selBar.remove(); selBar = null; } scheduleDraw(); }
  function showSelBar() {
    if (selBar) selBar.remove();
    selBar = elx('div', 'cv-selbar');
    const del = elx('button', 'cv-btn', '🗑 Apagar (' + selStrokes.length + ')'); const done = elx('button', 'cv-btn', '✓');
    selBar.append(del, done); stage.appendChild(selBar);
    onTap(del, () => { beginChange(); strokes = strokes.filter((st) => !selStrokes.includes(st)); markDirty(); commitChange(); clearSelection(); BISA.toast('Traços apagados'); });
    onTap(done, clearSelection);
  }
  function startLasso(e) {
    clearSelection(); lassoPts = [];
    const add = (ev) => { const [sx, sy] = stageXY(ev); const w = s2w(sx, sy); lassoPts.push([w.x, w.y]); scheduleDraw(); };
    add(e);
    const move = (ev) => add(ev);
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (lassoPts && lassoPts.length > 2) selStrokes = strokes.filter((st) => { let inn = 0; for (const p of st.points) if (pointInPoly(p[0], p[1], lassoPts)) inn++; return inn >= Math.ceil(st.points.length / 2); });
      lassoPts = null; scheduleDraw();
      if (selStrokes.length) showSelBar(); else BISA.toast('Nada selecionado');
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function startMoveStrokes(e) {
    beginChange();
    const sx = e.clientX, sy = e.clientY;
    const orig = selStrokes.map((st) => st.points.map((p) => p.slice()));
    const move = (ev) => { const dx = (ev.clientX - sx) / cam.zoom, dy = (ev.clientY - sy) / cam.zoom; selStrokes.forEach((st, i) => { st.points = orig[i].map((p) => [p[0] + dx, p[1] + dy, p[2]]); }); markDirty(); scheduleDraw(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Opções da caneta (cor + espessura) ─────────────────────────────────────
  function openInkOpts(anchor) {
    const ov = elx('div', 'cv-ov'); ov.style.background = 'transparent';
    const pop = elx('div', 'cv-color-pop'); pop.style.width = '212px';
    const themeSw = elx('button', 'cv-sw cv-sw-none' + (inkCol ? '' : ' on'), 'A'); themeSw.title = 'Cor do tema'; onTap(themeSw, () => { inkCol = null; ov.remove(); BISA.toast('Caneta: cor do tema'); }); pop.appendChild(themeSw);
    Object.keys(CV_COLORS).forEach((k) => { const sw = elx('button', 'cv-sw' + (inkCol === CV_COLORS[k] ? ' on' : '')); sw.style.background = CV_COLORS[k]; onTap(sw, () => { inkCol = CV_COLORS[k]; ov.remove(); }); pop.appendChild(sw); });
    const row = elx('div', 'cv-ink-sizes');
    [['Fino', 2], ['Médio', 4], ['Grosso', 8]].forEach(([lb, sz]) => { const b = elx('button', 'cv-btn' + (inkSize === sz ? ' on' : ''), lb); onTap(b, () => { inkSize = sz; ov.remove(); }); row.appendChild(b); });
    pop.appendChild(row);
    ov.appendChild(pop); document.body.appendChild(ov); ov.onclick = () => ov.remove(); pop.onclick = (e) => e.stopPropagation();
    const r = anchor.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
  }

  // ── Multisseleção de cartões (marquee) ─────────────────────────────────────
  function clearCardSel() { selCards.forEach((c) => c.el && c.el.classList.remove('cv-sel')); selCards = []; if (cardSelBar) { cardSelBar.remove(); cardSelBar = null; } }
  function selectCopies(copies) { clearCardSel(); selCards = copies; copies.forEach((c) => c.el.classList.add('cv-sel')); if (copies.length) showCardSelBar(); }
  function deleteSelCards() { if (!selCards.length) return; beginChange(); const ids = selCards.map((c) => c.id); selCards.forEach((c) => c.el.remove()); cards = cards.filter((c) => !ids.includes(c.id)); edges = edges.filter((ed) => !ids.includes(ed.fromNode) && !ids.includes(ed.toNode)); markDirty(); commitChange(); renderEdges(); clearCardSel(); BISA.toast('Cartões apagados'); }
  function showCardSelBar() {
    if (cardSelBar) cardSelBar.remove();
    cardSelBar = elx('div', 'cv-selbar');
    const dup = elx('button', 'cv-btn', '⧉'); dup.title = 'Duplicar';
    const align = elx('button', 'cv-btn', '⊟'); align.title = 'Alinhar / distribuir';
    const del = elx('button', 'cv-btn', '🗑 (' + selCards.length + ')'); const done = elx('button', 'cv-btn', '✓');
    cardSelBar.append(dup, align, del, done); stage.appendChild(cardSelBar);
    onTap(dup, () => selectCopies(duplicateCards(selCards, 24, 24)));
    onTap(align, () => openAlignMenu(align));
    onTap(del, deleteSelCards);
    onTap(done, clearCardSel);
  }
  // ── Duplicar / copiar-colar ────────────────────────────────────────────────
  function cardData(c) {
    const b = { kind: c.kind || 'text', x: c.x, y: c.y, width: Math.round(c.el.offsetWidth || c.width), height: Math.round(c.el.offsetHeight || c.height), color: c.color };
    if ((c.kind || 'text') === 'text') b.text = c.text || ''; else if (c.kind === 'file') { b.file = c.file; if (c.subpath) b.subpath = c.subpath; } else if (c.kind === 'link') b.url = c.url;
    return b;
  }
  function makeFromData(d) { return (d.kind && d.kind !== 'text') ? addMedia(Object.assign({}, d)) : addCard(Object.assign({}, d)); }
  function duplicateCards(list, dx, dy) {
    if (!list.length) return [];
    beginChange();
    const idMap = {}, copies = [];
    list.forEach((c) => { const d = cardData(c); d.x += dx; d.y += dy; const nc = makeFromData(d); idMap[c.id] = nc.id; copies.push(nc); });
    const setIds = new Set(list.map((c) => c.id));
    edges.filter((ed) => setIds.has(ed.fromNode) && setIds.has(ed.toNode)).forEach((ed) => edges.push({ id: uid(), fromNode: idMap[ed.fromNode], toNode: idMap[ed.toNode], toEnd: ed.toEnd, color: ed.color, label: ed.label }));
    markDirty(); commitChange(); renderEdges();
    return copies;
  }
  function copySel() { clip = selCards.map(cardData); if (clip.length) BISA.toast(clip.length + ' copiado(s)'); }
  function pasteClip() { if (!clip.length) return; beginChange(); const copies = clip.map((d) => makeFromData(Object.assign({}, d, { x: d.x + 24, y: d.y + 24 }))); markDirty(); commitChange(); renderEdges(); selectCopies(copies); BISA.toast(copies.length + ' colado(s)'); }
  // ── Alinhar / distribuir (seleção ≥ 2) ─────────────────────────────────────
  function alignSelection(mode) {
    if (selCards.length < 2) return;
    beginChange();
    const rs = selCards.map((c) => ({ c, r: rectOf(c) }));
    if (mode === 'left') { const m = Math.min(...rs.map((o) => o.r.x)); rs.forEach((o) => o.c.x = Math.round(m)); }
    else if (mode === 'right') { const m = Math.max(...rs.map((o) => o.r.x + o.r.w)); rs.forEach((o) => o.c.x = Math.round(m - o.r.w)); }
    else if (mode === 'hcenter') { const m = rs.reduce((s, o) => s + o.r.cx, 0) / rs.length; rs.forEach((o) => o.c.x = Math.round(m - o.r.w / 2)); }
    else if (mode === 'top') { const m = Math.min(...rs.map((o) => o.r.y)); rs.forEach((o) => o.c.y = Math.round(m)); }
    else if (mode === 'bottom') { const m = Math.max(...rs.map((o) => o.r.y + o.r.h)); rs.forEach((o) => o.c.y = Math.round(m - o.r.h)); }
    else if (mode === 'vcenter') { const m = rs.reduce((s, o) => s + o.r.cy, 0) / rs.length; rs.forEach((o) => o.c.y = Math.round(m - o.r.h / 2)); }
    else if (mode === 'disth') { const s = rs.slice().sort((a, b) => a.r.cx - b.r.cx); const lo = s[0].r.cx, hi = s[s.length - 1].r.cx, st = (hi - lo) / (s.length - 1); s.forEach((o, i) => o.c.x = Math.round(lo + st * i - o.r.w / 2)); }
    else if (mode === 'distv') { const s = rs.slice().sort((a, b) => a.r.cy - b.r.cy); const lo = s[0].r.cy, hi = s[s.length - 1].r.cy, st = (hi - lo) / (s.length - 1); s.forEach((o, i) => o.c.y = Math.round(lo + st * i - o.r.h / 2)); }
    selCards.forEach((c) => { c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; });
    markDirty(); commitChange(); renderEdges();
  }
  function openAlignMenu(anchor) {
    const ov = elx('div', 'cv-ov'); ov.style.background = 'transparent'; const pop = elx('div', 'cv-align-pop');
    [['⬅', 'left'], ['↔', 'hcenter'], ['➡', 'right'], ['⬆', 'top'], ['↕', 'vcenter'], ['⬇', 'bottom'], ['⇿', 'disth'], ['⇳', 'distv']].forEach(([lb, m]) => { const b = elx('button', 'cv-btn', lb); b.title = m; onTap(b, () => { ov.remove(); alignSelection(m); }); pop.appendChild(b); });
    ov.appendChild(pop); document.body.appendChild(ov); ov.onclick = () => ov.remove(); pop.onclick = (e) => e.stopPropagation();
    const r = anchor.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(window.innerWidth - 180, r.left - 60)) + 'px';
    let top = r.top - 8 - 96; if (top < 8) top = r.bottom + 8; pop.style.top = top + 'px';
  }
  // ── Busca nos cartões ──────────────────────────────────────────────────────
  function openSearch() {
    const ov = elx('div', 'cv-ov'); ov.style.background = 'transparent'; const bar = elx('div', 'cv-search');
    const inp = document.createElement('input'); inp.placeholder = 'Buscar nos cartões…'; inp.style.cssText = 'flex:1;min-width:120px;min-height:40px;border:none;background:none;color:var(--ink);font-size:1rem;outline:none;';
    const info = elx('span', 'cv-search-info'); const prev = elx('button', 'cv-btn', '‹'), next = elx('button', 'cv-btn', '›'), close = elx('button', 'cv-btn', '✕');
    bar.append(inp, info, prev, next, close); ov.appendChild(bar); document.body.appendChild(ov);
    ov.onclick = () => ov.remove(); bar.onclick = (e) => e.stopPropagation();
    const doSearch = () => { const q = inp.value.trim().toLowerCase(); searchMatches = q ? cards.filter((c) => (c.kind || 'text') === 'text' && (c.text || '').toLowerCase().includes(q)) : []; searchIdx = -1; info.textContent = q ? (searchMatches.length + ' achado(s)') : ''; if (searchMatches.length) jump(1); };
    const jump = (dir) => { if (!searchMatches.length) return; searchIdx = (searchIdx + dir + searchMatches.length) % searchMatches.length; const c = searchMatches[searchIdx], r = rectOf(c), st = stage.getBoundingClientRect(); cam.x = st.width / (2 * cam.zoom) - r.cx; cam.y = st.height / (2 * cam.zoom) - r.cy; applyCam(); clearCardSel(); selCards = [c]; c.el.classList.add('cv-sel'); info.textContent = (searchIdx + 1) + '/' + searchMatches.length; };
    inp.addEventListener('input', doSearch);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') ov.remove(); });
    onTap(prev, () => jump(-1)); onTap(next, () => jump(1)); onTap(close, () => ov.remove());
    setTimeout(() => inp.focus(), 0);
  }
  function onKey(e) {
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName))) return;   // não atrapalha edição
    const mod = e.metaKey || e.ctrlKey;
    const k = (e.key || '').toLowerCase();
    if (mod && k === 'd') { e.preventDefault(); if (selCards.length) selectCopies(duplicateCards(selCards, 24, 24)); }
    else if (mod && k === 'c') { if (selCards.length) { e.preventDefault(); copySel(); } }
    else if (mod && k === 'v') { if (clip.length) { e.preventDefault(); pasteClip(); } }
    else if (mod && k === 'f') { e.preventDefault(); openSearch(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selCards.length) { e.preventDefault(); deleteSelCards(); }
    else if (e.key === 'Escape') { clearCardSel(); clearSelection(); }
  }
  function startMarquee(e) {
    clearCardSel();
    const sx0 = e.clientX, sy0 = e.clientY; const box = elx('div', 'cv-marquee'); stage.appendChild(box);
    const draw = (ev) => { const r = stage.getBoundingClientRect(); const x1 = sx0 - r.left, y1 = sy0 - r.top, x2 = ev.clientX - r.left, y2 = ev.clientY - r.top; box.style.cssText = `left:${Math.min(x1, x2)}px;top:${Math.min(y1, y2)}px;width:${Math.abs(x2 - x1)}px;height:${Math.abs(y2 - y1)}px`; };
    draw(e);
    const move = (ev) => draw(ev);
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); box.remove();
      const r = stage.getBoundingClientRect();
      const w1 = s2w(sx0 - r.left, sy0 - r.top), w2 = s2w(ev.clientX - r.left, ev.clientY - r.top);
      const minx = Math.min(w1.x, w2.x), maxx = Math.max(w1.x, w2.x), miny = Math.min(w1.y, w2.y), maxy = Math.max(w1.y, w2.y);
      selCards = cards.filter((c) => { const b = rectOf(c); return b.x < maxx && b.x + b.w > minx && b.y < maxy && b.y + b.h > miny; });
      selCards.forEach((c) => c.el.classList.add('cv-sel'));
      if (selCards.length) showCardSelBar(); else clearCardSel();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function startCardsMove(e) {
    beginChange();
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
    const shield = elx('div', 'cv-drag-shield'); stage.appendChild(shield);
    const sx = e.clientX, sy = e.clientY; const orig = selCards.map((c) => ({ c, x0: c.x, y0: c.y }));
    const move = (ev) => { const dx = (ev.clientX - sx) / cam.zoom, dy = (ev.clientY - sy) / cam.zoom; orig.forEach(({ c, x0, y0 }) => { c.x = Math.round(x0 + dx); c.y = Math.round(y0 + dy); c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; }); markDirty(); renderEdges(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shield.remove(); commitChange(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Snap / guias de alinhamento (ao arrastar 1 cartão) ─────────────────────
  function snapDrag(c, nx, ny) {
    const T = 7 / cam.zoom, w = c.el.offsetWidth, h = c.el.offsetHeight;
    const myX = [nx, nx + w / 2, nx + w], myY = [ny, ny + h / 2, ny + h];
    let bx = null, by = null, gx = null, gy = null, dx = T, dy = T;
    for (const o of cards) {
      if (o === c) continue; const r = rectOf(o); const oX = [r.x, r.cx, r.x + r.w], oY = [r.y, r.cy, r.y + r.h];
      for (let i = 0; i < 3; i++) for (const ox of oX) { const d = Math.abs(myX[i] - ox); if (d < dx) { dx = d; bx = nx + (ox - myX[i]); gx = ox; } }
      for (let i = 0; i < 3; i++) for (const oy of oY) { const d = Math.abs(myY[i] - oy); if (d < dy) { dy = d; by = ny + (oy - myY[i]); gy = oy; } }
    }
    guides = []; if (gx != null) guides.push({ axis: 'x', at: gx }); if (gy != null) guides.push({ axis: 'y', at: gy });
    return { x: bx != null ? Math.round(bx) : nx, y: by != null ? Math.round(by) : ny };
  }

  // ── Enquadrar tudo (fit-to-content) ────────────────────────────────────────
  function fitContent() {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false;
    const acc = (x, y) => { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); any = true; };
    cards.forEach((c) => { const b = rectOf(c); acc(b.x, b.y); acc(b.x + b.w, b.y + b.h); });
    groups.forEach((g) => { acc(g.x, g.y); acc(g.x + g.width, g.y + g.height); });
    strokes.forEach((st) => st.points.forEach((p) => acc(p[0], p[1])));
    if (!any) { cam = { x: 0, y: 0, zoom: 1 }; applyCam(); return; }
    const pad = 60, r = stage.getBoundingClientRect();
    const z = Math.max(0.2, Math.min(2, Math.min(r.width / ((maxx - minx) + pad * 2), r.height / ((maxy - miny) + pad * 2))));
    cam.zoom = z; cam.x = r.width / (2 * z) - (minx + maxx) / 2; cam.y = r.height / (2 * z) - (miny + maxy) / 2;
    applyCam();
  }

  // ── IA no Canvas (Claude) ──────────────────────────────────────────────────
  function spawnAICards(texts, links) {
    beginChange();
    const r = stage.getBoundingClientRect(), ctr = s2w(r.width / 2, r.height / 2), made = [];
    texts.forEach((t, i) => { const col = i % 2, rowi = Math.floor(i / 2); made.push(addCard({ x: Math.round(ctr.x - 270 + col * 290), y: Math.round(ctr.y - 150 + rowi * 160), width: 250, text: String(t) })); });
    (links || []).forEach((l) => { const a = made[l[0]], b = made[l[1]]; if (a && b && a !== b) edges.push({ id: uid(), fromNode: a.id, toNode: b.id, toEnd: 'arrow' }); });
    markDirty(); commitChange(); renderEdges();
    BISA.toast(made.length + ' cartões criados');
  }
  // contexto textual do quadro p/ a IA: temas (grupos) → cartões, soltos e conexões
  const cardLine = (c) => String(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  function textCards() { return cards.filter((c) => (c.kind || 'text') === 'text' && (c.text || '').trim()); }
  function boardText(list) {
    const chosen = (list && list.length) ? list : textCards();
    const inGroup = new Set(); const parts = [];
    groups.forEach((g) => {
      const membros = chosen.filter((c) => { const r = rectOf(c); const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height; });
      if (!membros.length) return;
      membros.forEach((c) => inGroup.add(c));
      parts.push('## ' + (g.label || 'Grupo') + '\n' + membros.map((c) => '- ' + cardLine(c)).join('\n'));
    });
    const soltos = chosen.filter((c) => !inGroup.has(c));
    if (soltos.length) parts.push((parts.length ? '## (sem grupo)\n' : '') + soltos.map((c) => '- ' + cardLine(c)).join('\n'));
    const byId = new Map(cards.map((c) => [c.id, c]));
    const conns = edges.map((ed) => { const a = byId.get(ed.fromNode), b = byId.get(ed.toNode); return (a && b) ? '- ' + cardLine(a) + ' → ' + cardLine(b) : null; }).filter(Boolean);
    if (conns.length) parts.push('## Conexões\n' + conns.join('\n'));
    return parts.join('\n\n').slice(0, 11000);
  }
  // aplica a resposta do modo 'organize': move os cartões p/ grades e cria os grupos
  // rotulados ABAIXO do conteúdo atual (nada é apagado; desfazer volta tudo).
  function applyOrganize(respGroups, chosen) {
    const gs = (respGroups || []).filter((g) => g.cards && g.cards.length);
    if (!gs.length) return 0;
    beginChange();
    let minx = Infinity, maxy = -Infinity;
    cards.forEach((c) => { const r = rectOf(c); minx = Math.min(minx, r.x); maxy = Math.max(maxy, r.y + r.h); });
    groups.forEach((g) => { minx = Math.min(minx, g.x); maxy = Math.max(maxy, g.y + g.height); });
    if (!isFinite(minx)) { minx = 0; maxy = -100; }
    const COLS = 2, HG = 18, VG = 18, PAD = 22, HEAD = 36, CW = 250, GGAP = 40;
    const gw = PAD * 2 + COLS * CW + (COLS - 1) * HG;
    const gx0 = minx, gy0 = maxy + 70;
    let gy = gy0, rowH = 0;
    gs.forEach((g, gi) => {
      const membros = g.cards.map((i) => chosen[i]).filter(Boolean);
      if (!membros.length) return;
      const col = gi % 2;
      if (col === 0 && gi > 0) { gy += rowH + GGAP; rowH = 0; }
      const x0 = gx0 + col * (gw + GGAP);
      const slotH = Math.max(...membros.map((c) => rectOf(c).h), 60) + VG;
      const rows = Math.ceil(membros.length / COLS);
      const gh = PAD * 2 + HEAD + rows * slotH - VG;
      membros.forEach((c, j) => {
        const cc = j % COLS, rr = Math.floor(j / COLS);
        c.x = Math.round(x0 + PAD + cc * (CW + HG)); c.y = Math.round(gy + PAD + HEAD + rr * slotH);
        c.width = CW;
        c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; c.el.style.width = CW + 'px';
      });
      addGroup({ x: x0, y: gy, width: gw, height: gh, label: g.label || 'Tema' });
      rowH = Math.max(rowH, gh);
    });
    markDirty(); commitChange(); renderEdges(); fitContent();
    return gs.length;
  }
  function openAI() {
    const ov = elx('div', 'cv-ov'); const panel = elx('div', 'cv-panel');
    panel.innerHTML = '<h3 style="margin:0 0 10px">✨ IA no Canvas</h3>';
    const inp = document.createElement('textarea'); inp.placeholder = 'Tema p/ brainstorm (ou selecione cartões com ⬚ p/ os demais modos)';
    inp.style.cssText = 'width:100%;min-height:64px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);padding:10px 12px;font-size:1rem;box-sizing:border-box;';
    const row = elx('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
    const bBrain = elx('button', 'cv-btn primary', 'Brainstorm'), bExp = elx('button', 'cv-btn', 'Expandir seleção'), bSum = elx('button', 'cv-btn', 'Resumir seleção');
    row.append(bBrain, bExp, bSum);
    // modos que operam no QUADRO (seleção ⬚ restringe; sem seleção = quadro todo)
    const row2 = elx('div'); row2.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
    const bOrg = elx('button', 'cv-btn', '🗂 Organizar quadro'), bNote = elx('button', 'cv-btn', '📝 Sintetizar em nota'), bTask = elx('button', 'cv-btn', '✅ Gerar tarefas');
    row2.append(bOrg, bNote, bTask);
    const status = elx('div'); status.style.cssText = 'margin-top:10px;color:var(--ink-soft);font-size:.85rem;min-height:1.2em';
    const taskBox = elx('div'); taskBox.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:6px';
    panel.append(inp, row, row2, status, taskBox);
    ov.appendChild(panel); document.body.appendChild(ov); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation();
    const allB = [bBrain, bExp, bSum, bOrg, bNote, bTask];
    const busy = (b) => allB.forEach((x) => x.disabled = b);
    const selTextCards = () => selCards.filter((c) => (c.kind || 'text') === 'text' && (c.text || '').trim());

    const run = async (mode) => {
      const selText = selTextCards().map((c) => (c.text || '').trim()).join('\n---\n');
      if ((mode === 'expand' || mode === 'summarize') && !selText) { status.textContent = 'Selecione cartões primeiro (ferramenta ⬚).'; return; }
      if (mode === 'brainstorm' && !inp.value.trim()) { status.textContent = 'Escreva um tema p/ o brainstorm.'; return; }
      status.textContent = 'Pensando…'; busy(true);
      try {
        const r = await BISA.api('/canvas-ai', { method: 'POST', json: { mode, topic: inp.value.trim(), context: selText } });
        const list = (r && r.cards) || [];
        if (!list.length) { status.textContent = 'A IA não retornou cartões.'; busy(false); return; }
        ov.remove(); spawnAICards(list, r.links || []);
      } catch (e) { status.textContent = 'Erro: ' + e.message; busy(false); }
    };
    onTap(bBrain, () => run('brainstorm')); onTap(bExp, () => run('expand')); onTap(bSum, () => run('summarize'));

    // 🗂 Organizar: a IA agrupa os cartões em temas → grupos reais no quadro
    onTap(bOrg, async () => {
      const sel = selTextCards();
      const chosen = sel.length >= 3 ? sel : textCards();
      if (chosen.length < 3) { status.textContent = 'Preciso de pelo menos 3 cartões de texto.'; return; }
      status.textContent = 'Organizando ' + chosen.length + ' cartões…'; busy(true);
      try {
        const payload = chosen.map((c, i) => ({ i, text: cardLine(c) }));
        const r = await BISA.api('/canvas-ai', { method: 'POST', json: { mode: 'organize', cards: payload } });
        const n = applyOrganize(r && r.groups, chosen);
        if (!n) { status.textContent = 'A IA não propôs grupos.'; busy(false); return; }
        ov.remove(); BISA.toast(n + ' temas organizados (↶ desfaz)');
      } catch (e) { status.textContent = 'Erro: ' + e.message; busy(false); }
    });

    // 📝 Sintetizar: o quadro vira uma nota .md no vault + cartão de link no canvas
    onTap(bNote, async () => {
      const sel = selTextCards();
      const ctx = boardText(sel.length ? sel : null);
      if (!ctx.trim()) { status.textContent = 'O quadro não tem cartões de texto.'; return; }
      status.textContent = 'Sintetizando (pode levar ~1 min)…'; busy(true);
      try {
        const r = await BISA.api('/canvas-ai', { method: 'POST', json: { mode: 'synthesize', context: ctx } });
        const note = ((r && r.note) || '').trim();
        if (!note) { status.textContent = 'A IA não retornou a nota.'; busy(false); return; }
        const base = currentPath ? (currentPath.split('/').pop() || '').replace(/\.canvas$/i, '') : 'canvas';
        const dir = currentPath ? currentPath.split('/').slice(0, -1).join('/') : '';
        const rel = (dir ? dir + '/' : '') + base + '-sintese-' + new Date().toISOString().slice(0, 10) + '.md';
        await BISA.api('/vault/write', { method: 'POST', json: { path: rel, content: note } });
        ov.remove();
        placeMedia({ kind: 'file', file: rel, width: 360, height: 320 });
        BISA.toast('Nota criada: ' + rel.split('/').pop());
      } catch (e) { status.textContent = 'Erro: ' + e.message; busy(false); }
    });

    // ✅ Tarefas: a IA extrai ações → você escolhe quais entram no planner
    onTap(bTask, async () => {
      const sel = selTextCards();
      const ctx = boardText(sel.length ? sel : null);
      if (!ctx.trim()) { status.textContent = 'O quadro não tem cartões de texto.'; return; }
      status.textContent = 'Extraindo tarefas…'; busy(true); taskBox.innerHTML = '';
      try {
        const r = await BISA.api('/canvas-ai', { method: 'POST', json: { mode: 'tasks', context: ctx } });
        const tasks = (r && r.tasks) || [];
        if (!tasks.length) { status.textContent = 'Nenhuma tarefa acionável encontrada.'; busy(false); return; }
        status.textContent = 'Desmarque o que não quiser e confirme:';
        const checks = tasks.map((t) => {
          const lb = elx('label'); lb.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:.92rem';
          const ck = document.createElement('input'); ck.type = 'checkbox'; ck.checked = true; ck.style.cssText = 'width:20px;height:20px';
          lb.append(ck, document.createTextNode(t)); taskBox.appendChild(lb);
          return { ck, t };
        });
        const add = elx('button', 'cv-btn primary', '＋ Adicionar ao planner'); add.style.marginTop = '4px';
        taskBox.appendChild(add); busy(false);
        onTap(add, async () => {
          const chosen = checks.filter((c) => c.ck.checked).map((c) => c.t);
          if (!chosen.length) { ov.remove(); return; }
          add.disabled = true; status.textContent = 'Adicionando…';
          let ok = 0;
          for (const t of chosen) { try { await BISA.api('/planner/task', { method: 'POST', json: { text: t } }); ok++; } catch {} }
          ov.remove(); BISA.toast(ok + ' tarefa(s) no planner ✓');
        });
      } catch (e) { status.textContent = 'Erro: ' + e.message; busy(false); }
    });
  }

  // ── Pan / zoom (dedo) ──────────────────────────────────────────────────────
  const touches = new Map();
  let panLast = null, pinchLast = null;
  function onTouchStart(e) {
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 1) { panLast = [e.clientX, e.clientY]; pinchLast = null; }
    else if (touches.size === 2) { const pts = [...touches.values()]; pinchLast = pinchInfo(pts); panLast = null; }
  }
  function onTouchMove(e) {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 1 && panLast) {
      cam.x += (e.clientX - panLast[0]) / cam.zoom; cam.y += (e.clientY - panLast[1]) / cam.zoom;
      panLast = [e.clientX, e.clientY]; applyCam();
    } else if (touches.size >= 2) {
      const pts = [...touches.values()].slice(0, 2); const info = pinchInfo(pts);
      if (pinchLast) {
        const factor = info.dist / (pinchLast.dist || info.dist);
        const r = stage.getBoundingClientRect(); const mx = info.cx - r.left, my = info.cy - r.top;
        const before = s2w(mx, my); cam.zoom = Math.max(0.2, Math.min(4, cam.zoom * factor));
        const after = s2w(mx, my); cam.x += after.x - before.x; cam.y += after.y - before.y;
        applyCam();
      }
      pinchLast = info;
    }
  }
  function onTouchEnd(e) { touches.delete(e.pointerId); panLast = null; pinchLast = null; if (touches.size === 1) { const v = [...touches.values()][0]; panLast = v.slice(); } }
  function pinchInfo(pts) { const dx = pts[0][0] - pts[1][0], dy = pts[0][1] - pts[1][1]; return { dist: Math.hypot(dx, dy), cx: (pts[0][0] + pts[1][0]) / 2, cy: (pts[0][1] + pts[1][1]) / 2 }; }

  // ── Roteamento de ponteiro no stage ────────────────────────────────────────
  function onStageDown(e) {
    if (e.pointerType === 'touch') { onTouchStart(e); return; }   // dedo = pan/zoom
    // caneta/mouse: cartão (cabeçalho/corpo/apagar) trata sozinho — nunca desenha
    // tinta nem cria cartão por cima dele, qualquer que seja a ferramenta.
    if (e.target.closest && e.target.closest('.cv-card, .cv-group')) return;   // cartão/grupo tratam sozinhos
    if (tool === 'ink') { e.preventDefault(); startInk(e); return; }
    if (tool === 'eraser') { e.preventDefault(); startErase(e); return; }
    if (tool === 'lasso') {
      e.preventDefault();
      if (selStrokes.length) { const w = s2w(...stageXY(e)); const b = strokesBBox(selStrokes); if (w.x >= b.minx && w.x <= b.maxx && w.y >= b.miny && w.y <= b.maxy) { startMoveStrokes(e); return; } }
      startLasso(e); return;   // fora da seleção → novo laço
    }
    if (tool === 'select') { e.preventDefault(); startMarquee(e); return; }   // fundo vazio: retângulo de seleção
    if (tool !== 'text') return;   // modo 🔗 (ou outro): fundo vazio não cria cartão
    // tool === 'text' — fundo vazio: tap cria cartão
    e.preventDefault();
    const sx0 = e.clientX, sy0 = e.clientY; let moved = false;
    const move = (ev) => { if (Math.abs(ev.clientX - sx0) + Math.abs(ev.clientY - sy0) > 8) moved = true; };
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved) { const [sx, sy] = stageXY(ev); const w = s2w(sx, sy); beginChange(); const c = addCard({ x: Math.round(w.x), y: Math.round(w.y) }); markDirty(); commitChange(); setTimeout(() => enterCardEdit(c), 0); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Persistência (.canvas + .ink.json) ─────────────────────────────────────
  function markDirty() { dirty = true; updateName(); }
  function updateName() { if (nameEl) nameEl.innerHTML = (currentPath ? esc(currentPath.split('/').pop()) : 'Novo canvas') + (dirty ? ' <span class="dot">•</span>' : ''); }
  function buildCanvasJSON() {
    const textNodes = cards.map((c) => {
      const n = { id: c.id, x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.el.offsetWidth || c.width), height: Math.round(c.el.offsetHeight || c.height) };
      if (c.color) n.color = c.color;
      if ((c.kind || 'text') === 'text') { n.type = 'text'; n.text = c.text || ''; }
      else if (c.kind === 'file') { n.type = 'file'; n.file = c.file; if (c.subpath) n.subpath = c.subpath; }
      else if (c.kind === 'link') { n.type = 'link'; n.url = c.url; }
      return n;
    });
    const groupNodes = groups.map((g) => { const n = { id: g.id, type: 'group', x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.width), height: Math.round(g.height) }; const lbl = g.labelEl.innerText.trim(); if (lbl) n.label = lbl; if (g.color) n.color = g.color; return n; });
    // grupos primeiro = mais ao fundo (ordem do array = z-index no JSON Canvas)
    return Object.assign({}, extraKeys, { nodes: groupNodes.concat(textNodes, otherNodes), edges });
  }
  async function save() {
    if (!currentPath) { promptName((name) => doSave(name, null)); return; }   // salvar-como: sem OCC
    doSave(currentPath, baseHash);
  }
  // concorrência otimista no .canvas (last-writer-wins do Obsidian → checamos o hash
  // p/ não atropelar o que o Obsidian gravou). A tinta .ink.json é app-privada (sem OCC).
  async function doSave(rel, occHash) {
    try {
      const r = await BISA.api('/vault/write', { method: 'POST', json: { path: rel, content: JSON.stringify(buildCanvasJSON(), null, 2), baseHash: occHash || undefined } });
      if (strokes.length) await BISA.api('/vault/write', { method: 'POST', json: { path: rel + '.ink.json', content: JSON.stringify({ strokes }) } });
      currentPath = rel; baseHash = r.hash || null; dirty = false; updateName(); BISA.toast('Salvo ✓');
    } catch (e) { BISA.toast('Erro ao salvar: ' + e.message); }
  }
  // confirmação no mesmo padrão dos diálogos do Canvas (.cv-ov/.cv-panel)
  function confirmModal(msg, yesLabel, onYes) {
    const ov = elx('div', 'cv-ov'); const panel = elx('div', 'cv-panel');
    panel.innerHTML = `<h3 style="margin:0 0 14px">${esc(msg)}</h3>`;
    const row = elx('div'); row.style.cssText = 'display:flex;gap:8px';
    const cancel = elx('button', 'cv-btn', 'Cancelar'); cancel.style.flex = '1';
    const ok = elx('button', 'cv-btn primary', yesLabel || 'OK'); ok.style.flex = '1';
    onTap(cancel, () => ov.remove());
    onTap(ok, () => { ov.remove(); onYes(); });
    row.append(cancel, ok); panel.append(row);
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation(); document.body.appendChild(ov);
  }
  function promptName(cb) {
    const ov = elx('div', 'cv-ov'); const panel = elx('div', 'cv-panel'); panel.innerHTML = '<h3 style="margin:0 0 12px">Salvar canvas</h3>';
    const inp = document.createElement('input'); inp.placeholder = 'nome.canvas'; inp.style.cssText = 'width:100%;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);padding:10px 12px;font-size:1rem;';
    const row = elx('div'); row.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const ok = elx('button', 'cv-btn primary', 'Salvar'); ok.style.flex = '1'; const cancel = elx('button', 'cv-btn', 'Cancelar');
    onTap(ok, () => { let n = inp.value.trim(); if (!n) return; if (!/\.canvas$/i.test(n)) n += '.canvas'; ov.remove(); cb(n); });
    onTap(cancel, () => ov.remove()); row.append(ok, cancel); panel.append(inp, row);
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation(); document.body.appendChild(ov);
  }
  function openBrowser() {
    const ov = elx('div', 'cv-ov'); const panel = elx('div', 'cv-panel');
    panel.innerHTML = '<h3 style="margin:0 0 8px">Abrir canvas</h3><div data-path style="font-family:ui-monospace,monospace;font-size:.78rem;color:var(--ink-soft);margin-bottom:8px">.</div><div data-list></div>';
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation(); document.body.appendChild(ov);
    const list = panel.querySelector('[data-list]'), pathLbl = panel.querySelector('[data-path]');
    async function go(rel) {
      pathLbl.textContent = rel; list.innerHTML = '<p style="color:var(--ink-soft)">…</p>';
      try {
        const data = await BISA.api('/vault/list?path=' + encodeURIComponent(rel)); list.innerHTML = '';
        if (rel !== '.') { const up = elx('div', 'cv-li', '📁 ..'); onTap(up, () => { const p = rel.split('/'); p.pop(); go(p.join('/') || '.'); }); list.appendChild(up); }
        (data.entries || []).forEach((en) => { if (!en.dir && !/\.canvas$/i.test(en.name)) return; const li = elx('div', 'cv-li', (en.dir ? '📁 ' : '🗂 ') + esc(en.name)); onTap(li, () => { if (en.dir) go(en.rel); else { loadCanvas(en.rel); ov.remove(); } }); list.appendChild(li); });
        if (!list.children.length) list.innerHTML = '<p style="color:var(--ink-soft)">nenhum .canvas aqui</p>';
      } catch (e) { list.innerHTML = `<p style="color:var(--ink-soft)">erro: ${esc(e.message)}</p>`; }
    }
    go('.');
  }
  function clearBoard() { cards.forEach((c) => c.el.remove()); groups.forEach((g) => g.el.remove()); cards = []; groups = []; strokes = []; otherNodes = []; edges = []; extraKeys = {}; if (edgeSvg) edgeSvg.innerHTML = ''; }
  async function loadCanvas(rel) {
    try {
      const data = await BISA.api('/vault/file?path=' + encodeURIComponent(rel));
      let j = {}; try { j = JSON.parse(data.content || '{}'); } catch { BISA.toast('Canvas inválido'); return; }
      clearBoard();
      edges = Array.isArray(j.edges) ? j.edges : [];
      extraKeys = {}; Object.keys(j).forEach((k) => { if (k !== 'nodes' && k !== 'edges') extraKeys[k] = j[k]; });
      (Array.isArray(j.nodes) ? j.nodes : []).forEach((n) => {
        if (n.type === 'text') addCard({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, text: n.text || '', color: n.color });
        else if (n.type === 'group') addGroup({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, label: n.label || '', color: n.color });
        else if (n.type === 'file') addMedia({ kind: 'file', id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, file: n.file, subpath: n.subpath, color: n.color });
        else if (n.type === 'link') addMedia({ kind: 'link', id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, url: n.url, color: n.color });
        else otherNodes.push(n);
      });
      // tinta irmã
      try { const ik = await BISA.api('/vault/file?path=' + encodeURIComponent(rel + '.ink.json')); const ij = JSON.parse(ik.content || '{}'); if (Array.isArray(ij.strokes)) strokes = ij.strokes; } catch {}
      currentPath = rel; baseHash = data.hash || null; dirty = false; updateName(); resetHistory();   // abrir = baseline novo (undo + OCC)
      renderEdges();
      // centraliza no 1º cartão
      const first = cards[0]; if (first) { cam.zoom = 1; cam.x = stage.getBoundingClientRect().width / 2 - first.x - 120; cam.y = stage.getBoundingClientRect().height / 3 - first.y; }
      applyCam();
    } catch (e) { BISA.toast('Erro ao abrir: ' + e.message); }
  }

  // ── mount / unmount ─────────────────────────────────────────────────────────
  function setTool(t) { tool = t; if (t !== 'lasso') clearSelection(); if (t !== 'select') clearCardSel(); Object.keys(toolBtns).forEach((k) => toolBtns[k] && toolBtns[k].classList.toggle('on', k === t)); }
  window.BISO_CANVAS = {
    mount(el) {
      el.innerHTML = ''; root = elx('div', 'cv-root');
      const bar = elx('div', 'cv-bar'); bar.innerHTML = '<span class="cv-name">Novo canvas</span>';
      const bText = elx('button', 'cv-btn on', '✎ Texto'), bInk = elx('button', 'cv-btn', '✏️ Tinta'), bPen = elx('button', 'cv-btn', '✒︎');
      const bEraser = elx('button', 'cv-btn', '🩹 Borracha'), bLasso = elx('button', 'cv-btn', '✂ Laço'), bSelect = elx('button', 'cv-btn', '⬚ Selecionar'), bLink = elx('button', 'cv-btn', '🔗 Ligar');
      const bGroup = elx('button', 'cv-btn', '▢ Grupo'), bFile = elx('button', 'cv-btn', '📎 Arquivo'), bAI = elx('button', 'cv-btn', '✨ IA'), bSearch = elx('button', 'cv-btn', '🔎');
      const bFit = elx('button', 'cv-btn', '⊙ Enquadrar'), zoom = elx('span', 'cv-zoom', '100%');
      const bUndo = elx('button', 'cv-btn', '↶'), bRedo = elx('button', 'cv-btn', '↷');
      const bOpen = elx('button', 'cv-btn', '📂'), bSave = elx('button', 'cv-btn primary', '💾'), bNew = elx('button', 'cv-btn', '＋');
      bar.append(bText, bInk, bPen, bEraser, bLasso, bSelect, bLink, bGroup, bFile, bAI, bSearch, bFit, zoom, bUndo, bRedo, bOpen, bSave, bNew); nameEl = bar.querySelector('.cv-name'); zoomEl = zoom;
      toolBtns = { text: bText, ink: bInk, eraser: bEraser, lasso: bLasso, select: bSelect, link: bLink };

      stage = elx('div', 'cv-stage'); world = elx('div', 'cv-world'); ink = elx('canvas', 'cv-ink');
      edgeSvg = svgEl('svg', 'cv-edges'); world.appendChild(edgeSvg);   // 1º filho do world → atrás dos cartões
      stage.append(world, ink);
      const hint = elx('div', 'cv-hint', 'dedo = mover/zoom · caneta = ' + '✎ texto'); stage.appendChild(hint);
      setTimeout(() => hint.remove(), 4000);
      root.append(bar, stage); el.appendChild(root);
      ictx = ink.getContext('2d', { desynchronized: true });   // menor latência da tinta (Pencil)

      onTap(bText, () => setTool('text'));
      onTap(bInk, () => setTool('ink'));
      onTap(bPen, () => openInkOpts(bPen));
      onTap(bEraser, () => setTool('eraser'));
      onTap(bLasso, () => setTool('lasso'));
      onTap(bSelect, () => setTool('select'));
      onTap(bLink, () => setTool('link'));
      onTap(bGroup, () => { const r = stage.getBoundingClientRect(); const ctr = s2w(r.width / 2, r.height / 2); beginChange(); const g = addGroup({ x: Math.round(ctr.x - 160), y: Math.round(ctr.y - 120), width: 320, height: 240 }); markDirty(); commitChange(); setTimeout(() => g.labelEl.focus(), 0); });
      onTap(bFile, openFilePicker);
      onTap(bAI, openAI);
      onTap(bSearch, openSearch);
      onTap(bFit, fitContent);
      onTap(bUndo, undo);
      onTap(bRedo, redo);
      onTap(bOpen, openBrowser);
      onTap(bSave, save);
      onTap(bNew, () => { clearBoard(); currentPath = null; baseHash = null; dirty = false; resetHistory(); cam = { x: 0, y: 0, zoom: 1 }; applyCam(); updateName(); });

      stage.addEventListener('pointerdown', onStageDownCapture, true);   // captura: modo 🔗 inicia ligação no cartão
      stage.addEventListener('pointerdown', onStageDown);
      stage.addEventListener('pointermove', onTouchMove);
      stage.addEventListener('pointerup', onTouchEnd);
      stage.addEventListener('pointercancel', onTouchEnd);
      stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const before = s2w(mx, my); cam.zoom = Math.max(0.2, Math.min(4, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); const after = s2w(mx, my); cam.x += after.x - before.x; cam.y += after.y - before.y; applyCam(); }, { passive: false });
      window.addEventListener('resize', resizeInk);
      document.addEventListener('keydown', onKey);   // atalhos: Cmd-D/C/V/F, Delete, Esc
      // re-dimensiona o buffer da tinta (dpr) quando o stage muda de tamanho — troca
      // de aba, rotação, teclado — não só no resize da janela.
      try { ro = new ResizeObserver(() => resizeInk()); ro.observe(stage); } catch {}

      import('/vendor/perfect-freehand.js').then((m) => { getStroke = m.getStroke; scheduleDraw(); }).catch(() => {});
      setTimeout(resizeInk, 0);
      applyCam(); updateName();
    },
    unmount() {
      window.removeEventListener('resize', resizeInk);
      document.removeEventListener('keydown', onKey);
      if (ro) { try { ro.disconnect(); } catch {} ro = null; }
      resetHistory();
      document.querySelectorAll('.cv-ov, .cv-imgview, .ia-root, .iae-root, .ia-notepop').forEach((o) => o.remove());
      document.body.style.overflow = '';   // caso o anotador/editor de imagem estivesse aberto
      if (drawRAF) cancelAnimationFrame(drawRAF), drawRAF = 0;
      root = stage = world = ink = ictx = nameEl = zoomEl = edgeSvg = null; toolBtns = {};
      cards = []; groups = []; strokes = []; otherNodes = []; edges = []; extraKeys = {}; curStroke = null;
      selStrokes = []; lassoPts = null; selBar = null; selCards = []; cardSelBar = null; guides = []; clip = []; searchMatches = []; searchIdx = -1;
      touches.clear(); panLast = pinchLast = null; cam = { x: 0, y: 0, zoom: 1 };
      currentPath = null; baseHash = null; dirty = false; tool = 'text';
    },
  };
})();
