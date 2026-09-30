// The source-control hub's PR chip and Pull Request segment after the host reconnects.
//
// A PR read that failed because the connection dropped under it left the shared PR state on
// `error` for good: the chip's bootstrap and the PR segment's load both fire only for a `hidden`
// state, the controller had no reconnect effect, and the logical client is the same object across
// reconnects, so nothing keyed on it fires either (reproduced on main 0b2c7a92). A failed phase-2
// (comments) load was never retried the same way. Each is now read again once per NEW connection
// (useLastConnectedAt + shouldRefetchAfterReconnect), and never while the host stays down.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceControlHubTab } from './mobile-source-control-hub-tab'

const doubles = vi.hoisted(() => ({
  client: { sendRequest: () => Promise.resolve({ ok: true, result: null }) },
  connState: 'connected' as string,
  lastConnectedAt: 1 as number | null
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('./MobileSourceControlHeader', () => ({ MobileSourceControlHeader: () => null }))
vi.mock('./MobileSourceControlContent', () => ({ MobileSourceControlContent: () => null }))
vi.mock('./MobileSourceControlModals', () => ({ MobileSourceControlModals: () => null }))
vi.mock('./MobileSourceControlSegments', () => ({ MobileSourceControlSegments: () => null }))
vi.mock('./MobileGitHistoryList', () => ({ MobileGitHistoryList: () => null }))
vi.mock('../components/mobile-pr-url', () => ({ openMobilePrUrl: () => {} }))
vi.mock('./use-mobile-source-control-action-sheet', () => ({
  useMobileSourceControlActionSheet: () => ({})
}))
// What the chip shows, and what the PR segment was handed.
vi.mock('./MobileSourceControlBranchCard', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileSourceControlBranchCard: ({ prChip }: { prChip: { kind: string } | null }) =>
      h('Text', null, `chip:${prChip?.kind ?? 'none'}`)
  }
})
vi.mock('../components/pr-sidebar/MobilePrViewPanel', async () => {
  const { createElement: h } = await import('react')
  return {
    MobilePrViewPanelBody: ({
      controller
    }: {
      controller: {
        prSidebarState: { kind: string; data?: { details: { body: string } | null } }
      }
    }) => {
      const state = controller.prSidebarState
      return h('Text', null, `segment:${state.kind}:${state.data?.details?.body ?? '-'}`)
    }
  }
})
vi.mock('./use-mobile-source-control-state', () => ({
  useMobileSourceControlState: () => ({
    client: doubles.client,
    connState: doubles.connState,
    forceReconnect: null,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    router: { back: () => {} },
    setRootRef: () => {},
    worktreeLabel: 'wt',
    screenState: { kind: 'ready' },
    busyAction: null,
    loadStatus: () => Promise.resolve(true),
    status: { branch: 'feat', head: 'sha-1', entries: [], conflictOperation: 'unknown' },
    branchCompareResult: null,
    branchLabel: 'feat',
    syncLabel: '',
    unstagedCount: 0,
    stagedCount: 0,
    branchEntries: [],
    abortConflictOperation: () => Promise.resolve()
  })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => doubles.lastConnectedAt
}))

const fetchPRForBranch = vi.fn()
const fetchWorkItemDetails = vi.fn()
vi.mock('../session/github-pr-rpc', () => ({
  fetchGithubRepoSlug: async () => ({ ok: true, result: { owner: 'o', repo: 'r' } }),
  fetchHostedReviewForBranch: async () => ({ ok: true, result: null }),
  fetchPRChecks: async () => ({ ok: true, result: [] }),
  fetchPRForBranch: (...args: unknown[]) => fetchPRForBranch(...args),
  fetchWorkItemDetails: (...args: unknown[]) => fetchWorkItemDetails(...args)
}))
vi.mock('./mobile-pr-link', () => ({ fetchWorktreeLinkedPR: async () => null }))

const { MobileSourceControlPanel } = await import('./MobileSourceControlPanel')

const PR = {
  number: 7,
  title: 'Feat',
  state: 'open',
  url: 'https://github.com/o/r/pull/7',
  checksStatus: 'success',
  updatedAt: 'now',
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  headSha: 'sha-1'
}
const DETAILS = {
  item: {
    id: 'PR_node_7',
    type: 'pr',
    number: 7,
    title: 'Feat',
    state: 'open',
    url: '',
    labels: [],
    updatedAt: 'now',
    author: null
  },
  body: 'real body',
  comments: []
}

describe('the PR chip and segment after the host reconnects', () => {
  let renderer: ReactTestRenderer | null = null
  let tab: SourceControlHubTab = 'changes'

  beforeEach(() => {
    doubles.connState = 'connected'
    doubles.lastConnectedAt = 1
    fetchPRForBranch.mockReset()
    fetchWorkItemDetails.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
    })
  }

  async function mount(initialTab: SourceControlHubTab): Promise<void> {
    tab = initialTab
    await act(async () => {
      renderer = create(
        createElement(MobileSourceControlPanel, {
          hostId: 'host-a',
          worktreeId: 'wt-1',
          initialTab
        })
      )
    })
    await flush()
  }

  // A new render with the connection as the transport now reports it.
  async function connection(connState: string, lastConnectedAt: number | null): Promise<void> {
    doubles.connState = connState
    doubles.lastConnectedAt = lastConnectedAt
    await act(async () => {
      renderer?.update(
        createElement(MobileSourceControlPanel, {
          hostId: 'host-a',
          worktreeId: 'wt-1',
          initialTab: tab
        })
      )
    })
    await flush()
  }

  function texts(): string[] {
    return (renderer?.root.findAllByType('Text' as never) ?? []).map((node) =>
      String(node.props.children)
    )
  }

  it('reloads the PR chip by itself when the host reconnects after the load failed with the connection', async () => {
    fetchPRForBranch
      .mockResolvedValueOnce({ ok: false, error: 'connection closed' })
      .mockResolvedValue({ ok: true, result: PR })
    await mount('changes')
    expect(fetchPRForBranch).toHaveBeenCalledTimes(1)
    expect(texts()).toContain('chip:unavailable')

    await connection('reconnecting', 1)
    await connection('connected', 2)

    expect(fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(texts()).toContain('chip:ready')
    // The chip asked for phase 1 only, and so does its reconnect reload.
    expect(fetchWorkItemDetails).not.toHaveBeenCalled()
  })

  it('does not ask again while the host stays down, nor twice on one connection', async () => {
    fetchPRForBranch.mockResolvedValue({ ok: false, error: 'connection closed' })
    await mount('changes')
    await connection('reconnecting', 1)
    await connection('disconnected', 1)
    await connection('reconnecting', 1)
    expect(fetchPRForBranch).toHaveBeenCalledTimes(1)

    await connection('connected', 2)
    expect(fetchPRForBranch).toHaveBeenCalledTimes(2)
    // It failed again on this connection: a manual Retry is for that, not a loop.
    await connection('connected', 2)
    await connection('connected', 2)
    expect(fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(texts()).toContain('chip:unavailable')
  })

  it('reloads the Pull Request segment, comments included, after the host reconnects', async () => {
    fetchPRForBranch
      .mockResolvedValueOnce({ ok: false, error: 'Connection interrupted' })
      .mockResolvedValue({ ok: true, result: PR })
    fetchWorkItemDetails.mockResolvedValue({ ok: true, result: DETAILS })
    await mount('pr')
    expect(texts()).toContain('segment:error:-')

    await connection('reconnecting', 1)
    await connection('connected', 2)

    expect(fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(texts()).toContain('segment:ready:real body')
  })

  it('reads the comments again after a reconnect when only they failed, once per connection', async () => {
    fetchPRForBranch.mockResolvedValue({ ok: true, result: PR })
    let detailsReachable = false
    fetchWorkItemDetails.mockImplementation(async () =>
      detailsReachable
        ? { ok: true, result: DETAILS }
        : { ok: false, error: 'Request timed out: github.workItemDetails' }
    )
    await mount('pr')
    // The failed phase 2 leaves the empty placeholder the segment draws as "no comments". (The
    // segment's own fill-in may ask once more on this connection; that is not what is under test.)
    expect(texts()).toContain('segment:ready:')
    const onFirstConnection = fetchWorkItemDetails.mock.calls.length

    await connection('reconnecting', 1)
    await connection('disconnected', 1)
    expect(fetchWorkItemDetails).toHaveBeenCalledTimes(onFirstConnection)

    detailsReachable = true
    await connection('connected', 2)

    expect(fetchWorkItemDetails).toHaveBeenCalledTimes(onFirstConnection + 1)
    expect(fetchPRForBranch).toHaveBeenCalledTimes(1)
    expect(texts()).toContain('segment:ready:real body')
  })
})
