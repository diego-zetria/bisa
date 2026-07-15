// md-tables.js — realce "nível 1" das tabelas do markdown (respostas do agente).
// Determinístico, sem LLM: detecta colunas numéricas e adiciona alinhamento à
// direita, barras proporcionais atrás do número (estilo data-bar do Excel,
// ancoradas à esquerda), destaque do máximo e cor semântica de sinal
// (negativo/positivo explícito). Cores via tokens do tema (--tab-* com
// fallback p/ --primary/--negative/--positive) — cada tema pinta as suas.
// Usado por BISA.renderMarkdown (app.js); biso.css remapeia os tokens no caderno.
(function () {
  // escalar: "R$ 1.234,56" · "−12,5%" · "230 °C" · "45 min" · "1,5x"
  function parseNum(raw) {
    let t = String(raw || '').trim();
    if (!t || t.length > 24) return null;
    const explicitPos = /^\+/.test(t);
    let neg = false;
    if (/^[-−–]/.test(t)) { neg = true; t = t.slice(1).trim(); }
    else if (explicitPos) t = t.slice(1).trim();
    t = t.replace(/^(R\$|US\$|\$|€|£)\s*/i, '');
    const m = /^(\d[\d.,]*)\s*(%|°\s*[CF]|km|kg|g|ml|l|min|h|s|x|bpm|kcal)?$/i.exec(t);
    if (!m) return null;
    const v = toFloat(m[1]);
    if (!isFinite(v)) return null;
    return { v: neg ? -v : v, neg, explicitPos };
  }
  // pt-BR (1.234,56) e en (1,234.56); "1.234" sozinho é milhar, "3.14" é decimal
  function toFloat(s) {
    const d = s.lastIndexOf('.'), c = s.lastIndexOf(',');
    if (d >= 0 && c >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) s = (s.split(',').length === 2 && s.length - c - 1 <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
    else if (d >= 0 && (s.split('.').length > 2 || s.length - d - 1 === 3)) s = s.replace(/\./g, '');
    return parseFloat(s);
  }
  // "numérico-ish": faixas tipo "52-54 °C", "2-3 min" — alinha, mas sem barra
  const ISH = /^[+−-]?\d[\d.,]*\s*[-–—]\s*\d[\d.,]*.{0,8}$/;

  function wrapVal(cell, doc) {
    let w = cell.querySelector(':scope > .nbtab-val');
    if (!w) {
      w = doc.createElement('span'); w.className = 'nbtab-val';
      while (cell.firstChild) w.appendChild(cell.firstChild);
      cell.appendChild(w);
    }
    return w;
  }

  function upgrade(table) {
    const doc = table.ownerDocument, body = table.tBodies[0];
    const rows = Array.from(body.rows);
    if (rows.length < 2) return;
    table.classList.add('nbtab');
    if (table.tHead && table.tHead.rows[0]) {
      Array.from(table.tHead.rows[0].cells).forEach((h) => h.classList.add('nbtab-sort'));
    }
    const nCols = Math.max.apply(null, rows.map((r) => r.cells.length));
    for (let c = 0; c < nCols; c++) {
      const infos = rows.map((r) => r.cells[c]).filter(Boolean)
        .map((cell) => ({ cell, txt: cell.textContent.trim() }));
      const nonEmpty = infos.filter((i) => i.txt);
      if (nonEmpty.length < 2) continue;
      nonEmpty.forEach((i) => { i.num = parseNum(i.txt); i.ish = !i.num && ISH.test(i.txt); });
      const scal = nonEmpty.filter((i) => i.num);
      if ((scal.length + nonEmpty.filter((i) => i.ish).length) / nonEmpty.length < 0.8) continue;

      infos.forEach((i) => i.cell.classList.add('nbtab-num'));
      const th = table.tHead && table.tHead.rows[0] && table.tHead.rows[0].cells[c];
      if (th) th.classList.add('nbtab-num');

      scal.forEach((i) => {
        i.cell.dataset.nbv = i.num.v;   // valor cru p/ ordenação por toque
        if (i.num.neg) wrapVal(i.cell, doc).classList.add('nbtab-neg');
        else if (i.num.explicitPos) wrapVal(i.cell, doc).classList.add('nbtab-pos');
      });

      // barras: coluna 100% escalar, sem negativo, com variação, e não-ano
      if (scal.length !== nonEmpty.length) continue;
      const vals = scal.map((i) => i.num.v);
      const max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
      if (min < 0 || max <= 0 || max === min) continue;
      if (vals.every((v) => Number.isInteger(v) && v >= 1900 && v <= 2100)) continue;
      scal.forEach((i) => {
        const w = wrapVal(i.cell, doc);   // antes da barra: garante o texto acima
        const bar = doc.createElement('span');
        bar.className = 'nbtab-bar';
        bar.style.width = Math.max(3, Math.round((i.num.v / max) * 94)) + '%';
        i.cell.insertBefore(bar, w);
        if (i.num.v === max) i.cell.classList.add('nbtab-max');
      });
    }
  }

  function enhance(root) {
    root.querySelectorAll('table').forEach((t) => {
      try { if (t.tHead && t.tBodies.length) upgrade(t); } catch {}
    });
  }

  // ── nível 3: toque no cabeçalho ordena ────────────────────────────────
  // Delegação no document: o HTML entra por innerHTML (handlers não viajam).
  // Numérico começa DESC (maior primeiro — o que se quer comparar); texto ASC.
  function sortBy(table, idx, th) {
    const body = table.tBodies[0]; if (!body) return;
    const rows = Array.from(body.rows);
    const numeric = rows.some((r) => r.cells[idx] && r.cells[idx].dataset.nbv !== undefined);
    const cur = th.getAttribute('aria-sort');
    const next = cur ? (cur === 'ascending' ? 'descending' : 'ascending') : (numeric ? 'descending' : 'ascending');
    rows.sort((a, b) => {
      const ca = a.cells[idx], cb = b.cells[idx];
      if (numeric) {
        const va = ca && ca.dataset.nbv !== undefined ? parseFloat(ca.dataset.nbv) : -Infinity;
        const vb = cb && cb.dataset.nbv !== undefined ? parseFloat(cb.dataset.nbv) : -Infinity;
        return va - vb;
      }
      return (ca ? ca.textContent.trim() : '').localeCompare(cb ? cb.textContent.trim() : '', 'pt', { sensitivity: 'base' });
    });
    if (next === 'descending') rows.reverse();
    rows.forEach((r) => body.appendChild(r));   // zebra (nth-child) recalcula sozinha
    if (table.tHead && table.tHead.rows[0]) {
      Array.from(table.tHead.rows[0].cells).forEach((h) => h.removeAttribute('aria-sort'));
    }
    th.setAttribute('aria-sort', next);
  }
  if (typeof document !== 'undefined' && !window.__nbtabSortWired) {
    window.__nbtabSortWired = true;
    document.addEventListener('click', (e) => {
      const th = e.target && e.target.closest ? e.target.closest('table.nbtab thead th') : null;
      if (!th) return;
      const table = th.closest('table.nbtab');
      if (table) sortBy(table, th.cellIndex, th);
    });
  }

  window.BISA_MD_TABLES = { enhance };
})();
