import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn(), digestStringAsync: vi.fn() }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))

import { useCcrSessionModel } from './use-ccr-session-model'
import { useCcrSessionHeader, type CcrSessionHeader } from './use-ccr-session-header'
import { claudeSessionHeaderTitle, resetCcrSessionFactsForTests } from './ccr-session-facts'
import { CCR_MODEL_REFRESH_MS, resetCcrModelForTests } from './ccr-session-model'
import { resetCcrPipelineForTests, type CcrPipelineDeps } from './ccr-session-pipeline'
import { resetCcrUsageForTests } from './ccr-session-usage'
import { setCcrMapping } from './ccr-session-cache'
import { ACCOUNT_UUID, SESSION_A, SESSION_B, apiRoutes, assistantEvent, eventsReply, fakeFetch, reply, sessionRow, sessionsReply, singleAccountSource } from './fixtures/ccr-session-api-2026-10-14'

// The Claude app's session header shows the session's own `title` (Claude Code titles it; the user
// renames it). Code UI's header showed the worktree name for every tab. A Claude tab matched to
// its Remote Control session now shows that session's title, with the worktree name kept as the
// fallback whenever the title is not known.
const MESSAGES: NativeChatMessage[] = [{ id: 'm1', role: 'assistant', timestamp: 0, source: 'transcript', blocks: [{ type: 'text', text: 'hi' }] }]
const WORKTREE = 'fix-login'

let title: unknown = 'CI failure on main'
let listStatus = 200

function deps(): CcrPipelineDeps {
  const { fetch } = fakeFetch(
    apiRoutes({
      sessions: () => (listStatus === 200 ? reply(200, sessionsReply([sessionRow(SESSION_A, { title, external_metadata: { model: 'claude-opus-5-5' } })])) : reply(listStatus, { error: {} })),
      events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent('m1', 'toolu_A', '/x.png')])) }
    })
  )
  return { fetch, accounts: singleAccountSource(), keep: (_key, uri) => uri, maxBytes: 1, log: () => undefined }
}

let renderer: ReactTestRenderer | null = null
let header: CcrSessionHeader | null = null
let current = { enabled: true, agentSessionId: null as string | null, deps: null as CcrPipelineDeps | null }

function Probe(_props: { render: number }) {
  const args = { enabled: current.enabled, tabId: 'tab-1', agentSessionId: current.agentSessionId, epoch: 1 }
  useCcrSessionModel({ ...args, messages: MESSAGES, deps: current.deps!, needsContext: false })
  // The title is shown only with the session writes switch on (the header and Rename then name the
  // same thing); claude-rename-goes-to-anthropic-only-behind-the-switch.test.tsx covers it off.
  header = useCcrSessionHeader({ ...args, writesOn: true })
  return null
}

async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

async function mount(enabled = true) {
  current = { enabled, agentSessionId: null, deps: deps() }
  await act(async () => {
    renderer = create(createElement(Probe, { render: 0 }))
  })
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  title = 'CI failure on main'
  listStatus = 200
  resetCcrPipelineForTests()
  resetCcrModelForTests()
  resetCcrUsageForTests()
  resetCcrSessionFactsForTests()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  header = null
  vi.useRealTimers()
})

describe('the header of a Claude tab matched to its Anthropic session', () => {
  it('shows the session title instead of the worktree name', async () => {
    await mount()
    expect(header).toMatchObject({ sessionId: SESSION_A, title: 'CI failure on main' })
    expect(claudeSessionHeaderTitle(header?.title ?? null, WORKTREE)).toBe('CI failure on main')
  })

  it('follows a rename made elsewhere at the next re-read of the row', async () => {
    await mount()
    title = 'Login bug, take two'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CCR_MODEL_REFRESH_MS)
    })
    await settle()
    expect(header?.title).toBe('Login bug, take two')
  })

  it('keeps the worktree name while the session has no title yet', async () => {
    title = null
    await mount()
    expect(header?.sessionId).toBe(SESSION_A)
    expect(claudeSessionHeaderTitle(header?.title ?? null, WORKTREE)).toBe(WORKTREE)
  })

  it('keeps the worktree name for a title of only spaces', async () => {
    title = '   '
    await mount()
    expect(claudeSessionHeaderTitle(header?.title ?? null, WORKTREE)).toBe(WORKTREE)
  })

  it('keeps the worktree name when the session list cannot be read', async () => {
    listStatus = 500
    await mount()
    expect(header).toBeNull()
    expect(claudeSessionHeaderTitle(null, WORKTREE)).toBe(WORKTREE)
  })

  it('says nothing for a tab that is not a Claude chat (Codex, a terminal view)', async () => {
    await mount(false)
    expect(header).toBeNull()
  })

  it('drops the title once the tab is matched to another session', async () => {
    await mount()
    expect(header?.title).toBe('CI failure on main')
    // A /clear or another --resume: the tab now shows SESSION_B, whose row has not been read yet.
    setCcrMapping('tab-1', SESSION_B, 1, ACCOUNT_UUID)
    await act(async () => {
      renderer!.update(createElement(Probe, { render: 1 }))
    })
    expect(header).toBeNull()
  })
})

describe('the header title words', () => {
  it('reads Terminal when neither a title nor a worktree name is known', () => {
    expect(claudeSessionHeaderTitle(null, '')).toBe('Terminal')
    expect(claudeSessionHeaderTitle('  Ship it  ', '')).toBe('Ship it')
  })
})
