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
console.log(`${badge} ${cwd}`)
