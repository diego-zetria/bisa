// gate-core.js — núcleo dos "selos" de entrada do bisa.
// Registro de temas + kit compartilhado (reconhecedor $1, áudio WebAudio,
// binding unificado de ponteiro, transição de abertura). Cada tema é um
// arquivo que se registra via BISA_GATE.define(nome, def). app.js chama
// BISA_GATE.mount(gateEl, onUnlock), que escolhe o tema ativo.
//
// Tema ativo (a "variável do escolhido"):
//   1) ?gate=NOME na URL  (override para preview, não persiste)
//   2) localStorage['bisa_gate_theme']
//   3) DEFAULT_THEME
// BISA_GATE.setTheme(nome) persiste a escolha. Como aplicar isso numa UI de
// ajustes fica para depois — por ora a variável já guarda e resolve a seleção.
(function () {
  'use strict';

  const THEME_KEY = 'bisa_gate_theme';     // tema fixado (modo 'fixed')
  const ROTATE_KEY = 'bisa_gate_rotate';   // 'off' desliga a rotação diária
  const POOL_KEY = 'bisa_gate_pool';        // JSON: subconjunto de temas na rotação
  const DEFAULT_THEME = 'monolith';
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const registry = {};
  // markup original do #gate (fallback de token) — p/ restaurar após uma prévia
  const _g0 = document.getElementById('gate');
  const FALLBACK_HTML = _g0 ? _g0.innerHTML : '';

  // ── geometria / reconhecedor $1 (Wobbrock) ──────────────────────────────
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pathLen = (p) => { let d = 0; for (let i = 1; i < p.length; i++) d += dist(p[i - 1], p[i]); return d; };
  function resample(pts, n) {
    if (!pts || pts.length < 2) return null;
    const I = pathLen(pts) / (n - 1);
    if (!isFinite(I) || I === 0) return null;
    const p = pts.map((q) => q.slice());
    const out = [p[0].slice()]; let D = 0;
    for (let i = 1; i < p.length; i++) {       // if/else canônico — nada de while interno (trava)
      const d = dist(p[i - 1], p[i]);
      if (D + d >= I) {
        const t = (I - D) / d;
        const q = [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])];
        out.push(q); p.splice(i, 0, q); D = 0;
      } else { D += d; }
    }
    while (out.length < n) out.push(p[p.length - 1].slice());
    return out.slice(0, n);
  }
  function normalize(pts) {
    let cx = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; }
    cx /= pts.length; cy /= pts.length;
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (const q of pts) { mnx = Math.min(mnx, q[0]); mny = Math.min(mny, q[1]); mxx = Math.max(mxx, q[0]); mxy = Math.max(mxy, q[1]); }
    const s = Math.max(mxx - mnx, mxy - mny) || 1;   // escala uniforme: preserva o formato
    return pts.map((q) => [(q[0] - cx) / s, (q[1] - cy) / s]);
  }
  const avgDist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += dist(a[i], b[i]); return d / a.length; };
  // Reconhecedor para traços abertos (runa, etc.). template em 0..1.
  function makeRecognizer(template, accept, N) {
    N = N || 48;
    const T = normalize(resample(template, N));
    return (raw) => {
      const r = resample(raw, N); if (!r) return { score: 1, match: false };
      const a = normalize(r);
      const s = Math.min(avgDist(a, T), avgDist(a, T.slice().reverse())); // qualquer sentido
      return { score: s, match: s <= accept };
    };
  }

  // ── áudio (WebAudio, sem assets) ────────────────────────────────────────
  let actx;
  function tone(notes) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime;
      for (const [f, d, dur, type, pk] of notes) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t0 + d);
        g.gain.setValueAtTime(0, t0 + d);
        g.gain.linearRampToValueAtTime(pk, t0 + d + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + dur);
        o.connect(g); g.connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + dur + 0.05);
      }
    } catch {}
  }
  const audio = {
    success() { tone([[196, 0, 1.6, 'sine', 0.18], [294, 0.06, 1.4, 'sine', 0.12], [587, 0.12, 1.1, 'triangle', 0.07]]); },
    deny() { tone([[140, 0, 0.18, 'sawtooth', 0.05]]); },
    blip(freq) { tone([[freq || 660, 0, 0.07, 'triangle', 0.035]]); },
    custom: tone,
  };

  // ── binding unificado: Pointer (Pencil/touch/mouse) com fallback ────────
  // handlers: { begin(pt,e), move(pt,e), end(pt,e) }. pt = [x,y] normalizado
  // ao retângulo de `el` (0..1). Retorna unbind().
  function bindPointer(el, h) {
    const norm = (cx, cy) => { const r = el.getBoundingClientRect(); return [(cx - r.left) / r.width, (cy - r.top) / r.height]; };
    const offs = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
    if (window.PointerEvent) {
      on(el, 'pointerdown', (e) => { try { el.setPointerCapture(e.pointerId); } catch {} h.begin && h.begin(norm(e.clientX, e.clientY), e); });
      on(el, 'pointermove', (e) => h.move && h.move(norm(e.clientX, e.clientY), e));
      on(el, 'pointerup', (e) => h.end && h.end(norm(e.clientX, e.clientY), e));
      on(el, 'pointercancel', (e) => h.end && h.end(null, e));
    } else {
      on(el, 'mousedown', (e) => h.begin && h.begin(norm(e.clientX, e.clientY), e));
      on(window, 'mousemove', (e) => h.move && h.move(norm(e.clientX, e.clientY), e));
      on(window, 'mouseup', (e) => h.end && h.end(norm(e.clientX, e.clientY), e));
      on(el, 'touchstart', (e) => { const t = e.touches[0]; h.begin && h.begin(norm(t.clientX, t.clientY), e); }, { passive: true });
      on(el, 'touchmove', (e) => { const t = e.touches[0]; h.move && h.move(norm(t.clientX, t.clientY), e); }, { passive: true });
      on(el, 'touchend', (e) => h.end && h.end(null, e));
    }
    return () => offs.forEach((f) => f());
  }

  // ── transição de abertura ───────────────────────────────────────────────
  // style: 'doors' (racha um [data-slab] em duas metades) | 'fade' | 'bloom'
  // | 'warp' | 'iris' | 'glitch'. O brilho usa --accent do tema.
  function reveal(gateEl, style) {
    style = style || 'fade';
    return new Promise((resolve) => {
      const flood = document.createElement('div');
      flood.className = 'gate-flood'; gateEl.appendChild(flood);
      gateEl.classList.add('opening', 'reveal-' + style);
      if (style === 'doors' && !REDUCED) {
        const slab = gateEl.querySelector('[data-slab]');
        if (slab) {
          const r = slab.getBoundingClientRect();
          for (const side of ['l', 'r']) {
            const half = document.createElement('div');
            half.className = 'gate-half ' + side;
            Object.assign(half.style, {
              position: 'fixed', top: r.top + 'px', height: r.height + 'px',
              width: (r.width / 2) + 'px', left: side === 'l' ? r.left + 'px' : (r.left + r.width / 2) + 'px',
            });
            gateEl.appendChild(half);
          }
          slab.style.transition = 'opacity .3s ease'; slab.style.opacity = '0';
        }
      }
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        gateEl.classList.remove('show', 'opening', 'reveal-' + style);
        gateEl.querySelectorAll('.gate-half, .gate-flood').forEach((h) => h.remove());
        resolve();
      };
      gateEl.addEventListener('animationend', (e) => { if (e.animationName === 'gate-dissolve') finish(); }, { once: true });
      setTimeout(finish, REDUCED ? 450 : 2000);   // rede de segurança
    });
  }

  // Helper que os temas chamam ao acertar o gesto: libera no server e abre.
  // Retorna true se abriu; false se o /unlock falhou (tema mostra erro).
  async function finish(gateEl, onUnlock, style) {
    let ok = false;
    try { await onUnlock(); ok = true; } catch { ok = false; }
    if (!ok) return false;
    await reveal(gateEl, style);
    return true;
  }

  const kit = {
    REDUCED, dist, resample, normalize, avgDist, makeRecognizer,
    audio, bindPointer, reveal, finish,
    // util: cria nós a partir de HTML
    html(str) { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content; },
  };

  // ── seleção do tema ─────────────────────────────────────────────────────
  // Prioridade:
  //   1) ?gate=NOME na URL    → preview, não persiste
  //   2) rotação diária ON    → tema do dia (determinístico pela data local)
  //   3) tema fixado          → localStorage[THEME_KEY]
  //   4) DEFAULT_THEME
  // Rotação é o PADRÃO (liga sozinha). setTheme(nome) fixa e desliga a rotação.

  // Dias desde a época em HORA LOCAL — vira exatamente à meia-noite local.
  function localDayIndex() {
    const offMs = new Date().getTimezoneOffset() * 60000;
    return Math.floor((Date.now() - offMs) / 86400000);
  }
  function ls(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : v; } catch { return def; } }
  function rotationOn() { return ls(ROTATE_KEY, 'on') !== 'off'; }
  // Pool da rotação: subconjunto salvo (filtrado aos registrados) ou todos.
  function rotationPool() {
    const all = Object.keys(registry);
    let pool = null;
    try { pool = JSON.parse(localStorage.getItem(POOL_KEY) || 'null'); } catch {}
    if (Array.isArray(pool)) pool = pool.filter((n) => registry[n]);
    return pool && pool.length ? pool : all;
  }
  // Tema de um dia (offset 0 = hoje, 1 = amanhã, -1 = ontem).
  function themeForDay(offset) {
    const pool = rotationPool(); if (!pool.length) return DEFAULT_THEME;
    const i = ((localDayIndex() + (offset | 0)) % pool.length + pool.length) % pool.length;
    return pool[i];
  }
  const todayTheme = () => themeForDay(0);

  function chosenTheme() {
    try { const q = new URL(location.href).searchParams.get('gate'); if (q) return q; } catch {}
    if (rotationOn()) return todayTheme();
    return ls(THEME_KEY, DEFAULT_THEME);
  }

  function define(name, def) { registry[name] = Object.assign({ name }, def); }

  // Ajuda discreta: um "?" fixo num canto (quase invisível) que abre um cartão
  // com o passo-a-passo do tema. def.help = { title, steps:[...], tip? }.
  function mountHelp(gateEl, def) {
    if (!def.help) return;
    const h = def.help;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'gate-help-btn'; btn.setAttribute('aria-label', 'Como entrar'); btn.textContent = '?';
    const panel = document.createElement('div');
    panel.className = 'gate-help-panel';
    panel.innerHTML = `<div class="gate-help-card">
      <div class="gate-help-title">${h.title || def.label || 'Como entrar'}</div>
      <ol class="gate-help-steps">${(h.steps || []).map((s) => `<li>${s}</li>`).join('')}</ol>
      ${h.tip ? `<div class="gate-help-tip">${h.tip}</div>` : ''}
      <button type="button" class="gate-help-close">entendi</button>
    </div>`;
    const toggle = (on) => panel.classList.toggle('show', on);
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(!panel.classList.contains('show')); });
    panel.addEventListener('click', (e) => { if (e.target === panel || e.target.classList.contains('gate-help-close')) toggle(false); });
    gateEl.appendChild(btn); gateEl.appendChild(panel);
  }

  function mount(gateEl, onUnlock) {
    let name = chosenTheme();
    if (!registry[name]) {
      if (name !== DEFAULT_THEME) console.warn(`[gate] tema "${name}" não encontrado — usando ${DEFAULT_THEME}`);
      name = DEFAULT_THEME;
    }
    const def = registry[name];
    if (!def) {                                        // nem o default existe → fallback input
      gateEl.classList.add('fallback');
      return false;
    }
    gateEl.classList.add('gate', 'gate-' + name);
    if (def.accent) gateEl.style.setProperty('--accent', def.accent);
    try { def.mount({ gateEl, onUnlock, kit, REDUCED, accent: def.accent }); }
    catch (err) { console.error('[gate] falha ao montar', name, err); gateEl.classList.add('fallback'); return false; }
    mountHelp(gateEl, def);
    return true;
  }

  // Restaura o #gate ao estado limpo (fallback de token, sem tema/cena).
  function resetGate(g) {
    if (g._gateCleanup) { try { g._gateCleanup(); } catch {} g._gateCleanup = null; }
    g.className = ''; g.removeAttribute('style'); g.innerHTML = FALLBACK_HTML;
  }

  // Prévia ao vivo de um tema (usada pela tela de Ajustes): monta a cena em
  // tela cheia sobre o app, com botão de fechar; o gesto toca a abertura
  // inteira mas NÃO desbloqueia — ao dissolver, revela o app de volta e limpa.
  function preview(name) {
    const g = document.getElementById('gate');
    if (!g || !registry[name]) return false;
    resetGate(g);
    const def = registry[name];
    g.classList.add('gate', 'gate-' + name, 'gate-preview');
    if (def.accent) g.style.setProperty('--accent', def.accent);
    const obs = new MutationObserver(() => {
      if (!g.classList.contains('show')) { obs.disconnect(); setTimeout(() => resetGate(g), 60); }
    });
    try { def.mount({ gateEl: g, onUnlock: async () => {}, kit, REDUCED, accent: def.accent }); }
    catch (err) { console.error('[gate] prévia falhou', name, err); resetGate(g); return false; }
    mountHelp(g, def);
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'gate-close'; close.textContent = '✕ prévia';
    close.addEventListener('click', (e) => { e.stopPropagation(); obs.disconnect(); g.classList.remove('show'); setTimeout(() => resetGate(g), 60); });
    g.appendChild(close);
    g.classList.add('show');
    obs.observe(g, { attributes: true, attributeFilter: ['class'] });
    return true;
  }

  window.BISA_GATES = registry;
  window.BISA_GATE = {
    define, mount, preview, kit,
    getTheme: chosenTheme,        // o que será montado agora
    todayTheme, themeForDay,      // rotação: tema de hoje / de um dia qualquer
    isRotating: rotationOn,
    // fixa um tema (e desliga a rotação diária)
    setTheme(name) { try { localStorage.setItem(THEME_KEY, name); localStorage.setItem(ROTATE_KEY, 'off'); } catch {} },
    // liga/desliga a rotação diária
    setRotation(on) { try { localStorage.setItem(ROTATE_KEY, on ? 'on' : 'off'); } catch {} },
    // define quais temas entram na rotação (array de nomes); [] / null = todos
    setPool(names) { try { localStorage.setItem(POOL_KEY, JSON.stringify(names || [])); } catch {} },
    getPool: rotationPool,
    themes() { return Object.values(registry).map((d) => ({ name: d.name, label: d.label || d.name, accent: d.accent })); },
  };
})();
