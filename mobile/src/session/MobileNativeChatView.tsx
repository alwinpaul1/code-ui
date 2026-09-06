import { useMobileChatFollowing } from './use-mobile-chat-following'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { ArrowDown } from 'lucide-react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { useChatViewStyles } from './mobile-native-chat-view-styles'
import {
  buildMobileNativeChatTransientData,
  mobileNativeChatEmptyState
} from './mobile-native-chat-render-data'
import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { ImagePreviewModal } from '../components/ImagePreviewModal'
import { MobileNativeChatKeyStrip } from './MobileNativeChatKeyStrip'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatChromeRow } from './MobileNativeChatChromeRow'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'

const INPUT_LOCK_SETTLE_MS = 600
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
  const listRef = useRef<FlatList<NativeChatMessage>>(null)
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom

  // ─── Reader-aware following (#11638) ───
  // Why a ref and not state: `onContentSizeChange` fires on every streaming
  // tick, before React has re-rendered with a fresh `atBottom`. A state flag
  // lagged one frame behind the user's scroll and the list yanked back down
  // mid-read. The ref is read synchronously by every autoscroll site, and the
  // moment the user drags we stop following until they return to the edge.
  const { followingRef, scrollingRef, showJumpToLatest, setFollowing, beginScroll, endScroll } =
    useMobileChatFollowing()

  const sendScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { fontScale, pinchGesture } = useMobileNativeChatPinchGesture()
  useEffect(
    () => () => {
      if (sendScrollTimerRef.current) {
        clearTimeout(sendScrollTimerRef.current)
      }
    },
    []
  )

  const jumpToLatest = useCallback(
    (animated: boolean) => {
      setFollowing(true)
      listRef.current?.scrollToOffset({ offset: 0, animated })
    },
    [setFollowing]
  )

  // `data` is the list source: folded transcript + synthetic streaming bubble +
  // route-owned accepted echoes. Memoize on the same deps so the
  // downstream autoscroll effects/`renderItem` keep referential stability.
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
  // Inversion keeps the live edge at offset zero. Estimated spacing for
  // unmeasured history can then change without shifting the visible tail.
  const newestFirst = useMemo(() => data.toReversed(), [data])

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      const accepted = await onSend(text)
      if (!accepted) {
        return false
      }
      // The route-owned banner outlives this send; a success must retire it too,
      // or a stale "Message not sent" sits above the delivered message.
      onClearSendError?.()
      // Always jump to the newest message when the user sends.
      setFollowing(true)
      if (sendScrollTimerRef.current) {
        clearTimeout(sendScrollTimerRef.current)
      }
      sendScrollTimerRef.current = setTimeout(() => {
        sendScrollTimerRef.current = null
        listRef.current?.scrollToOffset({ offset: 0, animated: true })
      }, 60)
      return true
    },
    [onSend, onClearSendError, setFollowing]
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
    beginScroll()
    if (sendScrollTimerRef.current) {
      clearTimeout(sendScrollTimerRef.current)
      sendScrollTimerRef.current = null
    }
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
      />
    ),
    [toolsExpanded, fontScale, onScrollToMessage, onOpenFile, agentWorking, onCancelQueued]
  )

  const emptyState = mobileNativeChatEmptyState(status, agent ?? null, error)
  const showLoading = status === 'loading' && messages.length === 0

  // A dead PTY emits subscribed→end; settle both edges so its false lease cannot flash the composer enabled.
  const rawLockReason = inputLockReason ?? null
  const rawLockHeld = rawLockReason !== null
  const [lockHeld, setLockHeld] = useState(false)
  useEffect(() => {
    if (rawLockHeld === lockHeld) {
      return
    }
    const timer = setTimeout(() => setLockHeld(rawLockHeld), INPUT_LOCK_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [lockHeld, rawLockHeld])
  const lockReason = lockHeld ? (rawLockReason ?? 'waiting') : null

  return (
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      {showLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <GestureHandlerRootView style={styles.listWrap}>
          <GestureDetector gesture={pinchGesture}>
            <FlatList
              ref={listRef}
              data={newestFirst}
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
              onMomentumScrollBegin={onScrollBeginDrag}
              onMomentumScrollEnd={onScrollEnd}
              scrollEventThrottle={16}
              // Why: while the reader is up in history, content growing above the
              // fold must not shift what they are reading. At the live edge,
              // native anchoring fights scrollToEnd and briefly shows old rows.
              maintainVisibleContentPosition={
                showJumpToLatest ? { minIndexForVisible: 0 } : undefined
              }
              onContentSizeChange={() => {
                if (data.length > 0 && followingRef.current) {
                  listRef.current?.scrollToOffset({ offset: 0, animated: false })
                }
              }}
              // scrollToIndex can fail before an off-screen row is measured —
              // fall back to an estimated offset, then retry once it's laid out.
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true
                })
                setTimeout(() => {
                  listRef.current?.scrollToIndex({
                    index: info.index,
                    viewPosition: 1,
                    animated: true
                  })
                }, 120)
              }}
              ListFooterComponent={
                hasMore ? (
                  <Pressable
                    style={styles.loadEarlier}
                    onPress={onLoadEarlier}
                    disabled={loadingEarlier}
                  >
                    {loadingEarlier ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <Txt variant="caption" weight="semibold" tone="muted">
                        Load earlier messages
                      </Txt>
                    )}
                  </Pressable>
                ) : null
              }
              ListEmptyComponent={
                emptyState ? (
                  <View style={styles.center}>
                    {agent ? <MobileAgentIcon agentId={agent} size={40} /> : null}
                    <Txt variant="heading" weight="semibold" align="center">
                      {emptyState.title}
                    </Txt>
                    <Txt variant="body" tone="muted" align="center">
                      {emptyState.subtitle}
                    </Txt>
                  </View>
                ) : null
              }
            />
          </GestureDetector>
          {showJumpToLatest ? (
            <Pressable
              accessibilityLabel="Scroll to latest"
              style={styles.fab}
              onPress={() => jumpToLatest(true)}
            >
              <ArrowDown size={18} color={colors.text} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </GestureHandlerRootView>
      )}
        <MobileNativeChatQueue messages={queuedMessages} agent={agent} onEdit={onEditQueue} />
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
        onStop={onStop}
        toolsExpanded={toolsExpanded}
        onToggleTools={() => setToolsExpanded((v) => !v)}
        sendErrorMessage={sendErrorMessage}
        styles={styles}
      />
      {keyStrip ? <MobileNativeChatKeyStrip {...keyStrip} /> : null}
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
        onNeedSkills={onNeedSkills}
      />
      <ImagePreviewModal />
    </View>
  )
}
