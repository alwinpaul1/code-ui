import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { lookupPendingPermission } from './permission-lookup'

const ESCAPE = String.fromCharCode(27)

function approval(tool: string, summary?: string): string {
  return JSON.stringify({ approval: { tool, ...(summary ? { summary } : {}) } })
}

type Reply = { ok: boolean; result?: unknown }

function makeClient(
  replies: { terminals?: Reply; status?: (handle: string) => Reply },
  state = 'connected'
) {
  const calls: { method: string; params: unknown }[] = []
  const client = {
    getState: () => state,
    sendRequest: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params })
      if (method === 'terminal.list') {
        return replies.terminals ?? { ok: true, result: { terminals: [] } }
      }
      const handle = (params as { terminal: string }).terminal
      return replies.status?.(handle) ?? { ok: true, result: {} }
    })
  } as unknown as RpcClient
  return { client, calls }
}

const TWO_TERMINALS: Reply = {
  ok: true,
  result: {
    terminals: [
      { handle: 'plain-shell' },
      { handle: 'agent-1', agentIdentity: 'claude' },
      { handle: 'agent-2', agentIdentity: 'claude' }
    ]
  }
}

/**
 * The notification event carries a title, a body and some ids — nothing about
 * what is being asked. The desktop HAS it (`agentToolName` and `agentToolInput`
 * are on NotificationDispatchRequest) and does not forward it, and the desktop
 * is stock Orca. So the phone has to go and ask, and it can: the notification
 * arrived over the link, so the link is up.
 */
describe('finding the permission a notification is about', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the prompt out of the agent terminal', async () => {
    const { client } = makeClient({
      terminals: TWO_TERMINALS,
      status: (handle) =>
        handle === 'agent-1'
          ? { ok: true, result: { agentStatus: { interactivePrompt: approval('Bash', 'Recompile page 2') } } }
          : { ok: true, result: { agentStatus: {} } }
    })
    expect(await lookupPendingPermission(client, 'wt-1')).toEqual({
      terminal: 'agent-1',
      permission: {
        title: 'Allow Bash?',
        detail: 'Recompile page 2',
        options: [
          { label: 'Allow', send: '1' },
          { label: 'Deny', send: ESCAPE }
        ]
      }
    })
  })

  it('asks only terminals the host says are running an agent', async () => {
    const { client, calls } = makeClient({ terminals: TWO_TERMINALS })
    await lookupPendingPermission(client, 'wt-1')
    const asked = calls.filter((c) => c.method === 'terminal.agentStatus').map((c) => c.params)
    expect(asked).toEqual([{ terminal: 'agent-1' }, { terminal: 'agent-2' }])
  })

  it('stops at the first terminal that is actually waiting', async () => {
    const { client, calls } = makeClient({
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { interactivePrompt: approval('Edit') } } })
    })
    await lookupPendingPermission(client, 'wt-1')
    expect(calls.filter((c) => c.method === 'terminal.agentStatus')).toHaveLength(1)
  })

  // A stale handle answers for a PTY that has gone, and the prompt it reports
  // belongs to nothing.
  it('asks the host to exclude dead PTYs', async () => {
    const { client, calls } = makeClient({ terminals: TWO_TERMINALS })
    await lookupPendingPermission(client, 'wt-1')
    expect(calls[0]).toEqual({
      method: 'terminal.list',
      params: { worktree: 'wt-1', requireFreshPtyLiveness: true }
    })
  })

  /**
   * Every failure path returns null and the caller keeps the desktop's own
   * notification. A decorated banner is an improvement, never a requirement —
   * a permission ask that never appeared because a lookup threw would be far
   * worse than the plain caption it replaces.
   */
  it.each([
    ['the host refuses the listing', { terminals: { ok: false } as Reply }],
    ['the listing is empty', { terminals: { ok: true, result: { terminals: [] } } as Reply }],
    ['no terminal is running an agent', { terminals: { ok: true, result: { terminals: [{ handle: 'sh' }] } } as Reply }],
    ['nothing is waiting', { terminals: TWO_TERMINALS }],
    ['the prompt is not an approval', {
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { interactivePrompt: '{"question":{}}' } } }) as Reply
    }],
    ['the prompt is malformed', {
      terminals: TWO_TERMINALS,
      status: () => ({ ok: true, result: { agentStatus: { interactivePrompt: '{not json' } } }) as Reply
    }]
  ])('returns nothing when %s', async (_label, replies) => {
    const { client } = makeClient(replies as Parameters<typeof makeClient>[0])
    expect(await lookupPendingPermission(client, 'wt-1')).toBeNull()
  })

  it('does not throw when the request rejects', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    } as unknown as RpcClient
    await expect(lookupPendingPermission(client, 'wt-1')).resolves.toBeNull()
  })

  it('does not dial a host that is not connected', async () => {
    const { client, calls } = makeClient({ terminals: TWO_TERMINALS }, 'connecting')
    expect(await lookupPendingPermission(client, 'wt-1')).toBeNull()
    expect(calls).toEqual([])
  })

  // Degenerate: a worktree with more agents than is worth waiting on.
  it('does not fan out over every agent in a busy worktree', async () => {
    const many = {
      ok: true,
      result: {
        terminals: Array.from({ length: 9 }, (_, i) => ({
          handle: `agent-${i}`,
          agentIdentity: 'claude'
        }))
      }
    }
    const { client, calls } = makeClient({ terminals: many })
    await lookupPendingPermission(client, 'wt-1')
    expect(calls.filter((c) => c.method === 'terminal.agentStatus')).toHaveLength(4)
  })
})
