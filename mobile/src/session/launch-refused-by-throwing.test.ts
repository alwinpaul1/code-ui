import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { createMobileStructuredAgentSession } from './mobile-structured-agent-session-launch'

// Found by sweeping after the review of the #23674 port: the chat launch read a thrown refusal the
// way the chat writes did before 54f73304f. A 1.4.219+ host throws an agent-session refusal as an
// RPC error whose message is the bare code and whose refusal rides in `error.data`
// (`agentSessionRefusalErrorResponse`, src/main/runtime/rpc/errors.ts at v1.4.220), so a launch the
// host refused that way said "agent_session_journal_unreadable".
function clientReturning(...responses: unknown[]): RpcClient {
  let next = 0
  const sendRequest = vi.fn(async () => responses[next++])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch reaches only `sendRequest`.
  return { sendRequest } as unknown as RpcClient
}

function thrownRefusal(code: string, reason?: string) {
  return {
    ok: false,
    error: {
      code: 'runtime_error',
      message: code,
      data: { refusal: { code, ...(reason ? { details: { reason } } : {}) } }
    }
  }
}

const supported = { ok: true, result: { supported: true } }

describe('a chat launch the host refuses by throwing', () => {
  it('reads as unconfirmed in its own words, never the bare code, when the refusal proves nothing', async () => {
    const result = await createMobileStructuredAgentSession(
      clientReturning(supported, thrownRefusal('agent_session_journal_unreadable', 'journalCorrupt')),
      'workspace-1',
      'codex'
    )
    expect(result).toEqual({
      kind: 'unknown',
      message: 'The Codex chat result could not be confirmed.'
    })
  })

  it('fails, as a returned refusal of the same code does, when the refusal proves nothing was created', async () => {
    const result = await createMobileStructuredAgentSession(
      clientReturning(supported, thrownRefusal('structured_agent_session_unsupported', 'hostDisabled')),
      'workspace-1',
      'codex'
    )
    expect(result).toEqual({ kind: 'failed', message: 'Could not open Codex chat.' })
  })

  it('keeps an RPC error with no refusal as before', async () => {
    const result = await createMobileStructuredAgentSession(
      clientReturning(supported, { ok: false, error: { code: 'method_not_found', message: 'Unknown method' } }),
      'workspace-1',
      'codex'
    )
    expect(result).toEqual({ kind: 'failed', message: 'Unknown method' })
  })
})
