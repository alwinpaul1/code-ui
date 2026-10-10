import { encodePowerShellCommand } from '../session/agent-hud-launch-args'
import { UNKNOWN_MAC_HOST_STATE, type MacHostState } from './mac-host-state'
import { WINDOWS_AUDIO_TYPE } from './windows-host-commands'

const MARKER = 'CUIWIN'

/**
 * What a Windows PC says about itself, printed as one marker line.
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
 * Standby: whether the PC has Modern Standby (S0 Low Power Idle), from
 * GetPwrCapabilities' AoAc flag. There the display going off IS the start of
 * standby: Sleep display put Danny's whole laptop to sleep on 2026-10-08, and the
 * phone lost it. `modern` hid the row; a keeper holding the PC awake before an
 * instant display-off did not save his laptop on 0.9.122, and since 2026-10-10 the
 * row is back with the display going off through Windows' own idle route instead
 * (windows-display-off-keeper.ts). The sleep script itself asks again. Same caveat
 * as the display read: not yet run on a Windows machine.
 *
 * Lock is not asked (2026-09-26). The sheet offers Lock PC whatever the PC says,
 * since Windows has no Unlock to offer instead, so reading LogonUI only held up
 * the two rows that do depend on an answer.
 *
 * The marker is built from parts, and the command line on the screen is base64, so
 * nothing but the script's own output can match.
 */
/** The console display state as a number, or -1 when Windows would not say. C# 5
 *  for Windows PowerShell 5.1, and free of single quotes: it sits inside one.
 *
 *  Terse on purpose: the probe must fit cmd.exe's 8,191-character command line
 *  after base64 of UTF-16LE, which costs about 2.7 characters per character
 *  here; it is also why `powrprof` has no `.dll` (Windows adds it). C is
 *  DEVICE_NOTIFY_CALLBACK_ROUTINE, P is DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS
 *  (a struct is sequential by default, and a zero context needs no assignment),
 *  and O takes PBT_POWERSETTINGCHANGE (0x8013), whose POWERBROADCAST_SETTING
 *  is a GUID and a DWORD length, so the value sits at offset 20. The flag 2 is
 *  DEVICE_NOTIFY_CALLBACK. k keeps the delegate alive while Windows holds it.
 *  AoAc is SYSTEM_POWER_CAPABILITIES.AoAc, byte 20 of a 76-byte struct, read into
 *  a larger buffer to spare: modern, classic, or unknown when Windows would not say.
 *
 *  A namespace block with no `using` lines of its own, so the probe can compile it
 *  in the same unit as the Core Audio type (WINDOWS_HOST_STATE_SCRIPT). */
export const WINDOWS_DISPLAY_NAMESPACE = [
  'namespace CodeUI{public static class DisplayPower{',
  'public delegate uint C(IntPtr c,uint t,IntPtr s);struct P{public C c;public IntPtr x;}',
  '[DllImport("powrprof")]static extern uint PowerSettingRegisterNotification(ref Guid g,uint f,ref P p,out IntPtr h);',
  '[DllImport("powrprof")]static extern uint PowerSettingUnregisterNotification(IntPtr h);',
  'static int v=-1;static ManualResetEvent e=new ManualResetEvent(false);static C k;',
  'static uint O(IntPtr c,uint t,IntPtr s){if(t==0x8013&&s!=IntPtr.Zero){v=Marshal.ReadInt32(s,20);e.Set();}return 0;}',
  'public static int Read(int ms){Guid g=new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");k=O;P p=new P();p.c=k;IntPtr h;',
  'if(PowerSettingRegisterNotification(ref g,2,ref p,out h)!=0){return -1;}',
  'try{e.WaitOne(ms);return v;}finally{PowerSettingUnregisterNotification(h);}}',
  '[DllImport("powrprof")]static extern byte GetPwrCapabilities(byte[] b);',
  'public static string AoAc(){var b=new byte[99];return GetPwrCapabilities(b)<1?"unknown":b[20]>0?"modern":"classic";}}}'
].join('')

/** The display type standing alone, as the probe compiles it when the shared unit fails. */
export const WINDOWS_DISPLAY_TYPE =
  'using System;using System.Runtime.InteropServices;using System.Threading;' + WINDOWS_DISPLAY_NAMESPACE

/**
 * Why one Add-Type: in Windows PowerShell 5.1 every Add-Type runs csc.exe, a
 * process of its own, and the probe used to start it twice, once per type. One
 * unit holding both types starts it once. If that unit fails to compile, each
 * type is compiled alone, as before, so a display type Windows PowerShell 5.1
 * refuses (it has never been compiled there) cannot take the mute read with it.
 * `-IgnoreWarnings` because Add-Type fails a unit the compiler only warns about,
 * and a warning from that older compiler would have cost a third compile.
 *
 * Under PowerShell 7 on macOS (2026-09-26, six runs each) the probe script went
 * from 681 ms to 426 ms, against 186 ms for PowerShell starting and doing nothing.
 * PowerShell 7 compiles in process, so on Windows PowerShell 5.1, where each
 * compile is a csc.exe start, the saving is larger. Not measured on Windows.
 */
export function windowsHostStateScript(displayNamespace: string = WINDOWS_DISPLAY_NAMESPACE): string {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$a='${WINDOWS_AUDIO_TYPE}'`,
    `$p='${displayNamespace}'`,
    "$u='using System.Threading;'",
    "try{Add-Type -IgnoreWarnings -TypeDefinition ($u+$a+$p)}catch{try{Add-Type -IgnoreWarnings -TypeDefinition $a}catch{};try{Add-Type -IgnoreWarnings -TypeDefinition ('using System;using System.Runtime.InteropServices;'+$u+$p)}catch{}}",
    "$m=$d=$s='unknown'",
    "try{$m=if([CodeUI.Audio]::GetMute()){'true'}else{'false'}}catch{}",
    "try{$d=@{0='off';1='on';2='dimmed'}[[CodeUI.DisplayPower]::Read(1000)];if(!$d){$d='unknown'}}catch{}",
    'try{$s=[CodeUI.DisplayPower]::AoAc()}catch{}',
    `'${MARKER.slice(0, 3)}'+"${MARKER.slice(3)} mute=$m display=$d standby=$s"`
  ].join('\n')
}

export const WINDOWS_HOST_STATE_SCRIPT = windowsHostStateScript()

export const WINDOWS_HOST_STATE_PROBE_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(WINDOWS_HOST_STATE_SCRIPT)}`

// Every field required: the script prints them in one string, so a line without
// the last is a line still being painted.
const MARKER_PATTERN = new RegExp(
  `${MARKER} mute=(true|false|unknown) display=(on|off|dimmed|unknown) standby=(modern|classic|unknown)\\b`
)

/** The last marker painted on the screen, or null while there is none. Lock is
 *  always unknown: the probe does not ask it. */
export function readWindowsHostStateMarker(lines: string[]): MacHostState | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = MARKER_PATTERN.exec(lines[index] ?? '')
    if (match) {
      return {
        lock: 'unknown',
        // Dimmed is on: the idle dim before sleep, where Sleep is the row that acts.
        display: match[2] === 'off' ? 'off' : match[2] === 'on' || match[2] === 'dimmed' ? 'on' : 'unknown',
        mute: match[1] === 'true' ? 'muted' : match[1] === 'false' ? 'unmuted' : 'unknown',
        ...(match[3] === 'modern' ? { sleepsWithDisplay: true as const } : {})
      }
    }
  }
  return null
}

/** The last marker painted on the screen, or unknown — which offers every row. */
export function parseWindowsHostState(lines: string[]): MacHostState {
  return readWindowsHostStateMarker(lines) ?? UNKNOWN_MAC_HOST_STATE
}
