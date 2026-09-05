import { useEffect, useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useMobileDictation } from '../hooks/use-mobile-dictation'
import { useMobileLiveTranscription } from '../hooks/use-mobile-live-transcription'
import { applyLiveTranscript } from '../hooks/mobile-live-transcript'
import { liveDictationDelta } from '../hooks/mobile-live-dictation-delta'
import { loadLiveTranscriptionEnabled } from '../storage/preferences'
import { triggerError } from '../platform/haptics'
import {
  appendBufferedDictation,
  routeDictationTranscript
} from '../terminal/terminal-live-dictation-routing'
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
    activeHandleRef,
    deviceTokenRef,
    nativeChatTranscriptIsLocalReadable,
    nativeChatInputLeaseReady,
    connState,
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

  // Chat dictation transcribes on the phone so the words show up as they are
  // spoken (Claude Code's own voice input behaves this way); the desktop model
  // path below stays for the terminal and as the fallback.
  const [liveTranscriptionEnabled, setLiveTranscriptionEnabled] = useState(true)
  const liveBaseTextRef = useRef('')
  // Where a live transcript lands: the chat composer, the buffered command box,
  // or (live terminal input) the PTY line itself, revised with backspaces.
  const liveTargetRef = useRef<{ kind: 'chat' } | { kind: 'buffered' } | { kind: 'pty'; handle: string; typed: string }>({ kind: 'chat' })
  const liveTranscription = useMobileLiveTranscription({
    onTranscript: (text) => {
      const base = liveBaseTextRef.current
      const target = liveTargetRef.current
      if (target.kind === 'chat') {
        nativeChatController.setChatComposerText(() => applyLiveTranscript(base, text))
        return
      }
      if (target.kind === 'buffered') {
        setInput(() => applyLiveTranscript(base, text))
        return
      }
      const delta = liveDictationDelta(target.typed, text)
      target.typed = text
      if (delta) {
        void sendLiveTerminalInput(target.handle, delta)
      }
    },
    onError: (err) => {
      triggerError()
      showToast(err.message)
    }
  })
  const desktopDictation = useMobileDictation({
    client,
    enabled: canSend,
    onTranscript: (text) => {
      // Why: dictation belongs to the visible composer — native chat consumes it locally, terminal mode keeps live-input routing.
      if (showNativeChatRef.current) {
        nativeChatController.setChatComposerText((current) =>
          appendBufferedDictation(current, text)
        )
        showToast('Dictation inserted')
        return
      }
      // Live mode inserts the transcript into its PTY as text (no Return); buffered mode appends to the command field.
      const routeContext = dictationRouteContextRef.current
      dictationRouteContextRef.current = null
      const route = routeDictationTranscript(
        text,
        routeContext?.liveInputEnabled ?? liveInputEnabled
      )
      if (route.kind === 'live-insert') {
        const insertHandle = routeContext?.handle ?? activeHandleRef.current
        if (!insertHandle) {
          return
        }
        void (async () => {
          const flushedPendingInput = await flushPendingLiveInputBeforeExternalSend(insertHandle)
          if (!flushedPendingInput) {
            return
          }
          const sent = await sendLiveTerminalInput(insertHandle, route.text)
          if (sent) {
            showToast('Dictation inserted')
          }
        })()
        return
      }
      setInput((current) => appendBufferedDictation(current, route.text))
      showToast('Dictation inserted')
    },
    onError: (err) => {
      dictationRouteContextRef.current = null
      // Dictation not set up on desktop → open the setup sheet instead of a dead-end toast.
      if (isDictationSetupRequiredError(err.message)) {
        setShowDictationSetup(true)
        return
      }
      triggerError()
      showToast(err.message)
    }
  })

  const useLiveTranscription = liveTranscriptionEnabled && liveTranscription.available
  const dictation = useLiveTranscription ? liveTranscription : desktopDictation

  const startDictation = useCallback(() => {
    if (useLiveTranscription) {
      if (showNativeChatRef.current) {
        liveTargetRef.current = { kind: 'chat' }
        liveBaseTextRef.current = nativeChatController.chatComposerText
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
      triggerError()
      showToast(err instanceof Error ? err.message : String(err))
    })
  }, [
    activeHandle,
    dictation,
    liveInputTerminalHandles,
    liveTranscription,
    nativeChatController,
    setInput,
    showNativeChatRef,
    triggerError,
    showToast,
    useLiveTranscription
  ])

  const cancelDictation = useCallback(() => {
    dictationRouteContextRef.current = null
    if (useLiveTranscription) {
      const base = liveBaseTextRef.current
      const target = liveTargetRef.current
      if (target.kind === 'chat') {
        nativeChatController.setChatComposerText(() => base)
      } else if (target.kind === 'buffered') {
        setInput(() => base)
      } else if (target.typed) {
        void sendLiveTerminalInput(target.handle, liveDictationDelta(target.typed, ''))
        target.typed = ''
      }
    }
    void dictation.cancel()
  }, [dictation, nativeChatController, sendLiveTerminalInput, setInput, useLiveTranscription])

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
  useFocusEffect(
    useCallback(() => {
      void refreshDictationMode()
      void loadLiveTranscriptionEnabled().then(setLiveTranscriptionEnabled)
    }, [refreshDictationMode])
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
    startDictation,
    cancelDictation,
    handleDictationToggle,
    handleDictationPressIn,
    handleDictationPressOut,
    refreshDictationMode
  }
}

export type MobileSessionNativeChatDictationModel = MobileSessionFeedbackCapabilitiesModel &
  ReturnType<typeof useMobileSessionNativeChatDictation>
