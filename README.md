# bisa

Cockpit pessoal no browser para a esposa do Diego — um hub visual e touch-first
(Windows + iPad 11") sobre uma pasta local de dados dela, com uma sessão Claude
própria como motor. Irmão do **biso** (backend reaproveitado), com a alma do
**myPKA Cockpit** (hub, planner, journal visual, grafo).

**Status: fase de planejamento.** Nenhum código foi escrito ainda — por decisão
de processo, o sistema será 100% desenhado e cronogramado antes da execução.

- `docs/DESIGN.md` — desenho completo do sistema (arquitetura, dados, telas,
  segurança, política de uso de LLM, decisões técnicas com justificativa).
- `docs/CRONOGRAMA.md` — cronograma de implementação: fases e passos na ordem
  de execução, cada passo com sua verificação. A execução só começa após
  aprovação do Diego e segue o cronograma do início ao fim.

Servidor: Mac do Diego, porta **7778** (biso fica em 7777). Dados da usuária:
`~/bisa-data/` (fora deste repo). Acesso: browser na LAN + PWA no iPad.
