import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A PATH on which `ps` sees no process at all, for a test that must run one of
 * our beacon scripts with NO `CUIHUD_TTY` (the "cannot find the terminal" case).
 *
 * The tty writer (`agent-hud-tty-write.ts`) walks up to six parents with
 * `ps -o tty=` and writes to the first terminal it finds. A test runs under
 * vitest, under the tool's shell, under the agent, which sits on the user's REAL
 * PTY; with a real `ps` the walk finds it and writes the test's synthetic beacon
 * into the live terminal (2026-10-06: session `00000000-…` on the phone's tab).
 * This `ps` prints nothing, so the walk finds nothing and writes nothing.
 * `agent-hud-tests-reach-no-real-tty.test.ts` fails any test that runs a script
 * without either a temp-file `CUIHUD_TTY` or this.
 */
export function noTerminalPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuihud-no-ps-'))
  writeFileSync(join(dir, 'ps'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return `${dir}:${process.env.PATH ?? ''}`
}
