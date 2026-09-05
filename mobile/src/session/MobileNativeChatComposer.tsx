import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  View
} from 'react-native'
import { ArrowUp, Mic, Plus, Square, X } from 'lucide-react-native'
import {
  getNativeChatAgentProfile,
  getVerifiedNativeChatCommands
} from '../../../src/shared/native-chat-agent-profiles'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { useTheme } from '../theme/theme-context'
import { filterNativeChatSkillsForAgent } from './mobile-native-chat-skill-command'
import { PressScale } from '../ui/PressScale'
import {
  applyAutocomplete,
  detectAutocompleteTrigger,
  rankSkillSuggestions,
  rankSlashCommandSuggestions,
  rankSuggestions
} from './mobile-native-chat-autocomplete'
import {
  composerSuggestionInsertText,
  MobileNativeChatComposerSuggestions,
  type ComposerSuggestion
} from './MobileNativeChatComposerSuggestions'
import {
  MobileNativeChatSessionOptionPickers,
  type MobileNativeChatSessionOptionPickersProps
} from './MobileNativeChatSessionOptionPickers'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

const NO_FILE_PATHS: string[] = []
/** Enough for any catalog plus every installed skill; the list virtualizes. */
const SLASH_MENU_LIMIT = 500
const NO_SKILLS: DiscoveredSkill[] = []
const NO_ATTACHMENTS: PendingNativeChatImage[] = []

type Props = {
  /** Controlled composer text — owned by the parent so dictation can write to it. */
  value: string
  onChangeText: (text: string) => void
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
  onAttachImage?: () => void
  /** Images picked-and-uploaded but not yet sent — shown as removable thumbnails
   *  and ridden along on the next send (desktop native-chat parity). */
  attachments?: PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
  isAttaching?: boolean
  onMicPress?: () => void
  micActive?: boolean
  /** Dictation trigger style — 'hold' uses press-in/out, 'toggle' uses tap. */
  dictationMode?: 'toggle' | 'hold'
  onMicPressIn?: () => void
  onMicPressOut?: () => void
  disabled?: boolean
  placeholder?: string
  filePaths?: string[]
  onNeedFiles?: (query: string) => void
  /** Installed skills / plugin commands merged into the `/` menu. */
  skills?: readonly DiscoveredSkill[]
  /** Asked once the slash menu opens so the host scan is lazy. */
  onNeedSkills?: () => void
}

/** Claude-app style composer: a rounded card with the text field on top and a
 *  single action row beneath (attach, model, mic, send). */
export function MobileNativeChatComposer({
  value,
  onChangeText,
  onSend,
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  agent,
  sessionOptions,
  onAttachImage,
  attachments = NO_ATTACHMENTS,
  onRemoveAttachment,
  isAttaching = false,
  onMicPress,
  micActive = false,
  dictationMode = 'toggle',
  onMicPressIn,
  onMicPressOut,
  disabled = false,
  placeholder = 'Reply, @files, /commands',
  filePaths = NO_FILE_PATHS,
  onNeedFiles,
  skills = NO_SKILLS,
  onNeedSkills
}: Props): React.JSX.Element {
  const { colors, fonts, radius, space, type } = useTheme()
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState(false)
  // Transiently drives the native caret after a mid-text autocomplete insert,
  // then released on the next selection change so manual caret placement still
  // works (a permanently controlled `selection` breaks it in React Native).
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
    null
  )
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
  const trimmed = value.trim()
  const sessionOptionDispatching = sessionOptions?.controller.pendingId != null
  // An attached image alone is a valid send (desktop parity), so the image rides
  // along even when the user sends no accompanying text.
  const canSend =
    (trimmed.length > 0 || attachments.length > 0) &&
    !disabled &&
    !sending &&
    !isAttaching &&
    !sessionOptionDispatching

  const trigger = useMemo(() => detectAutocompleteTrigger(value, cursor), [value, cursor])
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!trigger) {
      return []
    }
    if (trigger.kind === 'slash') {
      const commands = agent ? getVerifiedNativeChatCommands(agent) : []
      // Why: a bare `/` lists everything the terminal would, built-ins first
      // and then every installed skill. The suggestion list virtualizes rows,
      // so the size of the catalog is not a render cost.
      const commandItems: ComposerSuggestion[] = rankSlashCommandSuggestions(
        commands,
        trigger.query,
        SLASH_MENU_LIMIT
      ).map((command) => ({ kind: 'command' as const, command }))
      // Installed skills and plugin commands follow the curated commands. For
      // agents that invoke skills with `/`, a name already in the catalog is a
      // command, not a skill (desktop picker parity); `$` agents keep both.
      const prefix = (agent ? getNativeChatAgentProfile(agent)?.skillPrefix : null) ?? '/'
      const commandNames = new Set(commands.map((command) => command.name))
      const skillItems: ComposerSuggestion[] = rankSkillSuggestions(
        filterNativeChatSkillsForAgent(skills, agent ?? null),
        trigger.query,
        SLASH_MENU_LIMIT
      )
        .filter((skill) => !(prefix === '/' && commandNames.has(skill.name)))
        .map((skill) => ({ kind: 'skill' as const, skill, prefix }))
      return [...commandItems, ...skillItems]
    }
    return rankSuggestions(filePaths, trigger.query).map((path) => ({
      kind: 'file' as const,
      path
    }))
  }, [trigger, filePaths, agent, skills])

  useEffect(() => {
    if (trigger?.kind === 'file') {
      onNeedFiles?.(trigger.query)
    }
  }, [onNeedFiles, trigger?.kind, trigger?.query])

  useEffect(() => {
    if (trigger?.kind === 'slash') {
      onNeedSkills?.()
    }
  }, [onNeedSkills, trigger?.kind])

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
        // Why: the turn is now the agent's — the keyboard would cover the reply.
        // A rejected send keeps it up so the handed-back draft stays editable.
        Keyboard.dismiss()
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const iconButton = {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  }

  return (
    <View>
      {suggestions.length > 0 ? (
        <MobileNativeChatComposerSuggestions suggestions={suggestions} onPick={pickSuggestion} />
      ) : null}
      <View
        style={{ paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: space.md }}
        testID="native-chat-composer-inset"
      >
        <View
          style={{
            borderWidth: 1,
            borderColor: focused ? colors.borderStrong : colors.border,
            borderRadius: radius.xl,
            backgroundColor: colors.bgPanel,
            overflow: 'hidden',
            shadowColor: colors.shadow,
            shadowOpacity: 0.6,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3
          }}
          testID="native-chat-composer"
        >
          {attachments.length > 0 ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: 80 }}
              contentContainerStyle={{
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingTop: space.md
              }}
            >
              {attachments.map((attachment) => (
                <View
                  key={attachment.id}
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.bgRaised
                  }}
                >
                  <Image
                    source={{ uri: attachment.previewUri }}
                    style={{ width: '100%', height: '100%', borderRadius: radius.sm }}
                    resizeMode="cover"
                  />
                  {onRemoveAttachment ? (
                    <Pressable
                      accessibilityLabel="Remove image"
                      // Inset inside the thumb: Android drops touches outside the parent's bounds,
                      // so an overhanging badge would lose part of its tap target.
                      style={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.text
                      }}
                      onPress={() => onRemoveAttachment(attachment.id)}
                      hitSlop={8}
                    >
                      <X size={12} color={colors.textInverse} strokeWidth={2.6} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <TextInput
            style={{
              width: '100%',
              maxHeight: 150,
              minHeight: 44,
              color: colors.text,
              fontFamily: fonts.regular,
              fontSize: type.body.size + 1,
              lineHeight: type.body.lineHeight + 1,
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: space.xs
            }}
            value={value}
            onChangeText={onChangeText}
            // Controlled only transiently right after an autocomplete insert.
            selection={pendingSelection ?? undefined}
            onSelectionChange={(e) => {
              setCursor(e.nativeEvent.selection.end)
              setPendingSelection(null)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            multiline
            // Why: never revoke `editable` — iOS resigns first responder on a focused
            // field, so a transient lock would yank the keyboard mid-typing (#10681).
            // The lock gates sending; the draft survives and rides the next send.
            textAlignVertical="top"
          />
          <View
            style={{
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              paddingHorizontal: space.sm,
              paddingBottom: space.sm
            }}
            testID="native-chat-composer-actions"
          >
            {onAttachImage ? (
              <Pressable
                accessibilityLabel="Attach image"
                style={({ pressed }) => [
                  iconButton,
                  { backgroundColor: pressed ? colors.bgRaised : 'transparent' }
                ]}
                onPress={onAttachImage}
                disabled={isAttaching || disabled}
              >
                {isAttaching ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Plus size={20} color={colors.textSecondary} strokeWidth={2} />
                )}
              </Pressable>
            ) : null}
            {sessionOptions ? (
              <MobileNativeChatSessionOptionPickers
                {...sessionOptions}
                sendInFlight={sending || isAttaching}
              />
            ) : null}
            <View style={{ flex: 1 }} />
            {onMicPress ? (
              <Pressable
                accessibilityLabel={micActive ? 'Stop dictation' : 'Dictate'}
                style={({ pressed }) => [
                  iconButton,
                  {
                    backgroundColor: micActive
                      ? colors.dangerSoft
                      : pressed
                        ? colors.bgRaised
                        : 'transparent'
                  }
                ]}
                // Hold mode is walkie-talkie (press-in/out); toggle mode taps.
                onPress={dictationMode === 'hold' ? undefined : onMicPress}
                onPressIn={dictationMode === 'hold' ? onMicPressIn : undefined}
                onPressOut={dictationMode === 'hold' ? onMicPressOut : undefined}
                disabled={disabled}
              >
                {micActive ? (
                  <Square size={16} color={colors.danger} strokeWidth={2.4} fill={colors.danger} />
                ) : (
                  <Mic size={19} color={colors.textSecondary} strokeWidth={2} />
                )}
              </Pressable>
            ) : null}
            <PressScale
              accessibilityLabel="Send message"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend }}
              style={[
                iconButton,
                { backgroundColor: canSend ? colors.accent : colors.bgRaised }
              ]}
              pressedScale={0.9}
              onPress={handleSend}
              disabled={!canSend}
            >
              <ArrowUp
                size={19}
                color={canSend ? colors.onAccent : colors.textMuted}
                strokeWidth={2.6}
              />
            </PressScale>
          </View>
        </View>
      </View>
    </View>
  )
}
