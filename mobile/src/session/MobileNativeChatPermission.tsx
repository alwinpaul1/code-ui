import { memo, useRef, useState } from 'react'
import { View } from 'react-native'
import { ShieldQuestion } from 'lucide-react-native'
import { useTheme } from '../theme/theme-context'
import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'
import type { MobileChatPermission } from './mobile-native-chat-permission'

// Renders a detected agent permission ask as a card with tappable options.
// The first option is treated as the primary (allow) action and gets a filled
// accent button so the affirmative choice reads as distinct from the rest.
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
      {permission.detail ? (
        <Txt variant="label" tone="secondary">
          {permission.detail}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {permission.options.map((option, index) => (
          <Button
            key={`${option.send}:${option.label}`}
            label={option.label}
            variant={index === 0 ? 'accent' : 'secondary'}
            disabled={submitting}
            onPress={() => void respond(option.send)}
          />
        ))}
      </View>
    </View>
  )
}

export const MobileNativeChatPermission = memo(MobileNativeChatPermissionImpl)
