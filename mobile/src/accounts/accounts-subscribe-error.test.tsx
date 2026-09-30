import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Accounts when `accounts.subscribe` fails. The screen only listened for 'ready' and 'snapshot', so
 * the error event the stream registry delivers ({ type: 'error', message }, from
 * RpcClientStreamRegistry.emitError: a host that does not know the method, a host refusal, or
 * "Connection interrupted") was dropped. Nothing asked `accounts.list`, no error text was set, and
 * the screen said "Loading accounts…" until someone pulled to refresh (review, 2026-09-30).
 */

const fakes = vi.hoisted(() => ({
  requests: [] as string[],
  listeners: [] as ((payload: unknown) => void)[],
  list: null as null | (() => Promise<unknown>)
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined
  }
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    },
    useLocalSearchParams: () => ({ hostId: 'host-1' }),
    useRouter: () => ({ back: vi.fn() })
  }
})
vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Path: 'Path' }))
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  withSpring: (to: number) => to,
  withTiming: (to: number) => to
}))
vi.mock('../platform/haptics', () => ({ triggerSelection: () => {} }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  RefreshCw: 'RefreshCw',
  RotateCcw: 'RotateCcw',
  User: 'User'
}))
vi.mock('../components/AgentIcons', () => ({ ClaudeIcon: 'ClaudeIcon', OpenAIIcon: 'OpenAIIcon' }))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: async () => [
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
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('../transport/client-context', () => {
  const client = {
    sendRequest: async (method: string) => {
      fakes.requests.push(method)
      if (method === 'status.get') {
        return { id: 'status', ok: true, result: { capabilities: [] } }
      }
      if (method === 'accounts.list' && fakes.list) {
        return fakes.list()
      }
      throw new Error(`Unexpected request: ${method}`)
    },
    subscribe: (_method: string, _params: unknown, onData: (payload: unknown) => void) => {
      fakes.listeners.push(onData)
      return () => {}
    }
  }
  return { useHostClient: () => ({ client, state: 'connected' }) }
})

import AccountsScreen from '../../app/h/[hostId]/accounts'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'

const SNAPSHOT = {
  claude: { accounts: [], activeAccountId: null },
  codex: {
    accounts: [
      { id: 'codex-1', email: 'dev@example.com', managedHomeRuntime: 'host', wslDistro: null, updatedAt: 10 }
    ],
    activeAccountId: 'codex-1',
    activeAccountIdsByRuntime: { host: 'codex-1', wsl: {} }
  },
  rateLimits: {
    claude: null,
    codex: {
      provider: 'codex',
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: 2_000_000_000_000, resetDescription: null },
      weekly: null,
      updatedAt: 100,
      error: null,
      status: 'ok'
    },
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
  }
}

/** What a desktop signed out of both, or before its first rate-limit poll, answers. */
const EMPTY_SNAPSHOT = {
  claude: { accounts: [], activeAccountId: null },
  codex: { accounts: [], activeAccountId: null },
  rateLimits: {
    claude: null,
    codex: null,
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
  }
}

const ACCOUNTS_EMPTY_COPY =
  'No Claude or Codex usage reported by this desktop yet. Pull down to check again.'

// The shape RpcClientStreamRegistry.emitError hands a listener when the host answers the
// subscribe with an error reply.
const SUBSCRIBE_ERROR = { type: 'error', message: 'Unknown method accounts.subscribe' }

let renderer: ReactTestRenderer | null = null

async function openAccounts(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <AccountsScreen />
      </ThemeProvider>
    )
  })
  if (renderer === null) {
    throw new Error('Accounts did not render')
  }
  return renderer
}

async function emitToSubscription(payload: unknown): Promise<void> {
  await act(async () => {
    for (const listener of fakes.listeners) {
      listener(payload)
    }
    await Promise.resolve()
    await Promise.resolve()
  })
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

function retryButton(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Retry'
  )[0]
}

beforeEach(() => {
  fakes.requests = []
  fakes.listeners = []
  fakes.list = async () => ({ id: 'list', ok: true, result: SNAPSHOT })
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('Accounts when accounts.subscribe fails', () => {
  it('draws the accounts from accounts.list instead of loading forever', async () => {
    const tree = await openAccounts()
    expect(lines(tree).map(({ text }) => text)).toContain('Loading accounts…')

    await emitToSubscription(SUBSCRIBE_ERROR)

    expect(fakes.requests).toContain('accounts.list')
    const texts = lines(tree).map(({ text }) => text)
    expect(texts).not.toContain('Loading accounts…')
    expect(texts.some((text) => text.includes('dev@example.com'))).toBe(true)
    expect(tree.root.findAll((node) => String(node.type) === 'ActivityIndicator')).toHaveLength(0)
  })

  it.each(['light', 'dark'] as const)(
    'says why, in the %s danger colour and with a Retry, when accounts.list fails too',
    async (scheme) => {
      fakes.list = async () => {
        throw new Error('Connection interrupted')
      }
      const tree = await openAccounts(scheme)

      await emitToSubscription(SUBSCRIBE_ERROR)

      const line = lines(tree).find(({ text }) => text === 'Connection interrupted')
      expect(line?.color).toBe(colorsForScheme(scheme).danger)
      expect(lines(tree).map(({ text }) => text)).not.toContain('Loading accounts…')
      expect(tree.root.findAll((node) => String(node.type) === 'ActivityIndicator')).toHaveLength(0)
      expect(retryButton(tree)).toBeDefined()
    }
  )

  it('Retry asks accounts.list again and draws the accounts once it answers', async () => {
    fakes.list = async () => ({
      id: 'list',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method accounts.list' }
    })
    const tree = await openAccounts()
    await emitToSubscription(SUBSCRIBE_ERROR)
    expect(lines(tree).map(({ text }) => text)).toContain('Unknown method accounts.list')

    fakes.list = async () => ({ id: 'list', ok: true, result: SNAPSHOT })
    await act(async () => {
      retryButton(tree)?.props.onPress()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fakes.requests.filter((method) => method === 'accounts.list')).toHaveLength(2)
    const texts = lines(tree).map(({ text }) => text)
    expect(texts).not.toContain('Unknown method accounts.list')
    expect(texts.some((text) => text.includes('dev@example.com'))).toBe(true)
  })

  it('still draws a snapshot the subscription delivers, without asking accounts.list', async () => {
    const tree = await openAccounts()

    await emitToSubscription({ type: 'ready', snapshot: SNAPSHOT })

    expect(fakes.requests).not.toContain('accounts.list')
    expect(lines(tree).some(({ text }) => text.includes('dev@example.com'))).toBe(true)
  })
})

describe('Accounts over a desktop that has reported nothing', () => {
  it.each(['light', 'dark'] as const)(
    'says the desktop has reported nothing yet, in the %s secondary colour, instead of a blank screen',
    async (scheme) => {
      // Review 2026-09-30: a valid snapshot with no accounts and no usage windows (a signed-out
      // desktop, or one before its first poll) drew only the header, which reads as frozen.
      const tree = await openAccounts(scheme)
      await emitToSubscription({ type: 'ready', snapshot: EMPTY_SNAPSHOT })

      const line = lines(tree).find(({ text }) => text === ACCOUNTS_EMPTY_COPY)
      expect(line?.color).toBe(colorsForScheme(scheme).textSecondary)
      expect(tree.root.findAll((node) => String(node.type) === 'ActivityIndicator')).toHaveLength(0)
      // Not a failure: nothing to retry, and the pull to refresh the copy names is already there.
      expect(retryButton(tree)).toBeUndefined()
    }
  )

  it('draws no empty note once one provider has something to show', async () => {
    const tree = await openAccounts()
    await emitToSubscription({ type: 'ready', snapshot: SNAPSHOT })
    expect(lines(tree).map(({ text }) => text)).not.toContain(ACCOUNTS_EMPTY_COPY)
  })
})
