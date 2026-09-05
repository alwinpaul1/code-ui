import { useEffect, useState } from 'react'
import { View, TextInput, Pressable, Platform } from 'react-native'
import { ArrowUp, MessageSquare } from 'lucide-react-native'
import {
  getTerminalCommandKeyboardType,
  getTerminalLiveInputKeyboardType
} from '../terminal/terminal-keyboard-type'
import { MobileSessionAccessoryStrip } from './MobileSessionAccessoryStrip'
import { getMobileTerminalLiveInputPlaceholder } from './mobile-terminal-live-input-placeholder'
import { MobileTerminalInputActions } from './MobileTerminalInputActions'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import type { MobileSessionController } from './use-mobile-session-controller'

export function MobileSessionCommandDock({ controller }: { controller: MobileSessionController }) {
  const { colors, fonts, radius, space, type } = useTheme()
  const {
    insets,
    bufferedTerminalDraftState,
    autocompleteEnabled,
    liveInputCapture,
    dictationMode,
    liveInputRef,
    commandInputRef,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    getLiveInteractionGeneration,
    getSendCompletionGeneration,
    dismissKeyboardAfterAgentSend,
    activeSessionTab,
    canSend,
    canCompose,
    liveInputEnabled,
    showNativeChat,
    dictation,
    cancelDictation,
    handleDictationToggle,
    handleDictationPressIn,
    handleDictationPressOut,
    handleSend,
    isAttaching,
    attachImage,
    activeMarkdownTab,
    activeFileTab,
    activeBrowserTab,
    keyboardLift,
    nativeChatController
  } = controller
  const { terminalPeekActive, endTerminalPeek, viewResolved } = nativeChatController
  // Tracks the live field's focus so the bar can highlight while the keyboard is open.
  const [liveFocused, setLiveFocused] = useState(false)
  useEffect(() => {
    if (!liveInputEnabled) {
      setLiveFocused(false)
    }
  }, [liveInputEnabled])
  // Why: until the stored view is known this would be the terminal dock under a
  // tab that is about to open as chat — the flash the user sees as a glitch.
  if (activeMarkdownTab || activeFileTab || activeBrowserTab || showNativeChat || !viewResolved) {
    return null
  }

  return (
    <View
      style={{
        zIndex: 20,
        backgroundColor: colors.bgPanel,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom,
        transform: [{ translateY: -keyboardLift }]
      }}
    >
      {terminalPeekActive ? (
        // A chat tab showing its terminal for a slash command's TUI output.
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: space.md,
            paddingTop: space.xs + 2
          }}
        >
          <Pressable
            onPress={endTerminalPeek}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              height: 30,
              paddingHorizontal: space.sm + 2,
              borderRadius: radius.sm,
              backgroundColor: pressed ? colors.borderStrong : colors.accentSoft
            })}
          >
            <MessageSquare size={14} color={colors.accent} strokeWidth={2} />
            <Txt variant="caption" weight="semibold" tone="accent">
              Back to chat
            </Txt>
          </Pressable>
        </View>
      ) : null}
      <MobileSessionAccessoryStrip controller={controller} />

      {/* Input bar */}
      {liveInputEnabled ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 50,
            paddingVertical: space.xs + 2,
            paddingHorizontal: space.md,
            gap: space.xs
          }}
        >
          {/* Why: the capture field is the visible bar itself, so typed text shows
              here instantly while each keystroke streams to the PTY; the terminal
              echo arrives one relay round trip later. Enter clears the field. */}
          <TextInput
            ref={liveInputRef}
            style={{
              flex: 1,
              height: 38,
              backgroundColor: colors.bgRaised,
              color: colors.text,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: liveFocused ? colors.accent : colors.border,
              paddingHorizontal: space.md,
              paddingVertical: 0,
              fontSize: type.body.size - 1,
              fontFamily: fonts.mono,
              opacity: canSend ? 1 : 0.45
            }}
            value={liveInputCapture}
            onFocus={() => setLiveFocused(true)}
            onBlur={() => setLiveFocused(false)}
            onChange={handleLiveInputChange}
            onKeyPress={handleLiveInputKeyPress}
            onSubmitEditing={() => {
              const submit = handleLiveInputSubmit()
              const sendOrigin = {
                tab: activeSessionTab,
                generation: getSendCompletionGeneration(),
                interaction: getLiveInteractionGeneration()
              }
              void submit.then((accepted) =>
                dismissKeyboardAfterAgentSend(
                  sendOrigin,
                  accepted && sendOrigin.interaction === getLiveInteractionGeneration()
                )
              )
            }}
            placeholder={getMobileTerminalLiveInputPlaceholder({ dictation, isAttaching })}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            accessibilityLabel="Live terminal input"
            accessibilityHint="Typed text is sent directly to the active terminal"
            showSoftInputOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            smartInsertDelete={false}
            // Why: iOS textContentType overrides autoComplete and can narrow the keyboard; keep IME switching available.
            autoComplete="off"
            keyboardType={getTerminalLiveInputKeyboardType(Platform.OS)}
            returnKeyType="default"
            blurOnSubmit={false}
            editable={canSend}
            importantForAutofill="no"
          />
          <MobileTerminalInputActions
            canSend={canSend}
            isAttaching={isAttaching}
            dictation={dictation}
            dictationMode={dictationMode}
            onAttachImage={() => void attachImage('library')}
            onAttachFile={() => void attachImage('files')}
            onDictationToggle={handleDictationToggle}
            onDictationPressIn={handleDictationPressIn}
            onDictationPressOut={handleDictationPressOut}
            onDictationCancel={cancelDictation}
          />
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 50,
            paddingVertical: space.xs + 2,
            paddingHorizontal: space.md,
            gap: space.xs
          }}
        >
          <TextInput
            ref={commandInputRef}
            // Why: Android caches IME inputType at mount, so toggling autocomplete must remount there; iOS updates in place.
            key={
              Platform.OS === 'android'
                ? autocompleteEnabled
                  ? 'cmd-input-ac-on'
                  : 'cmd-input-ac-off'
                : 'cmd-input'
            }
            style={{
              flex: 1,
              height: 38,
              backgroundColor: colors.bgRaised,
              color: colors.text,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: space.md,
              paddingVertical: 0,
              fontSize: type.body.size - 1,
              fontFamily: fonts.mono
            }}
            value={bufferedTerminalDraftState.input}
            // Why: iOS kills active dictation/IME if JS writes a value differing from native text; store raw, normalize at send.
            onChangeText={bufferedTerminalDraftState.setInput}
            placeholder="Type a command…"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={autocompleteEnabled}
            spellCheck={autocompleteEnabled}
            smartInsertDelete={false}
            // Why: not autofill content, but keyboard must stay default so non-Latin IMEs remain selectable.
            autoComplete="off"
            keyboardType={getTerminalCommandKeyboardType(Platform.OS, autocompleteEnabled)}
            returnKeyType="send"
            blurOnSubmit={false}
            // Why: composing is local — an outage must not lock the field or discard typed text (#6713).
            editable={canCompose}
            onSubmitEditing={() => void handleSend()}
            selectionColor={colors.accent}
          />
          <MobileTerminalInputActions
            canSend={canSend}
            isAttaching={isAttaching}
            dictation={dictation}
            dictationMode={dictationMode}
            onAttachImage={() => void attachImage('library')}
            onAttachFile={() => void attachImage('files')}
            onDictationToggle={handleDictationToggle}
            onDictationPressIn={handleDictationPressIn}
            onDictationPressOut={handleDictationPressOut}
            onDictationCancel={cancelDictation}
          />
          <Pressable
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: canSend ? colors.accent : colors.bgRaised,
              opacity: canSend ? 1 : 0.5
            }}
            disabled={!canSend}
            onPress={() => void handleSend()}
            accessibilityLabel="Send command"
          >
            <ArrowUp
              size={18}
              color={canSend ? colors.onAccent : colors.textMuted}
              strokeWidth={2.5}
            />
          </Pressable>
        </View>
      )}
    </View>
  )
}
