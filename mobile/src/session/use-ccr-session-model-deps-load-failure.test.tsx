import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// Found 2026-10-14: answered-prompt-terminal-notice.test.tsx passed 8 of 8 and still failed the
// gate with 7 "Unhandled Rejection" errors, a Flow parse failure in react-native/index.js. The
// importer chain: the composer's model pill (use-ccr-session-model.ts) has no deps injected, so
// it loads the real ones with import() (use-ccr-session-images.ts loadDefaultCcrPipelineDeps),
// and ccr-session-default-deps → dictation/anthropic-auth-store → expo-secure-store →
// expo-modules-core → react-native cannot load under Node. The hook ran `void step()` with no
// catch, so the rejected load escaped on every mount and every refresh tick. On the phone the
// same load fails whenever the secure store or the chunk does, and nothing said why.
//
// The deps fail to come up, so the deps promise the hook awaits rejects. (A factory that throws
// would reject the import() too, but vitest swaps its message for a generic one about hoisting.)
vi.mock('./ccr-session-default-deps', () => ({
  defaultCcrPipelineDeps: () => {
    throw new Error('secure store unavailable')
  }
}))

import { useCcrSessionModel } from './use-ccr-session-model'
import { CCR_MODEL_REFRESH_MS, resetCcrModelForTests } from './ccr-session-model'
import { resetCcrPipelineForTests } from './ccr-session-pipeline'

const MESSAGES: NativeChatMessage[] = [{ id: 'm1', role: 'assistant', timestamp: 0, source: 'transcript', blocks: [{ type: 'text', text: 'hi' }] }]

let renderer: ReactTestRenderer | null = null
const escaped: unknown[] = []
const onUnhandled = (reason: unknown) => {
  escaped.push(reason)
}

function Probe() {
  useCcrSessionModel({ enabled: true, tabId: 'tab-1', messages: MESSAGES, epoch: 1 })
  return null
}

async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  // Unhandled rejections are reported after the microtask queue drains.
  await new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  escaped.length = 0
  process.on('unhandledRejection', onUnhandled)
  resetCcrPipelineForTests()
  resetCcrModelForTests()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  process.off('unhandledRejection', onUnhandled)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the composer model pill when its Anthropic deps cannot load', () => {
  it('leaves no unhandled rejection on mount or on a refresh tick, and names why it stopped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await act(async () => {
      renderer = create(createElement(Probe))
    })
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CCR_MODEL_REFRESH_MS)
    })
    await settle()

    expect(escaped).toEqual([])
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.filter((line) => line !== '[ccr-model] could not run: secure store unavailable')).toEqual([])
  })
})
