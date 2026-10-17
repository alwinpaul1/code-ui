/** What voice_stream is opened with and how its API errors read (anthropic-voice-stream.ts). */

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

/** The Anthropic API's error shape, `{ type: 'error', error: { type, message }, request_id }`, as
 *  one line naming the reason and the request id to look up; null for any other shape. */
export function apiErrorMessage(msg: Record<string, unknown>): string | null {
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
