import { useCallback, useEffect, useRef, useState } from 'react'
import { useDictationCapture } from '../platform/dictation-capture'
import { fetchAnthropicCredential } from '../dictation/anthropic-credential-reader'
import { AnthropicVoiceStream } from '../dictation/anthropic-voice-stream'
import type {
  DictationStatus,
  UseMobileDictationResult
} from './mobile-dictation-session-state'
import type { DictationCaptureSubscription } from '../platform/dictation-capture-contract'

export type UseAnthropicDictationOptions = {
  enabled: boolean
  /** Called on every partial and on the final result.
   *  Matches the live engine signature: `(text, final, interim)`.
   *  Claude Code CLI: `onTranscript(text, isFinal)`. */
  onTranscript: (text: string, final: boolean, interim?: string) => void
  onError?: (error: Error) => void
  lang?: string
}

export type UseAnthropicDictationResult = UseMobileDictationResult & {
  /** Someone is signed in to Anthropic on the phone, as of the last read of its store. */
  available: boolean
  /** Reads the phone's store again (after a sign-in on Voice settings) and says whether anyone
   *  is signed in now. */
  refreshAvailable: () => Promise<boolean>
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
  const { enabled, onTranscript, onError, lang = 'en' } = options
  const capture = useDictationCapture()
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)

  const activeRef = useRef(false)
  const streamRef = useRef<AnthropicVoiceStream | null>(null)
  const chunkSubRef = useRef<DictationCaptureSubscription | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  onTranscriptRef.current = onTranscript
  onErrorRef.current = onError

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
    chunkSubRef.current?.remove()
    chunkSubRef.current = null
    streamRef.current?.destroy()
    streamRef.current = null
    void capture.end()
    capture.release()
  }, [capture])

  const start = useCallback(async () => {
    if (!enabled || activeRef.current) {
      return
    }

    setStatus('starting')
    setError(null)
    activeRef.current = true

    // Read fresh on every start, never a token held from an earlier read: a sign-in (or sign-out)
    // on Voice settings takes effect on the next tap (2026-10-14).
    const cred = await fetchAnthropicCredential().catch(() => null)
    setAvailable(cred !== null)
    if (!cred) {
      activeRef.current = false
      setStatus('error')
      const msg = 'Sign in to Anthropic in Voice settings to dictate'
      setError(msg)
      onErrorRef.current?.(new Error(msg))
      return
    }

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
      { accessToken: cred.accessToken, language: lang },
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
  }, [capture, enabled, lang, teardown])

  const stop = useCallback(async () => {
    if (!activeRef.current) {
      return
    }
    setStatus('processing')
    await capture.end()
    // Claude Code CLI: finalize() sends CloseStream, starts the two timers,
    // and resolves when the final transcript is delivered or a timeout fires.
    // The stream's onTranscript(text, true) callback handles the rest.
    streamRef.current?.finalize().catch(() => undefined)
  }, [capture])

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
    start,
    stop,
    cancel
  }
}
