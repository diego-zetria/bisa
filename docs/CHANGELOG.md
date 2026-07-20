# bisa — Changelog de features

## 2026-07-20 — ZIGGY: redesign cockpit de trabalho + Ticker de Reunião 2.0

A tela ⚡ Ziggy foi redesenhada com projeto (antes: 12 cards acumulados sem
layout). Identidade nova: cockpit de trabalho/reuniões em inglês. Decisões do
Diego: reunião é o herói; Nikin+Hábitos → Fit; agente de finanças → Finanças
(botão 🤖); ecossistema → Ajustes; journal removido (Caderno é o fluxo
principal). Ficaram: McGraw meu dia, PRs, clipboard, como-falo, revisão
semanal, guias.

- **Herói 🎧 Reunião** (`screens/ziggy.js` reescrito, 946→~700 linhas): grid
  2 colunas (feed de digests | painel de contexto), modo tela cheia ⛶,
  aviso de silêncio (3+ blocos descartados → "a reunião está tocando perto
  de mim?"), toggle PT/EN movido pro topo.
- **Camada de contexto no bridge** (alexa-claude-bridge server.js,
  `contextPass`): 1º passe ~1 min, depois a cada ~2 min (4 blocos) — Sonnet
  com read:true no MCGRAW_CWD devolve JSON {summary acumulado pt-BR,
  materials (até 3 docs nossos sobre o assunto), say (2 falas EN
  fundamentadas)}. Exposto em GET /digests (context, silentBlocks) — o proxy
  /ziggy/digests repassa sem mudança no bisa.
- **Resumo final** (`finishTranslation`): ao parar a tradução (iPad ou voz)
  com ≥3 blocos, Haiku resume os digests → meetings/<data>.md via meetLog.
- **Como falo 2.0**: contenteditable + 🎤 BISO_DITADO (onStop → traduz
  sozinho) + ▶ ouvir via POST /tts (Kokoro detecta idioma). Zero digitação.
- **Migrações**: fit.js ganhou Nikin Match + Hábitos (classes .ft-nk/.ft-hb);
  finance.js ganhou overlay do agente (🤖 no fin-month-nav, histórico
  `_agentLog` persiste, re-render pós-resposta); ajustes.js ganhou card
  Ecossistema Ziggy (refresh 60s, clearInterval no unmount).
- **Travas no bridge** (pós 1ª reunião real): gravação↔tradução se recusam
  (compartilham o BisaEar; pkill por bloco matava a gravação);
  TranslateStart/RadioStart por voz agora contam a sessão 'ipad' (loop duplo
  com pkill mútuo); POST /translate recusa com gravação ativa (409).
  EAR_MODE=mic no .env: captura pelo input padrão p/ reunião no Mac corp/TV.

## 2026-07-19 — FIN: Dashboards interativos (📊 no nav do mês, Claude design)

Novo board `screens/finance-dash.js` (botão 📊 na navegação do mês; volta com
←). Estética Claude: ivory #FAF9F5 / dark #1F1E1B (segue o tema noite),
números em serifa (Tiempos/Iowan/Georgia), terracotta, cards planos 1px.
SVG à mão, sem lib. Paleta categórica de 6 cores VALIDADA com o
validate_palette.js do skill dataviz (light e dark passam; CVD 6-8 coberto
com rótulo direto + gaps 2px).

- **GET /finance/dash?months=N** (lib/finance/api.js): série multi-mês
  (renda/gasto/saldo/byCategory/byBucket, pendentes fora) do ledger manual +
  totais do Actual (best-effort paralelo) + allocation/Fixed/Rest do perfil.
  Teste em tests/finance-api.test.js (6/6).
- **Tiles**: saldo (com % guardado da renda), entrou/saiu (▲▼ vs mês
  anterior), maior categoria — número herói em serifa.
- **Fluxo de caixa**: barras pareadas entrou×saiu por mês, 1 eixo, grade
  recessiva, banda no mês focado, rótulos diretos só no focado; tocar um mês
  FOCA o board inteiro (tiles/envelopes/donut re-renderizam).
- **Envelopes AUVP**: gasto vs alvo com a MESMA precedência da tela principal
  (fixa em R$ > allocationRest "resto da renda" > %); estouro = segmento
  vermelho + "⚠ estourou"; ≥85% = "◔ quase". **Liberdade é aporte**: acima do
  alvo = verde "✓ acima da meta", valor sempre verde (feedback do usuário no
  mesmo dia — ver memória finance-liberdade-e-aporte).
- **Para onde foi**: donut top-5 + outros (gaps 2px, total em serifa no
  centro), legenda com valores/%; cor por ENTIDADE com ranking fixo do
  período (trocar o mês não repinta).
- **Tendência por categoria**: 4 pequenos múltiplos (sparkline + total).
- **Drill**: tocar envelope/categoria/spark → card de lançamentos do mês
  focado (via /finance/summary cacheado); tooltip por marca em tudo
  (pointer + toque). Verificado no Playwright (light, dark, drill).

## 2026-07-19 — Rodada 6 do caderno: 5 melhorias dos vídeos de estudo (Copa)

Análise densa (179 frames, 6 agentes) dos 2 vídeos de 2026-07-19 18:21/18:31 —
sessão de ESTUDO (Copas 2026/2030/2034) com nota-viva no vault. Achados: ~29%
do tempo era espera com tela parada (texto só chegava por mensagem completa),
um turno "…" ficou 80s+ morto sem aviso, o trecho selecionado se perdia ao
fechar o preview (~24s de re-seleção), 0 escrita à mão real (tudo swipe no
teclado flutuante a ~16 wpm) e completações do pad alucinando programação.

1. **Streaming token a token** — `--include-partial-messages` no session.js:
   `stream_event` → `llm.text/llm.thinking` deltas; blocos das mensagens
   completas são pulados quando houve partials (dedup; fallback CLI antigo).
   HUD: Write/Edit de `.md` em voo vira "✍ escrevendo a nota · arquivo".
2. **Watchdog de turno morto** — 12s sem NENHUM evento do servidor → o card
   vira botão "⚠ sem resposta — tocar para reenviar" (mesmo texto, mesmo
   card); erro em card vazio agora renderiza DENTRO do card.
3. **Porta-trecho** — seleção → menu "▶ puxar o fio · ✎ escrever"; o trecho
   sobrevive num pill acima do rodapé quando a seleção colapsa; chip nasce
   dentro do preview da nota (antes ficava atrás do modal); chrome dos cards
   com `user-select:none`.
4. **Modo Estudo 📚 + nota fixada** — `/biso-chat/mode` + system prompt por
   turno (nota-guia sem pedir permissão, "✅ nota atualizada", fecha com
   a/b/c); última `.md` tocada vira pill 📌 no topo (preview em 1 toque);
   tabela cortada ganha pista "⇢ deslize".
5. **Previsão/chips no tema** — `/biso-predict` recebe `topic` (fim da última
   resposta) e framing neutro (não mais "agente de código"); resposta velha
   descartada se o rascunho mudou (fix chips "…ma sejam"); followups priorizam
   as ofertas de fechamento do Claude (único formato com conversão nos vídeos).
   Pad: traço acidental da Pencil descartado ao abrir, 🎤 espelho no cabeçalho
   (teclado flutuante cobria o Ditar), Ditar promovido, pill "🌐 resposta PT/EN".

## 2026-07-19 — Aba "⚡ Ziggy": voz (Alexa) + fluxos McGraw no iPad

Nova tela `screens/ziggy.js` + botão no nav: o Ziggy (alexa-claude-bridge,
:7788) entra no bisa pelo padrão das pontes — proxies `/ziggy/*` no server
(digests, howsay, translate, mcgraw, clipboard GET/POST, comandos, fluxos),
porta escondida, cookie autentica. Cards: **McGraw — meu dia** (7 fluxos de
trabalho → claude -p Sonnet no cwd do mcgraw via Biso `/agent/ask` com
`read:true`; saída em markdown com copiar / salvar no caderno / mandar pro
clipboard do Mac corp), **como falo em inglês?**, **ticker da reunião** com
liga/desliga da tradução, e dois guias em acordeão (COMANDOS.md e FLUXOS.md
do bridge, parseados — arquivo é a fonte). Tela bilíngue PT/EN
(`localStorage zg-lang`; EN treina o inglês do Diego) com a fala exata da
Echo dentro de cada botão (`🎤 "Ziggy, ask B B S …"`).

Integrações de sistema: clipboard dos dois Macs (pbpaste local; corp via
`biso run --on corp`, só no expediente), briefing automático seg–sex 08:45
(LaunchAgent do bridge → nota `ziggy-mcgraw-morning-<data>.md` no caderno →
anel amarelo no Echo) e handoff circular (wrapup grava
`followups/<data>-handoff-ziggy.md` no repo mcgraw; o morning seguinte lê).
Detalhe de implementação: fetches da tela usam `BISA.api`/`BISA.apiRaw`;
salvar no caderno reusa `/pkm/inbox?kind=file`. Deploy: só reload (tela é
estática); os proxies pedem restart do server.

## 2026-07-16 — Aba "✨ Evolução" no Biso (changelog interativo)

Nova sub-view no biso (`VIEWS` + `renderView` + `renderEvolucao` em `biso.js`)
que mostra a evolução do sistema numa timeline cronológica interativa, pro
Diego (não-dev) acompanhar. Fonte: **`public/changelog-feed.json`** — feed
AMIGÁVEL curado pelo Claude (área/emoji/tag/summary/detail), servido estático,
distinto do CHANGELOG.md técnico. **IMPORTANTE p/ sessões futuras: ao adicionar
feature nova, espelhe uma entrada no feed em linguagem simples.**

Cada cabeçalho de data leva uma pílula de tempo relativo (`relTime`): hoje/
ontem → 2–30 dias ("há N dias") → meses ("há N meses") → anos, ancorada na
meia-noite local (não escorrega pela hora). Testada nos limites (30d=dias,
31d=1 mês, 365d=1 ano).

UI: cabeçalho + filtro por área (chips), timeline com trilho vertical/pontos
coloridos por área, badge de área + tag (novo/correção), selo "novo" (≤10
dias), toque expande o `detail`. Botão "✨ Resumir pra mim" reusa o caderno:
monta um prompt com as 8 entradas recentes e chama `commitText` → o Claude
narra a evolução (é a "funcionalidade do Claude" pedida, sem custo por view).
Labels seguem `cadernoLang` (🌐); conteúdo do feed é PT.

**Pegadinha (achada no e2e):** `renderEvolucao` é chamado DIRETO pelos chips de
filtro/idioma, fora do `renderView` que limpa `contentEl` — sem um
`contentEl.innerHTML=''` no topo, cada filtro EMPILHAVA uma timeline nova
(13→26 itens). Toda sub-view re-renderizável por conta própria precisa limpar.
Verificado com Playwright: 10 entradas, 4 grupos de data, filtro isola a área
sem empilhar, expand abre o detail, Resumir troca p/ caderno + envia o prompt.
Deploy: só reload (biso.js/biso.css/json fora do shell do SW).


## 2026-07-16 — FIN: visual do item sem meta — iterações e decisão

Experimentei 3 alternativas ao anel neutro do item sem provisão; nenhuma
agradou o Diego, que pediu voltar ao anel. **Estado final = a v1** (anel `.free`
com "–", sub "R$ X · livre (sem meta)"). As tentativas descartadas (todas
revertidas, sem resquício no código): (a) disco de moeda com valor compacto
`compactBRL`; (b) minimalista sem círculo com barrinha de acento + valor herói;
(c) barra comparativa (peso do gasto no quadro, via `maxDone`). Aprendizado:
preferência do Diego é manter o anel; **não re-experimentar sem pedido dele**.

## 2026-07-16 — FIN fix: categoria sem provisão não é "estouro"

Bug relatado pelo Diego: item de custo sem valor provisionado (ex.: "diversos",
"roupinhas" com `amount:0`) mas com gasto aparecia como anel vermelho 100% +
"estourou R$ X". `_provRow` (`finance.js`) fazia `ratio = done>0 ? 1 : 0` e
`over = done > plan+0.005` — com `plan=0` isso é sempre estouro. Conceitualmente
errado: sem meta própria não há o que estourar; o teto real é o do envelope
(bucket), que já conta esse gasto.

Fix: flag `noPlan = !(plan>0)` → estado NEUTRO. Anel classe `.free` com "–"
(sem %), sub "R$ X · livre (sem meta)", sem vermelho. Itens COM meta seguem
iguais (%/restam/near/over). Verificado no app real: free (Roupinhas/Diversos),
over real preservado (Claude Max 107%, Comprinhas Gabi 143%), normais intactos.

Mesmo estado propagado à **vista expandida de lançamentos** (`_renderTxSublist`,
agora recebe `plan`/`done`): cabeçalho `.fin-bud-subhead` espelha o anel —
"livre (sem meta)" + botão "＋ definir meta" (abre `_manageMode`) quando sem
provisão; "R$ done de R$ plan · restam/estourou" quando há meta. Verificado:
Farmácia (com meta) mostra "restam R$ 134,11" sem botão; Diversos mostra livre
+ definir meta. NÃO afeta `_renderBucketTxs` (bucket sempre tem alocação).

**Não mexido de propósito:** o over de nível de BUCKET (`_envA`, ~linha 2410)
usa o mesmo padrão, mas ali 0-alocação-com-gasto É estouro real (orçou 0%,
gastou) — comportamento correto do método AUVP. Deploy: só reload.


## 2026-07-16 — FIN: campo US$ no avulso + toggle "🪙 Vai para investimento"

**Campo US$ sempre visível** (2ª iteração, pedido do Diego): no "+ Avulso",
para gasto OU receita, um campo "US$ (opcional)" converte pela cotação de
planejamento (`profile.fx.BRLperUSD`) e preenche o valor em R$ na hora
(hint "= R$ X (cotação Y)"). O ledger continua BRL-only; o US$ digitado vira
anotação automática na descrição — "Freelance (US$ 500)" — p/ rastreabilidade.
Sem cotação no perfil, o campo não aparece.


Feedback do Diego: ter que digitar categoria com sufixo `-lib` é encanamento
interno vazando pra UI. Agora o formulário "+ Avulso" (`finance.js`,
`_buildSheet`), quando o tipo é **Receita**, mostra o toggle
"🪙 Vai para investimento" (fora da renda do mês · cria o aporte junto):
- campo **US$ opcional** converte pela cotação de planejamento
  (`profile.fx.BRLperUSD`) e preenche o valor em R$;
- chips de **objetivo** (abertos: `current < target`; 1º pré-selecionado);
- no salvar: sufixa `-lib` na categoria por baixo dos panos (categoria padrão
  `freelance` se vazia) e cria o **aporte irmão** (expense, bucket liberdade,
  `goalId` + `creditGoal:true` — o servidor credita o objetivo convertendo
  p/ a moeda dele). Um formulário, um toque, dois lançamentos.

**Pegadinha:** dentro do `_buildSheet` a const `profile` só é declarada no
bloco de chips — código inserido ANTES dela precisa de cópia própria
(`prof`); referência direta dá TDZ e mata o sheet inteiro (achado no teste
e2e: botão "+ Avulso" existia, sheet não). Verificado com Playwright no app
REAL autenticado (BISA.api stubado p/ não gravar): payloads exatos dos 2
POSTs conferidos. Deploy: só reload (finance.js fora do shell do SW).


Registro por feature para sessões futuras (Claude ou humano) retomarem o
contexto sem reler diffs. Entradas mais novas no topo. Formato: o que é,
onde vive, decisões tomadas e pegadinhas — não o diff (isso é do git).

---

## 2026-07-15 — Rodada 5: segunda varredura do mesmo vídeo (4 gaps)

1. **Links externos com target=_blank** (`renderMarkdown`, app.js): tocar numa
   fonte da resposta navegava o PWA p/ fora do app (perdia o caderno). Âncoras
   `http(s)` de outro host ganham `_blank`+`noopener` pós-sanitize; mesmas do
   host e internas (`#`, [[slug]]) ficam como estão. **SW v23** (app.js é shell).
2. **Vídeo → backlog automático** (`lib/media/analyze-video.js`): ao fim da
   análise, a seção "Sugestões" do relatório vira entrada no
   `feedback/inbox.jsonl` (canal do Modo Anotar) com `status: 'review'` —
   o agente automático só processa `'open'`, então nada roda sozinho; o item
   espera a próxima sessão de melhorias. Sem seção Sugestões → não enfileira.
   Spawnado por vídeo (sem restart p/ valer).
3. **Dica dos comandos de voz** (biso.js): enquanto o 🎤 grava, o rótulo do
   dock rotaciona dicas a cada 7s ("apaga isso", "apaga tudo", "nova linha" —
   pt/en conforme o motor); volta ao rótulo normal no stop/close.
4. **Idioma de saída da limpeza** (`lib/ditado` + biso.js): `/ditado/limpar`
   aceita `lang` ('' mantém comportamento antigo); o write pad manda o 🌐 do
   caderno em TODAS as chamadas (chips, pós-ditado, prévia de pausa). Motivo:
   o modelo às vezes traduzia sozinho apesar do "NÃO traduza" (vídeo: "Let's
   go…" → "Vamos começar…") — agora a tradução é pedida e determinística,
   preservando nomes/termos (testado: fala mista → pt e → en, "entranha" e
   "churrasqueira" preservados).

Limitação conhecida (sem alavanca barata): ~10-20s de ToolSearch antes de cada
WebSearch — comportamento do CLI com tools deferidas, não do bisa.

Verificado: renderMarkdown REAL extraído do app.js + marked/purify vendorados
(5 âncoras, só externas marcadas); enqueueFeedback extraído e rodado contra
inbox temporário; harness Playwright (dicas pt/en + restauração; `lang` presente
nas duas chamadas de limpeza); curl no /ditado/limpar com token real.

---

## 2026-07-15 — Rodada 4 do caderno: 5 melhorias do vídeo de 2026-07-14

Gaps detectados re-analisando os frames de `RPReplay_Final1784072728.mp4`
(ditado EN mutilando "entranha" ~1min40; completions de GitHub numa pergunta
de culinária; 55s de espera cega no WebSearch; sem aviso de resposta pronta;
texto sujo até o fim do ditado). Implementações:

1. **Idioma do ditado** — botão `⇄ PT/EN` no write pad (`.wp-swap`, biso.js)
   só aparece com o 🎤 ativo e religa a MESMA sessão no outro idioma
   (`BISO_DITADO.restart`); detector `langLooksLike` no ditado.js (≥6 palavras,
   marcadores do outro idioma dominando → `onLangHint` 1×/sessão → toast +
   `.attn` no ⇄); glossário `--static-init-prompt` nos DOIS LaunchAgents
   whisper (com.bisa.stt/.stt-en — plists fora do repo; recarga = bootout +
   bootstrap, kickstart NÃO relê o plist).
2. **/biso-predict sem herança de assunto** (server.js) — rascunho <8 palavras
   não recebe history nem few-shot; prompt instrui confidence ≤25 sem assunto
   claro e completions só do próprio rascunho.
3. **Pílula thinking informativa** — `toolLabel(name, detail)` no biso.js:
   WebSearch → query, WebFetch → domínio, Read/Edit → arquivo, Bash →
   descrição. `detail` já vinha nos eventos `biso.llm.tool` (input da
   ferramenta). `.think-tool` ganhou max-width+ellipsis. No servidor,
   `TOOL_SUMMARY_PT` (lib/llm/session.js) também mostra query/domínio no chip
   do card.
4. **Bip de resposta pronta** — 2 notas quadradas (WebAudio) no `finalizeStream`
   quando a rodada durou >8s e a conversa por voz está off; AudioContext é
   criado/resumido no gesto do envio (`armDoneSound` no commitText — iOS).
   Toggle 🔔/🔕 no rodapé (`biso.done.sound`, default ligado).
5. **Prévia limpa em pausas de fala** — ditado.js dispara `onPause` a 3s de
   silêncio (1×/pausa; `PAUSE_HINT`); o write pad roda /ditado/limpar e mostra
   o resultado NO DOCK (`✦ …`, `.wp-live.clean`) — o quadro segue com o bruto
   (fonte do whisper). `render()` agora pula reescritas idênticas (silêncio
   re-manda o mesmo transcript e derrubaria a prévia via evento 'input').

**Verificado** com Playwright (harness com BISA/BISO_DITADO stubados dirigindo
o biso.js real): pílula com query/domínio/arquivo, bip só em rodada >8s,
toggle 🔕, swap aparece/some/attn, prévia limpa entra e cai com texto novo;
`langLooksLike` extraído do fonte e testado (6/6); /biso-predict com token
real: 4 palavras + history de repositórios → 15% e completions genéricas.

**Deploy:** biso.js/ditado.js/biso.css fora do shell do SW (reload basta);
server.js + lib/llm/session.js → kickstart com.bisa.server (feito); plists
stt → bootout/bootstrap (feito — atenção: bootstrap logo após bootout dá
"Input/output error"; esperar ~2s e repetir).

Interatividade touch nas tabelas/gráficos realçados, via UM listener delegado
no `document` por script (o HTML entra por `innerHTML` — handlers não viajam;
guarda `window.__nbtabSortWired`/`__nbchartWired` evita duplicar).
- **Ordenar** (`md-tables.js`): toque no `th` reordena o `tbody`. Coluna
  numérica ordena por `data-nbv` (valor cru salvo no realce) e começa DESC
  (maior primeiro); texto usa `localeCompare('pt')` e começa ASC; toques
  alternam. `aria-sort` + setas no CSS (⇅ tênue = affordance; ▲/▼ = estado).
  Barras/negrito viajam com as linhas; zebra (nth-child) recalcula sozinha.
- **Expandir** (`md-charts.js`): toque num gráfico com SVG clona a figure p/
  overlay fullscreen (`.nbchart-ov`, viewBox escala); qualquer toque fecha.
  Os tokens `--tab-*` são copiados COMPUTADOS p/ o clone — fora do
  `.biso-root` o remap do caderno se perderia e o overlay sairia na paleta
  errada. `--tab-card` novo (fundo do card; biso remapeia p/ --biso-surface).
  Stat tiles e links não expandem. Fade 180ms, off em reduced-motion.

Verificado com Playwright: sort desc→asc→alfabético (ordem das linhas
conferida), overlay abre/fecha, screenshot do overlay assentado (o 1º parecia
lavado — era só o fade pego no meio). Ordenação se perde se o stream repintar
o card (aceito). Deploy: SW v22 (style.css no shell).

---

## 2026-07-14 — Gráficos inline ```chart nas respostas (nível 2)

`public/md-charts.js` (novo) + wiring no `renderMarkdown` + CSS `.nbchart/.nbstat`
em `style.css` (indireção `--tab-*`; remap do biso ampliado p/ `.nbchart`).
Fence ```chart com JSON vira SVG nativo, sem lib:
`{"type":"bar|line|donut|stat","title","unit","data":[["rótulo",123],…]}`.
- **bar**: horizontais, rótulo à esquerda, valor na ponta (data-bar);
- **line**: 2px + pontos com `<title>`, rótulos seletivos (todos ≤6; senão
  primeiro/último/máximo), extremos ancorados p/ dentro (middle cortava);
- **donut**: ≤6 fatias (excedente vira "outros"), alphas escalonados da cor
  do tema + legenda nome/% — identidade pelos rótulos, nunca só pela cor;
- **stat**: tiles de KPI (valor pode ser string).
Spec inválida (JSON quebrado, barra negativa, >24 itens) → o `<pre>` fica
como está. Formatação pt-BR; não-inteiros <100 mantêm 1 decimal (85,4 kg).

**Convenção do agente:** seção "Gráficos inline" no CLAUDE.md do caderno-geral
(arquivo vivo em `~/bisa-data/caderno-geral/CLAUDE.md` + seed no `server.js` —
os DOIS devem andar juntos). Regras: 3–8 itens; muitos números → tabela normal;
NUNCA inventar valores p/ caber no gráfico. Só o foco Geral tem a convenção —
outros focos (projetos do biso) precisariam dela nos próprios CLAUDE.md.

**Deploy:** SW v21 (app.js/style.css no shell). Verificado com Playwright:
4 tipos + 2 specs inválidas + screenshots dark/cream/excel; clipping checado
via getBBox.

---

## 2026-07-14 — Tabelas realçadas nas respostas do agente (nível 1)

`public/md-tables.js` (novo, fora do shell do SW) + wiring no `renderMarkdown`
(`app.js`) + CSS em `style.css`/`biso.css`. Determinístico, sem LLM: qualquer
tabela do markdown ganha, por coluna numérica detectada:
- alinhamento à direita + `tabular-nums`; zebra sutil; cabeçalho destacado;
- **barras proporcionais** atrás do número (estilo data-bar do Excel,
  ancoradas à esquerda) quando a coluna é 100% escalar, sem negativos, com
  variação e não parece ano (int 1900–2100);
- **máximo** da coluna: negrito + barra mais forte;
- sinal semântico: negativo (−) vermelho, positivo explícito (+) verde;
- faixas ("52-54 °C") só alinham — sem barra.
Parser aceita pt-BR e en (R$ 1.234,56 / 1,234.56), unidades (%, °C, kg, min…).

**Decisões (skill dataviz):** cor única recessiva da paleta do tema
(`--tab-accent` = primary a 16%/30% alpha), NUNCA matiz por valor; texto sempre
em tokens de tinta; verde/vermelho só p/ sinal real. Indireção `--tab-*`
(accent/neg/pos/head/ink/line) remapeada em `.biso-root` — pegadinha achada em
screenshot: cabeçalho usava `--surface-2` global e quebrava contraste com
caderno escuro sobre app claro; por isso head/ink/line também são indirecionados.
Nível 2 planejado (não feito): fence ```chart → SVG inline via convenção no
CLAUDE.md do agente.

**Deploy:** SW bump v20 (app.js/style.css no shell). Verificado com Playwright
(marked real): 5 casos funcionais + screenshots em cream/dark/excel/matrix.

---

## 2026-07-14 — Fix: ~ solto riscava texto (marked del de til simples)

O marked vendorado trata `~um til~` como strikethrough; o Claude usa `~` p/
"aproximadamente" (~230 °C, ~15 min), então respostas apareciam riscadas
(visto em vídeo do iPad, seção "🔥 Fogo" de uma receita). Fix em `app.js`
(antes de `renderMarkdown`): `marked.use({tokenizer:{del}})` aceitando SÓ
`~~duplo~~`; um `~` solto é consumido como texto (retornar `false` cairia de
volta no tokenizer padrão — pegadinha da API do marked). Código em code-span
(`~/caminhos`) não é afetado. Testado contra o marked.min.js real (4 casos).

**Deploy:** `app.js` e `style.css` estão no SHELL do service worker
(cache-first) — mudanças neles SÓ chegam ao iPad bumpando `CACHE` no `sw.js`
(v19). biso.css/screens/* ficam fora do shell e não precisam.

---

## 2026-07-10 — Aparência "🧮 Planilha" (Excel) + saldo verde vivo

**Planilha.** Nova aparência fixa em Ajustes (junto de Sistema/Claro/Escuro),
pedida pela Gabriela: o creme do tema claro não era "branco o bastante".
Tokens em `style.css` (`:root[data-appearance="excel"]`): fundo/cards brancos
puros, texto #1f1f1f, verde do ribbon do Excel (#107c41) como primary e
positive, vermelho contábil (#c00000), preenchimento de célula #e2efda,
cantos menores (radius 8/6) e gridlines fantasma no `body` (grade 28px).
Registrada em `ajustes.js` (`APPEARANCES`, id `excel`).

**Pegadinha coberta:** a media query de dark usava
`:root:not([data-appearance="light"])` — num aparelho em dark mode ela
VENCERIA o tema excel por especificidade. Corrigido para
`:not([data-appearance="light"]):not([data-appearance="excel"])`; verificado
com Playwright emulando `prefers-color-scheme: dark` (o iPad dela é dark).
Toda aparência nova precisa entrar nesse `:not()`.

**Saldo verde.** O saldo do mês no hero do FIN (positivo) trocou o sage
`--positive` por um verde vivo `#2f9e63` local (`finance.js`, CSS do hero) —
o resto do app continua no sage. Negativo segue terracota.

---

## 2026-07-10 — Pílula "thinking" v2: as 5 melhorias implementadas

As 5 melhorias recomendadas da entrada anterior foram TODAS implementadas no
mesmo dia (mesmos arquivos: `paintRunStatus`/vizinhos em `public/screens/biso.js`
e o bloco da pílula em `public/biso.css`). Verificado de ponta a ponta com
Playwright dirigindo o `biso.js` REAL (BISA stubado + eventos `biso.llm.*`
injetados; relógio falso p/ fixar sprite e pular p/ 60s).

1. **Frases por ferramenta** — `TOOL_MSGS` (pt/en) com famílias read/bash/
   web/edit; `toolMsgKey()` classifica `curTool` por regex (cobre `mcp__*`).
   Sem ferramenta → `THINK_MSGS` genéricas.
2. **Elenco de sprites** — `THINK_SPRITES = ['', 'ghost', 'slime', 'mago']`,
   sorteado por rodada via `Math.floor(runT0/1000) % 4` (estável durante a
   rodada). CSS: `.think-inv.ghost/.slime/.mago` trocam `animation-name` +
   box-shadow base; keyframes `ghost/slime/mago-frames`.
3. **Turbo após 60s** — classe `.turbo` na pílula (toggle por tick): frames e
   bob 2× mais rápidos + frases de paciência (`SLOW_MSGS`) assumem o rótulo.
4. **Explosão no done** — `boomStatus()` chamado no `finalizeStream` (só no
   done; erro/interrupt não celebram): `.think-boom` com 3 frames discretos
   em `boom-frames` (.4s, step-end, forwards), removido por timeout de 520ms.
   Respeita `prefers-reduced-motion` (checado no JS).
5. **Easter egg de pontos** — toque no sprite = +10 (`tapSprite()`): pulo
   `.hit`, "+10" flutuante (`.think-plus`), placar `.think-score`
   ("30 · hi 30") e recorde por dispositivo em `localStorage['biso.inv.hi']`.
   Pontos zeram por rodada. Alvo de toque ampliado p/ 34×28 (padding 6px +
   margin -6px + `box-sizing: content-box` — o style.css global é border-box;
   o `::before` compensa com `left/top: 6px`).

**Pegadinhas novas.** Os keyframes por sprite duplicam o frame A no base do
`::before` (fallback reduced-motion) — regenerar com o mesmo esquema de grid
ASCII se redesenhar. `.think-inv.hit` re-declara o shorthand `animation`
(inv-hit + inv-bob juntos) — se mudar o bob, mudar lá também. O boom vive no
`nbStatus` DEPOIS do `setStatus('idle')` limpar a pílula (ordem importa no
`finalizeStream`).

---

## 2026-07-10 — Pílula "thinking" retrô no caderno (invasor 8-bit)

**O que é.** A pílula de status do caderno (aba Biso), mostrada enquanto o
Claude pensa/responde, trocou o orbe pulsante por um invasor de Space
Invaders em pixel art com frases de fliperama girando. O cronômetro e a
ferramenta corrente (`curTool`) continuam na pílula.

**Comportamento.**
- Sprite 11×8 (2 frames clássicos, braços abrem/fecham) alternando a cada
  0,5s + bob vertical de 2px. Estado `starting` mostra "INSERT COIN".
- Rótulo gira a cada 5s entre 8 frases retrô-gamer ("comendo os pontinhos",
  "rolando 1d20", "fugindo dos fantasmas"…), no idioma do 🌐 do caderno
  (listas `THINK_MSGS.pt`/`.en`).
- `prefers-reduced-motion`: sprite congela no frame A, shimmer do rótulo
  desliga (bloco de media query já existente, só ampliado).

**Onde vive.**
- `public/screens/biso.js` — `THINK_MSGS` + `paintRunStatus()` (logo acima
  de `commitText`). O índice da frase deriva dos segundos decorridos
  (`Math.floor(sec/5) % msgs.length`) usando o tick de 1s que já existia —
  nenhum timer novo.
- `public/biso.css` — bloco "pílula thinking": `.think-inv` (wrapper 22×16px)
  e `.think-inv::before` (pixel 2×2 que pinta o sprite inteiro via
  `box-shadow`), keyframes `inv-frames` e `inv-bob`.

**Decisões e porquês.**
- Sprite em `box-shadow` puro (2px por pixel, sem imagem/fonte externa):
  pinta com `currentColor` herdado de `--biso-primary`, então cada tema
  colore o próprio invasor de graça (azul no papel, verde no matrix/deck,
  amarelo no contraste). Verificado por screenshot nos 3 temas.
- `animation-timing-function: step-end` nos dois keyframes: os frames têm
  contagens de sombra diferentes (46 vs 44) e interpolar box-shadow entre
  eles deformaria o sprite; step-end troca de vez.
- Regra pré-existente mantida: o DOM da pílula é montado UMA vez e só o
  texto é atualizado por tick — recriar reiniciaria as animações CSS a cada
  segundo (comentário no próprio `paintRunStatus`).
- Frases geradas por tempo decorrido (determinístico), não por
  `setInterval` próprio — sobrevive a repaints e não vaza timer.

**Pegadinhas para quem for mexer.**
- Os dados dos frames aparecem 2× no CSS (base do `::before` = frame A para
  o fallback de reduced-motion, e dentro de `inv-frames`). Se redesenhar o
  sprite, atualizar os dois lugares. Os box-shadows foram gerados por
  script (grid ASCII → `node -e`), não à mão — mais fácil regerar que editar.
- `.think-lbl` tem `text-transform: uppercase`; as frases são escritas em
  minúsculas nas listas.
- Deploy: só arquivos estáticos — reload da página no iPad basta, sem
  restart do LaunchAgent.

**Próximas 5 melhorias recomendadas (em ordem).** *(TODAS implementadas — ver
a entrada "Pílula thinking v2" acima.)*
1. **Frases cientes da ferramenta** — quando `curTool` está ativo, girar
   frases contextuais em vez das genéricas ("cavando os arquivos" p/
   Read/Grep, "conjurando bash" p/ Bash, "explorando a masmorra" p/ web).
   Tudo já passa por `paintRunStatus()`; é um mapa ferramenta→frases.
2. **Elenco de sprites** — fantasma, slime e mago além do invasor; sorteia
   um por run (ou fixa por tema do caderno). Gerar os grids ASCII com o
   mesmo script `node -e` e virar classes `.think-inv.ghost` etc.
3. **Reação ao tempo** — a partir de ~60s a animação acelera
   (`animation-duration` menor via classe) e entram frases de paciência
   ("o chefe da fase demorou…"); sinaliza lentidão sem o usuário precisar
   ler o cronômetro. O `sec` já está calculado no tick.
4. **Micro-celebração no fim** — explosão pixelada de ~400ms (frame único
   de estilhaços + fade) quando chega `biso.llm.done`, antes da pílula
   sumir. Hoje `finalizeStream()` → `setStatus('idle')` limpa na hora;
   precisaria de um estado curto "done" antes do idle.
5. **Easter egg tocável** — tocar no invasor soma pontos num placar
   discreto (`+10`, high-score em `localStorage`), tipo o dino do Chrome.
   Diversão pura; usar `onTap` já existente e não interferir no ■ parar.
