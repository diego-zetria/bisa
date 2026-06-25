// gates/biblioteca.js — tema "Biblioteca": uma estante secreta à luz de vela.
// Gesto: puxar o livro que brilha em dourado para fora da prateleira.
// Abertura: a estante racha em duas e revela a luz quente lá dentro.
(function () {
  'use strict';
  const G = window.BISA_GATE; if (!G) return;

  // paleta de lombadas (hues quentes e abafados) — sorteadas por prateleira
  const SPINES = [
    '#7a2e2e', '#8a5a23', '#3f5a3a', '#2c3a55', '#c9b48a', '#6a3b52',
    '#864c25', '#43564b', '#5a2f3a', '#b08a4f', '#33445e', '#7d6e4a',
  ];
  const ROWS = 4, PER_ROW = 9;        // estante: linhas x livros
  const THRESH = 0.18;                 // fração da largura p/ contar como "puxado"
  const rnd = (a, b) => a + Math.random() * (b - a);

  G.define('biblioteca', {
    label: 'Biblioteca', accent: '#f0a94b',
    help: { title: 'Puxe o livro', steps: [
      'Um livro brilha em dourado e se destaca na estante.',
      'Toque nele e arraste-o pra fora, até a estante ceder.',
    ] },
    mount({ gateEl, onUnlock, kit, REDUCED }) {
      // o livro especial mora numa prateleira/coluna fixa (legível, centralizado)
      const SP_ROW = 1, SP_COL = 4;

      // monta as prateleiras com lombadas variadas; marca o livro especial
      let shelves = '';
      for (let r = 0; r < ROWS; r++) {
        let books = '';
        for (let c = 0; c < PER_ROW; c++) {
          if (r === SP_ROW && c === SP_COL) {
            books += `<div class="book special" data-special>
              <span class="bk-glow"></span><span class="bk-tag">Puxe o livro</span></div>`;
          } else {
            const col = SPINES[(r * PER_ROW + c * 5) % SPINES.length];
            const w = (16 + ((r * 7 + c * 13) % 12)) | 0;   // largura pseudo-aleatória estável
            const h = 86 + ((r * 5 + c * 11) % 12);          // leve variação de altura
            books += `<div class="book" style="--c:${col};--bw:${w}px;--bh:${h}%"></div>`;
          }
        }
        shelves += `<div class="shelf">${books}</div>`;
      }

      gateEl.appendChild(kit.html(`
        <canvas class="motes"></canvas>
        <div class="stage"><div class="bookcase" data-slab>
          <div class="wordmark">BISA</div>
          <div class="rows">${shelves}</div>
          <div class="edge-light"></div>
        </div></div>
        <div class="label">Puxe o livro</div>
        <div class="hint"><span>não cede? </span><button type="button">entrar assim mesmo</button></div>
        <div class="vignette"></div>`));

      const book = gateEl.querySelector('[data-special]');
      const label = gateEl.querySelector('.label');
      const hint = gateEl.querySelector('.hint');
      const stopMotes = motes(gateEl.querySelector('.motes'), REDUCED);

      let dragging = false, done = false, fails = 0, ox = 0, oy = 0;

      // distância "puxada" relativa à largura da estante (eixo dominante)
      const pulled = (pt, start) => {
        const dx = pt[0] - start[0], dy = pt[1] - start[1];
        return { dx, dy, mag: Math.hypot(dx, dy) };
      };

      let start = null;
      kit.bindPointer(book, {
        begin(pt) {
          if (done) return;
          dragging = true; start = pt; ox = oy = 0;
          book.classList.add('pulling');           // pausa o "respirar"
        },
        move(pt) {
          if (!dragging || done || !start) return;
          const { dx, dy } = pulled(pt, start);
          // resistência: o livro segue o ponteiro mas com fator < 1 e tombo (rotação)
          ox = dx * 160 * 0.85; oy = dy * 120 * 0.7;
          const tilt = Math.max(-10, Math.min(10, dx * 22));
          book.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px) rotateZ(${tilt.toFixed(1)}deg)`;
          const lit = Math.min(1, Math.hypot(dx, dy) / THRESH);
          book.style.setProperty('--pull', lit.toFixed(3));
        },
        end(pt) {
          if (!dragging || done) return; dragging = false;
          const past = start && pt && pulled(pt, start).mag >= THRESH;
          if (past) succeed();
          else snapBack();
        },
      });

      function snapBack() {
        book.classList.remove('pulling');
        book.classList.add('snap');
        book.style.transform = '';
        book.style.setProperty('--pull', '0');
        kit.audio.deny();
        setTimeout(() => book.classList.remove('snap'), 420);
        fails++;
        if (fails >= 2) hint.classList.add('show');
      }

      async function succeed() {
        done = true;
        book.classList.remove('pulling'); book.classList.add('out');
        book.style.transform = 'translate(0,-6px) translateZ(80px) rotateX(34deg)';
        label.textContent = 'Acesso concedido'; label.classList.add('ok');
        kit.audio.success();
        const ok = await kit.finish(gateEl, onUnlock, 'doors');
        if (!ok) {
          done = false; book.classList.remove('out'); book.style.transform = '';
          book.style.setProperty('--pull', '0'); label.classList.remove('ok');
          label.textContent = 'Falha ao abrir — tente de novo';
          setTimeout(() => { label.textContent = 'Puxe o livro'; }, 1400);
        }
      }

      hint.querySelector('button').addEventListener('click', async () => {
        if (done) return; done = true;
        const ok = await kit.finish(gateEl, onUnlock, 'doors'); if (!ok) done = false;
      });

      gateEl._gateCleanup = () => { stopMotes(); };
    },
  });

  // poeira dourada à deriva, à luz de vela (canvas atrás/sobre a estante)
  function motes(canvas, REDUCED) {
    const ctx = canvas.getContext('2d');
    let W, H, raf, t = 0, dust = [], glow;
    const dpr = () => Math.min(devicePixelRatio || 1, 2);
    const resize = () => { const d = dpr(); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    const seed = () => {
      dust = Array.from({ length: REDUCED ? 18 : 70 }, () => ({
        x: Math.random(), y: Math.random(), z: rnd(0.3, 1), ph: rnd(0, 6.28), sp: rnd(0.00003, 0.00009),
      }));
    };
    function frame() {
      t += 1; ctx.clearRect(0, 0, W, H);
      // brilho quente central, como um abajur (pulsa de leve, sem piscar se REDUCED)
      const flick = REDUCED ? 1 : 0.92 + 0.08 * Math.sin(t * 0.06) + 0.04 * Math.sin(t * 0.21);
      glow = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.6);
      glow.addColorStop(0, `rgba(255,196,110,${(0.10 * flick).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255,196,110,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      for (const m of dust) {
        const y = ((m.y - t * m.sp * m.z) % 1 + 1) % 1;
        const x = (m.x + Math.sin(t * 0.0006 + m.ph) * 0.012) * W;
        const a = (0.12 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.02 + m.ph))) * m.z;
        ctx.fillStyle = `rgba(255,214,150,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y * H, m.z * 1.3, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }
    resize(); seed(); frame();
    const onR = () => { resize(); seed(); }; addEventListener('resize', onR);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onR); };
  }
})();
