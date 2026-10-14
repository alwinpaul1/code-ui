/**
 * The Anthropic engine's microphone level, read from the PCM it already streams. It is the only
 * engine now (phone sign-in is mandatory), and it reported no level at all, so the recording row's
 * waveform was a flat line of dots whatever the user said (2026-10-14).
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { DictationCaptureChunk } from '../platform/dictation-capture-contract'

const capture = vi.hoisted(() => ({
  handler: null as ((chunk: DictationCaptureChunk) => void) | null,
  sent: 0
}))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    open: async () => ({ ok: true }),
    begin: () => true,
    end: async () => {},
    release: () => {},
    onChunk: (handler: (chunk: DictationCaptureChunk) => void) => {
      capture.handler = handler
      return { remove: () => (capture.handler = null) }
    }
  }
  return { useDictationCapture: () => instance }
})
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAnthropicCredential: async () => ({ accessToken: 'test-token' })
}))
vi.mock('../dictation/anthropic-voice-stream', () => ({
  AnthropicVoiceStream: class {
    connect(): void {}
    sendAudio(): void {
      capture.sent += 1
    }
    finalize(): Promise<void> {
      return Promise.resolve()
    }
    destroy(): void {}
  }
}))

import { useAnthropicDictation, type UseAnthropicDictationResult } from './use-anthropic-dictation'

function pcm(amplitude: number): DictationCaptureChunk {
  const data = new Uint8Array(1024)
  const view = new DataView(data.buffer)
  for (let i = 0; i < 512; i++) {
    view.setInt16(i * 2, Math.round(Math.sin(i / 3) * amplitude * 32767), true)
  }
  return { data, droppedBytes: 0 }
}

async function mountRecording(): Promise<{ hook: () => UseAnthropicDictationResult; renders: () => number }> {
  const held: { result: UseAnthropicDictationResult | null; renders: number } = { result: null, renders: 0 }
  function Probe(): null {
    held.renders += 1
    held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {} })
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  await act(async () => {
    await held.result!.start()
  })
  return { hook: () => held.result!, renders: () => held.renders }
}

describe('the Anthropic engine’s microphone level', () => {
  it('reads speech in the streamed audio as a level, and silence as none', async () => {
    const { hook } = await mountRecording()
    expect(hook().isRecording).toBe(true)
    act(() => capture.handler!(pcm(0.05)))
    expect(hook().levelSource.current).toBeGreaterThan(0.2)
    act(() => capture.handler!(pcm(0)))
    expect(hook().levelSource.current).toBe(0)
    // The audio still goes to the server: the level is read beside it, not instead of it.
    expect(capture.sent).toBeGreaterThanOrEqual(2)
  })

  it('does not re-render the screen for each chunk', async () => {
    const { hook, renders } = await mountRecording()
    const before = renders()
    act(() => {
      for (let i = 0; i < 30; i++) {
        capture.handler!(pcm(i % 2 === 0 ? 0.05 : 0))
      }
    })
    expect(renders()).toBe(before)
    expect(hook().levelSource.current).toBe(0)
  })

  it('keeps the last level through an empty or odd-length chunk, and drops to 0 when the take ends', async () => {
    const { hook } = await mountRecording()
    act(() => capture.handler!(pcm(0.05)))
    const speaking = hook().levelSource.current
    act(() => capture.handler!({ data: new Uint8Array(0), droppedBytes: 0 }))
    act(() => capture.handler!({ data: new Uint8Array(3), droppedBytes: 0 }))
    expect(hook().levelSource.current).toBe(speaking)
    await act(async () => {
      await hook().cancel()
    })
    expect(hook().levelSource.current).toBe(0)
  })
})
