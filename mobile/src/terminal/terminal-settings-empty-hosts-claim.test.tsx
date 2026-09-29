import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A locked Keychain made loadHosts() return [] for a phone with paired desktops, and Terminal
 * settings said "No paired desktops yet." A rejected read read as a fact too. It now says what is
 * known, in both themes, in the theme's secondary-text colour.
 */
const store = vi.hoisted(() => ({ catalog: vi.fn() }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {},
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Smartphone: 'Smartphone',
  Type: 'Type'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock('../transport/host-store', () => ({ loadHostCatalog: store.catalog }))
vi.mock('../transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: [], focused: true })
}))
vi.mock('../components/TerminalShortcutSettings', () => ({ TerminalShortcutSettings: () => null }))

import TerminalSettingsScreen from '../../app/terminal-settings'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => String(n.type) === 'Text' && typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
}

describe('Terminal settings empty-host line', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    store.catalog.mockReset()
    vi.restoreAllMocks()
  })
  async function mount(scheme: 'light' | 'dark') {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <TerminalSettingsScreen />
        </ThemeProvider>
      )
    })
    return texts(renderer!)
  }

  it.each(['light', 'dark'] as const)(
    'says the desktops cannot be read, not that there are none, under a locked Keychain (%s)',
    async (scheme) => {
      store.catalog.mockResolvedValue([
        { id: 'a', credentialStatus: 'temporarily-unavailable', profile: null }
      ])
      const lines = await mount(scheme)
      expect(lines.join('\n')).not.toContain('No paired desktops yet')
      expect(lines.join('\n')).toContain("can't be read right now")
      expect(lines.join('\n')).not.toMatch(/unlock/i)
      const line = renderer!.root.find(
        (n) => String(n.type) === 'Text' && n.props.children?.toString().includes("can't be read")
      )
      const palette = scheme === 'light' ? lightColors : darkColors
      expect(JSON.stringify(line.props.style)).toContain(palette.textSecondary)
    }
  )

  it.each(['light', 'dark'] as const)(
    'says the read failed, not that there are none, when it rejects (%s)',
    async (scheme) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      store.catalog.mockRejectedValue(new Error('keychain'))
      const lines = (await mount(scheme)).join('\n')
      expect(lines).not.toContain('No paired desktops yet')
      expect(lines).toContain("Couldn't read your paired desktops")
    }
  )

  it.each(['light', 'dark'] as const)(
    'says a desktop with no credential needs pairing again, not that Unlock will help (%s)',
    async (scheme) => {
      store.catalog.mockResolvedValue([{ id: 'a', credentialStatus: 'missing', profile: null }])
      const lines = (await mount(scheme)).join('\n')
      expect(lines).toContain('paired again')
      expect(lines).not.toMatch(/can't be read|Unlock|No paired desktops yet/)
    }
  )

  it.each(['light', 'dark'] as const)(
    'words one and several desktops to match the count (%s)',
    async (scheme) => {
      const missing = (id: string) => ({ id, credentialStatus: 'missing', profile: null })
      store.catalog.mockResolvedValue([missing('a')])
      expect((await mount(scheme)).join('\n')).toContain(
        'A paired desktop needs to be paired again'
      )
      act(() => renderer?.unmount())
      store.catalog.mockResolvedValue([missing('a'), missing('b')])
      const several = (await mount(scheme)).join('\n')
      expect(several).toContain('2 paired desktops need to be paired again')
      expect(several).not.toContain('needs')
      act(() => renderer?.unmount())
      const locked = (id: string) => ({
        id,
        credentialStatus: 'temporarily-unavailable',
        profile: null
      })
      store.catalog.mockResolvedValue([locked('a')])
      expect((await mount(scheme)).join('\n')).toContain("A paired desktop can't be read right now")
      act(() => renderer?.unmount())
      store.catalog.mockResolvedValue([locked('a'), locked('b')])
      expect((await mount(scheme)).join('\n')).toContain(
        "Your paired desktops can't be read right now"
      )
    }
  )

  it('still says none are paired when the read worked and found nothing', async () => {
    store.catalog.mockResolvedValue([])
    expect((await mount('light')).join('\n')).toContain('No paired desktops yet')
  })

  it('says nothing about pairing while the read is in flight', async () => {
    store.catalog.mockReturnValue(new Promise(() => {}))
    const lines = (await mount('light')).join('\n')
    expect(lines).not.toMatch(/No paired|can't be read|Couldn't read/)
  })
})
