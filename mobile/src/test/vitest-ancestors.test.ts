import { describe, expect, it } from 'vitest'
import { assertNoTerminalAncestors, terminalsAmong } from '../../vitest.ancestors'

// The same read-only ancestor walk the guard test makes, as a function that the
// globalSetup runs BEFORE any worker starts (vitest.global-setup.ts), so a direct
// `npx vitest run` from a terminal fails at setup with zero tests executed instead
// of reporting only after the whole suite has run.
describe('the ancestor check vitest runs before any test', () => {
  const chain = (...ttys: string[]) => ttys.map((tty, i) => ({ pid: 100 + i, tty }))

  it('lists the ancestors that hold a terminal, and ignores the ones that do not', () => {
    expect(terminalsAmong(chain('??', 'ttys010', '?', '', 'pts/3'))).toEqual([
      { pid: 101, tty: 'ttys010' },
      { pid: 104, tty: 'pts/3' }
    ])
    expect(terminalsAmong(chain('??', '?', ''))).toEqual([])
    expect(terminalsAmong([])).toEqual([])
  })

  it('throws, naming the terminal and the way out, when one is within reach', () => {
    expect(() => assertNoTerminalAncestors(chain('??', 'ttys010'))).toThrow(
      /A terminal is among this test run's ancestors.*ttys010.*pnpm test/s
    )
  })

  it('says nothing when none is', () => {
    expect(() => assertNoTerminalAncestors(chain('??', '??'))).not.toThrow()
    expect(() => assertNoTerminalAncestors([])).not.toThrow()
  })
})
