import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'
import type { DictationPaint } from '../hooks/mobile-live-transcript'
import { AppState } from 'react-native'
import { clipboardHasImage } from './mobile-clipboard-image-reader'
import { useNativeChatFrame } from './use-native-chat-frame'
import { placeOwnSendsAfterRowsWrittenBefore } from './mid-turn-written-before'
import { agentHasQueueReader, useQueuedOwnSends } from './use-queued-own-sends'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePendingImageHistory } from './use-pending-image-history'
import { StyleSheet, View } from 'react-native'
import { MobileNativeChatView, type MobileNativeChatInputLockReason } from './MobileNativeChatView'
import type { MobileNativeChatKeyStripProps } from './MobileNativeChatKeyStrip'
import { foldMobileNativeChatMessages, pendingFoldBoundaries } from './mobile-native-chat-render-data'
import { boundPhotoCopy, isOwnPhotoStatusCopy, rememberPhotoCopies } from './desktop-prompt-photo-copies'
import {
  inSendOrder,
  pairPendingWithHookPrompts,
  promptsNoCopyStandsFor
} from './desktop-prompt-own-sends'
import {
  deskEchoId,
  useDesktopPromptEchoes,
  withoutLandedDesktopPrompts
} from './use-desktop-prompt-echoes'
import { useScreenPeerNotices } from './use-screen-peer-notices'
import { drawnAfterEarlierAgentMessages, useAgentMessageRows } from './mobile-native-chat-agent-message-rows'
import { screenRowBodies, type BeaconAgentMessage, type StatusSubagentMessage } from './mobile-native-chat-agent-messages'
import { useScreenSentPhotos } from './use-screen-sent-photos'
import type { ScreenSentPhotos } from './mobile-terminal-sent-photos'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'
import type { DesktopPrompt } from './agent-hud-beacon'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { useQueuedDeskWitnesses, useRememberedWitnesses } from './use-queued-desk-witnesses'
import { openImageMarkup } from './image-markup-store'

import type { MobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'
import { useMobileNativeChatStreamingBubble } from './use-mobile-native-chat-streaming-bubble'
import { CreatedFileCountProvider } from './MobileNativeChatCreatedFileCounts'
import type { CreatedFileCountStore } from './mobile-native-chat-created-file-count-store'
import { holdsWholeSession, transcriptSettled } from './mobile-native-chat-whole-session'
import { placedByHarnessTurns } from './desk-prompt-harness-turns'
const CLIPBOARD_POLL_MS = 3000

const NO_PROMPTS: DesktopPrompt[] = []
const NO_SCREEN_PROMPTS: string[] = []
const NO_PEER_ROWS: ScreenPeerRow[] = []
const NO_AGENT_MESSAGES: BeaconAgentMessage[] = []
const NO_STATUS_AGENT_MESSAGES: readonly StatusSubagentMessage[] = []
const NO_SENT_PHOTOS: ScreenSentPhotos[] = []

type Props = {
  controller: MobileNativeChatController
  /** A terminal pane is mounted for the active tab. When none is, this overlay
   *  is the only thing on screen, so it must never render nothing. */
  hasTerminalUnderneath: boolean
  /** Opens a tapped file reference (worktree-relative or absolute, optional
   *  :line(:col) suffix) through the shared tap-to-open flow. */
  onOpenFile: (pathText: string) => void
  /** Puts one hunk of a landed edit back in the file (the diff card's action). */
  onRevertHunk?: MobileNativeChatRevertHunk
  /** Reads back the created files the wire cut, for their line counts. */
  createdFileCounts?: CreatedFileCountStore
  /** Whether THIS host lets a phone call `agentSession.rewind` at all — the
   *  mobile-scope dispatch gate's answer (host-mobile-capabilities.ts), which
   *  is separate from whether the session itself can be rewound. Both must
   *  hold before "Rewind to here" is offered. */
  hostAllowsRewind: boolean
  /** Native-chat image attachments: picking adds a composer chip, and sending
   *  rides the pending images along with the message text (desktop parity). */
  images: MobileNativeChatImageAttachments
  onMicPress: () => void
  /** Runs before a composer send goes out: ends live dictation so the sent words do not come back. */
  onBeforeSend?: () => void
  micActive: boolean
  micLevel?: number
  dictationPaint?: DictationPaint | null
  onComposerCursor?: (cursor: number) => void
  /** Steps the terminal to a permission mode (the mode sheet's pick). */
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  onSelectAgentMode?: (mode: TerminalAgentMode) => void
  dictationMode: string | undefined
  onMicPressIn: () => void
  onMicPressOut: () => void
  inputLockReason: MobileNativeChatInputLockReason | null
  /** Latest send failure, rendered inline above the composer. */
  sendErrorMessage: string | null
  /** Drops that failure once a later send succeeds. */
  onClearSendError: () => void
  /** The chat's banner-or-toast reporter itself, for a sheet that says its own
   *  failures while open and hands on what it cannot show (use-sheet-failure.ts). */
  onSendFailure?: (message: string) => void
  /** Stable host/worktree/tab identity for accepted-send completion fencing. */
  sendSurfaceId: string
  /** Reads the retained route's focus generation for accepted-send fencing. */
  getSendCompletionGeneration: () => number
  keyboardInset: number
  /** Terminal accessory keys (Tab, Shift+Tab, arrows, Esc…) rendered above the
   *  composer so TUI menus stay operable from Chat UI. */
  keyStrip?: MobileNativeChatKeyStripProps
}

/** Keeps the terminal mounted underneath chat so its PTY subscription survives
 *  view toggles while the native surface owns the visible composer. Also owns
 *  the streaming gate: this component stays mounted across those toggles, while
 *  the chat list below it does not. */
export function MobileNativeChatOverlay({
  controller,
  hasTerminalUnderneath,
  onOpenFile,
  onRevertHunk,
  createdFileCounts,
  hostAllowsRewind,
  images,
  onMicPress,
  onBeforeSend,
  micActive,
  micLevel,
  dictationPaint,
  onComposerCursor,
  onSelectPermissionMode,
  onSelectAgentMode,
  dictationMode,
  onMicPressIn,
  onMicPressOut,
  inputLockReason,
  sendErrorMessage,
  onClearSendError,
  onSendFailure,
  sendSurfaceId,
  getSendCompletionGeneration,
  keyboardInset,
  keyStrip
}: Props): React.JSX.Element | null {
  const session = controller.nativeChatSession
  // Both halves are fresh arrays every call, and they are the `pending` dep of
  // the render memo downstream whose comment says it exists to keep FlashList's
  // data identity stable. Unmemoized, every 1 Hz screen poll rebuilt the whole
  // list and re-ran the autoscroll — the layout churn 0.2.41 set out to remove.
  const queuedMessages = controller.nativeChatQueuedMessages
  // Only offer the paste row when there is actually an image to paste; an
  // empty clipboard would give the user a row that silently does nothing.
  const [clipboardImage, setClipboardImage] = useState(false)
  useEffect(() => {
    let cancelled = false
    const check = () => {
      void clipboardHasImage().then((has) => {
        if (!cancelled) {
          setClipboardImage(has)
        }
      })
    }
    check()
    // Re-check on a timer as well as on foreground: copying an image while the
    // app is already open never fired the AppState listener, so the row never
    // appeared — and emptying the clipboard the same way left a row that did
    // nothing when tapped (2026-09-14 review).
    const timer = setInterval(check, CLIPBOARD_POLL_MS)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check()
      }
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      subscription.remove()
    }
  }, [])

  // A send made mid-turn is queued from the moment it exists, not from the
  // first screen read that finds it in the agent's box (2026-09-25).
  const projectedQueue = useQueuedOwnSends(
    controller.chatPending,
    queuedMessages,
    controller.nativeChatAgentWorking === true,
    {
      scopeKey: controller.nativeChatStreamScopeKey,
      readsQueueBox: !controller.nativeChatStructured && agentHasQueueReader(controller.nativeChatAgent),
      readBeat: controller.nativeChatSpinner,
      // Taken mid-turn, a send is owed no row (isTakenSend, 2026-09-25).
      onTaken: controller.takeOwnSends
    }
  )
  // Confirmed queued photos cannot exist in history yet. Searching older pages
  // for them repeatedly changes the list window during a live reply.
  usePendingImageHistory(session, projectedQueue.pending, sendSurfaceId)
  // Folded twice on purpose. The first pass is what the echoes anchor
  // themselves against; the second breaks the tool fold at those anchors too,
  // so two prompts sent one after another keep the work between them instead
  // of stacking bare (2026-09-13, the Claude app's "Ran 2 commands").
  // Each of the phone's sends drawn after any row written before it, even one
  // that loaded after the send did (mid-turn-written-before.ts).
  const placedOwn = useMemo(
    () => placeOwnSendsAfterRowsWrittenBefore(projectedQueue.pending, session.messages),
    [projectedQueue.pending, session.messages]
  )
  const baseFolded = useMemo(
    () => foldMobileNativeChatMessages(session.messages, pendingFoldBoundaries(placedOwn)),
    [placedOwn, session.messages]
  )
  // Prompts typed on the desktop never reach the phone through Orca; they
  // ride the HUD beacon instead (2026-09-13).
  // A held copy the transcript can now place goes to its run
  // (desk-prompt-harness-turns.ts, 2026-09-27).
  const statusAndBeaconPrompts = controller.nativeChatDesktopPrompts ?? NO_PROMPTS
  const desktopPrompts = useMemo(() => placedByHarnessTurns(statusAndBeaconPrompts, session.messages), [session.messages, statusAndBeaconPrompts])
  // The hook fires for the phone's own sends too, and those already have a
  // pending echo, so the hook's copy of one is left out (2026-09-13). The
  // phone's send keeps its photos and its send-time place; only a copy with
  // no send time steps aside for the hook's. One copy each way: a pending
  // "yes" must not hide a later "yes" typed at the desk (desktop-prompt-own-sends.ts).
  // The photo sends the draft store has not read back yet pair too: in the
  // first frame back the hook's copy drew as chips, then the photos (third
  // review of the photo binder, 2026-09-26).
  const waitingPhotoSends = controller.chatWaitingPhotoSends
  const pairingPending = useMemo(
    () =>
      waitingPhotoSends?.length
        ? [...controller.chatPending, ...waitingPhotoSends.filter((send) => !controller.chatPending.some((item) => item.id === send.id))]
        : controller.chatPending,
    [controller.chatPending, waitingPhotoSends]
  )
  const hookPairing = useMemo(
    () => pairPendingWithHookPrompts(pairingPending, desktopPrompts, session.messages, boundPhotoCopy, isOwnPhotoStatusCopy),
    [pairingPending, desktopPrompts, session.messages]
  )
  useEffect(() => rememberPhotoCopies(hookPairing.photoCopies), [hookPairing])
  // …and a message the agent's queue box still lists is drawn THERE, not as
  // a bubble above it (2026-09-19, see promptsNoCopyStandsFor).
  // A user row of a desk copy's words lands it, unless a later submission of
  // the words owns that row, which only the prompt hook's copies can say
  // (desk-prompt-row-owners.ts: the same words sent mid-turn and then typed
  // at the desk as the next turn's prompt, gap D). Without them the phone
  // cannot tell that row from the one Claude writes for a message still
  // queued at a turn's end, and a rule that tried by the queue box drew those
  // twice whenever the phone missed the moment of the dequeue (asleep, a box
  // it could not read, a clock behind the desktop's).
  const unlandedPrompts = useMemo(
    () =>
      withoutLandedDesktopPrompts(
        promptsNoCopyStandsFor(desktopPrompts, hookPairing),
        baseFolded,
        queuedMessages ?? [],
        session.messages
      ),
    [hookPairing, desktopPrompts, baseFolded, queuedMessages, session.messages]
  )
  // Existing sessions have no hook, but the agent draws its own queue and the
  // phone parses it: an entry that leaves that list was absorbed (2026-09-13).
  // The phone's own sends waiting in the queue box before the agent's box has
  // listed them are drawn too: a box row that left may be one of them.
  // Not a status copy held back: it is never drawn, so a message the box
  // lets go of would then show nowhere (agent-status-prompts.ts, 2026-09-27).
  const ownPrompts = useMemo(
    () => [
      ...projectedQueue.pending.map((p) => p.text),
      ...projectedQueue.unlisted.map((p) => p.text),
      ...desktopPrompts.flatMap((p) => (p.heldBack === true ? [] : [p.text]))
    ],
    [desktopPrompts, projectedQueue.pending, projectedQueue.unlisted]
  )
  // Every mid-turn message is drawn where it was SENT, as the Claude app draws
  // it, with the calls that ran while it waited below it (2026-09-23).
  const desktopEchoes = useDesktopPromptEchoes(
    unlandedPrompts,
    baseFolded,
    session.messages,
    session.hasMore,
    session.status === 'ready' && session.baseRetained !== true,
    controller.nativeChatPromptHook === true
  )
  const absorbedEchoes = useAbsorbedQueueEchoes(
    queuedMessages ?? [],
    controller.nativeChatScreenPrompts ?? NO_SCREEN_PROMPTS,
    baseFolded,
    // Scoped on the STREAM key, which carries the session id: the surface id
    // is host/worktree/tab only, so after a `/clear` a held echo survived into
    // the new conversation and stuck to the top of it (2026-09-13).
    controller.nativeChatStreamScopeKey,
    session.messages,
    ownPrompts
  )
  const foldedWithoutPeers = useMemo(
    () =>
      desktopEchoes.length > 0 || absorbedEchoes.length > 0
        ? foldMobileNativeChatMessages(
            session.messages,
            pendingFoldBoundaries([...placedOwn, ...absorbedEchoes, ...desktopEchoes])
          )
        : baseFolded,
    [absorbedEchoes, baseFolded, desktopEchoes, placedOwn, session.messages]
  )
  // A subagent's message never reaches the transcript the phone reads; the
  // prompt hook carries it, drawn as the TUI's folded row (2026-09-26).
  const agentMessages = controller.nativeChatAgentMessages ?? NO_AGENT_MESSAGES
  const wholeSessionHeld = session.status === 'ready' && session.baseRetained !== true && !session.hasMore
  const foldedWithAgents = useAgentMessageRows(agentMessages, foldedWithoutPeers, session.messages, controller.nativeChatStreamScopeKey, wholeSessionHeld)
  // A message from a subagent or another session mostly never reaches the
  // transcript the phone reads; the agent's screen says one arrived, and
  // from whom, so that is drawn where it was seen (2026-09-20). A subagent's
  // is drawn off the screen only where no prompt hook carries it.
  // Its words, where the tab status carried a subagent message (2026-09-27).
  const statusAgentMessages = controller.nativeChatStatusAgentMessages ?? NO_STATUS_AGENT_MESSAGES
  const screenBodies = useMemo(() => screenRowBodies(statusAgentMessages, session.messages), [session.messages, statusAgentMessages])
  const foldedWithoutPhotos = useScreenPeerNotices(
    controller.nativeChatScreenPeerNotices === undefined ? NO_PEER_ROWS : controller.nativeChatScreenPeerNotices,
    foldedWithAgents,
    controller.nativeChatStreamScopeKey,
    controller.nativeChatPromptHook !== true,
    screenBodies,
    // A row found on the screen is placed against the host's transcript as
    // of now, never the cached copy or the one from before a reconnect.
    transcriptSettled(session)
  )
  // A photo from the Claude app never reaches the transcript the phone reads;
  // Claude's own `[Image #N]` rows say it was there (2026-09-24).
  const folded = useScreenSentPhotos(
    controller.nativeChatScreenSentPhotos ?? NO_SENT_PHOTOS,
    foldedWithoutPhotos,
    controller.nativeChatStreamScopeKey
  )
  // Witnessed messages are remembered with the phone's own sends, so they
  // survive a reconnect, a tab switch and a relaunch (2026-09-13).
  // A message still in the agent's queue box too (use-queued-desk-witnesses.ts).
  useRememberedWitnesses(
    [...absorbedEchoes, ...desktopEchoes],
    useQueuedDeskWitnesses(projectedQueue.queue, session.messages, controller.nativeChatStreamScopeKey),
    controller.rememberEcho
  )
  const pendingWithDesktopPrompts = useMemo(() => {
    const own = hookPairing.steppedAside.size === 0
      ? placedOwn
      : placedOwn.filter((item) => !hookPairing.steppedAside.has(item.id))
    if (desktopEchoes.length === 0 && absorbedEchoes.length === 0) {
      return own
    }
    // Two bubbles after one row draw in list order, so in the order they were sent.
    const sentAt = new Map(desktopPrompts.map((prompt) => [deskEchoId(prompt.nonce), prompt.at]))
    return inSendOrder([...own, ...absorbedEchoes], desktopEchoes, (echo) => sentAt.get(echo.id))
  }, [absorbedEchoes, desktopEchoes, desktopPrompts, hookPairing, placedOwn])
  // …and one the hook took after a subagent message at the same row is drawn
  // below that message's row, as it came (2026-09-26).
  const pendingInArrivalOrder = useMemo(
    () => drawnAfterEarlierAgentMessages(pendingWithDesktopPrompts, agentMessages, folded, session.messages),
    [agentMessages, folded, pendingWithDesktopPrompts, session.messages]
  )
  const stopBackgroundTask = useCallback(
    (taskId: string, report?: (message: string) => void) =>
      void controller.handleNativeChatStopBackgroundTask(taskId, report),
    [controller]
  )
  const streaming = useMobileNativeChatStreamingBubble(
    folded,
    controller.nativeChatStreamingText,
    controller.nativeChatStreamScopeKey,
    controller.nativeChatStreamLive
  )
  // A reconnect can blank the chat for a frame or two: the tab list
  // re-hydrates, or the transcript re-reads, and the overlay would drop to
  // the terminal beneath and back (2026-09-13, "the whole screen flashes").
  // Hold the last drawn chat for a moment instead; a real switch away
  // outlasts the hold and clears normally.
  // A deliberate switch to the terminal keeps the tab eligible for chat; a
  // blink loses the tab or its identity. Only the blink is held.
  const emptyReload = session.transcriptLoading && session.messages.length === 0
  const chatOn = controller.showNativeChat || controller.chatViewSelected
  const blank = !chatOn || emptyReload
  // The view mode is a placeholder answer of "terminal" until its store is
  // read, and that read re-runs on focus: coming back to the app showed the
  // terminal for a frame while the tab was still a chat tab (2026-09-13,
  // "sometimes chat ui flashes to terminal"). Unresolved is a blink too.
  const blink = controller.showNativeChat
    ? emptyReload
    : !controller.viewResolved ||
      (!controller.activeChatEligible && !controller.terminalPeekActive)
  const { frame, held, remember } = useNativeChatFrame({
    blank,
    blink,
    showNativeChat: chatOn,
    hasTerminalUnderneath,
    surfaceId: sendSurfaceId
  })
  if (frame === 'hold') {
    return held
  }
  if (frame === 'terminal') {
    return null
  }
  const chat = (
    <View style={styles.overlay}>
      <MobileNativeChatView
        messages={session.messages}
        folded={folded}
        status={session.status}
        error={session.error}
        agent={controller.nativeChatAgent}
        agentWorking={controller.nativeChatAgentWorking}
        canStop={controller.nativeChatCanStop}
        structuredActivityUi={controller.nativeChatStructured}
        turnActivity={controller.nativeChatTurnActivity}
        turnThinking={controller.nativeChatTurnThinking}
        workingStartedAt={controller.nativeChatWorkingStartedAt}
        settledTurns={controller.nativeChatSettledTurns}
        agentStatus={controller.nativeChatAgentStatus} sessionIdentity={controller.nativeChatSessionIdentity}
        backgroundTaskReport={controller.nativeChatBackgroundTaskReport}
        hostBackgroundTasks={controller.nativeChatBackgroundTasks}
        spinner={controller.nativeChatSpinner ?? null}
        onStopBackgroundTask={
          controller.nativeChatBackgroundTasks?.supportsTaskStop === true
            ? stopBackgroundTask
            : undefined
        }
        reportBackgroundTaskFailure={onSendFailure}
        streaming={streaming}
        onStop={controller.handleNativeChatStop}
        ask={controller.nativeChatAsk}
        askKey={controller.nativeChatAskKey} askSentAt={controller.nativeChatAskSentAt}
        onDismissAsk={controller.dismissNativeChatAsk}
        onAnswerAsk={controller.handleNativeChatAnswerAsk}
        onCancelAsk={controller.handleNativeChatCancelAsk}
        onCancelPrompt={controller.handleNativeChatCancelPrompt}
        question={controller.nativeChatQuestion}
        onAnswerQuestion={controller.handleNativeChatQuestionAnswer}
        permission={controller.nativeChatPermission}
        onRespondPermission={controller.handleNativeChatRespondPermission}
        onRespondPermissionWithComment={controller.handleNativeChatRespondPermissionWithComment}
        terminalWait={controller.nativeChatTerminalWait}
        onOpenTerminal={controller.openNativeChatTerminal}
        onOpenFile={onOpenFile}
        onRevertHunk={onRevertHunk}
        hasMore={session.hasMore}
        loadingEarlier={session.loadingEarlier}
        onLoadEarlier={session.loadEarlier}
        onSend={images.sendNativeChat}
        sendSurfaceId={sendSurfaceId}
        getSendCompletionGeneration={getSendCompletionGeneration}
        getComposerEditGeneration={controller.getChatComposerEditGeneration}
        queuedMessages={projectedQueue.queue}
        onEditQueue={controller.openNativeChatQueueEditor}
        onSendQueueNow={controller.sendNativeChatQueueNow}
        queueEditor={controller.nativeChatQueueEditor}
        pending={pendingInArrivalOrder}
        imagePreviewsByMessageId={controller.chatImagePreviewsByMessageId}
        composerText={controller.chatComposerText}
        onComposerTextChange={controller.setChatComposerText}
        composerFocusRequest={controller.composerFocusRequest}
        onCaptureImage={() => void images.attachImage('camera')}
        onAttachImage={() => void images.attachImage('library')}
        onPasteImage={clipboardImage ? () => void images.attachImage('clipboard') : undefined}
        onPasteImageFile={(uri) => void images.attachImageFile(uri)}
        onAttachFile={() => void images.attachDocument()}
        attachments={images.attachments}
        onRemoveAttachment={images.removeAttachment}
        onEditAttachment={(id, uri) =>
          openImageMarkup(uri, {
            onDone: (result) => void images.replaceAttachment(id, result.base64)
          })
        }
        videoFrameExtraction={images.videoFrameExtraction}
        onCancelVideoFrameExtraction={images.cancelVideoFrameExtraction}
        isAttaching={images.isAttaching}
        onMicPress={onMicPress}
        onBeforeSend={onBeforeSend}
        micActive={micActive}
        micLevel={micLevel}
        dictationPaint={dictationPaint}
        onComposerCursor={onComposerCursor}
        contextWindow={controller.nativeChatContextWindow}
        permissionMode={controller.nativeChatPermissionMode}
        onSelectPermissionMode={onSelectPermissionMode}
        agentMode={controller.nativeChatAgentMode}
        onSelectAgentMode={onSelectAgentMode}
        dictationMode={dictationMode}
        onMicPressIn={onMicPressIn}
        onMicPressOut={onMicPressOut}
        inputLockReason={inputLockReason}
        sendErrorMessage={sendErrorMessage}
        onClearSendError={onClearSendError}
        filePaths={controller.nativeChatFilePaths}
        onNeedFiles={controller.loadNativeChatFiles}
        skills={controller.nativeChatSkills}
        sessionCommands={controller.nativeChatCommandSurface?.sessionCommands}
        conversationCommands={controller.nativeChatCommandSurface?.conversationCommands}
        // Only the structured lane has a command surface, and only a host that
        // said it will rewind THIS session gets the affordance — and only when
        // the host's mobile gate lets the call through at all (Orca 1.4.205
        // refuses agentSession.rewind from a phone outright). The PTY lane
        // keeps the typed `/rewind`, which is the one that can restore files.
        onRewindToMessage={
          hostAllowsRewind &&
          controller.nativeChatCommandSurface?.rewindSupport?.supported === true
            ? controller.nativeChatCommandSurface.rewindToItem
            : undefined
        }
        onNeedSkills={controller.loadNativeChatSkills}
        sessionOptions={controller.nativeChatSessionOptions}
        keyboardInset={keyboardInset}
        keyStrip={keyStrip}
      />
    </View>
  )
  // The loaded transcript says whether a later call touched a created file,
  // but only a settled read of the whole session can (holdsWholeSession): a
  // kept tail lacks what was written while the chat was away, and a window
  // that starts after the first row can hide a background agent launched
  // before it that is still writing the file (review of 8b2ef369: +125 on a
  // 93-line create).
  const drawn = (
    <CreatedFileCountProvider
      store={createdFileCounts}
      messages={session.messages}
      live={holdsWholeSession(session)}
    >
      {chat}
    </CreatedFileCountProvider>
  )
  remember(drawn)
  return drawn
}

const styles = StyleSheet.create({
  overlay: StyleSheet.absoluteFill
})
