// Review of 5c7643bd (2026-09-26), failing there: a service listing that is not an array broke every take.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_SILENCE_STOP_MS } from './mobile-live-transcript'
import { useMobileLiveTranscription } from './use-mobile-live-transcription'

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }))

type Listener = (event: never) => void
const SAMSUNG = 'com.samsung.android.bixby.agent'

const BASE_START_OPTIONS = {
  lang: 'en-US',
  interimResults: true,
  continuous: true,
  maxAlternatives: 1,
  addsPunctuation: true,
  volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
  androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: DICTATION_SILENCE_STOP_MS }
}

function phoneWithListing(listing: unknown) {
  const listeners = new Map<string, Set<Listener>>()
  return {
    emit: (name: string, event: unknown) => {
      for (const listener of listeners.get(name) ?? []) {
        listener(event as never)
      }
    },
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    isRecognitionAvailable: () => true,
    getSpeechRecognitionServices: vi.fn(() => listing),
    getDefaultRecognitionService: vi.fn(() => ({ packageName: SAMSUNG })),
    addListener: (name: string, listener: Listener) => {
      const set = listeners.get(name) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(name, set)
      return { remove: () => set.delete(listener) }
    }
  }
}

describe('a service listing that is not an array', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  it('keeps the default engine and still opens the mic, as a throwing listing does', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recognizer = phoneWithListing({})
    let latest: ReturnType<typeof useMobileLiveTranscription> | null = null
    function Harness(): null {
      latest = useMobileLiveTranscription({ onTranscript: vi.fn(), onError: vi.fn() }, recognizer as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    let rejection: unknown = null
    await act(async () => {
      await latest!.start().catch((err: unknown) => {
        rejection = err
      })
    })
    expect(rejection).toBeNull()
    expect(recognizer.start).toHaveBeenCalledWith(BASE_START_OPTIONS)
  })

  it('does not leave the mic button stuck on starting', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recognizer = phoneWithListing({})
    let latest: ReturnType<typeof useMobileLiveTranscription> | null = null
    function Harness(): null {
      latest = useMobileLiveTranscription({ onTranscript: vi.fn(), onError: vi.fn() }, recognizer as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await latest!.start().catch(() => {})
    })
    // The take starts on the default engine and records once the engine says so.
    act(() => recognizer.emit('start', {}))
    expect(latest!.status).toBe('recording')
  })
})
