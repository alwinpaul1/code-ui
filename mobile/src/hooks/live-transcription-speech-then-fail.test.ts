// Review of 5c7643bd (2026-09-26), failing there: a failure after the engine heard speech dropped the sentence silently.
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

describe.each([['live transcription', headHook]])('%s: the engine heard speech, then failed before its first partial', (_label, hook) => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  it('tells the user the take failed instead of silently dropping what they said', async () => {
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
    // onReadyForSpeech: the screen says "recording", so the user talks.
    act(() => recognizer.emit('start', {}))
    expect(latest!.isRecording).toBe(true)
    // onBeginningOfSpeech: the engine has detected the user's voice.
    act(() => recognizer.emit('speechstart', {}))
    // No partial yet (server-side recognition on a flaky link), then it fails.
    act(() => recognizer.emit('error', { error: 'network', message: 'Other network related errors.' }))
    act(() => recognizer.emit('end', {}))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(recognizer.start).toHaveBeenCalledTimes(1)
  })
})
