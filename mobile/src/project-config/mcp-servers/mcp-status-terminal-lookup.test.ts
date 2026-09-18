import { describe, expect, it } from 'vitest'
import { findMcpStatusTerminalCandidate } from './mcp-status-terminal-lookup'

describe('finding a terminal for the "Show status in terminal" button', () => {
  it('picks an idle Claude terminal tab', () => {
    const result = findMcpStatusTerminalCandidate({
      tabs: [
        { type: 'browser', id: 'b1' },
        {
          type: 'terminal',
          id: 't1',
          terminal: 'term-1',
          agentStatus: { agentType: 'claude', state: 'done' }
        }
      ]
    })
    expect(result).toEqual({ terminal: 'term-1', agent: 'claude', status: 'done' })
  })

  it('falls back to launchAgent when the hook has not reported an agent type yet', () => {
    const result = findMcpStatusTerminalCandidate({
      tabs: [{ type: 'terminal', terminal: 'term-1', launchAgent: 'claude', agentStatus: { state: 'done' } }]
    })
    expect(result?.agent).toBe('claude')
  })

  it('skips a Codex terminal', () => {
    const result = findMcpStatusTerminalCandidate({
      tabs: [{ type: 'terminal', terminal: 'term-1', agentStatus: { agentType: 'codex', state: 'done' } }]
    })
    expect(result).toBeNull()
  })

  it('skips a Claude terminal that is not idle', () => {
    const result = findMcpStatusTerminalCandidate({
      tabs: [{ type: 'terminal', terminal: 'term-1', agentStatus: { agentType: 'claude', state: 'working' } }]
    })
    expect(result).toBeNull()
  })

  it('degenerate: an empty tab list finds nothing', () => {
    expect(findMcpStatusTerminalCandidate({ tabs: [] })).toBeNull()
  })

  it('refuses a malformed reply instead of guessing', () => {
    expect(findMcpStatusTerminalCandidate(null)).toBeNull()
    expect(findMcpStatusTerminalCandidate({})).toBeNull()
    expect(findMcpStatusTerminalCandidate({ tabs: 'not-an-array' })).toBeNull()
  })

  it('skips a terminal tab with no terminal handle', () => {
    expect(
      findMcpStatusTerminalCandidate({ tabs: [{ type: 'terminal', agentStatus: { agentType: 'claude', state: 'done' } }] })
    ).toBeNull()
  })
})
