# Bisa — Desenho Completo do Sistema

Data: 2026-06-12 · Status: rascunho para aprovação · Autores: Diego + Claude

Este documento fecha o desenho do sistema ANTES de qualquer execução.
O cronograma derivado dele está em `CRONOGRAMA.md`.

---

## 1. Visão

Um cockpit pessoal no browser para a esposa do Diego, no estilo do myPKA
Cockpit (hub visual, planner do dia, journal em cards, grafo de conexões),
rodando sobre a engine do biso (Express + WebSocket + chokidar + parsers de
journal/rotinas/finanças), com uma sessão Claude própria operando na pasta de
dados dela.

Princípios herdados dos dois mundos:

- **A pasta é o banco** (biso/myPKA): markdown + JSON locais, legíveis sem o
  app. A IA mantém os arquivos; a UI visualiza e permite edição leve.
- **Claude como motor, não como protagonista** (Cockpit): a tela inicial é o
  dia dela, não um terminal. O chat existe e é forte, mas é uma aba.
- **Touch-first**: tudo dimensionado para iPad 11" e mouse no Windows.
  Estética calma (modo claro default), o oposto do Matrix do biso.
- **Usuária não-técnica**: zero terminal aparente, zero YAML cru, zero
  permission prompt assustador. Read-only por padrão, edição opt-in.

## 2. Decisões fechadas (com o Diego, 2026-06-12)

| Decisão | Escolha |
|---|---|
| Infra | Mac do Diego, segunda instância, porta **7778**, acesso LAN (Tailscale depois) |
| Codebase | **Repo novo** (`bisa/`), backend copiado do biso; frontend novo estilo Cockpit |
| Dados | **Híbrido**: formato biso (`codex/`) para journal/agenda/hábitos/finanças + pasta `pkm/` leve estilo myPKA (People/Projects/Documents) com frontmatter e `[[wikilinks]]` |
| Escopo v1 | 100% do sistema: Hub+planner, Journal+hábitos, Chat Claude embutido, Finanças dela, PKM+grafo, PWA |
| Processo | Desenhar tudo → cronogramar → executar de uma vez seguindo o cronograma |

## 3. Arquitetura

```
Mac do Diego
├── biso  (:7777)  — intocado
└── bisa  (:7778)
    ├── server.js (núcleo portado do biso: Express + WS + auth + chokidar)
    ├── lib/
    │   ├── llm/          ★ novo — motor de sessão Claude + política de uso
    │   ├── codex/        portado — parser/serializer journal, goals, agenda
    │   ├── routines/     portado — hábitos (EMA strength, streaks, heatmap)
    │   ├── finance/      portado — ledger JSONL, IRPF, Actual/Ghostfolio
    │   ├── pkm/          ★ novo — entidades, wikilinks, backlinks, grafo
    │   ├── planner/      ★ novo — blocos do dia, rollover, highlight, ICS
    │   └── push/         ★ novo — Web Push (VAPID) p/ PWA do iPad
    ├── public/           ★ novo — frontend Cockpit (vanilla JS, como o biso)
    └── scripts/bisa      CLI (clone do biso CLI, BISA_URL/BISA_TOKEN)

~/bisa-data/              ← pasta DELA (fora do repo, backup independente)
├── CLAUDE.md             ensina o Claude a manter o mundo dela
├── codex/journal.md      formato biso (briefing/goals/agenda/log/...)
├── codex/finance/*.jsonl + profile.json (perfil financeiro próprio)
├── .meta/routines.json   hábitos dela
├── .meta/planner.json    blocos do dia, highlight, weekly goals
├── pkm/
│   ├── People/ Projects/ Documents/   (frontmatter YAML + [[wikilinks]])
│   ├── Inbox/                          (ela arrasta arquivos/fotos aqui)
│   └── assets/AAAA-MM/                 (fotos do journal e anexos)
└── .env-free: nada sensível aqui dentro
```

Clientes: browser Windows (mouse) e iPad 11" (touch/PWA), via LAN.
O Diego pode abrir a mesma instância como **supervisor** (vide §8).

## 4. Motor LLM e política de uso (NOVO — obrigatório)

Contexto: em junho/2026 entra a nova política do Claude que impõe regras ao
uso de `claude -p` (headless) e ao uso da API; a família passa a ter
**créditos de API** utilizáveis em certos casos. O Bisa nasce com uma camada
de roteamento para respeitar isso sem reescrita futura.

**Aprendizado da pesquisa (lição omnara/sugyan):** wrappear o terminal (PTY +
parsing de ANSI) como interface principal é frágil — o ecossistema inteiro
migrou para `--output-format stream-json` / Agent SDK com chat estruturado.
O Bisa adota isso desde o dia 1.

Três vias de execução, roteadas por `lib/llm/policy.js` + `.env`:

| Via | Uso no Bisa | Backend |
|---|---|---|
| **Sessão interativa** | Aba Claude (chat dela), "Discuss with AI" contextual | `claude` da assinatura, spawnado com `--output-format stream-json` (PTY xterm só como aba avançada oculta, acessível pelo Diego) |
| **Jobs agendados** | Briefing 07:00, reflexão 21:00, síntese semanal, organização do Inbox | `claude -p` OU API com créditos — **configurável por job** em `.env` (`LLM_JOB_<nome>=claude-p|api|off`), default conforme as regras da política |
| **Micro-tarefas** | Título de sessão, parse de quick-add ambíguo, legendas | API (Haiku) com créditos — barato, sem ocupar a assinatura |

Regras de implementação:

1. Nenhuma chamada LLM hardcoded: tudo passa por `lib/llm/run(job, payload)`,
   que consulta a política e registra uso em `~/bisa-data/.meta/llm-usage.jsonl`
   (espelho do padrão `openrouter-usage.log` que o Diego já usa).
2. As regras específicas da política (o que pode em `claude -p`, o que deve
   ir para API) entram como configuração em `lib/llm/policy.js` com
   comentário citando a regra — **pendência: Diego fornece o texto da
   política antes da Fase 1** (item aberto §11).
3. Limites de gasto: teto mensal de créditos API em `.env`
   (`API_BUDGET_MONTHLY`), com aviso no painel do supervisor ao atingir 80%.

## 5. Modelo de dados

### 5.1 `codex/` (formato biso, parsers reaproveitados)

Idêntico ao biso: `journal.md` append-only com seções por dia, IDs estáveis
em comentários HTML; `routines.json` (hábitos, completions, skips, moods);
`finance/*.jsonl` + `profile.json`. Zero mudança de schema → zero mudança
nos módulos portados.

### 5.2 `.meta/planner.json` (novo)

```jsonc
{
  "days": {
    "2026-06-12": {
      "blocks": { "morning": ["t-a1..."], "afternoon": ["t-b2..."] },
      "highlight": "t-a1...",            // destaque do dia (slot único, maior)
      "events": []                        // cache ICS do dia (read-only)
    }
  },
  "week": { "2026-W24": { "goals": ["t-c3...", "t-d4..."] } },
  "tasks": { "t-a1...": { "text": "...", "done": false, "created": "...",
              "rolledFrom": null, "tags": [] } }
}
```

Regras (da pesquisa): rollover automático (não feito hoje → aparece amanhã
com marcador discreto, padrão Super Productivity); highlight do dia como slot
visual único (Make Time); metas da semana arrastáveis para blocos do dia
(padrão WeekToDo).

### 5.3 `pkm/` (novo, inspirado no myPKA mas leve)

- Entidades: `People/`, `Projects/`, `Documents/` — um `.md` por entidade,
  frontmatter YAML mínimo (sem GL-002 completo): `name`, `type`-específicos
  (ex.: `relation`, `status`, `photo`), `tags`. Slug kebab-case = nome do
  arquivo = chave estrangeira (regra herdada do myPKA).
- `[[wikilinks]]` no corpo conectam tudo (journal ↔ entidades ↔ entidades).
- `Inbox/`: ela solta fotos/PDFs; o job de organização (LLM) classifica,
  move para `Documents/`+`assets/` e cria a nota — espelho do Team Inbox
  do myPKA.
- **Sem o time Larry/agentes**: o `CLAUDE.md` da pasta dela contém as regras
  de manutenção (criar stub ao mencionar pessoa nova, manter links, nunca
  YAML ad-hoc) em ~1 página. A parte boa da metodologia, sem a cerimônia.
- Índice: `lib/pkm/index.js` varre com chokidar e mantém em memória o grafo
  (nós = entidades + dias do journal; arestas = wikilinks) e o índice de
  backlinks. **Tolerante a edição externa** (padrão flatnotes): qualquer
  mudança do Claude reindexa incrementalmente.

## 6. Backend — API (resumo dos contratos)

Portados do biso (mesmos contratos): `/codex/today|day|append|toggle`,
`/codex/routines/*`, `/finance/*`, `/fs/*`, `/file`, `/api/notify`, WS `fs:`.

Novos:

| Endpoint | Função |
|---|---|
| `GET /planner/day?date=` | blocos + tarefas + eventos ICS + highlight |
| `POST /planner/task` · `PATCH /planner/task/:id` | criar (quick-add) / editar / mover / done |
| `POST /planner/promote` | definir highlight / meta semanal |
| `GET /pkm/entity/:slug` | nota renderizada + frontmatter promovido + backlinks |
| `GET /pkm/graph?focus=&hops=1` | subgrafo local (ou global sem focus) |
| `GET /pkm/search?q=` | paleta de busca (entidades + journal full-text) |
| `POST /pkm/inbox` | upload (foto/arquivo) p/ Inbox ou assets do dia |
| `WS /llm` | sessão chat stream-json (eventos: text, tool_use, tool_result, permission_request) |
| `POST /llm/permission` | resposta da usuária ao card de permissão |
| `POST /push/subscribe` · jobs internos de push | Web Push VAPID |
| `GET /pair/qr` (rota do supervisor) | QR de pareamento de novo dispositivo |

## 7. Frontend

Vanilla JS (como o biso — sem build step), CSS com variáveis de tema
(padrão Glance: primary/positive/negative; claro default, escuro opcional).

### 7.1 Telas (navegação inferior por abas, estilo app)

1. **Hub** — agenda de hoje (eventos ICS read-only intercalados), blocos
   manhã/tarde com drag-and-drop de tarefas, highlight do dia em slot
   destacado, metas da semana, hábitos pendentes (toque único marca),
   notas fixadas. Widgets com `title` + `collapse-after` (Glance); layout
   fixo, SEM drag de widgets em touch (lição negativa Homarr).
2. **Journal** — timeline infinita estilo memos (hoje no topo, lazy load
   para trás), cards por dia com grade de fotos 2-3 colunas + lightbox com
   swipe, heatmap-calendário como navegação, seção **"Neste dia"**
   (mesmo dia em meses/anos anteriores — alto valor emocional, padrão
   Journiv/StoryPad).
3. **Mundo** (PKM) — listas de Pessoas/Projetos/Documentos como cards com
   frontmatter renderizado como campos legíveis ("promoted attributes" do
   TriliumNext — nunca YAML cru); página de entidade com **backlinks
   automáticos** (trechos do journal que a mencionam, padrão Logseq) e
   **mini-grafo local de 1 salto** (padrão Quartz); grafo global em tela
   cheia; popover de preview ao segurar um wikilink.
4. **Claude** — chat estruturado (bolhas; tool_use colapsável e traduzido
   para linguagem humana: "criei o arquivo X"), composer com voz (Web
   Speech API), upload de foto/arquivo, botões de ação prontos
   ("organizar meu Inbox", "resumir este documento") e menção `@arquivo`.
   Permissões viram cards aprovar/negar. Perfil de segurança restrito
   (tools perigosas off por default).

Transversais: paleta de busca global (botão fixo, padrão SilverBullet);
resumo de fim de dia ("Seu dia": feito/hábitos/rolou para amanhã, padrão
Super Productivity); quick-add com linguagem natural pt-BR simplificada
("amanhã 15h dentista" via regex, padrão Vikunja).

### 7.2 iPad / touch / PWA

- Breakpoints: 1194×834 (landscape) e 834×1194 (portrait); 1 coluna no
  portrait. Alvos de toque ≥44px; `touch-action: manipulation`.
- Drag-and-drop: **SortableJS** com `delayOnTouchOnly: true`,
  `delay≈180ms`, `ghostClass` visível — toque longo arrasta, toque curto
  rola (a decisão crítica de DnD em Safari/iPad).
- PWA: manifest + service worker; instalação guiada ("Compartilhar →
  Adicionar à Tela de Início"). **Web Push no iPad exige PWA instalada
  (iPadOS 16.4+) e gesto explícito** → botão "Ativar lembretes".
- Push usados para: lembrete de agenda/hábito, "Claude terminou/precisa
  de você" (deep-link para a aba), briefing pronto.

### 7.3 Bibliotecas (decididas na pesquisa)

| Necessidade | Escolha | Por quê |
|---|---|---|
| Drag-and-drop | SortableJS | vanilla, touch maduro, listas conectadas (manhã/tarde/semana) com `group` |
| Grafo | force-graph (vasturiano) | d3-force + canvas, feel Obsidian, pinch-zoom touch, ~50 linhas (escolha do Foam) |
| Heatmap | grade CSS 7×N própria | trivial, zero dependência (Cal-Heatmap só se precisar de mais) |
| Editor (edição leve) | textarea estilizada no v1 → Milkdown no v2 | v1 é 90% read-only (padrão Perlite); Milkdown é o upgrade WYSIWYG markdown-nativo round-trip |
| Markdown render | marked/markdown-it + sanitização (mesma do biso preview.js) | já provado no biso |
| Calendário Google | endereço secreto ICS + `node-ical` no servidor, cache 10-15min | zero OAuth; URL nunca vai ao browser; padrão Glance/Super Productivity |
| Hábitos | engine do biso (EMA strength já existe) + dia "skip" | matemática uHabits já implementada em `lib/routines` |

## 8. Segurança e acesso

- Token próprio (32 bytes, cookie 1 ano, comparação constant-time — código
  do biso). Instância separada = blast radius separado: o token dela não
  abre o biso do Diego e vice-versa.
- **Pareamento por QR** (padrão happy/AionUi): Diego abre rota de supervisor
  no Mac, gera QR com URL+token; ela escaneia no iPad → cookie setado.
- **Modo supervisor**: o Diego acessa a instância com um segundo token
  (role=supervisor) para assistir/assumir a sessão Claude dela (follow &
  takeover via broadcast WS, padrão happier), ver gasto de créditos API e
  auditar hooks. Invisível na UI dela.
- Claude dela roda com perfil restrito: settings da pasta `~/bisa-data`
  com allowlist de tools; `permission_request` vira card na UI (nunca
  auto-aprova bash/rm/web fora da pasta).
- Remoto (fase posterior): Tailscale nas máquinas dela — sem porta exposta.
- Backup: `~/bisa-data` entra no Time Machine; lembrete da armadilha
  iCloud "Keep Downloaded" se um dia ela quiser sync (lição do vídeo myPKA).

## 9. Integrações

- **Google Calendar dela**: ICS secreto → `lib/planner/ics.js` (node-ical,
  cache TTL 15min, expande RRULE). Read-only no v1; se um dia precisar
  criar evento: service account (sem OAuth interativo).
- **Finanças**: módulo `lib/finance` portado; perfil dela em
  `~/bisa-data/codex/finance/profile.json`. Actual/Ghostfolio são opcionais
  e só entram se ela precisar (containers já existem no Mac; multi-budget
  do Actual suporta um budget para ela). v1: ledger + visão simplificada
  de orçamento/objetivos.
- **Jobs agendados** (scheduler do biso portado): briefing 07:00,
  reflexão 21:00, semanal dom 20:00, organização do Inbox sob demanda —
  todos via `lib/llm/run()` (política §4).

## 10. Decisões de design tomadas da pesquisa (rastreabilidade)

1. Chat estruturado stream-json como modo principal; PTY só aba avançada —
   omnara (lição da migração), sugyan/claude-code-webui, claudecodeui.
2. Cards de permissão + perfil seguro — happy, claudecodeui.
3. QR pairing — happy, AionUi. 4. PWA + push com deep-link — happy.
5. Journal timeline + fotos em grade + heatmap — memos.
6. Backlinks automáticos nas entidades — Logseq. 7. Mini-grafo local — Quartz.
8. Frontmatter como campos legíveis — TriliumNext. 9. Reindex tolerante a
   edição externa — flatnotes. 10. Read-only por padrão — Perlite.
11. Rollover + retro diária — Super Productivity. 12. Highlight do dia —
   Make Time/WeekToDo. 13. Hub com collapse-after, sem drag de widget —
   Glance/Homarr. 14. Score EMA + skip — uHabits. 15. Quick-add NL — Vikunja.
16. SortableJS/force-graph/node-ical — análises comparativas dos agentes.

## 11. Itens abertos (bloqueiam fases específicas, não o cronograma)

| # | Item | Bloqueia | Dono |
|---|---|---|---|
| 1 | Texto/regras da nova política Claude (claude -p vs API, casos permitidos, créditos) | Fase 1 (lib/llm/policy.js) | Diego |
| 2 | URL ICS do Google Calendar dela | Fase 3 (agenda no Hub) | Diego/esposa |
| 3 | Nome real do app na UI ("Bisa"? outro?) + paleta de cores do gosto dela | Fase 2 (tema) | esposa |
| 4 | Escopo financeiro dela (só orçamento? investimentos? IRPF?) | Fase 6 | Diego/esposa |

## 12. Riscos e mitigações

- **Formato stream-json muda com updates do CLI** → camada `lib/llm`
  isola; testes de contrato com fixtures; PTY como fallback de emergência.
- **Mac dormindo quando ela usa** → `caffeinate`/Energy Saver + launchd
  KeepAlive (Fase 7); Tailscale depois para fora de casa.
- **Política Claude muda de novo** → tudo configurável por job (§4),
  nada hardcoded.
- **Ela não adotar** → v1 entrega o Hub primeiro na ordem de execução
  interna, sessão de onboarding com ela usando o iPad real (Fase 7),
  e o supervisor permite o Diego ajustar fino com feedback real.
