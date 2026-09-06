import { memo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
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
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const commandStart = permission.detail?.search(/^\$ /m) ?? -1
  const description =
    commandStart >= 0 ? permission.detail?.slice(0, commandStart).trim() : permission.detail
  const command =
    permission.command ??
    (commandStart >= 0 ? permission.detail?.slice(commandStart + 2).trim() : undefined)
  const respond = async (send: string): Promise<void> => {
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    let sent = false
    try {
      sent = await onRespond(send)
      setAccepted(sent)
    } catch {
      setAccepted(false)
    } finally {
      if (!sent) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }
  if (accepted) {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={{
          margin: space.md,
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.bgPanel
        }}
      >
        <Txt variant="label" tone="secondary">
          Response sent · waiting for agent
        </Txt>
      </View>
    )
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
          style={{ maxHeight: 160 }}
          nestedScrollEnabled
          contentContainerStyle={{ gap: space.md }}
        >
          {description ? (
            <Txt variant="body" tone="secondary" selectable>
              {description}
            </Txt>
          ) : null}
          {command ? (
            <View
              style={{
                padding: space.md,
                gap: space.sm,
                borderRadius: radius.md,
                backgroundColor: colors.bgSunken
              }}
            >
              <Txt variant="caption" tone="muted">
                Command
              </Txt>
              <Txt variant="mono" selectable>
                {command}
              </Txt>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
      {submitting ? (
        <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          Sending response…
        </Txt>
      ) : null}
      <View style={{ gap: space.sm }}>
        {permission.options.map((option, index) => {
          const rememberedPrefix = option.label.match(
            /^Yes, and don't ask again for commands that start with\s+(.+)$/is
          )?.[1]
          const rememberedScope = option.label.match(
            /^Yes, and don['’]t ask again for:?\s+(.+)$/is
          )?.[1]
          const autoMode = /^Yes, and switch to auto mode\b/i.test(option.label)
          const shortLabel =
            rememberedPrefix || rememberedScope
              ? 'Allow and remember'
              : autoMode
                ? 'Allow and switch to auto mode'
                : /^Yes$/i.test(option.label)
                  ? 'Allow once'
                  : /^No$/i.test(option.label)
                    ? 'Deny'
                    : option.label
          return (
            <View key={`${option.send}:${option.label}`} style={{ gap: space.sm }}>
              {rememberedPrefix || rememberedScope ? (
                <ScrollView
                  style={{
                    maxHeight: 160,
                    borderRadius: radius.md,
                    backgroundColor: colors.bgSunken
                  }}
                  contentContainerStyle={{ gap: space.sm, padding: space.md }}
                  nestedScrollEnabled
                >
                  <Txt variant="body" tone="secondary" selectable>
                    {rememberedPrefix ? 'For commands starting with:' : 'Remember permission for:'}
                  </Txt>
                  <Txt variant="body" tone="secondary" selectable>
                    {rememberedPrefix ?? rememberedScope}
                  </Txt>
                </ScrollView>
              ) : null}
              {autoMode ? (
                <Txt variant="body" tone="secondary" selectable style={{ paddingTop: space.sm }}>
                  {option.label.replace(/^Yes, and switch to auto mode\s*[·:]?\s*/i, '') ||
                    'Switches this session to auto mode.'}
                </Txt>
              ) : null}
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ disabled: submitting, busy: submitting }}
                pressedScale={0.98}
                disabled={submitting}
                onPress={() => void respond(option.send)}
                style={{
                  minHeight: 48,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm + 4,
                  gap: space.sm,
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: index === 0 ? colors.accent : colors.border,
                  backgroundColor: index === 0 ? colors.accent : colors.bgRaised,
                  opacity: submitting ? 0.55 : 1
                }}
              >
                <Txt
                  variant="label"
                  weight="semibold"
                  align="center"
                  tone={index === 0 ? 'onAccent' : 'primary'}
                >
                  {shortLabel}
                </Txt>
              </PressScale>
            </View>
          )
        })}
      </View>
    </View>
  )
}

export const MobileNativeChatPermission = memo(MobileNativeChatPermissionImpl)
