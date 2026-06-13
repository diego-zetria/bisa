#!/usr/bin/env bash
# biso UserPromptSubmit hook — English coach analyzer trigger.
#
# Reads the Claude Code UserPromptSubmit payload from stdin, forwards it to
# the biso server which (if english_mode is enabled for the project resolved
# from cwd) analyzes the typed prompt for grammar / vocab / interview
# coaching issues.
#
# Fire-and-forget: backgrounded with a 2-second timeout so an unreachable
# server never delays the user's prompt reaching Claude.
#
# Install via: biso install-hook [--global|--project]

set -eu

INPUT=$(cat)

if [ -f "$HOME/.config/bisa/hook-env" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.config/bisa/hook-env"
fi

if [ -n "${BISA_URL:-}" ] && [ -n "${BISA_TOKEN:-}" ]; then
  (printf '%s' "$INPUT" | curl -fsS --max-time 2 -X POST \
    -H "x-bisa-token: $BISA_TOKEN" \
    -H 'content-type: application/json' \
    --data-binary @- \
    "${BISA_URL%/}/api/hook/userprompt" >/dev/null 2>&1) &
fi

# Always allow the prompt through unchanged — coach is observe-only.
exit 0
