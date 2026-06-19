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
  function renderMarkdown(md) {
    const raw = window.marked ? window.marked.parse(md || '') : (md || '');
    let html = window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
    // [[slug]] e [[slug|label]] → âncoras internas
    html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, label) => {
      const s = slug.split('/').pop().trim();
      return `<a href="#" data-slug="${s}">${(label || s).trim()}</a>`;
    });
    return html;
  }

  // ---- WS (eventos fs/pkm/llm/notify) ----
  const wsSubs = new Set();
  function onWs(fn) { wsSubs.add(fn); return () => wsSubs.delete(fn); }
  let ws, wsTimer;
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
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

  // ---- gate ----
  function showGate() {
    document.getElementById('gate').classList.add('show');
  }
  function hideGate() { document.getElementById('gate').classList.remove('show'); }
  function setupGate() {
    document.getElementById('gate-go').onclick = () => {
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
    setupGate();
    document.querySelectorAll('#nav button').forEach((b) =>
      b.onclick = () => go(b.dataset.route));
    if (!token) { showGate(); return; }
    try { await api('/auth-check'); }
    catch { showGate(); return; }
    hideGate();
    connectWs();
    registerSw();
    const initial = (location.hash || '').replace('#', '') || 'hub';
    go(screens[initial] ? initial : 'hub');
  }

  window.BISA = {
    api, apiRaw, toast, renderMarkdown, onWs, wsSend, go, openEntity,
    screens, start,
    get token() { return token; },
  };
})();
