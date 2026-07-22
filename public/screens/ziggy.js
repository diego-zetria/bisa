// screens/ziggy.js — Ziggy (alexa-claude-bridge) dentro do bisa.
// Redesign 2026-07-20 (rodada 2): cockpit de trabalho com o design Claude —
// papel ivory, serifa editorial (Iowan/Tiempos/Georgia), terracotta #D97757,
// hairlines, mono p/ as falas da Echo. Tema escopado em .zg-screen (segue o
// data-appearance do app: claro/noite). EN é o idioma PRINCIPAL (treino de
// inglês embutido); PT fica no toggle. Reunião é o herói: tradução ao vivo +
// painel de contexto (resumo acumulado + docs do McGraw + falas prontas).
// Fala só com os proxies /ziggy/* do bisa — a porta 7788 fica escondida.
(function () {
  if (!document.getElementById('zg-style')) {
    const s = document.createElement('style');
    s.id = 'zg-style';
    s.textContent = `
      /* ── tema Claude escopado (claro + noite via data-appearance/sistema) ── */
      .zg-screen { --zg-paper:#FAF9F5; --zg-card:#FDFCF9; --zg-line:#E8E4DA;
        --zg-ink:#21201C; --zg-soft:#6B675E; --zg-acc:#D97757; --zg-acc-deep:#C4643F;
        --zg-acc-soft:rgba(217,119,87,.09);
        --zg-serif:"Iowan Old Style","Tiempos Text",Palatino,Georgia,serif;
        --zg-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
      :root[data-appearance="dark"] .zg-screen { --zg-paper:#1F1E1B; --zg-card:#262624;
        --zg-line:#3A3733; --zg-ink:#F0EEE7; --zg-soft:#A29D92; --zg-acc-deep:#E08663;
        --zg-acc-soft:rgba(217,119,87,.16); }
      @media (prefers-color-scheme: dark) {
        :root:not([data-appearance="light"]):not([data-appearance="excel"]) .zg-screen {
          --zg-paper:#1F1E1B; --zg-card:#262624; --zg-line:#3A3733; --zg-ink:#F0EEE7;
          --zg-soft:#A29D92; --zg-acc-deep:#E08663; --zg-acc-soft:rgba(217,119,87,.16); }
      }
      /* Dentro do Biso, o tema 🎨 do Biso manda (senão um Biso escuro exibiria
         uma Ziggy clara). Temas escuros forçam papel carvão; claros, ivory. */
      .biso-root[data-theme="claude-noite"] .biso-content .zg-screen,
      .biso-root[data-theme="escuro"] .biso-content .zg-screen,
      .biso-root[data-theme="matrix"] .biso-content .zg-screen,
      .biso-root[data-theme="contraste"] .biso-content .zg-screen {
        --zg-paper:#1F1E1B; --zg-card:#262624; --zg-line:#3A3733; --zg-ink:#F0EEE7;
        --zg-soft:#A29D92; --zg-acc-deep:#E08663; --zg-acc-soft:rgba(217,119,87,.16); }
      .biso-root[data-theme="claude"] .biso-content .zg-screen,
      .biso-root[data-theme="sepia"] .biso-content .zg-screen {
        --zg-paper:#FAF9F5; --zg-card:#FDFCF9; --zg-line:#E8E4DA; --zg-ink:#21201C;
        --zg-soft:#6B675E; --zg-acc-deep:#C4643F; --zg-acc-soft:rgba(217,119,87,.09); }
      .zg-screen { color:var(--zg-ink); }
      .zg-screen .card { background:var(--zg-card); border:1px solid var(--zg-line);
        border-radius:14px; box-shadow:none; color:var(--zg-ink);
        animation:zgIn .5s cubic-bezier(.2,.7,.3,1) both; }
      .zg-screen .card:nth-of-type(2) { animation-delay:.05s }
      .zg-screen .card:nth-of-type(3) { animation-delay:.1s }
      .zg-screen .card:nth-of-type(4) { animation-delay:.15s }
      .zg-screen .card:nth-of-type(5) { animation-delay:.2s }
      .zg-screen .card:nth-of-type(6) { animation-delay:.25s }
      .zg-screen .card:nth-of-type(7) { animation-delay:.3s }
      @keyframes zgIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:none } }
      @media (prefers-reduced-motion: reduce) { .zg-screen .card { animation:none } }
      /* botões: terracotta p/ ação primária, hairline p/ o resto */
      .zg-screen .btn { background:var(--zg-acc); border:none; color:#fff;
        border-radius:11px; font-weight:600; }
      .zg-screen .btn:active { transform:translateY(1px); }
      .zg-screen .btn.ghost { background:transparent; color:var(--zg-ink);
        border:1px solid var(--zg-line); font-weight:500; }
      .zg-screen .btn.ghost:active { border-color:var(--zg-acc); color:var(--zg-acc-deep); }
      /* ── masthead editorial ── */
      .zg-mast { display:flex; align-items:flex-end; gap:14px; padding:6px 4px 14px; }
      .zg-mast .tw { flex:1; min-width:0; }
      .zg-eyebrow { font-family:var(--zg-mono); font-size:.66rem; letter-spacing:.24em;
        text-transform:uppercase; color:var(--zg-acc-deep); margin-bottom:7px; }
      .zg-title { font-family:var(--zg-serif); font-size:2.2rem; font-weight:600;
        letter-spacing:-.02em; line-height:1; margin:0; }
      .zg-h3 { display:flex; align-items:center; gap:10px; }
      .zg-h3 h3 { flex:1; margin:0; font-family:var(--zg-serif); font-size:1.28rem;
        font-weight:600; letter-spacing:-.01em; }
      .zg-lang { font-family:var(--zg-mono); font-size:.7rem; font-weight:600;
        letter-spacing:.1em; text-transform:uppercase; color:var(--zg-acc-deep);
        background:transparent; border:1px solid var(--zg-line); border-radius:999px;
        padding:6px 14px; cursor:pointer; }
      /* ── inputs ── */
      .zg-hs textarea, .zg-mc textarea { width:100%; box-sizing:border-box; min-height:64px;
        resize:none; overflow-y:auto; font:16px/1.45 var(--font); color:var(--zg-ink);
        background:var(--zg-paper); border:1px solid var(--zg-line);
        border-radius:10px; padding:11px 13px; }
      .zg-ta-tools { justify-content:flex-end; margin-top:6px; min-height:22px; }
      .zg-ta-tools .cnt { font-family:var(--zg-mono); font-size:.66rem; color:var(--zg-soft);
        letter-spacing:.05em; font-variant-numeric:tabular-nums; }
      .zg-ta-tools .btn { min-height:32px; padding:4px 12px; font-size:.8rem; }
      .zg-hs-box { min-height:52px; border:1px solid var(--zg-line); border-radius:10px;
        padding:12px 14px; background:var(--zg-paper); font-size:1rem; line-height:1.45; }
      .zg-hs-box:empty::before { content:attr(data-ph); color:var(--zg-soft); }
      .zg-row { display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap; }
      .zg-st { font-size:.85rem; color:var(--zg-soft); }
      .zg-hint { font-size:.82rem; color:var(--zg-soft); margin:10px 0 8px; }
      /* falas da Echo: sempre em mono — lê como comando */
      .zg-hint-voice { font-family:var(--zg-mono); font-size:.72rem; color:var(--zg-soft);
        margin:6px 0 0; letter-spacing:.02em; }
      .zg-hint-voice code { background:var(--zg-acc-soft); color:var(--zg-acc-deep);
        border-radius:5px; padding:2px 6px; }
      .zg-vh { font-family:var(--zg-mono); font-size:.62rem; font-weight:400;
        color:var(--zg-acc-deep); opacity:.85; letter-spacing:.02em; }
      /* ── grid dos rituais: blocos de papel, não botões berrantes ── */
      .zg-mc-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0; }
      .zg-mc-grid .btn { min-height:58px; display:flex; flex-direction:column;
        align-items:flex-start; justify-content:center; gap:3px; padding:10px 13px;
        text-align:left; background:var(--zg-paper); color:var(--zg-ink);
        border:1px solid var(--zg-line); font-weight:600; }
      .zg-mc-grid .btn:active { border-color:var(--zg-acc); }
      .zg-mc-out { margin-top:12px; display:none; border-left:2px solid var(--zg-acc);
        background:var(--zg-paper); border-radius:0 10px 10px 0;
        padding:12px 14px; font-size:.92rem; line-height:1.55; overflow-x:auto; }
      .zg-mc-out.on { display:block; }
      .zg-mc-out table { border-collapse:collapse; font-size:.85rem; }
      .zg-mc-out th, .zg-mc-out td { border:1px solid var(--zg-line); padding:5px 8px; text-align:left; }
      .zg-mc-out p { margin:0 0 8px; }
      .zg-mc-out ul, .zg-mc-out ol { margin:0 0 8px; padding-left:20px; }
      /* ── saída do howsay: a frase é a estrela, em serifa grande ── */
      .zg-out { margin-top:14px; display:none; border-top:1px solid var(--zg-line); padding-top:14px; }
      .zg-out.on { display:block; }
      .zg-out b { display:block; font-family:var(--zg-mono); font-size:.64rem;
        letter-spacing:.2em; text-transform:uppercase; color:var(--zg-acc-deep); margin-bottom:8px; }
      .zg-out span { font-family:var(--zg-serif); font-size:1.35rem; line-height:1.45;
        letter-spacing:-.005em; }
      .zg-mic { min-width:122px; }
      .zg-mic.active { background:#B0584F; animation:zgRec 1.6s ease-in-out infinite; }
      @keyframes zgRec { 0%,100% { opacity:1 } 50% { opacity:.72 } }
      /* ── herói: reunião ── */
      .zg-hero { position:relative; overflow:hidden; }
      .zg-hero::before { content:''; position:absolute; inset:0 0 auto 0; height:3px;
        background:linear-gradient(90deg,var(--zg-acc),#E8A87C,var(--zg-acc)); }
      .zg-live { font-family:var(--zg-mono); font-size:.72rem; letter-spacing:.08em;
        text-transform:uppercase; color:var(--zg-soft); margin-bottom:12px;
        display:flex; align-items:center; gap:9px; }
      .zg-live::before { content:''; width:8px; height:8px; border-radius:50%;
        background:var(--zg-line); flex:none; }
      .zg-live.on::before { background:var(--zg-acc); animation:zgPulse 2s infinite; }
      @keyframes zgPulse { 0% { box-shadow:0 0 0 0 rgba(217,119,87,.45) }
        70% { box-shadow:0 0 0 9px rgba(217,119,87,0) } 100% { box-shadow:0 0 0 0 rgba(217,119,87,0) } }
      .zg-hero-grid { display:grid; grid-template-columns:1.4fr 1fr; gap:22px; margin-top:6px; }
      @media (max-width: 760px) { .zg-hero-grid { grid-template-columns:1fr; } }
      .zg-d { display:grid; grid-template-columns:50px 1fr; gap:12px; padding:12px 2px;
        border-top:1px solid var(--zg-line); font-size:.95rem; line-height:1.55; }
      .zg-d:first-child { border-top:none; }
      .zg-d time { font-family:var(--zg-mono); font-size:.68rem; color:var(--zg-soft);
        padding-top:4px; font-variant-numeric:tabular-nums; }
      .zg-d.mention { background:var(--zg-acc-soft); border-radius:10px;
        padding-left:8px; padding-right:8px; border-top:none; }
      .zg-mention { font-family:var(--zg-mono); font-size:.66rem; letter-spacing:.14em;
        text-transform:uppercase; color:var(--zg-acc-deep); margin-bottom:4px; }
      .zg-say { margin-top:9px; display:flex; flex-wrap:wrap; gap:6px; }
      .zg-chip { font-size:.85rem; color:var(--zg-acc-deep); background:var(--zg-acc-soft);
        border-radius:999px; padding:5px 13px; line-height:1.4; }
      .zg-ctx { display:flex; flex-direction:column; gap:16px; border-left:1px solid var(--zg-line);
        padding-left:20px; min-width:0; }
      @media (max-width: 760px) { .zg-ctx { border-left:none; padding-left:0;
        border-top:1px dashed var(--zg-line); padding-top:14px; } }
      .zg-ctx h4 { margin:0 0 7px; font-family:var(--zg-mono); font-size:.62rem;
        letter-spacing:.2em; text-transform:uppercase; color:var(--zg-acc-deep); font-weight:600; }
      .zg-ctx-sum { font-family:var(--zg-serif); font-size:1.06rem; line-height:1.6; }
      .zg-ctx-mat { font-size:.88rem; line-height:1.5; }
      .zg-ctx-mat .m { margin-bottom:9px; }
      .zg-ctx-mat .m b { display:block; font-size:.85rem; }
      .zg-ctx-empty { font-size:.85rem; color:var(--zg-soft); line-height:1.55; }
      .zg-fin-saved { font-family:var(--zg-mono); font-size:.68rem; color:var(--zg-acc-deep);
        line-height:1.7; background:var(--zg-acc-soft); border-radius:10px; padding:8px 12px; }
      .zg-copy { font-family:var(--zg-mono); font-size:.7rem; color:var(--zg-acc-deep);
        background:var(--zg-acc-soft); border:none; border-radius:999px; padding:7px 15px;
        cursor:pointer; align-self:flex-start; }
      .zg-ctx-at { font-family:var(--zg-mono); font-size:.64rem; color:var(--zg-soft);
        font-variant-numeric:tabular-nums; letter-spacing:.06em; }
      .zg-silence { display:none; margin:0 0 12px; padding:10px 13px; border-radius:10px;
        background:var(--warn-soft); color:var(--warn); font-size:.88rem; }
      .zg-silence.on { display:block; }
      .card.zg-hero.full { position:fixed; inset:0; z-index:70; margin:0; border-radius:0;
        border:none; background:var(--zg-paper); overflow-y:auto;
        padding:20px 20px calc(24px + env(safe-area-inset-bottom)); animation:none; }
      .card.zg-hero.full .zg-d { font-size:1.04rem; }
      .card.zg-hero.full .zg-ctx-sum { font-size:1.12rem; }
      /* ── PRs ── */
      .zg-pr { border:1px solid var(--zg-line); border-radius:10px;
        background:var(--zg-paper); padding:12px 14px; margin-bottom:9px; }
      .zg-pr .meta { font-family:var(--zg-mono); font-size:.68rem; color:var(--zg-soft);
        font-variant-numeric:tabular-nums; letter-spacing:.03em; }
      .zg-pr .ttl { font-family:var(--zg-serif); font-size:1.02rem; line-height:1.4; margin:4px 0 9px; }
      .zg-pr .acts { display:flex; gap:8px; flex-wrap:wrap; }
      .zg-pr .acts .btn { min-height:38px; padding:6px 14px; font-size:.85rem; }
      .zg-pr .btn.arm { background:#B0584F; color:#fff; border:none; }
      .zg-pr .anl { margin-top:10px; padding:10px 12px; font-size:.88rem; line-height:1.5;
        border-left:2px solid var(--zg-acc); background:var(--zg-card);
        border-radius:0 10px 10px 0; display:none; }
      .zg-pr .anl.on { display:block; }
      .zg-pr .anl p { margin:0 0 6px; }
      /* ── revisão semanal ── */
      .zg-wk-agg { font-size:.85rem; line-height:1.6; color:var(--zg-soft); margin:10px 0;
        border-left:2px solid var(--zg-acc); background:var(--zg-paper); padding:10px 13px;
        border-radius:0 10px 10px 0; }
      .zg-wk-agg b { color:var(--zg-ink); }
      .zg-wk-dom { display:grid; grid-template-columns:auto 1fr auto; gap:8px 12px;
        align-items:center; margin:10px 0; font-size:.9rem; }
      .zg-wk-dom input[type=range] { width:100%; accent-color:var(--zg-acc); }
      .zg-wk-dom .v { font-variant-numeric:tabular-nums; color:var(--zg-acc-deep); font-weight:600; }
      /* ── guias ── */
      .zg-cmds { display:none; }
      .zg-cmds.on { display:block; }
      .zg-filter { width:100%; box-sizing:border-box; font:16px/1.4 var(--font);
        color:var(--zg-ink); background:var(--zg-paper); border:1px solid var(--zg-line);
        border-radius:999px; padding:10px 16px; margin:0 0 12px; }
      .zg-sec { border:1px solid var(--zg-line); border-radius:10px;
        margin-bottom:8px; overflow:hidden; background:var(--zg-paper); }
      .zg-sec-h { display:flex; align-items:center; gap:10px; width:100%; padding:13px 14px;
        background:none; border:none; font:inherit; font-weight:600; color:var(--zg-ink);
        cursor:pointer; text-align:left; }
      .zg-sec-h .ic { font-size:1.1rem; }
      .zg-sec-h .n { margin-left:auto; font-family:var(--zg-mono); font-size:.66rem;
        font-weight:400; color:var(--zg-soft); border:1px solid var(--zg-line);
        border-radius:999px; padding:2px 9px; }
      .zg-sec-h .ch { color:var(--zg-soft); font-size:.7rem; transition:transform .15s; }
      .zg-sec.open .zg-sec-h .ch { transform:rotate(90deg); }
      .zg-sec-b { display:none; padding:0 12px 6px; }
      .zg-sec.open .zg-sec-b { display:block; }
      .zg-it { padding:11px 4px; border-top:1px dashed var(--zg-line); }
      .zg-it .say { font-size:.98rem; line-height:1.45; }
      .zg-it .say b { color:var(--zg-acc-deep); }
      .zg-it .say code { font-family:var(--zg-mono); background:var(--zg-acc-soft);
        color:var(--zg-acc-deep); border-radius:5px; padding:1px 6px; font-size:.85em; }
      .zg-it .res { font-size:.8rem; color:var(--zg-soft); margin-top:4px; line-height:1.45; }
      .zg-it.cont { margin-left:16px; padding-top:7px; border-top:none; }
      .zg-it.cont .say::before { content:'↳ '; color:var(--zg-soft); }
    `;
    document.head.appendChild(s);
  }

  // --- i18n: EN é o PRINCIPAL (decisão 2026-07-20 — a tela é treino de
  // inglês por imersão); PT fica no toggle. Persistido em localStorage.
  const L = {
    pt: {
      eyebrow: '⚡ cockpit de trabalho',
      mcTitle: 'McGraw — meu dia',
      morning: '🌅 Começar o dia', daily: '🗣️ Prep da Daily',
      next: '⏭️ Próximo passo', wrapup: '🌙 Fechar o dia',
      slack: '📨 Slack', interpret: '🧭 Interpretar', statusB: '📌 Status',
      mcPh: 'Cole a mensagem do colega, escreva seu rascunho de Slack, ou o nome do projeto (roar, airflow, eks…)',
      thinking: ' — pensando… (pode levar 1-2 min)', fail: 'falhou: ',
      copy: 'copiar', copied: 'copiado ✓', save: 'salvar no caderno', saved: 'salvo no caderno ✓',
      needText: 'escreva ou cole o texto primeiro',
      clipCorp: '📋 colar do Mac corp', clipLocal: '📋 colar do Mac pessoal',
      clipFetching: 'buscando…', clipEmpty: 'clipboard vazio',
      clipOk: 'colado ✓',
      sendCorp: '📤 clipboard do corp', sending: 'enviando…',
      sentCorp: 'no clipboard do corp ✓ — é só Cmd+V lá',
      clear: '✕ limpar',
      hsTitle: 'Como falo em inglês?',
      hsPh: 'Toque em 🎤 e fale em português — ou digite aqui…',
      hsGo: 'Traduzir', sayThis: 'diga assim', hsThinking: 'pensando…',
      hsMic: '🎤 falar', hsListen: '▶ ouvir', hsListenLoading: 'gerando…',
      tkTitle: 'Reunião',
      tkOn: 'digerindo a cada ~30s', tkOff: 'parado', radioOn: ' · 📻 rádio ligada',
      connecting: 'conectando…', bridgeDown: 'bridge fora do ar: ',
      tgOn: '▶ Ligar tradução', tgOff: '■ Parar tradução',
      tgStarting: 'ligando…', tgStopping: 'parando…',
      tgToastOn: 'Tradução ligada — digests em ~40s', tgToastOff: 'Tradução parada',
      empty: 'nenhum digest ainda — os blocos aparecem aqui conforme a reunião rola.',
      full: '⛶ tela cheia', fullOff: '✕ sair',
      silence: '🤫 só silêncio há ~{s}s — a reunião está tocando perto de mim? (o som precisa chegar neste Mac: sistema ou microfone)',
      errBiso: '⚠ o resumidor falhou nos últimos {n} blocos — tentando de novo; o transcript segue sendo salvo',
      stale: '⏳ sem digest novo há {m} min — reunião em silêncio ou em pausa',
      mention: '📣 falaram de você',
      ctxSum: 'resumo da reunião', ctxMat: 'do nosso McGraw', ctxSay: 'com base no que temos',
      ctxEmpty: 'o painel de contexto acorda ~1 min depois que a conversa começa — resumo ao vivo, docs nossos sobre o assunto e falas prontas.',
      ctxWaiting: '⏳ coletando contexto — resumo ao vivo, docs nossos e falas prontas aparecem aqui em ~1 min.',
      finalizing: '🏁 encerrando — gerando o resumo final…',
      finTitle: '🏁 resumo final', finTopics: 'tópicos importantes', finActions: 'ações necessárias',
      finMat: 'arquivos relacionados', finSavedAta: '✓ ata salva em {f}', finSavedFu: '{n} ações → {f}',
      finCopy: '⧉ copiar resumo', finCopied: '✓ copiado',
      ctxAt: 'atualizado às {t}',
      cmTitle: 'Como falar com a Echo',
      flTitle: 'Fluxos & automações',
      prTitle: 'PRs para revisar',
      prFetch: '🔄 buscar PRs no corp', prFetching: 'buscando… (~15s)',
      prNone: 'nenhum PR esperando seu review 🎉',
      prAnalyze: '🔍 analisar', prAnalyzing: 'analisando… (~2 min)',
      prApprove: '✅ Approve LTMD', prConfirm: 'confirmar?', prApproved: 'aprovado ✓',
      prBy: 'por',
      wkTitle: 'Revisão semanal',
      wkOpen: 'abrir revisão', wkLoading: 'juntando a semana…',
      wkDoneQ: 'O que foi feito de bom?', wkChangedQ: 'O que mudou?', wkFocusQ: 'Foco da próxima semana',
      wkSave: 'salvar revisão no caderno', wkSaved: 'revisão salva no caderno ✓',
      wkDomains: ['saúde', 'finanças', 'trabalho', 'inglês', 'relações', 'projetos'],
      wkEnv: 'envelopes ≥50%', wkPeso: 'peso (7d)', wkNotas: 'notas na semana', wkEng: 'erros de inglês (7d)', wkCusto: 'custo claude (7d)',
      cmShow: 'mostrar', cmHide: 'ocultar', cmLoading: 'carregando…',
      filterPh: '🔍 buscar… (ex: nota, gasto, digest)',
      voicePrefix: '🎤 fale: ',
    },
    en: {
      eyebrow: '⚡ work cockpit',
      mcTitle: 'McGraw — my day',
      morning: "🌅 Start my day", daily: '🗣️ Prep my daily',
      next: '⏭️ My next step', wrapup: '🌙 Wrap up my day',
      slack: '📨 Slack draft', interpret: '🧭 Read this for me', statusB: '📌 Project status',
      mcPh: "Paste a teammate's message, write your Slack draft, or type a project name (roar, airflow, eks…)",
      thinking: ' — thinking… (may take 1-2 min)', fail: 'failed: ',
      copy: 'copy', copied: 'copied ✓', save: 'save to caderno', saved: 'saved to caderno ✓',
      needText: 'write or paste the text first',
      clipCorp: '📋 paste from work Mac', clipLocal: '📋 paste from my Mac',
      clipFetching: 'fetching…', clipEmpty: 'clipboard is empty',
      clipOk: 'pasted ✓',
      sendCorp: '📤 to work Mac clipboard', sending: 'sending…',
      sentCorp: "on the work Mac clipboard ✓ — just Cmd+V there",
      clear: '✕ clear',
      hsTitle: 'How do I say it?',
      hsPh: 'Tap 🎤 and speak in Portuguese — or type here…',
      hsGo: 'Translate', sayThis: 'say it like this', hsThinking: 'thinking…',
      hsMic: '🎤 speak', hsListen: '▶ listen', hsListenLoading: 'rendering…',
      tkTitle: 'Meeting',
      tkOn: 'digesting every ~30s', tkOff: 'stopped', radioOn: ' · 📻 radio on',
      connecting: 'connecting…', bridgeDown: 'bridge is down: ',
      tgOn: '▶ Start translation', tgOff: '■ Stop translation',
      tgStarting: 'starting…', tgStopping: 'stopping…',
      tgToastOn: 'Translation is on — digests in ~40s', tgToastOff: 'Translation stopped',
      empty: 'no digests yet — blocks show up here as the meeting goes.',
      full: '⛶ full screen', fullOff: '✕ exit',
      silence: "🤫 nothing but silence for ~{s}s — is the meeting playing near me? (audio must reach this Mac: system or mic)",
      errBiso: '⚠ the digester failed on the last {n} blocks — retrying; transcripts are still being saved',
      stale: '⏳ no new digest for {m} min — meeting silent or on a break',
      mention: '📣 they mentioned you',
      ctxSum: 'meeting summary', ctxMat: 'from our McGraw', ctxSay: 'grounded in our docs',
      ctxEmpty: 'the context panel wakes up ~1 min into the conversation — live summary, our docs on the topic, ready-to-say lines.',
      ctxWaiting: '⏳ gathering context — live summary, our docs and ready-to-say lines show up here in ~1 min.',
      finalizing: '🏁 wrapping up — generating the final summary…',
      finTitle: '🏁 final summary', finTopics: 'key topics', finActions: 'action items',
      finMat: 'related files', finSavedAta: '✓ minutes saved to {f}', finSavedFu: '{n} actions → {f}',
      finCopy: '⧉ copy summary', finCopied: '✓ copied',
      ctxAt: 'updated at {t}',
      cmTitle: 'Talking to the Echo',
      flTitle: 'Flows & automations',
      prTitle: 'PRs waiting for me',
      prFetch: '🔄 fetch PRs from work Mac', prFetching: 'fetching… (~15s)',
      prNone: 'no PRs waiting for your review 🎉',
      prAnalyze: '🔍 analyze', prAnalyzing: 'analyzing… (~2 min)',
      prApprove: '✅ Approve LTMD', prConfirm: 'confirm?', prApproved: 'approved ✓',
      prBy: 'by',
      wkTitle: 'Weekly review',
      wkOpen: 'open my review', wkLoading: 'gathering the week…',
      wkDoneQ: 'What went well?', wkChangedQ: 'What changed?', wkFocusQ: 'Focus for next week',
      wkSave: 'save review to caderno', wkSaved: 'review saved to caderno ✓',
      wkDomains: ['health', 'finances', 'work', 'english', 'relationships', 'projects'],
      wkEnv: 'envelopes ≥50%', wkPeso: 'weight (7d)', wkNotas: 'notes this week', wkEng: 'english mistakes (7d)', wkCusto: 'claude cost (7d)',
      cmShow: 'show', cmHide: 'hide', cmLoading: 'loading…',
      filterPh: '🔍 search… (e.g. note, expense, digest)',
      voicePrefix: '🎤 say: ',
    },
  };
  // EN é o padrão; 'zg-lang'='pt' ativa o português.
  const lang = () => (localStorage.getItem('zg-lang') === 'pt' ? 'pt' : 'en');
  const t = (k) => L[lang()][k];

  // Falas exatas p/ a Echo (batem com os samples dos intents da skill).
  // Sempre em inglês — a skill é en-US e é isso que treina o ouvido/boca.
  const VOICE = {
    morning: 'Ziggy, ask B B S to start my work day',
    daily: 'Ziggy, ask B B S to prep my daily',
    next: "Ziggy, ask B B S what's my next step",
    wrapup: 'Ziggy, ask B B S to wrap up my work day',
    hs: 'Ziggy, ask B B S how do I say …',
    tg: 'Ziggy, ask B B S start digest — stop digest',
  };

  const state = { timer: null, active: false, tgBtn: null };

  const escH = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  async function tick(ui) {
    try {
      const d = await BISA.api('/ziggy/digests');
      state.active = !!d.active;
      if (state.tgBtn && !state.tgBtn.disabled) state.tgBtn.textContent = state.active ? t('tgOff') : t('tgOn');
      ui.live.textContent = (d.active ? t('tkOn') : t('tkOff')) + (d.radio ? t('radioOn') : '');
      ui.live.classList.toggle('on', !!d.active);
      // Aviso no topo, por prioridade: erro do biso (2+ blocos falhando,
      // incidente 2026-07-21) > silêncio (3+ blocos descartados, lição
      // 2026-07-20) > sem digest há 2+ min (sinal de vida do pipeline).
      const errN = d.active ? (d.errorStreak || 0) : 0;
      const staleMin = d.active && d.lastDigestTs ? Math.floor((Date.now() - d.lastDigestTs) / 60000) : 0;
      let warn = '';
      if (errN >= 2) warn = t('errBiso').replace('{n}', errN);
      else if (d.active && (d.silentBlocks || 0) >= 3) warn = t('silence').replace('{s}', (d.silentBlocks || 0) * 30);
      else if (staleMin >= 2) warn = t('stale').replace('{m}', staleMin);
      ui.sil.classList.toggle('on', !!warn);
      if (warn) ui.sil.textContent = warn;
      // Sessão parada com fechamento disponível (ou em geração): o painel de
      // contexto vira o resumo final — parar não descarta mais nada (2026-07-22).
      if (!d.active && (d.final || d.finalizing)) renderFinal(ui, d.final);
      else renderCtx(ui, d.context, !!d.active);
      ui.feed.innerHTML = '';
      const items = (d.digests || []).slice().reverse();
      if (!items.length) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = t('empty');
        ui.feed.appendChild(p);
        return;
      }
      for (const x of items) {
        const div = document.createElement('div'); div.className = 'zg-d' + (x.mention ? ' mention' : '');
        const tm = document.createElement('time');
        tm.textContent = new Date(x.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        div.appendChild(tm);
        const body = document.createElement('div');
        if (x.mention) {
          const mk = document.createElement('div'); mk.className = 'zg-mention';
          mk.textContent = t('mention');
          body.appendChild(mk);
        }
        body.appendChild(document.createTextNode(x.text));
        if (x.say && x.say.length) {
          const row = document.createElement('div'); row.className = 'zg-say';
          for (const sTxt of x.say) {
            const c = document.createElement('span'); c.className = 'zg-chip';
            c.textContent = '💬 ' + sTxt;
            row.appendChild(c);
          }
          body.appendChild(row);
        }
        div.appendChild(body);
        ui.feed.appendChild(div);
      }
    } catch (e) { ui.live.textContent = t('bridgeDown') + e.message; ui.live.classList.remove('on'); }
  }

  // Painel de contexto (camada Sonnet do bridge, ~2 em 2 min): resumo
  // acumulado + materiais do McGraw sobre o assunto + falas fundamentadas.
  function renderCtx(ui, ctx, active) {
    if (!ctx || !ctx.summary) {
      ui.ctx.innerHTML = '';
      const p = document.createElement('p'); p.className = 'zg-ctx-empty';
      p.textContent = active ? t('ctxWaiting') : t('ctxEmpty');
      ui.ctx.appendChild(p);
      return;
    }
    ui.ctx.innerHTML = '';
    const sum = document.createElement('div');
    sum.innerHTML = '<h4>📌 ' + t('ctxSum') + '</h4>';
    const sumTx = document.createElement('div'); sumTx.className = 'zg-ctx-sum';
    sumTx.textContent = ctx.summary;
    sum.appendChild(sumTx);
    ui.ctx.appendChild(sum);
    if (ctx.materials && ctx.materials.length) {
      const mat = document.createElement('div');
      mat.innerHTML = '<h4>📂 ' + t('ctxMat') + '</h4>';
      const list = document.createElement('div'); list.className = 'zg-ctx-mat';
      for (const m of ctx.materials) {
        const it = document.createElement('div'); it.className = 'm';
        it.innerHTML = '<b>' + escH(m.title || '') + '</b>' + escH(m.note || '');
        list.appendChild(it);
      }
      mat.appendChild(list);
      ui.ctx.appendChild(mat);
    }
    if (ctx.say && ctx.say.length) {
      const say = document.createElement('div');
      say.innerHTML = '<h4>💬 ' + t('ctxSay') + '</h4>';
      const row = document.createElement('div'); row.className = 'zg-say';
      for (const sTxt of ctx.say) {
        const c = document.createElement('span'); c.className = 'zg-chip';
        c.textContent = sTxt;
        row.appendChild(c);
      }
      say.appendChild(row);
      ui.ctx.appendChild(say);
    }
    if (ctx.updatedAt) {
      const at = document.createElement('div'); at.className = 'zg-ctx-at';
      at.textContent = t('ctxAt').replace('{t}', new Date(ctx.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      ui.ctx.appendChild(at);
    }
  }

  // Fechamento da reunião: resumo final + tópicos + ações + arquivos ligados,
  // com confirmação do que foi salvo onde e botão de copiar. Fica na tela até
  // a próxima sessão começar (o bridge guarda em lastFinal).
  function renderFinal(ui, fin) {
    ui.ctx.innerHTML = '';
    if (!fin) {
      const p = document.createElement('p'); p.className = 'zg-ctx-empty';
      p.textContent = t('finalizing');
      ui.ctx.appendChild(p);
      return;
    }
    const hm = new Date(fin.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const head = document.createElement('div');
    head.innerHTML = '<h4>' + t('finTitle') + ' · ' + hm + '</h4>';
    if (fin.agenda) {
      const ag = document.createElement('div'); ag.className = 'zg-ctx-at';
      ag.textContent = '📅 ' + fin.agenda.time + ' — ' + fin.agenda.title
        + (fin.agenda.tags && fin.agenda.tags.length ? ' · ' + fin.agenda.tags.join(' ') : '');
      head.appendChild(ag);
    }
    const sum = document.createElement('div'); sum.className = 'zg-ctx-sum';
    sum.textContent = fin.resumo;
    head.appendChild(sum);
    ui.ctx.appendChild(head);
    const sec = (title, items, line) => {
      if (!items || !items.length) return;
      const b = document.createElement('div');
      b.innerHTML = '<h4>' + title + '</h4>';
      const list = document.createElement('div'); list.className = 'zg-ctx-mat';
      for (const x of items) {
        const it = document.createElement('div'); it.className = 'm';
        if (line) it.textContent = line + x;
        else it.innerHTML = '<b>' + escH(x.title || '') + '</b>' + escH(x.note || '');
        list.appendChild(it);
      }
      b.appendChild(list);
      ui.ctx.appendChild(b);
    };
    sec('💡 ' + t('finTopics'), fin.topicos, '• ');
    sec('☑️ ' + t('finActions'), fin.acoes, '☐ ');
    sec('📂 ' + t('finMat'), fin.materials);
    const saved = document.createElement('div'); saved.className = 'zg-fin-saved';
    saved.textContent = t('finSavedAta').replace('{f}', fin.ata)
      + (fin.followups ? ' · ' + t('finSavedFu').replace('{n}', fin.acoes.length).replace('{f}', fin.followups) : '');
    ui.ctx.appendChild(saved);
    const cp = document.createElement('button'); cp.className = 'zg-copy';
    cp.textContent = t('finCopy');
    cp.onclick = () => {
      const txt = fin.resumo
        + (fin.topicos.length ? '\n\n' + t('finTopics') + ':\n' + fin.topicos.map((x) => '- ' + x).join('\n') : '')
        + (fin.acoes.length ? '\n\n' + t('finActions') + ':\n' + fin.acoes.map((x) => '- [ ] ' + x).join('\n') : '');
      navigator.clipboard.writeText(txt).then(() => { cp.textContent = t('finCopied'); setTimeout(() => { cp.textContent = t('finCopy'); }, 2000); }).catch(() => {});
    };
    ui.ctx.appendChild(cp);
  }

  // --- guia de comandos: parseia o COMANDOS.md (seções ## + tabelas) em
  // itens navegáveis. O arquivo segue sendo a única fonte de verdade.
  const SEC_ICON = [
    [/pergunta/i, '💬'], [/finan/i, '💰'], [/dia a dia/i, '📅'], [/nota/i, '📝'],
    [/pron[úu]ncia/i, '🎙️'], [/ingl/i, '🇺🇸'], [/reuni/i, '🎧'], [/mcgraw/i, '🏢'], [/encerrar/i, '👋'],
    [/clipboard/i, '📋'], [/autom[áa]tic/i, '🤖'], [/panos|arquitetura/i, '🔩'],
  ];
  const secIcon = (tt) => { for (const [re, ic] of SEC_ICON) if (re.test(tt)) return ic; return '⚡'; };
  const fmtCell = (s) => escH(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  function parseComandos(md) {
    const secs = [];
    let cur = null;
    for (const line of md.split('\n')) {
      const h = line.match(/^## +(.+)/);
      if (h) { cur = { title: h[1].trim(), items: [] }; secs.push(cur); continue; }
      const r = line.match(/^\|(.+)\|(.+)\|\s*$/);
      if (!r || !cur) continue;
      const cmd = r[1].trim(); const res = r[2].trim();
      if (cmd === 'Comando' || /^[-: ]+$/.test(cmd)) continue;
      cur.items.push({ cmd: cmd.replace(/^\+ */, ''), res, cont: cmd.startsWith('+') });
    }
    return secs.filter((s) => s.items.length);
  }

  function voiceHint(key) {
    const d = document.createElement('div'); d.className = 'zg-hint-voice';
    d.innerHTML = t('voicePrefix') + '<code>' + escH(VOICE[key]) + '</code>';
    return d;
  }

  function header(titleKey) {
    const wrap = document.createElement('div'); wrap.className = 'zg-h3';
    const h = document.createElement('h3'); h.textContent = t(titleKey);
    wrap.appendChild(h);
    return wrap;
  }

  window.BISA.screens.ziggy = {
    mount(el) {
      el.classList.add('zg-screen');

      // ── Masthead editorial: marca da tela + toggle de idioma ───────────
      const mast = document.createElement('div'); mast.className = 'zg-mast';
      const tw = document.createElement('div'); tw.className = 'tw';
      const eb = document.createElement('div'); eb.className = 'zg-eyebrow';
      eb.textContent = t('eyebrow');
      const ttl = document.createElement('h2'); ttl.className = 'zg-title';
      ttl.textContent = 'Ziggy';
      tw.appendChild(eb); tw.appendChild(ttl);
      const langBtn = document.createElement('button'); langBtn.className = 'zg-lang';
      langBtn.textContent = lang() === 'en' ? 'PT' : 'EN';
      langBtn.onclick = () => {
        localStorage.setItem('zg-lang', lang() === 'en' ? 'pt' : 'en');
        // Remonta NO LUGAR (a tela vive como sub-aba do Biso — BISA.go
        // navegaria pra rota standalone e tiraria o usuário da aba).
        const scr = window.BISA.screens.ziggy;
        scr.unmount(); el.innerHTML = ''; scr.mount(el);
      };
      mast.appendChild(tw); mast.appendChild(langBtn);

      // ── Herói: reunião ─────────────────────────────────────────────────
      // Tradução ao vivo (digests + chips) à esquerda; painel de contexto
      // (resumo acumulado + materiais do McGraw + falas fundamentadas) à
      // direita. ⛶ vira modo tela cheia p/ usar DURANTE a meeting.
      const tk = document.createElement('div'); tk.className = 'card zg-hero';
      const tkHead = header('tkTitle');
      const full = document.createElement('button'); full.className = 'zg-lang';
      full.textContent = t('full');
      full.onclick = () => {
        const on = tk.classList.toggle('full');
        full.textContent = on ? t('fullOff') : t('full');
      };
      tkHead.appendChild(full);
      tk.appendChild(tkHead);
      tk.appendChild(voiceHint('tg'));
      const live = document.createElement('div'); live.className = 'zg-live'; live.textContent = t('connecting');
      const tg = document.createElement('button'); tg.className = 'btn'; tg.textContent = t('tgOn');
      state.tgBtn = tg;
      const sil = document.createElement('div'); sil.className = 'zg-silence';
      const grid = document.createElement('div'); grid.className = 'zg-hero-grid';
      const feed = document.createElement('div');
      const ctx = document.createElement('div'); ctx.className = 'zg-ctx';
      grid.appendChild(feed); grid.appendChild(ctx);
      const ui = { live, sil, feed, ctx };
      tg.onclick = async () => {
        tg.disabled = true; tg.textContent = state.active ? t('tgStopping') : t('tgStarting');
        try {
          const d = await BISA.api('/ziggy/translate', { method: 'POST', json: { on: !state.active } });
          state.active = !!d.active;
          BISA.toast(state.active ? t('tgToastOn') : t('tgToastOff'));
        } catch (e) { BISA.toast(t('fail') + e.message); }
        tg.disabled = false;
        tg.textContent = state.active ? t('tgOff') : t('tgOn');
        tick(ui);
      };
      const tgRow = document.createElement('div'); tgRow.className = 'zg-row';
      tgRow.style.marginBottom = '12px';
      tgRow.appendChild(tg);
      tk.appendChild(tgRow); tk.appendChild(live); tk.appendChild(sil); tk.appendChild(grid);

      // ── Card McGraw: rituais do dia + clipboard entre Macs ─────────────
      // (fluxos definidos no bridge, POST /mcgraw — claude -p no cwd mcgraw).
      const mc = document.createElement('div'); mc.className = 'card zg-mc';
      mc.appendChild(header('mcTitle'));
      const mcGrid = document.createElement('div'); mcGrid.className = 'zg-mc-grid';
      const mcTa = document.createElement('textarea');
      mcTa.placeholder = t('mcPh');
      // Texto colado pode ser longo: a caixa cresce sozinha até ~45% da tela
      // (depois rola por dentro — resize por arrasto não funciona no iPad),
      // com contagem de chars e ✕ limpar quando há conteúdo.
      const mcTools = document.createElement('div'); mcTools.className = 'zg-row zg-ta-tools';
      const mcCount = document.createElement('span'); mcCount.className = 'cnt';
      const mcClear = document.createElement('button'); mcClear.className = 'btn ghost';
      mcClear.textContent = t('clear'); mcClear.style.display = 'none';
      mcTools.appendChild(mcCount); mcTools.appendChild(mcClear);
      function mcSync() {
        const n = mcTa.value.length;
        mcCount.textContent = n ? (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n) + ' chars' : '';
        mcClear.style.display = n ? '' : 'none';
        mcTa.style.height = 'auto';
        mcTa.style.height = Math.min(mcTa.scrollHeight + 2, Math.round(window.innerHeight * 0.45)) + 'px';
      }
      mcTa.addEventListener('input', mcSync);
      mcClear.onclick = () => { mcTa.value = ''; mcSync(); mcTa.focus(); };
      // Botões de clipboard: 1 toque puxa o que foi copiado no Mac corp (via
      // fila do biso run, ~10-30s) ou neste Mac (pbpaste) direto pro campo —
      // o campo continua editável para aparar antes de rodar o fluxo.
      const clipRow = document.createElement('div'); clipRow.className = 'zg-row';
      for (const [key, src] of [['clipCorp', 'corp'], ['clipLocal', 'local']]) {
        const b = document.createElement('button'); b.className = 'btn ghost'; b.textContent = t(key);
        b.onclick = async () => {
          b.disabled = true; const old = b.textContent; b.textContent = t('clipFetching');
          try {
            const d = await BISA.api('/ziggy/clipboard?src=' + src);
            if (!d.text) { BISA.toast(t('clipEmpty')); }
            else { mcTa.value = d.text; mcSync(); BISA.toast(t('clipOk') + ' (' + d.text.length + ' chars)'); }
          } catch (e) { BISA.toast(t('fail') + e.message); }
          b.disabled = false; b.textContent = old;
        };
        clipRow.appendChild(b);
      }
      const mcRow = document.createElement('div'); mcRow.className = 'zg-row';
      const mcSt = document.createElement('span'); mcSt.className = 'zg-st';
      const mcOut = document.createElement('div'); mcOut.className = 'zg-mc-out';
      const mcActRow = document.createElement('div'); mcActRow.className = 'zg-row';
      const mcCopy = document.createElement('button'); mcCopy.className = 'btn ghost'; mcCopy.textContent = t('copy');
      const mcSave = document.createElement('button'); mcSave.className = 'btn ghost'; mcSave.textContent = t('save');
      const mcSend = document.createElement('button'); mcSend.className = 'btn ghost'; mcSend.textContent = t('sendCorp');
      mcActRow.appendChild(mcCopy); mcActRow.appendChild(mcSave); mcActRow.appendChild(mcSend);
      const mcButtons = [];
      let mcBusy = false; let mcRaw = ''; let mcFlow = '';
      async function runFlow(flow, text, label) {
        if (mcBusy) return;
        mcBusy = true;
        for (const b of mcButtons) b.disabled = true;
        mcSt.textContent = label + t('thinking');
        try {
          const d = await BISA.api('/ziggy/mcgraw', { method: 'POST', json: { flow, text } });
          mcRaw = d.answer || ''; mcFlow = flow;
          mcOut.innerHTML = BISA.renderMarkdown(mcRaw);
          mcOut.appendChild(mcActRow);
          mcOut.classList.add('on');
          mcSt.textContent = '';
        } catch (e) { mcSt.textContent = t('fail') + e.message; }
        mcBusy = false;
        for (const b of mcButtons) b.disabled = false;
      }
      for (const flow of ['morning', 'daily', 'next', 'wrapup']) {
        const b = document.createElement('button'); b.className = 'btn';
        const lb = document.createElement('span'); lb.textContent = t(flow);
        const vh = document.createElement('span'); vh.className = 'zg-vh';
        vh.textContent = '🎤 ' + VOICE[flow];
        b.appendChild(lb); b.appendChild(vh);
        b.onclick = () => runFlow(flow, '', t(flow));
        mcButtons.push(b); mcGrid.appendChild(b);
      }
      for (const [key, flow] of [['slack', 'slack'], ['interpret', 'interpret'], ['statusB', 'status']]) {
        const b = document.createElement('button'); b.className = 'btn ghost'; b.textContent = t(key);
        b.onclick = () => {
          const v = mcTa.value.trim();
          if (!v) { BISA.toast(t('needText')); return; }
          runFlow(flow, v, t(key));
        };
        mcButtons.push(b); mcRow.appendChild(b);
      }
      mcCopy.onclick = () => {
        if (navigator.clipboard) navigator.clipboard.writeText(mcRaw);
        mcCopy.textContent = t('copied');
        setTimeout(() => { mcCopy.textContent = t('copy'); }, 1500);
      };
      // Caminho de volta do fluxo Slack: rascunho → clipboard do Mac corp.
      mcSend.onclick = async () => {
        if (!mcRaw) return;
        mcSend.disabled = true; mcSend.textContent = t('sending');
        try {
          await BISA.api('/ziggy/clipboard', { method: 'POST', json: { src: 'corp', text: mcRaw } });
          BISA.toast(t('sentCorp'));
        } catch (e) { BISA.toast(t('fail') + e.message); }
        mcSend.disabled = false; mcSend.textContent = t('sendCorp');
      };
      // Mesmo destino do fluxo por voz: nota no caderno (PKM inbox do bisa).
      mcSave.onclick = async () => {
        if (!mcRaw) return;
        mcSave.disabled = true;
        try {
          const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          await BISA.apiRaw(`/pkm/inbox?kind=file&name=${encodeURIComponent(`ziggy-mcgraw-${mcFlow}-${stamp}.md`)}`,
            mcRaw + `\n\n— Ziggy, fluxo "${mcFlow}" pela tela, ${new Date().toISOString()}\n`, 'text/markdown');
          BISA.toast(t('saved'));
        } catch (e) { BISA.toast(t('fail') + e.message); }
        mcSave.disabled = false;
      };
      const mcStRow = document.createElement('div'); mcStRow.className = 'zg-row';
      mcStRow.appendChild(mcSt);
      mc.appendChild(mcGrid); mc.appendChild(clipRow); mc.appendChild(mcTa); mc.appendChild(mcTools); mc.appendChild(mcRow);
      mc.appendChild(mcStRow); mc.appendChild(mcOut);

      // Card fila de PRs: lista via corp (busca manual — cada fetch é um job
      // na fila), análise inline, Approve LTMD com confirmação em 2 toques.
      const pr = document.createElement('div'); pr.className = 'card';
      pr.appendChild(header('prTitle'));
      const prBtn = document.createElement('button'); prBtn.className = 'btn'; prBtn.textContent = t('prFetch');
      const prSt = document.createElement('span'); prSt.className = 'zg-st';
      const prRow = document.createElement('div'); prRow.className = 'zg-row';
      prRow.appendChild(prBtn); prRow.appendChild(prSt);
      const prList = document.createElement('div'); prList.style.marginTop = '12px';
      pr.appendChild(prRow); pr.appendChild(prList);

      function prItem(p) {
        const d = document.createElement('div'); d.className = 'zg-pr';
        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = `${p.repo} #${p.number} · ${t('prBy')} ${p.author}`;
        const ttl2 = document.createElement('div'); ttl2.className = 'ttl'; ttl2.textContent = p.title;
        const acts = document.createElement('div'); acts.className = 'acts';
        const anl = document.createElement('div'); anl.className = 'anl';
        const bA = document.createElement('button'); bA.className = 'btn ghost'; bA.textContent = t('prAnalyze');
        bA.onclick = async () => {
          bA.disabled = true; bA.textContent = t('prAnalyzing');
          try {
            const r = await BISA.api('/ziggy/prs/analyze', { method: 'POST', json: { repo: p.repo, number: p.number } });
            anl.innerHTML = BISA.renderMarkdown(r.analysis || '');
            anl.classList.add('on');
          } catch (e) { BISA.toast(t('fail') + e.message); }
          bA.disabled = false; bA.textContent = t('prAnalyze');
        };
        // Approve em 2 toques: 1º arma (botão fica vermelho "confirmar?"),
        // 2º executa; desarma sozinho em 3.5s sem o segundo toque.
        const bOk = document.createElement('button'); bOk.className = 'btn ghost'; bOk.textContent = t('prApprove');
        let armed = null;
        bOk.onclick = async () => {
          if (!armed) {
            bOk.classList.add('arm'); bOk.textContent = t('prConfirm');
            armed = setTimeout(() => { armed = null; bOk.classList.remove('arm'); bOk.textContent = t('prApprove'); }, 3500);
            return;
          }
          clearTimeout(armed); armed = null;
          bOk.disabled = true; bOk.textContent = '…';
          try {
            await BISA.api('/ziggy/prs/approve', { method: 'POST', json: { repo: p.repo, number: p.number } });
            bOk.classList.remove('arm'); bOk.textContent = t('prApproved');
            BISA.toast(`${p.repo} #${p.number} ${t('prApproved')}`);
          } catch (e) {
            BISA.toast(t('fail') + e.message);
            bOk.disabled = false; bOk.classList.remove('arm'); bOk.textContent = t('prApprove');
          }
        };
        acts.appendChild(bA); acts.appendChild(bOk);
        d.appendChild(meta); d.appendChild(ttl2); d.appendChild(acts); d.appendChild(anl);
        return d;
      }

      prBtn.onclick = async () => {
        prBtn.disabled = true; prSt.textContent = t('prFetching');
        try {
          const d = await BISA.api('/ziggy/prs');
          prList.innerHTML = '';
          const prs = d.prs || [];
          if (!prs.length) {
            const pEmpty = document.createElement('p'); pEmpty.className = 'empty';
            pEmpty.textContent = t('prNone');
            prList.appendChild(pEmpty);
          } else {
            for (const p of prs) prList.appendChild(prItem(p));
          }
          prSt.textContent = '';
        } catch (e) { prSt.textContent = t('fail') + e.message; }
        prBtn.disabled = false;
      };

      // ── Card howsay 2.0: voz primeiro ──────────────────────────────────
      // Toque 🎤, fale em PT (motor BISO_DITADO/Whisper local), toque de novo
      // p/ parar → traduz sozinho → frase em inglês + ▶ ouvir (voz Kokoro,
      // /tts detecta o idioma). Digitar continua funcionando na mesma caixa.
      const hs = document.createElement('div'); hs.className = 'card zg-hs';
      hs.appendChild(header('hsTitle'));
      hs.appendChild(voiceHint('hs'));
      const hsBox = document.createElement('div');
      hsBox.className = 'zg-hs-box'; hsBox.contentEditable = 'true';
      hsBox.setAttribute('data-ph', t('hsPh'));
      const row = document.createElement('div'); row.className = 'zg-row';
      const mic = document.createElement('button'); mic.className = 'btn zg-mic'; mic.textContent = t('hsMic');
      const btn = document.createElement('button'); btn.className = 'btn ghost'; btn.textContent = t('hsGo');
      const st = document.createElement('span'); st.className = 'zg-st';
      row.appendChild(mic); row.appendChild(btn); row.appendChild(st);
      const out = document.createElement('div'); out.className = 'zg-out';
      const lab = document.createElement('b'); lab.textContent = t('sayThis');
      const txt = document.createElement('span');
      const copyRow = document.createElement('div'); copyRow.className = 'zg-row';
      const listen = document.createElement('button'); listen.className = 'btn ghost'; listen.textContent = t('hsListen');
      const copy = document.createElement('button'); copy.className = 'btn ghost'; copy.textContent = t('copy');
      copyRow.appendChild(listen); copyRow.appendChild(copy);
      out.appendChild(lab); out.appendChild(txt); out.appendChild(copyRow);
      hs.appendChild(hsBox); hs.appendChild(row); hs.appendChild(out);

      async function howsay() {
        const phrase = hsBox.innerText.trim();
        if (!phrase) return;
        btn.disabled = true; st.textContent = t('hsThinking');
        try {
          const d = await BISA.api('/ziggy/howsay', { method: 'POST', json: { phrase } });
          txt.textContent = d.english; out.classList.add('on'); st.textContent = '';
        } catch (e) { st.textContent = t('fail') + e.message; }
        finally { btn.disabled = false; }
      }
      // Ditado: quando a sessão termina (2º toque no 🎤 ou pausa longa),
      // traduz sozinho — zero digitação no meio da reunião.
      if (window.BISO_DITADO) {
        window.BISO_DITADO.bind(mic, () => hsBox, { onStop: () => { if (hsBox.innerText.trim()) howsay(); } });
      } else { mic.style.display = 'none'; }
      state.hsMic = mic;
      btn.onclick = howsay;
      hsBox.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') howsay(); });
      copy.onclick = () => {
        if (navigator.clipboard) navigator.clipboard.writeText(txt.textContent);
        copy.textContent = t('copied');
        setTimeout(() => { copy.textContent = t('copy'); }, 1500);
      };
      // ▶ ouvir: pronúncia da frase na voz Kokoro (cacheada por hash no Mac).
      listen.onclick = async () => {
        if (!txt.textContent) return;
        listen.disabled = true; listen.textContent = t('hsListenLoading');
        try {
          const r = await BISA.api('/tts', { method: 'POST', json: { texto: txt.textContent } });
          new Audio(r.url).play();
        } catch (e) { BISA.toast(t('fail') + e.message); }
        listen.disabled = false; listen.textContent = t('hsListen');
      };

      // Guias de bolso (acordeão 1-seção-por-vez + busca), um card por arquivo:
      // COMANDOS.md (falas da Echo) e FLUXOS.md (automações). O markdown do
      // bridge segue como fonte única — o card só parseia.
      function guideCard(titleKey, endpoint) {
        const card = document.createElement('div'); card.className = 'card';
        card.appendChild(header(titleKey));
        const gBtn = document.createElement('button'); gBtn.className = 'btn ghost'; gBtn.textContent = t('cmShow');
        const gBody = document.createElement('div'); gBody.className = 'zg-cmds';
        let loaded = false;

        function build(md) {
          // Linha de intro = primeiro parágrafo fora de heading (wake word, resumo).
          const hintLine = (md.split('\n').find((l) => l.trim() && !l.startsWith('#')) || '').trim();
          if (hintLine) {
            const hint = document.createElement('div'); hint.className = 'zg-hint';
            hint.innerHTML = fmtCell(hintLine);
            gBody.appendChild(hint);
          }
          const filter = document.createElement('input');
          filter.className = 'zg-filter'; filter.type = 'search';
          filter.placeholder = t('filterPh');
          gBody.appendChild(filter);
          const secs = [];
          for (const s of parseComandos(md)) {
            const elx = document.createElement('div'); elx.className = 'zg-sec';
            const h = document.createElement('button'); h.className = 'zg-sec-h';
            h.innerHTML = '<span class="ic">' + secIcon(s.title) + '</span><span>' + escH(s.title) + '</span>'
              + '<span class="n">' + s.items.length + '</span><span class="ch">▶</span>';
            const b = document.createElement('div'); b.className = 'zg-sec-b';
            const items = [];
            for (const it of s.items) {
              const d = document.createElement('div'); d.className = 'zg-it' + (it.cont ? ' cont' : '');
              d.innerHTML = '<div class="say">' + fmtCell(it.cmd) + '</div><div class="res">' + fmtCell(it.res) + '</div>';
              b.appendChild(d);
              items.push({ el: d, text: (it.cmd + ' ' + it.res).toLowerCase() });
            }
            h.onclick = () => {
              const open = elx.classList.contains('open');
              for (const o of secs) o.el.classList.remove('open');
              if (!open) elx.classList.add('open');
            };
            elx.appendChild(h); elx.appendChild(b);
            gBody.appendChild(elx);
            secs.push({ el: elx, items, nEl: h.querySelector('.n') });
          }
          filter.oninput = () => {
            const q = filter.value.trim().toLowerCase();
            for (const s of secs) {
              let vis = 0;
              for (const it of s.items) {
                const show = !q || it.text.includes(q);
                it.el.style.display = show ? '' : 'none';
                if (show) vis += 1;
              }
              s.el.style.display = vis ? '' : 'none';
              s.nEl.textContent = vis;
              if (q) s.el.classList.add('open'); else s.el.classList.remove('open');
            }
          };
        }

        gBtn.onclick = async () => {
          if (!loaded) {
            gBtn.disabled = true; gBtn.textContent = t('cmLoading');
            try {
              const d = await BISA.api(endpoint);
              build(d.md);
              loaded = true;
            } catch (e) { BISA.toast(t('fail') + e.message); }
            gBtn.disabled = false;
            if (!loaded) { gBtn.textContent = t('cmShow'); return; }
          }
          gBody.classList.toggle('on');
          gBtn.textContent = gBody.classList.contains('on') ? t('cmHide') : t('cmShow');
        };
        card.appendChild(gBtn); card.appendChild(gBody);
        return card;
      }

      // Card revisão semanal: dados da semana pré-agregados pelo servidor;
      // Diego responde 3 perguntas + 6 sliders → nota no caderno + série.
      const wk = document.createElement('div'); wk.className = 'card zg-hs';
      wk.appendChild(header('wkTitle'));
      const wkBtn = document.createElement('button'); wkBtn.className = 'btn ghost'; wkBtn.textContent = t('wkOpen');
      const wkBody = document.createElement('div'); wkBody.style.display = 'none';
      wk.appendChild(wkBtn); wk.appendChild(wkBody);
      wkBtn.onclick = async () => {
        if (wkBody.style.display !== 'none') { wkBody.style.display = 'none'; return; }
        wkBtn.disabled = true; wkBtn.textContent = t('wkLoading');
        try {
          const d = await BISA.api('/ziggy/weekly');
          wkBody.innerHTML = '';
          const agg = document.createElement('div'); agg.className = 'zg-wk-agg';
          const rows = [];
          if (d.envelopes && d.envelopes.length) rows.push(`<b>${t('wkEnv')}:</b> ` + d.envelopes.map((e) => `${e.label} ${e.pct}%`).join(' · '));
          if (d.peso && d.peso.length) rows.push(`<b>${t('wkPeso')}:</b> ` + d.peso.map((p) => `${p.kg}kg`).join(' → '));
          rows.push(`<b>${t('wkNotas')}:</b> ${d.notasSemana ? d.notasSemana.count : 0}`);
          const eng = Object.entries(d.ingles || {}).map(([k, v]) => `${k}:${v}`).join(' · ');
          if (eng) rows.push(`<b>${t('wkEng')}:</b> ${eng}`);
          if (d.custoSemanaUsd != null) rows.push(`<b>${t('wkCusto')}:</b> $${d.custoSemanaUsd}`);
          agg.innerHTML = rows.join('<br>');
          wkBody.appendChild(agg);
          const tas = [];
          for (const q of ['wkDoneQ', 'wkChangedQ', 'wkFocusQ']) {
            const lb = document.createElement('div'); lb.className = 'zg-hint'; lb.textContent = t(q);
            const ta = document.createElement('textarea');
            wkBody.appendChild(lb); wkBody.appendChild(ta); tas.push(ta);
          }
          const domWrap = document.createElement('div'); domWrap.className = 'zg-wk-dom';
          const sliders = [];
          for (const dn of t('wkDomains')) {
            const lb = document.createElement('span'); lb.textContent = dn;
            const sl = document.createElement('input'); sl.type = 'range'; sl.min = 1; sl.max = 5; sl.value = 3;
            const vv = document.createElement('span'); vv.className = 'v'; vv.textContent = '3';
            sl.oninput = () => { vv.textContent = sl.value; };
            domWrap.appendChild(lb); domWrap.appendChild(sl); domWrap.appendChild(vv);
            sliders.push([dn, sl]);
          }
          wkBody.appendChild(domWrap);
          const sv = document.createElement('button'); sv.className = 'btn'; sv.textContent = t('wkSave');
          sv.onclick = async () => {
            sv.disabled = true;
            try {
              const domains = {}; for (const [dn, sl] of sliders) domains[dn] = Number(sl.value);
              await BISA.api('/ziggy/weekly', { method: 'POST', json: {
                answers: { done: tas[0].value, changed: tas[1].value, focus: tas[2].value }, domains } });
              BISA.toast(t('wkSaved'));
              wkBody.style.display = 'none';
            } catch (e) { BISA.toast(t('fail') + e.message); }
            sv.disabled = false;
          };
          const svRow = document.createElement('div'); svRow.className = 'zg-row';
          svRow.appendChild(sv); wkBody.appendChild(svRow);
          wkBody.style.display = '';
        } catch (e) { BISA.toast(t('fail') + e.message); }
        wkBtn.disabled = false; wkBtn.textContent = t('wkOpen');
      };

      const fl = guideCard('flTitle', '/ziggy/fluxos');
      const cm = guideCard('cmTitle', '/ziggy/comandos');

      // Ordem do cockpit: masthead → reunião (herói) → dia de trabalho →
      // PRs → como falo → revisão semanal → guias.
      el.appendChild(mast);
      el.appendChild(tk); el.appendChild(mc); el.appendChild(pr); el.appendChild(hs);
      el.appendChild(wk); el.appendChild(fl); el.appendChild(cm);
      tick(ui);
      state.timer = setInterval(() => tick(ui), 5000);
    },
    unmount() {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
      if (state.hsMic && window.BISO_DITADO && window.BISO_DITADO.activeBtn() === state.hsMic) {
        window.BISO_DITADO.stopAll();
      }
      state.hsMic = null;
      const scr = document.querySelector('.zg-screen');
      if (scr) scr.classList.remove('zg-screen');
    },
  };
})();
