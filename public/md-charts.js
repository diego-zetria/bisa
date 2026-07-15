// md-charts.js — nível 2 do realce: fences ```chart {...} nas respostas do
// agente viram SVG inline (sem lib). Convenção no CLAUDE.md do caderno-geral:
//   {"type":"bar|line|donut|stat","title":"…","unit":"R$","data":[["rótulo",123],…]}
// Regras (skill dataviz): cor única do tema (--tab-accent, indireção remapeada
// no biso.css), texto sempre em tokens de tinta, rótulos diretos (sem legenda
// de cor solta), donut ≤6 fatias (excedente vira "outros"), marcas finas com
// ponta arredondada. Spec inválida/sem suporte → tabela (via md-tables) ou o
// próprio <pre> fica como está — degrada, não quebra.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = (v) => {
    // não-inteiros pequenos mantêm 1 decimal (85,4 kg ≠ 85 kg); grandes arredondam
    const digits = Number.isInteger(v) ? 0 : (Math.abs(v) < 100 ? 1 : 0);
    try { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(v); }
    catch { return String(v); }
  };
  const withUnit = (v, unit) => {
    const s = typeof v === 'number' ? fmt(v) : String(v);
    if (!unit) return s;
    return /^(R\$|US\$|\$|€|£)$/i.test(unit) ? unit + ' ' + s : s + (unit === '%' ? '' : ' ') + unit;
  };
  const el = (doc, tag, attrs, txt) => {
    const e = doc.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (txt != null) e.textContent = txt;
    return e;
  };
  const svgRoot = (doc, w, h) => {
    const s = el(doc, 'svg', { viewBox: `0 0 ${w} ${h}`, role: 'img' });
    s.style.cssText = 'width:100%;height:auto;display:block';
    return s;
  };

  function bar(doc, spec) {
    const rows = spec.data, RH = 30, PAD = 4, W = 520;
    const H = rows.length * RH + PAD * 2;
    const max = Math.max.apply(null, rows.map((r) => r[1]));
    if (!(max > 0)) return null;
    const LBL = 148, VAL = 78, plot = W - LBL - VAL;
    const svg = svgRoot(doc, W, H);
    rows.forEach((r, i) => {
      const y = PAD + i * RH, bw = Math.max(3, (r[1] / max) * plot);
      svg.appendChild(el(doc, 'text', { x: LBL - 10, y: y + RH / 2 + 4, 'text-anchor': 'end', 'font-size': 12, class: 'nbc-ink' }, String(r[0])));
      const rect = el(doc, 'rect', { x: LBL, y: y + (RH - 13) / 2, width: bw, height: 13, rx: 3, class: 'nbc-fill' });
      rect.appendChild(el(doc, 'title', null, `${r[0]}: ${withUnit(r[1], spec.unit)}`));
      svg.appendChild(rect);
      svg.appendChild(el(doc, 'text', { x: LBL + bw + 8, y: y + RH / 2 + 4, 'font-size': 12, class: 'nbc-ink nbc-num' }, withUnit(r[1], spec.unit)));
    });
    return svg;
  }

  function line(doc, spec) {
    const rows = spec.data, W = 520, H = 150, P = { l: 14, r: 14, t: 18, b: 26 };
    const vals = rows.map((r) => r[1]);
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const span = (max - min) || 1;
    const x = (i) => P.l + (i / Math.max(1, rows.length - 1)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
    const svg = svgRoot(doc, W, H);
    svg.appendChild(el(doc, 'line', { x1: P.l, y1: H - P.b, x2: W - P.r, y2: H - P.b, class: 'nbc-grid' }));
    svg.appendChild(el(doc, 'polyline', {
      points: rows.map((r, i) => `${x(i)},${y(r[1])}`).join(' '),
      fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'nbc-stroke',
    }));
    const iMax = vals.indexOf(max);
    rows.forEach((r, i) => {
      const dot = el(doc, 'circle', { cx: x(i), cy: y(r[1]), r: 3.5, class: 'nbc-fill' });
      dot.appendChild(el(doc, 'title', null, `${r[0]}: ${withUnit(r[1], spec.unit)}`));
      svg.appendChild(dot);
      // rótulos seletivos: tudo se ≤6 pontos; senão primeiro/último/máximo.
      // Extremos ancoram p/ dentro — 'middle' estourava a viewBox (rótulo cortado).
      if (rows.length <= 6 || i === 0 || i === rows.length - 1 || i === iMax) {
        const anchor = i === 0 ? 'start' : (i === rows.length - 1 ? 'end' : 'middle');
        svg.appendChild(el(doc, 'text', { x: x(i), y: y(r[1]) - 8, 'text-anchor': anchor, 'font-size': 11, class: 'nbc-ink nbc-num' }, withUnit(r[1], spec.unit)));
      }
      if (i === 0 || i === rows.length - 1) {
        svg.appendChild(el(doc, 'text', { x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : 'end', 'font-size': 11, class: 'nbc-soft' }, String(r[0])));
      }
    });
    return svg;
  }

  function donut(doc, spec, box) {
    let rows = spec.data.slice().sort((a, b) => b[1] - a[1]);
    if (rows.length > 6) {   // sem 7ª cor: excedente vira "outros"
      const rest = rows.slice(5).reduce((s, r) => s + r[1], 0);
      rows = rows.slice(0, 5).concat([['outros', rest]]);
    }
    const total = rows.reduce((s, r) => s + r[1], 0);
    if (!(total > 0)) return null;
    const R = 46, CX = 62, CY = 62, C = 2 * Math.PI * R;
    const ALPHAS = [1, .72, .5, .34, .22, .13];
    const svg = svgRoot(doc, 124, 124);
    svg.style.cssText += ';width:124px;flex-shrink:0';
    let start = 0;
    const legend = doc.createElement('div');
    legend.className = 'nbchart-legend';
    rows.forEach((r, i) => {
      const frac = r[1] / total, len = Math.max(0, frac * C - 2);
      const c = el(doc, 'circle', { cx: CX, cy: CY, r: R, fill: 'none', 'stroke-width': 20,
        'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -start,
        transform: `rotate(-90 ${CX} ${CY})`, 'stroke-opacity': ALPHAS[i], class: 'nbc-stroke' });
      c.appendChild(el(doc, 'title', null, `${r[0]}: ${withUnit(r[1], spec.unit)} (${Math.round(frac * 100)}%)`));
      svg.appendChild(c);
      start += frac * C;
      const li = doc.createElement('div');
      li.innerHTML = `<i style="opacity:${ALPHAS[i]}"></i><b>${Math.round(frac * 100)}%</b>`;
      li.insertBefore(doc.createTextNode(''), li.querySelector('b'));
      const name = doc.createElement('span'); name.textContent = String(r[0]);
      li.insertBefore(name, li.querySelector('b'));
      legend.appendChild(li);
    });
    const row = doc.createElement('div');   // título fica em cima; donut+legenda lado a lado
    row.className = 'nbchart-row';
    row.append(svg, legend);
    box.appendChild(row);
    return 'appended';
  }

  function stat(doc, spec, box) {
    const grid = doc.createElement('div');
    grid.className = 'nbstat';
    spec.data.forEach((r) => {
      const t = doc.createElement('div');
      const v = doc.createElement('b'); v.textContent = withUnit(r[1], spec.unit);
      const l = doc.createElement('span'); l.textContent = String(r[0]);
      t.append(v, l);
      grid.appendChild(t);
    });
    box.appendChild(grid);
    return 'appended';
  }

  function render(doc, spec) {
    const box = doc.createElement('figure');
    box.className = 'nbchart';
    if (spec.title) {
      const cap = doc.createElement('figcaption');
      cap.textContent = spec.title;
      box.appendChild(cap);
    }
    let out = null;
    if (spec.type === 'bar') out = bar(doc, spec);
    else if (spec.type === 'line') out = line(doc, spec);
    else if (spec.type === 'donut') out = donut(doc, spec, box);
    else if (spec.type === 'stat') out = stat(doc, spec, box);
    if (!out) return null;
    if (out !== 'appended') box.appendChild(out);
    return box;
  }

  function validSpec(s) {
    return s && typeof s === 'object' && Array.isArray(s.data) && s.data.length >= 1 && s.data.length <= 24 &&
      s.data.every((r) => Array.isArray(r) && r.length >= 2 && (typeof r[1] === 'number' ? isFinite(r[1]) : s.type === 'stat')) &&
      (s.type === 'stat' || s.data.every((r) => typeof r[1] === 'number')) &&
      (s.type !== 'bar' && s.type !== 'donut' || s.data.every((r) => r[1] >= 0));
  }

  function enhance(root) {
    root.querySelectorAll('pre > code.language-chart').forEach((code) => {
      try {
        const spec = JSON.parse(code.textContent);
        if (!validSpec(spec)) return;            // fica o <pre> com o JSON — degrada
        const fig = render(code.ownerDocument, spec);
        if (fig) code.parentElement.replaceWith(fig);
      } catch {}
    });
  }

  // ── nível 3: toque no gráfico expande em overlay ──────────────────────
  // Clona a figure p/ um overlay em tela cheia (viewBox escala o SVG). Os
  // tokens --tab-* são COPIADOS computados p/ o clone: fora do .biso-root o
  // remap do caderno se perderia e o overlay sairia na paleta errada.
  const TOKENS = ['--tab-accent', '--tab-ink', '--tab-soft', '--tab-line', '--tab-card'];
  if (typeof document !== 'undefined' && !window.__nbchartWired) {
    window.__nbchartWired = true;
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const ov = t.closest('.nbchart-ov');
      if (ov) { ov.remove(); return; }            // qualquer toque fecha
      const fig = t.closest('figure.nbchart');
      if (!fig || !fig.querySelector('svg') || t.closest('a')) return;   // stat/links: sem zoom
      const wrap = document.createElement('div');
      wrap.className = 'nbchart-ov';
      const big = fig.cloneNode(true);
      const cs = getComputedStyle(fig);
      TOKENS.forEach((k) => { const v = cs.getPropertyValue(k).trim(); if (v) big.style.setProperty(k, v); });
      wrap.appendChild(big);
      document.body.appendChild(wrap);
    });
  }

  window.BISA_MD_CHARTS = { enhance };
})();
