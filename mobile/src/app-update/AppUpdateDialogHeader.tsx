import { Pressable, View } from 'react-native'
import { X } from 'lucide-react-native'

import { OrcaLogo } from '../components/OrcaLogo'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** Logo tile + version chip, the way Flighty and Xbox open their update dialogs. */
export function AppUpdateDialogHeader({
  version,
  tone = 'accent',
  onClose
}: {
  version: string
  tone?: 'accent' | 'success' | 'danger'
  onClose?: () => void
}) {
  const { colors, space, radius } = useTheme()
  const tileBg =
    tone === 'success'
      ? colors.successSoft
      : tone === 'danger'
        ? colors.dangerSoft
        : colors.accentSoft
  const tileFg =
    tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.accent
  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      {onClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={onClose}
          style={({ pressed }) => ({
            position: 'absolute',
            top: -space.sm,
            right: -space.sm,
            padding: space.xs,
            opacity: pressed ? 0.5 : 1
          })}
        >
          <X size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.lg,
          backgroundColor: tileBg,
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <OrcaLogo size={26} color={tileFg} />
      </View>
      <View
        style={{
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: colors.bgSunken
        }}
      >
        <Txt variant="caption" weight="medium" tone="secondary">
          Code UI {version}
        </Txt>
      </View>
    </View>
  )
}
