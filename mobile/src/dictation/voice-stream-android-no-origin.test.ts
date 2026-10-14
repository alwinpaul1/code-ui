/**
 * Voice dictation on 0.9.140 (Samsung, 2026-10-14) failed with the toast "Voice server: WebSocket
 * connection origin is not allowed. (permission_error, req_011Cg1xc7FWhLpUepsWFFWQ9)".
 *
 * The stream opened `new WebSocket(url, undefined, { headers })`. React Native's Android
 * WebSocketModule.kt adds an `origin` header to every connection whose caller names none, and
 * voice_stream refuses a socket with any Origin. Claude Code (Node `ws`) and the Claude Android
 * app (OkHttp) send none. So on Android the stream goes through modules/orca-voice-socket, an
 * OkHttp socket with no Origin, and these tests pin that from the JavaScript side: the Android
 * opener (as Metro resolves it) hands the native layer headers with no origin, and the React
 * Native WebSocket, which would add one, is never constructed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (payload: Record<string, unknown>) => void

const native = vi.hoisted(() => ({
  present: true,
  connects: [] as { id: string; url: string; headers: Record<string, string> }[],
  texts: [] as { id: string; text: string }[],
  binaries: [] as { id: string; base64: string }[],
  closes: [] as { id: string; code: number; reason: string }[],
  listeners: new Map<string, Set<(payload: Record<string, unknown>) => void>>()
}))

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    native.present && name === 'OrcaVoiceSocket'
      ? {
          connect: (id: string, url: string, headers: Record<string, string>) => {
            native.connects.push({ id, url, headers })
          },
          sendText: (id: string, text: string) => {
            native.texts.push({ id, text })
            return true
          },
          sendBinary: (id: string, base64: string) => {
            native.binaries.push({ id, base64 })
            return true
          },
          close: (id: string, code: number, reason: string) => {
            native.closes.push({ id, code, reason })
          },
          addListener: (event: string, listener: Listener) => {
            const set = native.listeners.get(event) ?? new Set<Listener>()
            set.add(listener)
            native.listeners.set(event, set)
            return { remove: () => set.delete(listener) }
          }
        }
      : null
}))

/** React Native's Android WebSocket, as far as the server sees it: whatever headers the caller
 *  passed, plus `origin` when the caller named none (WebSocketModule.kt). */
class AndroidRnWebSocket {
  static OPEN = 1
  static sentHeaders: Record<string, string>[] = []
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason?: string }) => void) | null = null
  constructor(_url: string, _protocols: unknown, options: { headers: Record<string, string> }) {
    const named = Object.keys(options.headers).some((key) => key.toLowerCase() === 'origin')
    AndroidRnWebSocket.sentHeaders.push(
      named ? options.headers : { ...options.headers, origin: 'https://api.anthropic.com:443' }
    )
  }
  send(): void {}
  close(): void {}
}

function emit(event: string, payload: Record<string, unknown>): void {
  // A copy: a close listener removes itself and its siblings while this loop runs.
  for (const listener of Array.from(native.listeners.get(event) ?? [])) {
    listener(payload)
  }
}

function listenerCount(): number {
  let count = 0
  for (const set of native.listeners.values()) {
    count += set.size
  }
  return count
}

/** The stream as an Android build has it: Metro resolves './voice-socket-opener' to the .android
 *  file, so this does too. Fresh each time, so the opener looks for the native module again. */
async function loadStream() {
  vi.resetModules()
  vi.doMock('./voice-socket-opener', async () => await import('./voice-socket-opener.android'))
  return await import('./anthropic-voice-stream')
}

beforeEach(() => {
  native.present = true
  native.connects = []
  native.texts = []
  native.binaries = []
  native.closes = []
  native.listeners = new Map()
  AndroidRnWebSocket.sentHeaders = []
  vi.stubGlobal('WebSocket', AndroidRnWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('voice dictation on Android', () => {
  it('opens voice_stream with no Origin header, through the native socket', async () => {
    const { AnthropicVoiceStream } = await loadStream()
    new AnthropicVoiceStream({ accessToken: 'tok' }, {}).connect()

    // Nothing went through React Native's WebSocket, which would have added an origin.
    expect(AndroidRnWebSocket.sentHeaders).toEqual([])
    expect(native.connects).toHaveLength(1)
    const { url, headers } = native.connects[0]!
    expect(url).toMatch(/^wss:\/\/api\.anthropic\.com\/api\/ws\/speech_to_text\/voice_stream\?/)
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('origin')
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['x-app']).toBe('cli')
    expect(headers['User-Agent']).toMatch(/^claude-cli\/\d+\.\d+\.\d+ /)
  })

  it('takes a dictation from open to the final transcript over the native socket', async () => {
    vi.useFakeTimers()
    const { AnthropicVoiceStream } = await loadStream()
    const transcripts: [string, boolean][] = []
    let ready = 0
    const stream = new AnthropicVoiceStream(
      { accessToken: 'tok' },
      { onTranscript: (text, isFinal) => transcripts.push([text, isFinal]), onReady: () => (ready += 1) }
    )
    stream.connect()
    const id = native.connects[0]!.id

    // Audio before the socket opens is not sent.
    stream.sendAudio(new Uint8Array([9, 9]))
    expect(native.binaries).toEqual([])

    emit('onOpen', { id })
    expect(ready).toBe(1)
    expect(native.texts).toEqual([{ id, text: '{"type":"KeepAlive"}' }])
    vi.advanceTimersByTime(8000)
    expect(native.texts.map((sent) => sent.text)).toEqual(['{"type":"KeepAlive"}', '{"type":"KeepAlive"}'])

    stream.sendAudio(new Uint8Array([0, 1, 2, 250, 255]))
    expect(native.binaries).toEqual([{ id, base64: 'AAEC+v8=' }])

    // Another socket's events are not this stream's.
    emit('onMessage', { id: 'voice-other', text: JSON.stringify({ type: 'TranscriptText', data: 'nope' }) })
    expect(transcripts).toEqual([])

    const finalized = stream.finalize()
    vi.advanceTimersByTime(0)
    expect(native.texts.at(-1)).toEqual({ id, text: '{"type":"CloseStream"}' })
    // Audio after CloseStream is not sent.
    stream.sendAudio(new Uint8Array([1]))
    expect(native.binaries).toHaveLength(1)

    emit('onMessage', { id, text: JSON.stringify({ type: 'TranscriptText', data: 'hello world' }) })
    emit('onMessage', { id, text: JSON.stringify({ type: 'TranscriptEndpoint' }) })
    await expect(finalized).resolves.toBe('post_closestream_endpoint')
    expect(transcripts).toEqual([
      ['hello world', false],
      ['hello world', true]
    ])

    stream.destroy()
    expect(native.closes).toEqual([{ id, code: 1000, reason: '' }])
    expect(listenerCount()).toBe(0)
    // Nothing reaches a destroyed stream.
    emit('onMessage', { id, text: JSON.stringify({ type: 'TranscriptText', data: 'late' }) })
    expect(transcripts).toHaveLength(2)
  })

  it("reports a native failure with OkHttp's reason and the close code", async () => {
    const { AnthropicVoiceStream } = await loadStream()
    const errors: string[] = []
    let closes = 0
    const stream = new AnthropicVoiceStream(
      { accessToken: 'tok' },
      { onError: (e) => errors.push(e.message), onClose: () => (closes += 1) }
    )
    stream.connect()
    const id = native.connects[0]!.id
    emit('onError', { id, message: 'HTTP 403: Expected HTTP 101 response but was 403 Forbidden' })
    emit('onClose', { id, code: 1006, reason: 'HTTP 403: Expected HTTP 101 response but was 403 Forbidden' })
    expect(errors).toEqual([
      'Voice stream connection error: HTTP 403: Expected HTTP 101 response but was 403 Forbidden',
      'Connection closed: code 1006 — HTTP 403: Expected HTTP 101 response but was 403 Forbidden'
    ])
    expect(closes).toBe(1)
    expect(listenerCount()).toBe(0)
  })

  it("says the server's reason when it closes the native socket, and nothing for a normal close", async () => {
    const { AnthropicVoiceStream } = await loadStream()
    const errors: string[] = []
    const first = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (e) => errors.push(e.message) })
    first.connect()
    emit('onClose', { id: native.connects[0]!.id, code: 1008, reason: 'invalid token' })
    const second = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (e) => errors.push(e.message) })
    second.connect()
    emit('onClose', { id: native.connects[1]!.id, code: 1000, reason: '' })
    expect(errors).toEqual(['Connection closed: code 1008 — invalid token'])
  })

  it('surfaces an API error frame from the native socket as before', async () => {
    const { AnthropicVoiceStream } = await loadStream()
    const errors: string[] = []
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (e) => errors.push(e.message) })
    stream.connect()
    emit('onMessage', {
      id: native.connects[0]!.id,
      text: JSON.stringify({
        type: 'error',
        error: { type: 'permission_error', message: 'WebSocket connection origin is not allowed.' },
        request_id: 'req_011Cg1xc7FWhLpUepsWFFWQ9'
      })
    })
    expect(errors).toEqual([
      'Voice server: WebSocket connection origin is not allowed. (permission_error, req_011Cg1xc7FWhLpUepsWFFWQ9)'
    ])
  })

  it("falls back to React Native's WebSocket, and says so, when the native module is absent", async () => {
    native.present = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { AnthropicVoiceStream } = await loadStream()
    new AnthropicVoiceStream({ accessToken: 'tok' }, {}).connect()
    expect(native.connects).toEqual([])
    expect(AndroidRnWebSocket.sentHeaders).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('OrcaVoiceSocket is not in this build'))
  })
})
