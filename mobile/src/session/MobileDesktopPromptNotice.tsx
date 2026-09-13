import { View } from 'react-native'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'

/** Said once, where the messages would have appeared: this tab was started
 *  before the desktop-prompt hook existed, so what the user types on the
 *  desktop cannot reach the phone here.
 *
 *  Why a notice and not a fix: Claude Code reads `--settings` once at launch.
 *  Its hot reload watches settings FILES (2026-09-13 issue #22679 and the
 *  v2.1.195 change), and Code UI writes nothing to the host, so a running tab
 *  can never gain a hook. A tab opened from now on has it. */
export function MobileDesktopPromptNotice() {
  const { colors, space } = useTheme()
  return (
    <View
      style={{ marginHorizontal: space.md, marginBottom: space.sm }}
      testID="desktop-prompt-notice"
    >
      <Txt variant="caption" tone="muted" style={{ color: colors.textMuted }}>
        Messages typed on the desktop appear here only on tabs opened after this update.
      </Txt>
    </View>
  )
}
