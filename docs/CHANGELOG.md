# bisa — Changelog de features

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
