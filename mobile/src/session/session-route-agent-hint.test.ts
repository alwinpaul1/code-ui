import { describe, expect, it } from 'vitest'
import { worktreeSessionPath } from '../host-screen/worktree-session-path'
import { readSessionRouteAgentHint, worktreeRowOpensClaude } from './session-route-agent-hint'

// 2026-10-16, from the user: opening a workspace the phone had never cached drew a bare spinner
// even for a Claude session, because only the tab cache could say it opened on Claude. The row
// the user tapped already lists the workspace's agents (worktree.ps `agents`, with `agentType`),
// so it hands that along the navigation.

type Row = Parameters<typeof worktreeRowOpensClaude>[0]

function agent(agentType: string | null, paneKey: string, parentPaneKey: string | null = null) {
  return { paneKey, agentType, parentPaneKey }
}

function row(agents: ReturnType<typeof agent>[], liveTerminalCount: number) {
  return { worktreeId: 'wt-1', displayName: 'Code UI', repo: 'code-ui', agents, liveTerminalCount } as Row & {
    worktreeId: string
    displayName: string
    repo: string
    liveTerminalCount: number
  }
}

describe('a tapped workspace row that opens on Claude', () => {
  it('is a Claude session when every agent on it is Claude and no other terminal is open', () => {
    expect(worktreeRowOpensClaude(row([agent('claude', 't1:1')], 1))).toBe(true)
    expect(worktreeRowOpensClaude(row([agent('claude', 't1:1'), agent('claude', 't2:1')], 2))).toBe(true)
    // A structured Claude session runs no PTY, so it has no live terminal at all.
    expect(worktreeRowOpensClaude(row([agent('claude', 't1:1')], 0))).toBe(true)
  })

  it("counts a Claude agent's subagents as its own, whatever they are", () => {
    expect(worktreeRowOpensClaude(row([agent('claude', 't1:1'), agent('codex', 't1:1:sub', 't1:1')], 1))).toBe(true)
  })

  it('is no hint for a Codex workspace, a mixed one, or one with a plain shell beside Claude', () => {
    expect(worktreeRowOpensClaude(row([agent('codex', 't1:1')], 1))).toBe(false)
    expect(worktreeRowOpensClaude(row([agent('claude', 't1:1'), agent('codex', 't2:1')], 2))).toBe(false)
    expect(worktreeRowOpensClaude(row([agent('claude', 't1:1')], 2))).toBe(false)
    expect(worktreeRowOpensClaude(row([agent(null, 't1:1')], 1))).toBe(false)
  })

  it('is no hint for a row with no agents, or one from a host that sends none', () => {
    expect(worktreeRowOpensClaude(row([], 0))).toBe(false)
    expect(worktreeRowOpensClaude(row([], 1))).toBe(false)
    expect(worktreeRowOpensClaude({ liveTerminalCount: 1 })).toBe(false)
  })
})

describe('the session route a tapped row opens', () => {
  it('carries agent=claude for a Claude row, and nothing for any other', () => {
    expect(worktreeSessionPath('host-1', row([agent('claude', 't1:1')], 1))).toBe('/h/host-1/session/wt-1?name=Code%20UI&agent=claude')
    expect(worktreeSessionPath('host-1', row([agent('codex', 't1:1')], 1))).toBe('/h/host-1/session/wt-1?name=Code%20UI')
    expect(worktreeSessionPath('host-1', row([], 0))).toBe('/h/host-1/session/wt-1?name=Code%20UI')
  })

  it('keeps an absent host an empty segment, as before', () => {
    expect(worktreeSessionPath(undefined, row([], 0))).toBe('/h//session/wt-1?name=Code%20UI')
  })
})

describe("the route's agent hint", () => {
  it('reads only claude, from a value or the first of several', () => {
    expect(readSessionRouteAgentHint('claude')).toBe('claude')
    expect(readSessionRouteAgentHint(['claude', 'codex'])).toBe('claude')
    expect(readSessionRouteAgentHint('codex')).toBeNull()
    expect(readSessionRouteAgentHint('')).toBeNull()
    expect(readSessionRouteAgentHint(undefined)).toBeNull()
    expect(readSessionRouteAgentHint([])).toBeNull()
  })
})
