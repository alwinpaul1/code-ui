import { describe, expect, it, vi } from 'vitest'
import { appendReturnedDraftText } from '../../../src/shared/returned-draft-text'
import type { RpcClient } from '../transport/rpc-client'
import { dispatchMobileStructuredCommand } from './mobile-structured-composer-command'

// Orca #25704 (4735ecefac), the half that is live without the host queue: a /clear or /compact
// the host refuses while the agent works reads one plain sentence, and a message handed back into
// a composer holding only that command replaces it. Before, the host's refusal read "The agent is
// still responding. This command didn't run. Wait for the agent to finish responding, or stop
// it.", and a refused send came back as "/compact\n\nmy message", which the next Send refused as
// a command with arguments.

/** A refusal as the host returns it (`result.ok: false`); `details.reason` is what it words. */
function hostRefuses(reason: 'turnActive' | 'messagesUnsettled' | 'promptPending') {
  return {
    ok: true,
    result: {
      ok: false,
      refusal: {
        code: 'agent_session_operation_invalid',
        message: 'agent_session_operation_invalid',
        details: { reason }
      }
    },
    _meta: { runtimeId: 'runtime-1' }
  }
}

function dispatch(text: string, response: unknown) {
  const sendRequest = vi.fn(async () => response)
  const onError = vi.fn()
  const outcome = dispatchMobileStructuredCommand({
    text,
    hasAttachments: false,
    client: { sendRequest } as unknown as RpcClient,
    sessionId: 'session',
    fence: 1,
    sessionKey: 'session:1',
    pending: { current: false },
    operationIds: new Map(),
    hostAnswersRepeats: true,
    controller: {
      agent: 'claude',
      snapshot: [],
      invokeAction: vi.fn(async () => true),
      setOption: vi.fn(async () => true),
      conversationCommands: ['clear', 'compact']
    },
    busy: () => null,
    onError,
    timeoutMs: 15_000
  })
  return { outcome, onError }
}

describe('a /clear or /compact the host refuses while the agent works', () => {
  it('says what the person sees and can do, whichever working reason the host names', async () => {
    for (const reason of ['turnActive', 'messagesUnsettled'] as const) {
      const clear = dispatch('/clear', hostRefuses(reason))
      expect(await clear.outcome).toBe('rejected')
      expect(clear.onError).toHaveBeenLastCalledWith(
        "The agent is still working. Run /clear when it's done.",
        undefined
      )
      const compact = dispatch('/compact', hostRefuses(reason))
      expect(await compact.outcome).toBe('rejected')
      expect(compact.onError).toHaveBeenLastCalledWith(
        "The agent is still working. Run /compact when it's done.",
        undefined
      )
    }
  })

  it('asks for the answer first when a question or approval waits', async () => {
    const clear = dispatch('/clear', hostRefuses('promptPending'))
    expect(await clear.outcome).toBe('rejected')
    expect(clear.onError).toHaveBeenLastCalledWith(
      "Answer the agent's question or approval, then run /clear.",
      undefined
    )
  })
})

describe('a refused message handed back into the composer', () => {
  it('takes the place of a lone /compact or /clear, which could not carry it', () => {
    expect(appendReturnedDraftText('/compact', 'my message')).toBe('my message')
    expect(appendReturnedDraftText(' /clear\n', 'my message')).toBe('my message')
  })

  it('keeps anything more than the bare command as the person typed it', () => {
    expect(appendReturnedDraftText('/compact now', 'my message')).toBe('/compact now\n\nmy message')
    expect(appendReturnedDraftText('/clearly', 'my message')).toBe('/clearly\n\nmy message')
    expect(appendReturnedDraftText('', 'my message')).toBe('my message')
  })
})
