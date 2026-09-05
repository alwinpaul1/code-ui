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
