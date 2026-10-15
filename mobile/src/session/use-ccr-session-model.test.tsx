import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn(), digestStringAsync: vi.fn() }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))

import { useCcrSessionModel } from './use-ccr-session-model'
import { CCR_MODEL_FRESH_MS, CCR_MODEL_REFRESH_MS, preferCcrModelPair, resetCcrModelForTests, type CcrModelReading } from './ccr-session-model'
import { resetCcrPipelineForTests, type CcrPipelineDeps } from './ccr-session-pipeline'
import { recordCcrFailure } from './ccr-session-cache'
import { notifyAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import {
  SESSION_A,
  TOKEN,
  singleAccountSource,
  apiRoutes,
  assistantEvent,
  eventsReply,
  fakeFetch,
  reply,
  sessionRow,
  sessionsReply,
  systemEvent,
  type RecordedRequest
} from './fixtures/ccr-session-api-2026-10-14'

const MESSAGES: NativeChatMessage[] = [{ id: 'm1', role: 'assistant', timestamp: 0, source: 'transcript', blocks: [{ type: 'text', text: 'hi' }] }]
const today = { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'medium' }

let reported: { model: string; effort?: string } | null = { model: 'claude-opus-5-5', effort: 'high' }
let shares = true

function deps(token: string | null = TOKEN): { deps: CcrPipelineDeps; requests: RecordedRequest[] } {
  const { fetch, requests } = fakeFetch(
    apiRoutes({
      sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A, { external_metadata: reported ? { model: reported.model, effort_level: reported.effort } : {} })])),
      events: { [SESSION_A]: () => reply(200, eventsReply([shares ? assistantEvent('m1', 'toolu_A', '/x.png') : systemEvent('other')])) }
    })
  )
  return {
    deps: {
      fetch,
      accounts: singleAccountSource(token),
      keep: (_key, uri) => uri,
      maxBytes: 1,
      log: () => undefined
    },
    requests
  }
}

let renderer: ReactTestRenderer | null = null
let reading: CcrModelReading | null = null
let clock = Date.now()

let current: { enabled: boolean; deps: CcrPipelineDeps; epoch: number; agentSessionId: string | null } | null = null

function Probe(_props: { render: number }) {
  reading = useCcrSessionModel({ enabled: current!.enabled, tabId: 'tab-1', agentSessionId: current!.agentSessionId, messages: MESSAGES, epoch: current!.epoch, deps: current!.deps, now: () => clock })
  return null
}

async function mount(args: { enabled?: boolean; deps: CcrPipelineDeps; epoch?: number; agentSessionId?: string | null }) {
  current = { enabled: args.enabled ?? true, deps: args.deps, epoch: args.epoch ?? 1, agentSessionId: args.agentSessionId ?? null }
  await act(async () => {
    renderer = create(createElement(Probe, { render: 0 }))
  })
  await settle()
}

async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  clock = Date.now()
  reported = { model: 'claude-opus-5-5', effort: 'high' }
  shares = true
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  reading = null
  vi.useRealTimers()
})

describe('the model and effort a matched session reports', () => {
  it('states the pill’s pair once the tab is matched', async () => {
    await mount({ deps: deps().deps })
    expect(reading).toMatchObject({ sessionId: SESSION_A, model: 'claude-opus-5-5', effort: 'high' })
    expect(preferCcrModelPair({ model: null, label: null, effort: null }, reading, null)).toEqual({ model: 'claude-opus-5-5', label: null, effort: 'high' })
  })

  it('is re-read every minute while the chat is shown, following an /effort typed on the desktop', async () => {
    const harness = deps()
    await mount({ deps: harness.deps })
    reported = { model: 'claude-opus-5-5', effort: 'max' }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CCR_MODEL_REFRESH_MS)
    })
    await settle()
    expect(reading?.effort).toBe('max')
    expect(harness.requests.filter((request) => request.url.includes('/v1/code/sessions?')).length).toBe(2)
  })

  it('leaves today’s pair once the reading is stale', async () => {
    await mount({ deps: deps().deps })
    expect(reading).not.toBeNull()
    clock += CCR_MODEL_FRESH_MS + 1
    await act(async () => {
      renderer!.update(createElement(Probe, { render: 1 }))
    })
    expect(reading).toBeNull()
    expect(preferCcrModelPair(today, reading, null)).toBe(today)
  })

  it('leaves today’s pair once a refresh fails', async () => {
    const harness = deps()
    await mount({ deps: harness.deps })
    reported = null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CCR_MODEL_REFRESH_MS)
    })
    await settle()
    expect(reading).toBeNull()
  })

  it('leaves today’s pair when the tab matches no session', async () => {
    shares = false
    await mount({ deps: deps().deps })
    expect(reading).toBeNull()
    expect(preferCcrModelPair(today, reading, null)).toBe(today)
  })

  it('leaves today’s pair for an id the phone cannot name', async () => {
    reported = { model: 'claude-mystery', effort: 'high' }
    await mount({ deps: deps().deps })
    expect(reading).toBeNull()
  })

  it('leaves today’s pair, asking nothing, when not signed in', async () => {
    const harness = deps(null)
    await mount({ deps: harness.deps })
    expect(reading).toBeNull()
    expect(harness.requests).toEqual([])
  })

  it('asks nothing while switched off (another agent, the structured lane)', async () => {
    const harness = deps()
    await mount({ enabled: false, deps: harness.deps })
    expect(reading).toBeNull()
    expect(harness.requests).toEqual([])
  })

  it('drops a reading from before the relay reconnected', async () => {
    const harness = deps()
    await mount({ deps: harness.deps, epoch: 1 })
    act(() => renderer?.unmount())
    renderer = null
    reported = null
    await mount({ deps: harness.deps, epoch: 2 })
    expect(reading).toBeNull()
  })
})

describe('the composer pill', () => {
  // A structural pin: the pill's pair is read in the controller, where no
  // behavioural test reaches without the whole session screen. It must pass
  // through preferCcrModelPair with the beacon's time, so a fresh reading
  // states the pill only where no beacon was heard and nothing live speaks.
  it('goes through the session’s reported pair, which yields to any beacon', () => {
    const source = readFileSync(join(__dirname, 'use-mobile-native-chat-controller.ts'), 'utf8')
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).toContain(
      'nativeChatLiveModel: claudeModelPillPair(preferCcrModelPair({ model: claudeReported.model, label: claudeReported.label, effort: claudeReported.effort }, ccrModel, hudLiveBeacon?.receivedAt ?? null), transcriptModel.fallback)'
    )
    expect(code).toContain("const ccrEnabled = showNativeChat && !activeChatStructured && activeChatResolution?.agent === 'claude', ccrModel = useCcrSessionModel({ enabled: ccrEnabled,")
  })
})

// "It must match the session when i open asap", for an already running tab too (2026-10-15). A
// back-off is for a tab left open that keeps failing; opening a tab, a sign-in, and a new Claude
// session in the tab each get one attempt at once.
describe('one attempt at once on each event, never a wait carried over', () => {
  const listCalls = (requests: RecordedRequest[]) => requests.filter((request) => new URL(request.url).pathname === '/v1/code/sessions').length

  it('matches a tab the moment it is opened, though a failure recorded while it was closed still has its wait to run', async () => {
    recordCcrFailure('tab-1', 1, Date.now())
    recordCcrFailure('tab-1', 1, Date.now())
    const { deps: d, requests } = deps()
    await mount({ deps: d })
    expect(listCalls(requests)).toBe(1)
    expect(reading).toMatchObject({ sessionId: SESSION_A, model: 'claude-opus-5-5' })
  })

  it('tries again at once when an account signs in, without waiting out the back-off', async () => {
    const signedOut = deps(null)
    await mount({ deps: signedOut.deps })
    expect(reading).toBeNull()
    const signedIn = deps()
    current = { ...current!, deps: signedIn.deps }
    await act(async () => {
      notifyAnthropicAccountsChanged()
    })
    await settle()
    expect(listCalls(signedIn.requests)).toBe(1)
    expect(reading).toMatchObject({ sessionId: SESSION_A })
  })

  it('matches again at once when the tab’s Claude session changes under it, and only once', async () => {
    const { deps: d, requests } = deps()
    await mount({ deps: d, agentSessionId: 'e50745d9-3b6f-4381-9e9c-48cfb838fa5f' })
    const before = requests.filter((request) => request.url.includes('/events')).length
    current = { ...current!, agentSessionId: '0b8e2d6c-1f4a-4c55-9a7e-2d3c4b5a6f70' }
    await act(async () => {
      renderer!.update(createElement(Probe, { render: 1 }))
    })
    await settle()
    await act(async () => {
      renderer!.update(createElement(Probe, { render: 2 }))
    })
    await settle()
    expect(requests.filter((request) => request.url.includes('/events')).length).toBe(before + 1)
  })
})

// A session just started may not be listed for a moment after launch (2026-10-15: "when I open a
// new tab on desktop and open claude, that session must match"). Not found is retried after 0.5,
// 1, 2 and 4 s, not after the 30 s back-off.
describe('a brand-new session listed a moment late', () => {
  it('is caught by the quick retries within the first seconds', async () => {
    let listedYet = false
    const { fetch, requests } = fakeFetch(
      apiRoutes({
        sessions: () => {
          const rows = listedYet ? [sessionRow(SESSION_A, { external_metadata: { model: 'claude-opus-5-5', effort_level: 'high' } })] : []
          listedYet = true
          return reply(200, sessionsReply(rows))
        },
        events: { [SESSION_A]: () => reply(200, eventsReply([assistantEvent('m1', 'toolu_A', '/x.png')])) }
      })
    )
    await mount({ deps: { fetch, accounts: singleAccountSource(), keep: (_key, uri) => uri, maxBytes: 1, log: () => undefined } })
    expect(reading).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    await settle()
    expect(reading).toMatchObject({ sessionId: SESSION_A, model: 'claude-opus-5-5' })
    expect(requests.filter((request) => new URL(request.url).pathname === '/v1/code/sessions')).toHaveLength(2)
  })

  it('stops the quick retries after four and waits the back-off, so a session that never appears does not spin', async () => {
    const { fetch, requests } = fakeFetch(apiRoutes({ sessions: () => reply(200, sessionsReply([])) }))
    await mount({ deps: { fetch, accounts: singleAccountSource(), keep: (_key, uri) => uri, maxBytes: 1, log: () => undefined } })
    for (let step = 0; step < 20; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
    }
    // The first try, four quick ones over 7.5 s, then nothing until the 30 s wait is out.
    expect(requests.filter((request) => new URL(request.url).pathname === '/v1/code/sessions')).toHaveLength(5)
  })
})
