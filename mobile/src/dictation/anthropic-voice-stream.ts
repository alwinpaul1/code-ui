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
import { createPcmBacklog, PCM_BYTES_PER_SECOND, type PcmBacklog } from './pcm-backlog'
import { apiErrorMessage, voiceStreamQuery, type VoiceStreamOptions } from './voice-stream-query'

export { voiceStreamQuery, type VoiceStreamOptions, type VoiceStreamProtocol } from './voice-stream-query'

export type VoiceStreamCallbacks = {
  readonly onTranscript?: (text: string, isFinal: boolean) => void
  readonly onError?: (error: Error) => void
  readonly onClose?: () => void
  readonly onReady?: () => void
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
/** Audio held while the socket opens: 15 s of the 16 kHz PCM the phone streams. A socket that has
 *  not opened by then has failed or soon will; what is spoken past it is dropped, and said once. */
export const MAX_AUDIO_BEFORE_OPEN_BYTES = 15 * PCM_BYTES_PER_SECOND
/** How long a take finalized before its socket opened waits for it to open: past this the take
 *  ends with an error rather than sit on "Transcribing…" with a socket that never answers. */
export const FINALIZE_CONNECT_TIMEOUT_MS = 10000
const AUDIO_BEFORE_OPEN_OVERFLOW = `[dictation] more than ${MAX_AUDIO_BEFORE_OPEN_BYTES / PCM_BYTES_PER_SECOND} s of audio before voice_stream opened; the rest of it is dropped`

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
  /** A take finalized before the socket opened waits this long for it (FINALIZE_CONNECT_TIMEOUT_MS). */
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  /** Audio sent before the socket opened, and whether it has. Before 2026-10-17 such audio went to
   *  sendBinary, which drops anything sent on a socket not open yet: the first half second or more
   *  of every take ("what's happening now" read "now"). */
  private opened = false
  private beforeOpen: PcmBacklog = createPcmBacklog(MAX_AUDIO_BEFORE_OPEN_BYTES, AUDIO_BEFORE_OPEN_OVERFLOW)

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
    this.opened = false
    this.beforeOpen.clear()

    const { accessToken } = this.options
    const url = `${BASE_URL}${PATH}?${voiceStreamQuery(this.options)}`

    const headers = { Authorization: `Bearer ${accessToken}`, ...CLIENT_HEADERS }
    this.ws = openVoiceSocket(url, headers, {
      onOpen: () => {
        if (this.done || !this.ws) {
          return
        }
        this.opened = true
        this.ws?.sendText(KEEPALIVE_JSON)
        // What was spoken while the socket opened, then a CloseStream asked for meanwhile.
        this.beforeOpen.drain((pcm) => this.ws?.sendBinary(pcm))
        if (this.closeStreamSent) {
          this.clearFinalizeTimers()
          this.startFinalizeTimers()
          this.ws?.sendText(CLOSESTREAM_JSON)
        }
        this.keepAliveTimer = setInterval(() => {
          this.ws?.sendText(KEEPALIVE_JSON)
        }, KEEPALIVE_INTERVAL_MS)
        this.callbacks?.onReady?.()
      },
      onMessage: (text) => this.handleMessage(text),
      onError: (message) => {
        this.beforeOpen.clear()
        this.promoteInterim('ws error')
        if (!this.done) {
          // The socket's own reason when it gave one (OkHttp's, or the HTTP status of a refused upgrade).
          this.callbacks?.onError?.(
            new Error(`Voice stream connection error${message ? `: ${message}` : ''}`)
          )
        }
      },
      onClose: (code, reason) => {
        // Gone: nothing more is held or sent for it.
        this.ws = null
        this.beforeOpen.clear()
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
    if (this.closeStreamSent || this.done || !this.ws) {
      return
    }
    if (!this.opened) {
      this.beforeOpen.push(pcm)
      return
    }
    this.ws.sendBinary(pcm)
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
      this.finalizeResolve = (reason: string) => {
        this.clearFinalizeTimers()
        resolve(reason)
      }
      if (!this.opened) {
        // onOpen sends CloseStream after the audio held for it, and the two timers start then: a
        // slow connect spent the 1.5 s one before CloseStream could go out (review 2026-10-17). A
        // socket that never opens and never closes ends the take here, and says so.
        this.connectTimer = setTimeout(() => this.connectTimedOut(), FINALIZE_CONNECT_TIMEOUT_MS)
        return
      }
      this.startFinalizeTimers()
      // Send CloseStream on next tick (matches CLI).
      setTimeout(() => {
        this.ws?.sendText(CLOSESTREAM_JSON)
      }, 0)
    })
  }

  private startFinalizeTimers(): void {
    this.safetyTimer = setTimeout(() => this.resolveFinalize('safety_timeout'), SAFETY_TIMEOUT_MS)
    this.noDataTimer = setTimeout(() => this.resolveFinalize('no_data_timeout'), NO_DATA_TIMEOUT_MS)
  }

  private connectTimedOut(): void {
    this.connectTimer = null
    this.resolveFinalize('connect_timeout')
    const callbacks = this.callbacks
    this.done = true
    this.teardownSocket()
    callbacks?.onError?.(new Error(`Voice stream did not connect within ${FINALIZE_CONNECT_TIMEOUT_MS / 1000} s`))
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
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
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
    this.beforeOpen.clear()
    this.clearKeepAlive()
    this.clearFinalizeTimers()
    const socket = this.ws
    this.ws = null
    socket?.close()
  }
}
