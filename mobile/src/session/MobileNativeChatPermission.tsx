import { memo, useRef, useState } from 'react'
import { View } from 'react-native'
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
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const commandStart = permission.detail?.search(/^\$ /m) ?? -1
  const description =
    commandStart >= 0 ? permission.detail?.slice(0, commandStart).trim() : permission.detail
  const command = commandStart >= 0 ? permission.detail?.slice(commandStart + 2).trim() : undefined
  const respond = async (send: string): Promise<void> => {
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    const accepted = await onRespond(send)
    if (!accepted) {
      submittingRef.current = false
      setSubmitting(false)
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
      <View style={{ gap: space.sm }}>
        {permission.options.map((option, index) => {
          const rememberedPrefix = option.label.match(
            /^Yes, and don't ask again for commands that start with\s+(.+)$/is
          )?.[1]
          return (
            <PressScale
              key={`${option.send}:${option.label}`}
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
                {rememberedPrefix ? 'Allow and remember' : option.label}
              </Txt>
              {rememberedPrefix ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="caption" tone="secondary">
                    For commands starting with:
                  </Txt>
                  <Txt variant="mono" tone="secondary">
                    {rememberedPrefix}
                  </Txt>
                </View>
              ) : null}
            </PressScale>
          )
        })}
      </View>
    </View>
  )
}

export const MobileNativeChatPermission = memo(MobileNativeChatPermissionImpl)
