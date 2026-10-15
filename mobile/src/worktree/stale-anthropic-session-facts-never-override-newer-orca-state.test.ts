import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { resetCcrCacheForTests, setCcrMapping } from '../session/ccr-session-cache'
import { ccrSessionFactsVersion, noteCcrSessionFacts, resetCcrSessionFactsForTests } from '../session/ccr-session-facts'
import { parseCcrSessionRow } from '../session/ccr-session-row'
import { claudeAgentDotState, claudeAgentSessionFacts, claudeAgentSessionState } from './claude-agent-session-state'

// Reported 2026-10-15 (review of the session-state branch): the list let a tab's Anthropic session
// row override Orca's own agent state for as long as the row was under 90 s old, even when Orca's
// state had changed since the row was read, and whichever session the row was about. A row read
// while the session ran kept a finished agent "working" for a minute and a half; a row that asked
// for input kept a NEW session in the same tab under "Needs input". Orca hears the agent live, so
// its state wins once it changed after the row was read, and a row applies only to the session the
// tab is matched to now.
const NOW = Date.parse('2026-10-15T12:00:00Z')
const SESSION_A = 'cse_01QXaaaaaaaaaaaaaaaaaaaa'
const SESSION_B = 'cse_01QXbbbbbbbbbbbbbbbbbbbb'
// The host addresses a terminal tab as `<tabId>::<leafId>` and Orca's pane as `<tabId>:<leafId>`.
const TAB = 'tab-cc::leaf-1'
const PANE = 'tab-cc:leaf-1'

function agent(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: PANE,
    parentPaneKey: null,
    state: 'done',
    agentType: 'claude',
    prompt: '',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    ...overrides
  }
}

function noteRow(fields: Record<string, unknown>, at = NOW, sessionId = SESSION_A) {
  noteCcrSessionFacts(TAB, 1, parseCcrSessionRow({ id: sessionId, ...fields })!, at)
}

beforeEach(() => {
  setCcrMapping(TAB, SESSION_A, 1, 'acct-1')
})
afterEach(() => {
  resetCcrSessionFactsForTests()
  resetCcrCacheForTests()
})

describe('a Claude agent row with its tab’s Anthropic session row held', () => {
  it('shows done once Orca says the turn ended after a row that said running was read', () => {
    noteRow({ status: 'running', worker_status: 'running', updated_at: new Date(NOW).toISOString() })
    const ended = agent({ state: 'done', stateStartedAt: NOW + 20_000, updatedAt: NOW + 20_000 })
    expect(claudeAgentDotState(ended, NOW + 25_000)).toBe('done')
    expect(claudeAgentSessionState(ended, NOW + 25_000)).toBe('completed')
  })

  it('files a new idle session in the tab as Completed, not under the old row’s Needs input', () => {
    noteRow({ status: 'requires_action' })
    const fresh = agent({ state: 'done', stateStartedAt: NOW + 30_000, updatedAt: NOW + 30_000 })
    expect(claudeAgentSessionState(fresh, NOW + 40_000)).toBe('completed')
    expect(claudeAgentDotState(fresh, NOW + 40_000)).toBe('done')
  })

  it('ignores a row about another session than the one the tab is matched to now', () => {
    noteRow({ status: 'idle', post_turn_summary: { status_category: 'review_ready' } })
    setCcrMapping(TAB, SESSION_B, 1, 'acct-1')
    expect(claudeAgentSessionState(agent(), NOW + 1000)).toBe('completed')
  })

  it('ignores the row once the tab has no match at all', () => {
    noteRow({ status: 'requires_action' })
    resetCcrCacheForTests()
    expect(claudeAgentSessionState(agent(), NOW + 1000)).toBe('completed')
    expect(claudeAgentDotState(agent(), NOW + 1000)).toBe('done')
  })

  it.each([
    ['both zero', { stateStartedAt: 0, updatedAt: 0 }],
    ['both not numbers', { stateStartedAt: Number.NaN, updatedAt: undefined as unknown as number }]
  ])('keeps Orca’s state when Orca’s row carries no usable time (%s)', (_name, times) => {
    noteRow({ status: 'requires_action' })
    expect(claudeAgentSessionFacts(agent(times), NOW + 1000)).toBeNull()
    expect(claudeAgentSessionState(agent(times), NOW + 1000)).toBe('completed')
  })

  it('still applies a row read after Orca’s last change, for the matched session', () => {
    noteRow({ status: 'idle', post_turn_summary: { status_category: 'review_ready' } })
    expect(claudeAgentSessionState(agent(), NOW + 1000)).toBe('ready-for-review')
    noteRow({ status: 'requires_action' })
    expect(claudeAgentDotState(agent(), NOW + 1000)).toBe('waiting')
  })

  it('applies a row kept under a bare tab id, from a host that publishes no leaf address', () => {
    noteCcrSessionFacts('tab-old', 1, parseCcrSessionRow({ id: SESSION_A, status: 'requires_action' })!, NOW)
    setCcrMapping('tab-old', SESSION_A, 1, 'acct-1')
    expect(claudeAgentSessionState(agent({ paneKey: 'tab-old:leaf-1' }), NOW + 1000)).toBe('needs-input')
  })

  it('leaves a Codex agent on Orca’s state whatever the tab’s row says', () => {
    noteRow({ status: 'requires_action' })
    const codex = agent({ agentType: 'codex', state: 'working', stateStartedAt: NOW - 60_000, updatedAt: NOW - 60_000 })
    expect(claudeAgentSessionFacts(codex, NOW + 1000)).toBeNull()
    expect(claudeAgentSessionState(codex, NOW + 1000)).toBeNull()
    expect(claudeAgentDotState(codex, NOW + 1000)).toBe('working')
  })
})

describe('a re-read of the same row', () => {
  it('tells no one when nothing it draws changed, and still moves its read time', () => {
    noteRow({ status: 'idle', title: 'CI failure', post_turn_summary: { status_category: 'completed' } })
    const before = ccrSessionFactsVersion()
    noteRow({ status: 'idle', title: 'CI failure', post_turn_summary: { status_category: 'completed' } }, NOW + 60_000)
    expect(ccrSessionFactsVersion()).toBe(before)
    // The read time moved: a row 60 s newer is still fresh 80 s after the first read.
    expect(claudeAgentSessionFacts(agent(), NOW + 120_000)?.fetchedAt).toBe(NOW + 60_000)
  })

  it('tells its readers when the title, the state or the Unread mark changed', () => {
    noteRow({ status: 'idle', title: 'CI failure' })
    const before = ccrSessionFactsVersion()
    noteRow({ status: 'idle', title: 'Login bug' }, NOW + 60_000)
    expect(ccrSessionFactsVersion()).toBe(before + 1)
    noteRow({ status: 'idle', title: 'Login bug', unread: true }, NOW + 120_000)
    expect(ccrSessionFactsVersion()).toBe(before + 2)
  })
})
