// Orca #19822's working-state half, at the seam that renders it. Its sibling
// file covers the rest of this hook; the split keeps both under the line cap.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

const FENCE = 3

function emptySnapshot(submissions: AgentJournalSubmission[]): AgentSessionSubscribeEvent {
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: FENCE,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: FENCE,
      direction: 'tail',
      items: [],
      removedItemIds: [],
      submissions,
      window: { oldest: null, newest: null, nextCursor: { epoch: 'epoch-1', sequence: 0 } },
      liveCursor: { epoch: 'epoch-1', sequence: 0 },
      hasOlder: false,
      hasNewer: false
    }
  }
}

/** The host has journalled the send; the provider has not echoed it. */
function pendingSend(overrides: Partial<AgentJournalSubmission> = {}): AgentJournalSubmission {
  return {
    clientMessageId: 'msg-1',
    fence: FENCE,
    payloadFingerprint: 'fp-1',
    dispatchState: 'pending',
    providerItemId: null,
    reason: null,
    submittedAt: 10,
    resolvedAt: null,
    ...overrides
  }
}

function runningStatusItem(): AgentJournalRenderItem {
  return {
    itemId: 'status-1',
    revision: 1,
    sequence: 1,
    observedAt: 14,
    body: { kind: 'status', text: 'Working', turnLifecycle: { turnId: 'turn-1', state: 'running' } }
  }
}

function turnOpened(): AgentSessionSubscribeEvent {
  return {
    type: 'batch',
    sessionId: 'session-1',
    fence: FENCE,
    batch: {
      cursor: { epoch: 'epoch-1', sequence: 1 },
      items: [runningStatusItem()],
      removedItemIds: [],
      submissions: []
    }
  }
}

describe('a structured Claude send, before the provider echoes it', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
  let listener: ((value: unknown) => void) | null = null
  const onSendError = vi.fn()
  const sendRequest = vi.fn(async (method: string) => ({
    ok: true,
    result:
      method === 'agentSession.options'
        ? { models: [], current: { model: 'claude-opus-5' } }
        : {},
    _meta: { runtimeId: 'runtime-1' }
  }))
  const subscribe = vi.fn((_method: string, _params: unknown, onData: (value: unknown) => void) => {
    listener = onData
    return vi.fn()
  })
  const client = { sendRequest, subscribe } as unknown as RpcClient

  function Harness(): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent: 'claude',
      onSendError
    } as never)
    return null
  }

  async function mount(submissions: AgentJournalSubmission[]): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
    act(() => listener?.(emptySnapshot(submissions)))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    listener = null
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it('reads as working from the journalled send, not from the provider echo', async () => {
    // Claude's running row can only be written once the SDK echoes the user
    // message back: 3.4s median, 18s at p90. All of that used to read idle.
    await mount([pendingSend()])
    expect(hook?.isWorking).toBe(true)
  })

  it('offers no stop until there is a turn to stop', async () => {
    await mount([pendingSend()])
    expect(hook?.canStop).toBe(false)
    act(() => listener?.(turnOpened()))
    expect(hook?.canStop).toBe(true)
    expect(hook?.isWorking).toBe(true)
  })

  it('still reads as working when the ack budget elapses', async () => {
    await mount([pendingSend({ dispatchState: 'unknown' })])
    expect(hook?.isWorking).toBe(true)
  })

  it('reads as idle for a send the host recovered after its own restart', async () => {
    await mount([pendingSend({ dispatchState: 'unknown', recovered: true, resolvedAt: 20 })])
    expect(hook?.isWorking).toBe(false)
  })

  it('reads as idle for a send left behind by an older fence', async () => {
    await mount([pendingSend({ fence: FENCE - 1 })])
    expect(hook?.isWorking).toBe(false)
  })
})
