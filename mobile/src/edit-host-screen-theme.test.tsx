import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Edit host screen (`app/h/[hostId]/edit.tsx`) in both themes. It painted from the LEGACY
 * static palette (`mobile-theme.ts`), dark-only, until the 2026-09-27 sweep. This pins the canvas,
 * heading, the Save button (an inverse surface with its own label colour), the form's inputs and
 * their help text, so a hardcoded colour cannot come back unnoticed.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'host-1' }),
  useRouter: () => ({ back: vi.fn() })
}))
const HOST = vi.hoisted(() => ({
  id: 'host-1',
  name: 'Studio Mac',
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'token',
  publicKeyB64: 'key',
  lastConnected: 0
}))
vi.mock('./transport/host-store', () => ({
  loadHosts: async () => [HOST],
  // The screen looks its host up in the catalog (host-lookup.ts).
  loadHostCatalog: async () => [{ ...HOST, credentialStatus: 'ready', profile: HOST }],
  updateHostNameAndEndpoint: vi.fn()
}))
// The connection counter the screen re-reads a failed host lookup on; it never moves here.
vi.mock('./transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('./transport/client-context', () => ({
  useForceReconnect: () => undefined,
  usePrimeHosts: () => () => undefined
}))

import EditHostScreen from '../app/h/[hostId]/edit'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'

function flat(style: unknown): Record<string, unknown> {
  const raw = typeof style === 'function' ? style({ pressed: false }) : style
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

describe('the Edit host screen', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'paints its canvas, Save button and form from the %s theme',
    async (scheme, palette) => {
      await act(async () => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <EditHostScreen />
          </ThemeProvider>
        )
      })
      const root = renderer!.root
      const text = (children: string): ReactTestInstance =>
        root.find((node) => String(node.type) === 'Text' && node.props.children === children)

      expect(
        flat(root.findAll((node) => String(node.type) === 'View')[0]!.props.style).backgroundColor
      ).toBe(palette.bg)
      expect(flat(text('Edit host').props.style).color).toBe(palette.text)
      expect(root.find((node) => String(node.type) === 'ChevronLeft').props.color).toBe(
        palette.textSecondary
      )

      const save = root.find(
        (node) => node.props.accessibilityLabel === 'Save host' && String(node.type) === 'Pressable'
      )
      expect(flat(save.props.style).backgroundColor).toBe(palette.text)
      expect(flat(text('Save').props.style).color).toBe(palette.textInverse)

      expect(flat(text('Name').props.style).color).toBe(palette.textSecondary)
      const nameInput = root.find(
        (node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === 'Name'
      )
      expect(flat(nameInput.props.style)).toMatchObject({
        backgroundColor: palette.bgPanel,
        borderColor: palette.border,
        color: palette.text
      })
      expect(nameInput.props.placeholderTextColor).toBe(palette.textMuted)
    }
  )
})
