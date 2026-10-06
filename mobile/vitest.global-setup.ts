import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

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
 * this makes the leak impossible for the ones it does not:
 *
 * - a `ps` that prints nothing (and logs each call to `ps.log`, so a test can
 *   prove it was the one found) goes first on PATH, so no walk sees an ancestor;
 * - `CUIHUD_TTY`, `CUIHUD_WIN_TTY` and `CUIHUD_WIN_CONOUT` point at temp files,
 *   so the MSYS branch's `/dev/tty` fallback is never reached either.
 *
 * Workers (forks and threads) inherit `process.env` from this process, and a
 * spawn that spreads or inherits it inherits all of it. Only a spawn that
 * builds an environment from nothing, with its own PATH, escapes it, and the
 * ratchet (agent-hud-tests-reach-no-real-tty.test.ts) is the second line there.
 * `agent-hud-test-sandbox.test.ts` proves the sandbox holds.
 */
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-test-sandbox-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'ps.log')
  writeFileSync(log, '')
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\necho "$*" >> '${log}'\nexit 0\n`)
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
