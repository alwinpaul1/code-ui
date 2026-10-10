import { encodePowerShellCommand } from '../session/agent-hud-launch-args'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './mac-host-state'
import { WINDOWS_AUDIO_TYPE } from './windows-host-commands'

const MARKER = 'CUIWIN'

/**
 * What a Windows PC says about itself, printed as one marker line:
 * `CUIWIN mute=<true|false|unknown> end`.
 *
 * Mute: Core Audio's own flag on the default output endpoint, the same interface
 * the mute action writes. `unknown` when it cannot be read (no output device).
 *
 * Nothing else. Lock is not asked (2026-09-26): the sheet offers Lock PC whatever
 * the PC says, since Windows has no Unlock to offer instead. The display state and
 * Modern Standby were asked for Sleep display and Wake display, which the user
 * removed from Windows on 2026-10-10 (docs/windows-sleep-display.md), so nothing
 * reads them any more.
 *
 * `-Ig` (-IgnoreWarnings) because Add-Type fails a unit the compiler only warns
 * about, and none of this C# has met Windows PowerShell 5.1's compiler. A compile
 * that fails anyway reads as unknown mute, and the marker still prints, so the
 * phone stops waiting. Not yet run on a Windows machine: PowerShell 7 on macOS
 * parses the script and compiles the type, and the Core Audio call fails there,
 * which reads as unknown.
 *
 * No repair of the display timeout 0.9.126 could leave at 1 s rides here, though
 * Wake display carried one until 2026-10-10: it took this command to 7,667 of
 * cmd.exe's 8,191 characters, and it would make a read-only probe write the PC's
 * power plan on every open, with C# Windows PowerShell 5.1 has never compiled.
 * Such a PC is set back in Settings, under the screen timeout.
 *
 * The marker is built from parts, and the command line on the screen is base64, so
 * nothing but the script's own output can match.
 */
export const WINDOWS_HOST_STATE_SCRIPT = [
  '$ErrorActionPreference=0',
  `try{Add-Type -Ig -TypeDefinition '${WINDOWS_AUDIO_TYPE}'}catch{}`,
  "$m='unknown'",
  "try{$m=if([CodeUI.Audio]::GetMute()){'true'}else{'false'}}catch{}",
  `'${MARKER.slice(0, 3)}'+"${MARKER.slice(3)} mute=$m end"`
].join('\n')

export const WINDOWS_HOST_STATE_PROBE_COMMAND = `powershell -nop -noni -enc ${encodePowerShellCommand(WINDOWS_HOST_STATE_SCRIPT)}`

// The closing ` end` is what says the line is whole. The second shape is the line
// an older build's probe printed (`display=… standby=…` in place of `end`). The phone
// only reads the tab it opened with its own command, so that line should never reach
// it; it is accepted anyway, for its mute alone, because refusing it would cost a
// whole probe budget for an answer that is right there.
const MARKER_PATTERN = new RegExp(
  `${MARKER} mute=(true|false|unknown)(?: end| display=(?:on|off|dimmed|unknown) standby=(?:modern|classic|unknown))\\b`
)

/** The last marker painted on the screen, or null while there is none. Lock and
 *  display are always unknown: the probe asks neither. */
export function readWindowsHostStateMarker(lines: string[]): MacHostState | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: 'unknown',
        display: 'unknown',
        mute: match[1] === 'true' ? 'muted' : match[1] === 'false' ? 'unmuted' : 'unknown'
      }
    }
  }
  return null
}

/** The last marker painted on the screen, or unknown — which offers both mute rows. */
export function parseWindowsHostState(lines: string[]): MacHostState {
  return readWindowsHostStateMarker(lines) ?? UNKNOWN_MAC_HOST_STATE
}
