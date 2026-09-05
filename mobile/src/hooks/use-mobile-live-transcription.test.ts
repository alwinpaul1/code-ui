import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { speechLevel, useMobileLiveTranscription } from './use-mobile-live-transcription'

vi.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }))

type Listener = (event: never) => void

function fakeRecognizer() {
  const listeners = new Map<string, Set<Listener>>()
  const emit = (name: string, event: unknown) => {
    for (const listener of listeners.get(name) ?? []) {
      listener(event as never)
    }
  }
  return {
    emit,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
    isRecognitionAvailable: () => true,
    addListener: (name: string, listener: Listener) => {
      const set = listeners.get(name) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(name, set)
      return { remove: () => set.delete(listener) }
    }
  }
}

describe('useMobileLiveTranscription', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  function mount(recognizer: ReturnType<typeof fakeRecognizer>) {
    const onTranscript = vi.fn()
    let latest: ReturnType<typeof useMobileLiveTranscription> | null = null
    function Harness(): null {
      latest = useMobileLiveTranscription({ onTranscript }, recognizer as never)
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    return { api: () => latest!, onTranscript }
  }

  it('streams partials, then the final text on release', async () => {
    const recognizer = fakeRecognizer()
    const { api, onTranscript } = mount(recognizer)
    await act(async () => {
      await api().start()
    })
    expect(recognizer.start).toHaveBeenCalledWith(
      expect.objectContaining({ interimResults: true, continuous: true })
    )
    act(() => recognizer.emit('start', {}))
    expect(api().isRecording).toBe(true)
    act(() => recognizer.emit('result', { isFinal: false, results: [{ transcript: 'fix the' }] }))
    act(() => recognizer.emit('result', { isFinal: true, results: [{ transcript: 'fix the bug' }] }))
    act(() => recognizer.emit('result', { isFinal: false, results: [{ transcript: 'in login' }] }))
    expect(onTranscript.mock.calls.map(([text, final]) => [text, final])).toEqual([
      ['fix the', false],
      ['fix the bug', false],
      ['fix the bug in login', false]
    ])
    await act(async () => {
      await api().stop()
    })
    expect(recognizer.stop).toHaveBeenCalled()
    act(() => recognizer.emit('end', {}))
    expect(onTranscript).toHaveBeenLastCalledWith('fix the bug in login', true)
    expect(api().status).toBe('idle')
  })

  it('cancel aborts without reporting a transcript', async () => {
    const recognizer = fakeRecognizer()
    const { api, onTranscript } = mount(recognizer)
    await act(async () => {
      await api().start()
    })
    act(() => recognizer.emit('result', { isFinal: false, results: [{ transcript: 'never' }] }))
    onTranscript.mockClear()
    await act(async () => {
      await api().cancel()
    })
    expect(recognizer.abort).toHaveBeenCalled()
    act(() => recognizer.emit('error', { error: 'aborted', message: '' }))
    act(() => recognizer.emit('end', {}))
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('moves the meter only while speech is detected, above the room noise', async () => {
    const recognizer = fakeRecognizer()
    const { api } = mount(recognizer)
    await act(async () => {
      await api().start()
    })
    act(() => recognizer.emit('start', {}))
    // A noisy room before anyone speaks: bars stay down.
    act(() => recognizer.emit('volumechange', { value: 4 }))
    act(() => recognizer.emit('volumechange', { value: 4 }))
    expect(api().level).toBe(0)
    act(() => recognizer.emit('speechstart', {}))
    act(() => recognizer.emit('volumechange', { value: 8 }))
    expect(api().level).toBeGreaterThan(0.3)
    // Speech at the same loudness as the room noise does not register.
    act(() => recognizer.emit('volumechange', { value: 1 }))
    expect(api().level).toBe(0)
    act(() => recognizer.emit('speechend', {}))
    act(() => recognizer.emit('volumechange', { value: 9 }))
    expect(api().level).toBe(0)
  })

  it('stretches the level above the noise floor', () => {
    expect(speechLevel(0.2, 0.2)).toBe(0)
    expect(speechLevel(0.5, 0)).toBeCloseTo((0.5 - 0.06) / 0.94, 3)
    expect(speechLevel(1, 0.5)).toBe(1)
  })
})
