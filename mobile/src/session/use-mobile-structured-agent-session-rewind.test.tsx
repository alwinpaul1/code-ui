// Rewind at the seam that runs it: the epoch the subscription delivered is the
// one the request carries, and the reset the host publishes afterwards is what
// truncates the chat. Its sibling files cover the rest of this hook; the split
// keeps each under the line cap.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

const FENCE = 3

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

function conversation(): AgentJournalRenderItem[] {
  return [
    userItem('user-1', 1, 'first'),
    assistantItem('assistant-1', 2, 'reply one'),
    userItem('user-2', 3, 'second'),
    assistantItem('assistant-2', 4, 'reply two')
  ]
}

function page(
  epoch: string,
  items: AgentJournalRenderItem[]
): AgentSessionSubscribeEvent extends { page: infer P } ? P : never {
  const last = items[items.length - 1]
  return {
    sessionId: 'session-1',
    epoch,
    fence: FENCE,
    direction: 'tail',
    items,
    removedItemIds: [],
    submissions: [],
    window: {
      oldest: items[0] ? { epoch, sequence: items[0].sequence } : null,
      newest: last ? { epoch, sequence: last.sequence } : null,
      nextCursor: { epoch, sequence: (last?.sequence ?? 0) + 1 }
    },
    liveCursor: { epoch, sequence: last?.sequence ?? 0 },
    hasOlder: false,
    hasNewer: false
  }
}

function snapshot(epoch: string, items: AgentJournalRenderItem[]): AgentSessionSubscribeEvent {
  return { type: 'snapshot', sessionId: 'session-1', fence: FENCE, page: page(epoch, items) }
}

/** What the host publishes after `replaceEpochItems('handle_forked', …)`: the
 *  catch-up reader cannot follow the old cursor into the new epoch, so every
 *  subscriber gets a reset carrying the retained tail. */
function forkedReset(epoch: string, items: AgentJournalRenderItem[]): AgentSessionSubscribeEvent {
  return {
    type: 'reset',
    sessionId: 'session-1',
    fence: FENCE,
    reset: 'handle_forked',
    page: page(epoch, items)
  } as AgentSessionSubscribeEvent
}

function rewindAccepted(epoch: string) {
  return {
    ok: true,
    result: {
      ok: true,
      replayed: false,
      fence: FENCE,
      cursor: { epoch, sequence: 2 },
      value: { itemId: 'user-2', epoch }
    },
    _meta: { runtimeId: 'runtime-1' }
  }
}

function rewindRefused(reason: string) {
  return {
    ok: true,
    result: {
      ok: false,
      refusal: {
        code: 'agent_session_operation_invalid',
        message: `agent_session_rewind:${reason}`,
        rewindReason: reason
      }
    },
    _meta: { runtimeId: 'runtime-1' }
  }
}

describe('rewinding a structured session to an earlier message', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  let optionsReply: Record<string, unknown> = {}
  let rewindReply: unknown = rewindAccepted('epoch-2')
  const onSendError = vi.fn()
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'agentSession.options') {
      return {
        ok: true,
        result: { models: [], current: { model: 'claude-opus-5' }, ...optionsReply },
        _meta: { runtimeId: 'runtime-1' }
      }
    }
    if (method === 'agentSession.rewind') {
      return rewindReply
    }
    return { ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } }
  })
  const subscribe = vi.fn((_method: string, _params: unknown, onData: (value: unknown) => void) => {
    listener = onData
    return vi.fn()
  })
  const client = { sendRequest, subscribe } as unknown as RpcClient

  function Harness({ agent }: { agent: string }): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent,
      onSendError
    } as never)
    return null
  }

  async function mount(agent = 'claude'): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { agent }))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(snapshot('epoch-1', conversation())))
    await vi.waitFor(() =>
      expect(sendRequest).toHaveBeenCalledWith('agentSession.options', expect.anything(), expect.anything())
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    listener = null
    optionsReply = { rewind: { supported: true } }
    rewindReply = rewindAccepted('epoch-2')
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it('offers rewind only once the host has said this session supports it', async () => {
    await mount()
    await vi.waitFor(() => expect(hook?.rewindSupport).toEqual({ supported: true }))
  })

  it('offers nothing on a host that predates the rewind field', async () => {
    optionsReply = {}
    await mount()
    // The options read has landed (the conversation-command list is set from
    // the same reply); the support field stays unknown rather than assumed.
    await vi.waitFor(() => expect(hook?.conversationCommands).toEqual([]))
    expect(hook?.rewindSupport).toBeNull()
  })

  it('offers nothing for a Codex session the host cannot page, and says why', async () => {
    optionsReply = { rewind: { supported: false, reason: 'history-not-paginated' } }
    await mount('codex')
    await vi.waitFor(() =>
      expect(hook?.rewindSupport).toEqual({ supported: false, reason: 'history-not-paginated' })
    )
  })

  it('sends the epoch the subscription delivered, and the chat truncates on the reset that follows', async () => {
    await mount()
    let accepted = false
    await act(async () => {
      accepted = await hook!.rewindToItem('user-2')
    })
    expect(accepted).toBe(true)
    expect(sendRequest).toHaveBeenCalledWith(
      'agentSession.rewind',
      expect.objectContaining({
        itemId: 'user-2',
        expectedEpoch: 'epoch-1',
        envelope: expect.objectContaining({ sessionId: 'session-1', expectedRuntimeFence: FENCE })
      }),
      expect.anything()
    )
    expect(onSendError).not.toHaveBeenCalled()
    // Before the host publishes, the chat still shows the full conversation:
    // the phone never edits the transcript on its own say-so.
    expect(hook?.session.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2'
    ])
    act(() => listener?.(forkedReset('epoch-2', conversation().slice(0, 2))))
    expect(hook?.session.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
  })

  it('says the session moved on when the host refuses the epoch, and leaves the chat alone', async () => {
    rewindReply = rewindRefused('stale-epoch')
    await mount()
    let accepted = true
    await act(async () => {
      accepted = await hook!.rewindToItem('user-2')
    })
    expect(accepted).toBe(false)
    expect(onSendError).toHaveBeenCalledWith('The session moved on. Reload the chat and try again.')
    expect(hook?.session.messages).toHaveLength(4)
  })

  it('carries a Codex rewind on the same call', async () => {
    await mount('codex')
    await act(async () => {
      await hook!.rewindToItem('user-2')
    })
    expect(sendRequest).toHaveBeenCalledWith(
      'agentSession.rewind',
      expect.objectContaining({ itemId: 'user-2', expectedEpoch: 'epoch-1' }),
      expect.anything()
    )
  })
})
