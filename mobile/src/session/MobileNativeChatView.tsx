import { FlashList } from '@shopify/flash-list'
import { MobileNativeChatQueueEditor } from './MobileNativeChatQueueEditor'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useTheme } from '../theme/theme-context'
import { useChatViewStyles } from './mobile-native-chat-view-styles'
import {
  buildMobileNativeChatTransientData,
  mobileNativeChatEmptyState
} from './mobile-native-chat-render-data'
import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'
import { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'
import { useMobileChatFocusView } from './use-mobile-chat-focus-view'
import { MobileNativeChatListHeader } from './MobileNativeChatListHeader'
import {
  chatListDrawDistanceDp,
  useChatListRenderStability
} from './mobile-native-chat-list-extra-data'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import {
  MobileNativeChatComposerTasks,
  useMobileNativeChatTaskProgress
} from './mobile-native-chat-composer-tasks'
import { MobileNativeChatKeyStrip } from './MobileNativeChatKeyStrip'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { useMobileNativeChatTailFollow } from './use-mobile-native-chat-tail-follow'
import { useMobileNativeChatRewind } from './use-mobile-native-chat-rewind'
import { useChatScrollView } from './use-mobile-chat-scroll-view'
import { ChatTextSelectableContext } from '../components/chat-text-selectable-context'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { interimAssistantMessageIds } from './mobile-native-chat-interim'
import { chatTimeDividerLabels } from './mobile-native-chat-time-dividers'
import { useNow } from '../hooks/use-now'
import { MobileNativeChatTimeDivider } from './MobileNativeChatTimeDivider'
import { useMeasuredHeight } from './mobile-native-chat-suggestion-popover'
import { useChatDock } from './use-mobile-chat-dock'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'
import { composerPlaceholder, useMobileNativeChatInputLock } from './use-mobile-native-chat-input-lock'
import {
  MobileNativeChatJumpToLatest,
  MobileNativeChatListEmpty,
  MobileNativeChatLoadEarlier
} from './mobile-native-chat-list-edges'


export type { MobileNativeChatInputLockReason } from './mobile-native-chat-view-props'

export function MobileNativeChatView({
  messages,
  folded,
  status,
  error,
  agent,
  agentWorking,
  canStop,
  structuredActivityUi = false,
  turnActivity = null,
  turnThinking = false,
  workingStartedAt,
  settledTurns,
  agentStatus,
  backgroundTaskReport,
  hostBackgroundTasks,
  onStopBackgroundTask,
  onStop,
  streaming,
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onSend,
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  queuedMessages,
  onEditQueue,
  onSendQueueNow,
  queueEditor,
  pending,
  imagePreviewsByMessageId,
  composerText,
  onComposerTextChange,
  composerFocusRequest,
  onCaptureImage, onAttachImage, onPasteImage, onPasteImageFile,
  onAttachFile,
  attachments,
  onRemoveAttachment,
  isAttaching,
  onMicPress,
  onBeforeSend,
  micActive, micLevel, dictationPaint, onComposerCursor,
  contextWindow,
  permissionMode,
  onSelectPermissionMode,
  agentMode,
  onSelectAgentMode,
  dictationMode,
  onMicPressIn,
  onMicPressOut,
  inputLockReason,
  sendErrorMessage,
  onClearSendError,
  filePaths,
  onNeedFiles,
  skills,
  sessionCommands,
  conversationCommands,
  onNeedSkills,
  sessionOptions,
  ask,
  askKey,
  onDismissAsk,
  onAnswerAsk,
  onCancelAsk,
  onCancelPrompt,
  question,
  onAnswerQuestion,
  permission,
  onRespondPermission,
  onRespondPermissionWithComment,
  onCancelQueued,
  onRewindToMessage,
  onOpenFile,
  onRevertHunk,
  keyboardInset = 0,
  keyStrip
}: MobileNativeChatViewProps): React.JSX.Element {
  const { colors, space } = useTheme()
  const styles = useChatViewStyles()
  const insets = useSafeAreaInsets()
  const drawDistance = chatListDrawDistanceDp(useWindowDimensions().height)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // Focus view is a device preference (Settings → Chat UI); the store notifies,
  // so a toggle made while this chat was open lands on its rows at once.
  const focusView = useMobileChatFocusView()
  const [backgroundTasksOpen, setBackgroundTasksOpen] = useState(false)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom

  const { fontScale, pinchGesture } = useMobileNativeChatPinchGesture()
  const ChatScrollView = useChatScrollView(pinchGesture)

  // Folded transcript plus streaming bubble and accepted echoes.
  const { data } = useMemo(
    () =>
      buildMobileNativeChatTransientData({
        messages,
        folded,
        streaming,
        pending,
        imagePreviewsByMessageId
      }),
    [messages, folded, streaming, pending, imagePreviewsByMessageId]
  )
  const newestFirst = useMemo(() => data.toReversed(), [data])
  // Over the transcript, not `data`: a message the phone sent mid-turn sits
  // in `data` as an echo the agent absorbed without a user record, and it
  // must not end the turn — the Claude app keeps the note before it in a
  // quote block (2026-09-13).
  const interimIds = useMemo(() => interimAssistantMessageIds(folded), [folded])
  // Labels say "today" or a weekday relative to now; five minutes keeps a
  // divider honest across midnight without churning the rows.
  const dividerNow = useNow(5 * 60_000)
  const dividerLabels = useMemo(() => chatTimeDividerLabels(data, dividerNow), [data, dividerNow])
  const { predecessors: taskListPredecessors, composerList } = useMobileNativeChatTaskProgress(data)

  // One owner for the transcript's scroll position: what the reader wants,
  // where the list is, and every command that moves it. Nothing else in this
  // file may touch the list's offset (ported from Orca 2fc84cb49, #20493).
  const {
    listRef,
    showJumpToLatest,
    textSelectable,
    touchStart,
    touchEnd,
    evaluateEdge,
    onEndReached,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    onScrollToMessage
  } = useMobileNativeChatTailFollow<NativeChatMessage>({
    rows: newestFirst,
    hasMore,
    loadingEarlier,
    onLoadEarlier
  })
  const { dockHeight, onDockLayout } = useChatDock(pinToTail)
  // The composer's popover may take only the room between the header and the
  // dock, keyboard included (mobile-native-chat-suggestion-popover.ts).
  const [rootHeight, onRootLayout] = useMeasuredHeight()
  const { rewindable, request: requestRewind, sheet: rewindSheet } = useMobileNativeChatRewind({
    messages, folded, onRewindToMessage, composerText, onComposerTextChange
  })

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      const accepted = await onSend(text)
      if (!accepted) {
        return false
      }
      onClearSendError?.()
      return true
    },
    [onSend, onClearSendError]
  )

  // Per-turn "Thinking / Working for N / Worked for N" rows. The structured lane
  // owns them; the bridge lane keeps its three-dot indicator.
  const turns = useMobileNativeChatTurnDisclosure({
    messages: data,
    enabled: structuredActivityUi,
    isWorking: agentWorking === true,
    workingStartedAt,
    settledTurns,
    thinking: turnThinking,
    awaitingInput: structuredActivityUi && (ask != null || permission != null || question != null),
    scopeKey: sendSurfaceId
  })

  const { headerExtraData, contentPosition } = useChatListRenderStability({
    agentStatus,
    backgroundTaskReport,
    hostBackgroundTasks,
    queuedMessages,
    turnActivity,
    showJumpToLatest,
    unanchoredTurnStatus: turns.activeTurnIsUnanchored ? turns.active : null
  })

  // The dock spacer lives in the header; the header only re-renders when
  // this changes, so the dock's height has to be part of it.
  const listExtraData = useMemo(() => [headerExtraData, dockHeight], [headerExtraData, dockHeight])

  const renderItem = useCallback(
    ({ item, index }: { item: NativeChatMessage; index: number }) => (
      <>
        {dividerLabels.has(item.id) ? (
          <MobileNativeChatTimeDivider label={dividerLabels.get(item.id) as string} />
        ) : null}
        <MobileNativeChatMessage
        message={item}
        interim={interimIds.has(item.id)}
        toolsExpanded={toolsExpanded}
        fontScale={fontScale}
        messageIndex={index}
        onScrollToMessage={onScrollToMessage}
        onOpenFile={onOpenFile}
        onRevertHunk={onRevertHunk}
        focusView={focusView}
        onCancelQueued={
          agentWorking && onCancelQueued && item.id.startsWith('pending-')
            ? () => void onCancelQueued(item.id)
            : undefined
        }
        onRewindToHere={rewindable.has(item.id) ? requestRewind : undefined}
        structuredActivityUi={structuredActivityUi}
        turnActivity={turnActivity}
        onToggleTurn={turns.onToggleTurn}
        // The list is inverted, so `index` counts from the newest row while the
        // disclosure walks the transcript in order. Flip it, or every row reads
        // another turn's status.
        {...turns.resolveRow(data.length - 1 - index, item)}
        taskListPredecessors={taskListPredecessors.get(item.id)}
        />
      </>
    ),
    [
      interimIds,
      dividerLabels,
      toolsExpanded,
      fontScale,
      onScrollToMessage,
      onOpenFile,
      onRevertHunk,
      focusView,
      agentWorking,
      onCancelQueued,
      rewindable,
      requestRewind,
      structuredActivityUi,
      turnActivity,
      turns,
      data.length,
      taskListPredecessors
    ]
  )

  const emptyState = mobileNativeChatEmptyState(status, agent ?? null, error)
  const showLoading = status === 'loading' && messages.length === 0

  const lockReason = useMobileNativeChatInputLock(inputLockReason)

  return (
    <View style={styles.root} onLayout={onRootLayout}>
      {showLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <GestureHandlerRootView style={styles.listWrap}>
          <ChatTextSelectableContext.Provider value={textSelectable}>
          <FlashList
            ref={listRef}
            renderScrollComponent={ChatScrollView}
            data={newestFirst}
            // Why: FlashList is a PureComponent, so its header keeps whatever
            // it last rendered unless `data` or this marker changes. The
            // running-tasks row, the queue and the turn status all live outside
            // `data`, and the row went stale while the sheet stayed correct.
            extraData={listExtraData}
            inverted
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            // Let link/file taps land while the composer keyboard is up
            // instead of being swallowed by the dismiss gesture.
            keyboardShouldPersistTaps="handled"
            onScroll={evaluateEdge}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            onTouchStart={touchStart}
            onTouchEnd={touchEnd}
            onTouchCancel={touchEnd}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollEndDrag}
            onMomentumScrollBegin={onMomentumScrollBegin}
            onMomentumScrollEnd={onMomentumScrollEnd}
            scrollEventThrottle={16}
            // Why: while the reader is up in history, content growing above the
            // fold must not shift what they are reading. At the live edge,
            // native anchoring fights the tail pin and briefly shows old rows.
            maintainVisibleContentPosition={contentPosition}
            onContentSizeChange={pinToTailAfterContentResize}
            // A viewport resize — the keyboard, a rotation — keeps an inverted
            // list's tail at offset 0 by itself, so this only re-asserts it,
            // and only while the reader is still following.
            onLayout={pinToTail}
            // Message descendants hold disclosure and copy state. Keep it
            // scoped to the message when off-screen cells leave the window.
            maxItemsInRecyclePool={0}
            // Why: with recycling off, every newly exposed message is a fresh
            // mount — markdown, code blocks and all — on the JS thread. The
            // 250dp default is under one viewport of runway, and with the
            // keyboard up the viewport is halved, so a scroll outran what was
            // prepared and the content landed late. Measured on a 120 Hz S23:
            // native frames stayed clean (<1% janky) while the scroll still
            // felt laggy, which is what a too-short render window looks like.
            drawDistance={drawDistance}
            // Inverted list: the header paints below the newest message, so
            // the running-tasks row sits directly under the last bubble.
            ListHeaderComponent={
              <>
              <MobileNativeChatListHeader
                messages={messages}
                agent={agent}
                agentStatus={agentStatus}
                backgroundTaskReport={backgroundTaskReport}
                hostBackgroundTasks={hostBackgroundTasks}
                queuedMessages={queuedMessages}
                onEditQueue={onEditQueue}
                onSendQueueNow={onSendQueueNow}
                agentWorking={agentWorking === true}
                unanchoredTurnStatus={turns.activeTurnIsUnanchored ? turns.active : null}
                turnActivity={turnActivity}
                onOpenBackgroundTasks={() => setBackgroundTasksOpen(true)}
              />
              {/* Inverted list: the header is the visual bottom; the spacer keeps the newest row clear of the dock. */}
              <View style={{ height: dockHeight }} testID="native-chat-dock-spacer" />
              </>
            }
            ListFooterComponent={
              <MobileNativeChatLoadEarlier
                hasMore={hasMore === true}
                loadingEarlier={loadingEarlier === true}
                onLoadEarlier={onLoadEarlier}
                styles={styles}
                colors={colors}
              />
            }
            ListEmptyComponent={
              <MobileNativeChatListEmpty emptyState={emptyState} agent={agent} styles={styles} />
            }
          />
          </ChatTextSelectableContext.Provider>
          <MobileNativeChatJumpToLatest visible={showJumpToLatest} onPress={() => jumpToTail(true)} styles={{ fab: [styles.fab, { bottom: dockHeight + space.md }] }} colors={colors} />
        </GestureHandlerRootView>
      )}
      <MobileBackgroundTasksSheet
        visible={backgroundTasksOpen}
        messages={messages}
        agent={agent}
        agentStatus={agentStatus ?? null}
        backgroundTaskReport={backgroundTaskReport}
        hostBackgroundTasks={hostBackgroundTasks}
        onStopTask={onStopBackgroundTask}
        onClose={() => setBackgroundTasksOpen(false)}
      />
      <MobileNativeChatQueueEditor editor={queueEditor} />
      {rewindSheet}
      <View
        style={[styles.dock, { paddingBottom: bottomPad }]}
        onLayout={onDockLayout}
        testID="native-chat-dock"
        // The dock draws no ground, so the list shows through its empty parts
        // and reads as list; a swipe begun there must scroll the list, not
        // die on the dock. Its controls (the chrome row's buttons, the
        // composer, the cards) still take their own touches (device,
        // 2026-09-20, keyboard open: swipes on the row above the composer
        // did nothing).
        pointerEvents="box-none"
      >
      {/* Inside the dock, not above it: the dock is absolutely positioned at the
          bottom, so a card left in normal flow was painted under it and its
          buttons could not be tapped (a long "Allow Bash?" on 0.5.67). Here its
          height is measured with the dock, which is what the list's spacer
          clears, so the newest rows still sit above it. */}
      <MobileNativeChatPromptCard
        ask={ask} askKey={askKey} onDismissAsk={onDismissAsk}
        onAnswerAsk={onAnswerAsk} onCancelAsk={onCancelAsk} onCancelPrompt={onCancelPrompt}
        {...{ question, onAnswerQuestion }}
        {...{ permission, onRespondPermission, onRespondPermissionWithComment }}
      />
      <MobileNativeChatChromeRow
        agentWorking={agentWorking}
        canStop={canStop ?? agentWorking}
        // The structured lane says "Working for N" per turn; a second, static
        // three-dot row under it would report the same fact twice.
        showWorkingIndicator={!structuredActivityUi}
        onStop={onStop}
        toolsExpanded={toolsExpanded}
        onToggleTools={() => setToolsExpanded((v) => !v)}
        sendErrorMessage={sendErrorMessage}
        styles={styles}
      />
      {keyStrip ? <MobileNativeChatKeyStrip {...keyStrip} /> : null}
      <MobileNativeChatComposerTasks list={composerList} />
      <MobileNativeChatComposer
        value={composerText}
        onChangeText={onComposerTextChange}
        focusRequest={composerFocusRequest}
        onSend={handleSend}
        sendSurfaceId={sendSurfaceId}
        {...{ getSendCompletionGeneration, getComposerEditGeneration }}
        agent={agent}
        sessionOptions={sessionOptions}
        onCaptureImage={onCaptureImage}
        onAttachImage={onAttachImage} onPasteImage={onPasteImage}
        onPasteImageFile={onPasteImageFile}
        onAttachFile={onAttachFile}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        isAttaching={isAttaching}
        onMicPress={onMicPress}
        onBeforeSend={onBeforeSend}
        micActive={micActive} micLevel={micLevel}
        dictationPaint={dictationPaint} onComposerCursor={onComposerCursor}
        contextWindow={contextWindow}
        permissionMode={permissionMode}
        onSelectPermissionMode={onSelectPermissionMode}
        agentMode={agentMode}
        onSelectAgentMode={onSelectAgentMode}
        dictationMode={dictationMode}
        onMicPressIn={onMicPressIn}
        onMicPressOut={onMicPressOut}
        disabled={lockReason !== null}
        placeholder={composerPlaceholder(lockReason, agentWorking)}
        filePaths={filePaths}
        popoverSpace={rootHeight}
        dockHeight={dockHeight}
        onNeedFiles={onNeedFiles}
        skills={skills}
        sessionCommands={sessionCommands}
        conversationCommands={conversationCommands}
        onNeedSkills={onNeedSkills}
      />
      </View>
    </View>
  )
}
