import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

/**
 * Home's Tasks card after the desktop's task source read FAILED, while the desktop stays
 * connected. Review round 2 stopped a refused read from claiming GitHub by leaving the sources
 * unread, and the card draws unread as "Checking sources…". Nothing was checking: the read had
 * ended, and the caption stayed until the next focus or new connection (review round 3,
 * 2026-09-30). The REAL `useMobileHomeData`, the REAL provider read and the REAL card run here,
 * over one connected desktop whose replies each case scripts.
 */

const home = vi.hoisted(() => ({
  client: null as unknown,
  refocus: null as null | (() => void)
}))

// Focus runs once as the screen opens; `refocus` is the user coming back to Home.
vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      const latest = react.useRef(effect)
      latest.current = effect
      home.refocus = () => {
        latest.current()
      }
      react.useEffect(() => latest.current(), [])
    }
  }
})
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight', ListTodo: 'ListTodo' }))
vi.mock('../ui/PressScale', async () => {
  const react = await import('react')
  return {
    PressScale: (props: Record<string, unknown>) => react.createElement('PressScale', props)
  }
})
vi.mock('../components/TaskProviderLogo', () => ({ TaskProviderLogo: 'TaskProviderLogo' }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null) }
}))
vi.mock('../cache/home-snapshot-cache', () => ({
  loadHomeSnapshot: vi.fn(async () => null),
  saveHomeSnapshot: vi.fn()
}))
vi.mock('../cache/worktree-cache', () => ({
  getCachedWorktrees: () => null,
  setCachedWorktrees: vi.fn()
}))
vi.mock('../onboarding/mobile-onboarding-plan', () => ({
  loadMobileOnboardingSteps: vi.fn(async () => []),
  mobileOnboardingDestination: vi.fn()
}))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: async () => [
    {
      id: 'mac',
      credentialStatus: 'ready',
      profile: {
        id: 'mac',
        name: 'mac',
        endpoint: 'ws://x',
        deviceToken: 't',
        publicKeyB64: 'k',
        lastConnected: 1
      }
    }
  ]
}))
vi.mock('./use-mobile-home-host-connections', async () => {
  const react = await import('react')
  return {
    useMobileHomeHostConnections: () => {
      const [allClients] = react.useState(() => [
        {
          hostId: 'mac',
          client: home.client,
          path: 'lan',
          pendingPath: null,
          pairingRejected: false,
          relayHostReachability: 'reachable',
          livenessProbing: false
        }
      ])
      return {
        allClients,
        hostStates: { mac: 'connected' },
        hostAttempts: {},
        hostLastConnected: {},
        autoConnectHostIds: new Set()
      }
    }
  }
})
vi.mock('../worktree/home-host-worktree-fetch', () => ({ fetchHomeHostWorktreeInfo: vi.fn() }))
vi.mock('./refresh-account-usage', () => ({ refreshAccountUsage: vi.fn() }))
vi.mock('../components/AccountUsage', () => ({
  hasRenderableUsage: () => false,
  decodeAccountsSnapshot: (value: unknown) => value
}))
// Only the task source read is under test; the counts and accounts reads stay quiet.
vi.mock('./mobile-home-host-operations', () => ({
  homeHostStatsRead: {
    operation: { method: 'stats.summary' },
    requestSingleFlight: () => new Promise(() => undefined)
  },
  homeHostAccountsRead: {
    operation: { method: 'accounts.list' },
    requestSingleFlight: () => new Promise(() => undefined)
  }
}))

import { ThemeProvider } from '../theme/theme-context'
import { MobileHomeTasksCard } from './MobileHomeTasksCard'
import { useMobileHomeData } from './use-mobile-home-data'

type Reply = () => Promise<unknown>

const answered = (result: unknown): Reply => async () => ({ id: 'r', ok: true, result })
const refused = (code: string, message: string): Reply => async () => ({
  id: 'r',
  ok: false,
  error: { code, message }
})
const dropped: Reply = async () => {
  throw new Error('Connection interrupted')
}

const GITLAB_AND_LINEAR: Record<string, Reply> = {
  'settings.get': answered({ settings: { visibleTaskProviders: ['gitlab', 'linear'] } }),
  'preflight.check': answered({ glab: { installed: true } }),
  'linear.status': answered({ connected: true })
}

/** The desktop's replies, swapped between reads the way a flaky desktop answers them. */
let replies: Record<string, Reply> = GITLAB_AND_LINEAR

function connectedDesktop(): RpcClient {
  return {
    getState: () => 'connected',
    sendRequest: vi.fn(async (method: string) => {
      const reply = replies[method]
      if (!reply) {
        throw new Error(`no reply scripted for ${method}`)
      }
      return reply()
    })
  } as unknown as RpcClient
}

function Screen() {
  const data = useMobileHomeData()
  return createElement(MobileHomeTasksCard, {
    enabled: data.primaryHost != null,
    providers: data.primaryTaskProviders,
    onOpen: () => undefined
  })
}

let renderer: ReactTestRenderer | null = null

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function openHome(): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <Screen />
      </ThemeProvider>
    )
  })
  await settle()
}

async function comeBackToHome(): Promise<void> {
  await act(async () => {
    home.refocus?.()
  })
  await settle()
}

function texts(): string[] {
  return renderer!.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => [node.props.children].flat().join(''))
}

function providerButtons(): ReactTestInstance[] {
  return renderer!.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      /^Open .* tasks$/.test(String(node.props.accessibilityLabel))
  )
}

function card(): ReactTestInstance {
  return renderer!.root.find((node) => String(node.type) === 'PressScale')
}

beforeEach(() => {
  replies = GITLAB_AND_LINEAR
  home.client = connectedDesktop()
  home.refocus = null
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe("Home's Tasks card after the task source read failed on a connected desktop", () => {
  it.each([
    ['the desktop refuses one of the three reads', { 'linear.status': refused('internal_error', 'boom') }],
    ['the settings read is dropped with the link', { 'settings.get': dropped }],
    [
      'the tooling check is not a method this desktop has',
      { 'preflight.check': refused('method_not_found', 'Unknown method: preflight.check') }
    ]
  ] as [string, Record<string, Reply>][])(
    'says the sources could not be read, not that it is still checking, when %s',
    async (_case, failure) => {
      replies = { ...GITLAB_AND_LINEAR, ...failure }
      await openHome()
      expect(texts()).not.toContain('Checking sources…')
      expect(texts()).toContain("Couldn't read task sources")
      expect(texts()).not.toContain('GitHub')
      expect(providerButtons()).toHaveLength(0)
      // Still a way in: the Tasks screen reads its own sources.
      expect(card().props.disabled).toBe(false)
    }
  )

  it('names the sources once a later read answers', async () => {
    replies = { ...GITLAB_AND_LINEAR, 'settings.get': dropped }
    await openHome()
    expect(texts()).toContain("Couldn't read task sources")

    replies = GITLAB_AND_LINEAR
    await comeBackToHome()
    expect(texts()).toContain('GitLab · Linear')
    expect(texts()).not.toContain("Couldn't read task sources")
    expect(providerButtons()).toHaveLength(2)
  })

  it('keeps the sources it read last when a later read fails', async () => {
    await openHome()
    expect(texts()).toContain('GitLab · Linear')

    replies = { ...GITLAB_AND_LINEAR, 'linear.status': refused('internal_error', 'boom') }
    await comeBackToHome()
    expect(texts()).toContain('GitLab · Linear')
    expect(texts()).not.toContain("Couldn't read task sources")

    replies = { ...GITLAB_AND_LINEAR, 'settings.get': dropped }
    await comeBackToHome()
    expect(texts()).toContain('GitLab · Linear')
    expect(providerButtons()).toHaveLength(2)
  })
})
