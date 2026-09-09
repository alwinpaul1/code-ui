import { beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const items = new Map<string, string>()
  return {
    items,
    getItem: vi.fn(async (key: string) => items.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void items.set(key, value)),
    removeItem: vi.fn(async (key: string) => void items.delete(key))
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))

import {
  agentHudCacheKey,
  hydrateAgentHudSnapshot,
  peekAgentHudSnapshot,
  rememberAgentHudSnapshot,
  resetAgentHudSnapshotCacheForTests
} from './agent-hud-snapshot-cache'
import { parseAgentHudSnapshot } from './agent-hud-snapshot'

const snapshot = parseAgentHudSnapshot(
  JSON.stringify({
    agent: 'claude',
    model: 'claude-opus-5',
    effort: 'xhigh',
    contextUsedTokens: 507540,
    contextWindowTokens: 1000000,
    contextWindowSource: 'statusline-cache'
  })
)!

async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick++) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  storage.items.clear()
  storage.getItem.mockClear()
  storage.setItem.mockClear()
  storage.removeItem.mockClear()
  resetAgentHudSnapshotCacheForTests()
})

it('keys a session by what identifies it, never by a directory two sessions share', () => {
  expect(agentHudCacheKey({ agent: 'claude', transcriptPath: '/t/s.jsonl' })).toBe(
    'claude:/t/s.jsonl'
  )
  expect(agentHudCacheKey({ agent: 'claude', transcriptPath: null })).toBeNull()
  expect(agentHudCacheKey({ agent: 'codex', sessionId: '01a0', cwd: '/w' })).toBe('codex:01a0')
  // Two Codex tabs in one worktree would otherwise show each other's context.
  expect(agentHudCacheKey({ agent: 'codex', sessionId: null, cwd: '/w' })).toBeNull()
})

it('hands the last snapshot back synchronously once it has seen one', () => {
  expect(peekAgentHudSnapshot('claude:/t/s.jsonl')).toBeNull()
  rememberAgentHudSnapshot('claude:/t/s.jsonl', snapshot)
  expect(peekAgentHudSnapshot('claude:/t/s.jsonl')).toBe(snapshot)
})

it('survives an app restart through storage, re-validated on the way back', async () => {
  rememberAgentHudSnapshot('claude:/t/s.jsonl', snapshot)
  await settle()
  resetAgentHudSnapshotCacheForTests()
  expect(peekAgentHudSnapshot('claude:/t/s.jsonl')).toBeNull()

  const hydrated = await hydrateAgentHudSnapshot('claude:/t/s.jsonl')
  expect(hydrated?.model).toBe('claude-opus-5')
  expect(hydrated?.contextWindowSource).toBe('statusline-cache')
  expect(peekAgentHudSnapshot('claude:/t/s.jsonl')).toBe(hydrated)

  // A stored shape an older build wrote degrades instead of being trusted.
  storage.items.set('orca.mobile.agent-hud.v1.claude:/t/old.jsonl', '{"agent":"gemini"}')
  expect(await hydrateAgentHudSnapshot('claude:/t/old.jsonl')).toBeNull()
})

it('never stores a failed read over a good one', () => {
  rememberAgentHudSnapshot('claude:/t/s.jsonl', snapshot)
  rememberAgentHudSnapshot('claude:/t/s.jsonl', { ...snapshot, error: 'node-missing' })
  expect(peekAgentHudSnapshot('claude:/t/s.jsonl')).toBe(snapshot)
})

it('keeps storage bounded, evicting the sessions seen longest ago', async () => {
  for (let index = 0; index < 34; index++) {
    rememberAgentHudSnapshot(`claude:/t/${index}.jsonl`, snapshot)
    await settle()
  }
  await settle()
  expect(storage.items.has('orca.mobile.agent-hud.v1.claude:/t/0.jsonl')).toBe(false)
  expect(storage.items.has('orca.mobile.agent-hud.v1.claude:/t/1.jsonl')).toBe(false)
  expect(storage.items.has('orca.mobile.agent-hud.v1.claude:/t/2.jsonl')).toBe(true)
  expect(storage.items.has('orca.mobile.agent-hud.v1.claude:/t/33.jsonl')).toBe(true)
  expect(peekAgentHudSnapshot('claude:/t/0.jsonl')).toBeNull()
})
