/**
 * The user, 2026-10-17: "it takes 1 to 3 seconds to capture the first word … if I say 'what's
 * happening now', it captures only 'now'." The take looked up its session's account (up to 6 s)
 * before it opened the microphone, so what was said meanwhile was never heard. The microphone opens
 * at the tap; what it hears while the account is looked up is held, in order, and handed to the
 * stream once it exists, ahead of the live audio. A refusal or a cancel lets the microphone go.
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictationAccountLookup } from '../dictation/dictation-account-lookup'

const seen = vi.hoisted(() => ({
  micOpens: 0,
  begins: 0,
  releases: 0,
  chunkListener: null as ((chunk: { data: Uint8Array }) => void) | null,
  streams: [] as { audio: number[][]; connected: boolean; finalized: number; destroyed: boolean }[]
}))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    open: async () => {
      seen.micOpens += 1
      return { ok: true }
    },
    begin: () => {
      seen.begins += 1
      return true
    },
    end: async () => {},
    release: () => {
      seen.releases += 1
    },
    onChunk: (listener: (chunk: { data: Uint8Array }) => void) => {
      seen.chunkListener = listener
      return {
        remove: () => {
          if (seen.chunkListener === listener) {
            seen.chunkListener = null
          }
        }
      }
    }
  }
  return { useDictationCapture: () => instance }
})
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAnthropicCredential: async () => ({ accessToken: 'tok-1', organizationUuid: 'org-1' }),
  fetchAccountCredentials: async (only?: string) => [{ id: only ?? 'a', label: 'A', accessToken: 'tok-a', organizationUuid: 'org-a' }]
}))
vi.mock('../dictation/anthropic-voice-stream', () => ({
  AnthropicVoiceStream: class {
    private readonly record = { audio: [] as number[][], connected: false, finalized: 0, destroyed: false }
    constructor() {
      seen.streams.push(this.record)
    }
    connect(): void {
      this.record.connected = true
    }
    sendAudio(pcm: Uint8Array): void {
      this.record.audio.push([...pcm])
    }
    finalize(): Promise<string> {
      this.record.finalized += 1
      return Promise.resolve('done')
    }
    destroy(): void {
      this.record.destroyed = true
    }
  }
}))

import { MAX_HELD_AUDIO_BYTES, useAnthropicDictation, type UseAnthropicDictationResult } from './use-anthropic-dictation'

function speak(...bytes: number[]): void {
  seen.chunkListener?.({ data: new Uint8Array(bytes) })
}

async function tapWithPendingLookup(): Promise<{ hook: () => UseAnthropicDictationResult; answer: (value: DictationAccountLookup) => Promise<void>; errors: Error[] }> {
  let settle: (value: DictationAccountLookup) => void = () => {}
  const resolve = () => new Promise<DictationAccountLookup>((done) => (settle = done))
  const held: { result: UseAnthropicDictationResult | null } = { result: null }
  const errors: Error[] = []
  function Probe(): null {
    held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {}, onError: (err) => errors.push(err), chatAccount: { accountId: null, resolve } })
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  let started: Promise<void> = Promise.resolve()
  await act(async () => {
    started = held.result!.start()
  })
  return {
    hook: () => held.result!,
    answer: async (value) => {
      await act(async () => {
        settle(value)
        await started
      })
    },
    errors
  }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  seen.micOpens = 0
  seen.begins = 0
  seen.releases = 0
  seen.chunkListener = null
  seen.streams = []
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe('the first words of a take are heard while its account is looked up', () => {
  it('opens the microphone at the tap and shows the take recording before the account is known', async () => {
    const take = await tapWithPendingLookup()
    expect(seen.micOpens).toBe(1)
    expect(seen.begins).toBe(1)
    expect(take.hook().isRecording).toBe(true)
    expect(seen.streams).toEqual([])
  })

  it('hands the stream what was said during the lookup, in order, before the live audio', async () => {
    const take = await tapWithPendingLookup()
    speak(1, 1)
    speak(2, 2)
    await take.answer({ ok: true, accountId: 'acct-work' })
    speak(3)
    expect(seen.streams).toHaveLength(1)
    expect(seen.streams[0]).toMatchObject({ connected: true, audio: [[1, 1], [2, 2], [3]] })
    expect(take.hook().isRecording).toBe(true)
  })

  it('a stop during the lookup still sends what was said, then finalizes', async () => {
    const take = await tapWithPendingLookup()
    speak(4, 4)
    await act(async () => {
      await take.hook().stop()
    })
    expect(take.hook().isProcessing).toBe(true)
    await take.answer({ ok: true, accountId: 'acct-work' })
    expect(seen.streams[0]).toMatchObject({ connected: true, audio: [[4, 4]], finalized: 1 })
  })

  it('a refusal after speech lets the microphone go and says why, with nothing sent', async () => {
    const take = await tapWithPendingLookup()
    speak(5)
    await take.answer({ ok: false, reason: 'none of the 2 signed in holds it' })
    expect(take.hook().status).toBe('error')
    expect(take.hook().error).toBe('none of the 2 signed in holds it')
    expect(take.errors.map((err) => err.message)).toEqual(['none of the 2 signed in holds it'])
    expect(seen.streams).toEqual([])
    expect(seen.releases).toBe(1)
    expect(seen.chunkListener).toBeNull()
  })

  it('a refusal after a stop during the lookup still shows the refusal', async () => {
    const take = await tapWithPendingLookup()
    await act(async () => {
      await take.hook().stop()
    })
    await take.answer({ ok: false, reason: 'refused' })
    expect(take.hook().status).toBe('error')
    expect(take.hook().error).toBe('refused')
    expect(seen.streams).toEqual([])
  })

  it('a cancel during the lookup lets the microphone go and makes no stream', async () => {
    const take = await tapWithPendingLookup()
    speak(6)
    await act(async () => {
      await take.hook().cancel()
    })
    await take.answer({ ok: true, accountId: 'acct-work' })
    expect(seen.streams).toEqual([])
    expect(seen.releases).toBe(1)
    expect(take.hook().status).toBe('idle')
  })

  it('holds at most its cap during the lookup and says so once', async () => {
    const take = await tapWithPendingLookup()
    const half = MAX_HELD_AUDIO_BYTES / 2
    seen.chunkListener?.({ data: new Uint8Array(half) })
    seen.chunkListener?.({ data: new Uint8Array(half) })
    speak(7)
    speak(8)
    await take.answer({ ok: true, accountId: 'acct-work' })
    expect(seen.streams[0]!.audio.map((chunk) => chunk.length)).toEqual([half, half])
    expect(warn.mock.calls.filter((call: unknown[]) => /held while/.test(String(call[0])))).toHaveLength(1)
  })
})
