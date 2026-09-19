import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'
import { useMobileNativeChatPermissionSend } from './mobile-native-chat-permission-send'
import { useMobileNativeChatPlanFeedbackRespond } from './use-mobile-native-chat-plan-feedback-respond'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'
import { useMobileNativeChatCancelAsk } from './use-mobile-native-chat-cancel-ask'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatComposerCatalogs } from './use-mobile-native-chat-composer-catalogs'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { mobileNativeChatStreamPreview } from './mobile-native-chat-streaming-gate'
import { useMobileNativeChatSessionLane } from './use-mobile-native-chat-session-lane'
import { useCodexCurrentModel } from './use-codex-current-model'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { useCodexStatusPoll } from './use-codex-status-poll'
import { useMobileChatCommandPeek } from './use-mobile-chat-command-peek'
import { useCodexChatCommandIntercept } from './use-codex-chat-command-intercept'
import { mergeImagePreviews, useHostImagePreviews } from './use-host-image-previews'
import { useMobileStructuredNativeChatSendBridge } from './use-mobile-structured-native-chat-send-bridge'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'
import { useMobileNativeChatStop } from './use-mobile-native-chat-stop'
import { useNativeChatAcceptedAction } from './use-native-chat-action-outcomes'
import { useThrottledLatestValue } from './use-throttled-latest-value'
import type {
  MobileNativeChatController,
  MobileNativeChatControllerArgs
} from './mobile-native-chat-controller-contract'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'
import { useMobileNativeChatDraftMirror } from './use-mobile-native-chat-draft-mirror'
import { nativeChatHudPhase, useMobileNativeChatHud } from './use-mobile-native-chat-hud'
import { reportedModelPair } from './mobile-chat-reported-model'
import { useMobilePermissionRefresh } from './use-mobile-permission-refresh'
import {
  withTerminalDialogOptions,
  resolveObservedPermission
} from './mobile-terminal-permission-options-merge'
import { useActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { useAgentHudBeacon } from './agent-hud-beacon'
import { useAgentStatusPrompts } from './use-agent-status-prompts'
import { agentHudBeaconMatches } from './hud-beacon-fields'


export type { MobileNativeChatController } from './mobile-native-chat-controller-contract'

const NATIVE_CHAT_STREAM_THROTTLE_MS = 50

/** Owns mobile native-chat state and teardown outside the already dense session
 *  route. The route remains responsible only for choosing and rendering the view. */
export function useMobileNativeChatController(
  args: MobileNativeChatControllerArgs
): MobileNativeChatController {
  const {
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
    agentSessionPromptCancelSupported = null,
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
    activeHandle,
    activeHandleRef,
    nativeChatTranscriptIsLocalReadable
  })

  const { structuredSession: structuredNativeChat, session: nativeChatSession } =
    useMobileNativeChatSessionLane({
      client,
      structured: activeChatStructured,
      agent: activeChatAgent,
      resolvedAgent: activeChatResolution?.agent ?? null,
      transcriptPath: activeChatResolution?.transcriptPath ?? null,
      sessionId: activeChatSessionId,
      sourceIdentity,
      callerIdentity: deviceTokenRef.current ?? '',
      enabled: showNativeChat,
      connState,
      promptCancelSupported: agentSessionPromptCancelSupported,
      onSendError
    })
  const handleBeacon = useAgentHudBeacon(activeHandle)
  // Only the beacon of the session this tab is showing: a beacon is keyed by
  // terminal handle, and a handle outlives the process that emitted into it,
  // so a hand-started session in a reused terminal would otherwise echo the
  // previous session's desktop prompts (2026-09-18). `null` while the tab
  // does not yet know its session.
  const hudBeacon = agentHudBeaconMatches(handleBeacon, activeChatResolution?.agent ?? null, activeChatSessionId) ? handleBeacon : null
  // What a hand-started session never beacons — a message from the desktop
  // or the Claude app, mid-turn or not — Orca's own hooks put on the tab
  // status as `agentStatus.prompt`, and the phone reads it there
  // (agent-status-prompts.ts, 2026-09-19).
  const tailPrompts = useAgentStatusPrompts(
    showNativeChat && !activeChatStructured ? (activeChatSessionId ?? null) : null,
    nativeChatStatus,
    hudBeacon?.desktopPrompts
  )
  const {
    composerText: chatComposerText,
    setComposerText: setChatComposerText, appendComposerMention,
    getComposerEditGeneration: getChatComposerEditGeneration,
    pending: chatPending,
    imagePreviewsByMessageId: chatImagePreviewsByMessageIdLocal,
    captureSendOrigin, rememberEcho,
    readSeededLaunchDraft,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    clearDraftAtSendStart,
    acceptSend,
    holdUnconfirmedSend,
    removePending
  } = useMobileNativeChatDrafts({
    hostId, worktreeId,
    tabId: activeSessionTabId,
    sessionId: activeChatSessionId,
    messages: nativeChatSession.messages,
    launchDraft: activeSessionTab?.launchDraft ?? null,
    launchDraftCreatedAt: activeSessionTab?.launchDraftCreatedAt ?? null,
    // Why: pass the raw draft plus this flag rather than nulling it off-chat — a
    // null reads as a host retraction, and a peek would decline the prefill forever.
    chatActive: showNativeChat,
    transcriptLoading: nativeChatSession.transcriptLoading,
    transcriptSettled: nativeChatSession.status === 'ready',
    onUnconfirmedSendLanded: onSendResolved,
    beaconPromptReceipts: tailPrompts
  })

  const backgroundTaskReport = useActiveTabBackgroundTaskReport({ handle: activeHandle, sessionId: activeChatSessionId, beacon: hudBeacon })
  // Not gated on chat visibility: the streaming gate must tell hidden from ended.
  const nativeChatStreamLive = activeChatStructured
    ? structuredNativeChat.isWorking
    : activeTabAgentWorking
  const nativeChatAgentWorking =
    nativeChatStreamLive && (activeChatStructured || activeChatResolution != null)
  const nativeChatStreamingText = useThrottledLatestValue(
    activeChatStructured
      ? undefined
      : mobileNativeChatStreamPreview(nativeChatStatus, nativeChatAgentWorking),
    NATIVE_CHAT_STREAM_THROTTLE_MS
  )
  const {
    observation: hudObservation,
    // The screen's last pair and context, held per tab, terminal and session,
    // with the beacon merged in only for the session on screen and only while
    // its process still paints: the live pair, or nothing.
    live: liveHud,
    refresh: refreshTerminalHud,
    dialogOptions: terminalDialogOptions,
    terminalPermission,
    permissionDismissed,
    queuedMessages: visibleQueuedMessages,
    sentPrompts: screenSentPrompts
  } = useMobileNativeChatHud({
    client,
    enabled: showNativeChat && !activeChatStructured && connState === 'connected',
    handleRef: activeHandleRef,
    scopeKey: showNativeChat ? streamScopeKey : null,
    tabId: activeSessionTabId,
    sessionId: activeChatSessionId,
    agent: activeChatResolution?.agent ?? null,
    phase: nativeChatHudPhase(nativeChatAgentWorking, nativeChatStatus?.state, nativeChatStatus?.interrupted),
    agentStatus: activeSessionTab?.agentStatus ?? null
  })
  // Model and effort as one pair, from one source; see the module's comment.
  const claudeReported = reportedModelPair(liveHud, activeSessionTab?.agentStatus)
  const isCodexChat = activeChatResolution?.agent === 'codex'
  // The agent's footer counts its shells live; fold that into the beacon-built
  // report so the pill and sheet can use it as a floor when the beacon's
  // transcript tail lags on a huge session.
  const onScreenShellCount = hudObservation?.runningShellCount ?? null
  const backgroundTaskReportWithScreen = useMemo(
    () => ({ ...backgroundTaskReport, onScreenShellCount }),
    [backgroundTaskReport, onScreenShellCount]
  )

  const {
    permission: reportedNativeChatPermission,
    question: legacyQuestion,
    detectedAsk: nativeChatDetectedAsk,
    ask: nativeChatAskPrompt
  } = useMobileNativeChatPrompts({
    enabled: activeChatResolution != null && !activeChatStructured,
    status: nativeChatStatus,
    messages: nativeChatSession.messages,
    transcriptLoading: nativeChatSession.transcriptLoading
  })
  const legacyNativeChatPermission = resolveObservedPermission(
    terminalPermission,
    reportedNativeChatPermission,
    permissionDismissed
  )
  // The card as rendered: what a tap answers, and what the send path reads
  // to tell a plan review (known only from its option labels) from a Bash one.
  const legacyRenderedPermission = withTerminalDialogOptions(
    legacyNativeChatPermission,
    terminalDialogOptions
  )
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

  // Chat writes gate on both: the lease proves the floor is ours; connState drops first.
  const inputSendable = activeChatStructured
    ? client != null && activeChatSessionId != null && connState === 'connected'
    : nativeChatInputLeaseReady && connState === 'connected'

  // Echo the draft onto the desktop TUI line while typing. Never while a prompt
  // is up: a permission or question card means the TUI is reading keys as
  // answers, and mirrored prose could pick one.
  const { settleBeforeSend: settleDraftMirrorBeforeSend } = useMobileNativeChatDraftMirror({
    client, getComposerEditGeneration: getChatComposerEditGeneration,
    // Why not `inputSendable`: the lease is about who owns the input floor and
    // collapses a render late; a mirror write without it is simply refused by
    // the host, so gating on the socket alone keeps echo from stalling.
    enabled:
      showNativeChat &&
      !activeChatStructured &&
      client != null &&
      connState === 'connected' &&
      legacyNativeChatPermission == null &&
      legacyQuestion == null &&
      nativeChatAskPrompt == null,
    handleRef: activeHandleRef,
    deviceTokenRef,
    text: chatComposerText
  })
  const peekTerminalForDispatchedCommand = useMobileChatCommandPeek(
    activeChatAgentRef,
    activeSessionTabId,
    peekTerminalTab
  )

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
    onSendError,
    expectedCodexPermission: terminalPermission,
    expectedTerminalAgent: activeChatResolution?.agent,
    cardPermission: legacyRenderedPermission,
    onResponseAccepted: refreshTerminalHud
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

  // Why a ref: the send seam reports catalog commands to option tracking, and
  // the options hook needs the seam's dispatcher; a ref breaks the cycle.
  const recordSessionOptionCommandRef = useRef<(command: string) => void>(() => {})

  const {
    send: _rawHandleNativeChatSend,
    sendWithOutcome: rawHandleNativeChatSendWithOutcome,
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
    agent: activeChatResolution?.agent === 'claude' ? 'claude' : 'codex',
    sendStructured: structuredNativeChat.sendWithOutcome,
    captureSendOrigin,
    clearDraftForSend,
    acceptSend,
    holdUnconfirmedSend,
    restoreRejectedDraft,
    onSendError
  })

  // Desktop-pasted images are host paths: fetch thumbnails through the host.
  const hostImagePreviews = useHostImagePreviews({
    client,
    enabled: showNativeChat && !activeChatStructured && connState === 'connected',
    hostId,
    worktreeId,
    nativeChatContext:
      activeSessionTabId && activeChatSessionId
        ? { tabId: activeSessionTabId, sessionId: activeChatSessionId }
        : null,
    terminalHandleRef: activeHandleRef,
    messages: nativeChatSession.messages,
    localPreviews: chatImagePreviewsByMessageIdLocal
  })
  useMobilePermissionRefresh(reportedNativeChatPermission, refreshTerminalHud)
  const codexModel = useCodexCurrentModel(
    activeChatResolution?.agent ?? null,
    hostId,
    worktreeId,
    activeSessionTab?.agentStatus?.model,
    hudObservation ? { modelId: hudObservation.modelId, effort: hudObservation.effort } : null
  )
  // composerFocusRequest: bumped once per "Ask about lines" tap, after the
  // route switches to this chat tab — the composer focuses on every increase,
  // never on every render. Both declared on one line with modelSheetRequest,
  // and requestComposerFocus is an inline arrow in the return below rather
  // than its own useCallback, to fit this file's line budget.
  const [modelSheetRequest, setModelSheetRequestState] = useState(0); const [composerFocusRequest, setComposerFocusRequest] = useState(0)
  const { nativeChatSessionOptions, recordCommand: recordNativeChatSessionOptionCommand } =
    useMobileNativeChatSessionOptionController({
      activeChatStructured,
      activeSessionTabId,
      agent: activeChatResolution?.agent ?? null,
      dispatchCommand: handleNativeChatDispatchCommand,
      hostId,
      isTabChatView,
      isWorking: nativeChatAgentWorking,
      // Neither agent needs the status line: Orca's own hooks report the model
      // into agent-status (Claude's raw id maps onto the catalog; Codex's goes
      // through useCodexCurrentModel, which guards the host's occasional Claude
      // id on a Codex pane and falls back to the picker's `(current)` row). The
      // footer, when a turn has drawn it, is only a fresher override.
      reportedModel: isCodexChat ? codexModel.model : claudeReported.model,
      reportedEffort: isCodexChat ? codexModel.effort : claudeReported.effort,
      // The agent's own name for it, so the pill can say "Opus 4.8.5" rather
      // than the family the catalog collapses every Opus onto.
      reportedModelLabel: isCodexChat ? null : claudeReported.label,
      // Codex resolves its own model elsewhere and has no launch-record path
      // here, so its report is always the live one.
      reportedModelSource: isCodexChat ? 'live' : claudeReported.source,
      terminalHandle: activeHandle,
      openRequest: modelSheetRequest,
      structured: {
        optionPickerRequest: structuredNativeChat.optionPickerRequest,
        conversationCommands: structuredNativeChat.conversationCommands,
        snapshot: structuredNativeChat.optionSnapshot,
        pendingId: structuredNativeChat.pendingOptionId,
        setOption: structuredNativeChat.setStructuredOption,
        invokeAction: structuredNativeChat.invokeStructuredOption
      },
      toggleTabChatView,
      worktreeId,
      client,
      handleRef: activeHandleRef,
      deviceTokenRef,
      refreshHud: refreshTerminalHud,
      onFailure: onSendError
    })
  // Read cached model membership safely; never inject background /status commands.
  useCodexStatusPoll({
    client,
    hostId,
    worktreeId,
    enabled:
      activeChatResolution?.agent === 'codex' &&
      showNativeChat &&
      !activeChatStructured &&
      connState === 'connected',
    working: nativeChatAgentWorking,
    hasDraft: chatComposerText.trim().length > 0,
    beforeWrite: settleDraftMirrorBeforeSend,
    handleRef: activeHandleRef,
    deviceTokenRef,
    handleKey: showNativeChat ? streamScopeKey : null,
    refreshHud: refreshTerminalHud
  })
  const codexIntercept = useCodexChatCommandIntercept({
    agentRef: activeChatAgentRef,
    captureSendOrigin,
    clearDraftForSend,
    sessionOptions: nativeChatSessionOptions,
    rawSendWithOutcome: rawHandleNativeChatSendWithOutcome
  })
  const { handleNativeChatSend, handleNativeChatSendWithOutcome } = codexIntercept
  useEffect(() => setModelSheetRequestState(codexIntercept.modelSheetRequest), [codexIntercept.modelSheetRequest])
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
  const respondWithComment = useMobileNativeChatPlanFeedbackRespond({
    client,
    enabled: inputSendable,
    structured: activeChatStructured,
    handleRef: activeHandleRef,
    deviceTokenRef,
    onSendError,
    onResponseAccepted: refreshTerminalHud,
    onAccepted: onSendResolved
  })
  const queueEditor = useMobileNativeChatQueueEditor({
    agent: activeChatAgent,
    tabId: activeSessionTabId,
    handleRef: activeHandleRef,
    enabled: showNativeChat && !activeChatStructured && connState === 'connected',
    client,
    deviceTokenRef,
    beforeOpen: settleDraftMirrorBeforeSend,
    pending: chatPending,
    removePending,
    queued: visibleQueuedMessages,
    onError: onSendError
  })

  const structuredCancelPrompt = useNativeChatAcceptedAction(
    activeChatStructured ? structuredNativeChat.cancelPrompt : async () => false,
    onSendResolved
  )

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
    setChatComposerText, appendComposerMention, composerFocusRequest, requestComposerFocus: () => setComposerFocusRequest((n) => n + 1),
    getChatComposerEditGeneration,
    chatPending, rememberEcho,
    nativeChatQueuedMessages: activeChatStructured || connState !== 'connected' ? [] : visibleQueuedMessages,
    chatImagePreviewsByMessageId: mergeImagePreviews(
      chatImagePreviewsByMessageIdLocal,
      hostImagePreviews
    ),
    nativeChatSession,
    nativeChatStructured: activeChatStructured,
    nativeChatTurnActivity: activeChatStructured ? structuredNativeChat.turnActivity : null,
    nativeChatTurnThinking: activeChatStructured ? structuredNativeChat.turnThinking : false,
    nativeChatWorkingStartedAt: activeChatStructured ? structuredNativeChat.workingStartedAt : null,
    nativeChatSettledTurns: activeChatStructured ? structuredNativeChat.settledTurns : null,
    nativeChatAgentWorking,
    nativeChatCanStop: activeChatStructured ? structuredNativeChat.canStop : nativeChatAgentWorking,
    nativeChatAgentStatus: activeSessionTab?.agentStatus ?? null,
    nativeChatBackgroundTaskReport: backgroundTaskReportWithScreen,
    nativeChatBackgroundTasks: activeChatStructured
      ? structuredNativeChat.backgroundTasks
      : undefined,
    handleNativeChatStopBackgroundTask: structuredNativeChat.stopBackgroundTask,
    nativeChatStreamingText,
    nativeChatStreamLive,
    nativeChatStreamScopeKey: streamScopeKey,
    nativeChatPermission: activeChatStructured
      ? structuredNativeChat.permission
      : legacyRenderedPermission,
    nativeChatQuestion: activeChatStructured ? structuredNativeChat.question : legacyQuestion,
    nativeChatAsk: !activeChatStructured && showNativeChatAsk ? nativeChatAskPrompt : null,
    nativeChatAskKey,
    dismissNativeChatAsk,
    handleNativeChatAnswerAsk: answerAsk,
    handleNativeChatCancelAsk: cancelAsk,
    // Heuristic/legacy cards have no durable prompt identity, so keep their
    // cancel affordance absent instead of exposing a dead action.
    handleNativeChatCancelPrompt: activeChatStructured ? structuredCancelPrompt : undefined,
    handleNativeChatRespondPermission: respond,
    handleNativeChatRespondPermissionWithComment: respondWithComment,
    openNativeChatQueueEditor: queueEditor.open, sendNativeChatQueueNow: queueEditor.sendNow,
    nativeChatQueueEditor: queueEditor.editor,
    prepareNativeChatImageSend: settleDraftMirrorBeforeSend,
    beginNativeChatImageSend: clearDraftAtSendStart,
    handleNativeChatStop: activeChatStructured ? structuredNativeChat.cancel : handleNativeChatStop,
    nativeChatFilePaths,
    loadNativeChatFiles,
    nativeChatSkills,
    // Only a structured session reports its own `/` surface; the PTY lane keeps
    // the curated catalog plus the disk scan.
    nativeChatCommandSurface: activeChatStructured ? structuredNativeChat : undefined,
    loadNativeChatSkills,
    handleNativeChatQuestionAnswer: activeChatStructured ? structuredNativeChat.respondQuestion : legacyHandleNativeChatQuestionAnswer,
    handleNativeChatSend: activeChatStructured ? structuredNativeChatSend.send : handleNativeChatSend,
    handleNativeChatSendWithOutcome: activeChatStructured ? structuredNativeChatSend.sendWithOutcome : handleNativeChatSendWithOutcome,
    readSeededLaunchDraft, nativeChatSessionOptions,
    nativeChatDesktopPrompts: tailPrompts,
    nativeChatScreenPrompts: activeChatStructured || connState !== 'connected' ? [] : screenSentPrompts,
    nativeChatPromptHook: hudBeacon?.promptHook ?? null,
    nativeChatContextWindow: liveHud.context, nativeChatLiveModel: { model: claudeReported.model, label: claudeReported.label, effort: claudeReported.effort }, nativeChatPermissionMode: hudObservation?.permissionMode ?? null, nativeChatAgentMode: hudObservation?.agentMode ?? null,
    refreshNativeChatHud: refreshTerminalHud
  }
}
