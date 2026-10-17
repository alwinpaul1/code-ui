/** Review 2026-10-17: finalize() before the socket opens must not spend its timers while connecting. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSocketHandlers } from './voice-socket'

const socket = vi.hoisted(() => ({ open: false, sent: [] as (string | number[])[], handlers: null as VoiceSocketHandlers | null }))
vi.mock('./voice-socket-opener', () => ({
  openVoiceSocket: (_u: string, _h: Record<string, string>, handlers: VoiceSocketHandlers) => {
    socket.handlers = handlers
    return {
      isOpen: () => socket.open,
      sendText: (t: string) => { if (socket.open) {socket.sent.push(t)} },
      sendBinary: (b: Uint8Array) => { if (socket.open) {socket.sent.push([...b])} },
      close: () => {}
    }
  }
}))
import { AnthropicVoiceStream } from './anthropic-voice-stream'

afterEach(() => {
  vi.useRealTimers()
})

describe('finalize before the socket opens', () => {
  it('does not resolve as "no data" before CloseStream could even be sent', async () => {
    vi.useFakeTimers()
    socket.open = false
    socket.sent = []
    const stream = new AnthropicVoiceStream({ accessToken: 't', language: 'en', protocol: 'claude-app', organizationUuid: null }, {})
    stream.connect()
    stream.sendAudio(new Uint8Array([1]))
    let reason = ''
    void stream.finalize().then((r) => { reason = r })
    // The connect takes 2 s (longer than the 1.5 s noData timer).
    await vi.advanceTimersByTimeAsync(2000)
    expect(reason).toBe('')
    socket.open = true
    socket.handlers!.onOpen()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.sent).toContain('{"type":"CloseStream"}')
    expect(reason).toBe('')
  })
})
