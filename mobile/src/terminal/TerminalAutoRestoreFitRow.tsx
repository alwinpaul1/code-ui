import { Pressable, Text, View } from 'react-native'
import { ChevronRight, Smartphone } from 'lucide-react-native'
import type { PickerOption } from '../components/PickerModal'
import { useTheme } from '../theme/theme-context'
import {
  TERMINAL_AUTO_RESTORE_FIT_UNREADABLE,
  type TerminalAutoRestoreFitRowAction,
  type TerminalAutoRestoreFitValue
} from './terminal-auto-restore-fit-state'
import type { terminalSettingsScreenStyles } from './terminal-settings-screen-styles'

// The Terminal settings "When you leave the app" row and its picker options, moved out of
// app/terminal-settings.tsx so the screen stays under its line cap.

export type RestoreValue = 'indefinite' | '60s' | '5m' | '30m'

export const AUTO_RESTORE_FIT_OPTIONS: (PickerOption<RestoreValue> & { ms: number | null })[] = [
  { value: 'indefinite', label: 'Keep at phone size (default)', ms: null },
  { value: '60s', label: 'After 1 minute', ms: 60_000 },
  { value: '5m', label: 'After 5 minutes', ms: 5 * 60_000 },
  { value: '30m', label: 'After 30 minutes', ms: 30 * 60_000 }
]

/** The picker's preselected option. Only ever asked for a value the desktop actually answered. */
export function restoreValueFromMs(ms: number | null): RestoreValue {
  if (ms === null) {
    return 'indefinite'
  }
  const exact = AUTO_RESTORE_FIT_OPTIONS.find((o) => o.ms === ms)
  if (exact) {
    return exact.value
  }
  // Why: server may return a non-preset ms (custom value, future preset,
  // or server-side clamp). Snap to the closest finite preset so the
  // picker's selected radio agrees with the row sublabel rendered by
  // autoRestoreSummary ("After Xs").
  let closest: (typeof AUTO_RESTORE_FIT_OPTIONS)[number] | null = null
  let bestDelta = Infinity
  for (const opt of AUTO_RESTORE_FIT_OPTIONS) {
    if (opt.ms == null) {
      continue
    }
    const delta = Math.abs(opt.ms - ms)
    if (delta < bestDelta) {
      bestDelta = delta
      closest = opt
    }
  }
  return closest ? closest.value : 'indefinite'
}

/**
 * '…' before a read answers (the first one, or a retry), "Couldn't read" when it failed: neither is
 * the default. A failed read the row can retry says so, or the tap that fixes it is invisible.
 */
function autoRestoreSummary(
  value: TerminalAutoRestoreFitValue | undefined,
  action: TerminalAutoRestoreFitRowAction
): string {
  if (value === undefined) {
    return '…'
  }
  if (value === TERMINAL_AUTO_RESTORE_FIT_UNREADABLE) {
    return action === 'retry' ? "Couldn't read. Tap to retry." : "Couldn't read"
  }
  if (value === null) {
    return AUTO_RESTORE_FIT_OPTIONS[0]!.label
  }
  const exact = AUTO_RESTORE_FIT_OPTIONS.find((o) => o.ms === value)
  return exact ? exact.label : `After ${Math.round(value / 1000)}s`
}

export function TerminalAutoRestoreFitRow({
  action,
  hostName,
  value,
  onPress,
  styles
}: {
  /** From terminalAutoRestoreFitRowAction; `null` disables the row. */
  action: TerminalAutoRestoreFitRowAction
  hostName: string
  value: TerminalAutoRestoreFitValue | undefined
  onPress: () => void
  styles: ReturnType<typeof terminalSettingsScreenStyles>
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={action === null}
    >
      <Smartphone size={16} color={colors.textSecondary} />
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{hostName}</Text>
        <Text style={styles.rowSublabel}>{autoRestoreSummary(value, action)}</Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} />
    </Pressable>
  )
}
