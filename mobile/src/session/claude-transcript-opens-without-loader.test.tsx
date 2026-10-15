import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAnthropicSignInReaderForTests } from './anthropic-sign-in-presence'
import { resetCcrLinksForTests, setCcrLinkDepsLoader, setCcrLinkTimerForTests } from './ccr-link-registry'
import { resetCcrMatchOutcomesForTests } from './ccr-match-outcome'
import type { CcrFetch } from './ccr-session-api'
import { parseCcrEvent } from './ccr-session-api'
import { resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import type { CcrLinkDeps } from './ccr-session-link'
import {
  ccrTranscriptKey,
  flushCcrTranscriptsForTests,
  hydrateCcrTranscripts,
  resetCcrTranscriptsForTests,
  restartCcrTranscriptsForTests,
  writeCcrTranscript
} from './ccr-transcript-persist'
import { useClaudeAnthropicTranscript } from './use-claude-anthropic-transcript'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'
import { SESSION_A, event, eventsReply, reply } from './fixtures/ccr-session-api-2026-10-14'
import { streamFetch } from './fixtures/ccr-session-stream'

// "If the session is in recent apps no need of loading the session, we need the same like claude
// mobile app" (2026-10-15). The Claude app 1.261009.20 seeds a Code session it holds (`tdu`, an
// in-memory LRU of 4) before the first frame, so its "Loading session…" item (`rs8.Y1`) is never
// drawn for it, and the server's newest pages then replace the seed in one change. Code UI keeps
// more (12 sessions, across restarts: ccr-transcript-persist.ts); these pin that a kept session
// never shows the loader, and that a session with nothing kept still does.

const TAB = 'tab-1'
const AGENT_SESSION = '3f0c6d2e-claude-session'
const ACCOUNT = 'acct-work'
const EPOCH = 7

let renderer: ReactTestRenderer | null = null
const seen: (MobileNativeChatSession | null)[] = []

function Probe() {
  seen.push(
    useClaudeAnthropicTranscript({
      enabled: true,
      tabId: TAB,
      agentSessionId: AGENT_SESSION,
      configDir: null,
      epoch: EPOCH,
      orcaRowCount: 3,
      orcaStatus: 'ready'
    }).session
  )
  return null
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const text = (uuid: string, role: 'user' | 'assistant', words: string) =>
  event({ type: role, uuid, parent_tool_use_id: null, message: { role, content: role === 'user' ? words : [{ type: 'text', text: words }] } })
const ids = (session: MobileNativeChatSession | null) => session?.messages.map((row) => row.id) ?? []
const statuses = () => seen.map((session) => session?.status)

function linkDeps(pages: () => unknown): CcrLinkDeps {
  const fetch: CcrFetch = async () => reply(200, pages())
  return {
    fetch,
    streamFetch: streamFetch(() => ({ status: 200, chunks: [], hold: true })).fetch,
    auth: async () => ({ token: 't', organizationUuid: 'o' }),
    keep: (key) => `file:///${encodeURIComponent(key)}`,
    log: () => undefined
  }
}

/** The session as it was kept when the phone last had it open, read back as after a relaunch. */
async function keepFromAnEarlierRun(raw: Record<string, unknown>[]): Promise<void> {
  const kept = raw.map((item) => parseCcrEvent(item)!)
  writeCcrTranscript({ accountId: ACCOUNT, sessionId: SESSION_A, events: kept, lastSequenceNum: kept[kept.length - 1]!.sequenceNum!, olderCursor: null, hasOlder: true })
  await flushCcrTranscriptsForTests()
}

async function relaunch(): Promise<void> {
  restartCcrTranscriptsForTests()
  await hydrateCcrTranscripts()
}

beforeEach(() => {
  seen.length = 0
  resetCcrLinksForTests()
  resetCcrTranscriptsForTests()
  resetCcrCacheForTests()
  resetCcrMatchOutcomesForTests()
  setCcrLinkTimerForTests(() => () => undefined)
  setAnthropicSignInReaderForTests(async () => 1)
  setCcrMapping(TAB, SESSION_A, EPOCH, ACCOUNT, AGENT_SESSION)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetCcrLinksForTests()
  setAnthropicSignInReaderForTests(null)
})

describe('opening a Claude session the phone has opened before', () => {
  it('shows its kept rows from the first frame and never the loader, while the server is still asked', async () => {
    const u1 = text('u1', 'user', 'kept question')
    const a1 = text('a1', 'assistant', 'kept answer')
    await keepFromAnEarlierRun([u1, a1])
    await relaunch()
    // The server never answers: nothing but the kept copy can be drawn.
    setCcrLinkDepsLoader(() => new Promise<CcrLinkDeps>(() => undefined))
    act(() => {
      renderer = create(createElement(Probe))
    })
    await settle()
    expect(ids(seen[0]!)).toEqual(['u1', 'a1'])
    expect(statuses().every((status) => status === 'ready')).toBe(true)
  })

  it('merges what the server adds without a single frame back on the loader', async () => {
    const u1 = text('u1', 'user', 'kept question')
    const a1 = text('a1', 'assistant', 'kept answer')
    await keepFromAnEarlierRun([u1, a1])
    await relaunch()
    const a2 = text('a2', 'assistant', 'written while the phone was away')
    setCcrLinkDepsLoader(async () => linkDeps(() => eventsReply([u1, a1, a2])))
    act(() => {
      renderer = create(createElement(Probe))
    })
    await settle()
    expect(ids(seen[0]!)).toEqual(['u1', 'a1'])
    expect(ids(seen[seen.length - 1]!)).toEqual(['u1', 'a1', 'a2'])
    expect(statuses().filter((status) => status !== 'ready')).toEqual([])
  })
})

describe('opening a Claude session with nothing kept', () => {
  it('shows the loader until its first page lands', async () => {
    setCcrLinkDepsLoader(async () => linkDeps(() => eventsReply([text('u1', 'user', 'first'), text('a1', 'assistant', 'reply')])))
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(seen[0]!.status).toBe('loading')
    await settle()
    expect(seen[seen.length - 1]!.status).toBe('ready')
    expect(ids(seen[seen.length - 1]!)).toEqual(['u1', 'a1'])
  })

  it.each([
    ['is not JSON', '{"accountId":'],
    ['is not a transcript', JSON.stringify({ accountId: ACCOUNT, sessionId: SESSION_A, events: 'gone' })]
  ])('falls back to the loader when the kept copy %s, and does not throw', async (_label, corrupt) => {
    await keepFromAnEarlierRun([text('u1', 'user', 'kept'), text('a1', 'assistant', 'kept reply')])
    await AsyncStorage.setItem(`codeui:ccr-transcript-v1:${encodeURIComponent(ccrTranscriptKey(ACCOUNT, SESSION_A))}`, corrupt)
    await relaunch()
    setCcrLinkDepsLoader(() => new Promise<CcrLinkDeps>(() => undefined))
    act(() => {
      renderer = create(createElement(Probe))
    })
    await settle()
    expect(seen[0]!.status).toBe('loading')
    expect(ids(seen[seen.length - 1]!)).toEqual([])
  })
})
