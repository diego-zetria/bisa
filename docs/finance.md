# Finanças (aba FIN)

Gerenciador financeiro pessoal seguindo o método AUVP: a renda do mês é
fatiada em envelopes por % (custo-fixo 30 / conforto 15 / liberdade 25 /
metas 15 / prazeres 10 / conhecimento 5 — editável por perfil, com meta
fixa em R$ e envelope "resto da renda"). Três domínios: caixa, investimentos
e IRPF.

## Módulos (`lib/finance/`)

| Módulo | Papel |
|---|---|
| `store.js` | Persistência JSONL em `codex/finance/` (gitignored): `transactions.jsonl` (caixa manual) e `investments.jsonl` (operações de investimento, com flag `gf` de sync) |
| `profile.js` | `profile.json`: itens de orçamento (BRL ou USD), alocação dos envelopes (`allocation` %, `allocationFixed` R$, `allocationRest`), objetivos, tags, `fx.BRLperUSD` e financiamentos SAC (`loanState`) |
| `irpf.js` | Motor fiscal puro (sem I/O — testado em `tests/finance-irpf.test.js`); ver "IRPF" abaixo |
| `actual.js` | Leitura do Actual Budget via `@actual-app/api` (a ÚNICA superfície headless que o Actual expõe — não há REST). Init lazy; config via `ACTUAL_*` no `.env` |
| `ghostfolio.js` | Push-only para o Ghostfolio pela superfície estável (`/api/v1/import`); os endpoints internos de leitura quebram entre versões, então o read model é o ledger próprio |
| `api.js` | Router Express montado em `server.js` sob `/finance/*` |
| `onboarding.js` | Questionário standalone na LAN (auth própria por chave em `codex/finance/onboarding/key.txt`) |

## Endpoints

Todos com o auth do biso (`requireAuth`), exceto o questionário (key própria).

- `GET /finance/status` — saúde do Actual/Ghostfolio + contagem do ledger
- `GET /finance/summary?month=YYYY-MM` — payload principal do mês: caixa
  manual (+ Actual quando configurado), pendentes fora do caixa
  (`pendingIncome`/`pendingExpense`), posições e proventos do mês
- `GET /finance/profile` — perfil + estado dos financiamentos + onboarding
- `POST/PATCH/DELETE /finance/budget` — itens de custo (categoria = slug do
  label); `PUT /finance/budget/order` foi removido em 2026-07 (sem chamador)
- `PATCH /finance/allocation {bucket, pct|amount|rest}` — meta de um envelope
- `PATCH /finance/fx {rate}` — cotação padrão de planejamento (R$/US$)
- `POST/PATCH/DELETE /finance/objectives` — objetivos (acumulam aportes)
- `POST /finance/tags` · `DELETE /finance/tags?name=` — vocabulário de tags
- `POST /finance/tx` — lançamento de caixa `{date, kind, amount, category,
  desc, bucket?, goalId?, pending?}`; `creditGoal: true` faz o servidor
  creditar o objetivo vinculado no mesmo request (aporte efetivado)
- `PATCH /finance/tx {id, ...campos, creditGoal?}` — edição in-place;
  `pending: false` efetiva um provisionado (o frontend nunca faz
  apaga-e-recria para editar)
- `DELETE /finance/tx?id=&creditGoal=1` — `creditGoal=1` desconta do objetivo
  o aporte removido
- `GET /finance/invest?year=` · `POST/DELETE /finance/invest` — ledger de
  operações (buy/sell/dividend/jcp/rent × stock/fii/etf/bdr/crypto)
- `GET /finance/positions` — posições a preço médio
- `GET /finance/irpf?year=` — relatório completo do ano-base
- `POST /finance/sync/ghostfolio` — empurra as operações ainda não sincadas
- `POST /finance/insight {month}` — análise mensal escrita pelo Claude
  (headless, Haiku)
- `GET /finance/onboarding-link` · `GET/POST /finance/onboarding?k=` ·
  `GET /finance/onboarding-answers` — questionário da família

## IRPF (`irpf.js`)

Regras implementadas (swing trade / pessoa física, declaração = ano-base + 1):

- Custo médio ponderado; venda realiza `qty*(preço - médio) - taxas` sem
  alterar o médio.
- Ações 15%, mês isento com vendas ≤ R$ 20.000 (perdas ainda acumulam);
  ETF/BDR 15% sem isenção (pool "comuns" com ações); FII 20%, pool próprio;
  cripto 15%, isenção ≤ R$ 35.000 e SEM compensação de prejuízo (IN 1888).
- DARF 6015 só quando o imposto do mês ≥ R$ 10; abaixo disso acumula como
  residual para o mês seguinte.
- Proventos: dividendo (isento, cód. 09), JCP (tributação exclusiva, cód. 10),
  rendimento de FII (isento, cód. 26). Bens e Direitos pelas posições de 31/12.

### Cortes de escopo deliberados

O motor NÃO computa: **day trade** (20%, sem isenção, DARF próprio — apenas
detectado e sinalizado nas notas do relatório), **opções, futuros, aluguel de
ações (BTC)** e o abatimento do **IRRF "dedo-duro"** (0,005% sobre vendas).
Se algum desses ocorrer, os números do mês afetado estão incompletos — calcule
fora e confira os códigos TODO de grupo/código dentro do programa da Receita
antes de entregar.

## Testes

- `tests/finance-irpf.test.js` — motor fiscal (posições, isenções, pools, DARF)
- `tests/finance-profile.test.js` — matemática SAC (`loanState`)
- `tests/finance-store.test.js` — persistência de transações/operações e
  `creditObjective`
- `tests/finance-api.test.js` — endpoints de tx (POST/PATCH/DELETE +
  `creditGoal`) e agregação do summary (pendentes fora do caixa)

Frontend (`public/screens/finance.js`) não tem testes automatizados — é DOM
imperativo validado manualmente no iPad.
