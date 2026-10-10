import { encodePowerShellCommand } from '../session/agent-hud-launch-args'
import type { MacHostAction } from './mac-host-commands'
import {
  DISPLAY_OFF_READY_EVENT,
  DISPLAY_WAKE_EVENT,
  WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT
} from './windows-display-off-keeper'

/**
 * The one-tap controls a Windows host gets: the Mac set without Unlock.
 *
 * Why no Unlock: Windows takes a password only on its own sign-in screen, from the
 * keyboard or from a sign-in component an administrator installed on the PC. Nothing
 * a program on the PC runs can type into it, so there is no zero-install Unlock, and
 * the sheet offers Lock PC alone, whatever state the PC is in (mac-host-sheet-actions.ts).
 */
export type WindowsHostAction = Exclude<MacHostAction, 'unlock'>

export const WINDOWS_HOST_ACTION_LABELS: Record<WindowsHostAction, string> = {
  lock: 'Lock PC',
  'sleep-display': 'Sleep display',
  'wake-display': 'Wake display',
  mute: 'Mute PC',
  unmute: 'Unmute PC'
}

export const WINDOWS_HOST_ACTION_PROGRESS: Record<WindowsHostAction, string> = {
  lock: 'Locking the PC…',
  'sleep-display': 'Putting the display to sleep…',
  'wake-display': 'Waking the display…',
  mute: 'Muting the PC…',
  unmute: 'Unmuting the PC…'
}

/**
 * The line each script ends on, the same marker the Mac commands print
 * (MAC_HOST_COMMAND_DONE_PATTERN). Built from two strings so the script's own text
 * never contains it — and the command line on the screen is base64, which cannot.
 * A script that throws stops before it, so a refusal reads as "did not finish"
 * rather than as success.
 */
const DONE = `'CUIDONE '+'ok'`

/**
 * Core Audio's default output endpoint, for mute and its state. The interface
 * layout is IAudioEndpointVolume's vtable up to GetMute; the eleven unnamed slots
 * are the methods before SetMute. Written as C# 5, which is what Windows
 * PowerShell 5.1's compiler takes. Output only, as on the Mac: the microphone is
 * left alone.
 */
export const WINDOWS_AUDIO_TYPE = [
  'using System;using System.Runtime.InteropServices;',
  'namespace CodeUI{',
  '[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'interface IAudioEndpointVolume{int f();int g();int h();int i();int j();int k();int l();int m();int n();int o();int p();',
  'int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,Guid context);int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);}',
  '[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'interface IMMDevice{int Activate(ref Guid id,int context,int parameters,out IAudioEndpointVolume volume);}',
  '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'interface IMMDeviceEnumerator{int f();int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice device);}',
  '[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MMDeviceEnumerator{}',
  'public static class Audio{',
  'static IAudioEndpointVolume Endpoint(){IMMDevice device;',
  'Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)new MMDeviceEnumerator()).GetDefaultAudioEndpoint(0,1,out device));',
  'Guid id=typeof(IAudioEndpointVolume).GUID;IAudioEndpointVolume volume;',
  'Marshal.ThrowExceptionForHR(device.Activate(ref id,23,0,out volume));return volume;}',
  'public static void SetMute(bool mute){Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute,Guid.Empty));}',
  'public static bool GetMute(){bool mute;Marshal.ThrowExceptionForHR(Endpoint().GetMute(out mute));return mute;}',
  '}}'
].join('')

// SC_MONITORPOWER over WM_SYSCOMMAND to every top-level window: 2 is off, -1 is on.
// PostMessage rather than SendMessage, which waits on every window and can hang on one
// that never answers. GetPwrCapabilities is for Sleep display's Modern Standby check.
// Sleep and Wake each declare only what they call (2026-10-10): Sleep display carries
// the keeper inside it and needs every character under cmd.exe's 8,191. They are
// separate type names because the real-PowerShell test compiles both in one session.
const POST_MESSAGE = '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);'
const SLEEP_TYPE =
  `Add-Type -IgnoreWarnings -Namespace CodeUI -Name Display -MemberDefinition '${POST_MESSAGE}` +
  " [DllImport(\"powrprof.dll\")] public static extern byte GetPwrCapabilities(byte[] c);'"
const WAKE_TYPE =
  `Add-Type -IgnoreWarnings -Namespace CodeUI -Name Wake -MemberDefinition '${POST_MESSAGE}` +
  ' [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' +
  " [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);'"

const SCRIPTS: Record<WindowsHostAction, string[]> = {
  lock: [
    'Add-Type -IgnoreWarnings -Namespace CodeUI -Name Session -MemberDefinition ' +
      "'[DllImport(\"user32.dll\")] public static extern bool LockWorkStation();'",
    "if(-not [CodeUI.Session]::LockWorkStation()){throw 'LockWorkStation refused'}"
  ],
  // Why the branch (2026-10-08, Danny): on a PC with Modern Standby (S0 Low Power
  // Idle, most laptops since about 2019) the display going off IS the start of
  // standby, so the post alone put his whole laptop to sleep and the phone lost it.
  // AoAc is byte 20 of SYSTEM_POWER_CAPABILITIES (76 bytes; the buffer is larger to
  // spare). On such a PC the script posts nothing itself: it starts the keeper
  // (windows-display-off-keeper.ts), which holds the PC awake and then turns the
  // display off, and waits for the keeper's ready event. Signalled: done. Not
  // signalled: the keeper could not hold the PC, nothing was turned off, and the
  // refusal says so (built from two strings so the script's own text never matches).
  // 10 s, not more: the phone gives the whole command 15 s
  // (WINDOWS_HOST_COMMAND_TIMEOUT_MS), and the keeper's only delay is a powershell
  // start and one compile. The keeper is encoded here, on the PC: base64 inside this
  // command, itself base64, would cost 2.7 times over and break cmd.exe's 8,191.
  // Every other PC (AoAc 0, or a call that returns 0) gets the post, as before; a
  // call that throws stops the script ('Stop'), which reads as "did not finish".
  // The ready event needs no reset first: the keeper closes its handle the moment it
  // has set it, so the event is gone once this script exits.
  // NOT YET RUN ON A WINDOWS MACHINE: off Windows the capability call throws.
  'sleep-display': [
    SLEEP_TYPE,
    '$c=New-Object byte[] 128;if([CodeUI.Display]::GetPwrCapabilities($c) -and $c[20]){' +
      `$r=New-Object Threading.EventWaitHandle($false,'ManualReset','${DISPLAY_OFF_READY_EVENT}');` +
      `$k=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('${WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT.replace(/'/g, "''")}'));` +
      "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',$k;" +
      `if($r.WaitOne(10000)){${DONE}}else{'CUIREF'+'USED keepawake'};exit}`,
    "if(-not [CodeUI.Display]::PostMessage([IntPtr]0xFFFF,0x0112,[IntPtr]0xF170,[IntPtr]2)){throw 'PostMessage refused'}"
  ],
  // Monitor power on alone is unreliable since Windows 8, so the script also resets the
  // display idle timer (ES_DISPLAY_REQUIRED, as `caffeinate -u` does on the Mac) and
  // nudges the pointer one pixel and back, which any monitor treats as activity.
  // First it sets the keeper's wake event, when a keeper is running (2026-10-10: a
  // Wake right after Sleep must end the keeper at once, even before the display has
  // reported off). The display coming on ends the keeper anyway; so does mouse or
  // keyboard at the PC, as on the Mac. No keeper, no event, nothing to do.
  'wake-display': [
    WAKE_TYPE,
    `$w=$null;if([Threading.EventWaitHandle]::TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)){[void]$w.Set()}`,
    '[void][CodeUI.Wake]::PostMessage([IntPtr]0xFFFF,0x0112,[IntPtr]0xF170,[IntPtr](-1))',
    '[void][CodeUI.Wake]::SetThreadExecutionState(2)',
    '[CodeUI.Wake]::mouse_event(1,1,0,0,[UIntPtr]::Zero)',
    '[CodeUI.Wake]::mouse_event(1,-1,0,0,[UIntPtr]::Zero)'
  ],
  mute: [`Add-Type -IgnoreWarnings -TypeDefinition '${WINDOWS_AUDIO_TYPE}'`, '[CodeUI.Audio]::SetMute($true)'],
  unmute: [`Add-Type -IgnoreWarnings -TypeDefinition '${WINDOWS_AUDIO_TYPE}'`, '[CodeUI.Audio]::SetMute($false)']
}

/** The PowerShell each action runs, before encoding. Exposed for the tests that parse
 *  and compile it; the phone only ever sends buildWindowsHostCommand's output. */
export function windowsHostScript(action: WindowsHostAction): string {
  return ["$ErrorActionPreference='Stop'", ...SCRIPTS[action], DONE].join('\n')
}

/**
 * Why `powershell -EncodedCommand`: the PC's terminal may be PowerShell, cmd or a WSL
 * shell, and no quoting survives all three. Base64 of UTF-16LE has no quotes at all,
 * and `powershell` is Windows PowerShell 5.1, present on every Windows. The same form
 * as the HUD's Windows beacon (CLAUDE_HUD_WINDOWS_COMMAND).
 */
export function buildWindowsHostCommand(action: WindowsHostAction): string {
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(windowsHostScript(action))}`
}
