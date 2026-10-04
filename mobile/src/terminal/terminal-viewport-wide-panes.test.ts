import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TERMINAL_VIEWPORT_MAX_COLS,
  clampTerminalViewport
} from '../../../src/shared/terminal-viewport'

// Orca #24687: a wide pane (a tablet, a landscape fold, a small text size) measures more than the
// 240 columns the host's `terminal.updateViewport` schema used to accept. The phone sends what its
// document measured, unclamped (`terminal-viewport-refit.ts`), so a refused update fell through to
// a full unsubscribe and resubscribe on every refit and the pane's right edge was cut off. The host
// now takes up to 1024 columns.
//
// The schema is read as text, not imported: the phone must never bundle a `*-params.ts` zod schema
// (`rpc-params-contract-type-only-boundary.test.ts`), and a test that parses with one would be the
// first value import of it. What the phone depends on is the bound the vendored schema states, so
// that is the line this reads, and the constant that line names is the one it checks the value of.
const schemaSource = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'src',
    'shared',
    'rpc-contract',
    'terminal-viewport-schemas-params.ts'
  ),
  'utf8'
)

describe('a wide pane keeps its width when the phone updates the viewport', () => {
  it('lets terminal.updateViewport take as many columns as the host will lay out, not 240', () => {
    const update = schemaSource.slice(schemaSource.indexOf('export const TerminalUpdateViewport'))
    expect(update).toMatch(/cols:\s*z\.number\(\)\.int\(\)\.min\(20\)\.max\(TERMINAL_VIEWPORT_MAX_COLS\)/)
    expect(update).not.toMatch(/\.max\(240\)/)
    expect(TERMINAL_VIEWPORT_MAX_COLS).toBe(1024)
  })

  it('clamps to the same bounds', () => {
    expect(clampTerminalViewport(51, 40)).toEqual({ cols: 51, rows: 40 })
    expect(clampTerminalViewport(300, 40)).toEqual({ cols: 300, rows: 40 })
    expect(clampTerminalViewport(2000, 200)).toEqual({ cols: 1024, rows: 120 })
    expect(clampTerminalViewport(10, 4)).toEqual({ cols: 20, rows: 8 })
    expect(clampTerminalViewport(500.4, 40.6)).toEqual({ cols: 500, rows: 41 })
  })
})
