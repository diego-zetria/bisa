# bisa — Contrato do frontend (para autores de tela)

Sem framework, sem build. Vanilla JS. Cada tela é um arquivo
`public/screens/<nome>.js` que registra:

```js
window.BISA.screens['hub'] = {
  mount(el) { /* el = container .screen-pad já vazio; construa a UI aqui */ },
  unmount() { /* opcional: limpar timers, sortables, unsub de WS */ },
  openEntity(slug) { /* só a tela 'world' implementa */ },
};
```

O roteador chama `mount(el)` ao entrar e `unmount()` ao sair. NÃO toque em
`#nav`, `#gate`, outras telas, nem em `app.js`. Use só seu próprio arquivo
de tela (+ helpers globais abaixo). Tudo em português do Brasil.

## window.BISA (helpers globais já prontos)

- `await BISA.api(path, {method, json, headers})` → JSON/texto; lança em erro
  (com `.message` em pt quando o backend manda `{error}`); 401 abre o gate.
- `await BISA.apiRaw(path, arrayBufferOuBlob, contentType)` → upload binário.
- `BISA.toast(msg)` → toast efêmero.
- `BISA.renderMarkdown(md)` → HTML sanitizado; `[[slug]]`/`[[slug|label]]`
  viram `<a data-slug>` (clique já roteia para a entidade — não trate você).
- `BISA.onWs(fn)` → assina eventos WS; retorna unsubscribe. Eventos:
  `{type:'fs',event,path}`, `{type:'pkm',event:'index'}`,
  `{type:'llm.*'}` (ver docs/API.md), `{type:'notify',...}`, `{type:'hello',role}`.
- `BISA.wsSend(obj)` → envia ao servidor (use para `llm.send` etc).
- `BISA.go(route)` / `BISA.openEntity(slug)` → navegação.
- `BISA.token` → token atual (para montar URLs de imagem com `?token=`).

## Estilo (use as classes do style.css, não invente cores)

`.card`, `.section-title`, `.muted`, `.row`, `.spacer`, `.pill`, `.btn`
(`.btn.ghost`, `.btn.block`), `.empty`, inputs/textarea já estilizados.
Cores só via variáveis CSS (`var(--primary)` etc). Alvos de toque ≥44px.
Container `.hub-grid` vira 2 colunas em ≥900px (iPad landscape).

## Imagens/arquivos da pasta dela

Servidos por `/file?path=<rel>&token=<BISA.token>` (rel relativo à pasta de
dados). Ex.: foto do journal embutida como `![[pkm/assets/2026-06/x.png]]`
→ `<img src="/file?path=pkm/assets/2026-06/x.png&token=...">`.

## Endpoints por tela — ver docs/API.md (fonte de verdade dos contratos)

- Hub: `/planner/day`, `/planner/task` (POST quick-add), `/planner/task/:id`
  (PATCH done/move), `/planner/promote`, `/codex/routines/day` + `/toggle`,
  `/codex/today` (briefing/notas fixadas).
- Diário: `/codex/day?date=` + `/codex/today`, `/file?path=` (fotos),
  `/pkm/inbox?kind=photo` (upload foto), rotinas `/codex/routines/*`
  (heatmap, analytics, toggle, skip, mood).
- Mundo: `/pkm/entities`, `/pkm/entity/:slug`, `/pkm/graph`, `/pkm/search`.
- Claude: WS `llm.send`/`llm.interrupt`/`llm.permission` + eventos `llm.*`;
  `/llm/status`; upload via `/pkm/inbox?name=`.
- Finanças: `/finance/status|summary|profile|tx|invest|positions|irpf`.
