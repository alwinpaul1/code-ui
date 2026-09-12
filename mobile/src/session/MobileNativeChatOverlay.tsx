import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'
import { projectMobileChatQueue } from './mobile-terminal-queued-messages'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePendingImageHistory } from './use-pending-image-history'
import { StyleSheet, View } from 'react-native'
import { MobileNativeChatView, type MobileNativeChatInputLockReason } from './MobileNativeChatView'
import type { MobileNativeChatKeyStripProps } from './MobileNativeChatKeyStrip'
import { foldMobileNativeChatMessages, pendingFoldBoundaries } from './mobile-native-chat-render-data'
import type { MobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import { useMobileNativeChatStreamingBubble } from './use-mobile-native-chat-streaming-bubble'

type Props = {
  controller: MobileNativeChatController
  /** Opens a tapped file reference (worktree-relative or absolute, optional
   *  :line(:col) suffix) through the shared tap-to-open flow. */
  onOpenFile: (pathText: string) => void
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
  dictationMode: 'toggle' | 'hold'
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
  onOpenFile,
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
  const projectedQueue = useMemo(
    () => projectMobileChatQueue(controller.chatPending, queuedMessages ?? []),
    [controller.chatPending, queuedMessages]
  )
  // Confirmed queued photos cannot exist in history yet. Searching older pages
  // for them repeatedly changes the list window during a live reply.
  usePendingImageHistory(session, projectedQueue.pending, sendSurfaceId)
  const folded = useMemo(
    () =>
      foldMobileNativeChatMessages(session.messages, pendingFoldBoundaries(projectedQueue.pending)),
    [projectedQueue.pending, session.messages]
  )
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
  const blink = controller.showNativeChat
    ? emptyReload
    : !controller.activeChatEligible && !controller.terminalPeekActive
  const held = useHeldChatFrame(blank && blink, sendSurfaceId)
  if (blank) {
    return held.element
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
        question={controller.nativeChatQuestion}
        onAnswerQuestion={controller.handleNativeChatQuestionAnswer}
        permission={controller.nativeChatPermission}
        onRespondPermission={controller.handleNativeChatRespondPermission}
        onOpenFile={onOpenFile}
        hasMore={session.hasMore}
        loadingEarlier={session.loadingEarlier}
        onLoadEarlier={session.loadEarlier}
        onSend={images.sendNativeChat}
        sendSurfaceId={sendSurfaceId}
        getSendCompletionGeneration={getSendCompletionGeneration}
        getComposerEditGeneration={controller.getChatComposerEditGeneration}
        queuedMessages={projectedQueue.queue}
        onEditQueue={controller.openNativeChatQueueEditor}
        queueEditor={controller.nativeChatQueueEditor}
        pending={projectedQueue.pending}
        imagePreviewsByMessageId={controller.chatImagePreviewsByMessageId}
        composerText={controller.chatComposerText}
        onComposerTextChange={controller.setChatComposerText}
        onAttachImage={() => void images.attachImage('library')}
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
 *  blanks briefly. Timing lives in an effect so render stays pure. */
function useHeldChatFrame(
  blank: boolean,
  surfaceId: string
): { element: React.JSX.Element | null; remember: (element: React.JSX.Element) => void } {
  const lastRef = useRef<{ surfaceId: string; element: React.JSX.Element } | null>(null)
  const [holding, setHolding] = useState(false)
  useEffect(() => {
    if (!blank) {
      setHolding(false)
      return
    }
    if (lastRef.current?.surfaceId !== surfaceId) {
      return
    }
    setHolding(true)
    const timer = setTimeout(() => setHolding(false), CHAT_FRAME_HOLD_MS)
    return () => clearTimeout(timer)
  }, [blank, surfaceId])
  const last = lastRef.current
  return {
    element: blank && holding && last?.surfaceId === surfaceId ? last.element : null,
    remember: (drawn) => {
      lastRef.current = { surfaceId, element: drawn }
    }
  }
}

const styles = StyleSheet.create({
  overlay: StyleSheet.absoluteFill
})
