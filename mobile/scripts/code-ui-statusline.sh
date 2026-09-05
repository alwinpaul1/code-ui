#!/bin/sh
# Code UI status line for Claude Code.
#
# Claude Code pipes a JSON snapshot to the status line command on every refresh
# (model, effort, workspace, …). This prints one short line that starts with a
# model badge Code UI's phone app can read back from the terminal screen:
#
#   [Fable 5.1 · effort high] ~/Desktop/Project/Thesis
#
# That badge is how the phone learns which model and effort the desktop session
# is really running, so the two stay in sync in both directions. Any status
# line that prints "[<model name> … <effort word>]" works; this is the minimal one.
#
# Install (once, per Claude profile):
#   /statusline   →  or add to ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "sh /path/to/code-ui-statusline.sh" }

input=$(cat)

# Orca's own (silent) status line forwards this JSON to the desktop so its usage
# bars stay live; when Code UI's script replaces it, forward the same way so
# nothing is lost. Orca sets ORCA_AGENT_HOOK_ENDPOINT and ORCA_PANE_KEY in its
# terminals; outside Orca this block is a no-op. Throttled to one post per pane
# per 15 s, like Orca.
forward_to_orca() {
  case "$input" in *'"rate_limits"'*) ;; *) return 0 ;; esac
  [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ] || return 0
  . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null || return 0
  [ -n "$ORCA_AGENT_HOOK_PORT" ] && [ -n "$ORCA_AGENT_HOOK_TOKEN" ] && [ -n "$ORCA_PANE_KEY" ] || return 0
  pane_id=$(printf '%s' "$ORCA_PANE_KEY" | tr -c 'A-Za-z0-9._-' '_')
  stamp="${TMPDIR:-/tmp}/code-ui-statusline-last-${pane_id}"
  now=$(date +%s)
  if [ -r "$stamp" ]; then
    last=$(cat "$stamp" 2>/dev/null)
    case "$last" in ''|*[!0-9]*) ;; *) [ $((now - last)) -lt 15 ] && return 0 ;; esac
  fi
  printf '%s' "$now" >"$stamp" 2>/dev/null
  config_dir_field="configDir="
  [ -n "$CLAUDE_CONFIG_DIR" ] && config_dir_field="configDir=$CLAUDE_CONFIG_DIR"
  printf '%s' "$input" | curl -sS -X POST "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/statusline/claude" \
    --connect-timeout 0.5 --max-time 1.5 \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \
    --data-urlencode "paneKey=${ORCA_PANE_KEY}" \
    --data-urlencode "$config_dir_field" \
    --data-urlencode "env=${ORCA_AGENT_HOOK_ENV}" \
    --data-urlencode "version=${ORCA_AGENT_HOOK_VERSION}" \
    --data-urlencode "payload@-" >/dev/null 2>&1 || :
}
[ -z "$CLAUDE_JOB_DIR" ] && forward_to_orca &

if command -v python3 >/dev/null 2>&1; then
  printf '%s' "$input" | python3 -c '
import json, os, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
model = d.get("model") or {}
name = model.get("display_name") or model.get("id") or "Claude"
effort = d.get("effort")
level = effort.get("level") if isinstance(effort, dict) else (effort if isinstance(effort, str) else None)
cwd = (d.get("workspace") or {}).get("current_dir") or d.get("cwd") or ""
home = os.path.expanduser("~")
if cwd.startswith(home):
    cwd = "~" + cwd[len(home):]
badge = "[%s · effort %s]" % (name, level) if level else "[%s]" % name
def short(n):
    n = float(n)
    if n >= 1e6:
        s = "%.1fM" % (n / 1e6)
    elif n >= 1e3:
        s = "%.1fk" % (n / 1e3)
    else:
        return str(int(n))
    return s.replace(".0M", "M").replace(".0k", "k")
ctx = d.get("context_window") or {}
pct = ctx.get("used_percentage")
size = ctx.get("context_window_size")
usage = ctx.get("current_usage") or {}
used = None
if isinstance(usage, dict):
    used = sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
if pct is None and used is not None and size:
    pct = 100.0 * used / float(size)
parts = [badge]
if pct is not None:
    figure = "ctx %d%%" % round(float(pct))
    if used is not None and size:
        figure += " %s/%s" % (short(used), short(size))
    parts.append(figure)
parts.append(cwd)
print(" ".join(p for p in parts if p))
'
  exit 0
fi

# No python3: pull the two fields out with sed. Good enough for the badge.
name=$(printf '%s' "$input" | sed -n 's/.*"display_name":"\([^"]*\)".*/\1/p' | head -n 1)
level=$(printf '%s' "$input" | sed -n 's/.*"effort":{"level":"\([^"]*\)".*/\1/p' | head -n 1)
pct=$(printf '%s' "$input" | sed -n 's/.*"used_percentage":\([0-9]*\).*/\1/p' | head -n 1)
[ -n "$name" ] || name="Claude"
if [ -n "$level" ]; then
  badge=$(printf '[%s · effort %s]' "$name" "$level")
else
  badge=$(printf '[%s]' "$name")
fi
if [ -n "$pct" ]; then
  printf '%s ctx %s%%\n' "$badge" "$pct"
else
  printf '%s\n' "$badge"
fi
