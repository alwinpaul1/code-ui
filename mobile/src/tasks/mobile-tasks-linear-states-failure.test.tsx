import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Linear's Change Status sheet when the team's state list could not be read. Both the rejection
 * and the refused reply set the list to [], and the sheet drew that as "No states available": false
 * for a team that has states, with no error, no retry and no read again when the host came back
 * (review, 2026-09-30).
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { addListener: () => ({ remove: () => undefined }), dismiss: () => undefined },
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  Linking: { openURL: async () => undefined },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('lucide-react-native', () => {
  const icon = (name: string) => (props: Record<string, unknown>) => createElement(name, props)
  return Object.fromEntries(
    [
      'AlertTriangle',
      'Check',
      'ChevronDown',
      'ChevronLeft',
      'ChevronRight',
      'ChevronUp',
      'Copy',
      'ExternalLink',
      'GitBranch',
      'Lock',
      'Pencil',
      'Plus',
      'RefreshCw',
      'Search',
      'Send',
      'Terminal',
      'X'
    ].map((name) => [name, icon(name)])
  )
})
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'host-1' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() })
}))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() })
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: 'disconnected' })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null,
  useReconnectAttempt: () => 0,
  useRelayRecoveryStatus: () => ({})
}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn(), triggerSelection: vi.fn() }))
vi.mock('../platform/external-link', () => ({ openExternalLink: vi.fn() }))
vi.mock('../platform/clipboard', () => ({
  useClipboardWriter: () => ({ writeText: async () => undefined }),
  useClipboardReader: () => ({})
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? createElement('BottomDrawer', null, children) : null
}))
vi.mock('../components/PickerModal', () => ({ PickerModal: () => null }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: () => null }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../components/TaskProviderLogo', () => ({
  TaskProviderLogo: (props: Record<string, unknown>) => createElement('TaskProviderLogo', props)
}))

import { ThemeProvider, type Theme } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { mobileTasksStyles } from './mobile-tasks-legacy-styles'
import { renderMobileTasksLinearStatusPicker } from './mobile-tasks-filter-pickers'
import { useMobileTasksListAndDetailEffects } from './use-mobile-tasks-list-and-detail-effects'

const ITEM = {
  id: 'linear:ENG-1',
  provider: 'linear',
  title: 'Fix it',
  subtitle: 'ENG-1',
  status: 'Todo',
  updatedAt: '2026-09-30T00:00:00Z',
  source: {
    id: 'issue-1',
    identifier: 'ENG-1',
    workspaceId: 'ws-1',
    team: { id: 'team-1', name: 'Engineering', key: 'ENG' },
    state: { name: 'Todo', type: 'unstarted' }
  }
}

const STATES = [
  { id: 'state-1', name: 'Todo', type: 'unstarted' },
  { id: 'state-2', name: 'Done', type: 'completed' }
]

type Reply = { throw: string } | { ok: boolean; result?: unknown; error?: unknown }

const host = {
  replies: [] as Reply[],
  requests: [] as string[],
  lastConnectedAt: null as number | null,
  listeners: new Set<() => void>()
}

/** The host's client: the read, and the connection state a live RpcClient reports. */
const client = {
  sendRequest: vi.fn(async (method: string) => {
    host.requests.push(method)
    const next = host.replies.shift()
    if (!next) {
      throw new Error(`no reply scripted for ${method}`)
    }
    if ('throw' in next) {
      throw new Error(next.throw)
    }
    return { id: method, ...next }
  }),
  getLastConnectedAt: () => host.lastConnectedAt,
  onStateChange: (listener: () => void) => {
    host.listeners.add(listener)
    return () => {
      host.listeners.delete(listener)
    }
  }
}

/** A NEW connection: the client's time moves and it says its state changed. */
async function connect(at: number): Promise<void> {
  host.lastConnectedAt = at
  await act(async () => {
    for (const listener of Array.from(host.listeners)) {
      listener()
    }
  })
}

type Setters = { states: unknown[][]; loading: boolean[]; drafts: string[] }

const noop = () => undefined

/**
 * Every other effect in the stage is gated off here, so only the state-list read runs. Strict the
 * way the RPC recorder's model is (observable-model.ts): a member the stage reads that is not
 * here throws, so this cannot pass on a field the recordings' fixtures do not carry.
 */
function stageModel(setters: Setters) {
  const fields: Record<string, unknown> = {
    client,
    tasksSupported: true,
    linearMetadataItem: ITEM,
    actionItem: null,
    activeGitHubProject: null,
    activeGitHubProjectViewId: null,
    githubKind: 'issues',
    githubMode: 'items',
    githubPreset: 'issues',
    linearConnected: false,
    linearFilter: 'all',
    loadGitHubProjectTable: async () => undefined,
    loadGitHubProjects: async () => undefined,
    loadLinearContext: async () => undefined,
    loadTasks: async () => undefined,
    persistTaskResumeState: () => undefined,
    refreshTasks: () => undefined,
    selectGitHubProject: async () => undefined,
    connState: 'disconnected',
    taskStateHydrated: false,
    taskUiReady: false,
    showCreateTask: false,
    showGitHubProjectPicker: false,
    provider: 'linear',
    query: '',
    appliedQuery: '',
    appliedGithubProjectSearch: '',
    hostedRepos: [],
    copiedLinkResetTimerRef: { current: null },
    setLinearStates: (states: unknown[]) => setters.states.push(states),
    setLinearStatesLoading: (loading: boolean) => setters.loading.push(loading),
    setLinearCommentDraft: (draft: string) => setters.drafts.push(`comment:${draft}`),
    setLinearSubIssueTitle: (title: string) => setters.drafts.push(`sub-issue:${title}`)
  }
  return new Proxy(fields, {
    get(target, key: string) {
      if (key in target) {
        return target[key]
      }
      // A setter is answered as the recorder answers one; any other member must be declared.
      if (key.startsWith('set') && key.length > 3) {
        return noop
      }
      throw new Error(`Missing model fixture: ${key}`)
    }
  })
}

type Held = { model: Record<string, unknown> | null }

async function mountStage(): Promise<{
  held: Held
  setters: Setters
  rerender: () => Promise<void>
  renderer: ReactTestRenderer
}> {
  const held: Held = { model: null }
  const setters: Setters = { states: [], loading: [], drafts: [] }
  function Probe(): null {
    held.model = useMobileTasksListAndDetailEffects(stageModel(setters) as never) as never
    return null
  }
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(Probe))
  })
  const rerender = async () => {
    await act(async () => {
      renderer!.update(createElement(Probe))
    })
  }
  return { held, setters, rerender, renderer: renderer! }
}

let mounted: ReactTestRenderer | null = null

beforeEach(() => {
  host.replies = []
  host.requests = []
  host.lastConnectedAt = 1
  host.listeners.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => mounted?.unmount())
  mounted = null
  vi.restoreAllMocks()
})

describe('Change Status over a team whose states could not be read', () => {
  it('says the read failed instead of claiming the team has no states', async () => {
    host.replies = [{ throw: 'Connection interrupted' }]
    const stage = await mountStage()
    mounted = stage.renderer
    expect(host.requests).toEqual(['linear.teamStates'])
    expect(stage.held.model?.linearStatesError).toMatch(/Connection interrupted/)
  })

  it('says so for a refused reply too, with the host’s reason', async () => {
    host.replies = [{ ok: false, error: { code: 'forbidden', message: 'Linear token expired' } }]
    const stage = await mountStage()
    mounted = stage.renderer
    expect(stage.held.model?.linearStatesError).toMatch(/Linear token expired/)
  })

  it('logs one line naming the cause', async () => {
    host.replies = [{ throw: 'Connection interrupted' }]
    mounted = (await mountStage()).renderer
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    expect(JSON.stringify(warned[0])).toContain('Connection interrupted')
  })

  it('reads again on Retry and draws the states once they answer', async () => {
    host.replies = [{ throw: 'Connection interrupted' }, { ok: true, result: STATES }]
    const stage = await mountStage()
    mounted = stage.renderer
    const retry = stage.held.model!.retryLinearStates as () => void
    await act(async () => {
      retry()
    })
    expect(host.requests).toHaveLength(2)
    expect(stage.setters.states.at(-1)).toEqual(STATES)
    expect(stage.held.model?.linearStatesError).toBe('')
  })

  it('keeps the comment and sub-issue drafts through a Retry', async () => {
    host.replies = [{ throw: 'Connection interrupted' }, { ok: true, result: STATES }]
    const stage = await mountStage()
    mounted = stage.renderer
    // Cleared once, for the item that opened.
    expect(stage.setters.drafts).toEqual(['comment:', 'sub-issue:'])
    const retry = stage.held.model!.retryLinearStates as () => void
    await act(async () => {
      retry()
    })
    expect(stage.setters.drafts).toEqual(['comment:', 'sub-issue:'])
  })

  it('reads again once per new connection, never once per render', async () => {
    host.replies = [{ throw: 'Connection interrupted' }, { ok: true, result: STATES }]
    const stage = await mountStage()
    mounted = stage.renderer
    await stage.rerender()
    // The same connection saying something else about itself is not a new one.
    await connect(1)
    expect(host.requests).toHaveLength(1)
    await connect(2)
    expect(host.requests).toHaveLength(2)
    expect(stage.setters.states.at(-1)).toEqual(STATES)
    expect(stage.held.model?.linearStatesError).toBe('')
    // A list that answered is not read again.
    await connect(3)
    expect(host.requests).toHaveLength(2)
  })

  it('leaves a team that really has no states as the true empty state', async () => {
    host.replies = [{ ok: true, result: [] }]
    const stage = await mountStage()
    mounted = stage.renderer
    expect(stage.setters.states.at(-1)).toEqual([])
    expect(stage.held.model?.linearStatesError).toBe('')
  })
})

function pickerModel(palette: ThemeColors, overrides: Record<string, unknown>) {
  return {
    colors: palette,
    styles: mobileTasksStyles({ colors: palette } as Theme),
    linearStates: [],
    linearStatesLoading: false,
    linearStatesError: '',
    retryLinearStates: vi.fn(),
    linearStatusPickerItem: ITEM,
    mutatingStatus: false,
    setLinearStatus: vi.fn(async () => undefined),
    setLinearStatusPickerItem: vi.fn(),
    taskUiReady: true,
    ...overrides
  }
}

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

const texts = (root: ReactTestInstance) =>
  root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => ({ node, text: [node.props.children].flat().join('') }))

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('the Change Status sheet in a %s session', (scheme, palette) => {
  it('draws the failure in the danger colour with a Retry, not "No states available"', async () => {
    const model = pickerModel(palette, {
      linearStatesError: "Couldn't load this team's states: Connection interrupted"
    })
    function Sheet() {
      return renderMobileTasksLinearStatusPicker(model as never)
    }
    await act(async () => {
      mounted = create(
        <ThemeProvider initialPreference={scheme as 'light' | 'dark'}>
          <Sheet />
        </ThemeProvider>
      )
    })
    const lines = texts(mounted!.root)
    expect(lines.map(({ text }) => text)).not.toContain('No states available')
    const failure = lines.find(({ text }) => text.includes('Connection interrupted'))
    expect(flat(failure?.node.props.style).color).toBe(palette.danger)
    const retry = mounted!.root.find(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Retry loading states'
    )
    const label = lines.find(({ text }) => text === 'Retry')
    expect(flat(label?.node.props.style).color).toBe(palette.text)
    act(() => retry.props.onPress())
    expect(model.retryLinearStates).toHaveBeenCalledTimes(1)
  })

  it('still says "No states available" for a team read that answered none', async () => {
    const model = pickerModel(palette, {})
    function Sheet() {
      return renderMobileTasksLinearStatusPicker(model as never)
    }
    await act(async () => {
      mounted = create(
        <ThemeProvider initialPreference={scheme as 'light' | 'dark'}>
          <Sheet />
        </ThemeProvider>
      )
    })
    expect(texts(mounted!.root).map(({ text }) => text)).toContain('No states available')
  })
})
