// app.js — núcleo do frontend bisa: auth gate, API helper, WS, router,
// toasts, e o contrato de tela. Telas registram-se em BISA.screens[nome]
// como { mount(el), unmount?() }. Sem framework, sem build.
(function () {
  const TOKEN_KEY = 'bisa_token';

  // ---- token: do ?token= da URL (QR pairing) ou do localStorage ----
  function readToken() {
    const u = new URL(location.href);
    const q = u.searchParams.get('token');
    if (q) {
      localStorage.setItem(TOKEN_KEY, q);
      u.searchParams.delete('token');
      history.replaceState({}, '', u.pathname + (u.search || '') + u.hash);
      return q;
    }
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  let token = readToken();

  // ---- API helper ----
  async function api(path, opts = {}) {
    const headers = Object.assign({ 'x-bisa-token': token }, opts.headers || {});
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body });
    if (res.status === 401) { showGate(); throw new Error('unauthorized'); }
    if (!res.ok) {
      let msg = 'erro'; try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }
  async function apiRaw(path, bodyBuf, contentType) {
    const res = await fetch(path, { method: 'POST',
      headers: { 'x-bisa-token': token, 'content-type': contentType || 'application/octet-stream' },
      body: bodyBuf });
    if (!res.ok) throw new Error('upload falhou');
    return res.json();
  }

  // ---- toasts ----
  function toast(msg, ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ---- markdown render (vendored marked + DOMPurify), wikilinks → links ----
  // Só ~~duplo~~ é strikethrough. O Claude usa ~ p/ "aproximadamente" (~230 °C,
  // ~15 min) e o del de til simples do marked riscava tudo entre os dois tils
  // (bug visto no caderno, 2026-07-14). Consumimos o ~ solto como texto para o
  // tokenizer padrão não rodar (retornar false cairia de volta nele).
  if (window.marked && window.marked.use) window.marked.use({
    tokenizer: {
      del(src) {
        const m = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?=[^~]|$)/.exec(src);
        if (m) return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
        if (src.startsWith('~')) return { type: 'text', raw: '~', text: '~' };
        return false;
      },
    },
  });
  function renderMarkdown(md) {
    const raw = window.marked ? window.marked.parse(md || '') : (md || '');
    let html = window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
    // [[slug]] e [[slug|label]] → âncoras internas
    html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, label) => {
      const s = slug.split('/').pop().trim();
      return `<a href="#" data-slug="${s}">${(label || s).trim()}</a>`;
    });
    // realce de tabelas e fences ```chart — md-tables/md-charts, pós-sanitize —
    // e links externos com target=_blank (senão o toque navega o PWA p/ fora
    // do app e perde o caderno; _blank abre no overlay do Safari)
    if ((window.BISA_MD_TABLES && html.includes('<table')) ||
        (window.BISA_MD_CHARTS && html.includes('language-chart')) ||
        html.includes('<a href="http')) {
      const div = document.createElement('div');
      div.innerHTML = html;
      if (window.BISA_MD_TABLES) window.BISA_MD_TABLES.enhance(div);
      if (window.BISA_MD_CHARTS) window.BISA_MD_CHARTS.enhance(div);
      div.querySelectorAll('a[href^="http"]').forEach((a) => {
        if (a.host === location.host) return;
        a.target = '_blank'; a.rel = 'noopener';
      });
      html = div.innerHTML;
    }
    return enhanceZiggyFences(html);
  }

  // ---- WS (eventos fs/pkm/llm/notify) ----
  const wsSubs = new Set();
  function onWs(fn) { wsSubs.add(fn); return () => wsSubs.delete(fn); }
  let ws, wsTimer, wsEverOpen = false;
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      // reconexão (não a 1ª conexão) → avisa as telas: um turno em andamento
      // pode ter morrido junto com o servidor (detector de turno órfão do caderno)
      if (wsEverOpen) for (const fn of wsSubs) { try { fn({ type: 'ws.reconnected' }); } catch {} }
      wsEverOpen = true;
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      // recarga remota (Modo Anotar: dev aplicou uma mudança → a usuária vê na hora)
      if (m && m.type === 'reload') { location.reload(); return; }
      // aviso do Modo Anotar (anotação enfileirada / para revisão) → toast
      if (m && m.type === 'annot' && m.text) { toast(m.text); return; }
      for (const fn of wsSubs) { try { fn(m); } catch {} }
    };
    ws.onclose = () => { clearTimeout(wsTimer); wsTimer = setTimeout(connectWs, 2000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function wsSend(obj) { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} }

  // ---- router ----
  const screens = {};
  let current = null;
  function go(route) {
    const scr = screens[route]; if (!scr) return;
    if (current && current.unmount) { try { current.unmount(); } catch {} }
    document.querySelectorAll('#nav button').forEach((b) =>
      b.classList.toggle('active', b.dataset.route === route));
    const el = document.getElementById('screen');
    el.innerHTML = '';
    const pad = document.createElement('div'); pad.className = 'screen-pad';
    el.appendChild(pad);
    el.scrollTop = 0;
    location.hash = route;
    current = scr;
    try { scr.mount(pad); } catch (err) { pad.innerHTML = `<p class="empty">Algo deu errado: ${err.message}</p>`; }
  }

  // open an entity (used by wikilink clicks anywhere) — World screen handles it
  function openEntity(slug) {
    go('world');
    setTimeout(() => { if (current && current.openEntity) current.openEntity(slug); }, 0);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-slug]');
    if (a) { e.preventDefault(); openEntity(a.dataset.slug); }
  });

  // ---- fence executável ```ziggy (padrão SilverBullet, pesquisa 2026-07):
  // bloco numa nota do caderno vira botão que dispara um fluxo do Ziggy com o
  // texto do bloco. 1ª linha opcional "flow: journal|finagent|slack|interpret|status".
  function enhanceZiggyFences(html) {
    if (!html.includes('language-ziggy')) return html;
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('pre > code.language-ziggy').forEach((code) => {
      const raw = code.textContent.trim();
      const m = raw.match(/^flow:\s*(\w+)\n?([\s\S]*)$/);
      const flow = m ? m[1] : 'journal';
      const text = (m ? m[2] : raw).trim();
      const btn = document.createElement('button');
      btn.className = 'btn zg-fence-btn';
      btn.dataset.flow = flow; btn.dataset.text = text;
      btn.textContent = `⚡ ${flow} — ${text.slice(0, 56)}${text.length > 56 ? '…' : ''}`;
      code.parentElement.replaceWith(btn);
    });
    return div.innerHTML;
  }
  function fenceOverlay(md) {
    let ov = document.getElementById('zg-fence-ov');
    if (ov) ov.remove();
    ov = document.createElement('div'); ov.id = 'zg-fence-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface);color:var(--ink);max-width:640px;max-height:80vh;overflow:auto;border-radius:var(--radius);padding:20px;line-height:1.5';
    box.innerHTML = renderMarkdown(md);
    ov.appendChild(box);
    document.body.appendChild(ov);
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.zg-fence-btn');
    if (!b || b.disabled) return;
    e.preventDefault();
    const old = b.textContent;
    b.disabled = true; b.textContent = '⚡ rodando… (pode levar 1-2 min)';
    try {
      const flow = b.dataset.flow; const text = b.dataset.text;
      let out;
      if (flow === 'journal') out = (await api('/ziggy/journal?q=' + encodeURIComponent(text))).answer;
      else if (flow === 'finagent') out = (await api('/ziggy/finagent', { method: 'POST', json: { text } })).answer;
      else out = (await api('/ziggy/mcgraw', { method: 'POST', json: { flow, text } })).answer;
      fenceOverlay(out || '(sem resposta)');
    } catch (err) { toast('falhou: ' + err.message); }
    b.disabled = false; b.textContent = old;
  });

  // ---- badge no ícone do PWA (iOS 16.4+): inbox do caderno + envelopes em
  // alerta. Atualiza no boot e toda vez que a PWA volta ao foco (não há
  // background sync em iOS — visibilitychange é o gancho certo).
  async function updateBadge() {
    if (!('setAppBadge' in navigator)) return;
    try {
      const d = await api('/badge/count');
      if (d.count > 0) navigator.setAppBadge(d.count); else navigator.clearAppBadge();
    } catch { /* offline/401: mantém o badge anterior */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token) updateBadge();
  });

  // ---- gate (o "selo": monólito + runa; ver gate.js) ----
  let gateMounted = false;
  function bootApp() {
    connectWs();
    registerSw();
    updateBadge();
    const initial = (location.hash || '').replace('#', '') || 'hub';
    go(screens[initial] ? initial : 'hub');
  }
  // Chamado pelo ritual da runa: seta o cookie no server (POST /unlock, sem
  // auth — local, baixa segurança por design), guarda o token p/ header+WS, e
  // sobe o app por trás do monólito (que então se abre revelando-o).
  async function unlock() {
    const r = await fetch('/unlock', { method: 'POST' });
    if (!r.ok) throw new Error('unlock falhou');
    const j = await r.json();
    token = j.token; localStorage.setItem(TOKEN_KEY, token);
    bootApp();
  }
  function showGate() {
    const g = document.getElementById('gate');
    g.classList.add('show');
    if (gateMounted) return;
    gateMounted = true;
    if (window.BISA_GATE) window.BISA_GATE.mount(g, unlock);
    else { g.classList.add('fallback'); setupGate(); }   // sem gate.js → input
  }
  function hideGate() { document.getElementById('gate').classList.remove('show'); }
  function setupGate() {
    const btn = document.getElementById('gate-go'); if (!btn) return;
    btn.onclick = () => {
      const t = document.getElementById('gate-token').value.trim();
      if (!t) return;
      token = t; localStorage.setItem(TOKEN_KEY, t);
      location.reload();
    };
  }

  // ---- service worker (PWA) ----
  function registerSw() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  // ---- boot ----
  async function start() {
    document.querySelectorAll('#nav button').forEach((b) =>
      b.onclick = () => go(b.dataset.route));
    if (!token) { showGate(); return; }
    try { await api('/auth-check'); }
    catch { showGate(); return; }
    hideGate();
    bootApp();
  }

  // ---- FAB arrastável com snap-to-edge (reuso: Modo Anotar ✎ e Biso ⌗) ----
  // Toque simples = onTapFn(); arrastar = move, gruda na borda mais próxima ao
  // soltar e guarda a posição (localStorage[key]). Distingue toque de arraste
  // por um limiar de 6px e engole o clique fantasma após o arraste.
  function makeDraggableFab(el, key, size, onTapFn) {
    const M = 6;
    const clamp = (x, y) => [
      Math.max(M, Math.min(window.innerWidth - size - M, x)),
      Math.max(M, Math.min(window.innerHeight - size - M, y)),
    ];
    function place(x, y, anim) {
      [x, y] = clamp(x, y);
      el.style.transition = anim ? 'left .2s ease, top .2s ease' : '';
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
      return [x, y];
    }
    // x: borda esq/dir mais próxima · y: topo / MEIO / base mais próximo → 6 pontos
    const snapCorner = (x, y) => {
      const nx = (x + size / 2 < window.innerWidth / 2) ? M : (window.innerWidth - size - M);
      const ys = [M, (window.innerHeight - size) / 2, window.innerHeight - size - M];
      let ny = ys[0], best = Infinity;
      for (const c of ys) { const d = Math.abs(y - c); if (d < best) { best = d; ny = c; } }
      return [nx, ny];
    };
    try { const p = JSON.parse(localStorage.getItem(key)); if (p && typeof p.x === 'number') place(p.x, p.y, false); } catch {}
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0, pid = null;
    el.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false; pid = e.pointerId; sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      el.style.transition = '';
      try { el.setPointerCapture(pid); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { e.preventDefault(); place(ox + dx, oy + dy, false); }
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      try { el.releasePointerCapture(pid); } catch {}
      if (moved) {
        const r = el.getBoundingClientRect();
        const [cx, cy] = snapCorner(r.left, r.top);
        const [nx, ny] = place(cx, cy, true);     // snap: vai p/ o canto mais próximo (4 cantos)
        try { localStorage.setItem(key, JSON.stringify({ x: nx, y: ny })); } catch {}
        const sw = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', sw, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', sw, { capture: true }), 400);
      } else if (onTapFn) { onTapFn(); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => { if (el.isConnected && el.style.left) place(parseFloat(el.style.left), parseFloat(el.style.top), false); });
  }

  window.BISA = {
    api, apiRaw, toast, renderMarkdown, onWs, wsSend, go, openEntity,
    screens, start, makeDraggableFab,
    get token() { return token; },
  };
})();
