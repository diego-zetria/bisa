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
      .cv-card { position:absolute; background:var(--surface); border:1px solid var(--line); border-radius:12px;
        box-shadow:var(--shadow); display:flex; flex-direction:column; overflow:hidden; min-width:120px; }
      .cv-card .hd { height:22px; flex-shrink:0; background:var(--surface-2); border-bottom:1px solid var(--line);
        cursor:grab; touch-action:none; display:flex; align-items:center; justify-content:center; color:var(--ink-soft); font-size:.7rem; letter-spacing:2px; }
      .cv-card .bd { flex:1; padding:8px 10px; outline:none; font-size:15px; line-height:1.4; color:var(--ink);
        overflow:auto; white-space:pre-wrap; word-break:break-word; -webkit-user-modify:read-write; }
      .cv-card .bd:empty::before { content:'escreva…'; color:var(--ink-soft); }
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
  const elx = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => Date.now().toString(16) + Math.random().toString(16).slice(2, 8);

  // ── Estado ───────────────────────────────────────────────────────────────
  let root, stage, world, ink, ictx, nameEl, zoomEl;
  let cam = { x: 0, y: 0, zoom: 1 };
  let cards = [];                 // { id, x, y, width, height, text, el, bd }
  let strokes = [];               // { points:[[wx,wy,p]], size, color }
  let otherNodes = [], edges = [], extraKeys = {};   // round-trip do Obsidian
  let tool = 'text';              // 'text' | 'ink'
  let currentPath = null, dirty = false;
  let getStroke = null;
  let drawRAF = 0;

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
    const c = Object.assign({ id: uid(), x: 0, y: 0, width: 240, height: 120, text: '' }, node);
    const el = elx('div', 'cv-card');
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.width = c.width + 'px'; el.style.minHeight = c.height + 'px';
    const hd = elx('div', 'hd', '⋯');
    const bd = elx('div', 'bd'); bd.setAttribute('contenteditable', 'true'); bd.setAttribute('spellcheck', 'false'); bd.textContent = c.text;
    el.append(hd, bd); world.appendChild(el);
    c.el = el; c.bd = bd;
    bd.addEventListener('input', () => { c.text = bd.innerText; markDirty(); });
    bd.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') e.stopPropagation(); });  // caneta escreve no corpo (Scribble); não vira pan/desenho
    hd.addEventListener('pointerdown', (e) => startCardDrag(e, c));   // arrastar pelo cabeçalho
    cards.push(c);
    return c;
  }
  function startCardDrag(e, c) {
    e.preventDefault(); e.stopPropagation();
    const startWX = c.x, startWY = c.y, sx = e.clientX, sy = e.clientY;
    const move = (ev) => { c.x = startWX + (ev.clientX - sx) / cam.zoom; c.y = startWY + (ev.clientY - sy) / cam.zoom; c.el.style.left = c.x + 'px'; c.el.style.top = c.y + 'px'; markDirty(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
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
    const path = new Path2D();
    outline.forEach((pt, i) => { const sx = (pt[0] + cam.x) * cam.zoom, sy = (pt[1] + cam.y) * cam.zoom; if (i === 0) path.moveTo(sx, sy); else path.lineTo(sx, sy); });
    path.closePath();
    return path;
  }
  function redrawInk() {
    if (!ictx) return;
    const r = stage.getBoundingClientRect(); ictx.clearRect(0, 0, r.width, r.height);
    for (const st of strokes) { const p = strokePath(st); if (p) { ictx.fillStyle = st.color || inkColor(); ictx.fill(p); } }
    if (curStroke) { const p = strokePath(curStroke); if (p) { ictx.fillStyle = curStroke.color || inkColor(); ictx.fill(p); } }
  }
  let curStroke = null;
  function startInk(e) {
    const [sx, sy] = stageXY(e); const w = s2w(sx, sy);
    curStroke = { points: [[w.x, w.y, e.pressure || 0.5]], size: 4 / 1, color: inkColor() };
    const move = (ev) => { const [mx, my] = stageXY(ev); const mw = s2w(mx, my); curStroke.points.push([mw.x, mw.y, ev.pressure || 0.5]); scheduleDraw(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (curStroke && curStroke.points.length > 1) { strokes.push(curStroke); markDirty(); } curStroke = null; scheduleDraw(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
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
    // caneta/mouse = ferramenta
    if (tool === 'ink') { e.preventDefault(); startInk(e); return; }
    // tool === 'text'
    const onCard = e.target.closest && e.target.closest('.cv-card');
    if (onCard) return;   // cabeçalho/corpo do cartão tratam (arrasta/edita)
    // fundo vazio: tap cria cartão
    e.preventDefault();
    const sx0 = e.clientX, sy0 = e.clientY; let moved = false;
    const move = (ev) => { if (Math.abs(ev.clientX - sx0) + Math.abs(ev.clientY - sy0) > 8) moved = true; };
    const up = (ev) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved) { const [sx, sy] = stageXY(ev); const w = s2w(sx, sy); const c = addCard({ x: Math.round(w.x), y: Math.round(w.y) }); markDirty(); setTimeout(() => c.bd.focus(), 0); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // ── Persistência (.canvas + .ink.json) ─────────────────────────────────────
  function markDirty() { dirty = true; updateName(); }
  function updateName() { if (nameEl) nameEl.innerHTML = (currentPath ? esc(currentPath.split('/').pop()) : 'Novo canvas') + (dirty ? ' <span class="dot">•</span>' : ''); }
  function buildCanvasJSON() {
    const textNodes = cards.map((c) => ({ id: c.id, type: 'text', x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.el.offsetWidth || c.width), height: Math.round(c.el.offsetHeight || c.height), text: c.bd.innerText }));
    return Object.assign({}, extraKeys, { nodes: textNodes.concat(otherNodes), edges });
  }
  async function save() {
    if (!currentPath) { promptName((name) => doSave(name)); return; }
    doSave(currentPath);
  }
  async function doSave(rel) {
    try {
      await BISA.api('/vault/write', { method: 'POST', json: { path: rel, content: JSON.stringify(buildCanvasJSON(), null, 2) } });
      if (strokes.length) await BISA.api('/vault/write', { method: 'POST', json: { path: rel + '.ink.json', content: JSON.stringify({ strokes }) } });
      currentPath = rel; dirty = false; updateName(); BISA.toast('Salvo ✓');
    } catch (e) { BISA.toast('Erro ao salvar: ' + e.message); }
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
  function clearBoard() { cards.forEach((c) => c.el.remove()); cards = []; strokes = []; otherNodes = []; edges = []; extraKeys = {}; }
  async function loadCanvas(rel) {
    try {
      const data = await BISA.api('/vault/file?path=' + encodeURIComponent(rel));
      let j = {}; try { j = JSON.parse(data.content || '{}'); } catch { BISA.toast('Canvas inválido'); return; }
      clearBoard();
      edges = Array.isArray(j.edges) ? j.edges : [];
      extraKeys = {}; Object.keys(j).forEach((k) => { if (k !== 'nodes' && k !== 'edges') extraKeys[k] = j[k]; });
      (Array.isArray(j.nodes) ? j.nodes : []).forEach((n) => { if (n.type === 'text') addCard({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, text: n.text || '' }); else otherNodes.push(n); });
      // tinta irmã
      try { const ik = await BISA.api('/vault/file?path=' + encodeURIComponent(rel + '.ink.json')); const ij = JSON.parse(ik.content || '{}'); if (Array.isArray(ij.strokes)) strokes = ij.strokes; } catch {}
      currentPath = rel; dirty = false; updateName();
      // centraliza no 1º cartão
      const first = cards[0]; if (first) { cam.zoom = 1; cam.x = stage.getBoundingClientRect().width / 2 - first.x - 120; cam.y = stage.getBoundingClientRect().height / 3 - first.y; }
      applyCam();
    } catch (e) { BISA.toast('Erro ao abrir: ' + e.message); }
  }

  // ── mount / unmount ─────────────────────────────────────────────────────────
  function setTool(t, bText, bInk) { tool = t; if (bText) bText.classList.toggle('on', t === 'text'); if (bInk) bInk.classList.toggle('on', t === 'ink'); }
  window.BISO_CANVAS = {
    mount(el) {
      el.innerHTML = ''; root = elx('div', 'cv-root');
      const bar = elx('div', 'cv-bar'); bar.innerHTML = '<span class="cv-name">Novo canvas</span>';
      const bText = elx('button', 'cv-btn on', '✎ Texto'), bInk = elx('button', 'cv-btn', '✏️ Tinta');
      const bFit = elx('button', 'cv-btn', '⊙'), zoom = elx('span', 'cv-zoom', '100%');
      const bOpen = elx('button', 'cv-btn', '📂'), bSave = elx('button', 'cv-btn primary', '💾'), bNew = elx('button', 'cv-btn', '＋');
      bar.append(bText, bInk, bFit, zoom, bOpen, bSave, bNew); nameEl = bar.querySelector('.cv-name'); zoomEl = zoom;

      stage = elx('div', 'cv-stage'); world = elx('div', 'cv-world'); ink = elx('canvas', 'cv-ink');
      stage.append(world, ink);
      const hint = elx('div', 'cv-hint', 'dedo = mover/zoom · caneta = ' + '✎ texto'); stage.appendChild(hint);
      setTimeout(() => hint.remove(), 4000);
      root.append(bar, stage); el.appendChild(root);
      ictx = ink.getContext('2d');

      onTap(bText, () => setTool('text', bText, bInk));
      onTap(bInk, () => setTool('ink', bText, bInk));
      onTap(bFit, () => { cam = { x: 0, y: 0, zoom: 1 }; applyCam(); });
      onTap(bOpen, openBrowser);
      onTap(bSave, save);
      onTap(bNew, () => { clearBoard(); currentPath = null; dirty = false; cam = { x: 0, y: 0, zoom: 1 }; applyCam(); updateName(); });

      stage.addEventListener('pointerdown', onStageDown);
      stage.addEventListener('pointermove', onTouchMove);
      stage.addEventListener('pointerup', onTouchEnd);
      stage.addEventListener('pointercancel', onTouchEnd);
      stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const before = s2w(mx, my); cam.zoom = Math.max(0.2, Math.min(4, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); const after = s2w(mx, my); cam.x += after.x - before.x; cam.y += after.y - before.y; applyCam(); }, { passive: false });
      window.addEventListener('resize', resizeInk);

      import('/vendor/perfect-freehand.js').then((m) => { getStroke = m.getStroke; scheduleDraw(); }).catch(() => {});
      setTimeout(resizeInk, 0);
      applyCam(); updateName();
    },
    unmount() {
      window.removeEventListener('resize', resizeInk);
      document.querySelectorAll('.cv-ov').forEach((o) => o.remove());
      if (drawRAF) cancelAnimationFrame(drawRAF), drawRAF = 0;
      root = stage = world = ink = ictx = nameEl = zoomEl = null;
      cards = []; strokes = []; otherNodes = []; edges = []; extraKeys = {}; curStroke = null;
      touches.clear(); panLast = pinchLast = null; cam = { x: 0, y: 0, zoom: 1 };
      currentPath = null; dirty = false; tool = 'text';
    },
  };
})();
