import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The PRIMARY guard against a test writing a beacon into the real terminal it
// runs under (2026-10-06: session `00000000-…` on the phone's tab). Our tty
// writer walks up to six ANCESTORS with `ps -o tty=` and writes to the first
// terminal it finds, so the only structural fix is that no ancestor within six
// steps has one. `setsid` alone does not do that (it drops the controlling
// terminal but the ancestors keep theirs), and a PATH-shadowed `ps` does not
// either: macOS's `/bin/ps` cannot be shadowed by a spawn that sets its own PATH
// (a reviewer wrote one frame that way). `scripts/run-detached.mjs` double-forks
// so the middle process exits and the command's chain ends at pid 1
// (runner → pid 1); `pnpm test` runs vitest through it.
//
// This test only READS the ancestors (with the real `ps`, by absolute path, since
// the globalSetup sandbox shadows `ps` on PATH) and fails when one has a tty.
// Hard fail on a developer machine: run `pnpm test`, not `vitest` from a
// terminal. In CI there is no terminal anywhere, so it passes there without a
// skip. Residual: this checks the ancestors of THIS process; a spawn from
// inside a test inherits that same chain.
const REAL_PS = ['/bin/ps', '/usr/bin/ps'].find((path) => existsSync(path))

function ps(field: string, pid: number): string {
  const r = spawnSync(REAL_PS!, ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' })
  return r.stdout.replace(/\s/g, '')
}

export function ancestorTerminals(start: number, steps = 6): { pid: number; tty: string }[] {
  const chain: { pid: number; tty: string }[] = []
  let pid = start
  for (let i = 0; i < steps && pid > 1; i += 1) {
    chain.push({ pid, tty: ps('tty', pid) })
    pid = Number(ps('ppid', pid)) || 0
  }
  return chain
}

describe('vitest runs detached from any terminal', () => {
  it('has no ancestor within six steps that holds a terminal: run `pnpm test`, which goes through scripts/run-detached.mjs', () => {
    expect(REAL_PS, 'no ps found').toBeDefined()
    const withTerminal = ancestorTerminals(process.ppid).filter(({ tty }) => tty !== '' && !/^\?+$/.test(tty))
    expect(
      withTerminal,
      'an ancestor of this test run holds a terminal, so a script a test runs could walk to it and write into it; start the tests with `pnpm test` (scripts/run-detached.mjs)'
    ).toEqual([])
  })
})
