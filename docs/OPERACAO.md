# bisa — Operação (Diego)

Guia rápido para rodar, parear, supervisionar e manter o bisa.

## Subir / parar

```bash
cd ~/Documents/cloudville/2026/ideas/bisa
npm start              # foreground, porta 7778
npm run start:awake    # idem, mantendo o Mac acordado (caffeinate)
```

Boot automático (recomendado, mantém de pé e acordado):
```bash
bash scripts/install-launchd.sh     # instala o serviço (uma vez)
launchctl unload ~/Library/LaunchAgents/com.bisa.server.plist   # parar
```
Logs do serviço: `bisa.log` na raiz do repo.

biso (seu, porta 7777) e bisa (dela, 7778) rodam lado a lado sem conflito.

## Parear o iPad / Windows dela

1. Com o server no ar, abra (como supervisor — use o SUPERVISOR_TOKEN do `.env`):
   `http://localhost:7778/pair/qr?token=<SUPERVISOR_TOKEN>` → mostra um QR.
2. Ela escaneia no iPad (mesma rede). O link já carrega o token DELA; o
   cookie é setado por 1 ano. Pronto.
3. Alternativa sem QR: `GET /pair/url` (supervisor) devolve a URL com o token
   dela para você mandar por mensagem.
4. No iPad: Safari → Compartilhar → "Adicionar à Tela de Início" para virar
   PWA (tela cheia, ícone). Depois, na tela do app, ativar lembretes quando
   pedir (Web Push só funciona com a PWA instalada, iPadOS 16.4+).

## Tokens (no `.env`, não commitado)

- `AUTH_TOKEN` — o token dela (acesso normal).
- `SUPERVISOR_TOKEN` — o seu (acesso de supervisor: QR, custos de API).
  Os dois passam em todas as telas; o supervisor habilita rotas extras.

## Política de LLM / créditos de API

Configurada em `.env` (`LLM_JOB_*`, `LLM_MICRO`) e em `lib/llm/policy.js`.
Hoje, sem `ANTHROPIC_API_KEY`, os jobs caem em `claude-p` (assinatura) com
aviso. Quando os créditos de API chegarem:

1. Adicione `ANTHROPIC_API_KEY=...` ao `.env`.
2. Ajuste `API_BUDGET_MONTHLY_USD` (teto; avisa em 80%).
3. **Quando o texto oficial da nova política Claude chegar**, codifique as
   regras em `lib/llm/policy.js` (há um bloco comentado reservado para isso) —
   por ora os defaults foram definidos por nós em 2026-06-12.

Uso e custo ficam em `~/bisa-data/.meta/llm-usage.jsonl`; veja agregado em
`GET /llm/usage` (supervisor).

## Calendário dela (quando tiver)

Pegue o "endereço secreto no formato iCal" no Google Calendar dela e coloque
em `BISA_ICS_URL` no `.env`. Reinicie. A agenda do Hub passa a mostrar os
eventos (somente leitura, cache 15 min). Vazio = "Calendário não conectado".

## Segurança do Claude dela

O Claude roda na pasta `~/bisa-data` com perfil restrito
(`~/bisa-data/.claude/settings.json`): bloqueia `rm`, `sudo`, `curl`, `wget`,
web e leitura fora da pasta. **Esse deny-list é a camada de segurança real** —
em modo `-p` o CLI não pede confirmação de tool (ver desvios no CRONOGRAMA).
Mantenha o deny-list rígido.

## Backup

`~/bisa-data` é a verdade. Entra no Time Machine. Se um dia usar iCloud/
Dropbox para sync, clique direito na pasta → "Manter Baixado" (senão arquivos
viram fantasma offloaded e o Claude se perde — lição do vídeo myPKA).

## Testes

```bash
npm test            # 192 testes unitários/contrato
bash scripts/smoke.sh   # 21 checagens HTTP de ponta a ponta (server efêmero)
```

## Manutenção

- Atualizar uma lib de frontend: re-baixar o pin em `public/vendor/` e
  **suba a versão do cache em `public/sw.js`** (`bisa-vN`), senão o iPad serve
  o JS antigo do cache (foi o que mascarou um bug do grafo no desenvolvimento).
- Adicionar feature: backend em `lib/<modulo>/`, tela em
  `public/screens/<nome>.js` (contrato em `docs/FRONTEND.md`); endpoints em
  `docs/API.md` primeiro.
