import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../../transport/rpc-client'
import { MCP_STATUS_COMMAND_TEXT, canShowMcpStatusOverlay, openMcpStatusOverlay } from './mcp-status-overlay'

describe('the "Show status in terminal" MCP button', () => {
  it('is the literal /mcp slash command', () => {
    expect(MCP_STATUS_COMMAND_TEXT).toBe('/mcp')
  })

  it.each([
    ['claude, idle, TUI lane', { agent: 'claude', status: 'done', structured: false }, true],
    ['claude, working', { agent: 'claude', status: 'working', structured: false }, false],
    ['claude, blocked on a prompt', { agent: 'claude', status: 'blocked', structured: false }, false],
    ['claude, waiting on a prompt', { agent: 'claude', status: 'waiting', structured: false }, false],
    ['claude, idle, but the SDK lane has no terminal', { agent: 'claude', status: 'done', structured: true }, false],
    ['codex has no /mcp overlay here', { agent: 'codex', status: 'done', structured: false }, false],
    ['no agent', { agent: null, status: 'done', structured: false }, false]
  ])('offers it for %s: %s', (_label, state, expected) => {
    expect(canShowMcpStatusOverlay(state)).toBe(expected)
  })

  it('types /mcp and submits it with Enter', async () => {
    const calls: unknown[] = []
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params })
        return { ok: true, result: { send: { accepted: true } } }
      })
    } as unknown as RpcClient
    expect(
      await openMcpStatusOverlay({ client, terminal: 'term-1', deviceToken: 'dev-1' })
    ).toBe(true)
    expect(calls).toEqual([
      {
        method: 'terminal.send',
        params: { terminal: 'term-1', text: '/mcp', enter: true, client: { id: 'dev-1', type: 'mobile' } }
      }
    ])
  })

  it('reports failure rather than throwing when the host refuses', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    } as unknown as RpcClient
    await expect(
      openMcpStatusOverlay({ client, terminal: 'term-1', deviceToken: null })
    ).resolves.toBe(false)
  })

  it('does not write over a link that is down', async () => {
    const send = vi.fn()
    const client = { getState: () => 'connecting', sendRequest: send } as unknown as RpcClient
    expect(await openMcpStatusOverlay({ client, terminal: 'term-1', deviceToken: null })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
