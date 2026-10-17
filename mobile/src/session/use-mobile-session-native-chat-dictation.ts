import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useMobileDictation } from '../hooks/use-mobile-dictation'
import { useMobileLiveTranscription } from '../hooks/use-mobile-live-transcription'
import { useAnthropicDictation } from '../hooks/use-anthropic-dictation'
import { paintSpokenAtCursor, type DictationPaint } from '../hooks/mobile-live-transcript'
import { chooseDictationEngine } from '../dictation/dictation-engine'
import { useDictationHoldMode } from './use-dictation-hold-mode'
import {
  deliverSessionDesktopDictation,
  placeLiveTranscript,
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
import { nativeChatComposerLockReason } from './use-mobile-native-chat-input-lock'
import { useMobileNativeChatSendError, mobileNativeChatSendErrorMessage } from './use-mobile-native-chat-send-error'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { useMobileSendCompletionGeneration } from './use-mobile-send-completion-generation'
import { dictationChatAccount } from './dictation-chat-account'
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
  // A matched Claude tab whose Anthropic lane is live sends with no terminal: its lease lock is lifted (gap 1).
  const nativeChatOverlayInputLockReason = nativeChatComposerLockReason({
    agentSessionTab: activeSessionTab?.type === 'agent-session',
    relayConnected: connState === 'connected',
    leaseLock: nativeChatInputLockReason,
    anthropicLaneLive: nativeChatController.nativeChatAnthropicControl?.live === true
  })
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
  // A chat take's words live in the caption until the take ends and only then move into the
  // draft, as the Claude app's do (docs/claude-mobile-dictation-decompiled.md, "Where the words
  // go"). `open` turns false once the take has committed or been cancelled, so a final that lands
  // after a Cancel cannot bring the words back.
  const chatTakeRef = useRef({ open: false, spoken: '' })

  const commitChatTake = (spoken: string) => {
    chatTakeRef.current = { open: false, spoken: '' }
    if (!spoken.trim()) {
      return
    }
    const { prefix, suffix } = chatInsertRef.current
    const painted = paintSpokenAtCursor(prefix, suffix, spoken, '')
    nativeChatController.setChatComposerText(() => painted.text)
    setDictationPaint(painted)
  }

  const onSpoken = (text: string, final?: boolean) => {
    hold.markTextProduced()
    if (liveTargetRef.current.kind === 'chat') {
      if (!chatTakeRef.current.open) {
        return
      }
      chatTakeRef.current.spoken = text
      setDictationCaption(text)
      if (final === true) {
        commitChatTake(text)
      }
      return
    }
    // The terminal's command box and live PTY line still take the words as they come.
    placeLiveTranscript(
      text, liveBaseTextRef.current, liveTargetRef.current,
      nativeChatController.setChatComposerText, setInput, sendLiveTerminalInput
    )
  }
  const onSpokenError = (err: Error) => {
    // The words heard before the failure still move in (the Claude app's Error(partialText)).
    if (liveTargetRef.current.kind === 'chat' && chatTakeRef.current.open) {
      commitChatTake(chatTakeRef.current.spoken)
    }
    triggerError()
    showToast(err.message)
  }
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
  // A take in a Claude chat dictates with that chat's own account (review of 2026-10-17).
  const anthropicDictation = useAnthropicDictation({
    enabled: canSend, onTranscript: onSpoken, onError: onSpokenError, lang: 'en',
    chatAccount: dictationChatAccount(nativeChatController)
  })
  // Signing in on the phone is mandatory (the user, 2026-10-14). A mic tap while signed out reads
  // the store once more (a sign-in may have just happened) and, if still nobody is signed in,
  // says so and opens the Anthropic accounts screen instead of starting anything.
  const { available: anthropicSignedIn, refreshAvailable: refreshAnthropicSignIn } = anthropicDictation
  const requireAnthropicSignIn = useCallback((): boolean => {
    if (anthropicSignedIn) {
      return true
    }
    void refreshAnthropicSignIn().then((signedIn) => {
      if (!signedIn) {
        showToast('Sign in to Anthropic to dictate')
        router.push('/anthropic-accounts')
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
        chatTakeRef.current = { open: true, spoken: '' }
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
      if (target.kind === 'chat') {
        // The draft was never touched while the take ran, so there is nothing to put back.
        chatTakeRef.current = { open: false, spoken: '' }
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
