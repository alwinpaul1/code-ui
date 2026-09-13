import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tokenizeStartupCommand } from '../../../src/shared/tui-agent-startup-shell'
import {
  agentHudLaunchFlag,
  buildAgentHudLaunchArgs,
  buildClaudeHudSettingsJson,
  buildCodexHudNotifyOverride,
  CLAUDE_HUD_STATUSLINE_POWERSHELL,
  CLAUDE_HUD_STATUSLINE_SCRIPT,
  CLAUDE_HUD_WINDOWS_COMMAND,
  CODEX_HUD_NOTIFY_POWERSHELL,
  CODEX_HUD_NOTIFY_SCRIPT,
  encodePowerShellCommand,
  CLAUDE_HUD_STOP_HOOK_POWERSHELL
} from './agent-hud-launch-args'

// Captured 2026-09-09 from Claude Code 2.1.266 on macOS: the JSON it pipes to a
// status-line command, paths redacted. This is the real contract, not a guess.
const statusJson = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-statusline-2.1.266.json', import.meta.url)),
  'utf8'
)
// Captured 2026-09-09 from a real codex-cli 0.153.4 rollout: the first and last
// `turn_context` and `token_count` records, paths and ids redacted, long prompt
// strings trimmed. Two token counts, so "the last one wins" is actually tested.
const rolloutJsonl = readFileSync(
  fileURLToPath(new URL('./fixtures/codex-rollout-0.153.4.jsonl', import.meta.url)),
  'utf8'
)

const ESC = '\u001b'
const BEL = '\u0007'
// Captured 2026-09-09 from this machine's own Claude Code 2.1.266 transcript:
// a task-notification written as a user turn (task finished while idle) and
// the queue-operation enqueue/remove pair Claude writes when one finishes
// MID-TURN — the kind Orca's transcript reader never surfaces. Paths redacted.
const transcriptWithNotifications = readFileSync(
  fileURLToPath(
    new URL('./fixtures/claude-transcript-task-notifications-2.1.266.jsonl', import.meta.url)
  ),
  'utf8'
)

/** Shells only; CI runners have no zsh, and Claude Code hands the command to sh.
 *  `dash` is Debian/Ubuntu's /bin/sh and the strictest of the three, so it is
 *  included wherever it exists — a Linux host runs this script under it. */
const SHELLS: readonly string[] = ['sh', 'bash', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])]

type Run = { stdout: string; beacon: string | null }

function runScript(
  script: string,
  options: {
    input?: string
    args?: string[]
    env?: Record<string, string>
    shell?: string
    /** Prepended to PATH; used to put a fake `uname` in front of the real one. */
    pathShim?: string
    /** Leaves CUIHUD_TTY unset, so the script has to find a device itself. */
    noTtyOverride?: boolean
  }
): Run {
  const home = mkdtempSync(join(tmpdir(), 'cuihud-home-'))
  const tty = join(mkdtempSync(join(tmpdir(), 'cuihud-tty-')), 'pty')
  const path = options.pathShim
    ? `${options.pathShim}:${process.env.PATH ?? ''}`
    : (process.env.PATH ?? '')
  const stdout = execFileSync(options.shell ?? 'sh', ['-c', script, ...(options.args ?? [])], {
    input: options.input ?? '',
    encoding: 'utf8',
    env: {
      PATH: path,
      HOME: home,
      ...(options.noTtyOverride ? {} : { CUIHUD_TTY: tty }),
      ...options.env
    }
  })
  let beacon: string | null = null
  try {
    beacon = readFileSync(tty, 'utf8')
  } catch {
    beacon = null
  }
  return { stdout, beacon }
}

function withUsage(
  json: string,
  usage: { input: number; create: number; read: number; pct: number }
): string {
  const parsed = JSON.parse(json)
  parsed.context_window.current_usage = {
    input_tokens: usage.input,
    cache_creation_input_tokens: usage.create,
    cache_read_input_tokens: usage.read,
    output_tokens: 900
  }
  parsed.context_window.used_percentage = usage.pct
  parsed.context_window.remaining_percentage = 100 - usage.pct
  return JSON.stringify(parsed)
}

describe("the phone reads Claude Code's own state without drawing a row", () => {
  it('sends model, effort, window and both limits on an invisible escape, printing nothing', () => {
    const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, { input: statusJson })
    // Empty stdout is the whole point: Claude Code draws no status row for it.
    expect(run.stdout).toBe('')
    expect(run.beacon).toBe(
      `${ESC}]7777;CUIHUD1 agent=claude model=claude-fable-5-1 name=Fable%205.1 effort=medium win=1000000 h5=37:1788967200 d7=36:1788973200${BEL}`
    )
  })

  it('adds the token total and the percentage once Claude Code has replied once', () => {
    const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
      input: withUsage(statusJson, { input: 12000, create: 30000, read: 607540, pct: 64.95 })
    })
    // The percentage is truncated to an integer, not passed through as 64.95.
    expect(run.beacon).toBe(
      `${ESC}]7777;CUIHUD1 agent=claude model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64 h5=37:1788967200 d7=36:1788973200${BEL}`
    )
    expect(run.stdout).toBe('')
  })

  it('reads the same under sh and bash, the shells Claude Code may hand it to', () => {
    for (const shell of SHELLS) {
      const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, { input: statusJson, shell })
      expect(run.beacon).toContain('model=claude-fable-5-1')
      expect(run.beacon).toContain('effort=medium')
    }
  })

  it("keeps a user's own status line exactly as it was", () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cuihud-cwd-'))
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify(
        { statusLine: { type: 'command', command: 'printf "my own bar"' } },
        null,
        2
      )
    )
    const json = JSON.parse(statusJson)
    json.cwd = cwd
    const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, { input: JSON.stringify(json) })
    expect(run.stdout).toBe('my own bar')
    // …and the beacon still went out alongside it.
    expect(run.beacon).toContain('CUIHUD1 agent=claude')
  })

  it("keeps a user's own status line without node, python3 or jq on the host", () => {
    // Claude Code's native install is one binary: a Windows or minimal Linux
    // host may have none of those runtimes, and the user's bar must not vanish
    // because of it. Broken runtimes stand in for missing ones (a PATH entry
    // cannot hide /usr/bin/python3 on this Mac), and the command carries the
    // two JSON escapes a shell command can contain.
    const shim = mkdtempSync(join(tmpdir(), 'cuihud-noruntime-'))
    for (const name of ['node', 'python3', 'jq']) {
      writeFileSync(join(shim, name), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    }
    const cwd = mkdtempSync(join(tmpdir(), 'cuihud-cwd-'))
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify(
        {
          statusLine: { type: 'command', command: 'printf "%s" "my \\"own\\" bar\\\\path"', padding: 0 },
          model: 'opus'
        },
        null,
        2
      )
    )
    const json = JSON.parse(statusJson)
    json.cwd = cwd
    for (const shell of SHELLS) {
      const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
        input: JSON.stringify(json),
        pathShim: shim,
        shell
      })
      expect(run.stdout).toBe('my "own" bar\\path')
      expect(run.beacon).toContain('CUIHUD1 agent=claude')
    }
  })

  it('writes nothing anywhere when it cannot find the terminal', () => {
    const home = mkdtempSync(join(tmpdir(), 'cuihud-home-'))
    const stdout = execFileSync('sh', ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], {
      input: statusJson,
      encoding: 'utf8',
      // No CUIHUD_TTY and no reachable parent tty: the Windows/Git Bash case.
      env: { PATH: process.env.PATH ?? '', HOME: home, CUIHUD_TTY: '' }
    })
    expect(stdout).toBe('')
  })
})

describe('a Windows host has no PTY device, so the script writes to the console', () => {
  /** Git Bash reports MINGW64_NT-10.0; a PATH shim is the honest way to reach
   *  that branch from a Mac, since only `uname -s` selects it. */
  function msysShim(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-shim-'))
    writeFileSync(join(dir, 'uname'), '#!/bin/sh\nprintf %s "MINGW64_NT-10.0-22631"\n', {
      mode: 0o755
    })
    return dir
  }

  it('writes the beacon to /dev/tty instead of walking to a PTY device', () => {
    const console_ = join(mkdtempSync(join(tmpdir(), 'cuihud-con-')), 'tty')
    const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
      input: statusJson,
      pathShim: msysShim(),
      noTtyOverride: true,
      env: { CUIHUD_WIN_TTY: console_ }
    })
    expect(run.stdout).toBe('')
    expect(readFileSync(console_, 'utf8')).toBe(
      `${ESC}]7777;CUIHUD1 agent=claude model=claude-fable-5-1 name=Fable%205.1 effort=medium win=1000000 h5=37:1788967200 d7=36:1788973200${BEL}`
    )
  })

  it('falls back to /dev/conout when the console cannot be opened', () => {
    const conout = join(mkdtempSync(join(tmpdir(), 'cuihud-con-')), 'conout')
    runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
      input: statusJson,
      pathShim: msysShim(),
      noTtyOverride: true,
      env: {
        // A path under a directory that does not exist: the open fails.
        CUIHUD_WIN_TTY: '/cuihud-no-such-dir/tty',
        CUIHUD_WIN_CONOUT: conout
      }
    })
    expect(readFileSync(conout, 'utf8')).toContain('CUIHUD1 agent=claude')
  })

  it('says nothing and fails nothing when neither console can be opened', () => {
    const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
      input: statusJson,
      pathShim: msysShim(),
      noTtyOverride: true,
      env: {
        CUIHUD_WIN_TTY: '/cuihud-no-such-dir/tty',
        CUIHUD_WIN_CONOUT: '/cuihud-no-such-dir/conout'
      }
    })
    expect(run.stdout).toBe('')
  })

  it("survives an MSYS ps that does not understand -o tty=", () => {
    // MSYS ships its own `ps`; the walk must never error out on it. Faked here
    // by a shim that fails the way that one does, with uname left as the Mac's
    // so the POSIX walk is the branch under test.
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-shim-'))
    writeFileSync(join(dir, 'ps'), '#!/bin/sh\necho "ps: unknown option" >&2\nexit 1\n', {
      mode: 0o755
    })
    const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
      input: statusJson,
      pathShim: dir,
      noTtyOverride: true
    })
    expect(run.stdout).toBe('')
  })
})

describe("the phone reads Codex's own rollout without drawing a row", () => {
  const threadId = '01a00000-0000-7000-8000-000000000000'
  const notifyJson = JSON.stringify({
    type: 'agent-turn-complete',
    'thread-id': threadId,
    'turn-id': '01a00000-0000-7000-8000-000000000001',
    cwd: '/Users/me/Project',
    client: 'codex-tui',
    'input-messages': ['hello'],
    'last-assistant-message': 'done'
  })

  function codexHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'cuihud-codex-'))
    const day = join(home, 'sessions', '2026', '09', '07')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, `rollout-2026-09-07T00-17-44-${threadId}.jsonl`), rolloutJsonl)
    return home
  }

  it('sends model, effort and the latest context figures for the thread that just replied', () => {
    const run = runScript(CODEX_HUD_NOTIFY_SCRIPT, {
      args: ['cuihud', notifyJson],
      env: { CODEX_HOME: codexHome() }
    })
    expect(run.stdout).toBe('')
    // 22147 is the LAST token_count in the fixture, not the first (21364).
    expect(run.beacon).toBe(
      `${ESC}]7777;CUIHUD1 agent=codex model=gpt-6-astra effort=high used=22147 win=258400${BEL}`
    )
  })

  it('reads the same under sh and bash', () => {
    for (const shell of SHELLS) {
      const run = runScript(CODEX_HUD_NOTIFY_SCRIPT, {
        args: ['cuihud', notifyJson],
        env: { CODEX_HOME: codexHome() },
        shell
      })
      expect(run.beacon).toContain('used=22147 win=258400')
    }
  })

  it('says nothing at all when the thread has no rollout to read', () => {
    const run = runScript(CODEX_HUD_NOTIFY_SCRIPT, {
      args: ['cuihud', JSON.stringify({ 'thread-id': 'no-such-thread' })],
      env: { CODEX_HOME: codexHome() }
    })
    expect(run.beacon).toBe(`${ESC}]7777;CUIHUD1 agent=codex${BEL}`)
  })

  it("still runs the user's own notify command", () => {
    const home = codexHome()
    const marker = join(mkdtempSync(join(tmpdir(), 'cuihud-notify-')), 'ran')
    writeFileSync(
      join(home, 'config.toml'),
      `model = "gpt-6-astra"\nnotify = ["/bin/sh","-c","printf %s \\"$1\\" > ${marker}","x"]\n`
    )
    runScript(CODEX_HUD_NOTIFY_SCRIPT, {
      args: ['cuihud', notifyJson],
      env: { CODEX_HOME: home }
    })
    expect(readFileSync(marker, 'utf8')).toContain('agent-turn-complete')
  })
})

describe('the flags survive the trip through Orca to the host shell', () => {
  it("travels as exactly two tokens and carries no single quote of its own", () => {
    const claude = buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: '', hostPlatform: 'darwin' })!
    const claudeTokens = tokenizeStartupCommand(claude, 'posix')
    expect(claudeTokens.ok).toBe(true)
    if (claudeTokens.ok) {
      expect(claudeTokens.tokens).toEqual(['--settings', buildClaudeHudSettingsJson()])
      expect(JSON.parse(claudeTokens.tokens[1]!).statusLine.command).toBe(
        CLAUDE_HUD_STATUSLINE_SCRIPT
      )
    }
    expect(CLAUDE_HUD_STATUSLINE_SCRIPT).not.toContain("'")

    const codex = buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: '', hostPlatform: 'darwin' })!
    const codexTokens = tokenizeStartupCommand(codex, 'posix')
    expect(codexTokens.ok).toBe(true)
    if (codexTokens.ok) {
      expect(codexTokens.tokens[0]).toBe('-c')
      expect(codexTokens.tokens[1]).toBe(buildCodexHudNotifyOverride('darwin'))
    }
    expect(CODEX_HUD_NOTIFY_SCRIPT).not.toContain("'")
  })

  it('base64-wraps the Codex script, because TOML rejects the escapes in it', () => {
    const value = buildCodexHudNotifyOverride('darwin')
    // TOML would reject a raw \033; the wrapper is plain base64 plus fixed text.
    expect(value).not.toContain('\\033')
    const encoded = /printf %s ([A-Za-z0-9+/=]+) \| base64 -d/.exec(value)?.[1]
    expect(encoded).toBeTruthy()
    expect(Buffer.from(encoded!, 'base64').toString('utf8')).toBe(CODEX_HUD_NOTIFY_SCRIPT)
  })

  // No PowerShell on this machine (`which pwsh powershell` finds neither), so
  // this can only assert the string's shape. The Windows path has NOT been run.
  it('gives a Windows host a PowerShell notify command it can actually spawn', () => {
    const value = buildCodexHudNotifyOverride('win32')
    expect(value.startsWith('notify=["powershell","-NoProfile","-NonInteractive","-Command",')).toBe(
      true
    )
    expect(value).not.toContain('"sh"')
    for (const piece of [
      // Reads the real argv, because -Command appends extra args to the
      // command TEXT rather than binding them to $args.
      '[Environment]::GetCommandLineArgs()',
      'thread.id',
      '$env:CODEX_HOME',
      '$env:USERPROFILE',
      'rollout-*-',
      'Get-Content -LiteralPath $f.FullName -Tail 400',
      'turn_context',
      'token_count',
      'total_tokens',
      'model_context_window',
      // Not stdout (Codex nulls it): the shared console writer, ESC and BEL as
      // [char] codes because `e does not exist in Windows PowerShell 5.1.
      'W $o',
      '$s=[string][char]27+"]7777;"+$o+[string][char]7',
      'AttachConsole',
      'CreateFileW("CONOUT$"',
      'CUIHUD1 agent=codex',
      'config.toml'
    ]) {
      expect(CODEX_HUD_NOTIFY_POWERSHELL).toContain(piece)
    }
    // The trailing comment is what makes the appended JSON argument inert.
    expect(CODEX_HUD_NOTIFY_POWERSHELL.endsWith('; #')).toBe(true)
    expect(CODEX_HUD_NOTIFY_POWERSHELL).not.toContain('\n')
  })

  it('rides through the tokenizer as one -c value, with no single quote in it', () => {
    expect(CODEX_HUD_NOTIFY_POWERSHELL).not.toContain("'")
    const args = buildAgentHudLaunchArgs({
      agent: 'codex',
      hostDefaultArgs: '',
      hostPlatform: 'win32'
    })!
    const tokens = tokenizeStartupCommand(args, 'posix')
    expect(tokens.ok).toBe(true)
    if (tokens.ok) {
      expect(tokens.tokens).toHaveLength(2)
      expect(tokens.tokens[0]).toBe('-c')
      expect(tokens.tokens[1]).toBe(buildCodexHudNotifyOverride('win32'))
      // TOML would reject \*, \{, \s and \d, so every backslash is doubled and
      // the parser hands PowerShell the script back verbatim.
      const script = /,"-Command",(".*")\]$/.exec(tokens.tokens[1]!)?.[1]
      expect(script).toBeTruthy()
      expect(JSON.parse(script!)).toBe(CODEX_HUD_NOTIFY_POWERSHELL)
    }
  })

  it('gives a Windows host a PowerShell status line, base64-encoded so sh and PowerShell both run it', () => {
    // Why: with Git Bash present Claude Code hands the command to sh; without
    // it, to PowerShell (read from 2.1.267). No quoting survives both parsers,
    // so the command is `powershell -EncodedCommand <UTF-16LE base64>`.
    const flag = agentHudLaunchFlag('claude', 'win32')
    const json = JSON.parse(flag.replace(/^--settings '/, '').replace(/'$/, ''))
    expect(json.statusLine.command).toBe(CLAUDE_HUD_WINDOWS_COMMAND)
    expect(CLAUDE_HUD_WINDOWS_COMMAND).toMatch(
      /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/
    )
    expect(
      Buffer.from(CLAUDE_HUD_WINDOWS_COMMAND.split(' ').pop() ?? '', 'base64').toString('utf16le')
    ).toBe(CLAUDE_HUD_STATUSLINE_POWERSHELL)
    expect(CLAUDE_HUD_STATUSLINE_POWERSHELL).not.toContain("'")
    expect(agentHudLaunchFlag('claude', 'darwin')).not.toContain('EncodedCommand')
    expect(agentHudLaunchFlag('claude', null)).toBe(agentHudLaunchFlag('claude', 'darwin'))
  })

  it("keeps the host's own default args in front, and leaves other agents alone", () => {
    expect(buildAgentHudLaunchArgs({ agent: 'claude', hostDefaultArgs: '--verbose', hostPlatform: 'linux' })).toMatch(
      /^--verbose --settings '/
    )
    expect(buildAgentHudLaunchArgs({ agent: 'codex', hostDefaultArgs: '--search', hostPlatform: 'linux' })).toMatch(
      /^--search -c '/
    )
    expect(buildAgentHudLaunchArgs({ agent: 'opencode', hostDefaultArgs: '', hostPlatform: 'darwin' })).toBeNull()
  })
})

describe('finished background tasks ride the Claude beacon', () => {
  function withTranscript(json: string, transcriptPath: string): string {
    const parsed = JSON.parse(json)
    parsed.transcript_path = transcriptPath
    return JSON.stringify(parsed)
  }

  for (const shell of SHELLS) {
    it(`beacons every task id Claude has written a notification for, mid-turn ones included (${shell})`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'cuihud-transcript-'))
      const transcript = join(dir, 'session.jsonl')
      writeFileSync(transcript, transcriptWithNotifications)
      const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
        input: withTranscript(statusJson, transcript),
        shell
      })
      // bqo82xkjk landed as a user turn; b5v3z4u8o only as queue-operation
      // records (enqueue + remove — one id, not two). bnotdone1 is prose, and
      // biifjm40h is a Monitor EVENT: a task id with no <status>, from a task
      // that is still running — it must not be reported finished.
      expect(run.beacon).toContain(' done=bqo82xkjk,b5v3z4u8o')
      expect(run.beacon).not.toContain('bnotdone1')
      expect(run.beacon).not.toContain('biifjm40h')
    })
  }

  // Verbatim tool_result records Claude Code 2.1.267 wrote on 2026-09-11 for a
  // `run_in_background` Bash and a command moved to the background; paths redacted.
  const transcriptWithLaunches = [
    '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01A","type":"tool_result","content":"Command running in background with ID: bajgl5wmo. Output is being written to: /private/tmp/claude-501/x/tasks/bajgl5wmo.output. You will be notified when it completes. To check interim output, use Read on that file path.","is_error":false}]},"uuid":"75a95481-2c35-4b80-81ff-dd558a4522fb","timestamp":"2026-09-11T10:17:50.846Z"}',
    '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01B","type":"tool_result","content":"Command did not complete within its 120s timeout and was moved to the background (ID: b7woddzjt). Output is being written to: /private/tmp/claude-501/x/tasks/b7woddzjt.output.","is_error":false}]},"uuid":"8f0c2b8f-2b1f-4b2e-9c1e-7a9d1f0e2c11","timestamp":"2026-09-11T10:20:01.000Z"}',
    '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<task-notification>\\n<task-id>bajgl5wmo</task-id>\\n<status>completed</status>\\n</task-notification>"}]},"uuid":"c1d2e3f4-0000-4000-8000-000000000001","timestamp":"2026-09-11T10:25:00.000Z"}',
    // Pollution the transcript really carries: the assistant's own command that
    // greps for the launch text, a tool_result that merely PRINTS one (id
    // bfakefake), and prose quoting a notification. None of these are shells.
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01C","name":"Bash","input":{"command":"grep -m1 \\"Command running in background with ID: b\\" transcript.jsonl"}}]},"uuid":"d1","timestamp":"2026-09-11T10:26:00.000Z"}',
    '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01C","type":"tool_result","content":"{\\"type\\":\\"user\\",\\"content\\":\\"Command running in background with ID: bfakefake. Output is being written to","is_error":false}]},"uuid":"d2","timestamp":"2026-09-11T10:26:01.000Z"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"The record looks like <task-notification><task-id>bquotedone</task-id><status>completed</status></task-notification> in the file."}]},"uuid":"d3","timestamp":"2026-09-11T10:26:02.000Z"}',
    ''
  ].join('\n')

  for (const shell of SHELLS) {
    it(`beacons every shell the transcript shows launched, so the count is right mid-turn (${shell})`, () => {
      // Why: the desk read "3 shells" on a 858k-token session while the phone
      // read "1": the launches sat above the window the phone loads, and the
      // Stop hook's run= list was a turn old (2026-09-11).
      const dir = mkdtempSync(join(tmpdir(), 'cuihud-transcript-'))
      const transcript = join(dir, 'session.jsonl')
      writeFileSync(transcript, transcriptWithLaunches)
      const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
        input: withTranscript(statusJson, transcript),
        shell
      })
      expect(run.beacon).toContain(' bg=bajgl5wmo,b7woddzjt')
      expect(run.beacon).toContain(' done=bajgl5wmo')
      expect(run.beacon).not.toContain('bfakefake')
      expect(run.beacon).not.toContain('bquotedone')
      const bg = (run.beacon ?? '').split(' ').find((field) => field.startsWith('bg='))
      expect(bg?.replace(/[^A-Za-z0-9_,=-]/g, '')).toBe('bg=bajgl5wmo,b7woddzjt')
    })
  }

  for (const shell of SHELLS) {
    it(`opens a Windows transcript path, which arrives JSON-escaped with backslashes (${shell})`, () => {
      // Claude Code runs the status-line command through Git Bash on Windows
      // and says so itself: a backslash path "will not resolve" there. The
      // value in the JSON is C:\\Users\\me\\… , so the script converts the
      // separators before opening the file.
      const dir = mkdtempSync(join(tmpdir(), 'cuihud-transcript-'))
      const transcript = join(dir, 'session.jsonl')
      writeFileSync(transcript, transcriptWithNotifications)
      const run = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
        input: withTranscript(statusJson, transcript.replace(/\//g, '\\')),
        shell
      })
      expect(run.beacon).toContain(' done=bqo82xkjk,b5v3z4u8o')
    })
  }

  it('reads the transcript with only the tools Git for Windows, BusyBox and coreutils all ship', () => {
    // Why: this line runs on every status-line refresh on Windows, macOS and
    // Linux. Anything outside this set breaks one of them silently.
    const line = CLAUDE_HUD_STATUSLINE_SCRIPT.split('; ').find((part) => part.includes('dn=$(grep -F'))
    expect(line).toBeDefined()
    const commands = (line ?? '').match(/\b(tail|grep|sed|awk|tr|printf|cat|head|cut|sort|uniq|perl|python3?|node|jq|xargs|rev|tac|mapfile|readarray)\b/g)
    expect([...new Set(commands ?? [])].sort()).toEqual(['awk', 'grep', 'sed', 'tail', 'tr'])
  })

  it('leaves the done field off when the transcript has no notifications, or is unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-transcript-'))
    const empty = join(dir, 'empty.jsonl')
    writeFileSync(empty, '{"type":"user","message":{"role":"user","content":"hi"}}\n')
    expect(runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, { input: withTranscript(statusJson, empty) }).beacon).not.toContain('done=')
    expect(
      runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, {
        input: withTranscript(statusJson, join(dir, 'missing.jsonl'))
      }).beacon
    ).not.toContain('done=')
  })
})

// ─── The Codex Windows script, executed for real ─────────────────────────────
// PowerShell 7 runs on macOS and Linux, so the script can be executed the way
// Codex executes it: `powershell -NoProfile -NonInteractive -Command <script>
// <json>`. Found through `CUIHUD_PWSH` or `pwsh` on PATH; skipped, loudly, when
// neither exists (CI runners have no PowerShell). Windows PowerShell 5.1 and a
// real Windows console remain unrun.
describe('the Codex notify script under a real PowerShell', () => {
  const pwsh = (() => {
    const fromEnv = process.env.CUIHUD_PWSH
    if (fromEnv && existsSync(fromEnv)) {
      return fromEnv
    }
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (dir && existsSync(join(dir, 'pwsh'))) {
        return join(dir, 'pwsh')
      }
    }
    return null
  })()
  // Why 60 s: a cold pwsh on a CI runner can take several seconds to start
  // (first-run assembly caching); the default 5 s timed out on GitHub Actions.
  const run = (name: string, fn: () => void) => (pwsh ? it(name, fn, 60_000) : it.skip(name, fn))
  const threadId = '01a08736-aaaa-bbbb-cccc-000000000001'

  /** `notify` may reference the marker path as `MARKER`. */
  function codexHomeWithRollout(notify?: string): { home: string; marker: string } {
    const home = mkdtempSync(join(tmpdir(), 'cuihud-codex-'))
    const day = join(home, 'sessions', '2026', '09', '09')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, `rollout-2026-09-09T10-00-00-${threadId}.jsonl`), rolloutJsonl)
    const marker = join(home, 'marker.txt')
    writeFileSync(
      join(home, 'config.toml'),
      `model = "gpt-6-astra"\n${(notify ?? '').replace('MARKER', marker)}\n`
    )
    return { home, marker }
  }

  /** Runs the script as Codex does and returns what reached the console seam:
   *  Codex nulls the child's stdout, so the beacon goes to CONOUT$, which the
   *  tests redirect to a file with CUIHUD_WIN_CONOUT. */
  function runPowerShell(home: string, jsonArg: string): string {
    const conout = join(home, 'conout.txt')
    execFileSync(
      pwsh ?? 'pwsh',
      ['-NoProfile', '-NonInteractive', '-Command', CODEX_HUD_NOTIFY_POWERSHELL, jsonArg],
      { encoding: 'utf8', env: { ...process.env, CODEX_HOME: home, CUIHUD_WIN_CONOUT: conout } }
    )
    try {
      return readFileSync(conout, 'utf8')
    } catch {
      return ''
    }
  }

  run('beacons model, effort and the context figures for the thread that just replied', () => {
    const { home } = codexHomeWithRollout()
    const out = runPowerShell(
      home,
      JSON.stringify({ type: 'agent-turn-complete', 'thread-id': threadId, cwd: '/tmp' })
    )
    expect(out).toBe(
      `${ESC}]7777;CUIHUD1 agent=codex model=gpt-6-astra effort=high used=22147 win=258400${BEL}`
    )
  })

  run('says nothing beyond the agent when the thread has no rollout to read', () => {
    // Parity with the sh script: a named thread with no rollout gets no
    // figures rather than another session's.
    const { home } = codexHomeWithRollout()
    const out = runPowerShell(home, JSON.stringify({ 'thread-id': 'no-such-thread-0000' }))
    expect(out).toBe(`${ESC}]7777;CUIHUD1 agent=codex${BEL}`)
  })

  run('falls back to the newest rollout when the argument names no thread', () => {
    // The script's own regex literal contains "thread.id"; before the fix the
    // id was read out of the script text as "0-9A-Za-z" and nothing matched.
    const { home } = codexHomeWithRollout()
    const out = runPowerShell(home, JSON.stringify({ type: 'agent-turn-complete' }))
    expect(out).toContain(' model=gpt-6-astra effort=high used=22147 win=258400')
  })

  run("runs the user's own notify command with the JSON as its last argument", () => {
    const { home, marker } = codexHomeWithRollout(
      'notify = ["sh", "-c", "printf %s \\"$1\\" > MARKER", "cuihud"]'
    )
    const out = runPowerShell(home, JSON.stringify({ type: 'agent-turn-complete', 'thread-id': threadId }))
    expect(out).toContain('CUIHUD1 agent=codex')
    expect(readFileSync(marker, 'utf8')).toContain('agent-turn-complete')
  })

  it('does not depend on PowerShell being present to state where it stands', () => {
    // Why: a skipped suite must never read as a passing one.
    if (!pwsh) {
      console.warn('[agent-hud] pwsh not found: the Codex Windows script was NOT executed here')
    }
    expect(true).toBe(true)
  })
})

// ─── The Claude Windows status line, executed for real ──────────────────────
describe('the Claude status line for Windows under a real PowerShell', () => {
  const pwsh = (() => {
    const fromEnv = process.env.CUIHUD_PWSH
    if (fromEnv && existsSync(fromEnv)) {
      return fromEnv
    }
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (dir && existsSync(join(dir, 'pwsh'))) {
        return join(dir, 'pwsh')
      }
    }
    return null
  })()
  // Why 60 s: a cold pwsh on a CI runner can take several seconds to start
  // (first-run assembly caching); the default 5 s timed out on GitHub Actions.
  const run = (name: string, fn: () => void) => (pwsh ? it(name, fn, 60_000) : it.skip(name, fn))

  function runClaudePowerShell(options: {
    json: string
    home?: string
    selftest?: boolean
    encoded?: boolean
  }): { stdout: string; beacon: string } {
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-ps-'))
    const conout = join(dir, 'conout.txt')
    const args = options.encoded
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          encodePowerShellCommand(CLAUDE_HUD_STATUSLINE_POWERSHELL)
        ]
      : ['-NoProfile', '-NonInteractive', '-Command', CLAUDE_HUD_STATUSLINE_POWERSHELL]
    const stdout = execFileSync(pwsh ?? 'pwsh', args, {
      input: options.json,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: options.home ?? dir,
        CUIHUD_WIN_CONOUT: conout,
        ...(options.selftest ? { CUIHUD_WIN_SELFTEST: '1' } : {})
      }
    })
    let beacon = ''
    try {
      beacon = readFileSync(conout, 'utf8')
    } catch {
      beacon = ''
    }
    return { stdout, beacon }
  }

  run('emits the very same beacon bytes as the sh script, from the same JSON', () => {
    const shell = runScript(CLAUDE_HUD_STATUSLINE_SCRIPT, { input: statusJson })
    const ps = runClaudePowerShell({ json: statusJson })
    expect(ps.beacon).toBe(shell.beacon)
    expect(ps.stdout).toBe('')
  })

  run('runs as Claude Code would run it: -EncodedCommand, JSON on stdin', () => {
    const ps = runClaudePowerShell({ json: statusJson, encoded: true })
    expect(ps.beacon).toContain('CUIHUD1 agent=claude model=claude-fable-5-1')
  })

  run('adds the token total and percentage once Claude Code has replied', () => {
    const json = withUsage(statusJson, { input: 500000, create: 100000, read: 49540, pct: 64.9 })
    const ps = runClaudePowerShell({ json })
    expect(ps.beacon).toContain(' used=649540 win=1000000 pct=64 ')
  })

  run('beacons finished task ids from the transcript, mid-turn ones included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-transcript-'))
    const transcript = join(dir, 'session.jsonl')
    writeFileSync(transcript, transcriptWithNotifications)
    const parsed = JSON.parse(statusJson)
    parsed.transcript_path = transcript
    const ps = runClaudePowerShell({ json: JSON.stringify(parsed) })
    expect(ps.beacon).toContain(' done=bqo82xkjk,b5v3z4u8o')
    expect(ps.beacon).not.toContain('biifjm40h')
  })

  run("keeps a user's own status line exactly as it was", () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cuihud-cwd-'))
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'printf "my own bar"' } }, null, 2)
    )
    const parsed = JSON.parse(statusJson)
    parsed.cwd = cwd
    const ps = runClaudePowerShell({ json: JSON.stringify(parsed) })
    expect(ps.stdout).toBe('my own bar')
    expect(ps.beacon).toContain('CUIHUD1 agent=claude')
  })

  run('defines every kernel32 entry point it needs without compiling anything', () => {
    // The Win32 calls themselves need Windows; that the dynamic P/Invoke type
    // builds on this PowerShell is what can be proven here.
    const ps = runClaudePowerShell({ json: statusJson, selftest: true })
    expect(ps.stdout).toBe('AttachConsole,CloseHandle,CreateFileW,FreeConsole,WriteConsoleW')
  })
})

// The Windows Stop hook, under a real PowerShell when one is on PATH (CI
// runners ship pwsh; this Mac does not, so it skips loudly here).
describe('the Claude Stop hook for Windows under a real PowerShell', () => {
  const pwsh = (() => {
    const fromEnv = process.env.CUIHUD_PWSH
    if (fromEnv && existsSync(fromEnv)) {
      return fromEnv
    }
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (dir && existsSync(join(dir, 'pwsh'))) {
        return join(dir, 'pwsh')
      }
    }
    return null
  })()
  const run = (name: string, fn: () => void) => (pwsh ? it(name, fn, 60_000) : it.skip(name, fn))

  function runStopPowerShell(json: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cuihud-ps-stop-'))
    const conout = join(dir, 'conout.txt')
    execFileSync(pwsh ?? 'pwsh', ['-NoProfile', '-NonInteractive', '-Command', CLAUDE_HUD_STOP_HOOK_POWERSHELL], {
      input: json,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: dir, CUIHUD_WIN_CONOUT: conout }
    })
    try {
      return readFileSync(conout, 'utf8')
    } catch {
      return ''
    }
  }

  run('leaves idle teammates off the list, like the sh hook', () => {
    // Same 2026-09-12 case as agent-hud-stop-hook.test.ts: four council
    // reviewers idle for a day, reported `running` by the Stop payload, shown
    // as "4 running tasks" on the phone while the desk showed none.
    const beacon = runStopPowerShell(
      JSON.stringify({
        background_tasks: [
          { id: 'tma4w24hz', type: 'in_process_teammate', status: 'running', description: 'fable-advisor' },
          { id: 'b0q56d8gf', type: 'shell', status: 'running', description: 'Sleep for 120 seconds' },
          { id: 'tcwll1evo', type: 'in_process_teammate', status: 'running', description: 'council-sonnet' }
        ]
      })
    )
    expect(beacon).toContain('run=b0q56d8gf')
    expect(beacon).not.toContain('tma4w24hz')
    expect(beacon).not.toContain('tcwll1evo')
  })

  it('does not depend on PowerShell being present to state where it stands', () => {
    if (!pwsh) {
      console.warn('[agent-hud] no pwsh on PATH — the Windows Stop hook teammate test was skipped')
    }
    expect(true).toBe(true)
  })
})
