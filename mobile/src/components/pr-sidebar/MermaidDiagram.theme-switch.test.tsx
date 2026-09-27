// The diagram's mermaid config is a `useMemo` keyed on `[scheme, colors]` (both come from
// `useTheme()`, not a static import). Reviewed alongside the sibling theme-sweep branches'
// finding (fix/theme-review, 2026-09-27): a memoised value that reads `colors`/`styles` but
// omits them from its deps array freezes on the scheme it first rendered under, and this
// repo's oxlint has `react-hooks/exhaustive-deps` off, so only a test that actually switches
// the theme under a mounted diagram can see that failure. This proves the deps are complete.
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../../theme/theme-context'
import { darkColors, lightColors, type ThemePreference } from '../../theme/tokens'

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() }
}))

const { MermaidDiagram } = await import('./MermaidDiagram')

let switchTo: ((preference: ThemePreference) => void) | null = null

function Switcher(): null {
  switchTo = useTheme().setPreference
  return null
}

describe('the mermaid diagram after an appearance change', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    switchTo = null
  })

  it('redraws the embedded document in the new theme, not the one it first mounted under', async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <Switcher />
          <MermaidDiagram source="graph TD; A-->B" base={13} />
        </ThemeProvider>
      )
    })

    const htmlOf = () => renderer!.root.findByType('WebView' as never).props.source.html as string

    const before = htmlOf()
    expect(before).toContain(lightColors.bgRaised)
    expect(before).toContain('"theme":"default"')

    await act(async () => {
      switchTo!('dark')
    })

    const after = htmlOf()
    expect(after).not.toBe(before)
    expect(after).toContain(darkColors.bgRaised)
    expect(after).toContain('"theme":"dark"')
    // The stale (light) surface must not linger anywhere in the redrawn document.
    expect(after).not.toContain(lightColors.bgRaised)
  })
})
