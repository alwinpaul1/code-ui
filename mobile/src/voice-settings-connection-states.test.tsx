import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Voice settings before it has read anything. With no connected desktop the spinner was gated on a
 * client, so the screen drew its body over a null setup: a live "Enable Voice Dictation" switch in
 * the off position, no active Dictation Mode segment and "Speech Model: None selected", with
 * handlers that return early for want of a client and nothing saying why. A failed read left the
 * same false state with a small error line under it (review, 2026-09-30).
 */

type Entry = { hostId: string; client: unknown; state: string }

const fakes = vi.hoisted(() => {
  const readyCatalog = async (): Promise<unknown[]> => [
    {
      id: 'host-1',
      credentialStatus: 'ready',
      profile: {
        id: 'host-1',
        name: 'Studio Mac',
        endpoint: 'ws://192.168.1.10:6768',
        publicKeyB64: 'key',
        lastConnected: 0
      }
    }
  ]
  return {
    entries: [] as Entry[],
    lastConnectedAt: 1000 as number | null,
    readyCatalog,
    catalog: readyCatalog as () => Promise<unknown[]>
  }
})

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock('./transport/host-store', () => ({ loadHostCatalog: () => fakes.catalog() }))
vi.mock('./transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: fakes.entries, focused: true })
}))
vi.mock('./transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: (hostId: string | undefined) => (hostId ? fakes.lastConnectedAt : null)
}))

import VoiceSettingsScreen from '../app/voice-settings'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'
import { EMPTY_HOSTS_FAILED_COPY } from './transport/use-loaded-hosts'

const SETUP = {
  enabled: true,
  selectedModelId: 'whisper-small',
  dictationMode: 'hold',
  models: [
    {
      id: 'whisper-small',
      label: 'Whisper Small',
      provider: 'local',
      sizeBytes: 100,
      recommended: true,
      status: 'ready',
      progress: null
    }
  ]
}

const listed = (result: unknown) => ({ id: 'r', ok: true, result, _meta: { runtimeId: 'rt' } })
const interrupted = () => Promise.reject(new Error('Connection interrupted'))

function desktop(replies: (unknown | (() => Promise<unknown>))[]) {
  const sendRequest = vi.fn(async () => {
    const next = replies.length > 1 ? replies.shift() : replies[0]
    return typeof next === 'function' ? (next as () => Promise<unknown>)() : next
  })
  return { client: { sendRequest, getState: () => 'connected' }, sendRequest }
}

let renderer: ReactTestRenderer | null = null

function screen(scheme: 'light' | 'dark') {
  return (
    <ThemeProvider initialPreference={scheme}>
      <VoiceSettingsScreen />
    </ThemeProvider>
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })
}

async function mount(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(screen(scheme))
  })
  await flush()
  return renderer!
}

async function rerender(scheme: 'light' | 'dark' = 'light'): Promise<void> {
  fakes.entries = fakes.entries.map((entry) => ({ ...entry }))
  await act(async () => {
    renderer!.update(screen(scheme))
  })
  await flush()
}

function lines(tree: ReactTestRenderer): { text: string; color: unknown }[] {
  return tree.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => {
      const children = node.props.children as unknown
      const style = [node.props.style].flat(Infinity) as Record<string, unknown>[]
      return {
        text: Array.isArray(children) ? children.join('') : String(children),
        color: Object.assign({}, ...style.filter(Boolean)).color
      }
    })
}

function texts(tree: ReactTestRenderer): string[] {
  return lines(tree).map(({ text }) => text)
}

function retryButton(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Retry'
  )[0]
}

/** What the old screen drew over a setup it never had. */
function expectNoInventedSettings(tree: ReactTestRenderer): void {
  expect(texts(tree)).not.toContain('None selected')
  expect(texts(tree)).not.toContain('Enable Voice Dictation')
  expect(tree.root.findAll((node) => String(node.type) === 'Switch')).toHaveLength(0)
}

beforeEach(() => {
  fakes.entries = []
  fakes.lastConnectedAt = 1000
  fakes.catalog = fakes.readyCatalog
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('Voice settings without settings to show', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'asks for a connected desktop instead of drawing an off switch and "None selected" (%s)',
    async (scheme, palette) => {
      const tree = await mount(scheme)

      const line = lines(tree).find(({ text }) => text === 'Connect to a desktop to change voice settings')
      expect(line?.color).toBe(palette.textSecondary)
      expectNoInventedSettings(tree)
    }
  )

  it('says it is connecting while the desktop connects, with no settings drawn', async () => {
    const { client, sendRequest } = desktop([listed(SETUP)])
    fakes.entries = [{ hostId: 'host-1', client, state: 'reconnecting' }]
    const tree = await mount()

    expect(texts(tree)).toContain('Connecting to your desktop…')
    expect(tree.root.findAll((node) => String(node.type) === 'ActivityIndicator')).toHaveLength(1)
    expectNoInventedSettings(tree)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'says the read failed, with the reason and a Retry, instead of drawing defaults (%s)',
    async (scheme, palette) => {
      const { client } = desktop([interrupted])
      fakes.entries = [{ hostId: 'host-1', client, state: 'connected' }]
      const tree = await mount(scheme)

      expect(lines(tree).find(({ text }) => text === "Couldn't read voice settings")?.color).toBe(
        palette.text
      )
      expect(lines(tree).find(({ text }) => text === 'Connection interrupted')?.color).toBe(
        palette.danger
      )
      expect(retryButton(tree)).toBeDefined()
      expectNoInventedSettings(tree)
    }
  )

  it('Retry reads again, and draws the settings the desktop answered', async () => {
    const { client, sendRequest } = desktop([interrupted, listed(SETUP)])
    fakes.entries = [{ hostId: 'host-1', client, state: 'connected' }]
    const tree = await mount()
    expect(texts(tree)).toContain("Couldn't read voice settings")

    await act(async () => {
      retryButton(tree)!.props.onPress()
    })
    await flush()

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(texts(tree)).not.toContain("Couldn't read voice settings")
    expect(texts(tree)).toContain('Whisper Small')
    expect(tree.root.findByType('Switch' as never).props.value).toBe(true)
  })

  it('reads a failed setup again once per new connection, not on every render', async () => {
    const { client, sendRequest } = desktop([interrupted, listed(SETUP)])
    fakes.entries = [{ hostId: 'host-1', client, state: 'connected' }]
    const tree = await mount()
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await rerender()
    await rerender()
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(texts(tree)).toContain("Couldn't read voice settings")

    fakes.lastConnectedAt = 2000
    await rerender()
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(texts(tree)).toContain('Whisper Small')
  })

  it('shows "None selected" only once the desktop has said no model is selected', async () => {
    const { client } = desktop([listed({ ...SETUP, enabled: false, selectedModelId: '' })])
    fakes.entries = [{ hostId: 'host-1', client, state: 'connected' }]
    const tree = await mount()

    expect(texts(tree)).toContain('None selected')
    expect(tree.root.findByType('Switch' as never).props.value).toBe(false)
  })
})

/**
 * No desktop in the list the screen can connect to. useLoadedHosts reports that as an empty list
 * for four different reasons, and the screen drew "Connect to a desktop to change voice settings"
 * for all of them: over a catalog it could not read, over a desktop whose Keychain entry was locked
 * for the moment, and over one whose credential is gone, it told someone with a paired desktop that
 * the fix was to connect one (review, 2026-09-30). Terminal settings already words these through
 * emptyHostsNoticeCopy; this screen now does too.
 */
describe('Voice settings with no desktop it can connect to', () => {
  const CONNECT_COPY = 'Connect to a desktop to change voice settings'

  function listedDesktop(credentialStatus: string): unknown {
    return { id: 'host-1', name: 'Studio Mac', credentialStatus, profile: null }
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'says the paired desktops could not be read, not "connect a desktop", when the list read fails (%s)',
    async (scheme, palette) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fakes.catalog = () => Promise.reject(new Error('SecureStore is unavailable'))
      const tree = await mount(scheme)

      const line = lines(tree).find(({ text }) => text === EMPTY_HOSTS_FAILED_COPY)
      expect(line?.color).toBe(palette.textSecondary)
      expect(texts(tree)).not.toContain(CONNECT_COPY)
      expectNoInventedSettings(tree)
      expect(warn).toHaveBeenCalledWith(
        '[hosts] paired-host list failed to load',
        expect.objectContaining({ message: 'SecureStore is unavailable' })
      )
      warn.mockRestore()
    }
  )

  it('says a paired desktop cannot be read right now when its Keychain entry is locked', async () => {
    fakes.catalog = async () => [listedDesktop('temporarily-unavailable')]
    const tree = await mount()

    expect(texts(tree)).toContain(
      "A paired desktop can't be read right now. Reopen this screen in a moment."
    )
    expect(texts(tree)).not.toContain(CONNECT_COPY)
    expectNoInventedSettings(tree)
  })

  it('says a paired desktop must be paired again when its credential is gone', async () => {
    fakes.catalog = async () => [listedDesktop('missing')]
    const tree = await mount()

    expect(texts(tree)).toContain(
      'A paired desktop needs to be paired again. Scan its code from the home screen.'
    )
    expect(texts(tree)).not.toContain(CONNECT_COPY)
    expectNoInventedSettings(tree)
  })

  it('says nothing is paired yet only when nothing is', async () => {
    fakes.catalog = async () => []
    const tree = await mount()

    expect(texts(tree)).toContain('No paired desktops yet. Pair one to change voice settings.')
    expect(texts(tree)).not.toContain(CONNECT_COPY)
    expect(tree.root.findAll((node) => String(node.type) === 'ActivityIndicator')).toHaveLength(0)
    expectNoInventedSettings(tree)
  })
})
