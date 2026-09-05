import { Pressable } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import {
  permissionModeLabel,
  type TerminalPermissionMode
} from '../session/mobile-terminal-hud-parse'

/** Claude Code's permission mode as a small pill; a tap sends Shift+Tab, the
 *  same cycle the keyboard does, and the pill follows the terminal footer. */
export function PermissionModePill({
  mode,
  onPress,
  disabled
}: {
  mode: TerminalPermissionMode
  onPress?: () => void
  disabled?: boolean
}) {
  const { colors, radius } = useTheme()
  const tint =
    mode === 'plan'
      ? colors.info
      : mode === 'acceptEdits'
        ? colors.success
        : mode === 'auto'
          ? colors.warning
          : mode === 'bypassPermissions'
            ? colors.danger
            : colors.textMuted
  return (
    <Pressable
      accessibilityLabel={`Permission mode ${permissionModeLabel(mode)}; tap to change`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexShrink: 0,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: tint,
        backgroundColor: pressed ? colors.bgRaised : 'transparent',
        opacity: disabled ? 0.6 : 1
      })}
    >
      <Txt variant="caption" weight="medium" style={{ color: tint }}>
        {permissionModeLabel(mode)}
      </Txt>
    </Pressable>
  )
}
