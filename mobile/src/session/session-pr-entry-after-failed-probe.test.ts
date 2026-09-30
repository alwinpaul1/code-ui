// The session header's PR entry (useMobileSessionFoundation's prRepoContextLoaded + prIsGithubRepo)
// after its repo probe FAILED on a connection that stays 'connected'.
//
// The foundation handed useMobilePrBranchContext no sign of a new connection, so after one relay
// timeout the only thing that probed again was connState leaving 'connected'. A LAN->relay swap
// keeps connState 'connected' and moves only lastConnectedAt, and the PR entry and checks action
// stayed hidden for the rest of the visit (review round 3, 2026-09-30). The REAL foundation and the
// REAL probe run here; the route, the layout and the connection metrics are the host's.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

const route = vi.hoisted(() => ({
  client: null as unknown,
  lastConnectedAt: 1 as number | null
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'mac', worktreeId: 'repo::/wt' })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ replace: vi.fn(), push: vi.fn() })
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: route.client, clientId: 'c1', state: 'connected' }),
  useForceReconnect: () => null
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useReconnectAttempt: () => 0,
  useLastConnectedAt: () => route.lastConnectedAt
}))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false })
}))
vi.mock('./use-live-worktree-name', () => ({
  useLiveWorktreeName: () => ({ name: 'wt', resolution: 'found' })
}))
vi.mock('./use-missing-worktree-bounce', () => ({ useMissingWorktreeBounce: () => undefined }))
vi.mock('../components/HostProtocolGate', () => ({
  useHostProtocolGates: () => ({ hostCapabilities: null })
}))

const { useMobileSessionFoundation } = await import('./use-mobile-session-foundation')
const { PR_REPO_PROBE_RETRY_DELAYS_MS } = await import('./use-mobile-pr-branch-context')

let foundation: ReturnType<typeof useMobileSessionFoundation> | null = null

function Session() {
  foundation = useMobileSessionFoundation()
  return null
}

let renderer: ReactTestRenderer | null = null

async function step(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  foundation = null
  route.lastConnectedAt = 1
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the session header's PR entry after a failed repo probe", () => {
  it('appears once the connection is replaced under a steady connected state', async () => {
    let githubAnswers = false
    const sendRequest = vi.fn(async (method: string) => {
      if (method !== 'github.repoSlug') {
        throw new Error(`unexpected ${method}`)
      }
      if (!githubAnswers) {
        throw new Error('Request timed out: github.repoSlug')
      }
      return { id: 'r', ok: true, result: { owner: 'stablyai', repo: 'orca' } }
    })
    route.client = { sendRequest } as unknown as RpcClient
    await act(async () => {
      renderer = create(createElement(Session))
    })
    await step()
    // Every try on this connection fails.
    for (const delay of PR_REPO_PROBE_RETRY_DELAYS_MS) {
      await step(delay)
    }
    await step(60_000)
    const probesOnFirstConnection = sendRequest.mock.calls.length
    expect(foundation?.prRepoContextLoaded).toBe(false)
    expect(foundation?.prIsGithubRepo).toBe(false)

    // A LAN->relay swap: connState stays 'connected', only the connection time moves.
    githubAnswers = true
    route.lastConnectedAt = 2
    await act(async () => {
      renderer!.update(createElement(Session))
    })
    await step()
    expect(sendRequest).toHaveBeenCalledTimes(probesOnFirstConnection + 1)
    expect(foundation?.prRepoContextLoaded).toBe(true)
    expect(foundation?.prIsGithubRepo).toBe(true)
  })
})
