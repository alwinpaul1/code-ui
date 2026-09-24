import { useEffect, useCallback, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useMobileDictation } from '../hooks/use-mobile-dictation'
import { useMobileLiveTranscription } from '../hooks/use-mobile-live-transcription'
import { liveDictationDelta } from '../hooks/mobile-live-dictation-delta'
import type { DictationPaint } from '../hooks/mobile-live-transcript'
import { chooseDictationEngine } from '../dictation/dictation-engine'
import {
  deliverDesktopDictation,
  placeSpokenText
} from '../dictation/place-dictation-transcript'
import { triggerError } from '../platform/haptics'
import {
  fetchDictationSetup,
  isDictationSetupRequiredError
} from '../dictation/mobile-dictation-setup'
import { useMobileNativeChatController } from './use-mobile-native-chat-controller'
import { useMobileNativeChatReadability } from './use-mobile-native-chat-readability'
import { useMobileNativeChatInputLease } from './use-mobile-native-chat-input-lease'
import { useMobileNativeChatSendError } from './use-mobile-native-chat-send-error'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { useMobileSendCompletionGeneration } from './use-mobile-send-completion-generation'
import type { MobileSessionFeedbackCapabilitiesModel } from './use-mobile-session-feedback-capabilities'

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
    flushPendingLiveInputBeforeExternalSend,
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
    agentSessionPromptCancelSupported,
    onSendError: nativeChatSendError.show,
    onSendResolved: nativeChatSendError.clear
  })
  const { toggleTabChatView, showNativeChat, showNativeChatRef } = nativeChatController
  nativeChatSendError.bannerMountedRef.current = showNativeChat
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
  // Where a live transcript lands: the chat composer, the buffered command box,
  // or (live terminal input) the PTY line itself, revised with backspaces.
  const liveTargetRef = useRef<{ kind: 'chat' } | { kind: 'buffered' } | { kind: 'pty'; handle: string; typed: string }>({ kind: 'chat' })
  const onSpoken = (text: string, _final?: boolean, interim = '') => {
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
  const desktopDictation = useMobileDictation({
    client,
    enabled: canSend,
    onTranscript: (text) => {
      const routeContext = dictationRouteContextRef.current
      dictationRouteContextRef.current = null
      deliverDesktopDictation({
        text,
        showNativeChat: showNativeChatRef.current,
        setChatComposerText: nativeChatController.setChatComposerText,
        showToast,
        routeContext,
        liveInputEnabled,
        activeHandle: activeHandleRef.current,
        flushPending: flushPendingLiveInputBeforeExternalSend,
        sendLiveTerminalInput,
        setInput
      })
    },
    onError: (err) => {
      dictationRouteContextRef.current = null
      reportDictationFailure(err)
    }
  })

  const useLiveTranscription = chooseDictationEngine(liveTranscription.available) === 'live'
  const dictation = useLiveTranscription ? liveTranscription : desktopDictation

  const startDictation = useCallback(() => {
    if (useLiveTranscription) {
      if (showNativeChatRef.current) {
        const draft = nativeChatController.chatComposerText
        const cursor = Math.max(0, Math.min(composerCursorRef.current, draft.length))
        chatInsertRef.current = { prefix: draft.slice(0, cursor), suffix: draft.slice(cursor) }
        liveTargetRef.current = { kind: 'chat' }
        liveBaseTextRef.current = draft
        setDictationPaint(null)
      } else if (activeHandle && liveInputTerminalHandles.has(activeHandle)) {
        liveTargetRef.current = { kind: 'pty', handle: activeHandle, typed: '' }
      } else {
        liveTargetRef.current = { kind: 'buffered' }
        setInput((current) => {
          liveBaseTextRef.current = current
          return current
        })
      }
      void liveTranscription.start().catch((err) => {
        triggerError()
        showToast(err instanceof Error ? err.message : String(err))
      })
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
    dictation,
    liveInputTerminalHandles,
    liveTranscription,
    nativeChatController,
    reportDictationFailure,
    setInput,
    showNativeChatRef,
    triggerError,
    showToast,
    useLiveTranscription
  ])

  const cancelDictation = useCallback((forSend = false) => {
    // Either route: gated on live transcription, the mic kept running on a
    // phone without one and wrote the spoken words back in (2026-09-13).
    if (forSend && !(liveTargetRef.current.kind === 'chat' && (dictation.isStarting || dictation.isRecording || dictation.isProcessing))) {
      return
    }
    dictationRouteContextRef.current = null
    if (useLiveTranscription) {
      const base = liveBaseTextRef.current
      const target = liveTargetRef.current
      // For a send the spoken words leave with the message: nothing is put back.
      liveBaseTextRef.current = forSend ? '' : base
      if (!forSend && target.kind === 'chat') {
        nativeChatController.setChatComposerText(() => base)
      } else if (target.kind === 'buffered') {
        setInput(() => base)
      } else if (target.kind === 'pty' && target.typed) {
        void sendLiveTerminalInput(target.handle, liveDictationDelta(target.typed, ''))
        target.typed = ''
      }
    }
    void dictation.cancel()
  }, [dictation, nativeChatController, sendLiveTerminalInput, setInput, useLiveTranscription])

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
  const handleDictationPressIn = useCallback(() => {
    if (!dictation.isStarting && !dictation.isRecording && !dictation.isProcessing) {
      startDictation()
    }
  }, [dictation, startDictation])

  const handleDictationPressOut = useCallback(() => {
    if (dictation.isRecording) {
      void dictation.stop()
    } else if (dictation.isStarting) {
      // Released before recording began: cancel so we don't leave a live mic.
      cancelDictation()
    }
  }, [cancelDictation, dictation])

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
    nativeChatSendError,
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
