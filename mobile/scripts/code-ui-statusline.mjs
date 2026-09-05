#!/usr/bin/env node
// Code UI status line for Claude Code, Node version (macOS, Linux, Windows).
// Prints "[Fable 5.1 · effort high] ~/project" from the JSON Claude Code pipes
// in, so the Code UI phone app can read the session's model and effort back
// from the terminal screen. Install in ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node /path/to/code-ui-statusline.mjs" }
import { homedir } from 'node:os'

let raw = ''
for await (const chunk of process.stdin) {
  raw += chunk
}
let d
try {
  d = JSON.parse(raw)
} catch {
  process.exit(0)
}
const model = d.model ?? {}
const name = model.display_name || model.id || 'Claude'
const effort = d.effort
const level = typeof effort === 'string' ? effort : effort?.level ?? null
let cwd = d.workspace?.current_dir || d.cwd || ''
const home = homedir()
if (cwd.startsWith(home)) {
  cwd = '~' + cwd.slice(home.length)
}
const badge = level ? `[${name} · effort ${level}]` : `[${name}]`
const short = (n) => {
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(1)}M`.replace('.0M', 'M')
  }
  if (n >= 1e3) {
    return `${(n / 1e3).toFixed(1)}k`.replace('.0k', 'k')
  }
  return String(Math.round(n))
}
const ctx = d.context_window ?? {}
const usage = ctx.current_usage ?? {}
const used =
  (usage.input_tokens ?? 0) +
  (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0)
const size = ctx.context_window_size
let pct = ctx.used_percentage
if (pct == null && size && used) {
  pct = (100 * used) / size
}
const parts = [badge]
if (pct != null) {
  parts.push(`ctx ${Math.round(pct)}%` + (used && size ? ` ${short(used)}/${short(size)}` : ''))
}
parts.push(cwd)
console.log(parts.filter(Boolean).join(' '))

// Forward the JSON to Orca the way its own (silent) status line does, so
// replacing it with this script keeps the desktop's usage bars live.
await forwardToOrca(raw)

async function forwardToOrca(payload) {
  try {
    if (process.env.CLAUDE_JOB_DIR || !payload.includes('"rate_limits"')) {
      return
    }
    const endpointFile = process.env.ORCA_AGENT_HOOK_ENDPOINT
    const paneKey = process.env.ORCA_PANE_KEY
    if (!endpointFile || !paneKey) {
      return
    }
    const { readFileSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const env = Object.fromEntries(
      readFileSync(endpointFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const eq = line.indexOf('=')
          return [line.slice(0, eq).replace(/^export\s+/, ''), line.slice(eq + 1)]
        })
    )
    const port = env.ORCA_AGENT_HOOK_PORT
    const token = env.ORCA_AGENT_HOOK_TOKEN
    if (!port || !token) {
      return
    }
    const stamp = join(tmpdir(), `code-ui-statusline-last-${paneKey.replace(/[^A-Za-z0-9._-]/g, '_')}`)
    const now = Math.floor(Date.now() / 1000)
    try {
      const last = Number(readFileSync(stamp, 'utf8'))
      if (Number.isFinite(last) && now - last < 15) {
        return
      }
    } catch {}
    try {
      writeFileSync(stamp, String(now))
    } catch {}
    const body = new URLSearchParams({
      paneKey,
      configDir: process.env.CLAUDE_CONFIG_DIR ?? '',
      env: env.ORCA_AGENT_HOOK_ENV ?? '',
      version: env.ORCA_AGENT_HOOK_VERSION ?? '',
      payload
    })
    await fetch(`http://127.0.0.1:${port}/statusline/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Orca-Agent-Hook-Token': token
      },
      body: body.toString(),
      signal: AbortSignal.timeout(1500)
    })
  } catch {}
}
