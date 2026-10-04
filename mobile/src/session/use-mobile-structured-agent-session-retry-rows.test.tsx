import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessionFailureWords } from '../../../src/shared/agent-session-failure-words'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../src/shared/agent-session-wire'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }
}))

// Orca #23684 (b4b708c2c4): a Codex stream error Codex says it will retry is written as its own
// warning row with a `providerRetrying` failure fact, one per attempt, and the journal keeps them
// all. The transcript draws only the latest row of each agent's run. The rows below are what a
// 1.4.220 host writes: `agentSessionFailureWords` is the host's own constructor for a row's
// sentence and fact (`codex-provider-retry-row.ts`), and the detail and cause are Codex's
// app-server `willRetry` error frame as upstream's fixture carries it.
function retry(sequence: number, attempt: number, agentId?: string): AgentJournalRenderItem {
  return {
    itemId: `retry-${agentId ?? 'root'}-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    ...(agentId ? { agentId } : {}),
    body: {
      kind: 'status',
      tone: 'warning',
      ...agentSessionFailureWords(
        {
          kind: 'providerRetrying',
          detail: { text: `Reconnecting... ${attempt}/5`, audience: 'person' },
          retry: { cause: 'stream disconnected before completion' }
        },
        { surface: 'row', agentName: 'Codex' }
      )
    }
  }
}

function said(sequence: number, text: string, agentId?: string): AgentJournalRenderItem {
  return {
    itemId: `said-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    ...(agentId ? { agentId } : {}),
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
  }
}

function snapshot(items: AgentJournalRenderItem[]): AgentSessionSubscribeEvent {
  const newest = items.length
  return {
    type: 'snapshot',
    sessionId: 'session-1',
    fence: 3,
    page: {
      sessionId: 'session-1',
      epoch: 'epoch-1',
      fence: 3,
      direction: 'tail',
      items,
      removedItemIds: [],
      submissions: [],
      window: {
        oldest: { epoch: 'epoch-1', sequence: 1 },
        newest: { epoch: 'epoch-1', sequence: newest },
        nextCursor: { epoch: 'epoch-1', sequence: newest + 1 }
      },
      liveCursor: { epoch: 'epoch-1', sequence: newest },
      hasOlder: false,
      hasNewer: false
    }
  }
}

const RETRY_LINE = (attempt: number) =>
  `Codex is retrying: Reconnecting... ${attempt}/5.\nstream disconnected before completion`

// Module scope: the harness assigns these, which a test body's own `let` would narrow to null.
let renderer: ReactTestRenderer | null = null
let hook: ReturnType<typeof useMobileStructuredAgentSession> | null = null
let listener: ((value: unknown) => void) | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  hook = null
  listener = null
})

async function drawn(items: AgentJournalRenderItem[]): Promise<string[]> {
  act(() => renderer?.unmount())
  listener = null
  const client = {
    sendRequest: async () => ({ id: 'request-1', ok: true, result: {}, _meta: { runtimeId: 'r' } }),
    subscribe: (_method: string, _params: unknown, onData: (value: unknown) => void) => {
      listener = onData
      return () => {}
    },
    getState: () => 'connected'
  } as unknown as RpcClient
  function Harness(): null {
    hook = useMobileStructuredAgentSession({
      client,
      sessionId: 'session-1',
      sourceIdentity: 'host-a\0workspace-a',
      enabled: true,
      connected: true,
      agent: 'codex',
      onSendError: vi.fn()
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  await vi.waitFor(() => expect(listener).toEqual(expect.any(Function)))
  act(() => listener?.(snapshot(items)))
  return (hook?.session.messages ?? []).map((message) =>
    message.blocks.map((block) => (block.type === 'text' ? block.text : block.type)).join('|')
  )
}

describe('a Codex stream retry on the phone', () => {
  it('draws one row for a run of provider retries, with what failed on its second line', async () => {
    expect(await drawn([retry(1, 1), retry(2, 2), retry(3, 3)])).toEqual([RETRY_LINE(3)])
  })

  it('keeps one row per run: a row of its own between two attempts ends the run', async () => {
    expect(await drawn([retry(1, 1), said(2, 'Partial answer'), retry(3, 1)])).toEqual([
      RETRY_LINE(1),
      'Partial answer',
      RETRY_LINE(1)
    ])
  })

  it("keeps each agent's run its own: two agents retrying at once each keep their latest row", async () => {
    expect(
      await drawn([retry(1, 1), retry(2, 1, 'sub-1'), retry(3, 2), retry(4, 2, 'sub-1')])
    ).toEqual([RETRY_LINE(2), RETRY_LINE(2)])
  })

  it("does not let another agent's row split a run (the phone draws every agent in one list)", async () => {
    expect(await drawn([retry(1, 1), said(2, 'Subagent output', 'sub-1'), retry(3, 2)])).toEqual([
      'Subagent output',
      RETRY_LINE(2)
    ])
  })

  it('draws a lone retry row, and a list with none, as before', async () => {
    expect(await drawn([retry(1, 1)])).toEqual([RETRY_LINE(1)])
    expect(await drawn([])).toEqual([])
  })
})
