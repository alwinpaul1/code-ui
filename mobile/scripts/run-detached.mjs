#!/usr/bin/env node
// Runs a command with NO terminal anywhere in its ancestor chain: `pnpm test`
// goes through this (package.json), and so does the release workflow's test step.
//
// Why: our hook and status-line scripts end in a tty writer that walks up six
// ANCESTORS with `ps -o tty=` and writes to the first terminal it finds. A test
// runs under vitest, under the shell, under the agent, which sits on the user's
// REAL PTY; one test that ran a script with an empty CUIHUD_TTY wrote a beacon for
// a synthetic session into the live terminal (2026-10-06). `setsid` does not help
// (the ancestors keep their terminals) and neither does a PATH-shadowed `ps` (a
// spawn with its own PATH finds the real, un-shadowable one).
//
// How: a double fork. This process starts `sh` in a new session (setsid); `sh`
// starts the command in a background subshell and EXITS at once, so the subshell is
// reparented to pid 1 (launchd, or the container's init) and the command's chain is
// command → subshell → pid 1, with no terminal in it. stdout and stderr are pipes
// the subshell inherits, relayed here until the last writer closes them; stdin is
// /dev/null; the exit status travels through a file. Residual: a process that is
// already an orphan of something with a terminal, or a host whose init keeps one
// (none known), is not helped; src/test/vitest-runs-detached.test.ts checks the
// chain it actually got and fails hard when a terminal is in it.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: run-detached.mjs <command> [args…]')
  process.exit(2)
}

const dir = mkdtempSync(join(tmpdir(), 'run-detached-'))
const statusFile = join(dir, 'status')
const middle = spawn(
  'sh',
  ['-c', '( "$@"; echo $? > "$RUN_DETACHED_STATUS" ) &', 'run-detached', command, ...args],
  {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RUN_DETACHED_STATUS: statusFile }
  }
)
middle.stdout.pipe(process.stdout)
middle.stderr.pipe(process.stderr)

// The command is in the middle's process group (no job control in `sh -c`).
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    try {
      process.kill(-middle.pid, signal)
    } catch {
      // Already gone.
    }
  })
}

let open = 2
const done = () => {
  open -= 1
  if (open > 0) {
    return
  }
  let status = 1
  try {
    status = Number(readFileSync(statusFile, 'utf8').trim())
  } catch {
    // The command never wrote one: it was killed, or `sh` never started it.
  }
  rmSync(dir, { recursive: true, force: true })
  process.exit(Number.isInteger(status) ? status : 1)
}
middle.stdout.on('close', done)
middle.stderr.on('close', done)
middle.on('error', (error) => {
  console.error(`run-detached: ${error.message}`)
  process.exit(1)
})
