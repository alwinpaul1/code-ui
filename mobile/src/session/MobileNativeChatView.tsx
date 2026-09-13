import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { MobileNativeChatQueueEditor } from './MobileNativeChatQueueEditor'
import { useMobileChatFollowing } from './use-mobile-chat-following'
import { useCallback, useMemo, useRef, useState } from 'react'
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
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { MobileNativeChatKeyStrip } from './MobileNativeChatKeyStrip'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { useMobileChatScrollHandlers } from './use-mobile-chat-scroll-handlers'
import { useChatScrollView } from './use-mobile-chat-scroll-view'
import { ChatTextSelectableContext } from '../components/chat-text-selectable-context'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { interimAssistantMessageIds } from './mobile-native-chat-interim'
import { chatTimeDividerLabels } from './mobile-native-chat-time-dividers'
import { useNow } from '../hooks/use-now'
import { MobileNativeChatTimeDivider } from './MobileNativeChatTimeDivider'
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
  queueEditor,
  pending,
  imagePreviewsByMessageId,
  composerText,
  onComposerTextChange,
  onAttachImage,
  onAttachFile,
  attachments,
  onRemoveAttachment,
  isAttaching,
  onMicPress,
  onBeforeSend,
  micActive,
  micLevel,
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
  question,
  onAnswerQuestion,
  permission,
  onRespondPermission,
  onCancelQueued,
  onOpenFile,
  keyboardInset = 0,
  keyStrip
}: MobileNativeChatViewProps): React.JSX.Element {
  const { colors, space } = useTheme()
  const styles = useChatViewStyles()
  const insets = useSafeAreaInsets()
  const drawDistance = chatListDrawDistanceDp(useWindowDimensions().height)
  const listRef = useRef<FlashListRef<NativeChatMessage>>(null)
  const jumpingRef = useRef(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [backgroundTasksOpen, setBackgroundTasksOpen] = useState(false)
  const { dockHeight, onDockLayout } = useChatDock(listRef, () => followingRef.current)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom

  // Following is a ref: onContentSizeChange runs before React commits `atBottom`,
  // and a state flag yanked the list back down mid-read (#11638).
  const {
    followingRef,
    scrollingRef,
    holdingRef,
    touchStart,
    touchEnd,
    followGate,
    textSelectable,
    showJumpToLatest,
    setFollowing,
    beginScroll,
    endScroll
  } = useMobileChatFollowing()

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
  followGate.noteData(newestFirst)
  const { predecessors: taskListPredecessors, composerList } = useMobileNativeChatTaskProgress(data)

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

  const { evaluateEdge, onEndReached, onScrollBeginDrag, onScrollEnd, jumpToLatest, onScrollToMessage } =
    useMobileChatScrollHandlers({
    listRef,
    followingRef,
    scrollingRef,
    jumpingRef,
    hasMore,
    loadingEarlier,
    onLoadEarlier,
    setFollowing,
    beginScroll,
    endScroll
  })

  // Per-turn "Thinking / Working for N / Worked for N" rows. The structured lane
  // owns them; the bridge lane keeps its three-dot indicator.
  const turns = useMobileNativeChatTurnDisclosure({
    messages: data,
    enabled: structuredActivityUi,
    isWorking: agentWorking === true,
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
        onCancelQueued={
          agentWorking && onCancelQueued && item.id.startsWith('pending-')
            ? () => void onCancelQueued(item.id)
            : undefined
        }
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
      agentWorking,
      onCancelQueued,
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
    <View style={styles.root}>
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
            onScrollEndDrag={onScrollEnd}
            onMomentumScrollBegin={() => {
              // A requested jump also emits momentum events. Enabling history
              // anchoring during that animation interrupts it before the end.
              if (!jumpingRef.current) {
                beginScroll()
              }
            }}
            onMomentumScrollEnd={(event) => {
              jumpingRef.current = false
              onScrollEnd(event)
            }}
            scrollEventThrottle={16}
            // Why: while the reader is up in history, content growing above the
            // fold must not shift what they are reading. At the live edge,
            // native anchoring fights scrollToEnd and briefly shows old rows.
            maintainVisibleContentPosition={contentPosition}
            onContentSizeChange={() => {
              if (data.length > 0 && followGate.shouldFollow(followingRef.current, holdingRef.current)) {
                listRef.current?.scrollToOffset({ offset: 0, animated: false })
              }
            }}
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
          <MobileNativeChatJumpToLatest visible={showJumpToLatest} onPress={() => jumpToLatest(true)} styles={{ fab: [styles.fab, { bottom: dockHeight + space.md }] }} colors={colors} />
        </GestureHandlerRootView>
      )}
      <MobileBackgroundTasksSheet
        visible={backgroundTasksOpen}
        messages={messages}
        agentStatus={agentStatus ?? null}
        backgroundTaskReport={backgroundTaskReport}
        hostBackgroundTasks={hostBackgroundTasks}
        onStopTask={onStopBackgroundTask}
        onClose={() => setBackgroundTasksOpen(false)}
      />
      <MobileNativeChatQueueEditor editor={queueEditor} />
      <MobileNativeChatPromptCard
        ask={ask}
        askKey={askKey}
        onDismissAsk={onDismissAsk}
        onAnswerAsk={onAnswerAsk}
        onCancelAsk={onCancelAsk}
        {...{ question, onAnswerQuestion }}
        {...{ permission, onRespondPermission }}
      />
      <View
        style={[styles.dock, { paddingBottom: bottomPad }]}
        onLayout={onDockLayout}
        testID="native-chat-dock"
      >
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
        onSend={handleSend}
        sendSurfaceId={sendSurfaceId}
        {...{ getSendCompletionGeneration, getComposerEditGeneration }}
        agent={agent}
        sessionOptions={sessionOptions}
        onAttachImage={onAttachImage}
        onAttachFile={onAttachFile}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        isAttaching={isAttaching}
        onMicPress={onMicPress}
        onBeforeSend={onBeforeSend}
        micActive={micActive}
        micLevel={micLevel}
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
        onNeedFiles={onNeedFiles}
        skills={skills}
        sessionCommands={sessionCommands}
        conversationCommands={conversationCommands}
        onNeedSkills={onNeedSkills}
      />
      </View>
      <ImagePreviewModal />
    </View>
  )
}
