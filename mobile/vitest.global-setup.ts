import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { assertNoTerminalAncestors } from './vitest.ancestors'

/**
 * The sandbox every test runs in, set up once before any worker starts.
 *
 * Why: our hook and status-line scripts end in a tty writer that, with no
 * `CUIHUD_TTY`, walks up six parents with `ps -o tty=` and writes to the first
 * terminal it finds. A test runs under vitest, under the tool's shell, under
 * the agent, which sits on the user's REAL PTY: one test that ran the script
 * with `CUIHUD_TTY: ''` wrote a beacon for a synthetic session into the live
 * terminal and the phone drew "the chat stays on Claude's own session
 * 00000000" (2026-10-06). A source-reading ratchet catches the shapes it knows;
 * this closes it for the spawns it does not know about, as long as they keep PATH:
 *
 * - a `ps` that prints nothing (and logs each call to `ps.log`, so a test can
 *   prove it was the one found) goes first on PATH, so no walk sees an ancestor;
 * - `CUIHUD_TTY`, `CUIHUD_WIN_TTY` and `CUIHUD_WIN_CONOUT` point at temp files,
 *   so the MSYS branch's `/dev/tty` fallback is never reached either.
 *
 * This is the SECOND line. The primary guard is that the tests run with no
 * terminal among their ancestors (scripts/run-detached.mjs, checked by
 * src/test/vitest-runs-detached.test.ts), because the walk reads ANCESTORS.
 *
 * Workers (forks and threads) inherit `process.env` from this process, and a
 * spawn that spreads or inherits it inherits all of it. A spawn with its OWN
 * PATH is not covered: it finds the real `/bin/ps`, which macOS will not let a
 * PATH entry shadow, and walks the real ancestors. The ratchet
 * (agent-hud-tests-reach-no-real-tty.test.ts) is the third line for that shape.
 * `agent-hud-test-sandbox.test.ts` checks the sandbox is in place and used.
 */
export default function setup(): () => void {
  // First, before any worker or file: fail here, with zero tests run, when a
  // terminal is among this process's ancestors (see vitest.ancestors.ts).
  assertNoTerminalAncestors()
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-test-sandbox-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'ps.log')
  writeFileSync(log, '')
  // Each call is logged with CUIHUD_PROBE, a token a test may put in the
  // environment of one spawn, so it can tell its own walk's calls from another's.
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\necho "\${CUIHUD_PROBE:-}|$*" >> '${log}'\nexit 0\n`)
  chmodSync(join(bin, 'ps'), 0o755)
  for (const sink of ['tty', 'wintty', 'conout']) {
    writeFileSync(join(dir, sink), '')
  }
  process.env.CUIHUD_TEST_SANDBOX = dir
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`
  process.env.CUIHUD_TTY = join(dir, 'tty')
  process.env.CUIHUD_WIN_TTY = join(dir, 'wintty')
  process.env.CUIHUD_WIN_CONOUT = join(dir, 'conout')
  return () => {
    rmSync(dir, { recursive: true, force: true })
  }
}
