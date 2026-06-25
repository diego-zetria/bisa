// gates/zen.js — tema "Zen": um amanhecer japonês sereno em sálvia e creme.
// Gesto: desenhar o ensō (um círculo num único traço de pincel sumi-ê).
// Abertura: a água floresce em ondas concêntricas (reveal 'bloom').
(function () {
  'use strict';
  const G = window.BISA_GATE; if (!G) return;

  G.define('zen', {
    label: 'Zen', accent: '#a8b5a2',
    help: { title: 'Desenhe o ensō', steps: [
      'Com calma, desenhe um círculo numa única pincelada.',
      'Não precisa fechar perfeito — basta dar quase a volta inteira.',
    ] },
    mount({ gateEl, onUnlock, kit, REDUCED }) {
      gateEl.appendChild(kit.html(`
        <canvas class="sky"></canvas>
        <div class="horizon"></div>
        <div class="stage">
          <div class="wordmark">bisa</div>
          <div class="enso">
            <svg class="guide" viewBox="0 0 100 100" aria-hidden="true">
              <!-- anel-guia com a falha do ensō (não fecha de todo) -->
              <path class="ring" d="M50 8 A42 42 0 1 1 35.5 11.7" pathLength="100"/>
            </svg>
            <canvas class="ink"></canvas>
            <div class="halo"></div>
          </div>
          <div class="label">Desenhe o ensō</div>
        </div>
        <div class="hint"><span>o ensō não fecha? </span><button type="button">entrar assim mesmo</button></div>
        <div class="veil"></div>`));

      const enso = gateEl.querySelector('.enso');
      const label = gateEl.querySelector('.label');
      const halo = gateEl.querySelector('.halo');
      const hint = gateEl.querySelector('.hint');

      const stopSky = sky(gateEl.querySelector('.sky'), REDUCED);
      const brush = sumi(enso.querySelector('.ink'), REDUCED);
      let drawing = false, done = false, fails = 0;

      // a superfície do gesto é a tela inteira (espaço amplo, calmo).
      kit.bindPointer(gateEl, {
        begin(pt) { if (done) return; drawing = true; brush.reset(); brush.push(pt); },
        move(pt) { if (drawing && !done) brush.push(pt); },
        end() {
          if (!drawing || done) return; drawing = false;
          if (isEnso(brush.points)) succeed();
          else { fails++; deny(); if (fails >= 2) hint.classList.add('show'); }
        },
      });

      // Verificação artesanal do círculo (não usa makeRecognizer — não é
      // invariante à rotação). Centroide → cobertura angular + redondez + tamanho.
      function isEnso(p) {
        if (!p || p.length < 12) return false;
        let cx = 0, cy = 0; for (const q of p) { cx += q[0]; cy += q[1]; }
        cx /= p.length; cy /= p.length;
        let cover = 0, prev = Math.atan2(p[0][1] - cy, p[0][0] - cx);
        let sum = 0, sum2 = 0;
        for (const q of p) {
          const dx = q[0] - cx, dy = q[1] - cy, r = Math.hypot(dx, dy);
          sum += r; sum2 += r * r;
          const a = Math.atan2(dy, dx);
          let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
          cover += d; prev = a;
        }
        const mean = sum / p.length;
        const variance = Math.max(0, sum2 / p.length - mean * mean);
        const rough = Math.sqrt(variance) / (mean || 1);   // dispersão dos raios
        const sweep = Math.abs(cover) * 180 / Math.PI;      // varredura angular em °
        return sweep >= 300 && rough < 0.35 && mean > 0.08;
      }

      function deny() {
        label.textContent = 'Respire e tente de novo'; label.classList.add('deny');
        kit.audio.deny(); brush.dissolve();
        setTimeout(() => { label.textContent = 'Desenhe o ensō'; label.classList.remove('deny'); }, 1300);
      }
      async function succeed() {
        done = true; brush.complete(); halo.classList.add('on');
        label.textContent = 'Acesso concedido'; kit.audio.success();
        const ok = await kit.finish(gateEl, onUnlock, 'bloom');
        if (!ok) {
          done = false; halo.classList.remove('on'); brush.reset();
          label.textContent = 'Falha ao abrir — tente de novo';
          setTimeout(() => label.textContent = 'Desenhe o ensō', 1400);
        }
      }
      hint.querySelector('button').addEventListener('click', async () => {
        if (done) return; done = true;
        const ok = await kit.finish(gateEl, onUnlock, 'bloom'); if (!ok) done = false;
      });

      gateEl._gateCleanup = () => { stopSky(); brush.destroy(); };
    },
  });

  // ── céu: gradiente vivo + pólen/luz flutuando (muito sutil) ───────────────
  function sky(canvas, REDUCED) {
    const ctx = canvas.getContext('2d');
    let W, H, raf, t = 0, motes = [];
    const dpr = () => Math.min(devicePixelRatio || 1, 2);
    const resize = () => { const d = dpr(); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const seed = () => {
      motes = Array.from({ length: REDUCED ? 10 : 34 }, () => ({
        x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7,
        ph: Math.random() * 6.28, sp: 0.00006 + Math.random() * 0.00012,
      }));
    };
    function frame() {
      t += 1; ctx.clearRect(0, 0, W, H);
      // brilho quente baixo no horizonte, como um sol nascente difuso
      const gx = W * 0.5, gy = H * 0.66, gr = Math.max(W, H) * 0.7;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g.addColorStop(0, 'rgba(244,237,221,0.55)'); g.addColorStop(0.5, 'rgba(214,219,198,0.18)'); g.addColorStop(1, 'rgba(214,219,198,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      for (const m of motes) {
        const drift = REDUCED ? 0 : Math.sin(t * 0.004 + m.ph) * 0.012;
        const y = REDUCED ? m.y : ((m.y - t * m.sp * m.z) % 1 + 1) % 1;
        const x = (m.x + drift) * W, py = y * H;
        const a = (0.10 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.02 + m.ph))) * m.z;
        ctx.fillStyle = `rgba(252,248,234,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, py, m.z * 1.5, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }
    resize(); seed(); frame();
    const onR = () => { resize(); seed(); }; addEventListener('resize', onR);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); };
  }

  // ── pincel sumi: rastro de tinta que afina pela velocidade, bordas macias ──
  function sumi(canvas, REDUCED) {
    const ctx = canvas.getContext('2d');
    let W, H, raf, pts = [], fade = 1, mode = 'live';   // live | dissolve | complete
    const dpr = () => Math.min(devicePixelRatio || 1, 2);
    const resize = () => { const d = dpr(); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };

    function strokeInk(alpha) {
      if (pts.length < 2) return;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.shadowColor = `rgba(40,46,40,${0.35 * alpha})`; ctx.shadowBlur = 6;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        // largura varia pela velocidade: traço rápido afina (tinta seca)
        const v = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const w = Math.max(2.2, 11 - v * 520);
        // pontas afinam (entrada/saída do pincel)
        const edge = Math.min(i, pts.length - i) / 6;
        const taper = Math.min(1, 0.35 + edge);
        ctx.strokeStyle = `rgba(36,42,38,${(0.9 * alpha).toFixed(3)})`;
        ctx.lineWidth = w * taper;
        ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(b[0] * W, b[1] * H); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      if (mode === 'dissolve') { fade = Math.max(0, fade - 0.05); if (fade <= 0) { pts = []; mode = 'live'; fade = 1; } }
      strokeInk(mode === 'dissolve' ? fade : 1);
      raf = requestAnimationFrame(draw);
    }
    resize(); draw();
    const onR = () => resize(); addEventListener('resize', onR);
    return {
      push: (x, y) => { pts.push(Array.isArray(x) ? x : [x, y]); },
      reset: () => { pts = []; mode = 'live'; fade = 1; },
      dissolve: () => { mode = 'dissolve'; fade = 1; },
      complete: () => { mode = 'complete'; },          // tinta permanece e o halo acende
      get points() { return pts; },
      destroy: () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); },
    };
  }
})();
