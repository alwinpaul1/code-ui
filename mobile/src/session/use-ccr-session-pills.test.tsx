import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCcrMapping, triggerCcrRematch } from './ccr-session-cache'
import { CCR_PILLS_REFRESH_MS, resetCcrPillsForTests, type CcrPillsReading } from './ccr-session-pills'
import { resetCcrPipelineForTests, type CcrPipelineDeps } from './ccr-session-pipeline'
import { branchFetch, branchStatus, branchStatusReply, jsonReply, rowWithBranches } from './fixtures/ccr-branch-status-2026-10-15'
import { ACCOUNT_UUID, ORG_UUID, SESSION_A, SESSION_B, TOKEN, defaultAccount, fakeAccounts } from './fixtures/ccr-session-api-2026-10-14'
import { useCcrSessionPills } from './use-ccr-session-pills'

// The pull request of a tab's Remote Control session is read on the events the model's read is
// (the tab opened, a new connection, a sign-in or out, the app back in front), then each minute;
// it waits, at no cost in requests, for the model hook's match, and reads nothing for a tab that
// is off or has no match.

vi.mock('react-native', () => ({}))

const TAB = 'tab-1'

function setup() {
  const net = branchFetch({ sessions: [rowWithBranches(SESSION_A)], branchStatus: () => jsonReply(200, branchStatusReply([branchStatus()])) })
  const kept = fakeAccounts([defaultAccount({ token: TOKEN, organizationUuid: ORG_UUID })])
  const deps: CcrPipelineDeps = { fetch: net.fetch, accounts: kept.source, keep: () => '', maxBytes: 1, log: () => {} }
  return { deps, requests: net.requests }
}

let shown: CcrPillsReading | null = null
let renderer: ReactTestRenderer | null = null

function Harness(props: { enabled?: boolean; tabId?: string | null; agentSessionId?: string | null; epoch?: number | null; deps: CcrPipelineDeps }) {
  shown = useCcrSessionPills({
    enabled: props.enabled ?? true,
    tabId: props.tabId === undefined ? TAB : props.tabId,
    agentSessionId: props.agentSessionId ?? null,
    epoch: props.epoch === undefined ? 1 : props.epoch,
    deps: props.deps
  })
  return null
}

async function mount(props: Parameters<typeof Harness>[0]) {
  await act(async () => {
    renderer = create(createElement(Harness, props))
  })
}
const flush = () => act(async () => {})
const posts = (requests: { method: string }[]) => requests.filter((request) => request.method === 'POST').length

beforeEach(() => {
  vi.useFakeTimers()
  resetCcrPipelineForTests()
  resetCcrPillsForTests()
  shown = null
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('the pull request reading for a tab', () => {
  it('is read at once for a matched tab and handed to the pills', async () => {
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
    const { deps, requests } = setup()
    await mount({ deps })
    await flush()
    expect(posts(requests)).toBe(1)
    expect(shown).toMatchObject({ sessionId: SESSION_A, pr: { number: 12 } })
  })

  it('reads nothing while the tab is off, has no tab id, or is not matched', async () => {
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
    const { deps, requests } = setup()
    await mount({ deps, enabled: false })
    await mount({ deps, tabId: null })
    await mount({ deps, tabId: 'tab-unmatched' })
    await flush()
    expect(requests).toEqual([])
    expect(shown).toBeNull()
  })

  it('waits for the model hook’s match with memory reads, then reads once it lands', async () => {
    const { deps, requests } = setup()
    await mount({ deps })
    await flush()
    expect(requests).toEqual([])
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(posts(requests)).toBe(1)
    expect(shown).toMatchObject({ pr: { number: 12 } })
  })

  it('gives up waiting after the quick retries and tries again on the minute', async () => {
    const { deps, requests } = setup()
    await mount({ deps })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(requests).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CCR_PILLS_REFRESH_MS)
    })
    expect(posts(requests)).toBe(1)
  })

  it('is read again each minute, and once for each rematch event, never once per render', async () => {
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
    const { deps, requests } = setup()
    await mount({ deps })
    await flush()
    expect(posts(requests)).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CCR_PILLS_REFRESH_MS)
    })
    expect(posts(requests)).toBe(2)
    await act(async () => {
      triggerCcrRematch('foreground')
    })
    await flush()
    expect(posts(requests)).toBe(3)
    await act(async () => {
      renderer!.update(createElement(Harness, { deps }))
    })
    await flush()
    expect(posts(requests)).toBe(3)
  })

  it('is not the reading of the Claude session the tab showed before', async () => {
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID, 'claude-session-1')
    const { deps } = setup()
    await mount({ deps, agentSessionId: 'claude-session-1' })
    await flush()
    expect(shown).toMatchObject({ sessionId: SESSION_A })
    setCcrMapping(TAB, SESSION_B, 1, ACCOUNT_UUID, 'claude-session-2')
    await act(async () => {
      renderer!.update(createElement(Harness, { deps, agentSessionId: 'claude-session-2' }))
    })
    expect(shown?.sessionId).not.toBe(SESSION_A)
  })

  it('reads nothing a new connection did not ask for: a reading of another connection is not used', async () => {
    setCcrMapping(TAB, SESSION_A, 1, ACCOUNT_UUID)
    const { deps } = setup()
    await mount({ deps, epoch: 1 })
    await flush()
    expect(shown).not.toBeNull()
    await act(async () => {
      renderer!.update(createElement(Harness, { deps, epoch: 2 }))
    })
    expect(shown).toBeNull()
  })
})
