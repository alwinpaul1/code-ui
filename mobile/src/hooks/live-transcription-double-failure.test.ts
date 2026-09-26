// Review of 5c7643bd (2026-09-26), failing there: a failure reported twice left an open mic nothing could stop.
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileLiveTranscription } from './use-mobile-live-transcription'

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

describe("a pinned engine that reports its failure twice (ExpoSpeechService.onError runs twice before the posted teardown)", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  function mount(recognizer: ReturnType<typeof samsungPhoneWithGoogle>) {
    const onTranscript = vi.fn()
    const onError = vi.fn()
    let latest: ReturnType<typeof useMobileLiveTranscription> | null = null
    function Harness(): null {
      latest = useMobileLiveTranscription({ onTranscript, onError }, recognizer as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    return { api: () => latest!, onTranscript, onError }
  }

  it("keeps the retry's take alive and stoppable when the failed attempt's second end lands after the retry opened the mic", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recognizer = samsungPhoneWithGoogle()
    const { api, onTranscript } = mount(recognizer)
    await act(async () => {
      await api().start()
    })
    // Each onError sends `error` and posts its own teardownAndEnd, so two
    // errors queued before the first teardown arrive as error, error, end, end.
    act(() => recognizer.emit('error', { error: 'client', message: 'Other client side errors.' }))
    act(() => recognizer.emit('error', { error: 'network', message: 'Server disconnected.' }))
    act(() => recognizer.emit('end', {}))
    // The first end reopened the mic on the default engine.
    expect(recognizer.start).toHaveBeenCalledTimes(2)
    // The second end belongs to the failed Google attempt, not to the retry.
    act(() => recognizer.emit('end', {}))
    // The retry's engine comes up and the user speaks.
    act(() => recognizer.emit('start', {}))
    expect(api().isRecording).toBe(true)
    act(() => recognizer.emit('result', { isFinal: false, results: [{ transcript: 'fix the bug' }] }))
    expect(onTranscript).toHaveBeenLastCalledWith('fix the bug', false, 'fix the bug')
    // And the mic button can still stop the mic the retry opened.
    await act(async () => {
      await api().stop()
    })
    expect(recognizer.stop).toHaveBeenCalledTimes(1)
  })

  it('lets the mic button stop the mic the retry opened, after the stale second end', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const recognizer = samsungPhoneWithGoogle()
    const { api } = mount(recognizer)
    await act(async () => {
      await api().start()
    })
    act(() => recognizer.emit('error', { error: 'client', message: 'Other client side errors.' }))
    act(() => recognizer.emit('error', { error: 'network', message: 'Server disconnected.' }))
    act(() => recognizer.emit('end', {}))
    act(() => recognizer.emit('end', {}))
    act(() => recognizer.emit('start', {}))
    // The screen shows a live mic...
    expect(api().isRecording).toBe(true)
    // ...so the tap goes to stop() (handleDictationToggle / handleDictationPressOut).
    await act(async () => {
      await api().stop()
    })
    expect(recognizer.stop.mock.calls.length + recognizer.abort.mock.calls.length).toBeGreaterThan(0)
  })
})
