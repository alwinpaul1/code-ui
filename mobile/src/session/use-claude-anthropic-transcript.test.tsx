import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAnthropicSignInReaderForTests } from './anthropic-sign-in-presence'
import { resetCcrLinksForTests, setCcrLinkDepsLoader, setCcrLinkTimerForTests } from './ccr-link-registry'
import { recordCcrMatchOutcome, resetCcrMatchOutcomesForTests } from './ccr-match-outcome'
import type { CcrFetch } from './ccr-session-api'
import { resetCcrCacheForTests, setCcrMapping } from './ccr-session-cache'
import type { CcrLinkDeps } from './ccr-session-link'
import { flushCcrTranscriptsForTests, hydrateCcrTranscripts, resetCcrTranscriptsForTests, restartCcrTranscriptsForTests, writeCcrTranscript } from './ccr-transcript-persist'
import { CLAUDE_SIGNED_OUT_LINE, CLAUDE_UNMATCHED_LINE, useClaudeAnthropicTranscript, type ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'
import { SESSION_A, event, eventsReply, reply } from './fixtures/ccr-session-api-2026-10-14'
import { streamFetch } from './fixtures/ccr-session-stream'
import { parseCcrEvent } from './ccr-session-api'

const TAB = 'tab-1'
const AGENT_SESSION = '3f0c6d2e-claude-session'
const ACCOUNT = 'acct-work'
const EPOCH = 7

type Seen = { gate: ClaudeChatGate; session: MobileNativeChatSession | null }
let renderer: ReactTestRenderer | null = null
const seen: Seen[] = []

function Probe(props: { enabled?: boolean; epoch?: number; orcaSettled?: boolean; orcaRowCount?: number; orcaStatus?: MobileNativeChatSession['status']; orcaError?: string }) {
  seen.push(
    useClaudeAnthropicTranscript({
      enabled: props.enabled ?? true,
      tabId: TAB,
      agentSessionId: AGENT_SESSION,
      epoch: props.epoch ?? EPOCH,
      orcaSettled: props.orcaSettled ?? true,
      orcaRowCount: props.orcaRowCount ?? 3,
      orcaStatus: props.orcaStatus ?? ((props.orcaSettled ?? true) ? 'ready' : 'loading'),
      orcaError: props.orcaError
    })
  )
  return null
}

async function mount(props: Parameters<typeof Probe>[0] = {}) {
  await act(async () => {
    renderer = create(createElement(Probe, props))
  })
  await settle()
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const last = () => seen[seen.length - 1]!
const ids = (session: MobileNativeChatSession | null) => session?.messages.map((row) => row.id) ?? []
const text = (uuid: string, role: 'user' | 'assistant', words: string) =>
  event({ type: role, uuid, parent_tool_use_id: null, message: { role, content: role === 'user' ? words : [{ type: 'text', text: words }] } })

function linkDeps(pages: (cursor: string | null) => unknown, requests: string[] = []): CcrLinkDeps {
  const fetch: CcrFetch = async (url) => {
    requests.push(url)
    return reply(200, pages(new URL(url).searchParams.get('cursor')))
  }
  return {
    fetch,
    streamFetch: streamFetch(() => ({ status: 200, chunks: [], hold: true })).fetch,
    auth: async () => ({ token: 't', organizationUuid: 'o' }),
    keep: (key) => `file:///${encodeURIComponent(key)}`,
    log: () => undefined
  }
}

beforeEach(() => {
  seen.length = 0
  resetCcrLinksForTests()
  resetCcrTranscriptsForTests()
  resetCcrCacheForTests()
  resetCcrMatchOutcomesForTests()
  setCcrLinkTimerForTests(() => () => undefined)
  setAnthropicSignInReaderForTests(async () => 1)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetCcrLinksForTests()
  setAnthropicSignInReaderForTests(null)
})

describe('a Claude tab reads only from Anthropic', () => {
  it('signed out, the chat is the sign-in line, not the desktop’s transcript', async () => {
    setAnthropicSignInReaderForTests(async () => 0)
    await mount()
    expect(last().gate).toEqual({ kind: 'signed-out' })
    expect(last().session).toMatchObject({ status: 'error', error: CLAUDE_SIGNED_OUT_LINE, messages: [] })
  })

  it('with no Remote Control session for it, the chat says so and why', async () => {
    recordCcrMatchOutcome(TAB, EPOCH, { stages: [{ stage: 'match', ok: false, detail: 'none of 12 sessions holds this tab’s messages' }], sessionId: null, found: 0, wanted: 0 })
    await mount()
    expect(last().gate).toEqual({ kind: 'unmatched', detail: 'none of 12 sessions holds this tab’s messages' })
    expect(last().session).toMatchObject({ status: 'error', error: CLAUDE_UNMATCHED_LINE, messages: [] })
  })

  it('while the match is still running, the chat is loading, never the desktop’s rows', async () => {
    await mount()
    expect(last().gate).toEqual({ kind: 'finding' })
    expect(last().session).toMatchObject({ status: 'loading', messages: [] })
  })

  it('a session with no message yet is an empty chat its composer can start', async () => {
    await mount({ orcaSettled: true, orcaRowCount: 0 })
    expect(last().gate).toEqual({ kind: 'new' })
    expect(last().session).toMatchObject({ status: 'ready', messages: [] })
  })

  // Review 2026-10-15: the match runs only on Orca's rows, so a tab with none that never became
  // `ready` sat on the loading spinner for ever.
  it('a session the desktop has no transcript for yet says so, not an endless spinner', async () => {
    await mount({ orcaSettled: false, orcaRowCount: 0, orcaStatus: 'awaiting-transcript' })
    expect(last().gate.kind).not.toBe('finding')
    expect(last().session).toMatchObject({ status: 'awaiting-transcript', messages: [], transcriptLoading: false })
  })

  it('a tab whose desktop read failed with no rows shows the error and its reason', async () => {
    await mount({ orcaSettled: false, orcaRowCount: 0, orcaStatus: 'error', orcaError: 'The host could not read the transcript' })
    expect(last().gate.kind).not.toBe('finding')
    expect(last().session).toMatchObject({ status: 'error', error: 'The host could not read the transcript', messages: [] })
  })

  it('a desktop read still in flight with no rows is still loading', async () => {
    await mount({ orcaSettled: false, orcaRowCount: 0, orcaStatus: 'loading' })
    expect(last().gate).toEqual({ kind: 'finding' })
    expect(last().session).toMatchObject({ status: 'loading', messages: [] })
  })

  it('matched, the rows are Anthropic’s and only Anthropic’s', async () => {
    setCcrMapping(TAB, SESSION_A, EPOCH, ACCOUNT, AGENT_SESSION)
    setCcrLinkDepsLoader(async () => linkDeps(() => eventsReply([text('u1', 'user', 'from Anthropic'), text('a1', 'assistant', 'reply')])))
    await mount()
    expect(last().gate).toEqual({ kind: 'matched', accountId: ACCOUNT, sessionId: SESSION_A })
    expect(ids(last().session)).toEqual(['u1', 'a1'])
  })

  it('a matched tab paints its kept conversation in the first frame, before any request answers', async () => {
    const kept = [text('u1', 'user', 'kept'), text('a1', 'assistant', 'kept reply')].map((raw) => parseCcrEvent(raw)!)
    writeCcrTranscript({ accountId: ACCOUNT, sessionId: SESSION_A, events: kept, lastSequenceNum: kept[1]!.sequenceNum!, olderCursor: null, hasOlder: true })
    await flushCcrTranscriptsForTests()
    restartCcrTranscriptsForTests()
    await hydrateCcrTranscripts()
    setCcrMapping(TAB, SESSION_A, EPOCH, ACCOUNT, AGENT_SESSION)
    const requests: string[] = []
    setCcrLinkDepsLoader(() => new Promise<CcrLinkDeps>(() => undefined))
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(ids(seen[0]!.session)).toEqual(['u1', 'a1'])
    expect(requests).toEqual([])
  })

  it('a tab of another agent is left to the desktop’s transcript, as before', async () => {
    await mount({ enabled: false })
    expect(last()).toEqual({ gate: { kind: 'off' }, session: null })
  })
})
