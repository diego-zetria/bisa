// screens/world.js — tela Mundo (PKM): busca, entidades, grafo, página de entidade.
// Touch-first iPad 11" + desktop. Todo UI em pt-BR.
// Globais usados: BISA.api, BISA.toast, BISA.renderMarkdown, BISA.onWs, BISA.token,
//                 window.ForceGraph (force-graph.min.js vendorado).

(function () {
  // ---- CSS escopado (injetado uma vez) ----
  (function injectStyle() {
    if (document.getElementById('world-style')) return;
    const s = document.createElement('style');
    s.id = 'world-style';
    s.textContent = `
      /* grade de entidades */
      .world-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
        margin-top: 12px;
      }
      @media (min-width: 600px) {
        .world-grid { grid-template-columns: 1fr 1fr; }
      }
      @media (min-width: 900px) {
        .world-grid { grid-template-columns: 1fr 1fr 1fr; }
      }

      /* segmento de filtro */
      .world-seg {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin: 14px 0 4px;
      }
      .world-seg button {
        border: 1.5px solid var(--line);
        background: var(--surface);
        color: var(--ink-soft);
        border-radius: 999px;
        padding: 6px 16px;
        min-height: var(--tap);
        font-size: .9rem;
        transition: background .15s, color .15s, border-color .15s;
      }
      .world-seg button.active {
        background: var(--primary);
        color: var(--primary-ink);
        border-color: var(--primary);
      }

      /* campo de busca */
      .world-search-wrap {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg);
        padding: 12px 0 8px;
      }
      .world-search-wrap input {
        font-size: 1.05rem;
        padding: 13px 16px;
        border-radius: var(--radius);
      }

      /* resultados de busca */
      .world-results {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        margin-top: 6px;
        overflow: hidden;
      }
      .world-result-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
        cursor: pointer;
        transition: background .12s;
      }
      .world-result-item:last-child { border-bottom: none; }
      .world-result-item:active { background: var(--surface-2); }
      .world-result-text { flex: 1; min-width: 0; }
      .world-result-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .world-result-exc { font-size: .85rem; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* card de entidade na grade */
      .entity-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 15px;
        cursor: pointer;
        transition: box-shadow .15s;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .entity-card:active { box-shadow: 0 0 0 2px var(--primary); }
      .entity-card-name { font-weight: 700; font-size: 1rem; }
      .entity-card-exc { font-size: .85rem; color: var(--ink-soft); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .entity-tags { display: flex; flex-wrap: wrap; gap: 4px; }

      /* contêiner do grafo */
      .world-graph-wrap {
        width: 100%;
        height: 60vh;
        min-height: 320px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
        margin-top: 10px;
        position: relative;
      }
      .world-mini-graph-wrap {
        width: 100%;
        height: 240px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
        margin: 14px 0;
        position: relative;
      }

      /* página de entidade */
      .entity-page-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
        flex-wrap: wrap;
      }
      .entity-page-title { font-size: 1.5rem; font-weight: 700; margin: 0; }
      .entity-photo {
        width: 80px; height: 80px;
        object-fit: cover;
        border-radius: var(--radius-sm);
        border: 1px solid var(--line);
        margin-bottom: 10px;
      }
      .entity-fm-table {
        width: 100%;
        border-collapse: collapse;
        font-size: .9rem;
        margin: 12px 0;
      }
      .entity-fm-table td {
        padding: 5px 8px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      .entity-fm-table td:first-child {
        color: var(--ink-soft);
        font-weight: 600;
        white-space: nowrap;
        width: 38%;
      }
      .entity-body { margin: 16px 0; line-height: 1.7; }
      .entity-body h1, .entity-body h2, .entity-body h3 { margin-top: 1.2em; }
      .entity-body a { color: var(--primary); }
      .entity-body img { max-width: 100%; border-radius: var(--radius-sm); }
      .backlink-item {
        padding: 10px 0;
        border-bottom: 1px solid var(--line);
        font-size: .9rem;
      }
      .backlink-item:last-child { border-bottom: none; }
      .backlink-exc { color: var(--ink-soft); margin-top: 3px; font-size: .85rem; }

      /* pill de tipo */
      .pill-people   { background: #e8f0fe; color: #1a73e8; }
      .pill-projects { background: #e6f4ea; color: #1e7e34; }
      .pill-documents{ background: #fff3cd; color: #856404; }
      .pill-journal  { background: var(--accent-soft); color: var(--ink-soft); }
    `;
    document.head.appendChild(s);
  })();

  // ---- helpers de tipo ----
  const TYPE_LABEL = { people: 'Pessoa', projects: 'Projeto', documents: 'Documento', journal: 'Diário' };
  const TYPE_CLASS = { people: 'pill-people', projects: 'pill-projects', documents: 'pill-documents', journal: 'pill-journal' };
  const TYPE_COLOR = { people: '#4285F4', projects: '#34A853', documents: '#FBBC04', 'j:': '#A0A0A0' };

  function typePill(type) {
    const cls = TYPE_CLASS[type] || '';
    return `<span class="pill ${cls}">${TYPE_LABEL[type] || type}</span>`;
  }

  // mapa de frontmatter em pt-BR
  const FM_LABELS = {
    relation: 'Relação', status: 'Status', birthday: 'Aniversário',
    phone: 'Telefone', target_date: 'Prazo', doc_type: 'Tipo',
    expiry_date: 'Validade', location: 'Local', tags: 'Tags',
    email: 'E-mail', company: 'Empresa', url: 'URL', role: 'Papel',
    start_date: 'Início', end_date: 'Fim', owner: 'Responsável',
    priority: 'Prioridade', category: 'Categoria',
  };

  function fmLabel(key) { return FM_LABELS[key] || key; }

  function isImagePath(val) {
    if (typeof val !== 'string') return false;
    return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(val);
  }

  // ---- Estado interno ----
  let _el = null;          // container raiz (screen-pad)
  let _view = 'list';      // 'list' | 'entity' | 'graph'
  let _segment = 'Pessoas'; // segmento ativo
  let _allEntities = [];   // cache de /pkm/entities
  let _searchTimer = null;
  let _fgGlobal = null;    // instância ForceGraph global
  let _fgMini = null;      // instância ForceGraph mini (entity)
  let _unsub = null;       // unsub WS

  // ---- ForceGraph lifecycle ----
  function destroyFG(fg) {
    if (!fg) return;
    try { fg._destructor && fg._destructor(); } catch {}
  }

  function nodeColor(node) {
    if (node.id && node.id.startsWith('j:')) return TYPE_COLOR['j:'];
    return TYPE_COLOR[node.type] || '#999';
  }

  function buildGraph(container, data, onNodeClick, height) {
    if (!window.ForceGraph) {
      container.innerHTML = '<p class="empty">ForceGraph não carregado.</p>';
      return null;
    }
    const w = container.clientWidth || 400;
    const h = height || container.clientHeight || 300;

    const maxLinks = Math.max(1, ...data.nodes.map(n => n.links || 1));

    const fg = window.ForceGraph()(container)
      .width(w)
      .height(h)
      .graphData({ nodes: data.nodes, links: data.links })
      .nodeId('id')
      .nodeLabel('name')
      .nodeColor(nodeColor)
      .nodeVal(n => Math.max(1, (n.links || 1) / maxLinks * 6 + 2))
      .linkColor(() => 'rgba(120,110,100,0.3)')
      .linkWidth(1)
      .enableNodeDrag(true)
      .enablePanInteraction(true)
      .enableZoomInteraction(true)
      .onNodeClick((node) => { if (onNodeClick) onNodeClick(node); });

    // rótulos de texto leve via canvas
    fg.nodeCanvasObject((node, ctx, globalScale) => {
      const label = node.name || node.id;
      const fontSize = Math.max(8, 11 / globalScale);
      const r = Math.max(2, (node.links || 1) / maxLinks * 6 + 2);

      // círculo
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = nodeColor(node);
      ctx.fill();

      // rótulo — só quando zoom razoável
      if (globalScale > 0.6) {
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = 'rgba(43,42,39,0.85)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label.length > 20 ? label.slice(0, 19) + '…' : label, node.x, node.y + r + 2);
      }
    });

    // suporte a toque/pinch: force-graph já usa d3-zoom que lida com touch events
    return fg;
  }

  // ---- Render: search bar + segment ----
  function renderShell() {
    _el.innerHTML = '';

    // campo de busca fixo no topo
    const searchWrap = document.createElement('div');
    searchWrap.className = 'world-search-wrap';
    searchWrap.innerHTML = `<input type="search" id="world-q" placeholder="Buscar pessoas, projetos, no diário…" autocomplete="off">`;
    _el.appendChild(searchWrap);

    // resultados de busca (ocultos por padrão)
    const resultsBox = document.createElement('div');
    resultsBox.id = 'world-results';
    resultsBox.style.display = 'none';
    _el.appendChild(resultsBox);

    // segmentos
    const seg = document.createElement('div');
    seg.className = 'world-seg';
    seg.id = 'world-seg';
    ['Pessoas', 'Projetos', 'Documentos', 'Grafo'].forEach(label => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.seg = label;
      if (label === _segment) b.classList.add('active');
      b.onclick = () => {
        _segment = label;
        document.querySelectorAll('#world-seg button').forEach(x => x.classList.toggle('active', x.dataset.seg === label));
        renderMainContent();
      };
      seg.appendChild(b);
    });
    _el.appendChild(seg);

    // área de conteúdo principal
    const main = document.createElement('div');
    main.id = 'world-main';
    _el.appendChild(main);

    // busca com debounce
    const input = document.getElementById('world-q');
    input.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      const q = input.value.trim();
      if (!q) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; return; }
      _searchTimer = setTimeout(() => doSearch(q, resultsBox), 280);
    });
    // fechar ao blur (com delay para permitir clique)
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!resultsBox.contains(document.activeElement)) {
          resultsBox.style.display = 'none';
        }
      }, 200);
    });
  }

  // ---- Busca ----
  async function doSearch(q, box) {
    try {
      const data = await BISA.api(`/pkm/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = '';

      const entities = data.entities || [];
      const journal = data.journal || [];

      if (!entities.length && !journal.length) {
        box.innerHTML = '<div class="world-result-item muted">Nenhum resultado.</div>';
        box.style.display = 'block';
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'world-results';

      if (entities.length) {
        const hdr = document.createElement('div');
        hdr.className = 'section-title';
        hdr.style.padding = '8px 14px 2px';
        hdr.textContent = 'Entidades';
        wrap.appendChild(hdr);

        entities.forEach(e => {
          const item = document.createElement('div');
          item.className = 'world-result-item';
          const eName = e.name || e.fm?.name || e.fm?.title || e.slug;
          item.innerHTML = `
            <div class="world-result-text">
              <div class="world-result-name">${esc(eName)}</div>
              ${e.excerpt ? `<div class="world-result-exc">${esc(e.excerpt)}</div>` : ''}
            </div>
            ${typePill(e.type)}
          `;
          item.onclick = () => {
            box.style.display = 'none';
            document.getElementById('world-q').value = '';
            openEntity(e.slug);
          };
          wrap.appendChild(item);
        });
      }

      if (journal.length) {
        const hdr = document.createElement('div');
        hdr.className = 'section-title';
        hdr.style.padding = '8px 14px 2px';
        hdr.textContent = 'Diário';
        wrap.appendChild(hdr);

        journal.forEach(j => {
          const item = document.createElement('div');
          item.className = 'world-result-item';
          item.innerHTML = `
            <div class="world-result-text">
              <div class="world-result-name">${esc(j.date || '')}</div>
              ${j.excerpt ? `<div class="world-result-exc">${esc(j.excerpt)}</div>` : ''}
            </div>
            <span class="pill pill-journal">Diário</span>
          `;
          // melhor esforço: toast com a data
          item.onclick = () => {
            box.style.display = 'none';
            document.getElementById('world-q').value = '';
            BISA.toast(`Entrada de diário: ${j.date || '?'}`);
          };
          wrap.appendChild(item);
        });
      }

      box.appendChild(wrap);
      box.style.display = 'block';
    } catch (err) {
      console.warn('[world] busca falhou:', err.message);
    }
  }

  // ---- Render: conteúdo principal (grade ou grafo) ----
  async function renderMainContent() {
    destroyFG(_fgGlobal); _fgGlobal = null;
    destroyFG(_fgMini); _fgMini = null;

    const main = document.getElementById('world-main');
    if (!main) return;
    main.innerHTML = '<p class="muted" style="margin-top:18px">Carregando…</p>';

    if (_segment === 'Grafo') {
      await renderGlobalGraph(main);
    } else {
      await renderEntityList(main);
    }
  }

  // ---- Grade de entidades ----
  async function renderEntityList(main) {
    try {
      // carrega (e cacheia) a lista completa uma vez
      if (!_allEntities.length) {
        _allEntities = await BISA.api('/pkm/entities');
      }

      const typeMap = { Pessoas: 'people', Projetos: 'projects', Documentos: 'documents' };
      const type = typeMap[_segment];
      const items = _allEntities.filter(e => e.type === type);

      main.innerHTML = '';

      if (!items.length) {
        main.innerHTML = `<p class="empty">Nenhum ${TYPE_LABEL[type] || _segment.toLowerCase()} encontrado.</p>`;
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'world-grid';

      items.forEach(e => {
        const card = document.createElement('div');
        card.className = 'entity-card';
        // /pkm/entities returns name+tags at top level; /pkm/entity/:slug nests under fm
        const name = e.name || e.fm?.name || e.fm?.title || e.slug;
        const rawTags = e.tags || e.fm?.tags;
        const tags = Array.isArray(rawTags) ? rawTags : (rawTags ? [rawTags] : []);

        card.innerHTML = `
          <div class="row">
            <span class="entity-card-name">${esc(name)}</span>
            <span class="spacer"></span>
            ${typePill(e.type)}
          </div>
          ${tags.length ? `<div class="entity-tags">${tags.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}
          ${e.excerpt ? `<div class="entity-card-exc">${esc(e.excerpt)}</div>` : ''}
        `;
        card.onclick = () => openEntity(e.slug);
        grid.appendChild(card);
      });

      main.appendChild(grid);
    } catch (err) {
      main.innerHTML = `<p class="empty">Erro ao carregar entidades: ${esc(err.message)}</p>`;
    }
  }

  // ---- Grafo global ----
  async function renderGlobalGraph(main) {
    try {
      const data = await BISA.api('/pkm/graph');
      main.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.className = 'world-graph-wrap';
      main.appendChild(wrap);

      _fgGlobal = buildGraph(wrap, data, (node) => {
        if (node.id && node.id.startsWith('j:')) {
          // nó de journal — toast com a data
          const date = node.id.replace('j:', '');
          BISA.toast(`Entrada de diário: ${date}`);
        } else {
          openEntity(node.id);
        }
      });

      if (!data.nodes || !data.nodes.length) {
        wrap.innerHTML = '<p class="empty">Nenhum dado no grafo ainda.</p>';
      }
    } catch (err) {
      main.innerHTML = `<p class="empty">Erro ao carregar grafo: ${esc(err.message)}</p>`;
    }
  }

  // ---- Página de entidade ----
  async function openEntity(slug) {
    if (!slug) return;

    // limpar grafos existentes antes de navegar
    destroyFG(_fgGlobal); _fgGlobal = null;
    destroyFG(_fgMini); _fgMini = null;

    _view = 'entity';

    if (!_el) return;
    const main = document.getElementById('world-main');
    if (main) main.innerHTML = '<p class="muted" style="margin-top:18px">Carregando…</p>';

    try {
      const entity = await BISA.api(`/pkm/entity/${encodeURIComponent(slug)}`);
      renderEntityPage(entity);
    } catch (err) {
      if (main) main.innerHTML = `<p class="empty">Entidade não encontrada: <strong>${esc(slug)}</strong><br><small>${esc(err.message)}</small></p>`;
    }
  }

  function renderEntityPage(entity) {
    const main = document.getElementById('world-main');
    if (!main) return;
    main.innerHTML = '';

    const fm = entity.fm || {};
    const name = fm.name || fm.title || entity.slug;

    // botão voltar
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.style.marginBottom = '14px';
    back.textContent = '← Mundo';
    back.onclick = () => {
      _view = 'list';
      destroyFG(_fgMini); _fgMini = null;
      renderShell();
      renderMainContent();
    };
    main.appendChild(back);

    // cabeçalho
    const header = document.createElement('div');
    header.className = 'entity-page-header';

    // foto/imagem (se disponível)
    const photoKey = fm.photo || fm.file || null;
    if (photoKey && isImagePath(photoKey)) {
      const img = document.createElement('img');
      img.className = 'entity-photo';
      img.src = `/file?path=${encodeURIComponent(photoKey)}&token=${encodeURIComponent(BISA.token)}`;
      img.alt = name;
      img.onerror = () => img.remove();
      main.appendChild(img);
    }

    header.innerHTML = `
      <h1 class="entity-page-title">${esc(name)}</h1>
      ${typePill(entity.type)}
    `;
    main.appendChild(header);

    // frontmatter como tabela
    const fmKeys = Object.keys(fm).filter(k => !['name', 'title', 'photo', 'file'].includes(k));
    if (fmKeys.length) {
      const table = document.createElement('table');
      table.className = 'entity-fm-table';
      fmKeys.forEach(k => {
        let val = fm[k];
        if (Array.isArray(val)) val = val.join(', ');
        else if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
        else val = String(val);

        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(fmLabel(k))}</td><td>${esc(val)}</td>`;
        table.appendChild(tr);
      });
      main.appendChild(table);
    }

    // corpo em markdown
    if (entity.md) {
      const body = document.createElement('div');
      body.className = 'entity-body';
      body.innerHTML = BISA.renderMarkdown(entity.md);
      main.appendChild(body);
    }

    // mini-grafo de vizinhos
    const backlinks = entity.backlinks || [];
    const neighbors = entity.neighbors || [];

    if (neighbors.length) {
      const gTitle = document.createElement('div');
      gTitle.className = 'section-title';
      gTitle.textContent = 'Conexões';
      main.appendChild(gTitle);

      const miniWrap = document.createElement('div');
      miniWrap.className = 'world-mini-graph-wrap';
      main.appendChild(miniWrap);

      // carrega grafo focalizado
      BISA.api(`/pkm/graph?focus=${encodeURIComponent(entity.slug)}&hops=1`).then(data => {
        if (!data.nodes || !data.nodes.length) {
          miniWrap.innerHTML = '<p class="empty">Sem conexões no grafo.</p>';
          return;
        }
        _fgMini = buildGraph(miniWrap, data, (node) => {
          if (node.id && node.id.startsWith('j:')) {
            BISA.toast(`Entrada de diário: ${node.id.replace('j:', '')}`);
          } else {
            destroyFG(_fgMini); _fgMini = null;
            openEntity(node.id);
          }
        }, 240);
      }).catch(() => {
        miniWrap.innerHTML = '<p class="empty">Erro ao carregar grafo de conexões.</p>';
      });
    }

    // backlinks — menções no diário
    if (backlinks.length) {
      const blTitle = document.createElement('div');
      blTitle.className = 'section-title';
      blTitle.textContent = 'Mencionado no diário';
      main.appendChild(blTitle);

      const blList = document.createElement('div');
      backlinks.forEach(bl => {
        const item = document.createElement('div');
        item.className = 'backlink-item';
        const isJournal = bl.source && bl.source.startsWith('j:');
        const dateStr = isJournal ? bl.source.replace('j:', '') : (bl.date || '');
        item.innerHTML = `
          <div class="row">
            ${dateStr ? `<span class="pill pill-journal">${esc(dateStr)}</span>` : ''}
            ${!isJournal && bl.source ? `<span class="muted" style="font-size:.85rem">${esc(bl.source)}</span>` : ''}
          </div>
          ${bl.excerpt ? `<div class="backlink-exc">${esc(bl.excerpt)}</div>` : ''}
        `;
        blList.appendChild(item);
      });
      main.appendChild(blList);
    }

    // Nota: preview popover de [[wikilink]] omitido intencionalmente.
    // O hover/long-press em wikilinks no corpo da entidade não exibe popover —
    // simplesmente toca/clica para abrir (app.js já roteia data-slug).
    // Razão: ForceGraph + posicionamento de popover em touch scroll introduziria
    // complexidade (>80 linhas) para ganho marginal no iPad. O tap direto é mais
    // previsível e acessível.
  }

  // ---- WS: refresh ao reindexar ----
  function subscribeWs() {
    _unsub = BISA.onWs(msg => {
      if (msg.type === 'pkm' && msg.event === 'index') {
        _allEntities = []; // invalida cache
        if (_view === 'list') {
          renderMainContent();
        }
        // se estiver em entity ou graph, não forçamos refresh automático
        // para não interromper a leitura
      }
    });
  }

  // ---- escape HTML simples ----
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Registro da tela ----
  window.BISA.screens['world'] = {
    mount(el) {
      _el = el;
      _view = 'list';
      _allEntities = [];
      _fgGlobal = null;
      _fgMini = null;

      subscribeWs();
      renderShell();
      renderMainContent();
    },

    unmount() {
      if (_unsub) { _unsub(); _unsub = null; }
      destroyFG(_fgGlobal); _fgGlobal = null;
      destroyFG(_fgMini); _fgMini = null;
      clearTimeout(_searchTimer);
      _el = null;
    },

    openEntity(slug) {
      // chamado por app.js quando um [[wikilink]] é clicado em qualquer tela
      openEntity(slug);
    },
  };
})();
