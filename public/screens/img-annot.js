// screens/img-annot.js — Anotador de IMAGEM em tela cheia (Pencil-first).
// Irmão do pdf-annot.js: mesma receita (perfect-freehand + sidecar NÃO-destrutivo):
//   <arquivo>.annot.json   (imagem original intacta; traços/notas em px NATURAIS da imagem)
// Dedo = rolar/pinçar · Pencil = ferramenta ativa (caneta, marca-texto, borracha,
// nota, recorte→cartão). "✂ Editar" abre o Cropper.js v2 (vendorizado, MIT) para
// recortar/girar salvando uma CÓPIA .png — nunca sobrescreve o original.
// Exposto como window.BISO_IMG = { open(file, opts), edit(file, opts) }.
(function () {
  let getStroke = null, cropperMod = null;
  async function libs() { if (!getStroke) { try { const m = await import('/vendor/perfect-freehand.js'); getStroke = m.getStroke; } catch {} } }
  async function cropperLib() { if (!cropperMod) cropperMod = await import('/vendor/cropperjs.esm.js'); return cropperMod; }
  const enc = encodeURIComponent;
  const rawUrl = (p) => '/vault/raw?path=' + enc(p) + '&token=' + enc(BISA.token || '');
  const elx = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const dpr = () => window.devicePixelRatio || 1;

  // ── estilos ────────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('ia-styles')) return;
    const s = document.createElement('style'); s.id = 'ia-styles';
    s.textContent = `
      .ia-root { position:fixed; inset:0; z-index:1300; display:flex; flex-direction:column; background:var(--bg); }
      .ia-bar { display:flex; align-items:center; gap:6px; padding:7px 10px; flex-shrink:0; overflow-x:auto;
        -webkit-overflow-scrolling:touch; border-bottom:1px solid var(--line); background:var(--surface); }
      .ia-bar::-webkit-scrollbar { display:none; }
      .ia-name { font-weight:600; max-width:30vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .ia-sep { width:1px; align-self:stretch; background:var(--line); margin:2px 2px; }
      .ia-btn { min-width:38px; height:38px; padding:0 9px; border-radius:10px; border:1px solid var(--line);
        background:var(--surface-2); color:var(--ink); font-size:1rem; display:inline-flex; align-items:center;
        justify-content:center; gap:5px; cursor:pointer; flex-shrink:0; touch-action:manipulation; }
      .ia-btn.on { background:var(--accent,#3b82f6); color:#fff; border-color:transparent; }
      .ia-btn:disabled { opacity:.4; }
      .ia-sw { width:24px; height:24px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1px var(--line); flex-shrink:0; cursor:pointer; }
      .ia-sw.on { outline:2px solid var(--ink); outline-offset:1px; }
      .ia-grow { flex:1; }
      .ia-status { font-size:.78rem; color:var(--ink-soft); min-width:64px; text-align:right; flex-shrink:0; }
      .ia-scroll { flex:1; min-height:0; overflow:auto; background:#3a3a3e; -webkit-overflow-scrolling:touch;
        touch-action:pan-x pan-y; overscroll-behavior:contain; }
      .ia-doc { display:flex; padding:14px; min-height:100%; box-sizing:border-box; }
      .ia-page { position:relative; margin:auto; background:#fff; box-shadow:0 2px 14px rgba(0,0,0,.4); flex-shrink:0; touch-action:pan-x pan-y; }
      .ia-page > img { display:block; pointer-events:none; user-select:none; -webkit-user-drag:none; }
      .ia-page > canvas, .ia-page > .ia-notes, .ia-page > .ia-crop { position:absolute; left:0; top:0; pointer-events:none; }
      .ia-notes { width:100%; height:100%; }
      .ia-pin { position:absolute; transform:translate(-50%,-100%); font-size:22px; line-height:1; cursor:pointer;
        pointer-events:auto; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); touch-action:none; }
      .ia-crop-box { position:absolute; border:2px dashed #3b82f6; background:rgba(59,130,246,.12); pointer-events:none; }
      .ia-notepop { position:fixed; z-index:1330; width:min(86vw,320px); background:var(--surface); border:1px solid var(--line);
        border-radius:14px; box-shadow:var(--shadow); padding:12px; }
      .ia-notepop textarea { width:100%; min-height:90px; box-sizing:border-box; border:1px solid var(--line); border-radius:10px;
        background:var(--surface-2); color:var(--ink); padding:8px 10px; font-size:1rem; resize:vertical; }
      .ia-notepop .row { display:flex; gap:8px; margin-top:8px; }
      /* editor (Cropper.js v2) */
      .iae-root { position:fixed; inset:0; z-index:1310; display:flex; flex-direction:column; background:var(--bg); }
      .iae-body { flex:1; min-height:0; }
      .iae-body cropper-canvas { width:100%; height:100%; }
    `;
    document.head.appendChild(s);
  }

  const PALETTE = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#111827'];
  const HL_PALETTE = ['#fde047', '#86efac', '#7dd3fc', '#f9a8d4', '#fdba74'];

  // outline do perfect-freehand → Path2D (mesma função do pdf-annot)
  function strokePath(ptsCss, size, isHl) {
    if (!getStroke || ptsCss.length === 0) return null;
    const out = getStroke(ptsCss, { size, thinning: isHl ? 0 : 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: false });
    if (!out.length) return null;
    const p = new Path2D(); p.moveTo(out[0][0], out[0][1]);
    for (let i = 1; i < out.length; i++) { const a = out[i - 1], b = out[i]; p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    p.closePath(); return p;
  }
  // desenha as anotações num contexto qualquer. k = px naturais da imagem → espaço do ctx.
  function drawAnnots(ctx, d, k) {
    if (!d) return;
    for (const st of d.ink || []) {
      const isHl = st.tool === 'hl';
      const path = strokePath(st.pts.map((p) => [p[0] * k, p[1] * k, p[2]]), (st.size || 3) * k, isHl); if (!path) continue;
      ctx.save(); if (isHl) ctx.globalAlpha = 0.38; ctx.fillStyle = st.color; ctx.fill(path); ctx.restore();
    }
  }

  // ── abrir o anotador ─────────────────────────────────────────────────────────
  async function open(file, opts) {
    opts = opts || {};
    ensureStyles(); await libs();
    const root = elx('div', 'ia-root');
    const bar = elx('div', 'ia-bar');
    const scroll = elx('div', 'ia-scroll'); const doc = elx('div', 'ia-doc');
    scroll.appendChild(doc); root.append(bar, scroll); document.body.appendChild(root);
    document.body.style.overflow = 'hidden';

    // estado
    let tool = 'pen';                 // pen | hl | erase | note | crop
    let color = '#ef4444', hlColor = '#fde047', penSize = 4, hlSize = 18;
    let zoom = 1, iw = 1, ih = 1;
    let data = { ink: [], notes: [] };
    const sidecar = file + '.annot.json'; let baseHash = null, saveTimer = 0, saving = false, dirtyPending = false;
    const undo = [], redo = [];

    // ── persistência (sidecar) ──────────────────────────────────────────────
    async function loadSidecar() {
      try { const r = await BISA.api('/vault/file?path=' + enc(sidecar)); baseHash = r.hash || null; const j = JSON.parse(r.content || '{}'); data = { ink: j.ink || [], notes: j.notes || [] }; }
      catch { baseHash = null; data = { ink: [], notes: [] }; }
    }
    async function save() {
      if (saving) { dirtyPending = true; return; }
      saving = true; setStatus('Salvando…');
      const content = JSON.stringify({ v: 1, image: file, ink: data.ink, notes: data.notes });
      try { const r = await BISA.api('/vault/write', { method: 'POST', json: { path: sidecar, content, baseHash: baseHash || undefined } }); baseHash = r.hash || null; }
      catch (e) { try { const r2 = await BISA.api('/vault/write', { method: 'POST', json: { path: sidecar, content } }); baseHash = r2.hash || null; } catch { setStatus('Erro ao salvar'); saving = false; return; } }
      saving = false; setStatus('Salvo ✓');
      if (dirtyPending) { dirtyPending = false; scheduleSave(); }
    }
    function scheduleSave() { clearTimeout(saveTimer); setStatus('Editado'); saveTimer = setTimeout(save, 900); }
    function snapshot() { return JSON.stringify(data); }
    function pushUndo() { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo.length = 0; refreshUndo(); }
    function applyState(json) { data = JSON.parse(json); redrawAnnot(); renderNotes(); scheduleSave(); refreshUndo(); }
    function doUndo() { if (!undo.length) return; redo.push(snapshot()); applyState(undo.pop()); }
    function doRedo() { if (!redo.length) return; undo.push(snapshot()); applyState(redo.pop()); }

    // ── barra de ferramentas ────────────────────────────────────────────────
    const mkBtn = (label, title, fn) => { const b = elx('button', 'ia-btn', label); b.title = title; b.addEventListener('click', (e) => { e.preventDefault(); fn(b); }); return b; };
    const closeBtn = mkBtn('‹', 'Voltar', () => close()); closeBtn.style.fontSize = '1.5rem';
    const nameEl = elx('span', 'ia-name'); nameEl.textContent = (file.split('/').pop() || file);
    const toolBtns = {};
    function setTool(t) { tool = t; Object.keys(toolBtns).forEach((k) => toolBtns[k].classList.toggle('on', k === t)); updateSwatches(); }
    const penB = mkBtn('✏️', 'Caneta', () => setTool('pen'));
    const hlB = mkBtn('🖍', 'Marca-texto', () => setTool('hl'));
    const erB = mkBtn('🩹', 'Borracha', () => setTool('erase'));
    const noB = mkBtn('📌', 'Nota fixada', () => setTool('note'));
    const crB = mkBtn('✂️', 'Recortar p/ o canvas', () => setTool('crop'));
    toolBtns.pen = penB; toolBtns.hl = hlB; toolBtns.erase = erB; toolBtns.note = noB; toolBtns.crop = crB;
    const swWrap = elx('span'); swWrap.style.cssText = 'display:inline-flex;gap:5px;align-items:center;flex-shrink:0';
    function updateSwatches() {
      swWrap.innerHTML = '';
      const isHl = tool === 'hl';
      const pal = isHl ? HL_PALETTE : PALETTE; const cur = isHl ? hlColor : color;
      pal.forEach((c) => { const sw = elx('button', 'ia-sw' + (c === cur ? ' on' : '')); sw.style.background = c; sw.addEventListener('click', (e) => { e.preventDefault(); if (isHl) hlColor = c; else color = c; updateSwatches(); }); swWrap.appendChild(sw); });
    }
    const undoB = mkBtn('↶', 'Desfazer', () => doUndo());
    const redoB = mkBtn('↷', 'Refazer', () => doRedo());
    function refreshUndo() { undoB.disabled = !undo.length; redoB.disabled = !redo.length; }
    const zOut = mkBtn('−', 'Diminuir', () => setZoom(zoom / 1.25));
    const zLbl = elx('span', 'ia-status'); zLbl.style.minWidth = '44px';
    const zIn = mkBtn('+', 'Aumentar', () => setZoom(zoom * 1.25));
    const fitB = mkBtn('⤢', 'Ajustar à tela', () => fitView());
    const editB = mkBtn('✂ Editar', 'Recortar/girar (salva uma cópia)', () => { close(); edit(file, { onSaved: opts.onCropCard }); });
    const statusEl = elx('span', 'ia-status'); const setStatus = (t) => { statusEl.textContent = t; };
    bar.append(closeBtn, nameEl, sep(), penB, hlB, erB, noB, crB, sep(), swWrap, sep(), undoB, redoB, sep(), zOut, zLbl, zIn, fitB, sep(), editB, elx('span', 'ia-grow'), statusEl);
    function sep() { return elx('span', 'ia-sep'); }
    setTool('pen'); refreshUndo();

    // ── página (imagem + camadas) ────────────────────────────────────────────
    const container = elx('div', 'ia-page');
    const imgEl = document.createElement('img'); imgEl.crossOrigin = 'anonymous'; imgEl.src = rawUrl(file);
    const annot = elx('canvas'); const live = elx('canvas');
    const notes = elx('div', 'ia-notes'); const cropL = elx('div', 'ia-crop'); cropL.style.cssText += 'width:100%;height:100%;';
    container.append(imgEl, annot, live, notes, cropL); doc.appendChild(container);
    try { await imgEl.decode(); } catch { setStatus('Erro ao abrir imagem'); BISA.toast('Não consegui abrir a imagem.'); root.remove(); document.body.style.overflow = ''; return; }
    iw = imgEl.naturalWidth || 1; ih = imgEl.naturalHeight || 1;
    await loadSidecar();

    function sizeCanvas(cv, w, h, d) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.getContext('2d').setTransform(d, 0, 0, d, 0, 0); }
    function layout() {
      const w = iw * zoom, h = ih * zoom, d = dpr();
      container.style.width = w + 'px'; container.style.height = h + 'px';
      imgEl.style.width = w + 'px'; imgEl.style.height = h + 'px';
      sizeCanvas(annot, w, h, d); sizeCanvas(live, w, h, d);
      redrawAnnot(); renderNotes();
    }
    function setZoom(z) {
      z = Math.max(0.05, Math.min(8, z)); if (Math.abs(z - zoom) < 0.0005) return;
      zoom = z; zLbl.textContent = Math.round(zoom * 100) + '%';
      layout();
    }
    function fitView() { const aw = scroll.clientWidth - 28, ah = scroll.clientHeight - 28; setZoom(Math.min(aw / iw, ah / ih, 1)); }
    zoom = 0; fitView();

    // pinça (Safari Gesture Events, como no pdf-annot)
    let pinch0 = 1;
    scroll.addEventListener('gesturestart', (e) => { e.preventDefault(); pinch0 = zoom; });
    scroll.addEventListener('gesturechange', (e) => { e.preventDefault(); setZoom(pinch0 * e.scale); });
    scroll.addEventListener('gestureend', (e) => { e.preventDefault(); });

    // ── entrada (Pencil = ferramenta · dedo = rolar/pinçar) ───────────────────
    function toImg(e) { const r = container.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; }
    const blockStylus = (e) => { const t = e.touches && e.touches[0]; if (t && t.touchType === 'stylus') e.preventDefault(); };
    container.addEventListener('touchstart', blockStylus, { passive: false, capture: true });
    container.addEventListener('touchmove', blockStylus, { passive: false, capture: true });
    container.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;                // dedo = rolar/pinçar
      if (e.target.closest && e.target.closest('.ia-pin')) return;   // tocar num pin = abrir a nota
      e.preventDefault();
      const pt = toImg(e);
      if (tool === 'pen') startInk(e, pt, { tool: 'pen', color, size: penSize / Math.min(zoom, 1) });
      else if (tool === 'hl') startInk(e, pt, { tool: 'hl', color: hlColor, size: hlSize / Math.min(zoom, 1) });
      else if (tool === 'erase') startErase(e);
      else if (tool === 'note') addNote(pt);
      else if (tool === 'crop') startCrop(e, pt);
    }, true);

    function startInk(e0, pt0, opt) {
      const pts = [[pt0[0], pt0[1], e0.pressure || 0.5]];
      const liveObj = { ink: [{ tool: opt.tool, color: opt.color, size: opt.size, pts }] };
      try { container.setPointerCapture(e0.pointerId); } catch {}
      const move = (e) => { const p = toImg(e); pts.push([p[0], p[1], e.pressure || 0.5]); drawLive(liveObj); };
      const up = () => {
        container.removeEventListener('pointermove', move); container.removeEventListener('pointerup', up); container.removeEventListener('pointercancel', up);
        if (pts.length > 1) { pushUndo(); data.ink.push({ tool: opt.tool, color: opt.color, size: opt.size, pts }); scheduleSave(); }
        clearLive(); redrawAnnot();
      };
      container.addEventListener('pointermove', move); container.addEventListener('pointerup', up); container.addEventListener('pointercancel', up);
    }
    function startErase(e0) {
      try { container.setPointerCapture(e0.pointerId); } catch {}
      let changed = false; const R = 12 / zoom;
      const hit = (e) => {
        const [x, y] = toImg(e);
        const before = data.ink.length;
        data.ink = data.ink.filter((st) => !st.pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < R + (st.size / 2)));
        if (data.ink.length !== before) { changed = true; redrawAnnot(); }
      };
      pushUndo();
      const move = (e) => hit(e); const up = () => { container.removeEventListener('pointermove', move); container.removeEventListener('pointerup', up); if (changed) scheduleSave(); else { undo.pop(); refreshUndo(); } };
      hit(e0); container.addEventListener('pointermove', move); container.addEventListener('pointerup', up);
    }

    function redrawAnnot() { const ctx = annot.getContext('2d'); ctx.clearRect(0, 0, iw * zoom + 2, ih * zoom + 2); drawAnnots(ctx, data, zoom); }
    function drawLive(obj) { const ctx = live.getContext('2d'); ctx.clearRect(0, 0, iw * zoom + 2, ih * zoom + 2); if (obj) drawAnnots(ctx, obj, zoom); }
    function clearLive() { live.getContext('2d').clearRect(0, 0, iw * zoom + 2, ih * zoom + 2); }

    // ── notas fixadas ──────────────────────────────────────────────────────────
    function renderNotes() {
      notes.innerHTML = '';
      for (const note of data.notes) {
        const pin = elx('div', 'ia-pin', '📌'); pin.style.left = (note.x * zoom) + 'px'; pin.style.top = (note.y * zoom) + 'px';
        pin.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); openNotePop(note); });
        notes.appendChild(pin);
      }
    }
    function addNote(pt) { const note = { id: Date.now().toString(16) + Math.random().toString(16).slice(2, 6), x: pt[0], y: pt[1], text: '' }; pushUndo(); data.notes.push(note); renderNotes(); openNotePop(note); }
    function openNotePop(note) {
      const pop = elx('div', 'ia-notepop'); const ta = elx('textarea'); ta.value = note.text || ''; ta.placeholder = 'Anotação…';
      const row = elx('div', 'row'); const del = elx('button', 'ia-btn', '🗑 Apagar'); const ok = elx('button', 'ia-btn on', 'OK');
      del.style.flex = '1'; ok.style.flex = '1'; row.append(del, ok); pop.append(ta, row); document.body.appendChild(pop);
      const r = container.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + note.x * zoom)) + 'px';
      pop.style.top = Math.max(8, Math.min(window.innerHeight - 200, r.top + note.y * zoom)) + 'px';
      ta.focus();
      ok.addEventListener('click', (e) => { e.preventDefault(); const v = ta.value.trim(); if (v !== (note.text || '')) { pushUndo(); note.text = v; scheduleSave(); } pop.remove(); });
      del.addEventListener('click', (e) => { e.preventDefault(); pushUndo(); const i = data.notes.indexOf(note); if (i >= 0) data.notes.splice(i, 1); renderNotes(); scheduleSave(); pop.remove(); });
    }

    // ── recorte → cartão no canvas ─────────────────────────────────────────────
    function startCrop(e0, pt0) {
      const box = elx('div', 'ia-crop-box'); cropL.appendChild(box);
      try { container.setPointerCapture(e0.pointerId); } catch {}
      const draw = (pt) => { const x = Math.min(pt0[0], pt[0]) * zoom, y = Math.min(pt0[1], pt[1]) * zoom; box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = Math.abs(pt[0] - pt0[0]) * zoom + 'px'; box.style.height = Math.abs(pt[1] - pt0[1]) * zoom + 'px'; };
      const move = (e) => draw(toImg(e));
      const up = async (e) => {
        container.removeEventListener('pointermove', move); container.removeEventListener('pointerup', up);
        const pt = toImg(e); box.remove();
        const x0 = Math.max(0, Math.min(pt0[0], pt[0])), y0 = Math.max(0, Math.min(pt0[1], pt[1]));
        const w = Math.min(iw - x0, Math.abs(pt[0] - pt0[0])), h = Math.min(ih - y0, Math.abs(pt[1] - pt0[1]));
        if (w < 6 || h < 6) return;
        await exportCrop(x0, y0, w, h);
      };
      container.addEventListener('pointermove', move); container.addEventListener('pointerup', up);
    }
    async function exportCrop(x0, y0, w, h) {
      setStatus('Recortando…');
      const out = document.createElement('canvas'); out.width = Math.round(w); out.height = Math.round(h);
      const ctx = out.getContext('2d');
      ctx.drawImage(imgEl, Math.round(x0), Math.round(y0), Math.round(w), Math.round(h), 0, 0, out.width, out.height);
      ctx.translate(-x0, -y0); drawAnnots(ctx, data, 1);   // anotações por cima, em px naturais
      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      if (!blob) { setStatus('Erro no recorte'); return; }
      const rel = siblingPath(file, 'crop');
      try {
        await uploadPng(rel, blob);
        setStatus('Salvo ✓'); BISA.toast('Recorte enviado ao canvas');
        if (opts.onCropCard) opts.onCropCard(rel);
        close();
      } catch (e) { setStatus('Erro ao salvar recorte'); BISA.toast('Falha: ' + e.message); }
    }

    // ── atalhos + fechar ───────────────────────────────────────────────────────
    function onKey(e) {
      if (e.key === 'Escape') { close(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    }
    document.addEventListener('keydown', onKey);
    function close() {
      clearTimeout(saveTimer); document.removeEventListener('keydown', onKey);
      root.remove(); document.body.style.overflow = '';   // fecha imediatamente
      if (opts.onClose) try { opts.onClose(); } catch {}
      save().catch(() => {});   // best-effort em background
    }
  }

  // caminho irmão p/ derivados: <dir>/attachments/<base>-<sufixo>-<ts>.png
  function siblingPath(file, sufixo) {
    const dir = file.split('/').slice(0, -1).join('/');
    const base = (file.split('/').pop() || 'img').replace(/\.[a-z0-9]+$/i, '');
    return (dir ? dir + '/' : '') + 'attachments/' + base + '-' + sufixo + '-' + Date.now().toString(16) + '.png';
  }
  async function uploadPng(rel, blob) {
    const r = await fetch('/vault/raw-write?path=' + enc(rel), { method: 'POST', headers: { 'x-bisa-token': BISA.token, 'content-type': 'image/png' }, body: blob });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }

  // ── editor (Cropper.js v2): recortar/girar → salva CÓPIA png ────────────────
  async function edit(file, opts) {
    opts = opts || {};
    ensureStyles();
    let Cropper;
    try { Cropper = (await cropperLib()).default; }
    catch (e) { BISA.toast('Editor indisponível: ' + e.message); return; }
    const root = elx('div', 'iae-root');
    const bar = elx('div', 'ia-bar');
    const body = elx('div', 'iae-body');
    root.append(bar, body); document.body.appendChild(root);
    document.body.style.overflow = 'hidden';

    const mkBtn = (label, title, fn) => { const b = elx('button', 'ia-btn', label); b.title = title; b.addEventListener('click', (e) => { e.preventDefault(); fn(b); }); return b; };
    const closeBtn = mkBtn('‹', 'Cancelar', () => close()); closeBtn.style.fontSize = '1.5rem';
    const nameEl = elx('span', 'ia-name'); nameEl.textContent = '✂ ' + (file.split('/').pop() || file);
    const statusEl = elx('span', 'ia-status'); const setStatus = (t) => { statusEl.textContent = t; };

    const img = document.createElement('img'); img.src = rawUrl(file); img.alt = file; img.crossOrigin = 'anonymous';
    body.appendChild(img);
    let cropper = null;
    try {
      cropper = new Cropper(img, {
        container: body,
        template: `<cropper-canvas background>
          <cropper-image rotatable scalable translatable></cropper-image>
          <cropper-shade hidden></cropper-shade>
          <cropper-handle action="select" plain></cropper-handle>
          <cropper-selection initial-coverage="0.85" movable resizable>
            <cropper-grid role="grid" bordered covered></cropper-grid>
            <cropper-crosshair centered></cropper-crosshair>
            <cropper-handle action="move" theme-color="rgba(255,255,255,0.35)"></cropper-handle>
            <cropper-handle action="n-resize"></cropper-handle><cropper-handle action="e-resize"></cropper-handle>
            <cropper-handle action="s-resize"></cropper-handle><cropper-handle action="w-resize"></cropper-handle>
            <cropper-handle action="ne-resize"></cropper-handle><cropper-handle action="nw-resize"></cropper-handle>
            <cropper-handle action="se-resize"></cropper-handle><cropper-handle action="sw-resize"></cropper-handle>
          </cropper-selection>
        </cropper-canvas>`,
      });
    } catch (e) { BISA.toast('Editor falhou: ' + e.message); root.remove(); document.body.style.overflow = ''; return; }

    const rotate = (deg) => { try { const ci = cropper.getCropperImage(); ci.$rotate(deg + 'deg'); ci.$center('contain'); } catch {} };
    const rotL = mkBtn('↺ 90°', 'Girar p/ esquerda', () => rotate(-90));
    const rotR = mkBtn('↻ 90°', 'Girar p/ direita', () => rotate(90));
    const resetB = mkBtn('⟲', 'Restaurar', () => { try { const ci = cropper.getCropperImage(); ci.$resetTransform(); ci.$center('contain'); const sel = cropper.getCropperSelection(); sel.$reset(); } catch {} });
    const saveB = mkBtn('💾 Salvar cópia', 'Salva a edição como novo .png (original intacto)', async () => {
      saveB.disabled = true; setStatus('Salvando…');
      try {
        const sel = cropper.getCropperSelection();
        const cv = await sel.$toCanvas();
        const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
        if (!blob) throw new Error('render vazio');
        const rel = siblingPath(file, 'edit');
        await uploadPng(rel, blob);
        setStatus('Salvo ✓'); BISA.toast('Cópia editada salva no vault');
        if (opts.onSaved) opts.onSaved(rel);
        close();
      } catch (e) { setStatus('Erro'); BISA.toast('Falha ao salvar: ' + e.message); saveB.disabled = false; }
    });
    saveB.classList.add('on');
    bar.append(closeBtn, nameEl, elx('span', 'ia-sep'), rotL, rotR, resetB, elx('span', 'ia-grow'), statusEl, saveB);

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    function close() {
      document.removeEventListener('keydown', onKey);
      root.remove(); document.body.style.overflow = '';
      if (opts.onClose) try { opts.onClose(); } catch {}
    }
  }

  window.BISO_IMG = { open, edit };
})();
