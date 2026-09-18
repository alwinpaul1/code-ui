import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { CLAUDE_FORK_COMMAND_TEXT, canForkClaudeSession, forkClaudeSession } from './claude-fork-session'

/**
 * The extension's "Fork conversation" resumes the session as a new branch.
 * The phone has no equivalent RPC — Claude Code's own `/fork` typed command
 * does the same thing, so the session-menu Fork action just types it and
 * presses Enter, the same as a person would.
 *
 * Verified against mobile-chat-command-overlay.ts's CLAUDE_TRANSCRIPT_COMMANDS
 * (Claude Code 2.1.267): `/fork` acts and answers in the transcript, so no
 * overlay follows a submitted `/fork`.
 */
describe('forking a Claude Code session', () => {
  it('is the literal slash command', () => {
    expect(CLAUDE_FORK_COMMAND_TEXT).toBe('/fork')
  })

  // A `/fork` typed mid-turn lands in the queue instead of running now, and a
  // permission/question prompt reads typed text as its own answer — so the
  // button only appears once the pane is genuinely idle.
  it.each([
    ['claude, idle', { agent: 'claude', status: 'done' }, true],
    ['claude, working', { agent: 'claude', status: 'working' }, false],
    ['claude, blocked on a prompt', { agent: 'claude', status: 'blocked' }, false],
    ['claude, waiting on a prompt', { agent: 'claude', status: 'waiting' }, false],
    ['codex has no /fork', { agent: 'codex', status: 'done' }, false],
    ['no agent', { agent: null, status: 'done' }, false]
  ])('offers it for %s: %s', (_label, state, expected) => {
    expect(canForkClaudeSession(state)).toBe(expected)
  })

  it('writes /fork and submits it with Enter', async () => {
    const calls: unknown[] = []
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params })
        return { ok: true, result: { send: { accepted: true } } }
      })
    } as unknown as RpcClient
    expect(await forkClaudeSession({ client, terminal: 'term-1', deviceToken: 'dev-1' })).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'terminal.send',
      params: { terminal: 'term-1', text: CLAUDE_FORK_COMMAND_TEXT, enter: true }
    })
  })

  // Failure path: the button runs from a tap handler with nowhere for a
  // rejection to go.
  it('reports failure rather than throwing when the host refuses', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    } as unknown as RpcClient
    await expect(forkClaudeSession({ client, terminal: 'term-1', deviceToken: null })).resolves.toBe(
      false
    )
  })

  it('does not write over a link that is down', async () => {
    const send = vi.fn()
    const client = { getState: () => 'connecting', sendRequest: send } as unknown as RpcClient
    expect(await forkClaudeSession({ client, terminal: 'term-1', deviceToken: null })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
