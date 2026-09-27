import { describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// Why: the module under test also builds SOURCE_CONTROL_ACTION_ICONS from lucide-react-native,
// which has no Node entry; every icon renders as a host element named after itself.
vi.mock(
  'lucide-react-native',
  () =>
    new Proxy(
      {},
      {
        get: (_target, name) => (typeof name === 'string' ? name : undefined),
        has: () => true
      }
    )
)

const { statusColor } = await import('./mobile-source-control-screen-state')

/**
 * `statusColor` is a pure helper with no screen of its own — it feeds the status-badge colour on
 * every changed-file row in both the Changes and Committed-on-Branch lists. Before the fix it
 * read the LEGACY static (dark-only) palette, so a file row's status letter stayed dark-palette
 * red/green/amber even in a light session. Fixed, it takes the live palette as a parameter.
 */
describe('the changed-file status badge colour, in both themes', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('reads added/copied, deleted, renamed and untracked from the %s palette', (_scheme, palette) => {
    expect(statusColor('added', palette)).toBe(palette.success)
    expect(statusColor('copied', palette)).toBe(palette.success)
    expect(statusColor('deleted', palette)).toBe(palette.danger)
    expect(statusColor('renamed', palette)).toBe(palette.accent)
    expect(statusColor('untracked', palette)).toBe(palette.warning)
    expect(statusColor('modified', palette)).toBe(palette.textSecondary)
  })

  it('never mixes the two palettes: light and dark disagree on every mapped colour', () => {
    for (const status of ['added', 'deleted', 'renamed', 'untracked'] as const) {
      expect(statusColor(status, lightColors)).not.toBe(statusColor(status, darkColors))
    }
  })
})
