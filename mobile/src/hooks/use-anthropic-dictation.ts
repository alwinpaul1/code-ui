import { useCallback, useEffect, useRef, useState } from 'react'
import { useDictationCapture } from '../platform/dictation-capture'
import {
  fetchAnthropicCredential,
  type AnthropicCredential
} from '../dictation/anthropic-credential-reader'
import { AnthropicVoiceStream } from '../dictation/anthropic-voice-stream'
import type { RpcClient } from '../transport/rpc-client'
import type {
  DictationStatus,
  UseMobileDictationResult
} from './mobile-dictation-session-state'
import type { DictationCaptureSubscription } from '../platform/dictation-capture-contract'

export type UseAnthropicDictationOptions = {
  client: RpcClient | null
  worktreeId: string
  enabled: boolean
  /** Called on every partial and on the final result.
   *  Matches the live engine signature: `(text, final, interim)`.
   *  Claude Code CLI: `onTranscript(text, isFinal)`. */
  onTranscript: (text: string, final: boolean, interim?: string) => void
  onError?: (error: Error) => void
  lang?: string
}

export type UseAnthropicDictationResult = UseMobileDictationResult & {
  available: boolean
}

/** Token must have at least this much life left to start a dictation. */
const TOKEN_MARGIN_MS = 60_000

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
  const { client, worktreeId, enabled, onTranscript, onError, lang = 'en' } =
    options
  const capture = useDictationCapture()
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)

  const activeRef = useRef(false)
  const streamRef = useRef<AnthropicVoiceStream | null>(null)
  const credentialRef = useRef<AnthropicCredential | null>(null)
  const chunkSubRef = useRef<DictationCaptureSubscription | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  onTranscriptRef.current = onTranscript
  onErrorRef.current = onError

  // Background probe: phone store is instant, no desktop needed.
  useEffect(() => {
    let cancelled = false
    fetchAnthropicCredential(client, worktreeId).then(
      (cred) => {
        if (cancelled) {
          return
        }
        credentialRef.current = cred
        setAvailable(cred !== null)
      },
      () => {
        // Non-fatal.
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, worktreeId])

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
    if (!client || !enabled || activeRef.current) {
      return
    }

    setStatus('starting')
    setError(null)
    activeRef.current = true

    // Credential: phone store first, then desktop keychain.
    let cred = credentialRef.current
    if (!cred || cred.expiresAt - Date.now() < TOKEN_MARGIN_MS) {
      cred = await fetchAnthropicCredential(client, worktreeId)
      credentialRef.current = cred
      setAvailable(cred !== null)
    }
    if (!cred) {
      activeRef.current = false
      setStatus('error')
      const msg = 'Could not read Anthropic credentials'
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
  }, [capture, client, enabled, lang, teardown, worktreeId])

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
    start,
    stop,
    cancel
  }
}
