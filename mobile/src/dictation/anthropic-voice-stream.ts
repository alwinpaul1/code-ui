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
 */

export type VoiceStreamCallbacks = {
  readonly onTranscript?: (text: string, isFinal: boolean) => void
  readonly onError?: (error: Error) => void
  readonly onClose?: () => void
  readonly onReady?: () => void
}

export type VoiceStreamOptions = {
  readonly accessToken: string
  readonly language?: string
  readonly sampleRate?: number
}

const BASE_URL = 'wss://api.anthropic.com'
const PATH = '/api/ws/speech_to_text/voice_stream'
const KEEPALIVE_JSON = '{"type":"KeepAlive"}'
const CLOSESTREAM_JSON = '{"type":"CloseStream"}'
const KEEPALIVE_INTERVAL_MS = 8000
/** Absolute maximum wait after CloseStream. */
const SAFETY_TIMEOUT_MS = 5000
/** Give up if no message arrives this long after CloseStream. Reset on
 *  every message that does arrive. */
const NO_DATA_TIMEOUT_MS = 1500

export class AnthropicVoiceStream {
  private ws: WebSocket | null = null
  private callbacks: VoiceStreamCallbacks | null
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  /** The last text from any Interim or Text message. */
  private latestText = ''
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

    const { accessToken, language = 'en', sampleRate = 16000 } = this.options
    const params = [
      `encoding=linear16`,
      `sample_rate=${sampleRate}`,
      `channels=1`,
      `endpointing_ms=300`,
      `utterance_end_ms=1000`,
      `language=${encodeURIComponent(language)}`,
      `use_conversation_engine=true`,
      `forward_interims=typed`
    ].join('&')
    const url = `${BASE_URL}${PATH}?${params}`

    const headers = { headers: { Authorization: `Bearer ${accessToken}` } }
    // @ts-expect-error — RN WebSocket supports 3 args; the DOM typedef does not.
    this.ws = new WebSocket(url, undefined, headers)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(KEEPALIVE_JSON)
      }
      this.keepAliveTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(KEEPALIVE_JSON)
        }
      }, KEEPALIVE_INTERVAL_MS)
      this.callbacks?.onReady?.()
    }

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      if (typeof event.data === 'string') {
        this.handleMessage(event.data)
      }
    }

    this.ws.onerror = () => {
      this.promoteInterim('ws error')
      if (!this.done) {
        this.callbacks?.onError?.(new Error('Voice stream connection error'))
      }
    }

    this.ws.onclose = (event: WebSocketCloseEvent) => {
      this.clearKeepAlive()
      this.promoteInterim('ws close')
      this.resolveFinalize('ws_close')
      // Codes 1000 and 1005 are normal closes — do not fire onError.
      if (!this.done && event.code !== 1000 && event.code !== 1005) {
        this.callbacks?.onError?.(
          new Error(`Connection closed: code ${event.code}`)
        )
      }
      this.callbacks?.onClose?.()
    }
  }

  /** Send a chunk of raw PCM audio to the server. */
  sendAudio(pcm: Uint8Array): void {
    if (this.closeStreamSent) {
      return
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm)
    }
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
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(CLOSESTREAM_JSON)
        }
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
        const message =
          (msg.message as string) ?? 'unstructured server error'
        this.promoteInterim('server error')
        if (!this.done) {
          this.callbacks?.onError?.(new Error(message))
        }
        break
      }
    }
  }

  /**
   * Interim promotion: if unreported text exists, deliver it as final.
   * This fires on any abnormal end (ws close, error, timeout).
   */
  private promoteInterim(reason: string): void {
    if (!this.latestText) {
      return
    }
    const text = this.latestText
    this.latestText = ''
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
    if (this.ws) {
      try {
        this.ws.onclose = null
        this.ws.onerror = null
        this.ws.onmessage = null
        this.ws.close()
      } catch {
        // Already gone.
      }
      this.ws = null
    }
  }
}
