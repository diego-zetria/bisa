#!/usr/bin/env bash
# biso echoes injection hook — runs on SessionStart, surfaces relevant
# journal entries (decisions, learnings, blockers, bugs, userprefs) as
# additionalContext so Claude sees them at the start of the session.
#
# Disabled by default. Opt in via BISA_INJECT_ECHOES=true (set in
# ~/.config/bisa/hook-env or shell env). Same opt-in pattern as
# rohitg00/agentmemory — keeps the default path token-neutral.
#
# Usage in settings.json (SessionStart only):
#   {
#     "hooks": {
#       "SessionStart": [
#         { "type": "command", "command": "/abs/path/bisa-echoes.sh" }
#       ]
#     }
#   }
#
# Install via: biso install-hook --event SessionStart --target echoes
# (current install-hook --all wires bisa-hook.sh for SessionStart; this
#  script supersedes that when you want context injection).

set -eu

# Drain stdin so Claude Code doesn't block on the pipe (we don't need the
# payload — SessionStart doesn't have meaningful args for context lookup).
cat >/dev/null || true

if [ -f "$HOME/.config/bisa/hook-env" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.config/bisa/hook-env"
fi

# Hard opt-in gate.
if [ "${BISA_INJECT_ECHOES:-false}" != "true" ]; then
  printf '{}\n'
  exit 0
fi

# Server unreachable? Allow + no context, never block the session.
if [ -z "${BISA_URL:-}" ] || [ -z "${BISA_TOKEN:-}" ]; then
  printf '{}\n'
  exit 0
fi

limit="${BISA_ECHOES_LIMIT:-5}"
half_life="${BISA_ECHOES_HALF_LIFE_DAYS:-60}"

payload=$(curl -fsS --max-time 3 \
  -H "x-bisa-token: $BISA_TOKEN" \
  "${BISA_URL%/}/codex/echoes/auto?caller=session-start&limit=${limit}&half_life_days=${half_life}" \
  2>/dev/null || true)

if [ -z "$payload" ]; then
  printf '{}\n'
  exit 0
fi

# Format the response into a {"additionalContext": "..."} JSON block.
# A single python3 invocation handles parse + format + JSON wrap so the
# script's stdin is free for the curl payload (heredoc-via-stdin would
# steal it and break json.load).
output=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("{}"); sys.exit(0)
results = d.get("results") or []
if not results:
    print("{}"); sys.exit(0)
lines = ["### biso · recent decisions worth carrying into this session"]
for r in results:
    date = r.get("date", "")
    section = r.get("section", "")
    text = (r.get("text") or "").strip()
    if not text:
        continue
    # Trim to ~200 chars to keep the injection lean.
    if len(text) > 200:
        text = text[:200].rstrip() + "…"
    tags = " ".join("#" + t for t in (r.get("tags") or [])[:4])
    lines.append(f"- [{date} · {section}] {text}  {tags}".strip())
body = "\n".join(lines)
print(json.dumps({"additionalContext": body}))
' 2>/dev/null || true)

if [ -z "$output" ]; then
  printf '{}\n'
else
  printf '%s\n' "$output"
fi
