# Pílula "thinking" do caderno (aba Biso) — arcade 8-bit

Enquanto o Claude pensa/responde no caderno, o rodapé mostra uma pílula com
um sprite de pixel art animado, frases de fliperama girando, a ferramenta
corrente e o cronômetro. Tudo frontend puro (sem imagem, sem lib, sem
backend): sprites desenhados em `box-shadow`, animados com `step-end`.

## Comportamento

| Momento | O que aparece |
|---|---|
| `starting` | "INSERT COIN" |
| `running` (sem ferramenta) | frases genéricas girando a cada 5s ("comendo os pontinhos", "rolando 1d20"…) |
| `running` (ferramenta ativa) | frases da família da ferramenta: read → "cavando os arquivos", bash → "conjurando bash", web → "explorando a masmorra da web", edit → "forjando o código" |
| ≥ 60s | classe `.turbo` (animações 2× mais rápidas) + frases de paciência ("o chefe da fase demorou…") |
| `done` | explosão pixelada de ~0,4s (`.think-boom`), depois o rodapé esvazia |
| erro / interrupt | sem celebração — a pílula só some |

- **Sprite por rodada**: invasor, fantasma, slime ou mago — sorteado por
  `Math.floor(runT0/1000) % 4` (estável durante a rodada, muda entre rodadas).
- **Idioma**: as frases seguem o 🌐 do caderno (`THINK_MSGS`/`TOOL_MSGS`/
  `SLOW_MSGS` têm listas `pt` e `en`). "insert coin" é universal.
- **Easter egg**: tocar no sprite dá +10 — pulo `.hit`, "+10" flutuante e
  placar "30 · hi 30" na pílula. Pontos zeram por rodada; o recorde fica em
  `localStorage['biso.inv.hi']` (por dispositivo).
- **Reduced motion**: sprites congelam no frame A, shimmer desliga, boom é
  pulado no JS.

## Onde vive

- `public/screens/biso.js` — bloco acima de `commitText`:
  - `THINK_MSGS` / `TOOL_MSGS` / `SLOW_MSGS` — as listas de frases (pt/en);
  - `toolMsgKey(name)` — classifica `curTool` na família de frases (regex,
    cobre nomes `mcp__*`);
  - `THINK_SPRITES` + `paintRunStatus()` — monta a pílula UMA vez por rodada
    e só atualiza texto/tempo por tick (recriar reiniciaria as animações CSS);
  - `tapSprite()` — easter egg; `boomStatus()` — explosão (chamada no
    `finalizeStream`, DEPOIS do `setStatus('idle')` limpar o rodapé — a ordem
    importa).
- `public/biso.css` — seção "pílula thinking": `.biso-think`, `.think-inv`
  (+ variantes `.ghost/.slime/.mago`), keyframes `*-frames`, `inv-bob`,
  `.turbo`, `.think-score/.think-plus/.hit`, `.think-boom`/`boom-frames`.

## Como os sprites são feitos

Cada sprite é um grid ASCII 11×8 (2 frames) convertido em lista de sombras
`box-shadow` (2px por pixel) por um script `node -e` descartável — ver o
gerador de exemplo na entrada de 2026-07-10 do `docs/CHANGELOG.md`. Regras:

- pintam com `currentColor` (herdado de `--biso-primary`) → cada tema colore
  o sprite de graça;
- troca de frame com `animation-timing-function: step-end` — box-shadow entre
  frames com contagens diferentes NÃO pode interpolar;
- o frame A aparece 2×: no `box-shadow` base do `::before` (fallback do
  reduced-motion) e no keyframe `0%` — atualizar os dois se redesenhar;
- alvo de toque do sprite: 34×28 via `padding: 6px; margin: -6px;
  box-sizing: content-box` (o style.css global é border-box) + `::before`
  deslocado `left/top: 6px`.

## Como estender

- **Nova frase**: acrescentar nas listas pt E en. Minúsculas — o CSS sobe
  p/ caixa alta.
- **Nova família de ferramenta**: novo grupo em `TOOL_MSGS.pt/.en` + um caso
  em `toolMsgKey()`.
- **Novo sprite**: grid ASCII → gerar sombras → classe `.think-inv.<nome>`
  (base + `animation-name`) + `@keyframes <nome>-frames` + entrada em
  `THINK_SPRITES`.

## Verificação (como foi testado)

Playwright dirigindo o `biso.js` REAL num harness com `window.BISA` stubado
(api/onWs/wsSend/toast/renderMarkdown), montando a tela e injetando eventos
`biso.llm.*` pelo handler capturado em `onWs`. Truques que funcionaram:

- `Date.now` falso (base + offset) p/ fixar o sorteio do sprite e pular p/
  60s+ sem esperar;
- `animation-play-state: paused` injetado via `<style>` p/ screenshots
  estáveis de frames;
- `setTimeout` neutralizado temporariamente p/ fotografar o boom (o cleanup
  de 520ms ganha do roundtrip do screenshot);
- upscale 4× com `flags=neighbor` (ffmpeg) p/ conferir pixel art.

## Deploy

Só arquivos estáticos — reload da página no iPad (PWA: matar e reabrir).
Sem restart do LaunchAgent.
