import { memo, useRef, useState } from 'react'
import { ScrollView, useWindowDimensions, View } from 'react-native'
import { ShieldQuestion } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { PressScale } from '../ui/PressScale'
import { Txt } from '../ui/Txt'
import type { MobileChatPermission } from './mobile-native-chat-permission'

// Keep agent-provided choices intact; action surfaces grow with their content.
function MobileNativeChatPermissionImpl({
  permission,
  onRespond
}: {
  permission: MobileChatPermission
  onRespond: (send: string) => Promise<boolean>
}): React.JSX.Element {
  const { colors, radius, space } = useTheme()
  // The card sits in the dock, which the chat list clears; a tall one would push
  // the composer off a short screen, so the reading area gives up space first and
  // the choices keep theirs. Half the window leaves the conversation visible.
  const { height: windowHeight } = useWindowDimensions()
  const readingMaxHeight = Math.max(72, Math.min(160, Math.round(windowHeight * 0.22)))
  // The choices scroll rather than run off the bottom. Capping the reading area
  // alone was not enough: the options are the only thing the user can act on,
  // and a prompt with four long labels still pushed them past the composer.
  const choicesMaxHeight = Math.max(160, Math.round(windowHeight * 0.34))
  // The Claude app offers exactly three: allow once, always for this session,
  // deny. The TUI's "switch to auto mode" is a mode change, not an answer to
  // this prompt. Filtering never leaves nothing to tap: if it would, the agent
  // offered only that, so keep what it gave rather than render a dead card.
  const withoutAutoMode = permission.options.filter(
    (option) => !/^Yes, and switch to auto mode\b/i.test(option.label)
  )
  const choices = withoutAutoMode.length > 0 ? withoutAutoMode : permission.options
  const [accepted, setAccepted] = useState(false)
  const [submittingIndex, setSubmittingIndex] = useState<number | null>(null)
  const submitting = submittingIndex !== null
  const submittingRef = useRef(false)
  const commandStart = permission.detail?.search(/^\$ /m) ?? -1
  const description =
    commandStart >= 0 ? permission.detail?.slice(0, commandStart).trim() : permission.detail
  const command =
    permission.command ??
    (commandStart >= 0 ? permission.detail?.slice(commandStart + 2).trim() : undefined)
  const respond = async (send: string, index: number): Promise<void> => {
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmittingIndex(index)
    let sent = false
    try {
      sent = await onRespond(send)
      setAccepted(sent)
    } catch {
      setAccepted(false)
    } finally {
      if (!sent) {
        submittingRef.current = false
        setSubmittingIndex(null)
      }
    }
  }
  return (
    <View
      style={{
        marginHorizontal: space.md,
        marginVertical: space.sm,
        padding: space.lg,
        gap: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bgPanel
      }}
      accessibilityRole="alert"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentSoft
          }}
        >
          <ShieldQuestion size={16} color={colors.accentText} strokeWidth={2} />
        </View>
        <Txt variant="heading" weight="semibold" style={{ flex: 1 }}>
          {permission.title}
        </Txt>
      </View>
      {description || command ? (
        <ScrollView
          style={{ maxHeight: readingMaxHeight, flexShrink: 1 }}
          nestedScrollEnabled
          contentContainerStyle={{ gap: space.md }}
        >
          {/* The agent's own words about what it wants to do. Prose, so it
              wraps — it went into the command's horizontal scroll for one
              release and a sentence ran off the side with no way back. */}
          {description ? (
            <Txt variant="body" tone="secondary" selectable>
              {description}
            </Txt>
          ) : null}
          {/* The command itself: the Claude app's sunken monospace block, never
              wrapped, scrolling sideways so a long path stays one path. */}
          {command ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              style={{ borderRadius: radius.md, backgroundColor: colors.bgSunken }}
              contentContainerStyle={{ padding: space.md }}
            >
              <Txt variant="mono" selectable>
                {command}
              </Txt>
            </ScrollView>
          ) : null}
        </ScrollView>
      ) : null}
      <ScrollView
        style={{ maxHeight: choicesMaxHeight, flexShrink: 1 }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm }}
      >
        {/* The Claude app offers exactly three: allow once, always for this
            session, deny. The TUI's "switch to auto mode" is a mode change, not
            an answer to this prompt, and is left out on the user's instruction. */}
        {choices.map((option, index) => {
          const rememberedPrefix = option.label.match(
            /^Yes, and don't ask again for commands that start with\s+(.+)$/is
          )?.[1]
          const rememberedScope = option.label.match(
            /^Yes, and don['’]t ask again for:?\s+(.+)$/is
          )?.[1]
          const shortLabel =
            rememberedPrefix || rememberedScope
              ? 'Always allow for this session'
              : /^Yes$/i.test(option.label)
                ? 'Allow once'
                : /^No$/i.test(option.label)
                  ? 'Deny'
                  : option.label
          return (
            <View key={`${option.send}:${option.label}`} style={{ gap: space.sm }}>
              {submittingIndex === index ? (
                <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
                  {accepted ? 'Response sent · waiting for agent' : 'Sending response…'}
                </Txt>
              ) : null}
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ disabled: submitting, busy: submittingIndex === index }}
                pressedScale={0.98}
                disabled={submitting}
                onPress={() => void respond(option.send, index)}
                style={{
                  minHeight: 48,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm + 4,
                  gap: space.sm,
                  justifyContent: 'center',
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: index === 0 ? colors.text : colors.border,
                  backgroundColor: index === 0 ? colors.text : 'transparent',
                  opacity: submitting ? 0.55 : 1
                }}
              >
                <Txt
                  variant="label"
                  weight="semibold"
                  align="center"
                  tone={index === 0 ? 'inverse' : 'primary'}
                >
                  {shortLabel}
                </Txt>
              </PressScale>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

export const MobileNativeChatPermission = memo(MobileNativeChatPermissionImpl)
