import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { dispatchStructuredTurnCancel } from './mobile-structured-agent-cancel'

/** Upstream #20868 ("retire a structured operation id the host has refused")
 *  fixed a Stop that stayed unusable: a cancel the host answered with
 *  `agent_session_operation_unknown` kept its retained operation id, so every
 *  later Stop was admitted as the SAME request and did nothing.
 *
 *  When this test was written the fork routed that refusal to `refused`, so
 *  the defect could not reach it. Orca #20133 (ported 2026-09-19) maps a
 *  cancel's `agent_session_operation_unknown` to `unknown`, exactly as
 *  upstream did when it shipped the bug — this test went red on that port
 *  and #20868's `hostReportedOperationUnknown` was folded in with it. Driven
 *  through the real dispatcher, not by reading the diff. */
function hostRefusesOperationAsUnknown(): RpcClient {
  const sendRequest = vi.fn(async () => ({
    ok: true,
    result: {
      ok: false,
      refusal: {
        code: 'agent_session_operation_unknown',
        message: 'The outcome of that operation is unknown; it was not run again.'
      }
    },
    _meta: { runtimeId: 'runtime-1' }
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path under test reaches only sendRequest.
  return { sendRequest } as unknown as RpcClient
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a Stop the host refused as an unknown operation', () => {
  it('retires the operation id, so the next Stop is a new request and not a replay', async () => {
    const operationIds = new Map<string, string>()
    const onError = vi.fn()
    dispatchStructuredTurnCancel({
      client: hostRefusesOperationAsUnknown(),
      sessionId: 'session-1',
      fence: 3,
      turnId: 'turn-1',
      sessionKey: 'key-1',
      operationIds,
      onError
    })
    await settle()
    // If the id survives, every later Stop replays this refused one and the
    // button is dead — the exact symptom upstream's #20868 describes.
    expect(operationIds.size).toBe(0)
  })

  /** The other half of upstream's reasoning: transport doubt proves nothing
   *  about delivery, so THAT id must be kept for a genuine replay. */
  it('keeps the id when the send itself was never confirmed', async () => {
    const operationIds = new Map<string, string>()
    const client = {
      sendRequest: vi.fn(async () => {
        // A send whose ACK was lost: the host may well have run it, so the id
        // must survive for a genuine replay.
        throw markRpcDeliveryUnknown(new Error('Request not sent'))
      })
    } as unknown as RpcClient
    dispatchStructuredTurnCancel({
      client,
      sessionId: 'session-1',
      fence: 3,
      turnId: 'turn-1',
      sessionKey: 'key-1',
      operationIds,
      onError: vi.fn()
    })
    await settle()
    expect(operationIds.size).toBe(1)
  })
})
