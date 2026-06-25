// gates/cosmos.js — tema "Cosmos": nebulosa violeta-magenta num céu profundo.
// Gesto: ligar a constelação na ordem certa (arrastar uma linha entre as
// estrelas). Abertura: portal de warp que suga a cena.
(function () {
  'use strict';
  const G = window.BISA_GATE; if (!G) return;

  // Estrelas-âncora (normalizadas 0..1) — forma uma coroa estilizada.
  const STARS = [
    [0.22, 0.62], [0.34, 0.34], [0.50, 0.55],
    [0.66, 0.34], [0.78, 0.62], [0.50, 0.74],
  ];
  const HIT = 0.07;   // raio de captura (normalizado)

  G.define('cosmos', {
    label: 'Cosmos', accent: '#a98bff',
    help: { title: 'Ligue a constelação', steps: [
      'Toque na primeira estrela — a que pulsa mais forte.',
      'Sem soltar, passe por cada estrela seguinte, na ordem.',
    ], tip: 'A próxima estrela acende mais forte pra te guiar.' },
    mount({ gateEl, onUnlock, kit, REDUCED }) {
      gateEl.appendChild(kit.html(`
        <canvas class="sky"></canvas>
        <div class="wordmark">BISA</div>
        <div class="label">Ligue a constelação</div>
        <div class="surface"></div>
        <div class="hint"><span>céu nublado? </span><button type="button">entrar assim mesmo</button></div>
        <div class="vignette"></div>`));

      const label = gateEl.querySelector('.label');
      const hint = gateEl.querySelector('.hint');
      const surface = gateEl.querySelector('.surface');

      const cosmos = scene(gateEl.querySelector('.sky'), REDUCED);
      let next = 0;          // índice da próxima estrela esperada
      let active = false;    // arrasto em andamento
      let done = false, fails = 0;

      // distância normalizada respeitando aspecto (o canvas usa px reais)
      const near = (pt, s) => Math.hypot(pt[0] - s[0], pt[1] - s[1]) <= HIT;

      function tryCapture(pt) {
        if (done || next >= STARS.length) return;
        if (near(pt, STARS[next])) {
          cosmos.light(next);
          kit.audio.blip(540 + next * 110);
          next++;
          if (next >= STARS.length) succeed();
        }
      }
      function reset(soft) {
        active = false; next = 0; cosmos.clearTrail(); cosmos.unlightAll();
        if (soft) kit.audio.deny();
      }

      kit.bindPointer(surface, {
        begin(pt) {
          if (done) return;
          if (near(pt, STARS[0])) { active = true; cosmos.startTrail(pt); tryCapture(pt); }
        },
        move(pt) {
          if (!active || done) return;
          cosmos.trailTo(pt); tryCapture(pt);
        },
        end() {
          if (!active || done) return;
          // soltou antes de completar → desfaz a corrente
          fails++; reset(true);
          if (fails >= 2) hint.classList.add('show');
        },
      });

      async function succeed() {
        done = true; active = false;
        cosmos.blaze(); label.textContent = 'Acesso concedido'; label.classList.add('lit');
        kit.audio.success();
        const ok = await kit.finish(gateEl, onUnlock, 'warp');
        if (!ok) {
          done = false; cosmos.unblaze(); reset(false);
          label.classList.remove('lit'); label.textContent = 'Falha ao abrir — tente de novo';
          setTimeout(() => { label.textContent = 'Ligue a constelação'; }, 1400);
        }
      }

      hint.querySelector('button').addEventListener('click', async () => {
        if (done) return; done = true;
        const ok = await kit.finish(gateEl, onUnlock, 'warp'); if (!ok) done = false;
      });

      gateEl._gateCleanup = () => cosmos.destroy();
    },
  });

  // ── cena: starfield + nebulosa + linhas/rastro, tudo num canvas ──────────
  function scene(canvas, REDUCED) {
    const ctx = canvas.getContext('2d');
    let W, H, raf, t = 0;
    let stars = [], nebula = [], shoot = null;
    let lit = STARS.map(() => 0);     // 0..1 brilho de cada âncora
    let trail = [], drawing = false;
    let blazing = 0;                  // 0..1 ignição final

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const seed = () => {
      const n = REDUCED ? 110 : 320;
      stars = Array.from({ length: n }, () => ({
        x: Math.random(), y: Math.random(),
        z: 0.3 + Math.random() * 0.7,                 // profundidade → parallax + tamanho
        ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 2.4,
      }));
      // manchas de nebulosa em violeta/índigo/magenta
      nebula = [
        { x: 0.32, y: 0.40, r: 0.55, c: [150, 90, 240], a: 0.16, ph: 0.0, sp: 0.00018 },
        { x: 0.66, y: 0.58, r: 0.48, c: [220, 80, 200], a: 0.13, ph: 2.1, sp: 0.00022 },
        { x: 0.50, y: 0.30, r: 0.42, c: [90, 110, 255], a: 0.11, ph: 4.0, sp: 0.00015 },
      ];
    };

    // posições das âncoras em px (centradas/escaladas no eixo curto p/ não esticar)
    const anchorPx = (i) => [STARS[i][0] * W, STARS[i][1] * H];

    function drawNebula() {
      ctx.globalCompositeOperation = 'screen';
      for (const m of nebula) {
        const dx = Math.sin(t * m.sp + m.ph) * 0.04, dy = Math.cos(t * m.sp * 0.8 + m.ph) * 0.03;
        const x = (m.x + dx) * W, y = (m.y + dy) * H, rad = m.r * Math.max(W, H);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${m.c[0]},${m.c[1]},${m.c[2]},${m.a})`);
        g.addColorStop(1, `rgba(${m.c[0]},${m.c[1]},${m.c[2]},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawStars() {
      ctx.globalCompositeOperation = 'screen';
      const px = REDUCED ? 0 : Math.sin(t * 0.0015) * 14, py = REDUCED ? 0 : Math.cos(t * 0.0012) * 10;
      for (const s of stars) {
        const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.03 * s.sp + s.ph));
        const x = s.x * W + px * s.z, y = s.y * H + py * s.z, r = s.z * 1.4 + 0.3;
        ctx.fillStyle = `rgba(225,225,255,${(tw * s.z * 0.9).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawShooting() {
      if (REDUCED) return;
      if (!shoot && Math.random() < 0.004) {
        shoot = { x: 0.1 + Math.random() * 0.5, y: Math.random() * 0.3, vx: 0.012, vy: 0.006, life: 1 };
      }
      if (shoot) {
        shoot.x += shoot.vx; shoot.y += shoot.vy; shoot.life -= 0.02;
        const hx = shoot.x * W, hy = shoot.y * H, tx = (shoot.x - shoot.vx * 7) * W, ty = (shoot.y - shoot.vy * 7) * H;
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, 'rgba(200,220,255,0)'); g.addColorStop(1, `rgba(235,240,255,${(shoot.life * 0.9).toFixed(3)})`);
        ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        if (shoot.life <= 0 || shoot.x > 1 || shoot.y > 1) shoot = null;
      }
    }

    // linhas-guia pontilhadas + segmentos travados (acesos)
    function drawLinks() {
      ctx.globalCompositeOperation = 'screen'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < STARS.length; i++) {
        const [ax, ay] = anchorPx(i - 1), [bx, by] = anchorPx(i);
        const locked = Math.min(lit[i - 1], lit[i]);   // segmento aceso só quando ambas acesas
        // dica fraca pontilhada
        ctx.save(); ctx.setLineDash([2, 9]);
        ctx.strokeStyle = `rgba(180,160,255,${(0.18 * (1 - locked)).toFixed(3)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore();
        // segmento travado (brilho aditivo)
        if (locked > 0.01) {
          const glow = Math.max(locked, blazing);
          ctx.strokeStyle = `rgba(214,196,255,${glow.toFixed(3)})`;
          ctx.shadowColor = 'rgba(169,139,255,.9)'; ctx.shadowBlur = 16 + 18 * glow;
          ctx.lineWidth = 2 + 1.5 * glow;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.shadowBlur = 0;
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawAnchors() {
      ctx.globalCompositeOperation = 'screen';
      // qual é a próxima estrela (a primeira ainda apagada) — pulsa p/ guiar
      let nextIdx = lit.findIndex((v) => v < 0.5); if (nextIdx < 0) nextIdx = -1;
      for (let i = 0; i < STARS.length; i++) {
        const [x, y] = anchorPx(i);
        const isNext = i === nextIdx && !blazing;
        const pulse = isNext ? 0.5 + 0.5 * Math.sin(t * 0.12) : 0;
        const b = Math.max(lit[i], blazing);
        // halo
        const halo = 10 + 16 * b + 8 * pulse;
        const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
        const a = 0.25 + 0.6 * b + 0.35 * pulse;
        g.addColorStop(0, `rgba(220,205,255,${Math.min(a, 1).toFixed(3)})`);
        g.addColorStop(1, 'rgba(169,139,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, halo, 0, 6.2832); ctx.fill();
        // núcleo
        ctx.fillStyle = `rgba(255,255,255,${(0.55 + 0.45 * b).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, 2.4 + 2.4 * b + 1.2 * pulse, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawTrail() {
      if (trail.length < 2) return;
      ctx.globalCompositeOperation = 'screen'; ctx.lineJoin = ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(169,139,255,.95)'; ctx.shadowBlur = 18;
      ctx.strokeStyle = 'rgba(226,214,255,.92)'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(trail[0][0] * W, trail[0][1] * H);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i][0] * W, trail[i][1] * H);
      ctx.stroke();
      const h = trail[trail.length - 1];
      ctx.shadowBlur = 24; ctx.fillStyle = '#f1ecff';
      ctx.beginPath(); ctx.arc(h[0] * W, h[1] * H, 3.2, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-over';
    }

    function frame() {
      t += 1; ctx.clearRect(0, 0, W, H);
      // aproxima brilhos das âncoras suavemente
      for (let i = 0; i < lit.length; i++) lit[i] += (lit[i] < 0.001 ? 0 : (1 - lit[i])) * 0.18;
      if (blazing > 0 && blazing < 1) blazing = Math.min(1, blazing + 0.06);
      drawNebula(); drawStars(); drawShooting();
      drawLinks(); drawTrail(); drawAnchors();
      raf = requestAnimationFrame(frame);
    }

    resize(); seed(); frame();
    const onR = () => { resize(); }; addEventListener('resize', onR);

    return {
      light: (i) => { lit[i] = Math.max(lit[i], 0.001); },   // acende (frame faz subir)
      unlightAll: () => { lit = STARS.map(() => 0); },
      startTrail: (pt) => { drawing = true; trail = [pt]; },
      trailTo: (pt) => { if (drawing) trail.push(pt); },
      clearTrail: () => { drawing = false; trail = []; },
      blaze: () => { blazing = 0.01; trail = []; drawing = false; lit = STARS.map(() => 1); },
      unblaze: () => { blazing = 0; },
      destroy: () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); },
    };
  }
})();
