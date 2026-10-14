/**
 * The Anthropic dictation engine on 0.9.138 (reported 2026-10-14 with a screen recording): a mic
 * tap with nobody signed in on the phone ended in a toast reading "unstructured server error", and
 * signing in on the phone did not change it.
 *
 * - Signed out, the credential reader fell back to opening a hidden terminal on the desktop and
 *   reading Claude Code's own token out of the Keychain. Nothing may open a terminal on the user's
 *   machine to read files (CLAUDE.md), and sign-in on the phone is mandatory (the user,
 *   2026-10-14): the reader is the phone's store and nothing else.
 * - The socket sent only Authorization. Claude Code 2.1.296 (read from its binary) also sends
 *   `x-app: cli` and a `claude-cli/<version>` User-Agent on voice_stream.
 * - "unstructured server error" named nothing. Claude Code logs the frame's keys; so does this.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({
  terminalOpens: 0,
  phone: null as null | { accessToken: string; refreshToken: string; expiresAt: number }
}))

vi.mock('../host-controls/throwaway-terminal', () => ({
  watchThrowawayTerminal: async () => {
    seen.terminalOpens += 1
    return { ok: false }
  }
}))
vi.mock('./anthropic-auth-store', () => ({
  readPrimaryAccount: async () => (seen.phone ? { credential: seen.phone, refreshRefused: false } : null),
  refreshAccessToken: async () => {
    throw new Error('no refresh in this test')
  }
}))

import { fetchAnthropicCredential } from './anthropic-credential-reader'
import { AnthropicVoiceStream } from './anthropic-voice-stream'

type Opened = { url: string; options: { headers: Record<string, string> } }

class FakeSocket {
  static OPEN = 1
  static opened: Opened[] = []
  static last: FakeSocket | null = null
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason?: string }) => void) | null = null
  constructor(url: string, _protocols: unknown, options: { headers: Record<string, string> }) {
    FakeSocket.opened.push({ url, options })
    FakeSocket.last = this
  }
  send(): void {}
  close(): void {}
}

beforeEach(() => {
  seen.terminalOpens = 0
  seen.phone = null
  FakeSocket.opened = []
  FakeSocket.last = null
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading the Anthropic credential', () => {
  it('never opens a terminal on the desktop when the phone is signed out', async () => {
    const desktop = { sendRequest: vi.fn(), subscribe: vi.fn() }
    // Called the way the old two-source reader was, with a desktop client to fall back to.
    const read = fetchAnthropicCredential as (...args: unknown[]) => Promise<unknown>
    await expect(read(desktop, 'wt-1')).resolves.toBeNull()
    expect(seen.terminalOpens).toBe(0)
    expect(desktop.sendRequest).not.toHaveBeenCalled()
  })

  it("returns the phone's own sign-in", async () => {
    seen.phone = { accessToken: 'phone-token', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }
    await expect(fetchAnthropicCredential()).resolves.toMatchObject({ accessToken: 'phone-token' })
  })
})

describe('the voice_stream socket', () => {
  it("sends Claude Code's x-app and User-Agent beside the token", () => {
    new AnthropicVoiceStream({ accessToken: 'tok' }, {}).connect()
    const headers = FakeSocket.opened[0]!.options.headers
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['x-app']).toBe('cli')
    expect(headers['User-Agent']).toMatch(/^claude-cli\/\d+\.\d+\.\d+ /)
  })

  it('names the keys of an error frame that carries no message', () => {
    const errors: string[] = []
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (e) => errors.push(e.message) })
    stream.connect()
    FakeSocket.last!.onmessage!({ data: JSON.stringify({ type: 'error', error_code: 'unauthorized' }) })
    expect(errors).toEqual(['Voice server error (keys: type, error_code)'])
  })

  // 0.9.139 on the phone (2026-10-14): "Voice server error (keys: type, error, request_id)". That is
  // the Anthropic API's error shape; the reason is in error.message, and the request id is what
  // to look up, so both are said.
  it("says the server's own reason and request id for an API-shaped error frame", () => {
    const errors: string[] = []
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (e) => errors.push(e.message) })
    stream.connect()
    FakeSocket.last!.onmessage!({
      data: JSON.stringify({
        type: 'error',
        error: { type: 'permission_error', message: 'OAuth token does not meet scope requirement' },
        request_id: 'req_011CabcDEF'
      })
    })
    expect(errors).toEqual([
      'Voice server: OAuth token does not meet scope requirement (permission_error, req_011CabcDEF)'
    ])
  })

  it('says why the server closed the stream', () => {
    const errors: string[] = []
    const stream = new AnthropicVoiceStream({ accessToken: 'tok' }, { onError: (e) => errors.push(e.message) })
    stream.connect()
    FakeSocket.last!.onclose!({ code: 1008, reason: 'invalid token' })
    expect(errors).toEqual(['Connection closed: code 1008 — invalid token'])
  })
})
