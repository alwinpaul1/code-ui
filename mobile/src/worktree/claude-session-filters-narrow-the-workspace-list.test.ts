import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { CCR_SESSION_FACTS_FRESH_MS, noteCcrSessionFacts, resetCcrSessionFactsForTests } from '../session/ccr-session-facts'
import { parseCcrSessionRow } from '../session/ccr-session-row'
import { resetCcrCacheForTests, setCcrMapping } from '../session/ccr-session-cache'
import { claudeAgentSessionState, filterSectionsByClaudeSession, hasClaudeAgents } from './claude-session-list-filter'
import type { Section, Worktree } from './workspace-list-types'

// The Claude app's session list filters (All, Working, Needs input, Ready for review, Completed)
// over Code UI's workspace list: a workspace stays when one of its CLAUDE agents is in that state.
// A fresh Anthropic row decides a Claude agent's state when the phone holds one; Orca's own agent
// status decides otherwise. Codex agents are never filed: Codex is left exactly as it was.
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

function worktree(id: string, agents: RuntimeWorktreeAgentRow[] | undefined): Worktree {
  return { worktreeId: id, repo: 'repo', branch: 'main', displayName: id, agents } as unknown as Worktree
}

const section = (key: string, data: Worktree[]): Section => ({ key, title: key, data })

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

describe('the session filters over the workspace list', () => {
  const working = worktree('w-working', [agent('t1:a', { state: 'working' })])
  const waiting = worktree('w-waiting', [agent('t2:a', { state: 'blocked' })])
  const codex = worktree('w-codex', [agent('t3:a', { agentType: 'codex', state: 'working' })])
  const plain = worktree('w-plain', undefined)
  const sections = [section('pinned', [working]), section('all', [waiting, codex, plain])]

  it('leaves the list exactly as it was under All', () => {
    expect(filterSectionsByClaudeSession(sections, 'all', NOW)).toBe(sections)
  })

  it('keeps only workspaces with a Claude agent in that state, and drops sections it empties', () => {
    expect(filterSectionsByClaudeSession(sections, 'working', NOW)).toEqual([section('pinned', [working])])
    expect(filterSectionsByClaudeSession(sections, 'needs-input', NOW)).toEqual([section('all', [waiting])])
  })

  it('shows nothing, rather than Codex or plain workspaces, when no Claude session is in the state', () => {
    expect(filterSectionsByClaudeSession(sections, 'ready-for-review', NOW)).toEqual([])
  })

  it('keeps a collapsed section (no rows drawn) as it is', () => {
    const collapsed = [section('repo', [])]
    expect(filterSectionsByClaudeSession(collapsed, 'working', NOW)).toEqual(collapsed)
  })

  it('handles an empty list and a workspace whose only agent is in another state', () => {
    expect(filterSectionsByClaudeSession([], 'working', NOW)).toEqual([])
    expect(filterSectionsByClaudeSession([section('all', [waiting])], 'completed', NOW)).toEqual([])
  })

  it('offers the filters only when the list holds a Claude agent', () => {
    expect(hasClaudeAgents([working, codex])).toBe(true)
    expect(hasClaudeAgents([codex, plain])).toBe(false)
    expect(hasClaudeAgents([])).toBe(false)
  })
})
