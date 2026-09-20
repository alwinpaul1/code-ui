import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'
import { AppState } from 'react-native'
import { clipboardHasImage } from './mobile-clipboard-image-reader'
import { mobileNativeChatFrameToShow } from './mobile-native-chat-frame-decision'
import { projectMobileChatQueue } from './mobile-terminal-queued-messages'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePendingImageHistory } from './use-pending-image-history'
import { StyleSheet, View } from 'react-native'
import { MobileNativeChatView, type MobileNativeChatInputLockReason } from './MobileNativeChatView'
import type { MobileNativeChatKeyStripProps } from './MobileNativeChatKeyStrip'
import { foldMobileNativeChatMessages, pendingFoldBoundaries } from './mobile-native-chat-render-data'
import { witnessesToRemember } from './mobile-native-chat-witness-memory'
import { pendingWithoutTranscriptTwins, textsAlreadyShown } from './desktop-prompt-own-sends'
import {
  useDesktopPromptEchoes,
  withoutLandedDesktopPrompts
} from './use-desktop-prompt-echoes'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { useOwnQueueAbsorption } from './use-own-queue-absorption'
import { withAbsorbedPlacement } from './own-queue-absorption'

import type { MobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import type { MobileNativeChatRevertHunk } from './mobile-diff-hunk-revert-request'
import { useMobileNativeChatStreamingBubble } from './use-mobile-native-chat-streaming-bubble'
const CLIPBOARD_POLL_MS = 3000

const NO_QUEUED: string[] = []
const NO_PROMPTS: { nonce: string; text: string }[] = []
const NO_SCREEN_PROMPTS: string[] = []

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
  hostAllowsRewind,
  images,
  onMicPress,
  onBeforeSend,
  micActive,
  micLevel,
  onSelectPermissionMode,
  onSelectAgentMode,
  dictationMode,
  onMicPressIn,
  onMicPressOut,
  inputLockReason,
  sendErrorMessage,
  onClearSendError,
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

  const projectedQueue = useMemo(
    () => projectMobileChatQueue(controller.chatPending, queuedMessages ?? []),
    [controller.chatPending, queuedMessages]
  )
  // Confirmed queued photos cannot exist in history yet. Searching older pages
  // for them repeatedly changes the list window during a live reply.
  usePendingImageHistory(session, projectedQueue.pending, sendSurfaceId)
  // Folded twice on purpose. The first pass is what the echoes anchor
  // themselves against; the second breaks the tool fold at those anchors too,
  // so two prompts sent one after another keep the work between them instead
  // of stacking bare (2026-09-13, the Claude app's "Ran 2 commands").
  const baseFolded = useMemo(
    () =>
      foldMobileNativeChatMessages(session.messages, pendingFoldBoundaries(projectedQueue.pending)),
    [projectedQueue.pending, session.messages]
  )
  // Prompts typed on the desktop never reach the phone through Orca; they
  // ride the HUD beacon instead (2026-09-13).
  const desktopPrompts = controller.nativeChatDesktopPrompts ?? NO_PROMPTS
  // The hook fires for the phone's own sends too, and those already have a
  // pending echo, so anything matching one is left out (2026-09-13).
  // …except a send the transcript itself has a record of: that record says
  // where the message was taken, the phone's echo only guessed, so the echo
  // steps aside for it (2026-09-19, see desktop-prompt-own-sends.ts).
  // …and a message the agent's queue box still lists is drawn THERE, not as
  // a bubble above it (2026-09-19, see textsAlreadyShown).
  const unlandedPrompts = useMemo(
    () =>
      withoutLandedDesktopPrompts(
        desktopPrompts,
        baseFolded,
        textsAlreadyShown(controller.chatPending, desktopPrompts, queuedMessages ?? [])
      ),
    [controller.chatPending, desktopPrompts, baseFolded, queuedMessages]
  )
  // Existing sessions have no hook, but the agent draws its own queue and the
  // phone parses it: an entry that leaves that list was absorbed (2026-09-13).
  const ownPrompts = useMemo(
    () => [...projectedQueue.pending.map((p) => p.text), ...desktopPrompts.map((p) => p.text)],
    [desktopPrompts, projectedQueue.pending]
  )
  // Where the box let each of the phone's own sends go: that is where Claude
  // Code draws it, after the calls that ran while it waited (2026-09-20).
  const ownAbsorption = useOwnQueueAbsorption(
    queuedMessages ?? NO_QUEUED,
    ownPrompts,
    session.messages,
    controller.nativeChatStreamScopeKey
  )
  const desktopEchoes = useDesktopPromptEchoes(
    unlandedPrompts,
    baseFolded,
    session.messages,
    ownAbsorption
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
  const folded = useMemo(
    () =>
      desktopEchoes.length > 0 || absorbedEchoes.length > 0
        ? foldMobileNativeChatMessages(
            session.messages,
            pendingFoldBoundaries([...projectedQueue.pending, ...absorbedEchoes, ...desktopEchoes])
          )
        : baseFolded,
    [absorbedEchoes, baseFolded, desktopEchoes, projectedQueue.pending, session.messages]
  )
  // Witnessed messages are remembered with the phone's own sends, so they
  // survive a reconnect, a tab switch and a relaunch (2026-09-13).
  const rememberEcho = controller.rememberEcho
  useEffect(() => {
    // The rule lives in `witnessesToRemember` so it can be tested: inline here
    // it guarded two things nothing asserted — that a provisional reading is
    // never made permanent, and which id each kind is stored under.
    for (const witness of witnessesToRemember([...absorbedEchoes, ...desktopEchoes])) {
      rememberEcho?.(witness.id, witness.text, witness.anchorId)
    }
  }, [absorbedEchoes, desktopEchoes, rememberEcho])
  const pendingWithDesktopPrompts = useMemo(() => {
    const own = withAbsorbedPlacement(
      pendingWithoutTranscriptTwins(projectedQueue.pending, desktopPrompts),
      ownAbsorption
    )
    return desktopEchoes.length > 0 || absorbedEchoes.length > 0
      ? [...own, ...absorbedEchoes, ...desktopEchoes]
      : own
  }, [absorbedEchoes, desktopEchoes, desktopPrompts, ownAbsorption, projectedQueue.pending])
  const stopBackgroundTask = useCallback(
    (taskId: string) => void controller.handleNativeChatStopBackgroundTask(taskId),
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
  const blank = !controller.showNativeChat || emptyReload
  // The view mode is a placeholder answer of "terminal" until its store is
  // read, and that read re-runs on focus: coming back to the app showed the
  // terminal for a frame while the tab was still a chat tab (2026-09-13,
  // "sometimes chat ui flashes to terminal"). Unresolved is a blink too.
  const blink = controller.showNativeChat
    ? emptyReload
    : !controller.viewResolved ||
      (!controller.activeChatEligible && !controller.terminalPeekActive)
  const held = useHeldChatFrame(blank && blink, sendSurfaceId)
  const frame = mobileNativeChatFrameToShow({
    blank,
    showNativeChat: controller.showNativeChat,
    hasHeldFrame: held.element != null,
    hasTerminalUnderneath
  })
  if (frame === 'hold') {
    return held.element
  }
  if (frame === 'terminal') {
    return null
  }
  const drawn = (
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
        agentStatus={controller.nativeChatAgentStatus}
        backgroundTaskReport={controller.nativeChatBackgroundTaskReport}
        hostBackgroundTasks={controller.nativeChatBackgroundTasks}
        onStopBackgroundTask={
          controller.nativeChatBackgroundTasks?.supportsTaskStop === true
            ? stopBackgroundTask
            : undefined
        }
        streaming={streaming}
        onStop={controller.handleNativeChatStop}
        ask={controller.nativeChatAsk}
        askKey={controller.nativeChatAskKey}
        onDismissAsk={controller.dismissNativeChatAsk}
        onAnswerAsk={controller.handleNativeChatAnswerAsk}
        onCancelAsk={controller.handleNativeChatCancelAsk}
        onCancelPrompt={controller.handleNativeChatCancelPrompt}
        question={controller.nativeChatQuestion}
        onAnswerQuestion={controller.handleNativeChatQuestionAnswer}
        permission={controller.nativeChatPermission}
        onRespondPermission={controller.handleNativeChatRespondPermission}
        onRespondPermissionWithComment={controller.handleNativeChatRespondPermissionWithComment}
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
        pending={pendingWithDesktopPrompts}
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
        isAttaching={images.isAttaching}
        onMicPress={onMicPress}
        onBeforeSend={onBeforeSend}
        micActive={micActive}
        micLevel={micLevel}
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
  held.remember(drawn)
  return drawn
}

const CHAT_FRAME_HOLD_MS = 1500

/** The last chat the overlay drew for this surface, replayed while the source
 *  blanks briefly. The hold is decided in the same render that blanks: an
 *  earlier version set it from an effect, so the first blank frame returned
 *  null, the terminal showed for that frame and the whole chat list
 *  remounted — the flash this exists to stop (2026-09-13). Only the expiry
 *  lives in an effect. */
function useHeldChatFrame(
  blank: boolean,
  surfaceId: string
): { element: React.JSX.Element | null; remember: (element: React.JSX.Element) => void } {
  const lastRef = useRef<{ surfaceId: string; element: React.JSX.Element } | null>(null)
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    if (!blank) {
      setExpired(false)
      return
    }
    const timer = setTimeout(() => setExpired(true), CHAT_FRAME_HOLD_MS)
    return () => clearTimeout(timer)
  }, [blank, surfaceId])
  const last = lastRef.current
  return {
    element: blank && !expired && last?.surfaceId === surfaceId ? last.element : null,
    remember: (drawn) => {
      lastRef.current = { surfaceId, element: drawn }
    }
  }
}

const styles = StyleSheet.create({
  overlay: StyleSheet.absoluteFill
})
