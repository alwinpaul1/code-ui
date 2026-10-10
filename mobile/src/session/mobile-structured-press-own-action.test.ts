import { describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { requestMobileStructuredAgentSessionCancel } from './mobile-structured-agent-session-cancel'
import { dispatchMobileStructuredCommand } from './mobile-structured-composer-command'
import { dispatchStructuredRewind } from './mobile-structured-agent-rewind'

// Orca #24301 (7176648759): every chat action press is its own action. A client that kept an id
// per payload replayed the last press instead of running a new one, and the host answered the
// replay from its ledger, so a second /clear, /compact, rewind or Stop after a lost answer did
// nothing. The host half (answer a repeated /clear from its committed record, a repeated Stop
// quietly) is in #24301 itself, so only a 1.4.220 host has it; the one capability that comes with
// it is `agent-session.repeated-stop.v1`. Against such a host every press gets a fresh id; against
// an older one, or before the status probe answers, the phone keeps replaying the id it kept, so
// the retry learns the true outcome instead of running a /clear twice.

type SentParams = { envelope: { clientOperationId: string } }

function idsOf(sendRequest: ReturnType<typeof vi.fn>): string[] {
  return sendRequest.mock.calls.map((call) => (call[1] as SentParams).envelope.clientOperationId)
}

function lostAnswer(): never {
  throw markRpcDeliveryUnknown(new Error('Connection closed'))
}

function commandInput(
  sendRequest: (method: string, params: unknown, options: unknown) => Promise<unknown>,
  hostAnswersRepeats: boolean | null
): Parameters<typeof dispatchMobileStructuredCommand>[0] {
  return {
    text: '/clear',
    hasAttachments: false,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path under test reaches only `sendRequest`.
    client: { sendRequest } as unknown as RpcClient,
    sessionId: 'session',
    fence: 1,
    sessionKey: 'session:1',
    pending: { current: false },
    operationIds: new Map(),
    hostAnswersRepeats,
    controller: {
      agent: 'codex',
      snapshot: [],
      invokeAction: vi.fn(async () => true),
      setOption: vi.fn(async () => true),
      conversationCommands: ['clear', 'compact']
    },
    busy: () => null,
    onError: vi.fn(),
    timeoutMs: 15000
  }
}

const clearCompleted = {
  ok: true,
  result: { ok: true, value: { command: 'clear', state: 'completed' } }
}

describe('a /clear pressed again after its answer was lost', () => {
  it('is a /clear of its own against a host that answers a repeat from its record', async () => {
    const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) =>
      clearCompleted
    )
    sendRequest.mockImplementationOnce(async () => lostAnswer())
    const input = commandInput(sendRequest, true)

    expect(await dispatchMobileStructuredCommand(input)).toBe('unknown')
    expect(await dispatchMobileStructuredCommand(input)).toBe('accepted')

    const [first, second] = idsOf(sendRequest)
    expect(second).not.toBe(first)
    expect(input.operationIds.size).toBe(0)
  })

  it.each([
    ['an older host', false],
    ['a host the status probe has not answered for', null]
  ] as const)('replays the same /clear against %s', async (_label, hostAnswersRepeats) => {
    const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) =>
      clearCompleted
    )
    sendRequest.mockImplementationOnce(async () => lostAnswer())
    const input = commandInput(sendRequest, hostAnswersRepeats)

    expect(await dispatchMobileStructuredCommand(input)).toBe('unknown')
    expect(await dispatchMobileStructuredCommand(input)).toBe('accepted')

    const [first, second] = idsOf(sendRequest)
    expect(second).toBe(first)
  })
})

function conversation(): AgentJournalRenderItem[] {
  return ['user-1', 'assistant-1', 'user-2', 'assistant-2'].map((itemId, index) => ({
    itemId,
    revision: 1,
    sequence: index + 1,
    observedAt: (index + 1) * 10,
    body: {
      kind: 'message',
      role: itemId.startsWith('user') ? 'user' : 'assistant',
      blocks: [{ type: 'text', text: itemId }]
    }
  }))
}

const rewound = {
  ok: true,
  result: {
    ok: true,
    replayed: false,
    fence: 3,
    cursor: { epoch: 'epoch-2', sequence: 0 },
    value: { itemId: 'user-2', epoch: 'epoch-2' }
  },
  _meta: { runtimeId: 'runtime-1' }
}

function rewindArgs(
  sendRequest: (method: string, params: unknown, options: unknown) => Promise<unknown>,
  hostAnswersRepeats: boolean | null
): Parameters<typeof dispatchStructuredRewind>[0] {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path under test reaches only sendRequest, and getState when it refuses.
    client: { sendRequest, getState: () => 'connected' } as unknown as RpcClient,
    sessionId: 'session-1',
    enabled: true,
    sessionKey: 'key-1',
    itemId: 'user-2',
    state: { fence: 3, epoch: 'epoch-1', items: conversation() },
    operationIds: new Map(),
    hostAnswersRepeats
  }
}

describe('a rewind pressed again after its answer was lost', () => {
  it('is a rewind of its own against a host that answers a repeat from its record', async () => {
    const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) => rewound)
    sendRequest.mockImplementationOnce(async () => lostAnswer())
    const args = rewindArgs(sendRequest, true)

    expect((await dispatchStructuredRewind(args)).status).toBe('unknown')
    expect((await dispatchStructuredRewind(args)).status).toBe('accepted')

    const [first, second] = idsOf(sendRequest)
    expect(second).not.toBe(first)
    expect(args.operationIds.size).toBe(0)
  })

  it('replays the same rewind against an older host', async () => {
    const sendRequest = vi.fn(async (_method: string, _params: unknown, _options: unknown) => rewound)
    sendRequest.mockImplementationOnce(async () => lostAnswer())
    const args = rewindArgs(sendRequest, false)

    expect((await dispatchStructuredRewind(args)).status).toBe('unknown')
    expect((await dispatchStructuredRewind(args)).status).toBe('accepted')

    const [first, second] = idsOf(sendRequest)
    expect(second).toBe(first)
  })
})

function runningState(): StructuredAgentSessionState {
  const state = {
    fence: 3,
    items: [
      {
        itemId: 'status-1',
        revision: 1,
        sequence: 1,
        observedAt: 10,
        body: { kind: 'status', text: 'Working', turnLifecycle: { turnId: 'turn-1', state: 'running' } }
      }
    ]
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: cancel reads only the fence and the running turn.
  return state as unknown as StructuredAgentSessionState
}

describe('a Stop pressed while an earlier Stop is still on its way', () => {
  function stuckClient() {
    const sendRequest = vi.fn(
      (_method: string, _params: unknown, _options: unknown) => new Promise<unknown>(() => {})
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: cancel reaches only `sendRequest`.
    return { sendRequest, client: { sendRequest } as unknown as RpcClient }
  }

  function stopArgs(client: RpcClient, hostAnswersRepeatedStops: boolean | null) {
    return {
      client,
      sessionId: 'session-1',
      enabled: true,
      stateRef: { current: runningState() },
      inFlight: new Map<string, Promise<boolean>>(),
      promptCancelSupported: null,
      hostAnswersRepeatedStops,
      onSendError: vi.fn()
    }
  }

  it('sends a Stop of its own against a host that answers a repeated Stop quietly', async () => {
    const { sendRequest, client } = stuckClient()
    const args = stopArgs(client, true)

    void requestMobileStructuredAgentSessionCancel(args)
    void requestMobileStructuredAgentSessionCancel(args)

    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(2))
    const [first, second] = idsOf(sendRequest)
    expect(second).not.toBe(first)
    expect(args.inFlight.size).toBe(0)
  })

  it('joins the Stop on its way against an older host, which would write a false row for the second', async () => {
    const { sendRequest, client } = stuckClient()
    const args = stopArgs(client, false)

    void requestMobileStructuredAgentSessionCancel(args)
    void requestMobileStructuredAgentSessionCancel(args)

    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
})
