// Review of 5c7643bd (2026-09-26), failing there: a mic lost to a call reopened on the default engine and dropped Google.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileLiveTranscription as headHook } from './use-mobile-live-transcription'

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }))

type Listener = (event: never) => void
const GOOGLE_APP = 'com.google.android.googlequicksearchbox'
const SAMSUNG = 'com.samsung.android.bixby.agent'

function samsungPhoneWithGoogle() {
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
    getSpeechRecognitionServices: vi.fn(() => [SAMSUNG, GOOGLE_APP]),
    getDefaultRecognitionService: vi.fn(() => ({ packageName: SAMSUNG })),
    addListener: (name: string, listener: Listener) => {
      const set = listeners.get(name) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(name, set)
      return { remove: () => set.delete(listener) }
    }
  }
}

// What expo-speech-recognition 3.1.3 sends when the recognizer reports
// SpeechRecognizer.ERROR_AUDIO (ExpoSpeechService.getErrorInfo): the mic could
// not be read, e.g. a phone call or another app holds it. main's own comment on
// QUIET_STOP_ERRORS: "A call taking the mic stops the take and leaves the words
// already heard". The library's "no service found" case is different: code -1,
// message "No service found for package ...".
const MIC_TAKEN = { error: 'audio-capture', message: 'Audio recording error.', code: 3 }

describe.each([['live transcription', headHook]])('%s: a call takes the mic before any words on a Samsung phone with the Google app', (_label, hook) => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  it('ends the take quietly and does not reopen the microphone', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recognizer = samsungPhoneWithGoogle()
    const onTranscript = vi.fn()
    const onError = vi.fn()
    let latest: ReturnType<typeof headHook> | null = null
    function Harness(): null {
      latest = hook({ onTranscript, onError }, recognizer as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await latest!.start()
    })
    // Native order: error, then teardownAndEnd posts `end`.
    act(() => recognizer.emit('error', MIC_TAKEN))
    act(() => recognizer.emit('end', {}))
    expect(recognizer.start).toHaveBeenCalledTimes(1)
    expect(latest!.status).toBe('idle')
    expect(onTranscript).toHaveBeenLastCalledWith('', true, '')
    expect(onError).not.toHaveBeenCalled()
  })
})

describe("a call taking the mic is not Google's engine failing", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  it("still dictates the next take with Google's engine", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recognizer = samsungPhoneWithGoogle()
    let latest: ReturnType<typeof headHook> | null = null
    function Harness(): null {
      latest = headHook({ onTranscript: vi.fn(), onError: vi.fn() }, recognizer as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => {
      await latest!.start()
    })
    act(() => recognizer.emit('error', MIC_TAKEN))
    act(() => recognizer.emit('end', {}))
    // Whatever happened to that take, finish it, then the call is over.
    await act(async () => {
      await latest!.cancel()
    })
    act(() => recognizer.emit('error', { error: 'aborted', message: '' }))
    act(() => recognizer.emit('end', {}))
    recognizer.start.mockClear()
    await act(async () => {
      await latest!.start()
    })
    expect(recognizer.start).toHaveBeenCalledWith(
      expect.objectContaining({ androidRecognitionServicePackage: GOOGLE_APP })
    )
  })
})
