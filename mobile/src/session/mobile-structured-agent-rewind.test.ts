import { describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  countMessagesDroppedByRewind,
  dispatchStructuredRewind,
  parseStructuredRewindSupport,
  rewindConfirmCopy
} from './mobile-structured-agent-rewind'

/** The refusal body Orca's host builds in `structured-rewind-refusal.ts`
 *  (origin/main, ce4a3a418 #19235): the reason rides the message as
 *  `agent_session_rewind:<reason>`, and `outcome-unknown` alone maps to the
 *  unknown-operation code. Verified against Orca 1.4.205's bundle, which
 *  carries those exact strings. */
function hostRefuses(reason: string) {
  return {
    ok: true,
    result: {
      ok: false,
      refusal: {
        code:
          reason === 'outcome-unknown'
            ? 'agent_session_operation_unknown'
            : 'agent_session_operation_invalid',
        message: `agent_session_rewind:${reason}`,
        rewindReason: reason
      }
    },
    _meta: { runtimeId: 'runtime-1' }
  }
}

function hostAccepts(epoch = 'epoch-2') {
  return {
    ok: true,
    result: {
      ok: true,
      replayed: false,
      fence: 3,
      cursor: { epoch, sequence: 0 },
      value: { itemId: 'user-2', epoch }
    },
    _meta: { runtimeId: 'runtime-1' }
  }
}

function userItem(itemId: string, sequence: number, text: string): AgentJournalRenderItem {
  return {
    itemId,
    revision: 1,
    sequence,
    observedAt: sequence * 10,
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
  }
}

function assistantItem(itemId: string, sequence: number, text: string): AgentJournalRenderItem {
  return {
    itemId,
    revision: 1,
    sequence,
    observedAt: sequence * 10,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
  }
}

function runningTurn(sequence: number): AgentJournalRenderItem {
  return {
    itemId: `status-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence * 10,
    body: { kind: 'status', text: 'Working', turnLifecycle: { turnId: 'turn-1', state: 'running' } }
  }
}

function pendingApproval(sequence: number): AgentJournalRenderItem {
  return {
    itemId: `approval-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence * 10,
    body: {
      kind: 'approval',
      title: 'Allow Bash?',
      detail: 'rm -rf build',
      options: [{ id: 'allow', label: 'Allow' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    }
  }
}

function conversation(): AgentJournalRenderItem[] {
  return [
    userItem('user-1', 1, 'first'),
    assistantItem('assistant-1', 2, 'reply one'),
    userItem('user-2', 3, 'second'),
    assistantItem('assistant-2', 4, 'reply two')
  ]
}

function setup(reply: unknown = hostAccepts()) {
  const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) => reply)
  const operationIds = new Map<string, string>()
  const args: Parameters<typeof dispatchStructuredRewind>[0] = {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path under test reaches only sendRequest.
    client: { sendRequest } as unknown as RpcClient,
    sessionId: 'session-1',
    enabled: true,
    sessionKey: 'key-1',
    itemId: 'user-2',
    state: { fence: 3, epoch: 'epoch-1', items: conversation() },
    operationIds
  }
  return { args, sendRequest, operationIds }
}

describe('what the host says about rewinding this session', () => {
  it('reads a host that offers rewind', () => {
    expect(
      parseStructuredRewindSupport({ models: [], current: { model: 'x' }, rewind: { supported: true } })
    ).toEqual({ supported: true })
  })

  it('reads a host that declines, keeping its reason', () => {
    expect(
      parseStructuredRewindSupport({
        models: [],
        current: { model: 'x' },
        rewind: { supported: false, reason: 'history-not-paginated' }
      })
    ).toEqual({ supported: false, reason: 'history-not-paginated' })
  })

  it('treats a host that predates the field as offering nothing, not as offering rewind', () => {
    expect(parseStructuredRewindSupport({ models: [], current: { model: 'x' } })).toBeNull()
  })

  it.each([
    ['a bare string', 'yes'],
    ['a string flag', { supported: 'true' }],
    ['a decline without a reason', { supported: false }],
    ['null', null]
  ])('refuses to guess from %s', (_label, rewind) => {
    expect(parseStructuredRewindSupport({ models: [], current: { model: 'x' }, rewind })).toBeNull()
  })
})

describe('rewinding the conversation to an earlier message', () => {
  it('asks the host to rewind to that item under the epoch and fence the phone holds', async () => {
    const { args, sendRequest, operationIds } = setup()
    await expect(dispatchStructuredRewind(args)).resolves.toEqual({
      status: 'accepted',
      epoch: 'epoch-2'
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'agentSession.rewind',
      expect.objectContaining({
        itemId: 'user-2',
        expectedEpoch: 'epoch-1',
        envelope: expect.objectContaining({ sessionId: 'session-1', expectedRuntimeFence: 3 })
      }),
      expect.anything()
    )
    // The rewind kills and resumes the provider child; 15 s is the ordinary
    // send budget and a Claude respawn does not fit in it.
    const options = sendRequest.mock.calls[0]?.[2] as { timeoutMs?: number } | undefined
    expect(options?.timeoutMs).toEqual(expect.any(Number))
    expect(options?.timeoutMs ?? 0).toBeGreaterThan(15_000)
    expect(operationIds.size).toBe(0)
  })

  it('says the session moved on when the host refuses a stale epoch, and never pretends it rewound', async () => {
    const { args, operationIds } = setup(hostRefuses('stale-epoch'))
    await expect(dispatchStructuredRewind(args)).resolves.toEqual({
      status: 'rejected',
      message: 'The session moved on. Reload the chat and try again.'
    })
    // A refused id is retired so the retry, after the reload, is a new request.
    expect(operationIds.size).toBe(0)
  })

  it.each([
    ['busy', 'The agent is still working. Wait for it to finish, then try again.'],
    ['invalid-target', 'This message cannot be rewound to.'],
    ['unsupported', 'Rewind is not available for this session.'],
    ['history-not-paginated', 'Rewind is not available for this session.'],
    ['history-limit', 'There is too much history to rewind here.'],
    ['provider-refused', 'The agent refused the rewind. Nothing was changed.'],
    ['proof-mismatch', 'The desktop transcript did not match. Nothing was changed.']
  ])('turns the %s refusal into words a reader can act on', async (reason, message) => {
    const { args } = setup(hostRefuses(reason))
    await expect(dispatchStructuredRewind(args)).resolves.toEqual({ status: 'rejected', message })
  })

  it('passes an unfamiliar refusal through verbatim rather than inventing a reason', async () => {
    const { args } = setup({
      ok: true,
      result: {
        ok: false,
        refusal: { code: 'agent_session_checkpoint_stale', message: 'Runtime fence 3 is stale.' }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    await expect(dispatchStructuredRewind(args)).resolves.toEqual({
      status: 'rejected',
      message: 'Runtime fence 3 is stale.'
    })
  })

  it('keeps the operation id when the outcome is unknown, so a retry replays it instead of rewinding twice', async () => {
    const { args, sendRequest, operationIds } = setup(hostRefuses('outcome-unknown'))
    await expect(dispatchStructuredRewind(args)).resolves.toEqual({
      status: 'unknown',
      message: 'Rewind unconfirmed. Check the chat before trying again.'
    })
    expect(operationIds.size).toBe(1)
    sendRequest.mockResolvedValueOnce(hostAccepts())
    await expect(dispatchStructuredRewind(args)).resolves.toEqual({
      status: 'accepted',
      epoch: 'epoch-2'
    })
    expect(sendRequest.mock.calls[0]?.[1]).toEqual(sendRequest.mock.calls[1]?.[1])
  })

  it('treats a lost acknowledgement the same way', async () => {
    const { args, operationIds } = setup()
    const client = {
      sendRequest: vi.fn(async () => {
        throw markRpcDeliveryUnknown(new Error('Request not sent'))
      })
    } as unknown as RpcClient
    await expect(dispatchStructuredRewind({ ...args, client })).resolves.toEqual({
      status: 'unknown',
      message: 'Rewind unconfirmed. Check the chat before trying again.'
    })
    expect(operationIds.size).toBe(1)
  })

  it('reports a request that never left the phone as not sent', async () => {
    const { args } = setup()
    const client = {
      sendRequest: vi.fn(async () => {
        throw new Error('Request not sent')
      })
    } as unknown as RpcClient
    await expect(dispatchStructuredRewind({ ...args, client })).resolves.toEqual({
      status: 'rejected',
      message: 'Rewind not sent'
    })
  })

  it.each([
    ['no client', { client: null }],
    ['no session', { sessionId: null }],
    ['a disabled lane', { enabled: false }],
    ['no fence yet', { state: { fence: null, epoch: 'epoch-1', items: conversation() } }],
    ['no epoch yet', { state: { fence: 3, epoch: null, items: conversation() } }]
  ])('refuses locally with %s, without a round trip', async (_label, override) => {
    const { args, sendRequest } = setup()
    await expect(dispatchStructuredRewind({ ...args, ...override })).resolves.toEqual({
      status: 'rejected',
      message: 'Rewind not sent (disconnected)'
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('refuses locally while a turn is running, without a round trip', async () => {
    const { args, sendRequest } = setup()
    const items = [...conversation(), runningTurn(5)]
    await expect(
      dispatchStructuredRewind({ ...args, state: { ...args.state, items } })
    ).resolves.toEqual({
      status: 'rejected',
      message: 'The agent is still working. Wait for it to finish, then try again.'
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('refuses locally while a permission is waiting on an answer', async () => {
    const { args, sendRequest } = setup()
    const items = [...conversation(), pendingApproval(5)]
    await expect(
      dispatchStructuredRewind({ ...args, state: { ...args.state, items } })
    ).resolves.toEqual({
      status: 'rejected',
      message: 'The agent is still working. Wait for it to finish, then try again.'
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['an assistant reply', 'assistant-2'],
    ['an id the transcript no longer holds', 'user-9']
  ])('refuses %s as a target, without a round trip', async (_label, itemId) => {
    const { args, sendRequest } = setup()
    await expect(dispatchStructuredRewind({ ...args, itemId })).resolves.toEqual({
      status: 'rejected',
      message: 'This message cannot be rewound to.'
    })
    expect(sendRequest).not.toHaveBeenCalled()
  })
})

describe('how many messages a rewind drops', () => {
  const user = (id: string) => ({
    id,
    role: 'user' as const,
    blocks: [{ type: 'text' as const, text: id }],
    timestamp: null,
    source: 'transcript' as const
  })
  const assistant = (id: string) => ({ ...user(id), role: 'assistant' as const })
  const notice = (id: string) => ({ ...user(id), role: 'system' as const })

  it('counts the tapped message and everything after it', () => {
    const folded = [user('u1'), assistant('a1'), user('u2'), assistant('a2'), user('u3'), assistant('a3')]
    expect(countMessagesDroppedByRewind(folded, 'u2')).toBe(4)
  })

  it('rewinding to the last message drops it and the reply after it', () => {
    const folded = [user('u1'), assistant('a1'), user('u2'), assistant('a2')]
    expect(countMessagesDroppedByRewind(folded, 'u2')).toBe(2)
  })

  it('rewinding to a message the agent has not answered drops only that message', () => {
    expect(countMessagesDroppedByRewind([user('u1'), assistant('a1'), user('u2')], 'u2')).toBe(1)
  })

  it('rewinding to the first message drops the whole conversation', () => {
    const folded = [user('u1'), assistant('a1'), user('u2'), assistant('a2')]
    expect(countMessagesDroppedByRewind(folded, 'u1')).toBe(4)
  })

  it('a one-message session drops one', () => {
    expect(countMessagesDroppedByRewind([user('u1')], 'u1')).toBe(1)
  })

  it('does not count host notices as messages', () => {
    expect(countMessagesDroppedByRewind([user('u1'), notice('n1'), assistant('a1')], 'u1')).toBe(2)
  })

  it.each([
    ['an empty transcript', []],
    ['a message the list does not hold', [user('u1'), assistant('a1')]]
  ])('says it cannot know for %s', (_label, folded) => {
    expect(countMessagesDroppedByRewind(folded, 'u9')).toBeNull()
  })
})

describe('the confirm sheet copy', () => {
  it('names the count', () => {
    expect(rewindConfirmCopy(4).message).toMatch(/^Drops 4 messages/)
    expect(rewindConfirmCopy(1).message).toMatch(/^Drops 1 message /)
  })

  it('says "later messages" rather than inventing a number', () => {
    expect(rewindConfirmCopy(null).message).toMatch(/^Drops this message and the later messages/)
    expect(rewindConfirmCopy(null).message).not.toMatch(/\d/)
  })

  it.each([4, 1, null])('says in plain words that files stay as they are (%s)', (count) => {
    const { title, message } = rewindConfirmCopy(count)
    expect(title).toBe('Rewind to this message?')
    expect(message).toContain('Conversation only; files stay as they are.')
    expect(message).toContain('To restore files too, use /rewind in the terminal.')
    expect(message).not.toMatch(/files? (are|were|will be) restored/i)
  })
})
