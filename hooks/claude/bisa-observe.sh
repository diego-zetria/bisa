#!/usr/bin/env bash
# biso PreToolUse hook — fire-and-forget observability.
#
# Reads the Claude Code PreToolUse payload from stdin, forwards it to the
# biso server which logs the Bash command to today's journal tagged
# with #bash and the matching #proj/<id> (resolved server-side by cwd).
#
# If the server is unreachable the tool call still proceeds — the POST is
# backgrounded with a 2-second timeout and its exit code is discarded.
#
# Install via: biso install-hook [--global|--project]

set -eu

INPUT=$(cat)

# Pick up BISA_URL / BISA_TOKEN. Already exported inside the biso PTY;
# for `claude` sessions started outside biso we source a small env file
# that `biso install-hook` writes with chmod 600.
if [ -f "$HOME/.config/bisa/hook-env" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.config/bisa/hook-env"
fi

if [ -n "${BISA_URL:-}" ] && [ -n "${BISA_TOKEN:-}" ]; then
  (printf '%s' "$INPUT" | curl -fsS --max-time 2 -X POST \
    -H "x-bisa-token: $BISA_TOKEN" \
    -H 'content-type: application/json' \
    --data-binary @- \
    "${BISA_URL%/}/api/hook/pretooluse" >/dev/null 2>&1) &
fi

# Always allow the tool call unchanged.
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
