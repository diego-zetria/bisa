# bisa

Cockpit pessoal no browser para a esposa do Diego — um hub visual e touch-first
(Windows + iPad 11") sobre uma pasta local de dados dela, com uma sessão Claude
própria como motor. Irmão do **biso** (backend reaproveitado), com a alma do
**myPKA Cockpit** (hub, planner, journal visual, grafo).

**Status: v1 implementado (2026-06-12).** As 8 fases do cronograma foram
executadas. 192 testes unitários/contrato verdes + 21 checagens de smoke
HTTP + validação visual no viewport do iPad (hub, mundo/grafo, claude).

Subir: `npm start` (porta 7778). Ver `docs/OPERACAO.md` para parear o iPad,
política de LLM/créditos, supervisor e backup.

Docs:
- `docs/DESIGN.md` — desenho completo (arquitetura, dados, telas, segurança).
- `docs/CRONOGRAMA.md` — fases/passos com verificação + seção de **desvios**.
- `docs/API.md` — contratos backend↔frontend (REST + WS).
- `docs/FRONTEND.md` — contrato de tela (como escrever uma `screens/<n>.js`).
- `docs/OPERACAO.md` — runbook do Diego.

Servidor: Mac do Diego, porta **7778** (biso fica em 7777). Dados da usuária:
`~/bisa-data/` (fora deste repo). Acesso: browser na LAN + PWA no iPad.

Pendências (não bloqueiam o uso): texto oficial da nova política Claude →
`lib/llm/policy.js`; `ANTHROPIC_API_KEY` + `BISA_ICS_URL` no `.env` quando
disponíveis; nome/cores no gosto dela; escopo financeiro final.
