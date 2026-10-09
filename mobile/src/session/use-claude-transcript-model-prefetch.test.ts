import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({ lastConnectedAt: 1 as number | null }))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => fakes.lastConnectedAt
}))

import {
  createAnsweringClient,
  historySession,
  ok,
  refused,
  type AnsweringClient,
  type HostReply
} from '../agent-history/agent-history-panel.test-support'
import type { ClaudeModelFallback } from './claude-transcript-model'
import {
  CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL,
  resetClaudeTranscriptModelScansForTests
} from './claude-transcript-model-scan'
import { clearPendingModelPicksForTests } from './mobile-native-chat-model-report-authority'
import type { MobileSessionTab } from './mobile-session-route-types'
import { resetSessionTabsCacheForTests, sessionTabsCacheKey, writeCachedSessionTabs } from './mobile-session-tabs-cache'
import { resetClaudeTranscriptModelPicksForTests, useClaudeTranscriptModel } from './use-claude-transcript-model'

// 2026-10-09: the pill must be there when a Claude chat opens. The session
// screen knows a project's tabs (the last accepted list, cached per project)
// before any chat is opened, so it warms the host's scan for that folder,
// unforced, and the chat states the reading on its first render.
const HOST = 'host-mac'
const SESSION = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607'
const worktree = (name: string) => `repo-${name}::/Users/alwin/${name}`

const claudeTab = (over: Partial<Record<string, unknown>> = {}): MobileSessionTab =>
  ({
    type: 'terminal',
    id: 'tab-1',
    title: 'claude',
    terminal: 'term-1',
    agentStatus: { state: 'done', agentType: 'claude', providerSession: { id: SESSION } },
    ...over
  }) as unknown as MobileSessionTab

type Probe = { worktreeId?: string; chatOpen?: boolean }

describe('warming the model scan before a Claude chat opens', () => {
  let host: AnsweringClient
  let reply: () => HostReply
  const renderers: ReactTestRenderer[] = []
  let latest: ClaudeModelFallback | null = null

  function Harness({ worktreeId = worktree('a'), chatOpen = false }: Probe) {
    latest = useClaudeTranscriptModel({
      client: host.client,
      hostId: HOST,
      worktreeId,
      tabId: 'tab-1',
      sessionId: chatOpen ? SESSION : null,
      enabled: chatOpen,
      connected: true,
      liveModel: null,
      beacon: false,
      agentWorking: false
    }).fallback
    return null
  }

  function mount(probe: Probe = {}): ReactTestRenderer {
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Harness, probe))
    })
    renderers.push(renderer!)
    return renderer!
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
    })
  }

  const scans = () => host.sent('aiVault.listSessions')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-09T10:00:00.000Z'))
    resetClaudeTranscriptModelScansForTests()
    resetSessionTabsCacheForTests()
    clearPendingModelPicksForTests()
    resetClaudeTranscriptModelPicksForTests()
    fakes.lastConnectedAt = 1
    latest = null
    reply = () => ok({ sessions: [historySession({ sessionId: SESSION, model: 'claude-opus-5-5' })], issues: [] })
    host = createAnsweringClient((method) => (method === 'aiVault.listSessions' ? reply() : refused('method_not_found', method)))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    for (const renderer of renderers.splice(0)) {
      act(() => renderer.unmount())
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('warms the scan for a project with a Claude tab, so the chat states the model on its first render', async () => {
    writeCachedSessionTabs(sessionTabsCacheKey(HOST, worktree('a')), [claudeTab()])
    const screen = mount()
    await flush()
    expect(scans()).toHaveLength(1)
    expect(scans()[0]?.params).toMatchObject({ force: false, scopePaths: ['/Users/alwin/a'] })

    // The chat opens: no further ask, and the reading is there on that render.
    act(() => screen.update(createElement(Harness, { chatOpen: true })))
    expect(latest).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
    await flush()
    expect(scans()).toHaveLength(1)
  })

  it('counts a tab launched as Claude before any agent status reached the phone', async () => {
    writeCachedSessionTabs(sessionTabsCacheKey(HOST, worktree('a')), [claudeTab({ agentStatus: null, launchAgent: 'claude' })])
    mount()
    await flush()
    expect(scans()).toHaveLength(1)
  })

  it.each([
    ['no tabs at all', []],
    ['only a shell', [claudeTab({ agentStatus: null })]],
    ['only a Codex tab', [claudeTab({ agentStatus: { state: 'done', agentType: 'codex' }, launchAgent: 'codex' })]],
    ['only a browser tab', [{ type: 'browser', id: 'b1', title: 'docs' } as unknown as MobileSessionTab]]
  ])('warms nothing for a project with %s', async (_label, tabs) => {
    writeCachedSessionTabs(sessionTabsCacheKey(HOST, worktree('a')), tabs as MobileSessionTab[])
    mount()
    await flush()
    expect(scans()).toHaveLength(0)
  })

  it('keeps one scan in flight per project, however often the screen re-renders or remounts', async () => {
    let answer: (value: HostReply) => void = () => {}
    reply = () => new Promise<HostReply>((resolve) => (answer = resolve)) as unknown as HostReply
    writeCachedSessionTabs(sessionTabsCacheKey(HOST, worktree('a')), [claudeTab()])
    const first = mount()
    act(() => first.update(createElement(Harness, {})))
    act(() => first.unmount())
    mount()
    mount()
    await flush()
    expect(scans()).toHaveLength(1)
    answer(ok({ sessions: [], issues: [] }))
    await flush()
  })

  it('never asks a host past its cap, however many projects are visited', async () => {
    const projects = Array.from({ length: CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL + 4 }, (_, i) => worktree(`p${String(i)}`))
    for (const id of projects) {
      writeCachedSessionTabs(sessionTabsCacheKey(HOST, id), [claudeTab()])
      mount({ worktreeId: id })
    }
    await flush()
    expect(scans()).toHaveLength(CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL)
  })

  it('fails open: a refused warm-up leaves the chat to show nothing, and ask again on the next connection', async () => {
    reply = () => refused('internal_error', 'scan worker exited')
    writeCachedSessionTabs(sessionTabsCacheKey(HOST, worktree('a')), [claudeTab()])
    const screen = mount()
    await flush()
    expect(scans()).toHaveLength(1)
    act(() => screen.update(createElement(Harness, { chatOpen: true })))
    await flush()
    expect(latest).toEqual({ kind: 'none' })

    reply = () => ok({ sessions: [historySession({ sessionId: SESSION, model: 'claude-opus-5-5' })], issues: [] })
    fakes.lastConnectedAt = 2
    act(() => screen.update(createElement(Harness, { chatOpen: true })))
    await flush()
    expect(scans()).toHaveLength(2)
    expect(latest).toMatchObject({ kind: 'transcript', model: { label: 'Opus 5.5' } })
  })
})
