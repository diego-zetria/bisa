// screens/novela-shorts.js — front do novela-shorts dentro do bisa (Fase 1: ver).
// Lê a API do novela-shorts via o proxy /novela do bisa (mesma origem → cookie
// autentica). Read-only: História (bíblia), Roteiro (beats) e Vídeos (player).
// Edição e geração entram em fases seguintes.
(function () {
  if (!document.getElementById('novela-style')) {
    const s = document.createElement('style');
    s.id = 'novela-style';
    s.textContent = `
      .nv-bar { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .nv-bar .title { font-weight:600; }
      .nv-tabs { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
      .nv-tabs .btn.active { background:var(--primary); color:#fff; }
      .nv-pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
      .nv-beat { margin-bottom:10px; }
      .nv-beat .lab { font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; }
      .nv-beat .prompt { font-family:ui-monospace,monospace; font-size:.82rem; }
      .nv-media { display:grid; grid-template-columns:1fr; gap:14px; }
      @media (min-width:900px){ .nv-media { grid-template-columns:1fr 1fr; } }
      .nv-media video, .nv-media img { width:100%; border-radius:var(--radius);
        border:1px solid var(--line); background:#000; display:block; }
      .nv-chip { font-size:.72rem; padding:2px 8px; border-radius:999px;
        border:1px solid var(--line); }
      .nv-field { width:100%; box-sizing:border-box; margin-bottom:8px; }
      input.nv-field[type=number] { max-width:120px; }
      .nv-save { min-height:40px; margin-top:2px; }
    `;
    document.head.appendChild(s);
  }

  const elx = (t, c, txt) => {
    const e = document.createElement(t);
    if (c) e.className = c;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const media = (rel) => '/novela/media/' + rel + '?token=' + encodeURIComponent(BISA.token || '');

  // --- campos de edição (Fase 2) ---
  function ta(val, rows) { const t = document.createElement('textarea'); t.rows = rows || 3; t.value = val || ''; t.className = 'nv-field'; return t; }
  function txtInput(val) { const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.className = 'nv-field'; return i; }
  function numInput(val) { const i = document.createElement('input'); i.type = 'number'; i.value = (val != null ? val : ''); i.className = 'nv-field'; return i; }
  async function salvar(path, json, btn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Salvando…';
    try { await BISA.api(path, { method: 'PATCH', json }); BISA.toast('Salvo ✓'); }
    catch (e) { BISA.toast((e && e.message) || 'Erro ao salvar'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  const state = { aba: 'historia', cap: null, biblia: null, capitulos: null };

  window.BISA.screens['novela-shorts'] = {
    mount(el) { renderShell(el); },
    unmount() { if (state.jobTimer) { clearInterval(state.jobTimer); state.jobTimer = null; } },
  };

  function renderShell(el) {
    if (state.jobTimer) { clearInterval(state.jobTimer); state.jobTimer = null; }
    state._jobsEl = null;
    el.innerHTML = '';
    const bar = elx('div', 'nv-bar');
    const back = elx('button', 'btn ghost', '← Hoje');
    back.style.minHeight = '40px';
    back.onclick = () => BISA.go('hub');
    const reload = elx('button', 'btn ghost', '⟳');
    reload.style.minHeight = '40px';
    reload.title = 'Recarregar';
    reload.onclick = () => { state.biblia = null; state.capitulos = null; renderAba(); };
    bar.append(back, elx('span', 'title', '🎬 Novela'), elx('span', 'spacer'), reload);
    el.appendChild(bar);

    const tabs = elx('div', 'nv-tabs');
    [['historia', 'História'], ['roteiro', 'Roteiro'], ['videos', 'Vídeos'], ['gerar', 'Gerar']].forEach(([k, label]) => {
      const b = elx('button', 'btn ghost' + (state.aba === k ? ' active' : ''), label);
      b.onclick = () => { state.aba = k; renderShell(el); };
      tabs.appendChild(b);
    });
    el.appendChild(tabs);

    const host = elx('div');
    el.appendChild(host);
    state._host = host;
    renderAba();
  }

  async function getBiblia() {
    if (!state.biblia) state.biblia = await BISA.api('/novela/biblia');
    return state.biblia;
  }
  async function getCapitulos() {
    if (!state.capitulos) state.capitulos = await BISA.api('/novela/capitulos');
    return state.capitulos;
  }

  async function renderAba() {
    const host = state._host;
    if (!host) return;
    host.innerHTML = '<p class="muted">Carregando…</p>';
    try {
      if (state.aba === 'historia') await renderHistoria(host);
      else if (state.aba === 'roteiro') await renderRoteiro(host);
      else if (state.aba === 'videos') await renderVideos(host);
      else await renderGerar(host);
    } catch (e) {
      host.innerHTML = '';
      const c = elx('div', 'card');
      c.append(elx('p', 'muted', (e && e.message) || 'Erro ao carregar.'));
      c.append(elx('p', 'muted', 'A API do novela-shorts está no ar? (python api.py, porta 7779)'));
      host.appendChild(c);
    }
  }

  async function renderHistoria(host) {
    const b = await getBiblia();
    host.innerHTML = '';
    const head = elx('div', 'card');
    head.append(elx('h2', null, b.titulo || 'Novela'));
    if (b.genero) head.append(elx('div', 'muted', b.genero));
    if (b.logline) head.append(elx('p', null, b.logline));
    host.appendChild(head);

    if (b.mundo) { const c = elx('div', 'card'); c.append(elx('div', 'section-title', 'Mundo'), elx('p', null, b.mundo)); host.appendChild(c); }
    if (b.arco_temporada) { const c = elx('div', 'card'); c.append(elx('div', 'section-title', 'Arco da temporada'), elx('p', null, b.arco_temporada)); host.appendChild(c); }

    if (Array.isArray(b.personagens) && b.personagens.length) {
      const c = elx('div', 'card');
      c.append(elx('div', 'section-title', 'Personagens'));
      b.personagens.forEach((p) => {
        const row = elx('div'); row.style.marginBottom = '8px';
        const h = elx('div'); h.append(elx('strong', null, p.nome || '—'));
        if (p.papel) h.append(elx('span', 'muted', '  ·  ' + p.papel));
        row.append(h);
        if (p.descricao_visual) row.append(elx('div', 'muted', p.descricao_visual));
        c.appendChild(row);
      });
      host.appendChild(c);
    }

    const caps = await getCapitulos();
    const c = elx('div', 'card');
    c.append(elx('div', 'section-title', 'Capítulos'));
    (caps.capitulos || []).forEach((cap) => {
      const row = elx('div', 'row'); row.style.alignItems = 'baseline'; row.style.gap = '8px'; row.style.marginBottom = '6px';
      row.append(elx('strong', null, cap.numero + '. ' + cap.titulo));
      row.append(elx('span', 'spacer'));
      row.append(elx('span', 'nv-chip', cap.tem_roteiro ? cap.planos + ' planos' : 'sem roteiro'));
      if ((cap.videos || []).length) row.append(elx('span', 'nv-chip', (cap.videos.length) + ' 🎞️'));
      c.appendChild(row);
    });
    host.appendChild(c);
  }

  function seletorCapitulos(caps, onPick) {
    const pills = elx('div', 'nv-pills');
    (caps.capitulos || []).forEach((cap) => {
      const b = elx('button', 'btn ghost' + (state.cap === cap.numero ? ' active' : ''), 'Cap ' + cap.numero);
      b.onclick = () => { state.cap = cap.numero; onPick(); };
      pills.appendChild(b);
    });
    return pills;
  }

  async function renderRoteiro(host) {
    const caps = await getCapitulos();
    if (!state.cap) {
      const primeiro = (caps.capitulos || []).find((c) => c.tem_roteiro) || (caps.capitulos || [])[0];
      state.cap = primeiro ? primeiro.numero : 1;
    }
    host.innerHTML = '';
    host.appendChild(seletorCapitulos(caps, () => renderRoteiro(host)));

    let cap;
    try { cap = await BISA.api('/novela/capitulo/' + state.cap); }
    catch (e) { const c = elx('div', 'card'); c.append(elx('p', 'muted', (e && e.message) || 'Capítulo sem roteiro.')); host.appendChild(c); return; }

    const base = '/novela/capitulo/' + state.cap;

    // Cabeçalho editável (título + gancho)
    const head = elx('div', 'card');
    head.append(elx('div', 'section-title', 'Cap ' + cap.numero));
    head.append(elx('div', 'lab muted', 'Título'));
    const tInp = txtInput(cap.titulo);
    head.append(elx('div', 'lab muted', 'Gancho (0-3s)'));
    const gInp = ta(cap.gancho, 2);
    head.append(tInp, gInp);
    const salvarCab = elx('button', 'btn ghost nv-save', 'Salvar cabeçalho');
    salvarCab.onclick = () => salvar(base, { titulo: tInp.value, gancho: gInp.value }, salvarCab);
    head.append(salvarCab);
    host.appendChild(head);

    // Beats editáveis
    (cap.beats || []).forEach((bt, i) => {
      const plano = i + 1;
      const c = elx('div', 'card nv-beat');
      c.append(elx('div', 'section-title', 'Plano ' + plano));
      c.append(elx('div', 'lab muted', 'Duração (s)'));
      const dInp = numInput(bt.duracao_seg);
      c.append(dInp);
      c.append(elx('div', 'lab muted', 'Narração (PT-BR)'));
      const nInp = ta(bt.narracao, 3);
      c.append(nInp);
      c.append(elx('div', 'lab muted', 'Legenda'));
      const lInp = txtInput(bt.legenda);
      c.append(lInp);
      c.append(elx('div', 'lab muted', 'Visual (EN — prompt do gerador)'));
      const pInp = ta(bt.prompt_visual, 4);
      pInp.classList.add('prompt');
      c.append(pInp);
      const save = elx('button', 'btn ghost nv-save', 'Salvar plano ' + plano);
      save.onclick = () => salvar(base + '/plano/' + plano, {
        duracao_seg: parseInt(dInp.value, 10) || 0,
        narracao: nInp.value,
        legenda: lInp.value,
        prompt_visual: pInp.value,
      }, save);
      c.append(save);
      host.appendChild(c);
    });

    // Rodapé editável (cliffhanger + post)
    const foot = elx('div', 'card');
    foot.append(elx('div', 'lab muted', 'Cliffhanger'));
    const cInp = ta(cap.cliffhanger, 2);
    foot.append(elx('div', 'lab muted', 'Post (legenda + hashtags)'));
    const capInp = ta(cap.caption_post, 3);
    foot.append(cInp, capInp);
    const salvarFoot = elx('button', 'btn ghost nv-save', 'Salvar rodapé');
    salvarFoot.onclick = () => salvar(base, { cliffhanger: cInp.value, caption_post: capInp.value }, salvarFoot);
    foot.append(salvarFoot);
    host.appendChild(foot);
  }

  async function renderVideos(host) {
    const caps = await getCapitulos();
    if (!state.cap) {
      const comVideo = (caps.capitulos || []).find((c) => (c.videos || []).length) || (caps.capitulos || [])[0];
      state.cap = comVideo ? comVideo.numero : 1;
    }
    host.innerHTML = '';
    host.appendChild(seletorCapitulos(caps, () => renderVideos(host)));

    const cap = (caps.capitulos || []).find((c) => c.numero === state.cap);
    if (!cap || (!(cap.videos || []).length && !(cap.keyframes || []).length)) {
      const c = elx('div', 'card'); c.append(elx('p', 'muted', 'Nenhum vídeo ou keyframe gerado para este capítulo ainda.')); host.appendChild(c); return;
    }

    if ((cap.videos || []).length) {
      const c = elx('div', 'card');
      c.append(elx('div', 'section-title', 'Vídeos'));
      const grid = elx('div', 'nv-media');
      cap.videos.forEach((name) => {
        const wrap = elx('div');
        const v = document.createElement('video');
        v.controls = true; v.preload = 'none'; v.setAttribute('playsinline', '');
        v.src = media('videos/' + name);
        wrap.append(v, elx('div', 'muted', name));
        grid.appendChild(wrap);
      });
      c.appendChild(grid);
      host.appendChild(c);
    }

    if ((cap.keyframes || []).length) {
      const c = elx('div', 'card');
      c.append(elx('div', 'section-title', 'Keyframes'));
      const grid = elx('div', 'nv-media');
      cap.keyframes.forEach((name) => {
        const wrap = elx('div');
        const img = document.createElement('img');
        img.loading = 'lazy'; img.src = media('keyframes/' + name);
        wrap.append(img, elx('div', 'muted', name));
        grid.appendChild(wrap);
      });
      c.appendChild(grid);
      host.appendChild(c);
    }
  }

  // --- Aba Gerar (Fase 3): dispara jobs assíncronos com confirmação de custo ---
  const CUSTO = { roteiro: '~US$0,10', keyframe: '~US$0,03', animar: '~US$0,30', video: '~US$0,35' };
  const temPlano = (nomes, p) => (nomes || []).some((n) => n.indexOf('plano_' + String(p).padStart(2, '0')) >= 0);

  async function iniciarJob(tipo, cap, plano) {
    const alvo = plano ? (' do plano ' + plano) : (' do cap ' + cap);
    if (!confirm('Gerar ' + tipo + alvo + ' — custo aprox. ' + (CUSTO[tipo] || '?') + '.\nContinuar?')) return;
    try { await BISA.api('/novela/jobs', { method: 'POST', json: { tipo, cap, plano } }); BISA.toast('Job iniciado'); atualizarJobs(); }
    catch (e) { BISA.toast((e && e.message) || 'Erro ao iniciar'); }
  }

  async function atualizarJobs() {
    const el = state._jobsEl;
    if (!el) return;
    let data;
    try { data = await BISA.api('/novela/jobs'); } catch (e) { return; }
    el.innerHTML = '';
    el.append(elx('div', 'section-title', 'Jobs'));
    if (!(data.jobs || []).length) { el.append(elx('p', 'muted', 'Nenhum job ainda.')); return; }
    data.jobs.forEach((j) => {
      const st = j.status === 'ok' ? '✅' : j.status === 'erro' ? '❌' : '⏳';
      const row = elx('div'); row.style.marginBottom = '6px';
      row.append(elx('div', null, st + ' ' + j.tipo + (j.plano ? (' · plano ' + j.plano) : '') + ' · cap ' + j.cap));
      const ult = j.erro || (j.log && j.log.length ? j.log[j.log.length - 1] : '');
      if (ult) row.append(elx('div', 'muted', ult));
      el.append(row);
    });
  }

  async function renderGerar(host) {
    if (state.jobTimer) { clearInterval(state.jobTimer); state.jobTimer = null; }
    const caps = await getCapitulos();
    if (!state.cap) state.cap = (caps.capitulos || [])[0] ? caps.capitulos[0].numero : 1;
    host.innerHTML = '';
    host.appendChild(seletorCapitulos(caps, () => renderGerar(host)));

    const cap = (caps.capitulos || []).find((c) => c.numero === state.cap) || {};

    const rc = elx('div', 'card');
    rc.append(elx('div', 'section-title', 'Roteiro do capítulo ' + state.cap));
    rc.append(elx('p', 'muted', cap.tem_roteiro ? (cap.planos + ' planos. Regerar substitui o roteiro atual.') : 'Ainda sem roteiro.'));
    const rb = elx('button', 'btn ghost nv-save', cap.tem_roteiro ? 'Regerar roteiro' : 'Gerar roteiro');
    rb.onclick = () => iniciarJob('roteiro', state.cap, null);
    rc.append(rb);
    host.appendChild(rc);

    if (cap.tem_roteiro) {
      for (let p = 1; p <= cap.planos; p++) {
        const c = elx('div', 'card');
        const row = elx('div', 'row'); row.style.gap = '8px'; row.style.alignItems = 'center';
        row.append(elx('strong', null, 'Plano ' + p));
        if (temPlano(cap.keyframes, p)) row.append(elx('span', 'nv-chip', 'keyframe ✓'));
        if (temPlano(cap.videos, p)) row.append(elx('span', 'nv-chip', 'vídeo ✓'));
        c.append(row);
        const btns = elx('div', 'nv-pills'); btns.style.marginTop = '8px';
        const bKf = elx('button', 'btn ghost', 'Keyframe'); bKf.onclick = () => iniciarJob('keyframe', state.cap, p);
        const bAn = elx('button', 'btn ghost', 'Animar'); bAn.onclick = () => iniciarJob('animar', state.cap, p);
        if (!temPlano(cap.keyframes, p)) bAn.disabled = true;
        const bVid = elx('button', 'btn ghost', 'Keyframe + Vídeo'); bVid.onclick = () => iniciarJob('video', state.cap, p);
        btns.append(bKf, bAn, bVid);
        c.append(btns);
        host.appendChild(c);
      }
    }

    const jc = elx('div', 'card');
    host.appendChild(jc);
    state._jobsEl = jc;
    atualizarJobs();
    state.jobTimer = setInterval(atualizarJobs, 4000);
  }
})();
