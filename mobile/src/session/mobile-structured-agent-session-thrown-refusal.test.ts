import { describe, expect, it } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  agentSessionReadFailureText,
  callAgentSession,
  requestStructuredAgentSessionMutation
} from './mobile-structured-agent-session-rpc'

// Orca #23674 (afa81dc3ad), with #22999 and #23116 under it: a refusal is worded from its typed
// data through the shared notice table, never from the host's message. A refusal the host THROWS
// reaches the phone as `runtime_error` whose message is the bare code and whose reason rides in
// `error.data`, as `mapRuntimeError` sends it (pinned upstream in `src/main/runtime/rpc/errors.test.ts`
// at v1.4.220). Before this the phone printed that bare code under a chat whose history would not
// open, and called a Stop the host had refused "unconfirmed".
const THROWN_JOURNAL_REFUSAL = {
  code: 'runtime_error',
  message: 'agent_session_journal_unreadable',
  data: {
    refusal: {
      code: 'agent_session_journal_unreadable',
      details: { reason: 'journalCorrupt' }
    }
  }
}

function refusingClient(): RpcClient {
  const sendRequest = async () => ({ id: 'req-1', ok: false, error: THROWN_JOURNAL_REFUSAL })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the paths under test reach only `sendRequest`.
  return { sendRequest } as unknown as RpcClient
}

describe('a refusal the host threw', () => {
  it("reads a chat's history failure in the refusal's words, from a stream or a request", async () => {
    const words = 'Unable to load this chat.'
    // The stream's error frame, as the RPC client hands it over (rpc-client-stream-registry.ts).
    expect(
      agentSessionReadFailureText({
        type: 'error',
        message: THROWN_JOURNAL_REFUSAL.message,
        error: THROWN_JOURNAL_REFUSAL
      })
    ).toBe(words)
    const thrown = await callAgentSession(refusingClient(), 'agentSession.history', {}).catch(
      (error: unknown) => error
    )
    expect(agentSessionReadFailureText(thrown)).toBe(words)
    // A failure that carries no refusal keeps its own text.
    expect(agentSessionReadFailureText({ type: 'error', message: 'Connection interrupted' })).toBe(
      'Connection interrupted'
    )
  })

  // Upstream's phone calls this `failed`; this one reads a thrown refusal exactly as a returned
  // one (`refused`), so its operation id follows its code as a returned refusal's does
  // (thrown-refusal-reads-as-returned.test.tsx).
  it("refuses a Stop with the refusal's words, not as unconfirmed", async () => {
    const result = await requestStructuredAgentSessionMutation({
      client: refusingClient(),
      method: 'agentSession.cancel',
      fingerprintMethod: 'agentSession.cancel',
      sessionId: 'session-1',
      expectedRuntimeFence: 3,
      fields: { turnId: 'turn-1' },
      clientOperationId: `1900000000000-${'c'.repeat(32)}`
    })

    expect(result).toMatchObject({
      status: 'refused',
      code: 'agent_session_journal_unreadable',
      message: "Unable to load this chat. The agent wasn't stopped."
    })
  })
})

describe('a write refused on a journal a newer Orca wrote', () => {
  // As a v1.4.220 host answers it (pinned upstream in `journal-open-failure.test.ts`).
  const newerOrcaClient = (): RpcClient => {
    const sendRequest = async () => ({
      id: 'req-1',
      ok: true,
      result: {
        ok: false,
        refusal: {
          code: 'agent_session_journal_unreadable',
          message: 'Chats were saved by a newer Orca. Update Orca to keep using them.',
          details: { reason: 'journalWrittenByNewerOrca' }
        }
      }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the paths under test reach only `sendRequest`.
    return { sendRequest } as unknown as RpcClient
  }

  it.each([
    [
      'agentSession.send',
      { body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'hello' }] } },
      'Chats were saved by a newer Orca. Your message was not sent. Update Orca to keep using them.'
    ],
    [
      'agentSession.cancel',
      { turnId: 'turn-1' },
      "Chats were saved by a newer Orca. The agent wasn't stopped. Update Orca to keep using them."
    ]
  ] as const)('says to update Orca for %s', async (method, fields, message) => {
    const result = await requestStructuredAgentSessionMutation({
      client: newerOrcaClient(),
      method,
      fingerprintMethod: method,
      sessionId: 'session-1',
      expectedRuntimeFence: 3,
      fields,
      clientOperationId: `1900000000000-${'d'.repeat(32)}`
    })

    expect(result).toMatchObject({
      status: 'refused',
      code: 'agent_session_journal_unreadable',
      message
    })
  })

  it("never shows a host's log-only refusal text: a replayed refusal names an operation id", async () => {
    // agent-session-refusal-notice.ts: "A replayed refusal, for one, says `Operation <id> was
    // already refused: <code>.` because the ledger stores no message" (Orca #22999).
    const sendRequest = async () => ({
      id: 'req-1',
      ok: true,
      result: {
        ok: false,
        refusal: {
          code: 'agent_session_operation_conflict',
          message: `Operation 1900000000000-${'e'.repeat(32)} was already refused: agent_session_operation_conflict.`
        }
      }
    })
    const result = await requestStructuredAgentSessionMutation({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path under test reaches only `sendRequest`.
      client: { sendRequest } as unknown as RpcClient,
      method: 'agentSession.setOption',
      fingerprintMethod: 'agentSession.setOption',
      sessionId: 'session-1',
      expectedRuntimeFence: 3,
      fields: { optionId: 'model', value: 'gpt-fast' }
    })

    expect(result).toMatchObject({ status: 'refused', message: "The setting wasn't changed." })
  })
})
