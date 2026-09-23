import { encodePowerShellCommand } from '../session/agent-hud-launch-args'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './mac-host-state'
import { WINDOWS_AUDIO_TYPE } from './windows-host-commands'

const MARKER = 'CUIWIN'

/**
 * What a Windows PC says about itself, printed as one marker line.
 *
 * Lock: the sign-in screen is LogonUI.exe, and it runs in this user's session only
 * while that screen is up. Filtered to the session this shell runs in, so another
 * user's sign-in screen on a shared PC does not read as this one locked.
 *
 * Mute: Core Audio's own flag on the default output endpoint, the same interface
 * the mute action writes. `unknown` when it cannot be read (no output device).
 *
 * Display: not asked. Windows has no reliable call for "is the monitor asleep", and
 * an unknown display half offers both Sleep and Wake, which is right rather than
 * guessed.
 *
 * The marker is built from parts, and the command line on the screen is base64, so
 * nothing but the script's own output can match.
 */
export const WINDOWS_HOST_STATE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$s=(Get-Process -Id $PID).SessionId',
  '$l=[int][bool](Get-Process -Name LogonUI | Where-Object {$_.SessionId -eq $s})',
  "$m='unknown'",
  `try{Add-Type -TypeDefinition '${WINDOWS_AUDIO_TYPE}';$m=if([CodeUI.Audio]::GetMute()){'true'}else{'false'}}catch{}`,
  `'${MARKER.slice(0, 3)}'+'${MARKER.slice(3)} lock='+$l+' mute='+$m`
].join('\n')

export const WINDOWS_HOST_STATE_PROBE_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(WINDOWS_HOST_STATE_SCRIPT)}`

const MARKER_PATTERN = new RegExp(`${MARKER} lock=([01]) mute=(true|false|unknown)\\b`)

/** The last marker painted on the screen, or unknown — which offers every row. */
export function parseWindowsHostState(lines: string[]): MacHostState {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: match[1] === '1' ? 'locked' : 'unlocked',
        display: 'unknown',
        mute: match[2] === 'true' ? 'muted' : match[2] === 'false' ? 'unmuted' : 'unknown'
      }
    }
  }
  return UNKNOWN_MAC_HOST_STATE
}
