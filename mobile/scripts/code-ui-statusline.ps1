# Code UI status line for Claude Code on Windows (PowerShell).
# Prints "[Fable 5.1 · effort high] C:\path" from the JSON Claude Code pipes in,
# so the Code UI phone app can read the session's model and effort back from
# the terminal screen. Install in %USERPROFILE%\.claude\settings.json:
#   "statusLine": { "type": "command",
#                   "command": "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\path\\to\\code-ui-statusline.ps1" }
$raw = [Console]::In.ReadToEnd()
try { $d = $raw | ConvertFrom-Json } catch { exit 0 }
$name = if ($d.model.display_name) { $d.model.display_name } elseif ($d.model.id) { $d.model.id } else { "Claude" }
$level = $null
if ($d.effort -is [string]) { $level = $d.effort } elseif ($d.effort -and $d.effort.level) { $level = $d.effort.level }
$cwd = if ($d.workspace.current_dir) { $d.workspace.current_dir } elseif ($d.cwd) { $d.cwd } else { "" }
$badge = if ($level) { "[$name · effort $level]" } else { "[$name]" }
Write-Output "$badge $cwd"
