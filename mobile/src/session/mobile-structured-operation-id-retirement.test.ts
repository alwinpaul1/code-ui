import { describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionState } from '../../../src/shared/structured-agent-session-reducer'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { requestMobileStructuredAgentSessionCancel } from './mobile-structured-agent-session-cancel'
import { requestStructuredAgentSessionMutation } from './mobile-structured-agent-session-rpc'

type SentParams = { envelope: { clientOperationId: string } }

function operationRefusedAsUnknown() {
  return {
    ok: true,
    result: {
      ok: false,
      refusal: {
        code: 'agent_session_operation_unknown',
        message: 'The outcome of operation X is unknown; it was not run again.'
      }
    },
    _meta: { runtimeId: 'runtime-1' }
  }
}

function fakeClient(
  sendRequest: (method: string, params: SentParams) => Promise<unknown>
): RpcClient {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: both paths under test reach only `sendRequest`.
  return { sendRequest } as unknown as RpcClient
}

function runningState(turnId = 'turn-1'): StructuredAgentSessionState {
  const state = {
    fence: 3,
    items: [
      {
        itemId: 'status-1',
        revision: 1,
        sequence: 1,
        observedAt: 10,
        body: {
          kind: 'status',
          text: 'Working',
          turnLifecycle: { turnId, state: 'running' }
        }
      }
    ]
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: cancel reads only the fence and the running turn.
  return state as unknown as StructuredAgentSessionState
}

function cancelArgs(client: RpcClient, inFlight = new Map<string, Promise<boolean>>()) {
  return {
    client,
    sessionId: 'session-1',
    enabled: true,
    stateRef: { current: runningState() },
    inFlight,
    promptCancelSupported: null,
    onSendError: vi.fn()
  }
}

describe('structured mutation id retirement', () => {
  it('marks a host answer about the id apart from doubt about the effect', async () => {
    const result = await requestStructuredAgentSessionMutation({
      client: fakeClient(async () => operationRefusedAsUnknown()),
      method: 'agentSession.cancel',
      fingerprintMethod: 'agentSession.cancel',
      sessionId: 'session-1',
      expectedRuntimeFence: 3,
      fields: { turnId: 'turn-1' },
      clientOperationId: `1900000000000-${'a'.repeat(32)}`
    })

    expect(result).toEqual({ status: 'unknown', hostReportedOperationUnknown: true })
  })

  it('leaves the id replayable when only the transport was in doubt', async () => {
    const result = await requestStructuredAgentSessionMutation({
      client: fakeClient(async () => {
        throw markRpcDeliveryUnknown(new Error('Connection closed'))
      }),
      method: 'agentSession.cancel',
      fingerprintMethod: 'agentSession.cancel',
      sessionId: 'session-1',
      expectedRuntimeFence: 3,
      fields: { turnId: 'turn-1' },
      clientOperationId: `1900000000000-${'b'.repeat(32)}`
    })

    expect(result).toEqual({ status: 'unknown' })
  })
})

describe('structured Stop: every press is its own Stop (Orca #24301)', () => {
  it('sends the next press under a fresh id after the host answered about the previous one', async () => {
    const sent: string[] = []
    const client = fakeClient(async (_method, params) => {
      sent.push(params.envelope.clientOperationId)
      return operationRefusedAsUnknown()
    })
    const inFlight = new Map<string, Promise<boolean>>()
    const args = cancelArgs(client, inFlight)

    await requestMobileStructuredAgentSessionCancel(args)
    await requestMobileStructuredAgentSessionCancel(args)

    expect(sent).toHaveLength(2)
    expect(sent[1]).not.toBe(sent[0])
    expect(inFlight.size).toBe(0)
  })

  // The symptom: the first Stop's answer was lost and the turn kept running, so the second press
  // replayed the first id and the host answered it from the ledger instead of stopping anything.
  it('sends the next press under a fresh id even when the first one never got an answer', async () => {
    const sent: string[] = []
    const client = fakeClient(async (_method, params) => {
      sent.push(params.envelope.clientOperationId)
      throw markRpcDeliveryUnknown(new Error('Connection closed'))
    })
    const args = cancelArgs(client)

    await requestMobileStructuredAgentSessionCancel(args)
    await requestMobileStructuredAgentSessionCancel(args)

    expect(sent).toHaveLength(2)
    expect(sent[1]).not.toBe(sent[0])
  })

  it('joins a second press while the first Stop is still on its way, then stops again after it settles', async () => {
    const sent: string[] = []
    let answer: (value: unknown) => void = () => undefined
    const client = fakeClient((_method, params) => {
      sent.push(params.envelope.clientOperationId)
      return new Promise((resolve) => {
        answer = resolve
      })
    })
    const args = cancelArgs(client)

    const first = requestMobileStructuredAgentSessionCancel(args)
    const second = requestMobileStructuredAgentSessionCancel(args)
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    answer({ ok: true, result: { ok: true, value: { turnId: 'turn-1' } }, _meta: { runtimeId: 'runtime-1' } })

    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(sent).toHaveLength(1)

    // Settled: the next press is a new Stop, with an id of its own.
    const third = requestMobileStructuredAgentSessionCancel(args)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    answer({ ok: true, result: { ok: true, value: { turnId: 'turn-1' } }, _meta: { runtimeId: 'runtime-1' } })
    await third
    expect(sent[1]).not.toBe(sent[0])
  })

  it('does not join a Stop of a different turn', async () => {
    const sent: string[] = []
    const client = fakeClient(async (_method, params) => {
      sent.push(params.envelope.clientOperationId)
      return operationRefusedAsUnknown()
    })
    const inFlight = new Map<string, Promise<boolean>>()
    const args = cancelArgs(client, inFlight)
    const other = { ...cancelArgs(client, inFlight), stateRef: { current: runningState('turn-2') } }

    await Promise.all([
      requestMobileStructuredAgentSessionCancel(args),
      requestMobileStructuredAgentSessionCancel(other)
    ])

    expect(sent).toHaveLength(2)
  })
})
