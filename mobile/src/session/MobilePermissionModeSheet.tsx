import { ActionSheetModal } from '../components/ActionSheetModal'
import { useTheme } from '../theme/theme-context'
import { permissionModeLabel, type TerminalPermissionMode } from './mobile-terminal-hud-parse'
import { PERMISSION_MODE_ICONS, permissionModeTint } from './permission-mode-appearance'
import { PERMISSION_MODE_SHEET_SUBTITLE, permissionModeSheetRows } from './permission-mode-sheet-rows'

/** Each row's glyph: 24 dp (`tzh.e`'s default, `au0.Large`) in the row's mode colour. */
const MODE_ICON_SIZE = 24

/** The Claude app's "Select mode" sheet. Picking one steps Shift+Tab in the
 *  terminal until its footer shows that mode (terminal-mode-stepper.ts).
 *  Each row draws the app's colourful glyph for its mode (`ky20.i`, 1.261009.20):
 *  a hand, code, a scroll, a lightning bolt, tinted by `permissionModeTint`. A row
 *  the running model refuses draws it in the plain muted tone instead (`rrh`: the
 *  list's content colour when the row is not open), as the app does. */
export function MobilePermissionModeSheet({
  visible,
  current,
  runningModel = null,
  onSelect,
  onClose
}: {
  visible: boolean
  current: TerminalPermissionMode | null
  /** The model the agent says is running (badge or beacon), for Auto's row. */
  runningModel?: string | null
  onSelect: (mode: TerminalPermissionMode) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  return (
    <ActionSheetModal
      visible={visible}
      title="Select mode"
      message={PERMISSION_MODE_SHEET_SUBTITLE}
      centerTitle
      actions={permissionModeSheetRows({ current, runningModel }).map((row) => ({
        label: permissionModeLabel(row.mode),
        hint: row.hint,
        icon: PERMISSION_MODE_ICONS[row.mode],
        renderIcon: () => {
          const Icon = PERMISSION_MODE_ICONS[row.mode]
          return (
            <Icon
              size={MODE_ICON_SIZE}
              color={row.disabled ? colors.textMuted : permissionModeTint(colors, row.mode)}
              strokeWidth={2}
            />
          )
        },
        selected: row.selected,
        disabled: row.disabled,
        // Auto can open its opt-in sheet (MobileNativeChatComposerSheets.tsx):
        // that second modal waits for this one to finish closing, the
        // codebase's sequencing for a sheet opened from a sheet.
        closeBeforePress: row.mode === 'auto',
        onPress: () => onSelect(row.mode)
      }))}
      onClose={onClose}
    />
  )
}
