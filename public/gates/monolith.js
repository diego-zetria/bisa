// gates/monolith.js — tema "Monólito": vault de obsidiana num vazio frio.
// Gesto: traçar a runa gravada na pedra. Abertura: a pedra racha em duas.
(function () {
  'use strict';
  const G = window.BISA_GATE; if (!G) return;

  const RUNE = [[0.26, 0.14], [0.74, 0.14], [0.30, 0.50], [0.70, 0.50], [0.34, 0.88]];
  const GLYPHS = ['◇', '◈', '◇', '◈', '◇', '◈', '◇'];
  const ACCEPT = 0.215;

  G.define('monolith', {
    label: 'Monólito', accent: '#6fe6ff',
    help: { title: 'Trace o selo', steps: [
      'Comece no canto superior da pedra.',
      'Faça o ziguezague descendo (um “Z” duplo), num traço só, sem soltar.',
    ], tip: 'A direção não importa — pode traçar de baixo pra cima.' },
    mount({ gateEl, onUnlock, kit, REDUCED }) {
      const sealPx = 1000;
      const pts = RUNE.map(([x, y]) => `${(x * sealPx) | 0},${(y * sealPx) | 0}`).join(' ');
      const nodes = RUNE.map(([x, y]) => `<circle class="guide-node" cx="${(x * sealPx) | 0}" cy="${(y * sealPx) | 0}" r="14"/>`).join('');
      gateEl.appendChild(kit.html(`
        <canvas class="atmos"></canvas>
        <div class="stage"><div class="monument">
          <div class="slab" data-slab>
            <div class="sheen"></div>
            <div class="glyphs top">${GLYPHS.map((g) => `<span>${g}</span>`).join('')}</div>
            <div class="wordmark">BISA</div>
            <div class="seal">
              <svg viewBox="0 0 ${sealPx} ${sealPx}" preserveAspectRatio="none">
                <polyline class="guide-line" points="${pts}"/>${nodes}
              </svg>
              <canvas></canvas><div class="shock"></div>
            </div>
            <div class="label">Trace o selo</div>
            <div class="glyphs bottom">${GLYPHS.map((g) => `<span>${g}</span>`).join('')}</div>
          </div>
        </div></div>
        <div class="hint"><span>o selo não responde? </span><button type="button">entrar assim mesmo</button></div>
        <div class="vignette"></div><div class="scanlines"></div><div class="grain"></div>`));

      const seal = gateEl.querySelector('.seal');
      const line = gateEl.querySelector('.guide-line');
      const label = gateEl.querySelector('.label');
      const hint = gateEl.querySelector('.hint');
      try { seal.style.setProperty('--len', line.getTotalLength()); } catch {}

      const stopAtmos = atmosphere(gateEl.querySelector('.atmos'), REDUCED);
      const trace = tracer(seal.querySelector('canvas'));
      const recognize = kit.makeRecognizer(RUNE, ACCEPT);
      let drawing = false, done = false, fails = 0;

      kit.bindPointer(seal, {
        begin(pt) { if (done) return; drawing = true; trace.reset(); seal.classList.remove('deny'); label.classList.remove('deny'); trace.push(pt); },
        move(pt) { if (drawing && !done) trace.push(pt); },
        end() {
          if (!drawing || done) return; drawing = false;
          if (recognize(trace.points).match) succeed();
          else { fails++; deny(); if (fails >= 2) hint.classList.add('show'); }
        },
      });

      function deny() {
        seal.classList.add('deny'); label.classList.add('deny'); label.textContent = 'Selo não reconhecido';
        kit.audio.deny();
        setTimeout(() => { trace.reset(); seal.classList.remove('deny'); label.classList.remove('deny'); label.textContent = 'Trace o selo'; }, 1100);
      }
      async function succeed() {
        done = true; trace.reset(); seal.classList.add('lit'); label.textContent = 'Acesso concedido';
        kit.audio.success();
        const ok = await kit.finish(gateEl, onUnlock, 'doors');
        if (!ok) { done = false; seal.classList.remove('lit'); label.textContent = 'Falha ao abrir — tente de novo'; setTimeout(() => label.textContent = 'Trace o selo', 1400); }
      }
      hint.querySelector('button').addEventListener('click', async () => {
        if (done) return; done = true; const ok = await kit.finish(gateEl, onUnlock, 'doors'); if (!ok) done = false;
      });
      gateEl._gateCleanup = () => { stopAtmos(); trace.destroy(); };
    },
  });

  // névoa + poeira no vazio
  function atmosphere(canvas, REDUCED) {
    const ctx = canvas.getContext('2d');
    let W, H, raf, t = 0, mist = [], dust = [];
    const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const seed = () => {
      mist = Array.from({ length: 6 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.28 + Math.random() * 0.22, ph: i * 1.7, sp: 0.0004 + Math.random() * 0.0006 }));
      dust = Array.from({ length: REDUCED ? 24 : 80 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, ph: Math.random() * 6.28 }));
    };
    function frame() {
      t += 1; ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'screen';
      for (const m of mist) {
        const x = (m.x + Math.sin(t * m.sp + m.ph) * 0.06) * W, y = (m.y + Math.cos(t * m.sp * 0.8 + m.ph) * 0.05) * H, rad = m.r * Math.min(W, H);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(46,120,150,0.10)'); g.addColorStop(1, 'rgba(46,120,150,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.2832); ctx.fill();
      }
      for (const d of dust) {
        const y = ((d.y - t * 0.00006 * d.z) % 1 + 1) % 1, x = (d.x + Math.sin(t * 0.0008 + d.ph) * 0.01) * W;
        const a = (0.18 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.03 + d.ph))) * d.z;
        ctx.fillStyle = `rgba(180,228,245,${a.toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y * H, d.z * 1.3, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over'; raf = requestAnimationFrame(frame);
    }
    resize(); seed(); frame();
    const onR = () => { resize(); seed(); }; addEventListener('resize', onR);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); };
  }

  // rastro luminoso do traçado
  function tracer(canvas) {
    const ctx = canvas.getContext('2d'); let W, H, pts = [], raf;
    const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    function draw() {
      ctx.clearRect(0, 0, W, H);
      if (pts.length > 1) {
        ctx.lineJoin = ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(150,235,255,.9)'; ctx.shadowBlur = 16;
        ctx.strokeStyle = 'rgba(196,244,255,.95)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
        ctx.stroke();
        const h = pts[pts.length - 1]; ctx.shadowBlur = 22; ctx.fillStyle = '#eafdff';
        ctx.beginPath(); ctx.arc(h[0] * W, h[1] * H, 3.4, 0, 6.2832); ctx.fill(); ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    }
    resize(); draw(); const onR = () => resize(); addEventListener('resize', onR);
    return { push: (x, y) => { if (Array.isArray(x)) pts.push(x); else pts.push([x, y]); }, reset: () => { pts = []; }, get points() { return pts; }, destroy: () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); } };
  }
})();
