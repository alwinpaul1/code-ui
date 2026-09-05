import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import type { DictationStatus, UseMobileDictationResult } from './mobile-dictation-session-state'
import { composeLiveTranscript } from './mobile-live-transcript'

export type UseMobileLiveTranscriptionOptions = {
  /** Fires on every partial and final result with the full transcript so far. */
  onTranscript: (text: string, final: boolean) => void
  onError?: (error: Error) => void
  lang?: string
}

export type UseMobileLiveTranscriptionResult = UseMobileDictationResult & {
  /** False when the phone has no speech recognizer (rare on Android, needs Google app). */
  available: boolean
  /** Input level 0..1 while recording (0 when quiet or idle); drives the voice bars. */
  level: number
}

type Recognizer = Pick<
  typeof ExpoSpeechRecognitionModule,
  'start' | 'stop' | 'abort' | 'addListener' | 'requestPermissionsAsync' | 'isRecognitionAvailable'
>

/**
 * On-phone dictation with text that appears as you speak, the way Claude Code's
 * own voice input does. The transcript is assembled locally (Android segments,
 * iOS one growing result) and handed to the caller on each change; nothing goes
 * to the desktop. The desktop-model path (`useMobileDictation`) stays available
 * for the terminal and as the fallback when the phone has no recognizer.
 */
export function useMobileLiveTranscription(
  options: UseMobileLiveTranscriptionOptions,
  recognizer: Recognizer = ExpoSpeechRecognitionModule
): UseMobileLiveTranscriptionResult {
  const { onTranscript, onError, lang = 'en-US' } = options
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const available = useMemo(() => {
    try {
      return recognizer.isRecognitionAvailable()
    } catch {
      return false
    }
  }, [recognizer])
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  onTranscriptRef.current = onTranscript
  onErrorRef.current = onError
  const segmentsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const activeRef = useRef(false)

  useEffect(() => {
    const started = recognizer.addListener('start', () => {
      setStatus('recording')
    })
    // The recognizer reports -2..10; below 0 is silence. Map to 0..1.
    const volume = recognizer.addListener('volumechange', (event) => {
      setLevel(Math.max(0, Math.min(1, event.value / 10)))
    })
    const result = recognizer.addListener('result', (event) => {
      if (!activeRef.current) {
        return
      }
      const transcript = event.results[0]?.transcript ?? ''
      if (event.isFinal) {
        segmentsRef.current = [...segmentsRef.current, transcript]
        interimRef.current = ''
      } else {
        interimRef.current = transcript
      }
      onTranscriptRef.current(composeLiveTranscript(segmentsRef.current, interimRef.current), false)
    })
    const ended = recognizer.addListener('end', () => {
      if (!activeRef.current) {
        return
      }
      activeRef.current = false
      setStatus('idle')
      setLevel(0)
      onTranscriptRef.current(composeLiveTranscript(segmentsRef.current, interimRef.current), true)
    })
    const failed = recognizer.addListener('error', (event) => {
      // "aborted" is our own cancel; "no-speech" on release is a quiet room.
      if (event.error === 'aborted' || event.error === 'no-speech') {
        return
      }
      activeRef.current = false
      setStatus('error')
      setError(event.message)
      onErrorRef.current?.(new Error(event.message || event.error))
    })
    return () => {
      started.remove()
      volume.remove()
      result.remove()
      ended.remove()
      failed.remove()
    }
  }, [recognizer])

  const start = useCallback(async () => {
    if (activeRef.current) {
      return
    }
    const permission = await recognizer.requestPermissionsAsync()
    if (!permission.granted) {
      throw new Error('Microphone permission denied')
    }
    segmentsRef.current = []
    interimRef.current = ''
    activeRef.current = true
    setError(null)
    setStatus('starting')
    recognizer.start({
      lang,
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
      // Hold-to-talk: never stop on a pause; the release stops it.
      androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 60_000 }
    })
  }, [lang, recognizer])

  const stop = useCallback(async () => {
    if (!activeRef.current) {
      return
    }
    setStatus('processing')
    recognizer.stop()
  }, [recognizer])

  const cancel = useCallback(async () => {
    if (!activeRef.current) {
      return
    }
    activeRef.current = false
    segmentsRef.current = []
    interimRef.current = ''
    setStatus('idle')
    setLevel(0)
    recognizer.abort()
  }, [recognizer])

  return {
    status,
    isStarting: status === 'starting',
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    error,
    start,
    stop,
    cancel,
    available,
    level
  }
}
