import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useMobileDictation } from '../hooks/use-mobile-dictation'
import { useMobileLiveTranscription } from '../hooks/use-mobile-live-transcription'
import { useAnthropicDictation } from '../hooks/use-anthropic-dictation'
import type { DictationPaint } from '../hooks/mobile-live-transcript'
import { chooseDictationEngine } from '../dictation/dictation-engine'
import { useDictationHoldMode } from './use-dictation-hold-mode'
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

export function useMobileSessionNativeChatDictation(
  scope: MobileSessionFeedbackCapabilitiesModel,
  sendLiveTerminalInput: (handle: string, bytes: string) => Promise<boolean>
) {
  const {
    hostId, worktreeId, client, connState,
    agentSessionPromptCancelSupported, agentSessionRepeatedStopSupported,
    setInput, liveInputTerminalHandles, activeHandle, activeSessionTabId,
    diffComments, diffCommentsRef, setShowDictationSetup, setDictationMode,
    deviceTokenRef, dictationRouteContextRef, activeHandleRef, activeSessionTab,
    canSend, liveInputEnabled, showToast, resetLiveInputFocus, router
  } = scope
  const nativeChatScopeKey = mobileNativeChatScopeKey(hostId, worktreeId, activeSessionTabId)
  const nativeChatSendError = useMobileNativeChatSendError({ scopeKey: nativeChatScopeKey, showToast })
  const nativeChatTranscriptIsLocalReadable = useMobileNativeChatReadability(client, worktreeId)
  const {
    ready: nativeChatInputLeaseReady, readyRef: nativeChatInputLeaseReadyRef,
    lockReason: nativeChatInputLockReason,
    markReady: markNativeChatInputLeaseReady, clear: clearNativeChatInputLease
  } = useMobileNativeChatInputLease({ activeHandle, connected: connState === 'connected' })
  const nativeChatController = useMobileNativeChatController({
    client, hostId, worktreeId, activeSessionTab, activeSessionTabId,
    activeHandle, activeHandleRef, deviceTokenRef,
    nativeChatTranscriptIsLocalReadable, nativeChatInputLeaseReady, connState,
    tabsLive: scope.terminalsLoaded,
    agentSessionPromptCancelSupported, agentSessionRepeatedStopSupported,
    onSendError: nativeChatSendError.show, onSendResolved: nativeChatSendError.clear
  })
  const { toggleTabChatView, showNativeChat, showNativeChatRef } = nativeChatController
  const { message: sendErrorText, failure: sendErrorFailure } = nativeChatSendError, chatMessages = nativeChatController.nativeChatSession.messages
  const sendErrorMessage = useMemo(() => mobileNativeChatSendErrorMessage({ message: sendErrorText, failure: sendErrorFailure }, chatMessages), [sendErrorText, sendErrorFailure, chatMessages])
  nativeChatSendError.bannerMountedRef.current = showNativeChat
  nativeChatSendError.keepWhile(nativeChatController.nativeChatCommandRefusalCauses)
  const nativeChatOverlayInputLockReason =
    activeSessionTab?.type === 'agent-session'
      ? connState === 'connected' ? null : 'disconnected'
      : nativeChatInputLockReason
  const routeKey = nativeChatScopeKey ?? `${hostId}\0${worktreeId}`
  const getSendCompletionGeneration = useMobileSendCompletionGeneration({
    onBlur: resetLiveInputFocus,
    surfaceKey: JSON.stringify([routeKey, activeHandle, showNativeChat, liveInputEnabled])
  })
  const reportDictationFailure = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (isDictationSetupRequiredError(message)) { setShowDictationSetup(true); return }
    triggerError()
    showToast(message)
  }, [setShowDictationSetup, showToast])

  const liveBaseTextRef = useRef('')
  const composerCursorRef = useRef(0)
  const chatInsertRef = useRef({ prefix: '', suffix: '' })
  const [dictationPaint, setDictationPaint] = useState<DictationPaint | null>(null)
  // The take's words for the caption above the recording row (MobileNativeChatDictationCaption).
  const [dictationCaption, setDictationCaption] = useState('')
  const liveTargetRef = useRef<LiveDictationTarget>({ kind: 'chat' })

  const onSpoken = (text: string, _final?: boolean, interim = '') => {
    hold.markTextProduced()
    if (liveTargetRef.current.kind === 'chat') {
      setDictationCaption(text)
    }
    const { prefix, suffix } = chatInsertRef.current
    setDictationPaint(placeSpokenText(
      text, interim, liveTargetRef.current, prefix, suffix,
      liveBaseTextRef.current, nativeChatController.setChatComposerText,
      setInput, sendLiveTerminalInput
    ))
  }
  const onSpokenError = (err: Error) => { triggerError(); showToast(err.message) }
  const liveTranscription = useMobileLiveTranscription({ onTranscript: onSpoken, onError: onSpokenError })
  const clipboard = useClipboardWriter()
  const desktopDictation = useMobileDictation({
    client, enabled: canSend,
    onTranscript: (text) => deliverSessionDesktopDictation(scope, text, {
      showNativeChat: showNativeChatRef.current,
      setChatComposerText: nativeChatController.setChatComposerText,
      sendLiveTerminalInput, copyToClipboard: clipboard.writeText
    }),
    onError: (err) => { dictationRouteContextRef.current = null; reportDictationFailure(err) }
  })
  const anthropicDictation = useAnthropicDictation({
    enabled: canSend, onTranscript: onSpoken, onError: onSpokenError, lang: 'en'
  })
  // Signing in on the phone is mandatory (the user, 2026-10-14). A mic tap while signed out reads
  // the store once more (a sign-in may have just happened) and, if still nobody is signed in,
  // says so and opens Voice settings instead of starting anything.
  const { available: anthropicSignedIn, refreshAvailable: refreshAnthropicSignIn } = anthropicDictation
  const requireAnthropicSignIn = useCallback((): boolean => {
    if (anthropicSignedIn) {
      return true
    }
    void refreshAnthropicSignIn().then((signedIn) => {
      if (!signedIn) {
        showToast('Sign in to Anthropic to dictate')
        router.push('/voice-settings')
      }
    })
    return false
  }, [anthropicSignedIn, refreshAnthropicSignIn, router, showToast])
  const engineChoice = chooseDictationEngine(liveTranscription.available, anthropicDictation.available)
  const usesLivePartials = engineChoice === 'live' || engineChoice === 'anthropic'
  const dictation = engineChoice === 'anthropic' ? anthropicDictation
    : engineChoice === 'live' ? liveTranscription : desktopDictation

  const hold = useDictationHoldMode({
    dictation, engineChoice, usesLivePartials, liveTranscription, anthropicDictation,
    gateStart: requireAnthropicSignIn,
    prepareLiveStart: () => {
      if (showNativeChatRef.current) {
        const draft = nativeChatController.chatComposerText
        const cursor = Math.max(0, Math.min(composerCursorRef.current, draft.length))
        chatInsertRef.current = { prefix: draft.slice(0, cursor), suffix: draft.slice(cursor) }
        liveTargetRef.current = { kind: 'chat' }
        liveBaseTextRef.current = draft
        setDictationPaint(null)
        setDictationCaption('')
      } else if (activeHandle && liveInputTerminalHandles.has(activeHandle)) {
        liveTargetRef.current = ptyDictationTarget(activeHandle, liveTargetRef.current)
      } else {
        liveTargetRef.current = { kind: 'buffered' }
        setInput((current) => { liveBaseTextRef.current = current; return current })
      }
    },
    targetIsChat: () => liveTargetRef.current.kind === 'chat',
    prepareDesktopStart: () => {
      const ctx = activeHandle
        ? { handle: activeHandle, liveInputEnabled: liveInputTerminalHandles.has(activeHandle) }
        : null
      dictationRouteContextRef.current = ctx
      return () => {
        if (dictationRouteContextRef.current === ctx) {
          dictationRouteContextRef.current = null
        }
      }
    },
    restoreLiveCancel: (forSend) => {
      dictationRouteContextRef.current = null
      if (!usesLivePartials) {
        return
      }
      const base = liveBaseTextRef.current
      const target = liveTargetRef.current
      liveBaseTextRef.current = forSend ? '' : base
      if (!forSend && target.kind === 'chat') {
        nativeChatController.setChatComposerText(() => base)
      } else if (target.kind === 'buffered') {
        setInput(() => base)
      } else if (target.kind === 'pty') {
        eraseLiveTranscript(target, sendLiveTerminalInput)
      }
    },
    triggerError, showToast, reportDictationFailure
  })

  const refreshDictationMode = useCallback(async () => {
    if (!client) {
      return
    }
    try { const setup = await fetchDictationSetup(client); setDictationMode(setup.dictationMode) }
    catch { /* Non-fatal */ }
  }, [client])
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
  useFocusEffect(useCallback(() => {
    void refreshDictationMode()
    void refreshAnthropicSignIn()
    void primeRecognizer()
    return () => releaseRecognizer()
  }, [primeRecognizer, refreshAnthropicSignIn, refreshDictationMode, releaseRecognizer]))
  useEffect(() => { diffCommentsRef.current = diffComments }, [diffComments])

  return {
    nativeChatScopeKey,
    nativeChatSendError: { ...nativeChatSendError, message: sendErrorMessage },
    nativeChatTranscriptIsLocalReadable, nativeChatInputLeaseReady,
    nativeChatInputLeaseReadyRef, nativeChatInputLockReason,
    nativeChatOverlayInputLockReason,
    markNativeChatInputLeaseReady, clearNativeChatInputLease,
    nativeChatController, getSendCompletionGeneration,
    toggleTabChatView, showNativeChat, showNativeChatRef,
    dictation, dictationPaint, dictationCaption, composerCursorRef,
    startDictation: hold.startDictation,
    cancelDictation: hold.cancelDictation,
    stopDictation: hold.stopDictation,
    handleDictationToggle: hold.handleToggle,
    finishDictationForSend: () => hold.cancelDictation(true),
    handleDictationPressIn: hold.handlePressIn,
    handleDictationPressOut: hold.handlePressOut,
    refreshDictationMode
  }
}

export type MobileSessionNativeChatDictationModel = MobileSessionFeedbackCapabilitiesModel &
  ReturnType<typeof useMobileSessionNativeChatDictation>
