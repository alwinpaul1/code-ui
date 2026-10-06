import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_HUD_STATUSLINE_SCRIPT } from './agent-hud-launch-args'

// The SECOND line against a test writing a beacon into the real terminal it runs
// under (2026-10-06). The primary guard is that the tests run with no terminal
// among their ancestors (scripts/run-detached.mjs, src/test/vitest-runs-detached
// .test.ts), because the tty writer walks ANCESTORS. This file checks the
// globalSetup sandbox (vitest.global-setup.ts): a `ps` that sees nothing first on
// PATH, and every tty override on a temp file, set before any worker starts.
//
// What it proves and what it does not. It proves that, for a spawn that inherits
// or spreads `process.env`, the `ps` command resolves to the sandbox's shim, that
// the shim was called with `-o tty=` by a walk carrying this spawn's own probe
// token, and that no sink grew during it. It does NOT prove a spawn with its own
// PATH is safe: that finds the real, un-shadowable `/bin/ps`. The probe token
// shows the shim call came from an environment this test built, not who the
// caller was. And it spawns the original leak shape ONLY after resolving `ps`
// under the exact environment it will pass, so a broken shim fails without
// running the script.
const SANDBOX = process.env.CUIHUD_TEST_SANDBOX ?? ''
const SHIM = join(SANDBOX, 'bin', 'ps')
const statusJson = JSON.stringify({
  session_id: '00000000-0000-4000-8000-000000000000',
  model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1' },
  cwd: '/p'
})
const sinkSizes = () => ['tty', 'wintty', 'conout'].map((sink) => statSync(join(SANDBOX, sink)).size)

describe('the vitest sandbox every test runs in', () => {
  it('is in place before any test: a ps that sees nothing first on PATH, and every tty override on a temp file', () => {
    expect(SANDBOX, 'vitest.global-setup.ts did not run').not.toBe('')
    expect((process.env.PATH ?? '').split(':')[0]).toBe(join(SANDBOX, 'bin'))
    expect(process.env.CUIHUD_TTY).toBe(join(SANDBOX, 'tty'))
    expect(process.env.CUIHUD_WIN_TTY).toBe(join(SANDBOX, 'wintty'))
    expect(process.env.CUIHUD_WIN_CONOUT).toBe(join(SANDBOX, 'conout'))
  })

  it('holds the original leak shape: the status-line script with CUIHUD_TTY empty reaches no terminal', () => {
    // Never spawn without the sandbox: every failed precondition is the red.
    expect(SANDBOX, 'vitest.global-setup.ts did not run').not.toBe('')
    const probe = randomBytes(6).toString('hex')
    const env = { ...process.env, CUIHUD_TTY: '', CUIHUD_PROBE: probe }
    // `ps` as the spawn will resolve it, under the exact environment it gets.
    const resolved = spawnSync('sh', ['-c', 'command -v ps'], { encoding: 'utf8', env })
    expect(resolved.stdout.trim(), 'the ps this spawn would run is not the sandbox shim').toBe(SHIM)
    const log = join(SANDBOX, 'ps.log')
    const sinksBefore = sinkSizes()
    const logBefore = readFileSync(log, 'utf8').split('\n').filter(Boolean).length
    const r = spawnSync('sh', ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], {
      input: statusJson,
      encoding: 'utf8',
      env: { ...process.env, CUIHUD_TTY: '', CUIHUD_PROBE: probe },
      timeout: 20_000
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    // The walk ran, and the shim was asked by an environment carrying this probe.
    const mine = readFileSync(log, 'utf8').split('\n').filter((line) => line.startsWith(`${probe}|`))
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.some((line) => /-o tty=/.test(line))).toBe(true)
    expect(readFileSync(log, 'utf8').split('\n').filter(Boolean).length).toBeGreaterThan(logBefore)
    // No sink grew during this spawn (another test's own frames are not ours to judge).
    expect(sinkSizes()).toEqual(sinksBefore)
  })
})
