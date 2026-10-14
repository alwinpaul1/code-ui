// "+N -M" for a file, as the Claude app draws it (`jlc.a` and `jlc.b` in com.anthropic.claude
// 1.261009.20): the added count in `ad5.K()`, the removed one in `ad5.u()`, a count of nothing not
// drawn, and the space between them only when both are.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileDiffPaletteForScheme } from '../source-control/mobile-diff-claude-palette'
import { ThemeProvider } from '../theme/theme-context'
import { MobileDiffChangeStat } from './MobileDiffChangeStat'

vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the +N -M count of a file', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(scheme: 'light' | 'dark', added: number, deleted: number) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffChangeStat added={added} deleted={deleted} />
        </ThemeProvider>
      )
    })
  }

  const texts = () =>
    renderer!.root
      .findAllByType('Text' as never)
      .map((node) => ({ text: [node.props.children].flat().join(''), style: styleOf(node) }))

  it.each(['light', 'dark'] as const)('draws "+12" green and " -3" red in the %s scheme', (scheme) => {
    const palette = mobileDiffPaletteForScheme(scheme)
    render(scheme, 12, 3)
    expect(texts()).toEqual([
      { text: '+12', style: expect.objectContaining({ color: palette.statAdd, fontSize: 13 }) },
      { text: ' -3', style: expect.objectContaining({ color: palette.statDel, fontSize: 13 }) }
    ])
  })

  it('draws only the added count, with no space, for a file that only gained lines', () => {
    render('light', 5, 0)
    expect(texts().map((entry) => entry.text)).toEqual(['+5'])
  })

  it('draws only the removed count, with no leading space, for a file that only lost lines', () => {
    render('light', 0, 7)
    expect(texts().map((entry) => entry.text)).toEqual(['-7'])
  })

  it('draws nothing for a file with neither', () => {
    render('dark', 0, 0)
    expect(texts()).toEqual([])
  })

  it('says what it counts to a screen reader as one phrase', () => {
    render('light', 12, 3)
    const row = renderer!.root.findAllByType('View' as never)[0]!
    expect(row.props.accessible).toBe(true)
    expect(row.props.accessibilityLabel).toBe('12 lines added, 3 lines removed')
  })

  it('says it in the singular for one line', () => {
    render('light', 1, 0)
    expect(renderer!.root.findAllByType('View' as never)[0]!.props.accessibilityLabel).toBe(
      '1 line added'
    )
  })
})
