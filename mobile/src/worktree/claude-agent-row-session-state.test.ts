import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { CCR_SESSION_FACTS_FRESH_MS, noteCcrSessionFacts, resetCcrSessionFactsForTests } from '../session/ccr-session-facts'
import { parseCcrSessionRow } from '../session/ccr-session-row'
import { resetCcrCacheForTests, setCcrMapping } from '../session/ccr-session-cache'
import { claudeAgentSessionState } from './claude-agent-session-state'

// A Claude agent row's session state, which its status dot follows on the workspace list.
// A fresh Anthropic row decides it when the phone holds one; Orca's own agent status decides
// otherwise. Codex agents get none: Codex is left exactly as it was.
const NOW = Date.parse('2026-10-15T12:00:00Z')

function agent(paneKey: string, overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey,
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
    stateStartedAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...overrides
  }
}

afterEach(() => {
  resetCcrSessionFactsForTests()
  resetCcrCacheForTests()
})

describe('a Claude agent row’s session state', () => {
  it('comes from Orca’s agent status when no fresh session row is held', () => {
    expect(claudeAgentSessionState(agent('t1:a', { state: 'working' }), NOW)).toBe('working')
    expect(claudeAgentSessionState(agent('t1:a', { state: 'waiting' }), NOW)).toBe('needs-input')
    expect(claudeAgentSessionState(agent('t1:a', { state: 'done' }), NOW)).toBe('completed')
  })

  it('comes from the session row while it is fresh, then falls back to Orca', () => {
    setCcrMapping('t1', 'cse_01QXaaaaaaaaaaaaaaaaaaaa', 1, 'acct-1')
    noteCcrSessionFacts('t1', 1, parseCcrSessionRow({ id: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', status: 'idle', post_turn_summary: { status_category: 'review_ready' } })!, NOW)
    expect(claudeAgentSessionState(agent('t1:a', { state: 'done' }), NOW + 1000)).toBe('ready-for-review')
    expect(claudeAgentSessionState(agent('t1:a', { state: 'done' }), NOW + CCR_SESSION_FACTS_FRESH_MS)).toBe('completed')
  })

  it('keeps Orca’s live Working over a session row read before the turn started', () => {
    noteCcrSessionFacts('t1', 1, parseCcrSessionRow({ id: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', status: 'idle', post_turn_summary: { status_category: 'completed' } })!, NOW)
    expect(claudeAgentSessionState(agent('t1:a', { state: 'working' }), NOW + 1000)).toBe('working')
  })

  it('is nothing for a Codex agent, even on a tab that holds a session row', () => {
    noteCcrSessionFacts('t1', 1, parseCcrSessionRow({ id: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', status: 'requires_action' })!, NOW)
    expect(claudeAgentSessionState(agent('t1:a', { agentType: 'codex', state: 'working' }), NOW)).toBeNull()
    expect(claudeAgentSessionState(agent('t2:a', { agentType: null }), NOW)).toBeNull()
  })
})
