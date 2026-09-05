import { View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { useTheme } from '../theme/theme-context'
import { Surface } from '../ui/Surface'
import { Txt } from '../ui/Txt'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

export function formatContextWindowFigure(context: TerminalHudContextWindow): string {
  const pct = `${Math.round(context.usedPercent)}%`
  return context.usedLabel && context.windowLabel
    ? `${context.usedLabel} / ${context.windowLabel} (${pct})`
    : pct
}

/** "Context window  537.2k / 1M (54%)" with a bar, as Claude Code shows it
 *  when the ring is tapped. The figure comes from the desktop's status line,
 *  so it refreshes with the terminal, a few seconds behind the agent. */
export function MobileContextWindowSheet({
  visible,
  context,
  onClose
}: {
  visible: boolean
  context: TerminalHudContextWindow | null
  onClose: () => void
}) {
  const { colors, space } = useTheme()
  const pct = context ? Math.max(0, Math.min(100, context.usedPercent)) : 0
  const color = pct >= 90 ? colors.danger : pct >= 70 ? colors.warning : colors.info
  return (
    <BottomDrawer visible={visible} onClose={onClose} dragContentToDismiss>
      <Surface rounded="lg" style={{ padding: space.md + 2, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Txt variant="body" weight="medium" style={{ flex: 1 }}>
            Context window
          </Txt>
          <Txt variant="body" tone="secondary">
            {context ? formatContextWindowFigure(context) : 'Not reported'}
          </Txt>
        </View>
        <View
          style={{ height: 8, borderRadius: 4, backgroundColor: colors.bgSunken, overflow: 'hidden' }}
        >
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
        </View>
        <Txt variant="caption" tone="muted">
          Read from the desktop status line; updates a few seconds behind the agent.
        </Txt>
      </Surface>
    </BottomDrawer>
  )
}
