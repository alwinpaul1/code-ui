import { useCallback, useLayoutEffect, useRef, type MutableRefObject, useEffect } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { useMobileNativeChatPermissionSend } from './mobile-native-chat-permission-send'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'
import { useMobileNativeChatCancelAsk } from './use-mobile-native-chat-cancel-ask'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatComposerCatalogs } from './use-mobile-native-chat-composer-catalogs'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { mobileNativeChatStreamPreview } from './mobile-native-chat-streaming-gate'
import { useMobileNativeChatSession } from './use-mobile-native-chat-session'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { useMobileStructuredAgentSession } from './use-mobile-structured-agent-session'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'
import { useNativeChatAcceptedAction } from './use-native-chat-action-outcomes'
import { useThrottledLatestValue } from './use-throttled-latest-value'
import type { MobileNativeChatController } from './mobile-native-chat-controller-contract'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'
import { useMobileNativeChatDraftMirror } from './use-mobile-native-chat-draft-mirror'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'
import { withTerminalDialogOptions } from './mobile-terminal-permission-options-merge'

export type { MobileNativeChatController } from './mobile-native-chat-controller-contract'

const NATIVE_CHAT_STREAM_THROTTLE_MS = 50

/** Owns mobile native-chat state and teardown outside the already dense session
 *  route. The route remains responsible only for choosing and rendering the view. */
export function useMobileNativeChatController(args: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  activeSessionTab: MobileNativeChatTab | null
  activeSessionTabId: string | null
  activeHandleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  nativeChatTranscriptIsLocalReadable: boolean
  nativeChatInputLeaseReady: boolean
  /** Live socket state; the lease collapses on disconnect but one render later. */
  connState: ConnectionState
  onSendError: (message: string) => void
  /** Retires a held failure banner. Any accepted chat write clears it — a delivered
   *  answer or permission reply must not sit under a stale "not sent". */
  onSendResolved: () => void
}): MobileNativeChatController {
  const {
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
    onSendError,
    onSendResolved
  } = args
  const {
    activeChatAgent,
    activeChatAgentRef,
    activeChatResolution,
    activeChatSessionId,
    activeChatStructured,
    activeTabAgentWorking,
    isTabChatView,
    nativeChatStatus,
    showNativeChat,
    showNativeChatRef,
    sourceIdentity,
    streamIdentity,
    streamScopeKey,
    toggleTabChatView,
    peekTerminalTab,
    endTerminalPeek,
    terminalPeekActive,
    viewResolved,
    activeChatEligible
  } = useMobileNativeChatActiveResolution({
    hostId,
    worktreeId,
    activeSessionTab,
    activeSessionTabId,
    activeHandleRef,
    nativeChatTranscriptIsLocalReadable
  })

  const legacyNativeChatSession = useMobileNativeChatSession({
    client,
    sourceIdentity,
    agent: activeChatStructured ? null : (activeChatResolution?.agent ?? null),
    sessionId: activeChatStructured ? null : activeChatSessionId,
    transcriptPath: activeChatStructured ? null : (activeChatResolution?.transcriptPath ?? null)
  })
  const structuredNativeChat = useMobileStructuredAgentSession({
    client,
    sessionId: activeChatStructured ? activeChatSessionId : null,
    sourceIdentity,
    enabled: showNativeChat,
    // Holds are connection-scoped; dropping this on transport loss lets the hook
    // reacquire the provider without clearing the cached transcript.
    connected: connState === 'connected',
    agent: activeChatStructured ? activeChatAgent : null,
    onSendError
  })
  const nativeChatSession = activeChatStructured
    ? structuredNativeChat.session
    : legacyNativeChatSession
  const {
    composerText: chatComposerText,
    setComposerText: setChatComposerText,
    getComposerEditGeneration: getChatComposerEditGeneration,
    pending: chatPending,
    imagePreviewsByMessageId: chatImagePreviewsByMessageId,
    captureSendOrigin,
    readSeededLaunchDraft,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    acceptSend,
    holdUnconfirmedSend
  } = useMobileNativeChatDrafts({
    hostId,
    worktreeId,
    tabId: activeSessionTabId,
    sessionId: activeChatSessionId,
    messages: nativeChatSession.messages,
    launchDraft: activeSessionTab?.launchDraft ?? null,
    launchDraftCreatedAt: activeSessionTab?.launchDraftCreatedAt ?? null,
    // Why: pass the raw draft plus this flag rather than nulling it off-chat —
    // a null is indistinguishable from a host retraction, and peeking at the
    // terminal view would permanently decline the prefill.
    chatActive: showNativeChat,
    transcriptLoading: nativeChatSession.transcriptLoading,
    transcriptSettled: nativeChatSession.status === 'ready'
  })

  const nativeChatAgentWorking = activeChatStructured
    ? structuredNativeChat.isWorking
    : activeChatResolution != null && activeTabAgentWorking
  // Deliberately not gated on the chat view being visible: the streaming gate
  // has to tell "hidden mid-turn" from "the turn ended".
  const nativeChatStreamLive = activeChatStructured
    ? structuredNativeChat.isWorking
    : activeTabAgentWorking
  // Throttle the streaming bubble: OpenCode emits a status frame per streamed
  // part, and each one re-renders and re-parses the whole accumulated markdown.
  const nativeChatStreamingText = useThrottledLatestValue(
    activeChatStructured
      ? undefined
      : mobileNativeChatStreamPreview(nativeChatStatus, nativeChatAgentWorking),
    NATIVE_CHAT_STREAM_THROTTLE_MS
  )
  const {
    permission: legacyNativeChatPermission,
    question: legacyNativeChatQuestion,
    detectedAsk: nativeChatDetectedAsk,
    ask: nativeChatAskPrompt
  } = useMobileNativeChatPrompts({
    enabled: activeChatResolution != null && !activeChatStructured,
    status: nativeChatStatus,
    messages: nativeChatSession.messages,
    transcriptLoading: nativeChatSession.transcriptLoading
  })
  // A never-read transcript cannot prove that a dismissed prompt cleared.
  const nativeChatTranscriptSettled =
    nativeChatSession.status === 'ready' ||
    (nativeChatSession.status === 'error' && nativeChatSession.messages.length > 0)
  const {
    askKey: nativeChatAskKey,
    showAsk: showNativeChatAsk,
    dismissAsk: dismissNativeChatAsk
  } = useMobileNativeChatAskDismiss({
    ask: nativeChatAskPrompt,
    detectedAsk: nativeChatDetectedAsk,
    scopeKey: activeSessionTabId,
    sessionKey: activeChatSessionId,
    observing: showNativeChat && (nativeChatDetectedAsk != null || nativeChatTranscriptSettled)
  })

  // Every chat write gates on both: the lease proves the input floor is ours, and
  // `connState` collapses a render before the lease does on disconnect.
  const inputSendable = activeChatStructured
    ? client != null && activeChatSessionId != null && connState === 'connected'
    : nativeChatInputLeaseReady && connState === 'connected'

  // Echo the draft onto the desktop TUI line while typing. Never while a prompt
  // is up: a permission or question card means the TUI is reading keys as
  // answers, and mirrored prose could pick one.
  const { settleBeforeSend: settleDraftMirrorBeforeSend } = useMobileNativeChatDraftMirror({
    client,
    // Why not `inputSendable`: the lease is about who owns the input floor and
    // collapses a render late; a mirror write without it is simply refused by
    // the host, so gating on the socket alone keeps echo from stalling.
    enabled:
      showNativeChat &&
      !activeChatStructured &&
      client != null &&
      connState === 'connected' &&
      legacyNativeChatPermission == null &&
      legacyNativeChatQuestion == null &&
      nativeChatAskPrompt == null,
    handleRef: activeHandleRef,
    deviceTokenRef,
    text: chatComposerText
  })
  // A slash/skill result renders in the TUI, not the transcript: show the
  // terminal for it without persisting a view override.
  const peekTerminalForDispatchedCommand = useCallback(() => {
    if (activeSessionTabId) {
      peekTerminalTab(activeSessionTabId)
    }
  }, [activeSessionTabId, peekTerminalTab])

  const { answerAsk: handleNativeChatAnswerAsk, cancelPending: cancelNativeChatAnswer } =
    useMobileNativeChatAnswerSend({
      client,
      enabled: inputSendable && !activeChatStructured,
      handleRef: activeHandleRef,
      deviceTokenRef,
      agentRef: activeChatAgentRef,
      sessionId: activeChatSessionId,
      streamIdentity,
      onSendError
    })

  const handleNativeChatCancelAsk = useMobileNativeChatCancelAsk({
    client,
    enabled: inputSendable && !activeChatStructured,
    handleRef: activeHandleRef,
    deviceTokenRef,
    cancelPending: cancelNativeChatAnswer,
    onSendError
  })

  const legacyHandleNativeChatRespondPermission = useMobileNativeChatPermissionSend({
    client,
    enabled: inputSendable && !activeChatStructured,
    handleRef: activeHandleRef,
    deviceTokenRef,
    onSendError
  })

  const handleNativeChatStop = useMobileNativeChatStop({
    client,
    enabled: inputSendable && !activeChatStructured,
    handleRef: activeHandleRef,
    deviceTokenRef,
    streamIdentity,
    cancelPending: cancelNativeChatAnswer,
    onSendError
  })

  const { nativeChatFilePaths, loadNativeChatFiles, nativeChatSkills, loadNativeChatSkills } =
    useMobileNativeChatComposerCatalogs({ client, worktreeId })

  // Why: the send seam reports outgoing catalog commands to session-option
  // tracking, but the options hook needs the seam's dispatcher — a ref breaks
  // the cycle without re-creating the send callbacks per snapshot.
  const recordSessionOptionCommandRef = useRef<(command: string) => void>(() => {})

  const {
    send: handleNativeChatSend,
    sendWithOutcome: handleNativeChatSendWithOutcome,
    answerQuestion: legacyHandleNativeChatQuestionAnswer,
    dispatchCommand: handleNativeChatDispatchCommand
  } = useMobileNativeChatMessageSend({
    client,
    enabled: inputSendable && !activeChatStructured,
    handleRef: activeHandleRef,
    deviceTokenRef,
    agentRef: activeChatAgentRef,
    commandSendRef: recordSessionOptionCommandRef,
    captureSendOrigin,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    acceptSend,
    holdUnconfirmedSend,
    onSendError,
    beforeSend: settleDraftMirrorBeforeSend,
    onCommandDispatched: peekTerminalForDispatchedCommand
  })

  const structuredNativeChatSend = useMobileStructuredNativeChatSendBridge({
    sendStructured: structuredNativeChat.sendWithOutcome,
    captureSendOrigin,
    clearDraftForSend,
    acceptSend,
    holdUnconfirmedSend,
    restoreRejectedDraft,
    onSendError
  })

  // The terminal's own status line is the one place that states model AND
  // effort; read it while chat covers the terminal and let it win over the
  // hook report, which names the model only.
  const {
    observation: hudObservation,
    refresh: refreshTerminalHud,
    dialogOptions: terminalDialogOptions
  } = useMobileTerminalHudObservation({
    client,
    enabled: showNativeChat && !activeChatStructured && connState === 'connected',
    handleRef: activeHandleRef,
    handleKey: showNativeChat ? streamScopeKey : null
  })
  // Why: the approval envelope lands before the dialog is drawn; re-read the
  // screen shortly after so the card shows the dialog's own options, not the
  // generic pair, without waiting for the next 5s poll.
  useEffect(() => {
    if (!legacyNativeChatPermission) {
      return
    }
    const timers = [400, 1500].map((ms) => setTimeout(() => void refreshTerminalHud(), ms))
    return () => timers.forEach(clearTimeout)
  }, [legacyNativeChatPermission, refreshTerminalHud])
  const { nativeChatSessionOptions, recordCommand: recordNativeChatSessionOptionCommand } =
    useMobileNativeChatSessionOptionController({
      activeChatStructured,
      activeSessionTabId,
      agent: activeChatResolution?.agent ?? null,
      dispatchCommand: handleNativeChatDispatchCommand,
      hostId,
      isTabChatView,
      isWorking: nativeChatAgentWorking,
      reportedModel: hudObservation?.modelId ?? activeSessionTab?.agentStatus?.model ?? null,
      reportedEffort: hudObservation?.effort ?? null,
      statusLineObserved: hudObservation != null,
      structured: {
        snapshot: structuredNativeChat.optionSnapshot,
        pendingId: structuredNativeChat.pendingOptionId,
        setOption: structuredNativeChat.setStructuredOption,
        invokeAction: structuredNativeChat.invokeStructuredOption
      },
      toggleTabChatView,
      worktreeId
    })
  useLayoutEffect(() => {
    recordSessionOptionCommandRef.current = recordNativeChatSessionOptionCommand
  }, [recordNativeChatSessionOptionCommand])
  // Card actions retire the route's held failure banner too, not just sends.
  const answerAsk = useNativeChatAcceptedAction(handleNativeChatAnswerAsk, onSendResolved)
  const cancelAsk = useNativeChatAcceptedAction(handleNativeChatCancelAsk, onSendResolved)
  const handleNativeChatRespondPermission = activeChatStructured
    ? structuredNativeChat.respondPermission
    : legacyHandleNativeChatRespondPermission
  const respond = useNativeChatAcceptedAction(handleNativeChatRespondPermission, onSendResolved)

  return {
    isTabChatView,
    toggleTabChatView,
    terminalPeekActive,
    endTerminalPeek,
    viewResolved,
    activeChatEligible,
    showNativeChat,
    showNativeChatRef,
    nativeChatAgent: activeChatResolution?.agent ?? null,
    chatComposerText,
    setChatComposerText,
    getChatComposerEditGeneration,
    chatPending,
    chatImagePreviewsByMessageId,
    nativeChatSession,
    nativeChatAgentWorking,
    nativeChatStreamingText,
    nativeChatStreamLive,
    nativeChatStreamScopeKey: streamScopeKey,
    nativeChatPermission: activeChatStructured
      ? structuredNativeChat.permission
      : withTerminalDialogOptions(legacyNativeChatPermission, terminalDialogOptions),
    nativeChatQuestion: activeChatStructured
      ? structuredNativeChat.question
      : legacyNativeChatQuestion,
    nativeChatAsk: !activeChatStructured && showNativeChatAsk ? nativeChatAskPrompt : null,
    nativeChatAskKey,
    dismissNativeChatAsk,
    handleNativeChatAnswerAsk: answerAsk,
    handleNativeChatCancelAsk: cancelAsk,
    handleNativeChatRespondPermission: respond,
    handleNativeChatStop: activeChatStructured ? structuredNativeChat.cancel : handleNativeChatStop,
    nativeChatFilePaths,
    loadNativeChatFiles,
    nativeChatSkills,
    loadNativeChatSkills,
    handleNativeChatQuestionAnswer: activeChatStructured
      ? structuredNativeChat.respondQuestion
      : legacyHandleNativeChatQuestionAnswer,
    handleNativeChatSend: activeChatStructured
      ? structuredNativeChatSend.send
      : handleNativeChatSend,
    handleNativeChatSendWithOutcome: activeChatStructured
      ? structuredNativeChatSend.sendWithOutcome
      : handleNativeChatSendWithOutcome,
    readSeededLaunchDraft,
    nativeChatSessionOptions,
    nativeChatContextWindow: hudObservation?.context ?? null,
    nativeChatPermissionMode: hudObservation?.permissionMode ?? null,
    refreshNativeChatHud: refreshTerminalHud
  }
}
