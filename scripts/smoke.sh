#!/usr/bin/env bash
# scripts/smoke.sh — smoke test consolidado do bisa. Sobe o server numa porta
# de teste com pasta de dados temporária, exercita todos os subsistemas via
# HTTP, e reporta PASS/FAIL. Não toca os dados reais dela.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=7799
TMP="$(mktemp -d)"
DATA="$TMP/bisa-data"
mkdir -p "$DATA"/codex/finance "$DATA"/.meta/prompts \
  "$DATA"/pkm/People "$DATA"/pkm/Projects "$DATA"/pkm/Documents \
  "$DATA"/pkm/Inbox "$DATA"/pkm/assets
printf -- '---\nname: Ana\nrelation: amiga\n---\nConheci a [[ana]] num projeto.\n' > "$DATA/pkm/People/ana.md"

TOK="smoketoken$$"
PASS=0; FAIL=0
ok(){ echo "  ok: $1"; PASS=$((PASS+1)); }
bad(){ echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
H(){ curl -s -m 5 -H "x-bisa-token: $TOK" "$@"; }
cleanup(){ kill "$SV" 2>/dev/null; /bin/rm -rf "$TMP" 2>/dev/null; }
trap cleanup EXIT

CWD="$DATA" CODEX_DIR="$DATA/codex" BISA_FINANCE_DIR="$DATA/codex/finance" \
  BISA_META_DIR="$DATA/.meta" PORT=$PORT AUTH_TOKEN="$TOK" SUPERVISOR_TOKEN="sup$$" \
  node "$ROOT/server.js" >"$TMP/server.log" 2>&1 &
SV=$!
sleep 2

[ "$(H -o /dev/null -w '%{http_code}' http://localhost:$PORT/healthz)" = 200 ] && ok healthz || bad healthz
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/auth-check)" = 401 ] && ok "auth bloqueia sem token" || bad "auth sem token"
H http://localhost:$PORT/auth-check | grep -q '"ok":true' && ok "auth com token" || bad "auth com token"
H http://localhost:$PORT/codex/today | grep -q '"date"' && ok codex/today || bad codex/today
H -X POST -H 'content-type: application/json' -d '{"section":"log","item":{"text":"smoke #x"}}' http://localhost:$PORT/codex/append | grep -q '"ok":true' && ok journal/append || bad journal/append
H -X POST -H 'content-type: application/json' -d '{"text":"amanhã 15h dentista #saude"}' http://localhost:$PORT/planner/task | grep -q '"block":"afternoon"' && ok "planner quick-add pt-BR" || bad "planner quick-add"
H http://localhost:$PORT/planner/day | grep -q '"blocks"' && ok planner/day || bad planner/day
H http://localhost:$PORT/codex/routines/day | grep -q '"items"' && ok routines/day || bad routines/day
H http://localhost:$PORT/pkm/entities | grep -q '"ana"' && ok pkm/entities || bad pkm/entities
H "http://localhost:$PORT/pkm/search?q=ana" | grep -q '"entities"' && ok pkm/search || bad pkm/search
H http://localhost:$PORT/pkm/graph | grep -q '"nodes"' && ok pkm/graph || bad pkm/graph
H http://localhost:$PORT/llm/status | grep -q '"policy"' && ok llm/status || bad llm/status
H http://localhost:$PORT/finance/summary | grep -qE '"cash"|"month"' && ok finance/summary || bad finance/summary
H http://localhost:$PORT/push/vapid-key | grep -q '"key"' && ok push/vapid || bad push/vapid
for s in hub journal world chat finance; do
  [ "$(H -o /dev/null -w '%{http_code}' http://localhost:$PORT/screens/$s.js)" = 200 ] && ok "tela $s" || bad "tela $s"
done
[ "$(H -o /dev/null -w '%{http_code}' http://localhost:$PORT/manifest.webmanifest)" = 200 ] && ok manifest || bad manifest
[ "$(H -o /dev/null -w '%{http_code}' http://localhost:$PORT/sw.js)" = 200 ] && ok service-worker || bad service-worker

echo ""
echo "RESULTADO: $PASS ok, $FAIL falhas"
[ $FAIL -eq 0 ] && echo "SMOKE PASS" || { echo "SMOKE FAIL"; echo "--- server.log ---"; cat "$TMP/server.log"; }
exit $FAIL
