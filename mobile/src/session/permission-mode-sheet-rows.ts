import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

// The rows of the "Select mode" sheet, as the Claude Android app (1.261009.20)
// lays them out: Manual, Accept edits, Plan, Auto, with its own descriptions.
// Bypass is never a row there, and it is not one here either: a session in
// Bypass was started that way on the desktop, and the chip still names it.

export type PermissionModeSheetMode = 'manual' | 'acceptEdits' | 'plan' | 'auto'

export type PermissionModeSheetRow = {
  mode: PermissionModeSheetMode
  hint: string
  selected: boolean
  disabled: boolean
}

export const PERMISSION_MODE_SHEET_SUBTITLE = 'Choose how Claude should work'
export const AUTO_MODE_UNAVAILABLE_FOR_MODEL = 'Not available for the selected model'

const ROWS: { mode: PermissionModeSheetMode; hint: string }[] = [
  { mode: 'manual', hint: 'Always ask before making changes' },
  { mode: 'acceptEdits', hint: 'Automatically accept all file edits' },
  { mode: 'plan', hint: 'Create a plan before making changes' },
  { mode: 'auto', hint: 'Claude handles permission decisions' }
]

/**
 * Whether the running model is one Auto mode refuses. The Claude app's rule,
 * word for word: a Claude 3 model, or a Claude 4 model up to 4.5 (`claude-
 * opus-4`, `claude-sonnet-4-5`, a dated `claude-opus-4-20250514`). Claude Code
 * 2.1.296 refuses the same switch with "<model> doesn't support auto mode".
 *
 * Only a full id is judged. An alias (`opus`) or no model at all says nothing
 * about the build behind it, so the row stays open and the stepper's read-back
 * decides, as it always has.
 */
export function autoModeUnsupportedModel(modelId: string | null | undefined): boolean {
  const id = modelId?.trim().toLowerCase() ?? ''
  if (!id) {
    return false
  }
  return id.startsWith('claude-3-') || /^claude-[a-z]+-4(?:$|-(?:[0-5](?!\d)|\d{8}))/.test(id)
}

export function permissionModeSheetRows(args: {
  current: TerminalPermissionMode | null
  runningModel?: string | null
}): PermissionModeSheetRow[] {
  const selected = args.current === 'default' ? 'manual' : args.current
  const autoRefused = autoModeUnsupportedModel(args.runningModel)
  return ROWS.map((row) => {
    const disabled = row.mode === 'auto' && autoRefused && selected !== 'auto'
    return {
      mode: row.mode,
      hint: disabled ? AUTO_MODE_UNAVAILABLE_FOR_MODEL : row.hint,
      selected: row.mode === selected,
      disabled
    }
  })
}
