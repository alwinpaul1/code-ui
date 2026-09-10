import { FlashList, type FlashListRef } from '@shopify/flash-list'
import { MobileNativeChatQueueEditor } from './MobileNativeChatQueueEditor'
import { useMobileChatFollowing } from './use-mobile-chat-following'
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
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
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'
import { useMobileNativeChatInputLock } from './use-mobile-native-chat-input-lock'
import {
  MobileNativeChatJumpToLatest,
  MobileNativeChatListEmpty,
  MobileNativeChatLoadEarlier
} from './mobile-native-chat-list-edges'

/** Within this many px of the bottom the list is "at the live edge". */
const LIVE_EDGE_THRESHOLD_PX = 48

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
  const { colors } = useTheme()
  const styles = useChatViewStyles()
  const insets = useSafeAreaInsets()
  const drawDistance = chatListDrawDistanceDp(useWindowDimensions().height)
  const listRef = useRef<FlashListRef<NativeChatMessage>>(null)
  const jumpingRef = useRef(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [backgroundTasksOpen, setBackgroundTasksOpen] = useState(false)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom

  // Following is a ref: onContentSizeChange runs before React commits `atBottom`,
  // and a state flag yanked the list back down mid-read (#11638).
  const { followingRef, scrollingRef, showJumpToLatest, setFollowing, beginScroll, endScroll } =
    useMobileChatFollowing()

  const { fontScale, pinchGesture } = useMobileNativeChatPinchGesture()
  // FlashList has an outer measurement view. Native scroll recognition must
  // attach to its actual ScrollView, not that wrapper, or dragging is blocked.
  const ChatScrollView = useMemo(
    () =>
      forwardRef<ScrollView, ScrollViewProps>(function ChatScrollView(props, ref) {
        return (
          <GestureDetector gesture={pinchGesture}>
            <ScrollView {...props} ref={ref} />
          </GestureDetector>
        )
      }),
    [pinchGesture]
  )

  const jumpToLatest = useCallback(
    (animated: boolean) => {
      jumpingRef.current = true
      setFollowing(true)
      listRef.current?.scrollToOffset({ offset: 0, animated })
    },
    [setFollowing]
  )

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

  const evaluateEdge = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const distanceFromHistoryStart =
        contentSize.height - (contentOffset.y + layoutMeasurement.height)
      if (!scrollingRef.current && contentOffset.y < LIVE_EDGE_THRESHOLD_PX) {
        setFollowing(true)
      }
      // Near the top — page in older history.
      if (!followingRef.current && distanceFromHistoryStart < 60 && hasMore && !loadingEarlier) {
        onLoadEarlier?.()
      }
    },
    [hasMore, loadingEarlier, onLoadEarlier, setFollowing]
  )

  // The reader took control: stop following immediately, on the same frame as
  // the drag, not after the next scroll sample lands.
  const onScrollBeginDrag = useCallback(() => {
    jumpingRef.current = false
    beginScroll()
  }, [beginScroll])

  const onScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      endScroll()
      evaluateEdge(event)
    },
    [evaluateEdge, endScroll]
  )

  // Align a single message's top to the top of the viewport.
  const onScrollToMessage = useCallback(
    (index: number) => {
      setFollowing(false)
      listRef.current?.scrollToIndex({ index, viewPosition: 1, animated: true })
    },
    [setFollowing]
  )

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

  const renderItem = useCallback(
    ({ item, index }: { item: NativeChatMessage; index: number }) => (
      <MobileNativeChatMessage
        message={item}
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
    ),
    [
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
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      {showLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <GestureHandlerRootView style={styles.listWrap}>
          <FlashList
            ref={listRef}
            renderScrollComponent={ChatScrollView}
            data={newestFirst}
            // Why: FlashList is a PureComponent, so its header keeps whatever
            // it last rendered unless `data` or this marker changes. The
            // running-tasks row, the queue and the turn status all live outside
            // `data`, and the row went stale while the sheet stayed correct.
            extraData={headerExtraData}
            inverted
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            // Let link/file taps land while the composer keyboard is up
            // instead of being swallowed by the dismiss gesture.
            keyboardShouldPersistTaps="handled"
            onScroll={evaluateEdge}
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
              if (data.length > 0 && followingRef.current) {
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
          <MobileNativeChatJumpToLatest
            visible={showJumpToLatest}
            onPress={() => jumpToLatest(true)}
            styles={styles}
            colors={colors}
          />
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
        placeholder={
          lockReason === 'disconnected'
            ? 'Reconnecting…'
            : lockReason === 'waiting'
              ? 'Waiting for terminal…'
              : 'Reply, @files, /commands'
        }
        filePaths={filePaths}
        onNeedFiles={onNeedFiles}
        skills={skills}
        sessionCommands={sessionCommands}
        conversationCommands={conversationCommands}
        onNeedSkills={onNeedSkills}
      />
      <ImagePreviewModal />
    </View>
  )
}
