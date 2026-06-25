// screens/hub.js — Hub / Hoje (tela principal do bisa)
// Touch-first, iPad 11" + desktop. Texto em pt-BR.
(function () {
  'use strict';

  /* ─── helpers locais ─── */

  function qs(el, sel) { return el.querySelector(sel); }

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.assign(e, attrs);
    return e;
  }

  function fmt(date) {
    // "sexta, 13 de junho"
    return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function safeRender(container, fn) {
    // runs fn; on error inserts a gentle error notice inside container
    try { fn(); } catch (err) {
      container.innerHTML = '<p class="muted" style="padding:8px 0;font-size:.88rem;">⚠ não foi possível carregar</p>';
      console.error('[hub]', err);
    }
  }

  /* ─── state ─── */
  let _sortables = [];
  let _unsubs = [];
  let _dayData = null;      // última resposta de /planner/day
  let _routines = [];       // última resposta de /codex/routines/day
  let _root = null;         // el passado em mount()

  /* ─── seções do DOM ─── */
  let _tasksLists = {};     // { morning, afternoon, unplanned } → <ul>
  let _highlightSlot = null;
  let _habitsContainer = null;
  let _agendaContainer = null;
  let _goalsContainer = null;
  let _eodCard = null;

  /* ══════════════════════════════════════════════════
     RENDER COMPLETO (rebuild on refresh)
  ══════════════════════════════════════════════════ */

  function buildTaskRow(task, onRefresh) {
    const row = el('li', null);
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px solid var(--line);list-style:none;';

    // checkbox
    const chk = el('button', 'btn ghost');
    chk.style.cssText = `min-height:36px;min-width:36px;padding:0;font-size:1.1rem;flex-shrink:0;border-radius:50%;${task.done ? 'background:var(--positive);color:#fff;' : ''}`;
    chk.title = task.done ? 'Marcar como pendente' : 'Marcar como feito';
    chk.textContent = task.done ? '✓' : '○';
    chk.addEventListener('click', async () => {
      try {
        await BISA.api(`/planner/task/${task.id}`, { method: 'PATCH', json: { done: !task.done } });
        onRefresh();
      } catch (e) { BISA.toast('Erro ao atualizar tarefa'); }
    });

    // text
    const txt = el('span');
    txt.style.cssText = `flex:1;font-size:.97rem;${task.done ? 'text-decoration:line-through;color:var(--ink-soft);' : ''}`;
    txt.textContent = task.text;

    // tags
    if (task.tags && task.tags.length) {
      task.tags.forEach(t => {
        const p = el('span', 'pill');
        p.textContent = t;
        p.style.flexShrink = '0';
        txt.appendChild(document.createTextNode(' '));
        txt.appendChild(p);
      });
    }

    // star (highlight toggle)
    const star = el('button', 'btn ghost');
    star.style.cssText = 'min-height:36px;min-width:36px;padding:0;font-size:1rem;flex-shrink:0;border-radius:50%;';
    star.title = task.highlight ? 'Remover destaque' : 'Definir como destaque';
    star.textContent = task.highlight ? '⭐' : '☆';
    star.addEventListener('click', async () => {
      try {
        await BISA.api('/planner/promote', { method: 'POST', json: { id: task.id, scope: 'highlight', on: !task.highlight } });
        onRefresh();
      } catch (e) { BISA.toast('Erro ao definir destaque'); }
    });

    // delete
    const del = el('button', 'btn ghost');
    del.style.cssText = 'min-height:36px;min-width:36px;padding:0;font-size:.9rem;flex-shrink:0;border-radius:50%;color:var(--negative);';
    del.title = 'Excluir tarefa';
    del.textContent = '✕';
    del.addEventListener('click', async () => {
      if (!confirm(`Excluir "${task.text}"?`)) return;
      try {
        await BISA.api(`/planner/task/${task.id}`, { method: 'DELETE' });
        onRefresh();
      } catch (e) { BISA.toast('Erro ao excluir tarefa'); }
    });

    row.append(chk, txt, star, del);
    return row;
  }

  function buildTaskList(tasks, onRefresh) {
    const ul = el('ul');
    ul.style.cssText = 'margin:0;padding:0;min-height:44px;';
    if (!tasks || !tasks.length) {
      const empty = el('li', 'muted');
      empty.style.cssText = 'list-style:none;padding:12px 2px;font-size:.88rem;';
      empty.textContent = 'Nenhuma tarefa';
      ul.appendChild(empty);
    } else {
      tasks.forEach(t => ul.appendChild(buildTaskRow(t, onRefresh)));
    }
    return ul;
  }

  /* ── Briefing ── */
  async function renderBriefing(card) {
    const inner = qs(card, '.briefing-body');
    try {
      const data = await BISA.api('/codex/today');
      const briefing = data?.day?.sections?.briefing;
      if (briefing && briefing.trim()) {
        inner.innerHTML = BISA.renderMarkdown(briefing);
      } else {
        inner.innerHTML = '<p class="muted" style="margin:0;">Seu briefing aparece aqui de manhã.</p>';
      }
    } catch {
      inner.innerHTML = '<p class="muted" style="margin:0;font-size:.88rem;">⚠ não foi possível carregar o briefing</p>';
    }
  }

  /* ── Agenda ── */
  function renderAgenda(container, events, icsConnected) {
    container.innerHTML = '';
    if (!icsConnected) {
      const note = el('p', 'muted');
      note.style.cssText = 'font-size:.82rem;margin:2px 0 8px;';
      note.textContent = 'Calendário não conectado';
      container.appendChild(note);
    }
    if (!events || !events.length) {
      const empty = el('p', 'muted');
      empty.style.cssText = 'font-size:.88rem;margin:0;';
      empty.textContent = 'Sem eventos hoje';
      container.appendChild(empty);
      return;
    }
    events.forEach(ev => {
      const row = el('div', 'row');
      row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--line);gap:8px;align-items:flex-start;';
      const icon = el('span');
      icon.textContent = '🗓️';
      icon.style.flexShrink = '0';
      const info = el('div');
      info.style.flex = '1';
      const timeStr = ev.allDay
        ? 'dia todo'
        : `${fmtTime(ev.start)}${ev.end ? ' – ' + fmtTime(ev.end) : ''}`;
      const time = el('span', 'muted');
      time.style.cssText = 'display:block;font-size:.8rem;';
      time.textContent = timeStr;
      const title = el('span');
      title.style.cssText = 'display:block;font-size:.95rem;';
      title.textContent = ev.title || '(sem título)';
      info.append(time, title);
      row.append(icon, info);
      container.appendChild(row);
    });
  }

  /* ── Destaque ── */
  function renderHighlight(container, dayData, onRefresh) {
    container.innerHTML = '';
    if (!dayData) return;
    const hlId = dayData.highlight;
    let hlTask = null;
    if (hlId) {
      const all = [...(dayData.blocks?.morning || []), ...(dayData.blocks?.afternoon || []), ...(dayData.unplanned || [])];
      hlTask = all.find(t => t.id === hlId);
    }
    if (hlTask) {
      const wrap = el('div', 'row');
      wrap.style.cssText = 'gap:12px;align-items:center;';
      const star = el('span');
      star.style.cssText = 'font-size:1.6rem;flex-shrink:0;';
      star.textContent = '⭐';
      const txt = el('span');
      txt.style.cssText = `font-size:1.1rem;font-weight:600;flex:1;${hlTask.done ? 'text-decoration:line-through;color:var(--ink-soft);' : ''}`;
      txt.textContent = hlTask.text;
      const unset = el('button', 'btn ghost');
      unset.style.cssText = 'font-size:.8rem;padding:0 10px;min-height:32px;';
      unset.textContent = 'Remover';
      unset.addEventListener('click', async () => {
        try {
          await BISA.api('/planner/promote', { method: 'POST', json: { id: hlTask.id, scope: 'highlight', on: false } });
          onRefresh();
        } catch { BISA.toast('Erro'); }
      });
      wrap.append(star, txt, unset);
      container.appendChild(wrap);
    } else {
      const muted = el('p', 'muted');
      muted.style.cssText = 'margin:0;font-size:.92rem;';
      muted.textContent = 'Escolha seu destaque do dia — toque na ☆ em qualquer tarefa';
      container.appendChild(muted);
    }
  }

  /* ── Blocos de tarefas (Manhã / Tarde / Sem horário) ── */
  function destroySortables() {
    _sortables.forEach(s => { try { s.destroy(); } catch {} });
    _sortables = [];
  }

  /* stamp data-task-id on li elements — must be done after buildTaskRow */
  function buildDraggableTaskRow(task, onRefresh) {
    const li = buildTaskRow(task, onRefresh);
    li.dataset.taskId = task.id;
    return li;
  }

  function renderBlocosV2(morningUl, afternoonUl, unplannedUl, dayData, onRefresh) {
    destroySortables();
    morningUl.innerHTML = '';
    afternoonUl.innerHTML = '';
    unplannedUl.innerHTML = '';

    const fill = (ul, tasks) => {
      if (!tasks || !tasks.length) {
        const li = el('li', 'muted');
        li.style.cssText = 'list-style:none;padding:12px 2px;font-size:.88rem;';
        li.textContent = 'Nenhuma tarefa';
        ul.appendChild(li);
      } else {
        tasks.forEach(t => ul.appendChild(buildDraggableTaskRow(t, onRefresh)));
      }
    };

    fill(morningUl, dayData?.blocks?.morning);
    fill(afternoonUl, dayData?.blocks?.afternoon);
    fill(unplannedUl, dayData?.unplanned);

    if (window.Sortable) {
      const makeOpts = () => ({
        group: 'plan',
        animation: 150,
        delayOnTouchOnly: true,
        delay: 180,
        ghostClass: 'drag-ghost',
        chosenClass: 'drag-chosen',
        onEnd(evt) {
          const id = evt.item.dataset.taskId;
          if (!id) return;
          let block = null;
          if (evt.to === morningUl) block = 'morning';
          else if (evt.to === afternoonUl) block = 'afternoon';
          BISA.api(`/planner/task/${id}`, { method: 'PATCH', json: { block, position: evt.newIndex } })
            .catch(() => BISA.toast('Erro ao mover tarefa'));
        },
      });
      _sortables.push(new Sortable(morningUl, makeOpts()));
      _sortables.push(new Sortable(afternoonUl, makeOpts()));
      _sortables.push(new Sortable(unplannedUl, makeOpts()));
    }
  }

  /* ── Metas da semana ── */
  function renderGoals(container, weekGoals, onRefresh) {
    container.innerHTML = '';

    const addRow = el('div', 'row');
    addRow.style.cssText = 'gap:8px;margin-bottom:10px;';
    const inp = el('input');
    inp.placeholder = 'Nova meta da semana…';
    inp.style.flex = '1';
    const addBtn = el('button', 'btn');
    addBtn.style.minHeight = '40px';
    addBtn.textContent = '＋';
    addBtn.addEventListener('click', async () => {
      const text = inp.value.trim();
      if (!text) return;
      try {
        const resp = await BISA.api('/planner/task', { method: 'POST', json: { text } });
        const task = resp.task || resp;
        await BISA.api('/planner/promote', { method: 'POST', json: { id: task.id, scope: 'week', on: true } });
        inp.value = '';
        BISA.toast('Meta adicionada');
        onRefresh();
      } catch (e) { BISA.toast('Erro ao adicionar meta'); }
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    addRow.append(inp, addBtn);
    container.appendChild(addRow);

    if (!weekGoals || !weekGoals.length) {
      const empty = el('p', 'muted');
      empty.style.cssText = 'font-size:.88rem;margin:0;';
      empty.textContent = 'Sem metas para esta semana';
      container.appendChild(empty);
      return;
    }

    const ul = el('ul');
    ul.style.cssText = 'margin:0;padding:0;';
    weekGoals.forEach(g => {
      const li = el('li', 'row');
      li.style.cssText = 'list-style:none;padding:8px 0;border-bottom:1px solid var(--line);gap:8px;';
      const icon = el('span');
      icon.textContent = '🎯';
      icon.style.flexShrink = '0';
      const chk = el('button', 'btn ghost');
      chk.style.cssText = `min-height:32px;min-width:32px;padding:0;font-size:1rem;border-radius:50%;${g.done ? 'background:var(--positive);color:#fff;' : ''}`;
      chk.textContent = g.done ? '✓' : '○';
      chk.addEventListener('click', async () => {
        try {
          await BISA.api(`/planner/task/${g.id}`, { method: 'PATCH', json: { done: !g.done } });
          onRefresh();
        } catch { BISA.toast('Erro'); }
      });
      const txt = el('span');
      txt.style.cssText = `flex:1;${g.done ? 'text-decoration:line-through;color:var(--ink-soft);' : ''}`;
      txt.textContent = g.text;
      li.append(icon, chk, txt);
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  /* ── Hábitos ── */
  async function renderHabits(container) {
    container.innerHTML = '';
    try {
      const routines = await BISA.api(`/codex/routines/day?date=${todayStr()}`);
      // API returns { date, items:[], done, total, mood } or array
      _routines = Array.isArray(routines) ? routines : (routines?.items || routines?.routines || []);

      if (!_routines.length) {
        const empty = el('p', 'muted');
        empty.style.cssText = 'font-size:.88rem;margin:0;';
        empty.textContent = 'Nenhum hábito para hoje';
        container.appendChild(empty);
        return;
      }

      const done = _routines.filter(r => r.done).length;
      const counter = el('p', 'muted');
      counter.style.cssText = 'font-size:.82rem;margin:0 0 8px;';
      counter.textContent = `${done} / ${_routines.length} concluídos`;
      container.appendChild(counter);

      const ul = el('ul');
      ul.style.cssText = 'margin:0;padding:0;';
      _routines.forEach(r => {
        const li = el('li', 'row');
        li.style.cssText = 'list-style:none;padding:8px 0;border-bottom:1px solid var(--line);gap:8px;';
        const btn = el('button', 'btn ghost');
        btn.style.cssText = `min-height:36px;min-width:36px;padding:0;font-size:1.05rem;border-radius:50%;${r.done ? 'background:var(--positive);color:#fff;' : ''}`;
        btn.textContent = r.done ? '✓' : '○';
        btn.addEventListener('click', async () => {
          try {
            await BISA.api('/codex/routines/toggle', { method: 'POST', json: { id: r.id, date: todayStr() } });
            await renderHabits(container);
          } catch { BISA.toast('Erro ao registrar hábito'); }
        });
        const lbl = el('span');
        lbl.style.cssText = `flex:1;${r.done ? 'text-decoration:line-through;color:var(--ink-soft);' : ''}`;
        lbl.textContent = r.name || r.title || r.id;
        li.append(btn, lbl);
        ul.appendChild(li);
      });
      container.appendChild(ul);
    } catch {
      container.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">⚠ não foi possível carregar hábitos</p>';
    }
  }

  /* ── Fim-de-dia ── */
  function renderEOD(container, dayData) {
    const h = new Date().getHours();
    if (h < 20) { container.style.display = 'none'; return; }
    container.style.display = '';
    container.innerHTML = '';

    const title = el('div', 'section-title');
    title.textContent = 'Seu dia';
    container.appendChild(title);

    const card = el('div', 'card');
    const allTasks = [
      ...(dayData?.blocks?.morning || []),
      ...(dayData?.blocks?.afternoon || []),
      ...(dayData?.unplanned || []),
    ];
    const doneTasks = allTasks.filter(t => t.done);
    const doneHabits = _routines.filter(r => r.done);

    const s = el('div');
    s.style.cssText = 'font-size:.95rem;';
    if (!doneTasks.length && !doneHabits.length) {
      s.innerHTML = '<p class="muted" style="margin:0;">Ainda sem conquistas registradas hoje — tem tempo!</p>';
    } else {
      if (doneTasks.length) {
        const h2 = el('p');
        h2.style.cssText = 'margin:0 0 6px;font-weight:600;';
        h2.textContent = `✅ ${doneTasks.length} tarefa${doneTasks.length > 1 ? 's' : ''} concluída${doneTasks.length > 1 ? 's' : ''}`;
        const ul = el('ul');
        ul.style.cssText = 'margin:4px 0 10px 18px;padding:0;';
        doneTasks.forEach(t => {
          const li = document.createElement('li');
          li.textContent = t.text;
          ul.appendChild(li);
        });
        s.append(h2, ul);
      }
      if (doneHabits.length) {
        const h2 = el('p');
        h2.style.cssText = 'margin:0 0 6px;font-weight:600;';
        h2.textContent = `🔥 ${doneHabits.length} hábito${doneHabits.length > 1 ? 's' : ''} mantido${doneHabits.length > 1 ? 's' : ''}`;
        const ul = el('ul');
        ul.style.cssText = 'margin:4px 0 0 18px;padding:0;';
        doneHabits.forEach(r => {
          const li = document.createElement('li');
          li.textContent = r.name || r.title || r.id;
          ul.appendChild(li);
        });
        s.append(h2, ul);
      }
    }
    card.appendChild(s);
    container.appendChild(card);
  }

  /* ══════════════════════════════════════════════════
     LOAD + REFRESH (planner)
  ══════════════════════════════════════════════════ */

  async function loadDay(onRefresh) {
    try {
      _dayData = await BISA.api(`/planner/day?date=${todayStr()}`);
    } catch {
      _dayData = null;
    }
    return _dayData;
  }

  /* ══════════════════════════════════════════════════
     MOUNT
  ══════════════════════════════════════════════════ */

  async function mount(el_root) {
    _root = el_root;
    _sortables = [];
    _unsubs = [];
    _dayData = null;
    _routines = [];

    /* ─── Header ─── */
    const header = el('div');
    header.style.cssText = 'margin-bottom:4px;';
    const greet = el('h1');
    greet.style.cssText = 'font-size:1.6rem;margin:0 0 2px;font-weight:700;';
    greet.textContent = greeting() + ' 👋';
    const dateStr = el('p', 'muted');
    dateStr.style.cssText = 'margin:0 0 16px;font-size:.95rem;text-transform:capitalize;';
    dateStr.textContent = fmt(new Date());
    header.append(greet, dateStr);
    el_root.appendChild(header);

    /* ─── Grid wrapper ─── */
    const grid = el('div', 'hub-grid');
    el_root.appendChild(grid);

    /* ── LEFT COLUMN ── */
    const left = el('div');

    /* Briefing */
    const briefingCard = el('div', 'card');
    const briefingTitle = el('div', 'section-title');
    briefingTitle.textContent = 'Briefing';
    const briefingBody = el('div', 'briefing-body');
    briefingBody.style.cssText = 'font-size:.95rem;line-height:1.6;';
    briefingBody.innerHTML = '<p class="muted" style="margin:0;">Carregando…</p>';
    briefingCard.append(briefingTitle, briefingBody);
    left.appendChild(briefingCard);

    /* Quick-add */
    const qaCard = el('div', 'card');
    qaCard.style.paddingBottom = '10px';
    const qaTitle = el('div', 'section-title');
    qaTitle.textContent = 'Adicionar tarefa';
    const qaRow = el('div', 'row');
    qaRow.style.gap = '8px';
    const qaInput = el('input');
    qaInput.placeholder = 'ex.: amanhã 15h dentista #saude';
    qaInput.style.flex = '1';
    const qaBtn = el('button', 'btn');
    qaBtn.style.minHeight = '44px';
    qaBtn.style.paddingInline = '18px';
    qaBtn.textContent = 'Adicionar';

    async function quickAdd() {
      const text = qaInput.value.trim();
      if (!text) return;
      qaBtn.disabled = true;
      try {
        await BISA.api('/planner/task', { method: 'POST', json: { text } }); // response shape: {ok,task}
        qaInput.value = '';
        BISA.toast('Tarefa adicionada!');
        await refresh();
      } catch (e) {
        BISA.toast(e.message || 'Erro ao adicionar tarefa');
      } finally {
        qaBtn.disabled = false;
      }
    }

    qaBtn.addEventListener('click', quickAdd);
    qaInput.addEventListener('keydown', e => { if (e.key === 'Enter') quickAdd(); });
    qaRow.append(qaInput, qaBtn);
    qaCard.append(qaTitle, qaRow);
    left.appendChild(qaCard);

    /* Destaque do dia */
    const hlCard = el('div', 'card');
    hlCard.style.cssText = 'background:var(--accent-soft);border:1.5px solid var(--primary);';
    const hlTitle = el('div', 'section-title');
    hlTitle.textContent = 'Destaque do dia';
    _highlightSlot = el('div');
    _highlightSlot.innerHTML = '<p class="muted" style="margin:0;font-size:.92rem;">Carregando…</p>';
    hlCard.append(hlTitle, _highlightSlot);
    left.appendChild(hlCard);

    /* Agenda de hoje */
    const agCard = el('div', 'card');
    const agTitle = el('div', 'section-title');
    agTitle.textContent = 'Agenda de hoje';
    _agendaContainer = el('div');
    _agendaContainer.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">Carregando…</p>';
    agCard.append(agTitle, _agendaContainer);
    left.appendChild(agCard);

    /* Blocos */
    const blocoCard = el('div', 'card');

    const morningTitle = el('div', 'section-title');
    morningTitle.textContent = 'Manhã';
    const morningUl = el('ul');
    morningUl.style.cssText = 'margin:0 0 10px;padding:0;min-height:44px;';
    morningUl.innerHTML = '<li class="muted" style="list-style:none;padding:12px 2px;font-size:.88rem;">Carregando…</li>';

    const afternoonTitle = el('div', 'section-title');
    afternoonTitle.textContent = 'Tarde';
    const afternoonUl = el('ul');
    afternoonUl.style.cssText = 'margin:0 0 10px;padding:0;min-height:44px;';
    afternoonUl.innerHTML = '<li class="muted" style="list-style:none;padding:12px 2px;font-size:.88rem;">Carregando…</li>';

    const unplannedTitle = el('div', 'section-title');
    unplannedTitle.textContent = 'Sem horário';
    const unplannedUl = el('ul');
    unplannedUl.style.cssText = 'margin:0;padding:0;min-height:44px;';
    unplannedUl.innerHTML = '<li class="muted" style="list-style:none;padding:12px 2px;font-size:.88rem;">Carregando…</li>';

    blocoCard.append(morningTitle, morningUl, afternoonTitle, afternoonUl, unplannedTitle, unplannedUl);
    left.appendChild(blocoCard);

    /* ── RIGHT COLUMN ── */
    const right = el('div');

    /* Metas da semana */
    const goalsCard = el('div', 'card');
    const goalsTitle = el('div', 'section-title');
    goalsTitle.textContent = 'Metas da semana';
    _goalsContainer = el('div');
    _goalsContainer.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">Carregando…</p>';
    goalsCard.append(goalsTitle, _goalsContainer);
    right.appendChild(goalsCard);

    /* Hábitos de hoje */
    const habCard = el('div', 'card');
    const habTitle = el('div', 'section-title');
    habTitle.textContent = 'Hábitos de hoje';
    _habitsContainer = el('div');
    _habitsContainer.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">Carregando…</p>';
    habCard.append(habTitle, _habitsContainer);
    right.appendChild(habCard);

    /* Fim-de-dia */
    _eodCard = el('div');
    _eodCard.style.display = 'none';
    right.appendChild(_eodCard);

    /* Botão Finanças */
    const finBtn = el('button', 'btn ghost block');
    finBtn.style.cssText = 'margin-top:8px;font-size:.95rem;min-height:48px;';
    finBtn.textContent = '💰 Finanças';
    finBtn.addEventListener('click', () => BISA.go('finance'));
    right.appendChild(finBtn);

    /* Botão Câmeras (sentinel/Frigate via proxy /sentinel) */
    const camBtn = el('button', 'btn ghost block');
    camBtn.style.cssText = 'margin-top:8px;font-size:.95rem;min-height:48px;';
    camBtn.textContent = '📹 Câmeras';
    camBtn.addEventListener('click', () => BISA.go('sentinel'));
    right.appendChild(camBtn);

    /* Botão Ajustes (tela de entrada / selo) */
    const cfgBtn = el('button', 'btn ghost block');
    cfgBtn.style.cssText = 'margin-top:8px;font-size:.95rem;min-height:48px;';
    cfgBtn.textContent = '⚙️ Ajustes';
    cfgBtn.addEventListener('click', () => BISA.go('ajustes'));
    right.appendChild(cfgBtn);

    grid.append(left, right);

    /* ─── Refresh function ─── */
    async function refresh() {
      const data = await loadDay(refresh);
      if (data) {
        safeRender(_highlightSlot, () => renderHighlight(_highlightSlot, data, refresh));
        safeRender(_agendaContainer, () => renderAgenda(_agendaContainer, data.events, data.icsConnected));
        safeRender(blocoCard, () => renderBlocosV2(morningUl, afternoonUl, unplannedUl, data, refresh));
        safeRender(_goalsContainer, () => renderGoals(_goalsContainer, data.weekGoals, refresh));
        if (_eodCard) renderEOD(_eodCard, data);
      } else {
        _highlightSlot.innerHTML = '<p class="muted" style="margin:0;font-size:.88rem;">⚠ não foi possível carregar</p>';
        _agendaContainer.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">⚠ não foi possível carregar</p>';
        _goalsContainer.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">⚠ não foi possível carregar</p>';
      }
    }

    /* ─── First load ─── */
    // briefing loads independently
    safeRender(briefingCard, () => renderBriefing(briefingCard));
    // habits load independently
    safeRender(_habitsContainer, () => renderHabits(_habitsContainer));
    // planner data
    await refresh();

    /* ─── WS subscriptions ─── */
    const debouncedRefresh = debounce(refresh, 800);
    const debouncedHabits = debounce(() => renderHabits(_habitsContainer), 800);

    const unsub = BISA.onWs((msg) => {
      if (msg.type === 'fs' || msg.type === 'pkm') {
        debouncedRefresh();
      }
    });
    _unsubs.push(unsub);
  }

  /* ══════════════════════════════════════════════════
     UNMOUNT
  ══════════════════════════════════════════════════ */

  function unmount() {
    destroySortables();
    _unsubs.forEach(fn => { try { fn(); } catch {} });
    _unsubs = [];
    _dayData = null;
    _routines = [];
    _root = null;
    _tasksLists = {};
    _highlightSlot = null;
    _habitsContainer = null;
    _agendaContainer = null;
    _goalsContainer = null;
    _eodCard = null;
  }

  /* ─── registro ─── */
  window.BISA.screens['hub'] = { mount, unmount };
})();
