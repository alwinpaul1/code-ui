// The source control screen's own header in both themes. Upstream (and this fork before the
// theme-review fix) painted it from the static dark palette (`../theme/mobile-theme`), so on a
// light session the "Source Control" title, the worktree meta line and the back icon stayed
// dark-palette colours over a light canvas underneath. Modelled on
// `mobile-web-shell/PageRouteUnavailableScreen.theme.test.tsx`.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileSourceControlHeader } from './MobileSourceControlHeader'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ExternalLink: 'ExternalLink',
  X: 'X'
}))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw = typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the source control screen header', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the title, meta and back icon from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileSourceControlHeader
            embedded={false}
            worktreeLabel="feature/tabs"
            onBack={() => undefined}
            onClose={() => undefined}
          />
        </ThemeProvider>
      )
    })
    const title = renderer!.root.findByProps({ children: 'Source Control' })
    expect(styleOf(title).color).toBe(palette.text)
    const meta = renderer!.root.findByProps({ children: 'feature/tabs' })
    expect(styleOf(meta).color).toBe(palette.textSecondary)
    const backIcon = renderer!.root.findByType('ChevronLeft' as never)
    expect(backIcon.props.color).toBe(palette.textSecondary)
    const backButton = renderer!.root.findByProps({ accessibilityLabel: 'Back to session' })
    expect(styleOf(backButton, true).backgroundColor).toBe(palette.bgRaised)
  })
})
