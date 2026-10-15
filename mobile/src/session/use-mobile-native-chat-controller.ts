import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hudFieldsFromAgentStatus } from './hud-agent-status-fields'
import { useMobileNativeChatQueueEditor } from './use-mobile-native-chat-queue-editor'; import { useChatStopButton } from './use-chat-stop-button'; import { parkRefusedComposerSend } from './native-chat-send-gate-outbox'
import { useMobileNativeChatPermissionSend } from './mobile-native-chat-permission-send'
import { useMobileNativeChatPlanFeedbackRespond } from './use-mobile-native-chat-plan-feedback-respond'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'
import { useMobileNativeChatCardAnswers } from './use-mobile-native-chat-card-answers'
import { useMobileNativeChatCancelAsk } from './use-mobile-native-chat-cancel-ask'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { useMobileNativeChatComposerCatalogs } from './use-mobile-native-chat-composer-catalogs'
import { useMobileNativeChatMessageSend } from './use-mobile-native-chat-message-send'
import { useMobileNativeChatStreamPreview } from './use-mobile-native-chat-stream-preview'
import { useMobileNativeChatSessionLane } from './use-mobile-native-chat-session-lane'; import { useClaudeAnthropicTranscript } from './use-claude-anthropic-transcript'
import { useCodexCurrentModel } from './use-codex-current-model'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { useCodexStatusPoll } from './use-codex-status-poll'
import { useMobileChatCommandPeek } from './use-mobile-chat-command-peek'
import { useCodexChatCommandIntercept } from './use-codex-chat-command-intercept'
import { applyCcrUsageToHud } from './ccr-usage-hud'; import { useCcrSessionUsage } from './use-ccr-session-usage'; import { mergeImagePreviews, useHostImagePreviews } from './use-host-image-previews'; import { useCcrSessionImages } from './use-ccr-session-images'; import { useCcrSessionModel } from './use-ccr-session-model'; import { claudeConfigDirFromTranscriptPath } from './mobile-native-chat-session-agent'; import { preferCcrModelPair } from './ccr-session-model'; import { useAgentImageShareAsks } from './agent-image-share-context'; import { lockedShareAskSend, withoutAskDraftRestore, withoutAskRetry } from './agent-image-share-ask'
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
import { useClaudeTranscriptModel } from './use-claude-transcript-model'
import { claudeModelPillPair, claudeReportedOverLive } from './claude-transcript-model'
import { useMobilePermissionRefresh } from './use-mobile-permission-refresh'
import { resolveObservedPermission, terminalPromptWait, withTerminalDialogOptions } from './mobile-terminal-permission-options-merge'
import { useActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import { useActiveTabTaskReport } from './use-active-tab-task-report'
import { useActiveChatBeacon } from './use-active-chat-beacon'
import { beaconDecidesLimits } from './hud-rate-limit-notice'
import { claudeLeadTurnEnded } from './claude-lead-turn-ended'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'; import { useMobileNativeChatOutbox } from './use-mobile-native-chat-outbox'; import { useClaudeTerminalTaskStop } from './use-claude-terminal-task-stop'


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
    agentSessionPromptCancelSupported = null, agentSessionRepeatedStopSupported = null,
    onSendError,
    onSendResolved
  } = args
  const {
    activeChatAgent,
    activeChatAgentRef,
    activeChatResolution, activeChatIdentity, activeChatAgentStatus, activeChatTaskStatus, activeChatPromptStatus, activeChatSessionIdentity,
    activeChatSessionId,
    activeChatStructured,
    activeTabAgentWorking,
    isTabChatView,
    nativeChatStatus,
    showNativeChat, chatViewSelected, showNativeChatRef,
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
    nativeChatTranscriptIsLocalReadable, watching: connState === 'connected' && args.tabsLive
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
      enabled: showNativeChat,
      connState,
      promptCancelSupported: agentSessionPromptCancelSupported, repeatedStopSupported: agentSessionRepeatedStopSupported,
      onSendError
    })
  const { hudBeacon, tailPrompts, statusAgentMessages, agentMessages } = useActiveChatBeacon({
    activeHandle, agent: activeChatResolution?.agent ?? null, sessionId: activeChatSessionId ?? null,
    readsPrompts: showNativeChat && !activeChatStructured, promptStatus: activeChatPromptStatus, connected: connState === 'connected', tabsLive: args.tabsLive
  })
  const {
    composerText: chatComposerText,
    setComposerText: setChatComposerText, appendComposerMention,
    getComposerEditGeneration: getChatComposerEditGeneration,
    pending: chatPending,
    waitingPhotoSends: chatWaitingPhotoSends,
    imagePreviewsByMessageId: chatImagePreviewsByMessageIdLocal,
    captureSendOrigin, rememberEcho, takeSends,
    readSeededLaunchDraft,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    clearDraftAtSendStart,
    acceptSend,
    holdUnconfirmedSend, removePending, showOutboxEcho, showSendingEcho, sendOnRecord
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
  // Orca's `working` outlives the lead's turn while a background agent runs,
  // and the transcript is what says that turn is over (claude-lead-turn-ended.ts).
  const lastConnectedAt = useLastConnectedAt(hostId), nativeChatHostConnection = useMemo(() => ({ connected: connState === 'connected', lastConnectedAt }), [connState, lastConnectedAt])
  const nativeChatLeadTurnEnded = claudeLeadTurnEnded(activeChatResolution?.agent ?? null, nativeChatSession.messages, activeChatAgentStatus)
  const nativeChatStreamLive = activeChatStructured ? structuredNativeChat.isWorking : activeTabAgentWorking && !nativeChatLeadTurnEnded
  const nativeChatAgentWorking =
    nativeChatStreamLive && (activeChatStructured || activeChatResolution != null)
  const streamPreview = useMobileNativeChatStreamPreview(nativeChatStatus, nativeChatAgentWorking)
  const nativeChatStreamingText = useThrottledLatestValue(
    activeChatStructured ? undefined : streamPreview,
    NATIVE_CHAT_STREAM_THROTTLE_MS
  )
  const {
    observation: hudObservation, liveBeacon: hudLiveBeacon,
    // The screen's last pair and context, held per tab, terminal and session,
    // with the beacon merged in only for the session on screen and only while
    // its process still paints: the live pair, or nothing.
    live: liveHud,
    refresh: refreshTerminalHud,
    dialogOptions: terminalDialogOptions, dialogKind: terminalDialogKind, dialogBeforeAnswer, rereadAfterAnswer,
    terminalPermission,
    permissionDismissed,
    queuedMessages: visibleQueuedMessages, queueReadable: screenQueueReadable, queueEditable: screenQueueEditable, queueInput: screenQueueInput,
    sentPrompts: screenSentPrompts,
    taskCompletions: screenTaskCompletions,
    peerNotices: screenPeerNotices, spinner: screenSpinner, sentPhotos: screenSentPhotos, modelStatement: screenModelStatement
  } = useMobileNativeChatHud({
    client,
    enabled: showNativeChat && !activeChatStructured && connState === 'connected',
    handleRef: activeHandleRef,
    scopeKey: showNativeChat ? streamScopeKey : null,
    tabId: activeSessionTabId,
    sessionId: activeChatSessionId,
    agent: activeChatResolution?.agent ?? null,
    phase: nativeChatHudPhase(nativeChatAgentWorking, nativeChatStatus?.state, nativeChatStatus?.interrupted),
    agentStatus: activeChatAgentStatus
  })
  // Model and effort as one pair, from one source; see the module's comment.
  const claudeLive = reportedModelPair(liveHud, activeChatAgentStatus)
  // No beacon and no badge (a Windows host, a tab typed in by hand, a tab launched before the flag): what the transcript last answered with.
  // `beacon` is a beacon the HUD still believes AND that names a model: one written off, or naming none, shows nothing, so it must not stand the fallback down.
  // `beaconStoredAt` is that live beacon's too: a written-off one was never heard again, and timed by it a later /model row outranked the badge for good.
  const transcriptModel = useClaudeTranscriptModel({ client, hostId, worktreeId, tabId: activeSessionTabId, sessionId: activeChatSessionId, enabled: showNativeChat && !activeChatStructured && activeChatResolution?.agent === 'claude', connected: connState === 'connected', liveModel: claudeLive.model, beacon: hudLiveBeacon?.modelId != null, beaconHandle: activeHandle, beaconStoredAt: hudObservation?.modelId && hudObservation.modelId !== hudLiveBeacon?.modelId ? null : (hudLiveBeacon?.receivedAt ?? null), liveEffort: claudeLive.effort, agentWorking: nativeChatAgentWorking, messages: nativeChatSession.messages, transcriptPath: activeChatResolution?.transcriptPath ?? null, rowsSettled: nativeChatSession.status === 'ready', screenStatement: screenModelStatement })
  // A model command written after the beacon last heard is newer than it (a switch made while the phone was away).
  const claudeReported = claudeReportedOverLive(claudeLive, transcriptModel.fallback)
  // Anthropic's copy of the session (Remote Control on): the model/effort it reports, used when fresh and nothing in the terminal states one (ccr-session-model.ts), and the pictures the desktop cannot send (use-ccr-session-images.ts).
  const ccrEnabled = showNativeChat && !activeChatStructured && activeChatResolution?.agent === 'claude', ccrModel = useCcrSessionModel({ enabled: ccrEnabled, tabId: activeSessionTabId ?? null, agentSessionId: activeChatSessionId ?? null, configDir: claudeConfigDirFromTranscriptPath(activeChatResolution?.transcriptPath), messages: nativeChatSession.messages, epoch: lastConnectedAt, needsContext: liveHud.context === null }), claudeApi = useClaudeAnthropicTranscript({ enabled: ccrEnabled, tabId: activeSessionTabId ?? null, agentSessionId: activeChatSessionId ?? null, epoch: lastConnectedAt, orcaSettled: nativeChatSession.status === 'ready', orcaRowCount: nativeChatSession.messages.length }), ccrImages = useCcrSessionImages({ enabled: ccrEnabled, tabId: activeSessionTabId ?? null, agentSessionId: activeChatSessionId ?? null, configDir: claudeConfigDirFromTranscriptPath(activeChatResolution?.transcriptPath), messages: claudeApi.session?.messages ?? nativeChatSession.messages, localPreviews: chatImagePreviewsByMessageIdLocal, epoch: lastConnectedAt })
  // The ring and usage rows of THIS tab's session and account (ccr-usage-hud.ts): what its terminal states wins, then Anthropic's figures for the matched session and account, never the host's login.
  const ccrUsage = useCcrSessionUsage({ enabled: ccrEnabled, tabId: activeSessionTabId ?? null, agentSessionId: activeChatSessionId ?? null, configDir: claudeConfigDirFromTranscriptPath(activeChatResolution?.transcriptPath), epoch: lastConnectedAt })
  const ccrHud = applyCcrUsageToHud({ context: liveHud.context, limits: liveHud.limits, usedTokens: hudFieldsFromAgentStatus(activeChatAgentStatus).contextUsedTokens ?? null }, { reading: ccrUsage.reading, matchedAccount: ccrUsage.matchedAccount, hostFeedAllowed: ccrUsage.hostFeedAllowed, beaconDecidesLimits: beaconDecidesLimits(hudLiveBeacon) })
  const isCodexChat = activeChatResolution?.agent === 'codex', isOmpChat = activeChatResolution?.agent === 'omp'
  // The agent's footer counts its shells live, and the completions it has
  // stated there name WHICH shell ended (the only source of that on a
  // hand-started tab, 2026-09-20). Folded into the beacon-built report with
  // what the phone has seen of this session: which agents are the lead's own,
  // what a window showed ending, the last host status (use-active-tab-task-report.ts).
  const backgroundTaskReportWithScreen = useActiveTabTaskReport({
    report: backgroundTaskReport, handle: activeHandle, sessionId: activeChatSessionId, agent: activeChatResolution?.agent ?? null,
    messages: nativeChatSession.messages, transcriptSettled: nativeChatSession.status === 'ready' && !nativeChatSession.baseRetained, agentStatus: activeChatTaskStatus,
    onScreenShellCount: hudObservation?.runningShellCount ?? null, screenTaskCompletions
  })

  const {
    permission: reportedNativeChatPermission,
    question: legacyQuestion,
    detectedAsk: nativeChatDetectedAsk, liveAsk: nativeChatLiveAsk,
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
    askKey: nativeChatAskKey, askSentAt: nativeChatAskSentAt,
    showAsk: showNativeChatAsk,
    dismissAsk: dismissNativeChatAsk
  } = useMobileNativeChatAskDismiss({
    ask: nativeChatAskPrompt,
    detectedAsk: nativeChatDetectedAsk, liveAsk: nativeChatLiveAsk,
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
  // answers, and mirrored prose could pick one. A dialog no card shows reads
  // keys the same way, so one on screen closes the mirror too, by the same
  // test the sends use (mobile-native-chat-dialog-guard.ts).
  const { settleBeforeSend: settleDraftMirrorBeforeSend, adoptRecalledInput } = useMobileNativeChatDraftMirror({
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
      nativeChatAskPrompt == null && terminalDialogKind === null,
    handleRef: activeHandleRef,
    deviceTokenRef, agentRef: activeChatAgentRef,
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
    streamIdentity, agent: activeChatResolution?.agent ?? null,
    cancelPending: cancelNativeChatAnswer,
    onSendError
  })

  const { nativeChatFilePaths, loadNativeChatFiles, nativeChatSkills, loadNativeChatSkills } =
    useMobileNativeChatComposerCatalogs({ client, worktreeId, chatIdentity: activeChatIdentity })

  // Why a ref: the send seam reports catalog commands to option tracking, and
  // the options hook needs the seam's dispatcher; a ref breaks the cycle.
  const recordSessionOptionCommandRef = useRef<(command: string) => void>(() => {})

  // A refused picture's ask rides this send, but its words were never in the box: no restore, no Retry (agent-image-share-ask.ts).
  const askAwareRestore = useMemo(() => withoutAskDraftRestore(restoreRejectedDraft), [restoreRejectedDraft]); const askAwareSendError = useMemo(() => withoutAskRetry(onSendError), [onSendError])
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
    restoreRejectedDraft: askAwareRestore, showSendingEcho,
    acceptSend,
    holdUnconfirmedSend,
    onSendError: askAwareSendError,
    beforeSend: settleDraftMirrorBeforeSend,
    onCommandDispatched: peekTerminalForDispatchedCommand, promptReceipts: tailPrompts, sendOnRecord
  })

  const structuredNativeChatSend = useMobileStructuredNativeChatSendBridge({
    agent: activeChatResolution?.agent === 'claude' ? 'claude' : 'codex',
    sendStructured: structuredNativeChat.sendWithOutcome, sendConditions: structuredNativeChat.sendConditions,
    captureSendOrigin,
    clearDraftForSend,
    acceptSend,
    holdUnconfirmedSend,
    restoreRejectedDraft, showSendingEcho,
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
    localPreviews: chatImagePreviewsByMessageIdLocal, remote: ccrImages
  })
  useMobilePermissionRefresh(reportedNativeChatPermission, refreshTerminalHud)
  const codexModel = useCodexCurrentModel(
    activeChatResolution?.agent ?? null,
    hostId,
    worktreeId,
    activeChatAgentStatus?.model,
    hudObservation ? { modelId: hudObservation.modelId, effort: hudObservation.effort } : null
  )
  // composerFocusRequest: bumped once per "Ask about lines" tap, after the
  // route switches to this chat tab — the composer focuses on every increase,
  // never on every render. Both declared on one line with modelSheetRequest,
  // and requestComposerFocus is an inline arrow in the return below rather
  // than its own useCallback, to fit this file's line budget.
  const [modelSheetRequest, setModelSheetRequestState] = useState(0); const [composerFocusRequest, setComposerFocusRequest] = useState(0); const [headerModelRequests, setHeaderModelRequests] = useState(0)
  const { nativeChatSessionOptions, recordCommand: recordNativeChatSessionOptionCommand } =
    useMobileNativeChatSessionOptionController({
      activeChatStructured,
      activeSessionTabId,
      agent: activeChatResolution?.agent ?? null,
      dispatchCommand: handleNativeChatDispatchCommand,
      hostId,
      isTabChatView,
      isWorking: nativeChatAgentWorking,
      // Codex needs no status line: Orca's own Codex hook reports the model
      // into agent-status, through useCodexCurrentModel, which guards the host's
      // occasional Claude id on a Codex pane and falls back to the picker's
      // `(current)` row; the footer, when a turn has drawn it, is only a fresher
      // override. Claude's comes from the beacon or the badge alone: Orca's
      // Claude hooks set no `agentStatus.model` (origin/main 8d6fec597b), and
      // with neither, the pills fall back to the transcript's own record of what
      // answered (use-claude-transcript-model.ts), which never seeds the record.
      //
      // OMP (Orca #20612): its extension stamps `provider/id` on every hook post
      // and re-posts on a switch, so for that agent — and only that one — the
      // tab's `agentStatus.model` is the agent's own live word, not the launch
      // record `reportedModelPair` refuses. The switch command rides beside it.
      reportedModel: isCodexChat
        ? codexModel.model
        : isOmpChat
          ? (activeChatAgentStatus?.model ?? null)
          : claudeReported.model,
      reportedEffort: isCodexChat ? codexModel.effort : isOmpChat ? null : claudeReported.effort,
      // The agent's own name for it, so the pill can say "Opus 4.8.5" rather
      // than the family the catalog collapses every Opus onto.
      reportedModelLabel: isCodexChat || isOmpChat ? null : claudeReported.label,
      // Codex resolves its own model elsewhere and has no launch-record path
      // here, so its report is always the live one; so is OMP's, see above.
      reportedModelSource: isCodexChat || isOmpChat ? 'live' : claudeReported.source,
      modelSwitchCommand: isOmpChat ? activeChatAgentStatus?.modelSwitchCommand : undefined,
      transcriptModel: transcriptModel.fallback, onModelSheetOpen: transcriptModel.requestScan, ccrModel: isCodexChat || isOmpChat ? null : ccrModel, beaconAt: hudLiveBeacon?.receivedAt ?? null,
      terminalHandle: activeHandle, queuedMessages: visibleQueuedMessages,
      openRequest: modelSheetRequest + headerModelRequests,
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
  // A refused picture's tap asks the agent for its path through the composer's own text send (outbox, echo, queue),
  // under the terminal's write lock; read through a ref so the placeholders' context is not new each render.
  const shareSendRef = useRef({ send: handleNativeChatSendWithOutcome, onSendError }); shareSendRef.current = { send: handleNativeChatSendWithOutcome, onSendError }
  const shareAskSend = useMemo(() => lockedShareAskSend({ handleRef: activeHandleRef, send: (text) => shareSendRef.current.send(text), onSendError: (message) => shareSendRef.current.onSendError(message) }), [activeHandleRef])
  const nativeChatImageShare = useAgentImageShareAsks({ tabId: activeSessionTabId, sessionId: activeChatSessionId, agent: activeChatResolution?.agent ?? null, messages: nativeChatSession.messages, working: nativeChatAgentWorking, send: !activeChatStructured && activeChatResolution != null ? shareAskSend : null })
  useEffect(() => setModelSheetRequestState(codexIntercept.modelSheetRequest), [codexIntercept.modelSheetRequest])
  useLayoutEffect(() => {
    recordSessionOptionCommandRef.current = recordNativeChatSessionOptionCommand
  }, [recordNativeChatSessionOptionCommand])
  // Card actions retire the route's held failure banner too, not just sends,
  // and hold the waiting notice until the answered card leaves: the dialog the
  // screen showed is the one answered (use-mobile-native-chat-card-answers.ts).
  const promptCard = legacyRenderedPermission ?? legacyQuestion ?? nativeChatAskPrompt
  const { noticeHeld, onCardAnswered, answerAsk, cancelAsk, answerQuestion, respond } = useMobileNativeChatCardAnswers({
    card: promptCard, dialogBeforeAnswer, rereadAfterAnswer, onSendResolved,
    answers: { ask: handleNativeChatAnswerAsk, cancelAsk: handleNativeChatCancelAsk, question: legacyHandleNativeChatQuestionAnswer, permission: activeChatStructured ? structuredNativeChat.respondPermission : legacyHandleNativeChatRespondPermission }
  })
  const respondWithComment = useMobileNativeChatPlanFeedbackRespond({
    client,
    enabled: inputSendable,
    structured: activeChatStructured,
    handleRef: activeHandleRef,
    deviceTokenRef,
    onSendError,
    onResponseAccepted: refreshTerminalHud,
    onAccepted: onCardAnswered
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
    onError: onSendError,
    // A tapped queued message comes back here from the agent's own input (the Claude app's dequeueToInput).
    composerText: () => chatComposerText, onRecalled: ({ handle, text }) => { adoptRecalledInput(handle, text); setChatComposerText(text); setComposerFocusRequest((n) => n + 1) }
  })

  // What a closed app or an expired hold left in the outbox: resent once when safe, or handed back (use-native-chat-outbox-recovery.ts).
  const outbox = useMobileNativeChatOutbox({ hostId, worktreeId, tabId: activeSessionTabId, sessionId: activeChatSessionId, showNativeChat, structured: activeChatStructured, terminalChat: activeChatResolution != null, agent: activeChatResolution?.agent ?? null, terminal: activeHandle, transcriptPath: activeChatResolution?.transcriptPath ?? null, promptBefore: activeChatPromptStatus?.prompt, messages: nativeChatSession.messages, transcriptSettled: nativeChatSession.status === 'ready', receipts: tailPrompts, inputSendable, agentWorking: nativeChatAgentWorking, promptUp: promptCard != null || terminalDialogKind !== null, queuedCount: visibleQueuedMessages.length, composerText: chatComposerText, setComposerText: setChatComposerText, sendTerminal: handleNativeChatSendWithOutcome, sendStructured: structuredNativeChatSend.sendWithOutcome, showEcho: showOutboxEcho, removeEcho: removePending, onNotice: onSendError })

  // The composer's Stop: a ring while stopping, back on when the stop failed or the agent kept working (G24).
  // A terminal Claude tab's Stop drives Claude's own Background dialog (claude-background-task-stop.ts); the structured lane asks its host.
  const structuredCancelPrompt = useNativeChatAcceptedAction(activeChatStructured ? structuredNativeChat.cancelPrompt : async () => false, onSendResolved); const terminalTaskStop = useClaudeTerminalTaskStop({ client, handleRef: activeHandleRef, deviceTokenRef, enabled: !activeChatStructured && activeChatResolution?.agent === 'claude' && connState === 'connected', onDriven: refreshTerminalHud }); const stopButton = useChatStopButton({ stop: activeChatStructured ? structuredNativeChat.cancel : handleNativeChatStop, reportsVerdict: !activeChatStructured, canStop: activeChatStructured ? structuredNativeChat.canStop : nativeChatAgentWorking, scope: streamIdentity, onSendError })

  // Held across renders: a fresh map each render re-ran the chat's whole
  // render-data pass, and an agent's pictures now keep a host entry even
  // before any has loaded (use-host-image-previews.ts).
  const chatImagePreviewsByMessageId = useMemo(
    () => mergeImagePreviews(chatImagePreviewsByMessageIdLocal, hostImagePreviews),
    [chatImagePreviewsByMessageIdLocal, hostImagePreviews]
  )

  return {
    isTabChatView,
    toggleTabChatView,
    terminalPeekActive,
    endTerminalPeek,
    viewResolved,
    activeChatEligible,
    showNativeChat, chatViewSelected, showNativeChatRef,
    nativeChatAgent: activeChatResolution?.agent ?? null,
    chatComposerText,
    setChatComposerText, appendComposerMention, composerFocusRequest, requestComposerFocus: () => setComposerFocusRequest((n) => n + 1), requestModelSheet: () => setHeaderModelRequests((n) => n + 1),
    getChatComposerEditGeneration,
    chatPending, chatWaitingPhotoSends, rememberEcho, takeOwnSends: takeSends, nativeChatOutboxDeliveries: outbox.deliveries, retryNativeChatOutbox: outbox.retry, editNativeChatOutbox: outbox.edit,
    nativeChatQueuedMessages: activeChatStructured || connState !== 'connected' ? [] : visibleQueuedMessages, nativeChatQueueReadable: !activeChatStructured && connState === 'connected' && screenQueueReadable, nativeChatQueueEditable: !activeChatStructured && connState === 'connected' && screenQueueEditable, nativeChatAgentInput: !activeChatStructured && connState === 'connected' ? screenQueueInput : '', // what left the box into the input was recalled, not sent (queue-recalls.ts)
    chatImagePreviewsByMessageId, nativeChatImageShare,
    nativeChatSession: claudeApi.session ?? nativeChatSession, nativeChatAnthropicGate: claudeApi.gate,
    nativeChatStructured: activeChatStructured,
    nativeChatVisualSource: activeChatStructured ? structuredNativeChat.visualSource : null,
    nativeChatTurnActivity: activeChatStructured ? structuredNativeChat.turnActivity : null,
    nativeChatTurnThinking: activeChatStructured ? structuredNativeChat.turnThinking : false,
    nativeChatWorkingStartedAt: activeChatStructured ? structuredNativeChat.workingStartedAt : null,
    nativeChatSettledTurns: activeChatStructured ? structuredNativeChat.settledTurns : null,
    nativeChatAgentWorking,
    nativeChatLeadTurnEnded,
    nativeChatCanStop: activeChatStructured ? structuredNativeChat.canStop : nativeChatAgentWorking,
    // Only the structured lane names a refusal's cause; the bridge lane's starved ones drop none.
    nativeChatCommandRefusalCauses: structuredNativeChat.commandRefusalCauses,
    nativeChatAgentStatus: activeChatTaskStatus, nativeChatSessionIdentity: activeChatSessionIdentity,
    nativeChatBackgroundTaskReport: backgroundTaskReportWithScreen,
    nativeChatBackgroundTasks: activeChatStructured ? structuredNativeChat.backgroundTasks : undefined,
    handleNativeChatStopBackgroundTask: activeChatStructured ? structuredNativeChat.stopBackgroundTask : (terminalTaskStop ?? structuredNativeChat.stopBackgroundTask), nativeChatTerminalTaskStop: terminalTaskStop !== undefined, nativeChatHostConnection,
    nativeChatStreamingText,
    nativeChatStreamLive,
    nativeChatStreamScopeKey: streamScopeKey,
    nativeChatPermission: activeChatStructured
      ? structuredNativeChat.permission
      : legacyRenderedPermission,
    nativeChatQuestion: activeChatStructured ? structuredNativeChat.question : legacyQuestion,
    nativeChatTerminalWait: activeChatStructured || connState !== 'connected' ? null : terminalPromptWait({ card: promptCard, dialogKind: terminalDialogKind, dialogBeforeAnswer: noticeHeld, dialogOptions: terminalDialogOptions, dialogLeft: permissionDismissed, hookState: nativeChatStatus?.state }),
    openNativeChatTerminal: () => { if (activeSessionTabId) { peekTerminalTab(activeSessionTabId) } },
    nativeChatAsk: !activeChatStructured && showNativeChatAsk ? nativeChatAskPrompt : null,
    nativeChatAskKey, nativeChatAskSentAt,
    dismissNativeChatAsk,
    handleNativeChatAnswerAsk: answerAsk,
    handleNativeChatCancelAsk: cancelAsk,
    // Heuristic/legacy cards have no durable prompt identity, so keep their
    // cancel affordance absent instead of exposing a dead action.
    handleNativeChatCancelPrompt: activeChatStructured ? structuredCancelPrompt : undefined,
    handleNativeChatRespondPermission: respond,
    handleNativeChatRespondPermissionWithComment: respondWithComment,
    openNativeChatQueueEditor: queueEditor.recallToComposer, sendNativeChatQueueNow: queueEditor.sendNow,
    nativeChatQueueEditor: queueEditor.editor,
    prepareNativeChatImageSend: settleDraftMirrorBeforeSend,
    beginNativeChatImageSend: clearDraftAtSendStart, parkRefusedNativeChatSend: (text: string) => parkRefusedComposerSend({ text, captureSendOrigin, clearDraftForSend, showSendingEcho }),
    handleNativeChatStop: stopButton.onStop, nativeChatStopping: stopButton.stopping,
    nativeChatFilePaths,
    loadNativeChatFiles,
    nativeChatSkills,
    // Only a structured session reports its own `/` surface; the PTY lane keeps
    // the curated catalog plus the disk scan.
    nativeChatCommandSurface: activeChatStructured ? structuredNativeChat : undefined,
    loadNativeChatSkills,
    handleNativeChatQuestionAnswer: activeChatStructured ? structuredNativeChat.respondQuestion : answerQuestion,
    handleNativeChatSend: activeChatStructured ? structuredNativeChatSend.send : handleNativeChatSend,
    handleNativeChatSendWithOutcome: activeChatStructured ? structuredNativeChatSend.sendWithOutcome : handleNativeChatSendWithOutcome,
    readSeededLaunchDraft, nativeChatSessionOptions,
    nativeChatDesktopPrompts: tailPrompts, nativeChatAgentMessages: agentMessages, nativeChatStatusAgentMessages: statusAgentMessages,
    nativeChatScreenPrompts: activeChatStructured || connState !== 'connected' ? [] : screenSentPrompts,
    nativeChatScreenPeerNotices: activeChatStructured ? [] : screenPeerNotices,
    nativeChatScreenSentPhotos: activeChatStructured || connState !== 'connected' ? [] : screenSentPhotos,
    nativeChatPromptHook: hudBeacon?.promptHook ?? null,
    nativeChatContextWindow: ccrHud.context, nativeChatRateLimits: ccrHud.limits, nativeChatContextUsedTokens: ccrHud.usedTokens, nativeChatLiveModel: claudeModelPillPair(preferCcrModelPair({ model: claudeReported.model, label: claudeReported.label, effort: claudeReported.effort }, ccrModel, hudLiveBeacon?.receivedAt ?? null), transcriptModel.fallback), nativeChatPermissionMode: hudObservation?.permissionMode ?? null, nativeChatAgentMode: hudObservation?.agentMode ?? null,
    refreshNativeChatHud: refreshTerminalHud, nativeChatSpinner: activeChatStructured || connState !== 'connected' ? null : screenSpinner
  }
}
