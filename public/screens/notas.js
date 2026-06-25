// screens/notas.js — "Notas": caderno de ESCRITA (frontend do vault Obsidian).
// Editor = ink-mde (CodeMirror 6) vendorizado em /vendor/ink-mde.js → live-preview
// de verdade (mesmo motor do Obsidian: negrito/links/listas renderizam enquanto
// digita; a linha do cursor revela o markdown). Sem build, offline. Salva .md no
// vault via /vault/*. ✦ Claude (popover de comandos diretos) edita o arquivo e
// insere texto. Ver memória obsidian-writing-notebook.
(function () {
  if (!document.getElementById('notas-styles')) {
    const s = document.createElement('style');
    s.id = 'notas-styles';
    s.textContent = `
      .notas-root { display:flex; flex-direction:column; height:100%; min-height:0;
        --notas-font: "Iowan Old Style", Georgia, Charter, serif; --notas-size:18px; --notas-lh:1.7;
        --notas-paper:#f7f1e3; --notas-ink:#3a3228; --notas-width:680px; }
      .notas-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; flex-shrink:0;
        overflow-x:auto; -webkit-overflow-scrolling:touch; border-bottom:1px solid var(--line); background:var(--surface); }
      .notas-name { flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .notas-name .dot { color:var(--warn); }
      .notas-btn { background:var(--surface-2); border:1px solid var(--line); color:var(--ink);
        border-radius:10px; min-height:40px; padding:0 13px; font-size:.9rem; flex-shrink:0; }
      .notas-btn.primary { background:var(--primary); color:var(--primary-ink); border:none; }
      /* editor ink-mde */
      .notas-host { flex:1; min-height:0; overflow:hidden; background:var(--notas-paper); }
      .notas-host .ink, .notas-host .cm-editor { height:100%; background:var(--notas-paper); color:var(--notas-ink); }
      .notas-host .cm-editor.cm-focused { outline:none; }
      .notas-host .cm-scroller { font-family:var(--notas-font); font-size:var(--notas-size); line-height:var(--notas-lh);
        -webkit-overflow-scrolling:touch; padding:3vh 0 42vh; }
      .notas-host .cm-content { max-width:var(--notas-width); margin:0 auto; padding:0 clamp(16px,5vw,40px); caret-color:var(--primary); }
      .notas-host a { color:var(--primary); }
      .notas-loading { padding:24px; color:var(--ink-soft); }
      .notas-status { flex-shrink:0; padding:5px 14px calc(5px + env(safe-area-inset-bottom));
        font-size:.74rem; color:var(--ink-soft); border-top:1px solid var(--line); background:var(--surface); }
      /* overlays (settings / abrir / nome) */
      .notas-ov { position:fixed; inset:0; z-index:1200; background:rgba(0,0,0,.34); }
      .notas-panel { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        width:min(94vw,460px); max-height:84vh; overflow:auto; background:var(--surface);
        border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow); padding:16px; }
      .notas-panel h3 { margin:0 0 12px; }
      .notas-row { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
      .notas-row .lbl { width:96px; font-size:.85rem; color:var(--ink-soft); }
      .notas-seg { display:flex; gap:6px; flex-wrap:wrap; flex:1; }
      .notas-seg button { flex:1; min-height:42px; border-radius:10px; border:1px solid var(--line);
        background:var(--surface-2); color:var(--ink); font-size:.85rem; }
      .notas-seg button.on { background:var(--primary); color:var(--primary-ink); border-color:var(--primary); }
      .notas-step { display:flex; align-items:center; gap:10px; flex:1; }
      .notas-step button { width:44px; min-height:44px; border-radius:10px; border:1px solid var(--line);
        background:var(--surface-2); color:var(--ink); font-size:1.2rem; }
      .notas-step .val { flex:1; text-align:center; font-variant-numeric:tabular-nums; }
      .notas-sw { width:40px; height:40px; border-radius:9px; border:2px solid var(--line); }
      .notas-sw.on { border-color:var(--primary); box-shadow:0 0 0 2px var(--primary); }
      .notas-li { display:flex; align-items:center; gap:10px; padding:11px 6px; border-bottom:1px solid var(--line); cursor:pointer; }
      .notas-li:last-child { border-bottom:none; }
      /* Claude-assist — POPOVER compacto de comandos (ancorado no ✦) */
      .na-pop { position:fixed; inset:0; z-index:1150; background:rgba(0,0,0,.16); display:none; }
      .na-pop.open { display:block; }
      .na-card { position:absolute; left:16px; top:70px; width:min(92vw,440px); max-height:64vh; display:flex; flex-direction:column; overflow:hidden;
        background:var(--surface); border:1px solid var(--line); border-radius:18px; box-shadow:0 16px 44px rgba(0,0,0,.24); animation:na-pop .14s ease-out; transform-origin:top left; }
      @keyframes na-pop { from { opacity:0; transform:scale(.97); } to { opacity:1; transform:scale(1); } }
      .na-head { display:flex; align-items:center; padding:6px 8px 0; }
      .na-grip { flex:1; text-align:center; color:var(--ink-soft); font-size:1.2rem; line-height:1; letter-spacing:3px; cursor:grab; touch-action:none; padding:8px 0; user-select:none; -webkit-user-select:none; }
      .na-grip:active { cursor:grabbing; }
      .na-x { background:none; border:none; color:var(--ink-soft); font-size:1.05rem; min-width:40px; min-height:40px; border-radius:10px; }
      .na-x-spacer { width:40px; flex-shrink:0; }
      .na-acts { display:flex; flex-wrap:wrap; gap:6px; padding:4px 12px 8px; }
      .na-act { background:var(--surface-2); border:1px solid var(--line); color:var(--ink); border-radius:999px; min-height:40px; padding:0 13px; font-size:.86rem; }
      .na-act.on { background:var(--primary); color:var(--primary-ink); border-color:var(--primary); }
      .na-ask { display:flex; gap:8px; align-items:flex-end; padding:2px 12px 12px; }
      .na-write { flex:1; min-height:44px; max-height:22vh; overflow-y:auto; border:1px solid var(--line); border-radius:14px;
        padding:10px 12px; background:var(--bg); color:var(--ink); outline:none; font-size:1rem; line-height:1.45; -webkit-user-modify:read-write; }
      .na-write:empty::before { content:attr(data-ph); color:var(--ink-soft); }
      .na-send { background:var(--primary); color:var(--primary-ink); border:none; border-radius:50%; min-width:44px; min-height:44px; font-size:1.05rem; flex-shrink:0; }
      .na-send:disabled { opacity:.45; }
      .na-res { border-top:1px solid var(--line); padding:11px 14px; overflow-y:auto; font-size:.92rem; line-height:1.5; color:var(--ink); }
      .na-res:empty { display:none; }
      .na-res p { margin:0 0 .4em; } .na-res p:last-child { margin:0; }
      .na-res .muted { color:var(--ink-soft); font-size:.8rem; }
      .na-cursor { display:inline-block; width:2px; height:1em; background:var(--primary); margin-left:1px; vertical-align:text-bottom; animation:na-blink .75s step-end infinite; }
      @keyframes na-blink { 50% { opacity:0; } }
      .na-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      .na-tag { background:var(--accent-soft); border:1px solid var(--line); color:var(--ink); border-radius:999px; min-height:36px; padding:4px 12px; font-size:.85rem; }
      .na-apply { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      .na-apply button { font-size:.82rem; min-height:38px; border-radius:999px; padding:0 14px; border:1px solid var(--primary); color:var(--primary); background:none; }
    `;
    document.head.appendChild(s);
  }

  function onTap(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const sw = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', sw, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', sw, { capture: true }), 500);
      fn(e);
    });
  }
  const elx = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── Preferências ──────────────────────────────────────────────────────────
  const PREFS_KEY = 'notas_prefs';
  const DEF = { font: 'serif', size: 18, lh: 1.7, paper: 'creme', width: 680 };
  const FONTS = {
    serif: '"Iowan Old Style", Georgia, Charter, serif',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  };
  const PAPERS = { branco: ['#ffffff', '#1c1c1c'], creme: ['#f7f1e3', '#3a3228'], sepia: ['#f4ecd8', '#433422'], escuro: ['#1b1e22', '#e6e8ec'] };
  const appFor = (paper) => (paper === 'escuro' ? 'dark' : 'light');
  let prefs = (() => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch { return Object.assign({}, DEF); } })();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }
  function applyPrefs() {
    if (!root) return;
    root.style.setProperty('--notas-font', FONTS[prefs.font] || FONTS.serif);
    root.style.setProperty('--notas-size', prefs.size + 'px');
    root.style.setProperty('--notas-lh', prefs.lh);
    const [bg, ink] = PAPERS[prefs.paper] || PAPERS.creme;
    root.style.setProperty('--notas-paper', bg);
    root.style.setProperty('--notas-ink', ink);
    root.style.setProperty('--notas-width', prefs.width + 'px');
    if (editor) { try { editor.reconfigure({ interface: { appearance: appFor(prefs.paper), toolbar: true } }); } catch {} }
  }

  // ── Estado ───────────────────────────────────────────────────────────────
  let root, host, editor, nameEl, statusEl;
  let currentPath = null, dirty = false;
  let inkLib = null;
  // Claude-assist
  let assistStream = null, assistBusy = false, assistUnsub = null, naMode = null;
  let naPop = null, naCard = null, naWrite = null, naSendBtn = null, naResEl = null, askBtn = null;
  // histórico desfazer/refazer
  let histStack = [], histIdx = -1, histTimer = null;

  // ── Editor (ink-mde) ──────────────────────────────────────────────────────
  async function loadInk() { if (!inkLib) inkLib = await import('/vendor/ink-mde.js'); return inkLib.ink; }
  function mdSource() { try { return editor ? editor.getDoc() : ''; } catch { return ''; } }
  function setDoc(md) { if (editor) { try { editor.update(md || ''); } catch {} } }
  function onChange() { dirty = true; updateStatus(); histSchedule(); }

  function wordCount() { const t = mdSource().trim(); return t ? t.split(/\s+/).length : 0; }
  function updateStatus() {
    if (statusEl) statusEl.textContent = `${wordCount()} palavras · ${dirty ? '✎ não salvo' : (currentPath ? 'salvo' : 'nova nota')}`;
    if (nameEl) nameEl.innerHTML = (currentPath ? esc(currentPath.split('/').pop()) : 'Nova nota') + (dirty ? ' <span class="dot">•</span>' : '');
  }

  // ── Abrir / salvar no vault ──────────────────────────────────────────────
  function openBrowser() {
    const ov = elx('div', 'notas-ov');
    const panel = elx('div', 'notas-panel');
    panel.innerHTML = '<h3>Abrir nota</h3><div data-path style="font-family:ui-monospace,monospace;font-size:.78rem;color:var(--ink-soft);margin-bottom:8px">.</div><div data-list></div>';
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation();
    document.body.appendChild(ov);
    const list = panel.querySelector('[data-list]'), pathLbl = panel.querySelector('[data-path]');
    async function go(rel) {
      pathLbl.textContent = rel; list.innerHTML = '<p style="color:var(--ink-soft)">…</p>';
      try {
        const data = await BISA.api('/vault/list?path=' + encodeURIComponent(rel));
        list.innerHTML = '';
        if (rel !== '.') { const up = elx('div', 'notas-li', '📁 ..'); onTap(up, () => { const p = rel.split('/'); p.pop(); go(p.join('/') || '.'); }); list.appendChild(up); }
        (data.entries || []).forEach((en) => {
          if (!en.dir && !/\.md$/i.test(en.name)) return;
          const li = elx('div', 'notas-li', (en.dir ? '📁 ' : '📄 ') + esc(en.name));
          onTap(li, () => { if (en.dir) go(en.rel); else { loadNote(en.rel); ov.remove(); } });
          list.appendChild(li);
        });
        if (!list.children.length) list.innerHTML = '<p style="color:var(--ink-soft)">vazio</p>';
      } catch (e) { list.innerHTML = `<p style="color:var(--ink-soft)">erro: ${esc(e.message)}</p>`; }
    }
    go('.');
  }
  async function loadNote(rel) {
    try {
      const data = await BISA.api('/vault/file?path=' + encodeURIComponent(rel));
      setDoc(data.content || '');
      currentPath = rel; histReset(data.content || '');
      Promise.resolve().then(() => { dirty = false; updateStatus(); });
    } catch (e) { BISA.toast('Erro ao abrir: ' + e.message); }
  }
  async function save() {
    const content = mdSource();
    if (!currentPath) { promptName((name) => doSave(name, content)); return; }
    doSave(currentPath, content);
  }
  async function doSave(rel, content) {
    try { const r = await BISA.api('/vault/write', { method: 'POST', json: { path: rel, content } }); currentPath = r.path; dirty = false; updateStatus(); BISA.toast('Salvo ✓'); }
    catch (e) { BISA.toast('Erro ao salvar: ' + e.message); }
  }
  function promptName(cb) {
    const ov = elx('div', 'notas-ov');
    const panel = elx('div', 'notas-panel'); panel.innerHTML = '<h3>Salvar como</h3>';
    const inp = document.createElement('input'); inp.placeholder = 'nome-da-nota.md';
    inp.style.cssText = 'width:100%;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);padding:10px 12px;font-size:1rem;';
    const row = elx('div', 'notas-row'); row.style.marginTop = '12px';
    const ok = elx('button', 'notas-btn primary', 'Salvar'); ok.style.flex = '1';
    const cancel = elx('button', 'notas-btn', 'Cancelar');
    onTap(ok, () => { let n = inp.value.trim(); if (!n) return; if (!/\.md$/i.test(n)) n += '.md'; ov.remove(); cb(n); });
    onTap(cancel, () => ov.remove());
    row.append(ok, cancel); panel.append(inp, row);
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation();
    document.body.appendChild(ov);
  }

  // ── Preferências (texto/papel) ────────────────────────────────────────────
  function openSettings() {
    const ov = elx('div', 'notas-ov');
    const panel = elx('div', 'notas-panel'); panel.innerHTML = '<h3>Texto & papel</h3>';
    const fontRow = elx('div', 'notas-row', '<span class="lbl">Fonte</span>'); const fontSeg = elx('div', 'notas-seg');
    [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']].forEach(([id, lb]) => { const b = elx('button', prefs.font === id ? 'on' : '', lb); onTap(b, () => { prefs.font = id; applyPrefs(); savePrefs(); fontSeg.querySelectorAll('button').forEach((x, i) => x.classList.toggle('on', ['serif', 'sans', 'mono'][i] === id)); }); fontSeg.appendChild(b); });
    fontRow.appendChild(fontSeg);
    const paperRow = elx('div', 'notas-row', '<span class="lbl">Papel</span>'); const paperSeg = elx('div', 'notas-seg');
    Object.keys(PAPERS).forEach((id) => { const sw = elx('button', 'notas-sw' + (prefs.paper === id ? ' on' : '')); sw.style.background = PAPERS[id][0]; onTap(sw, () => { prefs.paper = id; applyPrefs(); savePrefs(); paperSeg.querySelectorAll('.notas-sw').forEach((x, i) => x.classList.toggle('on', Object.keys(PAPERS)[i] === id)); }); paperSeg.appendChild(sw); });
    paperRow.appendChild(paperSeg);
    const stepper = (label, get, set, fmt) => { const row = elx('div', 'notas-row', `<span class="lbl">${label}</span>`); const st = elx('div', 'notas-step'); const minus = elx('button', '', '−'), val = elx('div', 'val', fmt(get())), plus = elx('button', '', '+'); onTap(minus, () => { set(get() - 1); applyPrefs(); savePrefs(); val.textContent = fmt(get()); }); onTap(plus, () => { set(get() + 1); applyPrefs(); savePrefs(); val.textContent = fmt(get()); }); st.append(minus, val, plus); row.appendChild(st); return row; };
    const sizeRow = stepper('Tamanho', () => prefs.size, (v) => prefs.size = Math.max(13, Math.min(28, v)), (v) => v + 'px');
    const lhRow = stepper('Espaçamento', () => Math.round(prefs.lh * 10), (v) => prefs.lh = Math.max(1.2, Math.min(2.4, v / 10)), (v) => (v / 10).toFixed(1));
    const widthRow = stepper('Largura', () => Math.round(prefs.width / 20), (v) => prefs.width = Math.max(440, Math.min(960, v * 20)), () => prefs.width + 'px');
    const close = elx('button', 'notas-btn primary', 'Pronto'); close.style.cssText = 'width:100%;margin-top:6px'; onTap(close, () => ov.remove());
    panel.append(fontRow, sizeRow, lhRow, widthRow, paperRow, close);
    ov.appendChild(panel); ov.onclick = () => ov.remove(); panel.onclick = (e) => e.stopPropagation();
    document.body.appendChild(ov);
  }

  // ── Desfazer / Refazer (snapshots do markdown) ────────────────────────────
  function histReset(md) { histStack = [md || '']; histIdx = 0; }
  function histDoRecord() { const md = mdSource(); if (histIdx >= 0 && histStack[histIdx] === md) return; histStack = histStack.slice(0, histIdx + 1); histStack.push(md); if (histStack.length > 80) histStack.shift(); histIdx = histStack.length - 1; }
  function histSchedule() { clearTimeout(histTimer); histTimer = setTimeout(histDoRecord, 600); }
  function histFlush() { clearTimeout(histTimer); histDoRecord(); }
  function undo() { histFlush(); if (histIdx > 0) { histIdx--; setDoc(histStack[histIdx]); dirty = true; updateStatus(); BISA.toast('Desfeito'); } else BISA.toast('Nada para desfazer'); }
  function redo() { if (histIdx < histStack.length - 1) { histIdx++; setDoc(histStack[histIdx]); dirty = true; updateStatus(); BISA.toast('Refeito'); } else BISA.toast('Nada para refazer'); }

  // ── Claude-assist (popover de comandos diretos; sessão claude -p no vault) ──
  function noteContext() { const t = mdSource().trim(); return t ? t.slice(0, 8000) : ''; }
  const TERSE = 'Seja MUITO breve e direto, sem preâmbulo nem conversa.';
  const ACTIONS = [
    { id: 'pesquisar', label: '🔎 Pesquisar', param: true, ph: 'pesquisar sobre…', kind: 'text', build: (q) => `${TERSE} Pesquise objetivamente sobre: ${q}. Responda em 3-5 bullets curtos.` },
    { id: 'tags', label: '🏷 Tags', kind: 'tags', build: () => `${TERSE} Gere de 4 a 8 tags para a nota abaixo. Responda APENAS as tags no formato #tag separadas por espaço.\n\n[Nota]\n${noteContext()}` },
    { id: 'resumir', label: '✂ Resumir', kind: 'text', build: () => `${TERSE} Resuma a nota abaixo em até 3 bullets curtos.\n\n[Nota]\n${noteContext()}` },
    { id: 'continuar', label: '✍ Continuar', kind: 'continue', build: () => `${TERSE} Continue o texto abaixo em 1-3 frases, mesmo tom. Responda só a continuação.\n\n[Nota]\n${noteContext()}` },
    { id: 'links', label: '🔗 Links', kind: 'links', build: () => `${TERSE} Olhe meu vault e sugira [[wikilinks]] existentes relevantes para a nota abaixo. Responda só os links separados por espaço.\n\n[Nota]\n${noteContext()}` },
    { id: 'editar', label: '✎ Editar', param: true, ph: 'o que mudar no arquivo…', kind: 'edit' },
  ];
  function openAssist() { if (naPop) naPop.classList.add('open'); positionCard(); if (naWrite) naWrite.focus(); }
  function closeAssist() { if (naPop) naPop.classList.remove('open'); }
  function placeCard(x, y) { if (!naCard) return; const m = 8, w = naCard.offsetWidth, h = naCard.offsetHeight; x = Math.max(m, Math.min(window.innerWidth - w - m, x)); y = Math.max(m, Math.min(window.innerHeight - h - m, y)); naCard.style.left = x + 'px'; naCard.style.top = y + 'px'; }
  function positionCard() { if (!naCard) return; let saved = null; try { saved = JSON.parse(localStorage.getItem('notas_assist_pos')); } catch {} if (saved && typeof saved.x === 'number') { placeCard(saved.x, saved.y); return; } const r = askBtn ? askBtn.getBoundingClientRect() : null; if (r) placeCard(Math.min(r.left, window.innerWidth), r.bottom + 8); else placeCard(window.innerWidth - 460, 70); }
  function makeCardDraggable(handle) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;
    handle.addEventListener('pointerdown', (e) => { dragging = true; pid = e.pointerId; sx = e.clientX; sy = e.clientY; const r = naCard.getBoundingClientRect(); ox = r.left; oy = r.top; naCard.style.animation = 'none'; try { handle.setPointerCapture(pid); } catch {} e.preventDefault(); });
    handle.addEventListener('pointermove', (e) => { if (!dragging) return; e.preventDefault(); placeCard(ox + (e.clientX - sx), oy + (e.clientY - sy)); });
    const end = () => { if (!dragging) return; dragging = false; try { handle.releasePointerCapture(pid); } catch {} const r = naCard.getBoundingClientRect(); try { localStorage.setItem('notas_assist_pos', JSON.stringify({ x: r.left, y: r.top })); } catch {} };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  function naSetBusy(b) { assistBusy = b; if (naSendBtn) naSendBtn.disabled = b; }
  function naSetMode(id) { naMode = id; if (!naCard) return; naCard.querySelectorAll('.na-act').forEach((b) => b.classList.toggle('on', b.dataset.id === id)); const a = ACTIONS.find((x) => x.id === id); if (naWrite) { naWrite.setAttribute('data-ph', a ? '✎ ' + a.ph : '✎ peça algo direto…'); naWrite.focus(); } }
  function naClearRes() { if (naResEl) naResEl.innerHTML = ''; }
  function naInsert(text) { if (editor) { try { editor.focus(); editor.insert(text); } catch {} onChange(); BISA.toast('Inserido'); } }
  function runAction(a) { if (a.param) { naSetMode(a.id); return; } naClearRes(); naSetMode(null); naSend(a.build(''), { kind: a.kind }); }
  async function naSend(prompt, meta) {
    meta = meta || {};
    prompt = (prompt || '').trim(); if (!prompt) return;
    if (assistBusy) { BISA.toast('Aguarde a resposta.'); return; }
    let reload = false, kind = meta.kind || 'text';
    if (meta.editFile) {
      if (!currentPath) { BISA.toast('Salve a nota antes de pedir uma edição.'); return; }
      if (dirty) await doSave(currentPath, mdSource());
      prompt = `${TERSE} Edite DIRETAMENTE o arquivo "${currentPath}" no vault conforme: ${meta.userText}. Use suas ferramentas de edição e resuma em 1 linha o que mudou.`;
      reload = true; kind = 'edit';
    }
    naClearRes();
    if (naResEl) naResEl.innerHTML = '<span class="muted">pensando…</span>';
    assistStream = { text: '', kind, reload };
    BISA.wsSend({ type: 'notas.llm.send', text: prompt });
    naSetBusy(true);
  }
  function naSendFree() {
    const t = (naWrite && naWrite.innerText.trim()) || ''; if (!t) return;
    const mode = naMode ? ACTIONS.find((x) => x.id === naMode) : null;
    if (naWrite) naWrite.innerHTML = '';
    if (mode && mode.id === 'editar') { naSetMode(null); naSend('', { editFile: true, userText: t }); return; }
    if (mode) { naSetMode(null); naSend(mode.build(t), { kind: mode.kind }); return; }
    naSend(`${TERSE} ${t}\n\n[Nota]\n${noteContext()}`, { kind: 'text' });
  }
  function naPaintStream() { if (assistStream && naResEl) naResEl.innerHTML = (BISA.renderMarkdown(assistStream.text || '') || '<span class="muted">…</span>') + '<span class="na-cursor"></span>'; }
  function naRenderResult() {
    if (!assistStream || !naResEl) return;
    const { text, kind } = assistStream;
    naResEl.innerHTML = BISA.renderMarkdown(text || '') || '<span class="muted">(sem resposta)</span>';
    const apply = elx('div', 'na-apply');
    if (kind === 'tags' || kind === 'links') {
      const items = kind === 'tags' ? (text.match(/#[\p{L}\p{N}_\/-]+/gu) || []) : (text.match(/\[\[[^\]]+\]\]/g) || []);
      if (items.length) {
        naResEl.innerHTML = '<span class="muted">toque p/ inserir:</span>';
        const row = elx('div', 'na-tags'); items.forEach((it) => { const b = elx('button', 'na-tag', it); onTap(b, () => naInsert(it + ' ')); row.appendChild(b); }); naResEl.appendChild(row);
        const all = document.createElement('button'); all.textContent = 'inserir todas'; onTap(all, () => naInsert(items.join(' ') + ' ')); apply.appendChild(all);
      }
    } else if (kind === 'continue') { const b = document.createElement('button'); b.textContent = '↘ inserir no fim'; onTap(b, () => naInsert('\n' + text)); apply.appendChild(b); }
    else if (kind !== 'edit') { const b = document.createElement('button'); b.textContent = '↘ inserir no texto'; onTap(b, () => naInsert(text)); apply.appendChild(b); }
    if (apply.children.length) naResEl.appendChild(apply);
  }
  function handleAssistWs(ev) {
    if (!ev || typeof ev.type !== 'string' || !ev.type.startsWith('notas.llm') || !assistStream) return;
    switch (ev.type) {
      case 'notas.llm.text': if (ev.delta) { assistStream.text += ev.delta; naPaintStream(); } break;
      case 'notas.llm.done': { const st = assistStream; naRenderResult(); assistStream = null; naSetBusy(false); if (st.reload && currentPath) loadNote(currentPath).then(() => BISA.toast('Nota atualizada pelo Claude ✎')); break; }
      case 'notas.llm.error': if (naResEl) naResEl.innerHTML = '<span class="muted">⚠ ' + esc(ev.message || 'erro') + '</span>'; assistStream = null; naSetBusy(false); break;
    }
  }
  function buildAssist() {
    naPop = elx('div', 'na-pop'); naCard = elx('div', 'na-card');
    naCard.innerHTML = `<div class="na-head"><span class="na-x-spacer"></span><div class="na-grip">•••</div><button class="na-x">✕</button></div>
      <div class="na-acts"></div>
      <div class="na-ask"><div class="na-write" contenteditable="true" data-ph="✎ peça algo direto…" spellcheck="false"></div><button class="na-send">↑</button></div>
      <div class="na-res"></div>`;
    naPop.appendChild(naCard); document.body.appendChild(naPop);
    naPop.addEventListener('pointerdown', (e) => { if (e.target === naPop) closeAssist(); });
    onTap(naCard.querySelector('.na-x'), closeAssist);
    makeCardDraggable(naCard.querySelector('.na-grip'));
    naWrite = naCard.querySelector('.na-write'); naSendBtn = naCard.querySelector('.na-send'); naResEl = naCard.querySelector('.na-res');
    const acts = naCard.querySelector('.na-acts');
    ACTIONS.forEach((a) => { const b = elx('button', 'na-act', a.label); b.dataset.id = a.id; onTap(b, () => runAction(a)); acts.appendChild(b); });
    naWrite.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); naSendFree(); } });
    onTap(naSendBtn, naSendFree);
    assistUnsub = BISA.onWs(handleAssistWs);
  }

  // ── mount / unmount ──────────────────────────────────────────────────────
  window.BISO_NOTAS = {
    mount(el) {
      el.innerHTML = '';
      root = elx('div', 'notas-root');
      const bar = elx('div', 'notas-bar'); bar.innerHTML = '<span class="notas-name">Nova nota</span>';
      const bOpen = elx('button', 'notas-btn', '📂 Abrir');
      const bSave = elx('button', 'notas-btn primary', '💾 Salvar');
      const bUndo = elx('button', 'notas-btn', '↶'), bRedo = elx('button', 'notas-btn', '↷');
      const bLink = elx('button', 'notas-btn', '[[ ]]'), bTag = elx('button', 'notas-btn', '#');
      const bSet = elx('button', 'notas-btn', '🎨');
      const bAsk = elx('button', 'notas-btn', '✦ Claude'); askBtn = bAsk;
      bar.append(bOpen, bSave, bUndo, bRedo, bLink, bTag, bSet, bAsk);
      nameEl = bar.querySelector('.notas-name');

      host = elx('div', 'notas-host'); host.innerHTML = '<div class="notas-loading">Carregando editor…</div>';
      statusEl = elx('div', 'notas-status');
      root.append(bar, host, statusEl);
      el.appendChild(root);
      applyPrefs(); updateStatus();

      onTap(bOpen, openBrowser);
      onTap(bSave, save);
      onTap(bUndo, undo);
      onTap(bRedo, redo);
      onTap(bLink, () => { if (editor) { try { editor.focus(); editor.wrap('[[', ']]'); } catch {} onChange(); } });
      onTap(bTag, () => { if (editor) { try { editor.focus(); editor.insert('#'); } catch {} onChange(); } });
      onTap(bSet, openSettings);
      onTap(bAsk, () => { if (naPop && naPop.classList.contains('open')) closeAssist(); else openAssist(); });
      buildAssist();

      // editor ink-mde (CM6) — live preview de verdade
      loadInk().then((ink) => {
        host.innerHTML = '';
        editor = ink(host, {
          doc: '',
          interface: { appearance: appFor(prefs.paper), toolbar: true, autocomplete: false, lists: true },
          hooks: { afterUpdate: () => onChange() },
        });
        applyPrefs(); histReset(''); dirty = false; updateStatus();
      }).catch((e) => { host.innerHTML = '<div class="notas-loading">Falha ao carregar o editor: ' + esc(e.message) + '</div>'; });
    },
    unmount() {
      if (assistUnsub) { assistUnsub(); assistUnsub = null; }
      if (editor) { try { editor.destroy(); } catch {} editor = null; }
      document.querySelectorAll('.notas-ov, .na-pop').forEach((o) => o.remove());
      clearTimeout(histTimer); histStack = []; histIdx = -1;
      root = host = nameEl = statusEl = null;
      naPop = naCard = naWrite = naSendBtn = naResEl = askBtn = null;
      assistStream = null; assistBusy = false; naMode = null;
      currentPath = null; dirty = false;
    },
  };
})();
