import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => 1 }))

import {
  createAnsweringClient,
  historySession,
  ok,
  refused,
  type AnsweringClient
} from '../agent-history/agent-history-panel.test-support'
import type { ClaudeModelFallback } from './claude-transcript-model'
import {
  CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS,
  resetClaudeTranscriptModelScansForTests
} from './claude-transcript-model-scan'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import {
  CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS,
  resetClaudeTranscriptModelPicksForTests,
  useClaudeTranscriptModel
} from './use-claude-transcript-model'

// Review, 2026-10-09: asking at once on a tab that can never beacon fired the
// scan on the first render, before the first screen read could show a badge.
// The budget is one scan per HOST per five minutes, but each scan is asked with
// its own project's folder, so that wasted scan of project A throttled the
// next chat in project B on the same host, and an unforced throttled scan is
// never asked again: B's pill stayed blank. The early ask now waits for the
// first screen read to land with no badge on it.
const HOST = 'host-mac'
const A = { worktreeId: 'repo-a::/Users/alwin/a', folder: '/Users/alwin/a', sessionId: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607' }
const B = { worktreeId: 'repo-b::/Users/alwin/b', folder: '/Users/alwin/b', sessionId: '8b19cb22-996c-40e5-a887-a5323a9845e1' }

type Tab = typeof A
type Probe = { tab: Tab; liveModel?: string | null; screenRead?: boolean }

describe('when a Claude tab that can never beacon asks the host at once', () => {
  let host: AnsweringClient
  const renderers: ReactTestRenderer[] = []
  const latest = new Map<string, ClaudeModelFallback>()

  function Harness({ tab, liveModel = null, screenRead = false }: Probe) {
    latest.set(
      tab.sessionId,
      useClaudeTranscriptModel({
        client: host.client,
        hostId: HOST,
        worktreeId: tab.worktreeId,
        tabId: tab.sessionId,
        sessionId: tab.sessionId,
        enabled: true,
        connected: true,
        liveModel,
        beacon: false,
        beaconCanCome: false,
        screenRead,
        agentWorking: false
      }).fallback
    )
    return null
  }

  function mount(probe: Probe): ReactTestRenderer {
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Harness, probe))
    })
    renderers.push(renderer!)
    return renderer!
  }

  function update(renderer: ReactTestRenderer, probe: Probe): void {
    act(() => renderer.update(createElement(Harness, probe)))
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  const scans = (): number => host.sent('aiVault.listSessions').length

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-09T10:00:00.000Z'))
    resetClaudeTranscriptModelScansForTests()
    clearPendingModelPicksForTests()
    resetClaudeTranscriptModelPicksForTests()
    latest.clear()
    // The host lists only the sessions in the folder it is asked about.
    host = createAnsweringClient((method, params) => {
      if (method !== 'aiVault.listSessions') {
        return refused('method_not_found', method)
      }
      const scope = (params as { scopePaths?: string[] }).scopePaths ?? []
      const tab = [A, B].find((candidate) => scope.includes(candidate.folder))
      return ok({
        sessions: tab ? [historySession({ sessionId: tab.sessionId, cwd: tab.folder, model: 'claude-opus-5-5' })] : [],
        issues: []
      })
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    for (const renderer of renderers.splice(0)) {
      act(() => renderer.unmount())
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('asks nothing before the first screen read, so a badge on that read costs no scan', async () => {
    const tab = mount({ tab: A })
    await advance(300)
    expect(scans()).toBe(0)
    // The first read lands with the user's status line on it.
    update(tab, { tab: A, liveModel: 'claude-opus-5-5', screenRead: true })
    await advance(60_000)
    expect(scans()).toBe(0)
  })

  it('asks as soon as the first screen read lands with no badge on it', async () => {
    const tab = mount({ tab: A })
    await advance(300)
    expect(scans()).toBe(0)
    update(tab, { tab: A, screenRead: true })
    await advance(0)
    expect(scans()).toBe(1)
    expect(latest.get(A.sessionId)).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })

  it('still asks after the settle when no screen read ever lands', async () => {
    mount({ tab: A })
    await advance(CLAUDE_TRANSCRIPT_MODEL_SETTLE_MS - 1)
    expect(scans()).toBe(0)
    await advance(1)
    expect(scans()).toBe(1)
  })

  it("leaves another project's badge-less chat on the same host its scan, after a chat whose badge spoke", async () => {
    const first = mount({ tab: A })
    await advance(300)
    update(first, { tab: A, liveModel: 'claude-opus-5-5', screenRead: true })
    await advance(30_000)

    const second = mount({ tab: B })
    update(second, { tab: B, screenRead: true })
    await advance(10_000)
    expect(latest.get(B.sessionId)).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    expect(latest.get(B.sessionId)).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })
})
