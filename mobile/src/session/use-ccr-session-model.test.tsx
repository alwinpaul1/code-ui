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
import {
  ACCOUNT_UUID,
  ORG_UUID,
  SESSION_A,
  TOKEN,
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
      readToken: async () => token,
      org: { read: async () => ({ accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID }), write: async () => undefined, clear: async () => undefined },
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

let current: { enabled: boolean; deps: CcrPipelineDeps; epoch: number } | null = null

function Probe(_props: { render: number }) {
  reading = useCcrSessionModel({ enabled: current!.enabled, tabId: 'tab-1', messages: MESSAGES, epoch: current!.epoch, deps: current!.deps, now: () => clock })
  return null
}

async function mount(args: { enabled?: boolean; deps: CcrPipelineDeps; epoch?: number }) {
  current = { enabled: args.enabled ?? true, deps: args.deps, epoch: args.epoch ?? 1 }
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
    expect(preferCcrModelPair(today, reading, null)).toEqual({ model: 'claude-opus-5-5', label: null, effort: 'high' })
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
  // through preferCcrModelPair with the beacon's time, so a fresh reading the
  // beacon has not overtaken states the pill, and nothing else does.
  it('goes through the session’s reported pair, weighed against the beacon', () => {
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
