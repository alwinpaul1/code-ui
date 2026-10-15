import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'
import type { DictationPaint } from '../hooks/mobile-live-transcript'
import type { LevelSource } from '../dictation/pcm-level'
import { ContextWindowRing } from '../components/ContextWindowRing'
import { Mic, Square } from 'lucide-react-native'
import { VoiceLevelBars } from '../components/VoiceLevelBars'
import { MobileNativeChatComposerSheets } from './MobileNativeChatComposerSheets'; import type { ClaudeUsageSheetData } from './ClaudeUsageSheet'
import { MobileNativeChatAttachButton } from './MobileNativeChatAttachButton'
import { COMPOSER_BUTTON_HIT_SLOP } from './composer-touch-target'
import type {
  TerminalAgentMode,
  TerminalHudContextWindow,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'
import { MobileNativeChatAttachmentChips } from './MobileNativeChatAttachmentChips'
import type { NativeChatVideoFrameExtractionState } from './mobile-native-chat-image-attachments-store'
import { useRichPasteInput } from './use-rich-paste-input'
import { useComposerKeepsKeyboard } from './use-composer-keeps-keyboard'
import { useDictationCaret } from './composer-input-box'
import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { useTheme } from '../theme/theme-context'
import { useComposerSuggestions } from './use-composer-suggestions'
import { useComposerPromptSuggestion } from './MobileNativeChatPromptSuggestion'
import { MobileNativeChatSendSlot } from './MobileNativeChatSendSlot'
import { MobileNativeChatDictationLayer } from './MobileNativeChatDictationRow'
import { MobileNativeChatDictationCaption, MobileNativeChatDictationScrim } from './MobileNativeChatDictationCaption'
import { useComposerDictationRow } from './use-composer-dictation-row'
import { keepHeldPressThroughLongPress } from './held-press-long-press'
import { applyAutocomplete } from './mobile-native-chat-autocomplete'
import {
  composerSuggestionInsertText,
  MobileNativeChatComposerSuggestions,
  type ComposerSuggestion
} from './MobileNativeChatComposerSuggestions'
import {
  MobileNativeChatSessionOptionPickers,
  type MobileNativeChatSessionOptionPickersProps
} from './MobileNativeChatSessionOptionPickers'
import { nativeChatAttachmentCount, type PendingNativeChatImage } from './mobile-native-chat-image-attachment'

const NO_FILE_PATHS: string[] = []
const NO_SKILLS: DiscoveredSkill[] = []
const NO_ATTACHMENTS: PendingNativeChatImage[] = []

type Props = {
  /** Controlled composer text — owned by the parent so dictation can write to it. */
  value: string
  onChangeText: (text: string) => void
  /** Bumped (any increase over 0) to focus the text field once — the file
   *  reader's "Ask about lines" after switching back to this chat tab. */
  focusRequest?: number
  /** The soft keyboard is up; one no field holds is claimed here (use-composer-keeps-keyboard.ts). */
  keyboardUp?: boolean
  onSend: (text: string) => Promise<boolean>
  /** Changes whenever the route focuses a different chat composer surface. */
  sendSurfaceId: string
  /** Reads the retained route's focus generation without forcing a screen render. */
  getSendCompletionGeneration: () => number
  /** Reads user draft mutations owned above this renderable composer. */
  getComposerEditGeneration: () => number
  /** Active tab's agent — the slash autocomplete serves its command catalog. */
  agent?: string | null
  /** Model/session-option pickers shown in the composer action row; null when
   *  the agent has no session-option catalog. */
  sessionOptions?: MobileNativeChatSessionOptionPickersProps | null
  /** A photo taken with the camera right now. */
  onCaptureImage?: () => void
  onAttachImage?: () => void
  onPasteImage?: () => void
  /** An image put into the input itself — the keyboard's clipboard panel,
   *  the paste menu, a drag — as a `file://` copy. Undefined when images
   *  cannot be attached here at all. */
  onPasteImageFile?: (uri: string) => void
  /** Any document via the system file picker; shown as a named chip. */
  onAttachFile?: () => void
  /** Images uploaded but not yet sent: removable thumbnails, sent with the next send. */
  attachments?: PendingNativeChatImage[]
  /** The rate-limit banner, drawn at the top of the card where the Claude app draws it. */
  banner?: ReactNode
  onRemoveAttachment?: (id: string) => void
  /** Opens the markup editor on a photo chip (the Claude app's pencil, 2026-09-24). */
  onEditAttachment?: (id: string, uri: string) => void
  /** A document attach is reading an over-the-cap video's frames. */
  videoFrameExtraction?: NativeChatVideoFrameExtractionState | null
  onCancelVideoFrameExtraction?: () => void
  isAttaching?: boolean
  onMicPress?: () => void
  /** Runs before `onSend`: ends live dictation so the sent words do not come back. */
  onBeforeSend?: () => void
  micActive?: boolean
  /** Microphone level 0..1 while `micActive`; drives the waveform (the voice bars without the
   *  recording row). */
  micLevel?: number
  /** The engine's per-chunk level, held outside React; the waveform prefers it to `micLevel`. */
  micLevelSource?: LevelSource
  /** The take's words so far, for the live caption above the recording row. */
  dictationCaption?: string
  /** The take has stopped listening and its words are being finished. */
  micTranscribing?: boolean
  /** With `onStopDictation`, turns on the recording row while dictating: the field and the
   *  action row give way to Cancel / waveform / Stop / Send, as in the Claude app. Discards the
   *  take's words. */
  onCancelDictation?: () => void
  /** Ends the take and keeps its words in the field. */
  onStopDictation?: () => void
  /** What the app's own dictation last wrote. In the render that brings a new one, if `value` is
   *  its text, the caret goes to its `caret`. */
  dictationPaint?: DictationPaint | null
  onComposerCursor?: (cursor: number) => void
  /** Context window figure from the desktop status line; shows the ring. */
  contextWindow?: TerminalHudContextWindow | null; claudeUsage?: { data: ClaudeUsageSheetData; onOpen: () => void } | null // claudeUsage: a Claude tab's Usage sheet, which the ring opens
  /** Permission mode from the terminal footer; drives the mode sheet. */
  permissionMode?: TerminalPermissionMode | null
  /** Steps the terminal to the chosen mode (Shift+Tab until its footer agrees). */
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  /** Codex collaboration mode from its footer; drives the mode sheet. */
  agentMode?: TerminalAgentMode | null
  onSelectAgentMode?: (mode: TerminalAgentMode) => void
  /** Dictation trigger style — 'hold' uses press-in/out, 'toggle' uses tap. */
  dictationMode?: string
  onMicPressIn?: () => void
  onMicPressOut?: () => void
  disabled?: boolean
  placeholder?: string
  filePaths?: string[]
  onNeedFiles?: (query: string) => void
  /** Installed skills / plugin commands merged into the `/` menu. */
  skills?: readonly DiscoveredSkill[]
  /** The `/` surface the running structured session reports for itself. When
   *  present it decides which commands and skills the menu offers; undefined
   *  keeps the curated catalog and the host disk scan. */
  sessionCommands?: readonly AgentSessionSlashCommand[]
  /** Conversation commands this chat host supports. Defined only on the
   *  structured lane, where the menu narrows to what the dispatcher honors. */
  conversationCommands?: readonly AgentSessionConversationCommand[]
  /** Asked once the slash menu opens so the host scan is lazy. */
  onNeedSkills?: () => void
  /** The chat view's height, for the popover's cap (the dock's own height
   *  carries the keyboard lift). */
  popoverSpace?: number
  /** The dock's current height (which includes the popover when it is up). */
  dockHeight?: number
  /** A turn is running that Stop can interrupt. With nothing typed, Stop takes
   *  the send button's slot; with text, Send stays so the message can queue. */
  canStop?: boolean
  /** A Stop went out and the turn has not ended yet (use-chat-stop-button.ts). */
  stopping?: boolean
  onStop?: () => void
}

/** The Claude app's composer, 1.261009.20 (the spec table is G37 in docs/claude-app-parity-gaps.md).
 *  Decompiled, then measured on the user's screen recording of the app (1080 px at 2.8125 px/dp):
 *  the shell pads 8 dp above its content (`o530.b`) and the field 8 more (`aj1`), so the first line
 *  starts 16 dp under the card's top edge (46 px); its caret spans 67 px, the 23.8 dp line of
 *  17 sp at 1.4. From that line's foot to the buttons is 16 dp again (46 px): the field's 8 plus
 *  the row's 8 here. The buttons sit 8 dp from the card's sides and foot and 8 dp apart.
 *  Until 2026-10-14 this was 12 / 9 above a 2 dp row gap, 11 dp of air from an earlier reading of
 *  the decompile (8 + 3 in a 42 dp row) that the recording does not bear out. */
const COMPOSER_INPUT_PAD = { top: 16, bottom: 8, side: 13 }
const [COMPOSER_ROW_PAD, COMPOSER_BUTTON] = [8, 36]
/** 17 sp at 1.4 (`aj1`), on whole dp. */
const COMPOSER_TYPE = { fontSize: 17, lineHeight: 24 }
/** `p54.L`: the card's shadow, blur 8, black at 10%, 2 dp down. */
const COMPOSER_SHADOW = '0px 2px 8px rgba(0, 0, 0, 0.1)'
/** Whole lines the input shows before it scrolls, 1 to 6 as in the Claude app. Its height is
 *  padding plus whole lines, so a full box never shows a cut line at its foot (the 150 dp cap fell
 *  2 dp into a seventh). */
const COMPOSER_INPUT_MAX_LINES = 6
/** Lines of draft left in view while the `/` or `@` menu is up. */
const COMPOSER_INPUT_LINES_WITH_MENU = 2

/** Claude-app style composer: a rounded card with the text field on top and a
 *  single action row beneath (attach, model, mic, send). */
export function MobileNativeChatComposer({
  value,
  onChangeText,
  focusRequest,
  keyboardUp = false,
  onSend,
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  agent,
  sessionOptions,
  onCaptureImage,
  onAttachImage,
  onPasteImageFile,
  onAttachFile,
  attachments = NO_ATTACHMENTS, banner, onRemoveAttachment, onEditAttachment,
  videoFrameExtraction = null,
  onCancelVideoFrameExtraction,
  onMicPress,
  onBeforeSend,
  micActive = false,
  micLevel = 0,
  micLevelSource,
  dictationCaption = '',
  micTranscribing = false,
  onCancelDictation,
  onStopDictation,
  dictationPaint = null,
  onComposerCursor,
  contextWindow = null, claudeUsage = null,
  permissionMode = null,
  onSelectPermissionMode,
  agentMode = null,
  onSelectAgentMode,
  dictationMode = 'toggle',
  onMicPressIn,
  onMicPressOut,
  disabled = false,
  placeholder = 'Type / for commands',
  filePaths = NO_FILE_PATHS,
  onNeedFiles,
  skills = NO_SKILLS,
  sessionCommands,
  conversationCommands,
  onNeedSkills,
  popoverSpace = 0,
  dockHeight = 0,
  canStop = false,
  stopping = false,
  onStop
}: Props): React.JSX.Element {
  const { colors, fonts, radius, space } = useTheme()
  const [cursor, setCursor] = useState(() => value.length)
  useEffect(() => {
    onComposerCursor?.(cursor)
  }, [cursor, onComposerCursor])
  const [focused, setFocused] = useState(false)
  // Transiently drives the native caret after a mid-text autocomplete insert,
  // then released on the next selection change so manual caret placement still
  // works (a permanently controlled `selection` breaks it in React Native).
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
    null
  )
  const textInputRef = useRef<TextInput>(null)
  useRichPasteInput(textInputRef, onPasteImageFile)
  useComposerKeepsKeyboard(textInputRef, keyboardUp)
  // Only on an actual increase, never on a re-render at the same value — a
  // route revisit that leaves focusRequest untouched must not steal the
  // keyboard back from whatever the user is doing now.
  const lastFocusRequestRef = useRef(focusRequest ?? 0)
  useEffect(() => {
    const requested = focusRequest ?? 0
    if (requested > lastFocusRequestRef.current) {
      textInputRef.current?.focus()
    }
    lastFocusRequestRef.current = requested
  }, [focusRequest])
  const sendingRef = useRef(false)
  const mountedRef = useRef(true)
  const sendSurfaceIdRef = useRef(sendSurfaceId)
  const sendSurfaceGenerationRef = useRef(0)
  useLayoutEffect(() => {
    if (sendSurfaceIdRef.current !== sendSurfaceId) {
      sendSurfaceIdRef.current = sendSurfaceId
      sendSurfaceGenerationRef.current += 1
    }
  }, [sendSurfaceId])
  const [sending, setSending] = useState(false)
  const [showContextSheet, setShowContextSheet] = useState(false)
  const [showModeSheet, setShowModeSheet] = useState(false)
  const trimmed = value.trim()
  const sessionOptionDispatching = sessionOptions?.controller.pendingId != null
  // An attached image alone is a valid send (desktop parity), so the image rides
  // along even when the user sends no accompanying text.
  // A chip still uploading does not grey Send: the tap waits for it and sends
  // it with the text (use-mobile-native-chat-send-chips.ts), and `sending`
  // greys Send meanwhile. Until 2026-09-26 only a first upload greyed it,
  // markup's re-upload never marked its chip, and a send tapped just after
  // Done pasted the photo without its marks.
  const hasContent = trimmed.length > 0 || attachments.length > 0
  // A failed chip turns Send off until retried or removed (Claude's yv8.i Idle over j29.e).
  const hasFailedChip = attachments.some((attachment) => attachment.failed === true)
  // Send or Stop, never both; typed text brings Send back (MobileNativeChatSendSlot.tsx).
  // Not while dictating: the mic's own Stop dictation square sits beside the slot.
  // A failed chip alone sends nothing, so it does not hold the slot from Stop.
  const showStop = canStop && onStop !== undefined && (!hasContent || (hasFailedChip && !trimmed)) && !micActive
  const canSend = hasContent && !hasFailedChip && !disabled && !sending && !sessionOptionDispatching

  const { trigger, suggestions, popoverMaxHeight, onPopoverLayout } = useComposerSuggestions({
    value,
    cursor,
    agent: agent ?? null,
    skills,
    sessionCommands,
    conversationCommands,
    filePaths,
    onNeedFiles,
    onNeedSkills,
    popoverSpace,
    dockHeight, focused
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sendSurfaceGenerationRef.current += 1
    }
  }, [])

  const pickSuggestion = (suggestion: ComposerSuggestion): void => {
    if (!trigger) {
      return
    }
    const { text: nextText, cursor: nextCursor } = applyAutocomplete(
      value,
      trigger,
      composerSuggestionInsertText(suggestion)
    )
    onChangeText(nextText)
    setCursor(nextCursor)
    setPendingSelection({ start: nextCursor, end: nextCursor })
  }

  const handleSend = async (): Promise<void> => {
    if (!canSend || sendingRef.current) {
      return
    }
    sendingRef.current = true
    setSending(true)
    const sendSurfaceGeneration = sendSurfaceGenerationRef.current
    const sendCompletionGeneration = getSendCompletionGeneration()
    const composerEditGeneration = getComposerEditGeneration()
    try {
      onBeforeSend?.()
      // Raw, not trimmed: the send seam owns the wire trim, and a rejection has
      // to hand the user back exactly what they typed (#14819).
      const accepted = await onSend(value)
      if (
        accepted &&
        mountedRef.current &&
        sendSurfaceGeneration === sendSurfaceGenerationRef.current &&
        sendCompletionGeneration === getSendCompletionGeneration() &&
        composerEditGeneration === getComposerEditGeneration()
      ) {
        setCursor(0)
        // Keep the keyboard and list viewport stable while the accepted send
        // becomes a queued input or transcript row. The user controls dismissal.
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  // While a take runs the field and the action row give way to the recording row.
  const dictationRow = useComposerDictationRow({
    micActive, micTranscribing, onCancelDictation, onStopDictation, sendNow: () => void handleSend(),
    sendSurfaceId, sendBlocked: disabled || sending || sessionOptionDispatching || hasFailedChip
  })
  const { micShowsStop } = dictationRow

  const iconButton = {
    flexShrink: 0,
    width: COMPOSER_BUTTON,
    height: COMPOSER_BUTTON,
    borderRadius: COMPOSER_BUTTON / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  }
  const composerType = { fontFamily: fonts.regular, ...COMPOSER_TYPE }
  // A matched Claude tab's next-prompt suggestion over the empty field, and the lines it draws: while
  // it shows, the field is tall enough for all of them and the pill (ccr-prompt-suggestion.ts).
  const promptHint = useComposerPromptSuggestion({ value, onFill: onChangeText, pad: COMPOSER_INPUT_PAD, type: composerType })
  const inputPads = COMPOSER_INPUT_PAD.top + COMPOSER_INPUT_PAD.bottom
  const inputMaxHeight = inputPads + COMPOSER_INPUT_MAX_LINES * composerType.lineHeight
  const inputMaxHeightWithMenu = inputPads + COMPOSER_INPUT_LINES_WITH_MENU * composerType.lineHeight
  // Placed once per dictation result (composer-input-box.ts).
  const dictationSelection = useDictationCaret(dictationPaint, value)

  return (
    <View>
      {dictationRow.available ? <MobileNativeChatDictationScrim fadeStyle={dictationRow.layerStyle} /> : null}
      {suggestions.length > 0 ? (
        <MobileNativeChatComposerSuggestions
          suggestions={suggestions}
          onPick={pickSuggestion}
          maxHeight={popoverMaxHeight}
          onLayout={onPopoverLayout}
        />
      ) : null}
      {dictationRow.available ? (
        <MobileNativeChatDictationCaption spoken={dictationCaption} shown={dictationRow.up} textStyle={composerType} />
      ) : null}
      <View
        // 16 dp from the screen's sides and 16 dp above the keyboard (or the navigation bar), as
        // the recording measures the Claude app's card (45 px and 46 px).
        style={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.lg }}
        testID="native-chat-composer-inset"
      >
        <View
          style={{
            // `p54.K`: a 0.5 dp hairline. `en7.b(..).j`: 24 dp corners.
            borderWidth: 0.5,
            borderColor: focused ? colors.composerBorderFocused : colors.composerBorder,
            borderRadius: radius.xl,
            // The Claude app's composer surface (tokens.ts, 2026-10-13), now near-opaque, with
            // the app's own soft shadow. The shadow came off in 2026-09 while the card was
            // see-through glass, where it read as a smudge; the card is no longer glass.
            backgroundColor: colors.composerFill,
            boxShadow: COMPOSER_SHADOW,
            overflow: 'hidden'
          }}
          testID="native-chat-composer"
        >
          {banner}
          {/* No markup while a send is out: marks made after it has written
              the photo would never reach the desktop. */}
          <MobileNativeChatAttachmentChips
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
            onEditAttachment={sending ? undefined : onEditAttachment}
            videoFrameExtraction={videoFrameExtraction}
            onCancelVideoFrameExtraction={onCancelVideoFrameExtraction}
          />
          {/* While the `/` or `@` menu is up the draft folds to its last two
              lines, so a long prompt leaves the menu its rows, as the Claude
              app does (device, 2026-09-20: four rows of draft and four photos
              left the menu a row and a half). The fold is a clipping wrapper,
              not a smaller input: shrinking a multiline TextInput's own
              maxHeight under its content blanked the text on Android.
              `collapsable={false}` keeps the input's native parent the same
              whether or not the menu is up. Without it the menu's
              `overflow: 'hidden'` alone decided whether Fabric kept this
              wrapper's children or handed them to the card, so every open and
              close moved the EditText to another parent. Android drops focus
              on that move while the keyboard stays up, and keys typed after
              `@` or `/` went nowhere until a tap (device, 2026-09-26). */}
          {/* While the recording row is up the field folds away, as the Claude app's does
              (use-composer-dictation-row.ts). It stays mounted, and focused if it was, so the
              keyboard does not drop. */}
          <Animated.View
            style={[{ overflow: 'hidden' }, dictationRow.fieldStyle]}
            {...dictationRow.hiddenWhileUp}
            testID="native-chat-composer-field"
          >
          <View
            collapsable={false}
            onLayout={dictationRow.onFieldLayout}
            style={
              suggestions.length > 0
                ? { maxHeight: inputMaxHeightWithMenu, overflow: 'hidden', justifyContent: 'flex-end' }
                : null
            }
            testID="native-chat-composer-input-fold"
          >
            <TextInput
              cursorColor={colors.caret}
              ref={textInputRef}
              // One text layer, capped at whole lines and scrolling inside its box. Until
              // 2026-10-11 dictation turned this text transparent and drew the words in an
              // absolutely positioned Text over it, with no cap and no scroll: past the cap it
              // ran over the button row and out of the composer, a line apart from the
              // scrolled input's own copy (MobileNativeChatComposer.text-air.test.tsx).
              style={{
                width: '100%',
                maxHeight: inputMaxHeight,
                minHeight: inputPads + promptHint.lines * composerType.lineHeight,
                color: colors.text,
                ...composerType,
                paddingHorizontal: COMPOSER_INPUT_PAD.side,
                paddingTop: COMPOSER_INPUT_PAD.top,
                paddingBottom: COMPOSER_INPUT_PAD.bottom
              }}
              value={value}
              onChangeText={onChangeText}
              // Controlled only while the app dictates, and transiently right after an
              // autocomplete insert.
              selection={dictationSelection ?? pendingSelection ?? undefined}
              onSelectionChange={(e) => {
                const next = e.nativeEvent.selection.end
                setCursor(next)
                onComposerCursor?.(next)
                setPendingSelection(null)
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={promptHint.overlay ? '' : placeholder}
              placeholderTextColor={colors.composerPlaceholder}
              selectionColor={colors.accent}
              multiline
              // Why: never revoke `editable` — iOS resigns first responder on a focused
              // field, so a transient lock would yank the keyboard mid-typing (#10681).
              // The lock gates sending; the draft survives and rides the next send.
              textAlignVertical="top"
            />
            {promptHint.overlay}
          </View>
          </Animated.View>
          <View testID="native-chat-composer-action-area">
          <Animated.View style={dictationRow.actionsStyle} collapsable={false} {...dictationRow.hiddenWhileUp}>
          <View
            style={{
              minHeight: COMPOSER_BUTTON + 2 * COMPOSER_ROW_PAD,
              flexDirection: 'row',
              alignItems: 'center',
              gap: COMPOSER_ROW_PAD,
              // Why: one flexible child (the model pill) and fixed icon buttons;
              // without this the row grows past the composer and clips send.
              flexWrap: 'nowrap',
              paddingHorizontal: COMPOSER_ROW_PAD,
              paddingTop: COMPOSER_ROW_PAD,
              paddingBottom: COMPOSER_ROW_PAD
            }}
            testID="native-chat-composer-actions"
          >
            {onAttachImage ? (
              // Owns the Add context sheet and its open flag, so opening it
              // does not re-render this composer.
              <MobileNativeChatAttachButton
                iconButtonStyle={iconButton}
                disabled={disabled}
                onCaptureImage={onCaptureImage}
                onAttachImage={onAttachImage}
                onAttachFile={onAttachFile}
                permissionMode={permissionMode}
                agentMode={agentMode}
                onOpenPermission={
                  (agentMode ? onSelectAgentMode : onSelectPermissionMode)
                    ? () => setShowModeSheet(true)
                    : undefined
                }
                attachmentCount={nativeChatAttachmentCount(attachments)}
              />
            ) : null}
            {sessionOptions ? (
              <MobileNativeChatSessionOptionPickers
                {...sessionOptions}
                sendInFlight={sending}
              />
            ) : null}
            {contextWindow ? (
              <ContextWindowRing
                usedPercent={contextWindow.usedPercent}
                // On touch-down, as the + does: the ring sits in the dock,
                // outside the chat list's scroll, so no scroll can claim the
                // touch afterwards. onPress stays for a screen reader's click.
                onPressIn={() => setShowContextSheet(true)}
                onPress={() => setShowContextSheet(true)}
              />
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }} />
            {micActive && !dictationRow.available ? <VoiceLevelBars level={micLevel} /> : null}
            {onMicPress ? (
              <Pressable focusable={false}
                hitSlop={COMPOSER_BUTTON_HIT_SLOP}
                // Under the recording row the mic stays the plain mic: the row has the Stop.
                accessibilityLabel={micShowsStop ? 'Stop dictation' : 'Dictate'}
                style={({ pressed }) => [
                  iconButton,
                  {
                    backgroundColor: micShowsStop
                      ? colors.dangerSoft
                      : pressed
                        ? colors.composerControlPressed
                        : colors.composerControl
                  }
                ]}
                // Hold mode is walkie-talkie (press-in/out); toggle mode taps.
                onPress={dictationMode === 'hold' ? undefined : onMicPress}
                onPressIn={dictationMode === 'hold' ? onMicPressIn : undefined}
                onPressOut={dictationMode === 'hold' ? onMicPressOut : undefined}
                onLongPress={dictationMode === 'hold' ? keepHeldPressThroughLongPress : undefined}
                disabled={disabled}
              >
                {/* The icon swaps on press; as the page's touch target, its removal would send
                    touchend to a detached node and lose the release. */}
                {micShowsStop ? (
                  <Square pointerEvents="none" size={16} color={colors.danger} strokeWidth={2.4} fill={colors.danger} />
                ) : (
                  // `yg9.e`: a 20 dp microphone in `pl7.P`.
                  <Mic pointerEvents="none" size={20} color={colors.composerIcon} strokeWidth={2} />
                )}
              </Pressable>
            ) : null}
            <MobileNativeChatSendSlot
              showStop={showStop}
              stopping={stopping}
              onStop={onStop}
              canSend={canSend}
              onSend={() => void handleSend()}
              iconButton={iconButton}
            />
          </View>
          </Animated.View>
          {dictationRow.available ? (
            <MobileNativeChatDictationLayer row={dictationRow} level={micLevel} levelSource={micLevelSource} padding={COMPOSER_ROW_PAD} iconButton={iconButton} />
          ) : null}
          </View>
        </View>
      </View>
      <MobileNativeChatComposerSheets
        showModeSheet={showModeSheet}
        onCloseModeSheet={() => setShowModeSheet(false)}
        permissionMode={permissionMode}
        runningModel={sessionOptions?.liveModel?.model ?? null}
        onSelectPermissionMode={onSelectPermissionMode}
        agentMode={agentMode}
        onSelectAgentMode={onSelectAgentMode}
        showContextSheet={showContextSheet}
        onCloseContextSheet={() => setShowContextSheet(false)}
        contextWindow={contextWindow} claudeUsage={claudeUsage}
      />
    </View>
  )
}
