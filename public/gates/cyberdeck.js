// gates/cyberdeck.js — tema "Cyberdeck": terminal retro-futurista, chão em grade
// recuando ao horizonte, scanlines de CRT e néon verde/ciano.
// Gesto: SEGURAR para dar boot — carrega o anel de progresso em ~1.5s.
// Abertura: glitch. Soltar antes do fim = ABORT (vermelho + deny).
(function () {
  'use strict';
  const G = window.BISA_GATE; if (!G) return;

  // log do boot: cada linha aparece ao cruzar seu limiar de carga (0..1)
  const BOOT = [
    [0.06, '> POWER ............ OK'],
    [0.22, '> NEURAL LINK ...... SYNC'],
    [0.42, '> AUTH HANDSHAKE ... 0x1F'],
    [0.66, '> DECRYPTING VAULT .'],
    [0.88, '> KEYS LOADED ...... OK'],
  ];
  const HOLD_MS = 1500; // tempo para encher o anel

  G.define('cyberdeck', {
    label: 'Cyberdeck', accent: '#39ff9d',
    help: { title: 'Segure para conectar', steps: [
      'Pressione e segure o botão central.',
      'Mantenha até a barra chegar a 100%.',
    ], tip: 'Soltar antes do fim cancela a conexão.' },
    mount({ gateEl, onUnlock, kit, REDUCED }) {
      gateEl.appendChild(kit.html(`
        <canvas class="grid"></canvas>
        <div class="deck">
          <div class="topbar">
            <span class="brand">BISA//OS<b class="cur">_</b></span>
            <span class="ver">v2.6 // local node</span>
          </div>
          <div class="core">
            <div class="node" role="button" tabindex="0" aria-label="Segure para conectar">
              <svg class="ring" viewBox="0 0 120 120">
                <circle class="track" cx="60" cy="60" r="52"/>
                <circle class="prog" cx="60" cy="60" r="52"/>
              </svg>
              <div class="orb"><div class="pct">0%</div></div>
            </div>
            <div class="label">Segure para conectar</div>
          </div>
          <div class="log" aria-hidden="true"></div>
          <div class="hint"><button type="button">entrar assim mesmo</button></div>
        </div>
        <div class="scanlines"></div><div class="noise"></div><div class="vignette"></div>`));

      const node = gateEl.querySelector('.node');
      const prog = gateEl.querySelector('.prog');
      const pctEl = gateEl.querySelector('.pct');
      const label = gateEl.querySelector('.label');
      const logEl = gateEl.querySelector('.log');
      const hint = gateEl.querySelector('.hint');

      const LEN = 2 * Math.PI * 52;            // circunferência do anel
      prog.style.strokeDasharray = LEN;
      prog.style.strokeDashoffset = LEN;

      const stopGrid = gridFloor(gateEl.querySelector('.grid'), REDUCED);

      let charge = 0, holding = false, done = false, fails = 0;
      let raf = 0, last = 0, logged = -1, nextBlip = 0;

      // renderiza o anel + % a partir da carga atual (0..1)
      function render() {
        prog.style.strokeDashoffset = LEN * (1 - charge);
        const p = Math.round(charge * 100);
        pctEl.textContent = p + '%';
        node.style.setProperty('--glow', (0.25 + charge * 0.95).toFixed(2));
      }
      function pushLog(text, cls) {
        const line = document.createElement('div');
        line.className = 'ln' + (cls ? ' ' + cls : '');
        line.textContent = text;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        while (logEl.childElementCount > 7) logEl.removeChild(logEl.firstChild);
      }
      // emite as linhas do boot conforme a carga ultrapassa cada limiar
      function streamLogs() {
        for (let i = logged + 1; i < BOOT.length; i++) {
          if (charge >= BOOT[i][0]) { pushLog(BOOT[i][1]); logged = i; }
          else break;
        }
      }

      function loop(ts) {
        if (!holding || done) return;
        if (!last) last = ts;
        const dt = ts - last; last = ts;
        charge = Math.min(1, charge + dt / HOLD_MS);
        render(); streamLogs();
        if (ts >= nextBlip) { kit.audio.blip(520 + charge * 700); nextBlip = ts + 130; }
        if (charge >= 1) { succeed(); return; }
        raf = requestAnimationFrame(loop);
      }

      kit.bindPointer(node, {
        begin() {
          if (done || holding) return;
          holding = true; last = 0; nextBlip = 0;
          node.classList.remove('abort'); node.classList.add('charging');
          label.textContent = 'Conectando…';
          raf = requestAnimationFrame(loop);
        },
        end() {
          if (!holding || done) return;
          holding = false; cancelAnimationFrame(raf);
          if (charge < 1) abort();
        },
      });
      // teclado: Espaço/Enter segura enquanto pressionado
      node.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !holding && !done) {
          e.preventDefault(); holding = true; last = 0; nextBlip = 0;
          node.classList.remove('abort'); node.classList.add('charging');
          label.textContent = 'Conectando…'; raf = requestAnimationFrame(loop);
        }
      });
      node.addEventListener('keyup', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && holding && !done) {
          holding = false; cancelAnimationFrame(raf); if (charge < 1) abort();
        }
      });

      function abort() {
        node.classList.remove('charging'); node.classList.add('abort');
        label.textContent = 'CONEXÃO PERDIDA';
        pushLog('x CONNECTION DROPPED', 'err');
        kit.audio.deny();
        const reset = () => {
          charge = 0; logged = -1; render(); logEl.innerHTML = '';
          node.classList.remove('abort'); label.textContent = 'Segure para conectar';
        };
        setTimeout(reset, 900);
        fails++;
        if (fails >= 2) hint.classList.add('show');
      }

      async function succeed() {
        done = true; holding = false; cancelAnimationFrame(raf);
        charge = 1; render();
        node.classList.remove('charging'); node.classList.add('done');
        pushLog('> ACCESS GRANTED', 'ok');
        label.textContent = 'ACESSO CONCEDIDO';
        kit.audio.success();
        const ok = await kit.finish(gateEl, onUnlock, 'glitch');
        if (!ok) {                              // server estático: volta ao repouso
          done = false; charge = 0; logged = -1; render(); logEl.innerHTML = '';
          node.classList.remove('done'); label.textContent = 'Segure para conectar';
        }
      }

      hint.querySelector('button').addEventListener('click', async () => {
        if (done) return; done = true;
        const ok = await kit.finish(gateEl, onUnlock, 'glitch');
        if (!ok) done = false;
      });

      render();
      gateEl._gateCleanup = () => { stopGrid(); cancelAnimationFrame(raf); };
    },
  });

  // chão em grade com perspectiva, rolando lento em direção ao observador.
  // REDUCED: desenha estático, sem rAF.
  function gridFloor(canvas, REDUCED) {
    const ctx = canvas.getContext('2d');
    let W, H, raf = 0, t = 0;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    function draw() {
      ctx.clearRect(0, 0, W, H);
      const horizon = H * 0.52, cx = W / 2;
      // brilho do horizonte
      const hg = ctx.createLinearGradient(0, horizon - 60, 0, horizon + 4);
      hg.addColorStop(0, 'rgba(57,255,157,0)');
      hg.addColorStop(1, 'rgba(57,255,157,0.16)');
      ctx.fillStyle = hg; ctx.fillRect(0, horizon - 60, W, 64);
      ctx.lineWidth = 1;
      // linhas longitudinais (raios saindo do ponto de fuga)
      ctx.strokeStyle = 'rgba(57,255,157,0.28)';
      for (let i = -10; i <= 10; i++) {
        ctx.beginPath(); ctx.moveTo(cx, horizon);
        ctx.lineTo(cx + i * (W * 0.16), H); ctx.stroke();
      }
      // linhas transversais (espaçamento perspectivo, rolando com t)
      const rows = 16;
      for (let i = 0; i < rows; i++) {
        const f = ((i + (t % 1)) / rows);
        const y = horizon + (H - horizon) * (f * f);
        const a = 0.32 * (1 - f * 0.7);
        ctx.strokeStyle = `rgba(57,255,157,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
    }
    resize();
    const onR = () => { resize(); if (REDUCED) draw(); };
    addEventListener('resize', onR);
    if (REDUCED) { draw(); return () => removeEventListener('resize', onR); }
    function frame() { t += 0.008; draw(); raf = requestAnimationFrame(frame); }
    frame();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); };
  }
})();
