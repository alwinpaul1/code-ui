import { useCallback, useEffect, useRef, useState } from 'react'
import { useDictationCapture } from '../platform/dictation-capture'
import { fetchAccountCredentials, fetchAnthropicCredential } from '../dictation/anthropic-credential-reader'
import { AnthropicVoiceStream, type VoiceStreamProtocol } from '../dictation/anthropic-voice-stream'
import type {
  DictationStatus,
  UseMobileDictationResult
} from './mobile-dictation-session-state'
import type { DictationCaptureSubscription } from '../platform/dictation-capture-contract'
import { createLevelSource, pcm16Level, type LevelSource } from '../dictation/pcm-level'

/**
 * The voice_stream contract the phone dictates with (see VoiceStreamProtocol): the Claude Android
 * app's. Its live text corrects the words while the user is still speaking, which Claude Code's set
 * only does once they stop (reported 2026-10-16). Probe p20 (2026-10-16): three sentences with
 * 1.8 s pauses; with the app's set the live text read "if it it's" at 9.1 s, with Claude Code's it
 * read "if it is" until the final text at 19 s. voice_stream took linear16 audio, the OAuth token
 * and the org with the app's set. Neither set drops fillers ("um", "uh"): the server keeps them.
 */
export const DICTATION_VOICE_PROTOCOL: VoiceStreamProtocol = 'claude-app'

/**
 * The chat a take dictates into: its Anthropic account's id, or null when several accounts are
 * signed in and none is matched to it (useClaudeTabAccount). Left out outside a Claude chat.
 */
export type DictationChatAccount = { readonly accountId: string | null }

/** What a take dictates with: a token and its account's organization, or why there is none. */
type DictationCredential =
  | { readonly ok: true; readonly accessToken: string; readonly organizationUuid: string | null }
  | { readonly ok: false; readonly reason: string }

const SIGN_IN_TO_DICTATE = 'Sign in to Anthropic in Settings, Anthropic accounts, to dictate'

/**
 * The credential for one take. In a chat with a known account, that account's token and
 * organization and nothing else: if it cannot give a token the take is refused with the reason,
 * because dictating with another account would send voice_stream the wrong organization (review of
 * 2026-10-17: every take used the first account signed in, whatever chat it went into). A chat
 * whose account is not known uses the first account signed in and says so in one log line; outside
 * a chat that account is used quietly.
 */
async function readDictationCredential(chat: DictationChatAccount | undefined): Promise<DictationCredential> {
  const accountId = chat?.accountId ?? null
  if (accountId === null) {
    const primary = await fetchAnthropicCredential().catch(() => null)
    if (!primary) {
      return { ok: false, reason: SIGN_IN_TO_DICTATE }
    }
    if (chat) {
      console.warn(
        "[dictation] this chat's Anthropic account is not known (several are signed in and none is matched to its session); dictating with the first account signed in"
      )
    }
    return { ok: true, accessToken: primary.accessToken, organizationUuid: primary.organizationUuid ?? null }
  }
  let listed
  try {
    listed = await fetchAccountCredentials(accountId)
  } catch (err) {
    return { ok: false, reason: `Can't read this chat's Anthropic account to dictate: ${err instanceof Error ? err.message : String(err)}` }
  }
  const account = listed[0]
  if (!account) {
    return {
      ok: false,
      reason: "This chat's Anthropic account is no longer signed in on the phone. Sign in to it again in Settings, Anthropic accounts, to dictate here"
    }
  }
  if (!account.accessToken) {
    return { ok: false, reason: `Can't dictate with ${account.label}, this chat's account: ${account.error ?? 'it has no sign-in token'}` }
  }
  return { ok: true, accessToken: account.accessToken, organizationUuid: account.organizationUuid }
}

export type UseAnthropicDictationOptions = {
  enabled: boolean
  /** Called on every partial and on the final result.
   *  Matches the live engine signature: `(text, final, interim)`.
   *  Claude Code CLI: `onTranscript(text, isFinal)`. */
  onTranscript: (text: string, final: boolean, interim?: string) => void
  onError?: (error: Error) => void
  lang?: string
  /** The chat the take dictates into; read at each start. Left out, the first account signed in. */
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

    // Read fresh on every start, never a token held from an earlier read: a sign-in (or sign-out)
    // on the Anthropic accounts screen takes effect on the next tap (2026-10-14).
    const cred = await readDictationCredential(chatAccountRef.current)
    if (!cred.ok) {
      if (cred.reason === SIGN_IN_TO_DICTATE) {
        setAvailable(false)
      }
      activeRef.current = false
      setStatus('error')
      setError(cred.reason)
      onErrorRef.current?.(new Error(cred.reason))
      return
    }
    setAvailable(true)

    // Open the microphone.
    const opened = await capture.open({
      stillWanted: () => activeRef.current && enabled
    })
    if (!opened.ok) {
      activeRef.current = false
      if (opened.reason === 'cancelled') {
        setStatus('idle')
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

    // Open the voice stream.
    // Claude Code CLI: four concurrent jobs — mic→encoder, encoder→socket,
    // socket→transcript, supervisor. Here the capture subscription is
    // mic→socket and the stream callbacks are socket→transcript.
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

    // Wire microphone chunks to the stream.
    const sub = capture.onChunk((chunk) => {
      stream.sendAudio(chunk.data)
      const level = pcm16Level(chunk.data)
      if (level !== null) {
        levelSource.set(level)
      }
    })
    chunkSubRef.current = sub

    if (!capture.begin()) {
      teardown()
      setStatus('error')
      const msg = 'Microphone capture refused'
      setError(msg)
      onErrorRef.current?.(new Error(msg))
      return
    }

    setStatus('recording')
  }, [capture, enabled, lang, levelSource, teardown])

  const stop = useCallback(async () => {
    if (!activeRef.current) {
      return
    }
    setStatus('processing')
    await capture.end()
    // Listening is over: the waveform gives way to "Transcribing…" with no stale bar.
    levelSource.set(0)
    // Claude Code CLI: finalize() sends CloseStream, starts the two timers,
    // and resolves when the final transcript is delivered or a timeout fires.
    // The stream's onTranscript(text, true) callback handles the rest.
    streamRef.current?.finalize().catch(() => undefined)
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
