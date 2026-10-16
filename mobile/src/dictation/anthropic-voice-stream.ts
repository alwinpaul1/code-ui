/**
 * WebSocket client for Anthropic's voice_stream speech-to-text endpoint.
 *
 * Matches the Claude Code CLI 2.1.296 implementation:
 *
 *   - TranscriptInterim and TranscriptText are handled identically.
 *     Both carry the full transcript so far in `data`. Neither is "final".
 *   - TranscriptEndpoint is the ONLY place `isFinal=true` is delivered.
 *   - If the stream ends without a TranscriptEndpoint, the last interim
 *     is promoted to final ("interim promotion").
 *   - Finalize uses two timers: safety (5 s) and noData (1.5 s). The
 *     noData timer resets on any message after CloseStream.
 *   - KeepAlive is sent on connect and every 8 s.
 *   - TranscriptError is handled and promotes any pending interim.
 *
 * The socket under it is voice-socket.ts's: on Android an OkHttp socket with no Origin header
 * (React Native's adds one, and voice_stream refuses it), elsewhere the JavaScript WebSocket.
 */

import type { VoiceSocket } from './voice-socket'
import { openVoiceSocket } from './voice-socket-opener'

export type VoiceStreamCallbacks = {
  readonly onTranscript?: (text: string, isFinal: boolean) => void
  readonly onError?: (error: Error) => void
  readonly onClose?: () => void
  readonly onReady?: () => void
}

/**
 * Which client's voice_stream contract the stream speaks.
 *
 * - `claude-code`: Claude Code CLI 2.1.296's parameters (`use_conversation_engine=true`, endpointing
 *   and utterance-end timings). Every TranscriptInterim and TranscriptText carries the whole
 *   transcript so far, and TranscriptEndpoint ends the take.
 * - `claude-app`: the Claude Android app 1.261013.20's (r4u.java:1018-1020): `encoding,
 *   sample_rate, channels, language, forward_interims=typed, organization_uuid`. TranscriptText is
 *   a committed segment, appended; TranscriptInterim replaces the live tail; what is shown is the
 *   two joined (j3i.java:846-851, a3x.q). The committed text is the server's corrected version of
 *   the words the interim showed, so it takes their place. TranscriptEndpoint is not one of the
 *   app's messages (nkt.java) and does not end a take the mic still holds.
 */
export type VoiceStreamProtocol = 'claude-code' | 'claude-app'

export type VoiceStreamOptions = {
  readonly accessToken: string
  readonly language?: string
  readonly sampleRate?: number
  /** Defaults to `claude-code`. */
  readonly protocol?: VoiceStreamProtocol
  /** The signed-in account's organization, sent as `organization_uuid` under `claude-app`. */
  readonly organizationUuid?: string | null
}

/** The query voice_stream is opened with. The Claude app encodes Opus in process; the phone
 *  streams the 16 kHz PCM it captures, so `encoding=linear16` under either protocol. */
export function voiceStreamQuery(options: VoiceStreamOptions): string {
  const { language = 'en', sampleRate = 16000, protocol = 'claude-code', organizationUuid } = options
  const audio = [`encoding=linear16`, `sample_rate=${sampleRate}`, `channels=1`]
  const lang = `language=${encodeURIComponent(language)}`
  switch (protocol) {
    case 'claude-code':
      return [
        ...audio,
        `endpointing_ms=300`,
        `utterance_end_ms=1000`,
        lang,
        `use_conversation_engine=true`,
        `forward_interims=typed`
      ].join('&')
    case 'claude-app':
      return [
        ...audio,
        lang,
        `forward_interims=typed`,
        ...(organizationUuid ? [`organization_uuid=${encodeURIComponent(organizationUuid)}`] : [])
      ].join('&')
    default: {
      const unhandled: never = protocol
      throw new Error(`Unknown voice_stream protocol: ${String(unhandled)}`)
    }
  }
}

const BASE_URL = 'wss://api.anthropic.com'
/** Claude Code 2.1.296's voice_stream identifies itself with `x-app: cli` and its CLI
 *  User-Agent; the phone signs in with Claude Code's OAuth client, so it says the same. */
const CLIENT_HEADERS = {
  'x-app': 'cli',
  'User-Agent': 'claude-cli/2.1.296 (external, cli)'
} as const
const PATH = '/api/ws/speech_to_text/voice_stream'
const KEEPALIVE_JSON = '{"type":"KeepAlive"}'
const CLOSESTREAM_JSON = '{"type":"CloseStream"}'
const KEEPALIVE_INTERVAL_MS = 8000
/** Absolute maximum wait after CloseStream. */
const SAFETY_TIMEOUT_MS = 5000
/** Give up if no message arrives this long after CloseStream. Reset on
 *  every message that does arrive. */
const NO_DATA_TIMEOUT_MS = 1500

/** The Anthropic API's error shape, `{ type: 'error', error: { type, message }, request_id }`, as
 *  one line naming the reason and the request id to look up; null for any other shape. */
function apiErrorMessage(msg: Record<string, unknown>): string | null {
  const error = msg.error
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const { type, message } = error as { type?: unknown; message?: unknown }
  const reason = typeof message === 'string' && message ? message : null
  const detail = [typeof type === 'string' ? type : null, typeof msg.request_id === 'string' ? msg.request_id : null]
    .filter((part): part is string => part !== null)
    .join(', ')
  if (!reason && !detail) {
    return null
  }
  return `Voice server: ${reason ?? 'error'}${detail ? ` (${detail})` : ''}`
}

export class AnthropicVoiceStream {
  private ws: VoiceSocket | null = null
  private callbacks: VoiceStreamCallbacks | null
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  /** What the take reads as now, not yet delivered as final: under `claude-code` the last Interim
   *  or Text, under `claude-app` the committed segments then the live interim. */
  private latestText = ''
  /** `claude-app` only: the TranscriptText segments so far, joined as the app joins them. */
  private committedText = ''
  /** True once CloseStream was sent. */
  private closeStreamSent = false
  /** True once finalize or close ran — no more callbacks after this. */
  private done = false
  /** Finalize promise resolver. */
  private finalizeResolve: ((reason: string) => void) | null = null
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  private noDataTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly options: VoiceStreamOptions,
    callbacks: VoiceStreamCallbacks
  ) {
    this.callbacks = callbacks
  }

  connect(): void {
    // Guard against double-connect.
    if (this.ws) {
      this.teardownSocket()
    }
    this.closeStreamSent = false
    this.done = false
    this.latestText = ''
    this.committedText = ''

    const { accessToken } = this.options
    const url = `${BASE_URL}${PATH}?${voiceStreamQuery(this.options)}`

    const headers = { Authorization: `Bearer ${accessToken}`, ...CLIENT_HEADERS }
    this.ws = openVoiceSocket(url, headers, {
      onOpen: () => {
        this.ws?.sendText(KEEPALIVE_JSON)
        this.keepAliveTimer = setInterval(() => {
          this.ws?.sendText(KEEPALIVE_JSON)
        }, KEEPALIVE_INTERVAL_MS)
        this.callbacks?.onReady?.()
      },
      onMessage: (text) => this.handleMessage(text),
      onError: (message) => {
        this.promoteInterim('ws error')
        if (!this.done) {
          // The socket's own reason when it gave one (OkHttp's, or the HTTP status of a refused upgrade).
          this.callbacks?.onError?.(
            new Error(`Voice stream connection error${message ? `: ${message}` : ''}`)
          )
        }
      },
      onClose: (code, reason) => {
        this.clearKeepAlive()
        this.promoteInterim('ws close')
        this.resolveFinalize('ws_close')
        // Codes 1000 and 1005 are normal closes — do not fire onError.
        if (!this.done && code !== 1000 && code !== 1005) {
          const detail = reason ? ` — ${reason}` : ''
          this.callbacks?.onError?.(new Error(`Connection closed: code ${code}${detail}`))
        }
        this.callbacks?.onClose?.()
      }
    })
  }

  /** Send a chunk of raw PCM audio to the server. */
  sendAudio(pcm: Uint8Array): void {
    if (this.closeStreamSent) {
      return
    }
    this.ws?.sendBinary(pcm)
  }

  /**
   * Tell the server the speaker stopped. Returns a promise that resolves
   * when the final transcript is delivered or a timeout fires.
   *
   * Two-timer approach from Claude Code CLI:
   *   safety (5 s): absolute max wait.
   *   noData (1.5 s): fires if no message arrives, reset on each message.
   */
  finalize(): Promise<string> {
    if (this.done || this.closeStreamSent) {
      return Promise.resolve('already_closed')
    }
    this.closeStreamSent = true
    return new Promise<string>((resolve) => {
      this.safetyTimer = setTimeout(
        () => this.resolveFinalize('safety_timeout'),
        SAFETY_TIMEOUT_MS
      )
      this.noDataTimer = setTimeout(
        () => this.resolveFinalize('no_data_timeout'),
        NO_DATA_TIMEOUT_MS
      )
      this.finalizeResolve = (reason: string) => {
        this.clearFinalizeTimers()
        resolve(reason)
      }
      // Send CloseStream on next tick (matches CLI).
      setTimeout(() => {
        this.ws?.sendText(CLOSESTREAM_JSON)
      }, 0)
    })
  }

  /** Hard teardown — no callbacks fire after this. */
  destroy(): void {
    this.done = true
    this.callbacks = null
    this.clearFinalizeTimers()
    this.resolveFinalize('destroyed')
    this.teardownSocket()
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const type = (msg.type as string) ?? ''
    const data = (msg.data as string) ?? ''

    if (this.options.protocol === 'claude-app' && this.handleClaudeAppTranscript(type, data)) {
      return
    }
    switch (type) {
      // Claude Code CLI: Interim and Text are handled identically.
      // Both carry the full transcript so far. Neither is "final".
      case 'TranscriptInterim':
      case 'TranscriptText': {
        if (this.closeStreamSent) {
          this.resetNoDataTimer()
        }
        if (data) {
          this.latestText = data
          this.callbacks?.onTranscript?.(data, false)
        }
        break
      }
      // The ONLY place isFinal=true is set during normal flow.
      case 'TranscriptEndpoint': {
        const text = this.latestText
        this.latestText = ''
        if (text) {
          this.callbacks?.onTranscript?.(text, true)
        }
        if (this.closeStreamSent) {
          this.resolveFinalize('post_closestream_endpoint')
        }
        break
      }
      case 'TranscriptError': {
        const desc =
          (msg.description as string) ??
          (msg.error_code as string) ??
          'unknown transcription error'
        this.promoteInterim('TranscriptError')
        if (!this.done) {
          this.callbacks?.onError?.(new Error(desc))
        }
        break
      }
      case 'error': {
        // Claude Code logs the frame's keys when it has no message; "unstructured server error"
        // alone said nothing about which frame it was (2026-10-14).
        const message =
          (msg.message as string) ?? apiErrorMessage(msg) ??
          `Voice server error (keys: ${Object.keys(msg).join(', ')})`
        this.promoteInterim('server error')
        if (!this.done) {
          this.callbacks?.onError?.(new Error(message))
        }
        break
      }
    }
  }

  /**
   * The Claude app's transcript model (j3i.java:846-851): a TranscriptText is appended to the
   * committed text and clears the interim; a TranscriptInterim replaces the interim; the take reads
   * as the two joined. A TranscriptEndpoint ends the take only once the mic is released. True when
   * the message was one of these; the errors fall through to the shared handling.
   */
  private handleClaudeAppTranscript(type: string, data: string): boolean {
    switch (type) {
      case 'TranscriptText':
      case 'TranscriptInterim': {
        if (this.closeStreamSent) {
          this.resetNoDataTimer()
        }
        const before = this.latestText
        if (type === 'TranscriptText') {
          this.committedText += data
          this.latestText = this.committedText
        } else {
          this.latestText = this.committedText + data
        }
        // An empty committed segment takes the interim's words away, as in the app; say so, or
        // the caption would keep words the take no longer holds.
        if (this.latestText !== before) {
          this.callbacks?.onTranscript?.(this.latestText, false)
        }
        return true
      }
      case 'TranscriptEndpoint': {
        if (this.closeStreamSent) {
          this.resolveFinalize('post_closestream_endpoint')
        }
        return true
      }
      default:
        return false
    }
  }

  /**
   * Interim promotion: if unreported text exists, deliver it as final.
   * This fires on any abnormal end (ws close, error, timeout).
   */
  private promoteInterim(_reason: string): void {
    if (!this.latestText) {
      return
    }
    const text = this.latestText
    this.latestText = ''
    this.committedText = ''
    this.callbacks?.onTranscript?.(text, true)
  }

  private resolveFinalize(reason: string): void {
    if (!this.finalizeResolve) {
      return
    }
    this.promoteInterim(reason)
    const resolve = this.finalizeResolve
    this.finalizeResolve = null
    resolve(reason)
  }

  private resetNoDataTimer(): void {
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer)
      this.noDataTimer = setTimeout(
        () => this.resolveFinalize('no_data_timeout'),
        NO_DATA_TIMEOUT_MS
      )
    }
  }

  private clearFinalizeTimers(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer)
      this.safetyTimer = null
    }
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer)
      this.noDataTimer = null
    }
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  private teardownSocket(): void {
    this.clearKeepAlive()
    this.clearFinalizeTimers()
    const socket = this.ws
    this.ws = null
    socket?.close()
  }
}
