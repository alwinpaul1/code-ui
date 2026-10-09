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
  resetClaudeTranscriptModelPicksForTests,
  useClaudeTranscriptModel
} from './use-claude-transcript-model'

// Review, 2026-10-09: asking early on a tab whose badge was about to speak
// spent the host's whole five-minute budget, while each scan asks for one
// project's folder, so the next chat in another project on that host was held
// back and, unforced and throttled, never asked again: its pill stayed blank.
// The budget is now per folder (claude-transcript-model-scan.ts), so every chat
// asks the moment it opens and no project can starve another; a badge that
// speaks later still outranks the reading.
const HOST = 'host-mac'
const A = { worktreeId: 'repo-a::/Users/alwin/a', folder: '/Users/alwin/a', sessionId: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607' }
const B = { worktreeId: 'repo-b::/Users/alwin/b', folder: '/Users/alwin/b', sessionId: '8b19cb22-996c-40e5-a887-a5323a9845e1' }

type Tab = typeof A
type Probe = { tab: Tab; liveModel?: string | null }

describe('two Claude chats in different projects on one host', () => {
  let host: AnsweringClient
  const renderers: ReactTestRenderer[] = []
  const latest = new Map<string, ClaudeModelFallback>()

  function Harness({ tab, liveModel = null }: Probe) {
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

  it('asks on opening, before any screen read, and gives way to the badge that read brings', async () => {
    const tab = mount({ tab: A })
    await advance(0)
    expect(scans()).toBe(1)
    expect(latest.get(A.sessionId)).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
    update(tab, { tab: A, liveModel: 'claude-opus-5-5' })
    expect(latest.get(A.sessionId)).toEqual({ kind: 'none' })
  })

  it("leaves another project's badge-less chat on the same host its scan, after a chat whose badge spoke", async () => {
    const first = mount({ tab: A })
    await advance(300)
    update(first, { tab: A, liveModel: 'claude-opus-5-5' })
    await advance(30_000)

    mount({ tab: B })
    await advance(10_000)
    expect(latest.get(B.sessionId)).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
    await advance(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    expect(latest.get(B.sessionId)).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })
})
