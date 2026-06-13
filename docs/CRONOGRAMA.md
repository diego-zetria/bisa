# Bisa — Cronograma de Implementação

Data: 2026-06-12 · Status: aguardando aprovação do Diego para execução.

Regras do processo (definidas pelo Diego):

1. Nada é executado antes deste cronograma ser aprovado.
2. Quando a execução começar, ela cobre **100% do sistema** descrito em
   `DESIGN.md`, seguindo as fases na ordem abaixo.
3. Cada passo tem um **verify** — a fase só fecha quando todos os verifies
   da fase passam. Formato: `passo → verify: critério observável`.
4. Desvios do desenho durante a execução são registrados na seção
   "Desvios" ao final deste arquivo (com motivo), nunca silenciosos.

Estimativas em **sessões de trabalho** (1 sessão ≈ um bloco contínuo de
implementação com Claude Code), não em datas.

---

## Fase 0 — Fundação do repo e dos dados (1 sessão)

| # | Passo | Verify |
|---|---|---|
| 0.1 | Criar repo `bisa/` (git init); copiar do biso: `server.js`, `lib/{bootstrap,fs-api,notify,codex,routines,finance,hooks}`, `scripts/biso`→`scripts/bisa`, testes de roundtrip | `npm install && npm test` verde no repo novo |
| 0.2 | Renomear superfícies BISO→BISA (env vars `BISA_URL/BISA_TOKEN`, cookie `bisa_token`, CLI) — mecânico, sem mudar lógica | `grep -ri biso lib/ server.js scripts/` retorna zero ocorrências funcionais |
| 0.3 | `.env` da instância: `PORT=7778`, `AUTH_TOKEN` novo, `CWD=~/bisa-data`; remover qualquer default apontando para caminhos do Diego | servidor sobe em :7778 com biso rodando em :7777 simultaneamente |
| 0.4 | Semear `~/bisa-data/`: estrutura do §5 do DESIGN (codex/, .meta/, pkm/ com 2-3 entidades exemplo, assets/), `CLAUDE.md` dela (~1 página, regras de manutenção PKM) | `bisa status` responde; journal de hoje criado; entidades exemplo legíveis |
| 0.5 | Limpar herança do Diego: `.meta/projects.json` zerado, rotinas vazias, finance/profile.json vazio | auditoria: nenhum dado do Diego na pasta dela |

## Fase 1 — Motor LLM (2 sessões) ← bloqueada pelo item aberto #1 (política)

| # | Passo | Verify |
|---|---|---|
| 1.1 | `lib/llm/session.js`: spawn `claude --output-format stream-json` na pasta dela; parse de eventos (text/tool_use/tool_result/permission_request); WS `/llm` com broadcast | fixture de sessão real reproduzida em teste de contrato |
| 1.2 | `lib/llm/policy.js`: roteamento por job (`claude-p` / `api` / `off`) via `.env`, com as regras da nova política Claude codificadas e comentadas | teste: cada job roteia conforme config; log em `.meta/llm-usage.jsonl` |
| 1.3 | `lib/llm/api.js`: cliente API Anthropic (créditos) p/ micro-tarefas (Haiku) e jobs configurados; teto `API_BUDGET_MONTHLY` com aviso a 80% | chamada de teste registra custo; estouro de teto bloqueia com erro claro |
| 1.4 | Permissões: `permission_request` → card via WS; `POST /llm/permission`; perfil restrito em `~/bisa-data/.claude/settings.json` (allowlist de tools) | bash perigoso pede aprovação; dentro da pasta flui sem fricção |
| 1.5 | Portar scheduler de jobs do biso → `lib/llm/run()` (briefing/reflexão/semanal/inbox) | `bisa loop run briefing --force` escreve `## briefing` no journal dela |
| 1.6 | Aba avançada PTY (xterm.js do biso) atrás de flag de supervisor | usuária não vê; Diego acessa com token supervisor |

## Fase 2 — Casca do frontend + tema + chat (2 sessões)

| # | Passo | Verify |
|---|---|---|
| 2.1 | `public/` novo: shell com navegação inferior (Hub/Journal/Mundo/Claude), tema claro via variáveis CSS (primary/positive/negative), tipografia legível, breakpoints iPad landscape/portrait | abrir no iPad real: navegação por toque fluida nas 4 abas vazias |
| 2.2 | Tela Claude: bolhas de chat, tool_use colapsável traduzido ("criei o arquivo X"), composer com upload de foto/arquivo e `@arquivo` autocomplete | conversa completa com a sessão dela, foto enviada chega na pasta |
| 2.3 | Cards de permissão aprovar/negar no chat | fluxo de permissão ponta a ponta no iPad |
| 2.4 | Voz no composer (Web Speech API; fallback: gravar e transcrever) | ditado em pt-BR vira prompt |
| 2.5 | Botões de ação prontos ("organizar meu Inbox", "resumir documento", "como foi meu mês?") | cada botão dispara o prompt certo com contexto |

## Fase 3 — Hub + planner (2 sessões) ← item aberto #2 (URL ICS) p/ 3.4

| # | Passo | Verify |
|---|---|---|
| 3.1 | `lib/planner/` + `.meta/planner.json` (schema §5.2): tasks CRUD, blocos manhã/tarde, highlight, metas da semana, rollover na virada do dia | testes de unidade do rollover e da promoção a highlight |
| 3.2 | Quick-add NL pt-BR ("amanhã 15h dentista #saúde") via regex; ambíguo → micro-tarefa LLM (política §4) | 10 frases de teste parseadas certo |
| 3.3 | Hub UI: widgets (agenda, blocos, highlight, metas, hábitos pendentes, fixadas) com `collapse-after`; SortableJS (`delayOnTouchOnly`, grupo semana↔manhã↔tarde) | arrastar meta da semana p/ bloco da tarde NO IPAD sem rolagem acidental |
| 3.4 | `lib/planner/ics.js`: ICS secreto + node-ical, cache 15min, eventos read-only intercalados | eventos do calendário real dela aparecem no dia certo (TZ correta) |
| 3.5 | Resumo de fim de dia ("Seu dia") + integração com reflexão das 21:00 | card aparece após 20h com dados reais do dia |

## Fase 4 — Journal visual + hábitos (2 sessões)

| # | Passo | Verify |
|---|---|---|
| 4.1 | Timeline infinita (hoje no topo, lazy load), card do dia com seções do codex renderizadas | scroll de 60+ dias seedados sem travar no iPad |
| 4.2 | Fotos: upload → `pkm/assets/AAAA-MM/` + embed no dia; grade 2-3 colunas + lightbox com swipe | foto tirada no iPad aparece no card do dia |
| 4.3 | Heatmap-calendário de navegação (grade CSS 7×N) + "Neste dia" (retrospectiva mesma data) | tocar célula abre o dia; "Neste dia" mostra entrada antiga seedada |
| 4.4 | Hábitos UI: linha por hábito com últimos 5-7 dias tocáveis, streak/strength (engine portada), skip que não quebra streak, heatmap por hábito | marcar/desmarcar/skip refletem na engine; mood diário registrável |
| 4.5 | Push (PWA): lembrete de hábito/agenda e "Claude terminou" com deep-link | push chega no iPad com PWA instalada (iPadOS 16.4+) |

## Fase 5 — Mundo (PKM) + grafo (2 sessões)

| # | Passo | Verify |
|---|---|---|
| 5.1 | `lib/pkm/index.js`: chokidar + índice incremental (entidades, wikilinks, backlinks, grafo em memória) tolerante a edição externa | Claude cria pessoa nova via chat → aparece na UI sem reload manual |
| 5.2 | Listas de Pessoas/Projetos/Documentos como cards; página de entidade com frontmatter promovido (campos legíveis, nunca YAML) | entidade exemplo renderiza com avatar/status/campos |
| 5.3 | Backlinks automáticos na página da entidade (trechos do journal com contexto + link p/ o dia) | mencionar pessoa no journal → trecho aparece na página dela |
| 5.4 | Grafo: force-graph — mini local 1 salto na entidade + global em tela cheia (pinch-zoom, tap navega) | navegação por toque no grafo no iPad |
| 5.5 | Paleta de busca global (entidades + full-text journal) com botão fixo | busca por nome e por palavra do journal retorna em <300ms |
| 5.6 | Popover de preview de wikilink (segurar/hover) | preview sem navegar |
| 5.7 | Job "organizar Inbox" (LLM, política §4): classifica arquivo de `pkm/Inbox/`, move, cria nota, linka | PDF solto no Inbox vira Documento linkado após o job |

## Fase 6 — Finanças dela (1-2 sessões) ← item aberto #4 (escopo)

| # | Passo | Verify |
|---|---|---|
| 6.1 | Onboarding do perfil dela (form simples → `finance/profile.json`) | perfil salvo, zero dados do Diego |
| 6.2 | Visão simplificada: orçamento mensal, objetivos com projeção, entradas via chat ("gastei 200 no mercado") registradas no ledger | lançamento por chat aparece no painel |
| 6.3 | (Condicional ao escopo) Actual budget próprio / investimentos / IRPF | conforme decisão do item #4 |

## Fase 7 — PWA, acesso, hardening e handoff (2 sessões)

| # | Passo | Verify |
|---|---|---|
| 7.1 | PWA completa: manifest, service worker, ícone, splash; fluxo guiado de instalação no iPad e no Windows | ícone na home do iPad abre fullscreen sem chrome do Safari |
| 7.2 | Pareamento QR (rota supervisor gera QR com URL+token) | iPad pareado em <30s sem digitar token |
| 7.3 | Modo supervisor: follow/takeover da sessão Claude, painel de créditos API, auditoria de hooks (lib portada) | Diego assiste sessão dela do Mac em tempo real |
| 7.4 | launchd: bisa + biso no boot, KeepAlive; `caffeinate`/energy p/ Mac acordado nos horários dela | reboot do Mac → ambos sobem sozinhos |
| 7.5 | Suíte de verificação: testes de contrato (stream-json, parsers, planner), teste manual roteirizado no iPad e no Windows | checklist completo verde |
| 7.6 | Onboarding real com a esposa (sessão guiada: instalar PWA, primeiro journal, primeiro hábito, primeira conversa com Claude) + ajustes de feedback | ela completa um dia de uso sem ajuda |
| 7.7 | Docs finais: `docs/OPERACAO.md` (backup, restart, troubleshooting) + atualizar DESIGN com desvios | docs revisados pelo Diego |

---

## Resumo e dependências

- Total: **14-15 sessões** em 8 fases. Caminho crítico: 0 → 1 → 2 → 3;
  Fases 4 e 5 podem intercalar após a 2; 6 e 7 fecham.
- Gate de início: aprovação do Diego + item aberto **#1 (política Claude)**
  resolvido (bloqueia a Fase 1; Fase 0 pode rodar antes dele).
- Critério de aceite global: todos os verifies verdes + onboarding 7.6
  concluído + zero ocorrências de dados do Diego na instância dela.

## Desvios do desenho (preencher durante a execução)

_(vazio — nenhum desvio registrado)_
