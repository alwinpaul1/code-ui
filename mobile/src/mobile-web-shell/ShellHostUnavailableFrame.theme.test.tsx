// What the web shell shows in place of the page while this desktop's profile cannot be read, in
// both themes: it stands where the whole workspace would, so a hardcoded colour would ship the
// wrong mode over the full screen.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_UNAVAILABLE_COPY } from '../transport/host-lookup'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { ShellHostUnavailableFrame } from './ShellHostUnavailableFrame'

vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => 'light'
}))
// host-lookup reaches the host store, whose modules touch an Expo global this test does not have.
// Only the copy is read here.
vi.mock('../transport/host-store', () => ({ loadHostCatalog: async () => [] }))

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the frame the web shell holds while this desktop cannot be read', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its canvas and message from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ShellHostUnavailableFrame message={HOST_UNAVAILABLE_COPY} />
        </ThemeProvider>
      )
    })
    const frame = renderer!.root.findByProps({ testID: 'mobile-web-shell-host-unavailable' })
    expect(styleOf(frame).backgroundColor).toBe(palette.bg)
    const message = renderer!.root.findByType('Text' as never)
    expect(message.props.children).toBe(HOST_UNAVAILABLE_COPY)
    expect(styleOf(message).color).toBe(palette.text)
  })
})
