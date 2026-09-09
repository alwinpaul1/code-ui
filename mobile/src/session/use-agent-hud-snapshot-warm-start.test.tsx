import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentHudSnapshot } from './agent-hud-snapshot'

// Measured on a Galaxy S23 over the relay, 2026-09-09: opening a project showed
// the tab first and the model and context pills about a second later. Every
// tab open started from nothing — asked the host its platform (one round trip,
// then a React re-render before the reader could start), then ran the shell
// reader (four more round trips and a node start) — although the agent had
// already answered for this very session moments before.

const storage = vi.hoisted(() => {
  const items = new Map<string, string>()
  return {
    getItem: vi.fn(async (key: string) => items.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void items.set(key, value)),
    removeItem: vi.fn(async (key: string) => void items.delete(key))
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))

const reader = vi.hoisted(() => ({
  resolve: null as ((snapshot: AgentHudSnapshot | null) => void) | null,
  calls: 0
}))
vi.mock('./agent-hud-snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent-hud-snapshot')>()
  return {
    ...actual,
    readAgentHudSnapshot: vi.fn(
      () =>
        new Promise<AgentHudSnapshot | null>((resolve) => {
          reader.calls++
          reader.resolve = resolve
        })
    )
  }
})

import { useAgentHudSnapshot } from './use-agent-hud-snapshot'
import { resetAgentHudSnapshotCacheForTests } from './agent-hud-snapshot-cache'

const snapshot: AgentHudSnapshot = {
  agent: 'claude',
  model: 'claude-opus-5',
  effort: 'xhigh',
  agentVersion: '2.1.263',
  contextUsedTokens: 507540,
  contextWindowTokens: 1000000,
  contextWindowSource: 'statusline-cache',
  mode: null,
  planType: null,
  limits: [],
  error: null
}

function makeClient() {
  const calls: string[] = []
  return {
    calls,
    sendRequest: vi.fn(async (method: string) => {
      calls.push(method)
      return method === 'status.get'
        ? { ok: true, result: { hostPlatform: 'darwin' } }
        : { ok: false }
    })
  }
}

const rendered: (AgentHudSnapshot | null)[] = []
function Probe(props: Parameters<typeof useAgentHudSnapshot>[0]) {
  const { snapshot } = useAgentHudSnapshot(props)
  rendered.push(snapshot)
  return null
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick++) {
      await Promise.resolve()
    }
  })
}

let tree: ReactTestRenderer | null = null

beforeEach(() => {
  rendered.length = 0
  reader.calls = 0
  reader.resolve = null
  resetAgentHudSnapshotCacheForTests()
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

function mount(client: ReturnType<typeof makeClient>, transcriptPath: string) {
  act(() => {
    tree = create(
      createElement(Probe, {
        client: client as never,
        enabled: true,
        worktree: 'id:wt-1',
        agent: 'claude',
        transcriptPath,
        sessionId: null,
        cwd: null,
        scopeKey: `scope:${transcriptPath}`
      })
    )
  })
}

it('paints the last snapshot the moment the tab reopens, then refreshes', async () => {
  const client = makeClient()
  mount(client, '/t/s.jsonl')
  expect(rendered[0]).toBeNull()
  await flush()
  expect(reader.calls).toBe(1)
  act(() => reader.resolve?.(snapshot))
  await flush()
  expect(rendered.at(-1)?.model).toBe('claude-opus-5')

  act(() => tree?.unmount())
  rendered.length = 0
  mount(client, '/t/s.jsonl')
  // First render, before any round trip has had a chance to answer.
  expect(rendered[0]?.model).toBe('claude-opus-5')
  expect(rendered[0]?.contextUsedTokens).toBe(507540)
  await flush()
  // And a fresh read is still in flight to replace it.
  expect(reader.calls).toBe(2)
})

it('does the same for a Codex tab, keyed by its session id', async () => {
  const client = makeClient()
  const codex: AgentHudSnapshot = {
    ...snapshot,
    agent: 'codex',
    model: 'gpt-5.6-terra',
    contextUsedTokens: 217306,
    contextWindowTokens: 258400,
    contextWindowSource: 'reported-by-agent'
  }
  const mountCodex = (sessionId: string | null) =>
    act(() => {
      tree = create(
        createElement(Probe, {
          client: client as never,
          enabled: true,
          worktree: 'id:wt-1',
          agent: 'codex',
          transcriptPath: null,
          sessionId,
          cwd: '/w',
          scopeKey: `scope:codex:${sessionId ?? 'none'}`
        })
      )
    })
  mountCodex('01a07632')
  await flush()
  act(() => reader.resolve?.(codex))
  await flush()
  expect(rendered.at(-1)?.model).toBe('gpt-5.6-terra')

  act(() => tree?.unmount())
  rendered.length = 0
  mountCodex('01a07632')
  expect(rendered[0]?.model).toBe('gpt-5.6-terra')
  expect(rendered[0]?.contextWindowTokens).toBe(258400)

  // Without a session id there is no honest key: a cwd is shared by every
  // Codex tab in the worktree, so nothing is remembered and nothing shown.
  act(() => tree?.unmount())
  rendered.length = 0
  mountCodex(null)
  expect(rendered[0]).toBeNull()
})

it('never opens a tab with another session\'s numbers', async () => {
  const client = makeClient()
  mount(client, '/t/s.jsonl')
  await flush()
  act(() => reader.resolve?.(snapshot))
  await flush()
  act(() => tree?.unmount())
  rendered.length = 0
  mount(client, '/t/other.jsonl')
  expect(rendered[0]).toBeNull()
  await flush()
  expect(rendered.at(-1)).toBeNull()
})

it('asks the host its platform once per client, not once per tab', async () => {
  const client = makeClient()
  mount(client, '/t/s.jsonl')
  await flush()
  expect(client.calls.filter((method) => method === 'status.get')).toHaveLength(1)
  act(() => tree?.unmount())
  mount(client, '/t/s.jsonl')
  await flush()
  expect(client.calls.filter((method) => method === 'status.get')).toHaveLength(1)
  // And the reader started without waiting on that answer's re-render.
  expect(reader.calls).toBe(2)
})
