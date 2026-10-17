/**
 * The user, 2026-10-17: "it takes 1 to 3 seconds to capture the first word … if I say 'what's
 * happening now', it captures only 'now'." Every chunk the stream was handed before voice_stream's
 * socket opened went to sendBinary, which drops anything sent on a socket that is not open yet, so
 * the first half second or more of every take never reached the server. Audio sent before the
 * socket opens is kept, in order and capped, and goes out right after the opening KeepAlive; a
 * CloseStream asked for before then goes after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSocketHandlers } from './voice-socket'

const socket = vi.hoisted(() => ({
  open: false,
  sent: [] as (string | number[])[],
  handlers: null as VoiceSocketHandlers | null,
  closed: 0
}))
vi.mock('./voice-socket-opener', () => ({
  openVoiceSocket: (_url: string, _headers: Record<string, string>, handlers: VoiceSocketHandlers) => {
    socket.handlers = handlers
    return {
      isOpen: () => socket.open,
      sendText: (text: string) => {
        if (socket.open) {
          socket.sent.push(text)
        }
      },
      sendBinary: (bytes: Uint8Array) => {
        if (socket.open) {
          socket.sent.push([...bytes])
        }
      },
      close: () => {
        socket.closed += 1
      }
    }
  }
}))

import { AnthropicVoiceStream, FINALIZE_CONNECT_TIMEOUT_MS, MAX_AUDIO_BEFORE_OPEN_BYTES } from './anthropic-voice-stream'

const KEEPALIVE = '{"type":"KeepAlive"}'
const CLOSESTREAM = '{"type":"CloseStream"}'
function opens(): void {
  socket.open = true
  socket.handlers!.onOpen()
}

beforeEach(() => {
  socket.open = false
  socket.sent = []
  socket.handlers = null
  socket.closed = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the first words of a take reach voice_stream', () => {
  it('sends the audio spoken before the socket opened, in order, right after the KeepAlive', () => {
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, {})
    stream.connect()
    stream.sendAudio(new Uint8Array([1, 1]))
    stream.sendAudio(new Uint8Array([2, 2]))
    expect(socket.sent).toEqual([])
    opens()
    stream.sendAudio(new Uint8Array([3]))
    expect(socket.sent).toEqual([KEEPALIVE, [1, 1], [2, 2], [3]])
    stream.destroy()
  })

  it('sends a CloseStream asked for before the socket opened after the audio held for it', async () => {
    vi.useFakeTimers()
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, {})
    stream.connect()
    stream.sendAudio(new Uint8Array([7]))
    void stream.finalize()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.sent).toEqual([])
    opens()
    expect(socket.sent).toEqual([KEEPALIVE, [7], CLOSESTREAM])
    stream.destroy()
  })

  it('sends nothing held once the stream is destroyed before the socket opens', () => {
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, {})
    stream.connect()
    stream.sendAudio(new Uint8Array([5]))
    const handlers = socket.handlers!
    stream.destroy()
    socket.open = true
    handlers.onOpen()
    expect(socket.sent.filter((entry) => Array.isArray(entry))).toEqual([])
  })

  it('drops what was held when the socket fails before it opens, and holds no more', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: () => {} })
    stream.connect()
    stream.sendAudio(new Uint8Array([5]))
    socket.handlers!.onError('refused')
    socket.handlers!.onClose(1006, 'refused')
    stream.sendAudio(new Uint8Array([6]))
    socket.open = true
    socket.handlers!.onOpen()
    expect(socket.sent.filter((entry) => Array.isArray(entry))).toEqual([])
  })

  it('holds at most its cap before the socket opens, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, {})
    stream.connect()
    const half = MAX_AUDIO_BEFORE_OPEN_BYTES / 2
    stream.sendAudio(new Uint8Array(half).fill(1))
    stream.sendAudio(new Uint8Array(half).fill(2))
    stream.sendAudio(new Uint8Array([3]))
    stream.sendAudio(new Uint8Array([4]))
    opens()
    expect(socket.sent.filter((entry) => Array.isArray(entry)).map((entry) => (entry as number[]).length)).toEqual([half, half])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/\[dictation\].*before voice_stream opened/)
    stream.destroy()
  })

  it('a take finalized before the socket opens still ends when the socket never opens, and says why', async () => {
    vi.useFakeTimers()
    const errors: string[] = []
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (err) => errors.push(err.message) })
    stream.connect()
    let reason = ''
    void stream.finalize().then((value) => (reason = value))
    await vi.advanceTimersByTimeAsync(FINALIZE_CONNECT_TIMEOUT_MS - 1)
    expect(reason).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    expect(reason).toBe('connect_timeout')
    expect(errors).toEqual([`Voice stream did not connect within ${FINALIZE_CONNECT_TIMEOUT_MS / 1000} s`])
    expect(socket.closed).toBe(1)
  })

  it('a take finalized before the socket opens ends at once when the socket closes instead', async () => {
    vi.useFakeTimers()
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: () => {} })
    stream.connect()
    let reason = ''
    void stream.finalize().then((value) => (reason = value))
    socket.handlers!.onError('refused')
    socket.handlers!.onClose(1006, 'refused')
    await vi.advanceTimersByTimeAsync(0)
    expect(reason).toBe('ws_close')
  })

  it('times a CloseStream sent on open from when it was sent', async () => {
    vi.useFakeTimers()
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, {})
    stream.connect()
    let reason = ''
    void stream.finalize().then((value) => (reason = value))
    await vi.advanceTimersByTimeAsync(3000)
    opens()
    await vi.advanceTimersByTimeAsync(1499)
    expect(reason).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    expect(reason).toBe('no_data_timeout')
  })
})
