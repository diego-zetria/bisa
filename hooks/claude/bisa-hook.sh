#!/usr/bin/env bash
# biso generic hook shim — used for every event other than the two
# specialized hooks (bisa-observe.sh for PreToolUse:Bash, bisa-english.sh
# for UserPromptSubmit).
#
# Usage in settings.json:
#   { "type": "command", "command": "/abs/path/bisa-hook.sh <event>" }
#
# Reads Claude Code's JSON payload from stdin, forwards it to
# /api/hook/<event> on the biso server (fire-and-forget, 2 s timeout),
# and emits a minimal allow-shaped JSON to stdout so the agent never
# stalls if biso is down.
#
# Install via: biso install-hook --event <Event> [--all]

set -eu

EVENT_RAW="${1:-unknown}"
INPUT=$(cat)

if [ -f "$HOME/.config/bisa/hook-env" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.config/bisa/hook-env"
fi

if [ -n "${BISA_URL:-}" ] && [ -n "${BISA_TOKEN:-}" ]; then
  endpoint=$(printf '%s' "$EVENT_RAW" | tr '[:upper:]' '[:lower:]')
  (printf '%s' "$INPUT" | curl -fsS --max-time 2 -X POST \
    -H "x-bisa-token: $BISA_TOKEN" \
    -H 'content-type: application/json' \
    --data-binary @- \
    "${BISA_URL%/}/api/hook/${endpoint}" >/dev/null 2>&1) &
fi

# Empty object = allow / continue across every Claude Code event shape.
printf '{}\n'
