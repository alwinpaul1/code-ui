import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useMobileDictation } from '../hooks/use-mobile-dictation'
import { useMobileLiveTranscription } from '../hooks/use-mobile-live-transcription'
import { useAnthropicDictation } from '../hooks/use-anthropic-dictation'
import type { DictationPaint } from '../hooks/mobile-live-transcript'
import { chooseDictationEngine } from '../dictation/dictation-engine'
import {
  deliverSessionDesktopDictation,
  placeSpokenText,
  type LiveDictationTarget
} from '../dictation/place-dictation-transcript'
import { eraseLiveTranscript, ptyDictationTarget } from '../dictation/live-terminal-dictation'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerError } from '../platform/haptics'
import {
  fetchDictationSetup,
  isDictationSetupRequiredError
} from '../dictation/mobile-dictation-setup'
import { useMobileNativeChatController } from './use-mobile-native-chat-controller'
import { useMobileNativeChatReadability } from './use-mobile-native-chat-readability'
import { useMobileNativeChatInputLease } from './use-mobile-native-chat-input-lease'
import { useMobileNativeChatSendError, mobileNativeChatSendErrorMessage } from './use-mobile-native-chat-send-error'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { useMobileSendCompletionGeneration } from './use-mobile-send-completion-generation'
import type { MobileSessionFeedbackCapabilitiesModel } from './use-mobile-session-feedback-capabilities'

/** Claude mobile (e5.java:226): 500 ms post-release grace before the
 *  recognizer stops. */
const RELEASE_GRACE_MS = 500
/** Claude mobile (pm0.java): if on-device produces no text within this
 *  window, switch to Anthropic's server path ("latching to server path"). */
const EFFICACY_LATCH_MS = 3000

export function useMobileSessionNativeChatDictation(
  scope: MobileSessionFeedbackCapabilitiesModel,
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
) {
  const {
    hostId,
    worktreeId,
    client,
    connState,
    agentSessionPromptCancelSupported,
    agentSessionRepeatedStopSupported,
    setInput,
    liveInputTerminalHandles,
    activeHandle,
    activeSessionTabId,
    diffComments,
    diffCommentsRef,
    setShowDictationSetup,
    setDictationMode,
    deviceTokenRef,
    dictationRouteContextRef,
    activeHandleRef,
    activeSessionTab,
    canSend,
    liveInputEnabled,
    showToast,
    resetLiveInputFocus
  } = scope
  const nativeChatScopeKey = mobileNativeChatScopeKey(hostId, worktreeId, activeSessionTabId)
  const nativeChatSendError = useMobileNativeChatSendError({
    scopeKey: nativeChatScopeKey,
    showToast
  })
  const nativeChatTranscriptIsLocalReadable = useMobileNativeChatReadability(client, worktreeId)
  const {
    ready: nativeChatInputLeaseReady,
    readyRef: nativeChatInputLeaseReadyRef,
    lockReason: nativeChatInputLockReason,
    markReady: markNativeChatInputLeaseReady,
    clear: clearNativeChatInputLease
  } = useMobileNativeChatInputLease({
    activeHandle,
    connected: connState === 'connected'
  })
  const nativeChatController = useMobileNativeChatController({
    client,
    hostId,
    worktreeId,
    activeSessionTab,
    activeSessionTabId,
    activeHandle,
    activeHandleRef,
    deviceTokenRef,
    nativeChatTranscriptIsLocalReadable,
    nativeChatInputLeaseReady,
    connState,
    // Set by the first tab list the host sends; until then the screen shows
    // the tabs the last visit cached (use-mobile-session-tab-application.ts).
    tabsLive: scope.terminalsLoaded,
    agentSessionPromptCancelSupported,
    agentSessionRepeatedStopSupported,
    onSendError: nativeChatSendError.show,
    onSendResolved: nativeChatSendError.clear
  })
  const { toggleTabChatView, showNativeChat, showNativeChatRef } = nativeChatController
  // A sign-in rejection's guidance steps aside once the chat's own row says it (Orca #26544).
  const { message: sendErrorText, failure: sendErrorFailure } = nativeChatSendError, chatMessages = nativeChatController.nativeChatSession.messages
  const sendErrorMessage = useMemo(() => mobileNativeChatSendErrorMessage({ message: sendErrorText, failure: sendErrorFailure }, chatMessages), [sendErrorText, sendErrorFailure, chatMessages])
  nativeChatSendError.bannerMountedRef.current = showNativeChat
  nativeChatSendError.keepWhile(nativeChatController.nativeChatCommandRefusalCauses)
  const nativeChatOverlayInputLockReason =
    activeSessionTab?.type === 'agent-session'
      ? connState === 'connected'
        ? null
        : 'disconnected'
      : nativeChatInputLockReason
  const routeKey = nativeChatScopeKey ?? `${hostId}\0${worktreeId}`
  const getSendCompletionGeneration = useMobileSendCompletionGeneration({
    onBlur: resetLiveInputFocus,
    surfaceKey: JSON.stringify([routeKey, activeHandle, showNativeChat, liveInputEnabled])
  })

  /**
   * One policy for every dictation failure, whichever entry point sees it: `onError` for a
   * dictation already underway, `start`'s rejection for the tap that never got one. Written twice,
   * only the first knew about the setup sheet, so a desktop refusing the start with
   * `voice_dictation_disabled` showed the user that code as a toast.
   */
  const reportDictationFailure = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      // Dictation not set up on desktop → open the setup sheet instead of a dead-end toast.
      if (isDictationSetupRequiredError(message)) {
        setShowDictationSetup(true)
        return
      }
      triggerError()
      showToast(message)
    },
    [setShowDictationSetup, showToast]
  )

  // Chat dictation uses the phone recognizer so the words show up as they are
  // spoken. The desktop path is the fallback when the phone has no recognizer.
  const liveBaseTextRef = useRef('')
  const composerCursorRef = useRef(0)
  const chatInsertRef = useRef({ prefix: '', suffix: '' })
  const [dictationPaint, setDictationPaint] = useState<DictationPaint | null>(null)
  const liveTargetRef = useRef<LiveDictationTarget>({ kind: 'chat' })

  // Claude mobile: grace period on hold-release and efficacy latch.
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const efficacyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** True once the on-device recognizer has produced any text this take. */
  const liveProducedTextRef = useRef(false)
  /** Review fix #10: ref so the efficacy latch reads current state, not a
   *  stale closure value. Updated after each engine choice render. */
  const liveIsRecordingRef = useRef(false)

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }, [])
  const clearEfficacyTimer = useCallback(() => {
    if (efficacyTimerRef.current) {
      clearTimeout(efficacyTimerRef.current)
      efficacyTimerRef.current = null
    }
  }, [])

  const onSpoken = (text: string, _final?: boolean, interim = '') => {
    liveProducedTextRef.current = true
    const { prefix, suffix } = chatInsertRef.current
    setDictationPaint(placeSpokenText(
      text,
      interim,
      liveTargetRef.current,
      prefix,
      suffix,
      liveBaseTextRef.current,
      nativeChatController.setChatComposerText,
      setInput,
      sendLiveTerminalInput
    ))
  }
  const onSpokenError = (err: Error) => {
    triggerError()
    showToast(err.message)
  }
  const liveTranscription = useMobileLiveTranscription({
    onTranscript: onSpoken,
    onError: onSpokenError
  })
  const clipboard = useClipboardWriter()
  const desktopDictation = useMobileDictation({
    client,
    enabled: canSend,
    onTranscript: (text) =>
      deliverSessionDesktopDictation(scope, text, {
        showNativeChat: showNativeChatRef.current,
        setChatComposerText: nativeChatController.setChatComposerText,
        sendLiveTerminalInput,
        // Where the words go when no field on screen can take them, to paste into the live field.
        copyToClipboard: clipboard.writeText
      }),
    onError: (err) => {
      dictationRouteContextRef.current = null
      reportDictationFailure(err)
    }
  })

  const anthropicDictation = useAnthropicDictation({
    client,
    worktreeId,
    enabled: canSend,
    onTranscript: onSpoken,
    onError: onSpokenError,
    lang: 'en'
  })

  const engineChoice = chooseDictationEngine(liveTranscription.available, anthropicDictation.available)
  const usesLivePartials = engineChoice === 'live' || engineChoice === 'anthropic'
  const dictation = engineChoice === 'anthropic'
    ? anthropicDictation
    : engineChoice === 'live'
      ? liveTranscription
      : desktopDictation

  // Review fix #10: keep a ref so the efficacy latch timer reads current
  // recording state instead of a stale closure capture.
  liveIsRecordingRef.current = liveTranscription.isRecording

  const startDictation = useCallback(() => {
    if (usesLivePartials) {
      if (showNativeChatRef.current) {
        const draft = nativeChatController.chatComposerText
        const cursor = Math.max(0, Math.min(composerCursorRef.current, draft.length))
        chatInsertRef.current = { prefix: draft.slice(0, cursor), suffix: draft.slice(cursor) }
        liveTargetRef.current = { kind: 'chat' }
        liveBaseTextRef.current = draft
        setDictationPaint(null)
      } else if (activeHandle && liveInputTerminalHandles.has(activeHandle)) {
        liveTargetRef.current = ptyDictationTarget(activeHandle, liveTargetRef.current)
      } else {
        liveTargetRef.current = { kind: 'buffered' }
        setInput((current) => {
          liveBaseTextRef.current = current
          return current
        })
      }
      const startFn = engineChoice === 'anthropic' ? anthropicDictation.start : liveTranscription.start
      liveProducedTextRef.current = false
      clearEfficacyTimer()
      void startFn().catch((err) => {
        clearEfficacyTimer()
        triggerError()
        showToast(err instanceof Error ? err.message : String(err))
      })
      // Claude mobile efficacy latch: if the on-device recognizer produces no
      // text within 3 s, cancel it and switch to Anthropic's server path.
      if (engineChoice === 'live' && anthropicDictation.available) {
        efficacyTimerRef.current = setTimeout(() => {
          efficacyTimerRef.current = null
          if (!liveProducedTextRef.current && liveIsRecordingRef.current) {
            console.log('[dictation] no text from on-device recognizer, latching to server path')
            void liveTranscription.cancel()
            void anthropicDictation.start().catch((err) => {
              triggerError()
              showToast(err instanceof Error ? err.message : String(err))
            })
          }
        }, EFFICACY_LATCH_MS)
      }
      return
    }
    const routeContext = activeHandle
      ? { handle: activeHandle, liveInputEnabled: liveInputTerminalHandles.has(activeHandle) }
      : null
    dictationRouteContextRef.current = routeContext
    void dictation.start().catch((err) => {
      if (dictationRouteContextRef.current === routeContext) {
        dictationRouteContextRef.current = null
      }
      reportDictationFailure(err)
    })
  }, [
    activeHandle,
    anthropicDictation,
    clearEfficacyTimer,
    dictation,
    engineChoice,
    liveInputTerminalHandles,
    liveTranscription,
    nativeChatController,
    reportDictationFailure,
    setInput,
    showNativeChatRef,
    triggerError,
    showToast,
    usesLivePartials
  ])

  const cancelDictation = useCallback((forSend = false) => {
    clearGraceTimer()
    clearEfficacyTimer()
    // Either route: gated on live transcription, the mic kept running on a
    // phone without one and wrote the spoken words back in (2026-09-13).
    if (forSend && !(liveTargetRef.current.kind === 'chat' && (dictation.isStarting || dictation.isRecording || dictation.isProcessing))) {
      return
    }
    dictationRouteContextRef.current = null
    if (usesLivePartials) {
      const base = liveBaseTextRef.current
      const target = liveTargetRef.current
      // For a send the spoken words leave with the message: nothing is put back.
      liveBaseTextRef.current = forSend ? '' : base
      if (!forSend && target.kind === 'chat') {
        nativeChatController.setChatComposerText(() => base)
      } else if (target.kind === 'buffered') {
        setInput(() => base)
      } else if (target.kind === 'pty') {
        eraseLiveTranscript(target, sendLiveTerminalInput)
      }
    }
    void dictation.cancel()
  }, [clearEfficacyTimer, clearGraceTimer, dictation, nativeChatController, sendLiveTerminalInput, setInput, usesLivePartials])

  // Send while the mic is on: the words spoken so far go with the message, so
  // the recogniser is dropped without putting the base text back — a stop
  // would deliver one more transcript and write the sent words into the empty
  // composer (2026-09-13). Speaking again is a fresh tap on the mic.
  // Toggle mode: one tap starts, the next stops; long-press cancels mid-record.
  const handleDictationToggle = useCallback(() => {
    if (dictation.isProcessing) {
      cancelDictation()
    } else if (dictation.isStarting) {
      // The start request is still settling; a second toggle is intentionally ignored.
    } else if (dictation.isRecording) {
      void dictation.stop()
    } else {
      startDictation()
    }
  }, [cancelDictation, dictation, startDictation])

  // Hold mode: press starts, release stops — like a walkie-talkie.
  // Claude mobile: on-device path keeps listening 500 ms after the finger
  // lifts, then waits up to 2.5 s for the final text. The server path sends
  // CloseStream immediately on release.
  const handleDictationPressIn = useCallback(() => {
    // User pressed again during the grace period — continue recording.
    if (graceTimerRef.current) {
      clearGraceTimer()
      return
    }
    if (!dictation.isStarting && !dictation.isRecording && !dictation.isProcessing) {
      startDictation()
    }
  }, [clearGraceTimer, dictation, startDictation])

  const handleDictationPressOut = useCallback(() => {
    if (dictation.isRecording) {
      if (engineChoice === 'live') {
        // On-device: keep listening 500 ms more (Claude mobile behaviour).
        clearEfficacyTimer()
        graceTimerRef.current = setTimeout(() => {
          graceTimerRef.current = null
          void dictation.stop()
        }, RELEASE_GRACE_MS)
      } else {
        // Server path (Anthropic / desktop): stop immediately.
        clearEfficacyTimer()
        void dictation.stop()
      }
    } else if (dictation.isStarting) {
      // Released before recording began: cancel so we don't leave a live mic.
      cancelDictation()
    }
  }, [cancelDictation, clearEfficacyTimer, dictation, engineChoice])

  const refreshDictationMode = useCallback(async () => {
    if (!client) {
      return
    }
    try {
      const setup = await fetchDictationSetup(client)
      setDictationMode(setup.dictationMode)
    } catch {
      // Non-fatal: fall back to the default toggle behavior.
    }
  }, [client])

  // Re-read on focus so a Settings ▸ Voice dictation-mode change is reflected on return.
  const primeRecognizer = liveTranscription.prime
  const releaseRecognizer = liveTranscription.release
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        releaseRecognizer()
      }
    })
    return () => sub.remove()
  }, [releaseRecognizer])
  useFocusEffect(
    useCallback(() => {
      void refreshDictationMode()
      void primeRecognizer()
      return () => releaseRecognizer()
    }, [primeRecognizer, refreshDictationMode, releaseRecognizer])
  )

  useEffect(() => {
    diffCommentsRef.current = diffComments
  }, [diffComments])
  return {
    nativeChatScopeKey,
    nativeChatSendError: { ...nativeChatSendError, message: sendErrorMessage },
    nativeChatTranscriptIsLocalReadable,
    nativeChatInputLeaseReady,
    nativeChatInputLeaseReadyRef,
    nativeChatInputLockReason,
    nativeChatOverlayInputLockReason,
    markNativeChatInputLeaseReady,
    clearNativeChatInputLease,
    nativeChatController,
    getSendCompletionGeneration,
    toggleTabChatView,
    showNativeChat,
    showNativeChatRef,
    dictation,
    dictationPaint,
    composerCursorRef,
    startDictation,
    cancelDictation,
    handleDictationToggle,
    finishDictationForSend: () => cancelDictation(true),
    handleDictationPressIn,
    handleDictationPressOut,
    refreshDictationMode
  }
}

export type MobileSessionNativeChatDictationModel = MobileSessionFeedbackCapabilitiesModel &
  ReturnType<typeof useMobileSessionNativeChatDictation>
