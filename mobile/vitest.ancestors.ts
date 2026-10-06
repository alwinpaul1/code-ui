import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// The read-only walk up this process's ANCESTORS, with the real `ps` by absolute
// path (the sandbox shadows `ps` on PATH), printing only. The tty writer of our hook
// and status-line scripts makes this same walk and writes to the first terminal it
// finds, so no ancestor of a test run may hold one (scripts/run-detached.mjs).
const REAL_PS = ['/bin/ps', '/usr/bin/ps'].find((path) => existsSync(path))

export type Ancestor = { pid: number; tty: string }

function ps(field: string, pid: number): string {
  try {
    return execFileSync(REAL_PS!, ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).replace(/\s/g, '')
  } catch {
    return ''
  }
}

/** Up to `steps` ancestors starting at `start`, stopping at pid 1. Empty when
 *  there is no POSIX `ps` (a Windows developer machine). */
export function terminalAncestors(start = process.ppid, steps = 6): Ancestor[] {
  if (REAL_PS === undefined) {
    return []
  }
  const chain: Ancestor[] = []
  let pid = start
  for (let i = 0; i < steps && pid > 1; i += 1) {
    chain.push({ pid, tty: ps('tty', pid) })
    pid = Number(ps('ppid', pid)) || 0
  }
  return chain
}

export function terminalsAmong(chain: readonly Ancestor[]): Ancestor[] {
  return chain.filter(({ tty }) => tty !== '' && !/^\?+$/.test(tty))
}

/** Throws before any worker starts when a terminal is within reach, so a direct
 *  `vitest` from a terminal fails at setup with zero tests run. */
export function assertNoTerminalAncestors(chain: readonly Ancestor[] = terminalAncestors()): void {
  const held = terminalsAmong(chain)
  if (held.length > 0) {
    throw new Error(
      `A terminal is among this test run's ancestors (${held.map(({ pid, tty }) => `${tty} at pid ${pid}`).join(', ')}): a script a test runs could walk to it and write into it. Run \`pnpm test\`, which detaches it (scripts/run-detached.mjs).`
    )
  }
}
