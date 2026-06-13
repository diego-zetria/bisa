// screens/journal.js — Diário + Hábitos
// Sub-tabs: "Diário" (timeline infinita) e "Hábitos" (rotinas do dia).
// Touch-first: iPad 11" + desktop. Texto em português do Brasil.

(function () {
  'use strict';

  /* ── Injetar CSS scoped uma única vez ──────────────────────────────── */
  const STYLE_ID = 'bisa-journal-css';
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
/* ── Lightbox ── */
.bj-lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,.92);
  display: flex; align-items: center; justify-content: center;
  z-index: 9000; cursor: zoom-out;
}
.bj-lightbox img {
  max-width: 96vw; max-height: 92vh; border-radius: 6px;
  object-fit: contain; touch-action: pinch-zoom;
}
/* ── Segmented control ── */
.bj-seg {
  display: flex; gap: 0; background: var(--surface-2);
  border-radius: var(--radius-sm); padding: 3px;
  margin-bottom: 16px; align-self: flex-start;
}
.bj-seg button {
  flex: 1; border: none; background: transparent; color: var(--ink-soft);
  border-radius: calc(var(--radius-sm) - 2px); padding: 8px 22px;
  min-height: 40px; font-size: .9rem; font-weight: 600; transition: background .15s, color .15s;
}
.bj-seg button.active {
  background: var(--surface); color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,.1);
}
/* ── Capture box ── */
.bj-capture {
  display: flex; gap: 8px; align-items: flex-start; margin-bottom: 12px;
}
.bj-capture input {
  flex: 1; min-height: var(--tap);
}
/* ── Heatmap calendar strip ── */
.bj-heatmap-wrap { overflow-x: auto; margin-bottom: 16px; }
.bj-heatmap {
  display: grid; grid-template-columns: repeat(7, 18px);
  gap: 3px; width: max-content; padding: 4px 0;
}
.bj-heatmap-cell {
  width: 18px; height: 18px; border-radius: 3px;
  background: var(--surface-2); cursor: pointer;
  transition: transform .1s;
}
.bj-heatmap-cell:hover { transform: scale(1.3); }
.bj-heatmap-cell.has-1 { background: color-mix(in srgb, var(--primary) 30%, var(--surface-2)); }
.bj-heatmap-cell.has-2 { background: color-mix(in srgb, var(--primary) 60%, var(--surface-2)); }
.bj-heatmap-cell.has-3 { background: var(--primary); }
.bj-heatmap-cell.today-cell { outline: 2px solid var(--primary); }
/* ── Day card ── */
.bj-day-card { margin-bottom: 18px; }
.bj-day-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; background: var(--surface);
  border-radius: var(--radius) var(--radius) 0 0;
  border: 1px solid var(--line); border-bottom: none;
  font-weight: 600;
}
.bj-day-body {
  background: var(--surface); border: 1px solid var(--line);
  border-top: none; border-radius: 0 0 var(--radius) var(--radius);
  padding: 14px 16px;
}
.bj-log-item { display: flex; gap: 10px; margin-bottom: 6px; font-size: .93rem; }
.bj-log-time { color: var(--ink-soft); min-width: 40px; font-size: .82rem; padding-top: 2px; }
/* ── Photo grid ── */
.bj-photo-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 6px; margin: 10px 0;
}
.bj-photo-grid img {
  width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px;
  cursor: zoom-in; transition: opacity .1s;
}
.bj-photo-grid img:hover { opacity: .85; }
/* ── Neste dia ── */
.bj-neste-dia { font-size: .9rem; }
.bj-neste-dia-item { padding: 6px 0; border-bottom: 1px solid var(--line); }
.bj-neste-dia-item:last-child { border-bottom: none; }
/* ── Collapsible ── */
details.bj-detail summary {
  cursor: pointer; color: var(--ink-soft); font-size: .85rem;
  margin: 8px 0 4px; list-style: none; display: flex; align-items: center; gap: 6px;
}
details.bj-detail summary::before { content: '▶'; font-size: .7rem; transition: transform .15s; }
details.bj-detail[open] summary::before { transform: rotate(90deg); }
/* ── Hábitos ── */
.bj-habit-row {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 0; border-bottom: 1px solid var(--line);
}
.bj-habit-row:last-child { border-bottom: none; }
.bj-habit-check {
  width: 36px; height: 36px; border-radius: 50%;
  border: 2px solid var(--line); background: transparent; font-size: 1.1rem;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: background .15s, border-color .15s;
}
.bj-habit-check.done { background: var(--positive); border-color: var(--positive); color: #fff; }
.bj-habit-check.skipped { background: var(--surface-2); border-color: var(--line); opacity: .5; }
.bj-habit-info { flex: 1; min-width: 0; }
.bj-habit-name { font-weight: 600; font-size: .97rem; }
.bj-habit-meta { font-size: .78rem; color: var(--ink-soft); margin-top: 1px; }
.bj-habit-actions { display: flex; align-items: center; gap: 6px; }
.bj-mood-row { display: flex; gap: 6px; align-items: center; margin: 12px 0; }
.bj-mood-btn {
  font-size: 1.4rem; border: none; background: transparent;
  cursor: pointer; min-width: 40px; min-height: 40px; border-radius: 50%;
  transition: transform .1s;
}
.bj-mood-btn.sel { transform: scale(1.25); }
.bj-routine-heatmap {
  display: grid; grid-template-columns: repeat(30, 10px);
  gap: 2px; padding: 4px 0; overflow: hidden;
}
.bj-routine-heatmap-cell {
  width: 10px; height: 10px; border-radius: 2px;
  background: var(--surface-2);
}
.bj-routine-heatmap-cell.done { background: var(--positive); }
.bj-routine-heatmap-cell.skip { background: var(--accent-soft); }
/* ── Form novo hábito ── */
.bj-new-habit-form {
  background: var(--surface-2); border-radius: var(--radius-sm);
  padding: 14px; margin-top: 12px; display: flex; flex-direction: column; gap: 10px;
}
.bj-new-habit-form label { font-size: .85rem; color: var(--ink-soft); margin-bottom: 2px; display: block; }
.bj-new-habit-form select, .bj-new-habit-form input { min-height: var(--tap); }
/* ── Done/total badge ── */
.bj-done-badge {
  background: var(--accent-soft); color: var(--primary);
  border-radius: 999px; padding: 3px 12px; font-size: .82rem; font-weight: 600;
}
/* ── Analytics expandable ── */
.bj-analytics { font-size: .8rem; color: var(--ink-soft); padding: 6px 0; }
.bj-analytics-bars { display: flex; gap: 4px; align-items: flex-end; height: 40px; margin-top: 4px; }
.bj-analytics-bar { flex: 1; background: var(--positive); border-radius: 2px 2px 0 0; min-width: 8px; }
/* ── Sentinel ── */
.bj-sentinel { height: 48px; }
`;
    document.head.appendChild(s);
  }

  /* ── Helpers de data ──────────────────────────────────────────────── */
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const shiftDate = (iso, days) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  };
  const fmtDatePT = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  };

  /* ── Estado de módulo ─────────────────────────────────────────────── */
  let _el = null;           // container
  let _unsub = null;        // WS unsubscribe
  let _tab = 'diary';       // 'diary' | 'habits'
  let _observers = [];      // IntersectionObservers para limpeza
  let _wsDebounce = null;

  /* ── Lightbox ─────────────────────────────────────────────────────── */
  function openLightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'bj-lightbox';
    const img = document.createElement('img');
    img.src = src;
    lb.appendChild(img);
    const close = () => lb.remove();
    lb.addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
    document.body.appendChild(lb);
  }

  /* ── Render markdown com fotos substituídas ────────────────────────── */
  function renderMd(text) {
    if (!text) return '';
    // Converter ![[pkm/assets/...]] → <img>
    const replaced = text.replace(/!\[\[([^\]]+)\]\]/g, (_, rel) => {
      const src = `/file?path=${encodeURIComponent(rel)}&token=${encodeURIComponent(BISA.token)}`;
      return `<img data-bj-photo="${src}" src="${src}" style="max-width:100%;border-radius:8px;">`;
    });
    return BISA.renderMarkdown(replaced);
  }

  /* ── Montar imagens em grid após renderizar ────────────────────────── */
  function hookPhotos(container) {
    const imgs = container.querySelectorAll('[data-bj-photo]');
    if (!imgs.length) return;
    // Agrupar imagens consecutivas em grids
    imgs.forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(img.getAttribute('data-bj-photo'));
      });
    });
  }

  /* ── Extrair fotos da seção log (itens de texto com ![[...]]) ──────── */
  function extractPhotos(logItems) {
    const photos = [];
    (logItems || []).forEach(item => {
      const m = [...(item.text || '').matchAll(/!\[\[([^\]]+)\]\]/g)];
      m.forEach(([, rel]) => photos.push(rel));
    });
    return photos;
  }

  /* ═══════════════════════════════════════════════════════════════════
     HEATMAP CALENDAR STRIP (navegação por dia)
  ═══════════════════════════════════════════════════════════════════ */
  function buildHeatmapStrip(loadedDays, onDayClick) {
    // loadedDays: Map<iso, { hasContent: bool }>
    const today = todayISO();
    const WEEKS = 9;
    const DAYS = WEEKS * 7;
    // Calcular início: o domingo da semana que contém hoje - (WEEKS-1) semanas
    const todayDow = new Date(...today.split('-').map((n,i)=>i===1?n-1:n)).getDay();
    const startDate = shiftDate(today, -(todayDow + (WEEKS - 1) * 7));

    const wrap = document.createElement('div');
    wrap.className = 'bj-heatmap-wrap';
    const grid = document.createElement('div');
    grid.className = 'bj-heatmap';
    wrap.appendChild(grid);

    for (let i = 0; i < DAYS; i++) {
      const iso = shiftDate(startDate, i);
      const cell = document.createElement('div');
      cell.className = 'bj-heatmap-cell';
      cell.title = iso;
      if (iso === today) cell.classList.add('today-cell');
      const info = loadedDays.get(iso);
      if (info) {
        const level = info.logCount >= 5 ? 3 : info.logCount >= 2 ? 2 : info.hasContent ? 1 : 0;
        if (level > 0) cell.classList.add(`has-${level}`);
      }
      cell.addEventListener('click', () => onDayClick(iso));
      grid.appendChild(cell);
    }
    return wrap;
  }

  /* ═══════════════════════════════════════════════════════════════════
     "NESTE DIA" — mesmo dia em meses anteriores
  ═══════════════════════════════════════════════════════════════════ */
  async function loadNesteDia() {
    const today = todayISO();
    const [y, m, d] = today.split('-').map(Number);
    const results = [];
    for (let back = 1; back <= 12; back++) {
      let my = y, mm = m - back;
      while (mm <= 0) { mm += 12; my--; }
      const iso = `${my}-${String(mm).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      try {
        const r = await BISA.api(`/codex/day?date=${iso}`);
        const day = r.day;
        if (day && (
          (day.sections?.log?.length) ||
          (day.sections?.notes?.trim?.()) ||
          (day.sections?.goals?.length)
        )) {
          results.push({ iso, day });
          if (results.length >= 3) break;
        }
      } catch (_) { /* best-effort */ }
    }
    return results;
  }

  /* ═══════════════════════════════════════════════════════════════════
     RENDERIZAR UM DIA (card de diário)
  ═══════════════════════════════════════════════════════════════════ */
  function renderDayCard(iso, day) {
    const card = document.createElement('div');
    card.className = 'bj-day-card card';
    card.id = `bj-day-${iso}`;
    card.style.padding = '0';
    card.style.overflow = 'hidden';

    try {
      const header = document.createElement('div');
      header.className = 'bj-day-header';
      header.innerHTML = `<span style="text-transform:capitalize">${fmtDatePT(iso)}</span>`;
      if (!day) {
        header.innerHTML += `<span class="muted" style="font-size:.82rem;margin-left:auto">sem registros</span>`;
        card.appendChild(header);
        return card;
      }
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'bj-day-body';

      const sec = day.sections || {};

      // Log entries
      if (sec.log && sec.log.length) {
        const logWrap = document.createElement('div');
        logWrap.style.marginBottom = '12px';
        // Fotos no log → grid separado
        const photos = extractPhotos(sec.log);
        sec.log.forEach(item => {
          const row = document.createElement('div');
          row.className = 'bj-log-item';
          const t = document.createElement('span');
          t.className = 'bj-log-time';
          t.textContent = item.time || '';
          const txt = document.createElement('span');
          // texto sem embeds de foto (já mostrados no grid)
          const cleanText = (item.text || '').replace(/!\[\[[^\]]+\]\]/g, '').trim();
          if (cleanText) txt.textContent = cleanText;
          row.appendChild(t);
          if (cleanText) row.appendChild(txt);
          logWrap.appendChild(row);
        });
        body.appendChild(logWrap);

        if (photos.length) {
          const grid = document.createElement('div');
          grid.className = 'bj-photo-grid';
          photos.forEach(rel => {
            const src = `/file?path=${encodeURIComponent(rel)}&token=${encodeURIComponent(BISA.token)}`;
            const img = document.createElement('img');
            img.src = src;
            img.loading = 'lazy';
            img.alt = rel.split('/').pop();
            img.addEventListener('click', () => openLightbox(src));
            grid.appendChild(img);
          });
          body.appendChild(grid);
        }
      }

      // Notes
      if (sec.notes && sec.notes.trim()) {
        const notesDiv = document.createElement('div');
        notesDiv.style.marginBottom = '10px';
        notesDiv.innerHTML = renderMd(sec.notes);
        hookPhotos(notesDiv);
        body.appendChild(notesDiv);
      }

      // Briefing / reflection collapsibles (estão em day.sections)
      if (sec.briefing && sec.briefing.trim()) {
        const det = document.createElement('details');
        det.className = 'bj-detail';
        det.innerHTML = `<summary>📋 Briefing</summary><div style="font-size:.9rem;color:var(--ink-soft);padding:6px 0">${renderMd(sec.briefing)}</div>`;
        body.appendChild(det);
      }
      if (sec.reflection && sec.reflection.trim()) {
        const det = document.createElement('details');
        det.className = 'bj-detail';
        det.innerHTML = `<summary>💭 Reflexão</summary><div style="font-size:.9rem;color:var(--ink-soft);padding:6px 0">${renderMd(sec.reflection)}</div>`;
        body.appendChild(det);
      }

      if (!body.children.length) {
        body.innerHTML = '<p class="muted" style="margin:0;font-size:.9rem">Nenhum conteúdo neste dia.</p>';
      }

      card.appendChild(body);
    } catch (err) {
      card.innerHTML += `<div class="bj-day-body"><p class="muted">Erro ao renderizar: ${err.message}</p></div>`;
    }

    return card;
  }

  /* ═══════════════════════════════════════════════════════════════════
     ABA DIÁRIO
  ═══════════════════════════════════════════════════════════════════ */
  async function mountDiary(el) {
    const today = todayISO();

    // --- Capture box ---
    const captureCard = document.createElement('div');
    captureCard.className = 'card';
    captureCard.style.marginBottom = '14px';

    const captureRow = document.createElement('div');
    captureRow.className = 'bj-capture';
    const captureInput = document.createElement('input');
    captureInput.type = 'text';
    captureInput.placeholder = 'Anotar algo…';
    captureInput.style.flex = '1';
    const captureBtn = document.createElement('button');
    captureBtn.className = 'btn';
    captureBtn.textContent = 'Anotar';
    const photoBtn = document.createElement('button');
    photoBtn.className = 'btn ghost';
    photoBtn.title = 'Enviar foto';
    photoBtn.innerHTML = '📷';
    photoBtn.style.minWidth = '44px';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    captureRow.appendChild(captureInput);
    captureRow.appendChild(captureBtn);
    captureRow.appendChild(photoBtn);
    captureCard.appendChild(captureRow);
    captureCard.appendChild(fileInput);
    el.appendChild(captureCard);

    // "Neste dia" — carregar async, inserir depois do capture
    const nesteDiaCard = document.createElement('div');
    nesteDiaCard.className = 'card bj-neste-dia';
    nesteDiaCard.style.display = 'none';
    el.appendChild(nesteDiaCard);

    // Heatmap container — populado depois que dias forem carregados
    const heatmapHolder = document.createElement('div');
    el.appendChild(heatmapHolder);

    // Timeline container
    const timeline = document.createElement('div');
    el.appendChild(timeline);

    // Sentinel para infinite scroll
    const sentinel = document.createElement('div');
    sentinel.className = 'bj-sentinel';
    el.appendChild(sentinel);

    /* ── Estado do timeline ── */
    const loadedDates = new Set();
    const loadedDayMap = new Map(); // iso → { hasContent, logCount }
    let currentDate = today;
    let emptyStreak = 0;
    let loading = false;
    let exhausted = false;
    let todayCardEl = null;

    /* ── Append ou scroll a um dia ── */
    async function appendDay(iso, prepend = false) {
      if (loadedDates.has(iso)) {
        // scroll até ele
        const existing = document.getElementById(`bj-day-${iso}`);
        if (existing) existing.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      loadedDates.add(iso);
      let day = null;
      try {
        const r = iso === today
          ? await BISA.api('/codex/today')
          : await BISA.api(`/codex/day?date=${iso}`);
        day = r.day || null;
      } catch (_) { /* mostrar card vazio */ }

      const hasContent = !!(day && (
        (day.sections?.log?.length) ||
        (day.sections?.notes?.trim?.()) ||
        (day.sections?.goals?.length)
      ));
      const logCount = day?.sections?.log?.length || 0;
      loadedDayMap.set(iso, { hasContent, logCount });
      if (!hasContent) emptyStreak++;
      else emptyStreak = 0;

      const card = renderDayCard(iso, day);
      if (prepend) timeline.prepend(card);
      else timeline.appendChild(card);
      if (iso === today) todayCardEl = card;
    }

    /* ── Carregar próximo bloco de dias ── */
    async function loadMore() {
      if (loading || exhausted) return;
      loading = true;
      const batchSize = 5;
      for (let i = 0; i < batchSize; i++) {
        if (emptyStreak >= 14) { exhausted = true; break; }
        await appendDay(currentDate);
        currentDate = shiftDate(currentDate, -1);
      }
      // Atualizar heatmap com novos dados
      renderHeatmap();
      loading = false;
    }

    /* ── Renderizar heatmap ── */
    function renderHeatmap() {
      heatmapHolder.innerHTML = '';
      const strip = buildHeatmapStrip(loadedDayMap, async (iso) => {
        if (!loadedDates.has(iso)) {
          await appendDay(iso);
        }
        const card = document.getElementById(`bj-day-${iso}`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      heatmapHolder.appendChild(strip);
    }

    /* ── IntersectionObserver ── */
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { threshold: 0.1 });
    obs.observe(sentinel);
    _observers.push(obs);

    /* ── Primeira carga ── */
    await loadMore();

    /* ── Neste dia (async) ── */
    loadNesteDia().then(results => {
      if (!results.length) return;
      nesteDiaCard.style.display = '';
      nesteDiaCard.innerHTML = `<div class="row" style="margin-bottom:8px"><span style="font-size:1rem">🕰️</span><strong>Neste dia…</strong></div>`;
      results.forEach(({ iso, day }) => {
        const item = document.createElement('div');
        item.className = 'bj-neste-dia-item';
        const firstLog = day.sections?.log?.[0];
        const preview = firstLog?.text || day.sections?.notes?.split('\n')[0] || '';
        item.innerHTML = `<span class="muted" style="font-size:.82rem">${fmtDatePT(iso)}</span>
          <p style="margin:2px 0;font-size:.9rem">${preview.slice(0, 120)}${preview.length > 120 ? '…' : ''}</p>`;
        item.style.cursor = 'pointer';
        item.addEventListener('click', async () => {
          if (!loadedDates.has(iso)) await appendDay(iso);
          const card = document.getElementById(`bj-day-${iso}`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        nesteDiaCard.appendChild(item);
      });
    }).catch(() => {});

    /* ── Capture: anotar ── */
    async function submitCapture() {
      const text = captureInput.value.trim();
      if (!text) return;
      captureInput.disabled = true;
      captureBtn.disabled = true;
      try {
        await BISA.api('/codex/append', { method: 'POST', json: { section: 'log', item: { text } } });
        captureInput.value = '';
        BISA.toast('Anotado ✓');
        // Recarregar o card de hoje
        loadedDates.delete(today);
        const old = document.getElementById(`bj-day-${today}`);
        if (old) old.remove();
        emptyStreak = 0;
        await appendDay(today, true);
      } catch (err) {
        BISA.toast('Erro: ' + err.message);
      } finally {
        captureInput.disabled = false;
        captureBtn.disabled = false;
        captureInput.focus();
      }
    }
    captureBtn.addEventListener('click', submitCapture);
    captureInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitCapture(); });

    /* ── Capture: foto ── */
    photoBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      photoBtn.disabled = true;
      try {
        const buf = await file.arrayBuffer();
        const name = encodeURIComponent(file.name);
        await BISA.apiRaw(
          `/pkm/inbox?kind=photo&name=${name}&date=${today}`,
          buf, file.type
        );
        BISA.toast('Foto enviada ✓');
        // Recarregar card de hoje
        loadedDates.delete(today);
        const old = document.getElementById(`bj-day-${today}`);
        if (old) old.remove();
        emptyStreak = 0;
        await appendDay(today, true);
      } catch (err) {
        BISA.toast('Erro ao enviar: ' + err.message);
      } finally {
        photoBtn.disabled = false;
        fileInput.value = '';
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     ABA HÁBITOS
  ═══════════════════════════════════════════════════════════════════ */
  async function mountHabits(el) {
    const today = todayISO();

    // Mood selector
    const moodCard = document.createElement('div');
    moodCard.className = 'card';
    moodCard.innerHTML = `<div class="section-title" style="margin-top:0">Humor de hoje</div>
      <div class="bj-mood-row" id="bj-mood-row"></div>`;
    el.appendChild(moodCard);

    const MOODS = ['😞','😕','😐','🙂','😄'];
    let currentMood = null;
    const moodRow = moodCard.querySelector('#bj-mood-row');
    MOODS.forEach((emoji, i) => {
      const btn = document.createElement('button');
      btn.className = 'bj-mood-btn';
      btn.textContent = emoji;
      btn.title = `${i + 1}`;
      btn.addEventListener('click', async () => {
        try {
          await BISA.api('/codex/routines/mood', { method: 'POST', json: { date: today, mood: i + 1 } });
          currentMood = i + 1;
          moodRow.querySelectorAll('.bj-mood-btn').forEach((b, j) => {
            b.classList.toggle('sel', j === i);
          });
        } catch (err) { BISA.toast('Erro: ' + err.message); }
      });
      moodRow.appendChild(btn);
    });

    // Hábitos do dia
    const habitsCard = document.createElement('div');
    habitsCard.className = 'card';
    el.appendChild(habitsCard);

    // Heatmap global de hábitos
    let heatmapData = null;
    try {
      heatmapData = await BISA.api('/codex/routines/heatmap?days=120');
    } catch (_) {}

    async function loadHabits() {
      habitsCard.innerHTML = '<p class="muted">Carregando…</p>';
      try {
        const data = await BISA.api(`/codex/routines/day?date=${today}`);
        if (data.mood) {
          currentMood = data.mood;
          moodRow.querySelectorAll('.bj-mood-btn').forEach((b, j) => {
            b.classList.toggle('sel', j + 1 === data.mood);
          });
        }
        renderHabits(habitsCard, data, heatmapData, today);
      } catch (err) {
        habitsCard.innerHTML = `<p class="muted">Erro ao carregar hábitos: ${err.message}</p>`;
      }
    }

    await loadHabits();

    // Botão novo hábito
    const newBtn = document.createElement('button');
    newBtn.className = 'btn ghost block';
    newBtn.textContent = '+ Novo hábito';
    newBtn.style.marginTop = '8px';
    el.appendChild(newBtn);

    const formHolder = document.createElement('div');
    el.appendChild(formHolder);
    let formOpen = false;

    newBtn.addEventListener('click', () => {
      if (formOpen) { formHolder.innerHTML = ''; formOpen = false; newBtn.textContent = '+ Novo hábito'; return; }
      formOpen = true;
      newBtn.textContent = '✕ Cancelar';
      renderNewHabitForm(formHolder, async () => {
        formHolder.innerHTML = '';
        formOpen = false;
        newBtn.textContent = '+ Novo hábito';
        await loadHabits();
      });
    });

    function renderHabits(container, data, heatmapData, date) {
      container.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'row';
      header.innerHTML = `<strong style="font-size:1.1rem">Hábitos</strong>
        <span class="spacer"></span>
        <span class="bj-done-badge">${data.done}/${data.total}</span>`;
      container.appendChild(header);

      if (!data.items || !data.items.length) {
        container.innerHTML += '<p class="muted" style="margin-top:12px">Nenhum hábito para hoje. Crie o primeiro! 🌱</p>';
        return;
      }

      data.items.forEach(habit => {
        const row = document.createElement('div');
        row.className = 'bj-habit-row';

        const check = document.createElement('button');
        check.className = 'bj-habit-check' + (habit.done ? ' done' : '') + (habit.skipped ? ' skipped' : '');
        check.textContent = habit.icon || (habit.done ? '✓' : '');
        check.title = habit.done ? 'Marcar como pendente' : 'Concluir';

        const info = document.createElement('div');
        info.className = 'bj-habit-info';
        const streakText = habit.streak ? ` · 🔥 ${habit.streak}d` : '';
        const catText = habit.category !== 'other' ? ` · ${habit.category}` : '';
        info.innerHTML = `<div class="bj-habit-name">${habit.icon ? habit.icon + ' ' : ''}${habit.name}</div>
          <div class="bj-habit-meta">${catText}${streakText}${habit.time ? ' · ' + habit.time : ''}</div>`;

        // Mini heatmap do hábito — usa heatmapData.habits[].cells (últimos 30 dias)
        if (heatmapData && heatmapData.habits) {
          const habitHeat = heatmapData.habits.find(h => h.id === habit.id);
          if (habitHeat && habitHeat.cells && habitHeat.cells.length) {
            const miniHeat = document.createElement('div');
            miniHeat.className = 'bj-routine-heatmap';
            // Pegar os últimos 30 dias (células ao final do array)
            const last30 = habitHeat.cells.slice(-30);
            last30.forEach(c => {
              const cell = document.createElement('div');
              cell.className = 'bj-routine-heatmap-cell';
              if (c.skipped) cell.classList.add('skip');
              else if (c.done) cell.classList.add('done');
              miniHeat.appendChild(cell);
            });
            info.appendChild(miniHeat);
          }
        }

        const actions = document.createElement('div');
        actions.className = 'bj-habit-actions';

        const skipBtn = document.createElement('button');
        skipBtn.className = 'btn ghost';
        skipBtn.style.cssText = 'font-size:.78rem;padding:0 10px;min-height:36px;';
        skipBtn.textContent = habit.skipped ? 'Retomar' : 'Pular';
        skipBtn.title = habit.skipped ? 'Remover pulo' : 'Pular hoje';

        // Analytics expandable
        const analyticsToggle = document.createElement('button');
        analyticsToggle.className = 'btn ghost';
        analyticsToggle.style.cssText = 'font-size:.78rem;padding:0 8px;min-height:36px;';
        analyticsToggle.textContent = '📊';
        analyticsToggle.title = 'Ver consistência';

        actions.appendChild(skipBtn);
        actions.appendChild(analyticsToggle);

        row.appendChild(check);
        row.appendChild(info);
        row.appendChild(actions);
        container.appendChild(row);

        // Analytics area
        const analyticsArea = document.createElement('div');
        analyticsArea.className = 'bj-analytics';
        analyticsArea.style.display = 'none';
        analyticsArea.style.paddingLeft = '46px';
        container.appendChild(analyticsArea);

        // Toggle check
        check.addEventListener('click', async () => {
          check.disabled = true;
          try {
            await BISA.api('/codex/routines/toggle', { method: 'POST', json: { id: habit.id, date } });
            await loadHabits();
          } catch (err) { BISA.toast('Erro: ' + err.message); }
          finally { check.disabled = false; }
        });

        // Skip
        skipBtn.addEventListener('click', async () => {
          skipBtn.disabled = true;
          try {
            await BISA.api('/codex/routines/skip', { method: 'POST', json: { id: habit.id, date, skipped: !habit.skipped } });
            await loadHabits();
          } catch (err) { BISA.toast('Erro: ' + err.message); }
          finally { skipBtn.disabled = false; }
        });

        // Analytics
        let analyticsLoaded = false;
        analyticsToggle.addEventListener('click', async () => {
          const open = analyticsArea.style.display !== 'none';
          analyticsArea.style.display = open ? 'none' : 'block';
          if (!open && !analyticsLoaded) {
            analyticsLoaded = true;
            analyticsArea.textContent = 'Carregando…';
            try {
              const stats = await BISA.api(`/codex/routines/analytics?id=${habit.id}&days=90`);
              renderAnalytics(analyticsArea, stats);
            } catch (err) {
              analyticsArea.textContent = `Sem dados suficientes.`;
            }
          }
        });
      });
    }

    function renderAnalytics(container, stats) {
      // API retorna: { id, name, days, byDow: [{dow, due, rate}] }
      // rate é null quando não há dados suficientes
      if (!stats || !stats.byDow) { container.textContent = 'Sem dados.'; return; }
      const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      container.innerHTML = `<div style="font-size:.8rem;color:var(--ink-soft);margin-bottom:4px">Consistência por dia da semana (${stats.days} dias):</div>`;
      const bars = document.createElement('div');
      bars.className = 'bj-analytics-bars';
      const labels = document.createElement('div');
      labels.style.cssText = 'display:flex;gap:4px;font-size:.7rem;color:var(--ink-soft);';
      stats.byDow.forEach((wd) => {
        const pct = wd.rate != null ? Math.round(wd.rate * 100) : 0;
        const bar = document.createElement('div');
        bar.className = 'bj-analytics-bar';
        bar.style.height = `${Math.max(2, pct * 0.4)}px`;
        bar.style.flex = '1';
        bar.title = `${DIAS[wd.dow]}: ${wd.rate != null ? pct + '%' : 'sem dados'}`;
        if (wd.rate == null) bar.style.opacity = '0.3';
        bars.appendChild(bar);
        const lbl = document.createElement('div');
        lbl.style.flex = '1';
        lbl.style.textAlign = 'center';
        lbl.textContent = DIAS[wd.dow]?.slice(0, 3) || '';
        labels.appendChild(lbl);
      });
      container.appendChild(bars);
      container.appendChild(labels);
    }

    function renderNewHabitForm(container, onDone) {
      const form = document.createElement('div');
      form.className = 'bj-new-habit-form';

      const CATS = ['health','fitness','learning','work','mind','chores','social','other'];
      const CAT_PT = { health:'Saúde', fitness:'Fitness', learning:'Aprendizado', work:'Trabalho', mind:'Mente', chores:'Afazeres', social:'Social', other:'Outro' };
      const SCHED_PT = { daily:'Diário', specific_days:'Dias específicos', times_per_week:'N× por semana' };

      form.innerHTML = `
        <div>
          <label>Nome</label>
          <input id="bj-nh-name" type="text" placeholder="Ex: Meditar 10 min" maxlength="120">
        </div>
        <div class="row" style="gap:10px">
          <div style="flex:1">
            <label>Ícone (emoji)</label>
            <input id="bj-nh-icon" type="text" placeholder="🧘" maxlength="4" style="text-align:center">
          </div>
          <div style="flex:2">
            <label>Categoria</label>
            <select id="bj-nh-cat">
              ${CATS.map(c => `<option value="${c}">${CAT_PT[c]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label>Frequência</label>
          <select id="bj-nh-sched">
            <option value="daily">Diário</option>
            <option value="specific_days">Dias específicos</option>
            <option value="times_per_week">N× por semana</option>
          </select>
        </div>
        <div id="bj-nh-sched-extra" style="display:none"></div>
        <div>
          <label>Horário (opcional)</label>
          <input id="bj-nh-time" type="time" placeholder="07:00">
        </div>
        <button class="btn block" id="bj-nh-save">Salvar hábito</button>
      `;
      container.appendChild(form);

      const schedSel = form.querySelector('#bj-nh-sched');
      const schedExtra = form.querySelector('#bj-nh-sched-extra');
      const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

      schedSel.addEventListener('change', () => {
        const v = schedSel.value;
        if (v === 'specific_days') {
          schedExtra.style.display = '';
          schedExtra.innerHTML = `<label>Dias da semana</label>
            <div class="row" style="flex-wrap:wrap;gap:6px">
              ${DAYS_PT.map((d, i) => `<label style="display:flex;align-items:center;gap:4px;font-size:.9rem">
                <input type="checkbox" value="${i}" ${i > 0 && i < 6 ? 'checked' : ''}> ${d}
              </label>`).join('')}
            </div>`;
        } else if (v === 'times_per_week') {
          schedExtra.style.display = '';
          schedExtra.innerHTML = `<label>Quantas vezes por semana</label>
            <input id="bj-nh-tpw" type="number" min="1" max="7" value="3" style="width:80px">`;
        } else {
          schedExtra.style.display = 'none';
          schedExtra.innerHTML = '';
        }
      });

      form.querySelector('#bj-nh-save').addEventListener('click', async () => {
        const name = form.querySelector('#bj-nh-name').value.trim();
        if (!name) { BISA.toast('Nome é obrigatório'); return; }
        const icon = form.querySelector('#bj-nh-icon').value.trim();
        const category = form.querySelector('#bj-nh-cat').value;
        const time = form.querySelector('#bj-nh-time').value || '';
        const schedType = schedSel.value;
        let schedule = { type: schedType };
        if (schedType === 'specific_days') {
          const days = [...form.querySelectorAll('#bj-nh-sched-extra input[type=checkbox]:checked')].map(c => Number(c.value));
          schedule.days = days.length ? days : [1,2,3,4,5];
        } else if (schedType === 'times_per_week') {
          schedule.target = parseInt(form.querySelector('#bj-nh-tpw')?.value, 10) || 3;
        }
        const saveBtn = form.querySelector('#bj-nh-save');
        saveBtn.disabled = true;
        try {
          await BISA.api('/codex/routines', { method: 'POST', json: { name, icon, category, schedule, time } });
          BISA.toast('Hábito criado ✓');
          onDone();
        } catch (err) {
          BISA.toast('Erro: ' + err.message);
          saveBtn.disabled = false;
        }
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     SCREEN REGISTRATION
  ═══════════════════════════════════════════════════════════════════ */
  window.BISA.screens['journal'] = {
    mount(el) {
      _el = el;
      el.innerHTML = '';

      // Segmented control
      const seg = document.createElement('div');
      seg.className = 'bj-seg';
      const btnDiary = document.createElement('button');
      btnDiary.textContent = 'Diário';
      btnDiary.className = 'active';
      const btnHabits = document.createElement('button');
      btnHabits.textContent = 'Hábitos';
      seg.appendChild(btnDiary);
      seg.appendChild(btnHabits);
      el.appendChild(seg);

      // Content area
      const content = document.createElement('div');
      el.appendChild(content);

      const switchTab = (tab) => {
        _tab = tab;
        content.innerHTML = '';
        btnDiary.classList.toggle('active', tab === 'diary');
        btnHabits.classList.toggle('active', tab === 'habits');
        if (tab === 'diary') mountDiary(content);
        else mountHabits(content);
      };

      btnDiary.addEventListener('click', () => switchTab('diary'));
      btnHabits.addEventListener('click', () => switchTab('habits'));

      // WS: fs events → refresh hoje (debounced)
      _unsub = BISA.onWs((msg) => {
        if (msg.type === 'fs' && _tab === 'diary') {
          clearTimeout(_wsDebounce);
          _wsDebounce = setTimeout(() => {
            const today = todayISO();
            const card = document.getElementById(`bj-day-${today}`);
            if (card) {
              // reload today silently
              BISA.api('/codex/today').then(r => {
                const newCard = renderDayCard(today, r.day || null);
                card.replaceWith(newCard);
              }).catch(() => {});
            }
          }, 800);
        }
      });

      // Montar aba inicial
      switchTab('diary');
    },

    unmount() {
      _observers.forEach(o => o.disconnect());
      _observers = [];
      if (_unsub) { _unsub(); _unsub = null; }
      clearTimeout(_wsDebounce);
      _el = null;
    },
  };
})();
