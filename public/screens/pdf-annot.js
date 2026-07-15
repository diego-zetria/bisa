// screens/pdf-annot.js — Anotador de PDF em tela cheia (Pencil-first).
// Renderiza o PDF com PDF.js (camada de texto p/ seleção), desenha por cima com a
// Pencil (perfect-freehand) e salva as anotações num SIDECAR não-destrutivo no vault:
//   <arquivo>.pdf.annot.json   (PDF original intacto; roundtrip com o Obsidian).
// Dedo = rolar/pinçar · Pencil = ferramenta ativa (caneta, marca-texto, borracha,
// notas, recorte). Coordenadas guardadas em UNIDADES DE PÁGINA (escala 1) → imunes ao zoom.
// Exposto como window.BISO_PDF = { open(file, opts), thumb(file, canvasEl) }.
(function () {
  let pdfjs = null, getStroke = null;
  async function libs() {
    if (!pdfjs) { pdfjs = await import('/vendor/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs'; }
    if (!getStroke) { try { const m = await import('/vendor/perfect-freehand.js'); getStroke = m.getStroke; } catch {} }
    return pdfjs;
  }
  const enc = encodeURIComponent;
  const rawUrl = (p) => '/vault/raw?path=' + enc(p) + '&token=' + enc(BISA.token || '');
  const elx = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const dpr = () => window.devicePixelRatio || 1;

  // ── estilos ────────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('pa-styles')) return;
    const s = document.createElement('style'); s.id = 'pa-styles';
    s.textContent = `
      .pa-root { position:fixed; inset:0; z-index:1300; display:flex; flex-direction:column; background:var(--bg); }
      .pa-bar { display:flex; align-items:center; gap:6px; padding:7px 10px; flex-shrink:0; overflow-x:auto;
        -webkit-overflow-scrolling:touch; border-bottom:1px solid var(--line); background:var(--surface); }
      .pa-bar::-webkit-scrollbar { display:none; }
      .pa-name { font-weight:600; max-width:34vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pa-sep { width:1px; align-self:stretch; background:var(--line); margin:2px 2px; }
      .pa-btn { min-width:38px; height:38px; padding:0 9px; border-radius:10px; border:1px solid var(--line);
        background:var(--surface-2); color:var(--ink); font-size:1rem; display:inline-flex; align-items:center;
        justify-content:center; gap:5px; cursor:pointer; flex-shrink:0; touch-action:manipulation; }
      .pa-btn.on { background:var(--accent,#3b82f6); color:#fff; border-color:transparent; }
      .pa-btn:disabled { opacity:.4; }
      .pa-sw { width:24px; height:24px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1px var(--line); flex-shrink:0; cursor:pointer; }
      .pa-sw.on { outline:2px solid var(--ink); outline-offset:1px; }
      .pa-grow { flex:1; }
      .pa-status { font-size:.78rem; color:var(--ink-soft); min-width:64px; text-align:right; flex-shrink:0; }
      .pa-scroll { flex:1; min-height:0; overflow:auto; background:#3a3a3e; -webkit-overflow-scrolling:touch;
        touch-action:pan-x pan-y; overscroll-behavior:contain; }
      .pa-doc { display:flex; flex-direction:column; align-items:center; gap:14px; padding:14px; min-height:100%; box-sizing:border-box; }
      .pa-page { position:relative; background:#fff; box-shadow:0 2px 14px rgba(0,0,0,.4); flex-shrink:0; touch-action:pan-x pan-y; }
      .pa-page > canvas, .pa-page > .pa-text, .pa-page > .pa-notes, .pa-page > .pa-crop { position:absolute; left:0; top:0; }
      .pa-page > .pa-annot, .pa-page > .pa-live { pointer-events:none; }
      .pa-crop { width:100%; height:100%; pointer-events:none; }
      .pa-text { overflow:hidden; opacity:1; line-height:1; pointer-events:none; user-select:none; -webkit-user-select:none;
        transform-origin:0 0; color:transparent; }
      .pa-text span { position:absolute; white-space:pre; cursor:text; transform-origin:0 0; }
      .pa-text ::selection { background:rgba(120,170,255,.45); }
      .pa-root.txt .pa-text { pointer-events:auto; user-select:text; -webkit-user-select:text; }
      .pa-notes { width:100%; height:100%; pointer-events:none; }
      .pa-pin { position:absolute; transform:translate(-50%,-100%); font-size:22px; line-height:1; cursor:pointer;
        pointer-events:auto; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); touch-action:none; }
      .pa-crop-box { position:absolute; border:2px dashed #3b82f6; background:rgba(59,130,246,.12); pointer-events:none; }
      .pa-selbar { position:fixed; z-index:1320; display:flex; gap:6px; background:var(--surface); border:1px solid var(--line);
        border-radius:12px; padding:6px; box-shadow:var(--shadow); }
      .pa-notepop { position:fixed; z-index:1330; width:min(86vw,320px); background:var(--surface); border:1px solid var(--line);
        border-radius:14px; box-shadow:var(--shadow); padding:12px; }
      .pa-notepop textarea { width:100%; min-height:90px; box-sizing:border-box; border:1px solid var(--line); border-radius:10px;
        background:var(--surface-2); color:var(--ink); padding:8px 10px; font-size:1rem; resize:vertical; }
      .pa-notepop .row { display:flex; gap:8px; margin-top:8px; }
    `;
    document.head.appendChild(s);
  }

  const PALETTE = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#111827'];
  const HL_PALETTE = ['#fde047', '#86efac', '#7dd3fc', '#f9a8d4', '#fdba74'];

  // outline do perfect-freehand → Path2D (quadráticas entre pontos médios, p/ suavidade)
  function strokePath(ptsCss, size, isHl) {
    if (!getStroke || ptsCss.length === 0) return null;
    const out = getStroke(ptsCss, { size, thinning: isHl ? 0 : 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: false });
    if (!out.length) return null;
    const p = new Path2D(); p.moveTo(out[0][0], out[0][1]);
    for (let i = 1; i < out.length; i++) { const a = out[i - 1], b = out[i]; p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    p.closePath(); return p;
  }
  // desenha as anotações de uma página num contexto qualquer. k = fator unidades-de-página → espaço do ctx
  // (canvas vivo: k=zoom em ctx escalado por dpr · recorte/miniatura: k=escala em px de device).
  function drawAnnots(ctx, d, k) {
    if (!d) return;
    for (const h of d.textHi || []) {
      ctx.save();
      // Nota: NÃO usar globalCompositeOperation='multiply' aqui — o canvas de anotação é
      // transparente (não tem o PDF embaixo), então multiply produziria preto. O efeito de
      // grifa-texto translúcido é obtido simplesmente com globalAlpha sobre source-over.
      if (h.kind === 'highlight') { ctx.globalAlpha = 0.38; ctx.fillStyle = h.color; for (const r of h.rects) ctx.fillRect(r[0] * k, r[1] * k, r[2] * k, r[3] * k); }
      else { ctx.strokeStyle = h.color; ctx.lineWidth = Math.max(1.5, 2 * k); for (const r of h.rects) { const y = h.kind === 'strike' ? (r[1] + r[3] / 2) : (r[1] + r[3] - 1); ctx.beginPath(); ctx.moveTo(r[0] * k, y * k); ctx.lineTo((r[0] + r[2]) * k, y * k); ctx.stroke(); } }
      ctx.restore();
    }
    for (const st of d.ink || []) {
      const isHl = st.tool === 'hl' || st.isHl; const path = strokePath(st.pts.map((p) => [p[0] * k, p[1] * k, p[2]]), (st.size || 3) * k, isHl); if (!path) continue;
      ctx.save(); if (isHl) { ctx.globalAlpha = 0.38; } ctx.fillStyle = st.color; ctx.fill(path); ctx.restore();
    }
  }

  // ── abrir o anotador ─────────────────────────────────────────────────────────
  async function open(file, opts) {
    opts = opts || {};
    ensureStyles();
    const root = elx('div', 'pa-root');
    const bar = elx('div', 'pa-bar');
    const scroll = elx('div', 'pa-scroll'); const doc = elx('div', 'pa-doc');
    scroll.appendChild(doc); root.append(bar, scroll); document.body.appendChild(root);
    document.body.style.overflow = 'hidden';

    // estado
    let tool = 'pen';                 // pen | hl | erase | text | note | crop
    let color = '#ef4444', hlColor = '#fde047', penSize = 3, hlSize = 14;
    let hlStraight = false; try { hlStraight = localStorage.getItem('pa_hl_straight') === '1'; } catch {}   // lembrado entre sessões
    let zoom = 1; const pages = [];   // pageMeta
    let model = { pages: {} };        // { [n]: { ink:[], textHi:[], notes:[] } }
    let sidecar = file + '.annot.json', baseHash = null, saveTimer = 0, saving = false, dirtyPending = false;
    const undo = [], redo = [];
    const pageData = (n) => (model.pages[n] || (model.pages[n] = { ink: [], textHi: [], notes: [] }));

    // ── persistência (sidecar) ──────────────────────────────────────────────
    async function loadSidecar() {
      try { const r = await BISA.api('/vault/file?path=' + enc(sidecar)); baseHash = r.hash || null; const j = JSON.parse(r.content || '{}'); model.pages = j.pages || {}; }
      catch { baseHash = null; model.pages = {}; }
    }
    function prune() { const out = {}; for (const k in model.pages) { const p = model.pages[k]; if ((p.ink && p.ink.length) || (p.textHi && p.textHi.length) || (p.notes && p.notes.length)) out[k] = p; } return out; }
    async function save() {
      if (saving) { dirtyPending = true; return; }
      saving = true; setStatus('Salvando…');
      const content = JSON.stringify({ v: 1, pdf: file, pages: prune() });
      try { const r = await BISA.api('/vault/write', { method: 'POST', json: { path: sidecar, content, baseHash: baseHash || undefined } }); baseHash = r.hash || null; }
      catch (e) { try { const r2 = await BISA.api('/vault/write', { method: 'POST', json: { path: sidecar, content } }); baseHash = r2.hash || null; } catch { setStatus('Erro ao salvar'); saving = false; return; } }
      saving = false; setStatus('Salvo ✓');
      if (dirtyPending) { dirtyPending = false; scheduleSave(); }
    }
    function scheduleSave() { clearTimeout(saveTimer); setStatus('Editado'); saveTimer = setTimeout(save, 900); }
    function snapshot() { return JSON.stringify(model.pages); }
    function pushUndo() { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo.length = 0; refreshUndo(); }
    function applyState(json) { model.pages = JSON.parse(json); pages.forEach((pm) => { redrawAnnot(pm); renderNotes(pm); }); scheduleSave(); refreshUndo(); }
    function doUndo() { if (!undo.length) return; redo.push(snapshot()); applyState(undo.pop()); }
    function doRedo() { if (!redo.length) return; undo.push(snapshot()); applyState(redo.pop()); }

    // ── barra de ferramentas ────────────────────────────────────────────────
    const mkBtn = (label, title, fn) => { const b = elx('button', 'pa-btn', label); b.title = title; b.addEventListener('click', (e) => { e.preventDefault(); fn(b); }); return b; };
    const closeBtn = mkBtn('‹', 'Voltar ao canvas', () => close()); closeBtn.style.fontSize = '1.5rem';
    const nameEl = elx('span', 'pa-name'); nameEl.textContent = (file.split('/').pop() || file);
    const toolBtns = {};
    function setTool(t) { tool = t; Object.keys(toolBtns).forEach((k) => toolBtns[k].classList.toggle('on', k === t)); root.classList.toggle('txt', t === 'text'); updateSwatches(); if (t === 'text') pages.forEach((pm) => { if (pm.visible) buildText(pm); }); }
    const penB = mkBtn('✏️', 'Caneta', () => setTool('pen'));
    const hlB = mkBtn('🖍', 'Marca-texto', () => setTool('hl'));
    const erB = mkBtn('🩹', 'Borracha', () => setTool('erase'));
    const txB = mkBtn('🆃', 'Selecionar texto p/ grifar', () => setTool('text'));
    const noB = mkBtn('📌', 'Nota fixada', () => setTool('note'));
    const crB = mkBtn('✂️', 'Recortar p/ o canvas', () => setTool('crop'));
    toolBtns.pen = penB; toolBtns.hl = hlB; toolBtns.erase = erB; toolBtns.text = txB; toolBtns.note = noB; toolBtns.crop = crB;
    // amostras de cor (mudam conforme caneta vs marca-texto)
    const swWrap = elx('span'); swWrap.style.cssText = 'display:inline-flex;gap:5px;align-items:center;flex-shrink:0';
    function updateSwatches() {
      swWrap.innerHTML = '';
      const isHl = tool === 'hl';
      const pal = isHl ? HL_PALETTE : PALETTE; const cur = isHl ? hlColor : color;
      pal.forEach((c) => { const sw = elx('button', 'pa-sw' + (c === cur ? ' on' : '')); sw.style.background = c; sw.addEventListener('click', (e) => { e.preventDefault(); if (isHl) hlColor = c; else color = c; updateSwatches(); }); swWrap.appendChild(sw); });
    }
    const undoB = mkBtn('↶', 'Desfazer', () => doUndo());
    const redoB = mkBtn('↷', 'Refazer', () => doRedo());
    function refreshUndo() { undoB.disabled = !undo.length; redoB.disabled = !redo.length; }
    const zOut = mkBtn('−', 'Diminuir', () => setZoom(zoom / 1.25));
    const zLbl = elx('span', 'pa-status'); zLbl.style.minWidth = '44px';
    const zIn = mkBtn('+', 'Aumentar', () => setZoom(zoom * 1.25));
    const fitB = mkBtn('⤢', 'Ajustar à largura', () => fitWidth());
    const hlLineB = mkBtn('📏', 'Marca-texto: auto-corrigir p/ linha reta', () => { hlStraight = !hlStraight; hlLineB.classList.toggle('on', hlStraight); try { localStorage.setItem('pa_hl_straight', hlStraight ? '1' : '0'); } catch {} });
    hlLineB.classList.toggle('on', hlStraight);   // reflete o estado lembrado
    const statusEl = elx('span', 'pa-status'); const setStatus = (t) => { statusEl.textContent = t; };
    bar.append(closeBtn, nameEl, sep(), penB, hlB, erB, txB, noB, crB, sep(), swWrap, hlLineB, sep(), undoB, redoB, sep(), zOut, zLbl, zIn, fitB, elx('span', 'pa-grow'), statusEl);
    function sep() { return elx('span', 'pa-sep'); }
    setTool('pen'); refreshUndo();

    // ── render PDF.js ─────────────────────────────────────────────────────────
    let pdf = null;
    try { await libs(); pdf = await pdfjs.getDocument({ url: rawUrl(file) }).promise; }
    catch (e) { setStatus('Erro ao abrir PDF'); BISA.toast('Não consegui abrir o PDF: ' + e.message); return; }
    await loadSidecar();

    const io = new IntersectionObserver((ents) => { ents.forEach((en) => { const pm = en.target.__pm; if (!pm) return; pm.visible = en.isIntersecting; if (en.isIntersecting) renderPdf(pm); }); }, { root: scroll, rootMargin: '300px 0px' });

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const container = elx('div', 'pa-page');
      const pdfCanvas = elx('canvas'); const annot = elx('canvas', 'pa-annot'); const live = elx('canvas', 'pa-live');
      const text = elx('div', 'pa-text'); const notes = elx('div', 'pa-notes'); const cropL = elx('div', 'pa-crop');
      container.append(pdfCanvas, annot, live, text, notes, cropL); doc.appendChild(container);
      const pm = { n, page, w1: vp1.width, h1: vp1.height, container, pdfCanvas, annot, live, text, notes, cropL, rendered: false, renderedZoom: 0, textZoom: 0, task: null, visible: false };
      container.__pm = pm; pages.push(pm);
      bindPageInput(pm);
      io.observe(container);
    }
    zoom = 0; setZoom(initialZoom());            // layout + 1º render
    function initialZoom() { const avail = scroll.clientWidth - 28; const maxW = Math.max(...pages.map((p) => p.w1), 1); return Math.max(0.3, Math.min(5, avail / maxW)); }

    function sizeCanvas(cv, w, h, d) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.getContext('2d').setTransform(d, 0, 0, d, 0, 0); }
    function layoutPage(pm) {
      const w = pm.w1 * zoom, h = pm.h1 * zoom, d = dpr();
      pm.container.style.width = w + 'px'; pm.container.style.height = h + 'px';
      sizeCanvas(pm.annot, w, h, d); sizeCanvas(pm.live, w, h, d);
      redrawAnnot(pm); renderNotes(pm);
    }
    async function renderPdf(pm) {
      if (!pm.visible) return;
      if (pm.rendered && pm.renderedZoom === zoom) return;
      if (pm.task) { try { pm.task.cancel(); } catch {} pm.task = null; }
      const d = dpr(); const vp = pm.page.getViewport({ scale: zoom * d });
      pm.pdfCanvas.width = Math.round(vp.width); pm.pdfCanvas.height = Math.round(vp.height);
      pm.pdfCanvas.style.width = (pm.w1 * zoom) + 'px'; pm.pdfCanvas.style.height = (pm.h1 * zoom) + 'px';
      try { pm.task = pm.page.render({ canvasContext: pm.pdfCanvas.getContext('2d'), viewport: vp }); await pm.task.promise; pm.rendered = true; pm.renderedZoom = zoom; }
      catch { /* cancelado por novo zoom */ }
      if (tool === 'text') buildText(pm);
    }
    async function buildText(pm) {
      if (pm.textZoom === zoom && pm.text.childElementCount) return;
      try {
        const tc = await pm.page.getTextContent();
        pm.text.innerHTML = ''; pm.text.style.width = (pm.w1 * zoom) + 'px'; pm.text.style.height = (pm.h1 * zoom) + 'px';
        pm.text.style.setProperty('--scale-factor', zoom);
        const tl = new pdfjs.TextLayer({ textContentSource: tc, container: pm.text, viewport: pm.page.getViewport({ scale: zoom }) });
        await tl.render(); pm.textZoom = zoom;
      } catch { /* sem camada de texto p/ esta página */ }
    }

    // ── zoom ──────────────────────────────────────────────────────────────────
    let zoomRAF = 0;
    function setZoom(z) {
      z = Math.max(0.3, Math.min(5, z)); if (Math.abs(z - zoom) < 0.001) return;
      zoom = z; zLbl.textContent = Math.round(zoom * 100) + '%';
      pages.forEach(layoutPage);
      if (zoomRAF) cancelAnimationFrame(zoomRAF);
      zoomRAF = requestAnimationFrame(() => { zoomRAF = 0; pages.forEach((pm) => { pm.rendered = false; if (pm.visible) renderPdf(pm); if (tool === 'text') buildText(pm); }); });
    }
    function fitWidth() { const avail = scroll.clientWidth - 28; const maxW = Math.max(...pages.map((p) => p.w1), 1); setZoom(avail / maxW); }
    // pinça (Safari Gesture Events)
    let pinch0 = 1;
    scroll.addEventListener('gesturestart', (e) => { e.preventDefault(); pinch0 = zoom; });
    scroll.addEventListener('gesturechange', (e) => { e.preventDefault(); setZoom(pinch0 * e.scale); });
    scroll.addEventListener('gestureend', (e) => { e.preventDefault(); });

    // ── entrada (Pencil = ferramenta · dedo = rolar/pinçar) ───────────────────
    function toPdf(e, pm) { const r = pm.container.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; }
    function bindPageInput(pm) {
      // entrada no CONTAINER (captura): os canvases são pointer-events:none, então a Pencil é
      // tratada aqui qualquer que seja o alvo (pdf/texto/container).
      // a Pencil (stylus) não deve rolar a página: bloqueia só o gesto da caneta, deixando o dedo rolar.
      const blockStylus = (e) => { const t = e.touches && e.touches[0]; if (t && t.touchType === 'stylus' && tool !== 'text') e.preventDefault(); };
      pm.container.addEventListener('touchstart', blockStylus, { passive: false, capture: true });
      pm.container.addEventListener('touchmove', blockStylus, { passive: false, capture: true });
      pm.container.addEventListener('pointerdown', (e) => {
        if (tool === 'text') return;                          // seleção nativa na camada de texto
        if (e.pointerType === 'touch') return;                // dedo = rolar/pinçar
        if (e.target.closest && e.target.closest('.pa-pin')) return;   // tocar num pin = abrir a nota
        e.preventDefault();
        const pt = toPdf(e, pm);
        if (tool === 'pen') startInk(e, pm, pt, { tool: 'pen', color, size: penSize });
        else if (tool === 'hl') hlStraight ? startStraightHl(e, pm, pt) : startInk(e, pm, pt, { tool: 'hl', color: hlColor, size: hlSize });
        else if (tool === 'erase') startErase(e, pm);
        else if (tool === 'note') addNote(pm, pt);
        else if (tool === 'crop') startCrop(e, pm, pt);
      }, true);
    }
    // traço livre (caneta; e marca-texto quando NÃO há texto embaixo — ex.: figuras)
    function startInk(e0, pm, pt0, opt) {
      const pts = [[pt0[0], pt0[1], e0.pressure || 0.5]];
      const live = { ink: [{ tool: opt.tool, color: opt.color, size: opt.size, pts }] };
      try { pm.container.setPointerCapture(e0.pointerId); } catch {}
      const move = (e) => { const p = toPdf(e, pm); pts.push([p[0], p[1], e.pressure || 0.5]); drawLive(pm, live); };
      const up = () => {
        pm.container.removeEventListener('pointermove', move); pm.container.removeEventListener('pointerup', up); pm.container.removeEventListener('pointercancel', up);
        if (pts.length > 1) { pushUndo(); pageData(pm.n).ink.push({ tool: opt.tool, color: opt.color, size: opt.size, pts }); scheduleSave(); }
        clearLive(pm); redrawAnnot(pm);
      };
      pm.container.addEventListener('pointermove', move); pm.container.addEventListener('pointerup', up); pm.container.addEventListener('pointercancel', up);
    }
    // MARCA-TEXTO com auto-corrigir: mesma renderização do traço, porém RETA (2 pontos: início→fim).
    // Snap p/ horizontal quando o arraste é quase reto (< ~10°), p/ grifar linha de texto fica perfeito.
    function startStraightHl(e0, pm, pt0) {
      try { pm.container.setPointerCapture(e0.pointerId); } catch {}
      let end = [pt0[0], pt0[1]];
      const seg = () => {
        let ex = end[0], ey = end[1]; const dx = ex - pt0[0], dy = ey - pt0[1];
        if (Math.abs(dx) > 4 && Math.abs(dy) < Math.abs(dx) * 0.18) ey = pt0[1];   // quase horizontal → reto na horizontal
        return [[pt0[0], pt0[1], 0.5], [ex, ey, 0.5]];
      };
      const stroke = () => ({ ink: [{ tool: 'hl', color: hlColor, size: hlSize, pts: seg() }] });
      drawLive(pm, stroke());
      const move = (e) => { const p = toPdf(e, pm); end = [p[0], p[1]]; drawLive(pm, stroke()); };
      const up = () => {
        pm.container.removeEventListener('pointermove', move); pm.container.removeEventListener('pointerup', up); pm.container.removeEventListener('pointercancel', up);
        const pts = seg();
        if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) > 4) { pushUndo(); pageData(pm.n).ink.push({ tool: 'hl', color: hlColor, size: hlSize, pts }); scheduleSave(); }
        clearLive(pm); redrawAnnot(pm);
      };
      pm.container.addEventListener('pointermove', move); pm.container.addEventListener('pointerup', up); pm.container.addEventListener('pointercancel', up);
    }
    function startErase(e0, pm) {
      try { pm.container.setPointerCapture(e0.pointerId); } catch {}
      let changed = false; const R = 9 / zoom;
      const hit = (e) => {
        const [x, y] = toPdf(e, pm); const d = pageData(pm.n);
        const before = d.ink.length + d.textHi.length;
        d.ink = d.ink.filter((st) => !st.pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < R + (st.size / 2)));
        d.textHi = d.textHi.filter((h) => !h.rects.some((r) => x >= r[0] - R && x <= r[0] + r[2] + R && y >= r[1] - R && y <= r[1] + r[3] + R));
        if (d.ink.length + d.textHi.length !== before) { changed = true; redrawAnnot(pm); }
      };
      pushUndo();
      const move = (e) => hit(e); const up = () => { pm.container.removeEventListener('pointermove', move); pm.container.removeEventListener('pointerup', up); if (changed) scheduleSave(); else { undo.pop(); refreshUndo(); } };
      hit(e0); pm.container.addEventListener('pointermove', move); pm.container.addEventListener('pointerup', up);
    }

    // ── desenho das anotações ────────────────────────────────────────────────
    // consolidado (tudo que está salvo) no canvas 'annot' — redesenhado só ao soltar/apagar
    function redrawAnnot(pm) {
      const ctx = pm.annot.getContext('2d'); ctx.clearRect(0, 0, pm.w1 * zoom + 2, pm.h1 * zoom + 2);
      drawAnnots(ctx, model.pages[pm.n], zoom);
    }
    // preview do traço/grifo em andamento no canvas 'live' — barato (só o que está sendo desenhado agora)
    function drawLive(pm, obj) { const ctx = pm.live.getContext('2d'); ctx.clearRect(0, 0, pm.w1 * zoom + 2, pm.h1 * zoom + 2); if (obj) drawAnnots(ctx, obj, zoom); }
    function clearLive(pm) { pm.live.getContext('2d').clearRect(0, 0, pm.w1 * zoom + 2, pm.h1 * zoom + 2); }

    // ── seleção de texto → grifar / sublinhar / tachar ────────────────────────
    let selBar = null;
    function pageAtPoint(cx, cy) { let el = document.elementFromPoint(cx, cy); while (el && el !== document.body) { if (el.__pm) return el.__pm; el = el.parentElement; } return null; }
    function showSelBar() {
      const sel = window.getSelection();
      if (tool !== 'text' || !sel || sel.isCollapsed || !sel.rangeCount) { if (selBar) { selBar.remove(); selBar = null; } return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect(); if (!rect.width && !rect.height) return;
      if (!selBar) { selBar = elx('div', 'pa-selbar'); ['highlight', 'underline', 'strike'].forEach((kind, i) => { const b = elx('button', 'pa-btn', ['🖍 Grifar', '𝐔 Sublinhar', 'S̶ Tachar'][i]); b.addEventListener('click', (e) => { e.preventDefault(); applyTextHi(kind); }); selBar.appendChild(b); }); document.body.appendChild(selBar); }
      selBar.style.left = Math.max(8, Math.min(window.innerWidth - selBar.offsetWidth - 8, rect.left)) + 'px';
      selBar.style.top = Math.max(8, rect.top - 46) + 'px';
    }
    function applyTextHi(kind) {
      const sel = window.getSelection(); if (!sel || !sel.rangeCount) return;
      const rects = [...sel.getRangeAt(0).getClientRects()]; const byPage = new Map();
      for (const r of rects) { if (r.width < 1 || r.height < 1) continue; const pm = pageAtPoint(r.left + r.width / 2, r.top + r.height / 2); if (!pm) continue; const pr = pm.container.getBoundingClientRect(); const arr = byPage.get(pm) || []; arr.push([(r.left - pr.left) / zoom, (r.top - pr.top) / zoom, r.width / zoom, r.height / zoom]); byPage.set(pm, arr); }
      if (!byPage.size) return; pushUndo();
      byPage.forEach((rs, pm) => { pageData(pm.n).textHi.push({ kind, color: hlColor, rects: rs }); redrawAnnot(pm); });
      sel.removeAllRanges(); if (selBar) { selBar.remove(); selBar = null; } scheduleSave();
    }
    document.addEventListener('selectionchange', () => { if (root.isConnected) showSelBar(); });

    // ── notas fixadas ──────────────────────────────────────────────────────────
    function renderNotes(pm) {
      pm.notes.innerHTML = ''; const d = model.pages[pm.n]; if (!d) return;
      for (const note of d.notes) {
        const pin = elx('div', 'pa-pin', '📌'); pin.style.left = (note.x * zoom) + 'px'; pin.style.top = (note.y * zoom) + 'px';
        pin.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); openNotePop(pm, note); });
        pm.notes.appendChild(pin);
      }
    }
    function addNote(pm, pt) { const note = { id: Date.now().toString(16) + Math.random().toString(16).slice(2, 6), x: pt[0], y: pt[1], text: '' }; pushUndo(); pageData(pm.n).notes.push(note); renderNotes(pm); openNotePop(pm, note); }
    function openNotePop(pm, note) {
      const pop = elx('div', 'pa-notepop'); const ta = elx('textarea'); ta.value = note.text || ''; ta.placeholder = 'Anotação…';
      const row = elx('div', 'row'); const del = elx('button', 'pa-btn', '🗑 Apagar'); const ok = elx('button', 'pa-btn on', 'OK');
      del.style.flex = '1'; ok.style.flex = '1'; row.append(del, ok); pop.append(ta, row); document.body.appendChild(pop);
      const r = pm.container.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + note.x * zoom)) + 'px';
      pop.style.top = Math.max(8, Math.min(window.innerHeight - 200, r.top + note.y * zoom)) + 'px';
      ta.focus();
      const finish = () => { const v = ta.value.trim(); if (v !== (note.text || '')) { pushUndo(); note.text = v; scheduleSave(); } pop.remove(); };
      ok.addEventListener('click', (e) => { e.preventDefault(); finish(); });
      del.addEventListener('click', (e) => { e.preventDefault(); pushUndo(); const d = pageData(pm.n); const i = d.notes.indexOf(note); if (i >= 0) d.notes.splice(i, 1); renderNotes(pm); scheduleSave(); pop.remove(); });
    }

    // ── recorte → cartão no canvas ─────────────────────────────────────────────
    function startCrop(e0, pm, pt0) {
      const box = elx('div', 'pa-crop-box'); pm.cropL.appendChild(box);
      try { pm.container.setPointerCapture(e0.pointerId); } catch {}
      const draw = (pt) => { const x = Math.min(pt0[0], pt[0]) * zoom, y = Math.min(pt0[1], pt[1]) * zoom; box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = Math.abs(pt[0] - pt0[0]) * zoom + 'px'; box.style.height = Math.abs(pt[1] - pt0[1]) * zoom + 'px'; };
      const move = (e) => draw(toPdf(e, pm));
      const up = async (e) => {
        pm.container.removeEventListener('pointermove', move); pm.container.removeEventListener('pointerup', up);
        const pt = toPdf(e, pm); box.remove();
        const x0 = Math.min(pt0[0], pt[0]), y0 = Math.min(pt0[1], pt[1]), w = Math.abs(pt[0] - pt0[0]), h = Math.abs(pt[1] - pt0[1]);
        if (w < 6 || h < 6) return;
        await exportCrop(pm, x0, y0, w, h);
      };
      pm.container.addEventListener('pointermove', move); pm.container.addEventListener('pointerup', up);
    }
    async function exportCrop(pm, x0, y0, w, h) {
      setStatus('Recortando…');
      const sc = 2; const vp = pm.page.getViewport({ scale: sc });
      const full = document.createElement('canvas'); full.width = Math.round(vp.width); full.height = Math.round(vp.height);
      const fctx = full.getContext('2d');
      await pm.page.render({ canvasContext: fctx, viewport: vp }).promise;
      drawAnnots(fctx, model.pages[pm.n], sc);   // anotações por cima, na escala do recorte
      const out = document.createElement('canvas'); out.width = Math.round(w * sc); out.height = Math.round(h * sc);
      out.getContext('2d').drawImage(full, Math.round(x0 * sc), Math.round(y0 * sc), Math.round(w * sc), Math.round(h * sc), 0, 0, out.width, out.height);
      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      if (!blob) { setStatus('Erro no recorte'); return; }
      const dir = file.split('/').slice(0, -1).join('/'); const base = (file.split('/').pop() || 'pdf').replace(/\.pdf$/i, '');
      const rel = (dir ? dir + '/' : '') + 'attachments/' + base + '-p' + pm.n + '-' + Date.now().toString(16) + '.png';
      try {
        await fetch('/vault/raw-write?path=' + enc(rel), { method: 'POST', headers: { 'x-bisa-token': BISA.token, 'content-type': 'image/png' }, body: blob });
        setStatus('Salvo ✓'); BISA.toast('Recorte enviado ao canvas');
        if (opts.onCropCard) opts.onCropCard(rel);
        close();
      } catch (e) { setStatus('Erro ao salvar recorte'); BISA.toast('Falha: ' + e.message); }
    }

    // ── atalhos teclado (desktop) + fechar ───────────────────────────────────
    function onKey(e) {
      if (e.key === 'Escape') { close(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    }
    document.addEventListener('keydown', onKey);
    function close() {
      clearTimeout(saveTimer); document.removeEventListener('keydown', onKey);
      try { io.disconnect(); } catch {}
      if (selBar) selBar.remove(); root.remove(); document.body.style.overflow = '';   // fecha IMEDIATAMENTE — não bloqueia na rede
      if (opts.onClose) try { opts.onClose(); } catch {}
      save().catch(() => {});   // salva em background (best-effort após fechar)
    }
  }

  // miniatura da 1ª página (com as anotações do sidecar por cima) p/ a capa do cartão no Canvas
  async function thumb(file, canvasEl) {
    try {
      await libs();
      const pdf = await pdfjs.getDocument({ url: rawUrl(file) }).promise;
      const page = await pdf.getPage(1);
      const box = canvasEl.getBoundingClientRect(); const cw = box.width || 280, ch = box.height || 200;
      const vp1 = page.getViewport({ scale: 1 }); const scale = Math.min(cw / vp1.width, ch / vp1.height) * dpr();
      const vp = page.getViewport({ scale });
      canvasEl.width = Math.round(vp.width); canvasEl.height = Math.round(vp.height);
      const ctx = canvasEl.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      try { const r = await BISA.api('/vault/file?path=' + enc(file + '.annot.json')); const j = JSON.parse(r.content || '{}'); drawAnnots(ctx, j.pages && j.pages['1'], scale); } catch {}
    } catch {}
  }

  window.BISO_PDF = { open, thumb };
})();
