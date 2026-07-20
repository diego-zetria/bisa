# bisa — regras para o Claude

## ⚠ Você provavelmente está rodando DENTRO do servidor bisa

Turnos do caderno Biso com foco neste projeto rodam como filho do processo
`node server.js` (LaunchAgent `com.bisa.server`, porta 7778). **Reiniciar o
servidor no meio do turno mata o próprio turno** — o usuário fica com um
spinner órfão no iPad (incidente real: 2026-07-20, turno de 22min perdido
no passo "restart bisa to load…").

Regras:
- **Nunca** rode `launchctl kickstart -k gui/501/com.bisa.server` (nem
  `pkill node`, nem mate a porta 7778) como passo normal do turno.
- Frontend (public/) não precisa de restart — o iPad recarrega com
  `POST /dev/reload` (token em `.env`), que é seguro.
- Backend (server.js, lib/): termine a resposta explicando que o restart é
  necessário e FINALIZE o turno; se o restart for indispensável agora, use
  o padrão adiado — `nohup sh -c 'sleep 5 && launchctl kickstart -k
  gui/501/com.bisa.server' >/dev/null 2>&1 &` — como ÚLTIMA ação do turno,
  para a resposta chegar inteira antes de o chão sumir.
- Testes: prefira `node --test tests/` e `node --check` — não sobem servidor.
