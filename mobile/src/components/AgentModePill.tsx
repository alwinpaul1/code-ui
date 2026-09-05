import { Pressable } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { CODEX_AGENT_MODES, type TerminalAgentMode } from '../session/mobile-terminal-hud-parse'

/** Codex's collaboration mode (Default / Plan), styled like the Claude mode pill. */
export function AgentModePill({
  mode,
  onPress,
  disabled
}: {
  mode: TerminalAgentMode
  onPress?: () => void
  disabled?: boolean
}) {
  const { colors, radius } = useTheme()
  const label = CODEX_AGENT_MODES.find((option) => option.id === mode)?.label ?? mode
  const tint = mode === 'plan' ? colors.info : colors.textMuted
  return (
    <Pressable
      accessibilityLabel={`Mode ${label}; tap to change`}
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
        {label}
      </Txt>
    </Pressable>
  )
}
