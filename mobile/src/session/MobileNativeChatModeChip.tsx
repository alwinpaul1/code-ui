import { Pressable } from 'react-native'
import { Code, Hand, ScrollText, Zap, type LucideIcon } from 'lucide-react-native'
import { resolveNativeChatTranscriptAgent } from '../../../src/shared/native-chat-agent-support'
import { useTheme } from '../theme/theme-context'
import { Txt } from '../ui/Txt'
import { permissionModeLabel, type TerminalPermissionMode } from './claude-terminal-mode-footer'
import { COMPOSER_BUTTON_HIT_SLOP, COMPOSER_BUTTON_SIZE } from './composer-touch-target'
import type { TerminalAgentMode } from './mobile-terminal-hud-parse'

/** Manual a hand, Accept edits code, Plan a scroll, Auto and Bypass a lightning bolt: the Claude
 *  app's icon per mode (1.261009.20, `ky20.q`). MobilePermissionModeSheet draws the same four
 *  for its rows, keyed by the sheet's modes, which leave out `default` and Bypass. (`default` is
 *  listed here for the switch's exhaustiveness; `modeChipSpec` never reaches it.) */
function modeIcon(mode: TerminalPermissionMode): LucideIcon {
  switch (mode) {
    case 'default':
    case 'manual':
      return Hand
    case 'acceptEdits':
      return Code
    case 'plan':
      return ScrollText
    case 'auto':
    case 'bypassPermissions':
      return Zap
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

export type ModeChipSpec = { label: string; icon: LucideIcon }

/**
 * What the mode chip says, or null when it must not be drawn.
 *
 * Drawn only on a Claude tab (Claude Code's footer, OpenClaude's the same) and only where a
 * footer stated a mode. Three refusals matter:
 *  - No mode read means no chip. `permissionMode` is null when no screen was read, or no footer
 *    row was on it (a shell the agent exited to, a repaint between frames); the chip names
 *    nothing it was not told, as the + sheet's row says "Not known yet" rather than a mode.
 *  - `default` is no statement either. It is the observation's fill for "a footer, and no mode
 *    row on it": what the mode sheet and the + sheet read as Manual, but also what a badge screen
 *    returns when five agent rows push the `auto mode on` row out of the footer's six rows. So a
 *    session in Auto drew "Manual". Only a footer that says "manual mode on" (2.1.270, 2.1.276)
 *    is `manual` and draws; a Manual session whose footer paints no row draws no chip, which a
 *    wrong chip would cost more than.
 *  - Codex states a different pair: its own Plan/Default mode, and its footer parse still
 *    fills `permissionMode` with `default`. The tab's agent rules it out, and so does its mode
 *    pair, so a tab whose agent is not yet known cannot draw it either.
 */
export function modeChipSpec(args: {
  agent: string | null | undefined
  agentMode: TerminalAgentMode | null | undefined
  permissionMode: TerminalPermissionMode | null | undefined
}): ModeChipSpec | null {
  const { agent, agentMode, permissionMode } = args
  if (
    resolveNativeChatTranscriptAgent(agent) !== 'claude' ||
    agentMode ||
    permissionMode == null ||
    permissionMode === 'default'
  ) {
    return null
  }
  return { label: permissionModeLabel(permissionMode), icon: modeIcon(permissionMode) }
}

/**
 * The Claude app's mode chip (G4), in the composer's leading group: its icon and the mode's
 * name in a circle of the control fill. Decompiled `x030.c`, 1.261009.20: at least 36 dp tall,
 * 16 x 4 dp padding, a 20 dp icon and a 13 / 400 one-line label 4 dp apart, both in `pl7.O`
 * (the model name's colour, `composerPillText`), the whole chip at 40% when disabled, read as
 * "Change mode" (`ccr_mode_toggle`). A tap opens the mode sheet; the chip does not change the
 * mode itself.
 *
 * The row cannot grow. The chip shrinks with the model pill (both `flexShrink` 1) when it is full,
 * its label ellipsizing, while the mic and Send never shrink. How the two share a 384 dp row with
 * "Accept edits" and "Opus 5.5 Extra" is not measured on a device yet.
 */
export function MobileNativeChatModeChip({
  agent,
  agentMode,
  permissionMode,
  onPress,
  disabled: locked = false
}: {
  agent: string | null | undefined
  agentMode: TerminalAgentMode | null | undefined
  permissionMode: TerminalPermissionMode | null | undefined
  /** Opens the mode sheet. Undefined when the host gave no way to change the mode: the chip
   *  then stays, at 40%, and still says what the screen stated. */
  onPress?: (() => void) | undefined
  /** The composer is locked (disconnected, or waiting for its terminal), as the + and Send are. */
  disabled?: boolean
}): React.JSX.Element | null {
  const { colors, radius } = useTheme()
  const spec = modeChipSpec({ agent, agentMode, permissionMode })
  if (!spec) {
    return null
  }
  const disabled = locked || onPress === undefined
  const Icon = spec.icon
  return (
    <Pressable
      focusable={false}
      accessibilityRole="button"
      accessibilityLabel="Change mode"
      accessibilityValue={{ text: spec.label }}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={COMPOSER_BUTTON_HIT_SLOP}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 1,
        minWidth: 0,
        minHeight: COMPOSER_BUTTON_SIZE,
        paddingHorizontal: 16,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: pressed && !disabled ? colors.composerControlPressed : colors.composerControl,
        opacity: disabled ? 0.4 : 1
      })}
    >
      <Icon pointerEvents="none" size={20} color={colors.composerPillText} strokeWidth={2} />
      {/* `jn7.H`: 13 / 400 / 1.4, one line. */}
      <Txt
        variant="label"
        weight="regular"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ flexShrink: 1, color: colors.composerPillText }}
      >
        {spec.label}
      </Txt>
    </Pressable>
  )
}
