import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLAUDE_HUD_STATUSLINE_SCRIPT } from './agent-hud-launch-args'

// The primary guard against a test writing a beacon into the REAL terminal it
// runs under (2026-10-06, session `00000000-…` on the phone's tab). The ratchet
// (agent-hud-tests-reach-no-real-tty.test.ts) reads source and misses shapes;
// this is structural: vitest's globalSetup (vitest.global-setup.ts) puts a `ps`
// that sees nothing first on PATH and points every tty override at a temp file
// BEFORE any worker starts, so a spawn that merely inherits or spreads
// `process.env` cannot walk to a real tty whatever its source looks like.
//
// This test spawns the original leak shape, `{ ...process.env, CUIHUD_TTY: '' }`
// with a real status-line payload, and checks the sandbox held: the `ps` the
// walk found was the sandbox's (its call log shows it), and no sink got a byte.
// It checks the sandbox is in place BEFORE spawning, so with the global setup
// missing it fails without running the script at all, never leaking to find out.
const SANDBOX = process.env.CUIHUD_TEST_SANDBOX ?? ''
const statusJson = JSON.stringify({
  session_id: '00000000-0000-4000-8000-000000000000',
  model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1' },
  cwd: '/p'
})

describe('the vitest sandbox every test runs in', () => {
  it('is in place before any test: a ps that sees nothing first on PATH, and every tty override on a temp file', () => {
    expect(SANDBOX, 'vitest.global-setup.ts did not run').not.toBe('')
    expect((process.env.PATH ?? '').split(':')[0]).toBe(join(SANDBOX, 'bin'))
    expect(process.env.CUIHUD_TTY).toBe(join(SANDBOX, 'tty'))
    expect(process.env.CUIHUD_WIN_TTY).toBe(join(SANDBOX, 'wintty'))
    expect(process.env.CUIHUD_WIN_CONOUT).toBe(join(SANDBOX, 'conout'))
    const found = spawnSync('sh', ['-c', 'command -v ps; ps -o tty= -p $$'], { encoding: 'utf8' })
    expect(found.stdout).toBe(`${join(SANDBOX, 'bin', 'ps')}\n`)
  })

  it('holds the original leak shape: the status-line script with CUIHUD_TTY empty reaches no terminal', () => {
    // Never spawn without the sandbox: a failed precondition is the red.
    expect(SANDBOX, 'vitest.global-setup.ts did not run').not.toBe('')
    expect((process.env.PATH ?? '').split(':')[0]).toBe(join(SANDBOX, 'bin'))
    const log = join(SANDBOX, 'ps.log')
    const before = readFileSync(log, 'utf8').split('\n').filter(Boolean).length
    const r = spawnSync('sh', ['-c', CLAUDE_HUD_STATUSLINE_SCRIPT], {
      input: statusJson,
      encoding: 'utf8',
      env: { ...process.env, CUIHUD_TTY: '' },
      timeout: 20_000
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    // The walk ran and the sandbox's ps was the one it asked.
    const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean)
    expect(calls.length).toBeGreaterThan(before)
    expect(calls.slice(before).some((call) => /-o tty=/.test(call))).toBe(true)
    for (const sink of ['tty', 'wintty', 'conout']) {
      expect(statSync(join(SANDBOX, sink)).size, sink).toBe(0)
    }
  })
})
