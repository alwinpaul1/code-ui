import { useTerminalEngine } from '../terminal/use-terminal-engine'
import { useMemo, useRef } from 'react'
import { stepTerminalMode } from './terminal-mode-stepper'
import { Animated, View, Text, ActivityIndicator } from 'react-native'
import { saveTerminalTextScale } from '../storage/preferences'
import { MobileBrowserPane } from '../browser/MobileBrowserPane'
import { TerminalPaneView } from './TerminalPaneView'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { MobileSubagentTranscriptModal } from './MobileSubagentTranscriptModal'
import { useHostMobileCapability } from '../transport/host-mobile-capabilities'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { styles } from './mobile-session-styles'
import type { MobileSessionController } from './use-mobile-session-controller'
import { FileReader } from './MobileSessionFileReader'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import { TERMINAL_ACCESSORY_KEY_DEFINITIONS } from '../terminal/terminal-key-definitions'
import { createTerminalLiveAccessoryInput } from '../terminal/terminal-live-accessory-input'
import type { TerminalAgentMode, TerminalPermissionMode } from './mobile-terminal-hud-parse'
import { readingPositionKey } from '../storage/reading-positions'
import { createMarkdownImageResolver } from '../files/markdown-image-resolver'

export function MobileSessionActiveContent({
  controller
}: {
  controller: MobileSessionController
}) {
  const terminalEngine = useTerminalEngine()
  const { colors, space } = useTheme()
  // The host's mobile-scope RPC gate, probed once per connection: "Rewind to
  // here" is offered only on a host that lets a phone call agentSession.rewind.
  const hostAllowsRewind = useHostMobileCapability(controller.hostId, 'agentSession.rewind')
  const centered = {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: space.xl,
    gap: space.md,
    backgroundColor: colors.bg
  }
  const {
    hostId,
    worktreeId,
    insets,
    connState,
    client,
    terminals,
    terminalTextScale,
    setTerminalTextScale,
    activeHandle,
    markdownDocs,
    fileDocs,
    diffComments,
    diffCommentBusy,
    createError,
    setCreateError,
    setShowCreateTabDrawer,
    dictationMode,
    toastMessage,
    terminalFrameHeightRef,
    setTerminalFrameWidth,
    handleTerminalTap,
    browserScreencastSupported,
    showToast,
    nativeChatSendError,
    nativeChatOverlayInputLockReason,
    nativeChatController,
    handleAccessoryKey,
    dictation,
    handleDictationToggle,
    finishDictationForSend,
    handleDictationPressIn,
    handleDictationPressOut,
    readMarkdownTab,
    addDiffCommentForFile,
    deleteDiffCommentForFile,
    copyDiffCommentsToClipboard,
    sendDiffCommentsToAgent,
    updateMarkdownLocalContent,
    copyMarkdownLocalContent,
    discardMarkdownLocalContent,
    saveMarkdownTab,
    notifyTerminalFrameHeight,
    setTerminalWebViewRef,
    handleTerminalWebReady,
    handleFileTap,
    handleNativeChatFileTap,
    askAboutFileLines,
    handleNativeChatRevertHunk,
    handleTerminalOpenUrl,
    handleTerminalInput,
    handleTerminalQueryReply,
    handleSelectionMode,
    handleSelectionCopy,
    handleSelectionEvicted,
    handleModesChanged,
    handleKeyboardAvoidanceMetrics,
    handleHaptic,
    nativeChatImages,
    activeMarkdownTab,
    activeFileTab,
    activeBrowserTab,
    activePendingTerminalTab,
    isPendingTerminalRecoveryParked,
    retryPendingTerminalRecovery,
    showLoadingState,
    showEmptyState,
    keyboardLift,
    activeTerminalKeyboardLift,
    toastAnimatedStyle,
    createTabBusy
  } = controller

  // Images a document names, read off the host for the .md tab and the file
  // tab's rendered view; one resolver per document, so a figure fetches once.
  const documentPath = activeMarkdownTab?.relativePath ?? activeFileTab?.relativePath ?? null
  const resolveImage = useMemo(
    () =>
      documentPath
        ? createMarkdownImageResolver({ client, worktreeId, documentRelativePath: documentPath })
        : undefined,
    [client, documentPath, worktreeId]
  )
  // Claude Code only cycles modes (Shift+Tab), and which modes are in the cycle
  // depends on how the session was started; Codex has two collaboration modes
  // on the same key. Press, wait for the footer to move, judge, repeat — and
  // give up after a lap and say so. See terminal-mode-stepper.ts for why a
  // fixed sleep between presses was not enough.
  // Render-synced, so a stepper started on one tab can tell it no longer owns
  // the screen after the user switches away.
  const liveHandleRef = useRef(activeHandle)
  liveHandleRef.current = activeHandle
  const shiftTab = TERMINAL_ACCESSORY_KEY_DEFINITIONS.find((key) => key.id === 'shiftTab')
  const pressShiftTab = async () => {
    if (shiftTab) {
      await handleAccessoryKey(createTerminalLiveAccessoryInput(shiftTab))
    }
  }
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const selectAgentMode = async (target: TerminalAgentMode) => {
    const startedOn = liveHandleRef.current
    const reached = await stepTerminalMode<TerminalAgentMode>({
      read: async () => (await nativeChatController.refreshNativeChatHud())?.agentMode ?? null,
      press: pressShiftTab,
      wait,
      wanted: target,
      maxPresses: 4,
      stillOurs: () => liveHandleRef.current === startedOn
    })
    if (!reached) {
      showToast('That mode is not available in this session')
    }
  }
  const selectPermissionMode = async (target: TerminalPermissionMode) => {
    const startedOn = liveHandleRef.current
    // 'default' and 'manual' are two names for one mode. Read the mode the
    // footer STATED: `permissionMode` collapses "no footer on screen" to
    // 'default', which reads as Manual, so a blank mid-repaint frame made the
    // stepper report success having pressed nothing (2026-09-14).
    const asShown = (mode: TerminalPermissionMode | null | undefined) =>
      mode == null ? null : mode === 'default' ? 'manual' : mode
    const reached = await stepTerminalMode<TerminalPermissionMode>({
      read: async () =>
        asShown((await nativeChatController.refreshNativeChatHud())?.permissionModeSeen),
      press: pressShiftTab,
      wait,
      wanted: asShown(target) as TerminalPermissionMode,
      maxPresses: 6,
      stillOurs: () => liveHandleRef.current === startedOn
    })
    if (!reached) {
      showToast('That mode is not available in this session')
    }
  }

  return showLoadingState ? (
    <View style={centered}>
      <ActivityIndicator size="small" color={colors.textSecondary} />
    </View>
  ) : showEmptyState ? (
    <View style={centered}>
      <Txt variant="heading" weight="semibold" align="center">
        Nothing open yet
      </Txt>
      <Txt variant="body" tone="secondary" align="center">
        Start an agent or open a terminal in this workspace.
      </Txt>
      {createError ? (
        <Txt variant="label" tone="danger" align="center">
          {createError}
        </Txt>
      ) : null}
      <Button
        label={createTabBusy ? 'Creating…' : 'New tab'}
        variant="accent"
        align="center"
        disabled={createTabBusy || connState !== 'connected'}
        loading={createTabBusy}
        onPress={() => {
          setCreateError('')
          setShowCreateTabDrawer(true)
        }}
      />
    </View>
  ) : activeMarkdownTab ? (
    <View style={styles.markdownFrame}>
      <MarkdownReader
        documentId={activeMarkdownTab.id}
        doc={markdownDocs.get(activeMarkdownTab.id)}
        readingPositionKey={readingPositionKey(hostId, worktreeId, activeMarkdownTab.relativePath)}
        resolveImage={resolveImage}
        onRefresh={() => void readMarkdownTab(activeMarkdownTab)}
        onChange={(content) => updateMarkdownLocalContent(activeMarkdownTab.id, content)}
        onSave={() => void saveMarkdownTab(activeMarkdownTab)}
        onCopy={() => void copyMarkdownLocalContent(activeMarkdownTab.id)}
        onDiscard={() => discardMarkdownLocalContent(activeMarkdownTab)}
        keyboardLift={keyboardLift}
      />
      {toastMessage && (
        <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  ) : activeFileTab ? (
    <View style={styles.markdownFrame}>
      <FileReader
        doc={fileDocs.get(activeFileTab.id)}
        title={activeFileTab.title || 'File'}
        relativePath={activeFileTab.relativePath}
        language={activeFileTab.language}
        readingPositionKey={readingPositionKey(hostId, worktreeId, activeFileTab.relativePath)}
        resolveImage={resolveImage}
        onAskAboutLines={(range) => askAboutFileLines(activeFileTab.relativePath, range)}
        diffCommentActions={
          activeFileTab.diffSource === 'staged' || activeFileTab.diffSource === 'unstaged'
            ? {
                comments: diffComments,
                busy: diffCommentBusy,
                onAdd: addDiffCommentForFile,
                onDelete: deleteDiffCommentForFile,
                onCopyAll: copyDiffCommentsToClipboard,
                onSendAll: sendDiffCommentsToAgent
              }
            : undefined
        }
      />
      {toastMessage && (
        <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  ) : activeBrowserTab ? (
    <View style={styles.browserFrame}>
      {/* Why: pane owns imperative frame refs; don't render a stale frame while the old stream effect cleans up. */}
      <MobileBrowserPane
        key={activeBrowserTab.browserPageId ?? activeBrowserTab.id}
        client={client}
        worktreeId={worktreeId}
        tab={activeBrowserTab}
        screencastSupported={browserScreencastSupported}
        keyboardLift={keyboardLift}
        bottomInset={insets.bottom}
        onToast={showToast}
      />
      {toastMessage && (
        <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  ) : activePendingTerminalTab ? (
    <View style={centered}>
      {!isPendingTerminalRecoveryParked && (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      )}
      <Txt variant="body" tone="secondary" align="center">
        {isPendingTerminalRecoveryParked
          ? 'Terminal is taking longer than expected'
          : activePendingTerminalTab.title || 'Loading terminal'}
      </Txt>
      {isPendingTerminalRecoveryParked && (
        <Button
          label="Retry"
          variant="secondary"
          align="center"
          accessibilityLabel="Retry loading terminal"
          onPress={() => void retryPendingTerminalRecovery()}
        />
      )}
    </View>
  ) : (
    <View
      style={styles.terminalFrame}
      onLayout={(e) => {
        terminalFrameHeightRef.current = e.nativeEvent.layout.height
        // Why: notify height imperatively so dock settling re-fits the PTY without rerendering SessionScreen.
        const nextWidth = Math.round(e.nativeEvent.layout.width)
        const nextHeight = Math.round(e.nativeEvent.layout.height)
        setTerminalFrameWidth((prev) => (prev === nextWidth ? prev : nextWidth))
        notifyTerminalFrameHeight(nextHeight)
      }}
    >
      {terminals.map((terminal) => (
        <TerminalPaneView
          key={terminal.handle}
          engine={terminalEngine}
          handle={terminal.handle}
          active={terminal.handle === activeHandle}
          keyboardLift={terminal.handle === activeHandle ? activeTerminalKeyboardLift : 0}
          terminalTheme={terminal.terminalTheme}
          textScale={terminalTextScale}
          onTextScaleChange={(scale) => {
            // Why: pinch-to-zoom reports a new preset; persist it so the size sticks across panes and launches.
            setTerminalTextScale(scale)
            void saveTerminalTextScale(scale)
          }}
          onRef={setTerminalWebViewRef}
          onWebReady={handleTerminalWebReady}
          onSelectionMode={handleSelectionMode}
          onSelectionCopy={handleSelectionCopy}
          onSelectionEvicted={handleSelectionEvicted}
          onModesChanged={handleModesChanged}
          onKeyboardAvoidanceMetrics={handleKeyboardAvoidanceMetrics}
          onHaptic={handleHaptic}
          onTerminalInput={handleTerminalInput}
          onTerminalQueryReply={handleTerminalQueryReply}
          onTerminalTap={handleTerminalTap}
          onFileTap={handleFileTap}
          onOpenUrl={handleTerminalOpenUrl}
        />
      ))}
      <MobileNativeChatOverlay
        controller={nativeChatController}
        hasTerminalUnderneath={terminals.some((terminal) => terminal.handle === activeHandle)}
        onOpenFile={handleNativeChatFileTap}
        onRevertHunk={handleNativeChatRevertHunk}
        hostAllowsRewind={hostAllowsRewind}
        images={nativeChatImages}
        onMicPress={handleDictationToggle}
        onBeforeSend={finishDictationForSend}
        micActive={dictation.isRecording}
        micLevel={(dictation as { level?: number }).level ?? 0}
        dictationMode={dictationMode}
        onMicPressIn={handleDictationPressIn}
        onMicPressOut={handleDictationPressOut}
        inputLockReason={nativeChatOverlayInputLockReason}
        sendErrorMessage={nativeChatSendError.message}
        onClearSendError={nativeChatSendError.clear}
        sendSurfaceId={controller.nativeChatScopeKey ?? ''}
        getSendCompletionGeneration={controller.getSendCompletionGeneration}
        keyboardInset={keyboardLift}
        onSelectPermissionMode={(mode) => void selectPermissionMode(mode)}
        onSelectAgentMode={(mode) => void selectAgentMode(mode)}
      />
      {/* Opened from a subagent row in the background-tasks sheet, through its
          store; mounted here because this is the screen that knows the host. */}
      <MobileSubagentTranscriptModal hostId={hostId} worktreeId={worktreeId} />
      {toastMessage && (
        <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  )
}
