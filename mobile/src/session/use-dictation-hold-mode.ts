import { useCallback, useRef } from 'react'
import type { DictationEngine } from '../dictation/dictation-engine'
import type { UseMobileDictationResult } from '../hooks/mobile-dictation-session-state'
import type { UseAnthropicDictationResult } from '../hooks/use-anthropic-dictation'
import type { UseMobileLiveTranscriptionResult } from '../hooks/use-mobile-live-transcription'

/** Claude mobile (e5.java:226): 500 ms post-release grace. */
const RELEASE_GRACE_MS = 500
/** Claude mobile (pm0.java): latch to server after 3 s silence. */
const EFFICACY_LATCH_MS = 3000

export type DictationHoldModeActions = {
  handlePressIn: () => void
  handlePressOut: () => void
  handleToggle: () => void
  markTextProduced: () => void
  startDictation: () => void
  cancelDictation: (forSend?: boolean) => void
}

export function useDictationHoldMode(opts: {
  dictation: UseMobileDictationResult
  engineChoice: DictationEngine
  usesLivePartials: boolean
  liveTranscription: UseMobileLiveTranscriptionResult
  anthropicDictation: UseAnthropicDictationResult
  /** Whether the take's words go into the chat composer (a send ends only that kind of take). */
  targetIsChat: () => boolean
  prepareLiveStart: () => void
  /** Claims the desktop route context; returns the release a failed start calls. */
  prepareDesktopStart: () => () => void
  restoreLiveCancel: (forSend: boolean) => void
  triggerError: () => void
  showToast: (msg: string) => void
  reportDictationFailure: (err: unknown) => void
}): DictationHoldModeActions {
  const {
    dictation, engineChoice, usesLivePartials,
    liveTranscription, anthropicDictation, targetIsChat,
    prepareLiveStart, prepareDesktopStart, restoreLiveCancel,
    triggerError, showToast, reportDictationFailure
  } = opts

  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const efficacyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveProducedTextRef = useRef(false)
  const liveIsRecordingRef = useRef(false)
  liveIsRecordingRef.current = liveTranscription.isRecording

  const clearGrace = useCallback(() => {
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null }
  }, [])
  const clearEfficacy = useCallback(() => {
    if (efficacyTimerRef.current) { clearTimeout(efficacyTimerRef.current); efficacyTimerRef.current = null }
  }, [])

  const markTextProduced = useCallback(() => { liveProducedTextRef.current = true }, [])

  const startDictation = useCallback(() => {
    if (usesLivePartials) {
      prepareLiveStart()
      const startFn = engineChoice === 'anthropic' ? anthropicDictation.start : liveTranscription.start
      liveProducedTextRef.current = false
      clearEfficacy()
      void startFn().catch((err: unknown) => {
        clearEfficacy()
        triggerError()
        showToast(err instanceof Error ? err.message : String(err))
      })
      if (engineChoice === 'live' && anthropicDictation.available) {
        efficacyTimerRef.current = setTimeout(() => {
          efficacyTimerRef.current = null
          if (!liveProducedTextRef.current && liveIsRecordingRef.current) {
            console.log('[dictation] latching to server path')
            void liveTranscription.cancel()
            void anthropicDictation.start().catch((e: unknown) => {
              triggerError()
              showToast(e instanceof Error ? e.message : String(e))
            })
          }
        }, EFFICACY_LATCH_MS)
      }
      return
    }
    const releaseRouteContext = prepareDesktopStart()
    void dictation.start().catch((err: unknown) => {
      releaseRouteContext()
      reportDictationFailure(err)
    })
  }, [
    anthropicDictation, clearEfficacy, dictation, engineChoice,
    liveTranscription, prepareDesktopStart, prepareLiveStart,
    reportDictationFailure, showToast, triggerError, usesLivePartials
  ])

  const cancelDictation = useCallback((forSend = false) => {
    clearGrace()
    clearEfficacy()
    // Either route: gated on live transcription, the mic kept running on a phone without one and
    // wrote the spoken words back in (2026-09-13). Only a chat take ends with the send; a terminal
    // take keeps its live transcript.
    if (forSend && !(targetIsChat() && (dictation.isStarting || dictation.isRecording || dictation.isProcessing))) {
      return
    }
    restoreLiveCancel(forSend)
    void dictation.cancel()
  }, [clearEfficacy, clearGrace, dictation, restoreLiveCancel, targetIsChat])

  const handlePressIn = useCallback(() => {
    if (graceTimerRef.current) { clearGrace(); return }
    if (!dictation.isStarting && !dictation.isRecording && !dictation.isProcessing) {
      startDictation()
    }
  }, [clearGrace, dictation, startDictation])

  const handlePressOut = useCallback(() => {
    if (dictation.isRecording) {
      clearEfficacy()
      if (engineChoice === 'live') {
        graceTimerRef.current = setTimeout(() => {
          graceTimerRef.current = null
          void dictation.stop()
        }, RELEASE_GRACE_MS)
      } else {
        void dictation.stop()
      }
    } else if (dictation.isStarting) {
      cancelDictation()
    }
  }, [cancelDictation, clearEfficacy, dictation, engineChoice])

  const handleToggle = useCallback(() => {
    if (dictation.isProcessing) { cancelDictation() }
    else if (dictation.isStarting) { /* settling */ }
    else if (dictation.isRecording) { void dictation.stop() }
    else { startDictation() }
  }, [cancelDictation, dictation, startDictation])

  return {
    handlePressIn, handlePressOut, handleToggle,
    markTextProduced, startDictation, cancelDictation
  }
}
