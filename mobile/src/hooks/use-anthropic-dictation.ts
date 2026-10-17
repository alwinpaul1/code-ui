import { useCallback, useEffect, useRef, useState } from 'react'
import { useDictationCapture } from '../platform/dictation-capture'
import { fetchAnthropicCredential } from '../dictation/anthropic-credential-reader'
import { AnthropicVoiceStream, type VoiceStreamProtocol } from '../dictation/anthropic-voice-stream'
import type {
  DictationStatus,
  UseMobileDictationResult
} from './mobile-dictation-session-state'
import type { DictationCaptureSubscription } from '../platform/dictation-capture-contract'
import { createLevelSource, pcm16Level, type LevelSource } from '../dictation/pcm-level'
import { createPcmBacklog, PCM_BYTES_PER_SECOND } from '../dictation/pcm-backlog'
import { SIGN_IN_TO_DICTATE } from '../dictation/dictation-account-lookup'
import { readDictationCredential, type DictationChatAccount } from '../dictation/dictation-credential'

export { SIGN_IN_TO_DICTATE, type DictationAccountLookup } from '../dictation/dictation-account-lookup'
export { UNKNOWN_SESSION_ACCOUNT, type DictationChatAccount } from '../dictation/dictation-credential'

/**
 * The voice_stream contract the phone dictates with (see VoiceStreamProtocol): the Claude Android
 * app's. Its live text corrects the words while the user is still speaking, which Claude Code's set
 * only does once they stop (reported 2026-10-16). Probe p20 (2026-10-16): three sentences with
 * 1.8 s pauses; with the app's set the live text read "if it it's" at 9.1 s, with Claude Code's it
 * read "if it is" until the final text at 19 s. voice_stream took linear16 audio, the OAuth token
 * and the org with the app's set. Neither set drops fillers ("um", "uh"): the server keeps them.
 */
export const DICTATION_VOICE_PROTOCOL: VoiceStreamProtocol = 'claude-app'

/** Audio held while a take's account is looked up (DICTATION_ACCOUNT_LOOKUP_MS, 6 s, at most):
 *  15 s of the 16 kHz PCM captured, so a slow answer loses nothing; past it, said once. */
export const MAX_HELD_AUDIO_BYTES = 15 * PCM_BYTES_PER_SECOND
const HELD_AUDIO_OVERFLOW = `[dictation] more than ${MAX_HELD_AUDIO_BYTES / PCM_BYTES_PER_SECOND} s of audio held while this session's account was looked up; the rest of it is dropped`

export type UseAnthropicDictationOptions = {
  enabled: boolean
  /** Called on every partial and on the final result.
   *  Matches the live engine signature: `(text, final, interim)`.
   *  Claude Code CLI: `onTranscript(text, isFinal)`. */
  onTranscript: (text: string, final: boolean, interim?: string) => void
  onError?: (error: Error) => void
  lang?: string
  /** The chat the take dictates into; read at each start. Left out (not a Claude session), the
   *  first account signed in; a chat with no known account is refused. */
  chatAccount?: DictationChatAccount
}

export type UseAnthropicDictationResult = UseMobileDictationResult & {
  /** Someone is signed in to Anthropic on the phone, as of the last read of its store. */
  available: boolean
  /** Reads the phone's store again (after a sign-in on the Anthropic accounts screen) and says whether anyone
   *  is signed in now. */
  refreshAvailable: () => Promise<boolean>
  /** The microphone level 0..1 from the streamed PCM, for the recording row's waveform. Held
   *  outside React: it changes per chunk, about 31 times a second. */
  levelSource: LevelSource
}

/**
 * Anthropic server dictation — matches Claude Code CLI 2.1.296.
 *
 * The server sends the full transcript on every Interim and Text message.
 * There is no segment accumulation. The hook tracks the latest text and
 * delivers it through `onTranscript(text, isFinal)`.
 *
 * `finalize()` uses the CLI's two-timer approach (5 s safety, 1.5 s noData)
 * and promotes the last interim to final when no TranscriptEndpoint arrives.
 */
export function useAnthropicDictation(
  options: UseAnthropicDictationOptions
): UseAnthropicDictationResult {
  const { enabled, onTranscript, onError, lang = 'en', chatAccount } = options
  const capture = useDictationCapture()
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)
  const [levelSource] = useState(createLevelSource)

  const activeRef = useRef(false)
  /** Which take is current: a take cancelled during its account lookup and tapped again is no
   *  longer wanted, though activeRef is true again for the new one (review of 2026-10-17). */
  const takeRef = useRef(0)
  /** The take stopped while its account was still being looked up, to finalize once its stream exists. */
  const pendingStopRef = useRef<number | null>(null)
  const streamRef = useRef<AnthropicVoiceStream | null>(null)
  const chunkSubRef = useRef<DictationCaptureSubscription | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  onTranscriptRef.current = onTranscript
  onErrorRef.current = onError
  const chatAccountRef = useRef(chatAccount)
  chatAccountRef.current = chatAccount

  const mountedRef = useRef(true)
  const refreshAvailable = useCallback(async (): Promise<boolean> => {
    const signedIn = await fetchAnthropicCredential().then((cred) => cred !== null, () => false)
    if (mountedRef.current) {
      setAvailable(signedIn)
    }
    return signedIn
  }, [])
  useEffect(() => {
    mountedRef.current = true
    void refreshAvailable()
    return () => {
      mountedRef.current = false
    }
  }, [refreshAvailable])

  const teardown = useCallback(() => {
    activeRef.current = false
    levelSource.set(0)
    chunkSubRef.current?.remove()
    chunkSubRef.current = null
    streamRef.current?.destroy()
    streamRef.current = null
    void capture.end()
    capture.release()
  }, [capture, levelSource])

  const start = useCallback(async () => {
    if (!enabled || activeRef.current) {
      return
    }

    setStatus('starting')
    setError(null)
    activeRef.current = true
    takeRef.current += 1
    const take = takeRef.current
    const current = () => activeRef.current && takeRef.current === take

    // The microphone opens at the tap, before the take knows its account: the lookup can take
    // seconds, and what is said meanwhile is held (user, 2026-10-17: "what's happening now"
    // dictated as "now"). The stream gets it, in order, once it exists.
    // Before the open: a stop tapped while the mic is opening is this take's (review 2026-10-17).
    pendingStopRef.current = null
    const opened = await capture.open({ stillWanted: () => current() && enabled })
    if (!opened.ok) {
      if (takeRef.current === take) {
        activeRef.current = false
      }
      if (opened.reason === 'cancelled') {
        if (takeRef.current === take) {
          setStatus('idle')
        }
        return
      }
      const msg =
        opened.reason === 'permission-denied'
          ? 'Microphone permission denied'
          : 'Failed to open the microphone'
      setStatus('error')
      setError(msg)
      onErrorRef.current?.(new Error(msg))
      return
    }

    if (!current()) {
      // Cancelled while the mic opened: cancel() went idle before there was a mic to let go.
      if (!activeRef.current) {
        void capture.end()
        capture.release()
      }
      return
    }
    // Claude Code CLI: four concurrent jobs — mic→encoder, encoder→socket,
    // socket→transcript, supervisor. Here the capture subscription is
    // mic→socket (through `held` until the stream exists) and the stream
    // callbacks are socket→transcript.
    const held = createPcmBacklog(MAX_HELD_AUDIO_BYTES, HELD_AUDIO_OVERFLOW)
    let live: AnthropicVoiceStream | null = null
    // Stopped while the mic opened: nothing is recorded, and the take ends once its stream is up.
    const stoppedWhileOpening = pendingStopRef.current === take
    const sub = capture.onChunk((chunk) => {
      if (live) {
        live.sendAudio(chunk.data)
      } else {
        held.push(chunk.data)
      }
      const level = pcm16Level(chunk.data)
      if (level !== null) {
        levelSource.set(level)
      }
    })
    chunkSubRef.current = sub
    if (stoppedWhileOpening) {
      void capture.end()
    } else if (!capture.begin()) {
      teardown()
      setStatus('error')
      const msg = 'Microphone capture refused'
      setError(msg)
      onErrorRef.current?.(new Error(msg))
      return
    } else {
      setStatus('recording')
    }

    // Read fresh on every start, never a token held from an earlier read: a sign-in (or sign-out)
    // on the Anthropic accounts screen takes effect on the next tap (2026-10-14).
    const cred = await readDictationCredential(chatAccountRef.current, current)
    if (cred === null || !current()) {
      // Cancelled while the session's account was being looked up: cancel() already let the
      // microphone go and went idle.
      return
    }
    if (!cred.ok) {
      if (cred.reason === SIGN_IN_TO_DICTATE) {
        setAvailable(false)
      }
      held.clear()
      teardown()
      setStatus('error')
      setError(cred.reason)
      onErrorRef.current?.(new Error(cred.reason))
      return
    }
    setAvailable(true)

    const stream = new AnthropicVoiceStream(
      {
        accessToken: cred.accessToken,
        language: lang,
        protocol: DICTATION_VOICE_PROTOCOL,
        organizationUuid: cred.organizationUuid
      },
      {
        onTranscript: (text, isFinal) => {
          if (!activeRef.current) {
            return
          }
          // Map to the live-engine signature the session wiring expects:
          // (text, final, interim). When not final the text IS the interim.
          onTranscriptRef.current(text, isFinal, isFinal ? '' : text)
          if (isFinal) {
            teardown()
            setStatus('idle')
          }
        },
        onError: (err) => {
          if (!activeRef.current) {
            return
          }
          teardown()
          setStatus('error')
          setError(err.message)
          onErrorRef.current?.(err)
        },
        onClose: () => {
          if (!activeRef.current) {
            return
          }
          teardown()
          setStatus('idle')
        }
      }
    )
    streamRef.current = stream
    stream.connect()
    // What was said during the lookup first, then the live audio straight through.
    held.drain((pcm) => stream.sendAudio(pcm))
    live = stream
    if (pendingStopRef.current === take) {
      // Stopped during the lookup: the speech held is in, so the take can end.
      pendingStopRef.current = null
      stream.finalize().catch(() => undefined)
    }
  }, [capture, enabled, lang, levelSource, teardown])

  const stop = useCallback(async () => {
    if (!activeRef.current) {
      return
    }
    setStatus('processing')
    const stream = streamRef.current
    if (!stream) {
      // The account is still being looked up: start() finalizes once the stream has the speech.
      pendingStopRef.current = takeRef.current
    }
    await capture.end()
    // Listening is over: the waveform gives way to "Transcribing…" with no stale bar.
    levelSource.set(0)
    // Claude Code CLI: finalize() sends CloseStream, starts the two timers,
    // and resolves when the final transcript is delivered or a timeout fires.
    // The stream's onTranscript(text, true) callback handles the rest.
    stream?.finalize().catch(() => undefined)
  }, [capture, levelSource])

  const cancel = useCallback(async () => {
    if (!activeRef.current) {
      return
    }
    teardown()
    setStatus('idle')
    setError(null)
  }, [teardown])

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      chunkSubRef.current?.remove()
      chunkSubRef.current = null
      if (activeRef.current) {
        streamRef.current?.destroy()
        streamRef.current = null
        void capture.end()
        capture.release()
        activeRef.current = false
      }
    }
  }, [capture])

  return {
    status,
    isStarting: status === 'starting',
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    error,
    available,
    refreshAvailable,
    levelSource,
    start,
    stop,
    cancel
  }
}
