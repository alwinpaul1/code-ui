import { Animated, View, Text, ActivityIndicator } from 'react-native'
import { saveTerminalTextScale } from '../storage/preferences'
import { MobileBrowserPane } from '../browser/MobileBrowserPane'
import { TerminalPaneView } from './TerminalPaneView'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import { styles } from './mobile-session-styles'
import type { MobileSessionController } from './use-mobile-session-controller'
import { FileReader } from './MobileSessionFileReader'
import { MarkdownReader } from './MobileSessionMarkdownReader'

export function MobileSessionActiveContent({
  controller
}: {
  controller: MobileSessionController
}) {
  const { colors, space } = useTheme()
  const centered = {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: space.xl,
    gap: space.md,
    backgroundColor: colors.bg
  }
  const {
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
    visibleBuiltInAccessoryKeys,
    customKeys,
    canSend,
    handleAccessoryKey,
    startAccessoryRepeat,
    stopAccessoryRepeat,
    didAccessoryRepeatFire,
    dictation,
    handleDictationToggle,
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
        onOpenFile={handleNativeChatFileTap}
        images={nativeChatImages}
        onMicPress={handleDictationToggle}
        micActive={dictation.isRecording}
        dictationMode={dictationMode}
        onMicPressIn={handleDictationPressIn}
        onMicPressOut={handleDictationPressOut}
        inputLockReason={nativeChatOverlayInputLockReason}
        sendErrorMessage={nativeChatSendError.message}
        onClearSendError={nativeChatSendError.clear}
        sendSurfaceId={controller.nativeChatScopeKey ?? ''}
        getSendCompletionGeneration={controller.getSendCompletionGeneration}
        keyboardInset={keyboardLift}
        keyStrip={{
          keys: visibleBuiltInAccessoryKeys,
          customKeys,
          enabled: canSend,
          onKey: (input) => void handleAccessoryKey(input),
          onRepeatStart: startAccessoryRepeat,
          onRepeatStop: stopAccessoryRepeat,
          didRepeatFire: didAccessoryRepeatFire
        }}
      />
      {toastMessage && (
        <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  )
}
