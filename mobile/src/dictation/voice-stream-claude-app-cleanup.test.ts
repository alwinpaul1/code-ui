/**
 * "When I transcribe something and it appears above the composer, it gets auto-corrected in
 * Claude" (the user, 2026-10-16). Code UI's caption kept the words as first heard.
 *
 * How the Claude Android app 1.261013.20 does it (decompiled, `claude-apk-1013/out`):
 *
 * - It opens voice_stream with `encoding, sample_rate, channels, language, forward_interims=typed,
 *   organization_uuid` and an optional `conversation_uuid` (r4u.java:1018-1020). No
 *   `use_conversation_engine`, no `endpointing_ms`, no `utterance_end_ms`: those are Claude Code's.
 * - It knows three server messages (nkt.java): TranscriptText, TranscriptInterim and
 *   AudioCaptureStarted. TranscriptText is a COMMITTED segment: appended to a buffer, and the live
 *   interim cleared. TranscriptInterim REPLACES the live tail (j3i.java:846-851).
 * - What is drawn is committed + interim, one string (a3x.q, wc00.a, hqs.A is plain `a + b`).
 *   So the server's committed text takes the place of the words it was heard as. There is no
 *   second request and no filler regex on the phone: the correction is the server's.
 *
 * Code UI took every TranscriptText and TranscriptInterim as the whole transcript so far (Claude
 * Code's `use_conversation_engine` contract) and asked for Claude Code's parameter set. These pin
 * the Claude app's set and model, and that nothing heard is lost when the correction never comes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSocketHandlers } from './voice-socket'

const socket = vi.hoisted(() => ({
  urls: [] as string[],
  texts: [] as string[],
  handlers: null as VoiceSocketHandlers | null
}))

vi.mock('./voice-socket-opener', () => ({
  openVoiceSocket: (url: string, _headers: Record<string, string>, handlers: VoiceSocketHandlers) => {
    socket.urls.push(url)
    socket.handlers = handlers
    return {
      isOpen: () => true,
      sendText: (text: string) => socket.texts.push(text),
      sendBinary: () => undefined,
      close: () => undefined
    }
  }
}))

import { AnthropicVoiceStream } from './anthropic-voice-stream'

const ORG = '0b5c8a0e-1111-4222-8333-944455556666'

function serverSays(type: string, data?: string): void {
  socket.handlers?.onMessage(JSON.stringify(data === undefined ? { type } : { type, data }))
}

function claudeAppStream(organizationUuid: string | null = ORG) {
  const heard: [string, boolean][] = []
  const errors: string[] = []
  const stream = new AnthropicVoiceStream(
    { accessToken: 'tok', protocol: 'claude-app', organizationUuid },
    { onTranscript: (text, final) => heard.push([text, final]), onError: (e) => errors.push(e.message) }
  )
  stream.connect()
  socket.handlers?.onOpen()
  return { stream, heard, errors }
}

function query(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries())
}

beforeEach(() => {
  socket.urls = []
  socket.texts = []
  socket.handlers = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dictation corrected the way the Claude app corrects it', () => {
  it('asks voice_stream for the parameters the Claude app sends', () => {
    claudeAppStream()
    expect(query(socket.urls[0]!)).toEqual({
      // The Claude app encodes Opus in process; the phone streams the 16 kHz PCM it captures.
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      language: 'en',
      forward_interims: 'typed',
      organization_uuid: ORG
    })
  })

  it('leaves organization_uuid out when the account has none, and sends nothing of Claude Code', () => {
    claudeAppStream(null)
    const params = query(socket.urls[0]!)
    expect(params).not.toHaveProperty('organization_uuid')
    expect(params).not.toHaveProperty('use_conversation_engine')
    expect(params).not.toHaveProperty('endpointing_ms')
    expect(params).not.toHaveProperty('utterance_end_ms')
  })

  it('replaces the live words with the corrected text the server commits', () => {
    const { heard } = claudeAppStream()
    serverSays('TranscriptInterim', 'um so i want')
    serverSays('TranscriptText', 'So I want')
    serverSays('TranscriptInterim', ' to uh test this')
    serverSays('TranscriptText', ' to test this.')
    expect(heard).toEqual([
      ['um so i want', false],
      ['So I want', false],
      ['So I want to uh test this', false],
      ['So I want to test this.', false]
    ])
  })

  it('moves the corrected words in when the server closes after the mic is released', async () => {
    const { stream, heard } = claudeAppStream()
    serverSays('TranscriptInterim', 'um hello there')
    serverSays('TranscriptText', 'Hello there.')
    const done = stream.finalize()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(socket.texts).toContain('{"type":"CloseStream"}')
    socket.handlers?.onClose(1000, '')
    await expect(done).resolves.toBe('ws_close')
    expect(heard.at(-1)).toEqual(['Hello there.', true])
  })

  it('does not end the take on an endpoint while the mic is still held', () => {
    const { heard } = claudeAppStream()
    serverSays('TranscriptText', 'First part.')
    serverSays('TranscriptEndpoint')
    serverSays('TranscriptInterim', ' and more')
    expect(heard).toEqual([
      ['First part.', false],
      ['First part. and more', false]
    ])
  })

  it('keeps the corrected words and the uncorrected tail when the correction never arrives', async () => {
    vi.useFakeTimers()
    const { stream, heard } = claudeAppStream()
    serverSays('TranscriptText', 'Hello there.')
    serverSays('TranscriptInterim', ' um one more thing')
    const done = stream.finalize()
    vi.advanceTimersByTime(5000)
    await expect(done).resolves.toBe('no_data_timeout')
    expect(heard.at(-1)).toEqual(['Hello there. um one more thing', true])
  })

  it('keeps every word heard when the server errors mid-take', () => {
    const { heard, errors } = claudeAppStream()
    serverSays('TranscriptText', 'Hello there.')
    serverSays('TranscriptInterim', ' and then')
    socket.handlers?.onMessage(JSON.stringify({ type: 'TranscriptError', description: 'model overloaded' }))
    expect(heard.at(-1)).toEqual(['Hello there. and then', true])
    expect(errors).toEqual(['model overloaded'])
  })

  it('keeps the take when the socket drops before any correction', () => {
    const { heard, errors } = claudeAppStream()
    serverSays('TranscriptInterim', 'um hello')
    socket.handlers?.onClose(1006, 'gone')
    expect(heard).toEqual([
      ['um hello', false],
      ['um hello', true]
    ])
    expect(errors).toEqual(['Connection closed: code 1006 — gone'])
  })

  it('clears the caption when the server commits nothing for the words it showed', () => {
    const { heard } = claudeAppStream()
    serverSays('TranscriptInterim', 'um')
    serverSays('TranscriptText', '')
    expect(heard).toEqual([
      ['um', false],
      ['', false]
    ])
  })

  it('starts each take with nothing committed', () => {
    const { stream, heard } = claudeAppStream()
    serverSays('TranscriptText', 'Old take.')
    stream.connect()
    socket.handlers?.onOpen()
    serverSays('TranscriptInterim', 'new')
    expect(heard.at(-1)).toEqual(['new', false])
  })
})

describe('Claude Code voice_stream, unchanged', () => {
  it('still takes each message as the whole transcript so far', () => {
    const heard: [string, boolean][] = []
    new AnthropicVoiceStream({ accessToken: 'tok' }, { onTranscript: (t, f) => heard.push([t, f]) }).connect()
    socket.handlers?.onOpen()
    expect(query(socket.urls[0]!)).toMatchObject({ use_conversation_engine: 'true', endpointing_ms: '300' })
    serverSays('TranscriptInterim', 'hello')
    serverSays('TranscriptText', 'hello there')
    serverSays('TranscriptEndpoint')
    expect(heard).toEqual([
      ['hello', false],
      ['hello there', false],
      ['hello there', true]
    ])
  })
})
