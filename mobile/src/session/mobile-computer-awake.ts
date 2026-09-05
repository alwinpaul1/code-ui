import {
  computerAwakeSettingsForMode,
  normalizeComputerAwakeMode,
  type ComputerAwakeMode
} from '../../../src/shared/computer-awake-mode'

/** The three choices Orca's desktop popover offers, in the same order. Orca calls
 *  the middle one "Agent" in the UI while storing it as `auto`. */
export const COMPUTER_AWAKE_OPTIONS: ReadonlyArray<{
  mode: ComputerAwakeMode
  label: string
  hint: string
}> = [
  { mode: 'on', label: 'On', hint: 'Always keep the computer awake' },
  { mode: 'auto', label: 'Agent', hint: 'Only while an agent is running' },
  { mode: 'off', label: 'Off', hint: 'Let the computer sleep normally' }
]

export function computerAwakeModeLabel(mode: ComputerAwakeMode | null): string {
  if (mode === null) {
    return 'Loading…'
  }
  switch (mode) {
    case 'on':
      return 'On'
    case 'auto':
      return 'Agent'
    case 'off':
      return 'Off'
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

/** Read the mode out of a `settings.get` / `settings.update` result. Both keys are
 *  consulted because an older host only writes the legacy boolean. Returns null
 *  when the host reports neither: Orca's mobile `settings.get` is a whitelist
 *  (1.4.197 leaves the keep-awake keys out), and guessing "Off" there would
 *  contradict what the Mac's popover shows. */
export function readComputerAwakeModeFromSettings(settings: unknown): ComputerAwakeMode | null {
  const record =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const legacy = record.keepComputerAwakeWhileAgentsRun
  if (record.computerAwakeMode === undefined && typeof legacy !== 'boolean') {
    return null
  }
  return normalizeComputerAwakeMode(
    record.computerAwakeMode,
    typeof legacy === 'boolean' ? legacy : undefined
  )
}

export const COMPUTER_AWAKE_UNSUPPORTED_HINT = 'Not exposed to phones by this Orca build'


/** Params for `settings.update`; the same pair the desktop popover writes. */
export function computerAwakeUpdateParams(mode: ComputerAwakeMode): {
  computerAwakeMode: ComputerAwakeMode
  keepComputerAwakeWhileAgentsRun: boolean
} {
  return computerAwakeSettingsForMode(mode)
}
