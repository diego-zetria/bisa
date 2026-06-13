# bisa — Contratos de API e WS (fonte de verdade entre backend e frontend)

Todos os endpoints exigem auth (`x-bisa-token` header ou cookie `bisa_token`),
exceto `/healthz`. Respostas JSON. Erros: `{ error: "msg" }` + status HTTP.

## Herdados do biso (já montados, contratos inalterados)

- `GET /codex/today` · `GET /codex/day?date=` · `POST /codex/append {text,tags}`
  · `POST /codex/toggle {id}` · goals/agenda/notes/workday — ver lib/codex/api.js
- `GET /codex/routines/day?date=` · `GET /codex/routines/heatmap?days=` ·
  `POST /codex/routines` · `PATCH /codex/routines/:id` · `POST /codex/routines/toggle`
  · `/skip` · `/mood` · `GET /codex/routines/analytics`
- `GET /finance/status` · `/finance/*` — ver lib/finance/api.js
- `GET /fs/list?path=` · `GET /file?path=` · `POST /fs/write` — ver lib/fs-api.js
- `POST /api/notify {text,tags,log}` — toasts + journal log
- WS `/ws` (token via cookie ou `?token=`): eventos `{type:'hello'|'fs'|'notify'|...}`

## lib/llm (Fase 1)

REST:
- `GET  /llm/status` → `{ session: 'idle'|'running'|'waiting_user', policy: {...}, apiBudget: {usedUsd, capUsd} }`
- `POST /llm/permission { requestId, allow }` → `{ ok }`
- `GET  /llm/usage` (supervisor) → linhas de `.meta/llm-usage.jsonl` agregadas

WS (mensagens cliente→servidor via `/ws`):
- `{type:'llm.send', text, attachments?: [relPaths]}` — envia prompt à sessão
  dela (cria a sessão se idle; uma sessão por vez; cwd = pasta de dados)
- `{type:'llm.interrupt'}` — interrompe o turno atual
- `{type:'llm.permission', requestId, allow}` — alternativa WS ao POST

WS (servidor→clientes, broadcast):
- `{type:'llm.state', state}` — idle|starting|running|waiting_user
- `{type:'llm.text', delta}` — texto incremental do assistente
- `{type:'llm.tool', name, summaryPt, status:'start'|'done', detail?}` —
  tool_use traduzido p/ humano ("Criando nota de Maria…")
- `{type:'llm.permission_request', requestId, tool, summaryPt, input}` —
  vira card aprovar/negar
- `{type:'llm.done', costUsd?}` — fim do turno
- `{type:'llm.error', message}`

Política (lib/llm/policy.js): sessão interativa = CLI assinatura
(stream-json); jobs `LLM_JOB_<NOME>` = `api|claude-p|off` (default api;
sem `ANTHROPIC_API_KEY` → fallback claude-p com warning); micro = API Haiku.
Registro de uso em `<data>/.meta/llm-usage.jsonl`
(`{ts, kind, job?, model, in_tokens, out_tokens, cost_usd, via}`).

## lib/planner (Fase 3)

- `GET  /planner/day?date=YYYY-MM-DD` →
  `{ date, blocks: {morning:[Task], afternoon:[Task]}, unplanned:[Task],
     weekGoals:[Task], highlight: id|null, events:[{start,end,title,allDay}],
     icsConnected: bool }`
- `POST /planner/task { text, date?, block? }` — quick-add NL pt-BR
  ("amanhã 15h dentista #saude"); sem data → unplanned de hoje
- `PATCH /planner/task/:id { done?, text?, date?, block?, position? }`
- `DELETE /planner/task/:id`
- `POST /planner/promote { id, scope:'highlight'|'week', on:bool }`
- `GET  /planner/week?start=YYYY-MM-DD` → 7 dias resumidos + weekGoals
- Task = `{ id, text, done, date|null, block|null, tags:[], rolledFrom|null,
  highlight:bool, week:bool, created }`
- Rollover: no primeiro `GET /planner/day` do dia, tarefas não-done de dias
  anteriores migram para o dia atual com `rolledFrom`.
- ICS: `BISA_ICS_URL` no .env; vazio → `icsConnected:false`, `events:[]`.
  Cache 15 min; node-ical; expandir RRULE; TZ local.

## lib/pkm (Fase 5)

- `GET  /pkm/list?type=people|projects|documents` → `[ {slug, type, fm, excerpt} ]`
- `GET  /pkm/entity/:slug` → `{ slug, type, fm, md, backlinks:[{source, date?,
  excerpt}], neighbors:[{slug,type,name}] }` (md cru; o frontend renderiza
  com marked+DOMPurify vendorados e converte `[[slug]]` em `<a data-slug>`)
- `GET  /pkm/graph?focus=slug&hops=1` (sem focus = global) →
  `{ nodes:[{id,type,name,links}], links:[{source,target}] }`
  (nós: entidades + dias do journal `j:YYYY-MM-DD`)
- `GET  /pkm/search?q=` → `{ entities:[...], journal:[{date, excerpt}] }`
- `POST /pkm/inbox` (raw body, `?name=`) — salva em `pkm/Inbox/`
- `POST /pkm/photo` (raw body, `?name=&date=`) — salva em
  `pkm/assets/AAAA-MM/AAAA-MM-DD-<slug>.<ext>` e adiciona embed `![[...]]`
  no journal do dia; retorna `{ rel }`
- Indexador: chokidar em `pkm/` + `codex/journal.md`; reindex incremental;
  tolerante a arquivo malformado (skip + warn, nunca crash).

## lib/push (Fase 4/7)

- `GET /push/vapid-key` · `POST /push/subscribe {subscription}` ·
  `POST /push/test` — web-push; chaves VAPID geradas no 1º boot e salvas em
  `<data>/.meta/push.json`; bridge: notificações `dispatchNotification` com
  `push:true` viram Web Push.

## lib/pair (Fase 7)

- `GET /pair/qr` (supervisor) → PNG QR de `http://<ip-lan>:7778/?token=<AUTH_TOKEN>`
