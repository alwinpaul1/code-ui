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
 * Display: the console display state, GUID_CONSOLE_DISPLAY_STATE, the power
 * setting Windows keeps for exactly this (0 off, 1 on, 2 dimmed). Windows sends
 * the current value to a new subscriber at once, so the script subscribes with a
 * callback (no window needed), takes that first value and unsubscribes. The
 * display-off command (SC_MONITORPOWER) is what drives it to 0. `unknown` when
 * nothing arrives within a second. Until 2026-09-23 this was not asked, and
 * both Sleep display and Wake display showed on every PC. NOT YET RUN ON A
 * WINDOWS MACHINE: PowerShell 7 on macOS parses the script and compiles the
 * type, and the call itself fails there, which reads as unknown.
 *
 * The marker is built from parts, and the command line on the screen is base64, so
 * nothing but the script's own output can match.
 */
/** The console display state as a number, or -1 when Windows would not say. C# 5
 *  for Windows PowerShell 5.1, and free of single quotes: it sits inside one.
 *
 *  Terse on purpose: the probe must fit cmd.exe's 8,191-character command line
 *  after base64 of UTF-16LE, which costs about 2.7 characters per character
 *  here. C is DEVICE_NOTIFY_CALLBACK_ROUTINE, P is DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS
 *  (a struct is sequential by default, and a zero context needs no assignment),
 *  and O takes PBT_POWERSETTINGCHANGE (0x8013), whose POWERBROADCAST_SETTING
 *  is a GUID and a DWORD length, so the value sits at offset 20. The flag 2 is
 *  DEVICE_NOTIFY_CALLBACK. k keeps the delegate alive while Windows holds it. */
export const WINDOWS_DISPLAY_TYPE = [
  'using System;using System.Runtime.InteropServices;using System.Threading;',
  'namespace CodeUI{public static class DisplayPower{',
  'public delegate uint C(IntPtr c,uint t,IntPtr s);struct P{public C c;public IntPtr x;}',
  '[DllImport("powrprof.dll")]static extern uint PowerSettingRegisterNotification(ref Guid g,uint f,ref P p,out IntPtr h);',
  '[DllImport("powrprof.dll")]static extern uint PowerSettingUnregisterNotification(IntPtr h);',
  'static int v=-1;static ManualResetEvent e=new ManualResetEvent(false);static C k;',
  'static uint O(IntPtr c,uint t,IntPtr s){if(t==0x8013&&s!=IntPtr.Zero){v=Marshal.ReadInt32(s,20);e.Set();}return 0;}',
  'public static int Read(int ms){Guid g=new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");k=O;P p=new P();p.c=k;IntPtr h;',
  'if(PowerSettingRegisterNotification(ref g,2,ref p,out h)!=0){return -1;}',
  'try{e.WaitOne(ms);return v;}finally{PowerSettingUnregisterNotification(h);}}}}'
].join('')

export const WINDOWS_HOST_STATE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$s=(Get-Process -Id $PID).SessionId',
  '$l=[int][bool](Get-Process -Name LogonUI | Where-Object {$_.SessionId -eq $s})',
  "$m='unknown'",
  `try{Add-Type -TypeDefinition '${WINDOWS_AUDIO_TYPE}';$m=if([CodeUI.Audio]::GetMute()){'true'}else{'false'}}catch{}`,
  "$d='unknown'",
  `try{Add-Type -TypeDefinition '${WINDOWS_DISPLAY_TYPE}';$d=@{0='off';1='on';2='dimmed'}[[CodeUI.DisplayPower]::Read(1000)];if(-not $d){$d='unknown'}}catch{}`,
  `'${MARKER.slice(0, 3)}'+'${MARKER.slice(3)} lock='+$l+' mute='+$m+' display='+$d`
].join('\n')

export const WINDOWS_HOST_STATE_PROBE_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(WINDOWS_HOST_STATE_SCRIPT)}`

const MARKER_PATTERN = new RegExp(
  `${MARKER} lock=([01]) mute=(true|false|unknown)(?: display=(on|off|dimmed|unknown))?\\b`
)

/** The last marker painted on the screen, or unknown — which offers every row. */
export function parseWindowsHostState(lines: string[]): MacHostState {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: match[1] === '1' ? 'locked' : 'unlocked',
        // Dimmed is on: the idle dim before sleep, where Sleep is the row that acts.
        display: match[3] === 'off' ? 'off' : match[3] === 'on' || match[3] === 'dimmed' ? 'on' : 'unknown',
        mute: match[2] === 'true' ? 'muted' : match[2] === 'false' ? 'unmuted' : 'unknown'
      }
    }
  }
  return UNKNOWN_MAC_HOST_STATE
}
