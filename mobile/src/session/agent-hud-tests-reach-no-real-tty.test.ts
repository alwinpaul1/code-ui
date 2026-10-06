import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
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
// and the Windows branch writes to `${CUIHUD_WIN_TTY:-/dev/tty}`. So every test
// that runs one of our beacon scripts must point `CUIHUD_TTY` at a temp file, or
// take the walk's ability to see an ancestor away with a fake `ps`
// (agent-hud-script-runner.test-support.ts: `noTerminalPath`), and a test that
// fakes MSYS (`uname`) must also pin `CUIHUD_WIN_TTY` and `CUIHUD_WIN_CONOUT`.
//
// The script's own `/dev/tty` fallback is left as it is: on a real Windows host
// `/dev/tty` is the console Claude is attached to, which is exactly what the
// frame is for, and the fallback is reachable only on the MSYS branch. A script
// that wrote nothing without `CUIHUD_WIN_TTY` would write nothing there either.
// What holds the tests off it is a test pinning both console overrides (checked
// below), the sandbox that sets them for every spawn that inherits the
// environment, and a run with no terminal in its ancestors (run-detached.mjs).
//
// THE PRIMARY GUARD IS NOT THIS FILE. It is `scripts/run-detached.mjs`, which
// `pnpm test` goes through: it double-forks so no ancestor of the tests holds a
// terminal, and src/test/vitest-runs-detached.test.ts fails hard when one does.
// The SECOND line is vitest's globalSetup (vitest.global-setup.ts, checked by
// agent-hud-test-sandbox.test.ts): a `ps` that sees nothing first on PATH and
// every tty override on a temp file, which covers a spawn that inherits or
// spreads `process.env` and NOT one with its own PATH (it finds the real
// `/bin/ps`, which macOS will not let us shadow). This ratchet is the THIRD line; it is not exhaustive and chasing every source
// shape (a string-form execSync, a script piped on stdin, wrappers in helpers,
// import aliases, promisify) is not its job.
//
// A STRUCTURE ratchet: a source-reading test is the only instrument that sees a
// spawn nobody pinned. It reads code, not comments, and every file that imports
// `child_process`, helpers and `scripts/` included (review R7, 2026-10-06).

const MOBILE = join(__dirname, '..', '..')
const ROOTS = [join(MOBILE, 'src'), join(MOBILE, 'scripts')]
/** A file that reaches a beacon script: by a constant, a builder, or an import
 *  of one of the modules that define them (review R5). */
const SCRIPT_REFERENCE = new RegExp(
  [
    String.raw`\b(?:CLAUDE_HUD_[A-Z_]*|CODEX_HUD_[A-Z_]*|AGENT_HUD_TTY_WRITE)\b`,
    String.raw`\b(?:buildClaudeHudSettingsJson|buildCodexHudNotifyOverride|agentHudLaunchFlag|withAgentHudDesktopFlag)\b`,
    String.raw`code-ui-statusline`,
    String.raw`agent-hud-(?:launch-args|prompt-hook-script|session-start-hook-script|tty-write|desktop-launch-args)`
  ].join('|')
)
const SPAWN = /\b(?:execFileSync|spawnSync|execSync|execFile|spawn)\s*\(/g
/** Spawns that run no script of ours. Applied only to a call that names none
 *  (review R3: `uname; … ; script` is not harmless). */
const HARMLESS = [/: > /, /command -v/, /--version/, /uname/]

/** The first argument array of a call with every string and template literal
 *  emptied: whatever identifier is left is a value the call runs. */
function argumentIdentifiers(call: string): boolean {
  const open = call.indexOf('[')
  if (open === -1) {
    return false
  }
  let depth = 0
  let end = call.length
  for (let i = open; i < call.length; i += 1) {
    depth += call[i] === '[' ? 1 : call[i] === ']' ? -1 : 0
    if (depth === 0) {
      end = i + 1
      break
    }
  }
  const emptied = call.slice(open, end).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''")
  return /[A-Za-z_$]/.test(emptied)
}

/** A spawn that runs nothing of ours: `cat` of a file, or a literal shell
 *  snippet from the harmless list (R3: not when it also runs a variable). */
function runsNoScript(call: string): boolean {
  if (/^\(\s*['"`]cat['"`]/.test(call)) {
    return true
  }
  return HARMLESS.some((pattern) => pattern.test(call)) && !argumentIdentifiers(call)
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' ? [] : sourceFiles(path)
    }
    return /\.(?:test\.)?(?:tsx?|mts|mjs|js)$/.test(name) || /test-support\.tsx?$/.test(name) ? [path] : []
  })
}

/** The source with comments blanked, and with a `//` or `/*` inside a string,
 *  template or regex literal left alone (review: a `://` swallowed the rest of
 *  the line). A small scanner, not a parser. */
function withoutComments(source: string): string {
  const out: string[] = []
  let i = 0
  let quote: string | null = null
  // The last significant character and word, tracked as the scan goes (a lookback
  // through the output per slash was quadratic). A `/` starts a regex literal after
  // an operator, an opening bracket, a keyword or at the start; it is a division
  // after an identifier, a number or a closing bracket.
  let last = ''
  let word = ''
  const note = (c: string) => {
    if (/\s/.test(c)) {
      return
    }
    last = c
    word = /[\w$]/.test(c) ? word + c : ''
  }
  const regexAllowed = () =>
    last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /^(?:return|typeof|case|in|of)$/.test(word)
  const emit = (text: string) => {
    out.push(text)
    for (const c of text) {
      note(c)
    }
  }
  while (i < source.length) {
    const c = source[i]!
    const next = source[i + 1]
    if (quote !== null) {
      emit(c)
      if (c === '\\') {
        emit(next ?? '')
        i += 2
        continue
      }
      if (c === quote) {
        quote = null
      }
      i += 1
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c
      emit(c)
      i += 1
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        i += 1
      }
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (c === '/' && regexAllowed()) {
      // A regex literal: to the closing `/`, honouring escapes and `[...]`.
      let inClass = false
      emit(c)
      i += 1
      while (i < source.length && source[i] !== '\n') {
        const r = source[i]!
        emit(r)
        i += 1
        if (r === '\\') {
          emit(source[i] ?? '')
          i += 1
        } else if (r === '[') {
          inClass = true
        } else if (r === ']') {
          inClass = false
        } else if (r === '/' && !inClass) {
          break
        }
      }
    } else {
      emit(c)
      i += 1
    }
  }
  return out.join('')
}

/** `PATH: name` where `name` is assigned from `process.env.PATH`. */
function pathFromEnv(call: string, code: string): boolean {
  const named = /PATH\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/.exec(call)
  if (!named) {
    return false
  }
  const assignment = new RegExp(String.raw`(?:const|let|var)\s+${named[1]!.replace(/\$/g, String.raw`\$`)}\s*=\s*([^;]+)`).exec(code)
  return assignment !== null && /process\.env\.PATH|noTerminalPath/.test(assignment[1]!)
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

const TEMP_ORIGIN = /mkdtemp|tmpdir|TMPDIR|os\.tmpdir/
/** True when `expression` (the value given to CUIHUD_TTY) is a path in a temp
 *  directory: a non-empty literal that is not a real device, or a name this
 *  file assigns from a temp directory (review R4: `CUIHUD_TTY: tty` is pinned
 *  only if `tty` is). */
function pinnedValue(expression: string, code: string, depth = 0): boolean {
  const literal = /^(['"`])([^'"`$]*)\1$/.exec(expression)
  if (literal) {
    return literal[2]!.length > 0 && !/^\/dev\/(?!null$)/.test(literal[2]!)
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(expression) || depth > 3) {
    return false
  }
  const name = expression.replace(/\$/g, String.raw`\$`)
  // Every `const tty = …` and default parameter `(…, tty = …)` of the name in the
  // file: scopes are not told apart, so one that is not a temp path fails them
  // all, which is the safe side.
  const assignments = [
    ...code.matchAll(new RegExp(String.raw`(?:(?:const|let|var)\s+|[(,]\s*)${name}\s*(?::[^=\n]+)?=\s*([^\n;]+(?:\n[^\n;]*)?)`, 'g'))
  ].map((m) => m[1]!)
  if (assignments.length === 0 || assignments.some((rhs) => /process\.env\.CUIHUD/.test(rhs))) {
    return false
  }
  return assignments.every(
    (rhs) =>
      TEMP_ORIGIN.test(rhs) ||
      // `join(dir, 'pty')`: pinned when a name it is built from is.
      [...rhs.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].some(
        (m) => m[1] !== expression && !/^(?:join|resolve|path|const|let|process|env|cwd)$/.test(m[1]!) && pinnedValue(m[1]!, code, depth + 1)
      )
  )
}

export function unpinnedSpawns(source: string, allowCall?: (call: string) => boolean): string[] {
  const code = withoutComments(source)
  if (!SCRIPT_REFERENCE.test(code)) {
    return []
  }
  const found: string[] = []
  for (const match of code.matchAll(SPAWN)) {
    const call = callText(code, match.index! + match[0].length - 1)
    if (runsNoScript(call) || allowCall?.(call)) {
      continue
    }
    // An environment built without PATH from process.env leaves the sandbox's `ps`
    // out of reach: the walk then finds the real one (a reviewer's scratch spawn
    // wrote a frame into the real terminal that way). A spawn with no `env` option
    // inherits ours.
    const envOption = /\benv\s*:/.test(call)
    const keepsPath = /\.\.\.process\.env|PATH\s*:\s*(?:[^,}\n]*process\.env\.PATH|noTerminalPath)/.test(call) || pathFromEnv(call, code)
    if (envOption && !keepsPath) {
      found.push(`${match[0]}…  builds env without PATH from process.env: the walk finds the real ps`)
      continue
    }
    const values = [...call.matchAll(/CUIHUD_TTY\s*:\s*([^,}\n]+)/g)].map((m) => m[1]!.trim())
    const noTerminal = /noTerminalPath|psShim|fakePs/.test(call)
    // The PowerShell writers have no tty to walk to: they write to the console
    // seam `CUIHUD_WIN_CONOUT`, which a test points at a temp file.
    const conout = /CUIHUD_WIN_CONOUT\s*:/.test(call) && /\b(?:pwsh|powershell)\b/i.test(call)
    const pinned = values.length > 0 && values.every((value) => pinnedValue(value, code))
    if (noTerminal || conout || pinned) {
      if (/\b(?:MINGW|MSYS|msys)/.test(call) && !(/CUIHUD_WIN_TTY\s*:/.test(call) && /CUIHUD_WIN_CONOUT\s*:/.test(call))) {
        found.push(`${match[0]}…  fakes MSYS without pinning CUIHUD_WIN_TTY and CUIHUD_WIN_CONOUT: it writes to /dev/tty`)
      }
      continue
    }
    found.push(
      values.length > 0
        ? `${match[0]}…  CUIHUD_TTY is ${values.join(', ')}, not a temp path: the script may walk to a REAL terminal`
        : `${match[0]}…  runs a script with no CUIHUD_TTY override and no fake ps`
    )
  }
  // A shared runner that leaves the override out for its `noTtyOverride` cases
  // is safe only with a shim, and an MSYS shim only with both console
  // overrides (review R6: `${CUIHUD_WIN_TTY:-/dev/tty}`).
  for (const match of code.matchAll(/noTtyOverride\s*:\s*true/g)) {
    // The call it sits in: back to the `(` that encloses it, to its close.
    let depth = 0
    let start = 0
    for (let i = match.index!; i >= 0; i -= 1) {
      depth += code[i] === ')' ? 1 : code[i] === '(' ? -1 : 0
      if (depth < 0) {
        start = i
        break
      }
    }
    const around = callText(code, start)
    // A shim counts when it is a `ps` that sees nothing, or an MSYS `uname`
    // with BOTH console overrides; any other path shim leaves the walk alone.
    const psShim = /noTerminalPath|psShim|fakePs/.test(around)
    const msys = /msysShim|MINGW|MSYS/i.test(around)
    if (!/pathShim/.test(around) || !(psShim || msys)) {
      found.push('noTtyOverride: true without a ps shim or an MSYS shim beside it: the walk reaches a real terminal')
    } else if (!psShim && !(/CUIHUD_WIN_TTY\s*:/.test(around) && /CUIHUD_WIN_CONOUT\s*:/.test(around))) {
      found.push('noTtyOverride with an MSYS shim and no CUIHUD_WIN_TTY and CUIHUD_WIN_CONOUT beside it: it writes to /dev/tty')
    }
  }
  return found
}

/** The one intended spawn of a leak shape: the sandbox guard's, by repo-relative path. */
const ALLOWED = new Map<string, (call: string) => boolean>([
  [join('src', 'session', 'agent-hud-test-sandbox.test.ts'), (call) => /CUIHUD_PROBE/.test(call)]
])

/** `file: why` for every unpinned spawn in the files under `roots` that import `child_process`. */
function offendersIn(roots: string[], base = MOBILE): string[] {
  return roots.flatMap((root) =>
    sourceFiles(root)
      .filter((file) => file !== __filename)
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        return /child_process/.test(source)
          ? unpinnedSpawns(source, ALLOWED.get(relative(base, file))).map((why) => `${basename(file)}: ${why}`)
          : []
      })
  )
}

describe('no test can reach a real terminal through a beacon script', () => {
  it('every spawn of one of our scripts, in a test, a helper or scripts/, is pinned to a temp file or cannot find an ancestor tty', () => {
    expect(offendersIn(ROOTS)).toEqual([])
  })

  it('the detector sees the shapes that leaked', () => {
    const leak = `import { execFileSync } from 'node:child_process'
      const s = CLAUDE_HUD_STATUSLINE_SCRIPT
      execFileSync('sh', ['-c', s], { env: { PATH: p, HOME: h, CUIHUD_TTY: '' } })`
    expect(unpinnedSpawns(leak)).toHaveLength(1)
    const bare = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
      execFileSync('sh', ['-c', s], { input: 'x' })`
    expect(unpinnedSpawns(bare)).toHaveLength(1)
    const pinned = `const tty = join(mkdtempSync(join(tmpdir(), 'x-')), 'pty')
      const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
      execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: tty } })`
    expect(unpinnedSpawns(pinned)).toEqual([])
    const shimmed = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
      execFileSync('sh', ['-c', s], { env: { PATH: noTerminalPath(), CUIHUD_TTY: '' } })`
    expect(unpinnedSpawns(shimmed)).toEqual([])
    expect(unpinnedSpawns("const s = CLAUDE_HUD_STATUSLINE_SCRIPT\n// execFileSync('sh', [s])")).toEqual([])
    expect(unpinnedSpawns("execFileSync('sh', ['-c', 'echo'])")).toEqual([])
    expect(unpinnedSpawns("run(s, { noTtyOverride: true })\nconst s = CLAUDE_HUD_STATUSLINE_SCRIPT")).toHaveLength(1)
  })

  // Opus's five ways past the first version (review, 2026-10-06). Each shape is
  // flagged here, and none of them occurs in the suite today.
  describe('the bypasses a reviewer found', () => {
    it('R3: a harmless-looking word in the call does not exempt a call that runs a script', () => {
      const src = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', 'uname; command -v cat; ' + s], { input: 'x' })`
      expect(unpinnedSpawns(src)).toHaveLength(1)
      const cat = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('cat', [tty], { encoding: 'latin1' })`
      expect(unpinnedSpawns(cat)).toEqual([])
    })

    it('R4: CUIHUD_TTY: tty is pinned only when tty comes from a temp directory or is a literal path', () => {
      const empty = `const tty = ''
        const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: tty } })`
      expect(unpinnedSpawns(empty)).toHaveLength(1)
      const param = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: whoKnows } })`
      expect(unpinnedSpawns(param)).toHaveLength(1)
      const real = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: '/dev/ttys003' } })`
      expect(unpinnedSpawns(real)).toHaveLength(1)
      const envTty = `const tty = process.env.CUIHUD_TTY
        const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: tty } })`
      expect(unpinnedSpawns(envTty)).toHaveLength(1)
      const literal = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: '/nonexistent-dir/tty' } })`
      expect(unpinnedSpawns(literal)).toEqual([])
      const viaTmpdir = `const tty = join(process.env.TMPDIR ?? '/tmp', 'x.txt')
        const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: tty } })`
      expect(unpinnedSpawns(viaTmpdir)).toEqual([])
    })

    it('R5: a script reached through a builder, with no constant named, is scanned', () => {
      for (const builder of [
        'buildClaudeHudSettingsJson()',
        "agentHudLaunchFlag('claude', null)",
        "buildCodexHudNotifyOverride('darwin')"
      ]) {
        const src = `const flag = ${builder}\nexecFileSync('sh', ['-c', flag], { input: 'x' })`
        expect(unpinnedSpawns(src), builder).toHaveLength(1)
      }
      const imported = `import { whatever } from './agent-hud-launch-args'\nexecFileSync('sh', ['-c', whatever], {})`
      expect(unpinnedSpawns(imported)).toHaveLength(1)
    })

    it('R6: an MSYS shim without both console overrides would write to /dev/tty, and is flagged', () => {
      const msys = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        run(s, { pathShim: msysShim(), noTtyOverride: true })`
      expect(unpinnedSpawns(msys)).toHaveLength(1)
      const halfPinned = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        run(s, { pathShim: msysShim(), noTtyOverride: true, env: { CUIHUD_WIN_TTY: c } })`
      expect(unpinnedSpawns(halfPinned)).toHaveLength(1)
      const pinned = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        run(s, { pathShim: msysShim(), noTtyOverride: true, env: { CUIHUD_WIN_TTY: c, CUIHUD_WIN_CONOUT: d } })`
      expect(unpinnedSpawns(pinned)).toEqual([])
      const spawned = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        execFileSync('sh', ['-c', s], { env: { PATH: msysShimPath, CUIHUD_TTY: '' } })`
      expect(unpinnedSpawns(spawned)).toHaveLength(1)
    })

    it('R7: helper modules and scripts/**/*.test.ts are scanned too', () => {
      const root = mkdtempSync(join(tmpdir(), 'tty-ratchet-'))
      mkdirSync(join(root, 'src', 'x'), { recursive: true })
      mkdirSync(join(root, 'scripts'), { recursive: true })
      const offender = `import { execFileSync } from 'node:child_process'
        execFileSync('sh', ['-c', CLAUDE_HUD_STOP_HOOK_SCRIPT], { env: { ...process.env, CUIHUD_TTY: '' } })`
      writeFileSync(join(root, 'src', 'x', 'runner.test-support.ts'), offender)
      writeFileSync(join(root, 'scripts', 'thing.test.ts'), offender)
      writeFileSync(join(root, 'src', 'x', 'fine.test.ts'), "const a = 1")
      const found = offendersIn([join(root, 'src'), join(root, 'scripts')])
      expect(found.map((line) => line.split(':')[0]).sort()).toEqual(['runner.test-support.ts', 'thing.test.ts'])
    })

    it('a // inside a string is not a comment, so what follows it is still read', () => {
      const src = `const url = 'http://x'; const s = CLAUDE_HUD_STOP_HOOK_SCRIPT; execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: '' } })`
      expect(unpinnedSpawns(src)).toHaveLength(1)
      const template = "const s = CLAUDE_HUD_STOP_HOOK_SCRIPT; run(`a // b`); execFileSync('sh', ['-c', s], {})"
      expect(unpinnedSpawns(template)).toHaveLength(1)
    })
  })

  // Opus's second round (2026-10-06). The cheap ones are fixed; the shapes
  // below (a string-form execSync, a script piped on stdin, wrappers in
  // helpers, aliases and promisify) are NOT chased: the global sandbox
  // (vitest.global-setup.ts, proved by agent-hud-test-sandbox.test.ts) is the
  // primary guard, and this ratchet is the second line for a spawn that builds
  // its environment from nothing.
  describe('the second round', () => {
    it('F3: a pathShim counts only when it is a ps shim, or an MSYS shim with both console overrides', () => {
      const anyShim = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        run(s, { pathShim: someDir, noTtyOverride: true })`
      expect(unpinnedSpawns(anyShim)).toHaveLength(1)
      const unameShim = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        run(s, { pathShim: unameOnly(), noTtyOverride: true })`
      expect(unpinnedSpawns(unameShim)).toHaveLength(1)
      const psShimmed = `const s = CLAUDE_HUD_STATUSLINE_SCRIPT
        run(s, { pathShim: psShimDir, noTtyOverride: true })`
      expect(unpinnedSpawns(psShimmed)).toEqual([])
    })

    it('F4: CUIHUD_WIN_CONOUT exempts only a PowerShell spawn, never the POSIX walk', () => {
      const posix = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_WIN_CONOUT: c, CUIHUD_TTY: '' } })`
      expect(unpinnedSpawns(posix)).toHaveLength(1)
      const bare = `const s = CLAUDE_HUD_STOP_HOOK_SCRIPT
        execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_WIN_CONOUT: c } })`
      expect(unpinnedSpawns(bare)).toHaveLength(1)
      const pwsh = `const s = CLAUDE_HUD_STOP_HOOK_POWERSHELL
        execFileSync(pwsh ?? 'pwsh', ['-Command', s], { env: { ...process.env, CUIHUD_WIN_CONOUT: c } })`
      expect(unpinnedSpawns(pwsh)).toEqual([])
    })

    it('F5: a name counts as a temp path only when EVERY assignment of it is one', () => {
      const second = `function a() { const tty = join(mkdtempSync(join(tmpdir(), 'x-')), 'pty'); return tty }
        function b() { const tty = ''; execFileSync('sh', ['-c', CLAUDE_HUD_STOP_HOOK_SCRIPT], { env: { ...process.env, CUIHUD_TTY: tty } }) }`
      expect(unpinnedSpawns(second)).toHaveLength(1)
      const both = `function a() { const tty = join(mkdtempSync(join(tmpdir(), 'x-')), 'pty'); return tty }
        function b() { const tty = join(tmpdir(), 'y'); execFileSync('sh', ['-c', CLAUDE_HUD_STOP_HOOK_SCRIPT], { env: { ...process.env, CUIHUD_TTY: tty } }) }`
      expect(unpinnedSpawns(both)).toEqual([])
    })

    it('a // inside a regex literal is not a comment either', () => {
      const src = `const re = /\\/\\//; const s = CLAUDE_HUD_STOP_HOOK_SCRIPT; execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: '' } })`
      expect(unpinnedSpawns(src)).toHaveLength(1)
      const division = `const half = a / b; const s = CLAUDE_HUD_STOP_HOOK_SCRIPT; execFileSync('sh', ['-c', s], { env: { ...process.env, CUIHUD_TTY: '' } })`
      expect(unpinnedSpawns(division)).toHaveLength(1)
    })
  })

  // Third round (2026-10-06): the sandbox's `ps` shadows only a spawn that keeps
  // PATH. A spawn with its own PATH finds the real `/bin/ps`, which macOS will not
  // let us shadow, walks to the real terminal and writes (a reviewer's scratch
  // spawn did exactly that). The primary guard is now scripts/run-detached.mjs
  // (src/test/vitest-runs-detached.test.ts); the sandbox is the second line; this
  // is the third.
  describe('the third round', () => {
    const head = `const tty = join(mkdtempSync(join(tmpdir(), 'x-')), 'pty')\nconst s = CLAUDE_HUD_STOP_HOOK_SCRIPT\n`
    it('flags a spawn whose environment is built without PATH from process.env', () => {
      for (const env of [
        "{ PATH: '/usr/bin:/bin', CUIHUD_TTY: tty }",
        '{ HOME: h, CUIHUD_TTY: tty }',
        "{ PATH: '', CUIHUD_TTY: tty }"
      ]) {
        expect(unpinnedSpawns(`${head}execFileSync('sh', ['-c', s], { env: ${env} })`), env).toHaveLength(1)
      }
    })

    it('accepts one that spreads process.env or builds PATH from it, and one with no env at all', () => {
      for (const env of [
        '{ ...process.env, CUIHUD_TTY: tty }',
        "{ PATH: process.env.PATH ?? '', HOME: h, CUIHUD_TTY: tty }",
        '{ PATH: noTerminalPath(), CUIHUD_TTY: tty }'
      ]) {
        expect(unpinnedSpawns(`${head}execFileSync('sh', ['-c', s], { env: ${env} })`), env).toEqual([])
      }
      expect(unpinnedSpawns(`${head}execFileSync('sh', ['-c', s], { input: 'x' })`)).toHaveLength(1)
      const viaName = `${head}const path = \`${'${shim}'}:${'${process.env.PATH}'}\`\nexecFileSync('sh', ['-c', s], { env: { PATH: path, CUIHUD_TTY: tty } })`
      expect(unpinnedSpawns(viaName)).toEqual([])
    })

    it('the allow-list is the one file by its repo-relative path, and the one call that carries the probe', () => {
      const root = mkdtempSync(join(tmpdir(), 'tty-ratchet-allow-'))
      mkdirSync(join(root, 'src', 'session'), { recursive: true })
      const leak = `import { spawnSync } from 'node:child_process'
        spawnSync('sh', ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], { env: { ...process.env, CUIHUD_TTY: '' } })`
      // Same basename as the guard, another path: no longer exempt.
      writeFileSync(join(root, 'src', 'session', 'agent-hud-test-sandbox.test.ts'), leak)
      expect(offendersIn([join(root, 'src')])).toHaveLength(1)
      // Inside the allowed file only a call that names the probe is exempt.
      const guard = "spawnSync('sh', ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], { env: { ...process.env, CUIHUD_TTY: '', CUIHUD_PROBE: probe } })"
      expect(unpinnedSpawns(guard, (call) => /CUIHUD_PROBE/.test(call))).toEqual([])
      expect(unpinnedSpawns(leak, (call) => /CUIHUD_PROBE/.test(call))).toHaveLength(1)
    })

    it('reads a large source in linear time (a regex per slash over a growing prefix was quadratic)', () => {
      const body = Array.from({ length: 30_000 }, (_, i) => `const q${i} = a${i} / b${i}`).join('\n')
      const started = performance.now()
      expect(unpinnedSpawns(`${body}\nconst s = CLAUDE_HUD_STOP_HOOK_SCRIPT\nexecFileSync('sh', ['-c', s], {})`)).toHaveLength(1)
      expect(performance.now() - started).toBeLessThan(600)
    })
  })
})
