/** Review 2026-10-17: cancel then tap again while the first take's account lookup runs. The first
 *  take's `stillWanted` reads the shared activeRef, which the second tap set true again, so both
 *  takes go on to open the microphone. */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ micOpens: 0, streams: 0 }))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    open: async () => {
      seen.micOpens += 1
      return { ok: true }
    },
    begin: () => true,
    end: async () => {},
    release: () => {},
    onChunk: () => ({ remove: () => {} })
  }
  return { useDictationCapture: () => instance }
})
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAnthropicCredential: async () => null,
  fetchAccountCredentials: async () => [{ id: 'a', label: 'A', accessToken: 't', organizationUuid: 'o' }]
}))
vi.mock('../dictation/anthropic-voice-stream', () => ({
  AnthropicVoiceStream: class {
    constructor() {
      seen.streams += 1
    }
    connect(): void {}
    sendAudio(): void {}
    finalize(): Promise<void> {
      return Promise.resolve()
    }
    destroy(): void {}
  }
}))
import { useAnthropicDictation, type UseAnthropicDictationResult } from './use-anthropic-dictation'

describe('a cancelled take does not open the microphone', () => {
  it("makes one stream, the second take's, when a take is cancelled and re-tapped during the account lookup", async () => {
    const releases: (() => void)[] = []
    const resolve = () => new Promise<{ ok: true; accountId: string }>((done) => releases.push(() => done({ ok: true, accountId: 'a' })))
    const held: { result: UseAnthropicDictationResult | null } = { result: null }
    function Probe(): null {
      held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {}, chatAccount: { accountId: null, resolve } })
      return null
    }
    await act(async () => {
      create(createElement(Probe))
    })
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = held.result!.start()
    })
    await act(async () => {
      await held.result!.cancel()
    })
    await act(async () => {
      second = held.result!.start()
    })
    await act(async () => {
      releases.forEach((release) => release())
      await Promise.all([first, second])
    })
    // Each tap opens the mic at once (first-words fix, 2026-10-17); only the second take gets a stream.
    expect(seen.micOpens).toBe(2)
    expect(seen.streams).toBe(1)
  })
})
