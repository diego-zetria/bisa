#!/usr/bin/env bash
# Instala o bisa como serviço launchd (sobe no login, reinicia se cair,
# mantém o Mac acordado via caffeinate). Rode uma vez.
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
DEST="$HOME/Library/LaunchAgents/com.bisa.server.plist"
sed -e "s#__REPO__#$REPO#g" -e "s#/usr/local/bin/node#$NODE#g" \
  "$REPO/scripts/com.bisa.server.plist" > "$DEST"
launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"
echo "bisa instalado como serviço. Logs: $REPO/bisa.log"
echo "Parar:  launchctl unload $DEST"
