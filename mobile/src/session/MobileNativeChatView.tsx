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
/** Covers the 60 ms and 250 ms pins; rows that grow later re-pin unseen. */
const REVEAL_AFTER_FIRST_PIN_MS = 320
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
  // Why: the transcript paints at the top first and is pinned to the bottom a
  // few frames later, once rows have measured. Showing that first paint reads
  // as the list jumping. Keep the list invisible until the first pin settled,
  // per conversation, so the first frame the user sees is already at the end.
  // Only the window right after the FIRST batch lands is hidden; an empty or
  // still-loading conversation shows its own state so nothing can spin forever.
  const [pinning, setPinning] = useState<{ key: string; done: boolean } | null>(null)
  const pinnedKeyRef = useRef<string | null>(null)

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
      listRef.current?.scrollToEnd({ animated })
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

  // Why the render-time check as well: the effect below starts the hidden
  // window one commit after the first batch renders, which let that first
  // top-anchored paint reach the screen for a frame before the pin.
  const awaitingFirstPin = data.length > 0 && pinnedKeyRef.current !== sendSurfaceId
  const revealed = !awaitingFirstPin && !(pinning?.key === sendSurfaceId && !pinning.done)

  // Follow the tail as the conversation grows and keep the newest message above
  // the keyboard when it opens — but only while following, so we never yank the
  // reader away from history.
  // Not animated: the transcript arrives in a few batches on open, and an
  // animated jump per batch reads as the list stuttering. Sends still animate.
  // Retried: a non-animated scrollToEnd right after a batch lands on the
  // content height measured so far; markdown rows keep growing for a few
  // hundred ms, so re-pin until the layout has settled.
  useEffect(() => {
    if (data.length === 0 || !followingRef.current) {
      return
    }
    const pin = (): void => {
      if (followingRef.current) {
        listRef.current?.scrollToEnd({ animated: false })
      }
    }
    const timers = [60, 250, 600, 1200].map((delay) => setTimeout(pin, delay))
    return () => timers.forEach(clearTimeout)
  }, [data.length, keyboardInset])

  // Start the hidden window once per conversation, on the first batch. No
  // cleanup here: batches keep landing inside the window and must not cancel it.
  useEffect(() => {
    if (data.length === 0 || pinnedKeyRef.current === sendSurfaceId) {
      return
    }
    pinnedKeyRef.current = sendSurfaceId
    setPinning({ key: sendSurfaceId, done: false })
  }, [data.length, sendSurfaceId])
  // The timer belongs to the pinning state itself, so only its own change (done)
  // or unmount can clear it — previously a data change cancelled it and the list
  // stayed hidden behind the spinner for good.
  useEffect(() => {
    if (!pinning || pinning.done) {
      return
    }
    const timer = setTimeout(
      () =>
        setPinning((current) => (current && !current.done ? { ...current, done: true } : current)),
      REVEAL_AFTER_FIRST_PIN_MS
    )
    return () => clearTimeout(timer)
  }, [pinning])

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
        listRef.current?.scrollToEnd({ animated: true })
      }, 60)
      return true
    },
    [onSend, onClearSendError, setFollowing]
  )

  const evaluateEdge = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      if (!scrollingRef.current && distanceFromBottom < LIVE_EDGE_THRESHOLD_PX) {
        setFollowing(true)
      }
      // Near the top — page in older history.
      if (contentOffset.y < 60 && hasMore && !loadingEarlier) {
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
      listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
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
      {!showLoading && !revealed ? (
        <View pointerEvents="none" style={styles.revealOverlay}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : null}
      {showLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : (
        <GestureHandlerRootView style={[styles.listWrap, !revealed && styles.listHidden]}>
          <GestureDetector gesture={pinchGesture}>
            <FlatList
              ref={listRef}
              data={data}
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
              // fold (older pages, re-flowed tool rows) must not shift what they
              // are looking at.
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onContentSizeChange={() => {
                if (data.length > 0 && followingRef.current) {
                  listRef.current?.scrollToEnd({ animated: false })
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
                    viewPosition: 0,
                    animated: true
                  })
                }, 120)
              }}
              ListHeaderComponent={
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
      <MobileNativeChatQueue messages={queuedMessages} />
      <MobileNativeChatPromptCard
        ask={ask}
        askKey={askKey}
        onDismissAsk={onDismissAsk}
        onAnswerAsk={onAnswerAsk}
        onCancelAsk={onCancelAsk}
        question={question}
        onAnswerQuestion={onAnswerQuestion}
        permission={permission}
        onRespondPermission={onRespondPermission}
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
