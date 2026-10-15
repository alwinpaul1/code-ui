import { Activity } from 'lucide-react-native'
import { Animated, StyleSheet, View } from 'react-native'
import type { AgentWorkingMode } from '../../../src/shared/agent-status-types'
import { useTheme } from '../theme/theme-context'
import type { ThemeColors } from '../theme/tokens'
import { useReducedMotion } from '../ui/use-reduced-motion'
import { useWorkingRingRotation } from './use-working-ring-rotation'

type WorktreeStatus = 'working' | 'active' | 'permission' | 'done' | 'inactive'

// Why: colors and sizing are 1:1 with the desktop StatusIndicator
// (src/renderer/src/components/sidebar/StatusIndicator.tsx) so the mobile
// worktree list reads identically to the sidebar — same yellow spinner for
// 'working', same emerald dot for 'active'/'done', same neutral-500 @ 40%
// for 'inactive', same red for 'permission'. Diverging palettes here lose
// the design intent ('moving' vs 'alive' vs 'completed') the desktop encodes.
const STATUS_COLORS: Record<WorktreeStatus, string> = {
  working: '#eab308',
  active: '#10b981',
  done: '#10b981',
  permission: '#ef4444',
  inactive: 'rgba(115,115,115,0.4)'
}

// A workspace whose agents are Claude sessions draws its glyph in the live theme's tokens, so light
// and dark each draw their own (the desktop hues above were one palette for both schemes). Any
// other workspace (a Codex agent among them) keeps the desktop hues, unchanged.
function themedColor(status: WorktreeStatus, colors: ThemeColors): string {
  switch (status) {
    case 'working':
      return colors.warning
    case 'active':
    case 'done':
      return colors.success
    case 'permission':
      return colors.danger
    case 'inactive':
      return colors.textMuted
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

export function AgentSpinner({
  status,
  workingMode,
  themed = false
}: {
  status: WorktreeStatus
  workingMode?: AgentWorkingMode
  /** The workspace's agents are Claude sessions: draw in the theme's tokens. */
  themed?: boolean
}) {
  const { colors } = useTheme()
  const monitoring = status === 'working' && workingMode === 'monitoring'
  const reducedMotion = useReducedMotion()
  // Unknown (null) holds too: a loop that started and then had to be
  // cancelled is a flash of motion for the one user who asked for none.
  // The arc still draws, so a working row still reads as working.
  const rotate = useWorkingRingRotation(
    status === 'working' && !monitoring && reducedMotion === false
  )

  const color = themed ? themedColor(status, colors) : (STATUS_COLORS[status] ?? STATUS_COLORS.inactive)
  // The desktop's idle grey carries its 40% in the hue; a token carries it here.
  const dim = themed && status === 'inactive' ? { opacity: 0.4 } : null

  if (monitoring) {
    return (
      <View style={styles.wrapper} accessibilityLabel="Monitoring background tasks">
        <Activity size={12} color={themed ? colors.warning : STATUS_COLORS.working} />
      </View>
    )
  }

  if (status === 'working') {
    return (
      <View style={styles.wrapper}>
        <Animated.View style={[styles.spinner, { borderColor: color, transform: [{ rotate }] }]} />
      </View>
    )
  }

  return (
    <View style={styles.wrapper}>
      <View style={[styles.dot, { backgroundColor: color }, dim]} />
    </View>
  )
}

const styles = StyleSheet.create({
  // Why: 12x12 wrapper centered around an 8x8 inner glyph mirrors the
  // desktop's `inline-flex h-3 w-3 ... items-center justify-center` shell
  // around `size-2` indicator — keeps row height/baseline alignment stable
  // across status transitions.
  wrapper: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  spinner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderTopColor: 'transparent'
  }
})
