import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// 2026-10-06: a test that ran the status-line script with `CUIHUD_TTY: ''` let
// the script's tty writer walk up six parents (`ps -o tty=`) and find the REAL
// terminal of the Orca tab running the tests (vitest, then the tool's shell,
// then the agent, which sits on the user's PTY). It wrote a beacon frame for the
// synthetic session `00000000-…` into the user's live terminal, and the phone
// then believed the tab's Claude session was 00000000: "Another agent started in
// this tab reported session …, the chat stays on Claude's own session 00000000".
//
// The walk runs only when `CUIHUD_TTY` is unset or empty (agent-hud-tty-write.ts),
// so every test that runs one of our beacon scripts must either point it at a
// temp file, or take the walk's ability to see an ancestor away with a fake `ps`
// (agent-hud-script-runner.test-support.ts: `noTerminalPath`). A STRUCTURE
// ratchet: a source-reading test is the only instrument that sees a spawn
// nobody pinned. It reads code, not comments.

const SRC = join(__dirname, '..')
const SCRIPT_REFERENCE =
  /\b(?:CLAUDE_HUD_[A-Z_]*(?:SCRIPT|POWERSHELL|COMMAND)|CODEX_HUD_NOTIFY[A-Z_]*|AGENT_HUD_TTY_WRITE|code-ui-statusline)\b/
const SPAWN = /\b(?:execFileSync|spawnSync|execSync|execFile|spawn)\s*\(/g
/** Spawns that run no script of ours. */
const HARMLESS = [/['"`]cat['"`]/, /: > /, /command -v/, /--version/, /uname/]

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' ? [] : testFiles(path)
    }
    return /\.test\.tsx?$/.test(name) ? [path] : []
  })
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** The text of the call opening at `open` (the index of its `(`): to the matching `)`. */
function callText(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') {
      depth += 1
    } else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) {
        return source.slice(open, i + 1)
      }
    }
  }
  return source.slice(open)
}

export function unpinnedSpawns(source: string): string[] {
  const code = withoutComments(source)
  if (!SCRIPT_REFERENCE.test(code)) {
    return []
  }
  const found: string[] = []
  for (const match of code.matchAll(SPAWN)) {
    const call = callText(code, match.index! + match[0].length - 1)
    if (HARMLESS.some((pattern) => pattern.test(call))) {
      continue
    }
    // The PowerShell writers have no tty to walk to: they write to the console
    // seam `CUIHUD_WIN_CONOUT`, which a test points at a temp file.
    const pinned = /CUIHUD_TTY\s*:\s*(?!''|""|``)[^,}\s]/.test(call) || /CUIHUD_WIN_CONOUT\s*:/.test(call)
    const emptied = /CUIHUD_TTY\s*:\s*(?:''|""|``)/.test(call)
    const noTerminal = /noTerminalPath|psShim|fakePs/.test(call)
    if (emptied && !noTerminal) {
      found.push(`${match[0]}…  sets CUIHUD_TTY to an empty string: the script walks to a REAL terminal`)
    } else if (!pinned && !noTerminal && !/runHudScript|runScript\(/.test(call)) {
      found.push(`${match[0]}…  runs a script with no CUIHUD_TTY override and no fake ps`)
    }
  }
  // The shared runner of agent-hud-launch-args.test.ts leaves the override out
  // for its `noTtyOverride` cases, which are safe only with a shim in front of
  // `ps` or `uname`.
  for (const match of code.matchAll(/noTtyOverride\s*:\s*true/g)) {
    const around = code.slice(Math.max(0, match.index! - 400), match.index! + 400)
    if (!/pathShim/.test(around)) {
      found.push('noTtyOverride: true without a pathShim beside it: the walk reaches a real terminal')
    }
  }
  return found
}

describe('no test can reach a real terminal through a beacon script', () => {
  it('every spawn of one of our scripts is pinned to a temp file or cannot find an ancestor tty', () => {
    const offenders = testFiles(SRC)
      .filter((file) => file !== __filename)
      .flatMap((file) =>
        unpinnedSpawns(readFileSync(file, 'utf8')).map((why) => `${relative(SRC, file)}: ${why}`)
      )
    expect(offenders).toEqual([])
  })

  it('the detector sees the shapes that leaked', () => {
    const leak = `import { execFileSync } from 'node:child_process'
      const s = CLAUDE_HUD_STATUSLINE_SCRIPT
      execFileSync('sh', ['-c', s], { env: { PATH: p, HOME: h, CUIHUD_TTY: '' } })`
    expect(unpinnedSpawns(leak)).toHaveLength(1)
    const bare = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
      execFileSync('sh', ['-c', s], { input: 'x' })`
    expect(unpinnedSpawns(bare)).toHaveLength(1)
    const pinned = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
      execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: tty } })`
    expect(unpinnedSpawns(pinned)).toEqual([])
    const shimmed = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
      execFileSync('sh', ['-c', s], { env: { PATH: noTerminalPath(), CUIHUD_TTY: '' } })`
    expect(unpinnedSpawns(shimmed)).toEqual([])
    expect(unpinnedSpawns("const s = CLAUDE_HUD_STATUSLINE_SCRIPT\n// execFileSync('sh', [s])")).toEqual([])
    expect(unpinnedSpawns("execFileSync('sh', ['-c', 'echo'])")).toEqual([])
    expect(unpinnedSpawns("run(s, { noTtyOverride: true })\nconst s = CLAUDE_HUD_STATUSLINE_SCRIPT")).toHaveLength(1)
  })
})
