// The Switch Branch picker while git.localBranches is on its way, and after it failed.
//
// Opening the picker cleared the list and showed the sheet at once, and a failed read stored an
// empty list with no message and no log line. The picker maps only its options and has no empty,
// loading or failed state, so a slow relay and a failure both drew the same titled sheet with no
// rows and no way out but closing it (source trace on main 0b2c7a92). The sheet now says
// "Loading branches…" while the list is on its way, "Couldn't load branches" with Retry when the
// read failed, and "No local branches" when the host answered none, which is not a failure.

import { createElement, useRef, useState, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeGitLocalBranches } from '../../../src/shared/runtime-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
  Pressable: 'Pressable',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('expo-router', () => ({
  useRouter: () => ({
    back: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    navigate: () => undefined,
    dismissTo: () => undefined,
    prefetch: () => undefined,
    canGoBack: () => false,
    setParams: () => undefined
  })
}))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: () => undefined,
  triggerError: () => undefined,
  triggerSelection: () => undefined,
  triggerWarning: () => undefined,
  triggerImpact: () => undefined
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))
vi.mock('../components/BottomDrawer', async () => {
  const { createElement: h } = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? h('BottomDrawer', null, children) : null
  }
})
// The other sheets the modals host are not under test.
vi.mock('./MobileBranchDiffPreviewDrawer', () => ({ MobileBranchDiffPreviewDrawer: () => null }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))

const { useRouteHandoff } = await import('../navigation/route-handoff')
const { useMobileSourceControlRunners } = await import('./use-mobile-source-control-runners')
const { MobileSourceControlModals } = await import('./MobileSourceControlModals')
type ModalsState = Parameters<typeof MobileSourceControlModals>[0]['state']

type SendGitRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

const captured: { open: (() => void) | null } = { open: null }

// The hub's own wiring: the runners own the read, the state carries the list, the modals draw it.
function Hub({ send, client }: { send: SendGitRequest; client: RpcClient | null }) {
  const [localBranches, setLocalBranches] = useState<RuntimeGitLocalBranches | null>(null)
  const [showBranchPicker, setShowBranchPicker] = useState(false)
  const router = useRouteHandoff()
  const mountedRef = useRef(true)
  const busyActionRef = useRef<string | null>(null)
  const runners = useMobileSourceControlRunners({
    client,
    hostId: 'host-a',
    worktreeId: 'wt-1',
    status: null,
    branchLabel: 'main',
    commitMessage: '',
    stagedEntries: [],
    generatingMessage: false,
    stageablePaths: [],
    unstageablePaths: [],
    router,
    sendGitRequest: send,
    sendCommitRequest: () => Promise.resolve(),
    runGitSyncSteps: () => Promise.resolve(),
    loadStatus: () => Promise.resolve(true),
    mountedRef,
    busyActionRef,
    setBusyAction: () => undefined,
    setActionError: () => undefined,
    setCommitMessage: () => undefined,
    setGeneratingMessage: () => undefined,
    setShowActionSheet: () => undefined,
    setLocalBranches,
    setShowBranchPicker,
    setCreatedPrUrl: () => undefined,
    setCreatedPrWarning: () => undefined,
    recordCommitFailure: () => undefined
  })
  captured.open = runners.openBranchPicker
  const state = {
    ...runners,
    localBranches,
    showBranchPicker,
    setShowBranchPicker,
    branchDiffPreview: null,
    setBranchDiffPreview: () => undefined,
    showActionSheet: false,
    setShowActionSheet: () => undefined,
    discardTarget: null,
    setDiscardTarget: () => undefined,
    createdPrUrl: null,
    setCreatedPrUrl: () => undefined,
    createdPrWarning: null,
    setCreatedPrWarning: () => undefined,
    branchLabel: 'main'
  } as unknown as ModalsState
  return createElement(MobileSourceControlModals, { state, actionSheetActions: [] })
}

function flatStyle(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat(3) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

describe('the Switch Branch picker', () => {
  let renderer: ReactTestRenderer | null = null
  let warn: ReturnType<typeof vi.spyOn>
  let connectedAt = 1
  const client = { getLastConnectedAt: () => connectedAt } as unknown as RpcClient

  beforeEach(() => {
    connectedAt = 1
    captured.open = null
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
  })

  function element(send: SendGitRequest, scheme: 'light' | 'dark') {
    return (
      <ThemeProvider initialPreference={scheme}>
        {createElement(Hub, { send, client })}
      </ThemeProvider>
    )
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve()
      }
    })
  }

  async function openPicker(send: SendGitRequest, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      renderer = create(element(send, scheme))
    })
    await act(async () => {
      captured.open?.()
    })
    await flush()
  }

  function texts(): string[] {
    return (renderer?.root.findAllByType('Text' as never) ?? []).map((node) =>
      [node.props.children].flat().join('')
    )
  }

  function retry() {
    return renderer?.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Retry loading branches')
  }

  function sender(answer: () => Promise<unknown>) {
    return vi.fn(answer) as unknown as SendGitRequest & ReturnType<typeof vi.fn>
  }

  it('says it is loading the branches instead of drawing a blank sheet', async () => {
    await openPicker(sender(() => new Promise(() => {})))

    expect(texts()).toContain('Switch Branch')
    expect(texts()).toContain('Loading branches…')
    expect(retry()).toBeUndefined()
  })

  it('says the branches could not be loaded, with Retry, when git.localBranches fails', async () => {
    await openPicker(sender(() => Promise.reject(new Error('runtime_timeout'))))

    expect(texts()).toContain("Couldn't load branches")
    expect(texts()).not.toContain('Loading branches…')
    expect(texts()).not.toContain('No local branches')
    expect(retry()).toBeDefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('runtime_timeout')
  })

  it('reads the branches again on Retry and lists them', async () => {
    let fail = true
    const send = sender(() =>
      fail
        ? Promise.reject(new Error('runtime_timeout'))
        : Promise.resolve({ current: 'main', branches: ['main', 'feat'] })
    )
    await openPicker(send)
    fail = false
    await act(async () => {
      retry()?.props.onPress()
    })
    await flush()

    expect(send).toHaveBeenCalledTimes(2)
    expect(texts()).toEqual(expect.arrayContaining(['main', 'feat', 'current']))
    expect(texts()).not.toContain("Couldn't load branches")
  })

  it('reads the branches again once on the next connection, and not before it', async () => {
    let fail = true
    const send = sender(() =>
      fail
        ? Promise.reject(new Error('connection closed'))
        : Promise.resolve({ current: 'main', branches: ['main'] })
    )
    await openPicker(send)
    await act(async () => {
      renderer?.update(element(send, 'light'))
    })
    await flush()
    expect(send).toHaveBeenCalledTimes(1)

    fail = false
    connectedAt = 2
    await act(async () => {
      renderer?.update(element(send, 'light'))
    })
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    expect(texts()).toContain('main')
    expect(texts()).not.toContain("Couldn't load branches")
  })

  it('says there are no local branches when the host answered none, which is not a failure', async () => {
    await openPicker(sender(() => Promise.resolve({ current: null, branches: [] })))

    expect(texts()).toContain('No local branches')
    expect(texts()).not.toContain("Couldn't load branches")
    expect(retry()).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('lists a single branch with no notice at all', async () => {
    await openPicker(sender(() => Promise.resolve({ current: 'main', branches: ['main'] })))

    expect(texts()).toEqual(['Switch Branch', 'main', 'current'])
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the failure from the %s theme', async (scheme, palette) => {
    await openPicker(
      sender(() => Promise.reject(new Error('runtime_timeout'))),
      scheme
    )

    const message = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === "Couldn't load branches")
    expect(flatStyle(message!.props.style).color).toBe(palette.textMuted)
    expect(flatStyle(retry()!.props.style).backgroundColor).toBe(palette.bgRaised)
    const retryText = retry()!
      .findAllByType('Text' as never)
      .find((node) => node.props.children === 'Retry')
    expect(flatStyle(retryText!.props.style).color).toBe(palette.text)
  })
})
