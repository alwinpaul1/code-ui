/** Review 2026-10-17 of the mic-at-tap reorder: races inside capture.open(). */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({
  begins: 0,
  ends: 0,
  releases: 0,
  openGate: null as (() => void) | null,
  finalized: 0,
  streams: 0
}))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    // Resolves ok only when the test opens the gate, as initialize() can after a cancel.
    open: () => new Promise((done) => { seen.openGate = () => done({ ok: true }) }),
    begin: () => {
      seen.begins += 1
      return true
    },
    end: async () => {
      seen.ends += 1
    },
    release: () => {
      seen.releases += 1
    },
    onChunk: () => ({ remove: () => {} })
  }
  return { useDictationCapture: () => instance }
})
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAnthropicCredential: async () => ({ accessToken: 't', organizationUuid: 'o' }),
  fetchAccountCredentials: async () => []
}))
vi.mock('../dictation/anthropic-voice-stream', () => ({
  AnthropicVoiceStream: class {
    constructor() {
      seen.streams += 1
    }
    connect(): void {}
    sendAudio(): void {}
    finalize(): Promise<string> {
      seen.finalized += 1
      return Promise.resolve('done')
    }
    destroy(): void {}
  }
}))
import { useAnthropicDictation, type UseAnthropicDictationResult } from './use-anthropic-dictation'

beforeEach(() => {
  seen.begins = 0
  seen.ends = 0
  seen.releases = 0
  seen.openGate = null
  seen.finalized = 0
  seen.streams = 0
})

async function mount(): Promise<{ hook: () => UseAnthropicDictationResult }> {
  const held: { result: UseAnthropicDictationResult | null } = { result: null }
  function Probe(): null {
    held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {} })
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  return { hook: () => held.result! }
}

describe('the microphone opened at the tap', () => {
  it('is not left recording when the take is cancelled while capture.open is still pending', async () => {
    const { hook } = await mount()
    let started: Promise<void> = Promise.resolve()
    await act(async () => {
      started = hook().start()
    })
    await act(async () => {
      await hook().cancel()
    })
    const endsAfterCancel = seen.ends
    await act(async () => {
      seen.openGate!()
      await started
    })
    // A cancelled take must not begin recording once open() finally answers ok.
    expect(seen.begins).toBe(0)
    expect(hook().status).toBe('idle')
    expect(seen.ends).toBeGreaterThanOrEqual(endsAfterCancel)
  })

  it('still finalizes a take stopped while capture.open is pending', async () => {
    const { hook } = await mount()
    let started: Promise<void> = Promise.resolve()
    await act(async () => {
      started = hook().start()
    })
    await act(async () => {
      await hook().stop()
    })
    await act(async () => {
      seen.openGate!()
      await started
    })
    expect(seen.finalized).toBe(1)
    expect(hook().status).not.toBe('recording')
  })
})
