// Diff Review's PR sidebar and PR drawer after the host reconnects.
//
// The reconnect refetch in useMobilePrSidebarController was opt-in through an optional
// `lastConnectedAt`, and only the source-control hub passed it. Diff Review called the controller
// without it, so a PR read that failed because the link dropped left the docked sidebar or the
// drawer on its error over a healthy connection: the docked-load effect fires only for `hidden`,
// and the logical client is the same object across reconnects (review round 2, 2026-09-30). The
// hub's own case is pinned in source-control/pr-chip-after-reconnect.test.tsx.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { ReviewScreenState } from './mobile-diff-review-screen-model'
import type { PrSidebarState } from './mobile-pr-sidebar-state'

const doubles = vi.hoisted(() => ({
  lastConnectedAt: 1 as number | null,
  loadSnapshot: vi.fn(),
  fetchPRForBranch: vi.fn()
}))

vi.mock('./mobile-diff-review-loaders', () => ({
  loadMobileDiffReviewSnapshot: doubles.loadSnapshot,
  loadMobileDiffReviewDiff: vi.fn().mockResolvedValue({ kind: 'idle' })
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  performAndroidHapticsAsync: vi.fn(),
  AndroidHaptics: {},
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {}
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => doubles.lastConnectedAt
}))
vi.mock('./github-pr-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./github-pr-rpc')>()),
  fetchGithubRepoSlug: async () => ({ ok: true, result: { owner: 'o', repo: 'r' } }),
  fetchHostedReviewForBranch: async () => ({ ok: true, result: null }),
  fetchPRChecks: async () => ({ ok: true, result: [] }),
  fetchPRForBranch: (...args: unknown[]) => doubles.fetchPRForBranch(...args),
  fetchWorkItemDetails: async () => ({ ok: true, result: null })
}))
vi.mock('../source-control/mobile-pr-link', () => ({ fetchWorktreeLinkedPR: async () => null }))

const { useMobileDiffReviewController } = await import('./use-mobile-diff-review-controller')

const client = { sendRequest: vi.fn() } as unknown as RpcClient

const PR = {
  number: 7,
  title: 'Feat',
  state: 'open',
  url: 'https://github.com/o/r/pull/7',
  checksStatus: 'success',
  updatedAt: 'now',
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  headSha: 'abc123'
}

function readySnapshot(branch: string): ReviewScreenState {
  return {
    kind: 'ready',
    status: { entries: [], branch, head: 'abc123' },
    comments: [],
    reviewState: { reviewedKeys: [] },
    branchCompare: null
  } as unknown as ReviewScreenState
}

describe('Diff Review PR sidebar after the host reconnects', () => {
  let renderer: ReactTestRenderer | null = null
  let prState: PrSidebarState = { kind: 'hidden' }
  let screenKind = 'loading'
  let refetchPRSidebar: (() => Promise<void>) | null = null

  function Probe({ connState }: { connState: ConnectionState }): null {
    const controller = useMobileDiffReviewController({
      client,
      connState,
      hostId: 'h',
      worktreeId: 'wt-1',
      name: 'review',
      initialFilter: 'all',
      initialTarget: null,
      onOpenSession: () => {},
      onReconnect: () => {}
    })
    prState = controller.prSidebarState
    screenKind = controller.screenState.kind
    refetchPRSidebar = () => controller.refetchPRSidebar()
    return null
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
    })
  }

  async function mount(): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Probe, { connState: 'connected' }))
    })
    await flush()
  }

  // A new render with the connection as the transport now reports it.
  async function connection(connState: ConnectionState, lastConnectedAt: number | null) {
    doubles.lastConnectedAt = lastConnectedAt
    await act(async () => {
      renderer?.update(createElement(Probe, { connState }))
    })
    await flush()
  }

  async function openFailedSidebar(): Promise<void> {
    await mount()
    expect(screenKind).toBe('ready')
    await act(async () => {
      await refetchPRSidebar?.()
    })
    await flush()
  }

  beforeEach(() => {
    doubles.lastConnectedAt = 1
    doubles.loadSnapshot.mockReset()
    doubles.loadSnapshot.mockResolvedValue(readySnapshot('feat'))
    doubles.fetchPRForBranch.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('reloads a PR read that failed with the connection once the host reconnects', async () => {
    doubles.fetchPRForBranch
      .mockResolvedValueOnce({ ok: false, error: 'closed' })
      .mockResolvedValue({ ok: true, result: PR })
    await openFailedSidebar()
    expect(prState.kind).toBe('error')
    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(1)

    await connection('reconnecting', 1)
    await connection('connected', 2)

    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(prState.kind).toBe('ready')
  })

  it('reloads a PR read the dropped link rejected once the host reconnects', async () => {
    doubles.fetchPRForBranch
      .mockRejectedValueOnce(new Error('connection closed'))
      .mockResolvedValue({ ok: true, result: PR })
    await openFailedSidebar()
    expect(prState.kind).toBe('error')

    await connection('reconnecting', 1)
    await connection('connected', 2)

    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(prState.kind).toBe('ready')
  })

  it('reloads a PR read the transport refused while the socket was down once the host reconnects', async () => {
    // The transport's own words (rpc-client-request-tracker.ts). They classified as `blocked`, the
    // GitHub-account state, which is not what the reconnect refetch keys on.
    doubles.fetchPRForBranch
      .mockResolvedValueOnce({ ok: false, error: 'Not connected: github.prForBranch' })
      .mockResolvedValue({ ok: true, result: PR })
    await openFailedSidebar()
    expect(prState.kind).toBe('error')

    await connection('reconnecting', 1)
    await connection('connected', 2)

    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(prState.kind).toBe('ready')
  })

  it('asks once per new connection, never per render, and not while the host stays down', async () => {
    doubles.fetchPRForBranch.mockResolvedValue({ ok: false, error: 'closed' })
    await openFailedSidebar()
    await connection('reconnecting', 1)
    await connection('disconnected', 1)
    await connection('reconnecting', 1)
    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(1)

    await connection('connected', 2)
    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(2)
    // It failed again on this connection: Retry is for that, not a loop.
    await connection('connected', 2)
    await connection('connected', 2)
    expect(doubles.fetchPRForBranch).toHaveBeenCalledTimes(2)
    expect(prState.kind).toBe('error')
  })

  it('says in one line which PR read failed, why, and whether a reconnect will retry it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      doubles.fetchPRForBranch.mockResolvedValue({ ok: false, error: 'closed' })
      await openFailedSidebar()
      const lines = warn.mock.calls.filter((call) => String(call[0]).startsWith('[pr-sidebar]'))
      expect(lines).toHaveLength(1)
      const line = JSON.stringify(lines[0])
      expect(line).toContain('wt-1')
      expect(line).toContain('feat')
      expect(line).toContain('closed')
      expect(line).toContain('"kind":"error"')
    } finally {
      warn.mockRestore()
    }
  })
})
